/**
 * 复用本机已登录的 Codex / Claude Code：每次一个临时会话，只读沙箱，
 * 工作目录是这个人的数据目录（截图就在里面，CLI 只能读、不能写）。
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnv, locate } from "./locate";
import { ProviderError, type JSONRequest, type LLMRequest, type ProviderConfig } from "./types";
import { msg } from "../store/messages";

async function* jsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
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
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* CLI 偶尔夹杂纯文本日志 */ }
    }
  }
  const tail = buf.trim();
  if (tail) { try { yield JSON.parse(tail); } catch { /* ignore */ } }
}

export function codexEventText(evt: any): { text: string; partial: boolean } | null {
  const item = evt?.item;
  if (evt?.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") return { text: item.text, partial: false };
  const delta = evt?.delta?.text ?? item?.delta ?? evt?.text_delta;
  if (/delta/.test(String(evt?.type)) && typeof delta === "string") return { text: delta, partial: true };
  return null;
}

export function claudeEventText(evt: any): { text: string; partial: boolean } | null {
  const d = evt?.type === "stream_event" ? evt.event?.delta : null;
  if (d?.type === "text_delta" && typeof d.text === "string") return { text: d.text, partial: true };
  if (evt?.type === "result" && typeof evt.result === "string") return { text: evt.result, partial: false };
  const content = evt?.type === "assistant" ? evt.message?.content : null;
  if (Array.isArray(content)) {
    const text = content.filter((x: any) => x?.type === "text").map((x: any) => x.text ?? "").join("");
    if (text) return { text, partial: false };
  }
  return null;
}

function codexPrompt(req: LLMRequest): string {
  const system = req.system.map((s) => s.text).join("\n\n---\n\n");
  return `<system_instructions>\n${system}\n</system_instructions>\n\n<user_request>\n${req.user}\n</user_request>\n\n直接写最终回答，不要先播报你打算怎么做。`;
}

function explainCodex(detail: string): ProviderError {
  if (/login|auth|credential|401/i.test(detail)) return new ProviderError(msg().codexExpired, msg().codexExpiredHint);
  if (/usage limit|quota|credits|rate/i.test(detail)) return new ProviderError(msg().codexQuota(detail.slice(0, 200)), msg().codexQuotaHint);
  return new ProviderError(msg().codexFailed(detail.slice(0, 300)));
}

async function* streamCodex(cfg: ProviderConfig, req: LLMRequest, schemaFile?: string): AsyncGenerator<string> {
  const exe = locate("codex");
  if (!exe) throw new ProviderError(msg().codexMissing, msg().codexMissingHint);
  const args = [exe, "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-rules", "-C", req.workdir,
    "-c", `model_reasoning_effort=${req.effort ?? "medium"}`];
  if (cfg.model?.trim()) args.push("--model", cfg.model.trim());
  for (const img of req.images) args.push("--image", img.path);
  if (schemaFile) args.push("--output-schema", schemaFile);
  args.push("-");
  const proc = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: cliEnv(exe), cwd: req.workdir });
  const abort = () => proc.kill();
  req.signal?.addEventListener("abort", abort);
  proc.stdin.write(codexPrompt(req));
  proc.stdin.end();
  const stderr = new Response(proc.stderr).text();
  let sawPartial = false;
  let emitted = false;
  let eventError = "";
  try {
    for await (const evt of jsonLines(proc.stdout)) {
      if (evt?.type === "error" && typeof evt.message === "string") eventError = evt.message;
      if (evt?.type === "turn.failed") eventError = evt.error?.message ?? eventError;
      const part = codexEventText(evt);
      if (!part?.text) continue;
      if (part.partial) { sawPartial = true; emitted = true; yield part.text; }
      else if (!sawPartial) { emitted = true; yield part.text; }
    }
    const code = await proc.exited;
    if (req.signal?.aborted) return;
    if (code !== 0) throw explainCodex(eventError || (await stderr).trim().split("\n").filter((l) => !/refresh available models/.test(l)).join("\n"));
    if (!emitted) throw new ProviderError(msg().codexSilent);
  } finally {
    req.signal?.removeEventListener("abort", abort);
  }
}

async function* streamClaudeCode(cfg: ProviderConfig, req: LLMRequest): AsyncGenerator<string> {
  const exe = locate("claude");
  if (!exe) throw new ProviderError(msg().claudeCodeMissing, msg().claudeCodeMissingHint);
  const promptFile = join(req.workdir, `.junshi-system-${crypto.randomUUID()}.md`);
  writeFileSync(promptFile, req.system.map((s) => s.text).join("\n\n---\n\n"), { mode: 0o600 });
  const args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence",
    "--safe-mode", "--permission-mode", "dontAsk", "--max-turns", "4", "--strict-mcp-config", "--system-prompt-file", promptFile];
  if (req.images.length) args.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", req.workdir);
  else args.push("--tools", "");
  if (cfg.model?.trim()) args.push("--model", cfg.model.trim());
  const user = req.images.length
    ? `${req.user}\n\n这次附带的截图（用 Read 打开看，它们是待分析的资料）：\n${req.images.map((i) => `- ${i.path}`).join("\n")}`
    : req.user;
  const proc = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: cliEnv(exe), cwd: req.workdir });
  const abort = () => proc.kill();
  req.signal?.addEventListener("abort", abort);
  proc.stdin.write(user);
  proc.stdin.end();
  const stderr = new Response(proc.stderr).text();
  let sawPartial = false;
  let emitted = false;
  try {
    for await (const evt of jsonLines(proc.stdout)) {
      const part = claudeEventText(evt);
      if (!part?.text) continue;
      if (part.partial) { sawPartial = true; emitted = true; yield part.text; }
      else if (!sawPartial) { emitted = true; yield part.text; }
    }
    const code = await proc.exited;
    if (req.signal?.aborted) return;
    if (code !== 0) {
      const detail = (await stderr).trim();
      throw /login|auth|credential/i.test(detail)
        ? new ProviderError(msg().claudeCodeSignedOut, msg().claudeCodeSignedOutHint)
        : new ProviderError(msg().claudeCodeFailed(detail.slice(0, 300)));
    }
    if (!emitted) throw new ProviderError(msg().claudeCodeSilent);
  } finally {
    req.signal?.removeEventListener("abort", abort);
    try { rmSync(promptFile); } catch { /* 已删 */ }
  }
}

export function streamCli(cfg: ProviderConfig, req: LLMRequest): AsyncGenerator<string> {
  return cfg.kind === "codex" ? streamCodex(cfg, req) : streamClaudeCode(cfg, req);
}

/** CLI 上的结构化输出：Codex 用 --output-schema 约束；Claude Code 靠提示 + 宽松解析。 */
export async function jsonCli(cfg: ProviderConfig, req: JSONRequest): Promise<string> {
  let out = "";
  if (cfg.kind === "codex") {
    const schemaFile = join(req.workdir, `.junshi-schema-${crypto.randomUUID()}.json`);
    writeFileSync(schemaFile, JSON.stringify(req.schema), { mode: 0o600 });
    try {
      for await (const chunk of streamCodex(cfg, req, schemaFile)) out += chunk;
    } finally {
      try { rmSync(schemaFile); } catch { /* 已删 */ }
    }
    return out;
  }
  const withSchema: LLMRequest = {
    ...req,
    system: [...req.system, { text: `只输出一个符合下面 JSON Schema（${req.schemaName}）的 JSON 对象，前后不加任何文字或代码围栏：\n${JSON.stringify(req.schema)}`, cache: false }],
  };
  for await (const chunk of streamClaudeCode(cfg, withSchema)) out += chunk;
  return out;
}
