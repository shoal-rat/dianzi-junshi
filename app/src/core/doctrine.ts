/**
 * 军师的问答策略，构建期作为文本内嵌进 sidecar。两套，按这段关系的聊天语言
 * **只装其中一套**：
 *   references/*.md     中文语境（微信、中文梗、中国的约会习惯和节日）
 *   references/en/*.md  英语语境（iMessage / 约会 App、英语俚语、欧美约会文化）
 * 英文那套是按英语圈的文化重写的，不是翻译。
 *
 * 装配顺序固定：核心 → 语感 → 梗 → 读局 → 打法，可以整段吃 prompt cache；
 * 约会、读人两个模块按需追加。
 */

import coreMd from "../../../references/core.md" with { type: "text" };
import voiceMd from "../../../references/voice.md" with { type: "text" };
import memesMd from "../../../references/memes.md" with { type: "text" };
import readingMd from "../../../references/reading.md" with { type: "text" };
import strategyMd from "../../../references/strategy.md" with { type: "text" };
import datingMd from "../../../references/dating.md" with { type: "text" };
import profileMd from "../../../references/profile.md" with { type: "text" };
import coreEn from "../../../references/en/core.md" with { type: "text" };
import voiceEn from "../../../references/en/voice.md" with { type: "text" };
import memesEn from "../../../references/en/memes.md" with { type: "text" };
import readingEn from "../../../references/en/reading.md" with { type: "text" };
import strategyEn from "../../../references/en/strategy.md" with { type: "text" };
import datingEn from "../../../references/en/dating.md" with { type: "text" };
import profileEn from "../../../references/en/profile.md" with { type: "text" };
import type { Lane, Lang, Mode } from "../shared/domain";

export { LANE_LABELS, laneLabel, type Lane } from "../shared/domain";

const LANE_PATTERNS: Record<Lang, Array<[Lane, RegExp]>> = {
  zh: [
    ["invite", /约|见面|吃饭|电影|看展|礼物|节日|七夕|情人节|520|生日|订位|订到|订了|请客|见个面|周末|出来玩|一起去|鸽|吃啥|吃什么|去哪/],
    ["pushpull", /不回|已读|冷淡|忽冷忽热|画饼|海王|海后|降温|拉扯|舔|没戏|敷衍|好几天|消失|备胎|养鱼/],
    ["conflict", /生气|吵架|冷战|你是不是|分手|误会|道歉|删了|拉黑|算了|随便你/],
    ["emotion", /累|emo|烦死|难过|哭|委屈|崩溃|加班|失眠|压力|不开心|好烦|破防/],
  ],
  en: [
    ["invite", /\b(date|dinner|drinks|coffee|brunch|movie|concert|(this|next) (weekend|fri|sat|sun)|tonight|tomorrow night|hang ?out|meet ?up|grab (a |some )|are you free|you free|wanna (go|get|grab|come)|want to (go|get|grab|come)|reservation|birthday|valentine|halloween|thanksgiving|nye|flaked?|cancel+ed|reschedul)/i],
    ["pushpull", /\b(ghost(ed|ing)?|left (me )?on read|haven'?t heard|hasn'?t (texted|replied)|dry texter|breadcrumb|situationship|mixed signals|hot and cold|disappeared|went quiet|only texts|wyd|u up|orbiting|zombie|player|talking to other)/i],
    ["conflict", /\b(mad at|upset|angry|argu(e|ment)|fight|fought|sorry|apolog|are you mad|whatever|block(ed)?|unfollow|broke up|break up|what did i do)\b/i],
    ["emotion", /\b(tired|exhausted|stressed|sad|crying|anxious|overwhelmed|rough day|bad day|burn(ed|t) out|can'?t sleep|lonely|down)\b/i],
  ],
};

export function routeLane(text: string, memeHits: number, lang: Lang = "zh"): Lane {
  for (const [lane, re] of LANE_PATTERNS[lang]) if (re.test(text)) return lane;
  if (memeHits > 0 && text.trim().length <= (lang === "en" ? 120 : 40)) return "meme";
  return "daily";
}

export interface DoctrineBlock {
  name: string;
  text: string;
  cacheable: boolean;
}

const SETS: Record<Lang, { base: Array<[string, string]>; dating: string; profile: string }> = {
  zh: {
    base: [["core", coreMd], ["voice", voiceMd], ["memes", memesMd], ["reading", readingMd], ["strategy", strategyMd]],
    dating: datingMd,
    profile: profileMd,
  },
  en: {
    base: [["core", coreEn], ["voice", voiceEn], ["memes", memesEn], ["reading", readingEn], ["strategy", strategyEn]],
    dating: datingEn,
    profile: profileEn,
  },
} as unknown as Record<Lang, { base: Array<[string, string]>; dating: string; profile: string }>;

export function doctrineFor(opts: { mode: Mode; lane: Lane; hasImages: boolean; nearFestival: boolean; lang?: Lang }): DoctrineBlock[] {
  const set = SETS[opts.lang ?? "zh"];
  const dir = opts.lang === "en" ? "en/" : "";
  const blocks: DoctrineBlock[] = set.base.map(([name, text]) => ({ name, text: `<!-- ${dir}${name}.md -->\n${text}`, cacheable: true }));
  if (opts.lane === "invite" || opts.nearFestival) blocks.push({ name: "dating", text: `<!-- ${dir}dating.md -->\n${set.dating}`, cacheable: true });
  if (opts.hasImages) blocks.push({ name: "profile", text: `<!-- ${dir}profile.md -->\n${set.profile}`, cacheable: true });
  return blocks;
}

export function profileDoctrine(lang: Lang): string {
  return SETS[lang].profile;
}

export function voiceDoctrine(lang: Lang): string {
  return SETS[lang].base.find(([n]) => n === "voice")![1];
}

export const PROFILE_DOCTRINE = profileMd as unknown as string;
export const CORE_DOCTRINE = coreMd as unknown as string;
