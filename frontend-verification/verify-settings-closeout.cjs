// Synthetic HTTP source + real app. Never use a production data directory.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.BM_CLOSEOUT_URL||'http://127.0.0.1:18775';
const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:false});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.getByRole('link',{name:'数据源',exact:false}).first().click();await page.getByRole('button',{name:'编辑 AVDB · 演示源',exact:true}).click();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/sources/alpha')&&r.request().method()==='PUT');await page.getByRole('button',{name:'保存数据源',exact:true}).click();await response;await page.locator('#saveSourceBtn:not([disabled])').waitFor({state:'attached'});};
 const access=async()=>{await page.getByRole('link',{name:'设置',exact:true}).click();await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();};
 const shots=path.join(__dirname,'screenshots','closeout');fs.mkdirSync(shots,{recursive:true});
 try{
  assert.equal((await page.request.get(BASE+'/api/settings')).status(),401);
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码',{exact:true}).fill('preview');await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  await page.request.put(BASE+'/api/sources/alpha',{data:{catalog_headers:{}}});await page.request.post(BASE+'/api/result-preferences',{data:{result_preferences:[]}});await page.reload();
  await open();await page.getByLabel('目录登录方式').selectOption('account');
  await page.getByLabel('源站账号',{exact:true}).fill('otp-user');await page.getByLabel('源站密码',{exact:true}).fill('wrong');await save();
  assert((await page.locator('#sourceError').textContent()).includes('登录失败'),JSON.stringify(await page.locator('#sourceForm').evaluate(n=>({error:document.getElementById('sourceError').textContent,invalid:[...n.querySelectorAll(':invalid')].map(x=>({id:x.id,message:x.validationMessage}))}))));
  assert.equal((await(await page.request.get(BASE+'/api/settings')).json()).sources[0].has_catalog_headers,false);
  await page.getByLabel('源站密码',{exact:true}).fill('preview-source');await save();assert((await page.locator('#sourceError').textContent()).includes('二次验证'));
  await page.getByLabel('二次验证码（如已开启）').fill('123456');await save();await page.locator('#sourceDialog').waitFor({state:'hidden'});
  const settings=await(await page.request.get(BASE+'/api/settings')).json();assert.equal(settings.sources[0].has_catalog_headers,true);assert(!JSON.stringify(settings).includes('fixture-directory-session'));
  await open();assert.equal(await page.getByLabel('源站密码',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('源站账号',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('目录登录方式').inputValue(),'keep');await save();await page.locator('#sourceDialog').waitFor({state:'hidden'});
  assert.equal((await(await page.request.get(BASE+'/api/settings')).json()).sources[0].has_catalog_headers,true);
  pass('account login validates permissions, supports OTP, preserves old state on failure and returns no credentials');
  await access();await page.getByRole('heading',{name:'搜索结果排序',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'标签与返回顺序',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'分类与标签目录',exact:true}).count(),0);
  assert(await page.locator('.preference-section #preferencesForm').count());assert(await page.locator('.preference-section #labelCatalog').count());
  assert.equal(await page.getByRole('button',{name:'保存返回顺序',exact:true}).count(),1);
  await page.getByRole('button',{name:'同步源目录',exact:true}).click();await page.getByRole('button',{name:'同步源目录',exact:true}).waitFor();
  await page.getByRole('button',{name:'将 AVDB · 演示源 的 category 标签 演示分类 加入排序',exact:true}).click();assert((await page.locator('#preferencesBadge').textContent()).includes('未保存'));
  assert.deepEqual((await(await page.request.get(BASE+'/api/settings')).json()).result_preferences,[]);
  await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await page.locator('#savePreferencesBtn:not([disabled])').waitFor();
  assert.deepEqual((await(await page.request.get(BASE+'/api/settings')).json()).result_preferences,[{type:'label',value:'演示分类',field:'category',source_id:'alpha',direction:'prefer'}]);
  await page.reload();await page.getByLabel('“演示分类”偏好',{exact:true}).waitFor();
  await page.getByText('手动添加规则（高级）',{exact:true}).click();await page.locator('#sortLabelValue').fill('字幕');await page.getByRole('button',{name:'添加到排序队列',exact:true}).click();await page.getByRole('button',{name:'保存返回顺序',exact:true}).click();await page.locator('#savePreferencesBtn:not([disabled])').waitFor();
  pass('one sorting section owns candidate selection, draft, advanced rules and a single save action');
  await page.locator('.label-rule-builder').evaluate(n=>n.open=false);
  for(const width of [1440,768,390,360]){
   await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`settings overflow ${width}`);
   if(width===1440||width===390)await page.locator('.preference-section').screenshot({path:path.join(shots,`sorting-${width}.png`),animations:'disabled'});
  }
  await open();await page.getByLabel('目录登录方式').selectOption('account');
  for(const width of [1440,390,360]){await page.setViewportSize({width,height:1100});assert(await page.locator('#sourceDialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),`drawer overflow ${width}`);if(width!==360){await page.locator('#catalogAccountFields').scrollIntoViewIfNeeded();await page.locator('#sourceDialog').screenshot({path:path.join(shots,`directory-login-${width}.png`)});}}
  await page.getByLabel('源站密码',{exact:true}).fill('preview-source');await page.getByRole('button',{name:'关闭源配置',exact:true}).click();await page.waitForFunction(()=>document.getElementById('formCatalogPassword').value==='');
  await open();await page.getByLabel('目录登录方式').selectOption('headers');await page.locator('#formCatalogHeaders').fill('{"Cookie":123}');await page.getByRole('button',{name:'保存数据源',exact:true}).click();assert((await page.locator('#sourceError').textContent()).includes('字符串值'));
  await page.locator('#formCatalogHeaders').fill('');await page.locator('#clearCatalogHeaders').check();await save();await page.locator('#sourceDialog').waitFor({state:'hidden'});assert.equal((await(await page.request.get(BASE+'/api/settings')).json()).sources[0].has_catalog_headers,false);
  pass('advanced headers, explicit clear and credential cleanup work at desktop and mobile widths');
  await page.getByRole('link',{name:'搜索与测试',exact:true}).click();await page.locator('#testKeyword').fill('演示查询');await page.locator('#testSearchBtn').click();await page.getByText('演示资源 · 中文字幕',{exact:true}).waitFor();
  await page.getByRole('link',{name:'运行概览',exact:true}).click();await page.locator('#statsStatus').waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:path.join(shots,'overview-demo.png'),fullPage:true});
  assert.deepEqual(errors,[]);pass('real synthetic search and overview load with zero uncaught browser errors');
 }finally{
  await browser.close();fs.writeFileSync(path.join(__dirname,'settings-closeout-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,isolated:true,syntheticSource:true,physicalPhone:false},null,2)+'\n');
 }
})().catch(e=>{console.error(e.stack);process.exit(1);});
