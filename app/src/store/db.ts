/**
 * 本机数据：~/.dianzi-junshi/（可用 DIANZI_JUNSHI_HOME 覆盖）
 *   junshi.db          SQLite（WAL）：人、对话轮、档案卡、梗记忆、素材库、结果、导入任务
 *   people/<id>/img/   截图原件
 *   settings.json      连接设置（API Key 不在这里，在系统凭据库）
 */

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.DIANZI_JUNSHI_HOME || join(homedir(), ".dianzi-junshi");

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch { /* Windows */ }
  return path;
}

const MIGRATIONS: string[] = [
  // v1 —— v6.0.0 的全新结构
  `
  CREATE TABLE people(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stage INTEGER NOT NULL DEFAULT 1,
    nerve INTEGER NOT NULL DEFAULT 2,
    clear_eyed INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_turn_at TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE images(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    file TEXT NOT NULL,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX images_person ON images(person_id, sha256);
  CREATE TABLE turns(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '',
    image_ids TEXT NOT NULL DEFAULT '[]',
    output TEXT NOT NULL DEFAULT '',
    checks TEXT NOT NULL DEFAULT '[]',
    memes TEXT NOT NULL DEFAULT '[]',
    context TEXT,
    status TEXT NOT NULL,
    error TEXT,
    provider TEXT,
    model TEXT,
    copied TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX turns_person ON turns(person_id, created_at);
  CREATE TABLE facts(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    text TEXT NOT NULL,
    date TEXT,
    source TEXT NOT NULL,
    source_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.7,
    status TEXT NOT NULL DEFAULT 'active',
    pinned INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX facts_person ON facts(person_id, status);
  CREATE TABLE memes(
    person_id TEXT NOT NULL,
    term TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1,
    last_seen TEXT NOT NULL,
    avoid INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(person_id, term)
  );
  CREATE TABLE archive(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id TEXT,
    text TEXT NOT NULL,
    tokens TEXT NOT NULL,
    happened_at TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX archive_person ON archive(person_id, status);
  CREATE TABLE vectors(
    archive_id TEXT NOT NULL,
    model TEXT NOT NULL,
    vec BLOB NOT NULL,
    PRIMARY KEY(archive_id, model)
  );
  CREATE TABLE readings(
    turn_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    at TEXT NOT NULL,
    sweet REAL, initiative REAL, commitment REAL, action REAL, overall REAL, player REAL
  );
  CREATE INDEX readings_person ON readings(person_id, at);
  CREATE TABLE outcomes(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    turn_id TEXT,
    plan_index INTEGER,
    seal TEXT,
    suggested TEXT NOT NULL DEFAULT '',
    sent TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL,
    delay_hours REAL,
    signals TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX outcomes_person ON outcomes(person_id, created_at);
  CREATE TABLE jobs(
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE job_items(
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    error TEXT
  );
  CREATE INDEX job_items_job ON job_items(job_id, position);
  CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // v2 —— ta 的性别（可选）：'' 没写 / 'm' 男生 / 'f' 女生
  `ALTER TABLE people ADD COLUMN gender TEXT NOT NULL DEFAULT '';`,
];

let db: Database | null = null;

export function database(): Database {
  if (db) return db;
  ensureDir(HOME);
  const conn = new Database(join(HOME, "junshi.db"), { create: true, strict: true });
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;");
  const version = Number((conn.query("PRAGMA user_version").get() as any)?.user_version ?? 0);
  for (let v = version; v < MIGRATIONS.length; v++) {
    conn.transaction(() => {
      conn.exec(MIGRATIONS[v]);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  db = conn;
  return conn;
}

/** 测试用：换一个临时 HOME 之前先关掉旧连接。 */
export function closeDatabase(): void {
  db?.close();
  db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uid(): string {
  return crypto.randomUUID();
}

export function kvGet<T>(key: string): T | null {
  const row = database().query("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}

export function kvSet(key: string, value: unknown): void {
  database().query("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}

export function personDir(personId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(personId)) throw new Error("档案编号不对");
  return ensureDir(join(HOME, "people", personId));
}
