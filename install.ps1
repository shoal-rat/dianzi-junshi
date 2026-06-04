# 电子军师 · 一键安装（Windows / PowerShell）
# 用法： irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/shoal-rat/dianzi-junshi.git'

$targets = @()
if (Test-Path "$HOME\.claude") { $targets += "$HOME\.claude\skills\dianzi-junshi" }
if (Test-Path "$HOME\.agents") { $targets += "$HOME\.agents\skills\dianzi-junshi" }
if ($targets.Count -eq 0) { $targets += "$HOME\.claude\skills\dianzi-junshi" }

foreach ($t in $targets) {
  New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null
  if (Test-Path "$t\.git") {
    Write-Host "更新 $t"
    git -C $t pull --ff-only
  } else {
    Write-Host "安装到 $t"
    git clone $repo $t
  }
}

Write-Host ""
Write-Host "装好了！接下来三步："
Write-Host "  1. 打开 Claude Code（或 Codex）；要是它本来就开着，先关掉再打开（新技能要重启才认）。"
Write-Host "  2. 进去说一句：帮我追个人"
Write-Host "  3. 回答几个小问题，然后把微信截图丢给它就行。"
