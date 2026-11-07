import asyncio
import logging
import time
import re
import os
import secrets
import hmac
import hashlib
import sqlite3
from copy import deepcopy
from urllib.parse import urlparse
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query, HTTPException, Body, Depends, Header, Request, status, Response, Cookie
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import httpx
from app.config import (
    DATA_DIR,
    load_settings,
    save_settings,
    clean_url,
    clean_headers,
    AppSettings,
    UpstreamSource,
    request_config,
    public_source,
)
from app.stats import RequestStats, source_key
from app.providers import fetch_source
from app.aggregation import merge_results
from app.resource_metadata import summarize_resources
from app.label_catalog import LabelCatalog
from app.upstream_catalog import CatalogSync, catalog_key
from app.version import VERSION, REVISION
from pydantic import ValidationError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("bm-bt-proxy")
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="BM-BT-Proxy", version=VERSION)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

WEB_USERNAME = os.getenv("WEB_USERNAME", "").strip()
WEB_PASSWORD = os.getenv("WEB_PASSWORD", "").strip()

# 静态固定密钥，保证容器重启、多工作进程时 Cookie 依然长期有效，绝不失效
SECRET_SIGN_KEY = os.getenv("SECRET_KEY", "bm-bt-proxy-secure-sign-key-v1")


def generate_cookie_token() -> str:
    """生成与账号密码绑定的签名 Token"""
    h = hmac.new(SECRET_SIGN_KEY.encode(), f"{WEB_USERNAME}:{WEB_PASSWORD}".encode(), hashlib.sha256)
    return h.hexdigest()


settings: AppSettings = load_settings()
request_stats = RequestStats(os.path.join(DATA_DIR, "requests.sqlite3"))
label_catalog = LabelCatalog(os.path.join(DATA_DIR, "resource-labels.sqlite3"))
catalog_sync = CatalogSync(label_catalog, lambda: list(settings.sources))
catalog_schedule_task = None


def is_authenticated(request: Request) -> bool:
    """检查是否已通过 Cookie 登录"""
    if not WEB_USERNAME or not WEB_PASSWORD:
        return True
    session_cookie = request.cookies.get("bm_session")
    if not session_cookie:
        return False
    expected = generate_cookie_token()
    return secrets.compare_digest(session_cookie, expected)


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
    global settings, catalog_schedule_task
    settings = load_settings()
    await asyncio.to_thread(label_catalog.reconcile, lambda: list(settings.sources))
    catalog_schedule_task = asyncio.create_task(catalog_sync.schedule())
    logger.info(f"Initialized with {len(settings.sources)} sources")


@app.on_event("shutdown")
async def shutdown_event():
    if catalog_schedule_task:
        catalog_schedule_task.cancel()
        try:
            await catalog_schedule_task
        except asyncio.CancelledError:
            pass
    await catalog_sync.close()


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
        token = generate_cookie_token()
        response.set_cookie(
            key="bm_session",
            value=token,
            path="/",
            httponly=False,  # 允许跨页面携带
            samesite="lax",
            max_age=86400 * 30,  # 30天有效
        )
        return {"status": "ok"}

    raise HTTPException(status_code=400, detail="用户名或密码不正确")


@app.post("/api/logout")
async def logout_api(response: Response):
    response.delete_cookie("bm_session", path="/")
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login")
    return FileResponse("app/static/index.html")


@app.get("/api/settings", dependencies=[Depends(require_auth)])
async def get_settings():
    value = settings.model_dump(exclude={"sources"})
    value["sources"] = [public_source(s) for s in settings.sources]
    return value


@app.get("/api/version", dependencies=[Depends(require_auth)])
async def get_version():
    return {"version": VERSION, "revision": REVISION}


@app.get("/api/resource-labels", dependencies=[Depends(require_auth)])
async def get_resource_labels():
    sources = [source.model_copy(deep=True) for source in settings.sources]
    try:
        value = await asyncio.to_thread(label_catalog.overview, sources)
        value["refreshing"] = catalog_sync.refreshing
        return value
    except (OSError, sqlite3.Error, ValueError):
        raise HTTPException(503, "暂时无法读取资源标签，请检查数据目录后重试") from None


