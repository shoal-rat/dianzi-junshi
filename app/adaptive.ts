/**
 * Temporal, outcome-aware profile storage.
 *
 * SQLite is the durable source of truth. Observations are append-only so a person can
 * change without erasing what used to be true. Current traits are calculated from two
 * time scales (recent + long-term), with confidence shrinkage and change detection.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { DJ_HOME } from "./store";
import type { MaterialMemory } from "./materials";

const VECTOR_DIMS = 384;
const DB_PATH = join(DJ_HOME, "memory.sqlite3");
let database: Database | null = null;
let vectorExtension = false;

export type FeedbackOutcome = "positive" | "neutral" | "negative" | "no_reply";

export interface OutcomeFeedback {
  decisionId?: string;
  strategyId?: string;
  replyId?: string;
  replyText: string;
  partnerResponse?: string;
  outcome: FeedbackOutcome;
  responseDelayHours?: number;
  signals?: {
    continued?: boolean;
    initiated?: boolean;
    followedThrough?: boolean;
    brokePromise?: boolean;
    rememberedDetail?: boolean;
    forgotDetail?: boolean;
  };
  observedAt?: string;
}

export interface AdaptiveTrait {
  key: string;
  label: string;
  current: number;
  shortTerm: number;
  longTerm: number;
  confidence: number;
  changing: boolean;
  evidenceCount: number;
}

export interface StrategyWeight {
  key: string;
  label: string;
  score: number;
  confidence: number;
  multiplier: number;
  samples: number;
}

export interface AdaptiveProfile {
  traits: AdaptiveTrait[];
  strategies: StrategyWeight[];
  responseEvidenceWeight: number;
  actionEvidenceWeight: number;
  feedbackCount: number;
  summary: string;
}

const TRAITS: Record<string, string> = {
  responsiveness: "回应意愿",
  initiative: "主动程度",
  follow_through: "说到做到",
  memory_care: "记得细节",
  warmth: "互动热度",
};

const STRATEGIES: Record<string, string> = {
  short: "短句",
  question: "留问题",
  playful: "轻松玩笑",
  direct: "直接表达",
  invite: "推进见面",
  warm: "表达关心",
};

function tryEnableVectorExtension() {
  if (process.env.DJ_DISABLE_SQLITE_VEC === "1") return;
  const packagedSqlite = process.env.DJ_SQLITE_LIBRARY;
  if (packagedSqlite && existsSync(packagedSqlite)) {
    try { Database.setCustomSQLite(packagedSqlite); } catch { /* another connection may already exist */ }
    return;
  }
  // Bun's bundled SQLite on macOS may disable extensions. Homebrew SQLite is an
  // optional zero-configuration acceleration path; other systems safely fall back.
  if (process.platform === "darwin") {
    const candidates = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    ].filter(Boolean) as string[];
    const custom = candidates.find(existsSync);
    if (custom) {
      try { Database.setCustomSQLite(custom); } catch { /* another connection may already exist */ }
    }
  }
}

export function decisionDatabase(): Database {
  if (database) return database;
  mkdirSync(DJ_HOME, { recursive: true, mode: 0o700 });
  tryEnableVectorExtension();
  database = new Database(DB_PATH, { create: true, strict: true });
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA synchronous = NORMAL");
  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA busy_timeout = 5000");
  if (process.env.DJ_DISABLE_SQLITE_VEC !== "1") {
    try {
      const packagedExtension = process.env.DJ_SQLITE_VEC_PATH;
      if (packagedExtension && existsSync(packagedExtension)) database.loadExtension(packagedExtension);
      else sqliteVec.load(database);
      vectorExtension = true;
    } catch {
      vectorExtension = false;
    }
  }
  migrate(database);
  return database;
}

// Internal alias retained so the original adaptive-profile code and the new
// decision engine share one WAL-backed source of truth.
const db = decisionDatabase;

