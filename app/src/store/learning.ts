/**
 * 从真实结果里学：打法记忆、兴趣走势、用户风格。
 *
 * 规矩沿用原来的记忆法则——先记事件，再升规则：
 * - 「聊冷了 / 没回」的原句，一次就进「同场景别再给」清单；
 * - 「接住了」的说法记为有效，同类重复出现才算稳定打法；
 * - 「一般」不写进打法记忆，只进统计。
 * 这里没有黑箱模型：每条记忆都能在档案卡里看到、改掉。
 */

import { database, now, uid } from "./db";
import { similarity } from "./tokenize";
import { bubblesOf } from "../core/voice";
import { shortDate } from "../core/calendar";
import type { InterestReading } from "../shared/contract";
import type { Outcome, OutcomeDTO, ReadingPoint, SignalKey, StyleProfile, TacticStat } from "../shared/domain";

export interface OutcomeInput {
  turnId?: string;
  planIndex?: number;
  seal?: string;
  suggested?: string;
  sent: string;
  reply?: string;
  result: Outcome;
  delayHours?: number;
  signals?: Partial<Record<SignalKey, boolean>>;
}

const RESULTS: Outcome[] = ["good", "meh", "cold", "ghosted"];

export function recordOutcome(personId: string, input: OutcomeInput): OutcomeDTO {
  if (!input.sent?.trim()) throw new Error("写一下你最后实际发的是什么");
  if (!RESULTS.includes(input.result)) throw new Error("选一下 ta 后来的反应");
  const conn = database();
  if (input.turnId) {
    // 同一轮只保留最新一次记录，改主意可以覆盖
    conn.query("DELETE FROM outcomes WHERE person_id=? AND turn_id=?").run(personId, input.turnId);
  }
  const id = uid();
  const t = now();
  conn.query(`INSERT INTO outcomes(id,person_id,turn_id,plan_index,seal,suggested,sent,reply,result,delay_hours,signals,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, personId, input.turnId ?? null, input.planIndex ?? null, input.seal?.slice(0, 2) ?? null,
    (input.suggested ?? "").slice(0, 1000), input.sent.trim().slice(0, 1000), (input.reply ?? "").trim().slice(0, 2000),
    input.result, input.delayHours ?? null, JSON.stringify(input.signals ?? {}), t,
  );
  return getOutcome(id)!;
}

function toOutcome(r: any): OutcomeDTO {
  return {
    id: r.id, turnId: r.turn_id ?? undefined, planIndex: r.plan_index ?? undefined, seal: r.seal ?? undefined, suggested: r.suggested || undefined,
    sent: r.sent, reply: r.reply, result: r.result, delayHours: r.delay_hours ?? undefined,
    signals: JSON.parse(r.signals || "{}"), createdAt: r.created_at,
  };
}

export function getOutcome(id: string): OutcomeDTO | null {
  const r = database().query("SELECT * FROM outcomes WHERE id=?").get(id);
  return r ? toOutcome(r) : null;
}

export function outcomeForTurn(turnId: string): OutcomeDTO | undefined {
  const r = database().query("SELECT * FROM outcomes WHERE turn_id=? ORDER BY created_at DESC LIMIT 1").get(turnId);
  return r ? toOutcome(r) : undefined;
}

export function deleteOutcome(personId: string, id: string): void {
  database().query("DELETE FROM outcomes WHERE id=? AND person_id=?").run(id, personId);
}

function allOutcomes(personId: string): OutcomeDTO[] {
  return (database().query("SELECT * FROM outcomes WHERE person_id=? ORDER BY created_at DESC LIMIT 400").all(personId) as any[]).map(toOutcome);
}

export function tacticStats(personId: string): TacticStat[] {
  const map = new Map<string, TacticStat>();
  for (const o of allOutcomes(personId)) {
    const seal = o.seal ?? "自写";
    const s = map.get(seal) ?? { seal, tries: 0, good: 0, meh: 0, cold: 0, ghosted: 0 };
    s.tries++;
    s[o.result]++;
    map.set(seal, s);
  }
  const rank = (seal: string) => { const i = ["稳", "撩", "奇"].indexOf(seal); return i < 0 ? 9 : i; };
  return [...map.values()].sort((a, b) => rank(a.seal) - rank(b.seal) || b.tries - a.tries);
}

export function workedAndFlopped(personId: string) {
  const outcomes = allOutcomes(personId);
  const worked: Array<{ text: string; seal?: string; count: number; lastAt: string }> = [];
  for (const o of outcomes.filter((x) => x.result === "good")) {
    const twin = worked.find((w) => similarity(w.text, o.sent) >= 0.6);
    if (twin) twin.count++;
    else worked.push({ text: o.sent, seal: o.seal, count: 1, lastAt: o.createdAt });
  }
  const flopped = outcomes.filter((x) => x.result === "cold" || x.result === "ghosted")
    .slice(0, 10).map((o) => ({ text: o.sent, seal: o.seal, result: o.result, at: o.createdAt }));
  return { worked: worked.slice(0, 10), flopped };
}

// ---------------------------------------------------------------------------
// 兴趣走势

export function recordReading(personId: string, turnId: string, interest: InterestReading | undefined, player: number | undefined): void {
  if (!interest && player === undefined) return;
  database().query(`INSERT OR REPLACE INTO readings(turn_id, person_id, at, sweet, initiative, commitment, action, overall, player)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(turnId, personId, now(), interest?.sweet ?? null, interest?.initiative ?? null,
    interest?.commitment ?? null, interest?.action ?? null, interest?.overall ?? null, player ?? null);
}

export function readings(personId: string, limit = 30): ReadingPoint[] {
  const rows = database().query("SELECT * FROM readings WHERE person_id=? ORDER BY at DESC LIMIT ?").all(personId, limit) as any[];
  return rows.reverse().map((r) => ({
    turnId: r.turn_id, at: r.at, sweet: r.sweet ?? undefined, initiative: r.initiative ?? undefined,
    commitment: r.commitment ?? undefined, action: r.action ?? undefined, overall: r.overall ?? undefined, player: r.player ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// 用户风格：从用户实际发出去的话里统计，不靠自述

export function styleProfile(personId: string): StyleProfile {
  const outcomes = allOutcomes(personId);
  const samples = outcomes.map((o) => o.sent).filter(Boolean);
  if (samples.length < 2) return { samples: samples.length, habits: [] };
  const bubbleLists = samples.map(bubblesOf);
  const bubbles = bubbleLists.flat();
  const avgLen = Math.round(bubbles.reduce((s, b) => s + [...b].length, 0) / Math.max(1, bubbles.length));
  const perMsg = Math.round((bubbles.length / samples.length) * 10) / 10;
  const punctCount = bubbles.filter((b) => /[，。！？,.!?]/.test(b)).length / bubbles.length;
  const punctuation: StyleProfile["punctuation"] = punctCount < 0.2 ? "none" : punctCount < 0.6 ? "light" : "full";
  const habits: string[] = [];
  if (punctuation === "none") habits.push("基本不打标点");
  const joined = samples.join("\n");
  const laugh = joined.match(/哈{3,}/g);
  if (laugh && laugh.length >= 2) habits.push(`笑用「${laugh.sort((a, b) => b.length - a.length)[0].slice(0, 6)}」`);
  for (const word of ["好滴", "好哒", "嗯嗯", "okok", "哈哈", "救命", "笑死", "捏", "叭", "～"]) {
    if (samples.filter((s) => s.includes(word)).length >= 2) habits.push(`常用「${word}」`);
  }
  const paired = outcomes.filter((o) => o.suggested && o.sent && o.suggested !== o.sent);
  if (paired.length >= 2) {
    const ratio = paired.reduce((s, o) => s + [...o.sent].length / Math.max(1, [...o.suggested!].length), 0) / paired.length;
    if (ratio < 0.8) habits.push("会把建议改得更短");
    if (ratio > 1.3) habits.push("会把建议写得更长");
    const droppedBang = paired.filter((o) => /[！!]/.test(o.suggested!) && !/[！!]/.test(o.sent)).length;
    if (droppedBang >= 2) habits.push("会删掉感叹号");
  }
  return { samples: samples.length, avgLen, bubbles: perMsg, punctuation, habits: habits.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// 给军师看的版本

const RESULT_LABEL: Record<Outcome, string> = { good: "接住了", meh: "一般", cold: "聊冷了", ghosted: "没回" };

export function learningForPrompt(personId: string): { tactics: string; style: string; trend: string; count: number } {
  const stats = tacticStats(personId);
  const { worked, flopped } = workedAndFlopped(personId);
  const lines: string[] = [];
  if (stats.length) {
    lines.push("各锦囊战绩：" + stats.map((s) => `${s.seal} ${s.tries} 次（接住 ${s.good}、一般 ${s.meh}、冷 ${s.cold}、没回 ${s.ghosted}）`).join("；"));
  }
  if (worked.length) {
    lines.push("接住了的说法（同场景优先这个路子）：");
    for (const w of worked.slice(0, 6)) lines.push(`- 「${w.text.replace(/\n/g, " / ")}」${w.seal ? `〔${w.seal}〕` : ""}${w.count > 1 ? ` ×${w.count}，已经是稳定打法` : ""}`);
  }
  if (flopped.length) {
    lines.push("聊冷了 / 没回的原句（同场景别再给相近的）：");
    for (const f of flopped.slice(0, 6)) lines.push(`- 「${f.text.replace(/\n/g, " / ")}」→ ${RESULT_LABEL[f.result]}（${shortDate(f.at)}）`);
  }
  const style = styleProfile(personId);
  const styleText = style.samples >= 2
    ? `用户实际发出去的 ${style.samples} 条：平均每条气泡 ${style.avgLen} 字，每次 ${style.bubbles} 条；${style.habits.join("，") || "没有特别明显的习惯"}。`
    : "";
  const pts = readings(personId, 8).filter((p) => p.overall !== undefined);
  const trend = pts.length >= 2
    ? `最近 ${pts.length} 次兴趣读数（总体）：${pts.map((p) => p.overall).join(" → ")}${pts.some((p) => p.player !== undefined) ? `；海王指数最近 ${pts.filter((p) => p.player !== undefined).slice(-1)[0]?.player}` : ""}`
    : "";
  return { tactics: lines.join("\n"), style: styleText, trend, count: stats.reduce((s, x) => s + x.tries, 0) };
}
