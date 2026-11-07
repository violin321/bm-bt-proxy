"""Bounded source directories and observed labels, without resources or credentials."""
import json
import logging
import sqlite3
import threading
import time
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from app.resource_metadata import item_labels, normalize_label
from app.stats import source_key
from app.upstream_catalog import catalog_key, catalog_provider, clean_directory, MAX_DIRECTORY_LABELS

logger = logging.getLogger("bm-bt-proxy")


class LabelCatalog:
    retention_days = 90
    max_labels_per_source = 200
    max_labels = 5000

    def __init__(self, path):
        self.path = Path(path)
        self._ready = False
        self._lock = threading.RLock()
        self.write_error = False

    def _connect(self):
        if not self._ready:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.path, timeout=3)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("""CREATE TABLE IF NOT EXISTS labels (
                    source_id TEXT NOT NULL, key TEXT NOT NULL,
                    field TEXT NOT NULL, value TEXT NOT NULL, normalized TEXT NOT NULL,
                    count INTEGER NOT NULL, first_seen REAL NOT NULL, last_seen REAL NOT NULL,
                    PRIMARY KEY (source_id, key, field, normalized))""")
                conn.execute("""CREATE TABLE IF NOT EXISTS queries (
                    source_id TEXT NOT NULL, key TEXT NOT NULL, last_query_at REAL NOT NULL,
                    PRIMARY KEY (source_id, key))""")
                conn.execute("CREATE INDEX IF NOT EXISTS labels_seen ON labels(last_seen)")
                conn.execute("""CREATE TABLE IF NOT EXISTS directories (
                    source_id TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
                    fetched_at REAL NOT NULL, coverage TEXT NOT NULL, origin TEXT NOT NULL,
                    limited INTEGER NOT NULL, PRIMARY KEY (source_id,key))""")
                conn.execute("""CREATE TABLE IF NOT EXISTS directory_attempts (
                    source_id TEXT NOT NULL, key TEXT NOT NULL, provider TEXT NOT NULL,
                    status TEXT NOT NULL, error TEXT, attempted_at REAL NOT NULL,
                    PRIMARY KEY (source_id,key))""")
                conn.commit()
            self._ready = True
        conn = sqlite3.connect(self.path, timeout=3)
        conn.row_factory = sqlite3.Row
        return conn

    def _prune(self, conn, sources, now, remove_stale=True):
        keys = {source.id: source_key(source) for source in sources}
        if remove_stale:
            for table in ("labels", "queries"):
                for row in conn.execute(f"SELECT DISTINCT source_id, key FROM {table}").fetchall():
                    if keys.get(row["source_id"]) != row["key"]:
                        conn.execute(f"DELETE FROM {table} WHERE source_id = ? AND key = ?",
                                     (row["source_id"], row["key"]))
            directory_keys = {source.id: catalog_key(source) for source in sources}
            for table in ("directories", "directory_attempts"):
                for row in conn.execute(f"SELECT source_id,key FROM {table}").fetchall():
                    if directory_keys.get(row["source_id"]) != row["key"]:
                        conn.execute(f"DELETE FROM {table} WHERE source_id=? AND key=?",
                                     (row["source_id"], row["key"]))
        cutoff = now - self.retention_days * 86400
        conn.execute("DELETE FROM labels WHERE last_seen < ?", (cutoff,))
        conn.execute("DELETE FROM queries WHERE last_query_at < ?", (cutoff,))
        return keys

    def reconcile(self, sources, now=None):
        """Invalidate removed/reconfigured sources; configuration writes fail open."""
        try:
            with self._lock, closing(self._connect()) as conn, conn:
                current = sources() if callable(sources) else sources
                self._prune(conn, current, time.time() if now is None else now)
            self.write_error = False
        except (OSError, sqlite3.Error):
            self.write_error = True
            logger.warning("Resource label catalog could not be updated; search results are unaffected")

    def record(self, sources, results, current_sources=None, at=None):
        """Count each field/normalized label once per upstream record, before dedup."""
        now = time.time() if at is None else at
        try:
            with self._lock, closing(self._connect()) as conn, conn:
                current = current_sources() if callable(current_sources) else current_sources
                keys = self._prune(conn, current if current is not None else sources, now)
                for source, result in zip(sources, results):
                    key = source_key(source)
                    if not result.get("success") or keys.get(source.id) != key:
                        continue
                    conn.execute("""INSERT INTO queries (source_id,key,last_query_at) VALUES (?,?,?)
                        ON CONFLICT(source_id,key) DO UPDATE SET last_query_at=excluded.last_query_at""",
                        (source.id, key, now))
                    counts, display = Counter(), {}
                    for item in result.get("items", []):
                        if not isinstance(item, dict):
                            continue
                        values = set()
                        for label in item_labels(item):
                            normalized = normalize_label(label["value"])
                            identity = (label["field"], normalized)
                            values.add(identity)
                            display.setdefault(identity, label["value"])
                        counts.update(values)
                    for (field, normalized), count in counts.items():
                        conn.execute("""INSERT INTO labels
                            (source_id,key,field,value,normalized,count,first_seen,last_seen)
                            VALUES (?,?,?,?,?,?,?,?)
                            ON CONFLICT(source_id,key,field,normalized) DO UPDATE
                            SET count=labels.count+excluded.count,last_seen=excluded.last_seen""",
                            (source.id, key, field, display[(field, normalized)], normalized, count, now, now))
                    conn.execute("""DELETE FROM labels WHERE rowid IN (
                        SELECT rowid FROM labels WHERE source_id=? AND key=?
                        ORDER BY last_seen DESC,count DESC,field,normalized LIMIT -1 OFFSET ?)""",
                        (source.id, key, self.max_labels_per_source))
                conn.execute("""DELETE FROM labels WHERE rowid IN (
                    SELECT rowid FROM labels ORDER BY last_seen DESC,count DESC,source_id,field,normalized
                    LIMIT -1 OFFSET ?)""", (self.max_labels,))
            self.write_error = False
        except (OSError, sqlite3.Error):
            self.write_error = True
            logger.warning("Resource labels could not be saved; search results are unaffected")

    @staticmethod
    def _timestamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat() if value is not None else None

    def directory_due(self, source, now=None):
        now = time.time() if now is None else now
        with self._lock, closing(self._connect()) as conn:
            row = conn.execute("SELECT status,attempted_at FROM directory_attempts WHERE source_id=? AND key=?",
                               (source.id, catalog_key(source))).fetchone()
            # Successful catalogs live for 24h. Failed metadata reads retry hourly.
            return row is None or now - row["attempted_at"] >= (86400 if row["status"] == "ready" else 3600)

    def record_directory(self, source, result, current_sources, at=None):
        now = time.time() if at is None else at
        key = catalog_key(source)
        try:
            with self._lock, closing(self._connect()) as conn, conn:
                current = current_sources() if callable(current_sources) else current_sources
                if not any(s.id == source.id and catalog_key(s) == key for s in current):
                    return False
                self._prune(conn, current, now)
                status = result["status"]
                if status == "ready":
                    labels, limited = clean_directory(result["labels"])
                    coverage = result["coverage"]
                    origin = result.get("origin", "upstream")
                    if coverage not in {"current_database", "declared_categories"} or origin not in {"upstream", "snapshot"}:
                        raise ValueError("目录范围无效")
                    conn.execute("""INSERT INTO directories VALUES (?,?,?,?,?,?,?)
                        ON CONFLICT(source_id,key) DO UPDATE SET payload=excluded.payload,
                        fetched_at=excluded.fetched_at,coverage=excluded.coverage,
                        origin=excluded.origin,limited=excluded.limited""",
                        (source.id, key, json.dumps(labels, ensure_ascii=False), now, coverage, origin,
                         int(limited or result.get("limited", False))))
                conn.execute("""INSERT INTO directory_attempts VALUES (?,?,?,?,?,?)
                    ON CONFLICT(source_id,key) DO UPDATE SET provider=excluded.provider,
                    status=excluded.status,error=excluded.error,attempted_at=excluded.attempted_at""",
                    (source.id, key, catalog_provider(source), status, result.get("error"), now))
            self.write_error = False
            return True
        except (OSError, sqlite3.Error):
            self.write_error = True
            logger.warning("Source directory could not be saved; search results are unaffected")
            return False

    def _directory(self, conn, source, now):
        key, provider = catalog_key(source), catalog_provider(source)
        cached = conn.execute("SELECT * FROM directories WHERE source_id=? AND key=?", (source.id, key)).fetchone()
        attempt = conn.execute("SELECT * FROM directory_attempts WHERE source_id=? AND key=?", (source.id, key)).fetchone()
        status = ("disabled" if source.catalog_mode == "disabled" else
                  "unsupported" if provider == "none" else attempt["status"] if attempt else "never")
        labels = json.loads(cached["payload"]) if cached and status != "disabled" else []
        return labels, {"provider": provider, "status": status,
                        "coverage": cached["coverage"] if cached else "observed_only",
                        "origin": cached["origin"] if cached else None,
                        "fetched_at": self._timestamp(cached["fetched_at"] if cached else None),
                        "last_attempt_at": self._timestamp(attempt["attempted_at"] if attempt else None),
                        "error": attempt["error"] if attempt and status not in {"disabled", "ready"} else None,
                        "count": len(labels), "limited": bool(cached["limited"]) if cached else False,
                        "stale": bool(cached and (now - cached["fetched_at"] >= 86400 or status != "ready"))}

    def overview(self, sources, now=None):
        now = time.time() if now is None else now
        with self._lock, closing(self._connect()) as conn, conn:
            # A GET may hold an older config snapshot while an edit completes.
            # It must never invalidate the cache of that newer configuration.
            keys = self._prune(conn, sources, now, remove_stale=False)
            global_limit = conn.execute("SELECT COUNT(*) FROM labels").fetchone()[0] >= self.max_labels
            result = []
            for source in sources:
                query = conn.execute("SELECT last_query_at FROM queries WHERE source_id=? AND key=?",
                                     (source.id, keys[source.id])).fetchone()
                rows = conn.execute("""SELECT field,value,count,first_seen,last_seen FROM labels
                    WHERE source_id=? AND key=? ORDER BY count DESC,last_seen DESC,field,normalized""",
                    (source.id, keys[source.id])).fetchall()
                labels = [{**dict(row), "first_seen": self._timestamp(row["first_seen"]),
                           "last_seen": self._timestamp(row["last_seen"]), "origin": "observed"} for row in rows]
                directory_labels, directory = self._directory(conn, source, now)
                merged = {(row["field"], normalize_label(row["value"])): row for row in labels}
                combined = []
                for row in directory_labels:
                    identity = (row["field"], normalize_label(row["value"]))
                    observed = merged.pop(identity, None)
                    combined.append({"count": 0, "first_seen": None, "last_seen": None,
                                     **(observed or {}), **row, "origin": "both" if observed else "directory"})
                labels = combined + list(merged.values())
                result.append({"id": source.id, "name": source.name, "enabled": source.enabled,
                               "last_query_at": self._timestamp(query["last_query_at"] if query else None),
                               "labels": labels, "labels_limited": global_limit or len(rows) >= self.max_labels_per_source,
                               "directory": directory, "kind": "combined" if directory_labels else "observed"})
            return {"sources": result, "retention_days": self.retention_days,
                    "max_labels_per_source": self.max_labels_per_source,
                    "max_directory_labels_per_source": MAX_DIRECTORY_LABELS, "write_error": self.write_error}
