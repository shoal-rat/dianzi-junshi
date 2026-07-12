/* 电子军师 App 前端（零依赖 ES module） */

const $ = (sel) => document.querySelector(sel);
const STAGES = ["初识期", "暧昧期", "追求期", "告白确认", "热恋初期", "稳定期", "磨合期", "危机期"];
const STAGE_OPTIONS = ["刚认识 / 还不熟", "有点熟 / 还没确定", "正在主动了解", "准备确认关系", "刚在一起", "稳定相处", "最近在磨合", "关系有点紧张"];
const OIL_CAPS = [0, 1.5, 2, 2.5, 3.5, 3, 1.5, 0.5];

const PLANNING_LEVELS = ["fast", "balanced", "deep"];
const PLANNING_LABELS = { fast: "快速", balanced: "平衡", deep: "深入" };
// 胆量按档位命名——用户选的是态度，不是数字
const BOLDNESS_GEARS = [
  { label: "很稳", value: .1 },
  { label: "偏稳", value: .3 },
  { label: "平衡", value: .5 },
  { label: "偏敢", value: .7 },
  { label: "放胆冲", value: .9 },
];
function nearestGear(boldness) {
  let best = 2;
  BOLDNESS_GEARS.forEach((gear, index) => {
    if (Math.abs(gear.value - boldness) < Math.abs(BOLDNESS_GEARS[best].value - boldness)) best = index;
  });
  return best;
}

