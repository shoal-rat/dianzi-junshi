/**
 * Optional local semantic embeddings.
 *
 * Feature hashing (embedding.ts) stays the zero-dependency floor: instant,
 * offline, great at exact terms. What it cannot do is see that 「她态度变冷了」
 * and 「她没以前热情了」 mean the same thing. This module adds that layer when —
 * and only when — the user runs a local embedding model:
 *
 *   auto   probe a local Ollama (http://127.0.0.1:11434) and use its best
 *          multilingual embedding model (bge-m3, nomic-embed-text, …)
 *   custom any OpenAI-compatible /embeddings endpoint (LM Studio, llama.cpp
 *          server, vLLM) with a configured base URL + model
 *   off    never probe, hashing only
 *
 * Nothing is downloaded, no npm dependency is added, and every failure path
 * falls back to hashing. Vectors are cached in SQLite by (text hash, model).
 */

import { decisionDatabase } from "./adaptive";
import { readSettings } from "./store";

export interface SemanticConfig {
  mode: "auto" | "off" | "custom";
  baseUrl?: string;
  model?: string;
}

export interface SemanticStatus {
  mode: SemanticConfig["mode"];
  available: boolean;
  endpoint?: string;
  model?: string;
  dims?: number;
  detail: string;
}

const OLLAMA_URL = "http://127.0.0.1:11434";
const PREFERRED_MODELS = [
  "bge-m3", "snowflake-arctic-embed2", "mxbai-embed-large",
  "granite-embedding", "nomic-embed-text", "all-minilm",
];
const PROBE_TIMEOUT_MS = 900;
const EMBED_TIMEOUT_MS = 12_000;
const PROBE_TTL_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;

interface EngineState {
  status: SemanticStatus;
  kind: "ollama" | "openai" | null;
  checkedAt: number;
}

let engine: EngineState | null = null;

export function semanticConfig(): SemanticConfig {
  if (process.env.DJ_DISABLE_SEMANTIC === "1") return { mode: "off" };
  const raw = (readSettings() as { semanticEmbedding?: SemanticConfig }).semanticEmbedding;
  if (!raw || !["auto", "off", "custom"].includes(raw.mode)) return { mode: "auto" };
  return raw;
}

export function resetSemanticEngineForTests(): void {
  engine = null;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function probe(config: SemanticConfig): Promise<EngineState> {
  const offline = (detail: string): EngineState => ({
    status: { mode: config.mode, available: false, detail }, kind: null, checkedAt: Date.now(),
  });
  if (config.mode === "off") return offline("已关闭，使用特征哈希");
  if (config.mode === "custom") {
    const base = (config.baseUrl ?? "").replace(/\/$/, "");
    if (!base || !config.model) return offline("自定义模式需要填 Base URL 和模型名");
    try {
      const data = await fetchJson(`${base}/embeddings`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: config.model, input: ["ok"] }),
      }, PROBE_TIMEOUT_MS + 2_000);
      const dims = data?.data?.[0]?.embedding?.length;
      if (!Number.isFinite(dims)) return offline("端点响应格式不是 OpenAI embeddings");
      return {
        status: { mode: "custom", available: true, endpoint: base, model: config.model, dims, detail: `已连接 ${config.model}（${dims} 维）` },
        kind: "openai", checkedAt: Date.now(),
      };
    } catch (error: any) {
      return offline(`自定义端点不可用：${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  // auto: local Ollama
  try {
    const tags = await fetchJson(`${OLLAMA_URL}/api/tags`, { method: "GET" }, PROBE_TIMEOUT_MS);
    const names: string[] = (tags?.models ?? []).map((m: any) => String(m?.name ?? ""));
    const pick = config.model && names.some((n) => n.startsWith(config.model!))
      ? config.model
      : PREFERRED_MODELS.find((p) => names.some((n) => n.startsWith(p)));
    if (!pick) return offline("检测到 Ollama，但没有可用的嵌入模型（可 ollama pull bge-m3）");
    const test = await fetchJson(`${OLLAMA_URL}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: pick, input: ["ok"] }),
    }, PROBE_TIMEOUT_MS + 4_000);
    const dims = test?.embeddings?.[0]?.length;
    if (!Number.isFinite(dims)) return offline("Ollama 嵌入响应异常");
    return {
      status: { mode: "auto", available: true, endpoint: OLLAMA_URL, model: pick, dims, detail: `Ollama · ${pick}（${dims} 维）` },
      kind: "ollama", checkedAt: Date.now(),
    };
  } catch {
    return offline("本机没有检测到 Ollama，使用特征哈希（零依赖模式）");
  }
}

