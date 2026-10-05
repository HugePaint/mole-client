# 摩尔庄园本地客户端 —— 安装程序
#
# 由 MoleClient-Setup.exe（7-Zip 自解压包）调用，也可直接手工运行。
#
# 用法:
#   .\install.ps1                          安装到 %USERPROFILE%\MoleClient
#   .\install.ps1 -TargetDir D:\MoleClient 指定安装目录
#   .\install.ps1 -NoRuffle                不安装随包的 Ruffle（首次运行时用启动器下载）
#   .\install.ps1 -NoShortcuts             不创建快捷方式
#   .\install.ps1 -SkipFonts               不安装原版宋体（见 docs/fonts.md）
#
# 无人值守（供自解压包与自动化测试使用）:
#   设置环境变量 MOLE_SETUP_QUIET / MOLE_SETUP_TARGET / MOLE_SETUP_NOSHORTCUTS /
#   MOLE_SETUP_NORUFFLE / MOLE_SETUP_NOFONTS 即可，它们作为对应参数的默认值。
#   由环境变量而不是命令行传入，是为了让 install.cmd 完全不必处理引号转义。
#
# 设计要点:
#   * 安装布局刻意做成「启动器在根、molemirror 在子目录」——
#     启动器的 PathResolver 会从 exe 所在目录向上查找含 molemirror\index.js 的目录，
#     因此这个布局能让它开箱即用、无需手工配置路径。
#   * **不包含 cache\**（已近 1 GB 的游戏资源）。资源由 molemirror 在首次运行时按需抓取并落盘，
#     这也正是「资源本地化」的正常工作方式。
#   * 原版宋体是**安装期可选步骤**（tools\install-xp-simsun.ps1）：
#     下载 XP 版 simsun.ttc → 校验 → 生成粗体副本 → 装进用户字体目录。
#     不成功不影响安装（字体只影响字形观感，不影响能不能玩），失败原因会打出来。

