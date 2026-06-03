# 安装指南

## 前置要求

- Claude Code、Codex 或 ChatGPT
- Python 3.8+（可选，用于聊天记录解析、档案管理和 ChatGPT 知识包生成）

本项目工具只使用 Python 标准库，`requirements.txt` 保留为空依赖说明。

## 克隆项目

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git
cd dianzi-junshi
```

## Claude Code

在 Claude Code 中打开项目目录，运行：

```text
/junshi
```

按引导建立对象档案。首次建档时可以选择是否开启反舔狗模式。

如果资料很多，可以直接给文件夹路径：

```text
/import-folder C:\Users\你\Desktop\ta资料
```

## Codex

Codex 会扫描 `.agents/skills` 和用户级 skills 目录。推荐：

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME\.agents\skills\dianzi-junshi"
```

重启 Codex 后调用：

```text
Use $dianzi-junshi to analyze this message and draft three replies.
```

更多说明见 [platforms/codex.md](platforms/codex.md)。

## ChatGPT

使用方式见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)。

如果创建自定义 GPT，建议先生成单文件知识包：

```bash
python tools/build_chatgpt_pack.py
```

然后上传 `dist/dianzi-junshi-chatgpt-pack.md` 到 GPT knowledge。

ChatGPT 默认不能直接读取你的本地文件夹路径；请上传图片、文本或压缩包。Claude Code/Codex 更适合直接使用 `/import-folder [路径]`。

## 本地数据

对象档案默认存储在项目根目录下的 `partners/`。

该目录已被 `.gitignore` 排除，不会被默认提交。真实聊天记录建议先匿名化。

## 工具命令

### 聊天记录解析

```bash
python tools/wechat_parser.py --help
```

### 文件夹自动分类

```bash
python tools/import_folder.py --help
```

### 档案管理

```bash
python tools/profile_manager.py --help
```

### 对话记录和统计

```bash
python tools/session_log.py --help
```

### 项目自检

```bash
python tools/skill_check.py
```
