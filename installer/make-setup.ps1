# 把已发布的启动器 + 本地镜像 + Ruffle 运行时打包成单文件安装包 MoleClient-Setup.exe
#
# 打包方式：自研的 C# 自解压引导器（installer\MoleSetup） + 附加在文件末尾的 payload.zip
#
# 为什么不用现成工具 —— 两条都是实测踩出来的，别轻易改回去：
#   1) 7-Zip 自解压：主安装包自带的 7z.sfx / 7zCon.sfx 是「简单解压器」，
#      模块内不含 ;!@Install@! 配置块的解析代码（字符串检索确认过），
#      拼出来的 exe 只会解压、不会执行安装脚本。
#      支持该配置的 7zS.sfx / 7zSD.sfx 已不再随官方包分发。
#   2) iexpress：Windows 自带，但实测文件数到 10 个左右的组合时稳定退出码 1、
#      不产出文件、不报原因；单文件或半数文件却都正常。不可靠。
#
# 用法:
#   .\make-setup.ps1                随包包含 Ruffle
#   .\make-setup.ps1 -NoRuffle      不打包 Ruffle（改由启动器首次运行时下载）
#   .\make-setup.ps1 -SkipBuild     跳过启动器与引导器的重新构建

[CmdletBinding()]
param(
    [switch]$NoRuffle,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$InstallerDir = $PSScriptRoot
$Root = Split-Path -Parent $InstallerDir
$Build = Join-Path $InstallerDir 'build'
$Payload = Join-Path $Build 'payload'
$StubProj = Join-Path $InstallerDir 'MoleSetup\MoleSetup.csproj'
$StubPublish = Join-Path $InstallerDir 'MoleSetup\publish'
$OutExe = Join-Path $InstallerDir 'MoleClient-Setup.exe'

Write-Host ''
Write-Host '=== 打包 摩尔庄园本地客户端 安装包 ===' -ForegroundColor Cyan
Write-Host ''

# ── 1) 构建启动器与引导器 ─────────────────────────────────
if (-not $SkipBuild) {
    Write-Host '步骤 1/5  发布启动器…' -ForegroundColor Green
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'launcher\build-launcher.ps1') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '启动器发布失败' }
} else {
    Write-Host '步骤 1/5  跳过构建（-SkipBuild）' -ForegroundColor DarkGray
}

$publishDir = Join-Path $Root 'launcher\publish'
if (-not (Test-Path (Join-Path $publishDir 'MoleLauncher.exe'))) {
    throw "找不到已发布的启动器: $publishDir\MoleLauncher.exe"
}

