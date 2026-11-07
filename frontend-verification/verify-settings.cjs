// Local real app; management state is restored after the checks.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const BASE='http://127.0.0.1:18765';const checks=[],errors=[];const passed=name=>{checks.push(name);console.log('PASS',name);};
(async()=>{
 const browser=await chromium.launch({headless:false});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let before,fixtureId;
 try {
  assert.equal((await page.request.get(BASE+'/api/version')).status(),401);
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码',{exact:true}).fill('preview');await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  before=await (await page.request.get(BASE+'/api/settings')).json();
  await page.locator('#headerVersion').getByText('v1.5.1',{exact:true}).waitFor();
  await page.locator('#headerVersion').click();await page.getByRole('heading',{name:'版本信息',exact:true}).waitFor();
  assert.equal(await page.locator('#runningVersion').textContent(),'v1.5.1');assert.equal(await page.locator('#buildRevision').textContent(),'abcdef1');
  passed('authenticated runtime version, header shortcut and build revision');
  await page.route('**/api/version',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'模拟版本读取失败'})}));
  await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.locator('#runningVersion').getByText('读取失败',{exact:true}).waitFor();
  await page.unroute('**/api/version');await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.locator('#runningVersion').getByText('v1.5.1',{exact:true}).waitFor();
  passed('version failure is explicit and retry recovers');
  assert.equal(await page.getByRole('link',{name:'设置',exact:true}).count(),1);
  await page.getByRole('heading',{name:'BM-BT 聚合规则',exact:true}).waitFor();
  assert.equal(await page.locator('.preference-rule').count(),4);assert((await page.locator('#preferencesForm').textContent()).includes('公共站点不等于免流'));
  passed('settings separate Byte-Muse connection from BM-BT rules and describe four resource tags');
  const key='fixture-$COMPOSE-"quoted"-key';
  await page.request.post(BASE+'/api/security',{data:{api_key_enabled:true,api_key:key}});await page.locator('#refreshBtn').click();await page.locator('#authBadge').getByText('API Key 已开启',{exact:true}).waitFor();
  await page.getByLabel('Byte-Muse 如何访问 BM-BT').selectOption('docker');
  assert(!(await page.locator('#consumerCompose').textContent()).includes(key));
  await page.getByRole('button',{name:'复制 Compose 配置',exact:true}).click();
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  const env=Object.fromEntries(text.split('\n').map(line=>{const at=line.indexOf(':');return [line.slice(0,at),JSON.parse(line.slice(at+1).trim()).replace(/\$\$/g,'$')];}));
  assert.equal(env.BT_URL,'http://bm-bt-proxy:8000/api/torrents');assert.equal(env.BT_METHOD,'get');assert.equal(env.BT_JSON_DATA,'');assert.deepEqual(JSON.parse(env.BT_HEADER),{'X-API-Key':key});
  await page.getByText('复制兼容令牌参数的接入地址',{exact:true}).click();await page.getByRole('button',{name:'复制接入地址'}).click();
  const url=new URL(await page.evaluate(()=>navigator.clipboard.readText()));assert.equal(url.searchParams.get('token'),key);assert.equal(url.searchParams.get('keyword'),'');
  passed('Compose clipboard preserves special credentials and Docker interpolation; secrets stay masked');
  await page.getByLabel('BM-BT 服务地址',{exact:true}).fill('https://proxy.example.test/prefix');
  assert((await page.locator('#consumerCompose').textContent()).includes('https://proxy.example.test/prefix/api/torrents'));
  await page.getByLabel('BM-BT 服务地址',{exact:true}).fill('javascript:alert(1)');assert(await page.locator('#copyCompose').isDisabled());await page.locator('#consumerError:not([hidden])').waitFor();
  await page.getByLabel('BM-BT 服务地址',{exact:true}).fill('http://127.0.0.1:18765');assert(!(await page.locator('#copyCompose').isDisabled()));
  passed('custom base paths are retained and invalid service URLs block copying');
  const fixture=await (await page.request.post(BASE+'/api/sources',{data:{name:'Settings test fixture',url:'http://fixture.example.test/api',enabled:true}})).json();fixtureId=fixture.id;
  await page.locator('#refreshBtn').click();await page.locator('#sourcesList').getByRole('heading',{name:'Settings test fixture',exact:true,includeHidden:true}).waitFor({state:'attached'});
  await page.getByRole('link',{name:'搜索与测试',exact:true}).click();
  await page.route('**/api/test',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{title:'Tagged fixture',free:true,chinese:true,uc:true,uhd:true,download_url:'magnet:?xt=urn:btih:'+'a'.repeat(40)},{title:'Unmarked fixture',uc:'false',chinese:false}],details:[],total_time_ms:1})}));
  await page.locator('#testKeyword').fill('fixture');await page.locator('#testSearchBtn').click();await page.locator('#resultTags').getByText('免流 1',{exact:true}).waitFor();
  for(const name of ['中文字幕 1','UC / 无码 1','UHD / 4K 1']) await page.locator('#resultTags').getByText(name,{exact:true}).waitFor();
  assert((await page.locator('.result').first().textContent()).includes('免流'));
  assert(!(await page.locator('.result').nth(1).textContent()).includes('UC / 无码'));
  await page.unroute('**/api/test');passed('result tag counts include freeleech and match explicit boolean flags');
  fs.mkdirSync(path.join(__dirname,'screenshots'),{recursive:true});
  for(const width of [1440,768,390,360]){
   await page.setViewportSize({width,height:1000});await page.getByRole('link',{name:'设置',exact:true}).click();
   const dim=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(dim.s<=dim.w+1,JSON.stringify(dim));
   await page.screenshot({path:path.join(__dirname,'screenshots',`settings-${width}.png`),fullPage:true,animations:'disabled'});
  }
  passed('settings and version fit 1440/768/390/360px without page overflow');
  assert.deepEqual(errors,[]);passed('zero uncaught browser exceptions');
 }finally{
  if(fixtureId)await page.request.delete(BASE+'/api/sources/'+fixtureId);
  if(before)await page.request.post(BASE+'/api/security',{data:{api_key_enabled:before.api_key_enabled,api_key:before.api_key}});
  await browser.close();fs.writeFileSync(path.join(__dirname,'settings-results.json'),JSON.stringify({checks,errors,localOnly:true,syntheticSearch:true},null,2)+'\n');
 }
})().catch(e=>{console.error(e);process.exit(1);});
