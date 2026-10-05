# 摩尔庄园本地客户端 · 实施计划 v2

> 目标：Windows 本地客户端，**引擎本地化、资源全量本地**，**网络仍连官方服务器**。
> 更新日期：2026-06 · 工作目录：`I:\61mole`

---

## 0. v2 相对 v1 的实质修订

| # | v1 的判断 | v2 的修订 | 依据 |
|---|---|---|---|
| 1 | "Ruffle 拿不到 `sid`，很可能致命" | **证伪**。客户端自带登录界面（`resource/login/Login.swf`），在客户端内用淘米账号登录即可，官网 `?sid=` 只是 SSO 透传 | `resource/login/Login.swf` 实测在线 489,881 B；MoleRuffle README「用淘米账号登录即可进入游戏」 |
| 2 | 把真实 Flash 列为"仅保底" | **升格为并列主线**。淘米官方自己仍在分发投影器并教玩家用 | `www.61.com.tw/download/flashplayer.zip` 实测 200，10,217,759 B |
| 3 | Ruffle 直接用 `?sid=...` URL | **纠正**：Ruffle 桌面版不解析 SWF URL 的 query string，必须用 `-P key=value` | ruffle issue #9571 |
| 4 | 未提 socket 白名单默认值 | **纠正**：显式传 `--tcp-connections allow` + `--socket-allow host:port`，不依赖默认 | Ruffle `cli.rs`；默认值未能确认 |
| 5 | 未提 Flex 4 SWZ 依赖 | **新增红线**：Flex 4 会从 `fpdownload.adobe.com` 取 SWZ，**该域不能封**（中文教程封的是 `macromedia.com` 系列，不是这个） | Flashpoint Flash Curation |
| 6 | Phase 0 单轨 | **改为双轨赛马**，半天内同时验证两个引擎，用实测决定主线 | 两条路都便宜 |

---

## 0.5 实施进展（Phase 0 / Phase 1 已完成，实测结论）

> 详细实测记录见 [`docs/spike-0.md`](docs/spike-0.md)。

**Phase 0 判定：PASS。** 用预编译 Ruffle（`0.7.0-nightly.2026.10.4`）+ 命令行开关 + 本地镜像代理，
**无需编译 Ruffle 源码、无需对官方 SWF 打任何补丁**，已跑通至登录界面并可输入。
实测证明 MoleRuffle 改源码所做的四件事（spoof / socket 放行 / base / 磁盘存储），
官方 Ruffle 命令行开关全部已具备。

**Phase 1 核心机制已跑通：**

| 能力 | 状态 |
|---|---|
| 正向代理（Ruffle `--proxy` / `HTTP_PROXY`） | ✅ |
| 反向代理源站（hosts 指向 127.0.0.1） | ✅ 已实现并冒烟通过 |
| 磁盘缓存（保留原始 URL 结构） | ✅ |
| DoH 独立解析（绕过 hosts 防自环） | ✅ |
| 请求日志 / 资源清单 | ✅ `resources/manifest.tsv` |
| 控制接口 `/__status` `/__manifest` | ✅ |
| 本地端点覆写（`ip.txt`） | ✅ |
| 离线模式 | ✅ **17/17 资源命中本地，mole.61.com 零回源** |
| 一键启动脚本 `run.ps1` | ✅ |

**引导集规模**：17 个文件 / 7.10 MB（完整清单见 `resources/manifest.tsv`）。

**实测中发现并修复的三个真实缺陷**：
1. Ruffle 默认配置目录创建被拒（`os error 5`）→ 必须显式传 `--config`，否则静默退出。
2. 客户端给静态资源追加缓存击穿参数（`?iekywkx4`）→ 缓存键必须剥离 query，否则永远无法本地化。
3. `version/zzz_config.txt` 是**硬依赖**，一旦失败即终止整条加载链 → 需 TTL 语义而非"永不缓存"。