# 引导器发布成单文件（框架依赖，与启动器共用同一份 .NET 7 运行时）
$stubExe = Join-Path $StubPublish 'MoleSetup.exe'
if (-not $SkipBuild -or -not (Test-Path $stubExe)) {
    Write-Host '         发布安装引导器…' -ForegroundColor DarkGray
    & dotnet publish $StubProj -c Release -r win-x64 --self-contained false `
        -p:PublishSingleFile=true -o $StubPublish 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '安装引导器发布失败' }
}
if (-not (Test-Path $stubExe)) { throw "找不到引导器: $stubExe" }

# ── 2) 组装 payload ───────────────────────────────────────
Write-Host '步骤 2/5  组装 payload…' -ForegroundColor Green
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

# 2a) 启动器
$launcherDst = Join-Path $Payload 'launcher'
New-Item -ItemType Directory -Force -Path $launcherDst | Out-Null
Get-ChildItem $publishDir -File | Where-Object { $_.Extension -ne '.pdb' } |
    ForEach-Object { Copy-Item $_.FullName $launcherDst -Force }
# 带中文名的便捷 bat 不打包：安装器会创建真正的快捷方式，它是冗余的
Remove-Item (Join-Path $launcherDst '启动摩尔庄园.bat') -Force -ErrorAction SilentlyContinue

# 2b) 本地镜像
$mirrorDst = Join-Path $Payload 'molemirror'
New-Item -ItemType Directory -Force -Path $mirrorDst | Out-Null
Get-ChildItem (Join-Path $Root 'molemirror') -File -Filter '*.js' |
    ForEach-Object { Copy-Item $_.FullName $mirrorDst -Force }

# 2c) Ruffle 运行时（可选）
# 两个坑：
#   1) 不能写成 Copy-Item <源目录> <已存在目录> —— 那会把源目录当作子目录拷进去，
#      产出 runtime\runtime\ruffle\，而启动器找的是 runtime\ruffle\ruffle.exe，会直接失效；
#   2) 必须排除 *.zip / *.msi —— Ruffle 官方压缩包与安装器加起来 30+ MB，运行只需要 ruffle.exe。
if (-not $NoRuffle) {
    $ruffleSrc = Join-Path $Root 'runtime\ruffle'
    if (Test-Path (Join-Path $ruffleSrc 'ruffle.exe')) {
        $ruffleDst = Join-Path $Payload 'runtime\ruffle'
        New-Item -ItemType Directory -Force -Path $ruffleDst | Out-Null
        $n = 0
        Get-ChildItem $ruffleSrc -File |
            Where-Object { $_.Extension -notin @('.zip', '.msi', '.pdb') } |
            ForEach-Object { Copy-Item $_.FullName $ruffleDst -Force; $n++ }
        $mb = [math]::Round(((Get-ChildItem $ruffleDst -File | Measure-Object Length -Sum).Sum / 1MB), 1)
        Write-Host ("         已包含 Ruffle 运行时（{0} 个文件 / {1} MB）" -f $n, $mb) -ForegroundColor DarkGray
    } else {
        Write-Host '         未找到 runtime\ruffle\ruffle.exe，安装包不含 Ruffle' -ForegroundColor DarkYellow
    }
} else {
    Write-Host '         按要求不打包 Ruffle' -ForegroundColor DarkGray
}

# 2d) 安装脚本
Copy-Item (Join-Path $InstallerDir 'install.ps1') $Payload -Force

# 2e) 字体工具（安装时的"可选步骤"要用，见 docs/fonts.md）
# 只带这两个文件：一个是下载+校验+安装 XP 宋体，一个是给字体改字重（Ruffle 的粗体查询才命中）。
# 字体文件本身**不入包**（版权属微软/中易），安装时按需下载并校验 SHA256。
$toolsDst = Join-Path $Payload 'tools'
New-Item -ItemType Directory -Force -Path $toolsDst | Out-Null
foreach ($f in @('install-xp-simsun.ps1', 'font-boldify.js')) {
    $src = Join-Path $Root "tools\$f"
    if (Test-Path $src) { Copy-Item $src $toolsDst -Force }
    else { Write-Host "         缺少 tools\$f，安装包的字体步骤会跳过" -ForegroundColor DarkYellow }
}

# 2f) 安装入口
$installCmd = @'
@echo off
rem 由 MoleClient-Setup.exe（自解压引导器）调用。
rem 可选环境变量（供无人值守安装 / 自动化验证）：
rem   MOLE_SETUP_QUIET / MOLE_SETUP_TARGET / MOLE_SETUP_NOSHORTCUTS / MOLE_SETUP_NORUFFLE / MOLE_SETUP_NOFONTS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
exit /b %errorlevel%
'@
# install.cmd 必须是 CRLF + OEM 代码页，才能在 cmd 下正常执行
[System.IO.File]::WriteAllText((Join-Path $Payload 'install.cmd'), ($installCmd -replace "`n", "`r`n"),
    [System.Text.Encoding]::GetEncoding(936))

# 2g) 说明文档（payload 里用 ASCII 名，安装时再由 install.ps1 改成中文名）
$readme = Join-Path $InstallerDir 'README-安装说明.md'
if (Test-Path $readme) { Copy-Item $readme (Join-Path $Payload 'README.md') -Force }

