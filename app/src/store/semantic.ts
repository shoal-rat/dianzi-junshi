/**
 * 可选的本机语义向量：自动探测 Ollama（127.0.0.1:11434）上的嵌入模型。
 * 没装也完全能用——检索退回关键词 + 时间。向量按 (素材, 模型) 缓存在 SQLite。
 */

import { database } from "./db";
import { readSettings } from "./settings";
import { msg } from "./messages";

const OLLAMA = process.env.DJ_OLLAMA_URL || "http://127.0.0.1:11434";
const PREFERRED = ["bge-m3", "nomic-embed-text", "mxbai-embed-large", "snowflake-arctic-embed", "all-minilm"];

export interface SemanticStatus {
  available: boolean;
  model?: string;
  detail: string;
}

let cached: { at: number; status: SemanticStatus } | null = null;

export async function semanticStatus(force = false): Promise<SemanticStatus> {
  if (process.env.DJ_DISABLE_SEMANTIC === "1") return { available: false, detail: msg().semOff };
  if (readSettings().semantic === "off") return { available: false, detail: msg().semOffSetting };
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached.status;
  let status: SemanticStatus;
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(800) });
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    const model = PREFERRED.map((p) => names.find((n) => n.startsWith(p))).find(Boolean)
      ?? names.find((n) => /embed|bge|e5|gte/i.test(n));
    status = model
      ? { available: true, model, detail: msg().semReady(model) }
      : { available: false, detail: msg().semNoModel };
  } catch {
    status = { available: false, detail: msg().semNone };
  }
  cached = { at: Date.now(), status };
  return status;
}

export async function embed(texts: string[], model: string): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  try {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 2000)) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || data.embeddings.length !== texts.length) return null;
    return data.embeddings.map((v) => normalize(Float32Array.from(v)));
  } catch {
    return null;
  }
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function saveVector(archiveId: string, model: string, vec: Float32Array): void {
  database().query("INSERT OR REPLACE INTO vectors(archive_id, model, vec) VALUES(?,?,?)").run(archiveId, model, new Uint8Array(vec.buffer.slice(0)));
}

export function loadVectors(ids: string[], model: string): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (!ids.length) return out;
  const q = database().query("SELECT archive_id, vec FROM vectors WHERE model=? AND archive_id=?");
  for (const id of ids) {
    const row = q.get(model, id) as { archive_id: string; vec: Uint8Array } | null;
    if (row) out.set(id, new Float32Array(row.vec.buffer.slice(row.vec.byteOffset, row.vec.byteOffset + row.vec.byteLength)));
  }
  return out;
}

export function resetSemanticCache(): void {
  cached = null;
}
