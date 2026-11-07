"""Synthetic localhost-only Jackett used by the browser acceptance test."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if '/torznab/api' in self.path:
            body=b'<indexers><indexer id="knaben" configured="true"><title>Fixture Knaben</title></indexer><indexer id="failed" configured="true"><title>Fixture failed</title></indexer></indexers>'
            content='application/xml'
        else:
            body=json.dumps({'Results':[
                {'Title':'Fixture Jackett UC', 'MagnetUri':'magnet:?xt=urn:btih:'+'a'*40,'Size':1073741824,'Seeders':12,'Tracker':'Fixture Knaben'},
                {'Title':'Fixture torrent only','Link':'http://internal/?apikey=fixture-secret'}],
                'Indexers':[{'ID':'knaben','Name':'Fixture Knaben','Status':2,'Results':1},
                            {'ID':'failed','Name':'Fixture failed','Status':1,'Error':'private credential URL'}]}).encode()
            content='application/json'
        self.send_response(200);self.send_header('Content-Type',content);self.end_headers();self.wfile.write(body)
    def log_message(self, *_):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1',18766),Fixture).serve_forever()
