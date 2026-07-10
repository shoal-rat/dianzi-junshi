/**
 * 模型供应商适配层：Claude（Anthropic 原生）、DeepSeek、GLM（智谱）、自定义
 * OpenAI 兼容端点，以及无需 key 的演示模式。全部走流式。
 *
 * 效率要点：
 * - Claude 走 prompt caching：稳定的技能层（core+voice+memes+…）标 cache_control，
 *   同一会话的后续请求只为增量付费，延迟也显著下降。
 * - OpenAI 兼容端点（DeepSeek/GLM）由服务端把稳定层拼成单条 system——DeepSeek
 *   的上下文缓存是自动前缀命中，稳定层放最前面即可吃到。
 */

export interface ProviderConfig {
  provider: "claude" | "deepseek" | "glm" | "custom" | "demo";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ImageAttachment {
  mediaType: string; // image/png 等
  dataBase64: string;
}

export interface ChatRequest {
  systemBlocks: Array<{ text: string; cacheable: boolean }>;
  userText: string;
  images: ImageAttachment[];
  maxTokens?: number;
}

export const PROVIDER_PRESETS = {
  claude: {
    label: "Claude（Anthropic）",
    models: ["claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-5",
    vision: true,
    keyUrl: "https://console.anthropic.com/",
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    vision: false,
    keyUrl: "https://platform.deepseek.com/",
  },
  glm: {
    label: "GLM（智谱）",
    models: ["glm-4.6", "glm-4-plus", "glm-4v-plus"],
    defaultModel: "glm-4.6",
    vision: true, // 仅 glm-4v* 支持，发送前按模型名再判断
    keyUrl: "https://open.bigmodel.cn/",
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    models: [],
    defaultModel: "",
    vision: false,
    keyUrl: "",
  },
  demo: {
    label: "演示模式（不联网）",
    models: ["demo"],
    defaultModel: "demo",
    vision: true,
    keyUrl: "",
  },
} as const;

export function supportsVision(cfg: ProviderConfig): boolean {
  if (cfg.provider === "claude" || cfg.provider === "demo") return true;
  if (cfg.provider === "glm") return (cfg.model ?? "").startsWith("glm-4v");
  return false;
}

// ---------------------------------------------------------------------------
// SSE 行解析工具
// ---------------------------------------------------------------------------

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function raiseHttpError(kind: string, res: Response): Promise<never> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 400);
  } catch { /* ignore */ }
  throw new Error(`${kind} HTTP ${res.status}：${detail || res.statusText}`);
}

// ---------------------------------------------------------------------------
// Anthropic 原生
// ---------------------------------------------------------------------------

async function* streamClaude(cfg: ProviderConfig, req: ChatRequest): AsyncGenerator<string> {
  const system = req.systemBlocks.map((b, i) => {
    const isLastCacheable = b.cacheable && !req.systemBlocks.slice(i + 1).some((x) => x.cacheable);
    return isLastCacheable
      ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
      : { type: "text", text: b.text };
  });
  const content: any[] = [];
  for (const img of req.images) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.dataBase64 } });
  }
  content.push({ type: "text", text: req.userText });

  const res = await fetch(`${cfg.baseUrl || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model || PROVIDER_PRESETS.claude.defaultModel,
      max_tokens: req.maxTokens ?? 2048,
      system,
      messages: [{ role: "user", content }],
      stream: true,
    }),
  });
  if (!res.ok || !res.body) await raiseHttpError("Claude", res);

  for await (const line of sseLines(res.body!)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload);
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") yield evt.delta.text as string;
      if (evt.type === "error") throw new Error(evt.error?.message ?? "Claude 流式错误");
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI 兼容（DeepSeek / GLM / 自定义）
// ---------------------------------------------------------------------------

const OPENAI_BASE: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  glm: "https://open.bigmodel.cn/api/paas/v4",
};

async function* streamOpenAICompat(cfg: ProviderConfig, req: ChatRequest): AsyncGenerator<string> {
  const base = (cfg.baseUrl || OPENAI_BASE[cfg.provider] || "").replace(/\/$/, "");
  if (!base) throw new Error("自定义供应商需要填 Base URL");
  // 稳定层在最前（DeepSeek 前缀缓存自动命中），动态层紧随其后
  const system = req.systemBlocks.map((b) => b.text).join("\n\n---\n\n");
  let userContent: any = req.userText;
  if (req.images.length && supportsVision(cfg)) {
    userContent = [
      ...req.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` } })),
      { type: "text", text: req.userText },
    ];
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey ?? ""}` },
    body: JSON.stringify({
      model: cfg.model || PROVIDER_PRESETS[cfg.provider === "glm" ? "glm" : "deepseek"].defaultModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      stream: true,
      max_tokens: req.maxTokens ?? 2048,
    }),
  });
  if (!res.ok || !res.body) await raiseHttpError(cfg.provider, res);

  for await (const line of sseLines(res.body!)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload);
      const delta = evt.choices?.[0]?.delta;
      if (delta?.content) yield delta.content as string;
      // deepseek-reasoner 的 reasoning_content 属于思考过程，不进正文
    } catch {
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// 演示模式：不联网，流式吐一份手写示例，方便没配 key 时体验完整 UI
// ---------------------------------------------------------------------------

function demoScript(userText: string): string {
  const memeCase = userText.includes("那咋了");
  if (memeCase) {
    return `「那咋了」是理直气壮的撒娇嘴硬，不是生气——接梗别讲理。

