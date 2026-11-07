"""Isolated regression contracts for observed labels and explicit return ordering."""
import asyncio
import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.aggregation import merge_results
from app.config import AppSettings, UpstreamSource
from app.label_catalog import LabelCatalog
from app.stats import RequestStats, source_key


def source(identity="a", **values):
    return UpstreamSource(id=identity, name=identity, url="http://fixture.test", **values)


def label(value="字幕", **values):
    return {"type": "label", "value": value, "field": "*", "source_id": "*",
            "direction": "prefer", **values}


def result(src, items, success=True):
    return {"id": src.id, "name": src.name, "success": success,
            "outcome": "complete" if success else "failed", "status_code": 200 if success else 502,
            "latency_ms": 1, "count": len(items), "error": None, "items": items, "indexers": []}


class OrderingContracts(unittest.TestCase):
    def test_mixed_rules_are_ordered_and_keep_all_resources(self):
        a, b = source(priority=10), source("b", priority=100)
        rows = [[{"title": "plain"}, {"title": "tag", "tags": ["字幕"]}],
                [{"title": "free", "free": True}, {"title": "both", "free": True, "tags": ["字幕"]}]]
        merged = merge_results([a, b], [result(a, rows[0]), result(b, rows[1])], ["free", label()])
        self.assertEqual([item["title"] for item in merged["data"]], ["both", "free", "tag", "plain"])
        self.assertEqual([row["rule_matches"] for row in merged["provenance"]],
                         [[True, True], [True, False], [False, True], [False, False]])
        deferred = merge_results([a, b], [result(a, rows[0]), result(b, rows[1])], [label(direction="defer")])
        self.assertEqual([item["title"] for item in deferred["data"]], ["plain", "free", "tag", "both"])

    def test_source_scope_field_and_nfkc_exact_matching(self):
        a, b = source(priority=10), source("b", priority=100)
        data = [result(a, [{"title": "wrong source", "tags": ["UHD"]}]), result(b, [
            {"title": "wrong field", "category": ["UHD"]},
            {"title": "substring", "tags": ["UHD 4K"]},
            {"title": "exact", "tags": ["  ＵＨＤ  "]}])]
        merged = merge_results([a, b], data, [label("uhd", source_id="b", field="tags")])
        self.assertEqual([item["title"] for item in merged["data"]],
                         ["exact", "wrong source", "wrong field", "substring"])

    def test_dedup_winner_does_not_change_or_borrow_labels(self):
        a, b = source(priority=10), source("b", priority=20)
        link = "magnet:?xt=urn:btih:" + "a" * 40
        merged = merge_results([a, b], [result(a, [{"title": "kept", "download_url": link}]),
            result(b, [{"title": "discarded", "download_url": link, "tags": ["字幕"]}])], [label()])
        self.assertEqual([item["title"] for item in merged["data"]], ["kept"])
        self.assertEqual(merged["provenance"][0]["rule_matches"], [False])
        self.assertNotIn("tags", merged["data"][0])

    def test_complete_ties_preserve_source_and_record_order(self):
        a, b = source(priority=10), source("b", priority=10)
        data = [result(a, [{"title": "one"}, {"title": "two"}]), result(b, [{"title": "three"}])]
        self.assertEqual([r["title"] for r in merge_results([a, b], data, [label()])["data"]],
                         ["one", "two", "three"])

    def test_rules_are_plain_dicts_and_legacy_rules_still_work(self):
        settings = AppSettings(sources=[source()], result_preferences=["free", label(source_id="a"), "!uc"])
        self.assertEqual(settings.model_dump()["result_preferences"], ["free", label(source_id="a"), "!uc"])
        self.assertIs(type(settings.result_preferences[1]), dict)

    def test_validation_rejects_unsafe_duplicate_unknown_or_oversized_rules(self):
        invalid = [["uc", "!uc"], ["unknown"], [label(), label(direction="defer")],
                   [label("ＵＨＤ"), label("uhd")], [label(source_id="missing")],
                   [label(field="title")], [label(direction=[])], [label(value=True)],
                   [label(value="token=secret")], [label(value="https://private.test/secret")],
                   [label(value="ｈｔｔｐｓ://private.test/secret")], [label(value="字幕\nsecret")],
                   [label(value="x" * 81)], [label(value="")], [label(extra="bad")],
                   [label(str(i)) for i in range(25)]]
        for rules in invalid:
            with self.subTest(rules=rules), self.assertRaises(ValidationError):
                AppSettings(sources=[source()], result_preferences=rules)
        self.assertEqual(len(AppSettings(result_preferences=[label(str(i)) for i in range(24)]).result_preferences), 24)
        self.assertEqual(AppSettings(result_preferences=[label("ﬃ" * 40)]).result_preferences[0]["value"], "ﬃ" * 40)


class CatalogContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "labels.sqlite3"
        self.store = LabelCatalog(self.path)
        self.a = source()

    def tearDown(self):
        self.tmp.cleanup()

    def observed(self, store=None, sources=None, now=1000):
        return (store or self.store).overview(sources or [self.a], now=now)["sources"][0]

    def test_counts_are_pre_dedup_per_record_and_survive_restart(self):
        items = [{"title": "same", "tags": ["ＵＨＤ", "uhd", "ＵＨＤ"], "category": ["uhd"]},
                 {"title": "same", "tags": ["UHD"]}]
        self.store.record([self.a], [result(self.a, items)], at=1000)
        overview = self.observed(LabelCatalog(self.path))
        self.assertEqual([(r["field"], r["count"]) for r in overview["labels"]], [("tags", 2), ("category", 1)])
        self.assertEqual(overview["kind"], "observed")
        self.assertIsNotNone(overview["last_query_at"])
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")

    def test_failure_keeps_last_success_empty_success_is_recorded(self):
        self.store.record([self.a], [result(self.a, [], success=False)], at=1000)
        self.assertIsNone(self.observed()["last_query_at"])
        self.store.record([self.a], [result(self.a, [])], at=1001)
        empty = self.observed(now=1001)
        self.assertEqual(empty["labels"], [])
        self.assertIsNotNone(empty["last_query_at"])

    def test_ttl_expires_on_read_without_new_upstream_request(self):
        self.store.record([self.a], [result(self.a, [{"tags": ["old"]}])], at=1000)
        expired = self.observed(now=1001 + self.store.retention_days * 86400)
        self.assertEqual(expired["labels"], [])
        self.assertIsNone(expired["last_query_at"])

    def test_bounded_per_source_and_global_counts(self):
        self.store.record([self.a], [result(self.a, [{"tags": [str(i)]} for i in range(220)])], at=1000)
        bounded = self.observed()
        self.assertEqual(len(bounded["labels"]), 200)
        self.assertTrue(bounded["labels_limited"])
        self.store.max_labels = 5
        b = source("b")
        self.store.record([b], [result(b, [{"tags": [str(i)]} for i in range(10)])],
                          current_sources=[self.a, b], at=1001)
        view = self.store.overview([self.a, b], now=1001)
        self.assertEqual(sum(len(s["labels"]) for s in view["sources"]), 5)
        self.assertTrue(all(s["labels_limited"] for s in view["sources"]))

    def test_config_change_and_change_back_never_reveal_stale_labels(self):
        self.store.record([self.a], [result(self.a, [{"tags": ["original"]}])], at=1000)
        renamed = self.a.model_copy(update={"name": "renamed", "priority": 1, "tags": ["metadata"]})
        self.assertEqual(self.observed(sources=[renamed])["labels"][0]["value"], "original")
        changed = renamed.model_copy(update={"url": "http://other.test", "config_revision": "new"})
        self.store.reconcile([changed], now=1001)
        self.assertEqual(self.observed(sources=[changed], now=1001)["labels"], [])
        back = renamed.model_copy(update={"config_revision": "back"})
        self.assertEqual(self.observed(sources=[back], now=1002)["labels"], [])
        self.store.record([self.a], [result(self.a, [{"tags": ["late old response"]}])],
                          current_sources=lambda: [back], at=1002)
        self.assertEqual(self.observed(sources=[back], now=1002)["labels"], [])
        self.store.reconcile([], now=1003)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM queries").fetchone()[0], 0)

    def test_only_safe_labels_and_fingerprints_are_persisted(self):
        private = source(headers={"Authorization": "Bearer credential-never-stored"})
        rows = [{"title": "private-resource-body", "tags": ["字幕", "token=unsafe-token", "https://private.test/path"],
                 "download_url": "magnet:?xt=urn:btih:" + "b" * 40}]
        self.store.record([private], [result(private, rows)], at=1000)
        with closing(sqlite3.connect(self.path)) as conn:
            data = repr(conn.execute("SELECT * FROM labels").fetchall())
            self.assertNotIn("credential-never-stored", data)
            self.assertNotIn("private-resource-body", data)
            self.assertNotIn("unsafe-token", data)
            self.assertNotIn("private.test", data)
            self.assertNotIn("magnet", data)
            self.assertIn(source_key(private), data)

    def test_stale_read_snapshot_cannot_delete_new_configuration_cache(self):
        changed = self.a.model_copy(update={"url": "http://new.test", "config_revision": "new"})
        self.store.record([changed], [result(changed, [{"tags": ["current"]}])], at=1000)
        self.assertEqual(self.observed(sources=[self.a])["labels"], [])
        self.assertEqual(self.observed(sources=[changed])["labels"][0]["value"], "current")

    def test_writes_are_thread_safe_and_errors_fail_open(self):
        def record(_):
            self.store.record([self.a], [result(self.a, [{"tags": ["字幕"]}])], at=1000)
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(record, range(12)))
        self.assertEqual(self.observed()["labels"][0]["count"], 12)
        broken = LabelCatalog(Path(self.tmp.name))  # Existing directory cannot be a SQLite file.
        broken.record([self.a], [result(self.a, [{"tags": ["字幕"]}])])
        self.assertTrue(broken.write_error)
        with patch.object(self.store, "_connect", side_effect=sqlite3.OperationalError("private failure")):
            self.store.record([self.a], [result(self.a, [])])
        self.assertTrue(self.store.overview([self.a], now=1000)["write_error"])


