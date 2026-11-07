"""Stable merging shared by manual tests and the public search endpoints."""
import base64
import re
from app.resource_metadata import item_labels, normalize_label
from app.ltx import ltx_evidence


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


def merge_results(sources, results, preferences, profile="standard"):
    if profile not in {"standard", "ltx"}:
        raise ValueError("Unknown result profile")
    candidates = []
    for index, (source, result) in enumerate(zip(sources, results)):
        for position, item in enumerate(result["items"] if result["success"] else []):
            if isinstance(item, dict):
                # Match the consumer's strict UC flag. A model name alone is not UC evidence.
                if profile == "ltx" and item.get("uc") is not True:
                    continue
                candidates.append((source.priority, index, position, source, item))
    evidence = {id(row[4]): ltx_evidence(row[4]) for row in candidates} if profile == "ltx" else {}
    def model_rank(row):
        return (-int(bool(evidence.get(id(row[4])))),) if profile == "ltx" else ()
    # In the opt-in profile retain the complete explicitly marked record for a duplicate.
    # The standard profile continues to choose its original source-priority winner.
    candidates.sort(key=lambda row: (*model_rank(row), *row[:3]))
    seen, selected, duplicates = {}, [], []
    for row in candidates:
        source, item = row[3:]
        key = dedup_key(item)
        if key and key in seen:
            if len(duplicates) < 200:
                duplicates.append({"kept_source": seen[key], "discarded_source": source.name,
                                   "reason": "LTX 优选；同档按源优先级及配置顺序" if profile == "ltx"
                                   else "源优先级；同级按配置顺序"})
            continue
        if key:
            seen[key] = source.name
        selected.append(row)

    aliases = {"chinese": "c_sub", "uc": "uncensored", "uhd": "hd"}
    compiled = [(rule, normalize_label(rule["value"]) if isinstance(rule, dict) else None)
                for rule in preferences]
    def matches(row):
        item = row[4]
        flags = []
        labels = None
        for rule, expected in compiled:
            if isinstance(rule, str):
                key = rule.lstrip("!")
                flag = item.get(key) is True or item.get(aliases.get(key, "")) is True
            else:
                if labels is None:
                    labels = {(value["field"], normalize_label(value["value"])) for value in item_labels(item)}
                flag = (rule["source_id"] in ("*", row[3].id) and
                        (any(value == expected for _, value in labels) if rule["field"] == "*"
                         else (rule["field"], expected) in labels))
            flags.append(bool(flag))
        return flags

    def rank(row):
        values = []
        for rule, flag in zip(preferences, matches(row)):
            defer = rule.startswith("!") if isinstance(rule, str) else rule["direction"] == "defer"
            values.append(int(flag) if defer else -int(flag))
        return (*model_rank(row), *values, *row[:3])
    selected.sort(key=rank)
    value = {"data": [r[4] for r in selected],
            "provenance": [{"source_id": r[3].id, "source_name": r[3].name, "priority": r[0],
                            "rule_matches": matches(r),
                            **({"ltx_evidence": evidence.get(id(r[4]))} if profile == "ltx" else {})}
                           for r in selected],
            "merge": {"preferences": preferences, "duplicates": duplicates}}
    if profile == "ltx":
        value["selection"] = {"profile": "ltx", "ltx_count": sum(bool(evidence.get(id(r[4]))) for r in selected),
                              "uncensored_count": len(selected), "fallback_preserved": True,
                              "consumer_sort": "uc"}
    return value
