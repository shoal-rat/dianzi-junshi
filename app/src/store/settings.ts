import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, HOME } from "./db";
import type { ProviderKind } from "../shared/domain";

export interface ProviderSettings {
  model?: string;
  baseUrl?: string;
  hasKey?: boolean;
}

export interface Settings {
  provider: ProviderKind;
  providers: Partial<Record<ProviderKind, ProviderSettings>>;
  semantic: "auto" | "off";
  /** 想多深：快（low）/ 标准（medium）/ 细（high）。本机 CLI 不流式，快档明显少等。 */
  depth: "fast" | "balanced" | "deep";
  /** 用户自己的性别（可选），让军师用对称呼、选对打法表。 */
  me: "" | "m" | "f";
  /** 界面语言：auto 跟随系统（中文环境中文，其他英文） */
  language: "auto" | "zh" | "en";
}

const PATH = () => join(HOME, "settings.json");
const LEGACY = () => join(HOME, "config.json");

export const PROVIDER_KINDS: ProviderKind[] = ["codex", "claude-code", "claude", "deepseek", "glm", "custom", "demo"];

const DEFAULTS: Settings = { provider: "demo", providers: {}, semantic: "auto", depth: "fast", me: "", language: "auto" };

/** v5 的 config.json：只搬 provider / model / baseUrl / hasKey（Key 本身一直在系统凭据库里）。 */
function fromLegacy(): Settings | null {
  if (!existsSync(LEGACY())) return null;
  try {
    const raw = JSON.parse(readFileSync(LEGACY(), "utf-8"));
    const providers: Settings["providers"] = {};
    for (const kind of PROVIDER_KINDS) {
      const p = raw.providers?.[kind];
      if (!p) continue;
      providers[kind] = {
        model: typeof p.model === "string" && !/^claude-(sonnet-5|fable-5|opus-4-8)$/.test(p.model) ? p.model : undefined,
        baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : undefined,
        hasKey: Boolean(p.hasKey),
      };
    }
    const provider = PROVIDER_KINDS.includes(raw.provider) ? raw.provider : "demo";
    return { provider, providers, semantic: raw.semanticEmbedding?.mode === "off" ? "off" : "auto", depth: "fast", me: "", language: "zh" };
  } catch {
    return null;
  }
}

let memo: Settings | null = null;

export function readSettings(): Settings {
  if (memo) return structuredClone(memo);
  ensureDir(HOME);
  let s: Settings | null = null;
  if (existsSync(PATH())) {
    try {
      const raw = JSON.parse(readFileSync(PATH(), "utf-8"));
      // v6.0 写的设置没有 language：那时只有中文版，老用户继续用中文
      s = { ...DEFAULTS, ...raw, language: raw.language ?? "zh" };
    } catch { s = null; }
  }
  if (!s) {
    s = fromLegacy() ?? structuredClone(DEFAULTS);
    persist(s);
  }
  if (!PROVIDER_KINDS.includes(s.provider)) s.provider = "demo";
  memo = s;
  return structuredClone(s);
}

function persist(s: Settings): void {
  const tmp = `${PATH()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, PATH());
}

export function writeSettings(patch: { provider?: ProviderKind; semantic?: "auto" | "off"; depth?: Settings["depth"]; me?: string; language?: string; providers?: Partial<Record<ProviderKind, ProviderSettings>> }): Settings {
  const cur = readSettings();
  if (patch.provider && !PROVIDER_KINDS.includes(patch.provider)) throw new Error("unsupported provider");
  const next: Settings = {
    provider: patch.provider ?? cur.provider,
    semantic: patch.semantic === "off" ? "off" : patch.semantic === "auto" ? "auto" : cur.semantic,
    depth: patch.depth && ["fast", "balanced", "deep"].includes(patch.depth) ? patch.depth : cur.depth ?? "fast",
    me: patch.me !== undefined ? (patch.me === "m" || patch.me === "f" ? patch.me : "") : cur.me ?? "",
    language: patch.language === "zh" || patch.language === "en" || patch.language === "auto" ? patch.language : cur.language ?? "auto",
    providers: { ...cur.providers },
  };
  for (const [kind, value] of Object.entries(patch.providers ?? {}) as Array<[ProviderKind, ProviderSettings]>) {
    if (!PROVIDER_KINDS.includes(kind)) continue;
    const prev = next.providers[kind] ?? {};
    next.providers[kind] = {
      model: value.model !== undefined ? String(value.model).trim().slice(0, 120) || undefined : prev.model,
      baseUrl: value.baseUrl !== undefined ? String(value.baseUrl).trim().slice(0, 300) || undefined : prev.baseUrl,
      hasKey: value.hasKey !== undefined ? Boolean(value.hasKey) : prev.hasKey,
    };
  }
  persist(next);
  memo = next;
  return structuredClone(next);
}

export function resetSettingsMemo(): void {
  memo = null;
}
