/**
 * 梗词典 = 扫梗表 + 人话检查黑名单的唯一来源（references/glossary.md）。
 *
 * - A / C / E 区表格行、B 区词表 → 扫对方消息用的条目
 * - D 区全部词条 → 可复制回复里的 FAIL
 * - C 区、E 区里标「慎用」→ WARN；E 区标「禁用」→ FAIL
 *
 * 改词典就是改 App 行为，不需要再同步第二份词表。
 */

import glossaryMd from "../../../references/glossary.md" with { type: "text" };
import type { MemeHit } from "../shared/domain";

export interface GlossaryEntry {
  term: string;
  matchers: string[];
  meaning: string;
  tone: string;
  status: string;
  section: string;
}

export interface Glossary {
  entries: GlossaryEntry[];
  banned: string[]; // FAIL
  shaky: string[]; // WARN
}

const CJK = /[一-鿿]/;

/** 词条 → 可匹配的字面串。「蚌埠住了 / 绷不住了」拆开；「拼好X」取字面段；单个汉字不匹配（太容易误伤）。 */
export function termMatchers(term: string): string[] {
  const out: string[] = [];
  for (const variant of term.split(/\s*\/\s*/)) {
    const cleaned = variant.replace(/[（(][^）)]*[）)]/g, "").replace(/o\.O$/i, "").trim();
    if (!cleaned) continue;
    if (/X{1,2}|×/.test(cleaned)) {
      const literal = cleaned.split(/X+|×+/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0];
      if (literal && literal.length >= 2) out.push(literal);
      continue;
    }
    if (CJK.test(cleaned) ? cleaned.length >= 2 : cleaned.length >= 2) out.push(cleaned);
  }
  return [...new Set(out)];
}

function tableCells(line: string): string[] {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** D 区的一个词条是否适合拿来做禁用词：去掉括号说明、描述性的条目。 */
function bannable(item: string): string | null {
  const t = item.replace(/[（(][^）)]*[）)]/g, "").replace(/[「」“”"]/g, "").trim();
  if (!t || t.length < 2 || t.length > 12) return null;
  if (/XX|以外|滥用|句式|无脑|接头|式$|尽头/.test(t)) return null;
  if (!CJK.test(t) && !/^[A-Za-z0-9]+$/.test(t)) return null;
  return t;
}

export function parseGlossary(md: string): Glossary {
  const entries: GlossaryEntry[] = [];
  const banned = new Set<string>();
  const shaky = new Set<string>();
  let section = "";
  for (const line of md.split("\n")) {
    const head = line.match(/^##\s+([A-F])[.．]/);
    if (head) { section = head[1]; continue; }
    if (line.startsWith("## ")) { section = ""; continue; }
    if (!section) continue;

    if (line.startsWith("|") && ["A", "C", "E"].includes(section)) {
      const cells = tableCells(line);
      if (cells.length < 2 || isSeparator(cells) || ["梗", "词"].includes(cells[0])) continue;
      const term = cells[0];
      const matchers = termMatchers(term);
      if (section === "A") {
        entries.push({ term, matchers, meaning: cells[1] ?? "", tone: cells[2] ?? "", status: cells[3] || "鲜活", section });
        if ((cells[3] ?? "").includes("慎用")) matchers.forEach((m) => shaky.add(m));
      } else if (section === "C") {
        if (/新造词|相关/.test(term)) continue;
        entries.push({ term, matchers, meaning: cells[1] ?? "", tone: "", status: "陈旧", section });
        matchers.forEach((m) => shaky.add(m));
      } else {
        const note = cells[1] ?? "";
        const status = /永久禁用|禁用/.test(note) ? "禁用" : /慎用/.test(note) ? "慎用" : "特殊";
        // 微信表情这类 [..] 条目只做说明，不参与匹配
        const usable = term.startsWith("[") ? [] : matchers;
        entries.push({ term, matchers: usable, meaning: note, tone: "", status, section });
        if (status === "禁用") usable.forEach((m) => banned.add(m));
        if (status === "慎用") usable.forEach((m) => shaky.add(m));
      }
      continue;
    }

    if (section === "B" && !line.startsWith("#") && line.includes("、")) {
      for (const raw of line.split(/[、。]/)) {
        const t = raw.replace(/[（(][^）)]*[）)]/g, "").replace(/→.*/, "").trim();
        if (t.length >= 2 && t.length <= 12 && !/[：:|#]/.test(t)) {
          for (const v of t.split("/")) {
            const clean = v.trim();
            if (clean.length >= 2) entries.push({ term: clean, matchers: [clean], meaning: "日常化词汇，不算玩梗", tone: "", status: "日常化", section });
          }
        }
      }
      continue;
    }

    if (section === "D" && /^\s*-\s/.test(line)) {
      const body = line.replace(/^\s*-\s*(\*\*[^*]+\*\*[：:]?)?/, "");
      for (const raw of body.split(/[、。；;]/)) {
        for (const piece of raw.split(/\s*\/\s*/)) {
          const t = bannable(piece);
          if (!t) continue;
          banned.add(t);
          entries.push({ term: t, matchers: [t], meaning: "过气梗", tone: "", status: "过气（别用）", section });
        }
      }
    }
  }
  // 陈旧词如果同时在 D 区，按更严的算
  for (const b of banned) shaky.delete(b);
  return { entries, banned: [...banned], shaky: [...shaky] };
}

export const GLOSSARY: Glossary = parseGlossary(glossaryMd as unknown as string);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ASCII 词整词匹配（忽略大小写），中文子串匹配。返回命中的原文片段。 */
export function findTerm(text: string, term: string): { index: number; matched: string } | null {
  if (/^[A-Za-z0-9]+$/.test(term)) {
    const m = new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, "i").exec(text);
    return m ? { index: m.index, matched: m[0] } : null;
  }
  const idx = text.indexOf(term);
  return idx >= 0 ? { index: idx, matched: term } : null;
}

/** 服务端确定性扫梗：长词优先、位置不重叠，最多 8 条。 */
export function scanMemes(text: string, glossary: Glossary = GLOSSARY): MemeHit[] {
  if (!text?.trim()) return [];
  const hits: Array<MemeHit & { index: number }> = [];
  const claimed = new Array<boolean>(text.length).fill(false);
  const ordered = glossary.entries
    .flatMap((entry) => entry.matchers.map((m) => ({ entry, m })))
    .sort((a, b) => b.m.length - a.m.length);
  const seenTerms = new Set<string>();
  for (const { entry, m } of ordered) {
    if (seenTerms.has(entry.term)) continue;
    const found = findTerm(text, m);
    if (!found) continue;
    let overlap = false;
    for (let p = found.index; p < found.index + found.matched.length; p++) if (claimed[p]) overlap = true;
    if (overlap) continue;
    for (let p = found.index; p < found.index + found.matched.length; p++) claimed[p] = true;
    seenTerms.add(entry.term);
    hits.push({ term: entry.term, matched: found.matched, meaning: entry.meaning, tone: entry.tone, status: entry.status, index: found.index });
    if (hits.length >= 8) break;
  }
  return hits.sort((a, b) => a.index - b.index).map(({ index: _i, ...rest }) => rest);
}
