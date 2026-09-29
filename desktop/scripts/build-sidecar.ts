/**
 * Tauri beforeBuildCommand：把 app/server.ts（连同内嵌的前端和问答策略）编译成
 * 当前目标平台的单文件 sidecar。v6 起不再需要任何原生库。
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || Bun.spawnSync(["rustc", "--print", "host-tuple"]).stdout.toString().trim();
const targets: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
};
const bunTarget = targets[triple];
if (!bunTarget) throw new Error(`暂不支持构建目标：${triple}`);

const desktop = join(import.meta.dir, "..");
const repository = join(desktop, "..");
const binaries = join(desktop, "src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });
const backendResources = join(desktop, "src-tauri", "resources", "backend");
rmSync(backendResources, { recursive: true, force: true });

const extension = triple.includes("windows") ? ".exe" : "";
const output = join(binaries, `dianzi-junshi-server-${triple}${extension}`);
const compiledOutput = triple.includes("linux") ? `${output}.elf` : output;
const proc = Bun.spawnSync([
  "bun", "build", "--compile", `--target=${bunTarget}`, "--minify",
  join(repository, "app", "server.ts"), "--outfile", compiledOutput,
], { cwd: join(repository, "app"), stdout: "inherit", stderr: "inherit" });
if (proc.exitCode !== 0) throw new Error(`后端构建失败（exit ${proc.exitCode}）`);

// linuxdeploy 默认所有 ELF 都是动态链接，遇到 Bun 的静态单文件会中止。
// Linux 上把后端压成资源，外面套一个小 shell sidecar，首次启动解压到缓存目录。
if (triple.includes("linux")) {
  mkdirSync(backendResources, { recursive: true });
  writeFileSync(join(backendResources, "dianzi-junshi-server.gz"), Bun.gzipSync(readFileSync(compiledOutput), { level: 9 }));
  const pkg = await Bun.file(join(desktop, "package.json")).json() as { version: string };
  const wrapper = readFileSync(join(import.meta.dir, "linux-sidecar.sh"), "utf8").replaceAll("__APP_VERSION__", pkg.version);
  writeFileSync(output, wrapper, { mode: 0o755 });
  chmodSync(output, 0o755);
  rmSync(compiledOutput, { force: true });
}
console.log(`桌面后端已准备：${output}`);
