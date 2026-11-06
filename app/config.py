import json
import os
import uuid
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


def save_sources(sources: List[UpstreamSource]):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    data = [s.model_dump() for s in sources]
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_sources() -> List[UpstreamSource]:
    # 1. Prioritize /data/sources.json if it exists
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return [UpstreamSource(**item) for item in data if isinstance(item, dict) and "url" in item]
        except Exception as e:
            print(f"[Config] Error loading {CONFIG_FILE}: {e}")

    # 2. Check BT_SOURCES_JSON environment variable
    sources_json = os.getenv("BT_SOURCES_JSON", "").strip()
    if sources_json:
        try:
            raw_list = json.loads(sources_json)
            if isinstance(raw_list, list):
                res = [UpstreamSource(**item) for item in raw_list if isinstance(item, dict) and "url" in item]
                if res:
                    save_sources(res)
                    return res
        except Exception as e:
            print(f"[Config] Error parsing BT_SOURCES_JSON: {e}")

    # 3. Check numbered env vars: BT_SOURCE_1_URL ...
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
        headers = {}
        try:
            headers = json.loads(headers_str) if headers_str else {}
        except Exception:
            pass

        field_name = os.getenv(f"BT_SOURCE_{idx}_FIELD") or os.getenv(f"SOURCE_{idx}_FIELD", "keyword")
        timeout = float(os.getenv(f"BT_SOURCE_{idx}_TIMEOUT") or os.getenv(f"SOURCE_{idx}_TIMEOUT", "10.0"))

        res.append(
            UpstreamSource(
                name=f"source_{idx}",
                enabled=True,
                url=url.strip(),
                method=method.strip().upper(),
                headers=headers,
                keyword_field=field_name.strip(),
                timeout=timeout,
            )
        )
        idx += 1

    if res:
        save_sources(res)
    return res
