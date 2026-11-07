"""Stable merging shared by manual tests and the public search endpoints."""
import base64
import re


def canonical_btih(value):
    if re.fullmatch(r"[A-Fa-f0-9]{40}", value or ""):
        return value.upper()
    if re.fullmatch(r"[A-Za-z2-7]{32}", value or ""):
        return base64.b32decode(value.upper()).hex().upper()
    return None


def dedup_key(item):
    if not isinstance(item, dict):
        return ""
    link = item.get("magnet") or item.get("download_url") or ""
    if isinstance(link, str) and link:
        match = re.search(r"urn:btih:([A-Za-z0-9]{32,40})(?=&|$)", link, re.I)
        if match and (value := canonical_btih(match[1])):
            return "btih:" + value
        match = re.search(r"\|file\|[^|]+\|[^|]+\|([A-Fa-f0-9]{32})\|", link)
        return "ed2k:" + match[1].upper() if match else link.strip()
    title = item.get("title") or item.get("name") or ""
    return "title:" + str(title).strip().lower() if title else ""


def merge_results(sources, results, preferences):
    candidates = []
    for index, (source, result) in enumerate(zip(sources, results)):
        for position, item in enumerate(result["items"] if result["success"] else []):
            if isinstance(item, dict):
                candidates.append((source.priority, index, position, source, item))
    candidates.sort(key=lambda row: row[:3])
    seen, selected, duplicates = {}, [], []
    for row in candidates:
        source, item = row[3:]
        key = dedup_key(item)
        if key and key in seen:
            if len(duplicates) < 200:
                duplicates.append({"kept_source": seen[key], "discarded_source": source.name,
                                   "reason": "源优先级；同级按配置顺序"})
            continue
        if key:
            seen[key] = source.name
        selected.append(row)

    aliases = {"chinese": "c_sub", "uc": "uncensored", "uhd": "hd"}
    def rank(row):
        item = row[4]
        values = []
        for rule in preferences:
            key = rule.lstrip("!")
            flag = item.get(key) is True or item.get(aliases.get(key, "")) is True
            values.append(int(flag) if rule.startswith("!") else -int(flag))
        return (*values, *row[:3])
    selected.sort(key=rank)
    return {"data": [r[4] for r in selected],
            "provenance": [{"source_id": r[3].id, "source_name": r[3].name, "priority": r[0]} for r in selected],
            "merge": {"preferences": preferences, "duplicates": duplicates}}
