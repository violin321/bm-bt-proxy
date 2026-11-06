"""Local-only integration: real auth, static assets, CRUD, aggregation, API Key.
Use against the isolated preview DATA_DIR, never a production URL.
"""
import ast, json, pathlib, re, tempfile, threading, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import httpx

# Exercise the unchanged normalization and deduplication contracts without loading app state.
root = pathlib.Path(__file__).resolve().parents[1]
config_ns = {'__name__':'config_contracts'}
exec(compile((root/'app/config.py').read_text(), 'app/config.py', 'exec'), config_ns)
assert config_ns['clean_url']('  library.local:6969/api///  ') == 'http://library.local:6969/api'
assert config_ns['clean_headers'](' raw-token ') == {'X-API-Key':'raw-token'}
assert config_ns['clean_headers']('{"Authorization":" Bearer example "}') == {'Authorization':'Bearer example'}
assert config_ns['clean_headers']({'X-Count': 2}) == {'X-Count':'2'}
source = ast.parse((root/'app/main.py').read_text())
fn = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'extract_dedup_key')
ns = {'re':re,'Dict':dict,'Any':object}
exec(compile(ast.Module(body=[fn], type_ignores=[]), 'dedup-contract', 'exec'), ns)
key = ns['extract_dedup_key']
assert key({'magnet':'magnet:?xt=urn:btih:'+'a'*40}) == key({'download_url':'magnet:?xt=urn:btih:'+'A'*40+'&dn=other'})
assert key({'magnet':'ed2k://|file|sample|123|'+'b'*32+'|/'}) == 'ed2k:'+'B'*32
assert key({'title':' Mixed TITLE '}) == key({'name':'mixed title'})
assert key({'download_url':'https://example.test/file'}) == 'https://example.test/file'
assert key({}) == ''
with tempfile.TemporaryDirectory(prefix='bm-config-contract-') as data_dir:
    config_ns['DATA_DIR'] = data_dir
    config_ns['CONFIG_FILE'] = str(pathlib.Path(data_dir)/'config.json')
    config_ns['OLD_SOURCES_FILE'] = str(pathlib.Path(data_dir)/'sources.json')
    pathlib.Path(config_ns['OLD_SOURCES_FILE']).write_text(json.dumps([{'name':'legacy','url':'library.local:6969/api'}]))
    migrated = config_ns['load_settings']()
    assert migrated.sources[0].url == 'http://library.local:6969/api'
    assert pathlib.Path(config_ns['CONFIG_FILE']).exists()
    migrated.api_key_enabled = True; migrated.api_key = 'local-contract-fixture'
    config_ns['save_settings'](migrated)
    restored = config_ns['load_settings']()
    assert restored.api_key_enabled and restored.api_key == 'local-contract-fixture'
print('PASS original URL / Token / JSON / BTIH / ED2K / title / legacy migration / persistence contracts')

BASE = os.getenv('BM_PREVIEW_URL', 'http://127.0.0.1:8765')
assert BASE.startswith('http://127.0.0.1:'), 'local integration only'
checks = ['original URL / Token / JSON / BTIH / ED2K / title / migration / persistence']
def checked(name):
    checks.append(name)
    print('PASS', name)
class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'data': [{'title': 'Synthetic upstream fixture', 'magnet': 'magnet:?xt=urn:btih:' + 'a' * 40, 'preview_image': 'https://fixture.test/cover.jpg'}]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.do_GET()
    def log_message(self, *_): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
threading.Thread(target=server.serve_forever, daemon=True).start()
ids = []
with httpx.Client(base_url=BASE) as client:
    original = None
    try:
        assert client.get('/api/stats').status_code == 401
        assert client.get('/api/settings').status_code == 401
        assert client.post('/api/login', json={'username': 'preview', 'password': 'wrong'}).status_code == 400
        assert client.post('/api/login', json={'username': 'preview', 'password': 'preview'}).status_code == 200
        assert 'bm_session' in client.cookies
        original = client.get('/api/settings').json()
        checked('real unauthenticated / incorrect / successful login contract')
        for file in ['theme.css', 'dashboard.css', 'console.js', 'login.js']:
            r = client.get('/static/' + file); assert r.status_code == 200 and len(r.content) > 100
        assert client.get('/favicon.svg').status_code == 200
        checked('shared frontend assets served by FastAPI')
        for method in ['GET', 'POST']:
            source = dict(name='Integration fixture ' + method, url=f'http://127.0.0.1:{server.server_port}/api', enabled=True, method=method, keyword_field='keyword', timeout=2, headers={})
            response = client.post('/api/sources', json=source); assert response.status_code == 200; source = response.json(); ids.append(source['id'])
            source['name'] += ' edited'; assert client.put('/api/sources/' + source['id'], json=source).status_code == 200
        checked('real create / edit for GET and POST source configuration')
        saved = client.get('/api/settings').json()['sources'][0]
        old_timeout = saved['timeout']
        saved['timeout'] = old_timeout + 1
        changed = client.put('/api/sources/' + saved['id'], json=saved).json()
        changed['timeout'] = old_timeout
        reverted = client.put('/api/sources/' + saved['id'], json=changed).json()
        assert changed['config_revision'] != saved['config_revision']
        assert reverted['config_revision'] != changed['config_revision']
        checked('persistent configuration revisions distinguish edits and exact reverts')
        response = client.post('/api/test', json={'keyword':'fixture', 'source_id':'all'}).json()
        fixtures = [d for d in response['details'] if d['id'] in ids]
        assert len(fixtures) == 2 and all(d['success'] for d in fixtures), repr(fixtures)
        assert len(response['data']) == 1 and response['data'][0]['preview_image'] == 'https://fixture.test/cover.jpg'
        checked('real concurrent upstream requests, BTIH dedup and image preservation')
        key = 'local-integration-fixture-key'
        assert client.post('/api/security', json={'api_key_enabled':True, 'api_key':key}).status_code == 200
        assert client.get('/api/torrents', params={'keyword':'fixture'}).status_code == 401
        assert len(client.get('/api/torrents', params={'keyword':'fixture', 'token':key}).json()['data']) == 1
        assert len(client.get('/bt/api', params={'keyword':'fixture'}, headers={'X-API-Key':key}).json()['data']) == 1
        checked('real endpoint aliases and query / header API Key authentication')
        stats = client.get('/api/stats').json()
        assert stats['summary']['requests'] >= 3
        assert stats['summary']['complete'] >= 3
        assert stats['summary']['duplicate_count'] >= 3
        assert {'api', 'test'} <= {r['origin'] for r in stats['requests']}
        assert client.get('/api/stats', params={'window':'invalid'}).status_code == 422
        assert client.get('/api/stats', params={'utc_offset':9999}).status_code == 422
        checked('real persisted dashboard stats, origins, dedup totals and query validation')
        assert client.post('/api/logout').status_code == 200
        assert client.get('/api/settings').status_code == 401
        checked('real logout clears authentication')
    finally:
        client.post('/api/login', json={'username':'preview', 'password':'preview'})
        for id_ in ids: client.delete('/api/sources/' + id_)
        if original: client.post('/api/security', json={k: original[k] for k in ['api_key_enabled', 'api_key']})
        server.shutdown()
result = {'checks':checks, 'localOnly':True, 'productionVerified':False}
(root/'frontend-verification/backend-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False))
