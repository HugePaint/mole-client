'use strict';
/**
 * 从摩尔博物馆镜像的 ClientSocketDLL 反编译源码中，自动抽取每个响应 opcode 的**包体字段结构**。
 *
 * 原理：各 *Res.as 的 doAction()/decode() 直接按顺序从 GV.onlineSocket 逐字段读取，
 * 例如 WalkMsgRes:
 *     walkMessage.UserID = GV.onlineSocket.readUnsignedInt();
 *     walkMessage.EndX   = GV.onlineSocket.readUnsignedInt();
 * 因此「read 调用的顺序 + 目标属性名」就是包体的字段 schema。
 *
 * 输出: resources/socket-schema.json
 *   { "<opcode>": { note, class, action, file, fields: [{name, type, fn}] } }
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, '_re', 'museum', 'src', 'ClientSocketDLL', 'com', 'logic', 'socket');
const PROTOCOL = path.join(ROOT, '_re', 'museum', 'socket_protocol.json');
const OUT = path.join(ROOT, 'resources', 'socket-schema.json');

// AS3 ByteArray 读取方法 → 规范类型
const TYPE_MAP = {
  readUnsignedInt: 'u32', readInt: 'i32',
  readUnsignedShort: 'u16', readShort: 'i16',
  readUnsignedByte: 'u8', readByte: 'i8',
  readFloat: 'f32', readDouble: 'f64',
  readBoolean: 'bool',
  readUTF: 'utf', readUTFBytes: 'utf', readMultiByte: 'str',
  readObject: 'amf', readBytes: 'bytes',
};

// 匹配两种常见写法：
//   A) foo.UserID = GV.onlineSocket.readUnsignedInt();
//   B) "num": GV.onlineSocket.readInt()
const RE_A = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*GV\.onlineSocket\.(read\w+)\s*\(/g;
const RE_B = /["']([A-Za-z_$][\w$]*)["']\s*:\s*GV\.onlineSocket\.(read\w+)\s*\(/g;

function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  entries.forEach(function (e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.as$/i.test(e.name)) acc.push(p);
  });
  return acc;
}

function extractFields(text) {
  const hits = [];
  let m;
  RE_A.lastIndex = 0;
  while ((m = RE_A.exec(text)) !== null) {
    hits.push({ at: m.index, name: m[2], fn: m[3] });
  }
  RE_B.lastIndex = 0;
  while ((m = RE_B.exec(text)) !== null) {
    hits.push({ at: m.index, name: m[1], fn: m[2] });
  }
  // 按源码出现顺序 = 线上的字段顺序
  hits.sort(function (a, b) { return a.at - b.at; });
  return hits.map(function (h) {
    return { name: h.name, type: TYPE_MAP[h.fn] || '?', fn: h.fn };
  });
}

function readJsonNoBom(p) {
  // PowerShell 5.1 的 Set-Content -Encoding UTF8 会写入 BOM，JSON.parse 不接受
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

(function main() {
  const proto = readJsonNoBom(PROTOCOL);
  const rows = proto.results || [];

  // class 全名 → opcode 列表
  const byClass = {};
  rows.forEach(function (r) {
    const c = (r.class || '').trim();
    if (!c) return;
    (byClass[c] = byClass[c] || []).push(String(r.ID));
  });

  const files = walk(SRC_DIR, []);
  const schema = {};
  let matchedFiles = 0, totalFields = 0, unmatched = [];

  files.forEach(function (fp) {
    const rel = path.relative(SRC_DIR, fp).replace(/\\/g, '/');
    const fileName = path.basename(fp);
    const dirName = rel.split('/')[0];
    const key = dirName + '.' + fileName.replace(/\.as$/i, '');

    const opcodes = byClass[key];
    if (!opcodes) { unmatched.push(key); return; }

    const text = fs.readFileSync(fp, 'utf8');
    const fields = extractFields(text);
    if (!fields.length) return;

    matchedFiles++;
    totalFields += fields.length;
    opcodes.forEach(function (id) {
      const row = rows.filter(function (r) { return String(r.ID) === id; })[0] || {};
      schema[id] = {
        note: row.note || '',
        class: row.class || '',
        action: row.action || '',
        file: 'com/logic/socket/' + rel,
        fields: fields,
      };
    });
  });

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'museum.61player.com 公开的 ClientSocketDLL 反编译源码',
    header: '17B: PkgLen(u32BE) | Version(u8) | Command(u32BE) | UserID(u32BE) | Result(i32BE)',
    stats: {
      opcodesWithSchema: Object.keys(schema).length,
      sourceFilesUsed: matchedFiles,
      totalFields: totalFields,
    },
    opcodes: schema,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log('[gen-socket-schema] 扫描 .as 文件 ' + files.length + ' 个');
  console.log('[gen-socket-schema] 命中并抽取出 schema 的 opcode: ' + Object.keys(schema).length);
  console.log('[gen-socket-schema] 使用源文件 ' + matchedFiles + ' 个，字段总数 ' + totalFields);
  console.log('[gen-socket-schema] 输出: ' + OUT);

  // 抽样展示
  ['303', '201', '302', '406', '10003'].forEach(function (id) {
    if (!schema[id]) return;
    console.log('\n[' + id + '] ' + schema[id].note + '  (' + schema[id].class + ')');
    schema[id].fields.forEach(function (f) {
      console.log('    ' + f.type.padEnd(5) + ' ' + f.name);
    });
  });
})();
