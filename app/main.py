import asyncio
import logging
import time
import re
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.responses import HTMLResponse, FileResponse
import httpx
from app.config import load_sources, save_sources, clean_url, clean_headers, UpstreamSource

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("bm-bt-proxy")

app = FastAPI(title="BM-BT-Proxy", version="1.1.0")

sources: List[UpstreamSource] = load_sources()


@app.on_event("startup")
async def startup_event():
    global sources
    sources = load_sources()
    logger.info(f"Initialized with {len(sources)} sources")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    return FileResponse("app/static/index.html")


@app.get("/api/sources")
async def get_sources():
    return [s.model_dump() for s in sources]


@app.post("/api/sources")
async def add_source(source_data: Dict[str, Any] = Body(...)):
    global sources
    source_data["url"] = clean_url(source_data.get("url", ""))
    source_data["headers"] = clean_headers(source_data.get("headers", {}))
    new_source = UpstreamSource(**source_data)
    sources.append(new_source)
    save_sources(sources)
    return new_source.model_dump()


@app.put("/api/sources/{source_id}")
async def update_source(source_id: str, source_data: Dict[str, Any] = Body(...)):
    global sources
    for i, s in enumerate(sources):
        if s.id == source_id:
            source_data["url"] = clean_url(source_data.get("url", ""))
            source_data["headers"] = clean_headers(source_data.get("headers", {}))
            updated = UpstreamSource(**{**source_data, "id": source_id})
            sources[i] = updated
            save_sources(sources)
            return updated.model_dump()
    raise HTTPException(status_code=404, detail="Source not found")


@app.delete("/api/sources/{source_id}")
async def delete_source(source_id: str):
    global sources
    sources = [s for s in sources if s.id != source_id]
    save_sources(sources)
    return {"status": "ok"}


def extract_dedup_key(item: Dict[str, Any]) -> str:
    """
    智能去重键提取：
    1. 优先提取标准 BTIH (BitTorrent Info Hash)，忽略 tracker / dn 参数，大小写统一大写；
    2. 次选 ed2k / http 下载链接；
    3. 兜底使用规范化标题（去除前后空格和特殊标点）。
    """
    if not isinstance(item, dict):
        return ""

    link = item.get("magnet") or item.get("download_url") or ""
    if link:
        # 正则提取 btih 哈希（支持 40 位 HEX 或 32 位 Base32）
        m = re.search(r"urn:btih:([a-zA-Z0-9]{32,40})", link, re.IGNORECASE)
        if m:
            return f"btih:{m.group(1).upper()}"
        # ed2k 哈希
        m_ed2k = re.search(r"\|file\|[^|]+\|[^|]+\|([a-fA-F0-9]{32})\|", link)
        if m_ed2k:
            return f"ed2k:{m_ed2k.group(1).upper()}"
        return link.strip()

    title = item.get("title") or item.get("name") or ""
    return f"title:{title.strip().lower()}" if title else ""


async def fetch_single_source(client: httpx.AsyncClient, source: UpstreamSource, keyword: str) -> Dict[str, Any]:
    start = time.time()
    result = {
        "id": source.id,
        "name": source.name,
        "success": False,
        "status_code": None,
        "latency_ms": 0,
        "count": 0,
        "error": None,
        "items": [],
    }
    try:
        if source.method == "POST":
            payload = {source.keyword_field: keyword}
            resp = await client.post(source.url, json=payload, headers=source.headers, timeout=source.timeout)
        else:
            params = {source.keyword_field: keyword}
            resp = await client.get(source.url, params=params, headers=source.headers, timeout=source.timeout)

        result["status_code"] = resp.status_code
        if resp.status_code == 200:
            res_json = resp.json()
            items = []
            if isinstance(res_json, dict) and "data" in res_json:
                data = res_json["data"]
                if isinstance(data, list):
                    items = data
            elif isinstance(res_json, list):
                items = res_json

            result["items"] = items
            result["count"] = len(items)
            result["success"] = True
        else:
            result["error"] = f"HTTP {resp.status_code}"
    except Exception as e:
        result["error"] = str(e)
    finally:
        result["latency_ms"] = int((time.time() - start) * 1000)

    return result


@app.post("/api/test")
async def test_search(body: Dict[str, Any] = Body(...)):
    keyword = body.get("keyword", "")
    target_id = body.get("source_id", "all")

    targets = [s for s in sources if s.enabled] if target_id == "all" else [s for s in sources if s.id == target_id]
    if not targets:
        return {"data": [], "details": [], "total_time_ms": 0}

    start = time.time()
    details = []
    all_torrents = []

    async with httpx.AsyncClient(verify=False) as client:
        tasks = [fetch_single_source(client, src, keyword) for src in targets]
        res_list = await asyncio.gather(*tasks)

        for res in res_list:
            details.append({
                "id": res["id"],
                "name": res["name"],
                "success": res["success"],
                "status_code": res["status_code"],
                "latency_ms": res["latency_ms"],
                "count": res["count"],
                "error": res["error"],
            })
            all_torrents.extend(res["items"])

    # 智能去重
    seen = set()
    deduped = []
    for item in all_torrents:
        key = extract_dedup_key(item)
        if key:
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        else:
            deduped.append(item)

    total_time_ms = int((time.time() - start) * 1000)
    return {"data": deduped, "details": details, "total_time_ms": total_time_ms}


@app.api_route("/api/torrents", methods=["GET", "POST"])
@app.api_route("/bt/api", methods=["GET", "POST"])
async def aggregate_torrents(keyword: Optional[str] = Query(default="")):
    enabled_sources = [s for s in sources if s.enabled]
    if not enabled_sources:
        return {"data": []}

    search_kw = keyword or ""
    all_torrents = []

    async with httpx.AsyncClient(verify=False) as client:
        tasks = [fetch_single_source(client, src, search_kw) for src in enabled_sources]
        results = await asyncio.gather(*tasks)
        for res in results:
            if res["success"]:
                all_torrents.extend(res["items"])

    seen = set()
    deduped = []
    for item in all_torrents:
        key = extract_dedup_key(item)
        if key:
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        else:
            deduped.append(item)

    return {"data": deduped}
