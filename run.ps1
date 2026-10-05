# 摩尔庄园本地客户端 · 启动脚本
#
# 用法:
#   .\run.ps1                 在线模式启动（缺什么资源自动回源并落盘）
#   .\run.ps1 -Offline        离线模式启动（一个字节都不上网，验证本地化完整性）
#   .\run.ps1 -NoRuffle       只起 molemirror，不开游戏窗口
#   .\run.ps1 -Status         只查看现场：启动器/镜像/Ruffle 进程与端口，以及陈旧的 pid 文件
#   .\run.ps1 -Stop           停止 molemirror（在线+离线两套）与 Ruffle
#
# 依赖: node（v14+）、runtime\ruffle\ruffle.exe

[CmdletBinding()]
param(
    [switch]$Offline,
    [switch]$NoRuffle,
    [switch]$Stop,
    [switch]$Status,
    [int]$Width = 1000,
    [int]$Height = 620
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$DataDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null

# 在线与离线是两套端口：离线实例用 8888/8998/8999（实测残留进程的监听端口）。
# 以前只按在线端口清理，导致离线实例（曾实测残留 20 小时）永远停不掉。
$OnlinePorts = @(8899, 8898, 8080)
$OfflinePorts = @(8999, 8998, 8888)

function Get-Listener([int[]]$Ports) {
    foreach ($port in $Ports) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { [pscustomobject]@{ Port = $port; Pid = $_.OwningProcess } }
    }
}

function Show-Status {
    Write-Host '── 现场 ─────────────────────────────────────────────' -ForegroundColor Cyan
    foreach ($f in @('launcher.pid', 'molemirror.pid', 'molemirror-offline.pid', 'ruffle.pid')) {
        $path = Join-Path $LogDir $f
        if (-not (Test-Path $path)) { Write-Host ("  {0,-24} 无" -f $f); continue }
        $procId = (Get-Content $path -ErrorAction SilentlyContinue | Select-Object -First 1)
        $proc = if ($procId) { Get-Process -Id $procId -ErrorAction SilentlyContinue } else { $null }
        if ($proc) { Write-Host ("  {0,-24} PID {1}  {2}  (存活)" -f $f, $procId, $proc.ProcessName) -ForegroundColor Green }
        else { Write-Host ("  {0,-24} PID {1}  (已退出，pid 文件陈旧)" -f $f, $procId) -ForegroundColor DarkYellow }
    }
    foreach ($set in @(@('在线', $OnlinePorts), @('离线', $OfflinePorts))) {
        foreach ($l in Get-Listener $set[1]) {
            $proc = Get-Process -Id $l.Pid -ErrorAction SilentlyContinue
            Write-Host ("  {0}端口 {1,-5} PID {2}  {3}" -f $set[0], $l.Port, $l.Pid, $proc.ProcessName)
        }
    }
    $ruffles = @(Get-Process ruffle -ErrorAction SilentlyContinue)
    Write-Host ("  ruffle 进程数            {0}" -f $ruffles.Count)
    Write-Host '─────────────────────────────────────────────────────' -ForegroundColor Cyan
}

