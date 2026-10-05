# 摩尔庄园 · 本地客户端

把 [mole.61.com](http://mole.61.com) 的 Flash 客户端做成 **Windows 本地客户端**：
游戏引擎与客户端资源都在本机，账号登录与游戏内容仍连**官方服务器**。

| | |
|---|---|
| **引擎** | [Ruffle](https://ruffle.rs)（原样执行官方 AS3/Flex 客户端，**不打任何补丁**） |
| **平台** | Windows（.NET 7 桌面运行时 + Node.js） |
| **启动器** | .NET 7 + WPF，单文件安装包 11.4 MB |
| **官方服务器** | `123.206.131.236:1863` / `:1865`（裸 TCP，实测策略放行） |

---

## 它做了什么

官方客户端是 Flash 的，跑在浏览器里。这个项目做的事可以概括成三件：

1. **让它脱离浏览器运行** —— 用 Ruffle 原样执行官方 `Client.swf`；
2. **让它以为自己还在官网** —— 通过 Ruffle 的 `--spoof-url` 等命令行开关满足客户端的域名校验；
3. **把资源搬到本地** —— 一个本地镜像按需抓取官方 CDN 资源并落盘，之后一直从本地读。

**全程不修改任何官方文件。** 已用 SHA256 逐一比对确认：本地缓存的
`Client.swf`、`ClientAppDLL.swf`、`ClientCommonDLL.swf`、`ClientConfigDLL.swf`、
`TaomeeCoreDLL.swf` 与源站**逐字节一致**。

---

## 架构

```
┌─────────────────┐
│  MoleLauncher   │  WPF 启动器：状态面板 / 设置 / 托盘 / 日志
│   (.NET 7)      │  自动启停镜像、注入 Ruffle 参数
└────────┬────────┘
         │ ① 启动
         ▼
┌─────────────────┐
│   molemirror    │  本地镜像（Node.js）
│   正向代理 :8899 │  · 正向代理：Ruffle 的资源请求走这里
│   反向源站 :8080 │  · 反向代理：把 mole.61.com 指到本机
│   控制接口 :8898 │  · 磁盘缓存：按原始 URL 结构落盘
└────────┬────────┘
         │ ② 缓存命中则本地读，未命中回源抓取
         ▼
┌─────────────────┐
│  ruffle.exe     │  游戏引擎 → 官方服务器（裸 TCP，不经镜像）
└─────────────────┘
```

**关键设计**：镜像只代理 HTTP 资源，**不碰游戏协议**。登录与游戏数据走官方 TCP 直连，
因此这不是私服，只是"资源本地化 + 本地引擎"。

---

## 快速开始

### 方式一：安装包

双击 `installer/MoleClient-Setup.exe`（需先自行构建，见下）。

### 方式二：从源码

```powershell
# 依赖：Windows + .NET 7 SDK + Node.js
git clone <repo>
cd 61mole

# 1) 准备引擎（放到 runtime\ruffle\ruffle.exe）
#    可从 https://ruffle.rs/downloads 下载 windows-x64 版
#    或用启动器的「设置 → 下载…」自动获取

# 2) 启动（会自动拉起本地镜像）
.\run.ps1
```

### 构建启动器与安装包

```powershell
# 发布启动器
powershell -ExecutionPolicy Bypass -File launcher\build-launcher.ps1

# 打包成单文件安装包
powershell -ExecutionPolicy Bypass -File installer\make-setup.ps1
```

---

## 仓库结构

```
61mole/
├── molemirror/index.js        本地镜像（正向代理 + 反向代理 + 磁盘缓存）
├── launcher/MoleLauncher/     启动器（.NET 7 + WPF，15 个源文件）
├── installer/                安装包
│   ├── MoleSetup/             自解压引导器（C#）
│   ├── make-setup.ps1         打包脚本
│   └── install.ps1            安装逻辑
├── tools/                     逆向与资源发现工具链（20+ 个 Node 脚本）
├── resources/                 生成的索引与证据数据
├── docs/                      设计文档与实测记录
├── run.ps1                    一键启动脚本
└── PLAN.md                    项目计划与进度
```

---

## 文档

| 文档 | 内容 |
|---|---|
| [`PLAN.md`](PLAN.md) | 项目计划、各阶段进度与指标 |
| [`docs/spike-0.md`](docs/spike-0.md) | Phase 0 技术验证：Ruffle 参数逐项实测 |
| [`docs/museum-61player.md`](docs/museum-61player.md) | 博物馆数据接口分析 |
| [`docs/phase2-static-crawl.md`](docs/phase2-static-crawl.md) | 资源本地化方法 |
| [`docs/prefix-resolution.md`](docs/prefix-resolution.md) | 路径模板破解（密集探测 + `newTask` 嵌套结构） |
| [`docs/cloth-group-pattern.md`](docs/cloth-group-pattern.md) | 衣服位图命名规则破解 |
| [`docs/launcher.md`](docs/launcher.md) | 启动器设计、Ruffle 参数说明、编码坑记录 |
| [`docs/installer.md`](docs/installer.md) | 安装包三次方案迭代与缺陷记录 |
| [`docs/phase2-acceptance.md`](docs/phase2-acceptance.md) | 离线验收报告 |
| [`docs/encoding-notes.md`](docs/encoding-notes.md) | **编码注意事项** —— Windows 上跨进程/接口传中文的坑与检查清单 |
| [`docs/fonts.md`](docs/fonts.md) | **中文字体** —— 设备字体（宋体/SimSun）为何回退，以及一键安装原创宋体的办法 |

---

## 项目数据

| 指标 | 值 |
|---|---|
| 本地资源 | 26,000+ 个 / 约 1.2 GB |
| 离线验收 | 15,075 条工作负载 → 100% 缓存命中 |
| 路径模板 | 29 条中 18 条落地真实文件，11 条经密集探测判定源站不存在 |
| 衣服位图 | 11,178 个（组空间规则已破解） |

> `cache/` 不入库 —— 资源由镜像在运行时按需抓取。玩得越多，本地越完整。

已抓取到的资源快照单独放在私有仓库
**[mole-resource](https://github.com/HugePaint/mole-resource)**（约 1.27 GB / 26,720 个文件）。
它只是为了省去重新下载的时间，**不是本项目的必要组成部分** —— 用本项目跑一遍就会重新抓下来。
放在私有仓库是因为这些资源版权归上海淘米，不适合公开分发。

---

## 免责声明

- **游戏客户端资源版权归上海淘米所有。** 本仓库**不包含任何游戏资源**，
  只包含自行编写的工具与文档。运行时从官方地址按需获取。
- 连接官方服务器属于使用官方服务，请遵守其用户协议。
- 本项目仅供**个人学习与本地使用**，请勿分发通过本项目获取的游戏资源。
- 仓库中的请求证据文件（`docs/evidence-requests.jsonl`、
  `resources/client-request-set.txt`）**已对账号等个人标识做脱敏处理**。

---

## 许可证

[MIT](LICENSE)
