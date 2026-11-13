"""Metadata-only directory readers. Never run searches to discover a catalog."""
import asyncio
import hashlib
import json
import time
from urllib.parse import urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx

from app.providers import jackett_path
from app.resource_metadata import category_ids, label_values, normalize_label
from app.stats import source_key

MAX_DIRECTORY_LABELS = 1000
MAX_DIRECTORY_BYTES = 2 * 1024 * 1024


def catalog_key(source):
    value = [source_key(source), source.catalog_mode, source.catalog_headers, source.catalog_revision]
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def catalog_provider(source):
    if source.catalog_mode == "disabled":
        return "none"
    if source.source_type == "jackett":
        return "jackett_caps"
    if urlsplit(source.url).path.rstrip("/").endswith("/api/v1/articles/torrents"):
        return "article_categories"
    # Probe only the JavDB adapter route. Extension routes have no movie genres.
    # A matching URL alone is not evidence: the response must identify its contract.
    if urlsplit(source.url).path.rstrip("/").endswith("/api/torrents"):
        return "adapter_genres"
    return "none"


def clean_directory(labels):
    """Validate external snapshots and deduplicate without merging different fields."""
    if not isinstance(labels, list):
        raise ValueError("目录必须为数组")
    rows, limited = {}, len(labels) > MAX_DIRECTORY_LABELS
    for row in labels[:10000]:
        if not isinstance(row, dict) or row.get("field") not in {"category", "category_ids", "genres"}:
            limited = True
            continue
        field = row["field"]
        values = category_ids([row.get("value")]) if field == "category_ids" else label_values(row.get("value"))
        if len(values) != 1:
            limited = True
            continue
        value = values[0]
        names = label_values(row.get("display_name", value))
        if len(names) != 1:
            limited = True
            continue
        key = (field, normalize_label(value))
        count = row.get("catalog_count")
        count = min(count, 2147483647) if type(count) is int and count >= 0 else None
        if key in rows:
            previous = rows[key]["catalog_count"]
            if previous is not None and count is not None:
                rows[key]["catalog_count"] = min(previous + count, 2147483647)
            continue
        if len(rows) >= MAX_DIRECTORY_LABELS:
            limited = True
            continue
        rows[key] = {"field": field, "value": value, "display_name": names[0], "catalog_count": count}
    return sorted(rows.values(), key=lambda row: (normalize_label(row["display_name"]), row["value"])), limited


def parse_article_categories(value):
    groups = value.get("data") if isinstance(value, dict) else None
    if not isinstance(groups, list):
        raise ValueError("分类目录响应格式无效")
    labels = []
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("分类目录响应格式无效")
        # Xiuxian nests categories under sections; AVDB returns flat sections.
        sections = group.get("sections", [group])
        if not isinstance(sections, list):
            raise ValueError("分类目录响应格式无效")
        entries = []
        for section in sections:
            if not isinstance(section, dict) or not isinstance(section.get("categories"), list):
                raise ValueError("分类目录响应格式无效")
            entries.extend(section["categories"])
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
                raise ValueError("分类目录响应格式无效")
            labels.append({"field": "category", "value": entry["name"], "catalog_count": entry.get("count")})
    return clean_directory(labels)


def parse_jackett_caps(content):
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise ValueError("分类目录响应格式无效")
    root = ElementTree.fromstring(content)
    categories = root.find("categories")
    if root.tag != "caps" or categories is None:
        raise ValueError("分类目录响应格式无效")
    return clean_directory([{"field": "category_ids", "value": row.get("id"), "display_name": row.get("name")}
                            for row in categories.iter() if row.tag in {"category", "subcat"}])


def parse_adapter_genres(value):
    if (not isinstance(value, dict) or value.get("provider") != "db_online" or
            value.get("coverage") != "cached_movies" or
            type(value.get("limited")) is not bool or not isinstance(value.get("labels"), list)):
        raise ValueError("影片风格目录响应格式无效")
    if any(not isinstance(row, dict) or row.get("field") != "genres" or
           not isinstance(row.get("value"), str) for row in value["labels"]):
        raise ValueError("影片风格目录字段无效")
    labels, limited = clean_directory(value["labels"])
    return labels, limited or value["limited"]


