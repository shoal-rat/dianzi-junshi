/**
 * 输出契约解析器（服务端与前端共用）。
 *
 * 军师的回答是一段 Markdown，里面嵌着几种围栏块（judge / reply / verdict /
 * strategy / aside / sticker / stop）和锦囊标题。这里把它切成有序的段落，
 * 前端按段渲染成读局卡、锦囊卡；服务端用同一份结果做人话检查、记兴趣走势。
 *
 * 流式输出时文本是半截的：没闭合的围栏标记 open=true，前端照样能边收边画。
 */

export type Seal = string; // 稳 / 撩 / 奇，模型偶尔会用别的单字

export interface Annotation {
  quote: string;
  note: string;
}

export interface Judge {
  verdict?: string; // 判断
  notes: Annotation[]; // 批
  original?: string; // 原话（截图时）
  surface?: string;
  emotion?: string;
  need?: string;
  stage?: string;
  interest?: InterestReading;
  player?: number;
  pursuit?: string;
  vibe?: string;
  extra: Array<[string, string]>;
  open: boolean;
}

export interface InterestReading {
  sweet?: number;
  initiative?: number;
  commitment?: number;
  action?: number;
  overall?: number;
  confidence?: string;
}

export interface Plan {
  index: number; // 在本条回答里的序号，从 0 开始
  seal: Seal;
  title: string;
  oil?: number;
  lines: string[];
  why: string;
  open: boolean; // reply 围栏还没收完
}

export type Segment =
  | { type: "judge"; judge: Judge }
  | { type: "plan"; plan: Plan }
  | { type: "kv"; kind: "verdict" | "strategy" | "aside" | "sticker" | "stop"; rows: Array<[string, string]>; open: boolean }
  | { type: "pick"; seal: Seal; why: string }
  | { type: "avoid"; text: string; why: string }
  | { type: "hold"; text: string; why: string }
  | { type: "md"; text: string };

export interface Parsed {
  segments: Segment[];
  judge?: Judge;
  plans: Plan[];
  pick?: { seal: Seal; why: string };
}

const KV_KINDS = new Set(["verdict", "strategy", "aside", "sticker", "stop"]);
const DEFAULT_SEALS = ["稳", "撩", "奇"];

