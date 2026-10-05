'use strict';
/**
 * 字重改写：给一个 TTF/TTC 的指定字面改写 OS/2.usWeightClass 与 head.macStyle 粗体位，
 * 生成「同族名、不同字重」的副本。
 *
 * 为什么需要它：
 *   Ruffle 桌面端把系统字体交给 fontdb 查表，登记时用的是**字体自身**的字重
 *   （desktop/src/backends/ui.rs: `let is_bold = face.weight > fontdb::Weight::NORMAL;`），
 *   而不是 SWF 请求的字重。于是当 SWF 要「宋体加粗」时：
 *     fontdb 按 family=SimSun/宋体 + weight=BOLD 查表 → 只有一个 400 字面的 SimSun
 *     → 登记成 is_bold=false → core 的精确查询（bold=true）匹配不上
 *     → WARN Unknown device font "SimSun" (bold: true) → 回退到引擎自带字体。
 *   补一张 family 相同、字重 700 的副本后，fontdb 的 BOLD 查询会选中它，
 *   登记出的 is_bold=true 就能匹配上，粗体文本终于用回宋体轮廓。
 *
 * 用法:
 *   node tools/font-boldify.js <输入字体> <字面序号> <输出字体> [字重=700]
 *   node tools/font-boldify.js --info <字体>        只报告每个字面的族名/版本/字重，不写文件
 * 说明:
 *   - 只改 4/2 字节的数值，不改 name 表、不重排任何表，产物依旧是合法的 TTF/TTC；
 *   - 字面序号仅对 .ttc 有意义（simsun.ttc: 0=SimSun, 1=NSimSun）；
 *   - 不做重命名，因此不影响系统字体缓存；该副本只放进 Ruffle 会扫描的字体目录使用。
 */

const fs = require('fs');
const path = require('path');

/** 读 name 表：返回 nameID -> 一串候选字符串（Windows 平台按 UTF-16BE 解） */
function readNames(buf, dirOff, tableMap) {
  const nameTable = tableMap.get('name');
  const out = {};
  if (!nameTable) return out;

  const base = nameTable.off;
  const count = buf.readUInt16BE(base + 2);
  const stringOff = base + buf.readUInt16BE(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformId = buf.readUInt16BE(rec);
    const nameId = buf.readUInt16BE(rec + 6);
    const len = buf.readUInt16BE(rec + 8);
    const off = buf.readUInt16BE(rec + 10);
    if (!len || stringOff + off + len > buf.length) continue;
    const raw = buf.slice(stringOff + off, stringOff + off + len);
    const text = platformId === 3 || platformId === 0
      ? Buffer.from(raw).swap16().toString('utf16le')          // UTF-16BE（复制一份再换序，避免动到原缓冲）
      : raw.toString('latin1');                                // Mac Roman 就按 latin1 看
    (out[nameId] = out[nameId] || []).push(text);
  }
  return out;
}

function faceDirs(buf) {
  const sig = buf.slice(0, 4).toString('latin1');
  if (sig === 'ttcf') {
    const n = buf.readUInt32BE(8);
    return Array.from({ length: n }, (_, i) => buf.readUInt32BE(12 + i * 4));
  }
  return [0];
}

function tableMapOf(buf, dirOff) {
  const numTables = buf.readUInt16BE(dirOff + 4);
  const map = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = dirOff + 12 + i * 16;
    const tag = buf.slice(rec, rec + 4).toString('latin1');
    map.set(tag, { rec, off: buf.readUInt32BE(rec + 8), len: buf.readUInt32BE(rec + 12) });
  }
  return map;
}

const [, , arg1, arg2, arg3, arg4] = process.argv;

