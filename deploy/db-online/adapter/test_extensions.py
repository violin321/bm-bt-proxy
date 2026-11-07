"""Exercise configured extension results through the adapter HTTP contract."""
import importlib.util
import unittest
from pathlib import Path

import httpx

spec = importlib.util.spec_from_file_location('extension_adapter', Path(__file__).with_name('main.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

LINK = 'magnet:?xt=urn:btih:' + 'c' * 40
ED2K = 'ed2k://|file|fixture.mkv|123|' + 'd' * 32 + '|/'


def extension():
    return {'code': 'TEST-123', 'count': 3, 'source': 'custom',
            'magnets': [{'id': 99, 'title': 'Extension fixture', 'download_url': LINK,
                         'size_mb': '124.5', 'site': 'fixture library', 'post_time': '2026-11-07',
                         'chinese': True, 'uc': True, 'uhd': True, 'free': True},
                        {'title': 'Duplicate', 'download_url': LINK + '&dn=duplicate'}],
            'ed2ks': [{'title': 'ED2K fixture', 'download_url': ED2K, 'size_mb': 3}]}


class ExtensionRequests(unittest.IsolatedAsyncioTestCase):
    async def call(self, handler, path='/api/torrents/custom', keyword='test123'):
        async with httpx.AsyncClient(base_url='http://upstream.test', transport=httpx.MockTransport(handler)) as upstream:
            adapter.app.state.provider = adapter.Provider(upstream)
            async with httpx.AsyncClient(base_url='http://adapter.test', transport=httpx.ASGITransport(app=adapter.app)) as c:
                return await c.get(path, params={'keyword': keyword})

    async def test_extension_only_resources_reach_bm_without_javdb_lookup(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            return httpx.Response(200, json={'success': True, 'data': extension()})
        response = await self.call(respond)
        self.assertEqual(response.status_code, 200)
        items = response.json()['data']
        self.assertEqual(calls, ['/api/external-magnets/custom/TEST-123'])
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['download_url'], LINK)
        self.assertIsInstance(items[0]['id'], int)
        self.assertEqual(items[0]['title'], 'Extension fixture')
        self.assertEqual(items[0]['size_mb'], 124.5)
        self.assertEqual(items[0]['date'], '2026-11-07')
        self.assertTrue(all(items[0][k] for k in ['chinese', 'uc', 'uhd', 'free']))

    async def test_nyaa_uses_its_own_endpoint_and_retains_safe_ids(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            return httpx.Response(200, json={'success': True, 'data': extension()})
        response = await self.call(respond, '/api/torrents/nyaa')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ['/api/external-magnets/nyaa/TEST-123'])
        item = response.json()['data'][0]
        self.assertEqual(item['site'], 'db_online_nyaa')
        self.assertTrue(0 <= item['id'] < 2 ** 53)
        self.assertEqual(item['id'], adapter.extension_resources(extension(), 'custom')[0]['id'])

    async def test_nyaa_preserves_labels_and_explicit_flags(self):
        value = extension()
        value['magnets'][0].update(tags=['高清', '字幕'], hd=True, mosaic=False, uncensored='false')
        response = await self.call(lambda r: httpx.Response(200, json={'success': True, 'data': value}), '/api/torrents/nyaa')
        item = response.json()['data'][0]
        self.assertEqual(item['tags'], ['高清', '字幕'])
        self.assertIs(item['upstream_flags']['hd'], True)
        self.assertIs(item['upstream_flags']['mosaic'], False)
        self.assertNotIn('uncensored', item['upstream_flags'])
        self.assertNotIn('hd', item)

    async def test_special_codes_are_queried_even_without_movie_metadata(self):
        for keyword, code in [('fc2-ppv-123', 'FC2-PPV-123'), ('259luxu123', '259LUXU123'),
                              ('TEST-123-C', 'TEST-123-C')]:
            calls = []
            def respond(request):
                calls.append(request.url.path)
                return httpx.Response(200, json={'success': True, 'data': extension()})
            self.assertEqual((await self.call(respond, keyword=keyword)).status_code, 200)
            self.assertEqual(calls, ['/api/external-magnets/custom/' + code])

    async def test_broad_search_queries_at_most_three_unique_movie_codes(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path == '/api/search':
                self.assertEqual(request.url.params['q'], '演员')
                return httpx.Response(200, json={'success': True, 'data': {'movies': [
                    {'number': 'TEST-1'}, {'number': 'TEST-1'}, {'number': 'TEST-2'},
                    {'number': 'TEST-3'}, {'number': 'TEST-4'}]}})
            return httpx.Response(200, json={'success': True, 'data': extension()})
        response = await self.call(respond, keyword='演员')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ['/api/search', '/api/external-magnets/custom/TEST-1',
                                 '/api/external-magnets/custom/TEST-2', '/api/external-magnets/custom/TEST-3'])
        self.assertEqual(len(response.json()['data']), 2)
        self.assertTrue(response.json()['meta']['limited'])

    async def test_upstream_errors_are_visible_and_do_not_affect_original_search(self):
        def respond(request):
            if '/external-magnets/' in request.url.path:
                return httpx.Response(200, json={'success': False, 'error': 'private token and URL'})
            return httpx.Response(200, json={'success': True, 'data': {
                'magnets': [{'name': 'original', 'magnet': LINK}], 'ed2ks': []}})
        response = await self.call(respond)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('private', response.text)
        original = await self.call(respond, '/api/torrents')
        self.assertEqual(original.status_code, 200)
        self.assertEqual(len(original.json()['data']), 1)

    async def test_successful_empty_is_distinct_from_invalid_resources(self):
        for value in [{'magnets': None, 'ed2ks': None, 'count': 0}, {'magnets': [], 'ed2ks': []}]:
            response = await self.call(lambda r: httpx.Response(200, json={'success': True, 'data': value}))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['data'], [])
        for value in [{}, {'magnets': {}}, {'magnets': ['wrong']},
                      {'magnets': [{'download_url': 'javascript:alert(1)'}]},
                      {'count': 3, 'magnets': None, 'ed2ks': None}]:
            response = await self.call(lambda r: httpx.Response(200, json={'success': True, 'data': value}))
            self.assertEqual(response.status_code, 502, value)

    async def test_extension_timeout_is_504(self):
        def respond(request):
            raise httpx.ReadTimeout('fixture', request=request)
        self.assertEqual((await self.call(respond)).status_code, 504)

    async def test_partial_extension_failure_is_not_successful_partial_data(self):
        def respond(request):
            if request.url.path == '/api/search':
                return httpx.Response(200, json={'success': True, 'data': {'movies': [
                    {'number': 'TEST-1'}, {'number': 'TEST-2'}]}})
            if request.url.path.endswith('TEST-1'):
                return httpx.Response(200, json={'success': True, 'data': extension()})
            return httpx.Response(503)
        self.assertEqual((await self.call(respond, keyword='fixture')).status_code, 502)

    async def test_blank_invalid_kind_and_overlong_input_never_contact_upstream(self):
        def respond(request):
            self.fail('invalid query contacted upstream')
        self.assertEqual((await self.call(respond, keyword='  ')).json(), {'data': []})
        self.assertEqual((await self.call(respond, '/api/torrents/not-a-source')).status_code, 422)
        self.assertEqual((await self.call(respond, keyword='x' * 201)).status_code, 422)


if __name__ == '__main__':
    unittest.main(verbosity=2)
