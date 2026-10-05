# 摩尔庄园本地客户端 · 安装说明

## 这是什么

一个 **Windows 本地客户端**：游戏引擎与客户端资源都在你自己机器上，网络仍连官方服务器。

| 你的需求 | 实现方式 |
|---|---|
| 网站 mole.61.com | 客户端从 `http://mole.61.com/Client.swf` 引导，域名守卫已被参数破解 |
| 官方通过 Flash 实现 | 用 **Ruffle** 原样执行官方 AS3/Flex 客户端，**不打任何补丁** |
| 本地端连接官方服务器 | 直连官方服 `123.206.131.236:1863 / 1865`，策略文件已实测放行 |
| 所有资源存在本地 | 本地镜像按需抓取并落盘，**断网也能进游戏** |

---

## 安装

双击 **MoleClient-Setup.exe**，按提示确认即可。

- 默认安装到 `%USERPROFILE%\MoleClient`
- 自动创建桌面与开始菜单快捷方式
- 需要 **.NET 7 桌面运行时**（若目标机没有，请到 <https://dotnet.microsoft.com/download/dotnet/7.0> 装 Desktop Runtime）
- 若安装包内**不含** Ruffle，首次运行请在启动器的「设置 → 下载…」里获取

### 手工安装（不用安装包）

把本目录内容整个拷到任意可写目录，运行 `install.ps1`：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -TargetDir D:\MoleClient
```

---

## 使用

1. 双击桌面「摩尔庄园」
2. 启动器会自动拉起本地镜像，点 **▶ 启动游戏**
3. 在客户端自带的登录框里输入淘米账号密码

### 资源本地化是"越玩越全"的

首次启动时 `cache\` 是空的，镜像会**边玩边从官方 CDN 抓取并落盘**。
抓过的资源之后都从本地读——所以玩得越多、去过的地方越多，本地就越完整。

想看当前进度，启动器主界面上有三个数字：**本地资源数 / 体积 / 命中率**。

### 离线验证

设置里勾上 **「离线模式」** 再启动：镜像会**拒绝一切回源**，
能进到登录界面就说明资源确实都在本地了。

---

## 目录结构

```
MoleClient\
├── MoleLauncher.exe        启动器
├── molemirror\index.js     本地镜像（正向代理 + 反向代理源站 + 磁盘缓存）
├── runtime\ruffle\         游戏引擎
├── cache\                  客户端资源（按需抓取，保留原始 URL 结构）
├── data\                   配置与引擎状态（settings.json / config / SharedObjects）
├── logs\                   日志
└── uninstall.ps1           卸载
```

---

## 卸载

```powershell
# 连资源一起删
powershell -ExecutionPolicy Bypass -File uninstall.ps1

# 保留 cache\（已下载的游戏资源），下次装回来不用重下
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -KeepCache
```

---

## 常见问题

**游戏窗口一闪就没了？**
多半是 Ruffle 找不到可写的配置目录。启动器已经显式传了 `--config`，若仍异常请看 `logs\launcher.log`。

**中文显示为方块？**
Ruffle 的 CJK 设备字体回退有告警（`Unknown device font "SimSun"`）。
多数界面正常，个别动态文本可能缺字。

**登录时提示版本过旧？**
本客户端不修改官方文件，这类提示来自官方侧；请确认网络能正常访问 `mole.61.com`。

**能离线玩吗？**
能进登录界面。但**登录与游戏内容本身需要官方服务器**——本客户端是"资源本地化"，不是"私服"。

---

## 合规提示

游戏客户端资源版权归**上海淘米**所有。本工具不含任何游戏资源，
运行时从官方地址按需获取。建议**仅本地个人使用，不要分发 `cache\` 目录**。
连接官方服务器属使用官方服务，请遵守其用户协议。
