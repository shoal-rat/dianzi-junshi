# 安装指南

## 前置要求

- [Claude Code](https://claude.ai/code) — 技能运行环境
- Python 3.8+（可选，用于聊天记录解析和档案管理工具）

## 安装步骤

### 1. 克隆项目

```bash
git clone https://github.com/shoal-rat/reply-skill.git
cd reply-skill
```

### 2. 安装 Python 依赖（可选）

如果你需要使用聊天记录导入功能：

```bash
pip install -r requirements.txt
```

### 3. 在 Claude Code 中注册

打开 Claude Code，将 `reply-skill` 目录设置为工作目录，然后运行：

```
/reply-love
```

系统会自动识别 `SKILL.md` 并启动引导流程。

## 档案存储

档案数据默认存储在项目根目录下的 `partners/` 文件夹中。

该目录已被 `.gitignore` 排除，不会被意外提交到 git。

## 工具使用

### 聊天记录解析

```bash
python tools/wechat_parser.py --help
```

### 档案管理

```bash
python tools/profile_manager.py --help
```

### 对话记录

```bash
python tools/session_log.py --help
```
