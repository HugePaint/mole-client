'use strict';
/**
 * 摸清 resource/newTask 的**任务 ID 空间**。
 *
 * 上一轮只用 TaskSummary.xml 里的 152 个 ID 铺开，命中了 105 个 task 目录。
 * 但任务 ID 显然不止这些（客户端代码里出现过 10004、10009）。
 *
 * 高效做法：先用「每个 ID 只探 1 个探针」快速判定该 task 目录是否存在，
 * 再只对**新发现**的 ID 展开帧号 N——避免对全部 ID 做 N 的笛卡尔积。
 *
 * 输出: resources/newtask-idscan-result.json
 */

const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'resources', 'newtask-idscan-result.json');
const CONC = 14;

// 三种已知子模式；用 N=1 作探针即可判定目录是否存在
const PROBES = [
  (id) => `resource/newTask/task${id}/movie/task_movie_${id}_1.swf`,
  (id) => `resource/newTask/task${id}/task_${id}_1.swf`,
  (id) => `resource/newTask/task${id}/task_movie_${id}_1.swf`,
];

// ID 扫描范围：TaskSummary 覆盖 0..1404，客户端代码出现过 10004/10009
const SCAN = [];
for (let i = 1; i <= 1600; i++) SCAN.push(String(i));
for (let i = 9990; i <= 10020; i++) SCAN.push(String(i));
for (const b of [10500, 11000, 12000, 13000, 14000, 15000, 16000, 20000, 30000]) {
  for (let i = 0; i < 15; i++) SCAN.push(String(b + i));
}

const resolver = new dns.Resolver();
try { resolver.setServers(['223.5.5.5', '119.29.29.29']); } catch (e) { }
let originIp = null;
function getIp() {
  return new Promise((resolve) => {
    if (originIp) return resolve(originIp);
    resolver.resolve4('mole.61.com', (e, a) => {
      originIp = (a && a[0]) || '61.164.158.61';
      resolve(originIp);
    });
  });
}

function head(ip, rel) {
  return new Promise((resolve) => {
    const req = http.request({
      host: ip, port: 80, method: 'HEAD', path: '/' + rel,
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-nettask-scan/0.1', Connection: 'close' },
      timeout: 12000,
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function pool(jobs, worker, conc) {
  let i = 0;
  await Promise.all(Array.from({ length: conc || CONC }, async () => {
    while (i < jobs.length) { const my = i++; await worker(jobs[my]); }
  }));
}

(async function () {
  const ip = await getIp();
  console.log('[idscan] 源站 IP ' + ip);
  console.log('[idscan] 扫描 ' + SCAN.length + ' 个任务 ID × ' + PROBES.length + ' 个模式 = ' +
    (SCAN.length * PROBES.length) + ' 次探针\n');

  // 自检
  const ctrl = await head(ip, 'resource/newTask/task626/movie/task_movie_626_1.swf');
  console.log('[idscan] 自检 task626 探针: ' + (ctrl === 200 ? '✅ 200' : '❌ ' + ctrl));
  if (ctrl !== 200) { console.error('[idscan] 自检失败，中止。'); process.exit(2); }
  console.log('');

  // ── 阶段 1：每个 ID 只探 3 个模式（N=1）──
  const found = {};   // id -> 模式序号数组
  const jobs = [];
  SCAN.forEach((id) => PROBES.forEach((fn, pi) => jobs.push({ id, pi, url: fn(id) })));

  let done = 0;
  await pool(jobs, async (j) => {
    const st = await head(ip, j.url);
    if (st === 200) (found[j.id] = found[j.id] || []).push(j.pi);
    done++;
    if (done % 1500 === 0) console.log('   阶段1 进度 ' + done + '/' + jobs.length);
  });

  const foundIds = Object.keys(found).sort((a, b) => Number(a) - Number(b));
  console.log('\n[idscan] 存在的 task 目录 ' + foundIds.length + ' 个');
  console.log('   ' + foundIds.slice(0, 60).join(',') + (foundIds.length > 60 ? ' …' : ''));

  // ── 阶段 2：只对新发现的 ID（不在上次 600 个结果里的）展开 N ──
  let known = new Set();
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'newtask-probe-result.json'), 'utf8'));
    Object.keys(prev.hits || {}).forEach((u) => {
      const m = u.match(/task(\d+)\//); if (m) known.add(m[1]);
    });
  } catch (e) { }

  const newIds = foundIds.filter((id) => !known.has(id));
  console.log('[idscan] 其中上次未覆盖的新 ID ' + newIds.length + ' 个');

  const N_CAP = 25;
  const urls = new Set();
  // 把上次已有的也带上，便于生成完整种子
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'newtask-probe-result.json'), 'utf8'));
    Object.keys(prev.hits || {}).forEach((u) => urls.add(u));
  } catch (e) { }

  const jobs2 = [];
  newIds.forEach((id) => {
    found[id].forEach((pi) => {
      for (let n = 1; n <= N_CAP; n++) jobs2.push({ id, pi, n, url: PROBES[pi](id).replace(/_1\.swf$/, '_' + n + '.swf') });
    });
  });

  done = 0;
  await pool(jobs2, async (j) => {
    const st = await head(ip, j.url);
    if (st === 200) urls.add(j.url);
    done++;
    if (done % 1000 === 0) console.log('   阶段2 进度 ' + done + '/' + jobs2.length);
  });

  const urlArr = Array.from(urls).sort();
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    origin: ip,
    scanned: SCAN.length,
    existingTaskIds: foundIds,
    newTaskIds: newIds,
    patternsById: found,
    totalUrls: urlArr.length,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'resources', 'newtask-seeds.txt'), urlArr.join('\n') + '\n', 'utf8');

  console.log('\n[idscan] 已存在的 task 目录: ' + foundIds.length + ' 个');
  console.log('[idscan] 本轮新发现 ID: ' + newIds.length + ' 个' + (newIds.length ? '  ' + newIds.join(',') : ''));
  console.log('[idscan] 累计 URL: ' + urlArr.length + ' 条');
  console.log('[idscan] 种子 -> resources/newtask-seeds.txt');
  console.log('[idscan] 结果 -> ' + OUT);
})();
