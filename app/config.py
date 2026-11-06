import json
import os
import uuid
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

CONFIG_FILE = os.getenv("CONFIG_FILE", "/data/sources.json")


class UpstreamSource(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str = "upstream"
    enabled: bool = True
    url: str
    method: str = "GET"  # GET or POST
    headers: Dict[str, str] = Field(default_factory=dict)
    keyword_field: str = "keyword"
    timeout: float = 10.0


def clean_url(raw_url: str) -> str:
    """防呆处理：去除前后空格，补全 http://，去除末尾斜杠"""
    if not raw_url:
        return ""
    u = raw_url.strip()
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "http://" + u
    return u.rstrip("/")


def clean_headers(headers_input: Any) -> Dict[str, str]:
    """防呆处理：支持 JSON 格式，或者如果只传入纯 Token 字符串自动包装为 X-API-Key"""
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
            # 纯字符串 token 防呆
            return {"X-API-Key": val}
    return {}


def save_sources(sources: List[UpstreamSource]):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    data = [s.model_dump() for s in sources]
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_sources() -> List[UpstreamSource]:
    # 1. 优先从 /data/sources.json 读取
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    res = []
                    for item in data:
                        if isinstance(item, dict) and "url" in item:
                            item["url"] = clean_url(item["url"])
                            item["headers"] = clean_headers(item.get("headers", {}))
                            res.append(UpstreamSource(**item))
                    return res
        except Exception as e:
            print(f"[Config] Error loading {CONFIG_FILE}: {e}")

    # 2. 检查环境变量 BT_SOURCES_JSON
    sources_json = os.getenv("BT_SOURCES_JSON", "").strip()
    if sources_json:
        try:
            raw_list = json.loads(sources_json)
            if isinstance(raw_list, list):
                res = []
                for item in raw_list:
                    if isinstance(item, dict) and "url" in item:
                        item["url"] = clean_url(item["url"])
                        item["headers"] = clean_headers(item.get("headers", {}))
                        res.append(UpstreamSource(**item))
                if res:
                    save_sources(res)
                    return res
        except Exception as e:
            print(f"[Config] Error parsing BT_SOURCES_JSON: {e}")

    # 3. 检查编号环境变量 BT_SOURCE_1_URL ...
    res = []
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

        res.append(
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

    if res:
        save_sources(res)
    return res
