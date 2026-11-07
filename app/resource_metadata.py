"""Bounded descriptions of upstream labels for authenticated diagnostics only."""
import re
import unicodedata
from collections import Counter

LABEL_FIELDS = ("tags", "labels", "category", "categories", "genres", "category_ids")
FLAG_FIELDS = ("free", "chinese", "c_sub", "uc", "uncensored", "uhd", "hd", "mosaic")


def normalize_label(value):
    """Compare complete labels without changing their upstream meaning."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def label_values(value):
    values = value[:32] if isinstance(value, list) else [value]
    labels = []
    for entry in values:
        if isinstance(entry, dict):
            entry = entry.get("name") or entry.get("label")
        if not isinstance(entry, str):
            continue
        if re.search(r"[\x00-\x1f\x7f]", entry):
            continue
        text = " ".join(entry.split())
        if (not text or len(text) > 80 or
                re.search(r"https?://|magnet:|ed2k:|(?:token|passkey|api[_-]?key|authorization|cookie)\s*[:=]",
                          normalize_label(text), re.I)):
            continue
        if text not in labels:
            labels.append(text)
    return labels


def category_ids(value):
    """Keep Torznab IDs exact; reject bools, malformed and unbounded values."""
    values = value[:128] if isinstance(value, list) else [value]
    result = []
    for entry in values:
        if type(entry) not in (int, str) or not re.fullmatch(r"[1-9][0-9]{0,9}", str(entry)):
            continue
        if int(entry) > 2147483647:
            continue
        text = str(entry)
        if text not in result:
            result.append(text)
    return result


def item_labels(item):
    return [{"field": field, "value": label}
            for field in LABEL_FIELDS
            for label in (category_ids(item.get(field)) if field == "category_ids" else label_values(item.get(field)))]


def summarize_resources(items):
    labels, flags = Counter(), {}
    labelled_count = 0
    for item in items:
        values = item_labels(item)
        labelled_count += bool(values)
        labels.update((value["field"], value["value"]) for value in values)
        original_flags = item.get("upstream_flags")
        original_flags = original_flags if isinstance(original_flags, dict) else item
        for field in FLAG_FIELDS:
            if type(original_flags.get(field)) is bool:
                counts = flags.setdefault(field, {"true": 0, "false": 0})
                counts["true" if original_flags[field] else "false"] += 1
    return {"count": len(items), "labelled_count": labelled_count,
            "labels": [{"field": field, "value": value, "count": count}
                       for (field, value), count in labels.most_common(120)],
            "labels_limited": len(labels) > 120, "flags": flags}
