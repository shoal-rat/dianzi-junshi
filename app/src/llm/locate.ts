/**
 * 找本机的 Codex / Claude Code。
 *
 * 桌面版从 Finder / 开始菜单启动时 PATH 只有系统目录，Homebrew、npm 全局、
 * ChatGPT.app 里带的 codex 都看不见。这里依次查：当前 PATH → 登录 shell 的 PATH
 * → 常见安装位置，并把找到的目录补进子进程的 PATH（npm 装的 CLI 需要 node）。
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { msg } from "../store/messages";

const HOME = homedir();
const WIN = process.platform === "win32";

const KNOWN: Record<"codex" | "claude", string[]> = {
  codex: [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    join(HOME, ".local/bin/codex"),
    join(HOME, ".codex/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    join(HOME, ".npm-global/bin/codex"),
    join(HOME, ".bun/bin/codex"),
    join(process.env.APPDATA ?? "", "npm", "codex.cmd"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "codex", "codex.exe"),
  ],
  claude: [
    join(HOME, ".claude/local/claude"),
    join(HOME, ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(HOME, ".npm-global/bin/claude"),
    join(HOME, ".bun/bin/claude"),
    join(process.env.APPDATA ?? "", "npm", "claude.cmd"),
    join(HOME, ".local", "bin", "claude.exe"),
  ],
};

let shellPath: string | null | undefined;

function loginShellPath(): string | null {
  if (shellPath !== undefined) return shellPath;
  shellPath = null;
  if (WIN) return null;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const proc = Bun.spawnSync([shell, "-ilc", "printf %s \"$PATH\""], { stdout: "pipe", stderr: "ignore", timeout: 4000 });
    const out = proc.stdout.toString().trim().split("\n").pop() ?? "";
    if (out.includes("/")) shellPath = out;
  } catch { /* 取不到就算了 */ }
  return shellPath;
}

const found = new Map<string, string | null>();

export function locate(name: "codex" | "claude"): string | null {
  if (found.has(name)) return found.get(name)!;
  let hit: string | null = Bun.which(name);
  if (!hit) {
    const sp = loginShellPath();
    if (sp) hit = Bun.which(name, { PATH: sp });
  }
  if (!hit) hit = KNOWN[name].find((p) => p && existsSync(p)) ?? null;
  found.set(name, hit);
  return hit;
}

export function resetLocate(): void {
  found.clear();
}

/** 子进程环境：把 CLI 所在目录、登录 shell 的 PATH、常见目录拼进 PATH。 */
export function cliEnv(executable: string): Record<string, string> {
  const parts = [
    dirname(executable),
    process.env.PATH ?? "",
    loginShellPath() ?? "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(HOME, ".local/bin"),
  ].join(delimiter).split(delimiter).filter(Boolean);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  env.PATH = [...new Set(parts)].join(delimiter);
  return env;
}

export interface CliStatus {
  path: string | null;
  installed: boolean;
  signedIn: boolean;
  detail: string;
}

async function runQuiet(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env });
    const timer = setTimeout(() => proc.kill(), 8000);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    return { code, out: `${out}\n${err}` };
  } catch {
    return { code: -1, out: "" };
  }
}

export async function cliStatus(name: "codex" | "claude"): Promise<CliStatus> {
  const path = locate(name);
  if (!path) {
    return { path, installed: false, signedIn: false, detail: name === "codex" ? msg().codexNotFound : msg().claudeNotFound };
  }
  const env = cliEnv(path);
  if (name === "codex") {
    const r = await runQuiet([path, "login", "status"], env);
    const signedIn = r.code === 0 && !/not logged in/i.test(r.out);
    return { path, installed: true, signedIn, detail: signedIn ? msg().cliReady : msg().codexNotSignedIn };
  }
  const r = await runQuiet([path, "auth", "status"], env);
  let signedIn = r.code === 0;
  try {
    const json = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1));
    signedIn = Boolean(json.loggedIn);
  } catch { /* 老版本只有退出码 */ }
  return { path, installed: true, signedIn, detail: signedIn ? msg().cliReady : msg().claudeNotSignedIn };
}
