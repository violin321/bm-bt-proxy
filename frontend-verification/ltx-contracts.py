"""Opt-in LTX selection contracts; all resources and endpoints are local fixtures."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.aggregation import merge_results
from app.config import AppSettings, UpstreamSource
from app.ltx import ltx_evidence


def source(identity="a", priority=100):
    return UpstreamSource(id=identity, name=identity, url="http://fixture.test", priority=priority)


def resource(identity, **values):
    return {"id": identity, "title": f"TEST-{identity}", "uc": True,
            "download_url": "magnet:?xt=urn:btih:" + f"{identity:040x}", **values}


def response(src, items):
    return {"id": src.id, "name": src.name, "success": True, "outcome": "complete",
            "status_code": 200, "latency_ms": 1, "count": len(items), "error": None,
            "items": items, "indexers": []}


class ResourceEvidence(unittest.TestCase):
    def test_individual_tags_and_explicit_title_markers(self):
        for item, expected in [({"tags": ["LTX"]}, "tags"), ({"labels": [{"name": "ＬＴＸ"}]}, "labels"),
                               ({"title": "TEST-100 [LTX-V3.2] 破解"}, "title"),
                               ({"title": "TEST-100 ltx破解"}, "title"),
                               ({"title": "TEST-100 LTX2.3"}, "title")]:
            with self.subTest(item=item):
                self.assertEqual(ltx_evidence(item), expected)

    def test_shared_genres_categories_site_or_generic_uc_are_not_model_evidence(self):
        for item in [{"genres": ["LTX破解"]}, {"category": "LTX破解"}, {"site": "LTX"},
                     {"title": "TEST-100 无码破解"}, {"title": "altx ABC-LTXMODEL"},
                     {"title": "非LTX 破解"}, {"tags": ["non-LTX"]},
                     {"title": "TEST without LTX"}, {"title": "TEST no.LTX"},
                     {"title": "TEST not an LTX version"}, {"title": "TEST not a LTX version"},
                     {"tags": ["LTX=false"]}, {"title": "TEST LTX:off"},
                     {"title": "TEST https://ltx.example/movie"},
                     {"tags": ["token=LTX"]}, {"title": "TEST token=LTX"},
                     {"tags": [False, {"id": "LTX"}]}]:
            with self.subTest(item=item):
                self.assertIsNone(ltx_evidence(item))

    def test_boundaries_normalization_and_input_are_preserved(self):
        item = resource(1, title="TEST-1", tags=[" ＬＴＸ "])
        old = dict(item)
        self.assertEqual(ltx_evidence(item), "tags")
        self.assertEqual(item, old)
        self.assertIsNone(ltx_evidence({"title": "x" * 2048 + " LTX"}))


class Selection(unittest.TestCase):
    def setUp(self):
        self.a, self.b = source(priority=10), source("b", priority=200)

    def merge(self, a, b=(), preferences=(), profile="ltx"):
        return merge_results([self.a, self.b], [response(self.a, a), response(self.b, b)], list(preferences), profile)

    def test_ltx_before_uc_fallback_even_when_other_flags_and_preferences_disagree(self):
        rows = [resource(1, chinese=True, free=True, seeders=999), resource(2, tags=["LTX"], seeders=0),
                resource(3, uc=False, tags=["LTX"])]
        value = self.merge(rows, preferences=["chinese", "free"])
        self.assertEqual([r["id"] for r in value["data"]], [2, 1])
        self.assertEqual(value["selection"], {"profile": "ltx", "ltx_count": 1, "uncensored_count": 2,
                                              "fallback_preserved": True, "consumer_sort": "uc"})

    def test_no_ltx_still_returns_other_uc_without_censored_fallback(self):
        rows = [resource(1, uc=False), resource(2), resource(3, uc="true"), resource(4, uc=1)]
        self.assertEqual([r["id"] for r in self.merge(rows)["data"]], [2])
        self.assertEqual(self.merge([resource(1, uc=False)])["data"], [])

    def test_ltx_only_does_not_set_uc_or_rewrite_resource_attributes(self):
        rows = [resource(1, uc=False, title="LTX 破解"), resource(2, tags=["LTX"], uhd=True, size_mb=20000)]
        value = self.merge(rows)
        self.assertEqual(value["data"], [rows[1]])
        self.assertIs(value["data"][0], rows[1])
        self.assertEqual(value["provenance"][0]["ltx_evidence"], "tags")

    def test_no_early_uhd_size_filter_can_swallow_a_usable_fallback(self):
        rows = [resource(1, tags=["LTX"], uhd=True, size_mb=50000),
                resource(2, uhd=False, size_mb=5000)]
        value = self.merge(rows)
        self.assertEqual([r["id"] for r in value["data"]], [1, 2])
        usable = [r for r in value["data"] if not r.get("uhd") and r["size_mb"] < 10000]
        self.assertEqual([r["id"] for r in usable], [2])

    def test_opt_in_dedup_keeps_whole_ltx_record_without_borrowing_flags(self):
        plain = resource(1, title="original", free=True)
        marked = resource(1, title="LTX version", free=False, seeders=0, tags=["LTX"])
        value = self.merge([plain], [marked])
        self.assertEqual(value["data"], [marked])
        self.assertEqual(value["provenance"][0]["source_id"], "b")
        self.assertFalse(value["data"][0]["free"])
        self.assertEqual(len(value["merge"]["duplicates"]), 1)

    def test_censored_duplicate_cannot_hide_uncensored_candidate(self):
        self.assertEqual(self.merge([resource(1, uc=False)], [resource(1)])["provenance"][0]["source_id"], "b")

    def test_same_tier_retains_preferences_then_source_and_original_order(self):
        a = [resource(1, tags=["LTX"]), resource(2, tags=["LTX"]), resource(3)]
        b = [resource(4, tags=["LTX"], chinese=True), resource(5)]
        self.assertEqual([r["id"] for r in self.merge(a, b)["data"]], [1, 2, 4, 3, 5])
        self.assertEqual([r["id"] for r in self.merge(a, b, ["chinese"])["data"]], [4, 1, 2, 3, 5])

    def test_standard_profile_keeps_original_winner_schema_and_all_resources(self):
        a = [resource(1, uc=False), resource(2)]
        b = [resource(2, tags=["LTX"])]
        implicit = merge_results([self.a, self.b], [response(self.a, a), response(self.b, b)], [])
        explicit = self.merge(a, b, profile="standard")
        self.assertEqual(implicit, explicit)
        self.assertEqual(explicit["data"], a)
        self.assertNotIn("selection", explicit)
        self.assertNotIn("ltx_evidence", explicit["provenance"][0])

    def test_unknown_profile_fails_instead_of_silently_falling_back(self):
        with self.assertRaises(ValueError):
            self.merge([], profile="unknown")


class Endpoints(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DATA_DIR"] = self.tmp.name
        import app.main as main
        from app.label_catalog import LabelCatalog
        from app.stats import RequestStats
        self.main = main
        self.a = source()
        self.rows = [resource(1), resource(2, title="TEST LTX"), resource(3, uc=False)]
        async def fetch(client, src, keyword):
            return response(src, self.rows)
        self.patches = [patch.object(main, "settings", AppSettings(api_key_enabled=True, api_key="fixture-key", sources=[self.a])),
                        patch.object(main, "WEB_USERNAME", "fixture"), patch.object(main, "WEB_PASSWORD", "fixture"),
                        patch.object(main, "label_catalog", LabelCatalog(Path(self.tmp.name) / "labels.sqlite3")),
                        patch.object(main, "request_stats", RequestStats(Path(self.tmp.name) / "requests.sqlite3")),
                        patch.object(main, "fetch_single_source", fetch)]
        for value in self.patches:
            value.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        for value in reversed(self.patches):
            value.stop()
        self.tmp.cleanup()

    def test_both_aliases_get_post_keep_auth_and_public_data_only(self):
        for path in ["/api/torrents/ltx", "/bt/api/ltx"]:
            self.assertEqual(self.client.get(path).status_code, 401)
            for method in [self.client.get, self.client.post]:
                value = method(path, params={"keyword": "TEST", "token": "fixture-key"})
                self.assertEqual(value.status_code, 200)
                self.assertEqual(set(value.json()), {"data"})
                self.assertEqual([r["id"] for r in value.json()["data"]], [2, 1])

    def test_standard_entry_is_unchanged_and_profile_test_requires_login(self):
        value = self.client.get("/api/torrents", headers={"X-API-Key": "fixture-key"}).json()
        self.assertEqual(value["data"], self.rows)
        self.assertEqual(self.client.post("/api/test", json={"keyword": "TEST", "profile": "ltx"}).status_code, 401)
        self.client.cookies.set("bm_session", self.main.generate_cookie_token())
        result = self.client.post("/api/test", json={"keyword": "TEST", "profile": "ltx"}).json()
        self.assertEqual(result["selection"]["ltx_count"], 1)
        self.assertEqual([r["id"] for r in result["data"]], [2, 1])
        self.assertEqual(self.client.post("/api/test", json={"profile": []}).status_code, 422)
        self.assertEqual(self.client.post("/api/test", json={"profile": "invalid"}).status_code, 422)


if __name__ == "__main__":
    unittest.main(verbosity=2)
