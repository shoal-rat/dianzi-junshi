/**
 * 电子军师本机服务（Bun）。只监听 127.0.0.1；前端页面由 Bun 打包后内嵌，
 * `bun build --compile` 出来的单文件就是桌面版的 sidecar。
 */

import index from "./web/index.html";
import pkg from "./package.json";
import { database, HOME } from "./src/store/db";
import { migrateLegacy } from "./src/store/legacy";
import { deleteKey, keychainBackend, loadKeys, saveKey } from "./src/store/keychain";
import { readSettings, writeSettings, PROVIDER_KINDS } from "./src/store/settings";
import { createPerson, deletePerson, getPerson, listPeople, updatePerson } from "./src/store/people";
import { getImage, imageBytes, imageRef, imagesFor, saveImage } from "./src/store/images";
import { deleteTurn, getTurn, listTurns, markCopied, updateTurnOutput } from "./src/store/turns";
import { addFacts, deleteMeme, listFacts, listMemes, setMemeAvoid, updateFact } from "./src/store/dossier";
import { deleteOutcome, readings, recordOutcome, styleProfile, tacticStats, workedAndFlopped } from "./src/store/learning";
import { archiveStats, addArchive } from "./src/store/archive";
import { createJob, getJob, importText, latestJob, resumeJobs, retryJob } from "./src/store/imports";
import { semanticStatus, resetSemanticCache } from "./src/store/semantic";
import { activeConfig, providerLabel, providerStatuses, ProviderError, supportsVision } from "./src/llm";
import { resetLocate } from "./src/llm/locate";
import { checksFor, replaceReply, runTurn, revisePlans } from "./src/core/advise";
import { guessOutcome } from "./src/core/feedback";
import { lint } from "./src/core/voice";
import { parseAnswer, planText } from "./src/shared/contract";
import type { DossierDTO, Mode, ProviderKind, SettingsDTO } from "./src/shared/domain";
import { personDir } from "./src/store/db";

if (process.argv.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}

const PORT = Number(process.env.PORT || 5177);
const HOSTNAME = process.env.HOST || "127.0.0.1";
const VERSION = pkg.version;
/** 编译进单文件后，源码在 Bun 的虚拟文件系统里（/$bunfs 或 B:/~BUN）。 */
const COMPILED = import.meta.path.includes("$bunfs") || import.meta.path.includes("~BUN");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function fail(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message, hint: error instanceof ProviderError ? error.hint : undefined }, status);
}

async function body<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

/** 只接受本机页面发来的请求：挡住别的网站借浏览器打本机端口，也挡 DNS rebinding。 */
function trusted(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = req.headers.get("origin");
  if (origin && !/^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|tauri:\/\/localhost|http:\/\/tauri\.localhost)$/.test(origin)) return false;
  return true;
}

type Handler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

function guard(handler: Handler): (req: Request & { params?: Record<string, string> }) => Promise<Response> {
  return async (req) => {
    if (!trusted(req)) return json({ error: "只接受本机请求" }, 403);
    try {
      return await handler(req, (req as any).params ?? {});
    } catch (e) {
      return fail(e);
    }
  };
}

function requirePerson(id: string) {
  const person = getPerson(id);
  if (!person) throw new Error("找不到这个档案");
  return person;
}

async function settingsDTO(): Promise<SettingsDTO> {
  const s = readSettings();
  const sem = await semanticStatus();
  return {
    provider: s.provider,
    providers: await providerStatuses(),
    semantic: { mode: s.semantic, available: sem.available, model: sem.model, detail: sem.detail },
    depth: s.depth ?? "fast",
    me: s.me ?? "",
    keychain: keychainBackend(),
    home: HOME,
    version: VERSION,
  };
}

function dossier(personId: string): DossierDTO {
  const person = requirePerson(personId);
  const { worked, flopped } = workedAndFlopped(personId);
  return {
    person,
    facts: listFacts(personId),
    memes: listMemes(personId),
    readings: readings(personId, 30),
    tactics: tacticStats(personId),
    worked,
    flopped,
    style: styleProfile(personId),
    archive: archiveStats(personId),
    job: latestJob(personId) ?? undefined,
  };
}

const MODES: Mode[] = ["reply", "read", "polish", "odds"];

