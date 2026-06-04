# 安装速查

完全没用过、想一步步来？看 [新手指南](docs/新手指南.md)。下面是给熟手的速查。

## 1. 先有个 AI 客户端

装 Claude Code（推荐）：

- Windows：`irm https://claude.ai/install.ps1 | iex`
- macOS / Linux：`curl -fsSL https://claude.ai/install.sh | bash`

或者用 Codex（见 [platforms/codex.md](platforms/codex.md)）。

## 2. 再装电子军师

**Claude Code（装成技能，一行命令）**

- Windows：`irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex`
- macOS / Linux：`curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash`

装进 `~/.claude/skills/dianzi-junshi`。不想跑脚本，手动 clone 也行：

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.claude/skills/dianzi-junshi"
```

**Codex（克隆到 Codex 技能目录）**

```powershell
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME\.agents\skills\dianzi-junshi"
```

（macOS / Linux 用 `$HOME/.agents/skills/dianzi-junshi`。）

装完如果客户端本来开着，关掉重开一次，新技能才认。

## 3. 开始用

进 Claude Code 或 Codex，说一句「帮我追个人」，回答几个小问题，然后把微信截图丢给它。之后想换对象就说「换人」或「新建」。

## 前置

- Claude Code 或 Codex。
- 朋友圈、自拍它直接看图，Claude Code 和 Codex 都自带这个能力。
- Python 3.8+ 可选，给文件夹分类用；工具只用标准库，不用额外装依赖。
