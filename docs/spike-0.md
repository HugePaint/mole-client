# Phase 0 可行性验证 · 实测记录

> 结论：**PASS**。Ruffle 单引擎路线成立，无需编译 Ruffle 源码，无需对官方 SWF 做任何补丁。
> 日期：2026-06 · 机器：Windows 10 专业版 / GTX 1080 Ti / Node v14.3.0

---

## 一、判定结论

| 验收项 | 结果 | 证据 |
|---|---|---|
| 过域名守卫（不被 `navigateToURL` 弹回首页） | ✅ 通过 | 进程稳定存活 55s+，日志无 `navigateToURL` |
| 加载引导器 `Client.swf` | ✅ | `Loaded SWF version 14, resolution 960x560 @ 24 FPS` |
| TaomeeVersionManager 解析版本清单 | ✅ | 请求 `version/zzz_config.txt` → `version/version1452075536.swf` |
| 加载全部 5 个 DLL 模块 | ✅ | TaomeeCore / ClientConfig / ClientCommon / ClientSocket / ClientApp 全部 200 |
| 加载登录 UI | ✅ | `resource/login/Login.swf` + `LoginHome.swf` + `main_resource.swf` |
| **渲染出登录界面且可输入** | ✅ **人工确认** | 用户确认：登录界面有账号/密码输入框，可以打字 |
| **连上官方服务器** | ✅ **实测** | Ruffle 进程建立 TCP `123.206.131.236:1865` **Established**（见第九节） |
| **登录成功并进入游戏世界** | ✅ **实测** | 开始拉取 `resource/ui/index.swf`、`resource/map/Map_10010.swf`、`NPCInfoList.xml`、`BGM_006c.mp3` |
| 资源可完全本地化 | ✅ | 离线模式下 17/17 命中本地磁盘，mole.61.com 零回源 |

**关键判断：用预编译 Ruffle + 命令行开关 + 本地镜像代理即可跑通，不需要构建 MoleRuffle 源码树。**
MoleRuffle 改源码做的四件事，官方 Ruffle 命令行全都已具备：

| MoleRuffle 改源码 | 官方 Ruffle 现成开关 |
|---|---|
| `with_spoofed_url` / `with_page_url` | `--spoof-url` （实测足以破域名守卫） |
| `SocketMode::Allow` + `confirm_socket` | `--tcp-connections allow` `--socket-allow host:port` |
| `base_url` | `--base` |
| `DiskStorageBackend` | `--storage disk --save-directory` |
| `CachingNavigator` 资源缓存 | `--proxy` + `molemirror` 本地镜像（本项目实现） |

MoleRuffle 的价值转为**参考实现**：其 `apply_mole_settings` 的字体回退链、`cache.rs` 的缓存分桶思路可直接借鉴。

---

## 二、环境

| 项 | 值 |
|---|---|
| Ruffle | `0.7.0-nightly.2026.10.4-nightly (dcc85a1b)` — 预编译 Windows x64 |
| Ruffle 路径 | `runtime\ruffle\ruffle.exe` |
| Node | v14.3.0（`molemirror` 只用核心模块，无外部依赖） |
| MSVC | VS2019 Community / MSVC 14.28.29333 x64（本阶段未用到，留给后续需要编译时） |
| Windows SDK | 10.0.18362.0 |

---

## 三、可复现启动命令

```powershell
# 1) 启动本地镜像（正向代理 8899 / 反向代理源站 8080 / 控制接口 8898）
node molemirror\index.js                 # 在线模式
node molemirror\index.js --offline       # 离线模式（拒绝一切回源）

# 2) 启动 Ruffle
$env:HTTP_PROXY='http://127.0.0.1:8899'; $env:HTTPS_PROXY='http://127.0.0.1:8899'
.\runtime\ruffle\ruffle.exe "http://mole.61.com/Client.swf" `
  --base              "http://mole.61.com/" `
  --spoof-url         "http://mole.61.com/Client.swf" `
  --proxy             "http://127.0.0.1:8899" `
  --config            "I:\61mole\data\config" `
  --cache-directory   "I:\61mole\data\cache" `
  --storage disk --save-directory "I:\61mole\data\SharedObjects" `
  --tcp-connections allow `
  --socket-allow 123.206.131.236:1863 `
  --socket-allow 123.206.131.236:1865 `
  --socket-allow 123.206.131.63:3200 `
  --player-version 32 `
  --scale show-all --force-scale `
  --width 1000 --height 620 --no-gui
