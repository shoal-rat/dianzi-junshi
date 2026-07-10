/**
 * 本地存储：设置（API key 等）+ 对象档案 + 消息记录。
 * 全部落在 ~/.dianzi-junshi/ 下（可用 DIANZI_JUNSHI_HOME 覆盖）——
 * key 和聊天数据永远不进仓库目录。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import type { ProviderConfig } from "./providers";

export const DJ_HOME = process.env.DIANZI_JUNSHI_HOME || join(homedir(), ".dianzi-junshi");
const PARTNERS_DIR = join(DJ_HOME, "partners");
const CONFIG_PATH = join(DJ_HOME, "config.json");

export interface Settings {
  provider: ProviderConfig["provider"];
  providers: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
}

export interface PartnerMeta {
  slug: string;
  name: string;
  stage: number;
  antiSimp: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  role: "partner" | "user" | "junshi";
  mode?: string;
  text: string;
  ts: string;
}

function ensureDirs() {
  mkdirSync(PARTNERS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: Settings = {
  provider: "demo",
  providers: {
    claude: { model: "claude-sonnet-5" },
    deepseek: { model: "deepseek-chat" },
    glm: { model: "glm-4.6" },
    custom: {},
  },
};

export function readSettings(): Settings {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return { ...structuredClone(DEFAULT_SETTINGS), ...raw, providers: { ...structuredClone(DEFAULT_SETTINGS.providers), ...(raw.providers ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  ensureDirs();
  const cur = readSettings();
  const next: Settings = {
    provider: patch.provider ?? cur.provider,
    providers: { ...cur.providers },
  };
  if (patch.providers) {
    for (const [k, v] of Object.entries(patch.providers)) {
      const prev = next.providers[k] ?? {};
      next.providers[k] = {
        ...prev,
        ...v,
        // 前端传回掩码 key（•••）时保留原 key
        apiKey: v.apiKey && !/^•+/.test(v.apiKey) ? v.apiKey : prev.apiKey,
      };
    }
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function maskedSettings(): Settings {
  const s = readSettings();
  const masked = structuredClone(s);
  for (const v of Object.values(masked.providers)) {
    if (v.apiKey) v.apiKey = "•".repeat(8) + v.apiKey.slice(-4);
  }
  return masked;
}

export function activeProviderConfig(): ProviderConfig {
  const s = readSettings();
  const p = s.providers[s.provider] ?? {};
  return { provider: s.provider, apiKey: p.apiKey, model: p.model, baseUrl: p.baseUrl };
}

// ---------------------------------------------------------------------------
// 对象档案
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  const base = name.trim().replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return base || `partner-${Date.now().toString(36)}`;
}

export function listPartners(): PartnerMeta[] {
  ensureDirs();
  const out: PartnerMeta[] = [];
  for (const entry of readdirSync(PARTNERS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(PARTNERS_DIR, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      out.push(JSON.parse(readFileSync(metaPath, "utf-8")));
    } catch { /* skip broken */ }
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getPartner(slug: string): PartnerMeta | null {
  const metaPath = join(PARTNERS_DIR, slug, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

export function createPartner(name: string, stage: number, antiSimp: boolean): PartnerMeta {
  ensureDirs();
  let slug = slugify(name);
  let n = 2;
  while (existsSync(join(PARTNERS_DIR, slug))) slug = `${slugify(name)}-${n++}`;
  const now = new Date().toISOString();
  const meta: PartnerMeta = { slug, name: name.trim(), stage, antiSimp, createdAt: now, updatedAt: now };
  mkdirSync(join(PARTNERS_DIR, slug), { recursive: true });
  writeFileSync(join(PARTNERS_DIR, slug, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export function updatePartner(slug: string, patch: Partial<Pick<PartnerMeta, "stage" | "antiSimp" | "notes" | "name">>): PartnerMeta | null {
  const meta = getPartner(slug);
  if (!meta) return null;
  const next = { ...meta, ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(join(PARTNERS_DIR, slug, "meta.json"), JSON.stringify(next, null, 2));
  return next;
}

export function appendMessage(slug: string, msg: Omit<StoredMessage, "ts">): StoredMessage {
  const stored: StoredMessage = { ...msg, ts: new Date().toISOString() };
  appendFileSync(join(PARTNERS_DIR, slug, "messages.jsonl"), JSON.stringify(stored) + "\n");
  updatePartner(slug, {});
  return stored;
}

export function readMessages(slug: string, limit = 200): StoredMessage[] {
  const p = join(PARTNERS_DIR, slug, "messages.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean) as StoredMessage[];
}
