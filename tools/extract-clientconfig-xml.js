'use strict';
/**
 * 从 ClientConfigDLL.swf 里抽出内嵌的配置 XML（摩尔配置）。
 *
 * 重要发现：该 DLL 内含形如
 *     <Item ID="1220038" Type="2" Path="resource/home/item/icon/" Name="..." />
 * 的配置条目 —— 这是**带 ID 的权威资源索引**，比任何外部语料都可靠。
 * （也解释了为什么语料 `家具\160001.swf` 这类名字探测会 404：那不是客户端 ID。）
 *
 * 输出: resources/clientconfig-index.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '_re', 'official', 'dll_ClientConfigDLL.swf.inflated.bin');
const OUT = path.join(ROOT, 'resources', 'clientconfig-index.json');

const buf = fs.readFileSync(SRC);
// AS3 字符串常量是 UTF-8；XML 属性名都是 ASCII，用 utf8 读即可
const t = buf.toString('utf8');
console.log('[clientconfig] 文件 ' + (buf.length / 1048576).toFixed(2) + ' MB');

// ── 1) 所有 Path="..." 属性 ──
const pathCount = {};
let m;
const rePath = /Path="([^"]{4,140})"/g;
while ((m = rePath.exec(t)) !== null) {
  pathCount[m[1]] = (pathCount[m[1]] || 0) + 1;
}

// ── 2) ID + Path 配对 ──
// 属性顺序不完全固定，因此允许两者之间出现任意属性
const pairs = [];
const rePair = /ID="(\d{2,10})"[^>]{0,300}?Path="([^"]{4,140})"/g;
while ((m = rePair.exec(t)) !== null) pairs.push([m[1], m[2]]);

// 也试试反序（Path 在前）
const pairs2 = [];
const rePair2 = /Path="([^"]{4,140})"[^>]{0,300}?ID="(\d{2,10})"/g;
while ((m = rePair2.exec(t)) !== null) pairs2.push([m[2], m[1]]);

const all = pairs.concat(pairs2);
const byPath = {};
all.forEach(function (p) {
  byPath[p[1]] = byPath[p[1]] || new Set();
  byPath[p[1]].add(p[0]);
});

// ── 3) 直接出现的完整资源路径（含数字 ID）──
const concrete = new Set();
const reConc = /(resource|module)\/[A-Za-z0-9_/\u4e00-\u9fff]{2,80}\/\d{3,9}\.swf/g;
while ((m = reConc.exec(t)) !== null) concrete.add(m[0]);

// ── 4) 所有 fragment 形式的目录（供后续与 ID 交叉）──
const dirs = new Set();
const reDir = /(resource|module)\/[A-Za-z0-9_/\u4e00-\u9fff]{2,80}\//g;
while ((m = reDir.exec(t)) !== null) dirs.add(m[0]);

const summary = {};
Object.keys(byPath).forEach(function (p) { summary[p] = byPath[p].size; });

const out = {
  generatedAt: new Date().toISOString(),
  source: 'dll/ClientConfigDLL.swf（内嵌配置 XML）',
  stats: {
    pathAttributes: Object.keys(pathCount).length,
    idPathPairs: all.length,
    concretePaths: concrete.size,
    dirFragments: dirs.size,
  },
  pathAttributeCounts: pathCount,
  idsByPath: (function () {
    const o = {};
    Object.keys(byPath).forEach(function (p) { o[p] = Array.from(byPath[p]).sort(); });
    return o;
  })(),
  concretePaths: Array.from(concrete).sort(),
  dirFragments: Array.from(dirs).sort(),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('[clientconfig] Path 属性去重: ' + out.stats.pathAttributes);
console.log('[clientconfig] ID+Path 配对: ' + out.stats.idPathPairs);
console.log('[clientconfig] 完整资源路径: ' + out.stats.concretePaths);
console.log('[clientconfig] 目录片段: ' + out.stats.dirFragments);
console.log('');
console.log('--- 带 ID 的目录（按 ID 数排序，Top 25）---');
Object.keys(summary).sort(function (a, b) { return summary[b] - summary[a]; }).slice(0, 25).forEach(function (p) {
  const ids = Array.from(byPath[p]).sort();
  console.log('   ' + String(summary[p]).padStart(5) + '  ' + p.padEnd(46) + ' 样例 ' + ids.slice(0, 4).join(','));
});
console.log('');
console.log('--- 目录片段（Top 30）---');
out.dirFragments.slice(0, 30).forEach(function (d) { console.log('   ' + d); });
console.log('');
console.log('[clientconfig] 输出 -> ' + OUT);
