"""Bounded read-only translation of db_online movies to the BM-BT item contract."""
import asyncio
import hashlib
import math
import os
import re
from contextlib import asynccontextmanager
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Query

BASE_URL = os.getenv('DBONLINE_URL', 'http://db_online:9090').rstrip('/')
API_KEY = os.getenv('DBONLINE_API_KEY', '')
MAX_MOVIES = 3
CODE = re.compile(r'([a-zA-Z]{2,12})-?(\d{2,8})\Z')
MAGNET = re.compile(r'urn:btih:([a-zA-Z0-9]{32,40})(?:&|$)', re.I)
ED2K = re.compile(r'\|file\|[^|]+\|\d+\|([a-fA-F0-9]{32})\|')


class UpstreamError(Exception):
    pass


def code_query(keyword):
    match = CODE.fullmatch(keyword)
    return f'{match[1].upper()}-{match[2]}' if match else None


def extension_code_query(keyword):
    """Keep special identifiers usable even when JavDB has no movie entry."""
    code = code_query(keyword)
    if code:
        return code
    if len(keyword) <= 64 and re.fullmatch(
            r'(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)'
            r'[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*', keyword):
        return keyword.upper()
    return None


def resources(movie, site='db_online'):
    if not isinstance(movie, dict) or not any(k in movie for k in ('magnets', 'ed2ks')):
        raise UpstreamError('Invalid movie object')
    items, seen = [], set()
    for field, link_field in [('magnets', 'magnet'), ('ed2ks', 'ed2k')]:
        entries = movie.get(field) or []
        if not isinstance(entries, list):
            raise UpstreamError('Invalid resources')
        for resource in entries:
            if not isinstance(resource, dict):
                continue
            link = resource.get(link_field)
            if not isinstance(link, str):
                continue
            link = link.strip()
            match = MAGNET.search(link) if link.startswith('magnet:?') else None
            ed2k_match = ED2K.search(link) if link.startswith('ed2k://') else None
            if not (match or ed2k_match):
                continue
            key = ('btih:' + match[1].upper()) if match else ('ed2k:' + ed2k_match[1].upper())
            if key in seen:
                continue
            seen.add(key)
            try:
                size = float(resource.get('size_mb') or 0)
                if not math.isfinite(size) or size < 0:
                    size = 0
            except (TypeError, ValueError):
                size = 0
            title = str(resource.get('name') or movie.get('code') or 'db_online')[:2048]
            tags = resource.get('tags') or []
            labels = [tag if isinstance(tag, str) else str(tag.get('name', ''))
                      for tag in tags if isinstance(tag, (str, dict))] if isinstance(tags, list) else []
            flags = (' '.join(labels) + ' ' + title).casefold()
            preview = movie.get('cover_url') or movie.get('thumb_url') or ''
            preview = preview if isinstance(preview, str) and urlsplit(preview).scheme in ('http', 'https') else ''
            items.append({
                # Byte-Muse requires an integer; stay within JavaScript's safe range.
                'id': int(hashlib.sha256(key.encode()).hexdigest()[:13], 16),
                'site': site, 'type': link_field, 'title': title,
                'download_url': link, 'size_mb': size,
                'preview_image': preview, 'date': str(resource.get('date') or ''),
                'seeders': 0, 'chinese': resource.get('chinese') is True or any(t in flags for t in ('中字', '中文', 'chs', 'chinese')),
                'uc': resource.get('uc') is True or any(t in flags for t in ('无码', '破解', 'uncensored')),
                'uhd': resource.get('uhd') is True or any(t in flags for t in ('4k', '2160p', 'uhd')),
                'free': resource.get('free') is True,
            })
    return items


def extension_resources(value, kind):
    if not isinstance(value, dict) or not any(k in value for k in ('magnets', 'ed2ks')):
        raise UpstreamError('Invalid extension response')
    movie = {'code': value.get('code'), 'magnets': [], 'ed2ks': []}
    for field, link_field in [('magnets', 'magnet'), ('ed2ks', 'ed2k')]:
        entries = value.get(field)
        if entries is None:
            continue
        if not isinstance(entries, list):
            raise UpstreamError('Invalid extension resources')
        for entry in entries:
            if not isinstance(entry, dict):
                raise UpstreamError('Invalid extension resource')
            movie[field].append({**entry, link_field: entry.get('download_url'),
                                 'name': entry.get('title') or entry.get('number'),
                                 'date': entry.get('post_time')})
    items = resources(movie, site='db_online_' + kind)
    if not items and (movie['magnets'] or movie['ed2ks'] or value.get('count')):
        raise UpstreamError('Extension resources contain no usable links')
    return items