**原「未解问题」已解开**：`TaomeeVersionManager` 的清单格式 =
`version/version` + `zzz_config.txt` 的内容 + `.swf`（是 SWF 而非文本/XML）。

### Phase 2 资源全量本地化（**已完成**，验收报告见 [`docs/phase2-acceptance.md`](docs/phase2-acceptance.md)）

| 指标 | 值 |
|---|---|
| 本地资源 | **26,428 个 / 1,187.38 MB**（有效约 26,139；289 个源站即空） |
| **离线验收** | **15,075 条工作负载 → 100% 缓存命中，0 未命中** |
| **衣服位图** | **11,178 个**（组空间 `{1001,1002,1003}` 已破解，见 [`docs/cloth-group-pattern.md`](docs/cloth-group-pattern.md)） |
| 衣服图标 | 1458（覆盖博物馆 1433 全部） |
| 家具图标 | 1,416（`resource/goods/icon/`） |
| **任务资源** | **1,336 个**（`resource/newTask`，嵌套结构已解，见 [`docs/prefix-resolution.md`](docs/prefix-resolution.md)） |
| 地图 | 616（长名 + 短名两套命名，覆盖 277/282 = 98.2%） |
| **路径模板破解** | **29 条中 18 条落地真实文件**，11 条经**密集探测（每条 799 个 ID）**判定官方 CDN 上不存在 |
| 语料补充 | 245 个地图 SWF（含 7 个线上已下架） |

**六条种子来源**：
1. SWF 常量池挖掘（689 条）
2. 真实请求日志（游玩驱动）
3. 摩尔博物馆数据接口（1438 条路径、1433 衣服 ID、282 地图）
4. 52摩尔共享语料（3837 衣服 ID、244 地图、155 BGM；易语言工具源码的 64 条路径模板）
5. ⭐ **`ClientConfigDLL` 内嵌配置 XML**（带 ID 的权威资源索引）
6. ⭐⭐ **博物馆物品全表**（10,989 物品 → **9,761 条权威资源路径**，覆盖 22 个前缀）

**工具链**：`scan-swf-paths` → `analyze-paths` → `extract-museum-seeds` → `extract-corpus-ids`
→ `gen-tool-template-seeds` → `extract-clientconfig-xml` → `extract-prefix-id-index`
→ `fetch-museum-items` → `probe-prefix-matrix` → `list-unresolved-prefixes` → `gen-matrix-seeds`
→ `gen-namespace-seeds` → `crawl-resources` → `fetch-list` → `gap-analysis`
→ `cloth-group-analysis` → `snapshot-compare`

### Phase 3 启动器 + 一键安装包（已完成，说明见 [`docs/launcher.md`](docs/launcher.md) / [`docs/installer.md`](docs/installer.md)）

.NET 7 + WPF 桌面壳，位于 `launcher/MoleLauncher/`，发布产物 `launcher/publish/`。

| 能力 | 状态 |
|---|---|
| 自动启停 molemirror（含**复用已有实例 + 缓存目录一致性校验**） | ✅ 实测 |
| Ruffle 参数注入（不修改任何官方文件） | ✅ `--print-command` 逐项验证 |
| 设置界面（路径 / 端口 / 离线模式 / 代理开关 / 分辨率 / 全屏） | ✅ |
| 托盘（最小化到托盘，游戏继续运行） | ✅ 日志确认创建成功 |
| 日志（应用内着色 + `logs\launcher.log`） | ✅ 实测 |
| 统计面板（2 秒轮询 `/__status`） | ✅ 实测 |
| `--play` 一键进游戏 | ✅ **端到端实测通过** |
| `--download-ruffle` 一键下载引擎 | ✅ **实测通过**（19.3 秒 / 25.76 MB） |

**一键安装包**：`installer/MoleClient-Setup.exe`（**11.4 MB**，自研 C# 自解压引导器，无外部工具依赖）

