/**
 * 从 v5 搬家：~/.dianzi-junshi/partners/<slug>/（meta.json、messages.jsonl、imports/）
 * 和 memory.sqlite3 里已经整理好的截图记忆。只搬一次，原文件留着不动。
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { database, HOME, kvGet, kvSet, now } from "./db";
import { createPerson } from "./people";
import { saveImage } from "./images";
import { addArchive, chunkText } from "./archive";
import { addFacts, normalizeSlot } from "./dossier";
import type { Mode } from "../shared/domain";

const MODE_MAP: Record<string, Mode> = { reply: "reply", analyze: "read", ask: "polish", interest: "odds" };

function guessSlot(text: string, type?: string): string {
  if (type === "attribute") return "basic";
  if (type === "preference") return /不喜欢|讨厌|雷/.test(text) ? "dislike" : "like";
  if (type === "one_time" || type === "availability") return "plan";
  if (type === "agreement") return "promise";
  if (/生日|职业|城市|学校|星座|MBTI/i.test(text)) return "basic";
  if (/不吃|忌口|过敏/.test(text)) return "diet";
  if (/不喜欢|讨厌/.test(text)) return "dislike";
  if (/喜欢|爱/.test(text)) return "like";
  return "habit";
}

export async function migrateLegacy(): Promise<number> {
  const root = join(HOME, "partners");
  if (!existsSync(root)) return 0;
  let moved = 0;
  let legacyDb: Database | null = null;
  const legacyPath = join(HOME, "memory.sqlite3");
  if (existsSync(legacyPath)) {
    try { legacyDb = new Database(legacyPath, { readonly: true }); } catch { legacyDb = null; }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (kvGet(`legacy:${slug}`)) continue;
    const dir = join(root, slug);
    let meta: any;
    try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")); } catch { continue; }
    const person = createPerson({
      name: String(meta.name ?? slug), stage: Number(meta.stage ?? 1), clearEyed: Boolean(meta.antiSimp),
      nerve: Math.round(Math.max(0, Math.min(1, Number(meta.boldness ?? 0.5))) * 4), note: String(meta.notes ?? ""),
    });
    const conn = database();
    const messages: any[] = [];
    if (existsSync(join(dir, "messages.jsonl"))) {
      for (const line of readFileSync(join(dir, "messages.jsonl"), "utf-8").split("\n")) {
        if (!line.trim()) continue;
        try { messages.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
      }
    }
    const saveAttachments = (list: any[] | undefined, origin: "turn" | "import") => (list ?? []).flatMap((a) => {
      const p = join(dir, "imports", String(a.fileName ?? ""));
      if (!a.fileName || !existsSync(p)) return [];
      try { return [saveImage(person.id, new Uint8Array(readFileSync(p)), String(a.name ?? a.fileName), origin).id]; } catch { return []; }
    });
    let lastAt = person.createdAt;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user" && m.mode === "context") {
        for (const chunk of chunkText(String(m.text ?? ""))) await addArchive(person.id, { kind: "paste", text: chunk, happenedAt: m.ts });
        saveAttachments(m.attachments, "import");
        continue;
      }
      if (m.role !== "partner") continue;
      const answer = messages[i + 1]?.role === "junshi" ? messages[++i] : null;
      const imageIds = saveAttachments(m.attachments, "turn");
      const text = /^\[图片 ×\d+\]$/.test(String(m.text)) || m.text === "（只发了图片，见附件）" ? "" : String(m.text ?? "");
      const at = String(m.ts ?? now());
      conn.query(`INSERT INTO turns(id,person_id,mode,input,image_ids,output,status,provider,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), person.id, MODE_MAP[m.mode] ?? "reply", text, JSON.stringify(imageIds), String(answer?.text ?? ""), answer ? "done" : "error", "v5", at);
      if (text) await addArchive(person.id, { kind: "turn", text, happenedAt: at });
      lastAt = at;
    }
    conn.query("UPDATE people SET created_at=?, last_turn_at=? WHERE id=?").run(String(meta.createdAt ?? person.createdAt), lastAt, person.id);
    if (legacyDb) {
      try {
        const rows = legacyDb.query("SELECT * FROM material_memories WHERE profile_slug=?").all(slug) as any[];
        for (const r of rows) {
          let facts: any[] = [];
          try { facts = JSON.parse(r.facts_json); } catch { facts = []; }
          const factTexts = facts.map((f) => (typeof f === "string" ? { text: f } : f)).filter((f) => f?.text && (f.status ?? "active") === "active");
          await addArchive(person.id, { kind: "screenshot", text: [r.summary, ...factTexts.map((f: any) => f.text)].join("\n"), happenedAt: r.observed_at });
          addFacts(person.id, factTexts.map((f: any) => ({ slot: normalizeSlot(guessSlot(f.text, f.type)) ?? "habit", text: f.text })), "screenshot", undefined, 0.65);
        }
      } catch { /* 老库结构不对就跳过这部分 */ }
    }
    kvSet(`legacy:${slug}`, { personId: person.id, at: now() });
    moved++;
  }
  legacyDb?.close();
  return moved;
}
