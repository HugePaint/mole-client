'use strict';
/**
 * 攻 resource/newTask 的嵌套结构。
 *
 * 已知事实（来自客户端代码里的具体路径字面量）：
 *   resource/newTask/task1/movie/task_movie_1_2.swf
 *   resource/newTask/task526/movie/task_movie_526_3.swf
 *   resource/newTask/task626/movie/task_movie_626_2.swf
 *   resource/newTask/task10004/task_movie_10004_1.swf
 *   resource/newTask/task10009/task_10009_2.swf
 *
 * 三个未知：
 *   1) task<ID> 这一层的 ID 空间（从 TaskSummary.xml 拿到 152 个，但显然还有更多）
 *   2) 第二层是 movie/task_movie_<ID>_<N>.swf 还是直接 task_<ID>_<N>.swf
 *   3) 帧号 N 的范围
 *
 * 策略：先用已知 ID 把「模式 × N 范围」钉死，再用 TaskSummary 的 ID 铺开。
 *
 * 输出: resources/newtask-probe-result.json
 */

const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'resources', 'newtask-probe-result.json');
const CONC = 12;

const KNOWN_IDS = ['1', '526', '626', '10004', '10009'];

let summaryIds = [];
try {
  summaryIds = fs.readFileSync(path.join(ROOT, 'resources', 'task-ids.txt'), 'utf8')
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
} catch (e) { }

const PATTERNS = [
  (id, n) => `resource/newTask/task${id}/movie/task_movie_${id}_${n}.swf`,
  (id, n) => `resource/newTask/task${id}/task_${id}_${n}.swf`,
  (id, n) => `resource/newTask/task${id}/task_movie_${id}_${n}.swf`,
  (id, n) => `resource/newTask/task${id}/movie/task_${id}_${n}.swf`,
];

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
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-newtask/0.1', Connection: 'close' },
      timeout: 12000,
    }, (res) => { res.resume(); resolve({ status: res.statusCode, len: Number(res.headers['content-length'] || 0) }); });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve({ status: 0, len: 0 }));
    req.end();
  });
}

async function pool(jobs, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < jobs.length) { const my = i++; await worker(jobs[my]); }
  }));
}

(async function () {
  const ip = await getIp();
  console.log('[newTask] 源站 IP ' + ip);
  console.log('[newTask] TaskSummary 任务 ID ' + summaryIds.length + ' 个\n');

  // ── 阶段 1：用已知 ID 钉死「模式 × N 范围」──
  console.log('[newTask] 阶段 1：用 5 个已知 ID 反推模式与帧号范围');
  const hitsByPattern = PATTERNS.map(() => []);
  const jobs1 = [];
  KNOWN_IDS.forEach((id) => {
    PATTERNS.forEach((fn, pi) => {
      for (let n = 1; n <= 30; n++) jobs1.push({ id, pi, n, url: fn(id, n) });
    });
  });

  await pool(jobs1, async (j) => {
    const r = await head(ip, j.url);
    if (r.status === 200) {
      hitsByPattern[j.pi].push({ id: j.id, n: j.n, url: j.url, len: r.len });
    }
  });

  PATTERNS.forEach((fn, pi) => {
    const h = hitsByPattern[pi];
    const sample = fn('626', 1);
    const ids = Array.from(new Set(h.map((x) => x.id))).sort();
    const ns = Array.from(new Set(h.map((x) => x.n))).sort((a, b) => a - b);
    console.log('  模式' + (pi + 1) + '  ' + sample.replace('626', '<ID>').replace('_1.', '_<N>.'));
    console.log('     命中 ' + h.length + ' 个' +
      (h.length ? '，ID={' + ids.join(',') + '}  N∈{' + ns.join(',') + '}' : ''));
  });

  // 选出「对所有已知 ID 都有效」的模式
  const goodPatterns = [];
  PATTERNS.forEach((fn, pi) => {
    const ids = new Set(hitsByPattern[pi].map((x) => x.id));
    if (ids.size >= 3) goodPatterns.push({ pi, fn, ids: Array.from(ids).sort() });
  });

  if (goodPatterns.length === 0) {
    console.log('\n[newTask] 阶段 1 无可用模式，中止。');
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), stage1: hitsByPattern }, null, 2), 'utf8');
    return;
  }

  // ── 阶段 2：用 TaskSummary 的 ID 铺开 ──
  const maxN = Math.max.apply(null, hitsByPattern.flat().map((x) => x.n)) || 10;
  const N_CAP = Math.min(maxN + 3, 25);
  console.log('\n[newTask] 阶段 2：用 ' + summaryIds.length + ' 个任务 ID × ' +
    goodPatterns.length + ' 个有效模式 × N≤' + N_CAP + ' 铺开');

  const allHits = {};
  const jobs2 = [];
  summaryIds.forEach((id) => {
    goodPatterns.forEach((g) => {
      for (let n = 1; n <= N_CAP; n++) jobs2.push({ id, pi: g.pi, n, url: g.fn(id, n) });
    });
  });

  let done = 0;
  await pool(jobs2, async (j) => {
    const r = await head(ip, j.url);
    if (r.status === 200) allHits[j.url] = r.len;
    done++;
    if (done % 2000 === 0) console.log('   进度 ' + done + '/' + jobs2.length);
  });

  const urls = Object.keys(allHits).sort();
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    origin: ip,
    stage1: hitsByPattern,
    goodPatterns: goodPatterns.map((g) => ({ pi: g.pi })),
    N_CAP: N_CAP,
    taskIdsUsed: summaryIds.length,
    stage2Probes: jobs2.length,
    hits: allHits,
    hitUrls: urls,
  }, null, 2), 'utf8');

  console.log('\n[newTask] 阶段 2 命中 ' + urls.length + ' 个文件');
  const byId = {};
  urls.forEach((u) => {
    const m = u.match(/task(\d+)\//);
    if (m) (byId[m[1]] = byId[m[1]] || []).push(u);
  });
  const ids = Object.keys(byId).sort((a, b) => a - b);
  console.log('[newTask] 涉及 task ID ' + ids.length + ' 个: ' + ids.slice(0, 40).join(','));
  console.log('[newTask] 输出 -> ' + OUT);
  if (urls.length) {
    fs.writeFileSync(path.join(ROOT, 'resources', 'newtask-seeds.txt'), urls.join('\n') + '\n', 'utf8');
    console.log('[newTask] 种子 -> resources/newtask-seeds.txt');
  }
})();
