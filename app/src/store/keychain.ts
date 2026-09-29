/**
 * API Key 只存系统凭据库：桌面版走 Tauri 自带的 keyring 助手（DJ_KEYCHAIN_HELPER），
 * 开发模式在 macOS 用 security、Linux 用 secret-tool。服务名和账户名与 v5 相同，
 * 升级后原来的 Key 直接可用。
 */

import { readSettings, writeSettings } from "./settings";
import type { ProviderKind } from "../shared/domain";

const SERVICE = "com.shoalrat.dianzi-junshi";
export const KEYED: ProviderKind[] = ["claude", "deepseek", "glm", "custom"];

const secrets = new Map<string, string>();

export type KeychainBackend = "desktop" | "macos" | "libsecret" | "memory";

export function keychainBackend(): KeychainBackend {
  if (process.env.DJ_KEYCHAIN_HELPER) return "desktop";
  if (process.env.DJ_KEYCHAIN_MEMORY === "1") return "memory";
  if (process.platform === "darwin" && Bun.which("security")) return "macos";
  if (process.platform === "linux" && Bun.which("secret-tool")) return "libsecret";
  return "memory";
}

async function run(args: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(args, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (stdin !== undefined) { proc.stdin!.write(stdin); proc.stdin!.end(); }
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: out.trim(), err: err.trim() };
}

async function helper(action: "get" | "set" | "delete", kind: string, secret?: string): Promise<string | null> {
  const backend = keychainBackend();
  const account = `${kind}-api-key`;
  if (backend === "desktop") {
    const r = await run([process.env.DJ_KEYCHAIN_HELPER!, "--keychain", action, kind], action === "set" ? secret : undefined);
    if (action === "get" && r.code === 4) return null;
    if (r.code !== 0) throw new Error(r.err || "系统凭据库没响应");
    return action === "get" ? r.out : "ok";
  }
  if (backend === "macos") {
    const args = action === "get" ? ["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"]
      : action === "delete" ? ["security", "delete-generic-password", "-s", SERVICE, "-a", account]
        : ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", secret ?? ""];
    const r = await run(args);
    if (r.code === 44) return action === "delete" ? "ok" : null;
    if (r.code !== 0) throw new Error(r.err || "钥匙串没响应");
    return action === "get" ? r.out : "ok";
  }
  if (backend === "libsecret") {
    const args = action === "get" ? ["secret-tool", "lookup", "service", SERVICE, "provider", kind]
      : action === "delete" ? ["secret-tool", "clear", "service", SERVICE, "provider", kind]
        : ["secret-tool", "store", "--label", `电子军师 ${kind}`, "service", SERVICE, "provider", kind];
    const r = await run(args, action === "set" ? secret : undefined);
    if (action === "get") return r.code === 0 && r.out ? r.out : null;
    if (r.code !== 0) throw new Error(r.err || "Secret Service 没响应");
    return "ok";
  }
  return action === "get" ? null : "ok";
}

/** 启动时把已标记的 Key 读进内存。 */
export async function loadKeys(): Promise<string[]> {
  const issues: string[] = [];
  const settings = readSettings();
  for (const kind of KEYED) {
    if (!settings.providers[kind]?.hasKey) continue;
    try {
      const secret = await helper("get", kind);
      if (secret) secrets.set(kind, secret);
      else issues.push(`${kind}：凭据库里没找到 Key`);
    } catch (e: any) {
      issues.push(`${kind}：${e?.message ?? e}`);
    }
  }
  return issues;
}

export function keyFor(kind: ProviderKind): string | undefined {
  return secrets.get(kind) ?? (kind === "claude" ? process.env.ANTHROPIC_API_KEY : undefined);
}

export async function saveKey(kind: ProviderKind, secret: string): Promise<void> {
  if (!KEYED.includes(kind)) throw new Error("这个连接不需要 API Key");
  const clean = secret.trim();
  if (!clean) throw new Error("API Key 是空的");
  if (keychainBackend() !== "memory") await helper("set", kind, clean);
  secrets.set(kind, clean);
  writeSettings({ providers: { [kind]: { hasKey: keychainBackend() !== "memory" } } });
}

export async function deleteKey(kind: ProviderKind): Promise<void> {
  if (!KEYED.includes(kind)) return;
  try { await helper("delete", kind); } catch { /* 已经没有了 */ }
  secrets.delete(kind);
  writeSettings({ providers: { [kind]: { hasKey: false } } });
}
