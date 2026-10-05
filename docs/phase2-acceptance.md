# Phase 2 验收报告 · 资源全量本地化

> 验收日期：2026-06 · 结论：**离线覆盖率 100%（对已请求过的全部资源）**
> 全程**未对官方 SWF 做任何补丁**（哈希逐字节比对证明，见 Phase 0 记录）

---

## 一、验收方法：用真实请求历史做工作负载

比"跑一遍登录页"严格得多的做法：**把客户端与爬虫历史上成功取回过的每一个 URL 拿来当工作负载**，
在**离线模式**下逐条回放，未命中即缺口。

```
工作负载 = logs/requests.jsonl 中所有 mole.61.com 的 200 响应
         → 去掉缓存击穿 query 后去重
         → 15,075 条
```

离线实例以独立端口启动（`--offline`），**共用同一缓存目录**，因此不影响正在运行的在线实例
（验收时 Ruffle 与游戏服 `123.206.131.236:1865` 的连接仍为 Established）。

工具：[`tools/fetch-list.js`](../tools/fetch-list.js)（支持指定代理端口）

---

## 二、验收结果

| 轮次 | 请求 | 缓存命中 | 离线未命中 | 404 | 其他错误 |
|---|---|---|---|---|---|
| 第一轮（并发 12） | 15,075 | **14,769** | **0** | 0 | 306 |
| 重试（并发 2） | 306 | **306** | 0 | 0 | 0 |
| **合计** | **15,075** | **15,075** | **0** | **0** | **0** |

### 那 306 个"其他错误"是什么

全部是 **`connect EADDRINUSE 127.0.0.1:8999`** —— 客户端本地临时端口在 TIME_WAIT 下耗尽，
是**测试脚手架**在高并发下的问题，**不是资源缺口**。降并发到 2 重试后 306 条**全部缓存命中**。

> 这个坑值得记录：Node 14 上以并发 12 打 15k 请求会打爆本地端口，
> 第一轮就把 306 条误报成了错误。**如果不追查这批错误，就会得出错误的覆盖率结论。**

### 结论

**对客户端已请求过的全部资源，离线可用率为 100%。**

需要明确区分：这证明的是「**已请求过的**资源 100% 本地化」，
不等于「CDN 上存在的**所有**资源都已本地化」——后者受限于我们尚未枚举的命名空间（见第五节）。

---

## 三、当前规模

| 指标 | 值 |
|---|---|
| 本地文件 | **16,196 个** |
| 总体积 | **937.45 MB** |
| 其中 0 字节（源站即空，非本地缺陷） | 261 |
| **有效资源** | **15,935 个** |

### 分类分布（Top 10）

| 目录 | 文件数 |
|---|---|
| `resource/cloth` | 12,684 |
| `resource/goods` | 1,402 |
| `resource/map` | 616 |
| `module/external` | 293 |
| `resource/allJob` | 178 |
| `resource/bgSounds` | 161 |
| `resource/farm` | 133 |
| `module/game` | 93 |
| `resource/pet` | 51 |
| `resource/xml` | 51 |

### 覆盖率（对照外部权威列表）

| 类别 | 覆盖 | 依据 |
|---|---|---|
| **衣服位图** `cloth/bmpswf/{1001,1002,1003}/<id>.swf` | **11,178 / 11,511 = 97.1%** | 组号规律已破解；ID 取自语料 3837 个 |
| **衣服图标** `cloth/icon/<id>.swf` | 1458 / 1433 = **100%+** | 博物馆 `ClothJson[].path` |
| **家具图标** `goods/icon/<id>.swf` | **1401 / 1401 = 100%** | 语料「家具」ID 全集 |
| **牧场动物** `farm/icon/<id>.swf` | 129 | 语料「牧场动物」+ 配置 XML |
| **地图**（长名 + 短名两套命名） | **277 / 282 = 98.2%** | 博物馆 282 地图 + 语料 244 |
| BGM | 161 | 语料 155 + 游玩捕获 |

---

## 三·补 · 最有价值的突破：客户端自己的配置 XML

前面几节用的都是**外部**权威列表（博物馆、语料）。但最可靠的一手来源其实是
**`ClientConfigDLL.swf` 里内嵌的配置 XML** —— 它是"摩尔配置"这一模块，内含形如

```xml
<Item ID="1220038" Type="2" Path="resource/home/item/icon/" Name="..." />
```

的条目，即**带 ID 的权威资源索引**。

工具：[`tools/extract-clientconfig-xml.js`](../tools/extract-clientconfig-xml.js)

它解开了两个此前猜错的命名空间：

| 我之前的猜测 | 实测结果 | 真名 |
|---|---|---|
| `resource/fitment/item/<id>.swf` | 404 | ❌ |
| `resource/home/item/swf/<id>.swf` | 404（因为 ID 用错了） | ❌ |
| — | **200** | ✅ `resource/goods/icon/<id>.swf` ← 家具 |
| — | **200** | ✅ `resource/farm/icon/<id>.swf` ← 牧场动物 |
| — | **200** | ✅ `resource/home/seed/icon/<id>.swf` |