async def fetch_directory(client, source):
    provider = catalog_provider(source)
    base = {"provider": provider, "status": "unsupported", "error": None}
    if source.catalog_mode == "disabled":
        return {**base, "status": "disabled"}
    if provider == "none":
        return base
    try:
        headers = httpx.Headers(source.headers)
        headers.update(source.catalog_headers)
        params = None
        if provider == "jackett_caps":
            url = jackett_path(source, "/torznab/api")
            params = {"apikey": source.jackett_api_key, "t": "caps"}
        else:
            parsed = urlsplit(source.url)
            path = parsed.path.rstrip("/").removesuffix("/torrents")
            path += "/catalog/genres" if provider == "adapter_genres" else "/categories"
            url = urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
        timeout = min(source.timeout, 8)
        async with asyncio.timeout(timeout):
            async with client.stream("GET", url, params=params, headers=headers, timeout=timeout,
                                     follow_redirects=False) as response:
                if response.status_code in {401, 403}:
                    return {**base, "status": "unauthorized", "error": "目录权限不足或会话已过期，请在数据源中重新登录目录或更新专用请求头。"}
                if response.status_code in {404, 405}:
                    return {**base, "status": "unsupported", "error": "此源未提供可读取的分类目录，继续积累搜索标签。"}
                if response.status_code != 200:
                    return {**base, "status": "error", "error": f"目录服务返回 HTTP {response.status_code}，保留上次成功目录。"}
                content = bytearray()
                async for part in response.aiter_bytes():
                    content.extend(part)
                    if len(content) > MAX_DIRECTORY_BYTES:
                        raise ValueError("目录超过容量限制")
        if provider == "jackett_caps":
            labels, limited = parse_jackett_caps(bytes(content))
        elif provider == "adapter_genres":
            labels, limited = parse_adapter_genres(json.loads(content))
        else:
            labels, limited = parse_article_categories(json.loads(content))
        return {**base, "status": "ready", "labels": labels, "limited": limited,
                "coverage": {"jackett_caps": "declared_categories", "adapter_genres": "cached_movies",
                             "article_categories": "current_database"}[provider],
                "origin": "upstream"}
    except (TimeoutError, httpx.TimeoutException):
        return {**base, "status": "error", "error": "目录读取超时，保留上次成功目录。"}
    except Exception:
        # Neither raw responses nor exceptions may expose upstream credentials.
        return {**base, "status": "error", "error": "目录无法读取或格式无效，保留上次成功目录。"}


class CatalogSync:
    """One serial metadata job at a time; cache GETs never contact upstreams."""
    def __init__(self, store, sources):
        self.store, self.sources, self.task = store, sources, None

    @property
    def refreshing(self):
        return self.task is not None and not self.task.done()

    def start(self, source_id="all", force=True):
        if not self.refreshing:
            targets = [s.model_copy(deep=True) for s in self.sources()
                       if s.enabled and (source_id == "all" or s.id == source_id)]
            self.task = asyncio.create_task(self._run(targets, force))

    async def _run(self, targets, force):
        try:
            async with httpx.AsyncClient(verify=False) as client:
                for source in targets:
                    if source.catalog_mode == "disabled" or catalog_provider(source) == "none":
                        continue
                    if not force and not await asyncio.to_thread(self.store.directory_due, source):
                        continue
                    # A source can be edited/deleted while another directory is read.
                    if not any(s.id == source.id and catalog_key(s) == catalog_key(source) for s in self.sources()):
                        continue
                    result = await fetch_directory(client, source)
                    await asyncio.to_thread(self.store.record_directory, source, result, self.sources)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Metadata persistence failures must not take down the search service.
            import logging
            logging.getLogger("bm-bt-proxy").warning("Directory synchronization failed; search is unaffected")

    async def schedule(self):
        while True:
            self.start(force=False)
            await asyncio.sleep(3600)

    async def close(self):
        if self.refreshing:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
