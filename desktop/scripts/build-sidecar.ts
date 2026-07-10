import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const nativeResources = join(desktop, "src-tauri", "resources", "native");
rmSync(nativeResources, { recursive: true, force: true });
mkdirSync(nativeResources, { recursive: true });
const backendResources = join(desktop, "src-tauri", "resources", "backend");
rmSync(backendResources, { recursive: true, force: true });
const profile = process.env.TAURI_ENV_DEBUG === "true" ? "debug" : "release";
// Tauri preserves resource permissions in its generated target folder. Remove an
// incremental copy before replacing native libraries so a previous read-only file
// cannot block the next build.
rmSync(join(desktop, "src-tauri", "target", profile, "resources", "native"), { recursive: true, force: true });
rmSync(join(desktop, "src-tauri", "target", triple, profile, "resources", "native"), { recursive: true, force: true });
const extension = triple.includes("windows") ? ".exe" : "";
const output = join(binaries, `dianzi-junshi-server-${triple}${extension}`);
const compiledOutput = triple.includes("linux") ? `${output}.elf` : output;
const proc = Bun.spawnSync([
  "bun", "build", "--compile", `--target=${bunTarget}`,
  join(repository, "app", "server.ts"), "--outfile", compiledOutput,
], { cwd: join(repository, "app"), stdout: "inherit", stderr: "inherit" });
if (proc.exitCode !== 0) throw new Error(`后端构建失败（exit ${proc.exitCode}）`);

// linuxdeploy assumes every ELF executable is dynamically linked and aborts when
// `ldd` correctly returns non-zero for Bun's standalone static executable. Ship
// the ELF as a gzip resource and expose a small shell sidecar instead. It expands
// once into the user's cache, then reuses the executable on later launches.
if (triple.includes("linux")) {
  mkdirSync(backendResources, { recursive: true });
  const archive = join(backendResources, "dianzi-junshi-server.gz");
  writeFileSync(archive, Bun.gzipSync(readFileSync(compiledOutput), { level: 9 }));
  const pkg = await Bun.file(join(desktop, "package.json")).json() as { version: string };
  const wrapper = readFileSync(join(import.meta.dir, "linux-sidecar.sh"), "utf8")
    .replaceAll("__APP_VERSION__", pkg.version);
  writeFileSync(output, wrapper, { mode: 0o755 });
  chmodSync(output, 0o755);
  rmSync(compiledOutput, { force: true });
}

const vecPackages: Record<string, [string, string]> = {
  "aarch64-apple-darwin": ["sqlite-vec-darwin-arm64", "vec0.dylib"],
  "x86_64-apple-darwin": ["sqlite-vec-darwin-x64", "vec0.dylib"],
  "x86_64-pc-windows-msvc": ["sqlite-vec-windows-x64", "vec0.dll"],
  "x86_64-unknown-linux-gnu": ["sqlite-vec-linux-x64", "vec0.so"],
  "aarch64-unknown-linux-gnu": ["sqlite-vec-linux-arm64", "vec0.so"],
};
const [vecPackage, vecFile] = vecPackages[triple];
const vecSource = join(repository, "app", "node_modules", vecPackage, vecFile);
if (existsSync(vecSource)) {
  const vecDestination = join(nativeResources, vecFile);
  copyFileSync(vecSource, vecDestination);
  chmodSync(vecDestination, 0o644);
}
else console.warn(`sqlite-vec 原生加速库未找到，将使用兼容检索：${vecSource}`);

const sqliteCandidates = [
  process.env.DJ_BUILD_SQLITE_LIBRARY,
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
  "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0",
].filter(Boolean) as string[];
const sqliteSource = sqliteCandidates.find(existsSync);
if (sqliteSource) {
  const sqliteName = triple.includes("windows") ? "sqlite3.dll" : triple.includes("apple") ? "libsqlite3.dylib" : "libsqlite3.so";
  const sqliteDestination = join(nativeResources, sqliteName);
  copyFileSync(sqliteSource, sqliteDestination);
  chmodSync(sqliteDestination, 0o644);
}
console.log(`桌面后端已准备：${output}`);
