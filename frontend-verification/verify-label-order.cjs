// Real Edge UI and HTTP providers, using an isolated preview dataset.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.BM_TEST_URL||'http://127.0.0.1:18765';
const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:false});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 const post=async(url,data)=>{const r=await page.request.post(BASE+url,{data});assert(r.ok(),`${url} HTTP ${r.status()}`);return r.json();};
 const catalog=async()=>{const r=await page.request.get(BASE+'/api/resource-labels');assert(r.ok());return r.json();};
 const access=async()=>{await page.getByRole('link',{name:'设置',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();};
 const search=async()=>{await page.getByRole('link',{name:'搜索与测试',exact:true}).click();await page.locator('#testKeyword').fill('label-contract');const pending=page.waitForResponse(r=>r.url().endsWith('/api/test'));await page.locator('#testSearchBtn').click();const r=await (await pending).json();await page.locator('#testSearchBtn:not([disabled])').waitFor();return r;};
 const add=async(value,source='*',field='*',direction='prefer')=>{await page.locator('#sortLabelSource').selectOption(source);await page.locator('#sortLabelField').selectOption(field);await page.locator('#sortLabelDirection').selectOption(direction);await page.locator('#sortLabelValue').fill(value);await page.getByRole('button',{name:'添加到排序队列',exact:true}).click();};
 try{
  assert.equal((await page.request.get(BASE+'/api/resource-labels')).status(),401);
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码',{exact:true}).fill('preview');await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  await post('/api/result-preferences',{result_preferences:[]});await page.locator('#refreshBtn').click();await access();
  const before=await catalog();assert.equal(before.sources.length,3);
  const response=await search();assert.equal(response.details.length,3);assert(response.details.every(d=>d.success));assert.equal(response.data.length,8);
  const cache=await catalog();assert(cache.sources.every(s=>s.last_query_at));
  assert(cache.sources.find(s=>s.id==='beta').labels.some(l=>l.value==='字幕'&&l.count>=3));
  assert(!JSON.stringify(cache).includes('fixture-secret'));assert(!JSON.stringify(cache).includes('magnet:'));
  pass('authenticated persistent catalog accumulates pre-dedup upstream tags without credential-bearing values');
  await access();await page.getByRole('heading',{name:'已发现的资源标签',exact:true}).waitFor();
  await page.locator('#labelCatalogFilter').fill('字幕');assert.equal(await page.locator('.catalog-source').count(),2);
  await page.locator('#labelCatalogSource').selectOption('beta');assert.equal(await page.locator('.catalog-source').count(),1);
  await page.getByRole('button',{name:'将 DB Online · 验证样本 的 tags 标签 字幕 加入排序',exact:true}).click();
  assert((await page.locator('.preference-rule').first().textContent()).includes('DB Online · 验证样本 · tags'));
  await page.getByLabel('“字幕”偏好',{exact:true}).selectOption('');
  await page.locator('#labelCatalogFilter').fill('');await page.locator('#labelCatalogSource').selectOption('*');
  assert((await page.locator('#labelCatalog').textContent()).includes('尚未发现文字标签'));
  pass('source filtering, tag search, per-source rule shortcut and no-text-label states work');
  await add('字幕');await add('无码破解');await page.getByLabel('UHD / 4K偏好',{exact:true}).selectOption('defer');
  await page.getByRole('button',{name:'上移UHD / 4K',exact:true}).click();
  assert((await page.locator('.preference-rule').nth(1).textContent()).includes('UHD / 4K'));
  await page.getByRole('button',{name:'下移UHD / 4K',exact:true}).click();
  await add('字幕','*','*','defer');assert((await page.locator('#labelRuleStatus').textContent()).includes('已有规则'));
  await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await page.getByText('返回顺序已保存，下次查询生效。可到搜索与测试中查看每条结果的排序依据。',{exact:true}).waitFor();
  const rules=[{type:'label',value:'字幕',field:'*',source_id:'*',direction:'prefer'},{type:'label',value:'无码破解',field:'*',source_id:'*',direction:'prefer'},'!uhd'];
  assert.deepEqual((await (await page.request.get(BASE+'/api/settings')).json()).result_preferences,rules);
  await page.reload();await page.getByLabel('“字幕”偏好',{exact:true}).waitFor();assert.equal(await page.getByLabel('UHD / 4K偏好',{exact:true}).inputValue(),'defer');
  const repeated=await catalog();assert.deepEqual(repeated.sources.map(s=>s.labels),cache.sources.map(s=>s.labels));
  pass('mixed label and flag rules reorder, reject duplicates, persist and survive a page reload');
  await add('LTX');
  let releaseSettings,settingsCaptured;
  const settingsGate=new Promise(resolve=>{releaseSettings=resolve;});
  const settingsReady=new Promise(resolve=>{settingsCaptured=resolve;});
  await page.route('**/api/settings',async route=>{const old=await (await route.fetch()).json();settingsCaptured();await settingsGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(old)});});
  await page.locator('#refreshBtn').click();await settingsReady;
  const savedDuringLoad=page.waitForResponse(r=>r.url().endsWith('/api/result-preferences'));
  await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await savedDuringLoad;await page.locator('#savePreferencesBtn:not(:disabled)').waitFor();
  releaseSettings();await page.locator('#refreshBtn:not([disabled])').waitFor();await page.unroute('**/api/settings');
  await page.getByLabel('“LTX”偏好',{exact:true}).waitFor();
  await page.getByLabel('“LTX”偏好',{exact:true}).selectOption('');
  await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await page.locator('#savePreferencesBtn:not(:disabled)').waitFor();
  pass('a delayed settings read cannot overwrite sorting rules saved while it was in flight');
  const sorted=await search();assert.deepEqual(sorted.data.slice(0,3).map(i=>i.title),['B · 无码字幕','B · 同标签','A · 字幕资源']);
  assert(sorted.data.some(i=>i.title==='A · 去重保留'));assert(!sorted.data.some(i=>i.title==='B · 去重丢弃'));assert(sorted.data.some(i=>i.title==='B · 无标签'));
  await page.locator('.result-sort-reasons summary').first().click();
  assert((await page.locator('.result-sort-reasons').first().textContent()).includes('字幕”优先'));
  assert.equal(await page.locator('.result-sort-reasons').first().getByText('命中',{exact:true}).count(),2);
  await page.locator('#mergeExplanation summary').click();assert(!(await page.locator('#mergeExplanation').textContent()).includes('[object Object]'));
  assert.equal(await page.locator('.result-upstream-labels img').count(),0);
  const publicResponse=await (await page.request.get(BASE+'/api/torrents?keyword=label-contract')).json();assert.deepEqual(Object.keys(publicResponse),['data']);
  pass('actual provider results honor mixed priorities, retain dedup winner and untagged items, and explain rule matches');
  await access();
  await page.route('**/api/resource-labels',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'模拟缓存不可读'})}));
  await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.getByText(/读取失败：模拟缓存不可读/).waitFor();assert.equal(await page.locator('.catalog-source').count(),3);
  await page.unroute('**/api/resource-labels');await page.getByRole('button',{name:'刷新列表',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
  pass('catalog read failure is explicit, keeps the last snapshot and recovers on retry');
  await add('长'.repeat(80));
  for(const width of [1440,768,390,360]){
   await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`settings overflow at ${width}`);
   if(width===1440||width===390){fs.mkdirSync(path.join(__dirname,'screenshots'),{recursive:true});await page.locator('.label-catalog-section').screenshot({path:path.join(__dirname,'screenshots',`label-catalog-${width}.png`),animations:'disabled'});await page.locator('#preferencesForm').screenshot({path:path.join(__dirname,'screenshots',`label-order-${width}.png`),animations:'disabled'});}
  }
  pass('catalog and long-label sorting rules fit at 1440, 768, 390 and 360 pixels');
  await post('/api/result-preferences',{result_preferences:rules});
  await page.reload();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
  await page.getByRole('button',{name:'关闭所有排序偏好',exact:true}).click();await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();
  await page.getByText('返回顺序已保存，下次查询生效。可到搜索与测试中查看每条结果的排序依据。',{exact:true}).waitFor();
  assert.deepEqual((await (await page.request.get(BASE+'/api/settings')).json()).result_preferences,[]);
  assert.deepEqual(errors,[]);pass('all sorting rules can be disabled; zero uncaught Edge exceptions');
 }finally{
  await browser.close();fs.writeFileSync(path.join(__dirname,'label-order-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:'Microsoft Edge',checks,errors,isolated:true,realHttpProviders:true,physicalPhone:false},null,2)+'\n');
 }
})().catch(error=>{console.error(error.stack);process.exit(1);});
