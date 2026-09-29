/**
 * 装配一轮请求：问答策略（稳定、可缓存）+ 此刻 + 档案 + 打法记忆 + 最近对话 + 找回的旧资料。
 *
 * 语言分两层：
 * - chat：这段关系用哪种语言聊 → 只装那一套问答策略、梗词典、人话检查，动态部分也用那种语言写；
 * - ui：App 的界面语言 → 如果和 chat 不同，只多一行「解说用 X 写，锦囊用 Y 写」。
 */

import { describeGap, describeNow, daysBetween, shortDate, upcomingFestivals } from "./calendar";
import { doctrineFor, routeLane, type Lane } from "./doctrine";
import { glossaryFor } from "./glossary";
import { labels, oilCap, type Lang, type MemeHit, type Mode, type PersonDTO, type TurnContext } from "../shared/domain";
import { dossierForPrompt, memesForPrompt } from "../store/dossier";
import { learningForPrompt } from "../store/learning";
import { recentForPrompt } from "../store/turns";
import { recall } from "../store/archive";
import { imagePath, type StoredImage } from "../store/images";
import { personDir } from "../store/db";
import { readSettings } from "../store/settings";
import { appLang, chatLang } from "../store/locale";
import type { LLMRequest } from "../llm";

export interface Composed {
  request: LLMRequest;
  context: TurnContext;
  lane: Lane;
  lang: Lang;
}

function genderLine(ta: string, me: string, lang: Lang): string {
  const L = labels(lang);
  if (lang === "en") {
    const taPart = ta ? `they're a ${L.genders[ta as "m" | "f"].label.toLowerCase()} — use "${L.pronoun(ta)}"` : `their gender isn't set — read the chat and use "they"`;
    const mePart = me ? `the user is a ${L.genders[me as "m" | "f"].label.toLowerCase()}` : "the user's gender isn't set";
    const table = ta === "f" ? "; use the \"dating women\" table" : ta === "m" ? "; use the \"dating men\" table" : "";
    return `Gender: ${taPart}; ${mePart}${table}`;
  }
  const taPart = ta ? `ta 是${L.genders[ta as "m" | "f"].label}，称「${L.pronoun(ta)}」` : "ta 的性别没写，按聊天判断，称「ta」";
  const mePart = me ? `用户是${L.genders[me as "m" | "f"].label}` : "用户性别没写";
  const table = ta === "f" ? "；打法看「追女生」那张表" : ta === "m" ? "；打法看「追男生」那张表" : "";
  return `性别：${taPart}；${mePart}${table}`;
}

const KIND_LABEL: Record<Lang, Record<string, string>> = {
  zh: { screenshot: "截图", paste: "旧聊天", sent: "用户发过", turn: "以前的对话" },
  en: { screenshot: "screenshot", paste: "old chat", sent: "user sent", turn: "earlier message" },
};