**关键教训**：语料 `家具\` 文件夹里的 `160001.swf` 这类名字**不是客户端 ID 的命名规则**，
它恰好落在同一个号段（160001..161509），所以看起来像。真正确定前缀与 ID 的配对关系，
必须回到客户端自己的配置里查。

用 `resource/goods/icon/<id>.swf` × 语料 1401 个家具 ID 抓取后**命中率接近 100%**，
一次性补上 1,543 个资源。

### 新解锁的命名空间落地量

| 前缀 | 文件数 |
|---|---|
| `resource/goods/icon/` | **1,401** |
| `resource/farm/icon/` | 129 |
| `resource/home/*` | 23 |

---

## 四、语料整合结论（目标第 2 项）

| 语料 | 用途 | 结论 |
|---|---|---|
| **素材福利袋**（933 MB） | 抽出 ID 空间 | ✅ **关键贡献**：3837 衣服 ID、244 地图、155 BGM、1401 家具、564 NPC。**文件名即 ID，无需解压** |
| **ClientConfig XML 整理** | 33 个 XML/HTML 转储 | ✅ 补了地图/NPC/坐骑/卡牌数据；`地图\特殊场景和ID.html` 有地图 ID 线索 |
| **易语言工具源码**（查看器.e） | 资源拼接逻辑 | ✅ **挖出 64 条路径模板**，其中 `resource/allJob/icon/`、`module/home/home.swf`、`module/house/house.swf` 实测为真 |
| **32 个每周缓存快照** | 历史版本 | ⚠️ **不带来新资源**，但给出清晰的版本演进序列（见下） |

### 历史快照的去重比对

用 7z 的 CRC **零解压**横向比对 23 个快照 × 52 个文件：

| 文件 | 出现快照数 | 不同版本数 |
|---|---|---|
| `ClientConfigDLL.swf` | 23 | **23**（每周一版） |
| `ClientAppDLL.swf` | 23 | 22 |
| `ClientSocketDLL.swf` | 23 | 22 |
| `topUI.swf` | 23 | 22 |
| `TaomeeCoreDLL.swf` | 23 | 20 |
| `ui.swf` | 23 | 1（**2014 至今未变**） |
| `index.swf` | 23 | 1（**2014 至今未变**） |

与线上现役版本比对：**5 个 DLL + `Client.swf` + `Login.swf` + `LoginHome.swf` 均已比所有快照更新**；
只有 `ui.swf` 与 `index.swf` 与历史快照逐字节相同。

**判定**：快照是「引导集的历史版本序列」，每个仅 24 个扁平主文件、无 `resource/` 目录结构，
**无法用于补全当前资源**。已作为版本考古资料归档，不进交付资源树。
详见 [`docs/snapshot-compare.md`](snapshot-compare.md)。

### 语料对"线上已下架资源"的补充

地图语料 245 个 SWF 中，**23 个线上已不存在**，其中 7 个正是博物馆收录但线上 404 的
（244、245、249、250、311、312、313）。加入后地图覆盖从 260/282 提升到 **277/282**。
归档于 `assets-corpus/`（52 MB），与线上抓取物分开存放以便区分来源。

---

## 五、仍存在的缺口（诚实口径）

### 5.1 路径模板的 ID 空间：已解 2 条，剩 27 条

从易语言工具源码里读出 64 条路径模板、29 条当时 ID 未知。借助 `ClientConfigDLL`
的配置 XML，**已解开 2 条**：

| 模板 | 状态 |
|---|---|
| `resource/goods/icon/{?}.swf` | ✅ **已解**（语料家具 1401 个） |
| `resource/farm/icon/{?}.swf` | ✅ **已解**（语料牧场动物 123 个） |

剩余 27 条登记在 [`resources/tool-templates-unresolved.txt`](../resources/tool-templates-unresolved.txt)：

| 模板 | 可能的 ID 来源 |
|---|---|
| `resource/elementCard/icon\|show/{?}.swf` | 语料「元素卡牌&其他」702 |
| `resource/magicSpirit/icon/{?}.swf` | 语料「魔灵」189 |
| `resource/newAngel/icon\|show\|skillico/{?}.swf` | 语料「天使」119 |
| `resource/activity\|effect\|flower/icon/{?}.swf` | 待定 |
| `resource/pet/icon\|head/{?}.swf`、`resource/newNpc/oneSide/{?}.swf` | 待定 |
| `resource/home/seed/swf/{?}.swf`、`resource/home/item/(icon\|swf)/{?}.swf` | 前缀已确认，**ID 空间**待解 |

> **下一步的正确做法**（本轮已验证有效）：不要再从外部语料名字猜前缀，
> 而是**回到 `ClientConfigDLL` / `ClientAppDLL` 的配置 XML 里直接查前缀↔ID 的配对**。
> `ClientAppDLL` 里已看到 `resource/home/item/icon/1220115.swf` 这类**含 ID 的完整路径字面量**，
> 把这类字面量系统性抽出来即可一次性解开剩余命名空间。

### 5.2 12 个地图线上与语料都缺失

`243、246、247、248、322` 及博物馆含但两处都无的若干（线上 404、语料未收录）。

### 5.3 源站即空的资源

260 个资源在官方 CDN 上返回「200 + 空 body」。镜像已如实记录并打 `empty` 标记，
口径上不计入有效资源。可通过 `/__empty?tsv` 导出。

---

## 六、复现命令

```powershell
# 离线验收（独立端口，不影响在线实例）
$env:MOLEMIRROR_PROXY_PORT='8999'; $env:MOLEMIRROR_CONTROL_PORT='8998'; $env:MOLEMIRROR_ORIGIN_PORT='8888'
node molemirror\index.js --offline

node tools\fetch-list.js resources\offline-verify-workload.txt 12 8999

# 历史快照比对
node tools\snapshot-compare.js
```
