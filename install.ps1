# Download and run the latest Windows desktop installer from the official GitHub Release.
$ErrorActionPreference = 'Stop'
$release = Invoke-RestMethod -Headers @{ Accept = 'application/vnd.github+json' } -Uri 'https://api.github.com/repos/shoal-rat/dianzi-junshi/releases/latest'
$asset = $release.assets | Where-Object { $_.name -match '(?i)(setup.*\.exe$|\.exe$)' } | Select-Object -First 1
if (-not $asset) { throw '最新 Release 里还没有 Windows 安装程序。' }

$target = Join-Path $env:TEMP 'dianzi-junshi-setup.exe'
Write-Host "正在下载 $($asset.name)…"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target
Write-Host '下载完成，正在打开安装程序。'
Start-Process -FilePath $target -Wait
Write-Host '安装完成后，可以从开始菜单打开「电子军师」。'
