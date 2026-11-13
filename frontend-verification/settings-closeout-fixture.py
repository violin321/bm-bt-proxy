"""Isolated synthetic article login provider and console. Never reads production."""
import json
import os
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

root = Path.cwd() / '.preview-data' / 'settings-closeout'
root.mkdir(parents=True, exist_ok=True)
data = root / 'data'
data.mkdir(exist_ok=True)
config = {'sources': [{'id': 'alpha', 'name': 'AVDB · 演示源', 'url': 'http://127.0.0.1:18776/api/v1/articles/torrents', 'headers': {'X-API-Key': 'fixture-search'}, 'priority': 100}, {'id': 'beta', 'name': 'Jackett · 演示源', 'url': 'http://127.0.0.1:18776', 'source_type': 'jackett', 'jackett_api_key': 'fixture-jackett', 'enabled': False}], 'result_preferences': []}
if not (data/'config.json').exists():
    (data/'config.json').write_text(json.dumps(config, ensure_ascii=False))


class Handler(BaseHTTPRequestHandler):
    def send(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode())
        if self.path == '/api/v1/users/login':
            if form.get('password') != ['preview-source']:
                return self.send({'code': 1, 'message': 'fixture upstream rejected password'})
            if form.get('username') == ['otp-user']:
                return self.send({'code': 0, 'data': {'requires_2fa': True, 'otp_token': 'fixture-challenge'}})
            return self.send({'access_token': 'fixture-directory-session'})
        if self.path == '/api/v1/users/login/2fa' and form.get('otp_code') == ['123456']:
            return self.send({'code': 0, 'data': {'access_token': 'fixture-directory-session'}})
        return self.send({}, 401)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/v1/articles/categories':
            if self.headers.get('Authorization') != 'Bearer fixture-directory-session':
                return self.send({}, 401)
            return self.send({'data': [{'categories': [{'name': '演示分类', 'count': 12}, {'name': '字幕', 'count': 6}]}]})
        if path == '/api/v1/articles/torrents':
            return self.send({'data': [{'title': '演示资源 · 中文字幕', 'download_url': 'magnet:?xt=urn:btih:'+'a'*40, 'tags': ['字幕'], 'category': '演示分类', 'uc': True, 'chinese': True, 'size_mb': 2048}]})
        return self.send({}, 404)

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 18776), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
env = {**os.environ, 'DATA_DIR': str(data), 'WEB_USERNAME': 'preview', 'WEB_PASSWORD': 'preview', 'BM_BUILD_REVISION': 'abcdef0'}
child = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18775'], env=env)


def stop(*args):
    child.terminate()
    server.shutdown()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    child.wait()
finally:
    server.server_close()