@app.post("/api/resource-labels/refresh", status_code=202, dependencies=[Depends(require_auth)])
async def refresh_resource_labels(body: Dict[str, Any] = Body(default={})):
    source_id = body.get("source_id", "all")
    if not isinstance(source_id, str) or (source_id != "all" and not any(
            s.id == source_id and s.enabled for s in settings.sources)):
        raise HTTPException(422, "请选择有效且已启用的数据源")
    catalog_sync.start(source_id)
    return {"refreshing": True}


@app.get("/api/stats", dependencies=[Depends(require_auth)])
def get_stats(window: str = Query("today", pattern="^(today|week)$"),
              utc_offset: int = Query(480, ge=-840, le=840),
              errors_only: bool = False, before: Optional[int] = Query(None, gt=0)):
    try:
        return request_stats.overview(list(settings.sources), window, utc_offset, errors_only, before)
    except (OSError, sqlite3.Error):
        raise HTTPException(status_code=503, detail="暂时无法读取请求统计，请检查数据目录后重试")


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
    return [public_source(s) for s in settings.sources]


def parse_source(data, previous=None):
    data = dict(data)
    data.pop("has_jackett_api_key", None)
    data.pop("has_catalog_headers", None)
    # Revisions belong to the server, not an editable request body.
    data.pop("catalog_revision", None)
    if previous is not None:
        data = {**previous.model_dump(), **data}
    if not isinstance(data.get("url"), str):
        raise HTTPException(422, "请填写有效的 HTTP / HTTPS 地址")
    data["url"] = clean_url(data.get("url", ""))
    for field in ("headers", "catalog_headers"):
        raw_headers = data.get(field, {})
        if not isinstance(raw_headers, (dict, str)):
            raise HTTPException(422, "请求头需为 JSON 对象或 Token")
        if isinstance(raw_headers, dict) and any(not isinstance(v, str) for v in raw_headers.values()):
            raise HTTPException(422, "请求头值必须为字符串")
        if isinstance(raw_headers, str) and raw_headers.strip().startswith(("{", "[")):
            import json
            try:
                parsed = json.loads(raw_headers)
                if not isinstance(parsed, dict) or any(not isinstance(v, str) for v in parsed.values()):
                    raise ValueError()
            except ValueError:
                raise HTTPException(422, "请求头 JSON 格式无效") from None
        data[field] = clean_headers(raw_headers)
    if previous is None:
        data.pop("id", None)
        if data.get("source_type") == "jackett":
            data.setdefault("timeout", 20)
            data.setdefault("priority", 200)
    try:
        return UpstreamSource(**{**data, **({"id": previous.id} if previous else {})})
    except (ValidationError, ValueError):
        raise HTTPException(422, "源配置无效，请检查地址、请求头、超时、优先级和站点标识") from None


@app.post("/api/jackett/indexers", dependencies=[Depends(require_auth)])
async def jackett_indexers(body: Dict[str, Any] = Body(...)):
    from xml.etree import ElementTree
    from app.providers import jackett_path
    previous = next((s for s in settings.sources if s.id == body.get("source_id")), None)
    source = parse_source({**body, "source_type": "jackett", "jackett_indexer": "all"}, previous)
    if not source.jackett_api_key:
        raise HTTPException(422, "请先填写 Jackett API Key")
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            response = await client.get(jackett_path(source, "/torznab/api"),
                                        params={"apikey": source.jackett_api_key, "t": "indexers", "configured": "true"},
                                        headers=source.headers)
        response.raise_for_status()
        root = ElementTree.fromstring(response.content)
        if root.tag != "indexers":
            raise ValueError()
        return {"indexers": [{"id": e.get("id"), "name": e.findtext("title") or e.get("id")}
                             for e in root.findall("indexer") if e.get("configured") == "true"]}
    except Exception:
        raise HTTPException(502, "无法读取已配置站点，请检查 Jackett 地址、API Key 和网络") from None


@app.post("/api/result-preferences", dependencies=[Depends(require_auth)])
async def update_preferences(body: Dict[str, Any] = Body(...)):
    try:
        rules = AppSettings(sources=settings.sources,
                            result_preferences=body.get("result_preferences", [])).result_preferences
    except ValidationError:
        raise HTTPException(422, "排序规则无效，请检查标签、来源和重复规则（最多24条）") from None
    settings.result_preferences = rules
    save_settings(settings)
    return {"result_preferences": rules}


@app.post("/api/sources", dependencies=[Depends(require_auth)])
async def add_source(source_data: Dict[str, Any] = Body(...)):
    new_source = parse_source(source_data)
    settings.sources.append(new_source)
    save_settings(settings)
    return public_source(new_source)


