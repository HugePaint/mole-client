'use strict';
/**
 * 拉取摩尔博物馆的物品全表，抽出具权威 `path` 字段的资源索引。
 *
 * 这是目前**最高产的一手来源**：每个物品条目直接带客户端资源路径，例如
 *   type=1  resource/cloth/icon/12001.swf
 *   type=5  resource/goods/icon/12839.swf
 *   type=9  resource/allJob/icon/190001.swf
 *   type=17 resource/classroom/icon/1260001.swf   ← 此前完全没发现的命名空间
 *
 * 输出:
 *   resources/museum-items.json   全量物品（含 path）
 *   resources/museum-item-seeds.txt  去重后的资源路径（供 fetch-list 使用）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://museum.61player.com';
const OUT_JSON = path.join(ROOT, 'resources', 'museum-items.json');
const OUT_SEEDS = path.join(ROOT, 'resources', 'museum-item-seeds.txt');

const TYPES = [];
for (let i = 1; i <= 40; i++) TYPES.push(i);
const PAGESIZE = 5000;

function get(url) {
  return new Promise(function (resolve, reject) {
    const req = https.get(BASE + url, { timeout: 60000, headers: { 'User-Agent': 'mole-museum/0.1' } }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve(body); });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
  });
}

(async function () {
  const all = [];
  const byType = {};

  for (let ti = 0; ti < TYPES.length; ti++) {
    const t = TYPES[ti];
    let items = [];
    try {
      const j = JSON.parse(await get('/api?event=getitemfromtype&type=' + t + '&pagesize=' + PAGESIZE + '&pageid=1'));
      items = j.results || [];
    } catch (e) {
      console.log('  type=' + t + ' 失败: ' + e.message);
      continue;
    }
    if (!items.length) continue;
    byType[t] = items.length;
    items.forEach(function (it) {
      all.push({ type: t, id: it.id, name: it.name, typeid: it.typeid, vipOnly: it.vipOnly, path: it.path });
    });
    const sample = items.filter(function (x) { return x.path && x.path !== '404.swf'; })[0];
    console.log('  type=' + String(t).padStart(2) + '  ' + String(items.length).padStart(5) + ' 条' +
      (sample ? '   样例 ' + sample.path : '   (无有效 path)'));
  }

  // 去重路径
  const paths = new Set();
  const prefixCount = {};
  let placeholder = 0;
  all.forEach(function (it) {
    const p = it.path;
    if (!p || p === '404.swf' || /^404/.test(p)) { placeholder++; return; }
    paths.add(p);
    const pre = p.replace(/[^/]*$/, '');
    prefixCount[pre] = (prefixCount[pre] || 0) + 1;
  });

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'museum.61player.com /api?event=getitemfromtype',
    totalItems: all.length,
    byType: byType,
    uniquePaths: paths.size,
    placeholderPaths: placeholder,
    prefixCounts: prefixCount,
    items: all,
  }, null, 2), 'utf8');
  fs.writeFileSync(OUT_SEEDS, Array.from(paths).sort().join('\n') + '\n', 'utf8');

  console.log('');
  console.log('物品总数:       ' + all.length);
  console.log('去重资源路径:   ' + paths.size);
  console.log('占位 404.swf:   ' + placeholder);
  console.log('');
  console.log('--- 前缀分布（Top 30）---');
  Object.keys(prefixCount).sort(function (a, b) { return prefixCount[b] - prefixCount[a]; }).slice(0, 30)
    .forEach(function (k) { console.log('   ' + String(prefixCount[k]).padStart(5) + '  ' + k); });
  console.log('');
  console.log('输出 -> ' + OUT_SEEDS);
})();
