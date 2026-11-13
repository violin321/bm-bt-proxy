"""Exchange article-source credentials for a directory-only session.

Passwords and OTPs are transient request data. Only the verified bearer token
is returned to the caller for storage in the existing write-only header field.
"""
import asyncio
import json
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import HTTPException

from app.upstream_catalog import catalog_provider, fetch_directory

MAX_LOGIN_BYTES = 64 * 1024


async def _login_data(client, url, form, timeout):
    async with client.stream("POST", url, data=form, timeout=timeout,
                             follow_redirects=False) as response:
        if response.status_code != 200:
            raise HTTPException(422, "源站登录失败，请检查账号、密码及登录接口。")
        body = bytearray()
        async for part in response.aiter_bytes():
            body.extend(part)
            if len(body) > MAX_LOGIN_BYTES:
                raise ValueError("Oversized login response")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError("Invalid login response")
    if "code" in value:
        if type(value["code"]) is not int or value["code"] != 0:
            raise HTTPException(422, "源站登录失败，请检查账号、密码或二次验证码。")
        value = value.get("data")
    if not isinstance(value, dict):
        raise ValueError("Invalid login data")
    return value


def _token(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 8192 or
            any(ord(c) < 33 or ord(c) > 126 for c in value)):
        raise ValueError("Invalid session token")
    return value


async def login_catalog(source, credentials, client=None):
    if (not isinstance(credentials, dict) or
            set(credentials) - {"username", "password", "otp_code"} or
            any(not isinstance(credentials.get(k, ""), str) for k in ("username", "password", "otp_code")) or
            not 1 <= len(credentials.get("username", "").strip()) <= 512 or
            not 1 <= len(credentials.get("password", "")) <= 2048 or
            len(credentials.get("otp_code", "")) > 64):
        raise HTTPException(422, "请填写源站账号和密码；二次验证码可按需填写。")
    if catalog_provider(source) != "article_categories":
        raise HTTPException(422, "账号密码登录仅支持 AVDB / 修仙兼容目录；其他源请使用专用请求头。")
    if client is None:
        async with httpx.AsyncClient() as session:
            return await login_catalog(source, credentials, session)
    parsed = urlsplit(source.url)
    url = urlunsplit((parsed.scheme, parsed.netloc,
                     parsed.path.rstrip("/").removesuffix("/articles/torrents") + "/users/login", "", ""))
    timeout = min(source.timeout, 8)
    try:
        # One bounded attempt, without retrying passwords or following redirects.
        async with asyncio.timeout(timeout):
            data = await _login_data(client, url, {"username": credentials["username"].strip(),
                                                 "password": credentials["password"]}, timeout)
            if data.get("requires_2fa") is True:
                if not credentials.get("otp_code", "").strip():
                    raise HTTPException(422, "源站已开启二次验证，请填写当前验证码后重新保存。")
                data = await _login_data(client, url + "/2fa",
                                         {"otp_token": _token(data.get("otp_token")),
                                          "otp_code": credentials["otp_code"].strip()}, timeout)
            if data.get("requires_2fa"):
                raise ValueError("Incomplete login")
            candidate = source.model_copy(update={"catalog_headers": {
                "Authorization": "Bearer " + _token(data.get("access_token"))}})
            directory = await fetch_directory(client, candidate)
            if directory["status"] != "ready":
                raise HTTPException(422, "登录后仍无法读取源目录，请确认账号权限和目录接口；原配置未保存。")
            return candidate
    except HTTPException:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise HTTPException(422, "源站登录或目录校验超时，请稍后重试。") from None
    except Exception:
        raise HTTPException(422, "源站登录响应无效或连接失败，请检查地址；也可使用专用请求头。") from None
