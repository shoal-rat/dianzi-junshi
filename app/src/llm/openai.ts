/**
 * OpenAI 兼容端点：DeepSeek、GLM（智谱）、以及任何兼容 /chat/completions 的服务。
 * DeepSeek 的前缀缓存是自动的——问答策略那段放在 system 最前面就能吃到。
 */

import { readFileSync } from "node:fs";
import { ProviderError, type JSONRequest, type LLMRequest, type ProviderConfig } from "./types";

export const OPENAI_PRESETS = {
  deepseek: { base: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"], vision: () => false },
  glm: { base: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4.6", "glm-4.5v", "glm-4-plus"], vision: (m: string) => /v/.test(m.replace(/^glm-/, "")) },
  custom: { base: "", models: [] as string[], vision: () => true },
} as const;

export function openaiVision(cfg: ProviderConfig): boolean {
  const p = OPENAI_PRESETS[cfg.kind as keyof typeof OPENAI_PRESETS];
  return p ? p.vision(cfg.model || p.models[0] || "") : false;
}

function endpoint(cfg: ProviderConfig): { url: string; model: string } {
  const preset = OPENAI_PRESETS[cfg.kind as keyof typeof OPENAI_PRESETS];
  const base = (cfg.baseUrl || preset?.base || "").replace(/\/+$/, "");
  if (!base) throw new ProviderError("自定义连接还没填地址", "在设置里填 Base URL，比如 http://127.0.0.1:1234/v1");
  const model = cfg.model?.trim() || preset?.models[0] || "";
  if (!model) throw new ProviderError("自定义连接还没填模型名");
  return { url: `${base}/chat/completions`, model };
}

function messages(cfg: ProviderConfig, req: LLMRequest, extraSystem?: string) {
  const system = [...req.system.map((s) => s.text), extraSystem].filter(Boolean).join("\n\n---\n\n");
  const user = req.images.length && openaiVision(cfg)
    ? [
      ...req.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${readFileSync(img.path).toString("base64")}` } })),
      { type: "text", text: req.user },
    ]
    : req.user;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

async function fail(res: Response): Promise<never> {
  let detail = "";
  try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) throw new ProviderError("API Key 不对或没有权限", "在设置里重新填一下 Key");
  if (res.status === 429) throw new ProviderError("服务这会儿限流了", "等一会儿再试");
  if (res.status === 402) throw new ProviderError("账户余额不足", "去服务商那边充值，或者换个连接");
  throw new ProviderError(`服务返回 ${res.status}：${detail || res.statusText}`);
}

export async function* streamOpenAI(cfg: ProviderConfig, req: LLMRequest): AsyncGenerator<string> {
  const { url, model } = endpoint(cfg);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey ?? ""}` },
      body: JSON.stringify({ model, messages: messages(cfg, req), stream: true, max_tokens: req.maxTokens ?? 8000 }),
      signal: req.signal,
    });
  } catch (e) {
    if (req.signal?.aborted) return;
    throw new ProviderError("连不上这个服务", "检查网络、代理或 Base URL");
  }
  if (!res.ok || !res.body) await fail(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        const text = evt.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      } catch { /* 半行，跳过 */ }
    }
  }
}

export async function jsonOpenAI(cfg: ProviderConfig, req: JSONRequest): Promise<string> {
  const { url, model } = endpoint(cfg);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey ?? ""}` },
    body: JSON.stringify({
      model,
      messages: messages(cfg, req, `只输出一个符合这个 JSON Schema（${req.schemaName}）的 JSON 对象：\n${JSON.stringify(req.schema)}`),
      response_format: { type: "json_object" },
      max_tokens: req.maxTokens ?? 4000,
    }),
    signal: req.signal,
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ProviderError("服务没有返回内容");
  return text;
}
