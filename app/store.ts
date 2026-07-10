/**
 * 本地存储：设置（API key 等）+ 对象档案 + 消息记录。
 * 全部落在 ~/.dianzi-junshi/ 下（可用 DIANZI_JUNSHI_HOME 覆盖）——
 * key 和聊天数据永远不进仓库目录。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, appendFileSync, chmodSync, unlinkSync } from "node:fs";
import type { ImageAttachment, ProviderConfig } from "./providers";

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
  attachments?: StoredAttachment[];
  ts: string;
}

export interface IncomingImage extends ImageAttachment {
  name?: string;
}

export interface StoredAttachment {
  fileName: string;
  name: string;
  mediaType: string;
  size: number;
}

export interface ContextPack {
  messages: StoredMessage[];
  images: Array<{ path: string; mediaType: string }>;
  stats: { total: number; included: number; omitted: number; recent: number; relevant: number };
}

function ensureDirs() {
  mkdirSync(PARTNERS_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(DJ_HOME, 0o700); chmodSync(PARTNERS_DIR, 0o700); } catch { /* Windows / restricted FS */ }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: Settings = {
  provider: "demo",
  providers: {
    codex: {},
    "claude-code": {},
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
  const allowedProviders: ProviderConfig["provider"][] = ["codex", "claude-code", "claude", "deepseek", "glm", "custom", "demo"];
  if (patch.provider && !allowedProviders.includes(patch.provider)) throw new Error("不支持这个 AI 连接");
  const next: Settings = {
    provider: patch.provider ?? cur.provider,
    providers: { ...cur.providers },
  };
  if (patch.providers) {
    for (const [k, v] of Object.entries(patch.providers)) {
      if (!allowedProviders.includes(k as ProviderConfig["provider"]) || !v || typeof v !== "object") continue;
      const prev = next.providers[k] ?? {};
      const apiKey = typeof v.apiKey === "string" ? v.apiKey : undefined;
      next.providers[k] = {
        ...prev,
        ...v,
        // 前端传回掩码 key（•••）时保留原 key
        apiKey: apiKey && !/^•+/.test(apiKey) ? apiKey : prev.apiKey,
      };
    }
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
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

function clampStage(stage: number): number {
  return Math.max(0, Math.min(7, Number.isFinite(stage) ? Math.round(stage) : 1));
}

function validSlug(slug: string): boolean {
  return /^[\p{Script=Han}a-z0-9-]+$/u.test(slug) && slug.length <= 120;
}

function partnerDir(slug: string): string | null {
  return validSlug(slug) ? join(PARTNERS_DIR, slug) : null;
}

export function getPartnerDataDir(slug: string): string | null {
  const dir = partnerDir(slug);
  return dir && existsSync(dir) ? dir : null;
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
  const dir = partnerDir(slug);
  if (!dir) return null;
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

export function createPartner(name: string, stage: number, antiSimp: boolean): PartnerMeta {
  ensureDirs();
  const safeName = name.trim().slice(0, 60);
  let slug = slugify(safeName);
  let n = 2;
  while (existsSync(join(PARTNERS_DIR, slug))) slug = `${slugify(safeName)}-${n++}`;
  const now = new Date().toISOString();
  const meta: PartnerMeta = { slug, name: safeName, stage: clampStage(stage), antiSimp, createdAt: now, updatedAt: now };
  mkdirSync(join(PARTNERS_DIR, slug), { recursive: true, mode: 0o700 });
  writeFileSync(join(PARTNERS_DIR, slug, "meta.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
  return meta;
}

export function updatePartner(slug: string, patch: Partial<Pick<PartnerMeta, "stage" | "antiSimp" | "notes" | "name">>): PartnerMeta | null {
  const meta = getPartner(slug);
  if (!meta) return null;
  const next: PartnerMeta = {
    ...meta,
    ...patch,
    name: typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 60) : meta.name,
    stage: patch.stage === undefined ? meta.stage : clampStage(Number(patch.stage)),
    notes: typeof patch.notes === "string" ? patch.notes.slice(0, 20_000) : meta.notes,
    antiSimp: patch.antiSimp === undefined ? meta.antiSimp : Boolean(patch.antiSimp),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(partnerDir(slug)!, "meta.json"), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function appendMessage(slug: string, msg: Omit<StoredMessage, "ts">): StoredMessage {
  const dir = partnerDir(slug);
  if (!dir || !getPartner(slug)) throw new Error("聊天档案不存在");
  const stored: StoredMessage = { ...msg, ts: new Date().toISOString() };
  appendFileSync(join(dir, "messages.jsonl"), JSON.stringify(stored) + "\n", { mode: 0o600 });
  updatePartner(slug, {});
  return stored;
}

export function readMessages(slug: string, limit = 200): StoredMessage[] {
  const dir = partnerDir(slug);
  if (!dir) return [];
  const p = join(dir, "messages.jsonl");
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

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isSupportedImageType(mediaType: string): boolean {
  return Boolean(IMAGE_TYPES[mediaType]);
}

export function validatePartnerImport(text: string, images: IncomingImage[]) {
  if (text.trim().length > 80_000) throw new Error("粘贴的文字有点多，请先控制在 8 万字以内");
  for (const image of images) {
    if (!IMAGE_TYPES[image.mediaType]) throw new Error("只支持 PNG、JPG、WebP 或 GIF 图片");
    if (!image.dataBase64) throw new Error("图片内容为空");
  }
}

/** Saves user-supplied images under one profile. Paths never come from the request. */
export function savePartnerImages(slug: string, images: IncomingImage[], prefix = "context"): StoredAttachment[] {
  const dir = getPartnerDataDir(slug);
  if (!dir) throw new Error("聊天档案不存在");
  validatePartnerImport("", images);
  if (!images.length) return [];

  const importsDir = join(dir, "imports");
  mkdirSync(importsDir, { recursive: true, mode: 0o700 });
  const stamp = Date.now();
  return images.map((image, index) => {
    const ext = IMAGE_TYPES[image.mediaType];
    if (!ext) throw new Error("只支持 PNG、JPG、WebP 或 GIF 图片");
    const bytes = Buffer.from(image.dataBase64, "base64");
    if (!bytes.length) throw new Error("图片内容为空");
    const cleanName = (image.name || `截图-${index + 1}`).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80);
    const fileName = `${stamp}-${index}-${prefix}.${ext}`;
    writeFileSync(join(importsDir, fileName), bytes, { mode: 0o600 });
    return { fileName, name: cleanName, mediaType: image.mediaType, size: bytes.length };
  });
}

/** Stream one upload directly to disk so batch size is limited by disk, not browser/server RAM. */
export async function saveUploadedImage(
  slug: string,
  input: { name: string; mediaType: string; body: ReadableStream<Uint8Array> | null },
): Promise<StoredAttachment> {
  const dir = getPartnerDataDir(slug);
  if (!dir) throw new Error("聊天档案不存在");
  const ext = IMAGE_TYPES[input.mediaType];
  if (!ext) throw new Error("只支持 PNG、JPG、WebP 或 GIF 图片");
  if (!input.body) throw new Error("图片内容为空");

  const importsDir = join(dir, "imports");
  mkdirSync(importsDir, { recursive: true, mode: 0o700 });
  const fileName = `${Date.now()}-${crypto.randomUUID()}.batch.${ext}`;
  const path = join(importsDir, fileName);
  const writer = Bun.file(path).writer();
  const reader = input.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      size += value.length;
      writer.write(value);
    }
    await writer.end();
    if (!size) throw new Error("图片内容为空");
    try { chmodSync(path, 0o600); } catch { /* Windows / restricted FS */ }
  } catch (error) {
    try { await writer.end(); } catch { /* ignore */ }
    try { unlinkSync(path); } catch { /* ignore */ }
    throw error;
  }
  const cleanName = (input.name || "截图").replace(/[^\p{L}\p{N} ._()-]+/gu, "-").slice(0, 120);
  return { fileName, name: cleanName, mediaType: input.mediaType, size };
}

export function importPartnerContext(slug: string, text: string, images: IncomingImage[]) {
  const cleanText = text.trim();
  validatePartnerImport(cleanText, images);
  const attachments = savePartnerImages(slug, images, "background");
  if (!cleanText && !attachments.length) return { textLength: 0, imageCount: 0 };
  const chunks: string[] = [];
  if (cleanText) {
    let rest = cleanText;
    while (rest.length) {
      let cut = Math.min(2200, rest.length);
      if (cut < rest.length) {
        const paragraph = rest.lastIndexOf("\n", cut);
        if (paragraph > 900) cut = paragraph;
      }
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
  } else {
    chunks.push("只有截图，没有补充文字");
  }
  chunks.forEach((chunk, index) => appendMessage(slug, {
    role: "user",
    mode: "context",
    text: `【创建档案时导入的背景资料 ${index + 1}/${chunks.length}】\n${chunk}${index === 0 && attachments.length ? `\n\n（另外保存了 ${attachments.length} 张过往截图）` : ""}`,
    attachments: index === 0 ? attachments : undefined,
  }));
  return { textLength: cleanText.length, imageCount: attachments.length, chunkCount: chunks.length };
}

export function attachmentPath(slug: string, fileName: string): string | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return null;
  const dir = getPartnerDataDir(slug);
  if (!dir) return null;
  const path = join(dir, "imports", fileName);
  return existsSync(path) ? path : null;
}

export function imageAsBase64(path: string, mediaType: string): ImageAttachment {
  return { mediaType, dataBase64: readFileSync(path).toString("base64") };
}

function queryTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]{3,}/g) ?? []) terms.add(word);
  for (const run of lower.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let i = 0; i < run.length - 1 && terms.size < 240; i++) terms.add(run.slice(i, i + 2));
  }
  return terms;
}

