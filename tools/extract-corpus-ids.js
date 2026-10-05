'use strict';
/**
 * 从「摩尔素材福利袋」的归档清单里抽出各分类的 ID 空间。
 *
 * 关键认识：清单里的**文件名本身就是 ID**，不需要解压 933 MB 的内容——
 * 我们要的是「有哪些 ID」，具体文件仍从官方 CDN 抓（那是权威且在役的版本）。
 *
 * 输入: logs/fulidai-list.txt  (7z l -sccUTF-8 的输出)
 * 输出: resources/corpus-ids.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST = path.join(ROOT, 'logs', 'fulidai-list.txt');
const OUT = path.join(ROOT, 'resources', 'corpus-ids.json');

// PowerShell 5.1 的 `>` 重定向默认写 UTF-16LE（Out-File 的默认编码），
// 而 7z -sccUTF-8 输出的内容是 UTF-8。这里按 BOM 自动判定，避免踩编码坑。
function readTextSmart(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    console.log('  检测到 UTF-16LE 编码');
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.slice(3).toString('utf8');
  }
  return buf.toString('utf8');
}

const lines = readTextSmart(LIST).split(/\r?\n/);
console.log('清单行数: ' + lines.length);

// 7z 的列表行形如:
//   2015-01-17 14:56:48 ....A      12345      6789  摩尔素材福利袋\衣服\12001.swf
function nameOf(line) {
  const m = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\d+\s+\d+\s+(.+?)\s*$/);
  return m ? m[1] : null;
}

const cat = {
  cloth: [],       // 衣服\<id>.swf
  map: [],         // 地图\<id>.swf
  bgm: [],         // BGM\<name>.mp3
  furniture: [],   // 家具\<id>.swf
  npc: [],         // NPC\<id>_<n>.swf
  lamu: [],        // 拉姆用具\<id>.swf
  ranch: [],       // 牧场动物\<id>.swf
  other: {},
};

// 除上述已确认前缀的分类外，其余分类的**文件名即 ID**，同样要抽出来供矩阵探测。
// 形如 allIds["元素卡牌&其他"] = ["1","2",...]；含后缀的形态（如 12_3）也一并保留。
const allIds = {};
const allNames = {};

lines.forEach(function (line) {
  const n = nameOf(line);
  if (!n) return;
  if (n.indexOf('摩尔素材福利袋\\') !== 0) return;
  const parts = n.split('\\');
  if (parts.length < 3) return;
  const folder = parts[1];
  const file = parts[parts.length - 1];

  // 通用记录：任何分类都留下文件名与其中的数字 ID
  allNames[folder] = allNames[folder] || [];
  allNames[folder].push(file);
  const numM = file.match(/^(\d{1,10})(?:[._-](\d{1,6}))?\.\w+$/);
  if (numM) {
    allIds[folder] = allIds[folder] || new Set();
    allIds[folder].add(numM[1]);
    if (numM[2]) allIds[folder].add(numM[1] + '_' + numM[2]);
  }

  let m;
  if (folder === '衣服' && (m = file.match(/^(\d+)\.swf$/))) cat.cloth.push(m[1]);
  else if (folder === '地图' && (m = file.match(/^(\d+)\.swf$/))) cat.map.push(m[1]);
  else if (folder === 'BGM' && (m = file.match(/^(.+)\.mp3$/))) cat.bgm.push(m[1]);
  else if (folder === '家具' && (m = file.match(/^(\d+)\.swf$/))) cat.furniture.push(m[1]);
  else if (folder === 'NPC' && (m = file.match(/^(\d+_\d+)\.swf$/))) cat.npc.push(m[1]);
  else if (folder === '拉姆用具' && (m = file.match(/^(\d+)\.swf$/))) cat.lamu.push(m[1]);
  else if (folder === '牧场动物' && (m = file.match(/^(\d+)\.swf$/))) cat.ranch.push(m[1]);
  else {
    if (!cat.other[folder]) cat.other[folder] = 0;
    cat.other[folder]++;
  }
});

// allIds 里的 Set 转数组
const allIdArrays = {};
Object.keys(allIds).forEach(function (k) {
  allIdArrays[k] = Array.from(allIds[k]).sort(numSort);
});

function numSort(a, b) { return Number(a) - Number(b); }
Object.keys(cat).forEach(function (k) {
  if (Array.isArray(cat[k])) cat[k] = Array.from(new Set(cat[k])).sort(numSort);
});

const CLOTH_GROUPS = ['1001', '1002', '1003'];

const out = {
  generatedAt: new Date().toISOString(),
  source: '52摩尔共享素材与数据/摩尔素材福利袋 By：52摩尔.rar 的归档清单',
  note: '文件名即 ID；实际内容仍从官方 CDN 抓取（权威且在役版本）。',
  clothGroups: CLOTH_GROUPS,
  counts: {},
  ids: cat,
  // 全分类的「文件名 ID」——供「前缀 × ID 空间」矩阵探测使用
  allFolderIds: allIdArrays,
  allFolderCounts: (function () {
    const o = {};
    Object.keys(allIdArrays).forEach(function (k) { o[k] = allIdArrays[k].length; });
    return o;
  })(),
  allFolderNames: allNames,
};
Object.keys(cat).forEach(function (k) {
  out.counts[k] = Array.isArray(cat[k]) ? cat[k].length : Object.keys(cat[k]).length;
});

// 预先展开成候选 URL 列表（爬虫直接消费）
const urls = [];
cat.cloth.forEach(function (id) {
  CLOTH_GROUPS.forEach(function (g) { urls.push('resource/cloth/bmpswf/' + g + '/' + id + '.swf'); });
});
cat.map.forEach(function (id) { urls.push('resource/map/' + id + '.swf'); });
cat.bgm.forEach(function (n) { urls.push('resource/bgSounds/BGM_' + n + '.mp3'); });
out.candidateUrls = urls;
out.counts.candidateUrls = urls.length;

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('\n抽取到的 ID 空间:');
Object.keys(cat).forEach(function (k) {
  if (Array.isArray(cat[k]) && cat[k].length) {
    console.log('  ' + k.padEnd(12) + cat[k].length + ' 个   (' + cat[k][0] + ' .. ' + cat[k][cat[k].length - 1] + ')');
  }
});
console.log('\n候选 URL 总数: ' + urls.length);
console.log('  = 衣服 ' + cat.cloth.length + ' × ' + CLOTH_GROUPS.length + ' 组'
  + ' + 地图 ' + cat.map.length
  + ' + BGM ' + cat.bgm.length);
console.log('\n其他分类（路径未知，仅计数）:');
Object.keys(cat.other).sort(function (a, b) { return cat.other[b] - cat.other[a]; }).slice(0, 15)
  .forEach(function (k) { console.log('  ' + k.padEnd(20) + cat.other[k]); });
console.log('\n输出 -> ' + OUT);