if (arg1 === '--info') {
  const target = arg2;
  if (!target) { console.error('用法: node tools/font-boldify.js --info <字体>'); process.exit(1); }
  const buf = fs.readFileSync(target);
  const dirs = faceDirs(buf);
  console.log(`${target}  (${buf.length} 字节, ${dirs.length} 个字面)`);
  dirs.forEach((dirOff, i) => {
    const t = tableMapOf(buf, dirOff);
    const names = readNames(buf, dirOff, t);
    const os2 = t.get('OS/2');
    const head = t.get('head');
    const uniq = a => Array.from(new Set(a || []));
    let fsSel = '?';
    if (os2 && os2.len >= 64) {
      const v = buf.readUInt16BE(os2.off + 62);
      // ttf-parser 判字重时最先看 fsSelection 的 BOLD(bit5)/REGULAR(bit6)，所以这里要显示出来：
      // 只改 usWeightClass 而 BOLD 位没同步，Ruffle 拿到的字重就不是你期望的那个。
      fsSel = `0x${v.toString(16)}${(v & 0x20) ? ' BOLD' : ''}${(v & 0x40) ? ' REGULAR' : ''}`;
    }
    console.log(`  字面 ${i}: family=[${uniq(names[1]).join(' | ')}] subfamily=[${uniq(names[2]).join(' | ')}]`);
    console.log(`          postscript=${uniq(names[6])[0] || '?'}  version=${uniq(names[5])[0] || '?'}  usWeightClass=${os2 ? buf.readUInt16BE(os2.off + 4) : '?'}  macStyle=0x${head ? buf.readUInt16BE(head.off + 44).toString(16) : '?'}  fsSelection=${fsSel}`);
  });
  process.exit(0);
}


const [, , inPath, faceArg, outPath, weightArg] = process.argv;
if (!inPath || !outPath) {
  console.error('用法: node tools/font-boldify.js <输入字体> <字面序号> <输出字体> [字重=700]');
  process.exit(1);
}
const faceIndex = Number(faceArg || 0);
const weight = Number(weightArg || 700);

const buf = fs.readFileSync(inPath);
const sig = buf.slice(0, 4).toString('latin1');
let dirOff;
let faceCount = 1;
if (sig === 'ttcf') {
  faceCount = buf.readUInt32BE(8);
  if (faceIndex >= faceCount) throw new Error(`字面序号 ${faceIndex} 超出范围（共 ${faceCount} 个字面）`);
  dirOff = buf.readUInt32BE(12 + faceIndex * 4);
} else {
  if (faceIndex !== 0) throw new Error('非 TTC 文件只有 0 号字面');
  dirOff = 0;
}

const numTables = buf.readUInt16BE(dirOff + 4);
const tables = new Map();
for (let i = 0; i < numTables; i++) {
  const rec = dirOff + 12 + i * 16;
  const tag = buf.slice(rec, rec + 4).toString('latin1');
  tables.set(tag, { rec, off: buf.readUInt32BE(rec + 8), len: buf.readUInt32BE(rec + 12) });
}

const os2 = tables.get('OS/2');
const head = tables.get('head');
if (!os2) throw new Error('该字面没有 OS/2 表，无法改写字重');
if (!head) throw new Error('该字面没有 head 表');

const before = { weight: buf.readUInt16BE(os2.off + 4), macStyle: buf.readUInt16BE(head.off + 44) };
const wantBold = weight >= 700;              // 目标字重决定粗体位，而不是无脑置位

buf.writeUInt16BE(weight, os2.off + 4);

// head.macStyle bit0 = Bold（OS/2 缺失时 ttf-parser 用它兜底）
buf.writeUInt16BE(wantBold ? (before.macStyle | 0x0001) : (before.macStyle & ~0x0001), head.off + 44);

// OS/2.fsSelection：bit5=BOLD、bit6=REGULAR。
// ⚠️ ttf-parser 的 Face::weight() 会**先看这两个位**再看 usWeightClass，
//    所以只改 usWeightClass 而位不同步，Ruffle 拿到的字重就是错的（实测踩过：
//    Arial Black 想要"非粗体副本"，却因为 BOLD 位被置上，仍旧登记成 bold=true）。
const fsSelOff = os2.off + 62;
let fsSelBefore = null;
if (os2.len >= 64) {
  fsSelBefore = buf.readUInt16BE(fsSelOff);
  const next = wantBold ? ((fsSelBefore | 0x0020) & ~0x0040) : ((fsSelBefore & ~0x0020) | 0x0040);
  buf.writeUInt16BE(next, fsSelOff);
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, buf);

console.log(`[font-boldify] ${path.basename(inPath)} 字面 ${faceIndex}/${faceCount} -> ${outPath}`);
console.log(`  usWeightClass ${before.weight} -> ${weight}   macStyle 0x${before.macStyle.toString(16)} -> 0x${(wantBold ? (before.macStyle | 1) : (before.macStyle & ~1)).toString(16)}` +
  (fsSelBefore === null ? '' : `   fsSelection 0x${fsSelBefore.toString(16)} -> 0x${buf.readUInt16BE(fsSelOff).toString(16)}`));
console.log(`  粗体位：${wantBold ? '置上（BOLD）' : '清掉（REGULAR）'}   大小 ${buf.length} 字节；表数 ${numTables}`);
