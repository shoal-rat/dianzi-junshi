# 安装

## 一行命令

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
```

脚本会把技能装进你已经在用的 Claude Code（`~/.claude/skills/`）或 Codex（`~/.agents/skills/`）；两个都装了就都装。

## 然后交给它

打开 Claude Code 或 Codex，说一句：

```text
帮我追个人
```

它先让你给 ta 起个代号，再把聊天截图丢给它就行，阶段、性格、你的说话风格它自己从聊天里看。没有截图，它就用带选项的小框问你一两句（到哪一步了、要不要反舔狗模式），其余跳过。

手头资料多就直接丢个文件夹路径，不用自己分类：

```text
ta 的资料都在 C:\Users\你\Desktop\ta资料
```

建好它马上给第一条建议。之后把微信截图或聊天记录丢进去，它就给你回复。

同时想追几个人？说一声「新建」再起个代号就行，每个人各记各的，不会串。下次打开它会先问你这次聊谁。

## 手动装

不想跑脚本，clone 到技能目录就行：

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.claude/skills/dianzi-junshi"
```

Codex 把目标换成 `~/.agents/skills/dianzi-junshi`。装完重启一下客户端就能用。

## ChatGPT

ChatGPT 读不到你的本地文件，把它当「当前对话版」或自定义 GPT 用，配置见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)。

想做成自定义 GPT，先打包成单文件知识包再上传：

```bash
python tools/build_chatgpt_pack.py
```

生成的 `dist/dianzi-junshi-chatgpt-pack.md` 传到 GPT 的 knowledge 即可。

## 前置

- Claude Code、Codex 或 ChatGPT 任选其一。
- 分析朋友圈和自拍要用能看图的模型，光读文字会漏掉一半信息。
- Python 3.8+ 可选，给文件夹分类和知识包打包用；工具只用标准库，不用额外装依赖。

## 你的数据

每个对象一份档案，存在技能目录下的 `partners/`，默认不提交（`.gitignore` 已排除）。
