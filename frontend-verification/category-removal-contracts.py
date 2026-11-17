import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from app.aggregation import merge_results
from app.config import AppSettings, UpstreamSource
from app.label_catalog import LabelCatalog
from app.stats import source_key
from app.upstream_catalog import CatalogSync, catalog_key


def source(**values):
    return UpstreamSource(**{"id": "article", "url": "http://source.test/api/v1/articles/torrents", **values})


class CandidateRemoval(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = LabelCatalog(Path(self.temporary.name) / "labels.sqlite3")
        self.article = source()
        self.adapter = source(id="genres", url="http://adapter.test/api/torrents")

    def tearDown(self):
        self.temporary.cleanup()

    def test_existing_category_cache_is_deleted_without_removing_tags_or_query_history(self):
        self.store.record([self.article], [{"success": True, "items": [{"tags": ["LTX"]}]}], at=1000)
        categories = [{"field": "category", "value": f"分类{index}"} for index in range(338)]
        with closing(sqlite3.connect(self.store.path)) as database, database:
            database.execute("INSERT INTO labels VALUES (?,?,?,?,?,?,?,?)",
                             (self.article.id, source_key(self.article), "category", "旧分类", "旧分类", 1, 1000, 1000))
            database.execute("INSERT INTO directories VALUES (?,?,?,?,?,?,?)",
                             (self.article.id, catalog_key(self.article), json.dumps(categories), 1000,
                              "current_database", "snapshot", 0))
            database.execute("INSERT INTO directory_attempts VALUES (?,?,?,?,?,?)",
                             (self.article.id, catalog_key(self.article), "article_categories", "ready", None, 1000))
        view = self.store.overview([self.article], now=1001)["sources"][0]
        self.assertEqual([(label["field"], label["value"]) for label in view["labels"]], [("tags", "LTX")])
        self.assertEqual(view["directory"]["count"], 0)
        self.assertEqual(view["directory"]["provider"], "none")
        self.assertIsNotNone(view["last_query_at"])
        with closing(sqlite3.connect(self.store.path)) as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM directories").fetchone()[0], 0)
            self.assertEqual(database.execute("SELECT COUNT(*) FROM directory_attempts").fetchone()[0], 0)
            self.assertEqual(database.execute("SELECT COUNT(*) FROM labels WHERE field='category'").fetchone()[0], 0)

    def test_search_never_repopulates_categories_but_retains_magnet_tags_and_genres(self):
        item = {"category": "旧分类", "categories": ["其他分类"], "category_ids": [2045],
                "tags": ["LTX"], "labels": ["字幕"], "genres": ["剧情"]}
        self.store.record([self.article], [{"success": True, "items": [item]}], at=1000)
        view = self.store.overview([self.article], now=1001)["sources"][0]
        self.assertEqual({label["field"] for label in view["labels"]}, {"tags", "labels", "genres"})
        self.assertEqual(item["category_ids"], [2045])

    def test_classification_import_cannot_restore_removed_candidates(self):
        for upstream in [self.article, source(id="jackett", source_type="jackett", url="http://jackett.test")]:
            self.assertFalse(self.store.record_directory(upstream, {
                "status": "ready", "coverage": "current_database",
                "labels": [{"field": "category", "value": "旧分类"}],
            }, [upstream], at=1000))

    def test_cached_movie_genres_survive_cleanup(self):
        self.assertTrue(self.store.record_directory(self.adapter, {
            "status": "ready", "coverage": "cached_movies",
            "labels": [{"field": "genres", "value": "剧情"}, {"field": "category", "value": "旧分类"}],
        }, [self.adapter], at=1000))
        view = self.store.overview([self.adapter], now=1001)["sources"][0]
        self.assertEqual([(label["field"], label["value"]) for label in view["labels"]], [("genres", "剧情")])
        self.assertEqual(view["directory"]["count"], 1)

    def test_existing_category_rules_still_match_original_resource_fields(self):
        rule = {"type": "label", "field": "category", "value": "旧分类",
                "source_id": self.article.id, "direction": "prefer"}
        settings = AppSettings(sources=[self.article], result_preferences=[rule])
        items = [{"title": "普通"}, {"title": "已有规则命中", "category": "旧分类"}]
        merged = merge_results(settings.sources, [{"success": True, "items": items}], settings.result_preferences)
        self.assertEqual(merged["data"][0], items[1])
        self.assertEqual(settings.result_preferences, [rule])


class Synchronization(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_skips_article_and_jackett_classifications(self):
        with tempfile.TemporaryDirectory() as temporary:
            sources = [source(), source(id="jackett", source_type="jackett", url="http://jackett.test"),
                       source(id="genres", url="http://adapter.test/api/torrents")]
            store = LabelCatalog(Path(temporary) / "labels.sqlite3")
            sync = CatalogSync(store, lambda: sources)
            calls = []

            async def fetch(client, upstream):
                calls.append(upstream.id)
                return {"status": "ready", "coverage": "cached_movies",
                        "labels": [{"field": "genres", "value": "剧情"}]}

            with patch("app.upstream_catalog.fetch_directory", fetch):
                sync.start()
                await sync.task
            self.assertEqual(calls, ["genres"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
