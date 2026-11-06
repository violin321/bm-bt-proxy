"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const paths = {
    source:"M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M16 7h2M16 17h2",
    search:"M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    plug:"M8 2v5m8-5v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5",
    plus:"M12 5v14M5 12h14",
    edit:"m15 4 5 5M4 20h5L21 8l-5-5L4 15v5Z",
    arrow:"M5 12h14m-5-5 5 5-5 5",
    close:"m6 6 12 12M6 18 18 6",
    play:"m8 5 11 7-11 7V5Z",
    issue:"M12 8v5m0 3h.01M10 3h4l9 17H1L10 3Z",
    clock:"M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    check:"m5 12 4 4L19 6",
    copy:"M8 8h13v13H8zM16 8V3H3v13h5",
    settings:"M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6",
    logo:"M5 4v16M12 4v16M19 4v16M5 9h7m0 6h7",
    trash:"M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.source}"/></svg>`;
  const initialSources = () => [
    {id:"atlas",name:"Atlas 电影索引",url:"https://atlas.example.test/api/torrents",method:"POST",keyword_field:"keyword",timeout:15,headers:{},enabled:true,status:"success",ms:342,count:28,symbol:"A"},
    {id:"prowlarr",name:"Prowlarr 聚合源",url:"http://prowlarr.example.test:9696/api",method:"GET",keyword_field:"query",timeout:10,headers:{"X-Api-Key":"sample-token"},enabled:true,status:"success",ms:128,count:16,symbol:"P"},
    {id:"local",name:"本地资源库",url:"http://library.example.test:6969/search",method:"GET",keyword_field:"keyword",timeout:10,headers:{},enabled:true,status:"success",ms:62,count:8,symbol:"L"},
    {id:"jackett",name:"Jackett 备用源",url:"http://jackett.example.test:9117/api/v2",method:"GET",keyword_field:"q",timeout:10,headers:{},enabled:true,status:"error",ms:214,count:0,code:401,error:"上游拒绝访问：缺少有效的 API Key。",help:"检查请求头中的 X-API-Key，保存配置后重新测试。",symbol:"J"},
    {id:"archive",name:"Archive 归档索引",url:"https://archive.example.test/api/search",method:"POST",keyword_field:"keyword",timeout:10,headers:{},enabled:true,status:"error",ms:10002,count:0,code:"TIMEOUT",error:"等待上游响应超时（10 秒）。",help:"检查源地址与网络，或调整超时时间后重试。",symbol:"R"},
    {id:"lab",name:"实验数据源",url:"http://lab.example.test:8080/torrents",method:"GET",keyword_field:"keyword",timeout:30,headers:{},enabled:false,status:"unknown",ms:0,count:0,symbol:"E"},
  ];
  const state = { sources:initialSources(), selected:"jackett", route:"sources", filter:"", query:"", testing:false, searchDone:false, keyword:"星际穿越", keyEnabled:true, key:"bm_demo_only_preview_key", keyVisible:false, lastTime:"14:32:08" };
  const themes = ["quiet","diagnostic","library"];
  const stage = $("stage");
  const picker = document.querySelector(".proto-picker");
  const items = [...picker.querySelectorAll(".proto-picker-item")];
  const highlight = picker.querySelector(".proto-picker-highlight");
  let current = Math.max(0,Math.min(2,(parseInt(new URLSearchParams(location.search).get("v"),10)||1)-1));
  let toastTimer;
  function notify(text) { clearTimeout(toastTimer); $("toast").textContent=text; $("toast").hidden=false; toastTimer=setTimeout(()=>$("toast").hidden=true,2800); }
  function btn(label,action,id="",primary=false,ico="") { return `<button class="btn${primary?" primary":""}" data-action="${action}"${id?` data-id="${h(id)}"`:""}${state.testing&&action==="test"?" disabled":""}>${ico?icon(ico):""}${label}</button>`; }
  function status(s) { const value=!s.enabled?"disabled":s.status; return `<span class="status ${value}">${{disabled:"已停用",success:"响应正常",error:s.code===401?"认证失败":"请求超时",unknown:"未测试",testing:"测试中"}[value]||"未测试"}</span>`; }
  function toggle(s) { return `<label class="switch"><input type="checkbox" data-toggle="${h(s.id)}" aria-label="启用 ${h(s.name)}" ${s.enabled?"checked":""}><span class="switch-track"></span></label>`; }
  function logo() { return `<div class="logo"><span class="logo-mark">${icon("logo")}</span><span>BM-BT</span></div>`; }
  function nav() { return `<nav class="shell-nav" aria-label="应用导航">${[["sources","数据源","source"],["search","搜索与测试","search"],["access","接入设置","plug"]].map(([route,title,ico])=>`<button class="nav-item${state.route===route?" active":""}" title="${title}" aria-label="${title}" ${state.route===route?'aria-current="page"':""} data-route="${route}">${icon(ico)}${title}</button>`).join("")}</nav>`; }
  function title() {
    const text={sources:[current===2?"你的数据源资料库":"数据源",current===1?"选择一个连接，查看响应并修复请求。":"管理连接、定位问题，让搜索结果稳定抵达。"],search:["搜索与测试","用一个关键词，对照每个上游源的响应。"],access:["接入设置","把聚合接口连接至 Byte-Muse。"]}[state.route];
    return `<div class="heading"><div><h1>${text[0]}</h1><p>${text[1]}</p></div><div class="heading-actions">${state.route==="sources"?btn(state.testing?"演示测试中…":"测试启用源","test","",false,"play")+btn("添加数据源","add","",true,"plus"):""}</div></div>`;
  }
  function filtered() { return state.sources.filter(s=>(!state.query||(s.name+" "+s.url).toLowerCase().includes(state.query.toLowerCase()))&&(!state.filter||(state.filter==="error"?s.enabled&&s.status==="error":state.filter==="disabled"?!s.enabled:s.enabled))); }
  function toolbar() { return `<div class="toolbar"><label class="filter-input">${icon("search")}<input id="filterQuery" aria-label="筛选数据源" placeholder="搜索名称或请求地址" value="${h(state.query)}"></label><select id="statusFilter" aria-label="筛选状态">${[["","全部状态"],["error","需要处理"],["enabled","已启用"],["disabled","已停用"]].map(([v,t])=>`<option value="${v}"${state.filter===v?" selected":""}>${t}</option>`).join("")}</select><span class="source-count">${filtered().length} 个数据源 · ${state.sources.filter(s=>s.enabled).length} 个已启用</span></div>`; }
  function attention() { const count=state.sources.filter(s=>s.enabled&&s.status==="error").length; return count?`<div class="attention">${icon("issue")}<span><strong>${count} 个源需要处理</strong> <span class="attention-extra">· 最近一次样例测试发现认证或超时问题</span></span><button class="btn" data-action="issues">查看问题 ${icon("arrow")}</button></div>`:""; }
  function footer() { return `<div class="footer-line"><span>仅展示最近一次测试 · ${state.lastTime}</span><span>样例配置 · 不连接实际源站</span></div>`; }
  function sourceActions(s) { return `<div class="source-actions">${toggle(s)}<button class="icon-btn" aria-label="测试 ${h(s.name)}" data-action="test" data-id="${h(s.id)}">${icon("play")}</button><button class="icon-btn" aria-label="编辑 ${h(s.name)}" data-action="edit" data-id="${h(s.id)}">${icon("edit")}</button></div>`; }
  function quietSources() { return `${title()}${attention()}${toolbar()}<div class="source-table"><div class="table-head"><span>数据源 / 请求地址</span><span>方式</span><span class="request-config">参数 / 超时</span><span>最近响应</span><span style="text-align:right">操作</span></div>${filtered().map(s=>`<div class="source-row${s.id===state.selected?" selected":""}"><button class="source-identity identity-button" data-action="select" data-id="${h(s.id)}"><div class="source-name">${h(s.name)}</div><div class="source-url mono" title="${h(s.url)}">${h(s.url)}</div></button><span class="method">${s.method}</span><div class="request-config small muted"><span class="mono">${h(s.keyword_field)}</span><br>${s.timeout} 秒</div><div class="row-response">${status(s)}<small>${s.enabled&&s.status!=="unknown"?`${s.ms} ms · ${s.count} 条`:"等待测试"}</small></div>${sourceActions(s)}</div>${s.id===state.selected&&s.status==="error"?`<div class="inline-detail"><div class="error-copy"><strong>${h(s.code)} · ${h(s.error)}</strong><span>${h(s.help)}</span></div>${btn("修改请求配置","edit",s.id,false,"edit")}</div>`:""}`).join("")||'<div class="empty">没有匹配的数据源</div>'}</div><div class="page-note">${icon("clock")}<p>测试状态仅代表该次请求。修改配置后，需要重新测试。</p><span class="spacer"></span><span>GET / POST · 多源并发 · 自动去重</span></div>${footer()}`; }
  function diagnosticSources() { const selected=state.sources.find(s=>s.id===state.selected)||state.sources[0]; return `${title()}<div class="diagnostic-layout"><section>${toolbar()}<div class="list-title"><span>连接列表</span><span>最近响应</span></div><div class="source-list">${filtered().map((s,i)=>`<button class="source-row${s.id===selected?.id?" selected":""}" data-action="select" data-id="${h(s.id)}" aria-pressed="${s.id===selected?.id}"><span class="row-index mono">${String(i+1).padStart(2,"0")}</span><div class="source-identity"><div class="source-name">${h(s.name)}</div><div class="source-url mono">${h(s.url)}</div></div><div class="row-response">${status(s)}<small class="mono">${s.enabled&&s.status!=="unknown"?s.ms+" ms":"—"}</small></div></button>`).join("")||'<div class="empty">没有匹配的数据源</div>'}</div><div class="list-foot">${icon("clock")}<span>最近样例测试 ${state.lastTime} · 选择源查看详情</span></div></section>${selected?detail(selected):'<div class="detail empty">添加第一个数据源</div>'}</div>`; }
  function detail(s) { return `<section class="detail"><div class="detail-head"><span>请求详情</span><span class="method">${s.method}</span></div><div class="detail-name">${h(s.name)}</div><div class="detail-endpoint mono">${h(s.url)}</div><div class="detail-status">${status(s)}<span class="muted small mono">${s.enabled&&s.status!=="unknown"?s.ms+" ms":"—"}</span><span class="spacer"></span>${toggle(s)}</div>${s.status==="error"&&s.enabled?`<div class="detail-error"><strong>${h(s.code)} · ${h(s.error)}</strong>${h(s.help)}</div>`:`<div class="detail-error" style="background:var(--soft);color:var(--muted)">${s.enabled&&s.status==="success"?`本次样例请求返回 ${s.count} 条结果。`:"启用或修改源后，可进行单独测试。"}</div>`}<dl class="specs"><div><dt>关键词参数</dt><dd class="mono">${h(s.keyword_field)}</dd></div><div><dt>超时时间</dt><dd class="mono">${s.timeout} s</dd></div><div><dt>返回结果</dt><dd class="mono">${s.count} 条</dd></div></dl><div class="request-block"><div class="request-label"><span>请求预览 · 样例</span><span class="spacer"></span><span>JSON</span></div><pre>${h(JSON.stringify({method:s.method,keyword_field:s.keyword_field,timeout:s.timeout,headers:Object.keys(s.headers).length?{"X-API-Key":"••••••••"}:{}},null,2))}</pre></div><div class="detail-bottom">${btn("编辑配置","edit",s.id,true,"edit")}${btn("重新测试","test",s.id,false,"play")}</div><p class="detail-note">${icon("clock")} 状态来自最近一次样例测试，不代表实时在线。</p></section>`; }
  function librarySources() { return `<div class="library-top"><span>工作空间 / 我的连接</span><span>本地样例资料库</span></div>${title()}${attention()}${toolbar()}<div class="group-heading">所有数据源 <span class="mono">${filtered().length}</span></div><div class="source-grid">${filtered().map(s=>`<article class="source-card"><div class="card-top"><span class="source-symbol">${s.symbol}</span><div class="card-subject"><h2 class="source-name">${h(s.name)}</h2><div class="source-url mono" title="${h(s.url)}">${h(s.url)}</div></div>${toggle(s)}</div><div class="card-specs"><span class="method">${s.method}</span><span class="mono">${h(s.keyword_field)}</span><span>·</span><span>${s.timeout} 秒超时</span></div><div class="card-status ${s.enabled?s.status:""}">${status(s)}<span class="mono">${s.enabled&&s.status!=="unknown"?s.ms+" ms · "+s.count+" 条":"等待测试"}</span></div><div class="card-footer"><button class="btn link" data-action="select" data-id="${h(s.id)}">${s.status==="error"?"查看问题":"请求详情"} ${icon("arrow")}</button><button class="btn link" data-action="test" data-id="${h(s.id)}">单独测试</button><button class="icon-btn" aria-label="编辑 ${h(s.name)}" data-action="edit" data-id="${h(s.id)}">${icon("edit")}</button></div></article>`).join("")||'<div class="empty">没有匹配的数据源</div>'}</div>${footer()}`; }
  function searchPage() { return `${title()}<section class="work-panel"><form id="searchForm" class="search-controls"><input class="text-input" aria-label="搜索关键词" name="keyword" placeholder="输入关键词，测试上游响应" value="${h(state.keyword)}" required><select name="target" aria-label="测试范围"><option value="all">全部启用源</option>${state.sources.map(s=>`<option value="${h(s.id)}">${h(s.name)}</option>`).join("")}</select><button class="btn primary"${state.testing?" disabled":""}>${icon("search")}${state.testing?"演示测试中…":"搜索并测试"}</button></form><p class="small muted">所有响应与搜索结果均为本地示例，用于比较界面风格。</p>${state.searchDone?`<div class="search-response"><div class="flex"><h2>源响应</h2><span class="spacer"></span><span class="small muted">样例 · 聚合去重后 42 条</span></div>${state.sources.filter(s=>s.enabled).map(s=>`<div class="response-source"><span>${h(s.name)}</span>${status(s)}<span class="mono">${s.ms} ms · ${s.count} 条</span></div>`).join("")}<article class="sample-result"><h3>星际穿越 / Interstellar (2014)</h3><p class="small muted">示例结果 · 1080p · 8.4 GB · 做种 26</p>${btn("复制示例磁力链","copy-result","",false,"copy")}</article></div>`:'<div class="empty">输入关键词，比较各数据源的请求结果。</div>'}</section>`; }
  function accessPage() { return `${title()}<div class="access-grid"><section class="work-panel"><div class="flex"><h2>API Key 保护</h2><span class="spacer"></span><label class="switch"><input id="keyEnabled" type="checkbox" aria-label="启用 API Key" ${state.keyEnabled?"checked":""}><span class="switch-track"></span></label></div><p class="field-hint" style="margin-bottom:23px">启用后，客户端需要携带令牌访问聚合接口。</p><label class="field-label" for="apiKey">接口令牌</label><div class="flex"><input class="text-input mono" id="apiKey" type="${state.keyVisible?"text":"password"}" value="${h(state.key)}">${btn(state.keyVisible?"隐藏":"显示","reveal")}</div><div class="flex" style="margin-top:13px">${btn("生成示例令牌","generate")}<span class="spacer"></span>${btn("保存样例设置","save-key","",true)}</div><div style="border-top:1px solid var(--line);margin-top:26px;padding-top:23px"><h2>Byte-Muse 接入地址</h2><code class="access-code">${h(endpoint())}</code>${btn("复制样例地址","copy-endpoint","",false,"copy")}</div></section><aside class="access-guidance"><h2>连接到 Byte-Muse</h2><ol><li>添加数据源并检查请求方式、参数和请求头。</li><li>在搜索与测试中确认源响应。</li><li>把聚合地址填入 Byte-Muse 的 BT_URL。</li></ol><p>当前是风格预览，地址为 example.test 样例。正式接入仍使用现有后端接口。</p></aside></div>`; }
  function endpoint() { return "https://proxy.example.test/api/torrents?"+(state.keyEnabled?"token="+encodeURIComponent(state.key)+"&":"")+"keyword="; }
  function render() {
    const active=document.activeElement, focusId=active?.id;
    const selection=active?.selectionStart;
    const content=state.route==="sources"?[quietSources,diagnosticSources,librarySources][current]():state.route==="search"?searchPage():accessPage();
    let shell;
    if(current===0) shell=`<header class="app-header">${logo()}${nav()}<div class="header-tail"><span>我的工作空间</span><span class="user-badge">V</span></div></header><div class="content">${content}</div>`;
    else if(current===1) shell=`<aside class="rail">${logo()}${nav()}<div class="rail-bottom"><span class="user-badge">V</span></div></aside><div class="desk"><div class="desk-header"><span>工作空间</span><span>/</span><strong>${{sources:"数据源诊断",search:"搜索与测试",access:"接入设置"}[state.route]}</strong><span class="product-name mono">BM-BT / PROXY CONSOLE</span></div><div class="alternate-content">${content}</div></div>`;
    else shell=`<aside class="library-sidebar"><div>${logo()}<div class="product-name">多源聚合，井然有序。</div></div><div><div class="side-label">工作空间</div>${nav()}</div><div class="sidebar-collection"><div class="side-label">源分类</div><div class="collection-item"><strong>已启用</strong><span>${state.sources.filter(s=>s.enabled).length}</span></div><div class="collection-item"><strong>需要处理</strong><span>${state.sources.filter(s=>s.enabled&&s.status==="error").length}</span></div><div class="collection-item"><strong>已停用</strong><span>${state.sources.filter(s=>!s.enabled).length}</span></div></div><div class="sidebar-caption">管理连接，整理来源。<br>让每次搜索都有回应。</div></aside><div class="content">${content}</div>`;
    stage.innerHTML=`<div class="app ${themes[current]}">${shell}</div>`;
    if(focusId&&$(focusId)){ $(focusId).focus(); if(typeof selection==="number")try{$(focusId).setSelectionRange(selection,selection);}catch{} }
    document.title=["素白工作台","深色诊断台","暖灰资料库"][current]+" · BM-BT 风格预览";
  }
  function openEditor(id) {
    const s=state.sources.find(s=>s.id===id)||{name:"",url:"",method:"GET",keyword_field:"keyword",timeout:10,headers:{},enabled:true};
    $("editor").className=current===1?"dark":current===2?"warm":"";
    $("editor").innerHTML=`<header><div><h2 id="editorTitle">${id?"编辑数据源":"添加数据源"}</h2><p>样例配置 · 仅在当前预览中生效</p></div><button class="icon-btn" data-close aria-label="关闭编辑">${icon("close")}</button></header><form id="sourceForm" data-id="${h(id||"")}"><div class="field"><label class="field-label" for="sourceName">源名称</label><input class="text-input" id="sourceName" name="name" value="${h(s.name)}" placeholder="留空时使用地址名称"></div><div class="field"><label class="field-label" for="sourceUrl">请求地址</label><input class="text-input mono" id="sourceUrl" name="url" value="${h(s.url)}" placeholder="example.test:8080/api" required></div><div class="form-grid"><div class="field"><label class="field-label" for="sourceMethod">请求方式</label><select id="sourceMethod" name="method" style="width:100%"><option${s.method==="GET"?" selected":""}>GET</option><option${s.method==="POST"?" selected":""}>POST</option></select></div><div class="field"><label class="field-label" for="sourceTimeout">超时（秒）</label><input class="text-input" id="sourceTimeout" name="timeout" type="number" min="0.5" step="any" value="${s.timeout}"></div></div><div class="field"><label class="field-label" for="sourceKeyword">关键词参数</label><input class="text-input mono" id="sourceKeyword" name="keyword_field" value="${h(s.keyword_field)}" placeholder="keyword"></div><div class="field"><label class="field-label" for="sourceHeaders">请求头 / Token</label><textarea id="sourceHeaders" name="headers" class="text-input" rows="3" placeholder='{"X-API-Key": "your-token"}'>${h(Object.keys(s.headers).length?JSON.stringify(s.headers,null,2):"")}</textarea><p class="field-hint">支持 JSON 对象或单独的 Token。</p></div><label class="flex"><input type="checkbox" name="enabled" ${s.enabled?"checked":""}> 启用此数据源</label><p id="editorError" role="alert"></p><footer>${id?btn("删除样例源","delete",id):""}<span class="spacer"></span><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">保存配置</button></footer></form>`;
    $("editor").querySelectorAll("button[data-action]").forEach(b=>b.type="button");
    $("editor").showModal();
  }
  function openDetail(s) { $("editor").className=current===1?"dark":"warm"; $("editor").innerHTML=`<header><h2 id="editorTitle">源诊断</h2><button class="icon-btn" data-close aria-label="关闭诊断">${icon("close")}</button></header><div class="app ${themes[current]}" style="display:block;min-height:0;padding:0">${detail(s)}</div>`; $("editor").showModal(); }
  function simulateTest(id) {
    if(state.testing)return;
    const targets=state.sources.filter(s=>id?s.id===id:s.enabled);
    if(!targets.length)return notify("请先添加或启用数据源");
    state.testing=true; render();
    setTimeout(()=>{state.testing=false;state.lastTime=new Date().toLocaleTimeString("zh-CN",{hour12:false});targets.forEach(s=>{s.status=["jackett","archive"].includes(s.id)?"error":"success";if(s.status==="success"){s.ms=s.ms||156;s.count=s.count||12;}});state.searchDone=true;render();notify("样例测试完成 · 未向真实上游发送请求");},650);
  }
  async function copy(value) { try{await navigator.clipboard.writeText(value);notify("已复制样例内容");}catch{notify("当前浏览器无法复制，请手动选择样例地址");} }
  async function handleAction(action,id) {
    const s=state.sources.find(s=>s.id===id);
    if(action==="add")openEditor();
    else if(action==="edit"){$("editor").close();openEditor(id);}
    else if(action==="select"){state.selected=id;if(current===2)openDetail(s);else render();}
    else if(action==="test"){if($("editor").open)$("editor").close();simulateTest(id);}
    else if(action==="issues"){state.filter="error";state.query="";render();}
    else if(action==="delete"){if(confirm(`删除样例源「${s.name}」？`)){state.sources=state.sources.filter(s=>s.id!==id);$("editor").close();render();notify("样例源已删除");}}
    else if(action==="reveal"){state.keyVisible=!state.keyVisible;render();}
    else if(action==="generate"){state.key="bm_demo_"+crypto.getRandomValues(new Uint32Array(3)).join("");render();notify("已生成示例令牌");}
    else if(action==="save-key"){if(state.keyEnabled&&!state.key.trim())notify("启用保护时，请填写或生成令牌");else notify("样例设置已保存在当前页面");}
    else if(action==="copy-endpoint")await copy(endpoint());
    else if(action==="copy-result")await copy("magnet:?xt=urn:btih:"+"a".repeat(40));
  }
  document.addEventListener("click",e=>{const close=e.target.closest("[data-close]");if(close)return $("editor").close();const route=e.target.closest("[data-route]");if(route){state.route=route.dataset.route;render();return;}const action=e.target.closest("[data-action]");if(action){e.preventDefault();handleAction(action.dataset.action,action.dataset.id);}});
  document.addEventListener("input",e=>{if(e.target.id==="filterQuery"){state.query=e.target.value;render();}else if(e.target.id==="apiKey")state.key=e.target.value;});
  document.addEventListener("change",e=>{if(e.target.id==="statusFilter"){state.filter=e.target.value;render();}else if(e.target.dataset.toggle){const s=state.sources.find(s=>s.id===e.target.dataset.toggle);s.enabled=e.target.checked;render();if($("editor").open){$("editor").close();openDetail(s);}}else if(e.target.id==="keyEnabled"){state.keyEnabled=e.target.checked;render();}});
  document.addEventListener("submit",e=>{
    if(e.target.id==="searchForm"){e.preventDefault();const data=new FormData(e.target);state.keyword=String(data.get("keyword"));simulateTest(data.get("target")==="all"?"":data.get("target"));}
    if(e.target.id==="sourceForm"){
      e.preventDefault();const form=e.target,data=new FormData(form),raw=String(data.get("url")).trim();
      try{
        const url=new URL(/^https?:\/\//i.test(raw)?raw:"http://"+raw);if(!["http:","https:"].includes(url.protocol)||!url.hostname)throw Error("请填写有效的 HTTP / HTTPS 请求地址。");
        const timeout=String(data.get("timeout")).trim()===""?10:Number(data.get("timeout"));if(!Number.isFinite(timeout)||timeout<.5)throw Error("超时不能小于 0.5 秒。");
        let headers={},headerText=String(data.get("headers")).trim();if(headerText){try{headers=JSON.parse(headerText);}catch{if(/[\n:{}\[\]]/.test(headerText))throw Error("请求头格式不正确，请使用 JSON 对象或单独的 Token。");headers={"X-API-Key":headerText};}if(!headers||Array.isArray(headers)||typeof headers!=="object"||Object.values(headers).some(v=>typeof v!=="string"))throw Error("请求头应为字符串值的 JSON 对象。");}
        const existing=state.sources.find(s=>s.id===form.dataset.id);const value={id:existing?.id||"sample-"+Date.now(),symbol:existing?.symbol||"N",name:String(data.get("name")).trim()||url.hostname,url:url.href.replace(/\/+$/,""),method:data.get("method"),keyword_field:String(data.get("keyword_field")).trim()||"keyword",timeout,headers,enabled:data.has("enabled"),status:"unknown",count:0,ms:0};if(existing)Object.assign(existing,value);else state.sources.push(value);$("editor").close();render();notify("样例配置已保存 · 请重新测试");
      }catch(error){$("editorError").textContent=error.message;}
    }
  });
  function moveHighlight(){const item=items[current];highlight.style.width=item.offsetWidth+"px";highlight.style.transform=`translateX(${item.offsetLeft}px)`;}
  function setActive(index){if(index<0||index>=themes.length)return;current=index;items.forEach((item,i)=>{item.toggleAttribute("data-active",i===index);if(i===index)item.setAttribute("aria-current","true");else item.removeAttribute("aria-current");});moveHighlight();const url=new URL(location);url.searchParams.set("v",index+1);history.replaceState(null,"",url);if($("editor").open)$("editor").close();render();}
  items.forEach((item,index)=>item.addEventListener("click",()=>setActive(index)));
  window.addEventListener("resize",moveHighlight);
  document.addEventListener("keydown",e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable||e.metaKey||e.ctrlKey||e.altKey||$("editor").open)return;const n=parseInt(e.key,10);if(n>=1&&n<=3)setActive(n-1);else if(e.key==="ArrowRight"){e.preventDefault();setActive((current+1)%3);}else if(e.key==="ArrowLeft"){e.preventDefault();setActive((current+2)%3);}});
  setActive(current);
  requestAnimationFrame(()=>requestAnimationFrame(()=>picker.setAttribute("data-ready","")));
})();
