# Phase 3 · 本地客户端启动器

> .NET 7 + WPF 桌面壳。负责：自动启停本地镜像、注入 Ruffle 参数、设置界面、托盘与日志。
> 位置：`launcher/MoleLauncher/`；发布产物：`launcher/publish/`。

---

## 一、为什么参数是"注入"而不是"改客户端"

启动器**不修改任何官方文件**。它做的全部事情是：

1. 把 `HTTP_PROXY` 指向本地镜像（`molemirror`），让引擎从本地取资源；
2. 给 Ruffle 传入一组命令行开关，把「客户端以为自己在哪里」伪装成官网。

这与 Phase 0 的结论一致：**官方 Ruffle 桌面版的命令行开关已经覆盖了 MoleRuffle 改源码所做的全部事情**，
因此不需要编译引擎、也不需要补丁。

---

## 二、项目结构

```
launcher/
├── build-launcher.ps1              发布脚本（框架依赖 / 自包含 / 打包 zip）
└── MoleLauncher/
    ├── MoleLauncher.csproj
    ├── App.xaml(.cs)               入口；含 --print-command 调试模式
    ├── MainWindow.xaml(.cs)        主界面：状态、统计、启停、日志
    ├── SettingsWindow.xaml(.cs)    设置：路径 / 端口 / 模式 / 画面 / 高级
    ├── Models/AppSettings.cs
    └── Services/
        ├── PathResolver.cs         自动探测项目根 / node / Ruffle
        ├── SettingsService.cs      配置读写（项目内优先）
        ├── LogService.cs           应用内日志 + 落盘
        ├── MirrorService.cs        molemirror 进程生命周期与 /__status 轮询
        └── RuffleService.cs        参数装配与 Ruffle 进程管理
```

---

## 三、界面

![启动器界面](launcher-ui.png)

- **状态徽章**：镜像运行中 / 游戏运行中 / 在线或离线模式
- **统计**：本地资源数、体积、请求与缓存命中数、命中率（2 秒轮询 `/__status`）
- **按钮**：启动游戏、停止全部、设置、打开缓存目录、打开日志
- **命令行预览**：可折叠，展示实际会执行的完整 Ruffle 命令行（便于排查）
- **日志**：按级别着色（OK 绿 / WRN 黄 / ERR 红），同时写入 `logs\launcher.log`
- **托盘**：关闭窗口最小化到托盘，游戏继续运行；托盘菜单可显示主窗口 / 启动 / 停止 / 退出

---

## 四、Ruffle 参数逐项说明

`RuffleService.BuildArguments()` 里的每一项都对应 Phase 0 实测到的一个具体问题：

| 参数 | 为什么必须有 |
|---|---|
| `--spoof-url http://mole.61.com/Client.swf` | 破域名守卫。`Client.swf` 检测到自己不在官网会 `navigateToURL("http://mole.61.com")` 把自己弹走 |
| `--base http://mole.61.com/` | `version/` `resource/` `config/` `dll/` 都是相对路径，必须给基准 |
| `--config <root>\data\config` | ⚠️ **必须显式指定**。默认的 `%LOCALAPPDATA%\ruffle` 创建会被拒（`os error 5`），Ruffle 会**静默退出且不打印任何东西** |
| `--tcp-connections allow` | 游戏用 `flash.net.Socket` 连官方服务器，默认策略会拦 |
| `--socket-allow ×3` | 白名单：登录服 `1863`、游戏服 `1865`、`Server.xml` 声明的 `3200` |
| `--player-version 32` | 客户端按 plugin 版本判断兼容性 |
| `--scale show-all --force-scale` | 客户端自设 `NoScale`，不强制会在小窗口溢出 |
| `--proxy` + `HTTP_PROXY` | 双保险：命令行参数与标准环境变量都设，确保资源走本地镜像 |
| `--no-gui` | 隐藏 Ruffle 菜单栏 |

### 客观验证方式

启动器提供 `--print-command`，不启 UI，只打印将要执行的命令行：

```powershell
.\launcher\publish\MoleLauncher.exe --print-command
```

实测输出（节选）：

```
Ruffle 命令行:
  "I:\61mole\runtime\ruffle\ruffle.exe" http://mole.61.com/Client.swf --base http://mole.61.com/
  --spoof-url http://mole.61.com/Client.swf --config I:\61mole\data\config
  --cache-directory I:\61mole\data\cache --storage disk --save-directory I:\61mole\data\SharedObjects
  --tcp-connections allow --socket-allow 123.206.131.236:1863 --socket-allow 123.206.131.236:1865
  --socket-allow 123.206.131.63:3200 --player-version 32 --scale show-all --force-scale
  --width 1000 --height 620 --proxy http://127.0.0.1:8899 --no-gui
```

与 `docs/spike-0.md` 里手工验证过的参数集**逐项一致**。

