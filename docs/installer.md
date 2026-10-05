# Phase 3 · 一键安装包

> 单文件安装程序 **`installer/MoleClient-Setup.exe`（11.4 MB）**，
> 双击即装，自动建快捷方式、写卸载器。
> 不依赖 Inno Setup / NSIS / WiX —— 用**自研的 C# 自解压引导器**完成。

---

## 一、打包方案的三次失败与最终选择

这个安装包前后做了三版，**前两版构建"成功"但根本装不了东西**。整个过程值得记录。

### 1.1 第一版：7-Zip 自解压（失败）

思路是经典做法 —— `7z.sfx 模块 + 配置块 + payload.7z` 二进制拼接：

```
;!@Install@!UTF-8!
Title="摩尔庄园本地客户端"
BeginPrompt="即将安装…"
RunProgram="install.cmd"
;!@InstallEnd@!
```

构建成功、`7z l` 也能列出正确内容。**但双击后闪一下就没了，什么都没装。**

查下去才发现根因：**7-Zip 主安装包自带的 `7z.sfx` / `7zCon.sfx` 根本不支持这个配置块**：

```
--- C:\Program Files\7-Zip\7z.sfx  (201 KB) ---
    含 'Install@':    False
    含 'RunProgram':  False
    含 'BeginPrompt': False
    含 'InstallEnd@': False
```

它们是「简单解压器」。支持 `RunProgram` 的是 **7-Zip Extra** 里的 `7zS.sfx` / `7zSD.sfx`，
但下载了 `7z2301-extra.7z` 后发现**新版本已不再分发 SFX 模块**（包里只有 `7za.exe` / `7za.dll` / Far 插件）。

> **教训**：我验证了「归档内容正确」，却从未验证「自解压器会不会真的执行安装脚本」。
> 于是那个 7.7 MB 的安装包"构建成功、内容列表正确"，但**永远不会装任何东西**。

### 1.2 第二版：iexpress（失败）

`iexpress.exe` 是 Windows 自带的，理论上最省事。结果同样不行：

- 单文件 SED → ✅ 成功
- 两个文件（含子目录）→ ✅ 成功
- **真实 payload 的 10 个小文件一起 → ❌ 退出码 1，不产出文件，不报原因**
- 但「只有 27 MB 的 ruffle.exe」→ ✅ 成功
- 「前 5 个文件」→ ✅ 成功；「后 5 个文件」→ ✅ 成功；**10 个一起 → ❌**

每个文件单独都能成功，半数也能成功，全部一起就失败，还不给任何诊断信息。
另外伴随 `libpng warning: iCCP: cHRM chunk does not match sRGB`（它在试图渲染进度对话框）。

顺手还发现两个坑：
- SED 里 `[SourceFiles0]` 的条目是 `%FILE0%=`，写成 `%%FILE0%%=` 会直接失败且不报原因；
- 加了 `/Q` 参数稳定失败（用最小 SED 对比过 `/N` 与 `/N /Q`）。

**不可靠，放弃。**

### 1.3 第三版：自研 C# 自解压引导器（成功）

`installer/MoleSetup/` —— 一个约 200 行的控制台程序，做的事极少，因此每步都可验证：

```
文件布局：[引导器 exe][payload.zip][32 字节页脚]
页脚    ：魔数 "MOLESETUP-V1"(16B) + int64 zip 偏移 + int64 zip 长度
```

流程：读页脚 → 取出 zip 那段字节 → 用 `ZipArchive` 解压到临时目录 → 运行 `install.cmd` → 清理。

### 1.4 又一个反直觉发现：.NET 读不了"前面带数据的 zip"

「exe + 附加 zip」是经典做法，我原本以为 `ZipFile.OpenRead(自身的 exe)` 就能读出来。

**实测不行**，而且做了一组对照：

| 情形 | 结果 |
|---|---|
| 纯 zip，`ZipFile.OpenRead(path)` | ✅ 2 个条目 |
| 前面附加 1000 字节后再 `OpenRead(path)` | ❌ **0 个条目** |
| 手动 seek 到 zip 起点再构造 `ZipArchive` | ❌ **0 个条目** |

