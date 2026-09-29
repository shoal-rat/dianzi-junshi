# 桌面壳和安装包

Tauri 2 原生窗口负责应用生命周期；业务后端是 `app/` 下的 TypeScript，构建时连同前端和问答策略一起编译成单文件 sidecar。v6 起不需要任何原生库。

## 本机构建

```bash
bun install
bun run build
```

`beforeBuildCommand`（`scripts/build-sidecar.ts`）会：

1. 读取 `TAURI_ENV_TARGET_TRIPLE`；
2. 用对应的 Bun target 把 `app/server.ts` 编译成单文件；
3. 按 Tauri 要求的 target-triple 文件名放进 `src-tauri/binaries/`；
4. Linux 上把后端压成资源、外面套一层 shell sidecar（linuxdeploy 处理不了 Bun 的静态可执行文件）。

macOS 只打 DMG：

```bash
bun run build -- --bundles dmg
```

## 运行时

- 只允许单实例。
- 启动时找一个空闲的本机端口，sidecar 只绑定 `127.0.0.1`，并拒绝非本机来源的请求。
- API Key 通过同一个可执行文件的 `--keychain` 子命令读写系统钥匙串（macOS 钥匙串 / Windows 凭据管理器 / Linux Secret Service）。
- 退出时结束 sidecar。

## 图标

`app-icon.html` 是图标的源文件：用 Chrome 无头模式按 1024×1024、透明底截图，再运行 `bunx tauri icon icon.png` 生成全部尺寸。

## 发布

GitHub Actions 的「Build desktop installers」手动触发，构建 macOS（Apple 芯片 / Intel）、Windows、Linux（x64 / ARM64）安装包并生成草稿 Release。签名与公证见 [发布签名](../docs/release-signing.md)。