const state = {
  partners: [],
  slug: null,
  mode: "reply",
  planningMode: localStorage.getItem("dj-planning-mode") || "balanced",
  boldness: 50,
  boldnessTimer: null,
  settings: null,
  presets: null,
  attachments: [], // {mediaType, dataBase64, previewUrl}
  profileAttachments: [],
  localStatus: null,
  activeMaterialJobId: null,
  materialPollTimer: null,
  materialProgressDismissed: false,
  selectedReply: "",
  selectedDecision: null,
  currentDecision: null,
  adaptiveProfile: null,
  sending: false,
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

let toastTimer = null;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

function showFormError(selector, message) {
  const node = $(selector);
  node.textContent = message;
  node.hidden = !message;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
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
  const copyBtn = el(`<button class="mini-btn">复制这句</button>`);
  copyBtn.onclick = async () => {
    await copyText(block.dataset.text || text);
    copyBtn.textContent = "已复制，可以去粘贴了";
    setTimeout(() => (copyBtn.textContent = "复制这句"), 1600);
  };
  tools.appendChild(copyBtn);
  const feedbackBtn = el(`<button class="mini-btn feedback-btn">记录后来结果</button>`);
  feedbackBtn.onclick = () => openFeedback(block.dataset.text || text, block);
  tools.appendChild(feedbackBtn);
  block.dataset.text = text;
  if (state.currentDecision) {
    block.dataset.decisionId = state.currentDecision.id;
    block.dataset.strategyId = state.currentDecision.selectedStrategy?.id || "";
    block.dataset.replyId = state.currentDecision.replyId || "";
  }
  block.appendChild(tools);
  if (lintResult) applyLint(block, lintResult);
  return block;
}

function applyLint(block, lintResult) {
  const tools = block.querySelector(".reply-tools");
  tools.querySelectorAll(".chip, .fix-btn").forEach((n) => n.remove());
  if (lintResult.result === "PASS" && lintResult.warnCount === 0) {
    tools.appendChild(el(`<span class="chip chip-pass">✓ 发送前检查通过</span>`));
  } else {
    for (const f of lintResult.findings) {
      const cls = f.level === "FAIL" ? "chip-fail" : "chip-warn";
      tools.appendChild(el(`<span class="chip ${cls}" title="${esc(f.hint)}">${f.level === "FAIL" ? "✕" : "!"} ${esc(f.check)}「${esc(f.text)}」</span>`));
    }
    if (lintResult.failCount > 0) {
      const fixBtn = el(`<button class="mini-btn fix-btn">帮我改自然一点</button>`);
      fixBtn.onclick = () => reviseBlock(block, lintResult, fixBtn);
      tools.appendChild(fixBtn);
    }
  }
}

async function reviseBlock(block, lintResult, btn) {
  btn.disabled = true;
  btn.textContent = "正在改…";
  try {
    const partner = state.partners.find((p) => p.slug === state.slug);
    const data = await api("/api/revise", {
      method: "POST",
      body: {
        text: block.dataset.text,
        findings: lintResult.findings.map((f) => `${f.check}「${f.text}」：${f.hint}`),
        partnerName: partner?.name ?? "ta",
        slug: state.slug,
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
    toast(`没改成功：${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "帮我改自然一点";
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
          <div class="partner-stage">${esc(STAGE_OPTIONS[p.stage] ?? p.stageName)}</div>
        </div>
      </div>`);
    item.onclick = () => selectPartner(p.slug);
    list.appendChild(item);
  }
  if (selectSlug) await selectPartner(selectSlug);
  else if (!state.slug && state.partners.length) await selectPartner(state.partners[0].slug);
  else if (!state.partners.length) {
    state.slug = null;
    $("#stage-select").disabled = true;
    $("#anti-simp").disabled = true;
    $("#boldness-slider").disabled = true;
  }
}

async function selectPartner(slug) {
  state.slug = slug;
  document.querySelectorAll(".partner-item").forEach((n) => n.classList.toggle("active", n.dataset.slug === slug));
  const p = state.partners.find((x) => x.slug === slug);
  if (!p) return;
  $("#chat-name").textContent = p.name;
  $("#chat-sub").textContent = `${STAGE_OPTIONS[p.stage] ?? p.stageName} · 我会按这个进度控制分寸`;
  $("#stage-select").disabled = false;
  $("#anti-simp").disabled = false;
  $("#stage-select").value = String(p.stage);
  $("#anti-simp").checked = p.antiSimp;
  const gear = nearestGear(p.boldness ?? .5);
  state.boldness = BOLDNESS_GEARS[gear].value;
  $("#boldness-slider").disabled = false;
  $("#boldness-slider").value = String(gear);
  $("#boldness-value").textContent = BOLDNESS_GEARS[gear].label;
  $("#sidebar").classList.remove("open");
  closeDrawers();
  await loadMessages(slug);
  void loadAdaptiveProfile(slug);
  void loadDecisionInsights(slug);
  void loadLatestDecision(slug);
  void restoreMaterialProgress(slug);
}

/** The decision panel (and its network graph) survives reloads: bring back the
 * most recent report for this profile. `#thinking` deep-links straight to it. */
async function loadLatestDecision(slug) {
  try {
    const data = await api(`/api/partners/${encodeURIComponent(slug)}/decisions/latest`);
    const report = data.report ?? data;
    if (!report?.selectedStrategy || state.slug !== slug) return;
    state.currentDecision = state.currentDecision ?? report;
    renderDecisionPanel(report);
    if (window.location.hash.includes("thinking")) openThinking();
  } catch { /* no decision yet */ }
}

async function loadAdaptiveProfile(slug) {
  const wrap = $("#panel-adaptive");
  try {
    const profile = await api(`/api/partners/${encodeURIComponent(slug)}/adaptive-profile`);
    state.adaptiveProfile = profile;
    wrap.classList.remove("muted");
    wrap.innerHTML = "";
    if (!profile.feedbackCount) {
      wrap.classList.add("muted");
      wrap.textContent = "发出建议后，点「记录后来结果」。有了真实反馈，军师才会逐渐分清 ta 的短期变化和长期习惯。";
      return;
    }
    wrap.appendChild(el(`<p>${esc(profile.summary)}</p>`));
    const changing = profile.traits.filter((trait) => trait.changing && trait.confidence >= 0.3);
    if (changing.length) wrap.appendChild(el(`<p class="adaptive-change">最近可能在变化：${esc(changing.map((x) => x.label).join("、"))}</p>`));
    const learned = profile.strategies.filter((x) => x.confidence >= 0.18).sort((a, b) => b.multiplier - a.multiplier).slice(0, 3);
    if (learned.length) {
      const chips = el(`<div class="panel-chips"></div>`);
      for (const item of learned) chips.appendChild(el(`<span class="chip chip-info">${esc(item.label)} · ${item.multiplier >= 1 ? "较合适" : "少一点"}</span>`));
      wrap.appendChild(chips);
    }
    const evidence = profile.actionEvidenceWeight > profile.responseEvidenceWeight + 0.12
      ? "目前更应该看 ta 有没有实际行动。"
      : "目前文字和行动的可信度接近，继续观察一致性。";
    wrap.appendChild(el(`<p>${evidence}</p>`));
  } catch {
    wrap.textContent = "暂时读不到变化画像，不影响继续聊天。";
  }
}

const STRATEGY_NAMES = { mirror: "顺着节奏", warm: "先接住感受", playful: "轻松接梗", direct: "直接说清楚",
  invite: "轻量邀约", clarify: "问一个关键问题", give_space: "留一点空间", seek_more_context: "先补信息", unknown: "未关联旧记录" };

async function loadDecisionInsights(slug) {
  const performanceWrap = $("#panel-performance");
  const patternWrap = $("#panel-patterns");
  try {
    const [performance, patterns, graph] = await Promise.all([
      api(`/api/partners/${encodeURIComponent(slug)}/strategy-performance`),
      api(`/api/partners/${encodeURIComponent(slug)}/patterns`),
      api(`/api/partners/${encodeURIComponent(slug)}/evidence-graph`),
    ]);
    performanceWrap.innerHTML = "";
    if (!performance.totalOutcomes) {
      performanceWrap.classList.add("muted");
      performanceWrap.textContent = "还没有真实结果。发出建议后点「记录后来结果」，这里才会开始学习。";
    } else {
      performanceWrap.classList.remove("muted");
      performanceWrap.appendChild(el(`<p>已关联 ${performance.totalOutcomes} 次真实结果。样本少时先看趋势。</p>`));
      for (const item of performance.strategies.slice(0, 7)) {
        const trend = item.trend === null ? "样本还少" : item.trend > .08 ? "最近更顺" : item.trend < -.08 ? "最近变弱" : "最近稳定";
        performanceWrap.appendChild(el(`<div class="performance-row"><div><b>${esc(STRATEGY_NAMES[item.family] || item.family)}</b><span>${item.samples} 次 · ${trend}</span></div><i>${Math.round(item.score * 100)}</i><em style="--score:${Math.round(item.score * 100)}%"></em></div>`));
      }
    }
    patternWrap.innerHTML = "";
    const visiblePatterns = patterns.filter((item) => item.lifecycle !== "rejected");
    if (!visiblePatterns.length) {
      patternWrap.classList.add("muted");
      patternWrap.textContent = `还没有达到展示门槛的模式。证据图已保存 ${graph.nodes.length} 个节点、${graph.edges.length} 条关系。`;
    } else {
      patternWrap.classList.remove("muted");
      patternWrap.appendChild(el(`<p>证据图：${graph.nodes.length} 个节点 · ${graph.edges.length} 条可追溯关系</p>`));
      for (const item of visiblePatterns.slice(0, 6)) {
        const row = el(`<div class="pattern-row"><div><b>${esc(item.label)}</b><small>${item.support} 次支持 · ${item.counterexamples} 个反例 · 置信度 ${Math.round(item.confidence * 100)}%</small></div><select class="select" aria-label="${esc(item.label)}的使用状态"><option value="active">用于规划</option><option value="watch">继续观察</option><option value="candidate">样本不足</option><option value="retired">暂停使用</option><option value="rejected">不适用</option></select></div>`);
        const select = row.querySelector("select");
        select.value = item.lifecycle || "candidate";
        select.onchange = async () => {
          select.disabled = true;
          try {
            await api(`/api/partners/${encodeURIComponent(slug)}/patterns/${encodeURIComponent(item.id)}/lifecycle`, { method: "POST", body: { lifecycle: select.value } });
            toast("这个模式的使用状态已更新");
          } catch (error) { toast(friendlyError(error)); select.value = item.lifecycle || "candidate"; }
          finally { select.disabled = false; }
        };
        patternWrap.appendChild(row);
      }
    }
  } catch {
    performanceWrap.textContent = "暂时读不到策略历史，不影响继续使用。";
    patternWrap.textContent = "暂时读不到模式记录，不影响继续使用。";
  }
}

function openFeedback(replyText, block = null) {
  if (!state.slug) return;
  state.selectedReply = replyText;
  state.selectedDecision = block ? {
    decisionId: block.dataset.decisionId || undefined,
    strategyId: block.dataset.strategyId || undefined,
    replyId: block.dataset.replyId || undefined,
  } : null;
  $("#feedback-reply").textContent = replyText;
  $("#feedback-response").value = "";
  $("#feedback-delay").value = "6";
  document.querySelectorAll("#feedback-form input[type=radio], #feedback-form input[type=checkbox]").forEach((input) => { input.checked = false; });
  showFormError("#feedback-error", "");
  $("#dlg-feedback").showModal();
}

async function loadMessages(slug) {
  state.currentDecision = null;
  const msgs = await api(`/api/partners/${encodeURIComponent(slug)}/messages`);
  const wrap = $("#messages");
  wrap.innerHTML = "";
  if (!msgs.length) {
    wrap.appendChild(el(`<div class="welcome-card"><div class="welcome-mark">${esc((state.partners.find((p) => p.slug === slug)?.name ?? "ta").slice(0, 1))}</div><p class="eyebrow">档案建好了</p><h1>先贴一段聊天吧</h1><p>文字、截图都可以。只要告诉我「这是 ta 发的」还是「这是我想发的」，剩下的交给我。</p><p class="privacy-line">第一次不需要把所有背景都说完整，之后可以慢慢补</p></div>`));
    return;
  }
  const contexts = msgs.filter((m) => m.mode === "context");
  if (contexts.length) {
    const imageCount = contexts.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);
    wrap.appendChild(el(`<div class="context-message">✓ 已带入创建档案时的 ${contexts.length} 段背景资料${imageCount ? `和 ${imageCount} 张截图` : ""}。原文保存在本机，需要时会自动找相关内容。</div>`));
  }
  for (const m of msgs) {
    if (m.role === "partner") appendTaMessage(m.text, m.ts, m.attachments, slug);
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

function appendTaMessage(text, ts, attachments = [], slug = state.slug) {
  const wrap = $("#messages");
  $("#empty-hint")?.remove();
  wrap.querySelector(".empty-hint")?.remove();
  const p = state.partners.find((x) => x.slug === state.slug);
  const node = el(`
    <div class="msg msg-ta">
      <div class="avatar">${esc((p?.name ?? "ta").slice(0, 1))}</div>
      <div class="msg-body">
        <div class="msg-meta">ta 发来 · ${ts ? new Date(ts).toLocaleString() : "刚刚"}</div>
        <div class="ta-bubble">${esc(text)}</div>
      </div>
    </div>`);
  if (attachments.length) {
    const images = el(`<div class="message-images"></div>`);
    for (const a of attachments) {
      const src = a.previewUrl || `/api/partners/${encodeURIComponent(slug)}/imports/${encodeURIComponent(a.fileName)}`;
      const img = el(`<img src="${esc(src)}" alt="${esc(a.name || "聊天截图")}">`);
      img.onclick = () => window.open(src, "_blank", "noopener");
      images.appendChild(img);
    }
    node.querySelector(".msg-body").appendChild(images);
  }
  wrap.appendChild(node);
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

function friendlyError(error) {
  const message = String(error?.message || error || "");
  if (/login|登录|auth|credential/i.test(message)) return `${message} 登录好后不用重启本页，直接再试一次。`;
  if (/API key|401|unauthorized/i.test(message)) return "这个 API 连接还没填好 Key。点左下角的 AI 连接检查一下，或者改用已登录的 Codex / Claude Code。";
  if (/fetch|network|连接|ECONN/i.test(message)) return "这次没连上 AI。网络恢复后再点一次，你刚才的文字和截图还在。";
  return message || "这次没有成功。你刚才的内容还在，可以直接再试一次。";
}

async function send() {
  if (state.sending) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  if (!state.slug) { openPartnerDialog(); return; }

  state.sending = true;
  $("#btn-send").disabled = true;
  $("#btn-send").textContent = "正在读…";
  const sentAttachments = [...state.attachments];
  appendTaMessage(text || `[截图 ×${sentAttachments.length}]`, null, sentAttachments);
  input.value = "";
  autoGrow(input);
  $("#scan-chips").hidden = true;

  const card = appendJunshiCard();
  card.body.innerHTML = `<p class="muted"><span class="streaming-dot">军师读局中</span> · <button type="button" class="thinking-link">看它的决策网络</button></p>`;
  card.body.querySelector(".thinking-link").onclick = openThinking;

  let raw = "";
  let lintBlocks = null;
  let completed = false;
  let finished = false;
  let pendingRender = false;
  const scheduleRender = () => {
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(() => {
      pendingRender = false;
      if (finished) return; // the final synchronous render already ran
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
        planningMode: state.planningMode,
        text,
        images: sentAttachments.map((a) => ({ name: a.name, mediaType: a.mediaType, dataBase64: a.dataBase64 })),
      }),
    });
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).error || detail; } catch {}
      throw new Error(detail);
    }

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
          if (event === "meta") {
            state.currentDecision = data.decision || null;
            renderPanelMeta(data);
            renderDecisionPanel(data.decision);
          }
          else if (event === "delta") { raw += data.text; scheduleRender(); }
          else if (event === "lint") { lintBlocks = data.blocks; renderPanelLint(data.blocks); scheduleRender(); }
          else if (event === "done") {
            completed = true;
            state.currentDecision = state.currentDecision || data;
          }
          else if (event === "error") throw new Error(data.message);
        }
      }
    }
    finished = true;
    renderJunshiMarkdown(raw, card.body, lintBlocks);
    if (state.currentDecision) {
      const thinkBtn = el(`<button class="mini-btn">🧠 思考过程与决策网络</button>`);
      thinkBtn.onclick = openThinking;
      card.body.appendChild(thinkBtn);
    }
    if (completed) clearAttachments();
  } catch (e) {
    card.body.classList.add("error-card");
    card.body.innerHTML = `<p><b>这次没接上</b></p><p>${esc(friendlyError(e))}</p>`;
    if (!input.value && text) { input.value = text; autoGrow(input); }
  } finally {
    state.sending = false;
    $("#btn-send").disabled = false;
    updateModeCopy();
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
}

