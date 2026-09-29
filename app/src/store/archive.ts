/**
 * 素材库：旧截图的整理结果、贴进来的旧聊天、过往对话，全部原文保留，按当前问题找回。
 *
 * 召回 = BM25（词典分词 + 二元组）⊕ 可选本机语义向量，用倒数排名融合；
 * 再乘一个很轻的时间先验（越近越好一点，但老资料照样找得回来）。
 */

import { database, now, uid } from "./db";
import { tokens } from "./tokenize";
import { cosine, embed, loadVectors, saveVector, semanticStatus } from "./semantic";

export type ArchiveKind = "screenshot" | "paste" | "turn" | "sent";

export interface ArchiveDoc {
  id: string;
  personId: string;
  kind: ArchiveKind;
  sourceId?: string;
  text: string;
  happenedAt?: string;
  createdAt: string;
}

export interface Recalled extends ArchiveDoc {
  score: number;
  why: string;
}

export async function addArchive(personId: string, doc: { kind: ArchiveKind; text: string; sourceId?: string; happenedAt?: string }): Promise<string | null> {
  const text = doc.text.trim();
  if (text.length < 2) return null;
  const id = uid();
  database().query(`INSERT INTO archive(id,person_id,kind,source_id,text,tokens,happened_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, personId, doc.kind, doc.sourceId ?? null, text.slice(0, 8000), tokens(text).join(" "), doc.happenedAt ?? null, now());
  const status = await semanticStatus();
  if (status.available && status.model) {
    const [vec] = (await embed([text], status.model)) ?? [];
    if (vec) saveVector(id, status.model, vec);
  }
  return id;
}

/** 把长文本切成 600 字左右、在换行处断开的块。 */
export function chunkText(text: string, size = 600): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let cur = "";
  for (const line of lines) {
    if ((cur + "\n" + line).length > size && cur.trim()) {
      out.push(cur.trim());
      cur = "";
    }
    if (line.length > size) {
      for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size));
      continue;
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface Row {
  id: string;
  person_id: string;
  kind: ArchiveKind;
  source_id: string | null;
  text: string;
  tokens: string;
  happened_at: string | null;
  created_at: string;
}

function toDoc(r: Row): ArchiveDoc {
  return { id: r.id, personId: r.person_id, kind: r.kind, sourceId: r.source_id ?? undefined, text: r.text, happenedAt: r.happened_at ?? undefined, createdAt: r.created_at };
}

export function archiveStats(personId: string) {
  const rows = database().query("SELECT kind, COUNT(*) AS n FROM archive WHERE person_id=? AND status='active' GROUP BY kind").all(personId) as Array<{ kind: string; n: number }>;
  const by = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  return { total: rows.reduce((s, r) => s + r.n, 0), screenshots: by.screenshot ?? 0, pastes: by.paste ?? 0 };
}

const K1 = 1.4;
const B = 0.6;

export async function recall(personId: string, query: string, opts: { limit?: number; exclude?: Set<string> } = {}): Promise<Recalled[]> {
  const limit = opts.limit ?? 6;
  const q = [...new Set(tokens(query))];
  const rows = (database().query("SELECT * FROM archive WHERE person_id=? AND status='active'").all(personId) as Row[])
    .filter((r) => !opts.exclude?.has(r.source_id ?? "") && !opts.exclude?.has(r.id));
  if (!rows.length || (!q.length && !query.trim())) return [];

  // BM25
  const docs = rows.map((r) => r.tokens.split(" ").filter(Boolean));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const lexical = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    const matched: string[] = [];
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg)));
      if (t.length >= 2 && !matched.some((m) => m.includes(t) || t.includes(m))) matched.push(t);
    }
    return { i, score, matched };
  });

  // 语义（可选）
  const semantic = new Map<number, number>();
  const status = await semanticStatus();
  if (status.available && status.model && query.trim()) {
    const [qv] = (await embed([query], status.model)) ?? [];
    if (qv) {
      const vecs = loadVectors(rows.map((r) => r.id), status.model);
      rows.forEach((r, i) => {
        const v = vecs.get(r.id);
        if (v) semantic.set(i, cosine(qv, v));
      });
    }
  }

  const rank = (scores: Array<[number, number]>) => {
    const ordered = scores.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    return new Map(ordered.map(([i], r) => [i, r + 1]));
  };
  const lexRank = rank(lexical.map((l) => [l.i, l.score]));
  const semRank = rank([...semantic.entries()].filter(([, s]) => s >= 0.45));

  const nowMs = Date.now();
  const fused = rows.map((r, i) => {
    let s = 0;
    const lr = lexRank.get(i);
    const sr = semRank.get(i);
    if (lr) s += 1 / (60 + lr);
    if (sr) s += 1 / (60 + sr);
    if (!s) return { i, s: 0 };
    const ageDays = (nowMs - Date.parse(r.happened_at ?? r.created_at)) / 86_400_000;
    const prior = 0.85 + 0.15 * Math.pow(0.5, Math.max(0, ageDays) / 180);
    const kindBoost = r.kind === "screenshot" || r.kind === "paste" ? 1.05 : 1;
    return { i, s: s * prior * kindBoost };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  const picked: Recalled[] = [];
  const seenText = new Set<string>();
  for (const { i, s } of fused) {
    const r = rows[i];
    const key = r.text.slice(0, 40);
    if (seenText.has(key)) continue;
    seenText.add(key);
    const why = [
      lexical[i].matched.length ? `提到了 ${lexical[i].matched.slice(0, 3).join("、")}` : "",
      semantic.get(i) !== undefined && (semRank.get(i) ?? 99) <= 10 ? `意思相近 ${semantic.get(i)!.toFixed(2)}` : "",
    ].filter(Boolean).join("；") || "相关";
    picked.push({ ...toDoc(r), score: s, why });
    if (picked.length >= limit) break;
  }
  return picked;
}

export function deleteArchiveBySource(personId: string, sourceId: string): void {
  const conn = database();
  const ids = conn.query("SELECT id FROM archive WHERE person_id=? AND source_id=?").all(personId, sourceId) as Array<{ id: string }>;
  for (const { id } of ids) conn.query("DELETE FROM vectors WHERE archive_id=?").run(id);
  conn.query("DELETE FROM archive WHERE person_id=? AND source_id=?").run(personId, sourceId);
}
