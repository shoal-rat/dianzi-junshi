/**
 * 电子军师 App 服务端（Bun）。
 *
 * 技术栈说明（为什么高效）：
 * - `bun build --compile` 将服务端、提示模块和前端资源打进桌面 sidecar，
 *   最终安装包不依赖用户电脑上的 Node.js、Bun 或仓库路径。
 * - SSE 流式：模型 token 逐段推给前端，首字延迟即模型延迟。
 * - 稳定 prompt 层缓存：Claude 走 cache_control（prompt caching），DeepSeek
 *   吃自动前缀缓存；稳定提示层只有第一次按完整前缀处理。
 * - 确定性工作留在服务端：梗词典扫描、voice_lint 检查都不烧 token。
 */

import { compose, revisePrompt, scanMemes, stageInfo, type Mode } from "./junshi";
import { streamChat, completeOnce, supportsVision, PROVIDER_PRESETS, detectLocalProviders, providerCapabilities } from "./providers";
import { lint } from "./voicelint";
import {
  readSettings, writeSettings, maskedSettings, activeProviderConfig,
  listPartners, createPartner, updatePartner, getPartner, appendMessage, readMessages, DJ_HOME,
  buildContextPack, savePartnerImages, attachmentPath, imageAsBase64, getPartnerDataDir,
  importPartnerContext, validatePartnerImport, saveUploadedImage, type IncomingImage, type StoredAttachment,
} from "./store";
import {
  getLatestMaterialJob, getMaterialJob, readMaterialMemories, retrieveMaterialMemories,
  resumeMaterialJob, resumePendingMaterialJobs, startMaterialJob,
} from "./materials";
import {
  adaptivePrompt, getAdaptiveProfile, recordOutcomeFeedback, sqliteCapabilities,
  type OutcomeFeedback,
} from "./adaptive";
import { runDecisionPipeline, realizationPrompt, demoRealization } from "./decision/pipeline";
import {
  calibrationDataset, calibrationReport, decisionDiagnostics, deleteCalibrationDataset,
  evidenceGraph, getDecisionReport, listDecisionReports, readPatternRegistry,
  rebuildDerivedState, recordCalibrationExample, recordLinkedOutcome, strategyPerformance,
  updatePatternLifecycle,
} from "./decision/store";
import type { EvidenceRef, PlanningMode } from "./decision/types";
import { deleteProviderKey, initializeProviderKeychain, keychainBackend, saveProviderKey } from "./keychain";

