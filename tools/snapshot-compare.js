'use strict';
/**
 * 历史缓存快照的去重比对（目标第 2 项）。
 *
 * 「52摩尔共享素材与数据」里有 32 个每周快照（2014-10 ~ 2015-01）。
 * 每个快照是**扁平的 24 个主文件**（Client.swf / Login.swf / ui.swf / 5 个 DLL …），
 * 也就是客户端引导集的**历史版本**，不是资源树。
 *
 * 因此它们的价值需要判定清楚：
 *   - 能否「补全」当前资源？ → 只有 24 个主文件，不能。
 *   - 是否是**独立的历史版本序列**？ → 用 7z 的 CRC 零解压比对即可回答。
 *
 * 做法: 对每个快照跑 `7z l -slt`，抽 Name/Size/CRC，按文件名横向汇总。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, '52摩尔共享素材与数据');
const SEVEN = 'C:\\Program Files\\7-Zip\\7z.exe';
const OUT = path.join(ROOT, 'resources', 'snapshot-compare.json');
const MD = path.join(ROOT, 'docs', 'snapshot-compare.md');

const snaps = fs.readdirSync(CORPUS)
  .filter(function (f) { return /^摩尔-\d{4}-\d+月\d+日主要缓存\.(rar|zip)$/.test(f); })
  .sort(function (a, b) {
    function key(s) {
      const m = s.match(/摩尔-(\d{4})-(\d+)月(\d+)日/);
      return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    }
    return key(a) - key(b);
  });

console.log('[snapshot] 找到快照 ' + snaps.length + ' 个');

const perFile = {};   // 文件名 -> { 日期: {size, crc} }
const perSnap = [];   // [{date, fileCount, totalBytes}]

snaps.forEach(function (s, i) {
  const full = path.join(CORPUS, s);
  let out;
  try {
    out = execFileSync(SEVEN, ['l', '-slt', full], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.log('  跳过 ' + s + ': ' + e.message);
    return;
  }
  const date = (s.match(/摩尔-(\d{4}-\d+月\d+日)/) || [])[1] || s;
  let curName = null, curSize = 0, curCrc = '';
  let fileCount = 0, totalBytes = 0;
  out.split(/\r?\n/).forEach(function (line) {
    let m;
    if ((m = line.match(/^Path = (.+)$/))) { curName = path.basename(m[1].trim()); curSize = 0; curCrc = ''; }
    else if ((m = line.match(/^Size = (\d+)$/))) curSize = Number(m[1]);
    else if ((m = line.match(/^CRC = ([0-9A-Fa-f]+)$/))) curCrc = m[1].toUpperCase();
    else if (line.trim() === '' && curName) {
      if (/\.(swf|xml|mp3|txt|gif|ico|png|jpg)$/i.test(curName)) {
        perFile[curName] = perFile[curName] || {};
        perFile[curName][date] = { size: curSize, crc: curCrc };
        fileCount++; totalBytes += curSize;
      }
      curName = null;
    }
  });
  perSnap.push({ date: date, archive: s, fileCount: fileCount, totalBytes: totalBytes });
  if ((i + 1) % 8 === 0) console.log('  已处理 ' + (i + 1) + '/' + snaps.length);
});

// 横向汇总：每个文件在多少个快照里出现、有多少个不同 CRC（= 有多少个版本）
const rows = Object.keys(perFile).map(function (name) {
  const versions = perFile[name];
  const dates = Object.keys(versions);
  const crcs = {};
  dates.forEach(function (d) { crcs[versions[d].crc] = (crcs[versions[d].crc] || 0) + 1; });
  return {
    name: name,
    appearances: dates.length,
    distinctVersions: Object.keys(crcs).length,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    latestSize: versions[dates[dates.length - 1]].size,
  };
}).sort(function (a, b) { return b.distinctVersions - a.distinctVersions || b.appearances - a.appearances; });

const out = {
  generatedAt: new Date().toISOString(),
  snapshotCount: snaps.length,
  perSnapshot: perSnap,
  filesTracked: rows.length,
  rows: rows,
  perFileVersions: perFile,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

// 对当前缓存做去重比对：主文件是否与线上现役版本一致
const CACHE = path.join(ROOT, 'cache', 'mole.61.com');
const crypto = require('crypto');
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16).toUpperCase(); }
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

const live = {};
[
  ['Client.swf', 'Client.swf'],
  ['ClientAppDLL.swf', 'dll/ClientAppDLL.swf'],
  ['ClientCommonDLL.swf', 'dll/ClientCommonDLL.swf'],
  ['ClientSocketDLL.swf', 'dll/ClientSocketDLL.swf'],
  ['ClientConfigDLL.swf', 'dll/ClientConfigDLL.swf'],
  ['TaomeeCoreDLL.swf', 'dll/TaomeeCoreDLL.swf'],
  ['Login.swf', 'resource/login/Login.swf'],
  ['LoginHome.swf', 'resource/login/LoginHome.swf'],
  ['ui.swf', 'resource/ui/ui.swf'],
  ['index.swf', 'resource/ui/index.swf'],
].forEach(function (pair) {
  const p = path.join(CACHE, pair[1].replace('/', path.sep));
  if (fs.existsSync(p)) live[pair[0]] = { path: pair[1], size: fs.statSync(p).size, crc: crc32(fs.readFileSync(p)) };
});

const md = [];
md.push('# 历史缓存快照 · 去重比对');
md.push('');
md.push('数据源：`52摩尔共享素材与数据/摩尔-YYYY-M月D日主要缓存.rar` × ' + snaps.length + ' 个（2014-10 ~ 2015-01）。');
md.push('');
md.push('## 结论：快照是「引导集的历史版本序列」，不是资源树');
md.push('');
md.push('每个快照是**扁平的 24 个主文件**（`Client.swf` / `Login.swf` / `ui.swf` / 5 个 DLL …），');
md.push('没有 `resource/` 目录结构。因此它们**无法补全**当前资源 —— 但可以作为**版本演进对照**。');
md.push('');
md.push('| 文件 | 出现快照数 | **不同版本数** | 首次 | 末次 |');
md.push('|---|---|---|---|---|');
rows.slice(0, 20).forEach(function (r) {
  md.push('| `' + r.name + '` | ' + r.appearances + ' | **' + r.distinctVersions + '** | ' + r.firstDate + ' | ' + r.lastDate + ' |');
});
md.push('');
md.push('## 与线上现役版本比对');
md.push('');
md.push('| 文件 | 线上路径 | 线上大小 | 线上 CRC32 | 是否等于快照版本 |');
md.push('|---|---|---|---|---|');
Object.keys(live).forEach(function (n) {
  const L = live[n];
  const vs = perFile[n] || {};
  const same = Object.keys(vs).filter(function (d) { return vs[d].crc === L.crc; });
  md.push('| `' + n + '` | `' + L.path + '` | ' + L.size + ' | ' + L.crc + ' | ' + (same.length ? same.join(', ') : '**无**（线上是更新的版本）') + ' |');
});
md.push('');
fs.writeFileSync(MD, md.join('\n'), 'utf8');

console.log('\n[snapshot] 跟踪到的文件数: ' + rows.length);
console.log('[snapshot] 版本最多的文件:');
rows.slice(0, 10).forEach(function (r) {
  console.log('   ' + r.name.padEnd(24) + ' 出现 ' + String(r.appearances).padStart(2) + ' 次, ' + r.distinctVersions + ' 个不同版本');
});
console.log('\n[snapshot] 线上现役主文件 vs 快照:');
Object.keys(live).forEach(function (n) {
  const vs = perFile[n] || {};
  const same = Object.keys(vs).filter(function (d) { return vs[d].crc === live[n].crc; });
  console.log('   ' + n.padEnd(24) + (same.length ? ('与快照一致: ' + same.join(',')) : '线上为新版本'));
});
console.log('\n[snapshot] 输出 -> ' + MD);
console.log('[snapshot] 数据 -> ' + OUT);
