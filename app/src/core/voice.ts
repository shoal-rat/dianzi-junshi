/**
 * 人话门禁的确定性部分（references/voice.md 第六节「禁写清单」）。
 * 只查可复制回复——reply 围栏里、用户会原样发出去的那几行。
 * 过气梗黑名单直接来自梗词典，不再维护第二份词表。
 */

import { GLOSSARY, findTerm, type Glossary } from "./glossary";
import type { LintFinding, LintResult } from "../shared/domain";

const FORMAL = ["然而", "因此", "综上", "首先", "其次", "再者", "与此同时", "总而言之", "众所周知", "不仅如此", "由此可见", "换言之"];

const ELDER = [
  "多喝热水", "喝口水", "早点休息", "早点睡", "注意身体", "注意保暖", "保重", "记你一功", "表现不错",
  "吃了吗", "亲爱的", "小仙女", "妹妹你", "美女你", "帅哥你", "我都是为你好", "听我一句劝", "你还年轻",
];

const LECTURE = ["你应该", "建议你", "记得要", "别忘了", "要注意", "我跟你说", "说句实话", "讲道理，", "讲道理,"];

const FAIL_LEN = 36;
const WARN_LEN = 22;

const URL_RE = /(?:https?:\/\/|www\.)\S+/g;

function visibleLength(bubble: string): number {
  return [...bubble.replace(URL_RE, "").trim()].length;
}

function isEmoji(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0x2b50 || cp === 0x2b55;
}

export function bubblesOf(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function lint(text: string, glossary: Glossary = GLOSSARY): LintResult {
  const bubbles = bubblesOf(text);
  const findings: LintFinding[] = [];
  const add = (level: LintFinding["level"], check: string, bubble: number | null, t: string, hint: string) =>
    findings.push({ level, check, bubble, text: t, hint });

  bubbles.forEach((bubble, i) => {
    const no = i + 1;
    if (/。$/.test(bubble)) add("FAIL", "period", no, bubble.slice(-8), "句尾句号读起来像生气，删掉");
    for (const t of FORMAL) if (bubble.includes(t)) add("FAIL", "formal", no, t, "书面连接词像公文，删掉或拆成短句");
    for (const t of ELDER) if (bubble.includes(t)) add("FAIL", "elder", no, t, "长辈腔，换成具体的、当下的话");
    for (const t of LECTURE) if (bubble.includes(t)) add("FAIL", "lecture", no, t.replace(/[，,]$/, ""), "说教起手式，改成分享或直接给动作");
    if (/^哟([，,\s!！]|$)/.test(bubble)) add("FAIL", "yo", no, "哟", "开头的「哟」油腻又出戏");
    const seen = new Set<string>();
    for (const term of glossary.banned) {
      const hit = findTerm(bubble, term);
      if (hit && !seen.has(hit.matched.toLowerCase())) {
        seen.add(hit.matched.toLowerCase());
        add("FAIL", "dated", no, hit.matched, term === "呵呵" || term === "在吗" ? "这个词在年轻人那里是雷" : "过气梗，一用就暴露，换白话");
      }
    }
    for (const term of glossary.shaky) {
      const hit = findTerm(bubble, term);
      if (hit) add("WARN", "stale", no, hit.matched, "有点过时，拿不准就换白话");
    }
    const len = visibleLength(bubble);
    if (len > FAIL_LEN) add("FAIL", "long", no, [...bubble].slice(0, 10).join("") + "…", `${len} 字的小作文，拆短或砍掉`);
    else if (len > WARN_LEN) add("WARN", "longish", no, [...bubble].slice(0, 10).join("") + "…", `${len} 字偏长，${WARN_LEN} 字以内最像真人`);
    if (bubble.includes("，") && /[。；]/.test(bubble)) add("WARN", "punct", no, "，。", "全套书面标点像写作文");
    if (/……|\.\.\.|。。/.test(bubble)) add("WARN", "ellipsis", no, "……", "省略号读起来欲言又止或阴阳");
    if (bubble.includes("您")) add("WARN", "honorific", no, "您", "「您」是客服腔");
  });

  if (bubbles.length > 3) add("WARN", "many", null, `${bubbles.length} 条`, "一次别超过 3 条气泡");
  const all = bubbles.join("");
  const bangs = (all.match(/[！!]/g) ?? []).length;
  if (bangs >= 2) add("WARN", "bang", null, `！×${bangs}`, "感叹号最多留一个");
  const tildes = (all.match(/[～~]/g) ?? []).length;
  if (tildes > 1) add("WARN", "tilde", null, `～×${tildes}`, "～一个就够了");
  const emoji = [...all].filter(isEmoji).length;
  if (emoji > 2) add("WARN", "emoji", null, `emoji×${emoji}`, "emoji 最多留一两个");

  const failCount = findings.filter((f) => f.level === "FAIL").length;
  return { result: failCount ? "FAIL" : "PASS", failCount, warnCount: findings.length - failCount, findings };
}

/**
 * 不需要模型就能确定修好的问题直接修：句尾句号、连发感叹号、「。。」。
 * 其余问题（禁词、过长、过气梗）留给改写。
 */
export function autofix(text: string): string {
  return bubblesOf(text)
    .map((b) => b.replace(/。+$/, "").replace(/([！!]){2,}/g, "$1").replace(/。{2,}/g, ""))
    .map((b) => b.replace(/[，,]\s*$/, ""))
    .filter(Boolean)
    .join("\n");
}
