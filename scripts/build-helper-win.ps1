$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $root 'electron-app\windows-text-observer\WindowsTextObserver.csproj'
$publishDir = Join-Path $root 'release-artifacts\helper'
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
$localDotnet = Join-Path $root '.tmp-dotnet\dotnet.exe'
if (!$dotnet -and (Test-Path $localDotnet)) {
  $dotnet = @{ Source = $localDotnet }
}

if (!$dotnet) {
  throw '未找到 dotnet CLI，请先安装 .NET 8 SDK 或把 dotnet 加入 PATH'
}

if (Test-Path $publishDir) {
  Remove-Item -LiteralPath $publishDir -Recurse -Force
}

& $dotnet.Source publish $project -c Release -r win-x64 --self-contained true -o $publishDir /p:PublishSingleFile=true

$exePath = Join-Path $publishDir 'WindowsTextObserver.exe'
if (!(Test-Path $exePath)) {
  throw "helper exe 构建失败: $exePath"
}

Write-Host "helper built: $exePath"
