# 中文字体（宋体 / SimSun）与 Ruffle 的设备字体

> 结论先说：**Ruffle 能用上系统里的宋体，但粗体请求会失败** —— 原因是它拿「字体自身的字重」
> 去登记，而 `simsun.ttc` 没有 Bold 字面。补一张同族名、字重 700 的副本即可解决，
> 无需改 Ruffle、无需改客户端。一键脚本：[`tools/install-xp-simsun.ps1`](../tools/install-xp-simsun.ps1)。

---

## 一、问题是什么

摩尔客户端大量使用**设备字体**（device font）：SWF 里只写字体名（`SimSun`、`宋体`、`Arial Black`…），
字形交给运行环境提供 —— 这正是"还原 XP 原版观感"的关键。

Ruffle 找不到时会在日志里留痕：

```
WARN ruffle_core::library: Unknown device font "SimSun" (bold: true, italic: false)
```

含义是"这段文本没能用上宋体，回退到了引擎自带字体"。

---

## 二、排查过程（本机实测，2026-10-05）

### 1. 不是"没装字体"

| 字体 | 注册表 | 文件 |
|---|---|---|
| SimSun & NSimSun | ✅ | `C:\Windows\Fonts\simsun.ttc`（17.4 MB，TTC 头合法，family = SimSun / 宋体） |
| Arial Black | ✅ | `C:\Windows\Fonts\ariblk.ttf` |

把 `simsun.ttc` 额外装进用户字体目录（`%LOCALAPPDATA%\Microsoft\Windows\Fonts`）后，告警**依旧**。

### 2. 不是"Ruffle 不查系统字体"

Ruffle 桌面端的实现（`desktop/src/backends/ui.rs`）：

```rust
fn load_device_font(&self, query: &FontQuery, register: &mut dyn FnMut(FontDefinition)) {
    let query = fontdb::Query { families: &[Family::Name(name)], weight: ..., style: ..., ..Default::default() };
    if let Some(id) = self.font_database.query(&query) { /* 找到就登记 */ }
}
```

字体库由 `fontdb::Database::load_system_fonts()` 建立（`desktop/src/app.rs`），
Windows 下扫描 `%SYSTEMROOT%\Fonts` 与用户字体目录（fontdb 0.23 `lib.rs`）。

把日志级别开到 `RUST_LOG=info` 后，真相出现了 —— **普通字重能查到，粗体查到的也是同一张脸**：

```
INFO ruffle_desktop::backends::ui: Loading device font "SimSun" for "SimSun" (bold: false)   ← 成功
INFO ruffle_desktop::backends::ui: Loading device font "SimSun" for "SimSun" (bold: true)    ← 也找到了
WARN ruffle_core::library: Unknown device font "SimSun" (bold: true, italic: false)          ← 但没匹配上
```

### 3. 根因：登记时用的是字体自身的字重

```rust
// desktop/src/backends/ui.rs
let is_bold = face.weight > fontdb::Weight::NORMAL;   // ← 看字体，不看请求
```

`simsun.ttc` 只有 400 字面，于是被登记成 `is_bold=false`；
而 core 按"名字 + 字重"做精确匹配（`core/src/library.rs`），
`SimSun + bold=true` 永远匹配不到 → 告警 → 回退。

同一机制也解释了 `Arial Black`：客户端按**非粗体**请求，而 `ariblk.ttf` 的 `usWeightClass` 是 900，
登记成 `is_bold=true` → 匹配失败。

> 附带排除项：`device_font_renderer = "freetype"`（`preferences.toml`）在桌面端是
> **Linux 专属**（`#[cfg(all(target_os = "linux", feature = "freetype"))]`），Windows 上写它没有任何作用；
> `ruffle.exe --help` 里也没有任何字体相关开关。

---

## 三、修法：补一张「同族名、字重 700」的副本

`tools/font-boldify.js` 只改 4 个字节量级的数值（`OS/2.usWeightClass`、`head.macStyle`、`OS/2.fsSelection`），
不碰 name 表、不重排表结构：

```powershell
# 把宋体的 0 号字面（SimSun）改成字重 700，输出一份副本
# （下面用 XP SP3 那份做例子；一键脚本会自动把下载到的 XP 字体作为输入）
node tools\font-boldify.js "$env:LOCALAPPDATA\Microsoft\Windows\Fonts\simsun-xp.ttc" 0 "$env:LOCALAPPDATA\Microsoft\Windows\Fonts\simsun-bold.ttc" 700

# 只看某个字体每个字面的族名/版本/字重（含 fsSelection 的 BOLD/REGULAR 位）
node tools\font-boldify.js --info C:\Windows\Fonts\simsun.ttc
```

放好后 fontdb 的粗体查询会选中 700 的副本 → 登记出 `is_bold=true` → 匹配成功。

**实测对比（同一次开游戏、取字体相关日志行）：**

| | 修复前 | 修复后 |
|---|---|---|
| `Unknown device font` 条数 | 3 | **0** |
| 粗体 SimSun | 回退到引擎自带字体 | `Loading device font "SimSun" for "SimSun" (bold: true)` |

### 为什么只放用户字体目录就够

fontdb 直接**扫目录**，不读注册表；`%LOCALAPPDATA%\Microsoft\Windows\Fonts` 在扫描列表内。
因此这种装法：**不需要管理员、不写注册表、不动系统字体、随时删文件即可回退**。

