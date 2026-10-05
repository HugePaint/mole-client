# 编码注意事项

> 这份文档来自本项目实际踩过的坑，不是泛泛的最佳实践清单。
> 每个条目都对应一次真实的、花时间排查过的故障。

## 一句话结论

**中文只要跨了进程边界或接口边界，就必须显式指定编码，不能依赖默认值。**

Windows 上参与本项目的组件（PowerShell 5.1、cmd.exe、Node.js、.NET、git、7-Zip）默认编码各不相同，
而它们之间传递文本的默认行为几乎**没有一个**是 UTF-8：

| 组件 | 默认编码 |
|---|---|
| PowerShell 5.1 读 `.ps1` | 无 BOM → **系统 ANSI（GBK）** |
| PowerShell 5.1 `>` 重定向 | **UTF-16LE** |
| PowerShell 5.1 `Invoke-RestMethod -Body <字符串>` | **ASCII** |
| PowerShell 5.1 写文件（`Set-Content` 默认） | ANSI |
| .NET `ProcessStartInfo` 读子进程输出 | **系统 ANSI** |
| cmd.exe 控制台 | OEM 代码页（936） |
| Node.js | UTF-8 |
| git | UTF-8 |
| 7-Zip 控制台输出 | OEM 代码页 |

---

## 一、踩过的坑（按发生顺序）

### 1. PowerShell 的 `>` 重定向写 UTF-16LE

```powershell
node tools\fetch-list.js ... > logs\out.txt     # ✗ 得到 UTF-16LE
```

后续用 Node 读这个文件会看到每个字符之间夹着 `\0`。

**修法**：不要用 `>`。用其中之一：

```powershell
... | Set-Content 'out.txt' -Encoding UTF8
[System.IO.File]::WriteAllText('out.txt', $text, [System.Text.UTF8Encoding]::new($false))
& tool.exe | Out-File 'out.txt' -Encoding utf8
```

**怎么发现**：Node 读到的字符串里全是 `\u0000`，或正则一个都匹配不上。

---

### 2. 内联 Node 脚本里的 `$` 被 PowerShell 吃掉

```powershell
node -e "const r = /\.swf$/; t.replace(/\{?\}?\.swf$/, '')"     # ✗ PowerShell 先展开了 $
```

报错往往很怪（正则行为不对、或 `$` 后面的内容消失），因为 PowerShell 在双引号里把
`$` 当作变量前缀处理了。

**修法**：**脚本一律写成文件再执行**，不要用 `-e` 内联。

```powershell
# ✗ 不要这样
node -e "...复杂逻辑..."

# ✓ 写成文件
node tools\my-script.js
```

> 这一条在本项目里反复触发（`$`、`$1`、`$&`、反引号都会被 PowerShell 处理）。
> 写成文件后彻底消失。

---

### 3. `.ps1` 无 BOM → PowerShell 5.1 按 ANSI 读 → 解析崩溃

`.ps1` 文件存为**不带 BOM 的 UTF-8**（很多编辑器和工具链的默认行为）时，
PowerShell 5.1 会按系统 ANSI（GBK）解码。后果不只是中文变乱码——
错误的字节序列可能被当成引号或括号，**直接导致语法错误**：

```
The string is missing the terminator: '.
```

**修法**：`.ps1` 一律存为**带 BOM 的 UTF-8**。

```powershell
$p = 'script.ps1'
$t = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($p)).TrimStart([char]0xFEFF)
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($true)))
```

**附加收益**：加一个语法检查就能立刻抓出 BOM 丢失——

```powershell
$errs = $null; $tokens = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count) { "行 $($errs[0].Extent.StartLineNumber): $($errs[0].Message)" }
```

> **注意** `[ref]` 的目标变量必须先声明，否则 `[ref]$errs` 本身会报错，
> 而 `if ($errs ...)` 是假分支 → **检查会静默通过**，给你一个假的"语法正常"。

---

### 4. 用编辑工具改完 `.ps1` 后 BOM 丢了

即使原文件有 BOM，**用编辑器/工具改一次之后 BOM 常常被去掉**，
于是第 3 条的故障原样复现。

**修法**：把「改完 → 补 BOM → 语法检查」当成一个固定动作，不要靠记忆。

> 本项目里 `.ps1` 反复中招，后来固化成一条纪律：
> **任何 `.ps1` 改动之后，立刻补 BOM 并跑语法检查。**

---

### 5. .NET 读子进程输出用系统 ANSI

启动器读取 `node` 与 `ruffle` 的 stdout 时没有指定编码，于是 UTF-8 的中文被按 ANSI 解码：

```
[molemirror] 杞藉叆缂撳瓨绱㈠紩 26428 鏉?      ← 实际是「载入缓存索引 26428 条」
```