---

## 五、AppData / %TEMP% 写入被拒：两次判断，两次都不准

这一节记录一个**我改了两次才搞对**的结论。留着它是因为过程本身有教学价值。

### 5.1 第一次观测

首次运行时配置**没有写成功**，而且因为当时用的是空的 `catch {}`，完全没有痕迹。
把静默捕获改成记录日志后，真因立刻显现：

```
配置保存失败：Access to the path 'C:\Users\iyyh\AppData\Roaming\MoleLauncher' is denied.
```

**当时的结论**：这台机器在 `%APPDATA%` / `%LOCALAPPDATA%` 下新建目录会被拒，
并与 Ruffle 的 `Failed to create configuration directory (os error 5)` 归为同一根因。

### 5.2 第一次更正（矫枉过正）

复测时用 **PowerShell** 与 **.NET `Directory.CreateDirectory`** 都能创建该目录，
CFA（受控文件夹访问）也是关闭的，ACL 正常。于是我推翻了自己：

> 那次是偶发（可能是杀软对新建未签名 exe 首次写 AppData 的瞬时拦截），不是持续性策略。

**这个更正仍然是错的** —— 因为我用 PowerShell 去"验证"，而 PowerShell 是受信任的签名程序，
它本来就不在拦截范围内。**用不受限的工具去验证受限主体的行为，方法本身就不成立。**

### 5.3 第二次更正：真正的原因

第三轮做 `--download-ruffle` 时，出现了**稳定复现**的同类错误：

```
下载失败：Access to the path 'C:\Users\iyyh\AppData\Local\Temp\ruffle-<guid>.zip' is denied.
```

于是做了一组对照实验：

| 主体 | 写 `%TEMP%` | 写项目内目录 | 说明 |
|---|---|---|---|
| **MoleLauncher.exe**（未签名、自编译） | ❌ **Access denied** | ✅ 正常 | 复现 2/2 |
| `cmd.exe`（系统签名） | ✅ 正常 | — | |
| `node.exe`（第三方签名） | ✅ 正常 | — | |
| PowerShell（签名） | ✅ 正常 | — | |

同时确认：CFA = 0、ASR 规则为空、只装了 Windows Defender、`%TEMP%` 的 ACL 里用户是 FullControl。

**结论**：这不是机器级的目录策略，而是**针对"未签名的自编译二进制"写用户 profile 目录的拦截**
（Defender 或其它安全软件的启发式，签名程序不受影响）。
所以它**既不是机器策略、也不是偶发**——是**只对这个二进制稳定复现**。

### 5.4 处理方式

不跟它对抗，直接绕开——**所有临时/配置/状态文件一律放项目内**：

| 用途 | 位置 |
|---|---|
| 启动器配置 | `<root>\data\settings.json`（AppData 仅作兜底） |
| Ruffle 的 `--config` | `<root>\data\config` |
| 下载暂存 | `<root>\data\temp`（**刻意不用 `%TEMP%`**） |
| 缓存 / 日志 | `<root>\cache`、`<root>\logs` |

改完后下载功能实测通过（19.3 秒，25.76 MB，暂存零残留）。

这与"本地/便携客户端"的定位也一致：不依赖用户 profile 的权限状态，换机器直接可用。

### 5.5 与 Ruffle `os error 5` 的关系

Ruffle 的情况是**稳定复现**的：它每次启动都报
`Failed to create configuration directory (os error 5)`，
而 PowerShell 手工创建同一个 `%LOCALAPPDATA%\ruffle` 却成功。

以 5.3 的结论看，这很可能是**同一类拦截**（Ruffle 是第三方未签名的独立 exe）。
但这一条我没有做更深入的验证，只能说"与 5.3 的现象一致"，**不做确定性断言**。

无论根因如何，`--config` 显式指定目录**仍然是必需的**（启动器里已硬编码）。

### 5.6 教训

1. **一次观测不能推成机器级结论**（第一次犯的错）；
2. **验证工具的权限/信任级别必须与被验证主体一致**（第二次犯的错）——
   拿 PowerShell 去证明"这个目录可以写"，对 MoleLauncher.exe 毫无意义；
3. 在 Windows 上排查"Access denied"时，**先分清是 ACL、策略、还是按主体的安全软件拦截**。

### 5.7 附带修掉的一处同类问题

脚本 `build-launcher.ps1` 一开始完全无法运行，报 `The term '//' is not recognized` 与
`The string is missing the terminator`。原因有两个：

1. 我误用了 C# 的 `//` 注释（PowerShell 是 `#`）；
2. **更隐蔽的一条**：PowerShell 5.1 读取 `.ps1` 时若无 BOM 会按 **ANSI** 解码，
   脚本里的中文变成乱码字节，其中某些序列被当成引号，导致解析崩溃。