function migrate(conn: Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS material_memories (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_slug TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      source_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      summary TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      people_json TEXT NOT NULL,
      dates_json TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      importance REAL NOT NULL,
      retrieval_text TEXT NOT NULL,
      vector BLOB NOT NULL,
      related_ids_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(profile_slug, memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_material_profile_time
      ON material_memories(profile_slug, observed_at DESC);
    CREATE TABLE IF NOT EXISTS feedback_events (
      id TEXT PRIMARY KEY,
      profile_slug TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      partner_response TEXT NOT NULL,
      outcome TEXT NOT NULL,
      response_delay_hours REAL,
      signals_json TEXT NOT NULL,
      strategy_keys_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_profile_time
      ON feedback_events(profile_slug, observed_at DESC);
    CREATE TABLE IF NOT EXISTS trait_observations (
      id TEXT PRIMARY KEY,
      profile_slug TEXT NOT NULL,
      trait_key TEXT NOT NULL,
      value REAL NOT NULL,
      confidence REAL NOT NULL,
      source_id TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_traits_profile_key_time
      ON trait_observations(profile_slug, trait_key, observed_at DESC);
  `);
  if (vectorExtension) {
    try {
      conn.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS material_vectors USING vec0(
        embedding float[${VECTOR_DIMS}],
        profile_slug text partition key,
        memory_id text
      )`);
    } catch {
      vectorExtension = false;
    }
  }
  conn.query("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function decodeBase64Vector(encoded: string): Uint8Array {
  const bytes = Buffer.from(encoded, "base64");
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function encodeVector(blob: unknown): string {
  if (blob instanceof Uint8Array) return Buffer.from(blob).toString("base64");
  if (blob instanceof ArrayBuffer) return Buffer.from(blob).toString("base64");
  return "";
}

export function sqliteCapabilities() {
  db();
  return { sqlite: true, vectorExtension, path: DB_PATH };
}

export function upsertMaterialMemory(slug: string, memory: MaterialMemory): void {
  const conn = db();
  const vector = decodeBase64Vector(memory.vector);
  const now = new Date().toISOString();
  const transaction = conn.transaction(() => {
    conn.query(`INSERT INTO material_memories(
      profile_slug, memory_id, file_name, source_name, media_type, observed_at, provider,
      summary, facts_json, keywords_json, people_json, dates_json, sentiment, importance,
      retrieval_text, vector, related_ids_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_slug, memory_id) DO UPDATE SET
      file_name=excluded.file_name, source_name=excluded.source_name, media_type=excluded.media_type,
      observed_at=excluded.observed_at, provider=excluded.provider, summary=excluded.summary,
      facts_json=excluded.facts_json, keywords_json=excluded.keywords_json,
      people_json=excluded.people_json, dates_json=excluded.dates_json,
      sentiment=excluded.sentiment, importance=excluded.importance,
      retrieval_text=excluded.retrieval_text, vector=excluded.vector,
      related_ids_json=excluded.related_ids_json, updated_at=excluded.updated_at`)
      .run(
        slug, memory.id, memory.fileName, memory.sourceName, memory.mediaType, memory.createdAt,
        memory.provider, memory.summary, JSON.stringify(memory.facts), JSON.stringify(memory.keywords),
        JSON.stringify(memory.people), JSON.stringify(memory.dates), memory.sentiment, memory.importance,
        memory.retrievalText, vector, JSON.stringify(memory.relatedIds), now,
      );
    if (vectorExtension) {
      const row = conn.query("SELECT rowid FROM material_memories WHERE profile_slug=? AND memory_id=?")
        .get(slug, memory.id) as { rowid: number } | null;
      if (row) {
        conn.query("DELETE FROM material_vectors WHERE rowid=?").run(row.rowid);
        conn.query("INSERT INTO material_vectors(rowid, embedding, profile_slug, memory_id) VALUES (?, ?, ?, ?)")
          .run(row.rowid, vector, slug, memory.id);
      }
    }
  });
  transaction();
}

export function readMaterialMemoriesDb(slug: string): MaterialMemory[] {
  const rows = db().query(`SELECT memory_id, file_name, source_name, media_type, observed_at, provider,
    summary, facts_json, keywords_json, people_json, dates_json, sentiment, importance,
    retrieval_text, vector, related_ids_json
    FROM material_memories WHERE profile_slug=? ORDER BY observed_at`).all(slug) as any[];
  return rows.map((row) => ({
    id: String(row.memory_id), fileName: String(row.file_name), sourceName: String(row.source_name),
    mediaType: String(row.media_type), createdAt: String(row.observed_at), provider: String(row.provider),
    summary: String(row.summary), facts: parseJson(row.facts_json, []), keywords: parseJson(row.keywords_json, []),
    people: parseJson(row.people_json, []), dates: parseJson(row.dates_json, []),
    sentiment: String(row.sentiment), importance: Number(row.importance), retrievalText: String(row.retrieval_text),
    vector: encodeVector(row.vector), relatedIds: parseJson(row.related_ids_json, []),
  }));
}

/** Returns cosine similarity candidates from sqlite-vec, or null for the JS fallback. */
export function vectorCandidates(slug: string, encodedVector: string, limit: number): Map<string, number> | null {
  if (!vectorExtension) return null;
  try {
    const rows = db().query(`SELECT memory_id, distance FROM material_vectors
      WHERE embedding MATCH ? AND k = ? AND profile_slug = ?
      ORDER BY distance`).all(decodeBase64Vector(encodedVector), Math.max(limit, 1), slug) as any[];
    return new Map(rows.map((row) => [String(row.memory_id), Math.max(0, 1 - Number(row.distance))]));
  } catch {
    return null;
  }
}

function strategyKeys(text: string): string[] {
  const keys = new Set<string>();
  const compact = text.trim();
  if (compact.length <= 28) keys.add("short");
  if (/[?？吗呢]$|[?？]/.test(compact)) keys.add("question");
  if (/哈哈|笑死|行啊|懂了|那咋|逗|玩笑|～|~/.test(compact)) keys.add("playful");
  if (/我想|我觉得|直接|说实话|坦白/.test(compact)) keys.add("direct");
  if (/见面|出来|一起|约|吃饭|电影|周末|哪天/.test(compact)) keys.add("invite");
  if (/辛苦|照顾|在意|想你|关心|别累/.test(compact)) keys.add("warm");
  if (!keys.size) keys.add(compact.length <= 45 ? "short" : "direct");
  return [...keys];
}

function outcomeValue(outcome: FeedbackOutcome): number {
  return { positive: 1, neutral: 0.55, negative: 0.08, no_reply: 0.15 }[outcome];
}

function traitRows(feedback: OutcomeFeedback): Array<{ key: string; value: number; confidence: number }> {
  const value = outcomeValue(feedback.outcome);
  const signals = feedback.signals ?? {};
  const out: Array<{ key: string; value: number; confidence: number }> = [
    { key: "warmth", value: value * 2 - 1, confidence: 0.55 },
  ];
  if (feedback.outcome === "no_reply") out.push({ key: "responsiveness", value: -0.8, confidence: 0.75 });
  else out.push({ key: "responsiveness", value: Math.max(-1, 1 - Number(feedback.responseDelayHours ?? 6) / 36), confidence: 0.65 });
  if (signals.continued !== undefined) out.push({ key: "responsiveness", value: signals.continued ? 0.65 : -0.45, confidence: 0.72 });
  if (signals.initiated !== undefined) out.push({ key: "initiative", value: signals.initiated ? 0.9 : -0.25, confidence: 0.8 });
  if (signals.followedThrough) out.push({ key: "follow_through", value: 1, confidence: 0.95 });
  if (signals.brokePromise) out.push({ key: "follow_through", value: -1, confidence: 0.95 });
  if (signals.rememberedDetail) out.push({ key: "memory_care", value: 1, confidence: 0.9 });
  if (signals.forgotDetail) out.push({ key: "memory_care", value: -0.8, confidence: 0.85 });
  return out;
}

export function recordOutcomeFeedback(slug: string, feedback: OutcomeFeedback): AdaptiveProfile {
  if (!feedback.replyText?.trim()) throw new Error("请选择你实际发出去的那句话");
  if (!(["positive", "neutral", "negative", "no_reply"] as string[]).includes(feedback.outcome)) {
    throw new Error("请选择 ta 后来的反应");
  }
  const conn = db();
  const id = crypto.randomUUID();
  const observedAt = feedback.observedAt && !Number.isNaN(Date.parse(feedback.observedAt))
    ? new Date(feedback.observedAt).toISOString() : new Date().toISOString();
  const strategies = strategyKeys(feedback.replyText);
  const transaction = conn.transaction(() => {
    conn.query(`INSERT INTO feedback_events(
      id, profile_slug, reply_text, partner_response, outcome, response_delay_hours,
      signals_json, strategy_keys_json, observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, slug, feedback.replyText.trim().slice(0, 2_000), String(feedback.partnerResponse ?? "").trim().slice(0, 4_000),
        feedback.outcome, feedback.responseDelayHours ?? null, JSON.stringify(feedback.signals ?? {}),
        JSON.stringify(strategies), observedAt, new Date().toISOString(),
      );
    const insertTrait = conn.query(`INSERT INTO trait_observations(
      id, profile_slug, trait_key, value, confidence, source_id, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const trait of traitRows(feedback)) {
      insertTrait.run(crypto.randomUUID(), slug, trait.key, trait.value, trait.confidence, id, observedAt);
    }
  });
  transaction();
  return getAdaptiveProfile(slug);
}

function decayedMean(rows: any[], halfLifeDays: number): { mean: number; mass: number } {
  const now = Date.now();
  let weighted = 0;
  let mass = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (now - Date.parse(String(row.observed_at))) / 86_400_000);
    const weight = Number(row.confidence) * Math.pow(0.5, ageDays / halfLifeDays);
    weighted += Number(row.value) * weight;
    mass += weight;
  }
  return { mean: mass ? weighted / mass : 0, mass };
}

function traitSnapshot(slug: string, key: string): AdaptiveTrait {
  const rows = db().query(`SELECT value, confidence, observed_at FROM trait_observations
    WHERE profile_slug=? AND trait_key=? ORDER BY observed_at DESC LIMIT 240`).all(slug, key) as any[];
  const recent = decayedMean(rows, 21);
  const long = decayedMean(rows, 240);
  const recentConfidence = 1 - Math.exp(-recent.mass / 2.2);
  const confidence = 1 - Math.exp(-long.mass / 4);
  const gap = Math.abs(recent.mean - long.mean);
  const changing = rows.length >= 3 && recentConfidence >= 0.42 && gap >= 0.28;
  const recentWeight = changing ? 0.72 : 0.38;
  const current = recent.mean * recentWeight + long.mean * (1 - recentWeight);
  return {
    key, label: TRAITS[key] ?? key, current, shortTerm: recent.mean, longTerm: long.mean,
    confidence, changing, evidenceCount: rows.length,
  };
}

function strategySnapshot(slug: string, key: string): StrategyWeight {
  const rows = db().query(`SELECT outcome, observed_at FROM feedback_events
    WHERE profile_slug=? AND EXISTS (
      SELECT 1 FROM json_each(strategy_keys_json) WHERE value=?
    ) ORDER BY observed_at DESC LIMIT 180`).all(slug, key) as any[];
  const now = Date.now();
  let successes = 1.5;
  let failures = 1.5;
  let effective = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (now - Date.parse(String(row.observed_at))) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / 120);
    const value = outcomeValue(row.outcome as FeedbackOutcome);
    successes += value * weight;
    failures += (1 - value) * weight;
    effective += weight;
  }
  const score = successes / (successes + failures);
  const confidence = 1 - Math.exp(-effective / 5);
  // Keep learning bounded: it guides ranking but never becomes an irreversible rule.
  const multiplier = 1 + (score - 0.5) * confidence * 0.7;
  return { key, label: STRATEGIES[key] ?? key, score, confidence, multiplier, samples: rows.length };
}

