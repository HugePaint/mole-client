'use strict';
/**
 * 列出「仍未在本地缓存里落地」的模板前缀，作为第二轮矩阵探测的清单。
 *
 * 判定方式：把模板的前缀映射到 cache 目录，数实际文件数；为 0 即仍未解开。
 * 兼容两类前缀：
 *   - 目录式：resource/elementCard/icon/  → 直接数该目录
 *   - 字面式：resource/bgSounds/BGM_      → 数同目录下以 BGM_ 开头的文件
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'mole.61.com');
const SRC = path.join(ROOT, 'resources', 'tool-templates-unresolved.txt');
const OUT = path.join(ROOT, 'resources', 'round2-prefixes.txt');

const list = fs.readFileSync(SRC, 'utf8').split(/\r?\n/)
  .map(function (s) { return s.trim(); }).filter(Boolean);

// 先把整个缓存的相对路径收集一次，用于「嵌套目录」型前缀的判定。
// 例如 resource/newTask/task{?}.swf 的真实结构是 resource/newTask/task626/movie/...，
// 只数 newTask 目录下的文件会漏掉——必须按路径前缀递归匹配。
const allRel = [];
(function walk(d, base) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  es.forEach(function (e) {
    const p = path.join(d, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, rel);
    else allRel.push(rel);
  });
})(CACHE, '');
console.log('（缓存内 ' + allRel.length + ' 个文件参与匹配）\n');

const unresolved = [];
const resolved = [];

list.forEach(function (t) {
  const prefix = t.replace(/\{[^}]*\}/g, '').replace(/\.(swf|mp3)$/i, '');
  const exts = /\.mp3$/i.test(t) ? /\.mp3$/i : /\.swf$/i;

  let n = 0;
  // 目录式与嵌套目录式统一按「路径以 prefix 开头」判定
  for (let i = 0; i < allRel.length; i++) {
    const r = allRel[i];
    if (r.length > prefix.length && r.lastIndexOf(prefix, 0) === 0 && exts.test(r)) n++;
  }

  (n > 0 ? resolved : unresolved).push({ template: t, prefix: prefix, files: n });
});

resolved.sort(function (a, b) { return b.files - a.files; });
console.log('已落地 (' + resolved.length + '):');
resolved.forEach(function (r) { console.log('   ✅ ' + String(r.files).padStart(5) + ' 个  ' + r.template); });

console.log('');
console.log('仍未落地 (' + unresolved.length + '):');
unresolved.forEach(function (r) { console.log('   ❌ ' + r.template); });

fs.writeFileSync(OUT, unresolved.map(function (r) { return r.prefix; }).join('\n') + '\n', 'utf8');
console.log('');
console.log('二轮探测清单 -> ' + OUT);
