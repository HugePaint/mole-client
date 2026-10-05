'use strict';
/**
 * 从 6 个客户端 SWF 里系统抽取「前缀 ↔ ID」配对关系。
 *
 * 动机（上一轮的教训）：从外部语料的名字猜前缀是不可靠的
 * （语料 `家具\160001.swf` 恰好落在 160001..161509，看起来像客户端 ID，其实不是）。
 * 客户端**自己的配置 XML** 才是权威来源，它直接给出:
 *     <Item ID="1220038" Type="2" Path="resource/home/item/icon/" Name="..." />
 * 同时代码里也有大量「含数字 ID 的完整路径字面量」:
 *     resource/home/item/icon/1220115.swf
 *
 * 本工具把这两类证据都抽出来，按前缀归并成 prefix → Set(ID)。
 *
 * 输出: resources/prefix-id-index.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '_re', 'official');
const OUT = path.join(ROOT, 'resources', 'prefix-id-index.json');

const files = fs.readdirSync(DIR).filter(function (f) { return /\.inflated\.bin$/.test(f); });

/** 前缀 → Set(ID)；前缀统一以 / 结尾（目录式），并保留原始写法 */
const prefixIds = {};
/** 完整的具体路径（含 ID） */
const concrete = new Set();
/** XML 里的 Path 属性计数 */
const pathAttrs = {};

function notePrefix(prefix, id) {
  if (!prefix || !id) return;
  prefixIds[prefix] = prefixIds[prefix] || new Set();
  prefixIds[prefix].add(String(id));
}

function scanText(t, fname) {
  let m;

  // ── A) XML 属性对: ID="..." 与 Path="..." 同处一个标签 ──
  // 允许两者之间出现任意属性（属性顺序不固定）
  const reA = /<[A-Za-z_][\w:]*\b[^>]{0,600}?>/g;
  let tag;
  while ((tag = reA.exec(t)) !== null) {
    const s = tag[0];
    const idM = s.match(/\bID="(\d{1,10})"/);
    const pathM = s.match(/\bPath="([^"]{3,140})"/);
    if (pathM) pathAttrs[pathM[1]] = (pathAttrs[pathM[1]] || 0) + 1;
    if (idM && pathM) notePrefix(pathM[1], idM[1]);
  }

  // ── B) 具体路径字面量: <prefix>/<纯数字ID>.<ext> ──
  const reB = /((?:resource|module|game)\/[A-Za-z0-9_/\u4e00-\u9fff]{2,90}\/)(\d{2,10})\.(swf|xml|mp3)/g;
  while ((m = reB.exec(t)) !== null) {
    concrete.add(m[1] + m[2] + '.' + m[3]);
    notePrefix(m[1], m[2]);
  }

  // ── C) 路径里 ID 带前后缀的形态:  npc_10000_1.swf / BGM_001.mp3 / task626.swf ──
  const reC = /((?:resource|module|game)\/[A-Za-z0-9_/\u4e00-\u9fff]{2,90}\/)([A-Za-z_]{0,12})(\d{1,10})((?:_\d{1,4})?)\.(swf|xml|mp3)/g;
  while ((m = reC.exec(t)) !== null) {
    const full = m[1] + m[2] + m[3] + m[4] + '.' + m[5];
    concrete.add(full);
    // 前缀记为「目录 + 字面前缀」，ID 记为纯数字
    notePrefix(m[1] + m[2], m[3]);
  }

  // ── D) 目录前缀常量（无 ID），用于判断某个前缀是否真的存在于代码里 ──
  const reD = /((?:resource|module)\/[A-Za-z0-9_/\u4e00-\u9fff]{2,90}\/)/g;
  while ((m = reD.exec(t)) !== null) {
    if (!prefixIds[m[1]]) prefixIds[m[1]] = new Set();
  }
}

files.forEach(function (f) {
  const t = fs.readFileSync(path.join(DIR, f)).toString('latin1'); // 只用 ASCII 结构，latin1 保证不抛错
  scanText(t, f);
  console.log('  扫描 ' + f);
});

// 只保留有 ID 的前缀，供枚举使用
const withIds = {};
Object.keys(prefixIds).forEach(function (p) {
  if (prefixIds[p].size > 0) withIds[p] = Array.from(prefixIds[p]).sort();
});

const out = {
  generatedAt: new Date().toISOString(),
  source: '6 个客户端 SWF（_re/official/*.inflated.bin）',
  stats: {
    prefixesTotal: Object.keys(prefixIds).length,
    prefixesWithIds: Object.keys(withIds).length,
    concretePaths: concrete.size,
    pathAttributes: Object.keys(pathAttrs).length,
  },
  prefixesWithIds: withIds,
  allPrefixes: Object.keys(prefixIds).sort(),
  concretePaths: Array.from(concrete).sort(),
  pathAttributeCounts: pathAttrs,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('');
console.log('前缀总数:        ' + out.stats.prefixesTotal);
console.log('带 ID 的前缀:    ' + out.stats.prefixesWithIds);
console.log('具体路径字面量:  ' + out.stats.concretePaths);
console.log('Path 属性去重:   ' + out.stats.pathAttributes);
console.log('');
console.log('--- 带 ID 的前缀（按 ID 数排序）---');
Object.keys(withIds).sort(function (a, b) { return withIds[b].length - withIds[a].length; })
  .forEach(function (p) {
    console.log('   ' + String(withIds[p].length).padStart(5) + '  ' + p.padEnd(48) + ' 样例 ' + withIds[p].slice(0, 5).join(','));
  });
console.log('');
console.log('输出 -> ' + OUT);
