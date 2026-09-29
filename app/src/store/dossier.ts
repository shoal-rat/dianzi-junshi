/**
 * 档案卡：关于 ta 的具体事实（生日、喜好、忌口、口头禅……）+ ta 的梗记忆。
 * 每轮都整份带给军师，所以不会因为「检索没命中」把生日忘掉。
 *
 * 合并规则：同栏目、字面相近的算同一条（见过次数 +1）；「基本」栏同一个键
 * （生日 / 城市 / 职业…）出现新值时，旧值标记为被覆盖，不删。
 * 「安排」栏会过期：写了日期的过了那天两天后过期，没写日期的 21 天后过期。
 */

import { database, now, uid } from "./db";
import { similarity } from "./tokenize";
import { FACT_SLOTS, type FactDTO, type FactSlot, type MemeMemoryDTO } from "../shared/domain";
import { nextAnnual, shortDate } from "../core/calendar";

export interface IncomingFact {
  slot: string;
  text: string;
  date?: string | null;
}

const SLOTS = Object.keys(FACT_SLOTS) as FactSlot[];

const SLOT_ALIASES: Record<string, FactSlot> = {
  基本: "basic", 喜欢: "like", 不喜欢: "dislike", 雷区: "dislike", 忌口: "diet", 作息: "habit", 习惯: "habit",
  口头禅: "phrase", 想做没做: "wish", 愿望: "wish", 安排: "plan", 约定: "promise", 潜台词: "subtext",
};

export function normalizeSlot(slot: string): FactSlot | null {
  const s = slot.trim();
  if ((SLOTS as string[]).includes(s)) return s as FactSlot;
  return SLOT_ALIASES[s] ?? null;
}

const BASIC_KEYS = ["生日", "城市", "职业", "工作", "学校", "专业", "年龄", "星座", "MBTI", "老家", "住", "身高"];

function basicKey(text: string): string | null {
  const head = text.split(/[：:]/)[0].trim();
  if (head && head.length <= 6 && /[：:]/.test(text)) return head.toUpperCase();
  const k = BASIC_KEYS.find((key) => text.toUpperCase().includes(key.toUpperCase()));
  return k ? k.toUpperCase() : null;
}

interface FactRow {
  id: string; person_id: string; slot: FactSlot; text: string; date: string | null; source: string; source_id: string | null;
  confidence: number; status: FactDTO["status"]; pinned: number; seen: number; created_at: string; updated_at: string;
}

export function effectiveStatus(row: Pick<FactRow, "slot" | "status" | "date" | "created_at" | "pinned">, at = Date.now()): FactDTO["status"] {
  if (row.status !== "active" || row.pinned || row.slot !== "plan") return row.status;
  if (row.date && !Number.isNaN(Date.parse(row.date))) {
    return Date.parse(row.date) + 2 * 86_400_000 < at ? "expired" : "active";
  }
  return Date.parse(row.created_at) + 21 * 86_400_000 < at ? "expired" : "active";
}

const SOURCE_LABEL: Record<string, string> = { screenshot: "截图", chat: "聊天", user: "你写的", paste: "旧聊天", feedback: "后续" };

function toDTO(r: FactRow): FactDTO {
  return {
    id: r.id, slot: r.slot, text: r.text, date: r.date ?? undefined, source: r.source,
    sourceLabel: `${SOURCE_LABEL[r.source] ?? r.source} · ${shortDate(r.created_at)}`,
    confidence: r.confidence, status: effectiveStatus(r), pinned: Boolean(r.pinned), seen: r.seen, updatedAt: r.updated_at,
  };
}

