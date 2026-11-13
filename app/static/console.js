"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    settings: { sources: [] },
    stats: null, statsEpoch: 0, statsRange: "today", statsMetric: "requests", onlyErrors: false, logLimit: 6,
    loaded: false,
    loadEpoch: 0,
    results: [],
    details: [],
    testedAt: null,
    keyword: "",
    tests: new Map(),
    sourceRevisions: new Map(),
    view: "card",
    route: "",
    sourceEpoch: 0,
    savingSource: false,
    securityDirty: false,
    pendingDelete: null,
    headerMode: "json", revealHeaders: false, ruleDraft: [], preferenceDirty: false, preferenceSaving: false, preferenceRevision: 0, provenance: [], resultPreferences: [],
    labelCatalog: null, catalogEpoch: 0, catalogLoading: false, catalogError: "", catalogSyncing: false, catalogPollTimer: null, catalogVisibleCounts: new Map(),
    revealCatalogHeaders: false,
    composeText: "", endpoint: "",
    authRedirect: false,
  };
  const icons = {
    edit: "M16 3 21 8 9 20H4v-5L16 3Zm-2 2 5 5",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
    search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    source: "M4 3h16v7H4V3Zm0 11h16v7H4v-7ZM8 6h.01M8 17h.01M15 6h2m-2 11h2",
  };
  function sourceFingerprint(source) {
    return JSON.stringify([
      source.url,
      source.method,
      source.keyword_field,
      source.timeout,
      source.enabled,
      source.config_revision, source.source_type || "generic", source.jackett_indexer || "all",
      Object.entries(source.headers || {}).sort(([a], [b]) => a.localeCompare(b)),
    ]);
  }
  function catalogFingerprint(source) {
    return JSON.stringify([sourceFingerprint(source), source.catalog_mode || "auto", source.has_catalog_headers || false]);
  }
  function invalidateSourceTest(id) {
    state.tests.delete(id);
    if (state.stats?.sources?.[id]) state.stats.sources[id] = {last: null, history: []};
    state.sourceRevisions.set(id, (state.sourceRevisions.get(id) || 0) + 1);
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  }
  function icon(name) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    n.setAttribute("viewBox", "0 0 24 24");
    n.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(n.namespaceURI, "path");
    p.setAttribute("d", icons[name]);
    n.append(p);
    return n;
  }
  function button(text, fn, cls = "btn") {
    const n = el("button", cls, text);
    n.type = "button";
    n.addEventListener("click", fn);
    return n;
  }
  function iconButton(label, name, fn, cls = "") {
    const b = button("", fn, "icon-btn " + cls);
    b.setAttribute("aria-label", label);
    b.title = label;
    b.append(icon(name));
    return b;
  }
  function message(id, text, error = false) {
    const n = $(id);
    n.textContent = text;
    n.hidden = !text;
    n.classList.toggle("error-text", error);
  }
  let toastTimer;
  function toast(text) {
    clearTimeout(toastTimer);
    $("toast").textContent = text;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
    }, 3500);
  }
  async function busy(btn, fn, text) {
    const nodes = [...btn.childNodes];
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    if (text) btn.replaceChildren(document.createTextNode(text));
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (text) btn.replaceChildren(...nodes);
    }
  }
  async function request(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (response.status === 401) {
        if (!state.authRedirect) {state.authRedirect = true;location.assign("/login");}
        throw Error("登录已过期，请重新登录。");
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw Error(
          `服务返回了无法解析的响应（HTTP ${response.status}），请检查服务后重试。`,
        );
      }
      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : `请求失败（HTTP ${response.status}）`;
        throw Error(detail);
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError")
        throw Error("请求超时，请检查网络或上游超时设置后重试。");
      if (e instanceof TypeError)
        throw Error("无法连接服务，请检查网络后重试。");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const post = (url, data, method = "POST", timeout) =>
    request(
      url,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
      timeout,
    );
  function safeHttp(value) {
    if (typeof value !== "string") return "";
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  }
  function normalizeUrl(value) {
    let v = value.trim();
    if (!/^https?:\/\//i.test(v)) {
      // A hostname followed by a numeric port is an authority, not a URL scheme.
      if (/^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(v)) return "";
      v = "http://" + v;
    }
    const normalized = safeHttp(v);
    return normalized ? normalized.replace(/\/+$/, "") : "";
  }
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          toast("已复制到剪贴板");
          return;
        } catch {
          /* Fall back for HTTP LAN consoles. */
        }
      }
      const input = el("textarea");
      input.value = text;
      input.style.cssText = "position:fixed;top:0;left:-9999px";
      input.setAttribute("aria-label", "待复制文本");
      document.body.append(input);
      const focus = document.activeElement;
      input.select();
      let copied;
      try {
        copied = document.execCommand("copy");
      } finally {
        input.remove();
        focus?.focus();
      }
      if (!copied) throw Error();
      toast("已复制到剪贴板");
    } catch {
      toast("复制失败，请选中文本手动复制。");
    }
  }
  const number = (value) => value == null ? "—" : Number(value).toLocaleString("zh-CN");
  const seconds = (ms) => ms == null ? "—" : (ms / 1000).toFixed(2);
  const outcomeLabels = {complete: "全部成功", partial: "部分成功", failed: "全部失败"};
  function localTime(at, date = false) {
    return new Date(at).toLocaleString("zh-CN", date
      ? {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"}
      : {hour: "2-digit", minute: "2-digit", second: "2-digit"});
  }
  async function loadStats(append = false) {
    if (!state.loaded) return;
    const epoch = ++state.statsEpoch;
    const configEpoch = state.loadEpoch;
    const params = new URLSearchParams({window: state.statsRange, utc_offset: -new Date().getTimezoneOffset(), errors_only: state.onlyErrors});
    if (append && state.stats?.next_before) params.set("before", state.stats.next_before);
    $("overviewContent").setAttribute("aria-busy", "true");
    $("moreRequests").disabled = true;
    message("statsStatus", state.stats ? "正在更新统计…" : "正在读取运行统计…");
    try {
      const data = await request("/api/stats?" + params);
      if (epoch !== state.statsEpoch || configEpoch !== state.loadEpoch) return;
      if (!data?.summary || !Array.isArray(data.buckets) || !Array.isArray(data.requests) || !data.sources)
        throw Error("统计响应格式不正确。");
      if (append && state.stats) {
        const existing = new Set(state.stats.requests.map((r) => r.id));
        data.requests = [...state.stats.requests, ...data.requests.filter((r) => !existing.has(r.id))];
      }
      if (!append) state.logLimit = 6;
      else state.logLimit += 20;
      state.stats = data;
      renderOverview();
      message("statsStatus", data.write_error ? "部分请求记录未能保存，统计可能不完整。请检查数据目录的可写性。" : "", data.write_error);
    } catch (e) {
      if (epoch !== state.statsEpoch || configEpoch !== state.loadEpoch) return;
      message("statsStatus", `统计读取失败：${e.message}${state.stats ? " 当前保留上次统计。" : ""}`, true);
      $("statsStatus").append(button("重试", () => loadStats()));
    } finally {
      if (epoch === state.statsEpoch) {
        $("overviewContent").setAttribute("aria-busy", "false");
        $("moreRequests").disabled = false;
      }
    }
  }
  function renderOverview() {
    const data = state.stats;
    const s = data?.summary;
    const period = data?.window || state.statsRange;
    const band = $("overviewMetrics");
    band.replaceChildren();
    for (const [label, value, unit, hint] of [
      ["搜索请求", s ? number(s.requests) : "—", "次", `${period === "week" ? "最近 7 天" : "今天"} · 业务与手动测试`],
      ["完整成功率", s?.success_rate == null ? "—" : s.success_rate + "%", "", "全部目标源均响应成功"],
      ["平均聚合耗时", seconds(s?.average_ms), "秒", `P95 · ${seconds(s?.p95_ms)} 秒`],
      ["去重后结果", s ? number(s.unique_count) : "—", "条", s ? `合并 ${number(s.duplicate_count)} 条重复结果` : "等待请求统计"],
    ]) {
      const stat = el("div", "stat");
      const valueNode = el("strong", "", value);
      if (unit) valueNode.append(el("small", "", unit));
      stat.append(el("span", "", label), valueNode, el("p", "", hint));
      band.append(stat);
    }
    $("todayBtn").setAttribute("aria-pressed", String(period === "today"));
    $("weekBtn").setAttribute("aria-pressed", String(period === "week"));
    $("requestMetric").setAttribute("aria-pressed", String(state.statsMetric === "requests"));
    $("latencyMetric").setAttribute("aria-pressed", String(state.statsMetric === "latency_ms"));
    $("trendHeading").textContent = state.statsMetric === "requests" ? "请求趋势" : "聚合耗时";
    const chart = $("requestChart");
    chart.replaceChildren();
    const bins = data?.buckets || [];
    const values = bins.map((b) => b[state.statsMetric] ?? 0);
    const maximum = Math.max(1, ...values);
    const yAxis = el("div", "chart-y-axis");
    for (const value of [maximum, maximum / 2, 0]) yAxis.append(el("span", "", state.statsMetric === "requests" ? String(Math.ceil(value)) : seconds(value) + "s"));
    const plot = el("div", "chart-plot");
    const bars = el("div", "chart-bars");
    const labels = el("div", "chart-x-axis");
    const srTable = el("table", "sr-only");
    srTable.append(el("caption", "", state.statsMetric === "requests" ? "请求数明细" : "平均耗时明细"));
    bins.forEach((b, i) => {
      const column = el("div", "chart-column");
      const bar = el("div", "chart-bar");
      bar.style.height = (values[i] / maximum * 100) + "%";
      const text = `${b.label} · ${b.requests} 次请求 · 平均 ${seconds(b.latency_ms)} 秒`;
      column.title = text;
      column.append(bar);
      bars.append(column);
      const row = el("tr");
      row.append(el("th", "", b.label), el("td", "", text));
      srTable.append(row);
      if (period === "week" || [0, 6, 12, 18, 23].includes(i)) labels.append(el("span", "", b.label));
    });
    plot.append(bars, labels);
    chart.append(yAxis, plot, srTable);
    $("chartRange").textContent = data ? `${new Date(data.start).toLocaleDateString("zh-CN")} 起 · ${period === "week" ? "按天" : "按小时"}统计` : "正在读取…";
    $("chartCaption").textContent = state.statsMetric === "requests" ? "聚合搜索请求" : "平均聚合耗时";
    $("chartEmpty").hidden = !s || s.requests > 0;
    $("outcomeTotal").textContent = s ? `${number(s.requests)} 次` : "—";
    $("outcomeBar").replaceChildren();
    $("outcomeLegend").replaceChildren();
    for (const key of ["complete", "partial", "failed"]) {
      const bar = el("i", key);
      bar.style.flex = s?.[key] || 0;
      bar.hidden = !s?.[key];
      $("outcomeBar").append(bar);
      const legend = el("span");
      legend.append(el("i", key), document.createTextNode(outcomeLabels[key] + " "), el("b", "", s ? number(s[key]) : "—"));
      $("outcomeLegend").append(legend);
    }
    $("outcomeBar").setAttribute("aria-label", s ? `全部成功 ${s.complete} 次，部分成功 ${s.partial} 次，全部失败 ${s.failed} 次` : "等待统计");
    renderOverviewSources();
    renderRequestLogs();
    if (data) {
      const offset = data.utc_offset;
      const zone = `UTC${offset >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(offset)/60)).padStart(2,"0")}:${String(Math.abs(offset)%60).padStart(2,"0")}`;
      $("statsFootnote").textContent = `更新于 ${localTime(data.updated_at)} · ${zone} · 保留最近 ${data.retention_days} 天、最多 ${number(data.max_records)} 条请求；安装前记录不补录。${data.first_record_at ? "当前最早记录：" + localTime(data.first_record_at, true) : "尚无请求历史。"}`;
    }
  }
  function renderOverviewSources() {
    const sources = state.settings.sources;
    $("overviewSourceCount").textContent = state.loaded ? sources.length : "—";
    const list = $("overviewSources");
    list.replaceChildren();
    if (!sources.length) {
      const empty = el("div", "overview-empty");
      empty.append(el("h3", "", state.loaded ? "连接你的第一个数据源" : "正在读取数据源"), el("p", "muted small", "添加上游连接，然后用关键词验证请求。"));
      if (state.loaded) empty.append(button("添加数据源", () => openSource(), "btn primary"));
      list.append(empty);
      return;
    }
    for (const source of sources) {
      const value = state.stats?.sources?.[source.id];
      const last = value?.last;
      const card = el("article", "overview-source");
      const top = el("div", "os-top");
      const emblem = el("span", "source-emblem");
      emblem.append(icon("source"));
      const title = el("div", "os-title");
      title.append(el("h3", "", source.name), el("p", "", `${source.method} · ${source.timeout}s · ${source.keyword_field}`));
      const status = el("span", "source-state " + (source.enabled && last ? last.outcome === "partial" ? "state-partial" : last.success ? "state-success" : "state-failed" : ""));
      status.append(el("span", "status-dot " + (!source.enabled || !last ? "neutral" : last.success ? "" : "failed")), document.createTextNode(!source.enabled ? "已停用" : last ? last.outcome === "partial" ? "部分成功" : last.success ? "响应成功" : "请求失败" : "未请求"));
      top.append(emblem, title, status);
      const metrics = el("div", "os-stats");
      for (const [label, value] of [["最近响应", last ? number(last.latency_ms) + " ms" : "—"], ["最近结果", last ? number(last.count) + " 条" : "—"]]) {
        const cell = el("div"); cell.append(el("span", "", label), el("b", "", value)); metrics.append(cell);
      }
      metrics.append(iconButton(`测试 ${source.name}`, "arrow", () => startTest(source.id)));
      const history = el("div", "source-history");
      const records = [...(value?.history || [])].reverse();
      history.setAttribute("aria-label", records.length ? `最近 ${records.length} 次请求，${records.filter(r=>r.success).length} 次成功` : "尚无请求历史");
      if (!records.length) history.append(el("span", "", "等待第一条请求记录"));
      else records.forEach((r) => {const mark = el("i", r.outcome === "partial" ? "partial" : r.success ? "complete" : "failed");mark.title = `${localTime(r.at, true)} · ${r.outcome === "partial" ? "部分成功" : r.success ? "成功" : "失败"}`;history.append(mark);});
      const foot = el("div", "os-footer");
      foot.append(el("span", "", last ? localTime(last.at, true) : "配置保存后，发起一次测试"), button("编辑配置", () => openSource(source), "text-link"));
      card.append(top, metrics, history, foot);
      list.append(card);
    }
  }
  function renderRequestLogs() {
    const list = $("recentRequests"); list.replaceChildren();
    const logs = state.stats?.requests || [];
    $("logFilter").setAttribute("aria-pressed", String(state.onlyErrors));
    $("logFilter").textContent = state.onlyErrors ? "显示全部" : "只看异常";
    if (!logs.length) list.append(el("p", "logs-empty", state.stats ? state.onlyErrors ? "当前时段没有异常请求。" : "当前时段暂无请求。从一次搜索开始，或等待 Byte-Muse 发起请求。" : "正在读取请求记录…"));
    for (const log of logs.slice(0, state.logLimit)) {
      const row = button("", () => openRequest(log), "request-line");
      const title = el("span", "request-keyword");
      title.append(el("b", "", log.keyword || "（空关键词）"), el("small", "", log.origin === "test" ? "手动测试" : "聚合接口"));
      row.append(el("time", "", localTime(log.at, state.stats?.window === "week")), title, el("span", "outcome-label " + log.outcome, outcomeLabels[log.outcome]), el("span", "request-count", `${log.success_count} / ${log.target_count}`), el("span", "request-count", number(log.unique_count) + " 条"), el("span", "request-latency", log.latency_ms >= 1000 ? seconds(log.latency_ms) + " s" : log.latency_ms + " ms"));
      list.append(row);
    }
    $("moreRequests").hidden = !state.stats?.next_before && logs.length <= state.logLimit;
    $("moreRequests").textContent = logs.length > state.logLimit ? "展开更多请求" : "加载更多请求";
  }
  function openRequest(log) {
    $("requestTitle").textContent = log.keyword || "空关键词请求";
    $("requestMeta").textContent = `${localTime(log.at, true)} · ${log.origin === "test" ? "手动测试" : "聚合接口"}`;
    $("requestSummary").replaceChildren();
    for (const [label, value] of [["聚合状态", outcomeLabels[log.outcome]], ["总耗时", log.latency_ms + " ms"], ["成功源", `${log.success_count} / ${log.target_count}`], ["结果 / 去重", `${log.unique_count} 条 / 合并 ${log.raw_count-log.unique_count} 条`]]) {
      const n = el("div"); n.append(el("span", "muted small", label), el("strong", "", value)); $("requestSummary").append(n);
    }
    $("requestDetails").replaceChildren();
    log.details.forEach((d) => {
      const row = el("div", "metric-row");
      const name = el("div", "metric-name"); name.append(el("strong", "", d.name));
      if (d.error) name.append(el("span", "metric-error", d.error));
      row.append(name, el("span", d.outcome === "partial" ? "state-partial" : d.success ? "state-success" : "state-failed", d.outcome === "partial" ? "部分成功" : d.success ? "响应成功" : "请求失败"), el("span", "metric-value", d.latency_ms + " ms"), el("span", "metric-value", d.count + " 条"));
      $("requestDetails").append(row);
      appendIndexerDetails($("requestDetails"), d);
    });
    $("retestRequest").onclick = () => {$("requestDialog").close();startTest();$("testKeyword").value = log.keyword;};
    $("requestDialog").showModal();
  }

  function route() {
    const key = location.hash.slice(1);
    const next = ["overview", "sources", "search", "access"].includes(key)
      ? key
      : "overview";
    const names = {
      overview: "运行概览",
      sources: "数据源",
      search: "搜索与测试",
      access: "设置",
    };
    for (const name of ["overview", "sources", "search", "access"])
      $("page-" + name).hidden = name !== next;
    document.querySelectorAll("[data-route]").forEach((a) => {
      if (a.dataset.route === next) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("routeLabel").textContent = names[next];
    document.title = names[next] + " · BM-BT-Proxy";
    if (state.route && state.route !== next) {
      window.scrollTo(0, 0);
      const heading = $("page-" + next).querySelector("h1");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    const changed = state.route !== next;
    state.route = next;
    if (next === "overview" && changed && state.loaded) loadStats();
    if (next === "access" && changed && state.loaded) loadLabelCatalog();
  }
  function startTest(id = "all") {
    location.hash = "search";
    route();
    $("testTargetSource").value = id;
    $("testKeyword").focus();
  }
  function updateEndpoint() {
    state.composeText = "";state.endpoint = "";
    try {
      const base = new URL($("consumerBaseUrl").value.trim());
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
        throw Error("请填写 HTTP / HTTPS 服务地址，不含账号、查询参数或片段。");
      const path = base.pathname.replace(/\/+$/, "").replace(/\/api\/torrents(?:\/ltx)?$/, "");
      const ltx = $("consumerProfile").value === "ltx";
      base.pathname = path + (ltx ? "/api/torrents/ltx" : "/api/torrents");
      const enabled = Boolean(state.settings.api_key_enabled && state.settings.api_key);
      const headers = enabled ? {"X-API-Key": state.settings.api_key} : {};
      const publicHeaders = enabled ? {"X-API-Key": "••••••••"} : {};
      const yamlString = value => JSON.stringify(value.replace(/\$/g, "$$$$"));
      const compose = value => ["BT_URL: " + yamlString(base.href), 'BT_METHOD: "get"', "BT_HEADER: " + yamlString(JSON.stringify(value)), 'BT_JSON_DATA: ""', ...(ltx ? ['DEFAULT_SORT: "uc"'] : [])].join("\n");
      state.composeText = compose(headers);state.consumerHeaders = JSON.stringify(headers);
      $("consumerCompose").textContent = compose(publicHeaders);
      $("consumerUrl").textContent = base.href;
      $("consumerHeaders").textContent = JSON.stringify(publicHeaders);
      $("consumerSortRow").hidden = !ltx;
      $("consumerProfileHint").textContent = ltx
        ? "LTX 无码优先，保留其他无码候选。Byte-Muse 继续使用你原有的仅无码、大小和 UHD 等筛选；将实际生效的默认排序 DEFAULT_SORT 设为 uc，避免再次按免流、中字或做种数覆盖 LTX 顺序。此选择只生成接入配置，不会修改运行中的 Byte-Muse。"
        : "标准聚合沿用已保存的源优先级与返回顺序。";
      $("composeKeyHint").textContent = enabled
        ? "密钥已隐藏；复制 Compose 配置会包含已保存的 API Key。"
        : "接口保护未开启，BT_HEADER 使用空对象。";
      const u = new URL(base);
      if (enabled) u.searchParams.set("token", state.settings.api_key);
      u.searchParams.set("keyword", "");state.endpoint = u.href;
      $("apiUrlCode").textContent = enabled ? base.href + "?token=••••••••&keyword=" : u.href;
      $("copyCompose").disabled = !state.loaded;$("copyApi").disabled = !state.loaded;
      message("consumerError", "");
    } catch (error) {
      $("consumerCompose").textContent = "填写有效服务地址后生成配置。";
      $("consumerUrl").textContent = "—";$("consumerHeaders").textContent = "—";
      $("apiUrlCode").textContent = "接入地址暂不可用";
      $("copyCompose").disabled = true;$("copyApi").disabled = true;
      message("consumerError", error.message, true);
    }
    $("authBadge").textContent = state.settings.api_key_enabled
      ? "API Key 已开启"
      : "API Key 未开启";
    $("authBadge").classList.toggle(
      "positive",
      Boolean(state.settings.api_key_enabled),
    );
  }
  $("consumerNetwork").onchange = () => {
    const mode = $("consumerNetwork").value;
    if (mode === "docker") $("consumerBaseUrl").value = "http://bm-bt-proxy:8000";
    if (mode === "browser") $("consumerBaseUrl").value = location.origin;
    $("consumerAddressHint").textContent = mode === "docker"
      ? "两个容器须加入同一 Docker 网络；bm-bt-proxy 为服务名，8000 为容器端口。"
      : "请填写 Byte-Muse 容器可访问的地址；远程容器的 localhost 指向它自身。";
    if (state.loaded) updateEndpoint();
  };
  $("consumerBaseUrl").oninput = () => {$("consumerNetwork").value = "custom";$("consumerAddressHint").textContent = "请填写 Byte-Muse 容器可访问的地址；远程容器的 localhost 指向它自身。";if (state.loaded) updateEndpoint();};
  $("consumerProfile").onchange = () => state.loaded && updateEndpoint();
  $("copyCompose").onclick = () => state.loaded && state.composeText
    ? copy(state.composeText) : toast("请先读取配置并填写有效服务地址");
  $("copyConsumerHeaders").onclick = () => state.loaded && state.composeText
    ? copy(state.consumerHeaders) : toast("请先读取配置并填写有效服务地址");
  async function loadVersion() {
    return busy($("refreshVersion"), async () => {
      try {
        const data = await request("/api/version");
        if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.version || "")) throw Error("版本响应格式无效");
        const label = "v" + data.version;
        $("headerVersion").textContent = label;$("footerVersion").textContent = label;
        $("runningVersion").textContent = label;
        $("buildRevision").textContent = /^[a-f\d]{7,40}$/i.test(data.revision || "") ? data.revision.slice(0, 7) : "未提供构建编号";
        $("versionStatus").textContent = "来自当前连接的 BM-BT 服务；发布记录中的版本可能更新。";
      } catch (error) {
        $("headerVersion").textContent = "版本未读取";$("footerVersion").textContent = "";
        $("runningVersion").textContent = "读取失败";$("buildRevision").textContent = "—";
        $("versionStatus").textContent = error.message + "，可重新读取。";
      }
    });
  }
  $("refreshVersion").onclick = loadVersion;
  function populateSecurity() {
    if (state.securityDirty) return;
    $("secEnabled").checked = Boolean(state.settings.api_key_enabled);
    $("secApiKey").value = state.settings.api_key || "";
  }
  function renderSources() {
    const sources = state.settings.sources;
    const enabled = sources.filter((s) => s.enabled).length;
    $("navCount").textContent = sources.length;
    $("totalCount").textContent = sources.length;
    $("activeCount").textContent = `${enabled} 个已启用 / ${sources.length} 个`;
    const q = $("sourceFilter").value.trim().toLocaleLowerCase();
    const mode = $("sourceStateFilter").value;
    const filtered = sources.filter(
      (s) =>
        (mode === "all" || Boolean(s.enabled) === (mode === "enabled")) &&
        `${s.name} ${s.url} ${(s.tags || []).join(" ")} ${s.source_type || "generic"}`.toLocaleLowerCase().includes(q),
    );
    const list = $("sourcesList");
    list.replaceChildren();
    $("filterCount").textContent =
      `显示 ${filtered.length} / ${sources.length} 个源`;
    if (!filtered.length) {
      const empty = el("div", "table-empty");
      empty.append(
        el(
          "h3",
          "",
          sources.length ? "没有匹配的数据源" : "连接你的第一个数据源",
        ),
        el(
          "p",
          "",
          sources.length
            ? "换个名称、地址或启用状态试试。"
            : "添加上游请求地址，随后即可统一搜索与排查。",
        ),
      );
      empty.append(
        button(
          sources.length ? "清除筛选" : "添加数据源",
          () => {
            if (sources.length) {
              $("sourceFilter").value = "";
              $("sourceStateFilter").value = "all";
              renderSources();
            } else openSource();
          },
          sources.length ? "btn" : "btn primary",
        ),
      );
      list.append(empty);
    }
    for (const s of filtered) {
      const row = el("article", "source-row");
      row.setAttribute("role", "row");
      const identity = el("div", "source-identity");
      identity.setAttribute("role", "cell");
      const name = el("div", "source-name");
      name.append(el("h3", "", s.name || "未命名数据源"));
      if (!s.enabled) name.append(el("span", "tag", "已停用"));
      const labels = el("div", "source-labels");
      labels.append(el("span", "tag", s.source_type === "jackett" ? "Jackett" : "通用 API"), el("span", "priority-tag", `优先级 ${s.priority ?? 100}`));
      (s.tags || []).forEach(tag => labels.append(el("span", "tag", tag)));
      const url = el("code", "source-url", s.url);
      url.title = s.url;
      identity.append(name, labels, url);
      const req = el("div", "source-request");
      req.setAttribute("role", "cell");
      req.append(
        el("span", "method-tag", s.method),
        el("div", "source-params", `${s.source_type === "jackett" ? s.jackett_indexer || "all" : s.keyword_field} · ${s.timeout}s`),
      );
      const test = el("div", "source-test");
      test.setAttribute("role", "cell");
      const last = state.tests.get(s.id);
      const label = el(
        "div",
        "source-state" +
          (last ? (last.outcome === "partial" ? " state-partial" : last.success ? " state-success" : " state-failed") : ""),
      );
      label.append(
        el(
          "span",
          "status-dot " + (last ? (last.success ? "" : "failed") : "neutral"),
        ),
        document.createTextNode(
          last ? (last.outcome === "partial" ? "部分成功" : last.success ? "响应成功" : "请求失败") : "未测试",
        ),
      );
      const detail = el(
        "div",
        "state-detail",
        last
          ? `${last.latency_ms ?? "—"} ms · ${last.count ?? 0} 条`
          : "等待关键词测试",
      );
      if (last?.error) detail.title = last.error;
      test.append(label, detail);
      const actions = el("div", "source-actions");
      actions.setAttribute("role", "cell");
      const toggle = el("label", "toggle");
      const check = el("input");
      check.type = "checkbox";
      check.checked = Boolean(s.enabled);
      check.setAttribute("role", "switch");
      check.setAttribute("aria-label", `启用 ${s.name}`);
      const track = el("span", "toggle-track");
      track.setAttribute("aria-hidden", "true");
      toggle.append(check, track);
      check.addEventListener("change", async () => {
        check.disabled = true;
        const previous = Boolean(s.enabled);
        try {
          await post(
            "/api/sources/" + encodeURIComponent(s.id),
            { ...s, enabled: check.checked },
            "PUT",
          );
          invalidateSourceTest(s.id);
          await load();
          toast(check.checked ? "数据源已启用" : "数据源已停用");
        } catch (e) {
          check.checked = previous;
          message("globalStatus", "切换失败：" + e.message, true);
        } finally {
          check.disabled = false;
        }
      });
      actions.append(
        toggle,
        iconButton(`测试 ${s.name}`, "search", () => startTest(s.id)),
        iconButton(`编辑 ${s.name}`, "edit", () => openSource(s)),
        iconButton(
          `删除 ${s.name}`,
          "trash",
          () => openDelete(s),
          "delete-btn",
        ),
      );
      row.append(identity, req, test, actions);
      list.append(row);
    }
    const previous = $("testTargetSource").value;
    $("testTargetSource").replaceChildren(
      new Option("全部启用源 · 聚合去重", "all"),
    );
    sources.forEach((s) =>
      $("testTargetSource").append(
        new Option(
          `${s.name}${s.enabled ? "" : "（已停用，仍可单独测试）"}`,
          s.id,
        ),
      ),
    );
    if ([...$("testTargetSource").options].some((o) => o.value === previous))
      $("testTargetSource").value = previous;
    updateEndpoint();
    populateSecurity();
  }
  async function load() {
    const epoch = ++state.loadEpoch;
    const preferenceRevision = state.preferenceRevision;
    $("loadState").textContent = "正在读取配置";
    $("loadState").classList.remove("error-text");
    return busy($("refreshBtn"), async () => {
      try {
        const data = await request("/api/settings");
        if (epoch !== state.loadEpoch) return;
        if (!data || !Array.isArray(data.sources))
          throw Error("源配置格式不正确，请检查服务配置。");
        for (const previous of state.settings.sources) {
          const current = data.sources.find((s) => s.id === previous.id);
          if (!current || sourceFingerprint(previous) !== sourceFingerprint(current))
            invalidateSourceTest(previous.id);
        }
        const labelsChanged = JSON.stringify(state.settings.sources.map(s => [s.id, catalogFingerprint(s)])) !== JSON.stringify(data.sources.map(s => [s.id, catalogFingerprint(s)]));
        if (preferenceRevision !== state.preferenceRevision) data.result_preferences = copyRules(state.settings.result_preferences || []);
        state.settings = data;
        if (labelsChanged) {state.labelCatalog = null;state.catalogError = "";state.catalogVisibleCounts.clear();}
        state.loaded = true;
        if (!state.preferenceDirty && !state.preferenceSaving) state.ruleDraft = copyRules(data.result_preferences || []);
        renderPreferences();
        renderSources();
        renderOverview();
        loadStats();
        populateLabelSources();
        loadLabelCatalog();
        message("globalStatus", "");
        $("loadState").textContent = "配置已同步";
      } catch (e) {
        if (epoch !== state.loadEpoch) return;
        $("loadState").textContent = state.loaded
          ? "配置同步失败"
          : "配置读取失败";
        $("loadState").classList.add("error-text");
        message(
          "globalStatus",
          `配置读取失败：${e.message}${state.loaded ? " 当前显示上次读取的配置。" : ""}`,
          true,
        );
        $("globalStatus").append(button("重试", load));
        if (!state.loaded) {
          const empty = el("div", "table-empty");
          empty.append(
            el("h3", "", "暂时无法读取数据源"),
            el("p", "", "检查服务连接，重新加载配置后继续。"),
            button("重新加载", load),
          );
          $("sourcesList").replaceChildren(empty);
          $("activeCount").textContent = "尚未读取配置";
          $("filterCount").textContent = "等待重新加载";
          $("apiUrlCode").textContent = "配置暂不可用，请刷新重试";
          message("statsStatus", "请先重新读取配置，再查看运行统计。", true);
        }
      }
    });
  }
  function updateSourceType(changed) {
    const jackett = $("formSourceType").value === "jackett";
    $("jackettFields").hidden = !jackett; $("genericFields").hidden = jackett;
    if (changed && !$("sourceId").value) {$("formTimeout").value = jackett ? 20 : 10;$("formPriority").value = jackett ? 200 : 100;}
  }
  $("formSourceType").addEventListener("change", () => updateSourceType(true));
  $("loadIndexersBtn").addEventListener("click", () => busy($("loadIndexersBtn"), async () => {
    const epoch = state.sourceEpoch, keyDraft = $("formJackettKey").value, clearKey = $("clearJackettKey").checked;
    try {
      const payload = {url: normalizeUrl($("formUrl").value), source_id: $("sourceId").value, headers: state.headerMode === "rows" ? readHeaderRows() : parseHeaderText()};
      if ($("clearJackettKey").checked) payload.jackett_api_key = "";
      else if ($("formJackettKey").value.trim()) payload.jackett_api_key = $("formJackettKey").value.trim();
      const data = await post("/api/jackett/indexers", payload);
      if (epoch !== state.sourceEpoch || payload.url !== normalizeUrl($("formUrl").value) || keyDraft !== $("formJackettKey").value || clearKey !== $("clearJackettKey").checked) return;
      const previous = $("formJackettIndexer").value;
      $("formJackettIndexer").replaceChildren(new Option("全部已配置站点", "all"));
      data.indexers.forEach(i => $("formJackettIndexer").append(new Option(i.name, i.id)));
      if (![...$("formJackettIndexer").options].some(o => o.value === previous)) $("formJackettIndexer").append(new Option(previous + "（未在已配置列表中）", previous));
      $("formJackettIndexer").value = previous;
      $("indexerStatus").textContent = `已读取 ${data.indexers.length} 个已配置站点；不代表每个站点均可访问。`;
    } catch (error) {if (epoch === state.sourceEpoch) $("indexerStatus").textContent = error.message;}
  }));
  function parseHeaderText() {
    const raw = $("formHeaders").value.trim();
    if (!raw) return {};
    try {const value = JSON.parse(raw);if (!value || Array.isArray(value) || typeof value !== "object" || Object.values(value).some(v => typeof v !== "string")) throw Error();return value;}
    catch {if (!/[\n:{}\[\]]/.test(raw)) return {"X-API-Key": raw};throw Error("请求头需为字符串值的 JSON 对象，或单独的 Token。");}
  }
  function addHeaderRow(key = "", value = "") {
    const row = el("div", "header-row");
    const k = el("input");k.value = key;k.placeholder = "Authorization";k.setAttribute("aria-label", "请求头名称");
    const v = el("input");v.value = value;v.type = state.revealHeaders ? "text" : "password";v.placeholder = "Bearer …";v.autocomplete = "off";v.setAttribute("aria-label", "请求头值");
    row.append(k, v, iconButton("移除请求头", "trash", () => row.remove()));$("headerRows").append(row);
  }
  function readHeaderRows() {
    const value = {}, names = new Set();
    for (const row of $("headerRows").children) {
      const inputs = row.querySelectorAll("input"), key = inputs[0].value.trim(), content = inputs[1].value.trim();
      if (!key && !content) continue;
      if (!key || names.has(key.toLowerCase())) throw Error("请求头名称不能为空或重复。");
      names.add(key.toLowerCase());value[key] = content;
    }
    return value;
  }
  function setHeaderMode(mode) {
    try {
      if (mode !== state.headerMode && mode === "rows") {const values = parseHeaderText();$("headerRows").replaceChildren();Object.entries(values).forEach(([k,v]) => addHeaderRow(k,v));if (!Object.keys(values).length) addHeaderRow();}
      if (mode !== state.headerMode && mode === "json") $("formHeaders").value = JSON.stringify(readHeaderRows(), null, 2);
      state.headerMode = mode;
      $("headerRowsPanel").hidden = mode !== "rows";$("headersJsonPanel").hidden = mode !== "json";
      $("headersRowsBtn").setAttribute("aria-pressed", String(mode === "rows"));$("headersJsonBtn").setAttribute("aria-pressed", String(mode === "json"));
      $("formHeaders").classList.toggle("concealed-value", !state.revealHeaders);
      $("revealHeadersBtn").textContent = state.revealHeaders ? "隐藏值" : "显示值";
      $("revealHeadersBtn").setAttribute("aria-pressed", String(state.revealHeaders));
      $("headerRows").querySelectorAll("input:nth-child(2)").forEach(i => i.type = state.revealHeaders ? "text" : "password");
    } catch (error) {message("sourceError", error.message, true);}
  }
  $("headersRowsBtn").onclick = () => setHeaderMode("rows");$("headersJsonBtn").onclick = () => setHeaderMode("json");
  $("addHeaderBtn").onclick = () => addHeaderRow();
  $("revealHeadersBtn").onclick = () => {state.revealHeaders = !state.revealHeaders;setHeaderMode(state.headerMode);};
  function updateCatalogEditor() {
    $("catalogAuthFields").hidden = $("formCatalogMode").value === "disabled";
    const mode = $("formCatalogAuth").value, clear = $("clearCatalogHeaders").checked;
    const url = normalizeUrl($("formUrl").value.trim());
    const compatible = $("formSourceType").value !== "jackett" && url && new URL(url).pathname.replace(/\/$/, "").endsWith("/api/v1/articles/torrents");
    $("formCatalogAuth").querySelector('[value="account"]').disabled = !compatible;
    $("catalogAccountFields").hidden = mode !== "account";
    $("catalogHeaderFields").hidden = mode !== "headers";
    for (const id of ["formCatalogUsername", "formCatalogPassword", "formCatalogOtp"]) $(id).disabled = clear;
    $("formCatalogAuth").disabled = clear;
    $("formCatalogHeaders").disabled = $("clearCatalogHeaders").checked;
    $("formCatalogHeaders").classList.toggle("concealed-value", !state.revealCatalogHeaders);
    $("revealCatalogHeadersBtn").disabled = $("clearCatalogHeaders").checked;
    $("revealCatalogHeadersBtn").textContent = state.revealCatalogHeaders ? "隐藏值" : "显示值";
    $("revealCatalogHeadersBtn").setAttribute("aria-pressed", String(state.revealCatalogHeaders));
  }
  $("formCatalogMode").onchange = updateCatalogEditor;
  $("formCatalogAuth").onchange = updateCatalogEditor;
  $("formUrl").addEventListener("input", updateCatalogEditor);
  $("formSourceType").addEventListener("change", updateCatalogEditor);
  $("clearCatalogHeaders").onchange = updateCatalogEditor;
  $("revealCatalogHeadersBtn").onclick = () => {state.revealCatalogHeaders = !state.revealCatalogHeaders;updateCatalogEditor();};
  function readCatalogHeaders() {
    if ($("clearCatalogHeaders").checked) return {};
    if ($("formCatalogMode").value === "disabled" || $("formCatalogAuth").value !== "headers") return undefined;
    const raw = $("formCatalogHeaders").value.trim();
    if (!raw) return undefined;
    let headers;
    try {headers = JSON.parse(raw);} catch (_) {throw Error("目录认证请求头需为有效的 JSON 对象。");}
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some(value => typeof value !== "string")) throw Error("目录认证请求头需为字符串值的 JSON 对象。");
    const names = new Set();
    for (const [name, value] of Object.entries(headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || names.has(name.toLowerCase()) || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw Error("目录认证请求头名称无效、重复或值包含控制字符。");
      names.add(name.toLowerCase());
    }
    return headers;
  }
  const preferenceNames = {free: "免流", chinese: "中文字幕", uc: "UC / 无码", uhd: "UHD / 4K"};
  const preferenceHelp = {
    free: "free · 上游标注的免流资源；公共站点不等于免流。",
    chinese: "chinese / c_sub · 上游标注有中文字幕。",
    uc: "uc / uncensored · 上游标注无码或破解。",
    uhd: "uhd / hd · 上游高清标记；实际分辨率以资源信息为准。",
  };
  function resourceFlag(item, key) {
    const aliases = {chinese: "c_sub", uc: "uncensored", uhd: "hd"};
    return item[key] === true || item[aliases[key]] === true;
  }
  const copyRules = rules => rules.map(rule => typeof rule === "string" ? rule : {...rule});
  const normalizedLabel = value => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  function labelCaption(label) {
    return label.field === "category_ids" && label.display_name ? `${label.display_name} · ID ${label.value}` : label.value;
  }
  function ruleName(rule) {
    if (typeof rule === "string") return preferenceNames[rule.replace("!", "")] || rule;
    if (rule.field === "category_ids") {
      const names = new Set();
      for (const source of state.labelCatalog?.sources || []) {
        if (rule.source_id !== "*" && rule.source_id !== source.id) continue;
        for (const label of source.labels || []) if (label.field === rule.field && label.value === rule.value && label.display_name) names.add(label.display_name);
      }
      return names.size === 1 ? `“${[...names][0]} · ID ${rule.value}”` : `“分类 ID ${rule.value}”`;
    }
    return `“${rule.value}”`;
  }
  function ruleScope(rule) {
    if (typeof rule === "string") return preferenceHelp[rule.replace("!", "")] || "";
    const source = rule.source_id === "*" ? "全部数据源" : state.settings.sources.find(s => s.id === rule.source_id)?.name || "来源已删除，请移除此规则";
    const field = rule.field === "*" ? "任意标签字段" : rule.field === "genres" ? "影片风格 · genres" : rule.field;
    return `${source} · ${field} · 完整标签匹配`;
  }
  function ruleDescription(rule) {
    const prefer = typeof rule === "string" ? !rule.startsWith("!") : rule.direction === "prefer";
    return `${ruleName(rule)}${prefer ? "优先" : "靠后"}${typeof rule === "string" ? "" : `（${ruleScope(rule)}）`}`;
  }
  function changedPreferences(text = "排序草稿已更新，保存后下次查询生效。") {
    state.preferenceDirty = true;
    message("preferencesStatus", text);
    renderPreferences();
  }
  function renderPreferences() {
    const list = $("preferenceRules");list.replaceChildren();
    $("preferencesBadge").textContent = state.ruleDraft.length ? `${state.ruleDraft.length} 项${state.preferenceDirty ? " · 未保存" : "规则"}` : state.preferenceDirty ? "已关闭 · 未保存" : "排序偏好关闭";
    const inactive = Object.keys(preferenceNames).filter(key => !state.ruleDraft.some(r => typeof r === "string" && r.replace("!", "") === key));
    const entries = [...state.ruleDraft.map((rule, index) => ({rule, index})), ...inactive.map(rule => ({rule, index: -1}))];
    for (const {rule, index} of entries) {
      const row = el("div", "preference-rule" + (index < 0 ? " inactive-rule" : ""));
      const name = ruleName(rule);
      row.append(el("span", "rule-number", index < 0 ? "—" : String(index + 1).padStart(2, "0")));
      const label = el("div", "rule-label");label.append(el("strong", "", name), el("small", "", ruleScope(rule)));row.append(label);
      const select = el("select");select.setAttribute("aria-label", `${name}偏好`);
      select.append(new Option("不参与排序", ""), new Option("优先", "prefer"), new Option("靠后", "defer"));
      select.value = index < 0 ? "" : typeof rule === "string" ? rule.startsWith("!") ? "defer" : "prefer" : rule.direction;
      select.onchange = () => {
        if (index < 0 && select.value && state.ruleDraft.length >= 24) {select.value = "";message("preferencesStatus", "最多设置 24 条排序规则，请先移除一条。", true);return;}
        if (index >= 0) state.ruleDraft.splice(index, 1);
        if (select.value) {
          const next = typeof rule === "string" ? (select.value === "defer" ? "!" : "") + rule.replace("!", "") : {...rule, direction: select.value};
          state.ruleDraft.splice(index < 0 ? state.ruleDraft.length : index, 0, next);
        }
        changedPreferences();
        list.querySelectorAll("select")[Math.min(Math.max(index, 0), entries.length - 1)]?.focus();
      };
      row.append(select);
      const actions = el("div", "rule-actions");
      for (const [text, delta] of [["上移", -1], ["下移", 1]]) {
        const aria = text + name;
        const b = button(text, () => {
          const next = index + delta;
          [state.ruleDraft[index], state.ruleDraft[next]] = [state.ruleDraft[next], state.ruleDraft[index]];
          changedPreferences();
          [...list.querySelectorAll("button")].find(n => n.getAttribute("aria-label") === aria)?.focus();
        }, "btn subtle");
        b.setAttribute("aria-label", aria);
        b.disabled = index < 0 || index + delta < 0 || index + delta >= state.ruleDraft.length;
        actions.append(b);
      }
      row.append(actions);list.append(row);
    }
    $("preferenceEditor").disabled = state.preferenceSaving || !state.loaded;
    $("addLabelRuleBtn").disabled = state.ruleDraft.length >= 24;
  }
  function populateLabelSources() {
    for (const id of ["labelCatalogSource", "sortLabelSource"]) {
      const select = $(id), previous = select.value;
      select.replaceChildren(new Option("全部数据源", "*"));
      for (const source of state.settings.sources) select.append(new Option(source.name + (source.enabled ? "" : "（已停用）"), source.id));
      if ([...select.options].some(o => o.value === previous)) select.value = previous;
    }
    renderLabelSuggestions();
  }
  function renderLabelSuggestions() {
    const list = $("labelSuggestions"), seen = new Set();list.replaceChildren();
    for (const source of state.labelCatalog?.sources || []) {
      if ($("sortLabelSource").value !== "*" && source.id !== $("sortLabelSource").value) continue;
      for (const label of source.labels || []) {
        if ($("sortLabelField").value !== "*" && label.field !== $("sortLabelField").value) continue;
        const key = normalizedLabel(label.value);
        if (seen.has(key) || seen.size >= 5000) continue;
        seen.add(key);list.append(new Option(labelCaption(label), label.value));
      }
    }
  }
  function addLabelRule(rule) {
    if (!state.loaded || state.preferenceSaving) return;
    if (state.ruleDraft.length >= 24) {message("labelRuleStatus", "最多设置 24 条排序规则，请先移除一条。", true);return;}
    const values = upstreamLabels({tags: [rule.value]});
    if (!values.length) {message("labelRuleStatus", "请输入有效的文字标签（最多 80 字，不包含链接或凭据）。", true);$("sortLabelValue").focus();return;}
    rule = {...rule, value: values[0].value};
    if (rule.field === "category_ids" && (!/^[1-9]\d{0,9}$/.test(rule.value) || Number(rule.value) > 2147483647)) {message("labelRuleStatus", "Jackett 分类请填写有效的数字 ID，可从目录点击添加。", true);$("sortLabelValue").focus();return;}
    const duplicate = state.ruleDraft.some(r => typeof r !== "string" && r.source_id === rule.source_id && r.field === rule.field && normalizedLabel(r.value) === normalizedLabel(rule.value));
    if (duplicate) {message("labelRuleStatus", "相同来源、字段和标签已有规则，可直接调整方向或顺序。", true);return;}
    state.ruleDraft.push(rule);
    changedPreferences();
    message("labelRuleStatus", `已添加“${rule.value}”，保存返回顺序后生效。`);
    $("sortLabelValue").value = "";
  }
  async function loadLabelCatalog() {
    if (!state.loaded) return;
    clearTimeout(state.catalogPollTimer);state.catalogPollTimer = null;
    const epoch = ++state.catalogEpoch, configEpoch = state.loadEpoch;
    state.catalogLoading = true;state.catalogError = "";renderLabelCatalog();
    try {
      const data = await request("/api/resource-labels");
      if (epoch !== state.catalogEpoch || configEpoch !== state.loadEpoch) return;
      if (!data || !Array.isArray(data.sources) || data.sources.some(s => !Array.isArray(s.labels))) throw Error("标签缓存格式无效，请重试。");
      const names = catalog => JSON.stringify((catalog?.sources || []).map(source => [source.id, source.labels.filter(label => label.field === "category_ids").map(label => [label.value, label.display_name])]));
      const captionsChanged = names(state.labelCatalog) !== names(data);
      state.labelCatalog = data;renderLabelSuggestions();if (captionsChanged) renderPreferences();
      if (data.refreshing) state.catalogPollTimer = setTimeout(loadLabelCatalog, 1800);
      return data;
    } catch (error) {
      if (epoch === state.catalogEpoch && configEpoch === state.loadEpoch) state.catalogError = error.message;
    } finally {
      if (epoch === state.catalogEpoch) {state.catalogLoading = false;renderLabelCatalog();}
    }
  }
  async function syncLabelDirectory() {
    if (!state.loaded || state.catalogSyncing || state.labelCatalog?.refreshing) return;
    const configEpoch = state.loadEpoch;
    state.catalogSyncing = true;state.catalogError = "";++state.catalogEpoch;
    clearTimeout(state.catalogPollTimer);renderLabelCatalog();
    try {
      await post("/api/resource-labels/refresh", {source_id: $("labelCatalogSource").value === "*" ? "all" : $("labelCatalogSource").value});
      if (configEpoch === state.loadEpoch && state.labelCatalog) state.labelCatalog.refreshing = true;
      await loadLabelCatalog();
    } catch (error) {
      if (configEpoch === state.loadEpoch) state.catalogError = `目录同步未启动：${error.message}`;
    } finally {state.catalogSyncing = false;renderLabelCatalog();}
  }
  function labelDate(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString("zh-CN", {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"}) : "尚无成功查询";
  }
  function directoryState(source) {
    const directory = source.directory || {provider: "none", status: "never", coverage: "observed_only"};
    const coverage = {current_database: "当前源数据库中的分类", declared_categories: "站点声明支持的分类", cached_movies: "仅 DB Online 已缓存影片的风格，不代表全站风格全集", observed_only: "仅搜索中已发现的标签"}[directory.coverage] || "源提供的目录";
    const statuses = {ready: "目录已同步", unauthorized: "目录需要登录权限", unsupported: "源未提供可读取目录", error: "目录同步失败", never: "目录尚未同步", disabled: "已关闭目录同步"};
    const status = statuses[directory.status] || "目录状态未知";
    let detail = coverage;
    if (directory.fetched_at) detail += ` · 更新于 ${labelDate(directory.fetched_at)}`;
    if (directory.stale) detail += " · 缓存待更新";
    if (directory.origin === "snapshot") detail += " · 上次目录快照";
    if (directory.limited) detail += " · 目录已达容量上限";
    let hint = "";
    if (directory.status === "unauthorized") hint = `目录接口需要登录权限。请在源设置中填写“目录认证请求头”后重新同步。${directory.fetched_at ? "已保留上次目录。" : "搜索发现的标签仍可使用。"}`;
    else if (directory.status === "error") hint = `${directory.error || "暂时无法读取源目录，请稍后重试。"}${directory.fetched_at ? " 已保留上次目录。" : " 搜索发现的标签仍可使用。"}`;
    else if (directory.status === "unsupported") hint = "该源暂时只累计搜索中返回的标签。";
    return {directory, status, detail, hint};
  }
  function renderLabelCatalog() {
    const box = $("labelCatalog");box.replaceChildren();
    $("refreshLabelsBtn").disabled = !state.loaded || state.catalogLoading;
    $("refreshLabelsBtn").textContent = state.catalogLoading ? "正在读取…" : "刷新列表";
    const refreshing = state.catalogSyncing || state.labelCatalog?.refreshing;
    const selected = state.settings.sources.find(source => source.id === $("labelCatalogSource").value);
    const unavailable = selected && (!selected.enabled || selected.catalog_mode === "disabled");
    $("syncLabelDirectoryBtn").disabled = !state.loaded || refreshing || unavailable;
    $("syncLabelDirectoryBtn").textContent = refreshing ? "正在同步目录…" : unavailable ? selected.enabled ? "目录同步已关闭" : "数据源已停用" : "同步源目录";
    $("syncLabelDirectoryBtn").setAttribute("aria-busy", String(Boolean(refreshing)));
    const sources = state.labelCatalog?.sources || [], total = sources.reduce((sum, source) => sum + source.labels.length, 0);
    const stale = state.catalogError ? `读取失败：${state.catalogError}${state.labelCatalog ? " 当前显示上次读取的缓存。" : ""}` : state.labelCatalog?.write_error ? "最近一次标签缓存写入失败，搜索仍可使用；当前显示已保存的标签。" : refreshing ? "正在逐个同步源目录，期间仍可使用已缓存的标签。" : state.catalogLoading ? "正在读取标签缓存…" : `${sources.length} 个源 · 目录与已发现标签共 ${total} 项`;
    message("labelCatalogStatus", stale, Boolean(state.catalogError || state.labelCatalog?.write_error));
    if (!state.labelCatalog) return;
    if (!sources.length) {box.append(el("p", "catalog-empty", "添加数据源后可同步目录；搜索返回的标签也会自动补充在这里。"));return;}
    const filter = normalizedLabel($("labelCatalogFilter").value), scope = $("labelCatalogSource").value, kind = $("labelCatalogKind").value;
    let visible = 0;
    for (const source of sources) {
      if (scope !== "*" && source.id !== scope) continue;
      const matching = source.labels.filter(label => (kind === "*" || (kind === "genres" ? label.field === "genres" : kind === "tags" ? ["tags", "labels"].includes(label.field) : ["category", "categories", "category_ids"].includes(label.field))) && (!filter || normalizedLabel(label.value).includes(filter) || normalizedLabel(label.display_name || "").includes(filter) || normalizedLabel(source.name).includes(filter)));
      if ((filter || kind !== "*") && !matching.length) continue;
      visible++;
      const row = el("article", "catalog-source");
      row.dataset.catalogSource = source.id;
      const heading = el("div", "catalog-source-heading");
      const title = el("div");title.append(el("h4", "", source.name), el("span", "small muted", `${source.labels.length} 项${source.enabled ? "" : " · 已停用"} · 最近成功查询 ${labelDate(source.last_query_at)}`));
      const {directory, status, detail, hint} = directoryState(source);
      const statusTag = el("span", "catalog-directory-state", status);statusTag.dataset.status = directory.status;
      heading.append(title, statusTag);row.append(heading, el("p", "catalog-coverage", detail));
      if (directory.coverage === "cached_movies") row.append(el("p", "catalog-directory-hint", "影片风格适合多影片关键词结果排序。同片磁链共享风格；风格中的 4K、破解等名称不会改变磁链的清晰度或无码属性。"));
      if (hint) row.append(el("p", "catalog-directory-hint" + (["unauthorized", "error"].includes(directory.status) ? " directory-warning" : ""), hint));
      const tags = el("div", "catalog-tags");
      const visibleCount = state.catalogVisibleCounts.get(source.id) || 12;
      for (const label of matching.slice(0, filter ? matching.length : visibleCount)) {
        const tag = button("", () => {
          $("sortLabelValue").value = label.value;$("sortLabelSource").value = source.id;$("sortLabelField").value = label.field;$("sortLabelDirection").value = "prefer";
          addLabelRule({type: "label", value: label.value, field: label.field, source_id: source.id, direction: "prefer"});
          $("preferencesForm").scrollIntoView({behavior: "auto", block: "start"});
          $("savePreferencesBtn").focus({preventScroll: true});
        }, "catalog-tag");
        tag.disabled = state.preferenceSaving;
        const origin = {directory: "源目录", observed: "已发现", both: "目录 + 已发现"}[label.origin] || "已发现";
        tag.dataset.labelOrigin = label.origin || "observed";
        tag.dataset.labelField = label.field;
        tag.setAttribute("aria-label", `将 ${source.name} 的 ${label.field} 标签 ${labelCaption(label)} 加入排序`);
        tag.title = `${origin} · 字段 ${label.field} · 累计搜索命中 ${label.count || 0} 次${label.last_seen ? ` · 最近发现 ${labelDate(label.last_seen)}` : ""}`;
        tag.append(el("span", "catalog-tag-field", label.field === "genres" ? "影片风格" : label.field), el("span", "catalog-tag-name", labelCaption(label)), el("span", "catalog-tag-origin", origin));
        if (label.count) tag.append(el("span", "catalog-tag-count", `${label.count} 次`));
        if (label.catalog_count !== null && label.catalog_count !== undefined) tag.append(el("span", "catalog-tag-count", `库内 ${label.catalog_count}`));
        tag.append(el("span", "catalog-tag-add", "+"));tags.append(tag);
      }
      if (tags.childElementCount) row.append(tags);
      else row.append(el("p", "small muted", source.last_query_at ? "成功查询过，尚未发现文字标签；原始布尔属性可在搜索与测试中查看。" : "暂无可用标签。可先同步源目录，或完成一次搜索积累标签。"));
      if (!filter && matching.length > 12) {
        const more = button(visibleCount >= matching.length ? "收起标签" : `再显示 ${Math.min(100, matching.length - visibleCount)} 项（剩余 ${matching.length - visibleCount}）`, () => {
          if (visibleCount >= matching.length) state.catalogVisibleCounts.delete(source.id);else state.catalogVisibleCounts.set(source.id, visibleCount + 100);
          renderLabelCatalog();
          [...box.querySelectorAll("button")].find(n => n.dataset.expandSource === source.id)?.focus();
        }, "btn subtle catalog-expand");
        more.dataset.expandSource = source.id;more.setAttribute("aria-expanded", String(visibleCount > 12));row.append(more);
      }
      if (source.labels_limited) row.append(el("p", "hint", "标签缓存已达到容量上限，部分较早的标签可能已被替换。"));
      box.append(row);
    }
    if (!visible) box.append(el("p", "catalog-empty", "没有匹配的目录项，试试其他来源、类型或关键词。"));
  }
  $("refreshLabelsBtn").onclick = loadLabelCatalog;
  $("syncLabelDirectoryBtn").onclick = syncLabelDirectory;
  window.addEventListener("pagehide", () => clearTimeout(state.catalogPollTimer));
  $("labelCatalogSource").onchange = renderLabelCatalog;
  $("labelCatalogKind").onchange = renderLabelCatalog;
  $("labelCatalogFilter").oninput = renderLabelCatalog;
  $("sortLabelSource").onchange = renderLabelSuggestions;
  $("sortLabelField").onchange = renderLabelSuggestions;
  $("addLabelRuleBtn").onclick = () => addLabelRule({type: "label", value: $("sortLabelValue").value, source_id: $("sortLabelSource").value, field: $("sortLabelField").value, direction: $("sortLabelDirection").value});
  $("sortLabelValue").addEventListener("keydown", e => {if (e.key === "Enter") {e.preventDefault();$("addLabelRuleBtn").click();}});
  $("resetPreferencesBtn").onclick = () => {state.ruleDraft = [];changedPreferences("所有排序偏好已关闭，保存后生效。");};
  $("preferencesForm").onsubmit = async e => {
    e.preventDefault();
    if (!state.loaded || state.preferenceSaving) return;
    const rules = copyRules(state.ruleDraft);
    state.preferenceSaving = true;renderPreferences();renderLabelCatalog();
    $("savePreferencesBtn").textContent = "正在保存…";
    try {
      const data = await post("/api/result-preferences", {result_preferences: rules});
      state.settings.result_preferences = data.result_preferences;state.ruleDraft = copyRules(data.result_preferences);state.preferenceDirty = false;state.preferenceRevision++;
      message("preferencesStatus", "返回顺序已保存，下次查询生效。可到搜索与测试中查看每条结果的排序依据。");
      message("labelRuleStatus", "");
    } catch (error) {message("preferencesStatus", "保存失败：" + error.message, true);}
    finally {state.preferenceSaving = false;$("savePreferencesBtn").textContent = "保存返回顺序";renderPreferences();renderLabelCatalog();}
  };
  function appendIndexerDetails(parent, detail) {
    if (!detail.indexers?.length && !detail.skipped_count) return;
    const box = el("details", "indexer-details");
    const success = (detail.indexers || []).filter(i => i.success).length;
    box.append(el("summary", "", `内部站点 ${success} / ${detail.indexers?.length || 0} 成功 · 跳过 ${detail.skipped_count || 0} 条无可用磁链记录`));
    (detail.indexers || []).slice(0, 200).forEach(i => {const line = el("div", "indexer-line");line.append(el("span", "", i.name),el("span", i.success ? "state-success" : "state-failed", i.success ? `${i.count} 条 · ${i.latency_ms} ms` : i.error || "失败"));box.append(line);});parent.append(box);
  }
  function openSource(s) {
    if (!state.loaded) {
      toast("请先成功读取配置");
      return;
    }
    if (state.savingSource) return;
    state.sourceEpoch++;
    $("sourceForm").reset();
    $("sourceTitle").textContent = s ? "编辑数据源" : "添加数据源";
    $("sourceId").value = s?.id || "";
    for (const [id, key] of [
      ["formName", "name"],
      ["formUrl", "url"],
      ["formMethod", "method"],
      ["formKeywordField", "keyword_field"],
      ["formTimeout", "timeout"],
    ])
      if (s) $(id).value = s[key];
    $("formSourceType").value = s?.source_type || "generic";
    $("formPriority").value = s?.priority ?? 100;
    $("formTags").value = (s?.tags || []).join(", ");
    $("formJackettKey").value = "";
    $("clearJackettKey").checked = false;
    $("jackettKeyHint").textContent = s?.has_jackett_api_key ? "已保存；留空保留原密钥，填写则替换。" : "仅在后端使用，不写入接入地址。";
    $("formJackettIndexer").replaceChildren(new Option("全部已配置站点", "all"));
    if (s?.jackett_indexer && s.jackett_indexer !== "all") $("formJackettIndexer").append(new Option(s.jackett_indexer, s.jackett_indexer));
    $("formJackettIndexer").value = s?.jackett_indexer || "all";
    $("indexerStatus").textContent = "";
    state.headerMode = "json"; state.revealHeaders = false;
    state.revealCatalogHeaders = false;
    $("formCatalogMode").value = s?.catalog_mode || "auto";
    $("formCatalogHeaders").value = "";
    $("formCatalogAuth").value = "keep";
    $("catalogSessionHint").textContent = s?.has_catalog_headers ? "已保存目录认证；保持当前选项即可继续使用。" : "尚未单独登录目录，当前使用搜索请求头。";
    $("clearCatalogHeaders").checked = false;
    $("catalogHeadersHint").textContent = s?.has_catalog_headers ? "已保存目录认证；留空保留原值，填写则替换。已保存内容不会回显。" : "仅在目录需要登录时填写 JSON 对象；与搜索请求头分开保存，不回显已保存值。";
    updateCatalogEditor();
    updateSourceType(false);
    $("formEnabled").checked = s ? s.enabled : true;
    $("formHeaders").value =
      s && Object.keys(s.headers || {}).length
        ? JSON.stringify(s.headers, null, 2)
        : "";
    setHeaderMode("json");
    message("sourceError", "");
    $("detectStatus").textContent = "";
    let del = $("drawerDelete");
    if (del) del.remove();
    if (s) {
      del = button(
        "删除此源",
        () => {
          $("sourceDialog").close();
          openDelete(s);
        },
        "btn subtle drawer-delete",
      );
      del.id = "drawerDelete";
      $("sourceForm").querySelector(".dialog-foot").prepend(del);
    }
    $("sourceDialog").showModal();
    $("formName").focus();
  }
  $("sourceDialog").addEventListener("close", () => {
    for (const id of ["formCatalogUsername", "formCatalogPassword", "formCatalogOtp", "formCatalogHeaders"]) $(id).value = "";
  });
  async function detect(force) {
    const rawUrl = $("formUrl").value.trim();
    if (!rawUrl || (!force && $("formName").value.trim())) return;
    const url = normalizeUrl(rawUrl);
    if (!url) {
      $("detectStatus").textContent = "请先填写有效的 HTTP / HTTPS 地址";
      return;
    }
    const name = $("formName").value;
    const epoch = state.sourceEpoch;
    await busy(
      $("detectBtn"),
      async () => {
        $("detectStatus").textContent = "正在识别…";
        try {
          const data = await post("/api/detect-name", { url });
          if (
            epoch !== state.sourceEpoch ||
            !$("sourceDialog").open ||
            $("formUrl").value.trim() !== rawUrl ||
            $("formName").value !== name
          )
            return;
          if (data.name) {
            $("formName").value = data.name;
            $("detectStatus").textContent = "已识别名称";
          } else $("detectStatus").textContent = "未识别到名称，可手动填写";
        } catch (e) {
          if (epoch === state.sourceEpoch)
            $("detectStatus").textContent = "识别失败，可手动填写名称";
        }
      },
      "识别中…",
    );
  }
  $("sourceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.savingSource) return;
    message("sourceError", "");
    const url = normalizeUrl($("formUrl").value);
    if (!url) {
      message("sourceError", "请填写有效的 HTTP / HTTPS 请求地址。", true);
      $("formUrl").focus();
      return;
    }
    let headers, catalogHeaders;
    try {headers = state.headerMode === "rows" ? readHeaderRows() : parseHeaderText();}
    catch (error) {message("sourceError", error.message, true);$("formHeaders").focus();return;}
    try {catalogHeaders = readCatalogHeaders();}
    catch (error) {message("sourceError", error.message, true);$("formCatalogHeaders").focus();return;}
    const timeout =
      $("formTimeout").value.trim() === ""
        ? 10
        : Number($("formTimeout").value);
    if (!Number.isFinite(timeout) || timeout < 0.5) {
      message("sourceError", "超时请填写不小于 0.5 的秒数。", true);
      return;
    }
    const id = $("sourceId").value;
    const names = new Set();
    for (const [name, value] of Object.entries(headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || names.has(name.toLowerCase()) || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
        message("sourceError", "请求头名称无效、重复或值包含控制字符。", true);return;
      }
      names.add(name.toLowerCase());
    }
    const priority = Number($("formPriority").value);
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {message("sourceError", "优先级需为 0–9999 的整数。", true);return;}
    const data = {
      source_type: $("formSourceType").value,
      priority, tags: $("formTags").value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      jackett_indexer: $("formJackettIndexer").value || "all",
      name: $("formName").value.trim() || new URL(url).hostname,
      url,
      method: $("formMethod").value,
      keyword_field: $("formKeywordField").value.trim() || "keyword",
      timeout,
      enabled: $("formEnabled").checked,
      headers,
      catalog_mode: $("formCatalogMode").value,
    };
    if (catalogHeaders !== undefined) data.catalog_headers = catalogHeaders;
    if ($("formCatalogMode").value !== "disabled" && !$("clearCatalogHeaders").checked && $("formCatalogAuth").value === "account") {
      if (!$("formCatalogUsername").value.trim() || !$("formCatalogPassword").value) {
        message("sourceError", "请填写源站账号和密码。", true);return;
      }
      data.catalog_login = {username: $("formCatalogUsername").value.trim(), password: $("formCatalogPassword").value, otp_code: $("formCatalogOtp").value.trim()};
    }
    if ($("clearJackettKey").checked) data.jackett_api_key = "";
    else if ($("formJackettKey").value.trim()) data.jackett_api_key = $("formJackettKey").value.trim();
    const previous = state.settings.sources.find(s => s.id === id);
    state.savingSource = true;
    $("sourceDialog")
      .querySelectorAll("[data-close], #drawerDelete")
      .forEach((b) => (b.disabled = true));
    await busy(
      $("saveSourceBtn"),
      async () => {
        try {
          const saved = await post(
            id ? "/api/sources/" + encodeURIComponent(id) : "/api/sources",
            data,
            id ? "PUT" : "POST",
          );
          if (!previous || sourceFingerprint(previous) !== sourceFingerprint(saved)) invalidateSourceTest(id);
          else if (previous.priority !== saved.priority) message("searchStatus", "源优先级已改变，请重新搜索查看新的返回顺序。");
          $("sourceDialog").close();
          await load();
          toast("数据源已保存");
        } catch (error) {
          message("sourceError", "保存失败：" + error.message, true);
        } finally {
          state.savingSource = false;
          $("sourceDialog")
            .querySelectorAll("[data-close], #drawerDelete")
            .forEach((b) => (b.disabled = false));
        }
      },
      "正在保存…",
    );
  });
  $("sourceDialog").addEventListener("cancel", (e) => {
    if (state.savingSource) e.preventDefault();
  });
  $("sourceDialog").addEventListener("close", () => {
    state.sourceEpoch++;
  });
  function openDelete(source) {
    state.pendingDelete = source;
    $("confirmText").textContent =
      `「${source.name}」的请求配置将被删除。需要再次使用时，请重新添加。`;
    message("confirmError", "");
    $("confirmDialog").showModal();
    $("cancelDelete").focus();
  }
  $("cancelDelete").onclick = () => $("confirmDialog").close();
  $("confirmDelete").onclick = () =>
    busy(
      $("confirmDelete"),
      async () => {
        const source = state.pendingDelete;
        if (!source) return;
        $("cancelDelete").disabled = true;
        try {
          await request("/api/sources/" + encodeURIComponent(source.id), {
            method: "DELETE",
          });
          invalidateSourceTest(source.id);
          $("confirmDialog").close();
          await load();
          toast("数据源已删除");
        } catch (e) {
          message("confirmError", "删除失败：" + e.message, true);
        } finally {
          $("cancelDelete").disabled = false;
        }
      },
      "正在删除…",
    );
  $("confirmDialog").addEventListener("cancel", (e) => {
    if ($("confirmDelete").disabled) e.preventDefault();
  });
  ["secEnabled", "secApiKey"].forEach((id) =>
    $(id).addEventListener("input", () => {
      state.securityDirty = true;
      message("securitySaved", "");
    }),
  );
  $("generateBtn").onclick = () => {
    $("secApiKey").value =
      "bm_" +
      [...crypto.getRandomValues(new Uint8Array(24))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    state.securityDirty = true;
    message("securitySaved", "新令牌已生成，保存后生效。");
  };
  $("revealBtn").onclick = () => {
    const show = $("secApiKey").type === "password";
    $("secApiKey").type = show ? "text" : "password";
    $("revealBtn").textContent = show ? "隐藏" : "显示";
    $("revealBtn").setAttribute("aria-pressed", String(show));
  };
  $("securityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    message("securityError", "");
    message("securitySaved", "");
    if (!state.loaded) {
      message("securityError", "请先成功读取配置，再保存设置。", true);
      return;
    }
    const enabled = $("secEnabled").checked,
      key = $("secApiKey").value.trim();
    if (enabled && !key) {
      message("securityError", "开启保护前，请填写或生成 API Key。", true);
      $("secApiKey").focus();
      return;
    }
    await busy(
      $("saveSecurityBtn"),
      async () => {
        try {
          await post("/api/security", {
            api_key_enabled: enabled,
            api_key: key,
          });
          state.securityDirty = false;
          await load();
          message("securitySaved", "已保存。请重新复制上方 Compose 配置，同步更新 Byte-Muse。");
          toast("接口保护设置已保存");
        } catch (error) {
          message("securityError", "保存失败：" + error.message, true);
        }
      },
      "正在保存…",
    );
  });
  function coverUrl(item) {
    for (const k of [
      "preview_image",
      "image",
      "cover",
      "cover_url",
      "poster",
      "poster_url",
      "thumbnail",
      "thumbnail_url",
    ]) {
      const u = safeHttp(item[k]);
      if (u) return u;
    }
    return "";
  }
  function formatSize(item) {
    const rawMb = item.size_mb;
    const mb = typeof rawMb === "string" && rawMb.trim() !== ""
      ? Number(rawMb)
      : rawMb;
    if (
      typeof mb === "number" &&
      Number.isFinite(mb) &&
      mb >= 0
    )
      return mb + " MB";
    const n = item.size;
    if (typeof n === "string") return n;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0)
      return "大小未知";
    if (!n) return "0 B";
    const i = Math.max(
      0,
      Math.min(4, Math.floor(Math.log(n) / Math.log(1024))),
    );
    return (n / 1024 ** i).toFixed(1) + " " + ["B", "KB", "MB", "GB", "TB"][i];
  }
  const upstreamLabelFields = {tags: "标签", labels: "标签", category: "分类", categories: "分类", genres: "影片风格", category_ids: "分类 ID"};
  function upstreamLabels(item) {
    const labels = [];
    for (const field of Object.keys(upstreamLabelFields)) {
      const value = item[field];
      const values = Array.isArray(value) ? value.slice(0, 32) : [value];
      const seen = new Set();
      for (let entry of values) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) entry = entry.name || entry.label;
        if (field === "category_ids" && Number.isSafeInteger(entry) && entry >= 0) entry = String(entry);
        if (typeof entry !== "string") continue;
        if (/[\x00-\x1f\x7f]/.test(entry)) continue;
        const text = entry.replace(/\s+/g, " ").trim();
        if (!text || text.length > 80 || /https?:\/\/|magnet:|ed2k:|(?:token|passkey|api[_-]?key|authorization|cookie)\s*[:=]/i.test(text.normalize("NFKC")) || seen.has(text)) continue;
        seen.add(text);labels.push({field, value: text});
      }
    }
    return labels;
  }
  function renderUpstreamTags() {
    const inventory = $("sourceTagInventory");inventory.replaceChildren();
    if (!state.details.length) inventory.append(el("p", "small muted", "本次没有源标签明细，请重新测试查看。"));
    for (const source of state.details) {
      const row = el("article", "source-tag-row");
      const heading = el("div", "source-tag-name");
      heading.append(el("strong", "", source.name || "未命名数据源"), el("span", "small muted", `${source.count ?? 0} 条 · 去重前`));
      const body = el("div", "source-tag-body");
      const metadata = source.resource_metadata;
      if (!source.success) body.append(el("p", "small muted", "查询失败，无法判断该源的标签。"));
      else if (!metadata) body.append(el("p", "small muted", "本次没有标签明细，请重新测试。"));
      else {
        const tags = el("div", "tags");
        for (const label of metadata.labels || []) {
          const tag = el("span", "tag", `${upstreamLabelFields[label.field] || label.field} · ${label.value} ${label.count}`);
          tag.title = `原始字段 ${label.field}；本次 ${label.count} 条记录包含此值`;
          tags.append(tag);
        }
        if (tags.childElementCount) body.append(tags);
        else body.append(el("p", "small muted", source.count ? "本次未提供文字标签或分类。" : "本次没有返回资源，无法判断标签。"));
        if (metadata.labels_limited) body.append(el("p", "hint", "标签较多，仅列出本次最常见的 120 项。"));
        const fields = Object.entries(metadata.flags || {});
        if (fields.length) {
          const flags = el("details", "source-flag-details");
          flags.append(el("summary", "", "查看原始属性字段"));
          const list = el("div", "tags");
          for (const [field, counts] of fields) {
            const tag = el("span", "tag", `${field}: true ${counts.true} / false ${counts.false}`);
            tag.title = "只统计上游明确返回的布尔值，缺少字段不算 false。";list.append(tag);
          }
          flags.append(list);body.append(flags);
        }
      }
      row.append(heading, body);inventory.append(row);
    }
  }
  function renderResults() {
    renderUpstreamTags();
    const inventory = $("resultTags");inventory.replaceChildren();
    for (const [key, name] of Object.entries(preferenceNames)) {
      const count = state.results.filter(item => resourceFlag(item, key)).length;
      const tag = el("span", "tag" + (count ? " positive" : ""), `${name} ${count}`);
      tag.title = preferenceHelp[key];inventory.append(tag);
    }
    inventory.append(el("span", "hint", "统计去重后结果的四项排序属性；上方保留各源返回的文字标签和分类。"));
    const container = $("cardView");
    container.replaceChildren();
    if (!state.results.length) {
      const n = el("div", "table-empty");
      n.append(
        el("h3", "", "这次没有找到结果"),
        el(
          "p",
          "",
          state.details.some((d) => !d.success)
            ? "部分上游请求失败，请查看上方响应明细并调整源配置。"
            : "试试其他关键词，或切换一个数据源。",
        ),
      );
      container.append(n);
    }
    for (const [itemIndex, item] of state.results.entries()) {
      const card = el("article", "result");
      const poster = el("div", "poster");
      const url = coverUrl(item);
      if (url) {
        const img = el("img");
        img.alt = String(item.title || item.name || "搜索结果") + " · 封面";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.addEventListener(
          "error",
          () => {
            poster.replaceChildren(document.createTextNode("封面加载失败"));
            poster.classList.add("missing");
          },
          { once: true },
        );
        img.src = url;
        poster.append(img);
      } else {
        poster.classList.add("missing");
        poster.textContent = "上游未提供可用封面";
      }
      const body = el("div", "result-body");
      const tags = el("div", "tags");
      tags.append(el("span", "tag", item.site || item.website || "来源未标注"));
      const origin = state.provenance[itemIndex];
      if (origin) tags.append(el("span", "priority-tag", `${origin.source_name} · 优先级 ${origin.priority}`));
      if (origin?.ltx_evidence) {
        const tag = el("span", "tag positive", origin.ltx_evidence === "title" ? "LTX · 标题标记" : "LTX · 磁链标签");
        tag.title = "上游对这条资源的明确 LTX 标记；没有验证实际使用的破解模型。";
        tags.append(tag);
      }
      for (const [key, name] of Object.entries(preferenceNames))
        if (resourceFlag(item, key)) {
          const caption = key === "uhd" && item.uhd !== true ? "高清 · HD" : name;
          const tag = el("span", "tag", caption);tag.title = preferenceHelp[key];tags.append(tag);
        }
      const meta = el("div", "meta");
      meta.append(
        el("span", "", formatSize(item)),
        el("span", "", `做种 ${item.seeders ?? "未知"}`),
      );
      if (item.number) meta.append(el("span", "", item.number));
      body.append(
        tags,
        el("h3", "", item.title || item.name || "未命名结果"),
        meta,
      );
      const labels = upstreamLabels(item);
      if (labels.length) {
        const rawTags = el("div", "tags result-upstream-labels");
        for (const label of labels) {
          const tag = el("span", "tag", `${upstreamLabelFields[label.field]} · ${label.value}`);
          tag.title = label.field === "genres" ? "上游原始字段 genres；同影片磁链共享，不代表该磁链的清晰度或无码属性" : `上游原始字段 ${label.field}`;
          tag.dataset.labelField = label.field;rawTags.append(tag);
        }
        body.append(rawTags);
      }
      if (origin && state.resultPreferences.length) {
        const reasons = el("details", "result-sort-reasons");
        reasons.append(el("summary", "", `第 ${itemIndex + 1} 条 · 查看排序依据`));
        if (Array.isArray(origin.rule_matches) && origin.rule_matches.length === state.resultPreferences.length) {
          state.resultPreferences.forEach((rule, index) => {
            const row = el("div", "sort-reason");
            row.append(el("span", "", `${index + 1}. ${ruleDescription(rule)}`), el("span", origin.rule_matches[index] ? "sort-match" : "muted", origin.rule_matches[index] ? "命中" : "未命中"));
            reasons.append(row);
          });
        } else reasons.append(el("p", "hint", "本次未提供规则命中明细，请重新测试。"));
        reasons.append(el("p", "hint", `条件相同时按源优先级 ${origin.priority}、源配置顺序及资源原顺序排列。`));
        body.append(reasons);
      }
      const link =
        typeof item.magnet === "string" && item.magnet.trim()
          ? item.magnet
          : item.download_url;
      if (typeof link === "string" && link.trim())
        body.append(
          button(
            link.startsWith("magnet:") ? "复制磁力链接" : "复制下载链接",
            () => copy(link),
          ),
        );
      else body.append(el("small", "", "上游未提供下载链接"));
      card.append(poster, body);
      container.append(card);
    }
  }
  function switchView(next) {
    state.view = next;
    $("cardView").hidden = next !== "card";
    $("jsonView").hidden = next !== "json";
    $("cardBtn").setAttribute("aria-pressed", String(next === "card"));
    $("jsonBtn").setAttribute("aria-pressed", String(next === "json"));
  }
  function renderDiagnostics(data) {
    $("metrics").replaceChildren();
    if (!state.details.length)
      $("metrics").append(
        el(
          "div",
          "table-empty small",
          "本次没有返回源响应记录。请确认测试范围内有数据源。",
        ),
      );
    state.details.forEach((d) => {
      const row = el("div", "metric-row");
      const name = el("div", "metric-name");
      name.append(el("strong", "", d.name || "未命名数据源"));
      if (!d.success && d.error)
        name.append(el("span", "metric-error", d.error));
      const status = el(
        "span",
        "source-state " + (d.outcome === "partial" ? "state-partial" : d.success ? "state-success" : "state-failed"),
      );
      status.append(
        el("span", "status-dot " + (d.success ? "" : "failed")),
        document.createTextNode(
          d.outcome === "partial" ? "部分成功" : d.success
            ? `成功 ${d.status_code || ""}`
            : `失败 ${d.status_code || ""}`,
        ),
      );
      row.append(
        name,
        status,
        el("span", "metric-value", `${d.latency_ms ?? "—"} ms`),
        el("span", "metric-value", `${d.count ?? 0} 条`),
      );
      $("metrics").append(row);
      appendIndexerDetails($("metrics"), d);
    });
    let mergeNote = $("mergeExplanation");
    if (!mergeNote) {mergeNote = el("details", "merge-explanation");mergeNote.id = "mergeExplanation";$("metrics").after(mergeNote);}
    mergeNote.replaceChildren(el("summary", "", `排序与去重说明 · ${(data.merge?.duplicates || []).length} 条重复记录`));
    if (data.selection?.profile === "ltx") {
      mergeNote.append(el("p", "small muted", `LTX 优选 · ${data.selection.ltx_count} 条 LTX 标记 / ${data.selection.uncensored_count} 条无码候选。重复磁链优先保留有 LTX 标记的无码记录，再比较源优先级；保留完整原始记录，不借用其他资源的标签。`));
      mergeNote.append(el("p", "hint", "其他无码候选仍保留。Byte-Muse 继续按你的条件过滤，排序需设为 uc，才能保持 LTX 优先。影片风格、源名称和普通“破解”字样不用于判定 LTX。"));
    }
    mergeNote.append(el("p", "small muted", (data.merge?.preferences || []).length ? `${data.selection?.profile === "ltx" ? "同档内" : "先按源优先级去重，再"}依次比较：${data.merge.preferences.map(ruleDescription).join(" → ")}，最后按源优先级及原顺序排列。` : data.selection?.profile === "ltx" ? "同档内按源优先级及原顺序排列。" : "排序偏好关闭；按源优先级去重和排序，同级保留原顺序。"));
    mergeNote.append(el("p", "hint", "文字标签只匹配每条最终保留资源的实际标签；缓存用于选择规则，不会给资源补标签。"));
    (data.merge?.duplicates || []).slice(0, 20).forEach(d => mergeNote.append(el("p", "small", `保留 ${d.kept_source}，合并 ${d.discarded_source}：${d.reason}`)));
    $("testDiagnostics").hidden = false;
    $("testTime").textContent = state.testedAt.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const info = $("lastTestInfo");
    info.replaceChildren(
      el("p", "aside-title", `“${state.keyword}”`),
      el(
        "p",
        "muted small",
        `${state.testedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · ${state.details.length} 个源参与测试`,
      ),
    );
    const summary = $("diagnosticSummary");
    summary.replaceChildren();
    for (const [label, value] of [
      [
        "成功 / 失败",
        `${state.details.filter((d) => d.success).length} / ${state.details.filter((d) => !d.success).length}`,
      ],
      ["聚合结果", state.results.length + " 条"],
      ["总耗时", `${data.total_time_ms ?? "—"} ms`],
    ]) {
      const row = el("div", "summary-line");
      row.append(el("span", "", label), el("strong", "", value));
      summary.append(row);
    }
    $("resultCount").textContent = state.results.length;
    $("resultSummary").textContent =
      `${state.details.length} 个源 · ${data.total_time_ms ?? "—"} ms · 已聚合去重${data.selection?.profile === "ltx" ? ` · LTX ${data.selection.ltx_count} 条 / 无码 ${data.selection.uncensored_count} 条` : ""}`;
  }
  $("testProfile").onchange = () => {$("testProfileHint").hidden = $("testProfile").value !== "ltx";};
  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.loaded) {
      message("searchStatus", "请先成功读取配置，再发起测试。", true);
      return;
    }
    const keyword = $("testKeyword").value.trim(),
      target = $("testTargetSource").value;
    const profile = $("testProfile").value;
    if (!keyword) {
      $("testKeyword").focus();
      return;
    }
    const targets = state.settings.sources.filter((s) =>
      target === "all" ? s.enabled : s.id === target,
    );
    if (!targets.length) {
      message(
        "searchStatus",
        "当前范围没有可测试的数据源，请先添加或启用一个源。",
        true,
      );
      return;
    }
    const timeout =
      (Math.max(...targets.map((s) => Number(s.timeout) || 10)) + 15) * 1000;
    const snapshots = new Map(targets.map((s) => [s.id, {
      fingerprint: sourceFingerprint(s),
      revision: state.sourceRevisions.get(s.id) || 0,
    }]));
    await busy(
      $("testSearchBtn"),
      async () => {
        $("searchForm").setAttribute("aria-busy", "true");
        $("searchEmpty").hidden = true;
        $("resultPanel").hidden = true;
        $("testDiagnostics").hidden = true;
        message("searchStatus", `正在请求 ${targets.length} 个上游源，请稍候…`);
        try {
          const data = await post(
            "/api/test",
            { keyword, source_id: target, ...(profile === "ltx" ? {profile} : {}) },
            "POST",
            Math.max(15000, timeout),
          );
          if (!data || !Array.isArray(data.data))
            throw Error("搜索响应格式不正确，请检查上游服务。");
          state.results = data.data.filter(
            (item) => item && typeof item === "object" && !Array.isArray(item),
          );
          state.provenance = Array.isArray(data.provenance) ? data.provenance : [];
          state.resultPreferences = copyRules(data.merge?.preferences || []);
          state.details = Array.isArray(data.details)
            ? data.details.filter((d) => d && typeof d === "object")
            : [];
          state.testedAt = new Date();
          state.keyword = keyword;
          state.details.forEach((d) => {
            const snapshot = snapshots.get(d.id);
            const current = state.settings.sources.find((s) => s.id === d.id);
            if (snapshot && current &&
                snapshot.revision === (state.sourceRevisions.get(d.id) || 0) &&
                snapshot.fingerprint === sourceFingerprint(current))
              state.tests.set(d.id, d);
          });
          renderDiagnostics(data);
          loadStats();
          loadLabelCatalog();
          renderSources();
          $("jsonView").textContent = JSON.stringify(
            { data: state.results },
            null,
            2,
          );
          renderResults();
          switchView(state.view);
          $("resultPanel").hidden = false;
          const failed = state.details.filter((d) => !d.success || d.outcome === "partial").length;
          message(
            "searchStatus",
            failed
              ? `测试完成，${failed} 个源未全部成功。请查看响应明细；可返回数据源修改配置。`
              : "测试完成。可在数据源页面查看本次响应状态。",
            failed > 0,
          );
        } catch (error) {
          message("searchStatus", "测试失败：" + error.message, true);
          $("searchEmpty").hidden = false;
        } finally {
          $("searchForm").removeAttribute("aria-busy");
        }
      },
      "正在测试…",
    );
  });
  $("refreshBtn").onclick = load;
  $("addBtn").onclick = () => openSource();
  $("sourceFilter").oninput = () => {
    if (state.loaded) renderSources();
  };
  $("sourceStateFilter").onchange = () => {
    if (state.loaded) renderSources();
  };
  $("testAllBtn").onclick = () => startTest();
  $("detectBtn").onclick = () => detect(true);
  $("formUrl").addEventListener("blur", () => detect(false));
  $("cardBtn").onclick = () => switchView("card");
  $("jsonBtn").onclick = () => switchView("json");
  $("copyApi").onclick = () =>
    state.loaded && state.endpoint
      ? copy(state.endpoint)
      : toast("请先成功读取配置");
  $("copyJson").onclick = () => copy($("jsonView").textContent);
  $("logoutBtn").onclick = () => {
    if (!window.confirm("确定退出控制台？")) return;
    return busy($("logoutBtn"), async () => {
      try {
        await request("/api/logout", { method: "POST" });
        location.assign("/login");
      } catch (e) {
        message("globalStatus", "退出失败：" + e.message, true);
      }
    });
  };
  $("overviewSearch").onclick = () => startTest();
  $("overviewTest").onclick = () => startTest();
  $("todayBtn").onclick = () => {state.statsRange = "today"; loadStats();};
  $("weekBtn").onclick = () => {state.statsRange = "week"; loadStats();};
  $("requestMetric").onclick = () => {state.statsMetric = "requests"; renderOverview();};
  $("latencyMetric").onclick = () => {state.statsMetric = "latency_ms"; renderOverview();};
  $("logFilter").onclick = () => {state.onlyErrors = !state.onlyErrors; loadStats();};
  $("moreRequests").onclick = () => {
    if ((state.stats?.requests.length || 0) > state.logLimit) {state.logLimit += 20; renderRequestLogs();}
    else loadStats(true);
  };
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
  window.addEventListener("hashchange", route);
  renderOverview();
  route();
  $("consumerBaseUrl").value = location.origin;
  load();
  loadVersion();
})();
