import { database, now, uid } from "./db";
import { getImage, imageRef } from "./images";
import { outcomeForTurn } from "./learning";
import { SEAL_EN, type Lang, type MemeHit, type Mode, type PlanCheck, type TurnContext, type TurnDTO } from "../shared/domain";
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

/** 启动时收尾：上次进程退出时还在写的那几轮，标成出错，免得永远卡在「写到一半」。 */
export function failInterruptedTurns(message: string): number {
  return database().query("UPDATE turns SET status='error', error=? WHERE status='streaming'").run(message).changes;
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

const MODE_WORD: Record<Lang, Record<Mode, string>> = {
  zh: { reply: "怎么回", read: "读懂", polish: "帮我改", odds: "有没有戏" },
  en: { reply: "Reply", read: "Decode", polish: "Check my text", odds: "Any chance?" },
};

const OUT_WORD: Record<Lang, Record<string, string>> = {
  zh: { good: "接住了", meh: "反应一般", cold: "变冷了", ghosted: "没回" },
  en: { good: "landed", meh: "was meh", cold: "went cold", ghosted: "no reply" },
};

/**
 * 最近几轮对话的紧凑摘要：ta 说了什么、军师推荐了什么、用户复制了哪条、后来怎样。
 * 截图轮只写「截图 ×N」和军师读出来的原话。
 */
export function recentForPrompt(personId: string, beforeTurnId: string, count = 8, lang: Lang = "zh"): { text: string; ids: string[] } {
  const en = lang === "en";
  const rows = (database().query("SELECT * FROM turns WHERE person_id=? AND id != ? AND status='done' ORDER BY created_at DESC LIMIT ?")
    .all(personId, beforeTurnId, count) as TurnRow[]).reverse();
  const lines: string[] = [];
  const seal = (x: string) => (en ? SEAL_EN[x] ?? x : x);
  for (const r of rows) {
    const t = toDTO(r);
    const parsed = parseAnswer(t.output);
    const said = t.input.trim() ? t.input.trim().replace(/\n+/g, " / ").slice(0, 240) : "";
    const shot = t.images.length
      ? en ? `${t.images.length} screenshot${t.images.length > 1 ? "s" : ""}${parsed.judge?.original ? ` (their last line: "${parsed.judge.original}")` : ""}`
        : `截图 ×${t.images.length}${parsed.judge?.original ? `（ta 最后一句：「${parsed.judge.original}」）` : ""}`
      : "";
    const who = t.mode === "polish" ? (en ? "user wanted to send" : "用户想发") : (en ? "them / situation" : "ta / 情况");
    lines.push(`[${shortDate(t.createdAt)} ${MODE_WORD[lang][t.mode]}] ${who}${en ? ": " : "："}${[said, shot].filter(Boolean).join(" ")}`);
    if (parsed.judge?.verdict) lines.push(en ? `  Junshi's read: ${parsed.judge.verdict}` : `  军师判断：${parsed.judge.verdict}`);
    const pick = parsed.pick?.seal;
    if (parsed.plans.length) {
      const copied = t.copied ?? [];
      const chosen = copied.length ? parsed.plans.filter((p) => copied.includes(p.index)) : [];
      if (chosen.length) lines.push(en
        ? `  User copied ${chosen.map((p) => seal(p.seal)).join(", ")}: ${chosen.map((p) => p.lines.join(" / ")).join(" | ")}`
        : `  用户复制了「${chosen.map((p) => p.seal).join("、")}」：${chosen.map((p) => p.lines.join(" / ")).join(" ｜ ")}`);
      else if (pick) lines.push(en ? `  Junshi picked ${seal(pick)}` : `  军师推荐了「${pick}」`);
    }
    if (t.outcome) lines.push(en
      ? `  After: user actually sent "${t.outcome.sent.replace(/\n/g, " / ")}", they ${OUT_WORD.en[t.outcome.result]}${t.outcome.reply ? `, replying "${t.outcome.reply.slice(0, 80)}"` : ""}`
      : `  后来：用户实际发了「${t.outcome.sent.replace(/\n/g, " / ")}」，ta ${OUT_WORD.zh[t.outcome.result]}${t.outcome.reply ? `，回的是「${t.outcome.reply.slice(0, 80)}」` : ""}`);
  }
  return { text: lines.join("\n"), ids: rows.map((r) => r.id) };
}
