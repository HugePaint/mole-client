'use strict';
/**
 * 「前缀 × ID 空间」矩阵探测：解开剩余路径模板的 ID 空间。
 *
 * 思路：
 *   剩余模板形如 resource/magicSpirit/icon/{?}.swf —— 前缀已知，缺的是 ID 从哪来。
 *   语料里有十几个分类、每类几百到上千个 ID（文件名即 ID）。
 *   于是对每个 (前缀, ID空间) 组合取少量样本探测：
 *     任一样本 200 → 该配对成立，随后可全量枚举。
 *
 * 探测用 HEAD 直连官方源站（绕过镜像，不污染缓存、也不打扰在跑的实例）。
 *
 * 输出: resources/prefix-matrix-result.json
 */

const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'resources', 'corpus-ids.json');
const UNRES = path.join(ROOT, 'resources', 'tool-templates-unresolved.txt');
const OUT = path.join(ROOT, 'resources', 'prefix-matrix-result.json');

const SAMPLES = 3;         // 每个组合取几个样本
const CONC = 10;

const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8').replace(/^\uFEFF/, ''));

// ── 待解前缀：从模板文件读出，剥掉占位符与扩展名 ──
// 注意两个坑：
//  1) 不能用正则 `\{?\}?\.(swf|mp3)$` —— 回溯会把 `{?}` 留下，拼出 `.../{?/123.swf` 坏 URL；
//  2) 前缀**不能强行补尾斜杠** —— `resource/newTask/task{?}.swf` 的真实形态是
//     `resource/newTask/task<ID>.swf`，补斜杠会拼错。因此显式携带扩展名，URL = prefix + id + ext。
const RESOLVED = ['resource/goods/icon/', 'resource/farm/icon/'];
const templates = fs.readFileSync(UNRES, 'utf8').split(/\r?\n/)
  .map(function (s) { return s.trim(); })
  .filter(Boolean)
  .map(function (t) {
    const ext = /\.mp3$/i.test(t) ? '.mp3' : '.swf';
    const prefix = t.replace(/\{[^}]*\}/g, '').replace(/\.(swf|mp3)$/i, '');
    return { prefix: prefix, ext: ext };
  })
  .filter(function (o) { return o.prefix && o.prefix.indexOf('/') > 0; })
  .filter(function (o) { return !RESOLVED.some(function (r) { return o.prefix.indexOf(r) === 0; }); });

const uniqPrefixes = [];
const seenP = {};
templates.forEach(function (o) {
  if (seenP[o.prefix]) return;
  seenP[o.prefix] = o.ext;
  uniqPrefixes.push(o.prefix);
});

// 可选：只探测指定前缀（argv[2] = 每行一个前缀的文件），用于二轮收敛
const ONLY = process.argv[2];
if (ONLY) {
  const want = fs.readFileSync(path.resolve(ROOT, ONLY), 'utf8')
    .split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  const wantSet = {};
  want.forEach(function (w) {
    wantSet[w] = true;
    wantSet[w.replace(/\/$/, '')] = true;
  });
  const filtered = uniqPrefixes.filter(function (p) {
    return wantSet[p] || wantSet[p.replace(/\/$/, '')];
  });
  uniqPrefixes.length = 0;
  filtered.forEach(function (p) { uniqPrefixes.push(p); });
  console.log('[matrix] 仅探测清单中的 ' + uniqPrefixes.length + ' 个前缀（来自 ' + ONLY + '）');
}

// ── 候选 ID 空间 ──
const spaces = {};
const folderIds = corpus.allFolderIds || {};
Object.keys(folderIds).forEach(function (k) {
  const idsArr = folderIds[k].filter(function (x) { return /^\d+$/.test(x); });
  if (idsArr.length >= 5) spaces[k] = idsArr;
});
// 也加上已确认的 ids.* 空间（注意 ids.other 是对象，需过滤）
Object.keys(corpus.ids || {}).forEach(function (k) {
  if (!Array.isArray(corpus.ids[k])) return;
  const a = corpus.ids[k].filter(function (x) { return /^\d+$/.test(x); });
  if (a.length >= 5) spaces['ids.' + k] = a;
});

// ── 关键补充：从**博物馆物品表的 path 字段**反推出的一批新 ID 空间 ──
// 博物馆给了 9,761 条权威路径，把它们按前缀归并，就得到一批此前语料里没有的 ID 集合
// （例如 resource/allJob/icon/ 的 190001…、resource/angelFight/icon/ 的 1301001…）。
// 这些新 ID 空间正是解开剩余前缀所需的钥匙。
try {
  const mi = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'museum-items.json'), 'utf8').replace(/^\uFEFF/, ''));
  const byPre = {};
  (mi.items || []).forEach(function (it) {
    const p = it.path;
    if (!p || p === '404.swf') return;
    const pre = p.replace(/[^/]*$/, '');
    const numM = p.match(/(\d{2,10})(?:_\d{1,4})?\.\w+$/);
    if (!pre || !numM) return;
    byPre[pre] = byPre[pre] || new Set();
    byPre[pre].add(numM[1]);
  });
  Object.keys(byPre).forEach(function (pre) {
    const a = Array.from(byPre[pre]).sort(function (x, y) { return x - y; });
    if (a.length >= 3) spaces['museum:' + pre] = a;
  });
  console.log('[matrix] 从博物馆 path 反推出 ' + Object.keys(byPre).length + ' 个新 ID 空间');
} catch (e) { console.log('[matrix] (无 museum-items.json，跳过博物馆 ID 空间)'); }

