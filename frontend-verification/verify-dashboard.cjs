// Local synthetic stats; real shipped HTML/CSS/JS. No upstream requests.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixtureStats} = require('./dashboard-fixtures.cjs');
const BASE=process.env.BM_DEMO_URL || 'http://127.0.0.1:8770';
const output=path.join(__dirname,'screenshots','selected1');
const review=path.resolve(__dirname,'..','.impeccable','review');
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(review,{recursive:true});
const checks=[],errors=[]; const ok=n=>{checks.push(n);console.log('PASS',n);};
(async()=>{
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/login');await page.getByLabel('管理账号').fill('preview');await page.getByLabel('访问密码').fill('preview');await page.getByRole('button',{name:'进入控制台'}).click();await page.waitForURL(BASE+'/');
  const settings=await (await page.request.get(BASE+'/api/settings')).json();
  let mode='normal', delayed;
  await page.route('**/api/settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(settings)}));
  await page.route('**/api/stats?*',async r=>{
    if(mode==='delay') await new Promise(resolve=>{delayed=resolve;});
    if(mode==='failure')return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'模拟统计不可用'})});
    const data=fixtureStats(mode==='empty'?[]:settings.sources,new URL(r.request().url()));
    if(mode==='hostile'){data.requests[0].keyword='<img src=x onerror=alert(1)>';data.requests[0].details[0].name='<script>bad</script>';}
    return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const ready=()=>page.locator('#overviewContent[aria-busy=false]').waitFor();
  await page.reload();await ready();
  await page.getByRole('heading',{name:'运行概览',exact:true}).waitFor();
  assert.equal(await page.locator('#overviewSources .overview-source').count(),2);
  assert.match(await page.locator('#overviewMetrics').innerText(),/128/);
  assert.equal(await page.locator('.request-line').count(),6);
  ok('selected light overview is default; two real-shaped source cards and six recent rows');
  for(const width of [1440,1265,768,390,360]){
    await page.setViewportSize({width,height:width<650?844:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
    await page.screenshot({path:path.join(output,'overview-'+width+'.png'),fullPage:true});
    if(width===1440||width===390)await page.screenshot({path:path.join(review,width===1440?'desktop.png':'mobile.png'),fullPage:true});
  }
  ok('overview has no horizontal overflow at 360, 390, 768, 1265, 1440');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'展开更多请求'}).click();assert.equal(await page.locator('.request-line').count(),20);
  await page.getByRole('button',{name:'加载更多请求'}).click();await ready();assert.equal(await page.locator('.request-line').count(),40);
  ok('recent requests expand locally then load a real cursor page');
  await page.getByRole('button',{name:'最近 7 天',exact:true}).click();await ready();assert.match(await page.locator('#overviewMetrics').innerText(),/864/);assert.equal(await page.locator('.chart-bar').count(),7);
  await page.getByRole('button',{name:'耗时',exact:true}).click();assert.equal(await page.locator('#trendHeading').innerText(),'聚合耗时');
  await page.getByRole('button',{name:'只看异常',exact:true}).click();await ready();assert.equal(await page.locator('.request-line .outcome-label.complete').count(),0);
  await page.locator('.request-line').first().click();await page.locator('#requestDialog[open]').waitFor();assert(await page.locator('#requestDetails .metric-row').count()>0);await page.getByRole('button',{name:'重新搜索测试'}).click();assert.equal(await page.locator('#testKeyword').inputValue(),'流浪地球');
  ok('seven-day range, latency chart, abnormal-only logs, source detail and retest shortcut');
  await page.locator('[data-route=overview]').click();await ready();
  mode='failure';await page.getByRole('button',{name:'今天',exact:true}).click();await page.locator('#statsStatus').filter({hasText:'模拟统计不可用'}).waitFor();assert.match(await page.locator('#statsStatus').innerText(),/保留上次/);
  mode='normal';await page.locator('#statsStatus').getByRole('button',{name:'重试'}).click();await ready();assert.equal(await page.locator('#statsStatus').isVisible(),false);
  ok('stats read failure preserves previous data and has a working retry');
  mode='empty';await page.getByRole('button',{name:'今天',exact:true}).click();await ready();assert.equal(await page.locator('#chartEmpty').isVisible(),true);assert.match(await page.locator('#overviewMetrics').innerText(),/完整成功率\n—/);assert.match(await page.locator('#recentRequests').innerText(),/没有异常/);
  ok('empty history shows no invented rate, latency or online status');
  mode='hostile';await page.getByRole('button',{name:'今天',exact:true}).click();await ready();await page.getByRole('button',{name:'显示全部'}).click();await ready();assert.equal(await page.locator('#recentRequests img').count(),0);assert.match(await page.locator('#recentRequests').innerText(),/<img/);await page.locator('.request-line').first().click();assert.equal(await page.locator('#requestDetails script').count(),0);await page.getByRole('button',{name:'关闭请求详情'}).click();
  ok('untrusted request keywords and upstream names render as text');
  mode='normal';const two=[...settings.sources];for(let i=3;i<=10;i++)settings.sources.push({...two[0],id:'extra'+i,name:'扩展样例 '+i});
  await page.getByRole('button',{name:'刷新配置',exact:true}).click();await page.locator('#refreshBtn:not([aria-busy])').waitFor();await ready();await page.locator('#overviewSources .overview-source').nth(9).waitFor();assert.equal(await page.locator('#overviewSources .overview-source').count(),10);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  ok('ten sources remain readable with the same responsive grid');
  settings.sources=two;await page.getByRole('button',{name:'刷新配置',exact:true}).click();await page.locator('#refreshBtn:not([aria-busy])').waitFor();await ready();
  assert.deepEqual(errors,[]);ok('zero uncaught dashboard JavaScript errors');
 } finally {fs.writeFileSync(path.join(__dirname,'dashboard-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),checks,errors,fixtureOnly:true,productionVerified:false},null,2));await browser.close();}
})();
