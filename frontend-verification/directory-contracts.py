"""Directory fetching, authentication isolation, cache and category-ID regressions."""
import asyncio
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.aggregation import merge_results
from app.config import UpstreamSource, AppSettings, public_source
from app.label_catalog import LabelCatalog
from app.providers import jackett_items
from app.resource_metadata import category_ids
from app.stats import RequestStats, source_key
from app.upstream_catalog import (CatalogSync, catalog_key, fetch_directory, clean_directory,
                                  parse_article_categories, parse_jackett_caps)


def source(**extra):
    return UpstreamSource(**{"id": "avdb", "name": "AVDB", "url": "http://upstream.test/api/v1/articles/torrents", **extra})


def directory(labels=None, **extra):
    return {"status": "ready", "coverage": "current_database", "origin": "upstream",
            "labels": labels if labels is not None else [{"field": "category", "value": "无码破解", "catalog_count": 10}], **extra}


class Readers(unittest.IsolatedAsyncioTestCase):
    async def test_article_endpoint_is_metadata_only_and_separate_headers_override(self):
        calls = []
        def respond(request):
            calls.append(request)
            self.assertEqual(request.url.path, "/prefix/api/v1/articles/categories")
            self.assertEqual(str(request.url.query), "b''")
            self.assertEqual(request.headers["Authorization"], "Bearer directory-private")
            self.assertEqual(request.headers["X-API-Key"], "search-private")
            return httpx.Response(200, json={"data": [{"categories": [{"name": "无码破解", "count": 10}]},
                                                      {"categories": [{"name": "无码破解", "count": 2}]}]})
        s = source(url="http://upstream.test/prefix/api/v1/articles/torrents?private=ignored",
                   headers={"X-API-Key": "search-private", "authorization": "Bearer search"},
                   catalog_headers={"Authorization": "Bearer directory-private"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            data = await fetch_directory(client, s)
        self.assertEqual(len(calls), 1)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["coverage"], "current_database")
        self.assertEqual(data["labels"][0]["catalog_count"], 12)

    async def test_jackett_reads_only_selected_indexer_caps(self):
        def respond(request):
            self.assertEqual(request.url.path, "/api/v2.0/indexers/knaben/results/torznab/api")
            self.assertEqual(dict(request.url.params), {"apikey": "private", "t": "caps"})
            return httpx.Response(200, content=b'<caps><categories><category id="2000" name="Movies"><subcat id="2045" name="Movies/UHD"/></category><category id="3103000" name="Movies UHD"/></categories></caps>')
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            data = await fetch_directory(client, source(source_type="jackett", url="http://jackett.test", jackett_indexer="knaben", jackett_api_key="private"))
        self.assertEqual(data["status"], "ready")
        self.assertEqual({r["value"] for r in data["labels"]}, {"2000", "2045", "3103000"})
        self.assertTrue(all(r["field"] == "category_ids" for r in data["labels"]))

    async def test_failures_never_expose_upstream_bodies_credentials_or_redirect(self):
        for code, status in [(401, "unauthorized"), (403, "unauthorized"), (404, "unsupported"), (302, "error"), (500, "error")]:
            calls = []
            def respond(request):
                calls.append(request)
                return httpx.Response(code, text="token=private-response", headers={"Location": "http://other.test/private"})
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
                data = await fetch_directory(client, source())
            self.assertEqual(data["status"], status)
            self.assertNotIn("private", json.dumps(data))
            self.assertEqual(len(calls), 1)

    async def test_invalid_and_oversize_responses_fail_closed(self):
        for body in [b'{"data":{}}', b'{"data":[{}]}', b'x' * (2 * 1024 * 1024 + 1)]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body))) as client:
                self.assertEqual((await fetch_directory(client, source()))["status"], "error")

    async def test_unsupported_and_disabled_sources_make_no_request(self):
        def unexpected(request):
            raise AssertionError("unexpected metadata request")
        async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected)) as client:
            self.assertEqual((await fetch_directory(client, source(url="http://adapter.test/api/torrents/javdb")))["status"], "unsupported")
            self.assertEqual((await fetch_directory(client, source(catalog_mode="disabled")))["status"], "disabled")


