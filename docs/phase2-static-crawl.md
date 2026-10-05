# Phase 2 · 资源全量本地化（静态爬取）

> 目标：**所有游戏相关客户端资源存在本地**。
> 方法：SWF 常量池挖掘 + 递归爬取 + 博物馆数据交叉（不依赖游玩）。
> 当前成果：**3005 个文件 / 275.14 MB**，命中率 82%。

---

## 一、三条种子来源

静态爬取的关键是**种子从哪来**。本次用了三条互补的来源：

### 1.1 SWF 常量池（自身挖掘）

AS3 的字符串常量以明文 UTF-8 存在 ABC 常量池里，**无需真正解析 ABC 结构**，
直接在解压后的 SWF 字节流里抽可打印字符串，再按 `resource/|module/|...` 过滤即可。

工具：[`tools/scan-swf-paths.js`](../tools/scan-swf-paths.js)

```
扫描 6 个 SWF（Client.swf + 5 个 DLL）
  dll_ClientAppDLL.swf      解压 2775 KB, 字符串 126419, 新增路径 593
  dll_ClientConfigDLL.swf   解压 2573 KB, 字符串  62780, 新增路径  78
  dll_ClientCommonDLL.swf   解压  799 KB, 字符串  29690, 新增路径  10
  Client.swf                解压   40 KB, 字符串   1801, 新增路径   8
  dll_TaomeeCoreDLL.swf / dll_ClientSocketDLL.swf  新增路径 0
→ 689 条完整路径 + 222 个目录片段
```

有意思的是 `ClientSocketDLL`（协议层）和 `TaomeeCoreDLL`（地基库）**一条资源路径都没有**——
资源加载逻辑集中在 `ClientAppDLL` / `ClientConfigDLL`。

### 1.2 真实请求日志

Phase 0/1 期间游玩产生的请求日志（`logs/requests.jsonl`）里出现过的 URL
**必然有效**，且暴露了动态路径模板：

```
38  resource/cloth/bmpswf/#/#.swf
16  resource/petcloth/swf#/#.swf
 8  resource/xml/NPC/NPCJoblist#.xml
 7  resource/map/Map_#.xml
 7  resource/home/seed/swf/#.swf
```

### 1.3 摩尔博物馆数据接口（ID 空间）

博物馆暴露的数据接口给出了**权威 ID 空间**：

| 接口 | 内容 |
|---|---|
| `/api?event=getmaplist&pagesize=3000&pageid=1` | 282 个地图（含 NPC / 传送点 / 对话） |
| `/api?event=getsuitlist&onlyvip=0&pagesize=3000&pageid=1` | 418 个套装，**每个衣服条目自带 `path` 字段** |
| `/api?event=getitemfromtype&type=<t>&pagesize=N&pageid=P` | 物品 |

工具：[`tools/extract-museum-seeds.js`](../tools/extract-museum-seeds.js) →
**1829 条真实资源路径** + 1433 个衣服 ID

> ⚠️ 一个必须绕开的坑：地图记录里的 `swfPaths` 形如
> `resource/map/museum_map_swf/1/1-1.经典.swf`，实测在官方 CDN 上 **404**——
> 那是**博物馆自己的地图快照**（跨节日多版本），不是客户端资源。
> 已在爬虫里显式排除，省下 387 次无效请求。
>
> 而套装的 `ClothJson[].path` 形如 `resource/cloth/icon/12148.swf`，
> 实测 **200 / 662 B**，是真实资源。

---

## 二、递归爬取

工具：[`tools/crawl-resources.js`](../tools/crawl-resources.js)

滚雪球逻辑：**每抓到一个 200 的 SWF，就扫描它的字符串常量，把新发现的路径入队**。

```
种子 3590 条
  ├─ SWF 常量池        689
  ├─ 请求日志真实 URL  ~100
  ├─ 博物馆直接路径   1438
  └─ 地图组合候选      990   (Map_10001..10500 的 .swf + .xml)
       ↓ 递归发现
  3629 次请求：200 = 2976，404 = 652，err = 1
  抓取 269.70 MB，队列耗尽（收敛）
```

### 发现能力最强的文件（资源索引型 SWF）

| 文件 | 新发现路径数 |
|---|---|
| `module/external/MasonTaomee.swf` | **308** |
| `module/external/SunshineTrade.swf` | **292** |
| `module/external/SirenCombatDefendPanel.swf` | **201** |
| `module/game/flyeavesgowall.swf` | 198 |
| `module/external/SuperLamuGiftMain.swf` | 197 |
| `resource/angelsAndDemons/swf/MoleParkThreeYear.swf` | 134 |

