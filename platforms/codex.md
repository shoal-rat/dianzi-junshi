# Codex 使用指南

Codex 支持 Agent Skills。这个仓库已经按 Codex 可识别的结构提供：

- `SKILL.md`：技能入口，包含 `name: dianzi-junshi` 和触发描述。
- `agents/openai.yaml`：Codex App 的展示名、简介和默认调用提示。
- `references/`：按需加载的 8 个细分模块（语感门禁、梗协议、梗词典、局势解读、节奏打法、对象档案、记忆引擎、约会）。
- `tools/`：确定性脚本（回复语感检查、聊天解析、批量导入、反馈统计等）。

## 安装到用户级 Codex

一行命令，克隆到 Codex 的用户技能目录。

Windows（PowerShell）：

```powershell
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME\.agents\skills\dianzi-junshi"
```

macOS / Linux：

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.agents/skills/dianzi-junshi"
```

重启 Codex 后，最省事的用法是直接贴截图、说人话：

```text
帮我追个人，先建个档
（贴一张微信截图）这条我该怎么回
```

想显式点名也行：

```text
Use $dianzi-junshi to analyze this message and draft three replies: "你最近忙什么呢"
```

```text
Use $dianzi-junshi to judge whether ta is interested based on this chat log. Anti-simp mode is on.
```

```text
Use $dianzi-junshi to analyze this Moments screenshot and suggest low-oiliness flirting openers.
```

```text
Use $dianzi-junshi to import and classify this folder: C:\Users\me\Desktop\ta-materials
```

```text
Use $dianzi-junshi to plan this accepted date. Keep user-only reminders separate from copyable replies.
```

也可以直接说：

```text
帮我分析 ta 这句话是什么意思，并给三个回复方案。
```

Codex 会根据 `SKILL.md` 的 `description` 决定是否隐式调用。

## 安装到仓库级 Codex

如果你想让某个项目自带这个技能：

```powershell
New-Item -ItemType Directory -Force ".agents\skills" | Out-Null
git clone https://github.com/shoal-rat/dianzi-junshi.git ".agents\skills\dianzi-junshi"
```

注意：Codex 会扫描 `.agents/skills`，不是任意项目根目录。把本仓库直接当工作目录打开时，仍建议复制到 `.agents/skills/dianzi-junshi` 或 `$HOME/.agents/skills/dianzi-junshi`。

## 档案存哪

Claude Code 和 Codex 能读写本地 `partners/`，所以适合存长期档案。每个对象一个文件夹，互不干扰；`partners/` 已被 `.gitignore` 忽略，不会默认提交。

## 常用能力

- `/reply`：三层解读 + 稳妥版/会撩版/展示自己版回复。
- `/import-folder [路径]`：自动扫描并分类聊天记录、朋友圈截图、照片和笔记。
- `/interest`：兴趣度 `0-10` 分、证据和下一步策略。
- `/anti-simp on`：明显没戏时直接劝止损。
- `/moments`：用多模态模型分析朋友圈/社交动态截图、妆容穿搭、评论互动和低油腻撩法。
- `/date-plan`：邀约/约会回复 + 单独旁白提醒。