（内容完全相同，只是加了前缀。）所以不能靠"自动修正偏移"，必须自己定位 —— 这就是页脚的作用。

> 这个坑是**打包脚本的自检**抓出来的：自检不满足于"文件生成成功"，
> 而是真的按引导器的逻辑取一段字节、交给 `ZipArchive` 解析、核对条目数。
> 如果自检只判断"exe 存在且大于 0 字节"，这一版又会带着 0 条目发出去。

---

## 二、安装包结构

```
MoleClient-Setup.exe  (11.4 MB)
├── MoleSetup.exe（引导器，约 160 KB，框架依赖 .NET 7）
├── payload.zip（11.2 MB）
│   ├── launcher\        MoleLauncher.exe + .dll + deps.json（启动器）
│   ├── molemirror\      index.js（本地镜像）
│   ├── runtime\ruffle\  ruffle.exe（游戏引擎，25.9 MB）
│   ├── install.cmd      入口
│   ├── install.ps1      安装逻辑
│   └── README.md        安装说明
└── 32 字节页脚
```

> payload 里的文件名一律用 **ASCII**（`README.md` 而非 `README-安装说明.md`），
> 装到目标目录后再由 `install.ps1` 改成中文名。
> 这是为了避开 iexpress 老工具的编码问题 —— 即使最终方案不用它，这个约定也保留了下来。

---

## 三、安装后的目录布局

```
<安装目录>\
├── MoleLauncher.exe        启动器
├── molemirror\index.js     本地镜像
├── runtime\ruffle\         游戏引擎
├── cache\                  ★ 客户端资源（首次运行时按需抓取）
├── data\
│   ├── settings.json       启动器配置
│   ├── config\             Ruffle 的 --config 目标
│   ├── cache\              Ruffle 自己的缓存
│   └── SharedObjects\      存档
├── logs\
├── uninstall.ps1
└── 安装说明.md
```

**布局是刻意设计的**：启动器在根、`molemirror` 在子目录 ——
启动器的 `PathResolver` 会从 exe 所在目录**向上查找含 `molemirror\index.js` 的目录**作为项目根，
因此装完即用，**不需要手工配置任何路径**。

### 为什么不打包 cache\