@app.put("/api/sources/{source_id}", dependencies=[Depends(require_auth)])
async def update_source(source_id: str, source_data: Dict[str, Any] = Body(...)):
    for i, source in enumerate(settings.sources):
        if source.id == source_id:
            updated = parse_source(source_data, source)
            old_config, new_config = request_config(source), request_config(updated)
            old_config.pop("config_revision", None)
            new_config.pop("config_revision", None)
            updated.config_revision = secrets.token_hex(8) if old_config != new_config else source.config_revision
            settings.sources[i] = updated
            if (source.catalog_mode, source.catalog_headers) != (updated.catalog_mode, updated.catalog_headers):
                updated.catalog_revision = secrets.token_hex(8)
            save_settings(settings)
            if source_key(source) != source_key(updated) or catalog_key(source) != catalog_key(updated):
                await asyncio.to_thread(label_catalog.reconcile, lambda: list(settings.sources))
            return public_source(updated)
    raise HTTPException(404, "Source not found")


@app.delete("/api/sources/{source_id}", dependencies=[Depends(require_auth)])
async def delete_source(source_id: str):
    global settings
    settings.sources = [s for s in settings.sources if s.id != source_id]
    settings.result_preferences = [rule for rule in settings.result_preferences
                                   if not isinstance(rule, dict) or rule["source_id"] != source_id]
    save_settings(settings)
    await asyncio.to_thread(label_catalog.reconcile, lambda: list(settings.sources))
    return {"status": "ok"}


def extract_dedup_key(item: Dict[str, Any]) -> str:
    from app.aggregation import dedup_key
    return dedup_key(item)


# Retain the internal entry point used by existing integrations.
fetch_single_source = fetch_source


async def run_search(targets, keyword, profile="standard"):
    start = time.monotonic()
    # Snapshot settings so edits during a request cannot mix two configurations.
    targets = [s.model_copy(deep=True) for s in targets]
    preferences = deepcopy(settings.result_preferences)
    async with httpx.AsyncClient(verify=False) as client:
        results = await asyncio.gather(*(fetch_single_source(client, source, keyword) for source in targets))
    await asyncio.to_thread(label_catalog.record, targets, results, lambda: list(settings.sources))
    merged = merge_results(targets, results, preferences, profile)
    elapsed = int((time.monotonic() - start) * 1000)
    return targets, results, merged, elapsed


@app.post("/api/test", dependencies=[Depends(require_auth)])
async def test_search(body: Dict[str, Any] = Body(...)):
    keyword = body.get("keyword", "")
    target_id = body.get("source_id", "all")
    profile = body.get("profile", "standard")
    if not isinstance(profile, str) or profile not in {"standard", "ltx"}:
        raise HTTPException(422, "请选择标准聚合或 LTX 优选方案")

    targets = (
        [s for s in settings.sources if s.enabled]
        if target_id == "all"
        else [s for s in settings.sources if s.id == target_id]
    )
    if not targets:
        return {"data": [], "details": [], "total_time_ms": 0}

    targets, results, merged, elapsed = await run_search(targets, str(keyword), profile)
    details = [{**{k: v for k, v in result.items() if k != "items"},
                "resource_metadata": summarize_resources(result["items"])} for result in results]
    await asyncio.to_thread(request_stats.record, "test", str(keyword), targets, results, len(merged["data"]), elapsed)
    return {**merged, "details": details, "total_time_ms": elapsed}


@app.api_route("/api/torrents", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
@app.api_route("/bt/api", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
async def aggregate_torrents(keyword: Optional[str] = Query(default="")):
    return await aggregate_response(keyword)


@app.api_route("/api/torrents/ltx", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
@app.api_route("/bt/api/ltx", methods=["GET", "POST"], dependencies=[Depends(verify_api_key)])
async def ltx_torrents(keyword: Optional[str] = Query(default="")):
    return await aggregate_response(keyword, profile="ltx")


async def aggregate_response(keyword, profile="standard"):
    enabled_sources = [s for s in settings.sources if s.enabled]
    if not enabled_sources:
        return {"data": []}

    search_kw = keyword or ""
    targets, results, merged, elapsed = await run_search(enabled_sources, search_kw, profile)
    await asyncio.to_thread(request_stats.record, "api", search_kw, targets, results, len(merged["data"]), elapsed)
    return {"data": merged["data"]}
