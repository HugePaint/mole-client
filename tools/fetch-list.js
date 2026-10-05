'use strict';
/**
 * 按列表抓取：读一个「每行一个相对路径」的文件，经 molemirror 逐个取回并落缓存。
 * 用于定向补充，不必重跑整个递归爬取。
 *
 * 用法: node tools/fetch-list.js <列表文件> [并发数] [代理端口] [结果文件]
 *   端口默认 8899；离线验收时可指向另一个离线实例（如 8999）以便不影响在跑的在线实例。
 *   结果文件默认 resources/offline-verify-results.json（离线验收的既有产物）；
 *   做别的定向补抓时请显式给第 4 个参数，免得把验收证据覆盖掉。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST = process.argv[2];
const CONC = Number(process.argv[3] || 8);
const PORT = Number(process.argv[4] || 8899);
const OUT_FILE = process.argv[5] || path.join('resources', 'offline-verify-results.json');
if (!LIST) { console.error('用法: node tools/fetch-list.js <列表文件> [并发数] [代理端口] [结果文件]'); process.exit(1); }

const files = fs.readFileSync(path.resolve(ROOT, LIST), 'utf8')
  .split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
console.log('[fetch-list] 待取 ' + files.length + ' 条，并发 ' + CONC + '，代理端口 ' + PORT);

function fetchOne(p) {
  return new Promise(function (resolve) {
    const req = http.request({
      host: '127.0.0.1', port: PORT, method: 'GET', path: 'http://mole.61.com/' + p,
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-fetch/0.1' }, timeout: 30000,
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ p: p, status: res.statusCode, bytes: Buffer.concat(chunks).length, hit: res.headers['x-molemirror'] });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { resolve({ p: p, status: 0, bytes: 0, err: e.message }); });
    req.end();
  });
}

(async function () {
  let idx = 0, ok = 0, nf = 0, er = 0, bytes = 0, hits = 0, override = 0, offlineMiss = 0;
  const results = [];
  await Promise.all(Array.from({ length: CONC }, async function () {
    while (idx < files.length) {
      const my = idx++;
      const r = await fetchOne(files[my]);
      results.push(r);
      if (r.status === 200) {
        ok++; bytes += r.bytes;
        if (r.hit === 'HIT') hits++;
        else if (r.hit === 'OVERRIDE') override++;
      } else if (r.status === 504) offlineMiss++;
      else if (r.status === 404 || r.status === 403) nf++;
      else er++;
    }
  }));
  console.log('[fetch-list] 结果:');
  console.log('  200 = ' + ok + '   其中 缓存命中(HIT) = ' + hits + '，本地覆写(OVERRIDE) = ' + override);
  console.log('  504 离线未命中 = ' + offlineMiss);
  console.log('  404/403 = ' + nf + '   其他错误 = ' + er);
  const out = path.resolve(ROOT, OUT_FILE);
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(), list: LIST, port: PORT, total: files.length,
    ok: ok, hits: hits, override: override, offlineMiss: offlineMiss, notFound: nf, errors: er,
    results: results,
  }, null, 2), 'utf8');
  console.log('  明细 -> ' + out);
})();
