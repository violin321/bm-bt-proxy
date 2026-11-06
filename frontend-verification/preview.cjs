// Isolated, in-memory UI demo. Never reads production config or calls upstreams.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'app', 'static');
const port = Number(process.env.BM_DEMO_PORT || 8766);
const {fixtureStats} = require('./dashboard-fixtures.cjs');
let settings = {api_key_enabled:false, api_key:'', sources:[
  {id:'avdb',name:'AVDB · 样例',url:'http://avdb.example.test:8000/api/v1/articles/torrents',method:'GET',keyword_field:'keyword',timeout:10,headers:{},enabled:true},
  {id:'xiuxian',name:'修仙 · 样例',url:'http://xiuxian.example.test:6969/api/v1/articles/torrents',method:'GET',keyword_field:'keyword',timeout:10,headers:{},enabled:true}
]};
const server = http.createServer(async (req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const json = (data,status=200) => {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const loggedIn = (req.headers.cookie || '').includes('bm_preview=1');
  let body = ''; for await (const chunk of req) {body += chunk; if (body.length>1000000) return json({detail:'演示请求过大'},413);}
  let data={};try{data=JSON.parse(body || '{}');}catch{return json({detail:'JSON 格式错误'},400);}
  if (pathname === '/api/login') {
    if (data.username !== 'preview' || data.password !== 'preview') return json({detail:'演示账号和密码均为 preview'},400);
    res.setHeader('Set-Cookie','bm_preview=1; HttpOnly; SameSite=Lax; Path=/');return json({status:'ok'});
  }
  if (pathname === '/api/logout') {res.setHeader('Set-Cookie','bm_preview=; Max-Age=0; Path=/');return json({status:'ok'});}
  if (pathname.startsWith('/api/')) {
    if (!loggedIn) return json({detail:'请先登录本地演示'},401);
    if (pathname === '/api/settings') return json(settings);
    if (pathname === '/api/stats') return json(fixtureStats(settings.sources,new URL(req.url,'http://localhost')));
    if (pathname === '/api/detect-name') return json({name:'示例 · 新数据源'});
    if (pathname === '/api/security') {Object.assign(settings,data);return json({status:'ok'});}
    if (pathname === '/api/sources' && req.method==='POST') {const s={...data,id:require('node:crypto').randomUUID()};settings.sources.push(s);return json(s);}
    if (pathname.startsWith('/api/sources/')) {const id=decodeURIComponent(pathname.split('/').pop());if(req.method==='DELETE'){settings.sources=settings.sources.filter(s=>s.id!==id);return json({status:'ok'});}if(req.method==='PUT'){settings.sources=settings.sources.map(s=>s.id===id?{...data,id}:s);return json({...data,id});}}
    if (pathname === '/api/test') {
      const sources=settings.sources.filter(s=>data.source_id==='all'?s.enabled:s.id===data.source_id);
      return json({data:sources.length?[
        {title:'演示资源 · '+data.keyword,site:'本地演示',size_mb:2048,seeders:26,chinese:true,magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40)},
        {title:'演示资源 · 上游没有提供封面',site:'本地演示',size:734003200,seeders:0,download_url:'https://example.test/download/fixture'}
      ]:[],details:sources.map((s,i)=>({id:s.id,name:s.name,success:i!==1,status_code:i!==1?200:503,latency_ms:i!==1?346:1004,count:i!==1?2:0,error:i!==1?null:'演示失败状态：上游暂不可用'})),total_time_ms:1008});
    }
    return json({detail:'演示中未实现此接口'},404);
  }
  if (pathname === '/' && !loggedIn) {res.writeHead(302,{Location:'/login'});return res.end();}
  const files={'/':'index.html','/login':'login.html','/favicon.svg':'favicon.svg','/static/theme.css':'theme.css','/static/dashboard.css':'dashboard.css','/static/console.js':'console.js','/static/login.js':'login.js'};
  const file=files[pathname];if(!file){res.writeHead(404);return res.end();}
  let text=fs.readFileSync(path.join(root,file),'utf8');
  if(file==='index.html') text=text.replace('<div class="app-shell">','<div class="app-shell">').replace('<main id="main" tabindex="-1">','<main id="main" tabindex="-1"><div class="notice" style="background:#fff1dc;color:#734318;border:1px solid #e6d3b1">本地交互演示 · 数据源、结果与耗时均为示例；修改仅保存在演示进程中，不会请求实际源站。</div>');
  if(file==='login.html') text=text.replace('管理连接，从这里继续。','本地演示：账号 preview，密码 preview。');
  res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(text);
});
server.listen(port,'127.0.0.1',()=>console.log('Isolated fixture demo: http://127.0.0.1:'+port));