### 方案1 · 稳妥（认怂式接梗，油0.5/5）
\`\`\`reply
没咋 羡慕的声音大了点
\`\`\`
秒怂加自嘲，接成她赢了，话题轻松续命。

### 方案2 · 会撩（顺梗埋钩，油1.5/5）
\`\`\`reply
挺好 记住了
以后找你玩只敢约下午场
\`\`\`
「以后会约你」藏在玩笑里，她接不接都不尴尬。

### 方案3 · 整活（同款句式回敬，油1/5）
\`\`\`reply
那咋了 我也爱赖床
咱俩谁也别笑话谁
\`\`\`

推荐方案3：镜像她的梗永远安全，同频感最强。
别这样回：讲睡懒觉对身体不好——一句话杀死一个梗，爹味瞬间拉满。

（演示模式：这是内置示例。到右上角设置里配好 Claude / DeepSeek / GLM 的 key，就能对任何消息实时出方案。）`;
  }
  return `收到。这条按暧昧期、油腻上限 1.5/5 处理。

### 方案1 · 稳妥（油0.5/5）
\`\`\`reply
懂了
今天先这样 你去忙
\`\`\`

### 方案2 · 会撩（油1.5/5）
\`\`\`reply
行啊
不过下次这种事当面说
\`\`\`

推荐方案2：留了一个见面钩子，接不接都不损失。
别这样回：连环追问——需求感一暴露，节奏就没了。

（演示模式：这是内置示例，不代表对你这条消息的真实分析。到右上角设置里配好 API key 后，军师才会真正读你的消息。）`;
}

async function* streamDemo(req: ChatRequest): AsyncGenerator<string> {
  const script = demoScript(req.userText);
  const chunks = script.match(/[\s\S]{1,6}/g) ?? [];
  for (const c of chunks) {
    yield c;
    await new Promise((r) => setTimeout(r, 12));
  }
}

// ---------------------------------------------------------------------------

export function streamChat(cfg: ProviderConfig, req: ChatRequest): AsyncGenerator<string> {
  switch (cfg.provider) {
    case "claude":
      return streamClaude(cfg, req);
    case "deepseek":
    case "glm":
    case "custom":
      return streamOpenAICompat(cfg, req);
    case "demo":
      return streamDemo(req);
    default:
      throw new Error(`未知供应商：${(cfg as any).provider}`);
  }
}

/** 非流式小调用（一键修用），复用流式接口拼接结果。 */
export async function completeOnce(cfg: ProviderConfig, system: string, user: string): Promise<string> {
  if (cfg.provider === "demo") {
    // 演示模式：把句号去掉、超长行砍半，模拟一次修写
    return user
      .split("\n")
      .filter((l) => l && !l.startsWith("发给") && !l.startsWith("没过的原因") && !l.startsWith("-") && !l.startsWith("改写"))
      .map((l) => l.replace(/。+$/g, "").trim())
      .filter(Boolean)
      .join("\n");
  }
  let out = "";
  const gen = streamChat(cfg, {
    systemBlocks: [{ text: system, cacheable: false }],
    userText: user,
    images: [],
    maxTokens: 300,
  });
  for await (const chunk of gen) out += chunk;
  return out.trim();
}
