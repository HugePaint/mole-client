'use strict';
/**
 * Phase 2 缺口分析：把「实际抓到的」与「理论上应该存在的」对照，量化本地化完成度。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'mole.61.com');
const MUSEUM = path.join(ROOT, 'resources', 'museum-seeds.json');
const CRAWL = path.join(ROOT, 'resources', 'crawl-results.json');
const OUT = path.join(ROOT, 'resources', 'gap-analysis.md');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    es.forEach(function (e) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(CACHE, p).replace(/\\/g, '/'));
    });
  })(dir);
  return out;
}

const files = listFiles(CACHE);
const fileSet = new Set(files);
const museum = readJson(MUSEUM);
const crawl = fs.existsSync(CRAWL) ? readJson(CRAWL) : { results: [] };

const L = [];
function w(s) { L.push(s); }

w('# Phase 2 资源本地化 · 缺口分析');
w('');
w('生成时间: ' + new Date().toISOString());
w('');
w('## 总览');
w('');
let totalBytes = 0;
files.forEach(function (f) {
  try { totalBytes += fs.statSync(path.join(CACHE, f)).size; } catch (e) { }
});
w('- 本地文件总数: **' + files.length + '**');
w('- 本地总体积: **' + (totalBytes / 1048576).toFixed(2) + ' MB**');
const byExt = {};
files.forEach(function (f) {
  const e = path.extname(f).toLowerCase() || '(none)';
  byExt[e] = (byExt[e] || 0) + 1;
});
w('- 扩展名分布: ' + Object.keys(byExt).sort(function (a, b) { return byExt[b] - byExt[a]; })
  .map(function (k) { return k + '=' + byExt[k]; }).join(', '));
w('');

// ── 地图 ──
w('## 地图覆盖');
w('');
const mapHave = new Set();
files.forEach(function (f) {
  const m = f.match(/^resource\/map\/Map_(\d+)\.(swf|xml)$/);
  if (m) mapHave.add(String(Number(m[1]) - 10000));
});
const museumMaps = new Set((museum.ids && museum.ids.map || []).map(String));
const mapMissing = Array.from(museumMaps).filter(function (x) { return !mapHave.has(x); })
  .sort(function (a, b) { return a - b; });
const mapExtra = Array.from(mapHave).filter(function (x) { return !museumMaps.has(x); })
  .sort(function (a, b) { return a - b; });
w('- 博物馆收录地图: ' + museumMaps.size);
w('- 客户端已抓到: **' + mapHave.size + '**');
w('- 博物馆有、客户端未抓到 (' + mapMissing.length + '): ' +
  (mapMissing.length ? mapMissing.join(', ') : '（无）'));
w('- 客户端有、博物馆未收录 (' + mapExtra.length + '): ' +
  (mapExtra.length ? mapExtra.join(', ') : '（无）'));
w('');

// ── 衣服 ──
w('## 衣服覆盖');
w('');
const clothIcons = files.filter(function (f) { return /^resource\/cloth\/icon\/\d+\.swf$/.test(f); });
const clothIds = new Set((museum.ids && museum.ids.cloth || []).map(String));
const iconIds = new Set(clothIcons.map(function (f) { return f.match(/(\d+)\.swf$/)[1]; }));
const clothMissing = Array.from(clothIds).filter(function (x) { return !iconIds.has(x); });
w('- 博物馆收录衣服 ID: ' + clothIds.size);
w('- 已抓到衣服图标: **' + iconIds.size + '**（未命中 ' + clothMissing.length + '）');
const clothBmps = files.filter(function (f) { return /^resource\/cloth\/bmpswf\//.test(f); });
w('- 已抓到衣服位图 (cloth/bmpswf): ' + clothBmps.length);
w('');

// ── 抓取效率 ──
w('## 爬取效率');
w('');
const r = crawl.results || [];
const ok = r.filter(function (x) { return x.status === 200; }).length;
const nf = r.filter(function (x) { return x.status === 404 || x.status === 403; }).length;
w('- 累计请求: ' + r.length + '（200 = ' + ok + '，404/403 = ' + nf + '）');
w('- 命中率: ' + (r.length ? ((ok / r.length) * 100).toFixed(1) : '0') + '%');
w('');

// 404 的路径按目录归类 —— 这些是「猜测但不存在」的，说明该命名空间没那么多资源
const nfByDir = {};
r.filter(function (x) { return x.status === 404 || x.status === 403; }).forEach(function (x) {
  const d = x.path.split('/').slice(0, 2).join('/');
  nfByDir[d] = (nfByDir[d] || 0) + 1;
});
w('### 404 的分布（说明哪些命名空间被高估了）');
w('');
w('| 目录 | 404 数 |');
w('|---|---|');
Object.keys(nfByDir).sort(function (a, b) { return nfByDir[b] - nfByDir[a]; }).slice(0, 15).forEach(function (k) {
  w('| `' + k + '` | ' + nfByDir[k] + ' |');
});
w('');

// ── 分类分布 ──
w('## 本地资源分类分布');
w('');
const cat = {};
files.forEach(function (f) {
  const k = f.split('/').slice(0, 2).join('/');
  cat[k] = (cat[k] || 0) + 1;
});
w('| 目录 | 文件数 |');
w('|---|---|');
Object.keys(cat).sort(function (a, b) { return cat[b] - cat[a]; }).slice(0, 25).forEach(function (k) {
  w('| `' + k + '` | ' + cat[k] + ' |');
});
w('');

// ── 仍待枚举的命名空间 ──
w('## 仍待枚举的命名空间（静态爬取触达不到）');
w('');
w('这些路径带**运行时 ID**，只有游玩或服务端数据才能给出具体取值：');
w('');
w('| 模板 | 说明 |');
w('|---|---|');
w('| `resource/cloth/bmpswf/<组>/<衣服ID>.swf` | 衣服位图。衣服 ID 已知（博物馆），但**组号未知** |');
w('| `resource/petcloth/swf<组>/<宠物ID>.swf` | 宠物装扮 |');
w('| `resource/petcloth/swf2/pet<ID>/skill_<N>.swf` | 宠物技能特效 |');
w('| `resource/home/seed/swf/<ID>.swf` | 家园种子 |');
w('| `resource/home/item/swf/<ID>.swf` | 家园物品 |');
w('| `resource/xml/NPC/NPCJoblist<ID>.xml` | NPC 任务状态表 |');
w('| `resource/xml/task/Task<ID>.xml` | 任务脚本 |');
w('| `resource/bgSounds/BGM_<ID>.mp3` | 背景音乐 |');
w('| `resource/dragon/bmpswf/<ID>_big_a.swf` | 坐骑位图 |');
w('');

fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(L.join('\n'));
console.log('\n报告 -> ' + OUT);
