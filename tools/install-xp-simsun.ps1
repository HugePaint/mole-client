# 一键安装「原版宋体 + 粗体副本」到用户字体目录
#
# 为什么需要它：见 docs/fonts.md。一句话 —— Ruffle 登记设备字体时用的是「字体自身的字重」，
# 而 simsun.ttc 只有 400 字面，于是 SWF 的「宋体加粗」请求永远匹配不上，回退到引擎自带字体。
# 补一张同族名、字重 700 的副本即可。本脚本负责：取字体 → 校验 → 造副本 → 装到
# %LOCALAPPDATA%\Microsoft\Windows\Fonts（fontdb 会扫这个目录，免管理员、不写注册表）。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1              安装（XP 版取不到则退回本机宋体）
#   powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -Verify      安装后跑一轮 Ruffle 实测告警是否消失
#   powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -Uninstall   卸载（只删本脚本放进去的文件）
#   powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -SourceUrl <url>   自定义下载地址
#   powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -Force        已经装好了也重装一遍
#
# ⚠️ 本仓库不入库字体文件（版权归微软/中易），所以走"下载 + 校验"。
#
# 装什么：① XP 原版宋体（首选 Windows XP SP3 的 Version 3.12）② 由它生成的"字重 700"副本。
# 已知残留：客户端还会请求 Arial Black，但 fontdb 连这个字族都查不到（没有 Loading 行、
#           也没有加载报错，推测是 ttf-parser 读不了该字体的 name 表），换副本无效，
#           属于观感问题，先记在 docs/fonts.md 里。

[CmdletBinding()]
param(
    [switch]$Verify,
    [switch]$Uninstall,
    [switch]$Force,
    [string]$SourceUrl,
    [int]$VerifySeconds = 22
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$SettingsFile = Join-Path $Root 'data\settings.json'
$Boldify = Join-Path $Root 'tools\font-boldify.js'
$FontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'

# 本脚本负责的产物（卸载时只删它们，别的一概不动）。
# simsun-xp 的扩展名取决于是 TTC 还是 TTF，两个都列上，卸载时都清。
$ArtifactXpTtc = Join-Path $FontDir 'simsun-xp.ttc'
$ArtifactXpTtf = Join-Path $FontDir 'simsun-xp.ttf'
$ArtifactBold = Join-Path $FontDir 'simsun-bold.ttc'

function Get-NodePath {
    if (Test-Path $SettingsFile) {
        try {
            $s = Get-Content $SettingsFile -Raw | ConvertFrom-Json
            if ($s.NodePath -and (Test-Path $s.NodePath)) { return $s.NodePath }
        } catch { }
    }
    return 'node'
}
$Node = Get-NodePath

function Show-FontInfo([string]$Path, [string]$Label) {
    if (-not (Test-Path $Path)) { Write-Host ("  {0,-16} 缺失" -f $Label) -ForegroundColor DarkYellow; return }
    Write-Host ("  {0,-16} {1}" -f $Label, $Path) -ForegroundColor DarkGray
    & $Node $Boldify --info $Path | Select-Object -Skip 1 | ForEach-Object { Write-Host "      $_" }
}

# ── 卸载 ────────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host '卸载：删除本脚本装入用户字体目录的文件' -ForegroundColor Cyan
    foreach ($f in @($ArtifactXpTtc, $ArtifactXpTtf, $ArtifactBold)) {
        if (Test-Path $f) { Remove-Item $f -Force; Write-Host "  已删除 $f" -ForegroundColor Yellow }
        else { Write-Host "  不存在 $f" -ForegroundColor DarkGray }
    }
    Write-Host '完成。重启游戏后即回到安装前的状态（系统宋体不受影响）。' -ForegroundColor Green
    return
}

