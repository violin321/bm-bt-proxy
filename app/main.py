import asyncio
import logging
import time
import re
import os
import secrets
from urllib.parse import urlparse
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query, HTTPException, Body, Depends, Header, Request, status
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import httpx
from app.config import (
    load_settings,
    save_settings,
    clean_url,
    clean_headers,
    AppSettings,
    UpstreamSource,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("bm-bt-proxy")

app = FastAPI(title="BM-BT-Proxy", version="1.2.0")

# HTTP Basic Auth support (via env vars)
security = HTTPBasic(auto_error=False)
WEB_USERNAME = os.getenv("WEB_USERNAME", "").strip()
WEB_PASSWORD = os.getenv("WEB_PASSWORD", "").strip()

settings: AppSettings = load_settings()


def verify_web_auth(credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    """如果配置了 WEB_USERNAME 和 WEB_PASSWORD，则启用 Basic Auth 鉴权"""
    if not WEB_USERNAME or not WEB_PASSWORD:
        return True  # 未设置账号密码，免密通行

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )

    is_user_ok = secrets.compare_digest(credentials.username, WEB_USERNAME)
    is_pass_ok = secrets.compare_digest(credentials.password, WEB_PASSWORD)
    if not (is_user_ok and is_pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True


def verify_api_key(token: Optional[str] = Query(default=None), x_api_key: Optional[str] = Header(default=None)):
    """校验 Byte-Muse 访问 /api/torrents 时的 API Key"""
    if not settings.api_key_enabled or not settings.api_key:
        return True

    provided = token or x_api_key
    if not provided or provided.strip() != settings.api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key or Token",
        )
    return True


@app.on_event("startup")
async def startup_event():
    global settings
    settings = load_settings()
    logger.info(f"Initialized with {len(settings.sources)} sources (API Key enabled: {settings.api_key_enabled})")


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(verify_web_auth)])
async def serve_index():
    return FileResponse("app/static/index.html")


@app.get("/api/settings", dependencies=[Depends(verify_web_auth)])
async def get_settings():
    return settings.model_dump()


@app.post("/api/security", dependencies=[Depends(verify_web_auth)])
async def update_security(body: Dict[str, Any] = Body(...)):
    global settings
    settings.api_key_enabled = bool(body.get("api_key_enabled", False))
    settings.api_key = str(body.get("api_key", "")).strip()
    save_settings(settings)
    return {"status": "ok", "api_key_enabled": settings.api_key_enabled, "api_key": settings.api_key}


@app.post("/api/detect-name", dependencies=[Depends(verify_web_auth)])
async def detect_name(body: Dict[str, Any] = Body(...)):
    url = clean_url(body.get("url", ""))
    if not url:
        return {"name": ""}

    # 1. 尝试从 URL 嗅探页面 HTML Title
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    try:
        async with httpx.AsyncClient(verify=False, timeout=3.0) as client:
            resp = await client.get(base_url)
            if resp.status_code == 200:
                m = re.search(r"<title[^>]*>([^<]+)</title>", resp.text, re.IGNORECASE)
                if m:
                    title = m.group(1).strip()
                    if title and len(title) < 50:
                        return {"name": title}
    except Exception:
        pass

    # 2. 兜底提取主机名/端口
    host_name = parsed.netloc or parsed.path.split("/")[0]
    return {"name": host_name or "BT源"}


@app.get("/api/sources", dependencies=[Depends(verify_web_auth)])
async def get_sources():
    return [s.model_dump() for s in settings.sources]


@app.post("/api/sources", dependencies=[Depends(verify_web_auth)])
async def add_source(source_data: Dict[str, Any] = Body(...)):
    global settings
    source_data["url"] = clean_url(source_data.get("url", ""))
    source_data["headers"] = clean_headers(source_data.get("headers", {}))
    new_source = UpstreamSource(**source_data)
    settings.sources.append(new_source)
    save_settings(settings)
    return new_source.model_dump()


@app.put("/api/sources/{source_id}", dependencies=[Depends(verify_web_auth)])
async def update_source(source_id: str, source_data: Dict[str, Any] = Body(...)):
    global settings
    for i, s in enumerate(settings.sources):
        if s.id == source_id:
            source_data["url"] = clean_url(source_data.get("url", ""))
            source_data["headers"] = clean_headers(source_data.get("headers", {}))
            updated = UpstreamSource(**{**source_data, "id": source_id})
            settings.sources[i] = updated
            save_settings(settings)
            return updated.model_dump()
    raise HTTPException(status_code=404, detail="Source not found")


@app.delete("/api/sources/{source_id}", dependencies=[Depends(verify_web_auth)])
async def delete_source(source_id: str):
    global settings
    settings.sources = [s for s in settings.sources if s.id != source_id]
    save_settings(settings)
    return {"status": "ok"}


def extract_dedup_key(item: Dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    link = item.get("magnet") or item.get("download_url") or ""
    if link:
        m = re.search(r"urn:btih:([a-zA-Z0-9]{32,40})", link, re.IGNORECASE)
        if m:
            return f"btih:{m.group(1).upper()}"
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


@app.post("/api/test", dependencies=[Depends(verify_web_auth)])
async def test_search(body: Dict[str, Any] = Body(...)):
    keyword = body.get("keyword", "")
    target_id = body.get("source_id", "all")

    targets = (
        [s for s in settings.sources if s.enabled]
        if target_id == "all"
        else [s for s in settings.sources if s.id == target_id]
    )
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


@app.api_route("/api/torrents", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
@app.api_route("/bt/api", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
async def aggregate_torrents(keyword: Optional[str] = Query(default="")):
    enabled_sources = [s for s in settings.sources if s.enabled]
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