export async function composeTurn(input: {
  person: PersonDTO;
  turnId: string;
  mode: Mode;
  text: string;
  images: StoredImage[];
  memes: MemeHit[];
  at?: Date;
}): Promise<Composed> {
  const at = input.at ?? new Date();
  const { person, mode, text } = input;
  const lang = chatLang(person);
  const ui = appLang();
  const L = labels(lang);
  const en = lang === "en";
  const lane = routeLane(text, input.memes.length, lang);
  const festivals = upcomingFestivals(at, 21, lang);
  const dossier = dossierForPrompt(person.id, at, lang);
  const personalDates = dossier.dates
    .map((d) => ({ ...d, days: daysBetween(at, d.date) }))
    .filter((d) => d.days >= 0 && d.days <= 30);
  const doctrine = doctrineFor({ mode, lane, lang, hasImages: input.images.length > 0, nearFestival: festivals.some((f) => f.days <= 14) || personalDates.length > 0 });
  const recent = recentForPrompt(person.id, input.turnId, 8, lang);
  const recalled = await recall(person.id, text, { limit: 6, exclude: new Set([input.turnId, ...recent.ids]) });
  const learning = learningForPrompt(person.id, lang);
  const memeMemory = memesForPrompt(person.id, lang);
  const me = readSettings().me;

  const stage = L.stage(person.stage);
  const nerve = L.nerve(person.nerve);
  const cap = oilCap(person.stage, person.nerve);
  const sections: string[] = [];
  const gap = describeGap(person.lastTurnAt ? new Date(person.lastTurnAt) : null, at, lang);
  const inDays = (d: number) => (en ? (d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`) : d === 0 ? "就是今天" : `还有 ${d} 天`);

  sections.push([
    en ? "# Right now" : "# 此刻",
    `${en ? "Now" : "现在"}：${describeNow(at, lang)}`.replace("：", en ? ": " : "："),
    gap ? (en ? `Last talked about them: ${gap}` : `上次聊 ta：${gap}`) : (en ? "First time talking about this person" : "这是第一次聊这个人"),
    festivals.length ? `${en ? "Coming up" : "临近"}${en ? ": " : "："}${festivals.map((f) => `${f.name} (${shortDate(f.date.toISOString())}, ${inDays(f.days)}) — ${f.note}`).join(en ? "; " : "；")}` : "",
    personalDates.length ? `${en ? "Their dates" : "ta 的日子"}${en ? ": " : "："}${personalDates.map((d) => `${d.label} (${inDays(d.days)})`).join(en ? "; " : "；")}` : "",
  ].filter(Boolean).join("\n"));

  const nerveDelta = `${nerve.delta > 0 ? "+" : ""}${nerve.delta || (en ? "±0" : "±0")}`;
  sections.push((en ? [
    "# Current profile",
    `Name: ${person.name} (a nickname the user chose — just a label)`,
    genderLine(person.gender, me, lang),
    `Stage: ${stage.name} (${stage.n}) · stage thirst cap ${stage.cap} → this turn's cap ${cap} (nerve "${nerve.name}" ${nerveDelta})`,
    `Nerve: ${nerve.name} — ${nerve.brief}`,
    `Reality check: ${person.clearEyed ? "ON — if the evidence is solid, tell them to stop investing, like a friend grabbing their arm" : "off — still name low interest, just gentler"}`,
    person.note ? `User's note: ${person.note}` : "",
  ] : [
    "# 当前档案",
    `称呼：${person.name}（用户起的代号，只是标签）`,
    genderLine(person.gender, me, lang),
    `关系阶段：${stage.name}（${stage.n}）· 阶段油腻上限 ${stage.cap} → 本次上限 ${cap}（胆量「${nerve.name}」${nerveDelta}）`,
    `胆量：${nerve.name}——${nerve.brief}`,
    `清醒提醒：${person.clearEyed ? "开——证据够硬就直说止损，像朋友一样拦住用户" : "关——低兴趣照样说出来，语气缓一点"}`,
    person.note ? `用户的备注：${person.note}` : "",
  ]).filter(Boolean).join("\n"));

  if (dossier.text) sections.push(`${en ? "# Dossier (facts about them)" : "# 档案卡（关于 ta 的事实）"}\n${dossier.text}`);
  if (memeMemory) sections.push(`${en ? "# Their slang (words they use themselves — safest to mirror)" : "# ta 的梗记忆（ta 自己用过的，镜像回去最安全）"}\n${memeMemory}`);
  if (learning.tactics) sections.push(`${en ? "# Track record (what the user has tried with them)" : "# 打法记忆（用户在 ta 身上试过的）"}\n${learning.tactics}`);
  if (learning.style) sections.push(`${en ? "# The user's texting style" : "# 用户风格"}\n${learning.style}`);
  if (learning.trend) sections.push(`${en ? "# Interest trend" : "# 兴趣走势"}\n${learning.trend}`);
  if (recent.text) sections.push(`${en ? "# Last few exchanges" : "# 最近几轮"}\n${recent.text}`);
  if (recalled.length) {
    sections.push(`${en ? "# Older notes recalled for this message (originals are on this computer; may be from long ago)" : "# 按这次的内容找回的旧资料（原文都在本机，可能来自很久以前）"}\n${recalled.map((r) => `- [${KIND_LABEL[lang][r.kind] ?? r.kind} · ${shortDate(r.happenedAt ?? r.createdAt)}] ${r.text.replace(/\n+/g, " / ").slice(0, 400)}`).join("\n")}`);
  }
  const blacklist = glossaryFor(lang).banned.slice(0, 30).join(en ? ", " : "、");
  if (en) {
    sections.push(input.memes.length
      ? `# Slang scan (glossary matches — check they fit the context)\n${input.memes.map((m) => `- "${m.matched}": ${m.meaning}${m.tone ? `; tone: ${m.tone}` : ""}; status: ${m.status}`).join("\n")}\nDead slang the vibe check bounces in copyable messages: ${blacklist}…`
      : `# Slang scan\nNo glossary matches. Phrases with off tone or odd structure can still be slang. Dead slang the vibe check bounces in copyable messages: ${blacklist}…`);
  } else {
    sections.push(input.memes.length
      ? `# 梗扫描（词典命中，直接采信）\n${input.memes.map((m) => `- 「${m.matched}」：${m.meaning}${m.tone ? `；语气：${m.tone}` : ""}；状态：${m.status}`).join("\n")}\n可复制回复里的过气梗（用了会被打回）：${blacklist}…`
      : `# 梗扫描\n词典没命中。语气对不上、句式突兀的短语照样当候选梗读。可复制回复里的过气梗（用了会被打回）：${blacklist}…`);
  }

  // 跨语言：锦囊用聊天语言写，解说用界面语言写。只多这一行，不带另一套策略。
  if (ui !== lang) {
    sections.push(ui === "zh"
      ? "# Language\nThe user reads Chinese. Write all commentary (the judge values, the one-line reasons, bullets, strategy/aside/stop values) in Simplified Chinese. Keep the block keys and seal names exactly as in the contract, and write the reply bubbles in natural English."
      : "# 语言\n用户读英文。所有解说（judge 各项的值、每条锦囊下面那句、列表、strategy/aside/stop 的值）用英文写；契约里的键名和稳 / 撩 / 奇保持原样；reply 围栏里的气泡用自然的中文写。");
  }

  const intro = en
    ? mode === "polish" ? "Here's what the user wants to send (their last message may come first):" : input.images.length ? "Here's what the user sent; screenshots are attached:" : "Here's what the user sent:"
    : mode === "polish" ? "下面是用户想发出去的话（前面可能带着 ta 的上一句）：" : input.images.length ? "下面是用户发来的内容，截图在附件里：" : "下面是用户发来的内容：";
  const user = en
    ? `[${L.modes[mode].doctrine}]\n${intro}\n${text.trim() || "(screenshots only)"}`
    : `【${L.modes[mode].doctrine}】\n${intro}\n${text.trim() || "（只有截图）"}`;

  const request: LLMRequest = {
    system: [
      ...doctrine.map((d) => ({ text: d.text, cache: d.cacheable })),
      { text: sections.join("\n\n"), cache: false },
    ],
    user,
    images: input.images.map((img) => ({ path: imagePath(img), mediaType: img.mediaType })),
    workdir: personDir(person.id),
    effort: ({ fast: "low", balanced: "medium", deep: "high" } as const)[readSettings().depth ?? "fast"],
    maxTokens: 12000,
  };
  const context: TurnContext = {
    lane,
    lang,
    modules: doctrine.map((d) => d.name),
    facts: dossier.count,
    recalled: recalled.map((r) => ({ id: r.id, kind: r.kind, text: r.text.slice(0, 200), when: r.happenedAt ?? r.createdAt, why: r.why })),
    tactics: learning.count,
    festivals: [...festivals.map((f) => `${f.name} ${inDays(f.days)}`), ...personalDates.map((d) => `${d.label} ${inDays(d.days)}`)],
  };
  return { request, context, lane, lang };
}
