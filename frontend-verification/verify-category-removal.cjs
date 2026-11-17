const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BM_TEST_URL || 'http://127.0.0.1:18765';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const checks = [], errors = [];
const pass = name => { checks.push(name); console.log('PASS', name); };

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: false});
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
  page.on('pageerror', error => errors.push(error.message));
  let refreshing = false, pollReads = 0, failRead = false;
  const refreshes = [];
  const sources = [
    {id: 'alpha', name: 'AVDB · 验证样本', enabled: true, last_query_at: null,
      labels: [...Array.from({length: 338}, (_, index) => ({field: 'category', value: `旧分类${index}`, origin: 'directory', count: 0})),
        {field: 'tags', value: 'LTX', origin: 'observed', count: 2}],
      directory: {provider: 'none', status: 'unsupported', coverage: 'observed_only', count: 0}},
    {id: 'beta', name: 'DB Online · 验证样本', enabled: true, last_query_at: null,
      labels: [{field: 'genres', value: '剧情', origin: 'directory', count: 0}],
      directory: {provider: 'adapter_genres', status: 'ready', coverage: 'cached_movies', count: 1}},
    {id: 'flags', name: '修仙 · 布尔属性样本', enabled: true, labels: [],
      directory: {provider: 'none', status: 'unsupported', coverage: 'observed_only', count: 0}},
  ];
  await page.route('**/api/resource-labels', async route => {
    if (failRead) return route.fulfill({status: 503, json: {detail: '模拟缓存读取失败'}});
    if (refreshing && ++pollReads >= 2) refreshing = false;
    await route.fulfill({json: {sources, refreshing, retention_days: 90, max_labels_per_source: 200}});
  });
  await page.route('**/api/resource-labels/refresh', async route => {
    refreshes.push(route.request().postDataJSON());
    refreshing = true; pollReads = 0;
    await route.fulfill({status: 202, json: {refreshing: true}});
  });
  let before;
  try {
    await page.goto(BASE + '/login');
    await page.getByLabel('管理账号').fill('preview');
    await page.getByLabel('访问密码', {exact: true}).fill('preview');
    await page.getByRole('button', {name: '进入控制台'}).click();
    await page.waitForURL(BASE + '/');
    before = await (await page.request.get(BASE + '/api/settings')).json();
    const legacy = {type: 'label', value: '2045', field: 'category_ids', source_id: 'alpha', direction: 'prefer'};
    assert((await page.request.post(BASE + '/api/result-preferences', {data: {result_preferences: [legacy]}})).ok());
    await page.reload();
    await page.getByRole('link', {name: '设置', exact: true}).click();
    await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
    assert.equal(await page.locator('#labelCatalogKind option[value="categories"]').count(), 0);
    assert.equal(await page.locator('#sortLabelField option[value="category_ids"]').count(), 0);
    assert.equal(await page.locator('.catalog-tag').count(), 2);
    assert.equal(await page.locator('[data-label-field="category"]').count(), 0);
    assert(!(await page.locator('#labelSuggestions').textContent()).includes('旧分类'));
    assert.equal(await page.getByLabel('“分类 ID 2045”偏好', {exact: true}).count(), 1);
    pass('338 obsolete candidates and their field options are absent; existing category rules remain editable');
    await page.locator('#labelCatalogSource').selectOption('alpha');
    assert(await page.getByRole('button', {name: '同步影片风格', exact: true}).isDisabled());
    await page.locator('#labelCatalogSource').selectOption('beta');
    await page.getByRole('button', {name: '同步影片风格', exact: true}).click();
    await page.getByRole('button', {name: '正在同步风格…', exact: true}).waitFor();
    await page.getByRole('button', {name: '同步影片风格', exact: true}).waitFor();
    assert.deepEqual(refreshes, [{source_id: 'beta'}]);
    await page.getByRole('button', {name: '将 DB Online · 验证样本 的 genres 标签 剧情 加入排序', exact: true}).click();
    await page.getByRole('button', {name: '保存返回顺序', exact: true}).click();
    await page.locator('#savePreferencesBtn:not([disabled])').waitFor();
    assert.deepEqual((await (await page.request.get(BASE + '/api/settings')).json()).result_preferences,
      [legacy, {type: 'label', value: '剧情', field: 'genres', source_id: 'beta', direction: 'prefer'}]);
    pass('genre-only synchronization and new label preferences preserve existing category rules');
    failRead = true;
    await page.getByRole('button', {name: '刷新列表', exact: true}).click();
    await page.getByText(/读取失败：模拟缓存读取失败/).waitFor();
    assert.equal(await page.locator('.catalog-tag').count(), 1);
    failRead = false;
    await page.getByRole('button', {name: '刷新列表', exact: true}).click();
    await page.locator('#refreshLabelsBtn:not([disabled])').waitFor();
    await page.locator('#labelCatalogSource').selectOption('*');
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({width, height: 1100});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width}`);
    }
    assert.deepEqual(errors, []);
    pass('cache failures preserve labels; desktop and mobile widths fit without uncaught errors');
  } finally {
    if (before) await page.request.post(BASE + '/api/result-preferences', {data: {result_preferences: before.result_preferences}});
    await browser.close();
    fs.writeFileSync(path.join(__dirname, 'category-removal-browser-results.json'),
      JSON.stringify({checkedAt: new Date().toISOString(), checks, errors, isolated: true, controlledCatalog: true, physicalPhone: false}, null, 2) + '\n');
  }
})().catch(error => { console.error(error.stack); process.exit(1); });