```

> `--scale show-all`（带连字符，不是 `showAll`）。Ruffle 桌面版**不解析 SWF URL 上的 query string**，
> 需要 flashvars 时必须用 `-P key=value`。

---

## 四、实测发现的三个真实缺陷（均已修复）

### 4.1 Ruffle 默认配置目录创建失败 → 必须先加 `--config`

**现象**：Ruffle 启动即退出，exit code 0，无任何输出，连自己的数据目录都不创建。

**抓到的真因**（把 stdout/stderr 重定向后才看到）：

```
Error: Failed to create configuration directory
Caused by: 拒绝访问。 (os error 5)
```

即默认的 `%LOCALAPPDATA%\ruffle` 创建被拒（手工 `New-Item` 却能创建，属 Ruffle 自身的创建方式问题）。

**修复**：始终显式传 `--config <项目内目录>`，同时也让全部状态落在项目目录内便于清理。
`--storage` 的默认目录也有同样问题，一并显式传 `--save-directory`。

### 4.2 缓存击穿参数导致「资源无法本地化」→ 缓存键必须剥离 query

**现象**：冷启动 120 次请求只落盘 5 个文件。

**真因**：客户端给几乎每个静态资源都追加随机缓存击穿参数：

```
http://mole.61.com/dll/TaomeeCoreDLL.swf?iekywkx4
http://mole.61.com/resource/ui/main_resource.swf?i0nykd8o
http://mole.61.com/resource/xml/ext.xml?i816xnyw
```

原实现把「带 query」一律判为动态不缓存 → 同一份资源被无限重复回源。

**修复**：静态文件类型（有扩展名）一律**剥离 query 再作为缓存键**。

**修复后实测**：

| 轮次 | 请求 | 命中缓存 | 回源 |
|---|---|---|---|
| 冷启动 | 22 | 17（其中大部分不可用） | 5 |
| 热启动（单轮） | 20 | **16** | **4** |

热启动那 4 个回源里，唯一属于 `mole.61.com` 的是 `version/zzz_config.txt`（TTL 探针，见 4.3），
其余 3 个是 `newmisc.taomee.com` 埋点。**静态资源已零回源。**

### 4.3 `version/zzz_config.txt` 是硬依赖 → 需要 TTL 而非「永不缓存」

**现象**：离线模式首轮只完成 1 个请求就停了。

**真因**：`zzz_config.txt` 一旦失败，客户端走 `TaomeeVersionLoader/configErrorHandler`
**直接终止整条加载链**（绝不继续加载 dll 模块）：

```
ERROR ruffle_core::avm2: Error dispatching event "ioError": Error: 版本配置文件加载失败
	at com.taomee.plugins.versionManager::TaomeeVersionLoader/configErrorHandler()
