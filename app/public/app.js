/* 电子军师 App 前端（零依赖 ES module） */

const $ = (sel) => document.querySelector(sel);
const STAGES = ["初识期", "暧昧期", "追求期", "告白确认", "热恋初期", "稳定期", "磨合期", "危机期"];
const OIL_CAPS = [0, 1.5, 2, 2.5, 3.5, 3, 1.5, 0.5];

const state = {
  partners: [],
  slug: null,
  mode: "reply",
  settings: null,
  presets: null,
  attachments: [], // {mediaType, dataBase64, previewUrl}
  sending: false,
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/** 极简 markdown：先抽围栏，再处理行级语法。返回 DOM 节点数组。 */
function renderJunshiMarkdown(raw, container, lintBlocks) {
  container.innerHTML = "";
  const parts = raw.split(/(```(?:reply|strategy)[^\n]*\n[\s\S]*?(?:```|$))/g);
  let replyIdx = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    const fence = part.match(/^```(reply|strategy)[^\n]*\n([\s\S]*?)(?:```|$)$/);
    if (fence) {
      const kind = fence[1];
      const body = fence[2].trim();
      if (kind === "strategy") {
        container.appendChild(el(`<div class="strategy-box">${esc(body)}</div>`));
      } else {
        container.appendChild(renderReplyBlock(body, lintBlocks ? lintBlocks[replyIdx] : null, replyIdx));
        replyIdx++;
      }
      continue;
    }
    // 普通 markdown 文本
    for (const line of part.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("### ")) container.appendChild(el(`<h4>${inline(t.slice(4))}</h4>`));
      else if (t.startsWith("## ")) container.appendChild(el(`<h4>${inline(t.slice(3))}</h4>`));
      else if (t.startsWith("- ")) {
        let ul = container.lastElementChild;
        if (!ul || ul.tagName !== "UL") { ul = el("<ul></ul>"); container.appendChild(ul); }
        ul.appendChild(el(`<li>${inline(t.slice(2))}</li>`));
      } else container.appendChild(el(`<p>${inline(t)}</p>`));
    }
  }
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
}

function renderReplyBlock(text, lintResult, idx) {
  const bubbles = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const block = el(`<div class="reply-block" data-reply-idx="${idx}"></div>`);
  const stack = el(`<div class="reply-bubbles"></div>`);
  for (const b of bubbles) stack.appendChild(el(`<div class="reply-bubble">${esc(b)}</div>`));
  block.appendChild(stack);

  const tools = el(`<div class="reply-tools"></div>`);
  const copyBtn = el(`<button class="mini-btn">复制</button>`);
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(block.dataset.text || text);
    copyBtn.textContent = "已复制";
    setTimeout(() => (copyBtn.textContent = "复制"), 1200);
  };
  tools.appendChild(copyBtn);
  block.dataset.text = text;
  block.appendChild(tools);
  if (lintResult) applyLint(block, lintResult);
  return block;
}

function applyLint(block, lintResult) {
  const tools = block.querySelector(".reply-tools");
  tools.querySelectorAll(".chip, .fix-btn").forEach((n) => n.remove());
  if (lintResult.result === "PASS" && lintResult.warnCount === 0) {
    tools.appendChild(el(`<span class="chip chip-pass" title="voice_lint 全绿">门禁 PASS</span>`));
  } else {
    for (const f of lintResult.findings) {
      const cls = f.level === "FAIL" ? "chip-fail" : "chip-warn";
      tools.appendChild(el(`<span class="chip ${cls}" title="${esc(f.hint)}">${f.level === "FAIL" ? "✕" : "!"} ${esc(f.check)}「${esc(f.text)}」</span>`));
    }
    if (lintResult.failCount > 0) {
      const fixBtn = el(`<button class="mini-btn fix-btn">一键修</button>`);
      fixBtn.onclick = () => reviseBlock(block, lintResult, fixBtn);
      tools.appendChild(fixBtn);
    }
  }
}