class CacheAndOrdering(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LabelCatalog(Path(self.tmp.name) / "labels.sqlite3")
        self.s = source()

    def tearDown(self):
        self.tmp.cleanup()

    def view(self, sources=None, now=1000):
        return self.store.overview(sources or [self.s], now=now)["sources"][0]

    def test_directory_and_observed_merge_without_double_count_or_losing_custom_tags(self):
        self.store.record([self.s], [{"success": True, "items": [{"category": "无码破解", "tags": ["LTX"]}]}], at=1000)
        self.store.record_directory(self.s, directory(), [self.s], at=1000)
        view = self.view()
        self.assertEqual(view["kind"], "combined")
        self.assertEqual(len(view["labels"]), 2)
        row = view["labels"][0]
        self.assertEqual((row["origin"], row["count"], row["catalog_count"]), ("both", 1, 10))
        self.assertEqual(view["labels"][1]["origin"], "observed")
        self.assertEqual(LabelCatalog(self.store.path).overview([self.s], now=1000), self.store.overview([self.s], now=1000))

    def test_refresh_failure_retains_snapshot_and_empty_success_replaces_it(self):
        self.store.record_directory(self.s, directory(origin="snapshot"), [self.s], at=1000)
        self.store.record_directory(self.s, {"status": "unauthorized", "error": "目录权限不足"}, [self.s], at=1001)
        view = self.view(now=1001)
        self.assertEqual(view["directory"]["status"], "unauthorized")
        self.assertEqual(view["directory"]["origin"], "snapshot")
        self.assertTrue(view["directory"]["stale"])
        self.assertEqual(len(view["labels"]), 1)
        self.store.record_directory(self.s, directory(labels=[]), [self.s], at=1002)
        self.assertEqual(self.view(now=1002)["labels"], [])
        self.assertEqual(self.view(now=1002)["directory"]["status"], "ready")

    def test_metadata_edits_do_not_change_search_fingerprint_but_invalidate_directory(self):
        self.store.record_directory(self.s, directory(), [self.s], at=1000)
        changed = self.s.model_copy(update={"catalog_headers": {"Authorization": "private"}, "catalog_revision": "changed"})
        self.assertEqual(source_key(self.s), source_key(changed))
        self.assertNotEqual(catalog_key(self.s), catalog_key(changed))
        self.store.reconcile([changed], now=1001)
        self.assertFalse(self.store.record_directory(self.s, directory(), lambda: [changed], at=1002))
        self.assertEqual(self.view([changed], now=1002)["labels"], [])
        self.store.record_directory(changed, directory(), [changed], at=1002)
        self.view([self.s], now=1003)  # stale GET must not delete current cache
        self.assertEqual(len(self.view([changed], now=1003)["labels"]), 1)

    def test_ttl_and_retry_backoff_and_disabled_do_not_claim_completeness(self):
        self.assertTrue(self.store.directory_due(self.s, now=1000))
        self.store.record_directory(self.s, directory(), [self.s], at=1000)
        self.assertFalse(self.store.directory_due(self.s, now=1001))
        self.assertTrue(self.store.directory_due(self.s, now=87400))
        self.assertTrue(self.view(now=87400)["directory"]["stale"])
        self.store.record_directory(self.s, {"status": "error", "error": "超时"}, [self.s], at=87400)
        self.assertFalse(self.store.directory_due(self.s, now=87401))
        self.assertTrue(self.store.directory_due(self.s, now=91000))
        disabled = self.s.model_copy(update={"catalog_mode": "disabled"})
        self.assertEqual(self.view([disabled])["directory"]["status"], "disabled")
        self.assertEqual(self.view([disabled])["labels"], [])

    def test_full_338_category_snapshot_is_not_cut_by_200_observed_limit(self):
        labels = [{"field": "category", "value": f"分类{i}", "catalog_count": i} for i in range(338)]
        self.store.record_directory(self.s, directory(labels=labels), [self.s], at=1000)
        self.assertEqual(self.view()["directory"]["count"], 338)
        self.assertFalse(self.view()["directory"]["limited"])
        self.assertFalse(self.view()["labels_limited"])
        bounded, limited = clean_directory(labels * 4)
        self.assertTrue(limited)
        self.assertEqual(len(bounded), 338)
        self.assertEqual(len(clean_directory([{"field": "category", "value": str(i)} for i in range(1200)])[0]), 1000)

    def test_unsafe_catalog_names_and_xml_are_rejected(self):
        labels, limited = clean_directory([{"field": "category", "value": "token=secret"},
                                          {"field": "category", "value": "https://private.test/path"},
                                          {"field": "category_ids", "value": "2045", "display_name": "Movies/UHD"}])
        self.assertTrue(limited)
        self.assertEqual(len(labels), 1)
        with self.assertRaises(ValueError):
            parse_jackett_caps(b'<!DOCTYPE caps [<!ENTITY a "private">]><caps><categories/></caps>')

    def test_category_id_rules_match_actual_ids_not_names_and_keep_dedup(self):
        rows, _ = jackett_items([{"Title": "UHD", "InfoHash": "a" * 40, "Category": [2045, 3103000], "CategoryDesc": "Movies, Movies/UHD"},
                                {"Title": "Plain", "InfoHash": "b" * 40, "Category": [2000], "CategoryDesc": "Movies"}])
        rule = {"type": "label", "value": "3103000", "field": "category_ids", "source_id": self.s.id, "direction": "prefer"}
        AppSettings(sources=[self.s], result_preferences=[rule])
        merged = merge_results([self.s], [{"success": True, "items": list(reversed(rows))}], [rule])
        self.assertEqual(merged["data"][0]["title"], "UHD")
        self.assertEqual(merged["provenance"][0]["rule_matches"], [True])
        self.assertEqual(category_ids([True, "02045", -1, 2147483648, 2045, "2045"]), ["2045"])
        for invalid in ["Movies/UHD", "02045", "0", "2147483648"]:
            with self.assertRaises(ValidationError):
                AppSettings(sources=[self.s], result_preferences=[{**rule, "value": invalid}])


class SerialJobs(unittest.IsolatedAsyncioTestCase):
    async def test_jobs_coalesce_and_are_serial_even_for_multiple_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            sources = [source(id=str(i)) for i in range(3)]
            store = LabelCatalog(Path(tmp) / "labels.sqlite3")
            sync = CatalogSync(store, lambda: sources)
            active = maximum = calls = 0
            async def fetch(client, s):
                nonlocal active, maximum, calls
                active += 1; maximum = max(maximum, active); calls += 1
                await asyncio.sleep(0.005)
                active -= 1
                return directory()
            with patch("app.upstream_catalog.fetch_directory", fetch):
                sync.start(); original = sync.task; sync.start()
                self.assertIs(sync.task, original)
                await sync.task
                self.assertEqual((maximum, calls), (1, 3))
                sync.start(force=False); await sync.task
                self.assertEqual(calls, 3)
            self.assertFalse(sync.refreshing)


class Management(unittest.TestCase):
    def test_auth_write_only_headers_and_cache_get_never_fetches(self):
        import app.main as main
        import app.config as config
        with tempfile.TemporaryDirectory() as tmp:
            settings = AppSettings(sources=[source(url="http://generic.test/search")])
            store = LabelCatalog(Path(tmp) / "labels.sqlite3")
            sync = CatalogSync(store, lambda: main.settings.sources)
            patches = [patch.object(main, "settings", settings), patch.object(main, "load_settings", lambda: settings),
                       patch.object(main, "label_catalog", store), patch.object(main, "catalog_sync", sync),
                       patch.object(main, "WEB_USERNAME", "test"), patch.object(main, "WEB_PASSWORD", "test"),
                       patch.object(config, "CONFIG_FILE", str(Path(tmp) / "config.json")),
                       patch.object(config, "DATA_DIR", tmp)]
            for p in patches: p.start()
            try:
                with TestClient(main.app) as client:
                    self.assertEqual(client.get("/api/resource-labels").status_code, 401)
                    self.assertEqual(client.post("/api/resource-labels/refresh").status_code, 401)
                    client.post("/api/login", json={"username": "test", "password": "test"})
                    before = source_key(main.settings.sources[0])
                    response = client.put("/api/sources/avdb", json={"catalog_headers": {"Authorization": "Bearer credential-never-returned"}})
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()["has_catalog_headers"])
                    self.assertNotIn("credential-never-returned", response.text)
                    for path in ["/api/settings", "/api/sources", "/api/resource-labels"]:
                        self.assertNotIn("credential-never-returned", client.get(path).text)
                    self.assertEqual(source_key(main.settings.sources[0]), before)
                    client.put("/api/sources/avdb", json={"name": "renamed"})
                    self.assertTrue(main.settings.sources[0].catalog_headers)
                    client.put("/api/sources/avdb", json={"catalog_headers": {}})
                    self.assertFalse(main.settings.sources[0].catalog_headers)
                    for value in [None, [], "missing"]:
                        self.assertEqual(client.post("/api/resource-labels/refresh", json={"source_id": value}).status_code, 422)
                    self.assertEqual(client.post("/api/resource-labels/refresh", json={"source_id": "all"}).status_code, 202)
                    self.assertEqual(client.get("/api/resource-labels").json()["sources"][0]["directory"]["status"], "unsupported")
                    for headers in [{"Authorization": "line\nbreak"}, {"x": "a", "X": "b"}, {"x": 5}]:
                        self.assertEqual(client.put("/api/sources/avdb", json={"catalog_headers": headers}).status_code, 422)
            finally:
                for p in reversed(patches): p.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
