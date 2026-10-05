'use strict';
/**
 * 对「疑似失效」的路径前缀做**决定性探测**。
 *
 * 背景：上一轮判定某前缀"失效"的判据是「客户端代码里没有具体路径实例」——
 * 这个判据偏弱，因为代码完全可能动态拼接路径。本工具改用更硬的做法：
 * 对每个前缀扫一大批 ID（按数量级铺开 + 从已知 ID 全集里采样），
 * 只要命中任意一个，就说明该命名空间**存在**，只是 ID 空间与常识不同。
 *
 * 探测走 HEAD 直连官方源站（绕过镜像，不污染缓存）。
 *
 * 输出: resources/dense-probe-result.json
 */

const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'resources', 'dense-probe-result.json');
const CONC = 12;

// ── 待探测前缀（含扩展名规则）────────────────────────────
// 形如 { prefix, ext, note }
const TARGETS = [
  { prefix: 'resource/activity/icon/', ext: '.swf' },
  { prefix: 'resource/fitment/item/', ext: '.swf' },
  { prefix: 'resource/flower/icon/', ext: '.swf' },
  { prefix: 'resource/groupFightResource/pet/', ext: '.swf' },
  { prefix: 'resource/item/cloth/icon/', ext: '.swf' },
  { prefix: 'resource/item/throw/icon/', ext: '.swf' },
  { prefix: 'resource/jobNpc/jobBookNPC/', ext: '.swf' },
  { prefix: 'resource/newAngel/skillico/', ext: '.swf' },
  { prefix: 'resource/newNpc/oneSide/', ext: '.swf' },
  { prefix: 'resource/pet/head/', ext: '.swf' },
  { prefix: 'resource/NPC/new_face/npc_', ext: '.swf' },
  { prefix: 'resource/oneBigStree/swf/', ext: '.swf' },
  { prefix: 'resource/newTask/task', ext: '.swf' },
  // 参考：已确认存在的相邻前缀，用来验证探测链路本身有效
  { prefix: 'resource/goods/icon/', ext: '.swf', control: true },
  { prefix: 'resource/pet/icon/', ext: '.swf', control: true },
];

// ── 构造 ID 候选 ──────────────────────────────────────────
const ids = new Set();

// 1) 数量级铺开：1..20, 100..120, 1000..1020, ... 10^7
for (const base of [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]) {
  for (let i = 0; i <= 20; i++) {
    const v = base + i;
    if (v > 0) ids.add(String(v));
  }
}

// 2) 常见 ID 家族（从已发现的资源路径里统计出来的量级段）
for (const seg of [12000, 12100, 12200, 12300, 12600, 13000, 13500, 14500, 15000, 15500,
                   16000, 16200, 16300, 16400, 16500, 16600, 16700, 17000, 17200, 18000, 19000,
                   120000, 121000, 122000, 126000, 127000, 130000, 135000, 145000, 150000,
                   159000, 162000, 163000, 164000, 165000, 166000, 167000, 172000, 180000, 190000,
                   1200000, 1210000, 1220000, 1260000, 1270000, 1300000, 1310000, 1330000,
                   1340000, 1350000, 1450000, 1550000, 1590000, 1620000, 1630000, 1640000,
                   1650000, 1660000, 1670000, 1700000, 1720000, 1800000, 1900000]) {
  for (let i = 0; i <= 6; i++) ids.add(String(seg + i));
}

// 3) 从已知 ID 全集里采样（每 N 个取一个，控总量）
const known = new Set();
function harvest(file, pick) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    pick(o);
  } catch (e) { }
}
harvest(path.join(ROOT, 'resources', 'museum-items.json'), (o) => {
  (o.items || []).forEach((it) => {
    const m = it.path && it.path.match(/(\d{2,10})(?:_\d{1,4})?\.\w+$/);
    if (m) known.add(m[1]);
  });
});
harvest(path.join(ROOT, 'resources', 'corpus-ids.json'), (o) => {
  Object.keys(o.allFolderIds || {}).forEach((k) => {
    (o.allFolderIds[k] || []).forEach((v) => { if (/^\d+$/.test(v)) known.add(v); });
  });
});
const knownArr = Array.from(known).sort((a, b) => a.length - b.length || a - b);
const step = Math.max(1, Math.floor(knownArr.length / 200));
for (let i = 0; i < knownArr.length; i += step) ids.add(knownArr[i]);
console.log('[dense] 已知 ID 全集 ' + knownArr.length + ' 个，采样后并入候选');

// 4) 补零形式（有些命名空间用 3~4 位零填充）
['001', '002', '003', '010', '100', '101', '1001', '1002'].forEach((v) => ids.add(v));

const idArr = Array.from(ids).sort((a, b) => Number(a) - Number(b));
console.log('[dense] ID 候选 ' + idArr.length + ' 个 × 前缀 ' + TARGETS.length + ' 个 = ' +
  (idArr.length * TARGETS.length) + ' 次探测');

// ── HTTP ────────────────────────────────────────────────
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
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-dense/0.1', Connection: 'close' },
      timeout: 12000,
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, len: Number(res.headers['content-length'] || 0) });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve({ status: 0, len: 0 }));
    req.end();
  });
}

(async function () {
  const ip = await getIp();
  console.log('[dense] 源站 IP ' + ip + '\n');

  // 自检：控制组必须命中，否则探测链路有问题、结论不可信
  console.log('[dense] 自检（控制组应命中）:');
  let ctrlOk = 0;
  for (const t of TARGETS.filter((x) => x.control)) {
    let hit = null;
    for (const id of ['160001', '160267', '170001', '180001']) {
      const r = await head(ip, t.prefix + id + t.ext);
      if (r.status === 200) { hit = id; break; }
    }
    console.log('   ' + (hit ? '✅' : '❌') + ' ' + t.prefix + (hit ? '  命中 ID ' + hit : ''));
    if (hit) ctrlOk++;
  }
  if (ctrlOk === 0) {
    console.error('\n[dense] 自检全失败，中止以免产生误导结论。');
    process.exit(2);
  }
  console.log('');

  const jobs = [];
  TARGETS.filter((t) => !t.control).forEach((t) => {
    idArr.forEach((id) => jobs.push({ t, id }));
  });

  const hits = {};      // prefix -> [ids]
  const probed = {};    // prefix -> count
  let idx = 0, done = 0;

  await Promise.all(Array.from({ length: CONC }, async () => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      const p = job.t.prefix;
      probed[p] = (probed[p] || 0) + 1;
      const r = await head(ip, p + job.id + job.t.ext);
      if (r.status === 200) {
        (hits[p] = hits[p] || []).push({ id: job.id, len: r.len });
        console.log('   ★ 命中 ' + p + job.id + job.t.ext + '  (' + r.len + ' B)');
      }
      done++;
      if (done % 500 === 0) console.log('   进度 ' + done + '/' + jobs.length);
    }
  }));

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    origin: ip,
    idCandidates: idArr.length,
    probed: probed,
    hits: hits,
  }, null, 2), 'utf8');

  console.log('\n===== 结论 =====');
  TARGETS.filter((t) => !t.control).forEach((t) => {
    const h = hits[t.prefix];
    console.log('  ' + (h ? '✅ 存在' : '❌ 无命中') + '  ' + t.prefix.padEnd(38) +
      '  探测 ' + probed[t.prefix] + ' 个 ID' + (h ? '  命中 ' + h.length + ' 个: ' + h.slice(0, 8).map((x) => x.id).join(',') : ''));
  });
  console.log('\n输出 -> ' + OUT);
})();
