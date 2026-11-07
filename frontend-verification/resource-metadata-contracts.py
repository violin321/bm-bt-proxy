"""Check original labels, pre-dedup diagnostics and conservative field handling."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.config import AppSettings, UpstreamSource
from app.providers import parse_jackett
from app.resource_metadata import item_labels, summarize_resources
from app.stats import RequestStats


class ResourceMetadataContracts(unittest.TestCase):
    def test_source_labels_and_bool_fields_keep_their_meanings(self):
        rows = [{'tags': ['高清', '高清', {'name': '字幕'}], 'category': '无码破解', 'hd': True, 'uhd': False},
                {'tags': ['高清'], 'hd': False, 'uhd': 'false'}]
        result = summarize_resources(rows)
        self.assertEqual(result['count'], 2)
        self.assertEqual(result['labelled_count'], 2)
        self.assertEqual(result['labels'][0], {'field': 'tags', 'value': '高清', 'count': 2})
        self.assertEqual(result['flags'], {'hd': {'true': 1, 'false': 1}, 'uhd': {'true': 0, 'false': 1}})
        original = summarize_resources([{'chinese': True, 'upstream_flags': {'hd': True, 'mosaic': False}}])
        self.assertEqual(original['flags'], {'hd': {'true': 1, 'false': 0}, 'mosaic': {'true': 0, 'false': 1}})

    def test_only_bounded_label_values_are_described(self):
        row = {'tags': ['字幕', {'name': '高清', 'token': 'secret'},
                        'https://private/?token=secret', 'passkey=secret', 'x' * 81, True, 42, []],
               'download_url': 'https://private/?token=secret', 'unknown': ['private']}
        self.assertEqual(item_labels(row), [{'field': 'tags', 'value': '字幕'}, {'field': 'tags', 'value': '高清'}])
        result = summarize_resources([{'tags': [str(i)]} for i in range(125)])
        self.assertEqual(len(result['labels']), 120)
        self.assertTrue(result['labels_limited'])

    def test_jackett_retains_category_labels_without_private_links(self):
        result = parse_jackett({'Indexers': [{'Status': 2}], 'Results': [{
            'InfoHash': 'a' * 40, 'Title': 'Fixture', 'CategoryDesc': 'XXX',
            'Label': ['Freeleech'], 'Genres': ['Drama'],
            'Details': 'https://private/?apikey=secret', 'Link': 'https://private/download'}]})
        item = result['items'][0]
        self.assertEqual(item['category'], ['XXX'])
        self.assertEqual(item['tags'], ['Freeleech'])
        self.assertEqual(item['genres'], ['Drama'])
        self.assertFalse(item['free'])
        self.assertNotIn('private', json.dumps(item))

    def test_test_api_describes_each_source_before_dedup_without_recording_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ['DATA_DIR'] = tmp
            import app.main as main
            a = UpstreamSource(id='a', name='First', url='http://fixture.test', priority=100)
            b = UpstreamSource(id='b', name='Second', url='http://fixture.test', priority=200)
            async def fetch(client, source, keyword):
                return {'id': source.id, 'name': source.name, 'success': True, 'outcome': 'complete',
                        'status_code': 200, 'latency_ms': 1, 'count': 1, 'error': None,
                        'items': [{'title': source.name, 'download_url': 'magnet:?xt=urn:btih:' + 'a' * 40,
                                   'tags': ['字幕' if source.id == 'a' else 'LTX']}], 'indexers': []}
            store = RequestStats(Path(tmp) / 'requests.sqlite3')
            with patch.object(main, 'settings', AppSettings(sources=[a, b])), patch.object(main, 'request_stats', store), \
                    patch.object(main, 'fetch_single_source', fetch), patch.object(main, 'WEB_USERNAME', 'fixture'), \
                    patch.object(main, 'WEB_PASSWORD', 'fixture'), TestClient(main.app) as client:
                main.settings = AppSettings(sources=[a, b])
                self.assertEqual(client.post('/api/test', json={'keyword': 'fixture'}).status_code, 401)
                client.post('/api/login', json={'username': 'fixture', 'password': 'fixture'})
                response = client.post('/api/test', json={'keyword': 'fixture'}).json()
                self.assertEqual(len(response['data']), 1)
                self.assertEqual(response['data'][0]['tags'], ['字幕'])
                self.assertEqual(response['details'][1]['resource_metadata']['labels'][0]['value'], 'LTX')
                self.assertNotIn('LTX', json.dumps(store.overview([a, b]), ensure_ascii=False))
                public = client.get('/api/torrents?keyword=fixture').json()
                self.assertEqual(set(public), {'data'})
                self.assertEqual(public['data'], response['data'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
