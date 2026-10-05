'use strict';
/**
 * 镜像 摩尔博物馆 (museum.61player.com) 公开的 ClientSocketDLL 反编译源码。
 *
 * 该站的反编译 API 只能按「已知路径」列举（列表不返回子目录名），
 * 因此目录清单来自协议表里每行的 `class` 字段反推：
 *   class "enterMapOrRoom.EnterMapOrRoomRes" → 目录 enterMapOrRoom
 *
 * 输出: _re/museum/src/ClientSocketDLL/com/logic/socket/<dir>/<File>.as
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://museum.61player.com';
const ROOT = path.resolve(__dirname, '..');
const DIRS_FILE = path.join(ROOT, '_re', 'museum', 'socket_dirs.txt');
const OUT_DIR = path.join(ROOT, '_re', 'museum', 'src');
const PKG = 'ClientSocketDLL/com/logic/socket';
const CONCURRENCY = 6;

const stats = { dirs: 0, files: 0, bytes: 0, errors: 0 };

function get(urlPath) {
  return new Promise(function (resolve, reject) {
    const req = https.get(BASE + urlPath, { timeout: 40000 }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve(body); });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
  });
}

function api(listPath) {
  return get('/api/dll-list?path=' + encodeURIComponent(listPath));
}
function source(filePath) {
  return get('/api/dll-source?path=' + encodeURIComponent(filePath));
}

function writeFile(rel, content) {
  const dest = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}

// 简单并发池
async function pool(items, worker, limit) {
  let idx = 0;
  const runners = [];
  for (let i = 0; i < limit; i++) {
    runners.push((async function () {
      while (idx < items.length) {
        const my = idx++;
        try { await worker(items[my], my); } catch (e) { stats.errors++; }
      }
    })());
  }
  await Promise.all(runners);
}

(async function main() {
  const dirs = fs.readFileSync(DIRS_FILE, 'utf8')
    .split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);

  console.log('[museum-mirror] 目录数 ' + dirs.length);

  // 先并行收集每个目录的文件列表
  const fileJobs = [];
  await pool(dirs, async function (d) {
    const pkgPath = PKG + '/' + d;
    let json;
    try { json = JSON.parse(await api(pkgPath)); } catch (e) { stats.errors++; return; }
    if (!json || !json.success || !json.files) return;
    stats.dirs++;
    json.files.forEach(function (f) {
      if (/\.as$/i.test(f)) fileJobs.push({ dir: d, file: f });
    });
  }, CONCURRENCY);

  console.log('[museum-mirror] 命中目录 ' + stats.dirs + '，待下载 .as 文件 ' + fileJobs.length);

  let done = 0;
  await pool(fileJobs, async function (job) {
    const full = PKG + '/' + job.dir + '/' + job.file;
    let json;
    try { json = JSON.parse(await source(full)); } catch (e) { stats.errors++; return; }
    if (!json || !json.success) { stats.errors++; return; }
    writeFile(path.join('ClientSocketDLL', 'com', 'logic', 'socket', job.dir, job.file), json.content);
    stats.files++;
    stats.bytes += json.content.length;
    done++;
    if (done % 50 === 0) console.log('  ...已下载 ' + done + '/' + fileJobs.length);
  }, CONCURRENCY);

  console.log('[museum-mirror] 完成: 文件 ' + stats.files + ' 个, ' +
    Math.round(stats.bytes / 1024) + ' KB, 错误 ' + stats.errors);
  console.log('[museum-mirror] 输出目录: ' + OUT_DIR);
})();