这不是手抄的乱码，而是**可推导、可复现**的——而且可以还原回来：

```powershell
$orig = '载入缓存索引'
$utf8 = [System.Text.Encoding]::UTF8.GetBytes($orig)

# 误解码：UTF-8 字节被当成 GBK
$mis = [System.Text.Encoding]::GetEncoding(936).GetString($utf8)
# → 杞藉叆缂撳瓨绱㈠紩

# 还原：把错误字符按 GBK 编回字节，再按 UTF-8 解码
$back = [System.Text.Encoding]::GetEncoding(936).GetBytes($mis)
[System.Text.Encoding]::UTF8.GetString($back)
# → 载入缓存索引   ✓
```

**修法**：`ProcessStartInfo` 显式指定编码。

```csharp
var psi = new ProcessStartInfo {
    ...
    RedirectStandardOutput = true,
    RedirectStandardError  = true,
    StandardOutputEncoding = Encoding.UTF8,   // ← 必须显式
    StandardErrorEncoding  = Encoding.UTF8,
};
```

---

### 6. `Invoke-RestMethod -Body <字符串>` 用 ASCII 发请求

```powershell
$body = @{ description = '摩尔庄园本地客户端：…' } | ConvertTo-Json
Invoke-RestMethod -Method Post $url -Body $body      # ✗ 中文全变成 ?
```

**PowerShell 5.1 在 `-Body` 收到字符串时用 ASCII 编码请求体**，
非 ASCII 字符在**发出之前**就变成了 `?`。这不是显示问题——
服务端数据库里存的就是问号（本项目两个 GitHub 仓库描述因此变成了 34 个和 24 个 `0x3F`）。

**修法**（任选）：

```powershell
# A) 自己编码成 UTF-8 字节
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Method Post $url -Body $bytes -ContentType 'application/json; charset=utf-8'

# B) 更稳：写成 UTF-8 文件，交给原生工具读（推荐）
#    这样完全绕开 PowerShell 的字符串/命令行编码
'{"description":"摩尔庄园本地客户端：…"}' | Set-Content body.json -Encoding UTF8
gh api -X PATCH repos/OWNER/REPO --input body.json
```

> 同理，**`git commit -m "中文"` 也不要走命令行**——
> 命令行参数会经过系统 ANSI 代码页。改用文件：
> ```powershell
> git commit -F commit-msg.txt      # commit-msg.txt 存为 UTF-8
> ```
> 本项目的 `mole-client` 提交信息就是靠 `-F` 才保持正确的。

---

### 7. cmd.exe 脚本需要 CRLF + OEM 代码页

`.cmd` / `.bat` 由 cmd.exe 按 OEM 代码页（简体中文 Windows 上是 936）解析，
换行也要 CRLF。

```powershell
[System.IO.File]::WriteAllText($path,
    ($text -replace "`n", "`r`n"),
    [System.Text.Encoding]::GetEncoding(936))
