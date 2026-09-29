/**
 * 人话门禁的确定性部分（references/voice.md 第六节「禁写清单」）。
 * 只查可复制回复——reply 围栏里、用户会原样发出去的那几行。
 * 过气梗黑名单直接来自梗词典，不再维护第二份词表。
 */

import { GLOSSARY, GLOSSARY_EN, findTerm, type Glossary } from "./glossary";
import type { Lang, LintFinding, LintResult } from "../shared/domain";

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

export function lint(text: string, glossaryOrLang: Glossary | Lang = GLOSSARY): LintResult {
  if (glossaryOrLang === "en") return lintEn(text);
  const glossary = typeof glossaryOrLang === "string" ? GLOSSARY : glossaryOrLang;
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
export function autofix(text: string, lang: Lang = "zh"): string {
  if (lang === "en") {
    return bubblesOf(text)
      // "ok." → "ok", but leave "..." and abbreviations like "a.m." alone
      .map((b) => b.replace(/(?<![.\s][A-Za-z]|\.)\.$/, "").replace(/!{2,}/g, "!").replace(/\?{4,}/g, "???"))
      .filter(Boolean)
      .join("\n");
  }
  return bubblesOf(text)
    .map((b) => b.replace(/。+$/, "").replace(/([！!]){2,}/g, "$1").replace(/。{2,}/g, ""))
    .map((b) => b.replace(/[，,]\s*$/, ""))
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// English vibe check (references/en/voice.md section 6)

const EN_FORMAL = /\b(furthermore|moreover|additionally|in conclusion|therefore|consequently|nevertheless|henceforth|thus)\b/i;
const EN_STIFF = [
  /hope (this|the) (message|text|email) finds you/i, /\bkind regards\b/i, /\bbest regards\b/i, /\bsincerely\b/i,
  /^dear\b/i, /^greetings\b/i, /\bhello there\b/i, /\bm'?lady\b/i, /\bi appreciate you sharing\b/i,
];
const EN_LECTURE = [/\bcalm down\b/i, /\bno offen[cs]e,? but\b/i, /\bjust saying\b/i, /\byou need to relax\b/i, /\byou'?re overthinking\b/i, /\bi'?m just being honest\b/i];
const EN_BOOTY = [/^(are )?(you|u) up\??$/i];
const EN_WARN: Array<[RegExp, string, string]> = [
  [/\byou should\b/i, "you should", "can read as lecturing — make it your own take (\"honestly I'd…\") unless it's an invite"],
  [/\b(i hear you|that'?s (so )?valid|i validate)\b/i, "therapy-speak", "sounds like a therapist, not a crush"],
  [/\bwyd\b/i, "wyd", "late at night this reads like a booty call"],
  [/\bhow (are you doing|was your day) today\b/i, "interview opener", "sounds like small talk at a job interview — open with something specific"],
  [/\bgood morning (beautiful|gorgeous|handsome)\b/i, "good morning beautiful", "early on this reads as love-bombing"],
  [/\b(ma'?am|sir)\b/i, "ma'am / sir", "reads stiff or sarcastic"],
];

function words(bubble: string): number {
  return bubble.replace(URL_RE, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function lintEn(text: string, glossary: Glossary = GLOSSARY_EN): LintResult {
  const bubbles = bubblesOf(text);
  const findings: LintFinding[] = [];
  const add = (level: LintFinding["level"], check: string, bubble: number | null, t: string, hint: string) =>
    findings.push({ level, check, bubble, text: t, hint });

  bubbles.forEach((bubble, i) => {
    const no = i + 1;
    if (/[^.]\.$/.test(bubble) && !/\b[A-Za-z]\.[A-Za-z]\.$/.test(bubble)) add("FAIL", "period", no, bubble.slice(-10), "a period ending a text reads cold or annoyed — drop it");
    if (/^k\.?$/i.test(bubble) || /^ok\.$/i.test(bubble)) add("FAIL", "k", no, bubble, "a lone \"k\" reads annoyed");
    const formal = bubble.match(EN_FORMAL);
    if (formal) add("FAIL", "formal", no, formal[0], "essay words — cut it or split into short texts");
    for (const re of EN_STIFF) { const m = bubble.match(re); if (m) add("FAIL", "stiff", no, m[0], "email / customer-service voice — say the actual thing"); }
    for (const re of EN_LECTURE) { const m = bubble.match(re); if (m) add("FAIL", "lecture", no, m[0], "talks down — share your own reaction instead"); }
    for (const re of EN_BOOTY) { const m = bubble.match(re); if (m) add("FAIL", "booty", no, m[0], "reads as a booty call"); }
    const seen = new Set<string>();
    for (const term of glossary.banned) {
      const hit = findTerm(bubble, term);
      if (hit && !seen.has(hit.matched.toLowerCase())) {
        seen.add(hit.matched.toLowerCase());
        add("FAIL", "dated", no, hit.matched, /^(u up|m'lady)$/i.test(term) ? "instantly cringe" : "dead slang — dates you, say it plainly");
      }
    }
    for (const term of glossary.shaky) {
      const hit = findTerm(bubble, term);
      if (hit) add("WARN", "stale", no, hit.matched, "aging or risky slang — plain English is safer");
    }
    for (const [re, label, hint] of EN_WARN) if (re.test(bubble)) add("WARN", "tone", no, label, hint);
    const n = words(bubble);
    if (n > 25) add("FAIL", "long", no, bubble.slice(0, 18) + "…", `${n} words is a paragraph — split it or cut it`);
    else if (n > 15) add("WARN", "longish", no, bubble.slice(0, 18) + "…", `${n} words is long for one text`);
    if (/\.{3,}|…/.test(bubble)) add("WARN", "ellipsis", no, "...", "trailing dots read hesitant or passive-aggressive");
    const caps = bubble.match(/\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/);
    if (caps && !/^(LMAO|LMFAO|LOL|OMG)$/.test(caps[0])) add("WARN", "caps", no, caps[0].slice(0, 16), "a whole sentence in caps reads like yelling");
    if (bubble.trim() === "👍") add("WARN", "thumbs", no, "👍", "a lone thumbs-up reads dismissive");
  });

  if (bubbles.length > 3) add("WARN", "many", null, `${bubbles.length} texts`, "keep it to 3 texts or fewer");
  const all = bubbles.join(" ");
  const bangs = (all.match(/!/g) ?? []).length;
  if (bangs >= 3 || /!!/.test(all)) add("WARN", "bang", null, `!×${bangs}`, "one \"!\" is warm; stacking them is a lot");
  if (all.includes("🙂")) add("WARN", "emoji", null, "🙂", "🙂 reads passive-aggressive to most people under 35");
  if (all.includes("😂")) add("WARN", "emoji", null, "😂", "😂 reads a little millennial — 💀 or 😭 land better with Gen Z");
  const emoji = [...all].filter(isEmoji).length;
  if (emoji > 2) add("WARN", "emoji", null, `emoji×${emoji}`, "one or two emoji is plenty");

  const failCount = findings.filter((f) => f.level === "FAIL").length;
  return { result: failCount ? "FAIL" : "PASS", failCount, warnCount: findings.length - failCount, findings };
}
