'use strict';
/**
 * 从摩尔庄园客户端 SWF 中扫描资源路径字面量。
 *
 * 原理：AS3 的字符串常量全部存放在 ABC（ActionScript Bytecode）常量池里，且是
 * 明文的 UTF-8（含长度前缀），无需真正解析 ABC 结构——直接在解压后的 SWF 字节流里
 * 抽取可打印字符串，再按路径特征过滤即可。
 *
 * 输入 : _re/official/*.inflated.bin 或 _re/official/*.swf（自动解压 CWS）
 * 输出 : resources/path-candidates.json  （分类后的候选路径 + 片段）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, '_re', 'official');
const OUT = path.join(ROOT, 'resources', 'path-candidates.json');

/** 读 SWF；若是 CWS(zlib) 则解压 */
function readSwf(p) {
  const buf = fs.readFileSync(p);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig === 'CWS') {
    return zlib.inflateSync(buf.slice(8));   // 前 8 字节是 SWF 头，之后是 zlib 流
  }
  return buf;
}

/** 抽取所有可打印字符串（ASCII 与 UTF-8 混合，控制字符作分隔） */
function extractStrings(buf) {
  const out = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    // 允许 ASCII 可见字符 与 >=0x80 的 UTF-8 续字节
    if ((b >= 0x20 && b < 0x7F) || b >= 0x80) {
      cur += String.fromCharCode(b);
      if (cur.length > 400) { out.push(cur); cur = ''; }
    } else {
      if (cur.length >= 4) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

// 目标：目录式的资源路径（这些才是我们要抓的）
const DIR_PREFIXES = ['resource/', 'module/', 'dll/', 'version/', 'config/'];
// 资源文件扩展名
const EXT_RE = /\.(swf|xml|mp3|png|jpg|jpeg|gif|txt|sol|dat|bin)\b/i;

const found = {
  fullPaths: new Set(),   // 看起来完整的路径（以扩展名结尾）
  fragments: new Set(),   // 目录片段（被拼接的动态路径用）
  bareNames: new Set(),   // 单独出现、带扩展名的相对名
};

function scan(text, sourceFile) {
  // 1) 目录式路径：允许路径里出现 UTF-8 汉字、数字、下划线、点、斜杠、连字符
  const re = /(?:resource|module|dll|version|config)\/[\x20-\x7E\u4e00-\u9fff]{0,160}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let s = m[0];
    // 截断到第一个明显不属于路径的字符
    s = s.replace(/[\\:*?"<>|,\s].*$/, '');
    if (!s || s.length < 10) continue;
    if (EXT_RE.test(s)) {
      // 只保留到扩展名结束
      const em = s.match(/^(.*?\.(?:swf|xml|mp3|png|jpg|jpeg|gif|txt|sol|dat|bin))/i);
      if (em) found.fullPaths.add(em[1]);
    } else if (s.endsWith('/')) {
      found.fragments.add(s);
    } else if (/\/[^/]*$/.test(s)) {
      // 以目录名结尾，可能是拼接片段
      if (s.length <= 80) found.fragments.add(s);
    }
  }

  // 2) 裸文件名（可能来自别的拼接方式）
  const re2 = /(^|[^A-Za-z0-9_\/.])([A-Za-z0-9_\u4e00-\u9fff\-]{2,60}\.(?:swf|xml|mp3))\b/g;
  while ((m = re2.exec(text)) !== null) {
    const n = m[2];
    if (n.length >= 6) found.bareNames.add(n);
  }
}

function main() {
  const files = fs.readdirSync(SRC_DIR).filter(function (f) {
    return /\.(bin|swf)$/i.test(f);
  });

  console.log('[scan-swf-paths] 扫描 ' + files.length + ' 个文件');
  const perFile = {};

  files.forEach(function (f) {
    const p = path.join(SRC_DIR, f);
    let raw;
    try { raw = readSwf(p); } catch (e) {
      console.log('  跳过 ' + f + ': ' + e.message);
      return;
    }
    const before = found.fullPaths.size;
    const strs = extractStrings(raw);
    strs.forEach(function (s) { scan(s, f); });
    perFile[f] = { bytes: raw.length, strings: strs.length, newPaths: found.fullPaths.size - before };
    console.log('  ' + f.padEnd(38) + ' 解压 ' + String(Math.round(raw.length / 1024)).padStart(6) + ' KB, ' +
      '字符串 ' + String(strs.length).padStart(6) + ', 新增路径 ' + (found.fullPaths.size - before));
  });

  const out = {
    generatedAt: new Date().toISOString(),
    sources: perFile,
    stats: {
      fullPaths: found.fullPaths.size,
      fragments: found.fragments.size,
      bareNames: found.bareNames.size,
    },
    fullPaths: Array.from(found.fullPaths).sort(),
    fragments: Array.from(found.fragments).sort().slice(0, 2000),
    bareNames: Array.from(found.bareNames).sort().slice(0, 2000),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log('\n[scan-swf-paths] 完整路径 ' + out.stats.fullPaths +
    ' / 目录片段 ' + out.stats.fragments + ' / 裸文件名 ' + out.stats.bareNames);
  console.log('[scan-swf-paths] 输出 ' + OUT);

  console.log('\n--- 完整路径样例（前 25）---');
  out.fullPaths.slice(0, 25).forEach(function (s) { console.log('   ' + s); });
  console.log('\n--- 目录片段样例（前 20）---');
  out.fragments.slice(0, 20).forEach(function (s) { console.log('   ' + s); });
}

main();