function renderPanelMeta(meta) {
  const laneNames = { A: "日常聊天或分享", B: "对方在表达情绪", C: "有试探、误会或冲突", D: "涉及邀约或见面", F: "互动偏冷，需要先观察" };
  const wrap = $("#panel-meta");
  wrap.classList.remove("muted");
  wrap.innerHTML = "";
  const chips = el(`<div class="panel-chips"></div>`);
  chips.appendChild(el(`<span class="chip chip-info">理解为：${laneNames[meta.lane] ?? "普通聊天"}</span>`));
  const providerName = state.presets?.[meta.provider]?.label ?? meta.provider;
  chips.appendChild(el(`<span class="chip chip-plain">由 ${esc(providerName.replace(/（.*?）/g, "").trim())} 帮你看</span>`));
  wrap.appendChild(chips);
  if (meta.context) {
    const c = meta.context;
    wrap.appendChild(el(`<p>这次参考了最近 ${c.recent} 条记录${c.relevant ? `，还找回 ${c.relevant} 条相关旧内容` : ""}。${c.omitted ? `其余 ${c.omitted} 条原文仍保存在本机。` : ""}</p>`));
    if (c.materialsIndexed) {
      wrap.appendChild(el(`<p>素材记忆库里有 ${c.materialsIndexed} 张已整理截图；这次按语义向量、人物和事件线索找回 ${c.materialsRetrieved} 张。</p>`));
    }
    if (c.feedbackCount) {
      const comparison = c.actionEvidenceWeight > c.responseEvidenceWeight + 0.12 ? "这次会更重视实际行动" : "这次会同时参考表达和行动";
      wrap.appendChild(el(`<p>已经参考 ${c.feedbackCount} 次真实后续反馈；${comparison}。变化画像会随时间衰减，新结果权重更高。</p>`));
    }
  }
  if (meta.scan?.length) {
    for (const h of meta.scan) {
      wrap.appendChild(el(`<div class="scan-item"><b>「${esc(h.matched)}」</b><br>${esc(h.meaning)}${h.tone ? ` · ${esc(h.tone)}` : ""}</div>`));
    }
  } else {
    wrap.appendChild(el(`<p class="muted">没有发现需要单独解释的网络用语；如果语气有歧义，回复里会说明。</p>`));
  }
}

