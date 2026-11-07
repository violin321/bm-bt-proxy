/* Run with a local Playwright installation: NODE_PATH=... node frontend-verification/verify.cjs.
   The app is served by the real local FastAPI preview; API responses below are synthetic fixtures.
   No production system is contacted. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const BASE = process.env.BM_PREVIEW_URL || "http://127.0.0.1:8765";
const out = path.join(__dirname, "screenshots");
fs.mkdirSync(out, { recursive: true });
const checks = [],
  errors = [];
const initial = () => ({
  api_key_enabled: false,
  api_key: "",
  sources: [
    {
      id: "atlas",
      name: "示例 · Atlas 索引",
      url: "https://atlas.example.test/api/v1/torrents",
      enabled: true,
      method: "POST",
      keyword_field: "keyword",
      timeout: 15,
      headers: {},
    },
    {
      id: "local",
      name: "示例 · 本地资源库",
      url: "http://library.example.test:6969/api/search",
      enabled: true,
      method: "GET",
      keyword_field: "keyword",
      timeout: 10,
      headers: {},
    },
    {
      id: "archive",
      name: "示例 · 备用归档源",
      url: "https://archive.example.test/" + "long-segment/".repeat(12),
      enabled: false,
      method: "GET",
      keyword_field: "q",
      timeout: 30,
      headers: { "X-API-Key": "fixture-not-a-secret" },
    },
  ],
});
let settings = initial(),
  mode = "normal",
  lastLogin = null,
  lastSearch = null,
  releaseSearch = null;
const results = [
  {
    title: "星际档案 · 第一季 / Interstellar Archives",
    site: "Atlas",
    preview_image: "https://fixture.test/cover.svg",
    size_mb: "2048",
    seeders: 26,
    chinese: true,
    hd: true,
    magnet: "magnet:?xt=urn:btih:" + "a".repeat(40),
  },
  {
    title: "长途旅行影像 · 无封面数据示例",
    site: "本地资源库",
    size: 0,
    seeders: 0,
    magnet: "magnet:?xt=fixture'\"<img src=x onerror=alert(1)>",
  },
  {
    title: "封面请求失败 · 状态示例",
    site: "Atlas",
    cover: "https://fixture.test/broken.jpg",
    size: 629145600,
    seeders: 4,
  },
  {
    title: "<img src=x onerror=alert(1)> 不可信标题",
    image: "javascript:alert(1)",
    seeders: "<script>bad</script>",
    magnet: "javascript:alert(1)",
  },
];
function ok(name) {
  checks.push(name);
  console.log("PASS", name);
}
async function noOverflow(page, name) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scroll <= dimensions.width + 1,
    name + " horizontal overflow " + JSON.stringify(dimensions),
  );
}
(async () => {
  const browser = await chromium.launch({
    headless: process.env.BM_HEADLESS === "1",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/login");
    await page.getByLabel("管理账号").fill("preview");
    await page.getByLabel("访问密码").fill("incorrect");
    await page.getByRole("button", { name: "进入控制台" }).click();
    await page.locator("#loginError:not([hidden])").waitFor();
    assert.match(await page.locator("#loginError").innerText(), /不正确/);
    ok("real login rejects incorrect password and keeps the error visible");
    await page.getByRole("button", { name: "显示密码" }).click();
    assert.equal(await page.locator("#password").getAttribute("type"), "text");
    await page.getByRole("button", { name: "隐藏密码" }).click();
    await page.locator("#loginError").evaluate((n) => {
      n.hidden = true;
    });
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page, "login-" + width);
      await page.evaluate(() => {
        if (!document.querySelector("dialog[open]"))
          document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(out, `login-${width}.png`),
        fullPage: false,
      });
    }
    ok("login responsive at 360 / 390 / 768 / 1440 and password visibility");
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.on("request", (r) => {
      if (r.url().endsWith("/api/login")) lastLogin = r.postDataJSON();
    });
    await page.getByLabel("访问密码").fill("preview");
    await page.getByRole("button", { name: "进入控制台" }).click();
    await page.waitForURL(BASE + "/");
    assert.equal(lastLogin.password, "preview");
    ok("real login submits entered password and redirects to console");
    await page.route("**/api/**", async (route) => {
      const r = route.request(),
        pathname = new URL(r.url()).pathname,
        method = r.method();
      let body = {};
      try {
        body = r.postDataJSON() || {};
      } catch {}
      const send = (data, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      if (mode === "401") return send({ detail: "expired" }, 401);
      if (pathname === "/api/settings")
        return mode === "settings-fail"
          ? send({ detail: "模拟配置读取失败" }, 500)
          : send(settings);
      if (pathname === "/api/detect-name") {
        await new Promise((r) => setTimeout(r, 120));
        return send({ name: "自动识别名称" });
      }
      if (pathname.startsWith("/api/sources")) {
        if (mode === "mutation-fail")
          return send({ detail: "模拟保存失败" }, 500);
        const id = pathname.split("/").pop();
        if (method === "POST") {
          const s = { ...body, id: "new-source" };
          settings.sources.push(s);
          return send(s);
        }
        if (method === "PUT") {
          settings.sources = settings.sources.map((s) =>
            s.id === id ? { ...body, id } : s,
          );
          return send({ ...body, id });
        }
        if (method === "DELETE") {
          settings.sources = settings.sources.filter((s) => s.id !== id);
          return send({ status: "ok" });
        }
      }
      if (pathname === "/api/security") {
        if (mode === "mutation-fail")
          return send({ detail: "模拟设置保存失败" }, 500);
        Object.assign(settings, body);
        return send({ status: "ok", ...body });
      }
      if (pathname === "/api/test") {
        lastSearch = body;
        if (mode === "delayed-search")
          await new Promise((resolve) => { releaseSearch = resolve; });
        if (mode === "search-fail")
          return send({ detail: "模拟上游失败" }, 502);
        if (mode === "timeout") return route.abort("timedout");
        if (mode === "abort-timeout") return;
        const details = [
          {
            id: "atlas",
            name: "示例 · Atlas 索引",
            success: true,
            status_code: 200,
            latency_ms: 346,
            count: 3,
          },
          {
            id: "local",
            name: "示例 · 本地资源库",
            success: false,
            status_code: 503,
            latency_ms: 1004,
            count: 0,
            error: "上游暂不可用，请稍后重试",
          },
        ];
        return send({
          data: mode === "empty" ? [] : mode === "size-values"
            ? [0, "0", " 2048 ", "", "Infinity", "-1", true].map((size_mb) => ({
                title: "大小边界 " + JSON.stringify(size_mb), size_mb,
              })) : results,
          details: mode === "empty" ? [] : details,
          total_time_ms: 1008,
        });
      }
      if (pathname === "/api/logout") return send({ status: "ok" });
      return route.continue();
    });
    await page.route("https://fixture.test/**", async (route) => {
      if (route.request().url().endsWith("broken.jpg"))
        return route.fulfill({ status: 403, body: "" });
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#324f59"/><circle cx="420" cy="90" r="100" fill="#c1a179"/><path d="M0 330 180 140 330 330 480 230 600 400H0" fill="#192f36"/><text x="35" y="65" font-family="sans-serif" font-size="24" fill="#fff">SYNTHETIC FIXTURE</text></svg>',
      });
    });
    await page.reload();
    await page
      .locator("#loadState")
      .filter({ hasText: "配置已同步" })
      .waitFor();
    assert.equal(await page.locator(".source-row").count(), 3);
    assert.equal(
      await page.locator(".source-state").filter({ hasText: "未测试" }).count(),
      3,
    );
    await page.locator("[data-route=sources]").click();
    ok("source workspace and truthful untested state");
    await page.getByLabel("筛选数据源").fill("本地");
    assert.equal(await page.locator(".source-row").count(), 1);
    await page.getByLabel("筛选数据源").fill("");
    await page.getByLabel("启用状态筛选").selectOption("disabled");
    assert.equal(await page.locator(".source-row").count(), 1);
    await page.getByLabel("启用状态筛选").selectOption("all");
    ok("name / URL and enabled-state filters");
    await page.getByRole("button", { name: "添加数据源", exact: true }).click();
    await page.getByLabel("源名称", { exact: true }).fill("新增测试源");
    await page
      .getByLabel("请求地址", { exact: true })
      .fill("  new.example.test:6969/api///  ");
    await page.getByLabel("请求头 / Token").fill("{bad: json}");
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page.locator("#sourceError:not([hidden])").waitFor();
    assert.equal(
      await page.locator("#sourceDialog").evaluate((n) => n.open),
      true,
    );
    ok("invalid headers rejected without closing editor");
    await page.getByLabel("请求头 / Token").fill("test-token");
    await page.getByLabel('关键词参数', {exact:true}).fill('');
    await page.getByLabel('超时（秒）', {exact:true}).fill('');
    mode = "mutation-fail";
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page
      .locator("#sourceError")
      .filter({ hasText: "模拟保存失败" })
      .waitFor();
    assert.equal(
      await page.getByLabel("源名称", { exact: true }).inputValue(),
      "新增测试源",
    );
    mode = "normal";
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page.locator("#sourceDialog").waitFor({ state: "hidden" });
    assert.equal(
      settings.sources.find((s) => s.id === "new-source").headers["X-API-Key"],
      "test-token",
    );
    assert.equal(
      settings.sources.find((s) => s.id === "new-source").url,
      "http://new.example.test:6969/api",
    );
    assert.equal(settings.sources.find(s => s.id === 'new-source').keyword_field, 'keyword');
    assert.equal(settings.sources.find(s => s.id === 'new-source').timeout, 10);
    ok("source create, bare host:port, Token, blank-field defaults, failure persistence and retry");
    await page
      .getByRole("button", { name: "编辑 新增测试源", exact: true })
      .click();
    await page.getByLabel("源名称", { exact: true }).fill("编辑后的数据源");
    await page.getByLabel("请求方式", { exact: true }).selectOption("POST");
    await page.getByLabel("超时（秒）").fill("600");
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page.locator("#sourceDialog").waitFor({ state: "hidden" });
    assert.equal(
      settings.sources.find((s) => s.id === "new-source").method,
      "POST",
    );
    assert.equal(
      settings.sources.find((s) => s.id === "new-source").timeout,
      600,
    );
    ok("source edit preserves request settings and timeouts above 300 seconds");
    mode = "mutation-fail";
    await page
      .getByRole("switch", { name: "启用 编辑后的数据源", exact: true })
      .uncheck();
    await page
      .locator("#globalStatus")
      .filter({ hasText: "切换失败" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("switch", { name: "启用 编辑后的数据源", exact: true })
        .isChecked(),
      true,
    );
    mode = "normal";
    await page
      .getByRole("switch", { name: "启用 编辑后的数据源", exact: true })
      .uncheck();
    await page
      .locator(".source-row")
      .filter({ hasText: "编辑后的数据源" })
      .getByText("已停用", { exact: true })
      .waitFor();
    ok("toggle failure rolls back and success updates source state");
    await page
      .getByRole("button", { name: "删除 编辑后的数据源", exact: true })
      .click();
    assert.equal(
      await page
        .locator("#cancelDelete")
        .evaluate((n) => n === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert(settings.sources.some((s) => s.id === "new-source"));
    await page
      .getByRole("button", { name: "删除 编辑后的数据源", exact: true })
      .click();
    mode = "mutation-fail";
    await page.getByRole("button", { name: "确认删除" }).click();
    await page
      .locator("#confirmError")
      .filter({ hasText: "模拟保存失败" })
      .waitFor();
    mode = "normal";
    await page.getByRole("button", { name: "确认删除" }).click();
    await page.locator("#confirmDialog").waitFor({ state: "hidden" });
    assert.equal(settings.sources.length, 3);
    ok("delete confirmation / cancel / failure / retry");
    await page.getByRole("button", { name: "添加数据源", exact: true }).click();
    await page
      .getByLabel("请求地址", { exact: true })
      .fill("javascript:alert(1)");
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page
      .locator("#sourceError")
      .filter({ hasText: "HTTP / HTTPS" })
      .waitFor();
    await page
      .getByLabel("请求地址", { exact: true })
      .fill("localhost:6969/api");
    await page.getByLabel("源名称", { exact: true }).fill("");
    const detecting = page.waitForRequest((r) =>
      r.url().endsWith("/api/detect-name"),
    );
    await page
      .getByRole("button", { name: "从地址识别名称", exact: true })
      .click();
    await detecting;
    await page.getByLabel("源名称", { exact: true }).fill("手动编辑名称");
    await page.waitForFunction(
      () => !document.getElementById("detectBtn").disabled,
    );
    assert.equal(
      await page.getByLabel("源名称", { exact: true }).inputValue(),
      "手动编辑名称",
    );
    await page.getByRole("button", { name: "关闭源配置", exact: true }).click();
    ok(
      "unsafe URL rejected, localhost:port accepted and async detection cannot overwrite manual name",
    );

    await page
      .getByRole("button", { name: "测试 示例 · Atlas 索引", exact: true })
      .click();
    assert.equal(await page.locator("#testTargetSource").inputValue(), "atlas");
    assert.equal(
      await page
        .locator("#testKeyword")
        .evaluate((n) => n === document.activeElement),
      true,
    );
    await page.getByLabel("搜索关键词").fill("星际档案");
    await page.getByLabel("测试范围").selectOption("all");
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page.locator("#resultPanel").waitFor({ state: "visible" });
    assert.equal(lastSearch.keyword, "星际档案");
    assert.equal(await page.locator(".metric-row").count(), 2);
    assert.equal(await page.locator(".result").count(), 4);
    await page.getByText("2048 MB", { exact: true }).waitFor();
    await page.getByText("封面加载失败", { exact: true }).waitFor();
    assert.equal(await page.locator("#cardView script").count(), 0);
    assert.equal(await page.locator("#cardView img").count(), 1);
    await page
      .getByText("<img src=x onerror=alert(1)> 不可信标题", { exact: true })
      .waitFor();
    ok(
      "single-source shortcut, aggregate search, diagnostic detail and safe result rendering",
    );
    await page
      .getByRole("button", { name: "复制磁力链接", exact: true })
      .nth(1)
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      results[1].magnet,
    );
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    assert.equal(await page.locator("#jsonView").isVisible(), true);
    await page.getByRole("button", { name: "复制 JSON", exact: true }).click();
    assert.equal(
      JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).data
        .length,
      4,
    );
    await page.getByRole("button", { name: "卡片", exact: true }).click();
    ok("hostile link clipboard, JSON switching and export");
    await page.locator('#toast').waitFor({state:'hidden'});
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page, "search-" + width);
      await page.evaluate(() => {
        if (!document.querySelector("dialog[open]"))
          document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(out, `search-${width}.png`),
        fullPage: false,
      });
      await page.locator("[data-route=sources]").click();
      await noOverflow(page, "sources-" + width);
      assert.equal(
        await page
          .locator(".source-state")
          .filter({ hasText: "请求失败" })
          .count(),
        1,
      );
      await page.evaluate(() => {
        if (!document.querySelector("dialog[open]"))
          document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(out, `sources-${width}.png`),
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "编辑 示例 · 备用归档源", exact: true })
        .click();
      await noOverflow(page, "dialog-" + width);
      await page.evaluate(() => {
        if (!document.querySelector("dialog[open]"))
          document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(out, `drawer-${width}.png`),
        fullPage: false,
      });
      const focusInside = await page
        .locator("#sourceDialog")
        .evaluate((n) => n.contains(document.activeElement));
      assert(focusInside);
      await page.keyboard.press("Escape");
      await page.locator("#sourceDialog").waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByRole("button", { name: "编辑 示例 · 备用归档源", exact: true })
          .evaluate((n) => n === document.activeElement),
        true,
      );
      await page.locator("[data-route=access]").click();
      await noOverflow(page, "access-" + width);
      await page.evaluate(() => {
        if (!document.querySelector("dialog[open]"))
          document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(out, `access-${width}.png`),
        fullPage: false,
      });
      await page.locator("[data-route=search]").click();
    }
    ok(
      "all three workspaces / drawer at 360 / 390 / 768 / 1440, Escape and focus return",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator("[data-route=sources]").click();
    await page
      .getByRole("button", { name: "编辑 示例 · 备用归档源", exact: true })
      .click();
    await page.getByRole("button", { name: "删除此源", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    ok("mobile editor exposes source deletion");
    await page.locator("[data-route=access]").click();
    await page.getByLabel("启用 API Key").check();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.locator("#securityError:not([hidden])").waitFor();
    await page.getByRole("button", { name: "生成新令牌" }).click();
    const key = await page.locator("#secApiKey").inputValue();
    assert.match(key, /^bm_[a-f0-9]{48}$/);
    await page.getByRole("button", { name: "显示", exact: true }).click();
    assert.equal(await page.locator("#secApiKey").getAttribute("type"), "text");
    mode = "mutation-fail";
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page
      .locator("#securityError")
      .filter({ hasText: "模拟设置保存失败" })
      .waitFor();
    mode = "normal";
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page
      .locator("#securitySaved")
      .filter({ hasText: "已保存" })
      .waitFor();
    await page.getByText("复制兼容令牌参数的接入地址", {exact:true}).click();
    await page.getByRole("button", { name: "复制接入地址" }).click();
    const copiedUrl = new URL(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    assert.equal(copiedUrl.searchParams.get("token"), key);
    assert.equal(copiedUrl.searchParams.get("keyword"), "");
    ok(
      "API Key validation / crypto generation / reveal / error / save / endpoint copy",
    );
    await page.locator("#secApiKey").fill("draft-key-not-saved");
    await page.getByRole("button", { name: "刷新配置", exact: true }).click();
    await page
      .locator("#loadState")
      .filter({ hasText: "配置已同步" })
      .waitFor();
    assert.equal(
      await page.locator("#secApiKey").inputValue(),
      "draft-key-not-saved",
    );
    ok("refresh preserves unsaved security draft");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("[data-route=search]").click();
    mode = "size-values";
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page.locator(".result").filter({ hasText: "大小边界" }).first().waitFor();
    assert.equal(await page.getByText("0 MB", { exact: true }).count(), 2);
    assert.equal(await page.getByText("2048 MB", { exact: true }).count(), 1);
    assert.equal(await page.getByText("大小未知", { exact: true }).count(), 4);
    ok("numeric and string size_mb compatibility, zero, whitespace and invalid-value guards");

    mode = "delayed-search";
    const pendingSearch = page.waitForRequest((r) => r.url().endsWith("/api/test"));
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await pendingSearch;
    assert.equal(typeof releaseSearch, "function");
    await page.locator("[data-route=sources]").click();
    await page.getByRole("button", { name: "编辑 示例 · Atlas 索引", exact: true }).click();
    await page.getByLabel("请求地址", { exact: true }).fill("https://atlas.example.test/new-api");
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await page.locator("#sourceDialog").waitFor({ state: "hidden" });
    await page.locator("#loadState").filter({ hasText: "配置已同步" }).waitFor();
    releaseSearch();
    await page.waitForFunction(() => !document.getElementById("testSearchBtn").disabled);
    const changedRow = page.locator(".source-row").filter({ hasText: "示例 · Atlas 索引" });
    assert.equal(await changedRow.locator(".source-state").innerText(), "未测试");
    assert.equal(await page.locator(".source-row").filter({ hasText: "示例 · 本地资源库" }).locator(".source-state").innerText(), "请求失败");
    await page.locator("[data-route=search]").click();
    await page.locator("#resultPanel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".metric-row").count(), 2);
    ok("in-flight test keeps its results but cannot assign old diagnostics to a changed source");
    mode = "empty";
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page.getByText("这次没有找到结果", { exact: true }).waitFor();
    ok("empty results explained");
    mode = "search-fail";
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page
      .locator("#searchStatus")
      .filter({ hasText: "模拟上游失败" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "搜索并测试" }).isEnabled(),
      true,
    );
    mode = "timeout";
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page
      .locator("#searchStatus")
      .filter({ hasText: "无法连接服务" })
      .waitFor();
    ok("HTTP and transport failures restore search action");
    // Accelerate the actual AbortController deadline without replacing fetch or controller.
    mode = "abort-timeout";
    await page.evaluate(() => {
      const native = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) =>
        native(fn, ms >= 15000 ? 40 : ms, ...args);
    });
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page
      .locator("#searchStatus")
      .filter({ hasText: "请求超时" })
      .waitFor();
    ok("actual AbortController timeout restores search action");
    mode = "settings-fail";
    await page.locator("[data-route=sources]").click();
    await page.reload();
    await page.getByRole("heading", { name: "暂时无法读取数据源" }).waitFor();
    mode = "normal";
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page
      .locator("#loadState")
      .filter({ hasText: "配置已同步" })
      .waitFor();
    ok("initial config failure has working retry");
    mode = "normal";
    settings.sources = [];
    await page.getByRole("button", { name: "刷新配置", exact: true }).click();
    await page.getByRole("heading", { name: "连接你的第一个数据源" }).waitFor();
    await page.locator("[data-route=search]").click();
    await page.getByLabel("搜索关键词").fill("test");
    await page.getByRole("button", { name: "搜索并测试" }).click();
    await page
      .locator("#searchStatus")
      .filter({ hasText: "没有可测试" })
      .waitFor();
    ok("empty source onboarding and no-source test guard");
    settings = initial();
    await page.route(BASE + "/login", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Login redirect fixture</title><h1>请重新登录</h1>",
      }),
    );
    mode = "401";
    await page.reload();
    await page.waitForURL(BASE + "/login"); // Existing real auth redirects /login to /; intercept login for the 401 contract.
    ok("401 navigates to login");
    assert.deepEqual(errors, []);
    ok("zero uncaught browser JavaScript errors");
  } catch (e) {
    errors.push(e.stack);
    throw e;
  } finally {
    fs.writeFileSync(
      path.join(__dirname, "results.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          checks,
          errors,
          fixtureOnly: true,
          realLocalLogin: true,
          productionVerified: false,
        },
        null,
        2,
      ),
    );
    await browser.close();
  }
})();
