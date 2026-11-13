// Real Edge UI against isolated HTTP preview, with controlled directory responses.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.BM_TEST_URL||'http://127.0.0.1:18765';
const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:false});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 let catalogReads=0,refreshRequests=[],pollReads=0,syncPending=false,failRead=false,capturedSources=[];
 const sourceOverrides=new Map();
 const directory={provider:'jackett_caps',status:'ready',coverage:'declared_categories',fetched_at:'2026-11-07T05:00:00+00:00',last_attempt_at:'2026-11-07T05:00:00+00:00',error:null,count:1000,limited:false,stale:false,origin:'upstream'};
 const labels=Array.from({length:1000},(_,i)=>({field:'category_ids',value:String(2000+i),display_name:i===45?'Movies/UHD':i===999?'末尾可检索分类':`分类 ${i}`,origin:i===45?'both':'directory',catalog_count:null,count:i===45?2:0,first_seen:i===45?'2026-11-07T05:00:00+00:00':null,last_seen:i===45?'2026-11-07T05:00:00+00:00':null}));
 const sources=[{id:'alpha',name:'Jackett · 目录验证',enabled:true,last_query_at:'2026-11-07T05:00:00+00:00',labels,labels_limited:false,kind:'combined',directory},
  {id:'beta',name:'DB Online · 验证样本',enabled:true,last_query_at:'2026-11-07T05:00:00+00:00',labels:[{field:'tags',value:'字幕',origin:'both',count:3,catalog_count:31,first_seen:'2026-11-07T05:00:00+00:00',last_seen:'2026-11-07T05:00:00+00:00'},{field:'category',value:'无码破解',origin:'directory',count:0,catalog_count:29,first_seen:null,last_seen:null}],labels_limited:false,kind:'combined',directory:{...directory,provider:'article_categories',status:'unauthorized',coverage:'current_database',count:2,stale:true,origin:'snapshot',error:'目录需要登录权限'}},
  {id:'flags',name:'修仙 · 布尔属性样本',enabled:true,last_query_at:null,labels:[],labels_limited:false,kind:'observed',directory:{...directory,provider:'none',status:'unsupported',coverage:'observed_only',fetched_at:null,last_attempt_at:null,count:0,origin:null}}];
 const settingsRoute=async route=>{const data=await(await route.fetch()).json();data.sources=data.sources.map(s=>({...s,name:s.id==='alpha'?'Jackett · 目录验证':s.name,catalog_mode:'auto',has_catalog_headers:s.id==='alpha',...sourceOverrides.get(s.id)}));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});};
 await page.route('**/api/settings',settingsRoute);
 await page.route('**/api/resource-labels',async route=>{
  catalogReads++;
  if(failRead)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'模拟目录缓存不可读'})});
  if(syncPending&&++pollReads>=3)syncPending=false;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sources,refreshing:syncPending,retention_days:90,max_labels_per_source:200,write_error:false})});
 });
 await page.route('**/api/resource-labels/refresh',async route=>{refreshRequests.push(route.request().postDataJSON());syncPending=true;pollReads=0;await route.fulfill({status:202,contentType:'application/json',body:'{"refreshing":true}'});});
 const access=async()=>{await page.getByRole('link',{name:'设置',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();};
 const saveRules=async()=>{await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await page.locator('#savePreferencesBtn:not([disabled])').waitFor();};
 const openSource=async()=>{await page.locator('a[data-route="sources"]').click();await page.getByRole('button',{name:'编辑 Jackett · 目录验证',exact:true}).click();await page.locator('#sourceDialog[open]').waitFor();};
 try{
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码',{exact:true}).fill('preview');await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  assert((await page.request.post(BASE+'/api/result-preferences',{data:{result_preferences:[]}})).ok());
  await page.locator('#refreshBtn').click();await page.locator('#refreshBtn:not([disabled])').waitFor();await access();
  assert((await page.locator('#labelCatalog').textContent()).includes('站点声明支持的分类'));
  assert((await page.locator('#labelCatalog').textContent()).includes('当前源数据库中的分类'));
  assert((await page.locator('[data-catalog-source="beta"]').textContent()).includes('请在源设置中填写“目录认证请求头”'));
  assert((await page.locator('[data-catalog-source="beta"]').textContent()).includes('已保留上次目录'));
  assert.equal(await page.locator('[data-label-origin="both"]').count(),1);
  assert.equal(await page.locator('[data-label-origin="observed"]').count(),0);
  const readsBefore=catalogReads;await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
  assert(catalogReads>readsBefore);assert.equal(refreshRequests.length,0);
  pass('directory coverage, provenance, 401 retained snapshot and cache-only refresh are explicit');
  await page.locator('#labelCatalogSource').selectOption('alpha');
  assert.equal(await page.locator('.catalog-tag').count(),12);
  for(let i=0;i<10;i++){await page.getByRole('button',{name:/^再显示 /}).click();}
  assert.equal(await page.locator('.catalog-tag').count(),1000);await page.getByRole('button',{name:'收起标签',exact:true}).click();assert.equal(await page.locator('.catalog-tag').count(),12);
  await page.locator('#labelCatalogFilter').fill('末尾可检索');assert.equal(await page.locator('.catalog-tag').count(),1);assert((await page.locator('.catalog-tag').textContent()).includes('ID 2999'));
  await page.locator('#labelCatalogFilter').fill('Movies/UHD');await page.getByRole('button',{name:'将 Jackett · 目录验证 的 category_ids 标签 Movies/UHD · ID 2045 加入排序',exact:true}).click();
  assert.equal(await page.locator('#sortLabelField').inputValue(),'category_ids');
  assert((await page.locator('.preference-rule').first().textContent()).includes('Movies/UHD · ID 2045'));
  await saveRules();
  const saved=(await(await page.request.get(BASE+'/api/settings')).json()).result_preferences;
  assert.deepEqual(saved,[{type:'label',value:'2045',field:'category_ids',source_id:'alpha',direction:'prefer'}]);
  await page.reload();await page.getByLabel('“Movies/UHD · ID 2045”偏好',{exact:true}).waitFor();
  pass('all 1000 directory entries can be paged and searched; friendly category captions save exact numeric IDs');
  await page.locator('.label-rule-builder summary').click();await page.locator('#sortLabelField').selectOption('category_ids');await page.locator('#sortLabelValue').fill('Movies/UHD');await page.getByRole('button',{name:'添加到排序队列',exact:true}).click();
  assert((await page.locator('#labelRuleStatus').textContent()).includes('数字 ID'));
  for(const invalid of ['0','02045','2147483648']){await page.locator('#sortLabelValue').fill(invalid);await page.getByRole('button',{name:'添加到排序队列',exact:true}).click();assert((await page.locator('#labelRuleStatus').textContent()).includes('有效的数字 ID'));assert.equal(await page.locator('.preference-rule').count(),5);}
  await page.locator('#labelCatalogSource').selectOption('alpha');await page.getByRole('button',{name:'同步源目录',exact:true}).click();
  await page.getByRole('button',{name:'正在同步目录…',exact:true}).waitFor();assert(await page.locator('#syncLabelDirectoryBtn').isDisabled());
  await page.getByRole('button',{name:'同步源目录',exact:true}).waitFor();assert.deepEqual(refreshRequests,[{source_id:'alpha'}]);assert(pollReads>=3);
  await page.locator('#labelCatalogSource').selectOption('*');await page.getByRole('button',{name:'同步源目录',exact:true}).click();await page.getByRole('button',{name:'同步源目录',exact:true}).waitFor();
  assert.deepEqual(refreshRequests[1],{source_id:'all'});
  pass('manual ID rules reject names and directory synchronization polls to completion for one or all sources');
  await page.route('**/api/sources/alpha',async route=>{const data=route.request().postDataJSON();capturedSources.push(data);sourceOverrides.set('alpha',{catalog_mode:data.catalog_mode,has_catalog_headers:Object.hasOwn(data,'catalog_headers')?Object.keys(data.catalog_headers).length>0:true});await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'alpha',...data,catalog_headers:undefined,has_catalog_headers:sourceOverrides.get('alpha').has_catalog_headers})});});
  await openSource();assert.equal(await page.locator('#formCatalogHeaders').inputValue(),'');assert((await page.locator('#catalogHeadersHint').textContent()).includes('已保存目录认证'));
  await page.getByRole('button',{name:'保存数据源',exact:true}).click();await page.locator('#sourceDialog').waitFor({state:'hidden'});assert(!Object.hasOwn(capturedSources.at(-1),'catalog_headers'));
  await openSource();await page.locator('#formCatalogAuth').selectOption('headers');await page.locator('#formCatalogHeaders').fill('{"Cookie": 123}');await page.getByRole('button',{name:'保存数据源',exact:true}).click();assert((await page.locator('#sourceError').textContent()).includes('字符串值的 JSON 对象'));assert.equal(capturedSources.length,1);
  await page.locator('#formCatalogHeaders').fill('{"Cookie":"fixture-directory-auth"}');await page.getByRole('button',{name:'保存数据源',exact:true}).click();await page.locator('#sourceDialog').waitFor({state:'hidden'});assert.deepEqual(capturedSources.at(-1).catalog_headers,{Cookie:'fixture-directory-auth'});
  await openSource();assert.equal(await page.locator('#formCatalogHeaders').inputValue(),'');await page.locator('#clearCatalogHeaders').check();assert(await page.locator('#formCatalogHeaders').isDisabled());await page.getByRole('button',{name:'保存数据源',exact:true}).click();await page.locator('#sourceDialog').waitFor({state:'hidden'});assert.deepEqual(capturedSources.at(-1).catalog_headers,{});
  await openSource();await page.locator('#formCatalogMode').selectOption('disabled');assert(await page.locator('#catalogAuthFields').isHidden());await page.getByRole('button',{name:'保存数据源',exact:true}).click();await page.locator('#sourceDialog').waitFor({state:'hidden'});assert.equal(capturedSources.at(-1).catalog_mode,'disabled');
  pass('catalog authentication stays write-only, blank edits preserve it, validation and explicit clear/disable work');
  sourceOverrides.set('alpha',{catalog_mode:'auto',has_catalog_headers:false});await page.locator('#refreshBtn').click();await page.locator('#refreshBtn:not([disabled])').waitFor();
  await access();failRead=true;await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.getByText(/读取失败：模拟目录缓存不可读/).waitFor();assert.equal(await page.locator('.catalog-source').count(),3);failRead=false;
  await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
  sources[2].directory.status='disabled';await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();assert((await page.locator('[data-catalog-source="flags"]').textContent()).includes('已关闭目录同步'));
  pass('catalog read failures preserve the last snapshot; disabled directory state is distinct');
  await page.route('**/api/test',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{title:'分类 ID 数组验证',category_ids:[2045],download_url:'magnet:?xt=urn:btih:'+'e'.repeat(40)}],details:[],total_time_ms:1,provenance:[{source_id:'alpha',source_name:'Jackett · 目录验证',priority:100,rule_matches:[true]}],merge:{preferences:[{type:'label',value:'2045',field:'category_ids',source_id:'alpha',direction:'prefer'}],duplicates:[]}})}));
  await page.getByRole('link',{name:'搜索与测试',exact:true}).click();await page.locator('#testKeyword').fill('category-contract');await page.locator('#testSearchBtn').click();await page.getByText('分类 ID 数组验证',{exact:true}).waitFor();
  assert((await page.locator('.result-upstream-labels').textContent()).includes('分类 ID · 2045'));await page.locator('.result-sort-reasons summary').click();assert((await page.locator('.result-sort-reasons').textContent()).includes('Movies/UHD · ID 2045'));
  pass('numeric upstream category arrays and friendly ID rule explanations display without changing IDs');
  await access();
  await page.locator('#labelCatalogSource').selectOption('alpha');await page.locator('#labelCatalogFilter').fill('Movies/UHD');
  for(const width of [1440,768,390,360]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);if(width===1440||width===390){fs.mkdirSync(path.join(__dirname,'screenshots'),{recursive:true});await page.locator('.label-catalog-section').screenshot({path:path.join(__dirname,'screenshots',`directory-catalog-${width}.png`),animations:'disabled'});}}
  await openSource();for(const width of [390,360]){await page.setViewportSize({width,height:1100});assert(await page.locator('#sourceDialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),`drawer overflow ${width}`);}await page.getByRole('button',{name:'关闭源配置',exact:true}).click();
  assert.deepEqual(errors,[]);pass('directory and authentication UI fit 1440/768/390/360px with zero uncaught Edge exceptions');
 }finally{await page.request.post(BASE+'/api/result-preferences',{data:{result_preferences:[]}});await browser.close();fs.writeFileSync(path.join(__dirname,'directory-catalog-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:'Microsoft Edge',checks,errors,isolated:true,controlledDirectoryResponses:true,physicalPhone:false},null,2)+'\n');}
})().catch(e=>{console.error(e.stack);process.exit(1);});