// @ts-ignore  bun text import
import indexHtml from "./public/index.html" with { type: "text" };
// @ts-ignore
import styleCss from "./public/style.css" with { type: "text" };
// @ts-ignore
import appJs from "./public/app.js" with { type: "text" };

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || "127.0.0.1";
const keychainStatus = await initializeProviderKeychain();

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
  const { slug, mode, text, images = [], planningMode = "balanced" } = body as {
    slug: string; mode: Mode; text: string;
    images: IncomingImage[];
    planningMode?: PlanningMode;
  };
  const partner = getPartner(slug);
  if (!partner) return json({ error: "对象不存在" }, 404);
  if (!text?.trim() && !images.length) return json({ error: "内容为空" }, 400);
  if (!["reply", "analyze", "ask", "interest"].includes(mode)) return json({ error: "不支持这个分析方式" }, 400);
  if (!["fast", "balanced", "deep"].includes(planningMode)) return json({ error: "不支持这个思考深度" }, 400);

  const cfg = activeProviderConfig();
  const allBefore = readMessages(slug, 10_000);
  const packed = buildContextPack(slug, text ?? "");
  const indexedMaterials = readMaterialMemories(slug);
  const materialMemories = retrieveMaterialMemories(slug, text ?? "", 6);
  const adaptiveProfile = getAdaptiveProfile(slug);
  let savedImages;
  try {
    savedImages = savePartnerImages(slug, images, "chat");
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 400);
  }
  const currentImagePaths = savedImages.flatMap((a) => {
    const path = attachmentPath(slug, a.fileName);
    return path ? [path] : [];
  });
  const firstAnalysis = !allBefore.some((m) => m.role === "junshi");
  const isLocalCli = cfg.provider === "codex" || cfg.provider === "claude-code";
  const localBackgroundImages = isLocalCli || firstAnalysis ? packed.images : [];
  const apiBackgroundImages = firstAnalysis ? packed.images : [];
  const retrievedMaterialPaths = isLocalCli
    ? materialMemories.slice(0, 2).flatMap((memory) => {
      const path = attachmentPath(slug, memory.fileName);
      return path ? [path] : [];
    })
    : [];
  const localImagePaths = [...new Set([...currentImagePaths, ...localBackgroundImages.map((x) => x.path), ...retrievedMaterialPaths])];
  const apiImages = supportsVision(cfg)
    ? [...images, ...apiBackgroundImages.map((x) => imageAsBase64(x.path, x.mediaType))]
    : [];
  const history = packed.messages.map((m) => ({
    role: m.role,
    text: m.text,
    mode: m.mode,
    attachmentNames: m.attachments?.map((a) => a.name),
  }));
  const composed = compose({
    mode,
    text: text?.trim() || "（只发了图片，见附件）",
    partner: { name: partner.name, stage: partner.stage, antiSimp: partner.antiSimp, notes: partner.notes },
    history,
    contextStats: packed.stats,
    materialMemories,
    adaptiveContext: adaptivePrompt(adaptiveProfile),
  });

  appendMessage(slug, {
    role: "partner",
    mode,
    text: text?.trim() || `[图片 ×${savedImages.length}]`,
    attachments: savedImages,
  });

  const evidence: EvidenceRef[] = [
    ...packed.messages.map((message, index) => ({
      id: `message:${message.ts}:${index}`, kind: "message" as const,
      text: message.text, observedAt: message.ts,
      reliability: message.role === "junshi" ? .42 : .68,
      importance: message.mode === "context" ? .72 : .52,
    })),
    ...materialMemories.map((memory) => ({
      id: `material:${memory.id}`, kind: "material" as const,
      text: [memory.summary, ...memory.facts].join("；"), observedAt: memory.createdAt,
      reliability: memory.provider === "demo" ? .45 : .72,
      importance: memory.importance, sourceId: memory.id,
    })),
  ];
  const pipelineInput = {
    profileSlug: slug, partnerName: partner.name, stage: partner.stage,
    antiSimp: partner.antiSimp, mode, planningMode,
    text: text?.trim() || "（只发了图片）", evidence,
  };
  const decision = await runDecisionPipeline(pipelineInput, {
    provider: cfg, workspaceDir: getPartnerDataDir(slug) ?? DJ_HOME,
  });
  const realization = realizationPrompt(pipelineInput, decision, cfg);

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
          capabilities: providerCapabilities(cfg),
          decision,
          context: {
            ...packed.stats,
            materialsIndexed: indexedMaterials.length,
            materialsRetrieved: materialMemories.length,
            feedbackCount: adaptiveProfile.feedbackCount,
            responseEvidenceWeight: adaptiveProfile.responseEvidenceWeight,
            actionEvidenceWeight: adaptiveProfile.actionEvidenceWeight,
          },
        });
        let full = "";
        if (cfg.provider === "demo") {
          full = demoRealization(decision, pipelineInput);
          for (const chunk of full.match(/[\s\S]{1,8}/g) ?? []) send("delta", { text: chunk });
        } else {
          const gen = streamChat(cfg, {
            systemBlocks: realization.systemBlocks,
            userText: realization.userText,
            images: apiImages,
            localImagePaths,
            workspaceDir: getPartnerDataDir(slug) ?? DJ_HOME,
          });
          for await (const chunk of gen) {
            full += chunk;
            send("delta", { text: chunk });
          }
        }
        const replies = extractReplyBlocks(full);
        const lints = replies.map((r) => lint(r));
        send("lint", { blocks: lints });
        appendMessage(slug, { role: "junshi", mode, text: full });
        send("done", {
          ok: true, decisionId: decision.id,
          strategyId: decision.selectedStrategy.id, replyId: decision.replyId,
        });
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
  const { text, findings = [], partnerName = "ta", slug = "" } = await req.json();
  if (!text) return json({ error: "内容为空" }, 400);
  const cfg = activeProviderConfig();
  const { system, user } = revisePrompt(text, findings, partnerName);
  let revised = await completeOnce(cfg, system, user, { workspaceDir: getPartnerDataDir(slug) ?? DJ_HOME });
  // 兜底清理：围栏、行尾句号
  revised = revised.replace(/```[a-z]*\n?|```/g, "").trim();
  const result = lint(revised);
  return json({ revised, lint: result });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 静态资源（内嵌，单文件可执行同样可用）
    if (req.method === "GET") {
      if (path === "/" || path === "/index.html")
        return new Response(indexHtml as unknown as string, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (path === "/style.css")
        return new Response(styleCss as string, { headers: { "content-type": "text/css; charset=utf-8" } });
      if (path === "/app.js")
        return new Response(appJs as string, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (path === "/api/health") return json({ ok: true, home: DJ_HOME, database: sqliteCapabilities() });
      if (path === "/api/settings") {
        const masked = maskedSettings();
        return json({ ...masked, presets: PROVIDER_PRESETS, keychain: {
          ...keychainStatus, backend: keychainBackend(),
        }, calibration: calibrationReport() });
      }
      if (path === "/api/providers/local") return json(await detectLocalProviders());
      if (path === "/api/partners") return json(listPartners().map((p) => ({ ...p, stageName: stageInfo(p.stage).name })));
      const mLatestJob = path.match(/^\/api\/partners\/([^/]+)\/material-jobs\/latest$/);
      if (mLatestJob) return json(getLatestMaterialJob(decodeURIComponent(mLatestJob[1])));
      const mJob = path.match(/^\/api\/partners\/([^/]+)\/material-jobs\/([a-f0-9-]{36})$/);
      if (mJob) {
        const job = getMaterialJob(decodeURIComponent(mJob[1]), mJob[2]);
        return job ? json(job) : json({ error: "整理任务不存在" }, 404);
      }
      const mMsgs = path.match(/^\/api\/partners\/([^/]+)\/messages$/);
      if (mMsgs) return json(readMessages(decodeURIComponent(mMsgs[1])));
      const mAdaptive = path.match(/^\/api\/partners\/([^/]+)\/adaptive-profile$/);
      if (mAdaptive) {
        const slug = decodeURIComponent(mAdaptive[1]);
        return getPartner(slug) ? json(getAdaptiveProfile(slug)) : json({ error: "对象不存在" }, 404);
      }
      const mDecisionLatest = path.match(/^\/api\/partners\/([^/]+)\/decisions\/latest$/);
      if (mDecisionLatest) {
        const slug = decodeURIComponent(mDecisionLatest[1]);
        return getPartner(slug) ? json(getDecisionReport(slug)) : json({ error: "对象不存在" }, 404);
      }
      const mDecisionHistory = path.match(/^\/api\/partners\/([^/]+)\/decisions$/);
      if (mDecisionHistory) {
        const slug = decodeURIComponent(mDecisionHistory[1]);
        return getPartner(slug)
          ? json(listDecisionReports(slug, Number(url.searchParams.get("limit") || 20)))
          : json({ error: "对象不存在" }, 404);
      }
      const mDecision = path.match(/^\/api\/partners\/([^/]+)\/decisions\/([a-f0-9-]{36})$/);
      if (mDecision) {
        const report = getDecisionReport(decodeURIComponent(mDecision[1]), mDecision[2]);
        return report ? json(report) : json({ error: "这次决策记录不存在" }, 404);
      }
      const mDiagnostics = path.match(/^\/api\/partners\/([^/]+)\/decision-diagnostics$/);
      if (mDiagnostics) {
        const slug = decodeURIComponent(mDiagnostics[1]);
        return getPartner(slug) ? json(decisionDiagnostics(slug)) : json({ error: "对象不存在" }, 404);
      }
      const mPatterns = path.match(/^\/api\/partners\/([^/]+)\/patterns$/);
      if (mPatterns) {
        const slug = decodeURIComponent(mPatterns[1]);
        return getPartner(slug) ? json(readPatternRegistry(slug)) : json({ error: "对象不存在" }, 404);
      }
      const mGraph = path.match(/^\/api\/partners\/([^/]+)\/evidence-graph$/);
      if (mGraph) {
        const slug = decodeURIComponent(mGraph[1]);
        return getPartner(slug) ? json(evidenceGraph(slug)) : json({ error: "对象不存在" }, 404);
      }
      const mPerformance = path.match(/^\/api\/partners\/([^/]+)\/strategy-performance$/);
      if (mPerformance) {
        const slug = decodeURIComponent(mPerformance[1]);
        return getPartner(slug) ? json(strategyPerformance(slug)) : json({ error: "对象不存在" }, 404);
      }
      if (path === "/api/calibration") return json({
        consent: readSettings().calibrationConsent ?? { enabled: false, version: "2026-07-v1" },
        report: calibrationReport(),
      });
      if (path === "/api/calibration/export") return new Response(JSON.stringify(calibrationDataset(), null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="dianzi-junshi-calibration-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
      const mAsset = path.match(/^\/api\/partners\/([^/]+)\/imports\/([^/]+)$/);
      if (mAsset) {
        const filePath = attachmentPath(decodeURIComponent(mAsset[1]), decodeURIComponent(mAsset[2]));
        if (!filePath) return new Response("Not Found", { status: 404 });
        const file = Bun.file(filePath);
        return new Response(file, { headers: { "content-type": file.type || "application/octet-stream", "cache-control": "private, max-age=3600" } });
      }
    }

    if (req.method === "POST") {
      if (path === "/api/settings") {
        const patch = await req.json() as any;
        try {
          for (const [provider, values] of Object.entries(patch.providers ?? {}) as Array<[string, any]>) {
            if (values?.removeApiKey) await deleteProviderKey(provider);
            else if (typeof values?.apiKey === "string" && values.apiKey.trim() && !/^•+/.test(values.apiKey)) {
              await saveProviderKey(provider, values.apiKey);
            }
          }
          if (patch.calibrationConsent) patch.calibrationConsent = {
            enabled: Boolean(patch.calibrationConsent.enabled), version: "2026-07-v1",
            enabledAt: patch.calibrationConsent.enabled
              ? readSettings().calibrationConsent?.enabledAt ?? new Date().toISOString() : undefined,
          };
          writeSettings(patch);
          resumePendingMaterialJobs();
          return json(maskedSettings());
        } catch (e: any) {
          return json({ error: String(e?.message ?? e) }, 400);
        }
      }
      if (path === "/api/partners") {
        const { name, stage = 1, antiSimp = false, backgroundText = "", images = [] } = await req.json();
        if (typeof name !== "string" || !name.trim()) return json({ error: "先给 ta 起个代号" }, 400);
        try {
          validatePartnerImport(String(backgroundText), images as IncomingImage[]);
        } catch (e: any) {
          return json({ error: String(e?.message ?? e) }, 400);
        }
        const meta = createPartner(name, Number(stage), Boolean(antiSimp));
        const imported = importPartnerContext(meta.slug, String(backgroundText), images as IncomingImage[]);
        return json({ ...meta, stageName: stageInfo(meta.stage).name, imported });
      }
      const mUpload = path.match(/^\/api\/partners\/([^/]+)\/materials\/upload$/);
      if (mUpload) {
        const slug = decodeURIComponent(mUpload[1]);
        let name = "截图";
        try { name = decodeURIComponent(req.headers.get("x-file-name") || name); } catch { /* keep fallback */ }
        try {
          const attachment = await saveUploadedImage(slug, {
            name,
            mediaType: (req.headers.get("content-type") || "").split(";")[0].trim(),
            body: req.body,
          });
          return json(attachment);
        } catch (e: any) {
          return json({ error: String(e?.message ?? e) }, 400);
        }
      }
      const mStartJob = path.match(/^\/api\/partners\/([^/]+)\/material-jobs$/);
      if (mStartJob) {
        try {
          const { attachments = [] } = await req.json() as { attachments?: StoredAttachment[] };
          return json(startMaterialJob(decodeURIComponent(mStartJob[1]), attachments));
        } catch (e: any) {
          return json({ error: String(e?.message ?? e) }, 400);
        }
      }
      const mResumeJob = path.match(/^\/api\/partners\/([^/]+)\/material-jobs\/([a-f0-9-]{36})\/resume$/);
      if (mResumeJob) {
        const { retryFailed = false } = await req.json().catch(() => ({}));
        const job = resumeMaterialJob(decodeURIComponent(mResumeJob[1]), mResumeJob[2], Boolean(retryFailed));
        return job ? json(job) : json({ error: "整理任务不存在" }, 404);
      }
      const mFeedback = path.match(/^\/api\/partners\/([^/]+)\/feedback$/);
      if (mFeedback) {
        const slug = decodeURIComponent(mFeedback[1]);
        if (!getPartner(slug)) return json({ error: "对象不存在" }, 404);
        try {
          const feedback = await req.json() as OutcomeFeedback;
          if (!feedback.replyText?.trim() || !["positive", "neutral", "negative", "no_reply"].includes(feedback.outcome)) {
            return json({ error: "请选中实际发送的话，并记录 ta 后来的反应" }, 400);
          }
          recordLinkedOutcome(slug, feedback);
          const linkedDecision = feedback.decisionId ? getDecisionReport(slug, feedback.decisionId) : null;
          if (linkedDecision && readSettings().calibrationConsent?.enabled) {
            recordCalibrationExample(linkedDecision, feedback, readSettings().calibrationConsent?.version);
          }
          const profile = recordOutcomeFeedback(slug, feedback);
          appendMessage(slug, {
            role: "user",
            mode: "context",
            text: `【实际结果反馈】用户记录了这次建议的后续结果：${feedback.outcome}。这条结果已进入随时间衰减的画像，不应被当作永久性格结论。`,
          });
          return json(profile);
        } catch (e: any) {
          return json({ error: String(e?.message ?? e) }, 400);
        }
      }
      const mPatternLifecycle = path.match(/^\/api\/partners\/([^/]+)\/patterns\/([^/]+)\/lifecycle$/);
      if (mPatternLifecycle) {
        const slug = decodeURIComponent(mPatternLifecycle[1]);
        if (!getPartner(slug)) return json({ error: "对象不存在" }, 404);
        try {
          const { lifecycle } = await req.json() as { lifecycle: "candidate" | "active" | "watch" | "retired" | "rejected" };
          const pattern = updatePatternLifecycle(slug, decodeURIComponent(mPatternLifecycle[2]), lifecycle);
          return pattern ? json(pattern) : json({ error: "模式不存在" }, 404);
        } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
      }
      if (path === "/api/calibration/delete") {
        return json({ deleted: deleteCalibrationDataset() });
      }
      const mRebuild = path.match(/^\/api\/partners\/([^/]+)\/decision-engine\/rebuild$/);
      if (mRebuild) {
        const slug = decodeURIComponent(mRebuild[1]);
        return getPartner(slug) ? json(rebuildDerivedState(slug)) : json({ error: "对象不存在" }, 404);
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

console.log(`电子军师 App 已启动：http://${HOST}:${server.port}`);
console.log(`数据目录：${DJ_HOME}（API key 与聊天记录都在这里，不进仓库）`);
console.log(`当前 AI 连接：${readSettings().provider}（界面左下角可以更换）`);
queueMicrotask(() => resumePendingMaterialJobs());
if (process.argv.includes("--open") && process.platform === "darwin") {
  Bun.spawn(["open", `http://${HOST}:${server.port}`]);
}
