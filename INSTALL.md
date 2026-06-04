# 安装速查

完全没用过、想一步步来？看 [新手指南](docs/新手指南.md)。下面是给熟手的速查。

## 1. 先有个 AI 客户端

装 Claude Code（推荐）：

- Windows：`irm https://claude.ai/install.ps1 | iex`
- macOS / Linux：`curl -fsSL https://claude.ai/install.sh | bash`

或者用 Codex，或者用 ChatGPT（不用装，配置见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)）。

## 2. 再装电子军师（一行命令）

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
```

脚本会装进 Claude Code（`~/.claude/skills/`）和 Codex（`~/.agents/skills/`，有就装）。**装完如果客户端开着，关掉重开一次，新技能才认。**

不想跑脚本，手动 clone 也行：

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.claude/skills/dianzi-junshi"
```

Codex 把目标换成 `~/.agents/skills/dianzi-junshi`。

## 3. 开始用

进 Claude Code 或 Codex，说一句「帮我追个人」，回答几个小问题，然后把微信截图丢给它。之后想换对象就说「换人」或「新建」。

## 前置

- Claude Code、Codex 或 ChatGPT 任选其一。
- 分析朋友圈、自拍要用能看图的模型。
- Python 3.8+ 可选，给文件夹分类和 ChatGPT 知识包打包用；工具只用标准库，不用额外装依赖。

## 你的数据

每个对象一份档案，存在技能目录下的 `partners/`，默认不提交（`.gitignore` 已排除）。
