# 桌面壳和安装包

Tauri 2 原生窗口负责应用生命周期；业务后端仍由 `app/` 下的 TypeScript 实现，并在构建时编译成 sidecar。

## 本机构建

```bash
bun install
bun run build
```

`beforeBuildCommand` 会：

1. 读取 `TAURI_ENV_TARGET_TRIPLE`；
2. 用对应 Bun target 编译后端；
3. 把 sidecar 写成 Tauri 要求的 target-triple 文件名；
4. 准备当前平台可用的 sqlite-vec 原生资源；
5. 由 Tauri 生成当前系统的安装包。

macOS 可以指定：

```bash
bun run build -- --bundles dmg
```

## 运行时

- 只允许单实例。
- 从系统选择空闲本机端口，避免固定 5177 冲突。
- sidecar 只绑定 `127.0.0.1`。
- 等待后端可连接后才创建主窗口。
- 应用退出时结束 sidecar。
- 前端没有执行任意 shell 命令的 Tauri 权限。

## Release

推送 `v*` 标签触发 `.github/workflows/release-desktop.yml`。工作流在各目标系统原生构建，不依赖不可靠的 Windows 跨编译。

签名和发布步骤见 [发布桌面安装包](../docs/发布桌面安装包.md)。