$payloadFiles = (Get-ChildItem $Payload -Recurse -File).Count
$payloadSize = [math]::Round(((Get-ChildItem $Payload -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ("         payload: {0} 个文件 / {1} MB（未压缩）" -f $payloadFiles, $payloadSize) -ForegroundColor DarkGray

# 关键断言：布局必须是 runtime\ruffle\ruffle.exe，多一层就会让启动器找不到引擎
if (-not $NoRuffle -and (Test-Path (Join-Path $Payload 'runtime'))) {
    if (-not (Test-Path (Join-Path $Payload 'runtime\ruffle\ruffle.exe'))) {
        throw 'payload 布局错误：期望 runtime\ruffle\ruffle.exe'
    }
    if (Test-Path (Join-Path $Payload 'runtime\runtime')) {
        throw 'payload 布局错误：出现了 runtime\runtime 的套娃目录'
    }
}

# ── 3) 打 zip ─────────────────────────────────────────────
Write-Host '步骤 3/5  压缩 payload…' -ForegroundColor Green
$zip = Join-Path $Build 'payload.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $Payload, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("         payload.zip: {0} MB" -f $zipSize) -ForegroundColor DarkGray

# ── 4) 把 zip 附加到引导器末尾 ────────────────────────────
# 文件布局：[引导器 exe][payload.zip][32 字节页脚]
#
# ⚠️ 不要省掉页脚去指望「ZipFile 能直接读附加的 zip」——
#    实测 .NET 的 ZipArchive 对前面带数据的 zip 会返回 **0 个条目**（纯 zip 正常）。
#    所以由页脚记录偏移与长度，引导器自己取出这一段字节。
Write-Host '步骤 4/5  生成 MoleClient-Setup.exe…' -ForegroundColor Green
if (Test-Path $OutExe) { Remove-Item $OutExe -Force }
Copy-Item $stubExe $OutExe -Force

$stubSize = (Get-Item $stubExe).Length
$zipBytes = [System.IO.File]::ReadAllBytes($zip)

$footer = New-Object byte[] 32
$magic = [System.Text.Encoding]::ASCII.GetBytes('MOLESETUP-V1')
[Array]::Copy($magic, 0, $footer, 0, $magic.Length)
[BitConverter]::GetBytes([int64]$stubSize).CopyTo($footer, 16)
[BitConverter]::GetBytes([int64]$zipBytes.Length).CopyTo($footer, 24)

$out = [System.IO.File]::Open($OutExe, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
try {
    $out.Write($zipBytes, 0, $zipBytes.Length)
    $out.Write($footer, 0, $footer.Length)
} finally {
    $out.Close()
}

# ── 5) 校验 ───────────────────────────────────────────────
Write-Host '步骤 5/5  校验…' -ForegroundColor Green

# 自检必须验证到「能从产物里取出并解析出条目」这一层。
# 之前 7z.sfx 那版「构建成功、7z l 也列得出内容」，但自解压器根本不执行安装脚本 ——
# 只看「打包成功」会漏掉这类问题。
$outBytes = [System.IO.File]::ReadAllBytes($OutExe)
$expectedSize = $stubSize + $zipBytes.Length + 32
if ($outBytes.Length -ne $expectedSize) {
    throw "自检失败：产物大小 $($outBytes.Length) 与期望 $expectedSize 不符"
}

$f = $outBytes[($outBytes.Length - 32)..($outBytes.Length - 1)]
$magicBack = [System.Text.Encoding]::ASCII.GetString($f, 0, 12)
if ($magicBack -ne 'MOLESETUP-V1') { throw "自检失败：页脚魔数不对（读到 '$magicBack'）" }

$off = [BitConverter]::ToInt64($f, 16)
$len = [BitConverter]::ToInt64($f, 24)
if ($off -ne $stubSize) { throw "自检失败：页脚偏移 $off 与引导器大小 $stubSize 不符" }
if ($len -ne $zipBytes.Length) { throw "自检失败：页脚长度 $len 与 zip 大小 $($zipBytes.Length) 不符" }

# 按引导器的逻辑取一段字节，交给 ZipArchive 解析
$slice = New-Object byte[] $len
[Array]::Copy($outBytes, [int]$off, $slice, 0, [int]$len)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ms = New-Object System.IO.MemoryStream(, $slice)
$za = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Read)
try {
    $entryCount = $za.Entries.Count
    $hasInstall = $null -ne ($za.Entries | Where-Object { $_.FullName -eq 'install.cmd' })
} finally {
    $za.Dispose(); $ms.Dispose()
}

if ($entryCount -ne $payloadFiles) {
    throw "自检失败：从产物中解析出 $entryCount 个条目，payload 有 $payloadFiles 个文件"
}
if (-not $hasInstall) { throw '自检失败：产物内找不到 install.cmd' }
Write-Host ("         自检通过：{0} 个条目，含 install.cmd" -f $entryCount) -ForegroundColor DarkGray

$setupSize = [math]::Round((Get-Item $OutExe).Length / 1MB, 1)
Write-Host ''
Write-Host "完成: $OutExe  ($setupSize MB)" -ForegroundColor Green
Write-Host ''
Write-Host '安装包行为:' -ForegroundColor DarkGray
Write-Host '  1. 双击后引导器把内嵌 payload 解压到自身目录下的临时子目录' -ForegroundColor DarkGray
Write-Host '  2. 运行 install.cmd → install.ps1，默认装到 %USERPROFILE%\MoleClient' -ForegroundColor DarkGray
Write-Host '  3. 创建桌面/开始菜单快捷方式（名称刻意与官方微端区分）' -ForegroundColor DarkGray
Write-Host '  4. 卸载脚本随安装写入（uninstall.ps1）' -ForegroundColor DarkGray
Write-Host ''
Write-Host '无人值守安装（供自动化验证）:' -ForegroundColor DarkGray
Write-Host '  $env:MOLE_SETUP_QUIET=1; $env:MOLE_SETUP_TARGET="D:\MoleClient"; .\MoleClient-Setup.exe' -ForegroundColor DarkGray
Write-Host ''