`cache\` 已经接近 1.2 GB。安装包只带"程序"，游戏资源由 `molemirror` 在首次运行时
**按需从官方 CDN 抓取并落盘**，之后一直从本地读。
这既是「资源本地化」的正常工作方式，也让安装包保持在 11 MB 量级。

---

## 四、安装目录的选择与回退

### 4.1 默认位置在本机不可用

初版把 `%USERPROFILE%\MoleClient` 写死成默认值，结果真实运行时直接失败：

```
安装目录不可写：C:\Users\iyyh\MoleClient
Access to the path 'MoleClient' is denied.
```

**这台机器上，未签名的自编译二进制写不了用户 profile。** 详见
[`launcher.md`](launcher.md) 第五节 —— 而且更进一步：

> **限制会沿进程树继承。**
> 从 PowerShell（受信任）启动时，`%USERPROFILE%\MoleClient` 是可写的；
> 而从 `MoleClient-Setup.exe`（未签名）拉起的 `cmd → powershell` 里，同一个路径不可写。

这也解释了为什么最初用 PowerShell 去"验证目录可写"会得出错误结论。

### 4.2 回退策略

未显式指定目标时，依次实测可写性，用第一个成功的：

1. `%USERPROFILE%\MoleClient`（标准位置，多数机器可用）
2. `<安装包所在目录>\MoleClient`（便携式；引导器已在那里成功解压过）
3. `%LOCALAPPDATA%\Programs\MoleClient`
4. `<当前工作目录>\MoleClient`

显式指定（`-TargetDir` 或 `MOLE_SETUP_TARGET`）时**不做替换**，不可写就明确报错。

引导器自己选解压目录时也是同样的回退思路（安装包旁 → `%TEMP%` → 当前目录）。

---

## 五、测试中发现并修掉的缺陷

### 5.1 快捷方式会覆盖官方微端（差点发出去）

准备测快捷方式时先检查了一下目标路径，结果两个都已存在：

```
D:\用户\Administrator\Desktop\摩尔庄园.lnk          → 已存在
C:\Users\iyyh\AppData\Roaming\...\Programs\摩尔庄园.lnk → 已存在
```

再看指向：

```
target = C:\Users\iyyh\AppData\Local\Programs\TaomeeMole\摩尔庄园.exe
描述   = 淘米微端-摩尔庄园
创建于 = 2021/4/26
```

**这是淘米官方微端的快捷方式。** 安装器原本用 `摩尔庄园.lnk` 这个名字，
一运行就会**静默覆盖**它 —— 用户点"摩尔庄园"以为开的是官方微端，实际换成了我们的客户端，
而且官方那个再也回不来。

**修法**：改用不冲突的名字 `摩尔庄园本地客户端.lnk`。
**验证方式**：每次测试都记录官方 `.lnk` 的 SHA256 并在前后比对，确认始终未被触碰。

### 5.2 快捷方式创建失败被静默吞掉

走引导器安装时，快捷方式创建失败，但那个 `catch` 只调用 `Say`（被 `-Quiet` 抑制），
结果用户看到的是"安装完成！"，然后**桌面上什么都没有**。

**修法**：失败信息收集起来，**即使处于 `-Quiet` 也用 `Write-Host` 输出**，
并给出替代启动方式：

```
注意：有 2 处快捷方式未能创建：
  - D:\用户\Administrator\Desktop\摩尔庄园本地客户端.lnk ：无法保存快捷方式…
  - C:\Users\iyyh\AppData\Roaming\...\Programs\摩尔庄园本地客户端.lnk ：无法保存快捷方式…
  这不影响使用——直接运行 I:\...\MoleClient\MoleLauncher.exe 即可。