function renderPanelLint(blocks) {
  const wrap = $("#panel-lint");
  wrap.classList.remove("muted");
  wrap.innerHTML = "";
  if (!blocks.length) { wrap.innerHTML = `<p class="muted">这次是分析，没有生成要发给 ta 的话。</p>`; return; }
  blocks.forEach((b, i) => {
    const cls = b.result === "PASS" ? (b.warnCount ? "chip-warn" : "chip-pass") : "chip-fail";
    const label = b.result === "PASS" ? (b.warnCount ? `${b.warnCount} 个小提醒` : "读起来比较自然") : `${b.failCount} 处建议先改`;
    wrap.appendChild(el(`<p>第 ${i + 1} 个说法：<span class="chip ${cls}">${label}</span></p>`));
  });
}

// ---------------------------------------------------------------------------
// 决策网络图：引擎本轮真实计算的数据流，节点可点击查看参数
// ---------------------------------------------------------------------------

function renderNetworkGraph(trace, container) {
  container.innerHTML = "";
  if (!trace?.layers?.length) return;
  const layers = trace.layers.filter((layer) => layer.nodes.length);
  const colWidth = 92;
  const rowHeight = 40;
  const padX = 46;
  const padY = 30;
  const width = padX * 2 + (layers.length - 1) * colWidth;
  const maxRows = Math.max(...layers.map((layer) => layer.nodes.length));
  const height = padY * 2 + Math.max(1, maxRows - 1) * rowHeight;
  const pos = new Map();
  layers.forEach((layer, col) => {
    const x = padX + col * colWidth;
    const span = (layer.nodes.length - 1) * rowHeight;
    const top = padY + (height - padY * 2 - span) / 2;
    layer.nodes.forEach((node, row) => pos.set(node.id, { x, y: top + row * rowHeight, node }));
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#177766";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e79a43";

  const edgeEls = [];
  for (const edge of trace.edges) {
    const a = pos.get(edge.from);
    const b = pos.get(edge.to);
    if (!a || !b) continue;
    const path = document.createElementNS(svgNS, "path");
    const mx = (a.x + b.x) / 2;
    path.setAttribute("d", `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute("class", "trace-edge");
    path.setAttribute("stroke", edge.weight >= 0 ? brand : accent);
    path.setAttribute("stroke-width", String(.6 + Math.abs(edge.weight) * 2.6));
    path.style.opacity = String(.14 + Math.abs(edge.weight) * .5);
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    svg.appendChild(path);
    edgeEls.push(path);
  }

  layers.forEach((layer, col) => {
    const title = document.createElementNS(svgNS, "text");
    title.setAttribute("x", String(padX + col * colWidth));
    title.setAttribute("y", "13");
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("class", "layer-title");
    title.textContent = layer.label;
    svg.appendChild(title);
  });

  const detail = el(`<div class="network-detail" hidden></div>`);
  const nodeEls = new Map();
  for (const { x, y, node } of pos.values()) {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "trace-node");
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(3.4 + Math.min(1, Math.abs(node.activation)) * 4.6));
    circle.setAttribute("fill", node.activation >= 0 ? brand : accent);
    circle.style.opacity = String(.38 + Math.min(1, Math.abs(node.activation)) * .62);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y + 17));
    text.setAttribute("text-anchor", "middle");
    text.textContent = node.label;
    g.appendChild(circle);
    g.appendChild(text);
    g.onclick = () => {
      const selected = g.classList.contains("selected");
      svg.querySelectorAll(".trace-node.selected").forEach((n) => n.classList.remove("selected"));
      edgeEls.forEach((e) => e.classList.remove("dimmed"));
      if (selected) { detail.hidden = true; return; }
      g.classList.add("selected");
      edgeEls.forEach((e) => e.classList.toggle("dimmed", e.dataset.from !== node.id && e.dataset.to !== node.id));
      const inbound = trace.edges.filter((e) => e.to === node.id).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5);
      const outbound = trace.edges.filter((e) => e.from === node.id).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5);
      const nodeLabel = (id) => { const p = pos.get(id); return p ? p.node.label : id; };
      detail.innerHTML = `<b>${esc(node.label)} · 激活 ${node.activation.toFixed(2)}</b>
        ${node.detail.map((line) => `<div>${esc(line)}</div>`).join("")}
        ${inbound.length ? `<ul>${inbound.map((e) => `<li>← ${esc(nodeLabel(e.from))} · 权重 ${e.weight.toFixed(2)}</li>`).join("")}</ul>` : ""}
        ${outbound.length ? `<ul>${outbound.map((e) => `<li>→ ${esc(nodeLabel(e.to))} · 权重 ${e.weight.toFixed(2)}</li>`).join("")}</ul>` : ""}`;
      detail.hidden = false;
    };
    svg.appendChild(g);
    nodeEls.set(node.id, g);
  }

  const graphBox = el(`<div class="network-graph"></div>`);
  graphBox.appendChild(svg);
  graphBox.appendChild(el(`<div class="network-legend">
    <i><span class="swatch" style="background:${brand}"></span>正向权重 / 激活</i>
    <i><span class="swatch" style="background:${accent}"></span>负向权重 / 激活</i>
    <i>粗细 = 贡献强度 · 点节点看参数</i>
  </div>`));
  container.appendChild(graphBox);
  container.appendChild(detail);
}

function openThinking() {
  if (window.matchMedia("(max-width: 1120px)").matches) openDrawer("#panel");
  const details = $("#decision-details");
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDecisionPanel(report) {
  const wrap = $("#panel-decision");
  wrap.innerHTML = "";
  renderNetworkGraph(report?.networkTrace, $("#panel-network"));
  if (!report) { wrap.textContent = "这次没有可显示的决策记录。"; return; }
  wrap.classList.remove("muted");
  const uncertainty = Math.round((report.uncertainty?.total || 0) * 100);
  const modeLabel = PLANNING_LABELS[report.planningMode] || report.planningMode;
  wrap.appendChild(el(`<div class="decision-callout"><b>最后选择：${esc(report.selectedStrategy.label)}</b><span>不确定性 ${uncertainty}% · ${esc(modeLabel)}</span><p>${esc(report.selectionReason)}</p></div>`));

  const beliefs = report.beliefs.filter((item) => item.confidence >= .18 || item.changing).sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  if (beliefs.length) {
    wrap.appendChild(el(`<h5>当前状态（带置信度）</h5>`));
    for (const item of beliefs) {
      const row = el(`<div class="belief-row"><span>${esc(beliefLabel(item.dimension))}${item.changing ? " · 近期变化" : ""}</span><i>${Math.round(item.confidence * 100)}%</i><b style="--value:${Math.round((item.mean + 1) * 50)}%"></b></div>`);
      wrap.appendChild(row);
    }
  }
  wrap.appendChild(el(`<h5>仍在比较的解释</h5>`));
  for (const item of report.hypotheses.slice(0, 4)) {
    wrap.appendChild(el(`<p><b>${Math.round(item.probability * 100)}% · ${esc(item.label)}</b><br><span class="muted">${esc(item.explanation)}</span></p>`));
  }
  if (report.patterns?.length) {
    wrap.appendChild(el(`<h5>从真实结果里发现的模式</h5>`));
    for (const item of report.patterns.slice(0, 3)) wrap.appendChild(el(`<p>${item.validated ? "✓" : "样本少"} · ${esc(item.label)}（${item.support} 支持 / ${item.counterexamples} 反例）</p>`));
  }
  wrap.appendChild(el(`<h5>比较过的方案</h5>`));
  for (const item of [...report.strategies].sort((a, b) => b.score - a.score).slice(0, 6)) {
    const selected = item.id === report.selectedStrategy.id;
    wrap.appendChild(el(`<div class="strategy-row ${selected ? "selected" : ""}"><b>${selected ? "✓ " : ""}${esc(item.label)}</b><span>${Math.round(item.score * 100)} 分</span><small>${esc(item.risk)}</small></div>`));
  }
  const evidence = report.evidence?.slice(0, 6) || [];
  if (evidence.length) {
    wrap.appendChild(el(`<h5>本轮采用的证据</h5>`));
    const list = el("<ul class=\"evidence-list\"></ul>");
    for (const item of evidence) list.appendChild(el(`<li>${esc(item.text)} <small>${Math.round(item.reliability * 100)}% 可靠</small></li>`));
    wrap.appendChild(list);
  }
  const clocks = report.timescales ? ` · 节奏自适应 τ ${report.timescales.shortDays}/${report.timescales.longDays} 天` : "";
  wrap.appendChild(el(`<p class="decision-metrics">本地规划 ${Math.round(report.metrics.durationMs)}ms · 检索 ${report.metrics.evidenceSelected}/${report.metrics.evidenceScanned} 条证据 · 模拟 ${report.metrics.simulationCount} 个分支${clocks}</p>`));
}

function beliefLabel(key) {
  return ({ engagement: "互动投入", trust: "信任", communication_willingness: "沟通意愿",
    emotional_pressure: "情绪压力", boundary_sensitivity: "戒备程度", commitment_reliability: "承诺可靠",
    momentum: "互动势头", initiative: "主动程度", consistency: "一致性" })[key] || key;
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

function addImageFile(file, target, onChange) {
  if (!file || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    toast("请选择 PNG、JPG、WebP 或 GIF 图片");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    const b64 = dataUrl.split(",")[1];
    target.push({ name: file.name, mediaType: file.type, dataBase64: b64, previewUrl: dataUrl });
    onChange();
  };
  reader.readAsDataURL(file);
}

function addAttachment(file) {
  addImageFile(file, state.attachments, renderAttachments);
}

function addProfileAttachment(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    toast("不是支持的图片，已跳过");
    return;
  }
  state.profileAttachments.push({
    file,
    name: file.name,
    mediaType: file.type,
    previewUrl: URL.createObjectURL(file),
  });
  renderProfileAttachments();
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

function renderProfileAttachments() {
  const strip = $("#np-file-list");
  strip.innerHTML = "";
  strip.hidden = state.profileAttachments.length === 0;
  if (state.profileAttachments.length) {
    strip.appendChild(el(`<div class="import-count">已选择 ${state.profileAttachments.length} 张。点「建好并开始」后会逐个上传、逐张整理，进度可以随时收起。</div>`));
  }
  state.profileAttachments.slice(0, 12).forEach((a, i) => {
    const t = el(`<div class="attach-thumb"><img src="${a.previewUrl}" alt="${esc(a.name)}"><button type="button" title="移除">×</button></div>`);
    t.querySelector("button").onclick = () => {
      const [removed] = state.profileAttachments.splice(i, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderProfileAttachments();
    };
    strip.appendChild(t);
  });
  if (state.profileAttachments.length > 12) {
    strip.appendChild(el(`<div class="attach-thumb"><div class="more-files">＋${state.profileAttachments.length - 12}</div></div>`));
  }
}

function clearProfileAttachments() {
  for (const item of state.profileAttachments) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  state.profileAttachments = [];
  renderProfileAttachments();
}

// ---------------------------------------------------------------------------
// 批量素材：逐个流式上传，后台逐张分析，任务可在关闭弹窗后继续
// ---------------------------------------------------------------------------

function renderMaterialProgress({ percent, title, count, detail, actionLabel = "", action = null }) {
  const wrap = $("#material-progress");
  if (state.materialProgressDismissed) return;
  wrap.hidden = false;
  $("#material-progress-title").textContent = title;
  $("#material-progress-count").textContent = count;
  $("#material-progress-detail").textContent = detail;
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $("#material-progress-bar").style.width = `${value}%`;
  wrap.querySelector("[role=progressbar]").setAttribute("aria-valuenow", String(Math.round(value)));
  const actionBtn = $("#material-progress-action");
  actionBtn.hidden = !actionLabel;
  actionBtn.textContent = actionLabel;
  actionBtn.onclick = action;
}

function scheduleMaterialPoll(slug, jobId, delay = 900) {
  clearTimeout(state.materialPollTimer);
  state.materialPollTimer = setTimeout(() => pollMaterialJob(slug, jobId), delay);
}

async function pollMaterialJob(slug, jobId) {
  try {
    const job = await api(`/api/partners/${encodeURIComponent(slug)}/material-jobs/${jobId}`);
    state.activeMaterialJobId = job.id;
    const processed = job.completed + job.failed;
    const percent = 45 + (job.total ? (processed / job.total) * 55 : 0);
    if (job.status === "waiting-for-ai") {
      renderMaterialProgress({
        percent: 45,
        title: "截图已经保存在本机",
        count: `${job.total} 张等待整理`,
        detail: job.message,
        actionLabel: "选择 AI 连接",
        action: () => openSettings().catch((e) => toast(friendlyError(e))),
      });
      scheduleMaterialPoll(slug, jobId, 3000);
      return;
    }
    if (job.status === "partial") {
      renderMaterialProgress({
        percent: 100,
        title: "这批资料已整理完",
        count: `${job.completed} 张成功 · ${job.failed} 张待重试`,
        detail: job.message,
        actionLabel: "重试失败项",
        action: async () => {
          await api(`/api/partners/${encodeURIComponent(slug)}/material-jobs/${job.id}/resume`, {
            method: "POST", body: { retryFailed: true },
          });
          state.materialProgressDismissed = false;
          scheduleMaterialPoll(slug, job.id, 250);
        },
      });
      return;
    }
    if (job.status === "complete") {
      renderMaterialProgress({
        percent: 100,
        title: "过往截图整理好了",
        count: `${job.completed} / ${job.total} 张`,
        detail: "长期记忆索引已更新。以后即使是很久以前的内容，也会按语义和人物线索找回。",
      });
      setTimeout(() => { if (state.activeMaterialJobId === job.id) $("#material-progress").hidden = true; }, 7000);
      if (state.slug === slug) await loadMessages(slug);
      return;
    }
    renderMaterialProgress({
      percent,
      title: "AI 正在逐张整理截图",
      count: `${processed} / ${job.total} 张${job.current ? ` · ${job.current}` : ""}`,
      detail: "每张图都会生成可回指的摘要、事实、人物、时间和语义向量。原图不会删除。",
    });
    scheduleMaterialPoll(slug, jobId);
  } catch (error) {
    renderMaterialProgress({
      percent: 45,
      title: "暂时读不到整理进度",
      count: "后台任务可能仍在继续",
      detail: friendlyError(error),
    });
    scheduleMaterialPoll(slug, jobId, 3000);
  }
}

async function uploadMaterialBatch(slug, selectedFiles) {
  if (!selectedFiles.length) return;
  state.materialProgressDismissed = false;
  const uploaded = [];
  const failed = [];
  for (let i = 0; i < selectedFiles.length; i++) {
    const item = selectedFiles[i];
    renderMaterialProgress({
      percent: (i / selectedFiles.length) * 45,
      title: "正在把截图逐个保存到本机",
      count: `${i} / ${selectedFiles.length} 张 · ${item.name}`,
      detail: "不把整批图片塞进内存；每个文件落盘后再处理下一个。这个进度可以收起。",
    });
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(slug)}/materials/upload`, {
        method: "POST",
        headers: { "content-type": item.mediaType, "x-file-name": encodeURIComponent(item.name) },
        body: item.file,
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try { message = (await res.json()).error || message; } catch {}
        throw new Error(message);
      }
      uploaded.push(await res.json());
    } catch (error) {
      failed.push({ name: item.name, error: friendlyError(error) });
    }
  }
  if (!uploaded.length) {
    renderMaterialProgress({
      percent: 100, title: "这批截图没有上传成功", count: `${failed.length} 张失败`,
      detail: failed[0]?.error || "请检查磁盘空间后再试。",
    });
    return;
  }
  renderMaterialProgress({
    percent: 45,
    title: "截图已保存，准备逐张理解",
    count: `${uploaded.length} 张已上传${failed.length ? ` · ${failed.length} 张上传失败` : ""}`,
    detail: "后台会一次只交给 AI 一张，避免超出上下文并保持进度可恢复。",
  });
  try {
    const job = await api(`/api/partners/${encodeURIComponent(slug)}/material-jobs`, {
      method: "POST", body: { attachments: uploaded },
    });
    state.activeMaterialJobId = job.id;
    scheduleMaterialPoll(slug, job.id, 250);
  } catch (error) {
    renderMaterialProgress({
      percent: 45,
      title: "截图已经保存在本机",
      count: `${uploaded.length} 张等待建立任务`,
      detail: `后台任务暂时没有建立：${friendlyError(error)}。重新打开档案后可以再次导入，不会影响已有资料。`,
    });
  }
}

async function restoreMaterialProgress(slug) {
  try {
    const job = await api(`/api/partners/${encodeURIComponent(slug)}/material-jobs/latest`);
    if (!job || job.status === "complete") return;
    state.materialProgressDismissed = false;
    state.activeMaterialJobId = job.id;
    await pollMaterialJob(slug, job.id);
  } catch { /* no previous job */ }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function openSettings() {
  showFormError("#settings-error", "");
  const [data, local] = await Promise.all([
    api("/api/settings"),
    api("/api/providers/local").catch(() => null),
  ]);
  state.settings = data;
  state.presets = data.presets;
  state.localStatus = local;
  renderLocalStatus();
  renderProviderCards(data.provider);
  $("#calibration-consent").checked = Boolean(data.calibrationConsent?.enabled);
  const samples = data.calibration?.samples || 0;
  $("#calibration-status").textContent = samples
    ? `本机已有 ${samples} 条去标识化样本${data.calibration.brierScore === null ? "" : ` · 校准误差 ${data.calibration.calibrationError.toFixed(3)}`}`
    : "尚未加入本机校准样本。开启后也只记录未来的新反馈。";
  $("#dlg-settings").showModal();
}

function renderLocalStatus() {
  const note = $("#local-provider-note");
  if (!state.localStatus) { note.textContent = "暂时没能检查电脑上的 AI，可以稍后重试，或使用 API 连接。"; return; }
  const labels = [["codex", "Codex"], ["claude-code", "Claude Code"]].map(([key, label]) => {
    const s = state.localStatus[key];
    if (!s?.installed) return `${label} 未安装`;
    if (!s.authenticated) return `${label} 已安装、还没登录`;
    return `${label} 已登录`;
  });
  const keychain = state.settings?.keychain;
  const credentialNote = keychain?.available ? "API Key 使用系统凭据库" : "当前模式只在本次运行中保留 API Key";
  note.textContent = `这台电脑：${labels.join(" · ")} · ${credentialNote}`;
}

function renderProviderCards(activeKey) {
  const cards = $("#provider-cards");
  cards.innerHTML = "";
  const order = ["codex", "claude-code", "demo", "claude", "deepseek", "glm", "custom"];
  const descriptions = {
    codex: "复用 ChatGPT / Codex 登录，不填 Key",
    "claude-code": "复用 Claude 账号登录，不填 Key",
    demo: "不联网，只看看界面和流程",
    claude: "使用 Anthropic API Key",
    deepseek: "使用 DeepSeek API Key",
    glm: "使用智谱 API Key",
    custom: "连接兼容 OpenAI 格式的服务",
  };
  for (const key of order) {
    const preset = state.presets[key];
    if (!preset) continue;
    const local = state.localStatus?.[key];
    const ready = local?.installed && local?.authenticated;
    const c = el(`<button type="button" class="provider-card ${key === activeKey ? "active" : ""}" data-key="${key}">
      <span class="status-dot ${ready ? "ready" : ""}"></span><b>${esc(preset.label)}</b><small>${esc(descriptions[key] ?? "")}</small>
    </button>`);
    c.onclick = () => { renderProviderCards(key); };
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
    wrap.innerHTML = `<p><b>演示模式不会读取你的真实内容。</b></p><p class="muted">它只播放一段内置例子，适合先熟悉按钮。准备正式使用时，再换成 Codex、Claude Code 或 API。</p>`;
    return;
  }
  if (preset.local) {
    const status = state.localStatus?.[key];
    const name = key === "codex" ? "Codex" : "Claude Code";
    if (!status?.installed) {
      wrap.innerHTML = `<p><b>还没有在这台电脑上找到 ${name}</b></p><p class="muted">先安装 ${name}，登录一次，再回到这里重新打开设置。App 不会读取或保存你的账号密码。</p>`;
      return;
    }
    if (!status.authenticated) {
      wrap.innerHTML = `<p><b>${name} 已安装，但还没有登录</b></p><p class="muted">在终端运行 <code>${key === "codex" ? "codex login" : "claude auth login"}</code> 完成登录，然后重新打开这里。</p>`;
      return;
    }
    const choices = key === "claude-code"
      ? `<select id="sf-model" class="select"><option value="">跟随 Claude Code 默认设置</option>${preset.models.filter(Boolean).map((m) => `<option value="${esc(m)}" ${saved.model === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>`
      : `<input id="sf-model" type="text" placeholder="留空就跟随 Codex 默认设置" value="${esc(saved.model ?? "")}">`;
    wrap.innerHTML = `<p><b>可以直接使用。</b> ${esc(status.version ?? "")}</p><p class="muted">它会沿用 ${name} 的现有登录。每次请求在只读环境里运行；截图只开放读取，不允许它改文件。</p><label class="field"><span>模型 <i>可选</i></span>${choices}</label>`;
    return;
  }
  const modelOptions = preset.models.map((m) => `<option value="${esc(m)}" ${saved.model === m ? "selected" : ""}>${esc(m)}</option>`).join("");
  wrap.innerHTML = `
    <p class="muted">这是给熟悉 API 的用户准备的高级连接。Key 保存在操作系统的安全凭据库，不写入聊天配置文件。</p>
    <label class="field"><span>API Key${preset.keyUrl ? ` · <a href="${preset.keyUrl}" target="_blank" rel="noopener">去服务商后台获取</a>` : ""}</span>
      <input id="sf-key" type="password" placeholder="${saved.hasKey ? "已安全保存；留空表示不更改" : "sk-…"}" value=""></label>
    ${saved.hasKey ? `<label class="check remove-key"><input id="sf-remove-key" type="checkbox"><span>从系统凭据库删除这个 Key</span></label>` : ""}
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
  if (state.presets[key]?.local && key !== "demo") {
    const status = state.localStatus?.[key];
    if (!status?.installed || !status.authenticated) throw new Error("这个连接还没准备好。先完成安装和登录，再回来选择它。");
    patch.providers[key] = { model: $("#sf-model")?.value?.trim() || undefined };
  } else if (key !== "demo") {
    patch.providers[key] = {
      apiKey: $("#sf-key")?.value?.trim() || undefined,
      removeApiKey: Boolean($("#sf-remove-key")?.checked),
      model: $("#sf-model")?.value?.trim() || undefined,
      baseUrl: $("#sf-base")?.value?.trim() || undefined,
    };
  }
  patch.calibrationConsent = { enabled: $("#calibration-consent").checked };
  await api("/api/settings", { method: "POST", body: patch });
  await refreshProviderPill();
}

async function refreshProviderPill() {
  const s = await api("/api/settings");
  state.settings = s;
  state.presets = s.presets;
  const label = s.presets[s.provider]?.label ?? s.provider;
  const model = s.providers[s.provider]?.model;
  $("#provider-label").textContent = s.provider === "demo" ? "演示模式 · 还没正式连接" : `${label}${model ? ` · ${model}` : ""}`;
  $("#btn-settings .dot").classList.toggle("offline", s.provider === "demo");
}

// ---------------------------------------------------------------------------
// 事件绑定与启动
// ---------------------------------------------------------------------------

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

function closeDrawers() {
  $("#sidebar").classList.remove("open");
  $("#panel").classList.remove("open");
  $("#drawer-backdrop").hidden = true;
}

function openDrawer(id) {
  closeDrawers();
  $(id).classList.add("open");
  $("#drawer-backdrop").hidden = false;
}

function makeDialogDismissible(dialog) {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function updateModeCopy() {
  const sendLabels = { reply: "帮我想想", analyze: "帮我读懂", ask: "帮我看看", interest: "帮我判断" };
  const placeholders = {
    reply: "把 ta 发来的话贴在这里…",
    analyze: "贴上 ta 的消息或描述当时的情况…",
    ask: "写下你准备发的话，我帮你看看…",
    interest: "贴几段最近的聊天，或说说 ta 最近做了什么…",
  };
  if (!state.sending) $("#btn-send").textContent = sendLabels[state.mode];
  $("#input").placeholder = placeholders[state.mode];
}

function openPartnerDialog() {
  $("#np-name").value = "";
  $("#np-stage").value = "1";
  $("#np-antisimp").checked = false;
  $("#np-context").value = "";
  clearProfileAttachments();
  showFormError("#np-error", "");
  $("#dlg-partner").showModal();
  setTimeout(() => $("#np-name").focus(), 30);
}

function bind() {
  // 阶段下拉
  const stageSel = $("#stage-select");
  const npStage = $("#np-stage");

  // 思考深度滑杆（fast / balanced / deep 三档）
  const planningSlider = $("#planning-slider");
  const planningIndex = PLANNING_LEVELS.indexOf(state.planningMode);
  planningSlider.value = String(planningIndex >= 0 ? planningIndex : 1);
  $("#planning-value").textContent = PLANNING_LABELS[state.planningMode] ?? "平衡";
  planningSlider.oninput = () => {
    state.planningMode = PLANNING_LEVELS[Number(planningSlider.value)] ?? "balanced";
    $("#planning-value").textContent = PLANNING_LABELS[state.planningMode];
    localStorage.setItem("dj-planning-mode", state.planningMode);
  };

  // 胆量档位：显示档位名，停止拨动后写入档案并作用于下一次决策
  const boldnessSlider = $("#boldness-slider");
  boldnessSlider.oninput = () => {
    const gear = BOLDNESS_GEARS[Number(boldnessSlider.value)] ?? BOLDNESS_GEARS[2];
    state.boldness = gear.value;
    $("#boldness-value").textContent = gear.label;
    clearTimeout(state.boldnessTimer);
    state.boldnessTimer = setTimeout(async () => {
      if (!state.slug) return;
      try {
        await api(`/api/partners/${encodeURIComponent(state.slug)}`, {
          method: "POST", body: { boldness: state.boldness },
        });
        const partner = state.partners.find((p) => p.slug === state.slug);
        if (partner) partner.boldness = state.boldness;
      } catch (error) { toast(friendlyError(error)); }
    }, 450);
  };
  STAGES.forEach((name, i) => {
    stageSel.appendChild(el(`<option value="${i}">${STAGE_OPTIONS[i]}</option>`));
    npStage.appendChild(el(`<option value="${i}" ${i === 1 ? "selected" : ""}>${STAGE_OPTIONS[i]}</option>`));
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

  // 新建聊天档案 + 首次资料导入
  $("#btn-new-partner").onclick = openPartnerDialog;
  $("#empty-create").onclick = openPartnerDialog;
  $("#np-close").onclick = () => $("#dlg-partner").close();
  $("#np-cancel").onclick = () => $("#dlg-partner").close();
  $("#dlg-partner form").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#np-name").value.trim();
    if (!name) { showFormError("#np-error", "先写一个称呼，昵称或代号都可以。"); $("#np-name").focus(); return; }
    const btn = $("#np-create");
    btn.disabled = true;
    btn.textContent = "正在建档…";
    showFormError("#np-error", "");
    const selectedFiles = [...state.profileAttachments];
    try {
      const meta = await api("/api/partners", {
        method: "POST",
        body: {
          name,
          stage: Number($("#np-stage").value),
          antiSimp: $("#np-antisimp").checked,
          backgroundText: $("#np-context").value,
          images: [],
        },
      });
      $("#dlg-partner").close();
      await loadPartners(meta.slug);
      if (selectedFiles.length) {
        toast(`档案建好了，开始在后台整理 ${selectedFiles.length} 张截图`);
        void uploadMaterialBatch(meta.slug, selectedFiles);
      } else {
        toast(meta.imported?.textLength ? "档案建好了，过往文字也带进来了" : "档案建好了，可以开始贴聊天了");
      }
      clearProfileAttachments();
    } catch (err) {
      showFormError("#np-error", friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "建好并开始";
    }
  };
  const dropzone = $("#np-dropzone");
  dropzone.onclick = () => $("#np-file-input").click();
  dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#np-file-input").click(); } };
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragging"); };
  dropzone.ondragleave = () => dropzone.classList.remove("dragging");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
    for (const file of e.dataTransfer?.files ?? []) addProfileAttachment(file);
  };
  $("#np-file-input").onchange = (e) => { for (const file of e.target.files) addProfileAttachment(file); e.target.value = ""; };

  // 模式
  $("#mode-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-tab");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".mode-tab").forEach((n) => n.classList.toggle("active", n === btn));
    document.querySelectorAll(".mode-tab").forEach((n) => n.setAttribute("aria-selected", String(n === btn)));
    updateModeCopy();
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
  $("#btn-settings").onclick = () => openSettings().catch((e) => toast(friendlyError(e)));
  $("#settings-close").onclick = () => $("#dlg-settings").close();
  $("#settings-cancel").onclick = () => $("#dlg-settings").close();
  $("#calibration-export").onclick = () => { window.location.href = "/api/calibration/export"; };
  $("#calibration-delete").onclick = async () => {
    if (!window.confirm("删除所有本机去标识化校准样本？聊天档案和结果记录不会删除。")) return;
    try {
      const result = await api("/api/calibration/delete", { method: "POST", body: {} });
      $("#calibration-status").textContent = `已删除 ${result.deleted} 条校准样本。`;
      toast("本机校准数据已删除");
    } catch (error) { toast(friendlyError(error)); }
  };
  $("#dlg-settings form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#settings-save");
    btn.disabled = true;
    btn.textContent = "正在连接…";
    showFormError("#settings-error", "");
    try {
      await saveSettings();
      $("#dlg-settings").close();
      toast("AI 连接已切换");
      if (state.activeMaterialJobId && state.slug) scheduleMaterialPoll(state.slug, state.activeMaterialJobId, 250);
    } catch (err) {
      showFormError("#settings-error", friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "使用这个连接";
    }
  };

  // 实际结果反馈：把真实后续变成有时间权重的学习信号
  $("#feedback-close").onclick = () => $("#dlg-feedback").close();
  $("#feedback-cancel").onclick = () => $("#dlg-feedback").close();
  $("#feedback-form").onsubmit = async (e) => {
    e.preventDefault();
    const outcome = document.querySelector("#feedback-form input[name=outcome]:checked")?.value;
    if (!outcome) { showFormError("#feedback-error", "先选一下 ta 后来的反应。"); return; }
    const btn = $("#feedback-save");
    btn.disabled = true;
    btn.textContent = "正在记下…";
    try {
      const checked = (name) => Boolean(document.querySelector(`#feedback-form input[name=${name}]`)?.checked);
      await api(`/api/partners/${encodeURIComponent(state.slug)}/feedback`, {
        method: "POST",
        body: {
          ...(state.selectedDecision || {}),
          replyText: state.selectedReply,
          partnerResponse: $("#feedback-response").value,
          outcome,
          responseDelayHours: Number($("#feedback-delay").value),
          signals: {
            continued: checked("continued") || undefined,
            initiated: checked("initiated") || undefined,
            followedThrough: checked("followedThrough") || undefined,
            brokePromise: checked("brokePromise") || undefined,
            rememberedDetail: checked("rememberedDetail") || undefined,
            forgotDetail: checked("forgotDetail") || undefined,
          },
        },
      });
      $("#dlg-feedback").close();
      toast("记下了。它会进入校准，和后续结果一起更新判断。");
      await loadAdaptiveProfile(state.slug);
      await loadDecisionInsights(state.slug);
      await loadMessages(state.slug);
    } catch (error) {
      showFormError("#feedback-error", friendlyError(error));
    } finally {
      btn.disabled = false;
      btn.textContent = "记下这次结果";
    }
  };

  // 所有浮层都可以通过关闭按钮、背景或 Esc 退出
  makeDialogDismissible($("#dlg-partner"));
  makeDialogDismissible($("#dlg-settings"));
  makeDialogDismissible($("#dlg-feedback"));
  $("#btn-sidebar").onclick = () => openDrawer("#sidebar");
  $("#btn-panel").onclick = () => openDrawer("#panel");
  $("#panel-close").onclick = closeDrawers;
  $("#drawer-backdrop").onclick = closeDrawers;
  $("#material-progress-close").onclick = () => {
    state.materialProgressDismissed = true;
    $("#material-progress").hidden = true;
  };
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDrawers();
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  });
}

async function main() {
  try {
    bind();
    updateModeCopy();
    await refreshProviderPill();
    await loadPartners();
    if (!state.partners.length) setTimeout(openPartnerDialog, 180);
  } catch (e) {
    toast(`页面没有准备好：${friendlyError(e)}`);
  }
}

main();