> 想连"普通字重也用 XP 那份"：把 XP 的 `simsun.ttc` 放进同一目录即可参与竞争。
> 但要 100% 确定选中哪一份，只能替换系统 `C:\Windows\Fonts\simsun.ttc`（需管理员，先备份）——
> 两者设计同源（都是中易宋体），差别主要在点阵/字重细节，建议先按缺省方式跑一轮看效果。

---

## 四、一键安装（含 XP 原版）

```powershell
# 下载 XP 版 simsun.ttc（带多个备用源与校验），生成粗体副本，装到用户字体目录，并实测验证
powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -Verify

# 只装、不验证
powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1

# 卸载（删掉本脚本放进去的文件）
powershell -ExecutionPolicy Bypass -File tools\install-xp-simsun.ps1 -Uninstall
```

脚本**不把字体文件放进仓库**：Windows XP 的宋体版权属于微软/中易，本仓库的一贯原则是不入库第三方版权资源
（见 README 免责声明），因此只提供下载与安装。下载失败时会退化为"用本机 `C:\Windows\Fonts\simsun.ttc` 生成粗体副本"，
至少把那 3 条告警消掉。

### 用哪一版宋体：首选 XP SP3 的原版

| 候选 | 大小 | 版本 | 说明 |
|---|---|---|---|
| **★ XP SP3 原版**（首选） | 10,512,288 B | **3.12** | TTC 三字面 `SimSun / NSimSun / SimSun-PUA`。用微软自己的 `zh-hans_windows_xp_professional_with_service_pack_3_x86_cd_vl_x14-74070.iso` 经 HTTP Range 只取 `I386\SIMSUN.TT_`、`expand.exe` 展开后比对：**逐字节一致**（同大小同 SHA256），确认不是仿制品 |
| 2.10 TTF（备用一） | 10,499,104 B | 2.10 | Windows 2000 / 早期 XP 那版，三个镜像哈希一致 |
| 2.92 TTF（备用二） | 7,024,536 B | 2.92 | 疑似子集，最后才用 |
| ~~本机 Win10 自带~~ | 18,214,472 B | 5.16 | 永远都在，用作最后的兜底 |

下载直链都是 `raw.githubusercontent.com` 且**固定到 commit**，脚本按 SHA256 校验（对不上会明确告警）。
来源排查全过程（含 ISO 提取配方、被淘汰的候选与被混淆的 wfonts 文件）见 `logs/xp-simsun-sources.md`。

> 小坑：`ttf-parser` 判断字重时**先看 `OS/2.fsSelection` 的 BOLD/REGULAR 位**，再看 `usWeightClass`。
> 所以 `tools/font-boldify.js` 必须按目标字重同步改这两处——只改 `usWeightClass` 会出现
> "明明改了字重，Ruffle 登记出来还是反的"（实测踩过）。

### 已知残留：客户端还会点名几个本机没有的字体

日志（启动器的降噪管道会把它变成一次性提示）实测见到：

| 请求的字体 | 情况 | 能否修 |
|---|---|---|
| `Arial Black` | 系统里**有** `ariblk.ttf`（900 字重），但 fontdb 的 `Family::Name("Arial Black")` 精确查询**查不到这个字族**（没有 `Loading device font` 行、也没有加载报错），塞一份 400 字重的副本同样查不到 —— 推测是 `ttf-parser` 读不了该字体 name 表的记录 | 不改客户端/Ruffle 的前提下**暂时无解**；影响一个画质面板的拉丁字体观感 |
| `DFPHaiBaoW12-GB`（华文琥珀） | 系统里没有；这是华文（汉仪/方正系）的商业显示字体 | 需自备字体文件，放同一个用户字体目录即可（fontdb 会扫到）；本脚本不代下 |

> 结论：**宋体一族（`SimSun` / `宋体` / 加粗）已经彻底修好**；
> 剩下这两个属于"客户端点名了本机没有、或字体库读不出来的字体"，
> 只影响局部观感，且 `tools\font-boldify.js --info` 与日志提示都能帮你定位下一次出现的名字。

---

## 五、顺带：日志里的字体提示

启动器的日志管道（`RuffleLogFilter.cs`）会把 `Unknown device font` 变成**一次性**提示，
并指向本脚本；重复的 `Movie clip N: Duplicated frame label` 噪声同时被折叠成一行汇总：

```
[WRN] ruffle  未能使用设备字体 "SimSun"（Ruffle 回退到自带字体，字形会与原版不一致）。
              需要还原原版宋体请运行 tools\install-xp-simsun.ps1，详见 docs\fonts.md
[INF] ruffle  已折叠 1120 条 "Duplicated frame label" 告警（对运行无影响，可用 tools\filter-ruffle-log.js 还原原文）
```

---

## 六、复现与验证

```powershell
# 1) 看 Ruffle 到底有没有用上系统字体（info 级才打印 Loading device font）
$env:RUST_LOG='info'
# 用 --play 让启动器起游戏，或直接跑 ruffle.exe（参数见 launcher 的 --print-command）
I:\61mole\launcher\publish\MoleLauncher.exe --print-command

# 2) 只看字体相关行
Select-String -Path logs\launcher.log -Pattern 'device font'

# 3) 看某个字体的字面字重（不带参数即打印用法）
node tools\font-boldify.js
```
