import type { ProviderKind } from "../shared/domain";

export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface LocalImage {
  path: string;
  mediaType: string;
}

export interface LLMRequest {
  /** 系统提示分段；cache=true 的段落在前，Claude API 会在最后一个可缓存段上打缓存点。 */
  system: Array<{ text: string; cache: boolean }>;
  user: string;
  images: LocalImage[];
  /** CLI 的工作目录（只读沙箱），通常是这个人的数据目录。 */
  workdir: string;
  maxTokens?: number;
  /** 回答的用力程度：写锦囊用 medium，抽取事实用 low。 */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface JSONRequest extends LLMRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}