class SnapshotContracts(unittest.IsolatedAsyncioTestCase):
    async def test_late_response_after_request_config_changes_back_is_not_catalogued(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["DATA_DIR"] = tmp
            import app.main as main
            a = source()
            store = LabelCatalog(Path(tmp) / "labels.sqlite3")
            started, finish = asyncio.Event(), asyncio.Event()
            async def fetch(client, src, keyword):
                started.set()
                await finish.wait()
                return result(src, [{"title": "old response", "tags": ["字幕"]}])
            with patch.object(main, "settings", AppSettings(sources=[a], result_preferences=[label()])), \
                    patch.object(main, "label_catalog", store), patch.object(main, "fetch_single_source", fetch):
                task = asyncio.create_task(main.run_search([a], "private-keyword"))
                await started.wait()
                changed = a.model_copy(update={"url": "http://changed.test", "config_revision": "changed"})
                main.settings.sources = [changed]
                await asyncio.to_thread(store.reconcile, lambda: list(main.settings.sources))
                back = a.model_copy(update={"config_revision": "changed-back"})
                main.settings.sources = [back]
                main.settings.result_preferences = ["free"]
                await asyncio.to_thread(store.reconcile, lambda: list(main.settings.sources))
                finish.set()
                targets, results, merged, _ = await task
                self.assertEqual(targets[0].config_revision, "")
                self.assertEqual(merged["provenance"][0]["rule_matches"], [True])
                observed = store.overview([back])["sources"][0]
                self.assertEqual(observed["labels"], [])
                self.assertIsNone(observed["last_query_at"])


class APIContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DATA_DIR"] = self.tmp.name
        import app.main as main
        import app.config as config
        self.main = main
        self.a, self.b = source(priority=10), source("b", priority=20)
        self.store = LabelCatalog(Path(self.tmp.name) / "resource-labels.sqlite3")
        self.patches = [patch.object(config, "DATA_DIR", self.tmp.name),
                        patch.object(config, "CONFIG_FILE", str(Path(self.tmp.name) / "config.json")),
                        patch.object(main, "settings", AppSettings(sources=[self.a, self.b])),
                        patch.object(main, "label_catalog", self.store),
                        patch.object(main, "request_stats", RequestStats(Path(self.tmp.name) / "requests.sqlite3")),
                        patch.object(main, "WEB_USERNAME", "fixture"), patch.object(main, "WEB_PASSWORD", "fixture")]
        for p in self.patches:
            p.start()
        self.fetches = 0
        async def fetch(client, src, keyword):
            self.fetches += 1
            return result(src, [{"title": src.id, "tags": ["字幕" if src.id == "b" else "高清"]}])
        self.fetch_patch = patch.object(main, "fetch_single_source", fetch)
        self.fetch_patch.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.fetch_patch.stop()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def login(self):
        self.assertEqual(self.client.post("/api/login", json={"username": "fixture", "password": "fixture"}).status_code, 200)

    def test_auth_get_is_local_and_public_search_returns_only_data(self):
        self.assertEqual(self.client.get("/api/resource-labels").status_code, 401)
        self.login()
        empty = self.client.get("/api/resource-labels")
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(self.fetches, 0)
        self.assertEqual(self.client.post("/api/result-preferences", json={"result_preferences": [label()]}).status_code, 200)
        for path in ("/api/torrents", "/bt/api"):
            response = self.client.get(path, params={"keyword": "private-search-term"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(set(response.json()), {"data"})
            self.assertEqual([r["title"] for r in response.json()["data"]], ["b", "a"])
            self.assertNotIn("rule_matches", response.text)
        view = self.client.get("/api/resource-labels").json()
        self.assertEqual(view["sources"][0]["labels"][0]["count"], 2)
        self.assertNotIn("private-search-term", json.dumps(view))
        test = self.client.post("/api/test", json={"keyword": "fixture"}).json()
        self.assertEqual(test["provenance"][0]["rule_matches"], [True])
        self.assertEqual(self.client.get("/api/resource-labels").json()["sources"][0]["labels"][0]["count"], 3)

    def test_nonexistent_scope_rejected_delete_cleans_only_its_rules_and_cache(self):
        self.login()
        self.assertEqual(self.client.post("/api/result-preferences", json={"result_preferences": [label(source_id="absent")]}).status_code, 422)
        rules = ["free", label(source_id="a"), label(source_id="b"), label(value="UHD")]
        self.assertEqual(self.client.post("/api/result-preferences", json={"result_preferences": rules}).json()["result_preferences"], rules)
        self.client.post("/api/test", json={"keyword": "fixture"})
        self.assertEqual(self.client.delete("/api/sources/a").status_code, 200)
        self.assertEqual(self.client.get("/api/settings").json()["result_preferences"], [rules[0], rules[2], rules[3]])
        view = self.client.get("/api/resource-labels").json()
        self.assertEqual([s["id"] for s in view["sources"]], ["b"])
        with closing(sqlite3.connect(self.store.path)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM labels WHERE source_id='a'").fetchone()[0], 0)

    def test_metadata_edits_preserve_and_request_edits_invalidate_cache(self):
        self.login()
        self.client.post("/api/test", json={"keyword": "fixture"})
        self.assertEqual(self.client.put("/api/sources/a", json={"name": "renamed", "priority": 42, "tags": ["management"]}).status_code, 200)
        view = self.client.get("/api/resource-labels").json()["sources"][0]
        self.assertEqual(view["name"], "renamed")
        self.assertEqual(len(view["labels"]), 1)
        self.assertEqual(self.client.put("/api/sources/a", json={"headers": {"X-Test": "changed"}}).status_code, 200)
        self.assertEqual(self.client.get("/api/resource-labels").json()["sources"][0]["labels"], [])
        self.client.put("/api/sources/a", json={"headers": {}})
        self.assertEqual(self.client.get("/api/resource-labels").json()["sources"][0]["labels"], [])
        self.client.put("/api/sources/b", json={"enabled": False})
        self.assertEqual(len(self.client.get("/api/resource-labels").json()["sources"]), 2)

    def test_cache_write_failure_does_not_fail_search_and_get_error_is_generic(self):
        self.login()
        broken = LabelCatalog(Path(self.tmp.name))
        with patch.object(self.main, "label_catalog", broken):
            response = self.client.get("/api/torrents?keyword=fixture")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["data"]), 2)
            self.assertTrue(broken.write_error)
            response = self.client.get("/api/resource-labels")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(self.tmp.name, response.text)
            self.assertNotIn("sqlite", response.text.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
