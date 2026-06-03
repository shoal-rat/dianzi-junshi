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
Write-Host "装好了。打开 Claude Code 或 Codex，说一句：帮我追个人。"
Write-Host "它会问你几个小问题，然后你把微信截图丢给它就行。"
