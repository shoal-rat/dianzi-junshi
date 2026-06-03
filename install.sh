#!/usr/bin/env bash
# 电子军师 · 一键安装（macOS / Linux）
# 用法： curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash

set -euo pipefail
repo="https://github.com/shoal-rat/dianzi-junshi.git"

targets=()
[ -d "$HOME/.claude" ] && targets+=("$HOME/.claude/skills/dianzi-junshi")
[ -d "$HOME/.agents" ] && targets+=("$HOME/.agents/skills/dianzi-junshi")
[ "${#targets[@]}" -eq 0 ] && targets+=("$HOME/.claude/skills/dianzi-junshi")

for t in "${targets[@]}"; do
  mkdir -p "$(dirname "$t")"
  if [ -d "$t/.git" ]; then
    echo "更新 $t"
    git -C "$t" pull --ff-only
  else
    echo "安装到 $t"
    git clone "$repo" "$t"
  fi
done

echo
echo "装好了。打开 Claude Code 或 Codex，说一句：帮我追个人。"
echo "它会问你几个小问题，然后你把微信截图丢给它就行。"