修法：脚本保存为**带 BOM 的 UTF-8**。

> **这个坑在本项目里踩了四次**（另有 PowerShell 的 `>` 重定向默认写 UTF-16LE、
> 内联 Node 脚本里的 `$` 被 PowerShell 吃掉、以及用 `edit` 工具改完 `.ps1` 后 BOM 丢失）。
> 凡是跨 PowerShell / Node / 编辑器传递含中文的脚本，都要显式检查编码与 BOM。
> 现在的做法：改完 `.ps1` 一律用 `UTF8Encoding($true)` 重写一遍，并用
> `Parser::ParseFile` 做语法检查——**语法检查能立刻抓出 BOM 丢失**。

### 5.8 发布脚本现在会自己挡掉"exe 被占用"

`dotnet publish` 无法覆盖正在运行的 `MoleLauncher.exe`，但它的报错只有
"发布失败"，不给原因。打包流程因此卡过一次，排查花了几分钟。

现在 `build-launcher.ps1` 会：

1. 发布前检测并结束正在运行的启动器实例；
2. 若仍然失败，在异常信息里直接提示「publish 目录下的文件被占用」。

---

## 六、其他设计要点

### 6.1 先探测已有实例，再决定要不要 spawn

启动时先请求一次 `/__status`：

- 有响应 → **复用**该实例（`_attached = true`），不再另起一个然后因端口占用而失败；
- 无响应 → 才真正拉起 node 进程。

停止时若只是复用，**不会去杀别人的进程**，只解除绑定。

实测日志：

```
[Ok   ] mirror   检测到已有镜像实例在运行，直接复用（25110 个资源）
```

### 6.2 路径探测顺序：项目内优先

`PathResolver` 从可执行文件目录**向上最多 8 层**查找含 `molemirror\index.js` 的目录作为项目根。
这样无论从 `bin\Debug\...` 还是 `publish\` 运行都能找对。

Ruffle 的探测顺序：配置 → `<项目根>\runtime\ruffle\ruffle.exe` → PATH → `%LOCALAPPDATA%\Ruffle\`。
**项目内自带即可完全自足**，不依赖目标机装了什么。

### 6.3 Ruffle 缺失时的一键下载

设置窗口里「下载…」按钮会：

1. 请求 GitHub Releases API 找最新的 `windows-x86_64.zip`；
2. 下载并解压到 `<项目根>\runtime\ruffle\`；
3. 自动把 `ruffle.exe` 路径填进配置。

这样分发包**不必自带第三方二进制**，用户也不必手工找。

---

## 七、构建与发布

```powershell
# 框架依赖（约 200 KB，目标机需 .NET 7 桌面运行时）
powershell -ExecutionPolicy Bypass -File launcher\build-launcher.ps1

# 自包含单文件（目标机无需任何运行时，体积约 150 MB）
powershell -ExecutionPolicy Bypass -File launcher\build-launcher.ps1 -SelfContained

# 额外打包 zip
powershell -ExecutionPolicy Bypass -File launcher\build-launcher.ps1 -Zip
```

> 执行策略若限制脚本运行，需要 `-ExecutionPolicy Bypass`。

发布目录里同时生成 `启动摩尔庄园.bat` 便捷入口。

---

## 八、验证状态

| 项 | 状态 |
|---|---|
| `dotnet build -c Release` | ✅ **0 警告 0 错误** |
| 启动器启动、窗口正常 | ✅ 标题「摩尔庄园 · 本地客户端」 |
| 项目根 / node / Ruffle 路径探测 | ✅ 三项全部正确 |
| 配置持久化 | ✅ 落到 `I:\61mole\data\settings.json` |
| 复用已运行的镜像实例 | ✅ 日志确认 |
| `--print-command` 参数正确性 | ✅ 与 Phase 0 验证集逐项一致 |
| `dotnet publish`（框架依赖） | ✅ 产物正常，从 `publish\` 运行路径探测正确 |
| 界面渲染 | ✅ 截图确认 |
| 托盘图标 | ⚠️ **未实测**（代码已写，需人工点一次） |
| 实际点击「启动游戏」 | ⚠️ **未实测**（会开第二个游戏窗口；参数已客观验证） |
| 下载 Ruffle 按钮 | ⚠️ **未实测**（需联网走一次） |
| 自包含发布 | ⚠️ **未实测**（脚本已备） |

---

## 九、已知限制

1. 托盘图标用的是通用应用图标（`SystemIcons.Application`），没有专门设计 `.ico`。
2. 下载 Ruffle 走 GitHub API，国内网络可能需要代理。
3. 修改「项目根目录」后配置文件仍留在原位置，不会自动迁移。
4. 启动器只管镜像与引擎生命周期，**不介入登录**——账号密码在客户端自己的登录框里输入。
