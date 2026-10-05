# 定向补抓：按新落盘的缓存抓相关文件

生成时间: 2026-10-06 00:4x（本次分析会话）
种子来源: 上次运行（2026-10-05 14:58:52 起）新落盘的 27 条缓存
工具: `tools/expand-related.js` → `resources/related-from-new-cache.txt` → `tools/fetch-list.js`
明细: `resources/related-fetch-results.json`

## 结果

| 项 | 值 |
|---|---|
| 展开候选 | 109 条（其中已缓存 44） |
| 实抓 | 65 + 33 = 98 次请求 |
| **新落盘** | **26 个文件** |
| 判定源站不存在 | 72 条（404，已记录，见下） |
| 缓存规模 | 26452 → **26480** 个文件 |

## 新增了什么

| 目录 | 新增 | 内容 |
|---|---|---|
| `resource/bgSounds` | 17 | `BGM_001a~f,h`（`g` 已有）、`FX_001,003,005~012` |
| `resource/cloth/bmpswf/1002` | 1 | `18262.swf` |
| `resource/cloth/bmpswf/1003` | 2 | `18103.swf`、`18262.swf` |
| `resource/cloth/icon` | 2 | `18218.swf`、`18262.swf` |
| `resource/cloth/prevIcon` | 3 | `18103.swf`、`18218.swf`、`18262.swf` |
| `resource/petcloth/swf/cloth` | 1 | `1200036.swf` |

## 顺带探明的命名空间规则（可回写进 gap-analysis）

| 命名空间 | 结论 | 证据 |
|---|---|---|
| `resource/bgSounds/BGM_<ID><后缀>.mp3` | 后缀空间是 **a..h**，i..z 全部 404 | `BGM_001a~h` 存在（g 此前已缓存），18 条 i..z 全 404 |
| `resource/bgSounds/FX_<ID>.mp3` | **001..012 全部存在** | FX_001、003、005~012 新增；002、004 此前已有 |
| `resource/dragon/<子目录>/<ID>_<变体>.swf` | 变体是**同目录同族**，不是跨目录：`bmpswf` 用 `_big_a/_big_b`，`show`/`icon` 用 `_2`（个别 `_1`） | `resource/dragon/show/1350002_2.swf` 存在，而 `resource/dragon/bmpswf/1350002_2.swf` 404 |
| `resource/petcloth` | 只有 **`swf2`** 与 `swf/cloth`；`swf1`、`swf3` 不存在 | 各 2 条 404 |
| `resource/petcloth/swf2/pet<ID>/skill_<N>.swf` | 只见到 **`skill_7`**；1~6、8 均 404 | 7 条 404 |
| `resource/cloth/bmpswf/<组>/<ID>.swf` | 组空间 {1001,1002,1003} 成立，但**存在性按 ID 而异**：18262 三组齐全；18103 仅 1003（1001/1002 是 0 字节空文件）；18218 仅 1001 | 5 条新增 + 2 条 404 |
| `resource/cloth/icon|prevIcon/<ID>.swf` | 与位图同 ID 成对，确实都有 | 5 条新增，0 条 404 |

## 客户端请求但源站确实没有的资源（记录在案，别再重复排查）

```
resource/xml/NPC/NPCJoblist1.xml / 2 / 3 / 9 / 69        （NPC 任务表，已下架）
resource/xml/task/Task411.xml                            （任务脚本，已下架）
resource/pet/icon/180011.swf / 180012 / 180013            （宠物图标，游戏内图标空白）
```

> 这些每次游玩都会重试（镜像不缓存失败结果）。若嫌日志难看，可在 molemirror 加一个
> 短 TTL 的负缓存（例如 30 分钟）——只影响观感，不影响正确性。

## 复现

```powershell
# 1) 起在线镜像（补抓要经它落盘）
powershell -ExecutionPolicy Bypass -File run.ps1 -NoRuffle

# 2) 按"上次运行"展开相关文件（--since 可指定特定一轮）
node tools\expand-related.js --since '2026-10-05 14:58:52'
node tools\expand-related.js --dry              # 只看统计不落盘

# 3) 抓取（第 4 个参数是结果文件，避免覆盖离线验收的 offline-verify-results.json）
node tools\fetch-list.js resources\related-from-new-cache.txt 8 8899 resources\related-fetch-results.json
```
