import type { Settings } from "./store";
import { readSettings, setRuntimeProviderSecret, writeSettings } from "./store";

const SERVICE = "com.shoalrat.dianzi-junshi";
const PROVIDERS = ["claude", "deepseek", "glm", "custom"];

export interface KeychainStatus {
  available: boolean;
  backend: "desktop-keyring" | "macos-keychain" | "libsecret" | "memory-only";
  loaded: string[];
  migrated: string[];
  issues: string[];
}

async function run(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (stdin !== undefined) { proc.stdin!.write(stdin); proc.stdin!.end(); }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

function backend(): KeychainStatus["backend"] {
  if (process.env.DJ_KEYCHAIN_HELPER) return "desktop-keyring";
  if (process.platform === "darwin" && Bun.which("security")) return "macos-keychain";
  if (process.platform === "linux" && Bun.which("secret-tool")) return "libsecret";
  return "memory-only";
}

async function helper(action: "get" | "set" | "delete", provider: string, secret?: string): Promise<string | null> {
  const selected = backend();
  if (selected === "desktop-keyring") {
    const result = await run([process.env.DJ_KEYCHAIN_HELPER!, "--keychain", action, provider], secret);
    if (action === "get" && result.code === 4) return null;
    if (result.code !== 0) throw new Error(result.stderr || "系统凭据库操作失败");
    return action === "get" ? result.stdout : "ok";
  }
  if (selected === "macos-keychain") {
    const account = `${provider}-api-key`;
    const args = action === "get"
      ? ["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"]
      : action === "delete"
        ? ["security", "delete-generic-password", "-s", SERVICE, "-a", account]
        : ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", secret ?? ""];
    const result = await run(args);
    if (action === "get" && result.code === 44) return null;
    if (action === "delete" && result.code === 44) return "ok";
    if (result.code !== 0) throw new Error(result.stderr || "macOS 钥匙串操作失败");
    return action === "get" ? result.stdout : "ok";
  }
  if (selected === "libsecret") {
    const args = action === "get"
      ? ["secret-tool", "lookup", "service", SERVICE, "provider", provider]
      : action === "delete"
        ? ["secret-tool", "clear", "service", SERVICE, "provider", provider]
        : ["secret-tool", "store", "--label", `电子军师 ${provider} API Key`, "service", SERVICE, "provider", provider];
    const result = await run(args, action === "set" ? secret ?? "" : undefined);
    if (action === "get" && (result.code !== 0 || !result.stdout)) return null;
    if (result.code !== 0) throw new Error(result.stderr || "Linux Secret Service 操作失败");
    return action === "get" ? result.stdout : "ok";
  }
  throw new Error("当前运行方式没有可用的系统凭据库；桌面安装版支持安全保存");
}

export async function initializeProviderKeychain(): Promise<KeychainStatus> {
  const settings = readSettings();
  const selected = backend();
  const status: KeychainStatus = { available: selected !== "memory-only", backend: selected, loaded: [], migrated: [], issues: [] };
  let changed = false;
  for (const provider of PROVIDERS) {
    const saved = settings.providers[provider] ?? {};
    if (saved.apiKey && !/^•+/.test(saved.apiKey)) {
      setRuntimeProviderSecret(provider, saved.apiKey);
      try {
        await helper("set", provider, saved.apiKey);
        saved.hasKey = true;
        status.migrated.push(provider);
        changed = true;
      } catch (error: any) {
        status.issues.push(`${provider}: ${String(error?.message ?? error)}`);
      }
      continue;
    }
    if (!saved.hasKey) continue;
    try {
      const secret = await helper("get", provider);
      if (secret) { setRuntimeProviderSecret(provider, secret); status.loaded.push(provider); }
      else status.issues.push(`${provider}: 系统凭据库中没有找到已标记的 Key`);
    } catch (error: any) {
      status.issues.push(`${provider}: ${String(error?.message ?? error)}`);
    }
  }
  if (changed && !status.issues.length) writeSettings({ providers: settings.providers });
  return status;
}

export async function saveProviderKey(provider: string, secret: string): Promise<void> {
  if (!PROVIDERS.includes(provider)) throw new Error("这个连接不使用 API Key");
  if (!secret.trim()) throw new Error("API Key 不能为空");
  await helper("set", provider, secret.trim());
  setRuntimeProviderSecret(provider, secret.trim());
}

export async function deleteProviderKey(provider: string): Promise<void> {
  if (!PROVIDERS.includes(provider)) return;
  await helper("delete", provider);
  setRuntimeProviderSecret(provider);
}

export function keychainBackend(): KeychainStatus["backend"] { return backend(); }
