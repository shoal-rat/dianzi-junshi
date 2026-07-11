param([Parameter(Mandatory=$true)][string]$File)

$thumbprint = $env:WINDOWS_CERTIFICATE_THUMBPRINT
if ([string]::IsNullOrWhiteSpace($thumbprint)) {
  Write-Warning "WINDOWS_CERTIFICATE_THUMBPRINT is not configured; leaving $File unsigned."
  exit 0
}

$timestamp = if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
  "http://timestamp.digicert.com"
} else {
  $env:WINDOWS_TIMESTAMP_URL
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw "signtool.exe is unavailable on this Windows runner"
}

& $signtool.Source sign /sha1 $thumbprint /fd SHA256 /tr $timestamp /td SHA256 $File
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $signtool.Source verify /pa /v $File
exit $LASTEXITCODE
