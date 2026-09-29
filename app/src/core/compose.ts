/**
 * 装配一轮请求：问答策略（稳定、可缓存）+ 此刻 + 档案 + 打法记忆 + 最近对话 + 找回的旧资料。
 */

import { describeGap, describeNow, daysBetween, shortDate, upcomingFestivals } from "./calendar";
import { doctrineFor, routeLane, type Lane } from "./doctrine";
import { GLOSSARY } from "./glossary";
import { GENDERS, MODES, nerveOf, oilCap, pronounOf, stageOf, type MemeHit, type Mode, type PersonDTO, type TurnContext } from "../shared/domain";
import { dossierForPrompt, memesForPrompt } from "../store/dossier";
import { learningForPrompt } from "../store/learning";
import { recentForPrompt } from "../store/turns";
import { recall } from "../store/archive";
import { imagePath, type StoredImage } from "../store/images";
import { personDir } from "../store/db";
import { readSettings } from "../store/settings";
import type { LLMRequest } from "../llm";

export interface Composed {
  request: LLMRequest;
  context: TurnContext;
  lane: Lane;
}

function genderLine(ta: string, me: string): string {
  const taPart = ta ? `ta 是${GENDERS[ta as "m" | "f"].label}，称「${pronounOf(ta)}」` : "ta 的性别没写，按聊天判断，称「ta」";
  const mePart = me ? `用户是${GENDERS[me as "m" | "f"].label}` : "用户性别没写";
  const table = ta === "f" ? "；打法看「追女生」那张表" : ta === "m" ? "；打法看「追男生」那张表" : "";
  return `性别：${taPart}；${mePart}${table}`;
}

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
  const lane = routeLane(text, input.memes.length);
  const festivals = upcomingFestivals(at, 21);
  const dossier = dossierForPrompt(person.id, at);
  const personalDates = dossier.dates
    .map((d) => ({ ...d, days: daysBetween(at, d.date) }))
    .filter((d) => d.days >= 0 && d.days <= 30);
  const doctrine = doctrineFor({ mode, lane, hasImages: input.images.length > 0, nearFestival: festivals.some((f) => f.days <= 14) || personalDates.length > 0 });
  const recent = recentForPrompt(person.id, input.turnId, 8);
  const recalled = await recall(person.id, text, { limit: 6, exclude: new Set([input.turnId, ...recent.ids]) });
  const learning = learningForPrompt(person.id);
  const memeMemory = memesForPrompt(person.id);

  const stage = stageOf(person.stage);
  const nerve = nerveOf(person.nerve);
  const cap = oilCap(person.stage, person.nerve);
  const sections: string[] = [];

  const gap = describeGap(person.lastTurnAt ? new Date(person.lastTurnAt) : null, at);
  sections.push([
    "# 此刻",
    `现在：${describeNow(at)}`,
    gap ? `上次聊 ta：${gap}` : "这是第一次聊这个人",
    festivals.length ? `临近：${festivals.map((f) => `${f.name}（${shortDate(f.date.toISOString())}，${f.days === 0 ? "就是今天" : `还有 ${f.days} 天`}）——${f.note}`).join("；")}` : "",
    personalDates.length ? `ta 的日子：${personalDates.map((d) => `${d.label}（${d.days === 0 ? "今天" : `还有 ${d.days} 天`}）`).join("；")}` : "",
  ].filter(Boolean).join("\n"));

  sections.push([
    "# 当前档案",
    `称呼：${person.name}（用户起的代号，只是标签）`,
    genderLine(person.gender, readSettings().me),
    `关系阶段：${stage.name}（${stage.n}）· 阶段油腻上限 ${stage.cap} → 本次上限 ${cap}（胆量「${nerve.name}」${nerve.delta > 0 ? "+" : ""}${nerve.delta || "±0"}）`,
    `胆量：${nerve.name}——${nerve.brief}`,
    `清醒提醒：${person.clearEyed ? "开——证据够硬就直说止损，像朋友一样拦住用户" : "关——低兴趣照样说出来，语气缓一点"}`,
    person.note ? `用户的备注：${person.note}` : "",
  ].filter(Boolean).join("\n"));

  if (dossier.text) sections.push(`# 档案卡（关于 ta 的事实）\n${dossier.text}`);
  if (memeMemory) sections.push(`# ta 的梗记忆（ta 自己用过的，镜像回去最安全）\n${memeMemory}`);
  if (learning.tactics) sections.push(`# 打法记忆（用户在 ta 身上试过的）\n${learning.tactics}`);
  if (learning.style) sections.push(`# 用户风格\n${learning.style}`);
  if (learning.trend) sections.push(`# 兴趣走势\n${learning.trend}`);
  if (recent.text) sections.push(`# 最近几轮\n${recent.text}`);
  if (recalled.length) {
    sections.push(`# 按这次的内容找回的旧资料（原文都在本机，可能来自很久以前）\n${recalled.map((r) => `- [${r.kind === "screenshot" ? "截图" : r.kind === "paste" ? "旧聊天" : r.kind === "sent" ? "用户发过" : "以前的对话"} · ${shortDate(r.happenedAt ?? r.createdAt)}] ${r.text.replace(/\n+/g, " / ").slice(0, 400)}`).join("\n")}`);
  }
  const blacklist = GLOSSARY.banned.slice(0, 30).join("、");
  sections.push(input.memes.length
    ? `# 梗扫描（词典命中，直接采信）\n${input.memes.map((m) => `- 「${m.matched}」：${m.meaning}${m.tone ? `；语气：${m.tone}` : ""}；状态：${m.status}`).join("\n")}\n可复制回复里的过气梗（用了会被打回）：${blacklist}…`
    : `# 梗扫描\n词典没命中。语气对不上、句式突兀的短语照样当候选梗读。可复制回复里的过气梗（用了会被打回）：${blacklist}…`);

  const intro = mode === "polish"
    ? "下面是用户想发出去的话（前面可能带着 ta 的上一句）："
    : input.images.length ? "下面是用户发来的内容，截图在附件里：" : "下面是用户发来的内容：";
  const user = `【${MODES[mode].doctrine}】\n${intro}\n${text.trim() || "（只有截图）"}`;

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
    modules: doctrine.map((d) => d.name),
    facts: dossier.count,
    recalled: recalled.map((r) => ({ id: r.id, kind: r.kind, text: r.text.slice(0, 200), when: r.happenedAt ?? r.createdAt, why: r.why })),
    tactics: learning.count,
    festivals: [...festivals.map((f) => `${f.name} ${f.days === 0 ? "今天" : `${f.days} 天后`}`), ...personalDates.map((d) => `${d.label} ${d.days === 0 ? "今天" : `${d.days} 天后`}`)],
  };
  return { request, context, lane };
}