function splitKV(line: string): [string, string] | null {
  const m = line.match(/^\s*[-*•]?\s*([^：:｜|]{1,12})\s*[：:]\s*(.*)$/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function splitBar(value: string): [string, string] {
  const idx = value.search(/[｜|]/);
  if (idx < 0) return [value.trim(), ""];
  return [value.slice(0, idx).trim(), value.slice(idx + 1).trim()];
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

export function parseInterest(value: string): InterestReading | undefined {
  const pick = (label: string) => {
    const m = value.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)`));
    return m ? Math.max(0, Math.min(10, Number(m[1]))) : undefined;
  };
  const reading: InterestReading = {
    sweet: pick("甜度"),
    initiative: pick("主动"),
    commitment: pick("承诺"),
    action: pick("行动"),
    overall: pick("总体"),
  };
  const conf = value.match(/置信\s*[:：]?\s*(高|中|低)/);
  if (conf) reading.confidence = conf[1];
  if (reading.overall === undefined) {
    const arrow = value.match(/(?:→|=|总)\s*(\d+(?:\.\d+)?)/);
    if (arrow) reading.overall = Math.min(10, Number(arrow[1]));
  }
  return Object.values(reading).some((v) => v !== undefined) ? reading : undefined;
}

export function parseJudge(body: string, open: boolean): Judge {
  const judge: Judge = { notes: [], extra: [], open };
  for (const raw of body.split("\n")) {
    const kv = splitKV(raw);
    if (!kv) continue;
    const [key, value] = kv;
    if (!value) continue;
    switch (key) {
      case "判断": judge.verdict = value; break;
      case "批": {
        const [quote, note] = splitBar(value);
        if (quote) judge.notes.push({ quote: quote.replace(/^[「“"']|[」”"']$/g, ""), note });
        break;
      }
      case "原话": judge.original = value.replace(/^[「“"]|[」”"]$/g, ""); break;
      case "表面": judge.surface = value; break;
      case "情绪": judge.emotion = value; break;
      case "需要": judge.need = value; break;
      case "阶段": judge.stage = value; break;
      case "兴趣": judge.interest = parseInterest(value); break;
      case "海王": case "海后": case "海王海后": {
        const n = num(value);
        if (n !== undefined) judge.player = Math.max(0, Math.min(100, n));
        break;
      }
      case "追法": judge.pursuit = value; break;
      case "气质": judge.vibe = value; break;
      default: judge.extra.push([key, value]);
    }
  }
  return judge;
}

// ### 稳 · 认怂接梗 · 油0.5   /   ### 方案1 · 稳妥（油0.5/5）
const PLAN_HEAD = /^#{2,4}\s*(.+)$/;

function parsePlanHead(text: string, fallbackSeal: string): { seal: string; title: string; oil?: number } {
  let rest = text.trim().replace(/^方案\s*\d+\s*[·・.、:：]?\s*/, "");
  let oil: number | undefined;
  const oilMatch = rest.match(/[（(]?\s*油(?:腻度?)?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*5)?\s*[）)]?/);
  if (oilMatch) {
    oil = Math.max(0, Math.min(5, Number(oilMatch[1])));
    rest = rest.replace(oilMatch[0], "");
  }
  const parts = rest.split(/\s*[·・|｜]\s*/).map((p) => p.trim()).filter(Boolean);
  let seal = fallbackSeal;
  if (parts.length && /^[一-鿿]$/.test(parts[0])) seal = parts.shift()!;
  else if (parts.length) {
    const spaced = parts[0].match(/^([一-鿿])\s+(.+)$/);
    if (spaced) { seal = spaced[1]; parts[0] = spaced[2]; }
    else {
      // 「稳妥」「会撩」这类整词标题：印取首字，标题保留原词
      const hit = DEFAULT_SEALS.find((s) => parts[0].includes(s));
      if (hit) seal = hit;
    }
  }
  return { seal, title: parts.join(" · ").replace(/[（(]\s*[）)]/g, "").trim(), oil };
}

function isPlanHeading(line: string): boolean {
  const m = line.match(PLAN_HEAD);
  if (!m) return false;
  const t = m[1].trim();
  return /^方案\s*\d/.test(t) || /^[稳撩奇]\s*[·・|｜\s]/.test(t) || /油\s*\d/.test(t) || /^[一-鿿]\s*[·・]/.test(t);
}

/** 有的模型会把围栏接在一句话后面（「…定下来。```judge」），把它们拆到新行。 */
export function normalizeAnswer(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/([^\n`])[ \t]*(```(?:judge|reply|verdict|strategy|aside|sticker|stop)\b)/g, "$1\n$2");
}

/** 解析一段（可能还没写完的）军师回答。 */
export function parseAnswer(text: string): Parsed {
  const lines = normalizeAnswer(text).split("\n");
  const segments: Segment[] = [];
  let md: string[] = [];
  let currentPlan: Plan | null = null;
  let planCount = 0;

  const flushMd = () => {
    const joined = md.join("\n").trim();
    md = [];
    if (!joined) return;
    if (currentPlan && !currentPlan.open) {
      // 锦囊之后、下一个标题之前的文字 = 这个锦囊的「为什么」，但推荐/避坑行要单独拎出来
      const rest: string[] = [];
      for (const l of joined.split("\n")) {
        if (/^\s*(?:\*\*)?(推荐|别这样回|暂时别说)/.test(l)) rest.push(l);
        else if (!rest.length) currentPlan.why = [currentPlan.why, l.replace(/^\s*(?:为什么|理由)\s*[：:]\s*/, "").trim()].filter(Boolean).join(" ");
        else rest.push(l);
      }
      if (rest.length) pushMd(rest.join("\n"));
      return;
    }
    pushMd(joined);
  };

  const pushMd = (block: string) => {
    const keep: string[] = [];
    const flushKeep = () => {
      const t = keep.join("\n").trim();
      keep.length = 0;
      if (t) segments.push({ type: "md", text: t });
    };
    for (const l of block.split("\n")) {
      const clean = l.replace(/^\s*[-*]\s*/, "").replace(/\*\*/g, "");
      // 推荐：奇｜理由 / 推荐：方案2｜理由 / 推荐方案2：理由
      const pick = clean.match(/^推荐\s*[：:]?\s*(?:方案\s*)?([\u4e00-\u9fff]|\d)\s*(?:[：:｜|·，,—-]+\s*(.*))?$/)
        ?? clean.match(/^推荐\s*[：:]\s*([^\s｜|·，,：:])[^｜|]*(?:[｜|]\s*(.*))?$/);
      const avoid = clean.match(/^别这样回\s*[：:]\s*(.*)$/);
      const hold = clean.match(/^暂时别说\s*[：:]\s*(.*)$/);
      if (pick) {
        flushKeep();
        let seal = pick[1];
        if (/^\d$/.test(seal)) seal = DEFAULT_SEALS[Number(seal) - 1] ?? seal;
        segments.push({ type: "pick", seal: seal.slice(0, 1), why: (pick[2] ?? "").trim() });
      } else if (avoid) {
        flushKeep();
        const [t, why] = splitBar(avoid[1]);
        const dash = !why ? t.split(/——|—/) : null;
        segments.push({ type: "avoid", text: (dash ? dash[0] : t).trim(), why: (dash?.[1] ?? why).trim() });
      } else if (hold) {
        flushKeep();
        const [t, why] = splitBar(hold[1]);
        segments.push({ type: "hold", text: t, why });
      } else keep.push(l);
    }
    flushKeep();
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z]+)?\s*$/);
    if (fence) {
      const marker = fence[1];
      const lang = (fence[2] ?? "").toLowerCase();
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        if (lines[j].trim().startsWith(marker[0].repeat(3)) && lines[j].trim().replace(/[`~]/g, "") === "") { closed = true; break; }
        body.push(lines[j]);
      }
      const open = !closed;
      if (lang === "judge") {
        flushMd();
        currentPlan = null;
        const judge = parseJudge(body.join("\n"), open);
        segments.push({ type: "judge", judge });
      } else if (lang === "reply") {
        // 围栏之前的 md 里如果刚好有一行锦囊标题，已经在下面的标题分支里建好 currentPlan
        flushMd();
        const bubbles = body.map((b) => b.trim()).filter(Boolean);
        if (currentPlan && currentPlan.lines.length === 0 && currentPlan.open) {
          currentPlan.lines = bubbles;
          currentPlan.open = open;
        } else {
          const plan: Plan = { index: planCount, seal: DEFAULT_SEALS[planCount] ?? "奇", title: "", lines: bubbles, why: "", open };
          planCount++;
          segments.push({ type: "plan", plan });
          currentPlan = plan;
        }
      } else if (KV_KINDS.has(lang)) {
        flushMd();
        currentPlan = null;
        const rows = body.map(splitKV).filter((r): r is [string, string] => Boolean(r && r[1]));
        segments.push({ type: "kv", kind: lang as any, rows, open });
      } else {
        md.push(line, ...body);
        if (closed) md.push(lines[j]);
      }
      i = closed ? j + 1 : lines.length;
      continue;
    }
    if (isPlanHeading(line)) {
      flushMd();
      const head = parsePlanHead(line.match(PLAN_HEAD)![1], DEFAULT_SEALS[planCount] ?? "奇");
      const plan: Plan = { index: planCount, seal: head.seal, title: head.title, oil: head.oil, lines: [], why: "", open: true };
      planCount++;
      segments.push({ type: "plan", plan });
      currentPlan = plan;
      i++;
      continue;
    }
    md.push(line);
    i++;
  }
  flushMd();

  // judge 之前的零碎文字多半是 agent 的过程播报（「我先看清最后一句…」），不给用户看
  const judgeAt = segments.findIndex((s) => s.type === "judge");
  if (judgeAt > 0 && segments.slice(0, judgeAt).every((s) => s.type === "md")) segments.splice(0, judgeAt);

  const plans = segments.flatMap((s) => (s.type === "plan" ? [s.plan] : []));
  const judge = segments.find((s): s is Extract<Segment, { type: "judge" }> => s.type === "judge")?.judge;
  const pickSeg = segments.find((s): s is Extract<Segment, { type: "pick" }> => s.type === "pick");
  return { segments, judge, plans, pick: pickSeg ? { seal: pickSeg.seal, why: pickSeg.why } : undefined };
}

/** 只要可复制的气泡文本，用于人话检查与复制。 */
export function planText(plan: Plan): string {
  return plan.lines.join("\n");
}

export function kvGet(rows: Array<[string, string]>, ...keys: string[]): string | undefined {
  for (const [k, v] of rows) if (keys.includes(k)) return v;
  return undefined;
}