| 能力 | 状态 |
|---|---|
| 打包 + **自检**（真的取出 payload 并解析条目） | ✅ |
| **双击安装的完整流程** | ✅ **已实测**（引导器 → install.cmd → install.ps1 全链路） |
| 安装目录自动回退 | ✅ 实测（默认位置不可写时自动改用可写目录并提示） |
| 安装后独立运行 | ✅ 项目根正确解析为安装目录 |
| **不覆盖官方微端快捷方式** | ✅ **实测**（前后 SHA256 比对） |
| 快捷方式失败可见性 | ✅ 失败原因完整打印，并给出替代启动方式 |
| 卸载器（全删 / `-KeepCache`） | ✅ **两条分支均实测通过** |

**打包方案经三次迭代**：7-Zip 自解压（`7z.sfx` 不支持 `RunProgram`，**构建成功但装不了**）→
iexpress（文件组合稍复杂就静默失败）→ **自研 C# 引导器**（成功）。
其中一个反直觉发现：**.NET 的 `ZipArchive` 读不了前面带数据的 zip**（返回 0 条目），
所以「exe + 附加 zip」这个经典做法在本项目不可用，改为在文件末尾写页脚定位。

**构建状态**：`dotnet build -c Release` **0 警告 0 错误**。

**过程中修掉的问题**（详见 [`docs/launcher.md`](docs/launcher.md) 第五节 / [`docs/installer.md`](docs/installer.md) 第五节）：
1. **静默 `catch` 掩盖故障** —— 配置写失败、快捷方式创建失败都完全无痕。
2. **两次误判 AppData 写入** —— 先是推成机器级策略，又用 PowerShell（受信任程序）
   去"验证"受限主体，结论两次都不准。最终查明：**针对未签名自编译二进制的拦截，
   且会沿进程树继承给子进程**。
3. **打包路径套娃 + 32 MB 冗余** —— 第一版 28.8 MB 且**引擎路径错误会直接失效**。
4. **快捷方式会覆盖淘米官方微端** —— 差一点发出去；改用不冲突的名字。
5. **镜像实例复用会读到别人的缓存** —— 增加 `cacheDir` 一致性校验。
6. **`--download-ruffle` 同步死锁** —— UI 线程上 `GetAwaiter().GetResult()` 死锁。
7. **下载暂存不能用 `%TEMP%`** —— 改用 `<root>\data\temp`。
8. **发布脚本不挡"exe 被占用"** —— `dotnet publish` 报错无原因，现主动检测并提示。
9. **子进程输出按 ANSI 解码** —— 中文日志全是乱码，改为显式 UTF-8。
10. **默认安装目录在本机不可用** —— 增加候选位置实测 + 回退。

---

## 一、方案选型

### 主线：双引擎，Phase 0 赛马决定

| | 引擎 | 优势 | 已知短板 |
|---|---|---|---|
| **A** | **Ruffle 桌面版** | 开源、无 Adobe 二进制、跨平台、可编程包裹 NavigatorBackend；MoleRuffle 已实测进游戏世界 | `ExternalInterface.call` 返回 `undefined`；`ByteArray.writeObject()` 是空实现；`URLStream` 无流式；CJK 设备字体需显式配置 |
| **B** | **Adobe Flash 投影器** | **100% AS3 保真**；**淘米官方自己分发并推荐**；中文社区已验证对 `mole.61.com` 有效 | 闭源、EOL；投影器无真实 ExternalInterface；"版本过旧"需 hosts + settings.sol 处理；无跨平台 |
| C | Flash 浏览器容器<br>（FPNavigator / Waterfox Classic / 360极速浏览器X）+ **自写本地 launcher.html** | **唯一零补丁拿到完整 ExternalInterface 的路径**；Flashpoint 与淘米 `win_browser.zip` 都是这条路 | 部署最重；仅当 JPEXS 审计证明 `get_sid` 确实必需时才启用 |

