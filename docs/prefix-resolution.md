# 路径模板 ID 空间破解 · 方法与结果

> 目标：把易语言工具源码里抽出的 64 条路径模板中「前缀已知、ID 未知」的部分解开。
> 结果：**29 条中 17 条落地真实文件**，11 条判定为失效命名空间，1 条结构比模板复杂。

---

## 一、上一轮的教训：不要猜前缀

上一轮我犯过一个具体错误：看到语料 `家具\160001.swf` 就猜前缀是 `resource/fitment/item/`，
探测全 404。真名是 **`resource/goods/icon/`**。

原因：语料的文件夹名只是**恰好落在同一号段**（160001..161509），看起来像客户端 ID，其实不是。

**因此本轮的方法论是：一切从前缀↔ID 的配对准不准，都要在客户端自己的数据里找证据，而不是靠名字相像。**

---

## 二、四条证据来源（按可靠性排序）

| 来源 | 做法 | 产出 |
|---|---|---|
| **① 博物馆物品表** | `/api?event=getitemfromtype&type=1..40`，每条物品带 `path` 字段 | ⭐ **9,761 条权威路径**，覆盖 22 个前缀 |
| **② 客户端配置 XML** | `ClientConfigDLL` 内嵌 `<Item ID="..." Path="..." />` | 前缀↔ID 直接配对 |
| **③ 客户端代码字面量** | 6 个 SWF 里 `prefix/<数字>.swf` 形态的常量 | 257 条具体路径 + 86 个带 ID 的前缀 |
| **④ 语料文件夹名** | 文件名即 ID | 各类 ID 空间（衣服 3837、家具 1401…） |

### ① 是决定性的

博物馆物品表直接给出客户端资源路径，样例：

```
type=1   resource/cloth/icon/12001.swf          3992 条
type=5   resource/goods/icon/12839.swf          1468 条
type=9   resource/allJob/icon/190001.swf        1191 条
type=13  resource/home/item/icon/1220001.swf     460 条
type=17  resource/classroom/icon/1260001.swf      65 条   ← 此前完全没有的命名空间
type=25  resource/oneBigStree/icon/1330001.swf    28 条
type=31  resource/digTreasure/icon/1453000.swf   119 条   ← 新
type=27  resource/dragon/show/1350001_2.swf      122 条   ← 新
```

**它同时暴露了一批此前完全不知道的命名空间**：`car/icon/`、`digTreasure/icon/`、
`dragon/show/`、`classroom/icon/`、`angelFight/icon/`、`oneBigStree/icon/`、
`angelPark/items/icon/`、`pig/icon/`、`restaurant/icon/`。

工具：[`tools/fetch-museum-items.js`](../tools/fetch-museum-items.js)

---

## 三、两轮「前缀 × ID 空间」矩阵探测

对剩下的前缀，用**少量样本**判定它属于哪个 ID 空间：

```
对每个 (前缀, ID空间) 组合，均匀取 3 个样本 → HEAD 探测
任一 200 → 该配对成立 → 随后全量枚举
```

工具：[`tools/probe-prefix-matrix.js`](../tools/probe-prefix-matrix.js)

### 第一轮（31 个 ID 空间，837 组合）→ 解开 13 条

```
resource/effect/icon/                   ← 投掷道具 150001 / 特殊道具 16001
resource/elementCard/icon|show/         ← 元素道具 1673000 / 元素卡牌 1663000
resource/magicSpirit/icon/              ← 魔灵 1720001
resource/newAngel/icon|show/            ← 天使 1643001
resource/siren/icon|swf/                ← 海妖 1623000
resource/pet/icon/                      ← 拉姆用具 180001
resource/restaurant/swf/                ← 餐厅的锅 1340001
resource/postcard/preIcon/              ← 邮件 1000001
resource/bgSounds/BGM_                  ← BGM
```

### 第二轮（52 个空间，加入博物馆反推的 21 个新 ID 空间）→ 再解 1 条

```
resource/oneBigStree/swf/               ← 博物馆 oneBigStree ID 1330001
```

---

## 四、两个必须记下的工程坑

### 4.1 前缀解析：正则回溯会把 `{?}` 留下

第一轮矩阵**全数误报「不匹配」（0/27）**，连已知可行的 `resource/home/seed/icon/` 都失败。