function sse(generator: AsyncGenerator<{ type: string }>, controller: AbortController): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const ping = setInterval(() => { try { ctrl.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ } }, 15_000);
      try {
        for await (const evt of generator) ctrl.enqueue(encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
      } catch (e: any) {
        ctrl.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: "error", message: String(e?.message ?? e) })}\n\n`));
      } finally {
        clearInterval(ping);
        try { ctrl.close(); } catch { /* 已关 */ }
      }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" } });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  idleTimeout: 255,
  development: COMPILED || process.env.NODE_ENV === "production" ? false : { hmr: false, console: false },
  routes: {
    "/": index,

    "/api/health": guard(() => json({ ok: true, version: VERSION })),

    "/api/settings": {
      GET: guard(async () => json(await settingsDTO())),
      POST: guard(async (req) => {
        const b = await body<{ provider?: ProviderKind; semantic?: "auto" | "off"; depth?: "fast" | "balanced" | "deep"; me?: string; providers?: Record<string, { model?: string; baseUrl?: string }>; key?: { kind: ProviderKind; value: string | null } }>(req);
        if (b.key) {
          if (b.key.value === null) await deleteKey(b.key.kind);
          else await saveKey(b.key.kind, b.key.value);
        }
        const providers: Record<string, { model?: string; baseUrl?: string }> = {};
        for (const [k, v] of Object.entries(b.providers ?? {})) if (PROVIDER_KINDS.includes(k as ProviderKind)) providers[k] = { model: v.model, baseUrl: v.baseUrl };
        writeSettings({ provider: b.provider, semantic: b.semantic, depth: b.depth, me: b.me, providers });
        if (b.semantic) resetSemanticCache();
        resetLocate();
        resumeJobs();
        return json(await settingsDTO());
      }),
    },

    "/api/people": {
      GET: guard(() => json(listPeople())),
      POST: guard(async (req) => {
        const b = await body<{ name: string; gender?: string; stage?: number; nerve?: number; clearEyed?: boolean; note?: string; history?: string }>(req);
        const person = createPerson(b);
        const job = b.history?.trim() ? await importText(person.id, b.history) : null;
        return json({ person, job });
      }),
    },

    "/api/people/:id": {
      GET: guard((_req, p) => json(requirePerson(p.id))),
      PATCH: guard(async (req, p) => json(updatePerson(p.id, await body(req)))),
      DELETE: guard((_req, p) => { requirePerson(p.id); deletePerson(p.id); return json({ ok: true }); }),
    },

    "/api/people/:id/dossier": guard((_req, p) => json(dossier(p.id))),

    "/api/people/:id/turns": {
      GET: guard((req, p) => {
        requirePerson(p.id);
        const before = new URL(req.url).searchParams.get("before") ?? undefined;
        return json(listTurns(p.id, 40, before));
      }),
      POST: guard(async (req, p) => {
        const person = requirePerson(p.id);
        const b = await body<{ mode: Mode; text?: string; imageIds?: string[] }>(req);
        if (!MODES.includes(b.mode)) throw new Error("不认识这个模式");
        const text = String(b.text ?? "").slice(0, 20000);
        const images = imagesFor(person.id, (b.imageIds ?? []).slice(0, 12));
        if (!text.trim() && !images.length) throw new Error("先贴点内容，文字或截图都行");
        const cfg = activeConfig();
        if (images.length && cfg.kind !== "demo" && !supportsVision(cfg)) {
          throw new ProviderError(`${providerLabel(cfg.kind)} 看不了截图`, "把 ta 的话打成文字贴进来，或者在设置里换成 Codex、Claude Code、Claude API 这类能看图的连接");
        }
        const controller = new AbortController();
        req.signal.addEventListener("abort", () => controller.abort());
        return sse(runTurn({ person, mode: b.mode, text, images, cfg, signal: controller.signal }), controller);
      }),
    },

    "/api/turns/:id": {
      DELETE: guard((_req, p) => {
        const turn = getTurn(p.id);
        if (!turn) throw new Error("找不到这一轮");
        deleteTurn(turn.personId, turn.id);
        return json({ ok: true });
      }),
    },

    "/api/turns/:id/copy": {
      POST: guard(async (req, p) => {
        const b = await body<{ planIndex: number }>(req);
        markCopied(p.id, Number(b.planIndex));
        return json({ ok: true });
      }),
    },

    /** 单条锦囊再改改：可以带一句要求（更短 / 更撩 / 别那么主动…）。 */
    "/api/turns/:id/revise": {
      POST: guard(async (req, p) => {
        const turn = getTurn(p.id);
        if (!turn) throw new Error("找不到这一轮");
        const b = await body<{ planIndex: number; ask?: string }>(req);
        const plan = parseAnswer(turn.output).plans.find((x) => x.index === Number(b.planIndex));
        if (!plan) throw new Error("找不到这条锦囊");
        const cfg = activeConfig();
        if (cfg.kind === "demo") throw new Error("演示模式不会真的改稿，先选一个 AI 连接");
        const current = lint(planText(plan));
        const problems = [
          ...current.findings.map((f) => `${f.text}：${f.hint}`),
          b.ask?.trim() ? `用户要求：${b.ask.trim().slice(0, 100)}` : "",
        ].filter(Boolean);
        const fixes = await revisePlans(cfg, personDir(turn.personId), turn.input, [{ index: plan.index, seal: plan.seal, text: planText(plan), problems: problems.length ? problems : ["换一种说法"] }]);
        const text = fixes.get(plan.index);
        if (!text) throw new Error("这次没改出来，再试一次");
        const pos = parseAnswer(turn.output).plans.findIndex((x) => x.index === plan.index);
        const next = checksFor(replaceReply(turn.output, pos, text));
        const checks = next.checks.map((c) => (c.index === plan.index ? { ...c, revised: true } : turn.checks.find((o) => o.index === c.index) ?? c));
        updateTurnOutput(turn.id, next.output, checks);
        return json(getTurn(turn.id));
      }),
    },

    "/api/people/:id/images": {
      POST: guard(async (req, p) => {
        requirePerson(p.id);
        const bytes = new Uint8Array(await req.arrayBuffer());
        const name = decodeURIComponent(req.headers.get("x-file-name") ?? "截图");
        const origin = (new URL(req.url).searchParams.get("origin") ?? "turn") as "turn" | "import" | "feedback";
        const img = saveImage(p.id, bytes, name, ["turn", "import", "feedback"].includes(origin) ? origin : "turn");
        return json({ ...imageRef(img), duplicate: Boolean(img.duplicate) });
      }),
    },

    "/api/images/:id": guard((_req, p) => {
      const img = getImage(p.id);
      const bytes = img ? imageBytes(img) : null;
      if (!img || !bytes) return new Response("not found", { status: 404 });
      return new Response(bytes as unknown as BodyInit, { headers: { "content-type": img.mediaType, "cache-control": "private, max-age=31536000, immutable" } });
    }),

    "/api/people/:id/import": {
      POST: guard(async (req, p) => {
        requirePerson(p.id);
        const b = await body<{ imageIds?: string[]; text?: string }>(req);
        const images = imagesFor(p.id, b.imageIds ?? []);
        let job = null;
        if (b.text?.trim()) job = await importText(p.id, b.text);
        if (images.length) job = createJob(p.id, images.map((i) => ({ kind: "image" as const, ref: i.id, name: i.name })));
        if (!job) throw new Error("没有要导入的内容");
        return json(job);
      }),
    },

    "/api/jobs/:id": guard((_req, p) => { const job = getJob(p.id); return job ? json(job) : fail("找不到这个任务", 404); }),
    "/api/jobs/:id/retry": { POST: guard((_req, p) => json(retryJob(p.id))) },

    "/api/people/:id/outcomes": {
      POST: guard(async (req, p) => {
        requirePerson(p.id);
        const b = await body(req);
        const outcome = recordOutcome(p.id, b);
        if (outcome.sent) await addArchive(p.id, { kind: "sent", text: `用户发：${outcome.sent}${outcome.reply ? `\nta 回：${outcome.reply}` : ""}`, sourceId: outcome.id });
        return json(outcome);
      }),
    },

    "/api/people/:id/outcomes/guess": {
      POST: guard(async (req, p) => {
        requirePerson(p.id);
        const b = await body<{ sent: string; reply?: string; imageIds?: string[] }>(req);
        if (!b.sent?.trim()) throw new Error("先写一下你实际发的是什么");
        const images = imagesFor(p.id, (b.imageIds ?? []).slice(0, 6));
        if (!b.reply?.trim() && !images.length) throw new Error("贴一下 ta 的回复，文字或截图都行");
        return json(await guessOutcome(activeConfig(), personDir(p.id), b.sent, b.reply ?? "", images));
      }),
    },

    "/api/people/:id/outcomes/:oid": {
      DELETE: guard((_req, p) => { deleteOutcome(p.id, p.oid); return json({ ok: true }); }),
    },

    "/api/people/:id/facts": {
      POST: guard(async (req, p) => {
        requirePerson(p.id);
        const b = await body<{ slot: string; text: string; date?: string }>(req);
        addFacts(p.id, [{ slot: b.slot, text: b.text, date: b.date }], "user", undefined, 0.95);
        return json(listFacts(p.id));
      }),
    },

    "/api/people/:id/facts/:fid": {
      PATCH: guard(async (req, p) => { updateFact(p.id, p.fid, await body(req)); return json(listFacts(p.id)); }),
    },

    "/api/people/:id/memes": {
      POST: guard(async (req, p) => {
        const b = await body<{ term: string; avoid?: boolean; remove?: boolean }>(req);
        if (b.remove) deleteMeme(p.id, b.term);
        else setMemeAvoid(p.id, b.term, Boolean(b.avoid));
        return json(listMemes(p.id));
      }),
    },

    "/api/lint": { POST: guard(async (req) => json(lint(String((await body(req)).text ?? "")))) },
  },
  fetch(req) {
    return trusted(req) ? new Response("not found", { status: 404 }) : new Response("forbidden", { status: 403 });
  },
});

database();
migrateLegacy().then((n) => { if (n) console.log(`从旧版本搬过来 ${n} 个档案`); }).catch((e) => console.error("旧数据迁移失败：", e));
loadKeys().then((issues) => { for (const i of issues) console.warn(i); }).finally(() => resumeJobs());

const url = `http://${HOSTNAME === "0.0.0.0" ? "127.0.0.1" : HOSTNAME}:${server.port}/`;
console.log(`电子军师 ${VERSION} · ${url} · 数据在 ${HOME}`);
if (process.argv.includes("--open")) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", url] : ["xdg-open", url];
  try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }); } catch { /* 手动打开 */ }
}