export async function semanticStatus(force = false): Promise<SemanticStatus> {
  const config = semanticConfig();
  const ttl = engine?.status.available ? PROBE_TTL_MS : FAILURE_COOLDOWN_MS;
  if (!force && engine && Date.now() - engine.checkedAt < ttl && engine.status.mode === config.mode) {
    return engine.status;
  }
  engine = await probe(config);
  return engine.status;
}

function normalize(values: number[]): Float32Array {
  const out = new Float32Array(values.length);
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / norm;
  return out;
}

function cacheKey(text: string, model: string): string {
  return `${model}:${Bun.hash(text).toString(16)}:${text.length}`;
}

function readCache(keys: string[]): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (!keys.length) return out;
  const conn = decisionDatabase();
  const stmt = conn.query("SELECT hash, vector, dims FROM embedding_cache WHERE hash=?");
  for (const key of keys) {
    const row = stmt.get(key) as any;
    if (!row) continue;
    const bytes = row.vector as Uint8Array;
    out.set(key, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Number(row.dims) * 4)));
  }
  return out;
}

function writeCache(entries: Array<{ key: string; model: string; vector: Float32Array }>): void {
  if (!entries.length) return;
  const conn = decisionDatabase();
  const stmt = conn.query(`INSERT OR REPLACE INTO embedding_cache(hash, model, dims, vector, created_at)
    VALUES (?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  conn.transaction(() => {
    for (const entry of entries) {
      stmt.run(entry.key, entry.model, entry.vector.length, new Uint8Array(entry.vector.buffer), now);
    }
  })();
}

/** Embed texts with the local model; null when the engine is unavailable.
 * Results are L2-normalized and cached by (model, text hash). */
export async function semanticEmbed(texts: string[]): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  const status = await semanticStatus();
  if (!status.available || !engine?.kind || !status.model) return null;
  const keys = texts.map((text) => cacheKey(text, status.model!));
  const cached = readCache(keys);
  const missingIndexes = texts.map((_, index) => index).filter((index) => !cached.has(keys[index]));
  if (missingIndexes.length) {
    try {
      const inputs = missingIndexes.map((index) => texts[index].slice(0, 2_000));
      let vectors: number[][];
      if (engine.kind === "ollama") {
        const data = await fetchJson(`${status.endpoint}/api/embed`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: status.model, input: inputs }),
        }, EMBED_TIMEOUT_MS);
        vectors = data?.embeddings ?? [];
      } else {
        const data = await fetchJson(`${status.endpoint}/embeddings`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: status.model, input: inputs }),
        }, EMBED_TIMEOUT_MS);
        vectors = (data?.data ?? []).map((d: any) => d.embedding);
      }
      if (vectors.length !== missingIndexes.length) throw new Error("嵌入数量不匹配");
      const fresh: Array<{ key: string; model: string; vector: Float32Array }> = [];
      missingIndexes.forEach((index, at) => {
        const vector = normalize(vectors[at] ?? []);
        cached.set(keys[index], vector);
        fresh.push({ key: keys[index], model: status.model!, vector });
      });
      writeCache(fresh);
    } catch {
      // One failed batch flips the engine into cooldown; callers fall back to hashing.
      if (engine) engine = { ...engine, status: { ...status, available: false, detail: "嵌入调用失败，暂时回退特征哈希" }, checkedAt: Date.now() };
      return null;
    }
  }
  return keys.map((key) => cached.get(key)!).map((v) => v ?? null) as Float32Array[];
}

export function semanticCosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let score = 0;
  for (let i = 0; i < n; i += 1) score += a[i] * b[i];
  return Math.max(-1, Math.min(1, score));
}
