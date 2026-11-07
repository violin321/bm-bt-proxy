"""Start isolated HTTP providers and console for verify-label-order.cjs; run from repo root."""
import json, os, subprocess, signal, threading, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
root=Path.cwd()/'.preview-data'/'labels160-preview'
root.mkdir(parents=True,exist_ok=True)
data=root/'data';data.mkdir(exist_ok=True)
config={'sources':[{'id':'alpha','name':'AVDB · 验证样本','url':'http://127.0.0.1:18766/alpha','priority':100},
 {'id':'beta','name':'DB Online · 验证样本','url':'http://127.0.0.1:18766/beta','priority':200},
 {'id':'flags','name':'修仙 · 布尔属性样本','url':'http://127.0.0.1:18766/flags','priority':150}], 'result_preferences':[]}
if not (data/'config.json').exists():(data/'config.json').write_text(json.dumps(config,ensure_ascii=False))
def item(title,key,**kw):return dict(title=title,download_url='magnet:?xt=urn:btih:'+key*40,uc=True,size_mb=2048,**kw)
rows={'/alpha':[item('A · 普通资源','1',tags=['高清']),item('A · 字幕资源','2',tags=['字幕','UHD'],uhd=True),item('A · 去重保留','d',tags=['高清']),item('A · 标签转义','4',tags=['<img src=x onerror=alert(1)>','passkey=fixture-secret','https://fixture.test/?token=secret','长'*80],category='无码高清')],
 '/beta':[item('B · 无码字幕','5',tags=['字幕','无码破解']),item('B · 同标签','6',tags=['字幕','无码破解']),item('B · 去重丢弃','d',tags=['字幕']),item('B · 无标签','8')],
 '/flags':[item('C · 原始属性','9',free=True,chinese=True)]}
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  values=rows.get(urlsplit(self.path).path,[])
  body=json.dumps({'data':values},ensure_ascii=False).encode()
  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',18766),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
env={**os.environ,'DATA_DIR':str(data),'WEB_USERNAME':'preview','WEB_PASSWORD':'preview','BM_BUILD_REVISION':'abcdef0'}
child=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','18765'],env=env)
def stop(*args):child.terminate();server.shutdown()
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
try:child.wait()
finally:server.server_close()