export function addFacts(personId: string, facts: IncomingFact[], source: string, sourceId?: string, confidence = 0.7): number {
  const conn = database();
  let changed = 0;
  const t = now();
  for (const f of facts) {
    const slot = normalizeSlot(f.slot);
    const text = String(f.text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!slot || text.length < 2) continue;
    const date = f.date && !Number.isNaN(Date.parse(f.date)) ? new Date(f.date).toISOString().slice(0, 10) : null;
    const existing = conn.query("SELECT * FROM facts WHERE person_id=? AND slot=? AND status='active'").all(personId, slot) as FactRow[];
    const norm = (x: string) => x.replace(/[\s，。、；;：:「」“”"'！!？?]/g, "");
    const twin = existing.find((e) => similarity(e.text, text) >= 0.72 || (norm(e.text).length >= 2 && norm(text).includes(norm(e.text))) || (norm(text).length >= 2 && norm(e.text).includes(norm(text))));
    if (twin) {
      conn.query("UPDATE facts SET seen=seen+1, confidence=MAX(confidence, ?), updated_at=?, date=COALESCE(?, date) WHERE id=?").run(confidence, t, date, twin.id);
      changed++;
      continue;
    }
    if (slot === "basic") {
      const key = basicKey(text);
      if (key) {
        const same = existing.filter((e) => basicKey(e.text) === key);
        // 用户亲手写的、确认过的，自动抽取的新说法不去动它
        if (source !== "user" && same.some((e) => e.pinned || e.source === "user")) continue;
        for (const e of same) conn.query("UPDATE facts SET status='superseded', updated_at=? WHERE id=?").run(t, e.id);
      }
    }
    conn.query(`INSERT INTO facts(id,person_id,slot,text,date,source,source_id,confidence,status,pinned,seen,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'active', 0, 1, ?, ?)`).run(uid(), personId, slot, text, date, source, sourceId ?? null, confidence, t, t);
    changed++;
  }
  return changed;
}

export function listFacts(personId: string, includeInactive = true): FactDTO[] {
  const rows = database().query("SELECT * FROM facts WHERE person_id=? AND status != 'removed' ORDER BY pinned DESC, updated_at DESC").all(personId) as FactRow[];
  const out = rows.map(toDTO);
  return includeInactive ? out : out.filter((f) => f.status === "active");
}

export function updateFact(personId: string, id: string, patch: { text?: string; slot?: string; pinned?: boolean; status?: "active" | "removed"; date?: string | null }): void {
  const conn = database();
  const row = conn.query("SELECT * FROM facts WHERE id=? AND person_id=?").get(id, personId) as FactRow | null;
  if (!row) throw new Error("找不到这条");
  const slot = patch.slot ? normalizeSlot(patch.slot) ?? row.slot : row.slot;
  const text = patch.text !== undefined ? patch.text.trim().slice(0, 160) || row.text : row.text;
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : row.pinned;
  const status = patch.status ?? row.status;
  const date = patch.date !== undefined ? patch.date : row.date;
  const source = patch.text !== undefined || patch.slot !== undefined ? "user" : row.source;
  const confidence = source === "user" ? 0.95 : row.confidence;
  conn.query("UPDATE facts SET slot=?, text=?, pinned=?, status=?, date=?, source=?, confidence=?, updated_at=? WHERE id=?")
    .run(slot, text, pinned, status, date, source, confidence, now(), id);
}

// ---------------------------------------------------------------------------
// ta 的梗记忆

export function recordMemes(personId: string, hits: Array<{ term: string; meaning: string; status: string }>): void {
  const conn = database();
  const t = now();
  for (const h of hits) {
    if (h.status === "日常化") continue;
    conn.query(`INSERT INTO memes(person_id, term, meaning, count, last_seen) VALUES(?,?,?,1,?)
      ON CONFLICT(person_id, term) DO UPDATE SET count=count+1, last_seen=excluded.last_seen`).run(personId, h.term, h.meaning.slice(0, 80), t);
  }
}

export function listMemes(personId: string): MemeMemoryDTO[] {
  const rows = database().query("SELECT * FROM memes WHERE person_id=? ORDER BY last_seen DESC LIMIT 40").all(personId) as any[];
  return rows.map((r) => ({ term: r.term, meaning: r.meaning, count: r.count, lastSeen: r.last_seen, avoid: Boolean(r.avoid) }));
}

export function setMemeAvoid(personId: string, term: string, avoid: boolean): void {
  database().query("UPDATE memes SET avoid=? WHERE person_id=? AND term=?").run(avoid ? 1 : 0, personId, term);
}

export function deleteMeme(personId: string, term: string): void {
  database().query("DELETE FROM memes WHERE person_id=? AND term=?").run(personId, term);
}

// ---------------------------------------------------------------------------
// 给军师看的版本

const CONF = (c: number) => (c >= 0.85 ? "高" : c >= 0.6 ? "中" : "低");

export function dossierForPrompt(personId: string, at = new Date()): { text: string; count: number; dates: Array<{ label: string; date: Date }> } {
  const facts = listFacts(personId, false);
  const dates: Array<{ label: string; date: Date }> = [];
  if (!facts.length) return { text: "", count: 0, dates };
  const bySlot = new Map<FactSlot, FactDTO[]>();
  for (const f of facts) {
    if (!bySlot.has(f.slot)) bySlot.set(f.slot, []);
    bySlot.get(f.slot)!.push(f);
    if (f.slot === "basic" && /生日/.test(f.text)) {
      const d = nextAnnual(f.text, at);
      if (d) dates.push({ label: "ta 的生日", date: d });
    }
    if ((f.slot === "plan" || f.slot === "promise") && f.date) dates.push({ label: f.text.slice(0, 20), date: new Date(f.date) });
  }
  const lines: string[] = [];
  let count = 0;
  for (const slot of SLOTS) {
    const list = (bySlot.get(slot) ?? []).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence * b.seen - a.confidence * a.seen).slice(0, 8);
    if (!list.length) continue;
    lines.push(`【${FACT_SLOTS[slot]}】`);
    for (const f of list) {
      count++;
      const dateNote = f.date ? `（${f.date}）` : "";
      lines.push(`- ${f.text}${dateNote} ·${f.sourceLabel} 置信${CONF(f.confidence)}${f.seen > 1 ? ` 见过${f.seen}次` : ""}${f.pinned ? " 用户确认" : ""}`);
    }
  }
  return { text: lines.join("\n"), count, dates };
}

export function memesForPrompt(personId: string): string {
  const memes = listMemes(personId);
  if (!memes.length) return "";
  const use = memes.filter((m) => !m.avoid).slice(0, 12).map((m) => `- ${m.term}${m.count > 1 ? ` ×${m.count}` : ""}（最近 ${shortDate(m.lastSeen)}）`);
  const avoid = memes.filter((m) => m.avoid).map((m) => m.term);
  return [...use, avoid.length ? `ta 反感、别用：${avoid.join("、")}` : ""].filter(Boolean).join("\n");
}
