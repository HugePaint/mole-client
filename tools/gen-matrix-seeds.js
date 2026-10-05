'use strict';
/**
 * 把「矩阵探测已确认」的 (前缀, ID空间) 配对展开成完整候选 URL 列表。
 *
 * 矩阵探测只验证了配对关系（每组合取 3 个样本），这里按该 ID 空间**全量展开**。
 *
 * 输出: resources/matrix-seeds.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MATRIX = path.join(ROOT, 'resources', 'prefix-matrix-result.json');
const CORPUS = path.join(ROOT, 'resources', 'corpus-ids.json');
const OUT = path.join(ROOT, 'resources', 'matrix-seeds.txt');

const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8').replace(/^\uFEFF/, ''));
const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8').replace(/^\uFEFF/, ''));

// ID 空间名 → ID 数组
function spaceIds(name) {
  if (name.indexOf('ids.') === 0) {
    const k = name.slice(4);
    return Array.isArray(corpus.ids[k]) ? corpus.ids[k] : [];
  }
  const f = (corpus.allFolderIds || {})[name];
  return Array.isArray(f) ? f : [];
}

const urls = new Set();
const report = [];

matrix.results.forEach(function (r) {
  if (!r.hit) return;
  const ids = spaceIds(r.space).filter(function (x) { return /^\d+$/.test(x); });
  if (!ids.length) return;
  let n = 0;
  ids.forEach(function (id) {
    const u = r.prefix + id + r.ext;
    if (!urls.has(u)) { urls.add(u); n++; }
  });
  report.push({ prefix: r.prefix, space: r.space, ids: ids.length, added: n });
});

const arr = Array.from(urls).sort();
fs.writeFileSync(OUT, arr.join('\n') + '\n', 'utf8');

console.log('[matrix-seeds] 生成 ' + arr.length + ' 条 -> ' + OUT);
console.log('');
const byPre = {};
arr.forEach(function (p) { const k = p.replace(/[^/]*$/, ''); byPre[k] = (byPre[k] || 0) + 1; });
Object.keys(byPre).sort(function (a, b) { return byPre[b] - byPre[a]; }).forEach(function (k) {
  console.log('   ' + String(byPre[k]).padStart(5) + '  ' + k);
});
