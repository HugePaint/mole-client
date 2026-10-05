# 构建并打包启动器
#
# 用法:
#   .\build-launcher.ps1              框架依赖发布（体积小，目标机需装 .NET 7 桌面运行时）
#   .\build-launcher.ps1 -SelfContained   自包含发布（体积大，目标机无需装任何运行时）
#   .\build-launcher.ps1 -Zip             发布后额外打 zip

[CmdletBinding()]
param(
    [switch]$SelfContained,
    [switch]$Zip,
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot          # 项目根（launcher 的上一级）
$Proj = Join-Path $PSScriptRoot 'MoleLauncher\MoleLauncher.csproj'
$OutBase = Join-Path $PSScriptRoot 'publish'

if (-not (Test-Path $Proj)) { throw "找不到项目文件: $Proj" }

# 发布前必须确保没有实例在运行：正在运行的 exe 被占用，dotnet publish 会失败，
# 而它的报错只说"发布失败"，不给原因 —— 这个坑值得在这里直接挡掉。
$running = Get-Process -Name 'MoleLauncher' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host ("检测到 {0} 个正在运行的启动器，先结束它们（否则 exe 被占用无法发布）…" -f $running.Count) -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# 注意：不能用 $args —— 它是 PowerShell 的自动变量且只读
$pubArgs = @(
    'publish', $Proj,
    '-c', $Configuration,
    '-r', 'win-x64',
    '-o', $OutBase
)

if ($SelfContained) {
    $pubArgs += @('--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true')
    Write-Host '模式: 自包含单文件（目标机无需 .NET 运行时）' -ForegroundColor Cyan
} else {
    $pubArgs += @('--self-contained', 'false')
    Write-Host '模式: 框架依赖（目标机需 .NET 7 桌面运行时）' -ForegroundColor Cyan
}

Write-Host '正在发布…' -ForegroundColor Green
& dotnet @pubArgs
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish 失败 (exit $LASTEXITCODE)。常见原因：publish 目录下的文件被占用（比如启动器还在跑、或资源管理器打开着该目录）。"
}

Write-Host ''
Write-Host '产物:' -ForegroundColor Green
Get-ChildItem $OutBase -File | Sort-Object Length -Descending |
    Select-Object -First 10 @{n='KB'; e={[math]::Round($_.Length / 1KB, 0)}}, Name |
    Format-Table -AutoSize

# 顺带放一个便捷启动脚本到发布目录
$bat = Join-Path $OutBase '启动摩尔庄园.bat'
@"
@echo off
rem 摩尔庄园本地客户端 —— 启动器
rem 启动器会自动探测项目根目录；若探测不到，请在「设置」里手动指定。
start "" "%~dp0MoleLauncher.exe"
"@ | Set-Content -Path $bat -Encoding OEM

if ($Zip) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    $zip = Join-Path $PSScriptRoot "MoleLauncher-$stamp.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $OutBase '*') -DestinationPath $zip
    Write-Host "已打包: $zip" -ForegroundColor Green
}

Write-Host ''
Write-Host "提示: 启动器会向上查找含 molemirror\index.js 的目录作为项目根。" -ForegroundColor DarkGray
Write-Host "      若把发布目录挪到别处，请在设置里手动指定项目根目录。" -ForegroundColor DarkGray
