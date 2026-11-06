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
      source.config_revision,
      Object.entries(source.headers || {}).sort(([a], [b]) => a.localeCompare(b)),
    ]);
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
        location.assign("/login");
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
      const status = el("span", "source-state " + (source.enabled && last ? last.success ? "state-success" : "state-failed" : ""));
      status.append(el("span", "status-dot " + (!source.enabled || !last ? "neutral" : last.success ? "" : "failed")), document.createTextNode(!source.enabled ? "已停用" : last ? last.success ? "响应成功" : "请求失败" : "未请求"));
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
      else records.forEach((r) => {const mark = el("i", r.success ? "complete" : "failed");mark.title = `${localTime(r.at, true)} · ${r.success ? "成功" : "失败"}`;history.append(mark);});
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
      row.append(name, el("span", d.success ? "state-success" : "state-failed", d.success ? "响应成功" : "请求失败"), el("span", "metric-value", d.latency_ms + " ms"), el("span", "metric-value", d.count + " 条"));
      $("requestDetails").append(row);
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
      access: "接入设置",
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
  }
  function startTest(id = "all") {
    location.hash = "search";
    route();
    $("testTargetSource").value = id;
    $("testKeyword").focus();
  }
  function updateEndpoint() {
    const u = new URL("/api/torrents", location.origin);
    if (state.settings.api_key_enabled && state.settings.api_key)
      u.searchParams.set("token", state.settings.api_key);
    u.searchParams.set("keyword", "");
    $("apiUrlCode").textContent = u.href;
    $("authBadge").textContent = state.settings.api_key_enabled
      ? "API Key 已开启"
      : "API Key 未开启";
    $("authBadge").classList.toggle(
      "positive",
      Boolean(state.settings.api_key_enabled),
    );
  }
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
        `${s.name} ${s.url}`.toLocaleLowerCase().includes(q),
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
      const url = el("code", "source-url", s.url);
      url.title = s.url;
      identity.append(name, url);
      const req = el("div", "source-request");
      req.setAttribute("role", "cell");
      req.append(
        el("span", "method-tag", s.method),
        el("div", "source-params", `${s.keyword_field} · ${s.timeout}s`),
      );
      const test = el("div", "source-test");
      test.setAttribute("role", "cell");
      const last = state.tests.get(s.id);
      const label = el(
        "div",
        "source-state" +
          (last ? (last.success ? " state-success" : " state-failed") : ""),
      );
      label.append(
        el(
          "span",
          "status-dot " + (last ? (last.success ? "" : "failed") : "neutral"),
        ),
        document.createTextNode(
          last ? (last.success ? "响应成功" : "请求失败") : "未测试",
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
        state.settings = data;
        state.loaded = true;
        renderSources();
        renderOverview();
        loadStats();
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
    $("formEnabled").checked = s ? s.enabled : true;
    $("formHeaders").value =
      s && Object.keys(s.headers || {}).length
        ? JSON.stringify(s.headers, null, 2)
        : "";
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
    let headers = {};
    const raw = $("formHeaders").value.trim();
    if (raw) {
      try {
        headers = JSON.parse(raw);
        if (
          !headers ||
          Array.isArray(headers) ||
          typeof headers !== "object" ||
          Object.values(headers).some((v) => typeof v !== "string")
        )
          throw Error();
      } catch {
        if (!/[\n:{}\[\]]/.test(raw)) headers = { "X-API-Key": raw };
        else {
          message(
            "sourceError",
            "请求头需为字符串值的 JSON 对象，或单独的 Token。",
            true,
          );
          $("formHeaders").focus();
          return;
        }
      }
    }
    const timeout =
      $("formTimeout").value.trim() === ""
        ? 10
        : Number($("formTimeout").value);
    if (!Number.isFinite(timeout) || timeout < 0.5) {
      message("sourceError", "超时请填写不小于 0.5 的秒数。", true);
      return;
    }
    const id = $("sourceId").value;
    const data = {
      name: $("formName").value.trim() || new URL(url).hostname,
      url,
      method: $("formMethod").value,
      keyword_field: $("formKeywordField").value.trim() || "keyword",
      timeout,
      enabled: $("formEnabled").checked,
      headers,
    };
    state.savingSource = true;
    $("sourceDialog")
      .querySelectorAll("[data-close], #drawerDelete")
      .forEach((b) => (b.disabled = true));
    await busy(
      $("saveSourceBtn"),
      async () => {
        try {
          await post(
            id ? "/api/sources/" + encodeURIComponent(id) : "/api/sources",
            data,
            id ? "PUT" : "POST",
          );
          invalidateSourceTest(id);
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
          message("securitySaved", "已保存。请同步更新 Byte-Muse 接入地址。");
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
  function renderResults() {
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
    for (const item of state.results) {
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
      for (const [flag, name] of [
        [item.chinese || item.c_sub, "中文字幕"],
        [item.uncensored || item.uc, "无码"],
        [item.uhd || item.hd, "高清"],
      ])
        if (flag) tags.append(el("span", "tag", name));
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
        "source-state " + (d.success ? "state-success" : "state-failed"),
      );
      status.append(
        el("span", "status-dot " + (d.success ? "" : "failed")),
        document.createTextNode(
          d.success
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
    });
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
      `${state.details.length} 个源 · ${data.total_time_ms ?? "—"} ms · 已聚合去重`;
  }
  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.loaded) {
      message("searchStatus", "请先成功读取配置，再发起测试。", true);
      return;
    }
    const keyword = $("testKeyword").value.trim(),
      target = $("testTargetSource").value;
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
            { keyword, source_id: target },
            "POST",
            Math.max(15000, timeout),
          );
          if (!data || !Array.isArray(data.data))
            throw Error("搜索响应格式不正确，请检查上游服务。");
          state.results = data.data.filter(
            (item) => item && typeof item === "object" && !Array.isArray(item),
          );
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
          renderSources();
          $("jsonView").textContent = JSON.stringify(
            { data: state.results },
            null,
            2,
          );
          renderResults();
          switchView(state.view);
          $("resultPanel").hidden = false;
          const failed = state.details.filter((d) => !d.success).length;
          message(
            "searchStatus",
            failed
              ? `测试完成，${failed} 个源请求失败。请查看响应明细；可返回数据源修改配置。`
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
    state.loaded
      ? copy($("apiUrlCode").textContent)
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
  load();
})();