console.log('[matrix] 待解前缀 ' + uniqPrefixes.length + ' 个');
console.log('[matrix] 候选 ID 空间 ' + Object.keys(spaces).length + ' 个: ' + Object.keys(spaces).join(', '));
console.log('[matrix] 组合数 ' + (uniqPrefixes.length * Object.keys(spaces).length) +
  '，每组合 ' + SAMPLES + ' 样本');

// ── DNS 独立解析（与镜像一致，绕过 hosts）──
const resolver = new dns.Resolver();
try { resolver.setServers(['223.5.5.5', '119.29.29.29']); } catch (e) { }
let originIp = null;
function getIp(cb) {
  if (originIp) return cb(originIp);
  resolver.resolve4('mole.61.com', function (e, a) {
    originIp = (a && a[0]) || '61.164.158.61';
    cb(originIp);
  });
}

function head(ip, rel) {
  return new Promise(function (resolve) {
    const req = http.request({
      host: ip, port: 80, method: 'HEAD', path: '/' + rel,
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-matrix/0.1', Connection: 'close' },
      timeout: 15000,
    }, function (res) {
      res.resume();
      resolve({ status: res.statusCode, len: Number(res.headers['content-length'] || 0) });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function () { resolve({ status: 0, len: 0 }); });
    req.end();
  });
}

(async function () {
  const ip = await new Promise(getIp);
  console.log('[matrix] 源站 IP ' + ip + '\n');

  // ── 自检：先探测几个**已知可行**的样本，证明探测链路本身没问题 ──
  // 上一轮矩阵全数误报「不匹配」，根因就是 URL 拼错而没有任何自检。
  const SELF = [
    'resource/home/seed/icon/1230005.swf',   // 已实测 200
    'resource/home/item/icon/1220038.swf',   // 已实测 200
    'resource/goods/icon/160267.swf',        // 已实测 200
    'resource/allJob/icon/190016.swf',       // 从 ClientAppDLL 抽出的 ID
  ];
  console.log('[matrix] 自检（应全部 200）:');
  let selfOk = 0;
  for (const s of SELF) {
    const r = await head(ip, s);
    console.log('   ' + (r.status === 200 ? '✅' : '❌') + ' ' + r.status + '  ' + s);
    if (r.status === 200) selfOk++;
  }
  if (selfOk === 0) {
    console.error('\n[matrix] 自检全失败 —— 探测链路有问题，中止以免产生误导性结论。');
    process.exit(2);
  }
  console.log('');

  const jobs = [];
  uniqPrefixes.forEach(function (p) {
    const ext = seenP[p];
    Object.keys(spaces).forEach(function (sk) {
      const ids = spaces[sk];
      // 均匀取样，避免只测连续段
      const step = Math.max(1, Math.floor(ids.length / SAMPLES));
      const picks = [];
      for (let i = 0; i < SAMPLES && i * step < ids.length; i++) picks.push(ids[i * step]);
      jobs.push({ prefix: p, ext: ext, space: sk, picks: picks });
    });
  });

  const results = [];
  let idx = 0, done = 0;
  await Promise.all(Array.from({ length: CONC }, async function () {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      let hit = null;
      for (let i = 0; i < job.picks.length; i++) {
        const rel = job.prefix + job.picks[i] + job.ext;
        const r = await head(ip, rel);
        if (r.status === 200) { hit = { id: job.picks[i], len: r.len, url: rel }; break; }
      }
      results.push({ prefix: job.prefix, ext: job.ext, space: job.space, samples: job.picks, hit: hit });
      done++;
      if (done % 100 === 0) console.log('  进度 ' + done + '/' + jobs.length);
    }
  }));

  // 汇总：每个前缀命中了哪些 ID 空间
  const byPrefix = {};
  results.forEach(function (r) {
    byPrefix[r.prefix] = byPrefix[r.prefix] || { hits: [], misses: [] };
    if (r.hit) byPrefix[r.prefix].hits.push(r.space + '(' + r.hit.id + ')');
    else byPrefix[r.prefix].misses.push(r.space);
  });

  const summary = {};
  Object.keys(byPrefix).sort().forEach(function (p) {
    summary[p] = byPrefix[p];
  });

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(), origin: ip,
    prefixes: uniqPrefixes.length, spaces: Object.keys(spaces).length, results: results, summary: summary,
  }, null, 2), 'utf8');

  console.log('\n===== 结果 =====');
  let solved = 0;
  Object.keys(summary).sort().forEach(function (p) {
    const s = summary[p];
    if (s.hits.length) {
      solved++;
      console.log('  ✅ ' + p.padEnd(46) + ' → ' + s.hits.join(', '));
    } else {
      console.log('  ❌ ' + p.padEnd(46) + ' → 全部 ID 空间都不匹配 (' + s.misses.length + ' 个)');
    }
  });
  console.log('\n解开 ' + solved + ' / ' + uniqPrefixes.length + ' 个前缀');
  console.log('输出 -> ' + OUT);
})();