根因是模板剥离用了：

```js
t.replace(/\{?\}?\.(swf|mp3)$/, '')   // ✗ 回溯后只吃掉 `}.swf`，`{?` 残留
```

拼出的 URL 是 `resource/home/seed/icon/{?/1230005.swf` —— 坏 URL。
改用显式剥离 + 保留扩展名后正常。

### 4.2 前缀不能强行补尾斜杠

`resource/newTask/task{?}.swf` 的真实形态是 `resource/newTask/task<ID>.swf`，
若统一补 `/` 会拼成 `.../task/123.swf`，错误。改为显式携带扩展名，`URL = prefix + id + ext`。

### 4.3 加了自检环节

上述两个坑之所以能被发现，是因为**加了自检**：探测前先测 4 个已知可行的 URL，
只要有一个不是 200 就中止，避免产出误导性结论。

```
[matrix] 自检（应全部 200）:
   ✅ 200  resource/home/seed/icon/1230005.swf
   ✅ 200  resource/home/item/icon/1220038.swf
   ✅ 200  resource/goods/icon/160267.swf
   ✅ 200  resource/allJob/icon/190016.swf
```

---

## 五、最终结果

### 已落地（17 / 29）

| 模板 | 文件数 |
|---|---|
| `resource/goods/icon/{?}.swf` | 1,416 |
| `resource/elementCard/icon/{?}.swf` | 709 |
| `resource/elementCard/show/{?}.swf` | 701 |
| `resource/postcard/preIcon/{?}.swf` | 372 |
| `resource/magicSpirit/icon/{?}.swf` | 188 |
| `resource/bgSounds/BGM_{?}.mp3` | 156 |
| `resource/newAngel/icon/{?}.swf` | 155 |
| `resource/home/seed/icon/{?}.swf` | 152 |
| `resource/farm/icon/{?}.swf` | 130 |
| `resource/newAngel/show/{?}.swf` | 118 |
| `resource/pet/icon/{?}.swf` | 108 |
| `resource/siren/icon/{?}.swf` | 91 |
| `resource/effect/icon/{?}.swf` | 89 |
| `resource/siren/swf/{?}.swf` | 83 |
| `resource/restaurant/swf/{?}.swf` | 73 |
| `resource/restaurant/eventResource/goods/{?}.swf` | 16 |
| `resource/oneBigStree/swf/{?}.swf` | 新增 |

### 之外还新增了一批**模板清单里没有**的命名空间

来自博物馆物品表：`allJob/icon`（1,424）、`angelFight/icon`（437）、
`angelPark/items/icon`（406）、`pig/icon`（293）、`dragon/show`（121）、
`digTreasure/icon`（109）、`petcloth/icon`（120）、`pethonor/icon`（24）、
`classroom/icon`（62）、`car/icon`（13）、`restaurant/icon`（73）、`home/item/icon`（458）。

### 判定为失效（11 / 29）

对这 11 条前缀，**客户端代码里没有任何具体路径实例**，判定为工具源码面向的旧版/未启用命名空间：

```
resource/activity/icon/        resource/fitment/item/       resource/flower/icon/
resource/groupFightResource/pet/  resource/item/cloth/icon/  resource/item/throw/icon/
resource/jobNpc/jobBookNPC/    resource/newAngel/skillico/  resource/newNpc/oneSide/
resource/pet/head/             resource/NPC/new_face/npc_
```

> `resource/flower/icon/` 是**小花仙**（hua.61.com）的命名空间，本就不属于摩尔。

### 结构比模板复杂（1 / 29）

`resource/newTask/task{?}.swf` 的真实结构是**嵌套**的：

```
resource/newTask/task<ID>/movie/task_movie_<ID>_<N>.swf
resource/newTask/task<ID>/task_<ID>_<N>.swf
resource/newTask/task<ID>/task_<ID>_<N>.swf
```

客户端代码里只有 5 个具体实例（`task1`、`task526`、`task626`、`task10004`、`task10009`），
不足以推断 ID 与帧号 N 的完整空间。

---

## 六、本轮规模变化

| | 文件数 | 体积 |
|---|---|---|
| 本轮起点 | 16,196 | 937.45 MB |
| **本轮终点** | **25,110** | **999.36 MB** |

有效资源 24,821 个（0 字节 289 个，均为源站即空）。

---

## 七、复现

```powershell
# 1) 拉博物馆物品全表（权威路径索引）
node tools\fetch-museum-items.js
node tools\fetch-list.js resources\museum-item-seeds.txt 10 8899

# 2) 抽取前缀↔ID 配对（客户端自有数据）
node tools\extract-prefix-id-index.js
node tools\extract-clientconfig-xml.js

# 3) 矩阵探测（含自检；第二轮可传入待解前缀清单）
node tools\probe-prefix-matrix.js
node tools\list-unresolved-prefixes.js        # 生成 round2-prefixes.txt
node tools\probe-prefix-matrix.js resources\round2-prefixes.txt

# 4) 展开并抓取
node tools\gen-matrix-seeds.js
node tools\fetch-list.js resources\matrix-seeds.txt 10 8899
```

---

## 十、第三轮：给「失效」判定补上硬证据 + 破开 newTask

第二轮的结论里有一条**判据偏弱**：判定 11 条前缀"失效"的依据是
「客户端代码里没有具体路径实例」。但代码完全可能动态拼路径，
所以这个判据不足以定论。本轮补做两件事。

### 10.1 密集探测：对每条前缀扫 799 个 ID

工具：[`tools/dense-probe-prefixes.js`](../tools/dense-probe-prefixes.js)

ID 候选按三条线构造：

1. **数量级铺开**：`1..20`、`100..120`、`1000..1020` … 一直到 `10^7`；
2. **已知 ID 家族**：从已发现的资源路径里统计出的 60 多个号段（如 `12000`、`162000`、`1650000`），每段取 7 个；
3. **已知 ID 全集采样**：把博物馆物品表 + 语料 ID 合并成 **11,738 个已知 ID**，等距取 200 个。

三条线并集 = **799 个 ID**，对 13 条前缀共 **10,387 次探测**。

结果：

```
✅ 存在   resource/oneBigStree/swf/     命中 6 个（1330001..1330006）
❌ 无命中 resource/activity/icon/       探测 799 个 ID
❌ 无命中 resource/fitment/item/        探测 799 个 ID
❌ 无命中 resource/flower/icon/         探测 799 个 ID
❌ 无命中 resource/groupFightResource/pet/
❌ 无命中 resource/item/cloth/icon/
❌ 无命中 resource/item/throw/icon/
❌ 无命中 resource/jobNpc/jobBookNPC/
❌ 无命中 resource/newAngel/skillico/
❌ 无命中 resource/newNpc/oneSide/
❌ 无命中 resource/pet/head/
❌ 无命中 resource/NPC/new_face/npc_
❌ 无命中 resource/newTask/task          ← 见 10.2，模板写错了
```

**结论**：这 11 条前缀在官方 CDN 上**确实不存在**。
它们来自易语言工具源码，那个工具面向的是更早的客户端版本或同族游戏——
`resource/flower/icon/` 更是**小花仙**（`hua.61.com`）的命名空间，被混进了工具的资源表。

> 一致性检查：探测同时跑了两个**控制组**（`resource/goods/icon/`、`resource/pet/icon/`），
> 两者都正常命中，证明探测链路本身有效、上面的"零命中"不是工具故障。

### 10.2 newTask：模板写错了，真实结构是嵌套的

第二轮把 `resource/newTask/task{?}.swf` 判为"结构比模板复杂"，本轮把它解开了。

工具：[`tools/probe-newtask.js`](../tools/probe-newtask.js)

**先反推模式。** 用客户端代码里那 5 个已知实例，对 4 种候选模式 × 帧号 1..30 探测：

| 模式 | 命中 | 说明 |
|---|---|---|
| `task<ID>/movie/task_movie_<ID>_<N>.swf` | **28 个**（ID 1/526/626，N 到 17 甚至 20） | **主模式** |
| `task<ID>/task_<ID>_<N>.swf` | 5 个（仅 ID 10009） | 变体 |
| `task<ID>/task_movie_<ID>_<N>.swf` | 1 个（仅 ID 10004） | 变体 |
| `task<ID>/movie/task_<ID>_<N>.swf` | 0 | 不存在 |

**再用 TaskSummary.xml 铺开。** `resource/xml/task/TaskSummary.xml`（49 KB）是客户端自带的
**任务总表**，从中解析出 **152 个任务 ID**。用主模式 × 152 个 ID × N≤23 探测：

```
阶段 2 命中 600 个文件，涉及 105 个 task 目录
```

**然后摸清 ID 空间。** 用「每个 ID 只探 3 个模式（N=1）」的高效探针扫描 1,766 个候选 ID：

工具：[`tools/scan-newtask-ids.js`](../tools/scan-newtask-ids.js)

```
5,298 次探针 → 存在的 task 目录 197 个
其中上一轮未覆盖的 92 个；还发现了 10001/10002/10004/10008/10009 这个五位系列
累计 1,318 条 URL
```

**结果：`resource/newTask` 从 22 个文件涨到 1,336 个。**

任务目录里除了 `task_movie_*`，还有别的子文件（如 `task10004/IceBabyTennisGame.swf`、
`panel_1.swf`），这类由递归爬取顺带发现。

### 10.3 检查器本身也有个 bug

修完之后 `resource/newTask/task{?}.swf` 一度仍显示"未落地"。
原因是 [`tools/list-unresolved-prefixes.js`](../tools/list-unresolved-prefixes.js)
只数**目录里的文件**，而 newTask 是 `task1/`、`task2/` 这样的**子目录结构**，自然数为 0。

改成「按路径前缀递归匹配」后显示正常（1,332 个）。

> **工具报出的数字也要怀疑。** 这一轮里，错的是工具而不是结论——
> 如果不追这一步，会误以为 newTask 还没解决。

---

## 十一、最终状态（29 条模板）

| | 数量 |
|---|---|
| **已落地真实文件** | **18** |
| 经密集探测判定不存在 | 11 |
| 结构特殊 | 0（newTask 已解） |

### 已落地的 18 条

| 模板 | 文件数 |
|---|---|
| `resource/goods/icon/{?}.swf` | 1,416 |
| **`resource/newTask/task{?}.swf`** | **1,332** |
| `resource/elementCard/icon/{?}.swf` | 709 |
| `resource/elementCard/show/{?}.swf` | 701 |
| `resource/postcard/preIcon/{?}.swf` | 372 |
| `resource/magicSpirit/icon/{?}.swf` | 188 |
| `resource/bgSounds/BGM_{?}.mp3` | 156 |
| `resource/newAngel/icon/{?}.swf` | 155 |
| `resource/home/seed/icon/{?}.swf` | 152 |
| `resource/farm/icon/{?}.swf` | 130 |
| `resource/newAngel/show/{?}.swf` | 118 |
| `resource/pet/icon/{?}.swf` | 108 |
| `resource/siren/icon/{?}.swf` | 91 |
| `resource/effect/icon/{?}.swf` | 89 |
| `resource/siren/swf/{?}.swf` | 83 |
| `resource/restaurant/swf/{?}.swf` | 73 |
| `resource/restaurant/eventResource/goods/{?}.swf` | 16 |
| `resource/oneBigStree/swf/{?}.swf` | 6 |

### 判定不存在的 11 条

```
resource/activity/icon/        resource/fitment/item/       resource/flower/icon/
resource/groupFightResource/pet/  resource/item/cloth/icon/  resource/item/throw/icon/
resource/jobNpc/jobBookNPC/    resource/newAngel/skillico/  resource/newNpc/oneSide/
resource/pet/head/             resource/NPC/new_face/npc_
```

---

## 十二、复现（第三轮部分）

```powershell
# 密集探测：给「不存在」判定补硬证据（含控制组自检）
node tools\dense-probe-prefixes.js

# 破开 newTask：先从 TaskSummary.xml 取任务 ID
#   （若未缓存，先 node tools\fetch-list.js 拉一次 resource/xml/task/TaskSummary.xml）
node tools\probe-newtask.js        # 反推模式 + 铺开帧号
node tools\scan-newtask-ids.js     # 摸清任务 ID 空间
node tools\fetch-list.js resources\newtask-seeds.txt 10 8899

# 复核落地情况（注意：这个检查器本身修过一次 bug）
node tools\list-unresolved-prefixes.js
```
