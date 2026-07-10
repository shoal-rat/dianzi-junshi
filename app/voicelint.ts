/**
 * 人话门禁的 TypeScript 版（与 tools/voice_lint.py 同源同词表）。
 * 服务端在流式输出结束后，对每个 ```reply 围栏里的可复制回复跑一遍，
 * 把 FAIL/WARN 以结构化结果回给前端渲染成检查徽章。
 * 词表与 references/glossary.md 的「过气」清单保持同步（改词表三处一起改）。
 */

export interface LintFinding {
  level: "FAIL" | "WARN";
  check: string;
  bubble: number | null; // 1-based；null = 整体检查
  text: string;
  hint: string;
}

export interface LintResult {
  result: "PASS" | "FAIL";
  failCount: number;
  warnCount: number;
  bubbles: string[];
  findings: LintFinding[];
}

const FORMAL_CONNECTIVES = [
  "然而", "因此", "综上", "首先", "其次", "再者", "与此同时",
  "总而言之", "众所周知", "不仅如此", "由此可见", "换言之", "与其说",
];

const ELDER_PHRASES = [
  "呵呵", "在吗", "多喝热水", "喝口水", "早点休息", "早点睡", "注意身体",
  "保重", "记你一功", "表现不错", "吃了吗", "亲爱的", "小仙女", "妹妹你",
  "我都是为你好", "听我一句劝", "你还年轻",
];

const LECTURE_PATTERNS = [
  "你应该", "建议你", "记得要", "别忘了", "要注意", "我跟你说",
  "说句实话", "讲道理，", "讲道理,",
];

export const DATED_MEMES = [
  "泰裤辣", "尊嘟假嘟", "栓Q", "芭比Q", "我不李姐", "退退退", "老六",
  "绝绝子", "YYDS", "无语子", "咱就是说", "奥利给", "集美",
  "爷青回", "夺笋", "干饭人", "凡尔赛体", "网抑云", "蓝瘦香菇",
  "洪荒之力", "皮皮虾我们走", "扎心了老铁", "老铁666", "skr",
  "疯狂打call", "神马都是", "有木有", "酱紫", "伤不起", "雪糕刺客",
  "命运的齿轮", "遥遥领先", "xswl", "u1s1", "dbq", "zqsg", "挖呀挖",
  "摁在地上摩擦", "么么哒", "萌萌哒", "加油鸭", "冲鸭", "奥力给",
];

export const STALE_MEMES = [
  "哈基米", "city不city", "泼天的富贵", "硬控", "显眼包", "草台班子",
  "猫meme", "破防了",
];

const URL_RE = /(?:https?:\/\/|www\.)\S+/g;
const YO_START_RE = /^哟([，,\s]|$)/;
const ASCII_TERM_RE = /^[A-Za-z0-9]+$/;

const FAIL_LEN = 36;
const WARN_LEN = 22;

function visibleLen(bubble: string): number {
  return bubble.replace(URL_RE, "").trim().length;
}

function isEmoji(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0x2b50 || cp === 0x2b55;
}

function countEmoji(text: string): number {
  let n = 0;
  for (const ch of text) if (isEmoji(ch)) n++;
  return n;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 纯 ASCII 词整词匹配（忽略大小写），含中文的词子串匹配。返回实际命中文本或 null。 */
function findTerm(bubble: string, term: string): string | null {
  if (ASCII_TERM_RE.test(term)) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, "i");
    const m = bubble.match(re);
    return m ? m[0] : null;
  }
  const m = bubble.match(new RegExp(escapeRe(term), "i"));
  return m ? m[0] : null;
}

export function lint(text: string): LintResult {
  const bubbles = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const findings: LintFinding[] = [];
  const add = (level: "FAIL" | "WARN", check: string, bubble: number | null, t: string, hint: string) =>
    findings.push({ level, check, bubble, text: t, hint });

  bubbles.forEach((bubble, i) => {
    const no = i + 1;
    if (bubble.trimEnd().endsWith("。")) {
      add("FAIL", "period-end", no, bubble.slice(-10), "句尾句号=冷漠/生气信号 删掉");
    }
    for (const term of FORMAL_CONNECTIVES) {
      if (bubble.includes(term)) add("FAIL", "formal-connective", no, term, "书面连接词是公文腔/机器腔，口语化改写或直接删");
    }
    for (const term of ELDER_PHRASES) {
      if (bubble.includes(term)) add("FAIL", "elder-phrase", no, term, "长辈腔/查户口式关怀，换成具体的、当下的话");
    }
    if (YO_START_RE.test(bubble)) {
      add("FAIL", "yo-start", no, bubble.slice(0, 2), "开头单独的哟油腻又出戏，换个自然的开场");
    }
    for (const term of LECTURE_PATTERNS) {
      if (bubble.includes(term)) add("FAIL", "lecture-tone", no, term, "说教口吻惹人烦，改成分享自己的做法或直接给行动");
    }
    const seen = new Set<string>();
    for (const term of DATED_MEMES) {
      const matched = findTerm(bubble, term);
      if (matched && !seen.has(matched.toLowerCase())) {
        seen.add(matched.toLowerCase());
        add("FAIL", "dated-meme", no, matched, "过气热梗，一用就出戏，删掉换当下的自然说法");
      }
    }
    const length = visibleLen(bubble);
    if (length > FAIL_LEN) {
      add("FAIL", "bubble-overlong", no, bubble.slice(0, 12) + "…", `小作文警告：${length}字超过上限${FAIL_LEN}字，拆成短句或砍掉`);
    } else if (length > WARN_LEN) {
      add("WARN", "bubble-long", no, bubble.slice(0, 12) + "…", `${length}字偏长，微信气泡${WARN_LEN}字以内最像真人`);
    }
    if (bubble.includes("，") && bubble.includes("。")) {
      add("WARN", "full-punct", no, "，+。", "全套书面标点像在写公文，逗号可留、句号删掉");
    }
    if (bubble.includes("……")) {
      add("WARN", "ellipsis", no, "……", "……显得欲言又止/阴阳怪气，删掉或换成具体的话");
    }
    for (const term of ["您", "咱们"]) {
      if (bubble.includes(term)) add("WARN", "honorific", no, term, "您/咱们拉开距离感（客服腔/自来熟），改成 你/我们");
    }
    for (const term of STALE_MEMES) {
      const matched = findTerm(bubble, term);
      if (matched) add("WARN", "stale-meme", no, matched, "热梗已陈旧，慎用；拿不准就换白话");
    }
  });

  if (bubbles.length > 3) {
    add("WARN", "too-many-bubbles", null, `${bubbles.length}条气泡`, "一次回太多条像刷屏，控制在3条以内");
  }
  const fullText = bubbles.join("\n");
  const bang = (fullText.match(/[！!]/g) ?? []).length;
  if (bang >= 2) add("WARN", "exclaim-overload", null, `！×${bang}`, "感叹号太多显得用力过猛，最多留一个");
  const tilde = (fullText.match(/[～~]/g) ?? []).length;
  if (tilde > 1) add("WARN", "tilde-overload", null, `～×${tilde}`, "～超过一个就腻了，留一个够了");
  const emojiN = countEmoji(fullText);
  if (emojiN > 2) add("WARN", "emoji-overload", null, `emoji×${emojiN}`, "emoji超过2个显得浮夸，最多留1-2个点睛");

  const failCount = findings.filter((f) => f.level === "FAIL").length;
  const warnCount = findings.filter((f) => f.level === "WARN").length;
  return { result: failCount ? "FAIL" : "PASS", failCount, warnCount, bubbles, findings };
}
