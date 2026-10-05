'use strict';
/**
 * 分析已发现的资源路径，并从「客户端自己的 XML 配置」里挖枚举清单。
 * 这些 XML 是权威来源——比猜 ID 范围可靠得多。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CAND = path.join(ROOT, 'resources', 'path-candidates.json');
const CACHE = path.join(ROOT, 'cache');
const LOG = path.join(ROOT, 'logs', 'requests.jsonl');

/** 去掉片段尾随的 1~3 个垃圾字符（下一字节恰好可打印导致） */
function cleanPath(s) {
  return s.replace(/(\.(swf|xml|mp3|png|jpg|jpeg|gif|txt|sol))[A-Za-z0-9_\u4e00-\u9fff]{1,3}$/i, '$1');
}

const cand = JSON.parse(fs.readFileSync(CAND, 'utf8'));
const cleaned = Array.from(new Set(cand.fullPaths.map(cleanPath)));
const fragCleaned = Array.from(new Set(cand.fragments.map(cleanPath)));

console.log('清理后完整路径: ' + cleaned.length + '（原始 ' + cand.fullPaths.length + '）');
console.log('清理后片段:     ' + fragCleaned.length);

// ── 1) 按目录归类 ──
const byTop = {};
cleaned.forEach(function (p) {
  const k = p.split('/').slice(0, 2).join('/');
  byTop[k] = (byTop[k] || 0) + 1;
});
console.log('\n--- 按前两段归类（Top 25）---');
Object.keys(byTop).sort(function (a, b) { return byTop[b] - byTop[a]; }).slice(0, 25).forEach(function (k) {
  console.log('  ' + String(byTop[k]).padStart(5) + '  ' + k);
});

// ── 2) resource/ 下的路径（这些是美术/数据资源，最需要本地化）──
const resPaths = cleaned.filter(function (p) { return p.indexOf('resource/') === 0; });
console.log('\n--- resource/ 下共 ' + resPaths.length + ' 条 ---');
resPaths.slice(0, 60).forEach(function (p) { console.log('   ' + p); });
if (resPaths.length > 60) console.log('   ...(还有 ' + (resPaths.length - 60) + ' 条)');

// ── 3) 从已缓存 XML 里挖枚举清单 ──
console.log('\n===== 已缓存 XML 中的资源引用 =====');
function walkXml(dir, acc) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  es.forEach(function (e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkXml(p, acc);
    else if (/\.xml$/i.test(e.name)) acc.push(p);
  });
  return acc;
}

const xmls = walkXml(CACHE, []);
const xmlRefs = {};       // 文件相对路径 -> Set(引用)
const allMapIds = new Set();
const allSwfRefs = new Set();

xmls.forEach(function (p) {
  const rel = path.relative(CACHE, p).replace(/\\/g, '/');
  const txt = fs.readFileSync(p, 'latin1');   // 可能是 GBK，用 latin1 保证不抛错
  const refs = new Set();

  // Map_10010 / map_10010 形式
  let m;
  const reMap = /[Mm]ap[_-]?(\d{3,6})/g;
  while ((m = reMap.exec(txt)) !== null) { allMapIds.add(m[1]); refs.add('Map_' + m[1]); }

  // 任意 .swf / .xml 文件名引用
  const reSwf = /([A-Za-z0-9_\-]{2,60}\.(?:swf|xml|mp3))/g;
  while ((m = reSwf.exec(txt)) !== null) { allSwfRefs.add(m[1]); refs.add(m[1]); }

  xmlRefs[rel] = refs;
});

Object.keys(xmlRefs).forEach(function (k) {
  const r = xmlRefs[k];
  if (r.size === 0) return;
  console.log('  ' + k + '  -> ' + r.size + ' 个引用');
});
console.log('\n  从 XML 里发现的地图 ID: ' + Array.from(allMapIds).sort().join(', '));
console.log('  从 XML 里发现的 .swf/.xml 引用数: ' + allSwfRefs.size);

// ── 4) 从请求日志看真实请求过的 URL 形态 ──
console.log('\n===== 请求日志中的 URL 形态 =====');
const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
const shapes = {};
lines.forEach(function (l) {
  let o; try { o = JSON.parse(l); } catch (e) { return; }
  if (!o.url || o.host !== 'mole.61.com') return;
  const p = o.url.replace(/^http:\/\/mole\.61\.com\//, '').split('?')[0];
  // 把数字段折叠成占位符
  const shape = p.replace(/\d+/g, '#');
  shapes[shape] = (shapes[shape] || 0) + 1;
});
Object.keys(shapes).sort(function (a, b) { return shapes[b] - shapes[a]; }).slice(0, 40).forEach(function (k) {
  console.log('  ' + String(shapes[k]).padStart(4) + '  ' + k);
});

// ── 输出分析结果 ──
const out = {
  generatedAt: new Date().toISOString(),
  cleanedFullPaths: cleaned,
  cleanedFragments: fragCleaned,
  resourcePaths: resPaths,
  xmlMapIds: Array.from(allMapIds).sort(),
  xmlSwfRefs: Array.from(allSwfRefs).sort(),
  urlShapes: shapes,
};
const OUT = path.join(ROOT, 'resources', 'path-analysis.json');
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('\n分析结果 -> ' + OUT);
