/**
 * Claude API（官方 SDK）。
 * - 问答策略那一大段系统提示打缓存点，同一个人连着问只为增量付费。
 * - 当前一代模型开启服务端拒答回退（fallbacks: "default"）：某次被安全分类器
 *   误拦时，API 会自动换推荐的模型接着答，用户看到的是正常回复。
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { ProviderError, type JSONRequest, type LLMRequest, type ProviderConfig } from "./types";

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5"];
export const CLAUDE_DEFAULT = "claude-opus-5-5";
const WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5", "claude-fable-5"]);

function client(cfg: ProviderConfig): Anthropic {
  if (!cfg.apiKey) throw new ProviderError("还没填 Claude 的 API Key", "在设置里填上 Key，或者换成本机的 Codex / Claude Code");
  return new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 2 });
}

function system(req: LLMRequest): Anthropic.Beta.BetaTextBlockParam[] {
  const lastCache = req.system.map((s) => s.cache).lastIndexOf(true);
  return req.system.map((s, i) => (i === lastCache
    ? { type: "text", text: s.text, cache_control: { type: "ephemeral" } }
    : { type: "text", text: s.text }));
}

function content(req: LLMRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = req.images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType as "image/png", data: readFileSync(img.path).toString("base64") },
  }));
  blocks.push({ type: "text", text: req.user });
  return blocks;
}

function baseParams(cfg: ProviderConfig, req: LLMRequest, maxTokens: number) {
  const model = cfg.model?.trim() || CLAUDE_DEFAULT;
  const params: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: system(req),
    messages: [{ role: "user", content: content(req) }],
  };
  if (!/haiku/.test(model)) params.output_config = { effort: req.effort ?? "medium" };
  if (WITH_FALLBACK.has(model) && !cfg.baseUrl) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function explain(error: unknown): Error {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new ProviderError("Claude 的 API Key 不对或已失效", "在设置里重新填一下 Key");
  if (error instanceof Anthropic.PermissionDeniedError) return new ProviderError("这个 Key 没有权限用这个模型", "在设置里换个模型试试");
  if (error instanceof Anthropic.RateLimitError) return new ProviderError("Claude 这会儿太忙（限流了）", "等一分钟再试");
  if (error instanceof Anthropic.BadRequestError) return new ProviderError(`Claude 拒收了这次请求：${error.message.slice(0, 200)}`);
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("连不上 Claude", "检查一下网络或代理");
  if (error instanceof Anthropic.APIError) return new ProviderError(`Claude 出错了（${error.status ?? "?"}）：${error.message.slice(0, 200)}`);
  return error instanceof Error ? error : new Error(String(error));
}

export async function* streamClaude(cfg: ProviderConfig, req: LLMRequest): AsyncGenerator<string> {
  try {
    const stream = client(cfg).beta.messages.stream(baseParams(cfg, req, req.maxTokens ?? 16000) as any, { signal: req.signal });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new ProviderError("Claude 这次没接这个话题", "换个说法再问，或者在设置里换个模型");
    if (final.stop_reason === "max_tokens") yield "\n\n（写到长度上限了，后面被截断。）";
  } catch (error) {
    if (req.signal?.aborted) return;
    throw explain(error);
  }
}

export async function jsonClaude(cfg: ProviderConfig, req: JSONRequest): Promise<string> {
  try {
    const params = baseParams(cfg, req, req.maxTokens ?? 8000);
    params.output_config = { ...(params.output_config as object ?? {}), format: { type: "json_schema", schema: req.schema } };
    if (/haiku/.test(String(params.model))) params.output_config = { format: { type: "json_schema", schema: req.schema } };
    const res = await client(cfg).beta.messages.create(params as any, { signal: req.signal });
    if ((res as any).stop_reason === "refusal") throw new ProviderError("Claude 没处理这张图");
    return (res as any).content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  } catch (error) {
    throw explain(error);
  }
}