> **C 的关键做法**：不注入、不改 SWF，只写一个本地 HTML 承载页复刻官网那段 JS（`get_sid` / `get_uid`），SWF 用 `<object>` 嵌入并**必须**带 `allowscriptaccess=always`（默认 `sameDomain` 会静默拒绝 ExternalInterface），3D 内容用 `wmode=direct`。本地 `:80` 起静态服务，浏览器打开 `http://127.0.0.1/launcher.html`。这一层同时是 Phase 3 启动器的降级实现。

**我的倾向**：以 **A（Ruffle）为主线**——MoleRuffle 的实测证据（进入游戏世界、原生 TCP 收发真实协议、91 个资源 SWF、9.5 分钟零崩）强于任何基于兼容性表的推断，且没有闭源二进制和分发问题。**B 作为并列备选**，因为它是官方认可路径、保真度最高，且 Phase 0 验证成本极低。

两者最终由 Phase 0 的实测结果裁决，不由推断裁决。

---

## 二、事实基础（全部实测）

### 服务端

- `mole.61.com` 在线，HTTP 200，`swfobject.js?v=202507311216` → 站点仍在维护
- 登录服 `123.206.131.236:1863`；游戏服 `123.206.131.236:1865`；`config/Server.xml` 另声明 `123.206.131.63:3200`
- **三个端口都返回 allow-all 的 socket 策略文件**：

  ```
  123.206.131.63:843    -> <allow-access-from domain="*" to-ports="*"/>
  123.206.131.63:3200   -> <allow-access-from domain="*" to-ports="*"/>
  123.206.131.236:1863  -> <allow-access-from domain="*" to-ports="*"/>
  ```

  ⇒ 本地客户端**可直连官方服务器，无需策略绕过**
- 回源已验证：按真实 IP + `Host: mole.61.com` 可取到资源（`61.164.158.61` / `36.25.243.102` / `61.164.158.59` 均 200）

### 客户端

- 入口 `Client.swf`：20KB，CWS/zlib，SWF v14，Flex 4，构建于 2015-11-04
- 它是**引导器**：`TaomeeVersionManager` / `TaomeeVersionLoader` / `DLLLoader` / `com.core.MainEntry`
- 读 `config/Server.xml`、`version/zzz_config.txt`
- 按相对路径加载五个 DLL 模块（实测大小）：

  | 模块 | 大小 |
  |---|---|
  | `dll/TaomeeCoreDLL.swf` | 1,133,615 |
  | `dll/ClientConfigDLL.swf` | 799,655 |
  | `dll/ClientCommonDLL.swf` | 429,461 |
  | `dll/ClientSocketDLL.swf` | 523,182 |
  | `dll/ClientAppDLL.swf` | 1,252,419 |

- **自带登录界面**（实测在线）：`resource/login/Login.swf` 489,881 B、`resource/login/LoginHome.swf` 175,856 B、`resource/login/Advertisement.swf` 151,216 B
- 网络层：`com.logic.socket.gameSocket` → `org.taomee.net.SocketImpl`
  - **17 字节包头**：`PkgLen u32BE | Version 1B | CmdID u32BE | UserID u32BE | SN i32BE`
  - 包体经 `com.fcc.MDecrypt` / `MEncrypt`（CrossBridge 编译的 C）加密
- 登录有两条路径：① 官网 SSO `?sid=` 经 ExternalInterface 透传 ② **客户端内登录框**（`Login.swf`）直接走 `1863`

### 三个"命门"（MoleRuffle 实测确认）

1. `Client.swf` 检测到自己不在官网会 `navigateToURL("http://mole.61.com")` 弹走
2. 游戏用 `flash.net.Socket` 裸 TCP —— 浏览器/WASM 做不到，**原生可以**
3. `version/`、`resource/`、`config/`、`dll/` 全是相对路径，必须给 base

