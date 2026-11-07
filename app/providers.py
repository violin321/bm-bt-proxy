"""Upstream protocols. Credentials and raw exception messages stay server-side."""
import asyncio
import hashlib
import math
import re
import time
from urllib.parse import quote, urlsplit

import httpx
from app.aggregation import canonical_btih, dedup_key
from app.resource_metadata import label_values


def jackett_path(source, suffix=""):
    return source.url.rstrip("/") + "/api/v2.0/indexers/" + quote(source.jackett_indexer, safe="") + "/results" + suffix


def number(value, integer=False):
    try:
        result = float(value or 0)
        if not math.isfinite(result) or result < 0:
            return 0
        return int(result) if integer else result
    except (TypeError, ValueError, OverflowError):
        return 0


def jackett_items(rows):
    items, skipped, seen = [], 0, set()
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        link = row.get("MagnetUri") or ""
        if not link and isinstance(row.get("Link"), str) and row["Link"].startswith("magnet:?"):
            link = row["Link"]
        if not isinstance(link, str) or not link.startswith("magnet:?") or not dedup_key({"magnet": link}).startswith("btih:"):
            infohash = canonical_btih(str(row.get("InfoHash") or ""))
            if not infohash:
                skipped += 1
                continue
            link = "magnet:?xt=urn:btih:" + infohash
        key = dedup_key({"magnet": link})
        if key in seen:
            continue
        seen.add(key)
        title = str(row.get("Title") or "Jackett")[:2048]
        # Conservative resource flags; being a public tracker does not mean freeleech.
        lower = title.casefold()
        poster = row.get("Poster")
        preview = poster if isinstance(poster, str) and urlsplit(poster).scheme in ("http", "https") else ""
        items.append({"id": int(hashlib.sha256(key.encode()).hexdigest()[:13], 16),
                      "site": str(row.get("Tracker") or row.get("TrackerId") or "Jackett")[:150],
                      "type": "magnet", "title": title, "download_url": link,
                      "size_mb": number(row.get("Size")) / 1024 / 1024,
                      "seeders": number(row.get("Seeders"), integer=True),
                      "date": str(row.get("PublishDate") or ""), "preview_image": preview,
                      "chinese": bool(re.search(r"中字|中文字幕|中文|\bchs\b|\bchinese\b", lower)),
                      "uc": bool(re.search(r"无码|無碼|破解|\buncensored\b|\buc\b", lower)),
                      "uhd": bool(re.search(r"\b4k\b|\b8k\b|\b2160p\b|\buhd\b", lower)),
                      "free": row.get("DownloadVolumeFactor") == 0,
                      "upstream_flags": {},
                      "category": label_values(row.get("CategoryDesc")),
                      "tags": label_values(row.get("Label")),
                      "genres": label_values(row.get("Genres"))})
    return items, skipped


def parse_jackett(value):
    if not isinstance(value, dict) or not isinstance(value.get("Results"), list) or not isinstance(value.get("Indexers"), list) or not value["Indexers"]:
        raise ValueError("Jackett 响应格式无效或没有可查询的站点")
    # Never relay Jackett Error strings: they can contain URLs and credentials.
    indexers = []
    for entry in value["Indexers"]:
        if not isinstance(entry, dict):
            raise ValueError("Jackett 站点状态格式无效")
        ok = entry.get("Status") == 2
        indexers.append({"id": str(entry.get("ID") or "")[:100],
                         "name": str(entry.get("Name") or "未命名站点")[:150],
                         "success": ok, "count": number(entry.get("Results"), integer=True),
                         "latency_ms": number(entry.get("ElapsedTime"), integer=True),
                         "error": None if ok else "站点查询失败，请在 Jackett 中查看详情"})
    successes = sum(i["success"] for i in indexers)
    items, skipped = jackett_items(value["Results"] if successes else [])
    outcome = "complete" if successes == len(indexers) else "partial" if successes else "failed"
    return {"items": items, "skipped_count": skipped, "indexers": indexers,
            "success": bool(successes), "outcome": outcome,
            "error": None if outcome == "complete" else "部分站点失败" if successes else "全部站点失败"}


async def fetch_source(client, source, keyword):
    start = time.monotonic()
    result = dict(id=source.id, name=source.name, success=False, outcome="failed", status_code=None,
                  latency_ms=0, count=0, error=None, items=[], indexers=[], skipped_count=0)
    try:
        async with asyncio.timeout(source.timeout):
            if source.source_type == "jackett":
                if not keyword.strip():
                    result.update(success=True, outcome="complete")
                    return result
                if not source.jackett_api_key:
                    raise ValueError("请配置 Jackett API Key")
                response = await client.get(jackett_path(source), params={"apikey": source.jackett_api_key, "query": keyword.strip()},
                                            headers=source.headers, timeout=source.timeout)
            elif source.method == "POST":
                response = await client.post(source.url, json={source.keyword_field: keyword}, headers=source.headers, timeout=source.timeout)
            else:
                response = await client.get(source.url, params={source.keyword_field: keyword}, headers=source.headers, timeout=source.timeout)
            result["status_code"] = response.status_code
            if response.status_code != 200:
                result["error"] = f"HTTP {response.status_code}"
                return result
            try:
                value = response.json()
            except ValueError:
                raise ValueError("上游未返回有效 JSON") from None
            if source.source_type == "jackett":
                result.update(parse_jackett(value))
            else:
                items = value.get("data") if isinstance(value, dict) else value
                if not isinstance(items, list) or any(not isinstance(i, dict) for i in items):
                    raise ValueError("上游响应应为数组或包含 data 数组的对象")
                result.update(items=items, success=True, outcome="complete")
            result["count"] = len(result["items"])
    except (TimeoutError, httpx.TimeoutException):
        result["error"] = "上游请求超时"
    except ValueError as error:
        result["error"] = str(error)
    except Exception:
        result["error"] = "上游连接失败，请检查地址、请求头和网络"
    finally:
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
    return result
