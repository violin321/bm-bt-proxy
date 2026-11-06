import asyncio
import logging
import time
import re
import os
import secrets
from urllib.parse import urlparse
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query, HTTPException, Body, Depends, Header, Request, status, Response, Cookie
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
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

app = FastAPI(title="BM-BT-Proxy", version="1.3.0")

WEB_USERNAME = os.getenv("WEB_USERNAME", "").strip()
WEB_PASSWORD = ***"WEB_PASSWORD", "").strip()

# Session token for cookie-based login
AUTH_SESSION_TOKEN = secrets.token_hex(16)

settings: AppSettings = load_settings()


def is_authenticated(request: Request) -> bool:
    """检查是否已通过 Cookie 登录"""
    if not WEB_USERNAME or not WEB_PASSWORD:
        return True
    session_cookie = request.cookies.get("bm_session")
    return session_cookie == AUTH_SESSION_TOKEN


def require_auth(request: Request):
    """API 路由认证依赖"""
    if not is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录管理控制台",
        )
    return True


def verify_api_key(token: Optional[str] = Query(default=None), x_api_key: Optional[str] = Header(default=None)):
    """Byte-Muse 访问 /api/torrents 时的 API Key 鉴权"""
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
    logger.info(f"Initialized with {len(settings.sources)} sources")


@app.get("/favicon.svg")
async def get_favicon():
    return FileResponse("app/static/favicon.svg", media_type="image/svg+xml")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/")
    return FileResponse("app/static/login.html")


@app.post("/api/login")
async def login_api(response: Response, body: Dict[str, Any] = Body(...)):
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()

    if not WEB_USERNAME or not WEB_PASSWORD:
        return {"status": "ok"}

    if secrets.compare_digest(username, WEB_USERNAME) and secrets.compare_digest(password, WEB_PASSWORD):
        response.set_cookie(
            key="bm_session",
            value=AUTH_SESSION_TOKEN,
            httponly=True,
            samesite="lax",
            max_age=86400 * 30,  # 30天免登录
        )
        return {"status": "ok"}

    raise HTTPException(status_code=400, detail="用户名或密码不正确")


@app.post("/api/logout")
async def logout_api(response: Response):
    response.delete_cookie("bm_session")
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login")
    return FileResponse("app/static/index.html")


@app.get("/api/settings", dependencies=[Depends(require_auth)])
async def get_settings():
    return settings.model_dump()


@app.post("/api/security", dependencies=[Depends(require_auth)])
async def update_security(body: Dict[str, Any] = Body(...)):
    global settings
    settings.api_key_enabled = bool(body.get("api_key_enabled", False))
    settings.api_key = str(body.get("api_key", "")).strip()
    save_settings(settings)
    return {"status": "ok", "api_key_enabled": settings.api_key_enabled, "api_key": settings.api_key}


@app.post("/api/detect-name", dependencies=[Depends(require_auth)])
async def detect_name(body: Dict[str, Any] = Body(...)):
    url = clean_url(body.get("url", ""))
    if not url:
        return {"name": ""}

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

    host_name = parsed.netloc or parsed.path.split("/")[0]
    return {"name": host_name or "BT源"}


@app.get("/api/sources", dependencies=[Depends(require_auth)])
async def get_sources():
    return [s.model_dump() for s in settings.sources]


@app.post("/api/sources", dependencies=[Depends(require_auth)])
async def add_source(source_data: Dict[str, Any] = Body(...)):
    global settings
    source_data["url"] = clean_url(source_data.get("url", ""))
    source_data["headers"] = clean_headers(source_data.get("headers", {}))
    new_source = UpstreamSource(**source_data)
    settings.sources.append(new_source)
    save_settings(settings)
    return new_source.model_dump()


@app.put("/api/sources/{source_id}", dependencies=[Depends(require_auth)])
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


@app.delete("/api/sources/{source_id}", dependencies=[Depends(require_auth)])
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


@app.post("/api/test", dependencies=[Depends(require_auth)])
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