### 引擎短板（逐条来源）

**Ruffle**（`avm2_report.json`，nightly-2026-10-04；全局 4182/4560）

| API | 状态 |
|---|---|
| `XMLSocket` | **6/6 完整** |
| `Socket` | **36/36 完整**（`bytesPending` 空实现） |
| `ApplicationDomain` / `LoaderContext` | **8/8 和 9/9 完整** ← 动态加载 40 个模块 DLL 的关键 |
| `ExternalInterface` | 5/6；`call_method` **只处理 `window.location.href` 系列**，其他方法名 `warn` + 返回 `undefined` |
| `ByteArray.writeObject()` | **空实现**（AMF 序列化会静默失败） |
| `SharedObject` | 9/19，`getLocal`/`flush` 可用并落盘；`send`/`connect`/`getRemote` 缺失 |
| `URLStream` | 21/25，无 `length`/`position`/`stop()`，**Ruffle 不支持流式加载** |
| `Security.loadPolicyFile/allowDomain` | 空实现（对本项目无害） |

结论：**加载与 UI 半场大概率可用；网络/会话半场有风险**。但 MoleRuffle 的实测覆盖了这个推断。

**Flash 投影器**

- **无 2021 kill switch**。"版本过旧"是**另一套机制**：`settings.sol` + 联网版本校验。修复见 Phase 0 轨道 B
- `ExternalInterface.available == false`；`addCallback()` 抛 `Error #2067`；`call()` 返回 `null`（不抛）
- Flex 4 会从 `fpdownload.adobe.com` 拉 `framework_4.x.swz`，缓存在 `%APPDATA%\Adobe\Flash Player\AssetCache\`；**该域不能封**

---

## 三、Phase 0 — 双轨赛马（0.5–1 天）

**目标：用实测裁决主线引擎。两轨都跑，成本各约 30 分钟。**

先下载：Ruffle（[ruffle.rs/downloads](https://ruffle.rs/downloads)）→ `runtime/ruffle/`；投影器（淘米官方 zip，最佳来源）→ `runtime/flash/`。

### 轨道 A — Ruffle

```
ruffle.exe "http://mole.61.com/Client.swf" ^
  --base "http://mole.61.com/" ^
  --spoof-url "http://mole.61.com/Client.swf" ^
  --tcp-connections allow ^
  --socket-allow 123.206.131.236:1863 ^
  --socket-allow 123.206.131.236:1865 ^
  --socket-allow 123.206.131.63:3200 ^
  --player-version 32 ^
  --scale showAll --force-scale ^
  --width 960 --height 560 ^
  --storage disk --save-directory "%LOCALAPPDATA%\MoleClient\SharedObjects" ^
  --no-gui
```

观察点：
- 是否被 `navigateToURL` 弹走 → `--spoof-url` 是否够（MoleRuffle 同时设 `spoofed_url` **和** `page_url`，CLI 只有前者，**这是本轨唯一真实风险**）
- 日志出现 `Trying to call unknown ExternalInterface method: get_sid` → 符合预期，走**客户端内登录框**
- 中文是否缺字（`Unknown device font "宋体"`）
- 能否连上 `1863` 并出现登录框

### 轨道 B — Flash 投影器

```powershell
# 1) hosts 追加（注意：不要加 fpdownload.adobe.com！）
#    %WINDIR%\System32\drivers\etc\hosts
127.0.0.1 geo2.adobe.com
127.0.0.1 fpdownload2.macromedia.com
127.0.0.1 fpdownload.macromedia.com
127.0.0.1 macromedia.com
127.0.0.1 flash.cn

# 2) 运行投影器
& "runtime\flash\flashplayer_32_sa.exe" "http://mole.61.com/Client.swf"