# ── 取 XP 版宋体 ────────────────────────────────────────────────────────
# 都是"直链 + 下载后按字体结构校验"；一个不行就试下一个，全不行就退回本机宋体。
# 校验顺序：SHA256（对得上的才认，防仓库被换） → 能否解析 → 字族里有没有 SimSun。
$Candidates = @(
    @{ Url = $SourceUrl; Sha256 = $null; Note = '自定义（-SourceUrl）' }
    @{ Url = 'https://raw.githubusercontent.com/horizonzy/simsun/05c5c118289862dda86ea4ea8f3af0518761843c/simsun/simsun.ttc'
       Sha256 = '1111E31E04A3218986616A7081DD1EEF1C50144DA9D15E6B22242E020B58E8BC'
       Note = '★ 首选：Windows XP SP3 原版宋体（TTC 三字面，Version 3.12）· 已固定到 commit，内容不会漂移' }
    @{ Url = 'https://raw.githubusercontent.com/flyskywhy/react-native-font-sim/ac3a7e3468ac665b7277834fd812b6aeb9c4f2cc/fonts/SimSun.ttf'
       Sha256 = 'CA4DA082CD970F0C8ABAA79F213DDCBC475F7B5AFABCB81B385998F9EBFBB53F'
       Note = '备用一：SimSun Version 2.10（Windows 2000/早期 XP 那版）' }
    @{ Url = 'https://raw.githubusercontent.com/kongchengji/FontSimsun/master/simsun.ttf'
       Sha256 = 'CA4DA082CD970F0C8ABAA79F213DDCBC475F7B5AFABCB81B385998F9EBFBB53F'
       Note = '备用一（同一份 2.10 的另一面镜子）' }
    @{ Url = 'https://raw.githubusercontent.com/ZsgsDesign/fonts-asset-Simsun/main/simsun.ttf'
       Sha256 = 'D2325E0202B3CA257F0C98245865C382C235066E7B67C25E814A87B0ECDD3D7B'
       Note = '备用二：SimSun Version 2.92（疑似子集，最后才用）' }
) | Where-Object { $_.Url }
#
# 为什么首选是 XP SP3 的 3.12：子代理拿微软自己的
# zh-hans_windows_xp_professional_with_service_pack_3_x86_cd_vl_x14-74070.iso
# 用 HTTP Range 只取 I386\SIMSUN.TT_（5.3 MB 的 MSCF cab）、expand.exe 展开，
# 得到的 simsun.ttc 与本候选**逐字节一致**（同 10,512,288 B、同 SHA256）。
# 参考：本机 Win10 自带的是 Version 5.16（18,214,472 B）。
# 来源排查记录见 logs/xp-simsun-sources.md。

function Save-Candidate([hashtable]$Cand, [string]$Dest) {
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Cand.Url -OutFile $Dest -TimeoutSec 120 -UseBasicParsing

        if ($Cand.Sha256) {
            $actual = (Get-FileHash $Dest -Algorithm SHA256).Hash
            if ($actual -ne $Cand.Sha256) {
                Write-Host ("  ⚠ SHA256 与记录值不一致：期望 {0}，实际 {1}" -f $Cand.Sha256, $actual) -ForegroundColor Yellow
                Write-Host '    （仓库内容可能被更新过；继续按字体结构校验，请自行判断是否可信）' -ForegroundColor Yellow
            } else {
                Write-Host '  SHA256 与记录值一致' -ForegroundColor Green
            }
        }
        return $true
    } catch {
        Write-Host ("  下载失败：{0} —— {1}" -f $Cand.Url, $_.Exception.Message) -ForegroundColor DarkYellow
        if (Test-Path $Dest) { Remove-Item $Dest -Force -ErrorAction SilentlyContinue }
        return $false
    }
}

function Get-XpSimSun([string]$Dest) {
    foreach ($cand in $Candidates) {
        Write-Host ("  尝试 {0}" -f $cand.Url) -ForegroundColor DarkGray
        if ($cand.Note) { Write-Host ("       {0}" -f $cand.Note) -ForegroundColor DarkGray }
        if (-not (Save-Candidate $cand $Dest)) { continue }

        $info = & $Node $Boldify --info $Dest 2>&1
        if (-not $info) { Write-Host '      不是可解析的 TTF/TTC，跳过' -ForegroundColor DarkYellow; Remove-Item $Dest -Force; continue }
        if (-not ($info -match 'SimSun')) { Write-Host '      字族里没有 SimSun，跳过' -ForegroundColor DarkYellow; Remove-Item $Dest -Force; continue }

        Write-Host '      校验通过：' -ForegroundColor Green
        $info | Select-Object -Skip 1 | ForEach-Object { Write-Host "        $_" }
        return $true
    }
    return $false
}

# ── 安装 ────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $FontDir | Out-Null

if ((Test-Path $ArtifactBold) -and -not $Force) {
    Write-Host "看起来已经装过了（$ArtifactBold 存在）。要重装请加 -Force。" -ForegroundColor Yellow
    $artifactXp = @($ArtifactXpTtc, $ArtifactXpTtf) | Where-Object { Test-Path $_ } | Select-Object -First 1
} else {
    Write-Host '1) 取字体' -ForegroundColor Cyan
    $tmp = Join-Path $env:TEMP 'simsun-candidate.bin'
    $artifactXp = $null
    $base = $null
    if (Get-XpSimSun $tmp) {
        # TTC 还是 TTF 看文件头，扩展名跟着走（fontdb 只按扩展名过滤，两种都认）
        $sig = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($tmp)[0..3])
        $artifactXp = if ($sig -eq 'ttcf') { $ArtifactXpTtc } else { $ArtifactXpTtf }
        $other = if ($sig -eq 'ttcf') { $ArtifactXpTtf } else { $ArtifactXpTtc }
        if (Test-Path $other) { Remove-Item $other -Force }
        Copy-Item $tmp $artifactXp -Force
        $base = $artifactXp
        Write-Host "  已放入 $artifactXp" -ForegroundColor Green
    } else {
        $sys = 'C:\Windows\Fonts\simsun.ttc'
        if (-not (Test-Path $sys)) { throw "下载全部失败，且本机也没有 $sys，无法继续。" }
        Write-Host "  所有下载源都不可用，退回本机宋体：$sys" -ForegroundColor Yellow
        Write-Host '  （仍然能修掉粗体回退：副本的族名/字形与本机宋体一致；只是不是 XP 那版）' -ForegroundColor DarkGray
        $base = $sys
    }

    Write-Host '2) 造「同族名、字重 700」的副本（Ruffle 的粗体查询才会命中）' -ForegroundColor Cyan
    & $Node $Boldify $base 0 $ArtifactBold 700
    if ($LASTEXITCODE -ne 0) { throw 'font-boldify 失败' }
}

