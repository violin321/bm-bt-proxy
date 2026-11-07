// Synthetic, credential-free search data against an isolated real console.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.BM_TEST_URL||'http://127.0.0.1:18765';
const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
const metadata=(labels=[],flags={},count=8)=>({count,labels:labels.map(([field,value,count])=>({field,value,count})),flags});
const detail=(name,count,resource_metadata,success=true)=>({name,count,resource_metadata,success,status_code:success?200:503,latency_ms:12});
const sample={data:[{title:'SSIS-586 · 上游标签展示样本',site:'AVDB',tags:['98T'],category:'无码高清',free:true,chinese:true,download_url:'magnet:?xt=urn:btih:'+'a'.repeat(40),size_mb:2048},
 {title:'SSIS-586 · DB Online 标签样本',site:'db_online',tags:['字幕','高清','破解','UHD','LTX'],chinese:true,uc:true,uhd:true,size_mb:4096}],
 details:[detail('AVDB',8,metadata([['tags','98T',1],['category','无码高清',2],['category','无码破解',1]],{free:{true:8,false:0},hd:{true:7,false:1}})),
 detail('修仙',6,metadata([],{free:{true:6,false:0},chinese:{true:2,false:4}},6)),
 detail('DB Online (JavDB)',17,metadata([['tags','高清',13],['tags','字幕',4],['tags','破解',5],['tags','UHD',2],['tags','LTX',1]],{},17)),
 detail('DB Online (Nyaa)',15,metadata([['tags','高清',11],['tags','字幕',4],['tags','破解',1],['tags','UHD',1]],{hd:{true:11,false:4},mosaic:{true:14,false:1}},15)),
 detail('Jackett',2,metadata([['category','XXX',2]],{},2))],total_time_ms:20};
(async()=>{
 const browser=await chromium.launch({headless:false});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 let fixtureId;
 try{
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码',{exact:true}).fill('preview');
  await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  const fixture=await (await page.request.post(BASE+'/api/sources',{data:{name:'Resource tag fixture',url:'http://fixture.example.test',enabled:true}})).json();fixtureId=fixture.id;
  await page.locator('#refreshBtn').click();await page.getByRole('link',{name:'搜索与测试',exact:true}).click();
  let response=sample;
  await page.route('**/api/test',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)}));
  const search=async()=>{await page.locator('#testKeyword').fill('SSIS-586');const pending=page.waitForResponse(r=>r.url().endsWith('/api/test'));await page.locator('#testSearchBtn').click();await pending;await page.locator('#testSearchBtn:not([disabled])').waitFor();};
  await search();await page.locator('#sourceTagInventory .source-tag-row').nth(4).waitFor();
  assert.equal(await page.locator('#sourceTagInventory .source-tag-row').count(),5);
  const db=page.locator('.source-tag-row').filter({has:page.getByText('DB Online (JavDB)',{exact:true})});
  assert((await db.textContent()).includes('17 条 · 去重前'));
  assert((await db.textContent()).includes('标签 · 字幕 4'));
  assert((await page.locator('#sourceTagInventory').textContent()).includes('分类 · XXX 2'));
  assert.equal(await page.locator('.result').count(),2);
  pass('all five upstream label inventories remain visible before aggregation deduplication');
  assert((await page.locator('.source-tag-row').nth(1).textContent()).includes('本次未提供文字标签或分类'));
  await page.locator('.source-tag-row').nth(1).getByText('查看原始属性字段',{exact:true}).click();
  await page.locator('.source-tag-row').nth(1).getByText('chinese: true 2 / false 4',{exact:true}).waitFor();
  assert((await page.locator('.result').nth(1).textContent()).includes('标签 · 字幕'));
  await page.locator('.result-attributes summary').click();await page.locator('#resultTags').getByText('中文字幕 2',{exact:true}).waitFor();
  pass('original labels, exact boolean fields and aggregate sorting attributes are separate');
  response={data:[{title:'Escaping fixture',tags:['<img src=x onerror=alert(1)>','https://private/?token=secret','passkey=secret','长'.repeat(80)]}],details:[detail('Bounded labels',1,metadata([['tags','长'.repeat(80),1]],{},1))],total_time_ms:1};
  await search();await page.getByRole('heading',{name:'Escaping fixture',exact:true}).waitFor();
  assert.equal(await page.locator('.result-upstream-labels img').count(),0);
  assert(!(await page.locator('.result-upstream-labels').textContent()).includes('secret'));
  for(const width of [1440,768,390,360]){
   await page.setViewportSize({width,height:1000});
   const dimensions=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(dimensions.s<=dimensions.w+1,JSON.stringify(dimensions));
  }
  pass('untrusted tag text stays inert; URL-bearing values are excluded and 80-character labels wrap at four widths');
  response={data:[],details:[detail('Empty source',0,metadata([],{},0)),detail('Failed source',0,metadata([],{},0),false)],total_time_ms:1};
  await search();await page.getByText('本次没有返回资源，无法判断标签。',{exact:true}).waitFor();
  await page.getByText('查询失败，无法判断该源的标签。',{exact:true}).waitFor();
  pass('empty and failed sources do not claim that their complete tag catalogs are known');
  response=sample;await search();await page.locator('#sourceTagInventory .source-tag-row').nth(4).waitFor();
  fs.mkdirSync(path.join(__dirname,'screenshots'),{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   await page.screenshot({path:path.join(__dirname,'screenshots',`resource-tags-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.getByRole('link',{name:'设置',exact:true}).click();await page.getByRole('heading',{name:'排序属性与返回顺序',exact:true}).waitFor();
  assert((await page.locator('#preferencesForm').textContent()).includes('上游返回的标签'));
  const config=await (await page.request.get(BASE+'/api/settings')).json();assert.deepEqual(config.result_preferences,[]);
  pass('settings point to actual upstream labels and sorting preferences remain off');
  assert.deepEqual(errors,[]);pass('zero uncaught browser exceptions');
 }finally{
  if(fixtureId)await page.request.delete(BASE+'/api/sources/'+fixtureId);
  await browser.close();fs.writeFileSync(path.join(__dirname,'resource-tags-results.json'),JSON.stringify({checks,errors,syntheticSearch:true,localOnly:true},null,2)+'\n');
 }
})().catch(error=>{console.error(error);process.exit(1);});
