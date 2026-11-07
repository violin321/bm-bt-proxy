"""Identify explicit LTX markers on individual resources, never film-wide genres."""
import re
import unicodedata

from app.resource_metadata import label_values


_MARKER = re.compile(r"(?<![a-z0-9])ltx(?:[-_ ]?v?\d+(?:\.\d+)*)?(?![a-z0-9])")
_NEGATED = re.compile(
    r"(?:非|无|無|不是|并非|並非|(?<![a-z0-9])(?:without|not(?:[\s_-]+an?)?|non|no))[\s_.\-:：]*$",
    re.I,
)
_DISABLED = re.compile(r"^\s*[:=]\s*(?:false|no|off|0)(?![a-z0-9])", re.I)


def _marked(value):
    text = unicodedata.normalize("NFKC", value[:2048]).casefold()
    # A link or a credential assignment is not a resource's model marker.
    text = re.sub(r"(?:https?://|magnet:|ed2k:)\S+", "", text)
    text = re.sub(r"(?:token|passkey|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+", "", text)
    for match in _MARKER.finditer(text):
        if not _NEGATED.search(text[max(0, match.start() - 32):match.start()]) and not _DISABLED.match(text[match.end():]):
            return True
    return False


def ltx_evidence(item):
    """Return the field carrying an explicit marker, without claiming model verification."""
    for field in ("tags", "labels"):
        if any(_marked(value) for value in label_values(item.get(field))):
            return field
    title = item.get("title") or item.get("name")
    return "title" if isinstance(title, str) and _marked(title) else None
