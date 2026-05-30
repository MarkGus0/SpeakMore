$ErrorActionPreference = 'Stop'

function Fail($message) {
  Write-Error $message
  exit 1
}

$trackedFiles = git ls-files

$forbiddenTracked = $trackedFiles | Where-Object {
  $_ -match '^(docs/ai/context/|app-extracted/)' -or
  ($_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '(^|/)\.env\.example$') -or
  $_ -match '(^|/)\.tmp-' -or
  $_ -match '\.(log|err|pid)$' -or
  $_ -match '(^|/)(Local Storage|local-data|recordings)(/|$)'
}

if ($forbiddenTracked) {
  $forbiddenTracked | ForEach-Object { Write-Host "forbidden tracked file: $_" }
  Fail '公开仓库包含不应跟踪的内部上下文、本地数据、日志或密钥文件'
}

$secretPattern = '(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|aws_secret_access_key)'
$secretMatches = git grep -n -I -E $secretPattern -- . ':(exclude)scripts/verify-open-source.ps1' ':(exclude)scripts/verify-portable-win.ps1' 2>$null
if ($LASTEXITCODE -eq 0 -and $secretMatches) {
  $secretMatches | ForEach-Object { Write-Host $_ }
  Fail '公开仓库命中疑似真实密钥'
}

$personalPathMatches = git grep -n -I -E 'C:/Users/yui|C:\\Users\\yui|D:\\CodeWorkSpace\\typeless|D:/CodeWorkSpace/typeless|com\.pais\.handy|app-extracted' -- . ':(exclude).gitignore' ':(exclude)scripts/verify-open-source.ps1' ':(exclude)scripts/verify-portable-win.ps1' 2>$null
if ($LASTEXITCODE -eq 0 -and $personalPathMatches) {
  $personalPathMatches | ForEach-Object { Write-Host $_ }
  Fail '公开仓库命中个人路径、逆向来源或本机路径'
}

Write-Host 'open-source verification passed'