function relevanceScore(message: StoredMessage, terms: Set<string>): number {
  const lower = message.text.toLowerCase();
  let score = message.mode === "context" ? 1 : 0;
  for (const term of terms) if (lower.includes(term)) score += term.length > 2 ? 3 : 1;
  if (message.attachments?.length) score += 2;
  return score;
}

/**
 * Query-aware context packing: full transcripts remain on disk, while the model receives
 * recent turns plus the most relevant older records. This avoids blind truncation and keeps
 * prompt size predictable without making a false "lossless summary" claim.
 */
export function buildContextPack(slug: string, query: string, recentLimit = 14, relevantLimit = 8): ContextPack {
  const all = readMessages(slug, 10_000);
  const split = Math.max(0, all.length - recentLimit);
  const older = all.slice(0, split).map((message, index) => ({ message, index }));
  const recent = all.slice(split).map((message, index) => ({ message, index: split + index }));
  const terms = queryTerms(query);
  const relevant = older
    .map((x) => ({ ...x, score: relevanceScore(x.message, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, relevantLimit);
  const selected = [...relevant, ...recent]
    .filter((x, i, arr) => arr.findIndex((y) => y.index === x.index) === i)
    .sort((a, b) => a.index - b.index);
  const messages = selected.map((x) => x.message);
  const images = selected.flatMap((x) => (x.message.attachments ?? []).flatMap((a) => {
    const path = attachmentPath(slug, a.fileName);
    return path ? [{ path, mediaType: a.mediaType }] : [];
  }));
  return {
    messages,
    images,
    stats: {
      total: all.length,
      included: messages.length,
      omitted: Math.max(0, all.length - messages.length),
      recent: recent.length,
      relevant: relevant.length,
    },
  };
}
