import { completeOnce, completeStructuredNative, providerCapabilities, type ImageAttachment, type ProviderConfig } from "../providers";
import { readDecisionCache, writeDecisionCache } from "./store";

export interface StructuredResult<T> {
  value: T;
  attempts: number;
  cacheHit: boolean;
  fallback: boolean;
}

export function parseJsonWithRepair(raw: string): unknown {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(clean); } catch { /* repair below */ }
  const start = Math.min(...[clean.indexOf("{"), clean.indexOf("[")].filter((x) => x >= 0));
  const end = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
  if (Number.isFinite(start) && end > start) {
    const candidate = clean.slice(start, end + 1)
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(candidate);
  }
  throw new Error("模型没有返回可解析的 JSON");
}

/** Structured role adapter. Prefers API-level constrained decoding (forced tool
 * schema / JSON response_format) when the provider supports it; falls back to a
 * prompt-and-repair loop for local CLI providers, and finally to a deterministic
 * local result. The main planner remains usable when any role fails. */
export async function completeStructured<T>(options: {
  provider: ProviderConfig;
  schemaName: string;
  cacheKey: string;
  system: string;
  user: string;
  /** JSON Schema (top-level object) enabling native constrained decoding. */
  schema?: Record<string, unknown>;
  /** Screenshots for vision-capable providers (base64 for APIs, paths for CLIs). */
  images?: ImageAttachment[];
  localImagePaths?: string[];
  validate: (value: unknown) => T | null;
  fallback: () => T;
  workspaceDir?: string;
}): Promise<StructuredResult<T>> {
  const cached = readDecisionCache<unknown>(options.cacheKey);
  if (cached !== null) {
    const valid = options.validate(cached);
    if (valid) return { value: valid, attempts: 0, cacheHit: true, fallback: false };
  }
  const capabilities = providerCapabilities(options.provider);
  if (!capabilities.structuredOutput) {
    return { value: options.fallback(), attempts: 0, cacheHit: false, fallback: true };
  }
  if (options.schema && capabilities.nativeJsonSchema) {
    try {
      const raw = await completeStructuredNative(options.provider, {
        system: options.system, user: options.user,
        schemaName: options.schemaName, schema: options.schema,
        images: options.images,
      });
      const valid = options.validate(parseJsonWithRepair(raw));
      if (valid) {
        writeDecisionCache(options.cacheKey, valid, options.provider.provider, options.schemaName);
        return { value: valid, attempts: 1, cacheHit: false, fallback: false };
      }
    } catch { /* degrade to the prompt-and-repair loop below */ }
  }
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const user = attempt === 1 ? options.user
        : `${options.user}\n\n你刚才的输出无法通过 ${options.schemaName} 校验。只返回一个合法 JSON 值，不要 Markdown，不要解释。上次输出：\n${last.slice(0, 2000)}`;
      last = await completeOnce(options.provider, `${options.system}\n只输出合法 JSON。`, user, {
        workspaceDir: options.workspaceDir, images: options.images, localImagePaths: options.localImagePaths,
      });
      const valid = options.validate(parseJsonWithRepair(last));
      if (valid) {
        writeDecisionCache(options.cacheKey, valid, options.provider.provider, options.schemaName);
        return { value: valid, attempts: attempt, cacheHit: false, fallback: false };
      }
    } catch { /* retry once, then deterministic fallback */ }
  }
  return { value: options.fallback(), attempts: 2, cacheHit: false, fallback: true };
}
