/**
 * 电子军师 App 服务端（Bun）。
 *
 * 技术栈说明（为什么高效）：
 * - Bun 运行时 + 零依赖：无 node_modules，冷启动毫秒级；`bun build --compile`
 *   直接打成单文件可执行，技能文件和前端资源全部内嵌。
 * - SSE 流式：模型 token 逐段推给前端，首字延迟即模型延迟。
 * - 稳定 prompt 层缓存：Claude 走 cache_control（prompt caching），DeepSeek
 *   吃自动前缀缓存；技能层几万 token 只有第一次全价。
 * - 确定性工作留在服务端：梗词典扫描、voice_lint 检查都不烧 token。
 */

import { compose, revisePrompt, scanMemes, stageInfo, type Mode } from "./junshi";
import { streamChat, completeOnce, supportsVision, PROVIDER_PRESETS } from "./providers";
import { lint } from "./voicelint";
import {
  readSettings, writeSettings, maskedSettings, activeProviderConfig,
  listPartners, createPartner, updatePartner, getPartner, appendMessage, readMessages, DJ_HOME,
} from "./store";

// @ts-ignore  bun text import
import indexHtml from "./public/index.html" with { type: "text" };
// @ts-ignore
import styleCss from "./public/style.css" with { type: "text" };
// @ts-ignore
import appJs from "./public/app.js" with { type: "text" };

const PORT = Number(process.env.PORT || 5177);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function extractReplyBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /```reply\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) blocks.push(m[1].trim());
  return blocks;
}

async function handleChat(req: Request): Promise<Response> {
  const body = await req.json();
  const { slug, mode, text, images = [] } = body as {
    slug: string; mode: Mode; text: string;
    images: Array<{ mediaType: string; dataBase64: string }>;
  };
  const partner = getPartner(slug);
  if (!partner) return json({ error: "对象不存在" }, 404);
  if (!text?.trim() && !images.length) return json({ error: "内容为空" }, 400);

  const cfg = activeProviderConfig();
  const history = readMessages(slug, 24).map((m) => ({ role: m.role, text: m.text }));
  const composed = compose({
    mode,
    text: text?.trim() || "（只发了图片，见附件）",
    partner: { name: partner.name, stage: partner.stage, antiSimp: partner.antiSimp, notes: partner.notes },
    history,
  });

  appendMessage(slug, { role: "partner", mode, text: text?.trim() || "[图片]" });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send("meta", {
          lane: composed.lane,
          loaded: composed.loaded,
          scan: composed.scan,
          provider: cfg.provider,
          model: cfg.model ?? PROVIDER_PRESETS[cfg.provider]?.defaultModel,
          vision: supportsVision(cfg),
        });
        let full = "";
        const gen = streamChat(cfg, {
          systemBlocks: composed.systemBlocks,
          userText: composed.userText,
          images: supportsVision(cfg) ? images : [],
        });
        for await (const chunk of gen) {
          full += chunk;
          send("delta", { text: chunk });
        }
        const replies = extractReplyBlocks(full);
        const lints = replies.map((r) => lint(r));
        send("lint", { blocks: lints });
        appendMessage(slug, { role: "junshi", mode, text: full });
        send("done", { ok: true });
      } catch (e: any) {
        send("error", { message: String(e?.message ?? e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

async function handleRevise(req: Request): Promise<Response> {
  const { text, findings = [], partnerName = "ta" } = await req.json();
  if (!text) return json({ error: "内容为空" }, 400);
  const cfg = activeProviderConfig();
  const { system, user } = revisePrompt(text, findings, partnerName);
  let revised = await completeOnce(cfg, system, user);
  // 兜底清理：围栏、行尾句号
  revised = revised.replace(/```[a-z]*\n?|```/g, "").trim();
  const result = lint(revised);
  return json({ revised, lint: result });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 静态资源（内嵌，单文件可执行同样可用）
    if (req.method === "GET") {
      if (path === "/" || path === "/index.html")
        return new Response(indexHtml as string, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (path === "/style.css")
        return new Response(styleCss as string, { headers: { "content-type": "text/css; charset=utf-8" } });
      if (path === "/app.js")
        return new Response(appJs as string, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (path === "/api/health") return json({ ok: true, home: DJ_HOME });
      if (path === "/api/settings") {
        const masked = maskedSettings();
        return json({ ...masked, presets: PROVIDER_PRESETS });
      }
      if (path === "/api/partners") return json(listPartners().map((p) => ({ ...p, stageName: stageInfo(p.stage).name })));
      const mMsgs = path.match(/^\/api\/partners\/([^/]+)\/messages$/);
      if (mMsgs) return json(readMessages(decodeURIComponent(mMsgs[1])));
    }

    if (req.method === "POST") {
      if (path === "/api/settings") {
        const patch = await req.json();
        writeSettings(patch);
        return json(maskedSettings());
      }
      if (path === "/api/partners") {
        const { name, stage = 1, antiSimp = false } = await req.json();
        if (!name?.trim()) return json({ error: "先给 ta 起个代号" }, 400);
        const meta = createPartner(name, Number(stage), Boolean(antiSimp));
        return json({ ...meta, stageName: stageInfo(meta.stage).name });
      }
      const mUpd = path.match(/^\/api\/partners\/([^/]+)$/);
      if (mUpd) {
        const patch = await req.json();
        const meta = updatePartner(decodeURIComponent(mUpd[1]), patch);
        return meta ? json({ ...meta, stageName: stageInfo(meta.stage).name }) : json({ error: "对象不存在" }, 404);
      }
      if (path === "/api/scan") {
        const { text = "" } = await req.json();
        return json({ hits: scanMemes(text) });
      }
      if (path === "/api/chat") return handleChat(req);
      if (path === "/api/revise") return handleRevise(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`电子军师 App 已启动：http://localhost:${server.port}`);
console.log(`数据目录：${DJ_HOME}（API key 与聊天记录都在这里，不进仓库）`);
console.log(`当前供应商：${readSettings().provider}（右上角设置里可切换 Claude / DeepSeek / GLM）`);
if (process.argv.includes("--open") && process.platform === "darwin") {
  Bun.spawn(["open", `http://localhost:${server.port}`]);
}
