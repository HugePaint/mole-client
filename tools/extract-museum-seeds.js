'use strict';
/**
 * 从摩尔博物馆的数据接口结果中抽取「客户端资源路径」与「ID 空间」。
 *
 * 已确认可用接口:
 *   /api?event=getmaplist&pagesize=N&pageid=P      地图（含 NPC/传送点/对话）
 *   /api?event=getmapbyid&id=<mapId>
 *   /api?event=getsuitlist&onlyvip=0&pagesize=N&pageid=P   套装（ClothJson[].path 直接是资源路径）
 *   /api?event=getsuitinfobyid&id=<id>
 *   /api?event=getitemfromtype&type=<t>&pagesize=N&pageid=P
 *
 * 输入: _re/museum/maplist.json, _re/museum/suitlist.json
 * 输出: resources/museum-seeds.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUSEUM = path.join(ROOT, '_re', 'museum');
const OUT = path.join(ROOT, 'resources', 'museum-seeds.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

const resourcePaths = new Set();   // 直接可用的客户端资源路径
const idSpaces = {                 // 各类 ID 空间（用于组合式探测）
  cloth: new Set(),
  suit: new Set(),
  map: new Set(),
  npc: new Set(),
  item: new Set(),
};
const notes = [];

// 递归找出对象里所有形似资源路径的字符串
function harvestPaths(node, keyHint) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    // 直接是路径
    if (/^(resource|module|dll|version|config)\/.+\.(swf|xml|mp3|png|jpg)$/i.test(node)) {
      resourcePaths.add(node);
    }
    return;
  }
  if (Array.isArray(node)) { node.forEach(function (x) { harvestPaths(x, keyHint); }); return; }
  if (typeof node === 'object') {
    Object.keys(node).forEach(function (k) {
      const v = node[k];
      // 记录各种 ID
      if (k === 'id' || k === 'ID' || k === 'ItemID' || k === 'NpcID' || k === '_id') {
        if (typeof v === 'string' || typeof v === 'number') {
          const s = String(v);
          if (/^\d{1,8}$/.test(s)) {
            const lk = k.toLowerCase();
            if (lk === 'npcid') idSpaces.npc.add(s);
            else if (lk === '_id' && keyHint === 'map') idSpaces.map.add(s);
            else idSpaces.item.add(s);
          }
        }
      }
      harvestPaths(v, k);
    });
  }
}

// ── 套装 ──
let suitIds = 0, clothIds = 0;
try {
  const s = readJson(path.join(MUSEUM, 'suitlist.json'));
  const rows = s.results || [];
  notes.push('套装记录数: ' + rows.length);
  rows.forEach(function (r) {
    if (r._id) idSpaces.suit.add(String(r._id));
    suitIds++;
    (r.ClothJson || []).forEach(function (c) {
      if (c.id) { idSpaces.cloth.add(String(c.id)); clothIds++; }
      if (c.path) resourcePaths.add(c.path);
    });
    // Cloth 字段是逗号分隔的 ID 串
    if (r.Cloth) String(r.Cloth).split(',').forEach(function (x) {
      x = x.trim(); if (/^\d+$/.test(x)) idSpaces.cloth.add(x);
    });
  });
  notes.push('套装内衣物条目: ' + clothIds);
} catch (e) { notes.push('套装解析失败: ' + e.message); }

// ── 地图 ──
try {
  const m = readJson(path.join(MUSEUM, 'maplist.json'));
  const rows = m.results || [];
  notes.push('地图记录数: ' + rows.length);
  rows.forEach(function (r) {
    if (r._id !== undefined) idSpaces.map.add(String(r._id));
    harvestPaths(r, 'map');
    // 地图记录里若出现形如 10010 的 5 位数，单独记录（可能就是客户端 Map_ 资源号）
    JSON.stringify(r).replace(/"(\d{5})"/g, function (_, d) { idSpaces.item.add(d); return _; });
  });
} catch (e) { notes.push('地图解析失败: ' + e.message); }

// 从套装的 path 里反推目录模板
const templates = new Set();
resourcePaths.forEach(function (p) {
  const t = p.replace(/[^/]+\.(swf|xml|mp3|png|jpg)$/i, '');
  templates.add(t);
});

const out = {
  generatedAt: new Date().toISOString(),
  source: 'museum.61player.com /api?event=getmaplist|getsuitlist',
  notes: notes,
  stats: {
    resourcePaths: resourcePaths.size,
    templates: templates.size,
    clothIds: idSpaces.cloth.size,
    suitIds: idSpaces.suit.size,
    mapIds: idSpaces.map.size,
    npcIds: idSpaces.npc.size,
    otherIds: idSpaces.item.size,
  },
  resourcePaths: Array.from(resourcePaths).sort(),
  templates: Array.from(templates).sort(),
  ids: {
    cloth: Array.from(idSpaces.cloth).sort(function (a, b) { return a - b; }),
    suit: Array.from(idSpaces.suit).sort(function (a, b) { return a - b; }),
    map: Array.from(idSpaces.map).sort(function (a, b) { return a - b; }),
    npc: Array.from(idSpaces.npc).sort(function (a, b) { return a - b; }),
  },
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('[museum-seeds] ' + notes.join(' | '));
console.log('[museum-seeds] 资源路径 ' + out.stats.resourcePaths + ' 条');
console.log('[museum-seeds] 目录模板 ' + out.stats.templates + ' 个');
console.log('[museum-seeds] ID 空间: cloth=' + out.stats.clothIds + ' suit=' + out.stats.suitIds +
  ' map=' + out.stats.mapIds + ' npc=' + out.stats.npcIds + ' other=' + out.stats.otherIds);
console.log('[museum-seeds] 输出 ' + OUT);

console.log('\n--- 目录模板 ---');
out.templates.forEach(function (t) { console.log('   ' + t); });
console.log('\n--- 资源路径样例（前 20）---');
out.resourcePaths.slice(0, 20).forEach(function (p) { console.log('   ' + p); });
console.log('\n--- cloth ID 区间 ---');
const ci = out.ids.cloth;
if (ci.length) console.log('   ' + ci[0] + ' .. ' + ci[ci.length - 1] + '（共 ' + ci.length + ' 个）');
console.log('\n--- map ID 样例（前 40）---');
console.log('   ' + out.ids.map.slice(0, 40).join(', '));