async function reviseBlock(block, lintResult, btn) {
  btn.disabled = true;
  btn.textContent = "修改中…";
  try {
    const partner = state.partners.find((p) => p.slug === state.slug);
    const data = await api("/api/revise", {
      method: "POST",
      body: {
        text: block.dataset.text,
        findings: lintResult.findings.map((f) => `${f.check}「${f.text}」：${f.hint}`),
        partnerName: partner?.name ?? "ta",
      },
    });
    block.dataset.text = data.revised;
    const stack = block.querySelector(".reply-bubbles");
    stack.innerHTML = "";
    for (const b of data.revised.split("\n").map((l) => l.trim()).filter(Boolean)) {
      stack.appendChild(el(`<div class="reply-bubble">${esc(b)}</div>`));
    }
    applyLint(block, data.lint);
  } catch (e) {
    alert(`一键修失败：${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "一键修";
  }
}

// ---------------------------------------------------------------------------
// 对象列表
// ---------------------------------------------------------------------------

async function loadPartners(selectSlug) {
  state.partners = await api("/api/partners");
  const list = $("#partner-list");
  list.innerHTML = "";
  for (const p of state.partners) {
    const item = el(`
      <div class="partner-item ${p.slug === (selectSlug ?? state.slug) ? "active" : ""}" data-slug="${p.slug}">
        <div class="partner-avatar">${esc(p.name.slice(0, 1))}</div>
        <div class="partner-info">
          <div class="partner-name">${esc(p.name)}</div>
          <div class="partner-stage">${esc(p.stageName)} · 油上限 ${OIL_CAPS[p.stage]}/5</div>
        </div>
      </div>`);
    item.onclick = () => selectPartner(p.slug);
    list.appendChild(item);
  }
  if (selectSlug) await selectPartner(selectSlug);
  else if (!state.slug && state.partners.length) await selectPartner(state.partners[0].slug);
}

async function selectPartner(slug) {
  state.slug = slug;
  document.querySelectorAll(".partner-item").forEach((n) => n.classList.toggle("active", n.dataset.slug === slug));
  const p = state.partners.find((x) => x.slug === slug);
  if (!p) return;
  $("#chat-name").textContent = p.name;
  $("#chat-sub").textContent = `${p.stageName} · 油腻度上限 ${OIL_CAPS[p.stage]}/5`;
  $("#stage-select").value = String(p.stage);
  $("#anti-simp").checked = p.antiSimp;
  $("#sidebar").classList.remove("open");
  await loadMessages(slug);
}

async function loadMessages(slug) {
  const msgs = await api(`/api/partners/${encodeURIComponent(slug)}/messages`);
  const wrap = $("#messages");
  wrap.innerHTML = "";
  if (!msgs.length) {
    wrap.appendChild(el(`<div class="empty-hint"><div class="empty-logo"></div><p>把 ta 发来的消息贴进下面，军师给你能直接发的回复。</p></div>`));
    return;
  }
  for (const m of msgs) {
    if (m.role === "partner") appendTaMessage(m.text, m.ts);
    else if (m.role === "junshi") {
      const card = appendJunshiCard();
      renderJunshiMarkdown(m.text, card.body, null);
      // 历史消息重跑一次本地展示用 lint（服务端已存原文）
      relintCard(card.body);
      card.metaEl.textContent = new Date(m.ts).toLocaleString();
    }
  }
  wrap.scrollTop = wrap.scrollHeight;
}

function relintCard(container) {
  container.querySelectorAll(".reply-block").forEach(async (block) => {
    try {
      // 历史卡片不重新调 lint 接口的话没有徽章；轻量起见直接调 revise 的 lint？
      // 这里选择静默：历史卡片只保留复制按钮。
    } catch {}
  });
}

function appendTaMessage(text, ts) {
  const wrap = $("#messages");
  $("#empty-hint")?.remove();
  wrap.querySelector(".empty-hint")?.remove();
  const p = state.partners.find((x) => x.slug === state.slug);
  wrap.appendChild(el(`
    <div class="msg msg-ta">
      <div class="avatar">${esc((p?.name ?? "ta").slice(0, 1))}</div>
      <div class="msg-body">
        <div class="msg-meta">ta 发来 · ${ts ? new Date(ts).toLocaleString() : "刚刚"}</div>
        <div class="ta-bubble">${esc(text)}</div>
      </div>
    </div>`));
  wrap.scrollTop = wrap.scrollHeight;
}

function appendJunshiCard() {
  const wrap = $("#messages");
  wrap.querySelector(".empty-hint")?.remove();
  const node = el(`
    <div class="msg msg-junshi">
      <div class="avatar">军</div>
      <div class="msg-body">
        <div class="msg-meta">电子军师</div>
        <div class="junshi-card"></div>
      </div>
    </div>`);
  wrap.appendChild(node);
  wrap.scrollTop = wrap.scrollHeight;
  return { root: node, body: node.querySelector(".junshi-card"), metaEl: node.querySelector(".msg-meta") };
}

// ---------------------------------------------------------------------------
// 发送 + SSE
// ---------------------------------------------------------------------------

async function send() {
  if (state.sending) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  if (!state.slug) { $("#dlg-partner").showModal(); return; }

  state.sending = true;
  $("#btn-send").disabled = true;
  appendTaMessage(text || "[图片]");
  input.value = "";
  autoGrow(input);
  $("#scan-chips").hidden = true;

  const card = appendJunshiCard();
  card.body.innerHTML = `<p class="muted streaming-dot">军师读局中</p>`;

  let raw = "";
  let lintBlocks = null;
  let pendingRender = false;
  const scheduleRender = () => {
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(() => {
      pendingRender = false;
      renderJunshiMarkdown(raw, card.body, lintBlocks);
      const last = card.body.lastElementChild;
      if (last && !lintBlocks) last.classList.add("streaming-dot");
      $("#messages").scrollTop = $("#messages").scrollHeight;
    });
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: state.slug,
        mode: state.mode,
        text,
        images: state.attachments.map((a) => ({ mediaType: a.mediaType, dataBase64: a.dataBase64 })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    clearAttachments();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let event = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const data = JSON.parse(line.slice(5));
          if (event === "meta") renderPanelMeta(data);
          else if (event === "delta") { raw += data.text; scheduleRender(); }
          else if (event === "lint") { lintBlocks = data.blocks; renderPanelLint(data.blocks); scheduleRender(); }
          else if (event === "error") throw new Error(data.message);
        }
      }
    }
    renderJunshiMarkdown(raw, card.body, lintBlocks);
  } catch (e) {
    card.body.classList.add("error-card");
    card.body.innerHTML = `<p>出错了：${esc(String(e.message || e))}</p><p class="muted">检查右下角设置里的供应商和 API key；演示模式不需要 key。</p>`;
  } finally {
    state.sending = false;
    $("#btn-send").disabled = false;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
}

function renderPanelMeta(meta) {
  const laneNames = { A: "日常/分享", B: "情绪事件", C: "试探/冲突", D: "邀约/见面", F: "低兴趣/拉扯" };
  const wrap = $("#panel-meta");
  wrap.classList.remove("muted");
  wrap.innerHTML = "";
  const chips = el(`<div class="panel-chips"></div>`);
  chips.appendChild(el(`<span class="chip chip-info">车道 ${meta.lane} · ${laneNames[meta.lane] ?? ""}</span>`));
  chips.appendChild(el(`<span class="chip chip-plain">${esc(meta.provider)} · ${esc(meta.model ?? "")}</span>`));
  for (const f of meta.loaded) chips.appendChild(el(`<span class="chip chip-plain">${esc(f)}.md</span>`));
  wrap.appendChild(chips);
  if (meta.scan?.length) {
    for (const h of meta.scan) {
      wrap.appendChild(el(`<div class="scan-item"><b>「${esc(h.matched)}」</b> ${esc(h.meaning)}${h.tone ? ` · ${esc(h.tone)}` : ""} <span class="muted">（${esc(h.status)}）</span></div>`));
    }
  } else {
    wrap.appendChild(el(`<p class="muted">梗词典未命中（不代表没梗）。</p>`));
  }
}

function renderPanelLint(blocks) {
  const wrap = $("#panel-lint");
  wrap.classList.remove("muted");
  wrap.innerHTML = "";
  if (!blocks.length) { wrap.innerHTML = `<p class="muted">这次输出里没有可复制回复。</p>`; return; }
  blocks.forEach((b, i) => {
    const cls = b.result === "PASS" ? (b.warnCount ? "chip-warn" : "chip-pass") : "chip-fail";
    const label = b.result === "PASS" ? (b.warnCount ? `PASS（${b.warnCount} 提醒）` : "PASS") : `FAIL ×${b.failCount}`;
    wrap.appendChild(el(`<p>回复 ${i + 1}：<span class="chip ${cls}">${label}</span></p>`));
  });
}

// ---------------------------------------------------------------------------
// 梗扫描（输入实时）
// ---------------------------------------------------------------------------

let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    const text = $("#input").value.trim();
    const box = $("#scan-chips");
    if (text.length < 2) { box.hidden = true; return; }
    try {
      const { hits } = await api("/api/scan", { method: "POST", body: { text } });
      if (!hits.length) { box.hidden = true; return; }
      box.innerHTML = "";
      for (const h of hits) {
        const cls = /过气|慎用/.test(h.status) ? "chip-warn" : "chip-info";
        box.appendChild(el(`<span class="chip ${cls}" title="${esc(h.meaning)}">梗「${esc(h.matched)}」· ${esc(h.status)}</span>`));
      }
      box.hidden = false;
    } catch { box.hidden = true; }
  }, 350);
}

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

function addAttachment(file) {
  if (!file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    const b64 = dataUrl.split(",")[1];
    state.attachments.push({ mediaType: file.type, dataBase64: b64, previewUrl: dataUrl });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

function renderAttachments() {
  const strip = $("#attach-strip");
  strip.innerHTML = "";
  strip.hidden = state.attachments.length === 0;
  state.attachments.forEach((a, i) => {
    const t = el(`<div class="attach-thumb"><img src="${a.previewUrl}"><button title="移除">×</button></div>`);
    t.querySelector("button").onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
    strip.appendChild(t);
  });
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function openSettings() {
  const data = await api("/api/settings");
  state.settings = data;
  state.presets = data.presets;
  renderProviderCards(data.provider);
  $("#dlg-settings").showModal();
}

function renderProviderCards(activeKey) {
  const cards = $("#provider-cards");
  cards.innerHTML = "";
  const order = ["demo", "claude", "deepseek", "glm", "custom"];
  for (const key of order) {
    const preset = state.presets[key];
    if (!preset) continue;
    const c = el(`<button type="button" class="provider-card ${key === activeKey ? "active" : ""}" data-key="${key}">
      ${esc(preset.label)}<small>${key === "demo" ? "不用 key，先体验" : esc(preset.defaultModel || "自填模型名")}</small>
    </button>`);
    c.onclick = () => { renderProviderCards(key); renderProviderFields(key); };
    cards.appendChild(c);
  }
  renderProviderFields(activeKey);
}

function renderProviderFields(key) {
  const wrap = $("#provider-fields");
  wrap.dataset.key = key;
  const preset = state.presets[key];
  const saved = state.settings.providers[key] ?? {};
  if (key === "demo") {
    wrap.innerHTML = `<p class="muted" style="font-size:12.5px">演示模式不联网，回复是内置示例，方便先看界面和流程。</p>`;
    return;
  }
  const modelOptions = preset.models.map((m) => `<option value="${m}" ${saved.model === m ? "selected" : ""}>${m}</option>`).join("");
  wrap.innerHTML = `
    <label class="field"><span>API Key${preset.keyUrl ? `（<a href="${preset.keyUrl}" target="_blank">去获取</a>）` : ""}</span>
      <input id="sf-key" type="password" placeholder="sk-…" value="${esc(saved.apiKey ?? "")}"></label>
    <label class="field"><span>模型</span>
      ${preset.models.length
        ? `<select id="sf-model" class="select" style="width:100%">${modelOptions}</select>`
        : `<input id="sf-model" type="text" placeholder="模型名" value="${esc(saved.model ?? "")}">`}
    </label>
    ${key === "custom" ? `<label class="field"><span>Base URL（OpenAI 兼容，如 https://api.example.com/v1）</span>
      <input id="sf-base" type="text" value="${esc(saved.baseUrl ?? "")}"></label>` : ""}
    ${key === "deepseek" ? `<p class="muted" style="font-size:12px">DeepSeek 暂不支持看图，发截图请换 Claude 或 GLM-4V。</p>` : ""}
  `;
}

async function saveSettings() {
  const key = $("#provider-fields").dataset.key;
  const patch = { provider: key, providers: {} };
  if (key !== "demo") {
    patch.providers[key] = {
      apiKey: $("#sf-key")?.value?.trim() || undefined,
      model: $("#sf-model")?.value?.trim() || undefined,
      baseUrl: $("#sf-base")?.value?.trim() || undefined,
    };
  }
  await api("/api/settings", { method: "POST", body: patch });
  await refreshProviderPill();
}

async function refreshProviderPill() {
  const s = await api("/api/settings");
  state.settings = s;
  state.presets = s.presets;
  const label = s.presets[s.provider]?.label ?? s.provider;
  const model = s.providers[s.provider]?.model;
  $("#provider-label").textContent = s.provider === "demo" ? "演示模式（点此配置模型）" : `${label} · ${model ?? ""}`;
}

// ---------------------------------------------------------------------------
// 事件绑定与启动
// ---------------------------------------------------------------------------

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

function bind() {
  // 阶段下拉
  const stageSel = $("#stage-select");
  const npStage = $("#np-stage");
  STAGES.forEach((name, i) => {
    stageSel.appendChild(el(`<option value="${i}">${i} ${name}</option>`));
    npStage.appendChild(el(`<option value="${i}" ${i === 1 ? "selected" : ""}>${i} ${name}（油上限 ${OIL_CAPS[i]}/5）</option>`));
  });
  stageSel.onchange = async () => {
    if (!state.slug) return;
    await api(`/api/partners/${encodeURIComponent(state.slug)}`, { method: "POST", body: { stage: Number(stageSel.value) } });
    await loadPartners(state.slug);
  };
  $("#anti-simp").onchange = async (e) => {
    if (!state.slug) return;
    await api(`/api/partners/${encodeURIComponent(state.slug)}`, { method: "POST", body: { antiSimp: e.target.checked } });
    await loadPartners(state.slug);
  };

  // 新建对象
  $("#btn-new-partner").onclick = () => { $("#np-name").value = ""; $("#dlg-partner").showModal(); };
  $("#np-create").onclick = async (e) => {
    const name = $("#np-name").value.trim();
    if (!name) { e.preventDefault(); $("#np-name").focus(); return; }
    const meta = await api("/api/partners", {
      method: "POST",
      body: { name, stage: Number($("#np-stage").value), antiSimp: $("#np-antisimp").checked },
    });
    await loadPartners(meta.slug);
  };

  // 模式
  $("#mode-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-tab");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".mode-tab").forEach((n) => n.classList.toggle("active", n === btn));
    $("#btn-send").textContent = { reply: "出方案", analyze: "分析", ask: "评估", interest: "判断" }[state.mode];
    $("#input").placeholder = {
      reply: "贴 ta 发来的消息，或描述情况…（Enter 发送，Shift+Enter 换行）",
      analyze: "贴 ta 的消息，只做解读不给回复",
      ask: "写下你想发的话，军师告诉你行不行、怎么改",
      interest: "描述最近的互动，或贴几段聊天，军师给四维兴趣判断",
    }[state.mode];
  });

  // 输入
  const input = $("#input");
  input.addEventListener("input", () => { autoGrow(input); scheduleScan(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener("paste", (e) => {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.type.startsWith("image/")) { addAttachment(item.getAsFile()); e.preventDefault(); }
    }
  });
  $("#btn-send").onclick = send;
  $("#btn-attach").onclick = () => $("#file-input").click();
  $("#file-input").onchange = (e) => { for (const f of e.target.files) addAttachment(f); e.target.value = ""; };

  // 设置
  $("#btn-settings").onclick = openSettings;
  $("#settings-save").onclick = async () => { await saveSettings(); };

  // 移动端抽屉
  $("#btn-sidebar").onclick = () => $("#sidebar").classList.toggle("open");
  $("#btn-panel").onclick = () => $("#panel").classList.toggle("open");
}

async function main() {
  bind();
  await refreshProviderPill();
  await loadPartners();
}

main();
