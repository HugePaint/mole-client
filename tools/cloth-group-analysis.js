'use strict';
/**
 * 破解 resource/cloth/bmpswf/<组>/<衣服ID>.swf 的组号生成规律。
 *
 * 假设: 组号 = 1000 + typeid
 *   证据: 实测组空间只有 {1001, 1002, 1003}；
 *         博物馆 ClothJson 每条都有 typeid 字段。
 *
 * 做法: 把「已抓到的 (组,ID)」与「博物馆的 ID→typeid」对照，看假设成立与否。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'mole.61.com', 'resource', 'cloth', 'bmpswf');
const SUIT = path.join(ROOT, '_re', 'museum', 'suitlist.json');
const OUT = path.join(ROOT, 'resources', 'cloth-group-analysis.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }

// ── 1) 博物馆: 衣服 ID -> typeid / 名称 / 部位 ──
const idInfo = {};        // id -> {typeid, name, part}
const typeidCount = {};   // typeid -> 数量
try {
  const s = readJson(SUIT);
  (s.results || []).forEach(function (r) {
    (r.ClothJson || []).forEach(function (c) {
      if (!c.id) return;
      let part = '';
      (c.table || []).forEach(function (t) { if (t.title === '部位') part = t.content; });
      idInfo[String(c.id)] = { typeid: c.typeid, name: c.name, part: part };
      typeidCount[c.typeid] = (typeidCount[c.typeid] || 0) + 1;
    });
  });
} catch (e) { console.log('套装数据解析失败: ' + e.message); }

console.log('博物馆衣服条目: ' + Object.keys(idInfo).length);
console.log('typeid 分布: ' + Object.keys(typeidCount).sort().map(function (k) {
  return k + '=' + typeidCount[k];
}).join(', '));

// ── 2) 本地已抓到的 (组, ID) ──
const got = [];
(function walk(d) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  es.forEach(function (e) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    const m = e.name.match(/^(\d+)\.swf$/);
    if (!m) return;
    got.push({ group: path.basename(d), id: m[1] });
  });
})(CACHE);

console.log('\n本地 cloth/bmpswf 文件: ' + got.length);
const groups = Array.from(new Set(got.map(function (g) { return g.group; }))).sort();
console.log('实际出现的组: ' + groups.join(', '));

// ── 3) 验证假设 ──
let match = 0, mismatch = 0, unknown = 0;
const mismatches = [];
got.forEach(function (g) {
  const info = idInfo[g.id];
  if (!info || info.typeid === undefined) { unknown++; return; }
  const predicted = String(1000 + Number(info.typeid));
  if (predicted === g.group) match++;
  else { mismatch++; mismatches.push({ id: g.id, group: g.group, typeid: info.typeid, predicted: predicted, name: info.name, part: info.part }); }
});

console.log('\n===== 假设「组号 = 1000 + typeid」验证 =====');
console.log('  吻合:   ' + match);
console.log('  不符:   ' + mismatch);
console.log('  ID 不在博物馆数据里: ' + unknown);

if (mismatches.length) {
  console.log('\n--- 不符样例（前 20）---');
  mismatches.slice(0, 20).forEach(function (m) {
    console.log('   ID=' + m.id + ' 实际组=' + m.group + ' 预测=' + m.predicted +
      ' typeid=' + m.typeid + '  部位=' + m.part + '  名称=' + m.name);
  });
}

// ── 4) 反向: 每个组里的 ID 其 typeid 是否恒定 ──
console.log('\n===== 每个组内 ID 的 typeid 分布（若假设成立，应各自恒定）=====');
const byGroup = {};
got.forEach(function (g) { (byGroup[g.group] = byGroup[g.group] || []).push(g.id); });
Object.keys(byGroup).sort().forEach(function (grp) {
  const dist = {};
  let miss = 0;
  byGroup[grp].forEach(function (id) {
    const info = idInfo[id];
    if (!info) { miss++; return; }
    dist[info.typeid] = (dist[info.typeid] || 0) + 1;
  });
  console.log('  组 ' + grp + ': ' + Object.keys(dist).sort().map(function (k) {
    return 'typeid' + k + '=' + dist[k];
  }).join(', ') + (miss ? '  (未收录 ' + miss + ' 个)' : ''));
});

// ── 5) 若成立，生成完整枚举 ──
const typeids = Object.keys(typeidCount).map(Number).sort(function (a, b) { return a - b; });
const allIds = Object.keys(idInfo).sort(function (a, b) { return a - b; });
const candidates = [];
if (mismatch === 0 && match > 0) {
  allIds.forEach(function (id) {
    const g = String(1000 + Number(idInfo[id].typeid));
    candidates.push('resource/cloth/bmpswf/' + g + '/' + id + '.swf');
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  hypothesis: 'group == 1000 + typeid',
  museumClothCount: Object.keys(idInfo).length,
  typeidDistribution: typeidCount,
  localGroups: groups,
  localFiles: got.length,
  verification: { match: match, mismatch: mismatch, unknown: unknown },
  mismatches: mismatches.slice(0, 50),
  generatedCandidates: candidates.length,
  candidates: candidates,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('\n===== 结论 =====');
if (mismatch === 0 && match > 0) {
  console.log('  假设成立！可枚举组合: ' + candidates.length + ' 条');
} else {
  console.log('  假设不成立，需另找规律。');
}
console.log('  输出 -> ' + OUT);