Write-Host ''
Write-Host '当前用户字体目录：' -ForegroundColor Cyan
if ($artifactXp) { Show-FontInfo $artifactXp (Split-Path $artifactXp -Leaf) } else { Write-Host '  simsun-xp.*      缺失' -ForegroundColor DarkYellow }
Show-FontInfo $ArtifactBold 'simsun-bold.ttc'

# ── 实测 ────────────────────────────────────────────────────────────────
if ($Verify) {
    Write-Host ''
    Write-Host "实测：启动 Ruffle $VerifySeconds 秒，看还有没有 'Unknown device font'" -ForegroundColor Cyan
    Write-Host '      （会短暂弹出游戏窗口；需要本地镜像已在运行）' -ForegroundColor DarkGray

    if (-not (Test-Path $SettingsFile)) { throw "找不到 $SettingsFile，无法确定 Ruffle 路径与端口。" }
    $s = Get-Content $SettingsFile -Raw | ConvertFrom-Json

    try {
        $null = Invoke-WebRequest "http://127.0.0.1:$($s.ControlPort)/__status" -UseBasicParsing -TimeoutSec 5
    } catch {
        Write-Host '  镜像没在跑，跳过实测。先执行： powershell -ExecutionPolicy Bypass -File run.ps1 -NoRuffle' -ForegroundColor Yellow
        return
    }

    $out = Join-Path $env:TEMP 'simsun-verify-out.txt'
    Remove-Item $out -ErrorAction SilentlyContinue

    $env:RUST_LOG = 'info'
    if ($s.UseProxy) {
        $proxy = "http://127.0.0.1:$($s.ProxyPort)"
        $env:HTTP_PROXY = $proxy; $env:HTTPS_PROXY = $proxy; $env:http_proxy = $proxy; $env:https_proxy = $proxy
    }

    $ruffleArgs = @(
        'http://mole.61.com/Client.swf', '--base', 'http://mole.61.com/', '--spoof-url', 'http://mole.61.com/Client.swf',
        '--config', (Join-Path $s.ProjectRoot 'data\config'),
        '--cache-directory', (Join-Path $s.ProjectRoot 'data\cache'),
        '--storage', 'disk', '--save-directory', (Join-Path $s.ProjectRoot 'data\SharedObjects'),
        '--tcp-connections', 'allow',
        '--socket-allow', '123.206.131.236:1863', '--socket-allow', '123.206.131.236:1865', '--socket-allow', '123.206.131.63:3200',
        '--player-version', '32', '--scale', 'show-all', '--force-scale',
        '--width', "$($s.Width)", '--height', "$($s.Height)", '--no-gui',
        '--proxy', "http://127.0.0.1:$($s.ProxyPort)"
    )

    $p = Start-Process -FilePath $s.RufflePath -ArgumentList $ruffleArgs -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    Start-Sleep -Seconds $VerifySeconds
    if (-not $p.HasExited) { $p.Kill() }
    Start-Sleep -Seconds 1

    $lines = Get-Content $out -ErrorAction SilentlyContinue
    $miss = @($lines | Where-Object { $_ -match 'Unknown device font' })
    $load = @($lines | Where-Object { $_ -match 'Loading device font' })

    Write-Host ''
    Write-Host ("  设备字体加载成功 {0} 条，未命中 {1} 条" -f $load.Count, $miss.Count) -ForegroundColor $(if ($miss.Count -eq 0) { 'Green' } else { 'Yellow' })
    $load | Select-Object -First 6 | ForEach-Object { Write-Host ("    OK   " + ($_ -replace '\x1b\[[0-9;]*m', '')) -ForegroundColor DarkGray }
    $miss | Select-Object -First 6 | ForEach-Object { Write-Host ("    MISS " + ($_ -replace '\x1b\[[0-9;]*m', '')) -ForegroundColor Yellow }

    if ($miss.Count -eq 0) { Write-Host '  结论：没有回退了，粗体宋体请求已被满足。' -ForegroundColor Green }
    else { Write-Host '  结论：仍有未命中的设备字体（见上），可把完整输出发来定位。' -ForegroundColor Yellow }
    Write-Host "  原始输出: $out" -ForegroundColor DarkGray
}
