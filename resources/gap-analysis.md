# Phase 2 资源本地化 · 缺口分析

生成时间: 2026-10-04T19:31:37.089Z

## 总览

- 本地文件总数: **14646**
- 本地总体积: **929.55 MB**
- 扩展名分布: .swf=14157, .xml=316, .mp3=170, .jpg=2, .txt=1

## 地图覆盖

- 博物馆收录地图: 282
- 客户端已抓到: **260**
- 博物馆有、客户端未抓到 (26): 243, 244, 245, 246, 247, 248, 249, 250, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 322, 327
- 客户端有、博物馆未收录 (4): 351, 352, 399, 402

## 衣服覆盖

- 博物馆收录衣服 ID: 1433
- 已抓到衣服图标: **1458**（未命中 4）
- 已抓到衣服位图 (cloth/bmpswf): 11178

## 爬取效率

- 累计请求: 15665（200 = 14643，404/403 = 1021）
- 命中率: 93.5%

### 404 的分布（说明哪些命名空间被高估了）

| 目录 | 404 数 |
|---|---|
| `resource/map` | 647 |
| `resource/cloth` | 350 |
| `resource/allJob` | 11 |
| `resource/task` | 7 |
| `module/game` | 2 |
| `module/external` | 2 |
| `resource/farm` | 1 |
| `resource/movie` | 1 |

## 本地资源分类分布

| 目录 | 文件数 |
|---|---|
| `resource/cloth` | 12679 |
| `resource/map` | 616 |
| `module/external` | 293 |
| `resource/allJob` | 174 |
| `resource/bgSounds` | 161 |
| `module/game` | 93 |
| `resource/pet` | 51 |
| `resource/xml` | 51 |
| `resource/task` | 49 |
| `resource/dragon` | 41 |
| `module/pig` | 38 |
| `resource/movie` | 29 |
| `resource/slOnlyItems` | 26 |
| `resource/angelsAndDemons` | 23 |
| `resource/newTask` | 23 |
| `module/gameUI` | 18 |
| `resource/besmearBook` | 15 |
| `resource/home` | 15 |
| `resource/lamuWorldConvert` | 15 |
| `resource/petcloth` | 13 |
| `resource/acclimationSMC` | 12 |
| `resource/pig` | 10 |
| `resource/ui` | 10 |
| `resource/goods` | 9 |
| `resource/farm` | 8 |

## 仍待枚举的命名空间（静态爬取触达不到）

这些路径带**运行时 ID**，只有游玩或服务端数据才能给出具体取值：

| 模板 | 说明 |
|---|---|
| `resource/cloth/bmpswf/<组>/<衣服ID>.swf` | 衣服位图。衣服 ID 已知（博物馆），但**组号未知** |
| `resource/petcloth/swf<组>/<宠物ID>.swf` | 宠物装扮 |
| `resource/petcloth/swf2/pet<ID>/skill_<N>.swf` | 宠物技能特效 |
| `resource/home/seed/swf/<ID>.swf` | 家园种子 |
| `resource/home/item/swf/<ID>.swf` | 家园物品 |
| `resource/xml/NPC/NPCJoblist<ID>.xml` | NPC 任务状态表 |
| `resource/xml/task/Task<ID>.xml` | 任务脚本 |
| `resource/bgSounds/BGM_<ID>.mp3` | 背景音乐 |
| `resource/dragon/bmpswf/<ID>_big_a.swf` | 坐骑位图 |
