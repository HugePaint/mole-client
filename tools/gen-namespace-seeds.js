'use strict';
/**
 * 生成「已确认命名空间」的候选 URL。
 *
 * 命名空间与其 ID 来源的对应关系，全部经过实测确认（不是猜的）：
 *
 *   resource/goods/icon/<id>.swf      ← 语料「家具」1401 个 (160001..161509)   ✔ 实测 200
 *   resource/farm/icon/<id>.swf       ← 语料「牧场动物」123 个 (1270001..)      ✔ 实测 200
 *   resource/goods/icon/<id>.swf      ← 语料「拉姆用具」104 个 (180001..)       ? 待验证
 *   resource/home/item/icon/<id>.swf  ← ClientConfigDLL 配置 XML 里的 ID        ✔ 实测 200
 *   resource/home/item/swf/<id>.swf   ← 同上                                    ✔ 实测 200
 *   resource/home/seed/icon/<id>.swf  ← 同上                                    ✔ 实测 200
 *
 * 输出: resources/namespace-seeds.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'resources', 'corpus-ids.json');
const CFG = path.join(ROOT, 'resources', 'clientconfig-index.json');
const OUT = path.join(ROOT, 'resources', 'namespace-seeds.txt');

const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8').replace(/^\uFEFF/, ''));
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8').replace(/^\uFEFF/, ''));

const urls = new Set();
function add(p) { if (p) urls.add(p); }

// 1) 家具 → resource/goods/icon/
(corpus.ids.furniture || []).forEach(function (id) { add('resource/goods/icon/' + id + '.swf'); });

// 2) 牧场动物 → resource/farm/icon/
(corpus.ids.ranch || []).forEach(function (id) { add('resource/farm/icon/' + id + '.swf'); });

// 3) 拉姆用具 → 先试 goods/icon（同属"物品"大类），再试 lamuWorldConvert
(corpus.ids.lamu || []).forEach(function (id) {
  add('resource/goods/icon/' + id + '.swf');
});

// 4) ClientConfigDLL 配置 XML 里成对给出的 ID → 直接展开
const byPath = cfg.idsByPath || {};
Object.keys(byPath).forEach(function (prefix) {
  if (!/\/$/.test(prefix)) return;                 // 只处理目录式前缀
  byPath[prefix].forEach(function (id) {
    add(prefix + id + '.swf');
    // home/item 同时有 icon 与 swf 两种
    if (prefix === 'resource/home/item/icon/') add('resource/home/item/swf/' + id + '.swf');
  });
});

// 5) 邻居扩展：家具 ID 区间有大量跳号，按已确认前缀补齐语料未收录的密集段
//    （只补语料给出的最小~最大区间内、且未被语料覆盖的号，避免无边界探测）
const nums = (corpus.ids.furniture || []).map(Number).filter(function (n) { return !isNaN(n); });
if (nums.length) {
  const lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
  let added = 0;
  for (let n = lo; n <= hi && added < 3000; n++) {
    const p = 'resource/goods/icon/' + n + '.swf';
    if (!urls.has(p)) { urls.add(p); added++; }
  }
}

const arr = Array.from(urls).sort();
fs.writeFileSync(OUT, arr.join('\n') + '\n', 'utf8');

console.log('[namespace-seeds] 生成 ' + arr.length + ' 条 -> ' + OUT);
const cat = {};
arr.forEach(function (p) { const k = p.replace(/\/\d+\.swf$/, '/'); cat[k] = (cat[k] || 0) + 1; });
console.log('');
Object.keys(cat).sort(function (a, b) { return cat[b] - cat[a]; }).forEach(function (k) {
  console.log('   ' + String(cat[k]).padStart(6) + '  ' + k);
});