```

**修复**：改为 TTL 资源语义——在线超过 6 小时则回源刷新，离线则用陈旧值兜底。

### 4.4 附带发现：TaomeeVersionManager 的清单格式（原本是未解问题）

研究阶段发现「无人逆向过 `TaomeeVersionManager` 的 manifest 格式」。实测直接解开了：

```
version/zzz_config.txt          → 内容 "1452075536"
version/version1452075536.swf   → 314.6 KB，即版本清单本体（是 SWF，不是文本/XML）
```

即清单文件名 = `version/version` + `zzz_config.txt` 的内容 + `.swf`。
`config/Server.xml` 里 `allversion="A=A0.30"` 那套命名空间未在此路径上使用。

---

## 五、离线验收（对齐「所有客户端资源存在本地」）

离线模式（代理拒绝一切回源）实测：

```
离线轮请求 22 条：cache 17 / override 1 / offline-miss 4
```

| 来源 | 数量 | 说明 |
|---|---|---|
| `cache` | **17** | **全部客户端资源命中本地磁盘** |
| `override` | 1 | `login.mole.61.com/ip.txt` 本地覆写 |
| `offline-miss` | 4 | 全是 `newmisc.taomee.com` 埋点，fire-and-forget，无功能影响 |

**mole.61.com 零回源、零加载错误**，客户端完整启动到登录界面。

### 引导集清单（17 个文件 / 7.10 MB）

| # | 大小 | 资源 |
|---|---|---|
| 1 | 20.2 KB | `Client.swf` |
| 2 | 0.5 KB | `config/Server.xml` |
| 3 | 1,223.1 KB | `dll/ClientAppDLL.swf` |
| 4 | 419.4 KB | `dll/ClientCommonDLL.swf` |
| 5 | 780.9 KB | `dll/ClientConfigDLL.swf` |
| 6 | 510.9 KB | `dll/ClientSocketDLL.swf` |
| 7 | 1,107.0 KB | `dll/TaomeeCoreDLL.swf` |
| 8 | 721.3 KB | `module/external/logo/51moleInfo0.swf` |
| 9 | 19.3 KB | `module/external/logo/Logo.swf` |
| 10 | 460.8 KB | `module/external/logo/randomMC.swf` |
| 11 | 478.4 KB | `resource/login/Login.swf` |
| 12 | 171.7 KB | `resource/login/LoginHome.swf` |
| 13 | 1,040.2 KB | `resource/ui/main_resource.swf` |
| 14 | 1.0 KB | `resource/xml/ext.xml` |
| 15 | 0.2 KB | `resource/xml/logo/loadingWord.xml` |
| 16 | 314.6 KB | `version/version1452075536.swf` |
| 17 | 0.0 KB | `version/zzz_config.txt` |

缓存目录**完整保留原始 URL 结构**（`cache/mole.61.com/dll/ClientSocketDLL.swf`），便于人工核对与打包。
完整清单见 `resources/manifest.tsv` / `resources/manifest.json`。

---

## 六、服务端实测补充

### 6.1 `login.mole.61.com` 的 80 端口已关闭

```
GET http://login.mole.61.com/ip.txt  → connect ECONNREFUSED 123.206.131.236:80
```

`config/Server.xml` 的 `MOUrl="login.mole.61.com"` 就是让客户端查这个端点来发现登录服地址。
官方 80 端口已关（该主机只开 1863），所以这步**必然失败**，客户端随后还会去尝试两个早已下线的
老错误上报服务器（`123.150.163.99:80`、`125.39.236.145:80`，均超时）。

**这不致命**——`config/Server.xml` 里已有直连 IP+端口，客户端会兜底。
但会白等约 2 秒并刷失败埋点。已用**本地覆写**消除：

```
login.mole.61.com/ip.txt  →  "123.206.131.236:1863"
```

格式依据 RecMole 的 `loginip.lua`（返回 `host:port`）。实测 `X-MoleMirror: OVERRIDE`，`ms=0`。

### 6.2 服务器端口与策略文件（复核）

| 端点 | 状态 |
|---|---|
| `123.206.131.236:1863` 登录服 | TCP 可连，返回 allow-all 策略文件 |
| `123.206.131.236:1865` 游戏服 | 客户端实际连接目标（来自登录服返回的服务器列表） |
| `123.206.131.63:3200` 游戏服 | `config/Server.xml` 声明值 |
| `123.206.131.63:843` | 返回 `<allow-access-from domain="*" to-ports="*"/>` |

---

## 七、Ruffle 侧观察到的 stub 与告警（当前均不致命）

```
WARN ruffle_core::stub: Encountered stub: AVM2 flash.system.Security.allowDomain()
WARN ruffle_core::stub: Encountered stub: AVM2 flash.utils.Dictionary constructor with weak keys
WARN ruffle_core::stub: Encountered stub: AVM2 flash.net.URLLoader.close()
WARN ruffle_core::stub: Encountered stub: AVM2 flash.net.URLStream constructor streaming support
WARN ruffle_core::stub: Encountered stub: AVM2 flash.display.NativeMenuItem constructor
WARN ruffle_core::stub: Encountered stub: AVM2 flash.display.Loader.load() addChild at the correct time
WARN ruffle_core::stub: Encountered stub: AVM2 flash.media.Video.clear()
WARN ruffle_core::library: Unknown device font "SimSun" (bold: true, italic: false)
WARN ruffle_desktop::gui::controller: Failed to register [Name("Noto Sans CJK"), ...] as Proportional: no unicode fonts found!
```

与预研报告一致：`URLStream` 流式加载与 `ByteArray.writeObject()` 是 Ruffle 已知短板，
本轮启动链路未受影响，需在进入游戏世界与各小游戏时持续观察。

**待办**：CJK 设备字体（`SimSun` bold 变体未命中）需配置 Ruffle 字体回退，
否则动态文本（玩家名/聊天）可能缺字。MoleRuffle 的 `set_mole_fonts` 回退链可直接照搬。

---

## 九、登录实测：连上官方服务器并进入游戏世界（Phase 0 收口）

用户在自己机器上于 Ruffle 窗口内完成了一次真实登录。以下为客观观测结果。

### 9.1 TCP 连接证据

用持续采样监视器 [`tools/monitor-tcp.ps1`](../tools/monitor-tcp.ps1)（400 ms 轮询，
因为登录连接可能很快断开，一次性检查会漏）记录到：

```
--- monitor start pid=6008 at 2026-10-05 02:55:56 ---
02:56:00.252  123.206.131.236:1865/Established
```

实时复核（登录后较长时间仍存活）：

```
      State RemoteAddress   RemotePort CreationTime
