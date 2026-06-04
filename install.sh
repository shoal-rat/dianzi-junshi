#!/usr/bin/env bash
# 电子军师 · Claude Code 一键安装（装成技能 / Skill，macOS / Linux）
# 用法： curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
# 用 Codex 的看 platforms/codex.md。

set -euo pipefail
repo="https://github.com/shoal-rat/dianzi-junshi.git"
target="$HOME/.claude/skills/dianzi-junshi"

mkdir -p "$(dirname "$target")"
if [ -d "$target/.git" ]; then
  echo "更新 $target"
  git -C "$target" pull --ff-only
else
  echo "把电子军师装成 Claude Code 技能：$target"
  git clone "$repo" "$target"
fi

echo
echo "装好了！接下来三步："
echo "  1. 打开 Claude Code；要是它本来就开着，先关掉再打开（新技能要重启才认）。"
echo "  2. 进去说一句：帮我追个人"
echo "  3. 回答几个小问题，然后把微信截图丢给它就行。"
