"""DB Online adapter -> metadata cache -> source-scoped genre sorting contracts."""
import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import httpx

from app.aggregation import merge_results
from app.config import AppSettings, UpstreamSource
from app.label_catalog import LabelCatalog
from app.upstream_catalog import catalog_provider, fetch_directory, parse_adapter_genres

spec = importlib.util.spec_from_file_location("genres_adapter_contract", Path(__file__).resolve().parents[1] / "deploy/db-online/adapter/main.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def source(**extra):
    return UpstreamSource(**{"id": "db", "name": "DB Online", "url": "http://adapter.test/api/torrents", **extra})


def payload(**extra):
    return {"provider": "db_online", "coverage": "cached_movies", "limited": False,
            "labels": [{"field": "genres", "value": "OL"}], **extra}


def film(number, key, genres):
    return {"number": number, "categories": [{"name": name} for name in genres],
            "magnets": [{"name": number + " ordinary", "magnet": "magnet:?xt=urn:btih:" + key * 40}]}


class Discovery(unittest.IsolatedAsyncioTestCase):
    async def test_candidate_route_is_narrow_and_does_not_probe_extension_channels(self):
        for path in ["/api/torrents/nyaa", "/api/torrents/custom", "/search", "/api/torrents/javdb"]:
            self.assertEqual(catalog_provider(source(url="http://adapter.test" + path)), "none")
        self.assertEqual(catalog_provider(source()), "adapter_genres")
        self.assertEqual(catalog_provider(source(catalog_mode="disabled")), "none")

    async def test_prefix_headers_query_isolation_and_full_36_name_catalog(self):
        calls = []
        def respond(request):
            calls.append(request)
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/proxy/api/catalog/genres")
            self.assertFalse(request.url.query)
            self.assertEqual(request.headers["Authorization"], "directory-private")
            self.assertEqual(request.headers["X-Search"], "preserved")
            return httpx.Response(200, json=payload(labels=[{"field": "genres", "value": f"风格{i}", "external_id": "do-not-copy"} for i in range(36)]))
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            result = await fetch_directory(client, source(url="http://adapter.test/proxy/api/torrents/?secret=ignored", headers={"X-Search": "preserved", "Authorization": "search-private"}, catalog_headers={"authorization": "directory-private"}))
        self.assertEqual(len(calls), 1)
        self.assertEqual((result["status"], result["coverage"], len(result["labels"])), ("ready", "cached_movies", 36))
        self.assertNotIn("external_id", json.dumps(result))
        self.assertNotIn("do-not-copy", json.dumps(result))

    async def test_other_api_torrents_services_cannot_claim_movie_genres(self):
        invalid = [{"data": []}, payload(provider="other"), payload(coverage="all_movies"),
                   payload(limited="false"), payload(labels=[{"field": "tags", "value": "4K"}]),
                   *[payload(labels=[{"field": "genres", "value": value}]) for value in [None, ["OL"], {"name": "OL"}]],
                   payload(labels=[{"field": "genres"}])]
        for body in invalid:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))) as client:
                result = await fetch_directory(client, source())
            self.assertEqual(result["status"], "error")
            self.assertNotIn("labels", result)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404, text="token=private"))) as client:
            result = await fetch_directory(client, source())
        self.assertEqual(result["status"], "unsupported")
        self.assertNotIn("private", json.dumps(result))

    async def test_timeout_and_upstream_failure_are_isolated_and_redacted(self):
        for failure in [httpx.ReadTimeout("token=private"), RuntimeError("cookie=private")]:
            def respond(request):
                raise failure
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                result = await fetch_directory(client, source())
            self.assertEqual(result["status"], "error")
            self.assertNotIn("private", json.dumps(result))

    async def test_adapter_to_cache_and_sort_preserves_same_film_order_and_flags(self):
        movies = [film("TEST-100", "a", []), film("TEST-200", "b", ["OL", "4K"])]
        movies[1]["magnets"].append({"name": "second ordinary", "magnet": "magnet:?xt=urn:btih:" + "c" * 40})
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path == "/api/options/categories":
                return httpx.Response(200, json={"success": True, "data": [{"name": "OL"}, {"name": "4K"}]})
            if request.url.path == "/api/search":
                return httpx.Response(200, json={"success": True, "data": {"movies": [{"number": m["number"]} for m in movies]}})
            movie = next(m for m in movies if request.url.path == "/api/video/" + m["number"])
            return httpx.Response(200, json={"success": True, "data": movie})
        async with httpx.AsyncClient(base_url="http://db.test", transport=httpx.MockTransport(respond)) as upstream:
            adapter.app.state.provider = adapter.Provider(upstream)
            async with httpx.AsyncClient(base_url="http://adapter.test", transport=httpx.ASGITransport(app=adapter.app)) as client:
                directory = await fetch_directory(client, source())
                rows = (await client.get("/api/torrents", params={"keyword": "ordinary"})).json()["data"]
        self.assertEqual(calls, ["/api/options/categories", "/api/search", "/api/video/TEST-100", "/api/video/TEST-200"])
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(not row["uhd"] and not row["uc"] for row in rows))
        s, other = source(), source(id="other", name="other", url="http://other.test/search")
        other_row = {"title": "other film", "genres": ["OL"], "download_url": "magnet:?xt=urn:btih:" + "d" * 40}
        batches = [{"success": True, "items": rows}, {"success": True, "items": [other_row]}]
        rule = {"type": "label", "value": "OL", "field": "genres", "source_id": "db", "direction": "prefer"}
        self.assertEqual(AppSettings(sources=[s]).result_preferences, [])
        AppSettings(sources=[s, other], result_preferences=[rule])
        preferred = merge_results([s, other], batches, [rule])
        self.assertEqual([row["title"] for row in preferred["data"]], ["TEST-200 ordinary", "second ordinary", "TEST-100 ordinary", "other film"])
        self.assertEqual([row["rule_matches"] for row in preferred["provenance"]], [[True], [True], [False], [False]])
        deferred = merge_results([s, other], batches, [{**rule, "direction": "defer"}])
        self.assertEqual([row["title"] for row in deferred["data"]], ["TEST-100 ordinary", "other film", "TEST-200 ordinary", "second ordinary"])
        self.assertEqual([row["title"] for row in merge_results([s, other], batches, [])["data"]], [row["title"] for row in rows] + ["other film"])
        with tempfile.TemporaryDirectory() as tmp:
            store = LabelCatalog(Path(tmp) / "labels.sqlite3")
            store.record_directory(s, directory, [s], at=1000)
            store.record([s], batches[:1], at=1000)
            view = store.overview([s], now=1000)["sources"][0]
            self.assertEqual(view["directory"]["coverage"], "cached_movies")
            self.assertTrue(all(row["field"] == "genres" and row["origin"] == "both" for row in view["labels"]))
            store.record_directory(s, {"status": "error", "error": "目录读取失败"}, [s], at=1001)
            view = store.overview([s], now=1001)["sources"][0]
            self.assertEqual(len(view["labels"]), 2)
            self.assertTrue(view["directory"]["stale"])


class Cleaning(unittest.TestCase):
    def test_adapter_limit_and_name_sanitization_survive_the_core_boundary(self):
        labels, limited = parse_adapter_genres(payload(limited=True, labels=[{"field": "genres", "value": "OL", "extra": "secret"}, {"field": "genres", "value": "token=private"}]))
        self.assertTrue(limited)
        self.assertEqual(labels, [{"field": "genres", "value": "OL", "display_name": "OL", "catalog_count": None}])


if __name__ == "__main__":
    unittest.main()