# 3) 若提示「版本过旧」——清空并把 settings.sol 设为只读
#    实测本机路径（注意 Flash Player 带空格）：
#    %APPDATA%\Macromedia\Flash Player\macromedia.com\support\flashplayer\sys\settings.sol
```

**若投影器因"检测到自己不在浏览器里"而拒绝运行**，换用 Flashpoint 的 **plugin 投影器** `flashplayer_32_plugin.exe`——它伪装成浏览器 Flash 插件而非独立投影器。

诊断（强烈建议先开）——`%USERPROFILE%\mm.cfg`：

```
ErrorReportingEnable=1
TraceOutputFileEnable=1
```

日志落 `%APPDATA%\Macromedia\Flash Player\Logs\flashlog.txt`，另开终端实时看：

```powershell
Get-Content "$env:APPDATA\Macromedia\Flash Player\Logs\flashlog.txt" -wait
```

### 前置：5 分钟 JPEXS 审计（两轨共用）

用 [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler) 打开 `Client.swf` 与 5 个 DLL：
- **Metadata**：确认 `<dc:title>Adobe Flex 4 Application</dc:title>` → 确认 Flex 4 SWZ 依赖
- **Text Search**：`ExternalInterface`、`.swz`、`loadPolicyFile`、`xmlsocket://`、`SharedObject.getLocal`
- 抓出所有 `ExternalInterface.call("...")` 的方法名 → 决定是否真的需要浏览器容器

### 判定表

| 观察项 | 轨道 A (Ruffle) | 轨道 B (Flash) |
|---|---|---|
| 出登录页 | | |
| 出登录**框**（可输账号） | | |
| 日志能收到服务器包 | | |
| 中文正常 | | |
| 被弹走 | | |

**裁决规则**：能出登录框并连上 `1863` 的引擎胜出；两轨都通则 **Ruffle 优先**（无闭源依赖），把 Flash 投影器留作"高保真兼容模式"。

---

## 四、Phase 1 — 本地镜像（2–4 天）

`molemirror` 需要**同时支持两种模式**，因为两个引擎的接入方式不同：

| 模式 | 用于 | 接入方式 |
|---|---|---|
| **反向代理源站**（监听 `:80` + hosts 指向 127.0.0.1） | 轨道 B（Flash 走 WinINet / 直连域名） | `hosts: 127.0.0.1 mole.61.com`，本地 `:80` 应答 |
| **正向代理** | 轨道 A（Ruffle `--proxy` 或 `HTTP_PROXY`） | `--proxy http://127.0.0.1:8899` |

