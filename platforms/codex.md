# 在桌面 App 里使用 Codex

电子军师 v4 不再安装成 Codex Skill。Codex 是桌面 App 可以选择的一种本机 AI 连接。

## 第一次准备

1. 按 [OpenAI 官方说明](https://developers.openai.com/codex/cli/) 安装 Codex CLI。
2. 在终端运行：

   ```bash
   codex login
   ```

3. 打开电子军师，点左下角「AI 连接」。
4. 看到「Codex 已登录」后选择 Codex。

App 只运行 `codex login status` 检查状态，不会读取账号密码。实际请求使用：

```text
codex exec --json --ephemeral --sandbox read-only
```

每次都是临时会话。电子军师自己的 SQLite 负责长期记忆和上下文选择；Codex 只读取这次需要分析的内容。涉及旧截图时，App 仅把当前档案中相关图片的只读路径交给 Codex。

## 不用 API Key 的含义

不需要在电子军师里再粘贴 API Key，但仍会使用 Codex 账号对应的套餐额度、组织规则和使用限制。额度不足时，App 会显示 Codex 返回的真实错误，而不是笼统地说“连接失败”。

## 找不到 Codex

桌面程序有时拿不到终端配置里的自定义 `PATH`。先确认：

```bash
codex --version
codex login status
```

如果终端能找到、App 仍找不到，重新启动 App。macOS 上通过 Homebrew 或官方安装方式放在标准位置通常最省事。