```

### 5.3 镜像实例复用会读到别人的缓存

把包装到 `I:\61mole\_test-install\` 后启动，日志显示它**复用了主项目的镜像实例**：

```
[Ok ] mirror  检测到已有镜像实例在运行，直接复用（25110 个资源）
```

而那个实例服务的是 `I:\61mole\cache`，不是新安装的缓存目录。
表现为"新安装的客户端资源莫名其妙是全的" —— 排查起来会非常费解。

**修法**：复用前先比对 `cacheDir`，不一致就拒绝复用并给出可操作提示。实测守卫生效。

### 5.4 `--download-ruffle` 的同步死锁

设置窗口的「下载…」按钮是 `async void`，正常 await，没问题。
但为了能自动化验证而加的命令行开关写成了：

```csharp
DownloadRuffle().GetAwaiter().GetResult();   // ✗ UI 线程同步等待 → 死锁
```

实测表现：进程卡住不退出、内存不动、连临时文件都不建（GitHub API 其实 1.4 秒就返回了）。

**修法**：`Task.Run(() => DownloadRuffle()).GetAwaiter().GetResult()`（挪到线程池，那里没有同步上下文）。

### 5.5 下载暂存目录不能用 `%TEMP%`

死锁修好后立刻撞上第二个问题：

```
下载失败：Access to the path 'C:\Users\iyyh\AppData\Local\Temp\ruffle-<guid>.zip' is denied.
```

**修法**：暂存目录改成 `<root>\data\temp`。改完实测通过（19.3 秒 / 25.76 MB / 零残留）。

### 5.6 卸载器会按端口结束镜像 —— 有意的，但有副作用

卸载器不做"杀掉所有 node"这种粗暴操作，而是**按端口精确结束**：

```powershell
foreach ($port in @(8899, 8898, 8080)) {
    Get-NetTCPConnection -LocalPort $port -State Listen |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
```

对**单份安装**这是正确的。但我测试卸载时发现它把**主项目**那个镜像也一起杀了 ——
因为两份安装默认用同一组端口。配合 5.3 的守卫，完整行为是：

- 两份安装共存 → 后启动的**拒绝复用**并提示换端口；
- 卸载其中一份 → 会结束占用这些端口的镜像进程（可能是另一份的）。

**要同时保留多份安装，请给它们分配不同的端口组。** 这属于已知行为，暂未改动 ——
对绝大多数用户（只有一份安装）来说它是正确的。

### 5.7 子进程输出按系统 ANSI 解码，中文日志全是乱码

```
[molemirror] 杞藉叆缂撳瓨绱㈠紩 26428 鏉?      ← 实际是「载入缓存索引 26428 条」
```

`ProcessStartInfo` 未指定 `StandardOutputEncoding` 时用系统 ANSI 代码页去解，
而 node 与 Ruffle 都以 UTF-8 输出。

**修法**：两个服务都显式设 `StandardOutputEncoding = Encoding.UTF8`（stderr 同理）。

---

## 六、验证状态

| 项 | 状态 |
|---|---|
| `make-setup.ps1` 打包 | ✅ 产出 11.4 MB |
| **打包自检**（真的取出 payload 并解析条目） | ✅ 11 个条目，含 `install.cmd` |
| **双击 `MoleClient-Setup.exe` 的完整流程** | ✅ **已实测**：引导器解压 → `install.cmd` → `install.ps1` 全链路跑通 |
| 安装目录回退 | ✅ 实测：默认位置不可写时自动改用可写目录并提示 |
| 安装后可独立运行 | ✅ 启动器从安装目录运行，项目根解析为安装目录本身 |
| 参数指向安装目录 | ✅ `--config` / `--cache-directory` / Ruffle 路径均正确 |
| 启动器托盘 | ✅ 日志确认 `托盘图标已创建` |
| 缓存目录不一致守卫 | ✅ 日志确认拒绝复用并给出提示 |
| **不覆盖官方微端快捷方式** | ✅ **已实测**：前后 SHA256 比对，官方 `.lnk` 哈希未变 |
| 快捷方式创建（受信任进程树下） | ✅ 已实测创建成功、target/workdir 正确 |
| **快捷方式失败可见性** | ✅ 实测：失败原因完整打印，并给出替代启动方式 |
| **卸载器（默认，全删）** | ✅ **已实测**：目录清除，官方快捷方式完好 |
| **卸载器（`-KeepCache`）** | ✅ **已实测**：`cache\` 及其内容保留，其余清除 |
| **`--download-ruffle`** | ✅ **已实测**：19.3 秒下载解压成功，暂存零残留 |
| **`--play` 全链路** | ✅ 端到端实测（见 [`launcher.md`](launcher.md)） |
| 镜像 stdout 中文编码 | ✅ 实测可读 |
| 自包含单文件发布 | ⚠️ 未实测（脚本已备） |

> 所有安装/卸载测试后均已清理；每次都记录官方微端快捷方式的 SHA256 并在前后比对。

---

## 七、复现

```powershell
# 打包（会自动先发布启动器与引导器）
powershell -ExecutionPolicy Bypass -File installer\make-setup.ps1

# 不随包带 Ruffle（改由启动器首次运行时下载）
powershell -ExecutionPolicy Bypass -File installer\make-setup.ps1 -NoRuffle

# 直接手工安装（不用安装包）
powershell -ExecutionPolicy Bypass -File installer\install.ps1 -TargetDir D:\MoleClient

# 无人值守安装（自动化验证用）
$env:MOLE_SETUP_QUIET=1; $env:MOLE_SETUP_TARGET="D:\MoleClient"; .\MoleClient-Setup.exe
```

可选环境变量：`MOLE_SETUP_QUIET` / `MOLE_SETUP_TARGET` / `MOLE_SETUP_NOSHORTCUTS` / `MOLE_SETUP_NORUFFLE`

> `.ps1` 必须保存为**带 BOM 的 UTF-8**，否则 PowerShell 5.1 会按 ANSI 解码中文，
> 导致解析崩溃。本项目已踩过此坑至少五次，改完脚本一律用
> `UTF8Encoding($true)` 重写并用 `Parser::ParseFile` 做语法检查 ——
> **语法检查能立刻抓出 BOM 丢失**。