共同要求：
- 缓存键**保留原始目录结构**（不 hash），便于核对与打包
- 上游用 DoH 解析真实 IP 回源，避免自环
- 只缓存静态 GET（`mole.61.com` / `webres.61.com` / `game-res.61.com` / `res.61.com`，无 query）；登录、`account.61.com`、POST 一律透传
- 只缓存 HTTP 200；原子写（tmp + rename）
- `/__status`：已缓存条目数、体积、命中率、未命中清单
- **全量请求日志 = 客户端资源全景清单**（绕开未知的 manifest 格式）
- **白名单必须包含 `fpdownload.adobe.com`**（Flex 4 SWZ 宿主），且要能转存到本地
- **SWZ 专项处理**（否则界面可能直接崩）：
  - 缓存位置 `%APPDATA%\Adobe\Flash Player\AssetCache\`
  - 陷阱：SWZ 一旦被缓存过就再也不会请求，**同一份客户端在不同机器上表现可能不同**——所以不能靠"我这能跑"来判断
  - 用 JPEXS 在 AS3 里文本搜索 `.swz` 拿到字面 URL，按原路径镜像到本地
  - 现成素材：Flashpoint 安装目录 `Legacy\htdocs\fpdownload.adobe.com` 内含全部已知 SWZ，可直接取用

---

## 五、Phase 2 — 资源全量本地化（3–5 天）

- **2.1 静态爬取**：从 `Client.swf` + 5 个 DLL 的 ABC 常量池提取字符串字面量，筛资源路径（`resource/*`、`module/*`、`dll/*`、`.swf/.xml/.png/.mp3/.swz`）递归抓取。已有解包产物 `_re/official/*.inflated.bin` 可直接用
- **2.2 覆盖式游玩**：遍历地图、小游戏、装扮、背包、宠物，让按需缓存补全
- **2.3 离线校验**：代理切"离线模式"（不回源，未命中直接 404），跑主流程，缺口回填 manifest
- **2.4** 产出 `assets/`（保留原 URL 结构）+ `manifest.json` + 校验和
- 验收：**离线模式下能进游戏世界**

---

## 六、Phase 3 — 启动器（3–5 天）

.NET 7 + WPF/WinForms（SDK 与 WebView2 已就绪）：
- 自动启停 `molemirror`；单实例；托盘；日志
- 设置：分辨率 / 全屏 / 画质 / 代理开关 / 资源目录 / **引擎切换（Ruffle ↔ Flash）**
- 自动维护 hosts 条目（安装时写入，卸载时清理）
- 一键安装包：部署引擎运行时、建目录、生成配置

---

## 七、Phase 4 — 网络可观测（可选，3–5 天）

- 本地 TCP 代理（`127.0.0.1:1865` → `123.206.131.236:1865`），按已抓取格式回 `policy-file-request`
- 按 17 字节头解析为 `PktLen/Ver/CmdID/UserID/SN` 表格；接 `_re/RecMole-master/.../cmdlist.lua` 的 **1234 条 opcode 中文注释**
- 包体解密为加分项（密钥未知，密钥流周期 ≈22 字节，非赛尔默认键）

---

## 八、Phase 5 — 增强（可选）

- 服务器地址切换（官方 / 自建）
- 若要单机化：RecMole（Lua，2019 后停更，处于"极初期阶段"）或自写服务端；**赛尔号的 kose_seer 仍在活跃开发**（2026-03），同族协议可借鉴

---

## 九、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Ruffle `--spoof-url` 不足以破域名守卫（缺 `page_url`） | 轨道 A 失败 | 轨道 B 顶上；或转 MoleRuffle 源码树（同时设两者） |
| Ruffle `ByteArray.writeObject()` 空实现 | AMF 序列化的子模块不可用 | 主世界已实测可用；逐模块点亮；测不通的模块走 Flash 轨道 |
| Ruffle CJK 设备字体缺字 | 中文乱码 | MoleRuffle 已有字体回退链 + 内置 TTF，可直接搬 |
| Flash「版本过旧」循环 | 投影器无法启动 | hosts 5 行 + `settings.sol` 只读 |
| 误封 `fpdownload.adobe.com` | Flex 4 SWZ 加载失败，界面崩 | **明确不封**；按需镜像 SWZ |
| 投影器无真实 ExternalInterface | 官网 SSO 路径不可用 | 走**客户端内登录框**（已确认存在） |
| 上游 CDN 主机清单不全 | 漏缓存 | 代理全量日志兜底 |
| 资源体量未知（RecMole 镜像含数千 SWF） | 磁盘与时间 | 增量抓取；manifest 记体积；I: 盘 757GB 可用 |
| 官方改版 / 下线 | 客户端失效 | 本地已镜像资源不受影响 |

---

## 十、验收标准

| 你的需求 | 验收方式 |
|---|---|
| 网站 `mole.61.com` | 客户端从 `http://mole.61.com/Client.swf` 引导，域名守卫通过 |
| 官方通过 Flash 实现 | 引擎原样执行 AS3/Flex 客户端，**不打补丁**（Ruffle 或官方投影器） |
| 本地端连接官方服务器 | 连 `123.206.131.236:1863` → 服务器列表 → `:1865`，能进地图、走路、聊天 |
| 所有客户端资源存在本地 | **断网 + 代理离线模式下能进游戏世界**，`assets/` 完整且带校验和 |

---

## 十一、目录结构

```
I:\61mole\
├─ launcher\        .NET 7 启动器（含引擎切换）
├─ molemirror\      Node.js 本地镜像（反向代理源站 + 正向代理 双模式）
├─ runtime\
│   ├─ ruffle\      Ruffle 运行时
│   └─ flash\       官方投影器（来自淘米 zip）
├─ assets\          本地化客户端资源（保留原 URL 结构）
├─ tools\           SWF 常量池爬虫、离线校验器
├─ docs\            调研与实测记录
└─ _re\             调研素材（RecMole / MoleRuffle / TaomeeLibraryDLL / 解包 SWF）
```

---

## 十二、参考实现与可复用素材

| 项目 / 文档 | 用途 |
|---|---|
| [Flashpoint](https://flashpointarchive.org/)（Infinity 14.0.3 + **FPNavigator**） | **架构蓝本**：本地 web server「假装成互联网」+ launcher + WinINet 代理注入。也可直接拿来当现成容器跑 |
| [MoleRuffle](https://github.com/moleworld-dev/MoleRuffle) | 唯一实测跑通官方协议的 摩尔庄园 客户端；`apply_mole_settings`（spoof + socket 放行）与中文字体回退链可直接搬 |
| [TaomeeLibraryDLL](https://github.com/yy9819/TaomeeLibraryDLL) | 淘米 AS3 地基（摩尔/赛尔/功夫派共用）；`org.taomee.net.SocketImpl` 是 17 字节头的权威规格 |
| [Miigon/RecMole](https://github.com/Miigon/RecMole) | 摩尔庄园服务端逆向；`cmdlist.lua` 含 **1234 条 opcode 中文注释**（Phase 4 直接用） |
| [BaiSugar/kose_seer](https://github.com/BaiSugar/kose_seer) | 赛尔号服务端，**2026-03 仍活跃**；同族协议的分帧与网关拓扑可借鉴 |
| [iyzyi/SeerPacket](https://github.com/iyzyi/SeerPacket) · [dauphinYan/SeerAssistant](https://github.com/dauphinYan/SeerAssistant) | `com.fcc.MDecrypt/MEncrypt` 的两种独立公开实现（Phase 4 解密用） |
| [Cnotech/flash-collector](https://github.com/Cnotech/flash-collector) | 自带投影器的收集器；含 Referer 伪装、cookie 抓取、进度导出等启动器实现细节 |
| [median-dxz/seerh5-assistant](https://github.com/median-dxz/seerh5-assistant) | 「游戏资源反代」模式参考（已归档） |
| [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler) | SWF 审计与定点补丁工具；Phase 0 前置审计必用 |
| [摩尔博物馆 museum.61player.com](https://museum.61player.com/socket.html) | ⭐ **1234 条 opcode 中文协议表** + `ClientSocketDLL` 反编译源码（已镜像 769 个 `.as`）+ 自动抽取的 **441 条包体字段 schema**。详见 [`docs/museum-61player.md`](docs/museum-61player.md) |

---

## 十三、合规提示

- 摩尔庄园客户端资源版权归上海淘米。建议仅本地个人使用，**不再分发 `assets/`**
- **投影器来源优先级**：① 淘米官方 `61.com.tw/download/flashplayer.zip`（最佳来源，实测 200）② Internet Archive 的 Adobe 原版 ③ clean-flash-builds（有公开 patch 源码与哈希）。**避免来源不明的中文重打包版**
- 不要安装「中国特供版 Flash 中心」——其用户协议含 IP／访问链接／已装软件采集与无法关闭的个性化广告
- 连接官方服务器属使用官方服务，请遵守用户协议，不要用于自动化、作弊或批量登录

---

## 十四、批准后立刻执行

**Phase 0 双轨赛马 + JPEXS 审计**。半天内出结论，先拿给你看，再决定主线并推进 Phase 1。