```

**更省事的做法**：让 `.cmd` 保持纯 ASCII，把所有中文和复杂逻辑放到 `.ps1` 里。
本项目的 `install.cmd` 就只是四行 ASCII 转发。

---

### 8. Node 读 PowerShell 写的文件要处理 BOM

同一条数据在 PowerShell 与 Node 之间传递时，BOM 的有无取决于写入方式。
Node 的 `fs.readFileSync(p, 'utf8')` **不会**自动去掉 BOM，
于是 `JSON.parse` 会在第一个字符上失败。

**修法**：读进来先剥 BOM。

```js
const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
JSON.parse(text);
```

本项目多个工具里都有这一行，不是多余的。

---

### 9. 需要区分「显示乱码」和「内容损坏」

有些乱码只是**终端显示**问题，文件本身是对的。

本项目的例子：用 `7z l` 列出自解压安装包内容时，
归档内那个中文名文件在终端里显示为一串乱码（7-Zip 按 OEM 代码页输出，
而终端按另一种代码页渲染）。

**但归档里的文件名是完好的。** 验证方式是解压出来用 .NET 枚举文件名，
而不是看 `7z l` 的输出：

```powershell
Get-ChildItem $extracted -Recurse | ForEach-Object { $_.FullName }
# → 得到正确的 launcher\启动摩尔庄园.bat
```

**不要**因为看到乱码就去"修"一个没坏的文件。先按第四节的办法确认字节。

> 顺带一提：本节最初我试图把那串乱码**原样抄进文档当示例**，
> 结果抄进去的是无法还原的替换字符。**乱码是不可复现的**——
> 它依赖终端代码页，抄下来只会得到另一个错误。要留证据就留**字节**，不要留显示效果。

---

## 二、边界对照表

| 跨越的边界 | 用什么 | 不要用什么 |
|---|---|---|
| PowerShell → 文件（给 Node/程序读） | `Set-Content -Encoding UTF8` 或 `File.WriteAllText` + `UTF8Encoding` | `>`、`Out-File`（默认）、裸 `Set-Content` |
| PowerShell → `.ps1` 文件本身 | 带 BOM 的 UTF-8 | 无 BOM UTF-8 |
| PowerShell → 子进程 stdout | .NET: `StandardOutputEncoding = UTF8` | 默认 |
| PowerShell → REST 请求体 | UTF-8 字节，或「文件 + `gh api --input`」 | `-Body <字符串>` |
| PowerShell → `git commit -m` | `git commit -F <UTF-8 文件>` | `-m "中文"` |
| PowerShell → cmd 脚本 | 纯 ASCII，或 CRLF + 代码页 936 | 无 BOM UTF-8 |
| Node → 文件 | `fs.writeFileSync(p, s)`（默认 UTF-8） | — |
| Node ← PowerShell 写的文件 | `replace(/^\uFEFF/, '')` | 直接 `JSON.parse` |
| 终端显示 | 只当参考 | 当作事实 |

---

## 三、本项目的既有约定

沿用这些约定可以避免重复踩坑：

1. **`.ps1` 一律带 BOM**，改完立刻补 BOM 并跑 `Parser::ParseFile` 语法检查。
2. **不给 `node` 用 `-e` 内联脚本**，一律写进 `tools\*.js`。
3. **不用 `>` 重定向**，统一 `Set-Content -Encoding UTF8`。
4. **给 API 传中文用文件**（`gh api --input` / `git commit -F`），不走命令行和字符串 body。
5. **Node 读配置/数据文件先剥 BOM**。
6. **`.cmd` 保持纯 ASCII**。

---

## 四、怎么确认到底是编码问题

不要靠肉眼看终端。**看字节。**

### 判断是否有字符在传输中丢失

`?`（`0x3F`）是"字符被 ASCII 编码吃掉"的典型指纹：

```powershell
$s = (Invoke-RestMethod $url -Headers $h).description
$b = [System.Text.Encoding]::UTF8.GetBytes($s)
"问号个数: " + ($b | Where-Object { $_ -eq 0x3F }).Count      # 应该为 0
"首 12 字节: " + (($b | Select-Object -First 12 | ForEach-Object { $_.ToString('X2') }) -join ' ')
```

期望值与实际值对比：

```powershell
[System.Text.Encoding]::UTF8.GetBytes('资源快照')      # E8 B5 84 E6 BA 90 E5 BF AB E7 85 A7
[System.Text.Encoding]::GetEncoding(936).GetBytes('资源快照')   # D7 CA D4 B4 BF EC D5 D5
```

如果存的是 `E7 92 A7 E5 8B AC …`，那说明**「UTF-8 字节被当成 GBK 解释」**——
也就是第 3 条（无 BOM 的 `.ps1`）。这种错误是**不可逆**的，只能重做。

### 对比远端与本地

```powershell
# 远端内容
$remote = & gh api "repos/OWNER/REPO/contents/README.md" --jq '.content'
$rb = [Convert]::FromBase64String(($remote -replace '\s',''))

# 本地内容（把 CRLF 规范化成 LF 再比，避免换行策略干扰）
$lt = ([System.IO.File]::ReadAllText('README.md')) -replace "`r`n","`n"
$lb = [System.Text.Encoding]::UTF8.GetBytes($lt)

"大小: 远端 $($rb.Length) / 本地 $($lb.Length)"
"一致: " + [System.Linq.Enumerable]::SequenceEqual($lb, $rb)
```

### 检查脚本文件本身的编码

```powershell
$b = [System.IO.File]::ReadAllBytes('script.ps1')
"前 3 字节: " + (($b[0..2] | ForEach-Object { $_.ToString('X2') }) -join ' ')
# EF BB BF = 带 BOM 的 UTF-8（.ps1 需要的）
```

---

## 五、提交前检查清单

往公开仓库推中文内容之前：

- [ ] `git ls-files` 出来的文件里，`.ps1` 都带 BOM
- [ ] 提交信息用 `-F <文件>` 传入，不用 `-m`
- [ ] README 等 Markdown 用 UTF-8，且**远端与本地字节一致**
- [ ] 仓库描述等**通过 API 设置的字段**单独核对过问号数
- [ ] 没有把 `logs\`、`data\` 这类含本机路径/账号的运行期文件带进去

> 最后一条不是编码问题，但同样是"推之前必须扫一遍"的东西——
> 本项目就是从待提交文件里扫出了游戏账号并做了脱敏。
