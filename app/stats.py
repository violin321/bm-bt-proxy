"""Bounded, local request history. Never stores source URLs, headers or result bodies."""
import hashlib
import json
import logging
import math
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("bm-bt-proxy")


def source_key(source):
    # Includes credentials so results from an old configuration never look current.
    config = source.model_dump(exclude={"name"})
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


class RequestStats:
    retention_days = 30
    max_records = 50000

    def __init__(self, path):
        self.path = Path(path)
        self._ready = False
        self._lock = threading.Lock()
        self.write_error = False

    def _connect(self):
        self._initialize()
        conn = sqlite3.connect(self.path, timeout=3)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self):
        with self._lock:
            if self._ready:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.path, timeout=3)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("""CREATE TABLE IF NOT EXISTS requests (
                    id INTEGER PRIMARY KEY, at REAL NOT NULL,
                    origin TEXT NOT NULL, keyword TEXT NOT NULL,
                    outcome TEXT NOT NULL, latency_ms INTEGER NOT NULL,
                    raw_count INTEGER NOT NULL, unique_count INTEGER NOT NULL,
                    target_count INTEGER NOT NULL, success_count INTEGER NOT NULL,
                    details TEXT NOT NULL)""")
                conn.execute("CREATE INDEX IF NOT EXISTS requests_at ON requests(at)")
                conn.commit()
            self._ready = True

    def record(self, origin, keyword, sources, results, unique_count, latency_ms, at=None):
        if not sources:
            return
        keys = {s.id: source_key(s) for s in sources}
        details = []
        for r in results:
            error = None
            if not r["success"]:
                code = r.get("status_code")
                error = f"HTTP {code}" if code else "连接失败或请求超时，请重新测试查看当前响应"
            details.append({
                "id": r["id"], "name": r["name"], "key": keys[r["id"]],
                "success": bool(r["success"]), "status_code": r.get("status_code"),
                "latency_ms": r["latency_ms"], "count": r["count"], "error": error,
            })
        successes = sum(r["success"] for r in details)
        outcome = "complete" if successes == len(sources) else "partial" if successes else "failed"
        now = time.time() if at is None else at
        try:
            conn = self._connect()
            try:
                with conn:
                    conn.execute("""INSERT INTO requests
                        (at,origin,keyword,outcome,latency_ms,raw_count,unique_count,
                         target_count,success_count,details) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (now, origin, str(keyword)[:500], outcome, latency_ms,
                         sum(r["count"] for r in details), unique_count,
                         len(sources), successes, json.dumps(details, ensure_ascii=False)))
                    conn.execute("DELETE FROM requests WHERE at < ?", (now-self.retention_days*86400,))
                    conn.execute("""DELETE FROM requests WHERE id IN (
                        SELECT id FROM requests ORDER BY id DESC LIMIT -1 OFFSET ?)""", (self.max_records,))
                self.write_error = False
            finally:
                conn.close()
        except (sqlite3.Error, OSError):
            self.write_error = True
            logger.warning("Request history could not be saved; search results are unaffected")

    @staticmethod
    def _public(row):
        result = dict(row)
        result["at"] = datetime.fromtimestamp(result["at"], timezone.utc).isoformat()
        result["details"] = [{k: v for k, v in d.items() if k != "key"}
                             for d in json.loads(result["details"])]
        return result

    def overview(self, sources, window="today", utc_offset=480, errors_only=False, before=None, now=None):
        tz = timezone(timedelta(minutes=utc_offset))
        current = datetime.fromtimestamp(time.time() if now is None else now, tz)
        day = current.replace(hour=0, minute=0, second=0, microsecond=0)
        start = day - timedelta(days=6) if window == "week" else day
        begin, end = start.timestamp(), current.timestamp()
        conn = self._connect()
        try:
            with conn:  # Keep summary, chart and logs on one read snapshot.
                conn.execute("BEGIN")
                rows = conn.execute("SELECT * FROM requests WHERE at >= ? AND at <= ? ORDER BY id DESC",
                                    (begin, end)).fetchall()
                first = conn.execute("SELECT MIN(at) FROM requests").fetchone()[0]
                # Last response independent of selected period, bounded by retention.
                recent = conn.execute("SELECT at, details FROM requests WHERE at >= ? ORDER BY id DESC",
                                      (end-self.retention_days*86400,)).fetchall()
            bins = [{"label": (start+timedelta(days=i)).strftime("%m/%d") if window == "week" else f"{i:02d}:00",
                     "requests": 0, "latency_ms": 0} for i in range(7 if window == "week" else 24)]
            outcomes = {"complete": 0, "partial": 0, "failed": 0}
            latencies = []
            raw = unique = 0
            for row in rows:
                outcomes[row["outcome"]] += 1
                local = datetime.fromtimestamp(row["at"], tz)
                index = (local.date()-start.date()).days if window == "week" else local.hour
                bins[index]["requests"] += 1
                bins[index]["latency_ms"] += row["latency_ms"]
                latencies.append(row["latency_ms"])
                raw += row["raw_count"]
                unique += row["unique_count"]
            for b in bins:
                b["latency_ms"] = round(b["latency_ms"]/b["requests"]) if b["requests"] else None
            valid = {s.id: source_key(s) for s in sources}
            source_states = {s.id: {"last": None, "history": []} for s in sources}
            for row in recent:
                for detail in json.loads(row["details"]):
                    if valid.get(detail["id"]) != detail["key"]:
                        continue
                    value = source_states[detail["id"]]
                    if len(value["history"]) >= 30:
                        continue
                    public = {k: v for k, v in detail.items() if k != "key"}
                    public["at"] = datetime.fromtimestamp(row["at"], timezone.utc).isoformat()
                    if value["last"] is None:
                        value["last"] = public
                    value["history"].append({"at": public["at"], "success": public["success"]})
            page = [r for r in rows if (not errors_only or r["outcome"] != "complete") and (before is None or r["id"] < before)]
            count = len(rows)
            ordered = sorted(latencies)
            return {
                "window": window, "utc_offset": utc_offset,
                "start": start.isoformat(), "updated_at": current.isoformat(),
                "first_record_at": datetime.fromtimestamp(first, timezone.utc).isoformat() if first else None,
                "retention_days": self.retention_days, "max_records": self.max_records,
                "write_error": self.write_error,
                "summary": {"requests": count, **outcomes, "raw_count": raw,
                    "unique_count": unique, "duplicate_count": raw-unique,
                    "success_rate": round(outcomes["complete"]/count*100, 1) if count else None,
                    "average_ms": round(sum(latencies)/count) if count else None,
                    "p95_ms": ordered[max(0, math.ceil(count*.95)-1)] if count else None},
                "buckets": bins, "sources": source_states,
                "requests": [self._public(r) for r in page[:20]],
                "next_before": page[19]["id"] if len(page) > 20 else None,
            }
        finally:
            conn.close()
