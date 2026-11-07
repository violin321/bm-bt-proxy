"""Isolated protocol, merge, secret-handling and compatibility contracts."""
import asyncio
import base64
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from app.config import UpstreamSource, AppSettings, request_config
from app.stats import RequestStats, source_key
from app.aggregation import dedup_key, merge_results
from app.providers import fetch_source, parse_jackett

HASH = 'a' * 40
MAGNET = 'magnet:?xt=urn:btih:' + HASH


def source(**values):
    return UpstreamSource(**{'id': 'jackett', 'name': 'Jackett', 'source_type': 'jackett',
                             'url': 'http://jackett.test', 'jackett_api_key': 'fixture-secret', **values})


def payload(statuses=(2,), rows=None):
    return {'Results': rows if rows is not None else [dict(Title='Fixture 中字 UC 2160p', Size=1048576,
                    Seeders=12, Tracker='Fixture indexer', MagnetUri=MAGNET, DownloadVolumeFactor=1)],
            'Indexers': [dict(ID=str(i), Name='Indexer ' + str(i), Status=s, Results=1,
                             Error=None if s == 2 else 'secret URL ?apikey=fixture-secret') for i, s in enumerate(statuses)]}


class JackettContracts(unittest.IsolatedAsyncioTestCase):
    async def fetch(self, value, status=200, src=None, keyword='fixture'):
        def handler(request):
            self.assertEqual(request.url.params.get('apikey'), 'fixture-secret')
            return httpx.Response(status, json=value)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_source(client, src or source(), keyword)

    async def test_mapping_and_safe_ids(self):
        r = await self.fetch(payload())
        self.assertTrue(r['success']); self.assertEqual(r['outcome'], 'complete')
        item = r['items'][0]
        self.assertEqual((item['size_mb'], item['seeders']), (1, 12))
        self.assertTrue(item['chinese'] and item['uc'] and item['uhd'])
        self.assertFalse(item['free']); self.assertLess(item['id'], 2**53)
        self.assertEqual(item['id'], parse_jackett(payload())['items'][0]['id'])

    async def test_partial_success_retains_data_and_redacts_errors(self):
        r = await self.fetch(payload((2, 1)))
        self.assertTrue(r['success']); self.assertEqual(r['outcome'], 'partial')
        self.assertEqual(r['count'], 1); self.assertNotIn('fixture-secret', str(r))

    async def test_all_failed_is_not_successful_empty(self):
        r = await self.fetch(payload((1, 1)))
        self.assertFalse(r['success']); self.assertEqual(r['items'], [])

    async def test_legitimate_zero(self):
        r = await self.fetch(payload(rows=[]))
        self.assertTrue(r['success']); self.assertEqual(r['count'], 0)

    async def test_wrong_schema_rejected(self):
        for value in [{'data': []}, {'Results': [], 'Indexers': []}, []]:
            r = await self.fetch(value); self.assertFalse(r['success'])

    async def test_empty_keyword_never_calls_jackett(self):
        async def handler(request):
            self.fail('empty input called upstream')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            r = await fetch_source(client, source(), '  ')
            self.assertTrue(r['success']); self.assertEqual(r['items'], [])

    async def test_deadline_and_http_failure(self):
        async def handler(request):
            await asyncio.sleep(1)
            return httpx.Response(200, json=payload())
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            r = await fetch_source(client, source(timeout=0.5), 'fixture')
            self.assertFalse(r['success']); self.assertIn('超时', r['error'])
        r = await self.fetch({}, status=403)
        self.assertFalse(r['success']); self.assertEqual(r['status_code'], 403)

    async def test_hash_fallback_and_torrent_only_skipped(self):
        rows = [dict(Title='hash', InfoHash=HASH), dict(Title='torrent only', Link='http://private/?apikey=secret'),
                dict(Title='duplicate', MagnetUri=MAGNET)]
        r = await self.fetch(payload(rows=rows))
        self.assertEqual(r['count'], 1); self.assertEqual(r['skipped_count'], 1)
        self.assertNotIn('private', str(r['items']))

    async def test_magnet_in_link_field_is_usable(self):
        r = await self.fetch(payload(rows=[{'Title': 'link magnet', 'Link': MAGNET}]))
        self.assertTrue(r['success']); self.assertEqual(r['count'], 1)
        self.assertEqual(r['items'][0]['download_url'], MAGNET)

    async def test_generic_wrong_schema_and_post_headers(self):
        def handler(request):
            self.assertEqual(request.method, 'POST')
            self.assertEqual(json.loads(request.content), {'q': 'fixture'})
            self.assertEqual(request.headers['Authorization'], 'Bearer fixture')
            return httpx.Response(200, json={'Results': []})
        src = source(source_type='generic', method='POST', keyword_field='q', headers={'Authorization': 'Bearer fixture'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            r = await fetch_source(client, src, 'fixture')
            self.assertFalse(r['success'])


class MergeContracts(unittest.TestCase):
    def test_base32_hex_equivalence_and_ed2k(self):
        b32 = base64.b32encode(bytes.fromhex(HASH)).decode()
        self.assertEqual(dedup_key({'magnet': MAGNET}), dedup_key({'download_url': 'magnet:?xt=urn:btih:' + b32}))
        self.assertEqual(dedup_key({'magnet': 'ed2k://|file|a|123|'+'b'*32+'|/'}), 'ed2k:'+'B'*32)

    def test_source_priority_duplicate_winner_and_stability(self):
        a, b = source(id='a', name='A', priority=200), source(id='b', name='B', priority=100)
        rows = [dict(success=True, items=[{'title': 'A', 'download_url': MAGNET, 'chinese': True}]),
                dict(success=True, items=[{'title': 'B', 'download_url': MAGNET, 'chinese': False}])]
        r = merge_results([a,b], rows, ['chinese'])
        self.assertEqual(r['data'][0]['title'], 'B')
        self.assertFalse(r['data'][0]['chinese'])
        self.assertEqual(r['merge']['duplicates'][0]['kept_source'], 'B')

    def test_preferences_default_off_and_precede_source(self):
        a, b = source(id='a', priority=10), source(id='b', priority=100)
        rows = [dict(success=True, items=[{'title': 'plain'}]), dict(success=True, items=[{'title': 'chinese', 'chinese': True}])]
        self.assertEqual(merge_results([a,b], rows, [])['data'][0]['title'], 'plain')
        self.assertEqual(merge_results([a,b], rows, ['chinese'])['data'][0]['title'], 'chinese')
        self.assertEqual(merge_results([a,b], rows, ['!chinese'])['data'][0]['title'], 'plain')

    def test_legacy_fingerprint_and_metadata_edits(self):
        a = UpstreamSource(id='old', url='http://old.test')
        legacy = a.model_dump(exclude={'name', 'source_type', 'priority', 'tags', 'jackett_indexer', 'jackett_api_key'})
        expected = hashlib.sha256(json.dumps(legacy, sort_keys=True).encode()).hexdigest()
        self.assertEqual(source_key(a), expected)
        a.tags = ['public']; a.priority = 2; a.name = 'renamed'
        self.assertEqual(source_key(a), expected)
        a.timeout += 1
        self.assertNotEqual(source_key(a), expected)

    def test_partial_stats_and_legacy_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = source()
            store = RequestStats(Path(tmp) / 'stats.sqlite3')
            r = parse_jackett(payload((2,1))); r.update(id=s.id,name=s.name,status_code=200,count=1,latency_ms=20)
            store.record('test','fixture',[s],[r],1,20)
            d = store.overview([s]);self.assertEqual(d['summary']['partial'],1)
            self.assertEqual(d['sources'][s.id]['last']['outcome'],'partial')
            self.assertNotIn('fixture-secret', str(d))


class ManagementContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ['DATA_DIR'] = cls.tmp.name
        import app.main as main
        cls.main = main
        # config was imported earlier; point persistence explicitly at the isolated directory.
        import app.config as config
        config.DATA_DIR = cls.tmp.name; config.CONFIG_FILE = str(Path(cls.tmp.name)/'config.json')
        cls.main.settings = AppSettings()
        cls.main.request_stats = RequestStats(Path(cls.tmp.name) / 'requests.sqlite3')
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close(); cls.tmp.cleanup()

    def test_write_only_key_and_metadata_revision(self):
        r = self.client.post('/api/sources', json={'source_type':'jackett','url':'jackett.test','jackett_api_key':'fixture-secret'})
        self.assertEqual(r.status_code,200)
        data = r.json();self.assertEqual(data['priority'],200);self.assertEqual(data['timeout'],20)
        self.assertTrue(data['has_jackett_api_key']);self.assertNotIn('fixture-secret',r.text)
        path='/api/sources/'+data['id'];revision=data['config_revision']
        changed=self.client.put(path,json={'priority':1,'tags':['public']}).json()
        self.assertEqual(changed['config_revision'],revision)
        self.assertTrue(changed['has_jackett_api_key'])
        self.assertNotIn('fixture-secret', self.client.get('/api/settings').text)
        changed=self.client.put(path,json={'jackett_indexer':'knaben'}).json()
        self.assertNotEqual(changed['config_revision'],revision)
        cleared=self.client.put(path,json={'jackett_api_key':''}).json()
        self.assertFalse(cleared['has_jackett_api_key'])
        self.client.delete(path)

    def test_validation_and_preferences(self):
        for extra in [{'timeout':0}, {'priority':-1}, {'url':1}, {'headers':{'X-Test':'a\nb'}},
                      {'headers':{'X-Test':'a','x-test':'b'}}, {'jackett_indexer':'../all'}]:
            r=self.client.post('/api/sources',json={'url':'http://fixture.test',**extra})
            self.assertEqual(r.status_code,422,r.text)
        for rules in [['uc','!uc'],['unknown']]:
            self.assertEqual(self.client.post('/api/result-preferences',json={'result_preferences':rules}).status_code,422)
        self.assertEqual(self.client.post('/api/result-preferences',json={'result_preferences':['chinese','uc']}).status_code,200)
        self.assertEqual(self.client.get('/api/settings').json()['result_preferences'],['chinese','uc'])
        self.client.post('/api/result-preferences',json={'result_preferences':[]})


if __name__ == '__main__':
    unittest.main(verbosity=2)