Established 123.206.131.236       1865 2026/10/5 2:55:58
```

**结论：本地 Ruffle 客户端与官方服务器建立了真实的、持续的 TCP 连接。**

原始记录：[`docs/evidence-tcp-connections.log`](evidence-tcp-connections.log)

### 9.2 两点值得记录的观察

1. **客户端直接连 `1865`，没有先连 `1863`。** 这与 RecMole 抓到的 `alog.txt`
   （`___user___ 123.206.131.236 1865`）以及我们此前对 `config/Server.xml` 的分析一致：
   `Server.xml` 里声明的 `GameSer 123.206.131.63:3200` **不是**客户端实际使用的地址。
   真正的游戏服地址来自 opcode **10007「重定向到GameServer」** 的响应
   （字段：`IP(utf) | Port(u16) | Count(u8) | UserID(u32) | Itemid(u8)`，见
   [`docs/museum-61player.md`](museum-61player.md)）。
2. **`Security.loadPolicyFile()` 在 Ruffle 里是空实现**：
   ```
   WARN ruffle_core::stub: Encountered stub: AVM2 flash.system.Security.loadPolicyFile()
   ```
   即 Ruffle 完全忽略策略文件，靠 `--tcp-connections allow` 放行。连接仍然成功，
   说明我们**不需要**依赖官方 843 端口的策略文件（虽然它确实存在且是 allow-all）。

### 9.3 进入游戏世界的证据（资源侧）

登录后客户端立即开始拉取游戏世界资源，全部经由 `molemirror`：

| 类别 | 样例 |
|---|---|
| 主 UI | `resource/ui/index.swf`、`topUI.swf`、`ui.swf` |
| **地图** | `resource/map/Map_10010.swf` + `Map_10010.xml` |
| 装扮 | `resource/cloth/bmpswf/1001/*.swf`、`1002/*.swf`（21 个） |
| 宠物装扮 | `resource/petcloth/swf2/1200021.swf` |
| 坐骑 | `resource/dragon/bmpswf/1350004_big_a.swf` 等 4 个 |
| 配置数据 | `resource/xml/NPCInfoList.xml`、`ModuleInfoList.xml`、`Task9.xml`、`SuitSwap.xml`、`socket/SocketErrorConfig.xml` |
| 音频 | `resource/bgSounds/BGM_006c.mp3`、`resource/soundLib/lib1.swf` |
| 模块 | `module/angelFight/AngelFight.swf`、`module/lamuPKSys/AnimalSkillControler.swf`、`module/external/Speaker.swf` |

### 9.4 资源镜像的增长

| 时点 | 条目 | 体积 |
|---|---|---|
| 登录界面为止 | 17 | 7.10 MB |
| **登录并进入游戏世界后** | **69** | **15.27 MB** |

按需缓存机制在真实游玩下自然工作——**这正是 Phase 2「资源全量本地化」的采集通道**，
无需另写爬虫即可持续积累。完整清单见 [`resources/manifest.tsv`](../resources/manifest.tsv)，
请求流水见 [`docs/evidence-requests.jsonl`](evidence-requests.jsonl)。

### 9.5 达成判定

Phase 0 的全部验收项（过域名守卫 / 加载引导器 / 解析版本清单 / 加载 5 个 DLL /
出登录页 / **连上官方服务器** / 进入游戏世界）**均已实测通过**，
且全程**未对官方 SWF 做任何补丁**。

---

## 十、下一步（Phase 2）

1. **反向代理源站模式验证**：写 hosts（`127.0.0.1 mole.61.com`）+ 本地 8080，验证 SWF 自认在官网且相对路径全部回本地。此模式可彻底摆脱环境变量代理配置。
2. **CJK 字体回退**：配置 Ruffle 的 `defaultFonts`，消除 `Unknown device font "SimSun"`。
3. **Phase 2 全量本地化**：从 6 个 SWF 的 ABC 常量池提取资源路径字面量递归抓取 + 覆盖式游玩补全 + 离线缺口回填。
4. **登录链路实测**：需用户提供淘米账号，验证 `1863` → 服务器列表 → `1865` 的完整流程（本轮因无凭据未测）。
