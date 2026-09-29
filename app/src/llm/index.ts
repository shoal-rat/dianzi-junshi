import { readSettings } from "../store/settings";
import { keyFor, KEYED } from "../store/keychain";
import { CLAUDE_DEFAULT, CLAUDE_MODELS, jsonClaude, streamClaude } from "./claude";
import { cliStatus } from "./locate";
import { jsonCli, streamCli } from "./cli";
import { jsonOpenAI, OPENAI_PRESETS, openaiVision, streamOpenAI } from "./openai";
import { ProviderError, type JSONRequest, type LLMRequest, type ProviderConfig } from "./types";
import type { ProviderKind, ProviderStatusDTO } from "../shared/domain";

export { ProviderError } from "./types";
export type { LLMRequest, JSONRequest, ProviderConfig } from "./types";

const LABEL: Record<ProviderKind, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  claude: "Claude API",
  deepseek: "DeepSeek",
  glm: "GLM 智谱",
  custom: "自定义接口",
  demo: "演示模式",
};

export function providerLabel(kind: ProviderKind): string {
  return LABEL[kind];
}

export function configFor(kind: ProviderKind): ProviderConfig {
  const s = readSettings().providers[kind] ?? {};
  return { kind, model: s.model, baseUrl: s.baseUrl, apiKey: KEYED.includes(kind) ? keyFor(kind) : undefined };
}

export function activeConfig(): ProviderConfig {
  return configFor(readSettings().provider);
}

export function supportsVision(cfg: ProviderConfig): boolean {
  if (cfg.kind === "codex" || cfg.kind === "claude-code" || cfg.kind === "claude") return true;
  if (cfg.kind === "demo") return false;
  return openaiVision(cfg);
}

export function modelName(cfg: ProviderConfig): string | undefined {
  if (cfg.kind === "claude") return cfg.model || CLAUDE_DEFAULT;
  if (cfg.kind === "deepseek" || cfg.kind === "glm") return cfg.model || OPENAI_PRESETS[cfg.kind].models[0];
  return cfg.model || undefined;
}

export function streamText(cfg: ProviderConfig, req: LLMRequest): AsyncGenerator<string> {
  switch (cfg.kind) {
    case "codex":
    case "claude-code":
      return streamCli(cfg, req);
    case "claude":
      return streamClaude(cfg, req);
    case "deepseek":
    case "glm":
    case "custom":
      return streamOpenAI(cfg, req);
    default:
      throw new ProviderError("演示模式不连 AI");
  }
}

/** 从模型输出里抠出第一个 JSON 对象（容忍代码围栏和前后废话）。 */
export function extractJSON(text: string): unknown {
  const clean = text.replace(/```(?:json)?/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("AI 没有按格式返回");
  return JSON.parse(clean.slice(start, end + 1));
}

export async function completeJSON<T>(cfg: ProviderConfig, req: JSONRequest, validate: (value: unknown) => T | null): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = cfg.kind === "claude" ? await jsonClaude(cfg, req)
        : cfg.kind === "codex" || cfg.kind === "claude-code" ? await jsonCli(cfg, req)
          : cfg.kind === "demo" ? (() => { throw new ProviderError("演示模式不连 AI"); })()
            : await jsonOpenAI(cfg, req);
      const value = validate(extractJSON(raw));
      if (value) return value;
      lastError = new ProviderError("AI 返回的内容格式不对");
    } catch (e) {
      lastError = e;
      if (e instanceof ProviderError && !/格式/.test(e.message)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError("AI 没有返回可用的结果");
}

export async function providerStatuses(): Promise<ProviderStatusDTO[]> {
  const settings = readSettings();
  const [codex, claudeCode] = await Promise.all([cliStatus("codex"), cliStatus("claude")]);
  const out: ProviderStatusDTO[] = [];
  const saved = (k: ProviderKind) => settings.providers[k] ?? {};
  out.push({ kind: "codex", label: LABEL.codex, ready: codex.signedIn, detail: codex.detail, vision: true, needsKey: false, hasKey: false, model: saved("codex").model, models: [], local: true });
  out.push({ kind: "claude-code", label: LABEL["claude-code"], ready: claudeCode.signedIn, detail: claudeCode.detail, vision: true, needsKey: false, hasKey: false, model: saved("claude-code").model, models: ["", "opus", "sonnet", "haiku"], local: true });
  for (const kind of ["claude", "deepseek", "glm", "custom"] as const) {
    const cfg = configFor(kind);
    const hasKey = Boolean(cfg.apiKey);
    const models = kind === "claude" ? CLAUDE_MODELS : [...OPENAI_PRESETS[kind].models];
    const needsBase = kind === "custom" && !cfg.baseUrl;
    out.push({
      kind, label: LABEL[kind], ready: hasKey && !needsBase,
      detail: needsBase ? "填上接口地址、模型名和 Key" : hasKey ? `已保存 Key · ${modelName(cfg) ?? "未选模型"}` : "需要 API Key",
      vision: supportsVision(cfg), needsKey: true, hasKey, model: cfg.model, models, baseUrl: cfg.baseUrl, local: false,
    });
  }
  out.push({ kind: "demo", label: LABEL.demo, ready: true, detail: "不联网，用写好的示例熟悉界面", vision: false, needsKey: false, hasKey: false, models: [], local: true });
  return out;
}
