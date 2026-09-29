/**
 * 军师的问答策略（references/*.md），构建期作为文本内嵌进 sidecar。
 *
 * 装配顺序固定：核心 → 语感 → 梗 → 读局 → 打法，这一段对所有请求相同，
 * 可以整体吃 prompt cache；约会、读人两个模块按车道追加在后面。
 */

import coreMd from "../../../references/core.md" with { type: "text" };
import voiceMd from "../../../references/voice.md" with { type: "text" };
import memesMd from "../../../references/memes.md" with { type: "text" };
import readingMd from "../../../references/reading.md" with { type: "text" };
import strategyMd from "../../../references/strategy.md" with { type: "text" };
import datingMd from "../../../references/dating.md" with { type: "text" };
import profileMd from "../../../references/profile.md" with { type: "text" };
import type { Mode } from "../shared/domain";

export type Lane = "日常" | "情绪" | "冲突" | "邀约" | "玩梗" | "拉扯";

const LANE_PATTERNS: Array<[Lane, RegExp]> = [
  ["邀约", /约|见面|吃饭|电影|看展|礼物|节日|七夕|情人节|520|生日|订位|订到|订了|请客|见个面|周末|出来玩|一起去|鸽|吃啥|吃什么|去哪/],
  ["拉扯", /不回|已读|冷淡|忽冷忽热|画饼|海王|海后|降温|拉扯|舔|没戏|敷衍|好几天|消失|备胎|养鱼/],
  ["冲突", /生气|吵架|冷战|你是不是|分手|误会|道歉|删了|拉黑|算了|随便你/],
  ["情绪", /累|emo|烦死|难过|哭|委屈|崩溃|加班|失眠|压力|不开心|好烦|破防/],
];

export function routeLane(text: string, memeHits: number): Lane {
  for (const [lane, re] of LANE_PATTERNS) if (re.test(text)) return lane;
  if (memeHits > 0 && text.trim().length <= 40) return "玩梗";
  return "日常";
}

export interface DoctrineBlock {
  name: string;
  text: string;
  cacheable: boolean;
}

const BASE: DoctrineBlock[] = [
  { name: "core", text: coreMd as unknown as string, cacheable: true },
  { name: "voice", text: voiceMd as unknown as string, cacheable: true },
  { name: "memes", text: memesMd as unknown as string, cacheable: true },
  { name: "reading", text: readingMd as unknown as string, cacheable: true },
  { name: "strategy", text: strategyMd as unknown as string, cacheable: true },
];

export function doctrineFor(opts: { mode: Mode; lane: Lane; hasImages: boolean; nearFestival: boolean }): DoctrineBlock[] {
  const blocks = BASE.map((b) => ({ ...b, text: `<!-- ${b.name}.md -->\n${b.text}` }));
  if (opts.lane === "邀约" || opts.nearFestival) blocks.push({ name: "dating", text: `<!-- dating.md -->\n${datingMd}`, cacheable: true });
  if (opts.hasImages) blocks.push({ name: "profile", text: `<!-- profile.md -->\n${profileMd}`, cacheable: true });
  return blocks;
}

export const PROFILE_DOCTRINE = profileMd as unknown as string;
export const CORE_DOCTRINE = coreMd as unknown as string;
