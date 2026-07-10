# 安装电子军师桌面版

## 最简单的方法

1. 打开 [最新 Release](https://github.com/shoal-rat/dianzi-junshi/releases/latest)。
2. 下载自己电脑对应的文件。
3. 双击安装，然后从开始菜单、应用程序或应用列表打开「电子军师」。

| 系统 | 选择 |
| --- | --- |
| Windows 10 / 11 | `*-setup.exe`；公司批量部署可选 MSI |
| Apple Silicon Mac | `*_aarch64.dmg` |
| Intel Mac | `*_x64.dmg` |
| Ubuntu / Debian x64 | `*_amd64.deb` |
| Linux ARM64 | `*_arm64.deb` 或 `*_aarch64.AppImage` |
| 其他 Linux | AppImage |

安装包已经包含桌面窗口、本地后端和数据库。普通用户不要再克隆仓库，也不用安装 Bun、Rust、Node.js 或旧版 Skill。

## macOS 第一次打开

公开发布前，维护者应配置 Apple Developer 签名与 notarization。如果下载的是未 notarize 的测试包，macOS 可能阻止第一次打开：

1. 打开「系统设置 → 隐私与安全性」。
2. 找到被阻止的「电子军师」。
3. 点「仍要打开」。

不要从不可信的镜像站下载安装包。

## Windows 第一次打开

未签名的测试包可能触发 SmartScreen。公开 Release 应使用代码签名证书。若你在测试自己构建的版本，确认来源是本仓库的 GitHub Release 后再继续。

## Linux

DEB：

```bash
sudo apt install ./电子军师_*.deb
```

AppImage：

```bash
chmod +x 电子军师_*.AppImage
./电子军师_*.AppImage
```

## 可选的一键下载脚本

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
```

脚本只从 GitHub 最新 Release 下载适合当前系统的安装包。想看清每一步时，直接使用上面的手动下载方式更合适。

## 连接 AI

安装完成后，可以：

- 使用电脑上已经登录的 Codex；
- 使用电脑上已经登录的 Claude Code；
- 在 App 里配置 Claude、DeepSeek、GLM 或兼容 OpenAI 的 API。

Codex 和 Claude Code 不是安装桌面 App 的前置条件。没有任何连接时，可以先用演示模式熟悉界面。