这些是"资源索引型"SWF——它们内部硬编码了大量同族资源路径。
**递归是本次能一次性收敛的关键**：纯种子抓取只能拿到 3590 条里的一部分。

### 一个盲区及修补

爬虫只扫描**它自己抓到的** SWF。游玩时被按需抓到的文件（Phase 0 那次登录产生）
虽然已在缓存里，却从没被扫描过。已补上「扫描缓存目录全部 SWF」这一步：

```
已扫描缓存 SWF 1048 个，新增种子 12 条
```

补完后队列再次耗尽，确认**已收敛**。

---

## 三、当前成果

| 指标 | 值 |
|---|---|
| 本地文件总数 | **3005** |
| 本地总体积 | **275.14 MB** |
| 扩展名分布 | `.swf`=2667, `.xml`=315, `.mp3`=20, `.jpg`=2, `.txt`=1 |
| 爬取命中率 | **82.0%**（2976/3629） |

### 分类分布（Top 10）

| 目录 | 文件数 |
|---|---|
| `resource/cloth` | 1491 |
| `resource/map` | 397 |
| `module/external` | 289 |
| `resource/allJob` | 173 |
| `module/game` | 93 |
| `resource/xml` | 50 |
| `resource/task` | 49 |
| `module/pig` | 38 |
| `resource/movie` | 29 |
| `resource/slOnlyItems` | 26 |

### 覆盖率（与博物馆权威列表对照）

| 类别 | 覆盖 |
|---|---|
| **地图** | 260 / 282 博物馆收录（92%）；另有 4 张博物馆未收录的新图 |
| **衣服图标** | 1446 / 1433 博物馆收录（**100%+**，还多抓到 13 个） |
| 衣服位图 `cloth/bmpswf` | 42（**主要缺口**，见下） |

完整分析见 [`resources/gap-analysis.md`](../resources/gap-analysis.md)。

---

## 四、仍待枚举的命名空间

这些路径带**运行时 ID**，静态爬取原理上触达不到，只有游玩或服务端数据才能给出取值：

| 模板 | 缺口说明 |
|---|---|
| `resource/cloth/bmpswf/<组>/<衣服ID>.swf` | **最大缺口**。衣服 ID 已知（博物馆给了 1433 个），但**组号未知**——实测 `1001/12052.swf` 与 `1002/12052.swf` 同时存在，说明组号不是从衣服 ID 派生的（可能是体型/朝向变体） |
| `resource/petcloth/swf<组>/<宠物ID>.swf` | 宠物装扮 |
| `resource/petcloth/swf2/pet<ID>/skill_<N>.swf` | 宠物技能特效 |
| `resource/home/seed/swf/<ID>.swf` | 家园种子 |
| `resource/home/item/swf/<ID>.swf` | 家园物品 |
| `resource/xml/NPC/NPCJoblist<ID>.xml` | NPC 任务状态表 |
| `resource/xml/task/Task<ID>.xml` | 任务脚本（已抓到 49 个） |
| `resource/bgSounds/BGM_<ID>.mp3` | 背景音乐（已抓到 20 个） |
| `resource/dragon/bmpswf/<ID>_big_a.swf` | 坐骑位图 |

**结论**：静态爬取已把「可枚举部分」做到收敛；剩余缺口本质上需要
**游玩驱动的按需捕获**（Phase 1 的镜像代理天然就是这个通道）或**服务端数据**。

---

## 五、复现命令

```powershell
# 1) 确保 molemirror 在线运行
.\run.ps1 -NoRuffle

# 2) 从 SWF 常量池挖路径
node tools\scan-swf-paths.js

# 3) 分析路径结构 + 从 XML 找枚举
node tools\analyze-paths.js

# 4) 拉博物馆数据并抽 ID 空间（需先手动取回 maplist.json / suitlist.json）
node tools\extract-museum-seeds.js

# 5) 递归爬取（会自动合并以上全部种子）
node tools\crawl-resources.js --budget 9000

# 6) 缺口分析
node tools\gap-analysis.js
```

博物馆数据取回命令：

```powershell
Invoke-WebRequest 'https://museum.61player.com/api?event=getmaplist&pagesize=3000&pageid=1' `
  -OutFile '_re\museum\maplist.json' -UseBasicParsing
Invoke-WebRequest 'https://museum.61player.com/api?event=getsuitlist&onlyvip=0&pagesize=3000&pageid=1' `
  -OutFile '_re\museum\suitlist.json' -UseBasicParsing
```
