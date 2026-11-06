import json
import os
import uuid
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

DATA_DIR = os.getenv("DATA_DIR", "/data")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
OLD_SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")


class UpstreamSource(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str = "upstream"
    enabled: bool = True
    url: str
    method: str = "GET"  # GET or POST
    headers: Dict[str, str] = Field(default_factory=dict)
    keyword_field: str = "keyword"
    timeout: float = 10.0
    # Changes whenever request configuration changes, including a change back.
    # Kept in config.json so response history remains valid across restarts.
    config_revision: str = ""


class AppSettings(BaseModel):
    api_key_enabled: bool = False
    api_key: str = ""
    sources: List[UpstreamSource] = Field(default_factory=list)


def clean_url(raw_url: str) -> str:
    if not raw_url:
        return ""
    u = raw_url.strip()
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "http://" + u
    return u.rstrip("/")


def clean_headers(headers_input: Any) -> Dict[str, str]:
    if isinstance(headers_input, dict):
        return {str(k).strip(): str(v).strip() for k, v in headers_input.items()}
    if isinstance(headers_input, str):
        val = headers_input.strip()
        if not val:
            return {}
        try:
            parsed = json.loads(val)
            if isinstance(parsed, dict):
                return {str(k).strip(): str(v).strip() for k, v in parsed.items()}
        except Exception:
            return {"X-API-Key": val}
    return {}


def save_settings(settings: AppSettings):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(settings.model_dump(), f, indent=2, ensure_ascii=False)


def load_settings() -> AppSettings:
    # 1. 优先加载 config.json
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    # 清洗 sources
                    clean_sources = []
                    for item in data.get("sources", []):
                        if isinstance(item, dict) and "url" in item:
                            item["url"] = clean_url(item["url"])
                            item["headers"] = clean_headers(item.get("headers", {}))
                            clean_sources.append(UpstreamSource(**item))
                    data["sources"] = clean_sources
                    return AppSettings(**data)
        except Exception as e:
            print(f"[Config] Error loading {CONFIG_FILE}: {e}")

    # 2. 兼容旧版 sources.json
    if os.path.exists(OLD_SOURCES_FILE):
        try:
            with open(OLD_SOURCES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    res = []
                    for item in data:
                        if isinstance(item, dict) and "url" in item:
                            item["url"] = clean_url(item["url"])
                            item["headers"] = clean_headers(item.get("headers", {}))
                            res.append(UpstreamSource(**item))
                    settings = AppSettings(sources=res)
                    save_settings(settings)
                    return settings
        except Exception as e:
            print(f"[Config] Error loading {OLD_SOURCES_FILE}: {e}")

    # 3. 环境变量初始化
    sources = []
    idx = 1
    while True:
        url = os.getenv(f"BT_SOURCE_{idx}_URL") or os.getenv(f"SOURCE_{idx}_URL")
        if not url:
            if idx > 10:
                break
            idx += 1
            continue

        method = os.getenv(f"BT_SOURCE_{idx}_METHOD") or os.getenv(f"SOURCE_{idx}_METHOD", "GET")
        headers_str = os.getenv(f"BT_SOURCE_{idx}_HEADERS") or os.getenv(f"SOURCE_{idx}_HEADERS", "{}")
        headers = clean_headers(headers_str)
        field_name = (os.getenv(f"BT_SOURCE_{idx}_FIELD") or os.getenv(f"SOURCE_{idx}_FIELD", "keyword")).strip()
        timeout = float(os.getenv(f"BT_SOURCE_{idx}_TIMEOUT") or os.getenv(f"SOURCE_{idx}_TIMEOUT", "10.0"))

        sources.append(
            UpstreamSource(
                name=f"source_{idx}",
                enabled=True,
                url=clean_url(url),
                method=method.strip().upper(),
                headers=headers,
                keyword_field=field_name,
                timeout=timeout,
            )
        )
        idx += 1

    settings = AppSettings(sources=sources)
    if sources:
        save_settings(settings)
    return settings
