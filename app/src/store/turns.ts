import { database, now, uid } from "./db";
import { getImage, imageRef } from "./images";
import { outcomeForTurn } from "./learning";
import type { MemeHit, Mode, PlanCheck, TurnContext, TurnDTO } from "../shared/domain";
import { parseAnswer } from "../shared/contract";
import { shortDate } from "../core/calendar";

interface TurnRow {
  id: string; person_id: string; mode: Mode; input: string; image_ids: string; output: string; checks: string; memes: string;
  context: string | null; status: TurnDTO["status"]; error: string | null; provider: string | null; model: string | null;
  copied: string; created_at: string;
}

function toDTO(r: TurnRow): TurnDTO {
  const ids: string[] = JSON.parse(r.image_ids || "[]");
  return {
    id: r.id, personId: r.person_id, mode: r.mode, input: r.input,
    images: ids.map(getImage).filter(Boolean).map((img) => imageRef(img!)),
    output: r.output, checks: JSON.parse(r.checks || "[]"), memes: JSON.parse(r.memes || "[]"),
    status: r.status, error: r.error ?? undefined, provider: r.provider ?? undefined, model: r.model ?? undefined,
    createdAt: r.created_at, context: r.context ? JSON.parse(r.context) : undefined,
    outcome: outcomeForTurn(r.id), copied: JSON.parse(r.copied || "[]"),
  };
}

export function createTurn(input: { personId: string; mode: Mode; text: string; imageIds: string[]; memes: MemeHit[]; provider: string; model?: string }): TurnDTO {
  const id = uid();
  database().query(`INSERT INTO turns(id,person_id,mode,input,image_ids,memes,status,provider,model,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, input.personId, input.mode, input.text.slice(0, 20000), JSON.stringify(input.imageIds), JSON.stringify(input.memes), "streaming", input.provider, input.model ?? null, now());
  return getTurn(id)!;
}

export function finishTurn(id: string, patch: { output: string; checks: PlanCheck[]; context: TurnContext; status: "done" | "error"; error?: string }): void {
  database().query("UPDATE turns SET output=?, checks=?, context=?, status=?, error=? WHERE id=?")
    .run(patch.output, JSON.stringify(patch.checks), JSON.stringify(patch.context), patch.status, patch.error ?? null, id);
}

export function updateTurnOutput(id: string, output: string, checks: PlanCheck[]): void {
  database().query("UPDATE turns SET output=?, checks=? WHERE id=?").run(output, JSON.stringify(checks), id);
}

export function getTurn(id: string): TurnDTO | null {
  const r = database().query("SELECT * FROM turns WHERE id=?").get(id) as TurnRow | null;
  return r ? toDTO(r) : null;
}

export function listTurns(personId: string, limit = 60, before?: string): TurnDTO[] {
  const rows = (before
    ? database().query("SELECT * FROM turns WHERE person_id=? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(personId, before, limit)
    : database().query("SELECT * FROM turns WHERE person_id=? ORDER BY created_at DESC LIMIT ?").all(personId, limit)) as TurnRow[];
  return rows.reverse().map(toDTO);
}

export function markCopied(turnId: string, planIndex: number): void {
  const r = database().query("SELECT copied FROM turns WHERE id=?").get(turnId) as { copied: string } | null;
  if (!r) return;
  const list: number[] = JSON.parse(r.copied || "[]");
  if (!list.includes(planIndex)) list.push(planIndex);
  database().query("UPDATE turns SET copied=? WHERE id=?").run(JSON.stringify(list), turnId);
}

export function deleteTurn(personId: string, id: string): void {
  database().query("DELETE FROM turns WHERE id=? AND person_id=?").run(id, personId);
  database().query("DELETE FROM readings WHERE turn_id=?").run(id);
}

const MODE_WORD: Record<Mode, string> = { reply: "怎么回", read: "读懂", polish: "帮我改", odds: "有没有戏" };

/**
 * 最近几轮对话的紧凑摘要：ta 说了什么、军师推荐了什么、用户复制了哪条、后来怎样。
 * 截图轮只写「截图 ×N」和军师读出来的原话。
 */
export function recentForPrompt(personId: string, beforeTurnId: string, count = 8): { text: string; ids: string[] } {
  const rows = (database().query("SELECT * FROM turns WHERE person_id=? AND id != ? AND status='done' ORDER BY created_at DESC LIMIT ?")
    .all(personId, beforeTurnId, count) as TurnRow[]).reverse();
  const lines: string[] = [];
  for (const r of rows) {
    const t = toDTO(r);
    const parsed = parseAnswer(t.output);
    const said = t.input.trim() ? t.input.trim().replace(/\n+/g, " / ").slice(0, 240) : "";
    const shot = t.images.length ? `截图 ×${t.images.length}${parsed.judge?.original ? `（ta 最后一句：「${parsed.judge.original}」）` : ""}` : "";
    const who = t.mode === "polish" ? "用户想发" : "ta / 情况";
    lines.push(`[${shortDate(t.createdAt)} ${MODE_WORD[t.mode]}] ${who}：${[said, shot].filter(Boolean).join(" ")}`);
    if (parsed.judge?.verdict) lines.push(`  军师判断：${parsed.judge.verdict}`);
    const pick = parsed.pick?.seal;
    if (parsed.plans.length) {
      const copied = t.copied ?? [];
      const chosen = copied.length ? parsed.plans.filter((p) => copied.includes(p.index)) : [];
      if (chosen.length) lines.push(`  用户复制了「${chosen.map((p) => p.seal).join("、")}」：${chosen.map((p) => p.lines.join(" / ")).join(" ｜ ")}`);
      else if (pick) lines.push(`  军师推荐了「${pick}」`);
    }
    if (t.outcome) lines.push(`  后来：用户实际发了「${t.outcome.sent.replace(/\n/g, " / ")}」，ta ${({ good: "接住了", meh: "反应一般", cold: "变冷了", ghosted: "没回" } as const)[t.outcome.result]}${t.outcome.reply ? `，回的是「${t.outcome.reply.slice(0, 80)}」` : ""}`);
  }
  return { text: lines.join("\n"), ids: rows.map((r) => r.id) };
}