[CmdletBinding()]
param(
    [string]$TargetDir = "",
    [switch]$NoRuffle,
    [switch]$NoShortcuts,
    [switch]$SkipFonts,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# ── 无人值守：环境变量作为参数默认值 ────────────────────────
if ([string]::IsNullOrWhiteSpace($TargetDir) -and $env:MOLE_SETUP_TARGET) {
    $TargetDir = $env:MOLE_SETUP_TARGET
}
if ($env:MOLE_SETUP_QUIET) { $Quiet = $true }
if ($env:MOLE_SETUP_NOSHORTCUTS) { $NoShortcuts = $true }
if ($env:MOLE_SETUP_NORUFFLE) { $NoRuffle = $true }
if ($env:MOLE_SETUP_NOFONTS) { $SkipFonts = $true }

function Say([string]$msg, [string]$color = 'Gray') {
    if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

$Payload = $PSScriptRoot
Say ""
Say "=== 摩尔庄园本地客户端 · 安装程序 ===" Cyan
Say ""

# ── 1) 确定安装目录 ────────────────────────────────────────
# 显式指定（参数或 MOLE_SETUP_TARGET）时就用它，不可写就明确报错，不做替换。
# 未指定时依次尝试若干候选位置，用第一个**真正可写**的。
#
# 为什么需要这套回退：本机实测这个未签名的自编译二进制**写不了用户 profile**
# （%USERPROFILE% 与 %TEMP% 下的新建都会 Access denied，而 PowerShell / cmd / node
# 这些受信任程序写同一路径却完全正常）。若把 %USERPROFILE%\MoleClient 写死成默认值，
# 安装会直接失败。回退到「安装包所在目录」是可行的（引导器本来就把 payload 解压在那里）。
function Test-Writable([string]$dir) {
    try {
        New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null
        $probe = Join-Path $dir '.write-test'
        Set-Content -Path $probe -Value 'x' -ErrorAction Stop
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

$explicit = -not [string]::IsNullOrWhiteSpace($TargetDir)

if ($explicit) {
    $TargetDir = [System.IO.Path]::GetFullPath($TargetDir)
    if (-not (Test-Writable $TargetDir)) {
        throw "安装目录不可写：$TargetDir`n（`$TargetDir 是你显式指定的，安装器不会擅自改到别处；请换一个可写目录）"
    }
} else {
    $candidates = New-Object System.Collections.Generic.List[string]

    # 1. 标准位置（多数机器上可用）
    if ($env:USERPROFILE) { $candidates.Add((Join-Path $env:USERPROFILE 'MoleClient')) }
    # 2. 安装包所在目录下（便携式；引导器已在那里成功解压过，通常可写）
    if ($env:MOLE_SETUP_SRCDIR) { $candidates.Add((Join-Path $env:MOLE_SETUP_SRCDIR 'MoleClient')) }
    # 3. 用户级程序目录
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\MoleClient')) }
    # 4. 当前工作目录下
    $candidates.Add((Join-Path (Get-Location).Path 'MoleClient'))

    $chosen = $null
    foreach ($c in $candidates) {
        $full = [System.IO.Path]::GetFullPath($c)
        if (Test-Writable $full) { $chosen = $full; break }
        Say ("  候选位置不可写，跳过：{0}" -f $full) DarkYellow
    }

    if (-not $chosen) {
        throw ("找不到可写的安装位置。已尝试：`n  " + ($candidates -join "`n  ") +
               "`n`n请用 -TargetDir 指定一个可写目录，例如：`n  .\install.ps1 -TargetDir D:\MoleClient")
    }
    $TargetDir = $chosen
    if ($TargetDir -ne [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'MoleClient'))) {
        Say "（默认位置不可写，已自动改用：$TargetDir）" DarkYellow
    }
}

# 不能装到自解压包的临时目录里
if ($Payload -and $TargetDir.StartsWith($Payload, [StringComparison]::OrdinalIgnoreCase)) {
    throw "安装目录不能位于解压目录内部：$TargetDir"
}

Say "安装到: $TargetDir"

# ── 2) 复制文件 ────────────────────────────────────────────
Say "正在复制文件…"

function Copy-Tree([string]$from, [string]$to, [string[]]$excludeNames) {
    if (-not (Test-Path $from)) { return 0 }
    $count = 0
    $fromFull = (Resolve-Path $from).Path
    Get-ChildItem -Path $from -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($fromFull.Length).TrimStart('\')
        $skip = $false
        foreach ($ex in $excludeNames) {
            if ($rel -like "$ex*" -or $rel -like "*\$ex*") { $skip = $true; break }
        }
        if ($skip) { return }
        $dest = Join-Path $to $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
        Copy-Item $_.FullName $dest -Force
        $count++
    }
    return $count
}

$copied = 0

# 2a) 启动器（根目录）
$launcherCopy = Copy-Tree (Join-Path $Payload 'launcher') $TargetDir @('*.pdb')
$copied += $launcherCopy
Say ("  启动器        {0} 个文件" -f $launcherCopy)

# 2b) 本地镜像
$mirrorCopy = Copy-Tree (Join-Path $Payload 'molemirror') (Join-Path $TargetDir 'molemirror') @()
$copied += $mirrorCopy
Say ("  本地镜像      {0} 个文件" -f $mirrorCopy)

# 2c) Ruffle 运行时（可选）
if (-not $NoRuffle -and (Test-Path (Join-Path $Payload 'runtime'))) {
    $ruffleCopy = Copy-Tree (Join-Path $Payload 'runtime') (Join-Path $TargetDir 'runtime') @()
    $copied += $ruffleCopy
    Say ("  Ruffle 运行时 {0} 个文件" -f $ruffleCopy)
} elseif (-not $NoRuffle) {
    Say "  （未随包提供 Ruffle，首次运行时可用启动器的「下载…」按钮获取）" DarkYellow
}

# 2d) 字体工具（安装期"可选步骤"要用；字体文件本身不入包）
$toolsDst = Join-Path $TargetDir 'tools'
$toolsCopy = Copy-Tree (Join-Path $Payload 'tools') $toolsDst @()
if ($toolsCopy -gt 0) {
    $copied += $toolsCopy
    Say ("  字体工具      {0} 个文件" -f $toolsCopy)
}

# 2e) 说明文档
# payload 里的文件名是 ASCII（iexpress 这个老工具对中文名不友好），
# 装到目标目录时再改成中文名，用户看到的是正常中文。
$readmeSrc = Join-Path $Payload 'README.md'
if (Test-Path $readmeSrc) {
    Copy-Item $readmeSrc (Join-Path $TargetDir '安装说明.md') -Force
    $copied++
    Say "  安装说明      1 个文件"
}

Say ("  合计          {0} 个文件" -f $copied) Green

# ── 3) 运行时目录先建好 ────────────────────────────────────
# 注意 data\config 是 Ruffle 的 --config 目标：默认的 %LOCALAPPDATA%\ruffle
# 在本机实测会创建失败（os error 5），所以必须显式给一个可写目录。
foreach ($d in @('data', 'data\config', 'data\cache', 'data\SharedObjects', 'logs', 'cache')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir $d) | Out-Null
}

# ── 4) 写入卸载程序 ────────────────────────────────────────
$uninstall = Join-Path $TargetDir 'uninstall.ps1'
@'
# 摩尔庄园本地客户端 —— 卸载程序
param([switch]$KeepCache, [switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$Base = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Quiet) {
    Write-Host "正在卸载摩尔庄园本地客户端…" -ForegroundColor Cyan
}

# 先停掉可能还在跑的进程
foreach ($n in @('MoleLauncher', 'ruffle')) {
    Get-Process $n | Stop-Process -Force
}
# 本地镜像：按端口精确结束，避免误杀别的 node
foreach ($port in @(8899, 8898, 8080)) {
    Get-NetTCPConnection -LocalPort $port -State Listen |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
Start-Sleep -Milliseconds 500

# 快捷方式
# ⚠️ 必须用**不会被别人占用**的名字。
# 实测本机桌面与开始菜单已存在 `摩尔庄园.lnk`，指向淘米官方的微端
# （C:\Users\...\Programs\TaomeeMole\摩尔庄园.exe）。若安装器沿用同名，
# 会静默覆盖官方微端的快捷方式，用户点「摩尔庄园」开出来的东西就变了。
$lnks = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) '摩尔庄园本地客户端.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) '摩尔庄园本地客户端.lnk')
)
foreach ($l in $lnks) { Remove-Item $l -Force }

# 顺手卸掉安装期放进用户字体目录的原版宋体（那个脚本只删它自己放进去的文件）
$fontTool = Join-Path $Base 'tools\install-xp-simsun.ps1'
if (Test-Path $fontTool) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $fontTool -Uninstall | Out-Null
}

if ($KeepCache) {
    if (-not $Quiet) { Write-Host "保留 cache 目录（$Base\cache）" -ForegroundColor Yellow }
    Get-ChildItem $Base -Exclude 'cache' | Remove-Item -Recurse -Force
} else {
    Set-Location $env:TEMP
    Remove-Item $Base -Recurse -Force
}

if (-not $Quiet) { Write-Host "卸载完成。" -ForegroundColor Green }
'@ | Set-Content -Path $uninstall -Encoding UTF8

# ── 5) 创建快捷方式 ────────────────────────────────────────
# 名字用「摩尔庄园本地客户端」，与官方微端的「摩尔庄园」区分开。
# 本机实测已存在指向 TaomeeMole 微端的同名快捷方式——沿用同名会静默覆盖别人的东西。
$ShortcutName = '摩尔庄园本地客户端.lnk'
$shortcutFailures = @()

if (-not $NoShortcuts) {
    $exe = Join-Path $TargetDir 'MoleLauncher.exe'
    if (Test-Path $exe) {
        try {
            $shell = New-Object -ComObject WScript.Shell
        } catch {
            $shortcutFailures += "无法创建 WScript.Shell 对象：$($_.Exception.Message)"
            $shell = $null
        }

        if ($shell) {
            $targets = @(
                (Join-Path ([Environment]::GetFolderPath('Desktop')) $ShortcutName),
                (Join-Path ([Environment]::GetFolderPath('Programs')) $ShortcutName)
            )
            $made = 0
            foreach ($lnkPath in $targets) {
                try {
                    $lnk = $shell.CreateShortcut($lnkPath)
                    $lnk.TargetPath = $exe
                    $lnk.WorkingDirectory = $TargetDir
                    $lnk.Description = '摩尔庄园本地客户端（资源本地化，连官方服务器）'
                    $lnk.Save()
                    $made++
                } catch {
                    # 不要把失败吞掉：实测在「由未签名引导器拉起的进程树」里，
                    # 桌面/开始菜单所在的用户目录可能整体不可写，快捷方式创建会失败。
                    # 若这里静默处理，用户会看到「安装完成」却找不到任何入口。
                    $shortcutFailures += "$lnkPath ：$($_.Exception.Message)"
                }
            }
            Say ("已创建 {0} 个快捷方式（名称：{1}）" -f $made, $ShortcutName) Green
        }
    } else {
        $shortcutFailures += "找不到 $exe，跳过快捷方式创建"
    }
}

# 快捷方式失败必须让用户看见——即使处于 -Quiet。
# 这是「安装成功但没有任何入口」这类问题的唯一提示。
if ($shortcutFailures.Count -gt 0) {
    $msg = "注意：有 {0} 处快捷方式未能创建：" -f $shortcutFailures.Count
    Write-Host $msg -ForegroundColor Yellow
    foreach ($f in $shortcutFailures) { Write-Host "  - $f" -ForegroundColor Yellow }
    Write-Host ("  这不影响使用——直接运行 {0}\MoleLauncher.exe 即可。" -f $TargetDir) -ForegroundColor Yellow
}

# ── 6) 可选步骤：原版宋体 ──────────────────────────────────
# 为什么值得做（详见 docs/fonts.md）：Ruffle 登记设备字体时用的是**字体自身的字重**，
# 而 simsun.ttc 只有 400 字面，于是客户端"宋体加粗"的请求永远匹配不上、回退到引擎自带字体
# （字形与原版不一致）。这一步下载 XP 版 simsun.ttc、校验、补一张字重 700 的副本，
# 放进**用户字体目录**（fontdb 会扫那里；免管理员、不写注册表、删文件即可回退）。
#
# 三条铁律：
#   1) 失败绝不能让安装失败 —— 字体只影响观感，不影响能不能玩；
#   2) 支持跳过（-SkipFonts / MOLE_SETUP_NOFONTS），也支持离线（脚本会退回本机宋体）；
#   3) 字体文件不入包（版权属微软/中易），只下载 + SHA256 校验。
$fontResult = '未执行'
$fontTool = Join-Path $TargetDir 'tools\install-xp-simsun.ps1'

if ($SkipFonts) {
    $fontResult = '已跳过（-SkipFonts / MOLE_SETUP_NOFONTS）'
    Say "跳过原版宋体安装（-SkipFonts）" DarkGray
} elseif (-not (Test-Path $fontTool)) {
    $fontResult = '跳过（安装包内没有 tools\install-xp-simsun.ps1）'
    Say "跳过原版宋体安装（包内缺少字体工具）" DarkYellow
} elseif (-not (Get-Command node -ErrorAction SilentlyContinue) -and
          -not (Test-Path (Join-Path $TargetDir 'data\settings.json'))) {
    $fontResult = '跳过（没找到 node，无法生成粗体副本）'
    Say "跳过原版宋体安装（需要 node；装好 Node.js 后可手动运行 tools\install-xp-simsun.ps1）" DarkYellow
} else {
    Say "正在安装原版宋体（可选步骤，失败也不影响安装）…"
    try {
        $fontOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fontTool 2>&1
        $fontCode = $LASTEXITCODE
        if ($fontCode -eq 0) {
            foreach ($line in $fontOut) { Say ("    " + $line) DarkGray }
            $fontResult = if ($fontOut -match '已经装过了') { '此前已装过（本次跳过；要重装加 -Force）' }
                          else { '已安装（重启游戏后生效）' }
        } else {
            $fontResult = "失败（退出码 $fontCode）—— 不影响使用，可稍后手动运行 tools\install-xp-simsun.ps1"
            foreach ($line in ($fontOut | Select-Object -Last 6)) { Say ("    " + $line) DarkYellow }
        }
    } catch {
        $fontResult = "失败（$($_.Exception.Message)）—— 不影响使用"
        Say ("    原版宋体安装失败：{0}" -f $_.Exception.Message) DarkYellow
    }
}

# ── 7) 完成 ────────────────────────────────────────────────
Say ""
Say "安装完成！" Green
Say ""
Say "  启动方式：桌面「摩尔庄园本地客户端」快捷方式，或直接运行"
Say "            $TargetDir\MoleLauncher.exe"
Say ""
Say ("  原版宋体：{0}" -f $fontResult)
Say "            需要重装/卸载：powershell -ExecutionPolicy Bypass -File `"$TargetDir\tools\install-xp-simsun.ps1`" [-Force|-Uninstall]"
Say ""
Say "  首次启动会按需从官方 CDN 抓取游戏资源到 cache\ 目录（约 1 GB，视游玩范围而定）。"
Say "  之后即使断网也能进游戏——这就是「资源全量本地化」。"
Say ""
Say "  卸载：$TargetDir\uninstall.ps1"
Say ""

if (-not $Quiet) {
    $run = Read-Host "现在启动吗？(Y/n)"
    if ($run -ne 'n' -and $run -ne 'N') {
        Start-Process (Join-Path $TargetDir 'MoleLauncher.exe')
    }
}