export function getAdaptiveProfile(slug: string): AdaptiveProfile {
  const traits = Object.keys(TRAITS).map((key) => traitSnapshot(slug, key));
  const strategies = Object.keys(STRATEGIES).map((key) => strategySnapshot(slug, key));
  const feedbackRow = db().query("SELECT COUNT(*) AS count FROM feedback_events WHERE profile_slug=?").get(slug) as any;
  const feedbackCount = Number(feedbackRow?.count ?? 0);
  const follow = traits.find((x) => x.key === "follow_through")!;
  const memory = traits.find((x) => x.key === "memory_care")!;
  const initiative = traits.find((x) => x.key === "initiative")!;
  const responseEvidenceWeight = Math.max(0.55, Math.min(1.25,
    0.9 + follow.current * follow.confidence * 0.18 + memory.current * memory.confidence * 0.12,
  ));
  const actionEvidenceWeight = Math.max(0.9, Math.min(1.45,
    1.1 + (1 - responseEvidenceWeight) * 0.35 + initiative.current * initiative.confidence * 0.08,
  ));
  const changing = traits.filter((x) => x.changing && x.confidence >= 0.3);
  const established = traits.filter((x) => x.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const pieces: string[] = [];
  if (!feedbackCount) pieces.push("还没有结果反馈，暂不对 ta 下长期结论");
  else {
    if (established.length) pieces.push(established.map((x) => `${x.label}${x.current >= 0.18 ? "偏高" : x.current <= -0.18 ? "偏低" : "中等"}`).join("、"));
    if (changing.length) pieces.push(`${changing.map((x) => x.label).join("、")}最近可能在变化`);
    if (!pieces.length) pieces.push(`已记下 ${feedbackCount} 次结果，样本还少，先不急着下结论`);
  }
  return { traits, strategies, responseEvidenceWeight, actionEvidenceWeight, feedbackCount, summary: pieces.join("；") };
}

export function adaptivePrompt(profile: AdaptiveProfile): string {
  if (!profile.feedbackCount) return "暂无足够的实际结果反馈，不要假装已经了解对方的固定性格。";
  const reliableTraits = profile.traits.filter((x) => x.confidence >= 0.28 && Math.abs(x.current) >= 0.12);
  const strategyHints = profile.strategies.filter((x) => x.confidence >= 0.18)
    .sort((a, b) => b.multiplier - a.multiplier).slice(0, 3);
  return [
    `实际结果反馈：${profile.feedbackCount} 次。文字表态证据权重 ${profile.responseEvidenceWeight.toFixed(2)}；实际行动证据权重 ${profile.actionEvidenceWeight.toFixed(2)}。`,
    reliableTraits.length ? `时间变化画像：${reliableTraits.map((x) => `${x.label}=${x.current.toFixed(2)}${x.changing ? "（近期变化）" : ""}，置信度${x.confidence.toFixed(2)}`).join("；")}` : "目前没有达到置信门槛的人格结论。",
    strategyHints.length ? `从真实结果看，较适合优先尝试：${strategyHints.map((x) => `${x.label}×${x.multiplier.toFixed(2)}`).join("、")}。这只是有界提示，不能覆盖当前聊天证据。` : "策略样本仍少，保持探索，不要过拟合。",
    "对近期变化优先参考短期画像；对稳定习惯参考长期画像。事实冲突时保留冲突，不要强行合并成单一性格。",
  ].join("\n");
}

export function resetAdaptiveDatabaseForTests(): void {
  database?.close();
  database = null;
  vectorExtension = false;
}
