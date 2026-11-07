"""Import a trusted, read-only category snapshot into this instance's cache."""
import argparse
import json
from pathlib import Path

from app.config import DATA_DIR, load_settings
from app.label_catalog import LabelCatalog
from app.upstream_catalog import catalog_key, catalog_provider, clean_directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--expected-key", required=True, help="Current catalog fingerprint; rejects changed sources")
    args = parser.parse_args()
    source = next((s for s in load_settings().sources if s.id == args.source_id), None)
    if source is None or catalog_key(source) != args.expected_key or catalog_provider(source) == "none":
        parser.error("source missing, unsupported or changed; take a fresh snapshot")
    if args.snapshot.stat().st_size > 2 * 1024 * 1024:
        parser.error("snapshot exceeds 2 MiB")
    value = json.loads(args.snapshot.read_text())
    labels, limited = clean_directory(value["labels"])
    store = LabelCatalog(Path(DATA_DIR) / "resource-labels.sqlite3")
    if not store.record_directory(source, {"status": "ready", "labels": labels, "limited": limited,
            "coverage": value["coverage"], "origin": "snapshot"}, lambda: load_settings().sources):
        parser.error("snapshot was not saved")
    print(json.dumps({"source_id": source.id, "count": len(labels), "limited": limited, "origin": "snapshot"}))


if __name__ == "__main__":
    main()
