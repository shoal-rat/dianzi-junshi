import { rmSync } from "node:fs";
import { join } from "node:path";
import { database, HOME, now, uid } from "./db";
import { msg } from "./messages";
import type { ChatLang, Gender, PersonDTO } from "../shared/domain";

interface PersonRow {
  id: string;
  name: string;
  gender: string;
  lang: string;
  stage: number;
  nerve: number;
  clear_eyed: number;
  note: string;
  created_at: string;
  updated_at: string;
  last_turn_at: string | null;
}

function toDTO(row: PersonRow, extra: { turns: number; lastLine?: string }): PersonDTO {
  return {
    id: row.id, name: row.name, gender: normGender(row.gender), lang: normLang(row.lang), stage: row.stage, nerve: row.nerve, clearEyed: Boolean(row.clear_eyed),
    note: row.note, createdAt: row.created_at, updatedAt: row.updated_at, lastTurnAt: row.last_turn_at ?? undefined,
    turns: extra.turns, lastLine: extra.lastLine,
  };
}

function lastLine(personId: string): { turns: number; lastLine?: string } {
  const conn = database();
  const count = (conn.query("SELECT COUNT(*) AS n FROM turns WHERE person_id=?").get(personId) as any)?.n ?? 0;
  const last = conn.query("SELECT input, image_ids FROM turns WHERE person_id=? ORDER BY created_at DESC LIMIT 1").get(personId) as any;
  let line: string | undefined;
  if (last) {
    const text = String(last.input ?? "").trim().split("\n").pop() ?? "";
    line = text || (JSON.parse(last.image_ids ?? "[]").length ? "[截图]" : undefined);
  }
  return { turns: Number(count), lastLine: line?.slice(0, 40) };
}

export function listPeople(): PersonDTO[] {
  const rows = database().query("SELECT * FROM people WHERE archived=0 ORDER BY COALESCE(last_turn_at, created_at) DESC").all() as PersonRow[];
  return rows.map((r) => toDTO(r, lastLine(r.id)));
}

export function getPerson(id: string): PersonDTO | null {
  const row = database().query("SELECT * FROM people WHERE id=? AND archived=0").get(id) as PersonRow | null;
  return row ? toDTO(row, lastLine(row.id)) : null;
}

export function normGender(g: unknown): Gender {
  return g === "m" || g === "f" ? g : "";
}

export function normLang(l: unknown): ChatLang {
  return l === "zh" || l === "en" ? l : "";
}

export function createPerson(input: { name: string; gender?: string; lang?: string; stage?: number; nerve?: number; clearEyed?: boolean; note?: string }): PersonDTO {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error(msg().nameRequired);
  const id = uid();
  const t = now();
  database().query(`INSERT INTO people(id,name,gender,lang,stage,nerve,clear_eyed,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, normGender(input.gender), normLang(input.lang), clampInt(input.stage ?? 1, 0, 7), clampInt(input.nerve ?? 2, 0, 4), input.clearEyed ? 1 : 0, (input.note ?? "").slice(0, 2000), t, t);
  return getPerson(id)!;
}

export function updatePerson(id: string, patch: Partial<{ name: string; gender: string; lang: string; stage: number; nerve: number; clearEyed: boolean; note: string }>): PersonDTO {
  const cur = getPerson(id);
  if (!cur) throw new Error(msg().personMissing);
  const next = {
    name: patch.name !== undefined ? patch.name.trim().slice(0, 40) || cur.name : cur.name,
    gender: patch.gender !== undefined ? normGender(patch.gender) : cur.gender,
    lang: patch.lang !== undefined ? normLang(patch.lang) : cur.lang,
    stage: patch.stage !== undefined ? clampInt(patch.stage, 0, 7) : cur.stage,
    nerve: patch.nerve !== undefined ? clampInt(patch.nerve, 0, 4) : cur.nerve,
    clearEyed: patch.clearEyed !== undefined ? Boolean(patch.clearEyed) : cur.clearEyed,
    note: patch.note !== undefined ? patch.note.slice(0, 2000) : cur.note,
  };
  database().query("UPDATE people SET name=?, gender=?, lang=?, stage=?, nerve=?, clear_eyed=?, note=?, updated_at=? WHERE id=?")
    .run(next.name, next.gender, next.lang, next.stage, next.nerve, next.clearEyed ? 1 : 0, next.note, now(), id);
  return getPerson(id)!;
}

export function touchPerson(id: string): void {
  database().query("UPDATE people SET last_turn_at=? WHERE id=?").run(now(), id);
}

/** 删除一个人的全部数据：数据库行和截图文件。 */
export function deletePerson(id: string): void {
  const conn = database();
  conn.transaction(() => {
    for (const table of ["turns", "facts", "memes", "readings", "outcomes", "jobs", "job_items", "images"]) {
      conn.query(`DELETE FROM ${table} WHERE person_id=?`).run(id);
    }
    const ids = conn.query("SELECT id FROM archive WHERE person_id=?").all(id) as Array<{ id: string }>;
    for (const { id: aid } of ids) conn.query("DELETE FROM vectors WHERE archive_id=?").run(aid);
    conn.query("DELETE FROM archive WHERE person_id=?").run(id);
    conn.query("DELETE FROM people WHERE id=?").run(id);
  })();
  if (/^[a-f0-9-]{36}$/.test(id)) rmSync(join(HOME, "people", id), { recursive: true, force: true });
}

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
