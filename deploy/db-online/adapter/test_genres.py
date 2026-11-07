"""Keep film genres distinct from resource attributes and bound catalog reads."""
import asyncio
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

spec = importlib.util.spec_from_file_location('genre_adapter', Path(__file__).with_name('main.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

LINK = 'magnet:?xt=urn:btih:' + 'a' * 40
ED2K = 'ed2k://|file|fixture.mkv|123|' + 'b' * 32 + '|/'


def movie():
    return {'code': 'TEST-123',
            'magnets': [{'name': 'ordinary resource', 'magnet': LINK,
                         'size_mb': '12.5', 'tags': ['字幕', 'resource tag']}],
            'ed2ks': [{'name': 'ordinary ED2K', 'ed2k': ED2K}]}


class GenreMapping(unittest.TestCase):
    def test_film_4k_and_uncensored_genres_do_not_change_resource_flags(self):
        value = movie()
        baseline = adapter.resources(value)
        value['categories'] = [{'name': '4K', 'external_id': '347'},
                               {'name': '无码破解', 'external_id': '348'},
                               {'name': 'OL', 'private': 'do-not-copy'}]
        actual = adapter.resources(value)
        for old, new in zip(baseline, actual):
            self.assertEqual(new['genres'], ['4K', '无码破解', 'OL'])
            self.assertEqual({k: v for k, v in new.items() if k != 'genres'},
                             {k: v for k, v in old.items() if k != 'genres'})
            self.assertFalse(new['uhd'])
            self.assertFalse(new['uc'])
        self.assertEqual(actual[0]['tags'], ['字幕', 'resource tag'])
        self.assertTrue(actual[0]['chinese'])
        self.assertNotIn('do-not-copy', json.dumps(actual))

    def test_missing_invalid_and_unsafe_film_genres_do_not_break_resources(self):
        for categories in [None, 'OL', {}, 123]:
            value = movie()
            value['categories'] = categories
            self.assertTrue(all(v['genres'] == [] for v in adapter.resources(value)))
        value = movie()
        value['categories'] = [None, 123, {}, {'name': False}, {'name': ' OL '},
                               'OL', {'name': 'https://private.test/?key=secret'},
                               'token=private', 'bad\x00name', ' ', 'x' * 81]
        self.assertEqual(adapter.resources(value)[0]['genres'], ['OL'])


class GenreRequests(unittest.IsolatedAsyncioTestCase):
    async def request(self, handler, path='/api/catalog/genres', params=None):
        async with httpx.AsyncClient(base_url='http://upstream.test',
                                     transport=httpx.MockTransport(handler)) as upstream:
            adapter.app.state.provider = adapter.Provider(upstream)
            async with httpx.AsyncClient(base_url='http://adapter.test',
                                         transport=httpx.ASGITransport(app=adapter.app)) as client:
                return await client.get(path, params=params)

    async def test_catalog_keeps_more_than_32_names_and_only_public_label_fields(self):
        calls = []
        entries = [{'id': i, 'name': f'genre {i}', 'external_id': str(i),
                    'private': 'do-not-copy'} for i in range(40)]
        entries.extend([{'name': ' OL '}, {'name': 'ol'}, {'name': 'ＯＬ'}])
        def respond(request):
            calls.append((request.method, request.url.path, str(request.url.query)))
            return httpx.Response(200, json={'success': True, 'data': entries})
        response = await self.request(respond)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(calls, [('GET', '/api/options/categories', "b''")])
        self.assertEqual(set(body), {'provider', 'coverage', 'labels', 'limited'})
        self.assertEqual(body['provider'], 'db_online')
        self.assertEqual(body['coverage'], 'cached_movies')
        self.assertFalse(body['limited'])
        self.assertEqual(len(body['labels']), 41)
        self.assertEqual(body['labels'][-1], {'field': 'genres', 'value': 'OL'})
        self.assertEqual(body['labels'][39], {'field': 'genres', 'value': 'genre 39'})
        self.assertTrue(all(set(row) == {'field', 'value'} for row in body['labels']))
        self.assertNotIn('do-not-copy', response.text)
        self.assertNotIn('external_id', response.text)

    async def test_catalog_caps_unique_names_and_reports_omissions(self):
        for count, expected, limited in [(0, 0, False), (1000, 1000, False),
                                         (1001, 1000, True)]:
            with self.subTest(count=count):
                entries = [{'name': f'genre {i}'} for i in range(count)]
                response = await self.request(lambda r: httpx.Response(
                    200, json={'success': True, 'data': entries}))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()['labels']), expected)
                self.assertIs(response.json()['limited'], limited)
        entries = [{'name': 'OL'}] * 10000 + [{'name': 'outside scan bound'}]
        response = await self.request(lambda r: httpx.Response(
            200, json={'success': True, 'data': entries}))
        self.assertEqual(response.json()['labels'], [{'field': 'genres', 'value': 'OL'}])
        self.assertTrue(response.json()['limited'])

    async def test_catalog_drops_unsafe_names_and_reports_incomplete_directory(self):
        entries = [{'name': name} for name in [' OL ', '', 'x' * 81, 'bad\x00name',
                    'https://private.test/?key=secret', 'magnet:private', 'token=private']]
        response = await self.request(lambda r: httpx.Response(
            200, json={'success': True, 'data': entries}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['labels'], [{'field': 'genres', 'value': 'OL'}])
        self.assertTrue(response.json()['limited'])
        self.assertNotIn('private', response.text)

    async def test_catalog_schema_failures_are_fixed_502_errors(self):
        for data in [None, {}, 'private', ['private'], [{}], [{'name': 1}],
                     [{'name': 'OL'}, {'name': False}]]:
            with self.subTest(data=data):
                response = await self.request(lambda r: httpx.Response(
                    200, json={'success': True, 'data': data}))
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json(), {'detail': 'db_online genre directory failed'})

    async def test_catalog_upstream_failures_and_timeout_are_sanitized(self):
        for fixture in [httpx.Response(401, text='private'),
                        httpx.Response(503, text='private'),
                        httpx.Response(200, text='private invalid JSON'),
                        httpx.Response(200, json={'success': False, 'error': 'private'})]:
            response = await self.request(lambda r, fixture=fixture: fixture)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json(), {'detail': 'db_online genre directory failed'})
        def timeout(request):
            raise httpx.ReadTimeout('private URL and credential', request=request)
        response = await self.request(timeout)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json(), {'detail': 'db_online genre directory timed out'})

    async def test_catalog_deadline_includes_waiting_for_search_gate(self):
        def unexpected(request):
            self.fail('catalog bypassed the shared search gate')
        async with httpx.AsyncClient(base_url='http://upstream.test',
                                     transport=httpx.MockTransport(unexpected)) as upstream:
            provider = adapter.Provider(upstream)
            provider.gate = asyncio.Semaphore(0)
            real_timeout = asyncio.timeout
            def short_deadline(seconds):
                self.assertEqual(seconds, 8)
                return real_timeout(0.01)
            with patch.object(adapter.asyncio, 'timeout', side_effect=short_deadline):
                with self.assertRaises(TimeoutError):
                    await provider.genre_catalog()

    async def test_catalog_deadline_cancels_slow_upstream(self):
        cancelled = []
        async def slow(request):
            try:
                await asyncio.sleep(1)
                self.fail('request exceeded the catalog deadline')
            except asyncio.CancelledError:
                cancelled.append(True)
                raise
        real_timeout = asyncio.timeout
        def short_deadline(seconds):
            self.assertEqual(seconds, 8)
            return real_timeout(0.01)
        with patch.object(adapter.asyncio, 'timeout', side_effect=short_deadline):
            response = await self.request(slow)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(cancelled, [True])

    async def test_catalog_failure_does_not_disable_search(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            data = [{'name': False}] if request.url.path.endswith('categories') else movie()
            return httpx.Response(200, json={'success': True, 'data': data})
        async with httpx.AsyncClient(base_url='http://upstream.test',
                                     transport=httpx.MockTransport(respond)) as upstream:
            adapter.app.state.provider = adapter.Provider(upstream)
            async with httpx.AsyncClient(base_url='http://adapter.test',
                                         transport=httpx.ASGITransport(app=adapter.app)) as client:
                self.assertEqual((await client.get('/api/catalog/genres')).status_code, 502)
                response = await client.get('/api/torrents', params={'keyword': 'TEST-123'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['data']), 2)
        self.assertEqual(calls, ['/api/options/categories', '/api/video/TEST-123'])

    async def test_exact_and_broad_search_keep_request_counts_and_per_film_genres(self):
        for keyword, expected_calls in [('TEST-123', 1), ('fixture', 4)]:
            calls = []
            def respond(request):
                calls.append(request.url.path)
                if request.url.path == '/api/search':
                    return httpx.Response(200, json={'success': True, 'data': {'movies': [
                        {'number': f'TEST-{i}'} for i in range(1, 4)]}})
                code = request.url.path.rsplit('/', 1)[-1]
                value = movie()
                value['code'] = code
                value['categories'] = [{'name': f'genre for {code}'}]
                value['magnets'][0]['magnet'] = 'magnet:?xt=urn:btih:' + code.split('-')[-1].zfill(40)
                value['ed2ks'] = []
                return httpx.Response(200, json={'success': True, 'data': value})
            response = await self.request(respond, '/api/torrents', {'keyword': keyword})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(calls), expected_calls)
            self.assertFalse(any('categories' in path or 'following' in path for path in calls))
            expected_codes = [keyword] if expected_calls == 1 else [f'TEST-{i}' for i in range(1, 4)]
            self.assertEqual([v['genres'] for v in response.json()['data']],
                             [[f'genre for {code}'] for code in expected_codes])

    async def test_extensions_never_inherit_film_genres_or_fetch_details(self):
        for kind in ['custom', 'nyaa']:
            calls = []
            def respond(request):
                calls.append(request.url.path)
                return httpx.Response(200, json={'success': True, 'data': {
                    'categories': [{'name': 'must not inherit'}],
                    'magnets': [{'title': 'fixture', 'download_url': LINK,
                                 'tags': ['resource tag'], 'categories': [{'name': 'also ignored'}]}],
                    'ed2ks': []}})
            response = await self.request(respond, f'/api/torrents/{kind}', {'keyword': 'TEST-123'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(calls, [f'/api/external-magnets/{kind}/TEST-123'])
            self.assertEqual(response.json()['data'][0]['genres'], [])
            self.assertEqual(response.json()['data'][0]['tags'], ['resource tag'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
