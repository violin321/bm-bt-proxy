import json
import os
import uuid
import re
from typing import List, Dict, Any, Optional, Literal, Union
from pydantic import BaseModel, Field, field_validator, model_validator
from app.resource_metadata import LABEL_FIELDS, label_values, normalize_label

DATA_DIR = os.getenv("DATA_DIR", "/data")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
OLD_SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")


class UpstreamSource(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str = "upstream"
    enabled: bool = True
    url: str
    source_type: Literal["generic", "jackett"] = "generic"
    priority: int = Field(default=100, ge=0, le=9999)
    tags: List[str] = Field(default_factory=list, max_length=20)
    jackett_indexer: str = "all"
    jackett_api_key: str = Field(default="", repr=False)
    method: Literal["GET", "POST"] = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    keyword_field: str = "keyword"
    timeout: float = Field(default=10.0, ge=0.5, allow_inf_nan=False)
    # Changes whenever request configuration changes, including a change back.
    # Kept in config.json so response history remains valid across restarts.
    config_revision: str = ""

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value):
        return list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))

    @field_validator("jackett_indexer")
    @classmethod
    def validate_indexer(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
            raise ValueError("站点标识格式无效")
        return value

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("请填写有效的 HTTP / HTTPS 地址")
        return value

    @field_validator("headers")
    @classmethod
    def validate_headers(cls, value):
        names = set()
        for key, item in value.items():
            if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key) or key.lower() in names:
                raise ValueError("请求头名称无效或重复")
            if any(ord(c) < 32 and c != "\t" or ord(c) == 127 for c in item):
                raise ValueError("请求头值不能包含换行或控制字符")
            names.add(key.lower())
        return value


class AppSettings(BaseModel):
    api_key_enabled: bool = False
    api_key: str = ""
    sources: List[UpstreamSource] = Field(default_factory=list)
    result_preferences: List[Union[str, Dict[str, Any]]] = Field(default_factory=list, max_length=24)

    @field_validator("result_preferences")
    @classmethod
    def validate_preferences(cls, value):
        seen = set()
        for rule in value:
            if isinstance(rule, str):
                key = rule.lstrip("!")
                if rule not in (key, "!" + key) or key not in {"free", "chinese", "uc", "uhd"}:
                    raise ValueError("排序属性无效")
                identity = ("flag", key)
            else:
                if (set(rule) != {"type", "value", "field", "source_id", "direction"} or
                        rule.get("type") != "label" or rule.get("field") not in ("*", *LABEL_FIELDS) or
                        not isinstance(rule.get("direction"), str) or
                        rule.get("direction") not in {"prefer", "defer"} or
                        not isinstance(rule.get("value"), str) or
                        not isinstance(rule.get("source_id"), str) or not rule["source_id"]):
                    raise ValueError("文字标签规则无效")
                labels = label_values(rule["value"])
                if len(labels) != 1:
                    raise ValueError("文字标签无效")
                rule["value"] = labels[0]
                identity = ("label", rule["source_id"], rule["field"], normalize_label(rule["value"]))
            if identity in seen:
                raise ValueError("排序标签无效或重复")
            seen.add(identity)
        return value

    @model_validator(mode="after")
    def validate_preference_sources(self):
        ids = {source.id for source in self.sources}
        if any(isinstance(rule, dict) and rule["source_id"] != "*" and rule["source_id"] not in ids
               for rule in self.result_preferences):
            raise ValueError("文字标签规则引用了不存在的源")
        return self


def request_config(source):
    """Keep legacy generic-source fingerprints byte-for-byte compatible."""
    value = source.model_dump(exclude={"name", "priority", "tags", "source_type", "jackett_indexer", "jackett_api_key"})
    if source.source_type == "jackett":
        value.update(source_type="jackett", jackett_indexer=source.jackett_indexer,
                     jackett_api_key=source.jackett_api_key)
    return value


def public_source(source):
    value = source.model_dump(exclude={"jackett_api_key"})
    value["has_jackett_api_key"] = bool(source.jackett_api_key)
    return value


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
    import tempfile
    os.makedirs(DATA_DIR, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=DATA_DIR, delete=False) as f:
            temporary = f.name
            json.dump(settings.model_dump(), f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, CONFIG_FILE)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


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
