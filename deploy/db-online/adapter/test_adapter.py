import importlib.util
import json
import unittest
from pathlib import Path

import httpx

spec = importlib.util.spec_from_file_location('dbonline_adapter', Path(__file__).with_name('main.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

LINK = 'magnet:?xt=urn:btih:' + 'a' * 40
ED2K = 'ed2k://|file|fixture.mkv|123|' + 'b' * 32 + '|/'


def movie():
    return {'code': 'TEST-123', 'cover_url': 'https://example.test/cover.jpg',
            'magnets': [{'name': 'TEST-123 2160p', 'magnet': LINK, 'size_mb': '123.5', 'tags': ['中字']},
                        {'name': 'duplicate', 'magnet': LINK + '&dn=other'},
                        {'name': 'unsafe', 'magnet': 'javascript:alert(1)'}],
            'ed2ks': [{'name': 'fixture', 'ed2k': ED2K, 'size_mb': 'nan'}]}


class Mapping(unittest.TestCase):
    def test_byte_muse_required_field_types(self):
        required = {'id': int, 'site': str, 'type': str, 'size_mb': (int, float),
                    'seeders': int, 'title': str, 'chinese': bool, 'uc': bool,
                    'uhd': bool, 'free': bool, 'download_url': str}
        for item in adapter.resources(movie()):
            for field, kind in required.items():
                self.assertIsInstance(item[field], kind, field)
            self.assertTrue(0 <= item['id'] < 2 ** 53)
            json.dumps(item, allow_nan=False)

    def test_only_common_identifier_forms_are_normalized(self):
        for text in ['TEST-123', 'test123', 'TeSt-123']:
            self.assertEqual(adapter.code_query(text), 'TEST-123')
        for text in ['259luxu123', 'TEST-123-C', 'FC2-PPV-123', '演员']:
            self.assertIsNone(adapter.code_query(text))

    def test_magnet_ed2k_sizes_flags_and_dedup(self):
        items = adapter.resources(movie())
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['download_url'], LINK)
        self.assertEqual(items[1]['download_url'], ED2K)
        self.assertEqual(items[0]['size_mb'], 123.5)
        self.assertEqual(items[1]['size_mb'], 0)
        self.assertTrue(items[0]['chinese'] and items[0]['uhd'])
        self.assertEqual(items[0]['preview_image'], 'https://example.test/cover.jpg')

    def test_original_tags_survive_without_private_tag_metadata(self):
        value = movie()
        value['magnets'][0]['tags'] = ['字幕', '高清', '破解', 'LTX',
            {'name': 'UHD', 'token': 'private'}, '字幕', {'name': 'https://private/?key=secret'}, 123]
        item = adapter.resources(value)[0]
        self.assertEqual(item['tags'], ['字幕', '高清', '破解', 'LTX', 'UHD'])
        self.assertTrue(item['chinese'])
        self.assertNotIn('private', json.dumps(item))
        value['magnets'][0].update(name='TEST-123 无字幕', tags=['无字幕'])
        self.assertFalse(adapter.resources(value)[0]['chinese'])

    def test_invalid_resource_schema_is_an_error_but_empty_lists_are_valid(self):
        for value in [None, {}, {'magnets': {'items': []}}]:
            with self.assertRaises(adapter.UpstreamError):
                adapter.resources(value)
        self.assertEqual(adapter.resources({'magnets': None, 'ed2ks': []}), [])


class Requests(unittest.IsolatedAsyncioTestCase):
    async def call(self, handler, keyword):
        async with httpx.AsyncClient(base_url='http://fixture.test', transport=httpx.MockTransport(handler)) as client:
            return await adapter.Provider(client).search(keyword)

    async def test_exact_identifier_needs_one_request(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            return httpx.Response(200, json={'success': True, 'data': movie()})
        result = await self.call(respond, 'test123')
        self.assertEqual(calls, ['/api/video/TEST-123'])
        self.assertEqual(len(result['data']), 2)

    async def test_blank_keyword_does_not_contact_upstream(self):
        def respond(request):
            self.fail('empty keyword contacted upstream')
        self.assertEqual(await self.call(respond, ''), {'data': []})

    async def test_broad_search_is_bounded_and_deduplicates(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path == '/api/search':
                self.assertEqual(request.url.params['q'], 'fixture')
                return httpx.Response(200, json={'success': True, 'data': {'movies': [
                    {'number': 'TEST-' + str(i), 'id': str(i)} for i in range(20)]}})
            return httpx.Response(200, json={'success': True, 'data': movie()})
        result = await self.call(respond, 'fixture')
        self.assertEqual(len(calls), 4)
        self.assertEqual(len(result['data']), 2)
        self.assertTrue(result['meta']['limited'])

    async def test_not_found_differs_from_upstream_failure(self):
        result = await self.call(lambda r: httpx.Response(200, json={
            'success': False, 'error': '无法获取影片信息: 未找到影片: TEST-999'}), 'TEST-999')
        self.assertEqual(result, {'data': []})
        for response in [httpx.Response(401), httpx.Response(200, text='<html>login</html>'),
                         httpx.Response(200, json={'success': False, 'error': 'authentication failed'}),
                         httpx.Response(200, json={'success': True, 'data': None})]:
            with self.assertRaises(adapter.UpstreamError):
                await self.call(lambda r, response=response: response, 'TEST-999')

    async def test_current_movie_not_found_response_is_an_empty_endpoint_result(self):
        for message in ['无法获取影片信息: 未找到匹配的影片: TEST-999',
                        '未找到匹配的影片: TEST-999']:
            with self.subTest(message=message):
                async with httpx.AsyncClient(base_url='http://upstream.test',
                        transport=httpx.MockTransport(lambda r: httpx.Response(200, json={
                            'success': False, 'error': message}))) as upstream:
                    adapter.app.state.provider = adapter.Provider(upstream)
                    async with httpx.AsyncClient(base_url='http://adapter.test',
                            transport=httpx.ASGITransport(app=adapter.app)) as client:
                        response = await client.get('/api/torrents', params={'keyword': 'test999'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'data': []})

    async def test_current_not_found_message_cannot_hide_other_failures(self):
        for value in [
                {'success': False, 'error': '无法获取影片信息: 未找到上游服务'},
                {'success': False, 'error': '无法获取影片信息: 未找到匹配的影片: OTHER-999'},
                {'success': False, 'error': '未找到匹配的影片: TEST-999; upstream failed'},
                {'success': False, 'error': ['未找到匹配的影片: TEST-999']},
                {'error': '未找到匹配的影片: TEST-999'},
                {'success': True, 'error': '未找到匹配的影片: TEST-999', 'data': None}]:
            with self.subTest(value=value):
                with self.assertRaises(adapter.UpstreamError):
                    await self.call(lambda r: httpx.Response(200, json=value), 'TEST-999')
        for status in [401, 403, 429, 500, 502, 503]:
            with self.subTest(status=status):
                with self.assertRaises(adapter.UpstreamError):
                    await self.call(lambda r: httpx.Response(status, json={
                        'success': False, 'error': '未找到匹配的影片: TEST-999'}), 'TEST-999')

    async def test_current_not_found_message_does_not_hide_generic_search_failure(self):
        with self.assertRaises(adapter.UpstreamError):
            await self.call(lambda r: httpx.Response(200, json={
                'success': False, 'error': '未找到匹配的影片: TEST-999'}), 'fixture')

    async def test_partial_metadata_failure_is_not_reported_as_success(self):
        def respond(request):
            if request.url.path == '/api/search':
                return httpx.Response(200, json={'success': True, 'data': {'movies': [
                    {'number': 'TEST-1'}, {'number': 'TEST-2'}]}})
            if request.url.path.endswith('TEST-1'):
                return httpx.Response(200, json={'success': True, 'data': movie()})
            return httpx.Response(503)
        with self.assertRaises(adapter.UpstreamError):
            await self.call(respond, 'fixture')

    async def test_timeout_is_distinct(self):
        def respond(request):
            raise httpx.ReadTimeout('fixture', request=request)
        with self.assertRaises(TimeoutError):
            await self.call(respond, 'TEST-123')

    async def test_endpoint_validation_and_sanitized_error(self):
        class Broken:
            async def search(self, keyword):
                raise adapter.UpstreamError('private token and URL')
        adapter.app.state.provider = Broken()
        async with httpx.AsyncClient(base_url='http://fixture.test', transport=httpx.ASGITransport(app=adapter.app)) as c:
            self.assertEqual((await c.get('/health')).status_code, 200)
            self.assertEqual((await c.get('/api/torrents', params={'keyword': 'x' * 201})).status_code, 422)
            response = await c.get('/api/torrents', params={'keyword': 'test'})
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private', response.text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