function Stop-All {
    $stopped = @()

    foreach ($l in Get-Listener ($OnlinePorts + $OfflinePorts)) {
        $proc = Get-Process -Id $l.Pid -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        # 只杀本项目的 node 镜像，避免端口被别人占用时误伤
        if ($proc.ProcessName -ne 'node') {
            Write-Host ("  端口 {0} 被 {1}(PID {2}) 占用，不是 node，跳过" -f $l.Port, $proc.ProcessName, $l.Pid) -ForegroundColor DarkYellow
            continue
        }
        Stop-Process -Id $l.Pid -Force -ErrorAction SilentlyContinue
        $stopped += "molemirror(:$($l.Port) PID $($l.Pid))"
    }

    foreach ($p in @(Get-Process ruffle -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        $stopped += "ruffle(PID $($p.Id))"
    }

    # pid 文件只是 run.ps1 自己写的运行期状态，进程没了就删掉，避免下次误判
    foreach ($f in @('molemirror.pid', 'molemirror-offline.pid', 'ruffle.pid')) {
        $path = Join-Path $LogDir $f
        if (Test-Path $path) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
    }

    if ($stopped.Count) { Write-Host ('已停止: ' + ($stopped -join ', ')) -ForegroundColor Yellow }
    else { Write-Host '没有发现需要停止的 molemirror / Ruffle。' -ForegroundColor Yellow }
}

if ($Status) { Show-Status; return }
if ($Stop) { Stop-All; return }

Stop-All
Start-Sleep -Seconds 1

# ── 1) 启动 molemirror ──────────────────────────────────────────────
$mirrorArgs = @('index.js')
if ($Offline) { $mirrorArgs += '--offline' }
$mirror = Start-Process -FilePath 'node' -ArgumentList $mirrorArgs `
    -WorkingDirectory (Join-Path $Root 'molemirror') -WindowStyle Hidden -PassThru
$mirror.Id | Set-Content (Join-Path $LogDir 'molemirror.pid')
Start-Sleep -Seconds 3

$mode = if ($Offline) { '离线' } else { '在线' }
try {
    $st = (Invoke-WebRequest 'http://127.0.0.1:8898/__status' -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    Write-Host ("molemirror 已启动 (PID {0}) 模式={1}  已缓存 {2} 个 / {3:N2} MB" -f `
        $mirror.Id, $mode, $st.cachedEntries, ($st.cachedBytes / 1MB)) -ForegroundColor Green
} catch {
    Write-Host 'molemirror 启动失败，请检查 8899/8898 端口是否被占用。' -ForegroundColor Red
    throw
}

if ($NoRuffle) { return }

# ── 2) 启动 Ruffle ──────────────────────────────────────────────────
$env:HTTP_PROXY = 'http://127.0.0.1:8899'
$env:HTTPS_PROXY = 'http://127.0.0.1:8899'
$env:http_proxy = 'http://127.0.0.1:8899'
$env:https_proxy = 'http://127.0.0.1:8899'
if (-not $env:RUST_LOG) { $env:RUST_LOG = 'ruffle_core=info,ruffle_desktop=warn,wgpu=error' }

$ruffle = Join-Path $Root 'runtime\ruffle\ruffle.exe'
if (-not (Test-Path $ruffle)) {
    Write-Host "找不到 Ruffle: $ruffle" -ForegroundColor Red
    Write-Host '请从 https://ruffle.rs/downloads 下载 Windows x64 版并解压到 runtime\ruffle\' -ForegroundColor Yellow
    return
}

$ruffleArgs = @(
    'http://mole.61.com/Client.swf',
    '--base',            'http://mole.61.com/',
    '--spoof-url',       'http://mole.61.com/Client.swf',
    '--proxy',           'http://127.0.0.1:8899',
    # 必须显式指定：默认的 %LOCALAPPDATA%\ruffle 创建会被拒（os error 5），Ruffle 会静默退出
    '--config',          (Join-Path $DataDir 'config'),
    '--cache-directory', (Join-Path $DataDir 'cache'),
    '--storage', 'disk', '--save-directory', (Join-Path $DataDir 'SharedObjects'),
    '--tcp-connections', 'allow',
    '--socket-allow', '123.206.131.236:1863',
    '--socket-allow', '123.206.131.236:1865',
    '--socket-allow', '123.206.131.63:3200',
    '--player-version', '32',
    '--scale', 'show-all', '--force-scale',
    '--width', $Width, '--height', $Height,
    '--no-gui'
)

Write-Host '启动 Ruffle ...' -ForegroundColor Green
$proc = Start-Process -FilePath $ruffle -ArgumentList $ruffleArgs -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir 'ruffle_out.txt') `
    -RedirectStandardError  (Join-Path $LogDir 'ruffle_err.txt')
$proc.Id | Set-Content (Join-Path $LogDir 'ruffle.pid')
Write-Host ("Ruffle PID {0}  日志: logs\ruffle_out.txt" -f $proc.Id) -ForegroundColor Green
Write-Host '停止: .\run.ps1 -Stop' -ForegroundColor DarkGray