class Provider:
    def __init__(self, client):
        self.client = client
        self.gate = asyncio.Semaphore(2)

    async def get(self, path, params=None, missing_ok=False):
        try:
            response = await self.client.get(path, params=params)
            if missing_ok and response.status_code == 404:
                return None
            response.raise_for_status()
            value = response.json()
        except httpx.TimeoutException as error:
            raise TimeoutError('db_online request timed out') from error
        except (httpx.HTTPError, ValueError) as error:
            raise UpstreamError('db_online request failed') from error
        if not isinstance(value, dict) or value.get('success') is not True:
            error = str(value.get('error', '')) if isinstance(value, dict) else ''
            if missing_ok and ('未找到影片:' in error or 'movie not found' in error.lower()):
                return None
            raise UpstreamError('db_online returned an error')
        if value.get('data') is None:
            raise UpstreamError('Missing db_online data')
        return value['data']

    async def search(self, keyword):
        if not keyword:
            return {'data': []}
        async with asyncio.timeout(22):
            async with self.gate:
                code = code_query(keyword)
                if code:
                    movie = await self.get('/api/video/' + quote(code, safe=''), missing_ok=True)
                    return {'data': resources(movie) if movie is not None else []}
                result = await self.get('/api/search', {'q': keyword, 'page': 1, 'limit': MAX_MOVIES})
                if not isinstance(result, dict) or not isinstance(result.get('movies'), list):
                    raise UpstreamError('Invalid search response')
                matches = result['movies']
                selected, ids = [], set()
                for movie in matches:
                    if not isinstance(movie, dict) or not isinstance(movie.get('number'), str):
                        raise UpstreamError('Invalid movie search result')
                    number = movie['number'].strip()
                    if number and number not in ids:
                        ids.add(number)
                        selected.append(movie)
                    if len(selected) == MAX_MOVIES:
                        break
                items, seen = [], set()
                for movie in selected:
                    detail = await self.get('/api/video/' + quote(movie['number'], safe=''),
                                            {'video_id': movie['id']} if movie.get('id') else None,
                                            missing_ok=True)
                    for item in resources(detail) if detail is not None else []:
                        if item['id'] not in seen:
                            seen.add(item['id'])
                            items.append(item)
                return {'data': items, 'meta': {'selected_movies': len(selected),
                                               'limit': MAX_MOVIES, 'limited': len(matches) > MAX_MOVIES}}

    async def search_extensions(self, keyword, kind):
        if not keyword:
            return {'data': []}
        async with asyncio.timeout(22):
            async with self.gate:
                code = extension_code_query(keyword)
                if code:
                    value = await self.get('/api/external-magnets/' + kind + '/' + quote(code, safe=''))
                    return {'data': extension_resources(value, kind)}
                result = await self.get('/api/search', {'q': keyword, 'page': 1, 'limit': MAX_MOVIES})
                if not isinstance(result, dict) or not isinstance(result.get('movies'), list):
                    raise UpstreamError('Invalid search response')
                codes = []
                for movie in result['movies']:
                    if not isinstance(movie, dict) or not isinstance(movie.get('number'), str):
                        raise UpstreamError('Invalid movie search result')
                    number = movie['number'].strip()
                    if number and number not in codes:
                        codes.append(number)
                    if len(codes) == MAX_MOVIES:
                        break
                items, seen = [], set()
                for code in codes:
                    value = await self.get('/api/external-magnets/' + kind + '/' + quote(code, safe=''))
                    for item in extension_resources(value, kind):
                        if item['id'] not in seen:
                            seen.add(item['id'])
                            items.append(item)
                return {'data': items, 'meta': {'selected_movies': len(codes), 'limit': MAX_MOVIES,
                                               'limited': len(result['movies']) > MAX_MOVIES}}


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(base_url=BASE_URL, headers={'X-API-Key': API_KEY},
                                 timeout=10, limits=httpx.Limits(max_connections=4),
                                 follow_redirects=False) as client:
        app.state.provider = Provider(client)
        yield


app = FastAPI(title='db_online BM-BT adapter', version='0.2.0', lifespan=lifespan)


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.get('/api/torrents')
async def search(keyword: str = Query(default='', max_length=200)):
    try:
        return await app.state.provider.search(keyword.strip())
    except TimeoutError:
        raise HTTPException(504, 'db_online search timed out') from None
    except UpstreamError:
        raise HTTPException(502, 'db_online search failed') from None


@app.get('/api/torrents/{kind}')
async def search_extensions(kind: Literal['custom', 'nyaa'], keyword: str = Query(default='', max_length=200)):
    try:
        return await app.state.provider.search_extensions(keyword.strip(), kind)
    except TimeoutError:
        raise HTTPException(504, 'db_online extension search timed out') from None
    except UpstreamError:
        raise HTTPException(502, 'db_online extension search failed') from None
