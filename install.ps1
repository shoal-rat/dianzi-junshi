# 电子军师 · Claude Code 一键安装（装成技能 / Skill，Windows / PowerShell）
# 用法： irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
# 用 Codex 的看 platforms/codex.md。

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/shoal-rat/dianzi-junshi.git'
$target = "$HOME\.claude\skills\dianzi-junshi"

New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
if (Test-Path "$target\.git") {
  Write-Host "更新 $target"
  git -C $target pull --ff-only
} else {
  Write-Host "把电子军师装成 Claude Code 技能：$target"
  git clone $repo $target
}

Write-Host ""
Write-Host "装好了！接下来三步："
Write-Host "  1. 打开 Claude Code；要是它本来就开着，先关掉再打开（新技能要重启才认）。"
Write-Host "  2. 进去说一句：帮我追个人"
Write-Host "  3. 回答几个小问题，然后把微信截图丢给它就行。"
