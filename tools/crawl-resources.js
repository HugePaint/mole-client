'use strict';
/**
 * Phase 2 核心：递归资源爬取器。
 *
 * 思路（滚雪球）：
 *   种子 = SWF 常量池里抽出的路径 + 请求日志里真实出现过的 URL
 *   每抓到一个 200 的 SWF，就扫描它的字符串常量，把新发现的路径入队
 *   直到队列耗尽或达到预算
 *
 * 所有请求都经 molemirror 的正向代理，因此抓到的内容自动落盘缓存。
 *
 * 用法:
 *   node tools/crawl-resources.js              正常爬取
 *   node tools/crawl-resources.js --budget 500 限制请求数
 *   node tools/crawl-resources.js --dry        只打印计划，不实际请求
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PROXY = { host: '127.0.0.1', port: 8899 };
const ORIGIN = 'http://mole.61.com/';
const CAND = path.join(ROOT, 'resources', 'path-candidates.json');
const LOG = path.join(ROOT, 'logs', 'requests.jsonl');
const OUT_JSON = path.join(ROOT, 'resources', 'crawl-results.json');
const OUT_MD = path.join(ROOT, 'resources', 'crawl-report.md');

const argv = process.argv.slice(2);
const DRY = argv.indexOf('--dry') >= 0;
const budgetIdx = argv.indexOf('--budget');
const BUDGET = budgetIdx >= 0 ? parseInt(argv[budgetIdx + 1], 10) : 4000;
const CONCURRENCY = 8;

// ── 收集种子 ────────────────────────────────────────────────

function cleanPath(s) {
  return s.replace(/(\.(swf|xml|mp3|png|jpg|jpeg|gif|txt|sol))[A-Za-z0-9_\u4e00-\u9fff]{1,3}$/i, '$1');
}

function loadSeeds() {
  const seeds = new Set();

  // 1) SWF 常量池抽出的路径
  try {
    const cand = JSON.parse(fs.readFileSync(CAND, 'utf8'));
    cand.fullPaths.forEach(function (p) { seeds.add(cleanPath(p)); });
    // 目录片段里若已带扩展名也可用
    cand.fragments.forEach(function (p) {
      const c = cleanPath(p);
      if (/\.(swf|xml|mp3)$/i.test(c)) seeds.add(c);
    });
  } catch (e) { console.log('  (无 path-candidates.json)'); }

  // 2) 请求日志里真实出现过的 URL —— 这些必然有效
  try {
    const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    lines.forEach(function (l) {
      let o; try { o = JSON.parse(l); } catch (e) { return; }
      if (o.host !== 'mole.61.com' || !o.url) return;
      if (o.status !== 200) return;
      seeds.add(o.url.replace(/^http:\/\/mole\.61\.com\//, '').split('?')[0]);
    });
  } catch (e) { console.log('  (无 requests.jsonl)'); }

  // 3) 扫描缓存目录里**所有** SWF —— 包括「游玩时被按需抓到、但爬虫从没抓过」的文件。
  //    这些文件的字符串常量里同样含有下一跳路径，是纯爬虫触达不到的盲区。
  try {
    const cacheRoot = path.join(ROOT, 'cache');
    let scanned = 0, added = 0;
    (function walk(dir) {
      let es;
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      es.forEach(function (e) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        if (!/\.swf$/i.test(e.name)) return;
        try {
          const found = scanForPaths(fs.readFileSync(p));
          scanned++;
          found.forEach(function (x) { if (!seeds.has(x)) { seeds.add(x); added++; } });
        } catch (err) { }
      });
    })(cacheRoot);
    console.log('  已扫描缓存 SWF ' + scanned + ' 个，新增种子 ' + added + ' 条');
  } catch (e) { console.log('  (缓存扫描跳过: ' + e.message + ')'); }

  // 4) 摩尔博物馆数据接口抽出的资源路径 + 由 ID 空间组合出的候选
  try {
    const ms = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'museum-seeds.json'), 'utf8'));
    let n1 = 0, n2 = 0, n3 = 0;

    // 4a) 直接路径。注意：museum_map_swf/* 经实测在官方 CDN 上 404（那是博物馆自己的快照资源），
    //     这里显式排除，避免白白浪费请求预算。
    (ms.resourcePaths || []).forEach(function (p) {
      if (p.indexOf('resource/map/museum_map_swf/') === 0) return;
      if (!seeds.has(p)) { seeds.add(p); n1++; }
    });

    // 4b) 衣服图标：ID 来自博物馆 ClothJson，命名规则 resource/cloth/icon/<id>.swf 已实测为真
    (ms.ids && ms.ids.cloth || []).forEach(function (id) {
      const p = 'resource/cloth/icon/' + id + '.swf';
      if (!seeds.has(p)) { seeds.add(p); n2++; }
    });

    // 4c) 地图：客户端形如 resource/map/Map_<10000+id>.{xml,swf}
    //     证据：Map_10010/10080/10083/10084/10120/10121 均真实存在，
    //     且地图 XML 里 alt_map 的 Param 就是小整数地图号（如 84、112）。
    for (let id = 1; id <= 500; id++) {
      const n = 10000 + id;
      ['resource/map/Map_' + n + '.xml', 'resource/map/Map_' + n + '.swf'].forEach(function (p) {
        if (!seeds.has(p)) { seeds.add(p); n3++; }
      });
    }

    console.log('  博物馆种子: 直接路径 +' + n1 + '，衣服图标 +' + n2 + '，地图候选 +' + n3);
  } catch (e) { console.log('  (博物馆种子跳过: ' + e.message + ')'); }

  // 5) 从「52摩尔共享素材与数据」语料归档清单抽出的 ID 空间展开的候选 URL。
  //    其中 cloth/bmpswf 的组号规律已实测确认：组空间恰好是 {1001,1002,1003}，
  //    且任意存在的衣服 ID 在三组里各有一份位图。
  try {
    const ci = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'corpus-ids.json'), 'utf8'));
    let n = 0;
    (ci.candidateUrls || []).forEach(function (p) { if (!seeds.has(p)) { seeds.add(p); n++; } });
    console.log('  语料种子: +' + n + '（衣服/地图/BGM）');
  } catch (e) { console.log('  (语料种子跳过: ' + e.message + ')'); }

  // 6) 从易语言工具源码（淘米素材查看器 查看器.e）抽出的路径模板。
  //    这些命名空间纯靠爬取发现不了，是从工具的资源拼接逻辑里读出来的。
  try {
    const t = fs.readFileSync(path.join(ROOT, 'resources', 'tool-template-seeds.txt'), 'utf8');
    let n = 0;
    t.split(/\r?\n/).forEach(function (x) {
      x = x.trim();
      if (x && !seeds.has(x)) { seeds.add(x); n++; }
    });
    console.log('  工具模板种子: +' + n);
  } catch (e) { /* 无工具模板种子 */ }

  return seeds;
}

// ── 从 SWF 字节里再抽路径（爬取时的增量发现）───────────────

const EXT_RE = /\.(swf|xml|mp3|png|jpg|jpeg|gif|txt|sol)$/i;
const PATH_RE = /(?:resource|module|dll|version|config|assets)\/[\x20-\x7E\u4e00-\u9fff]{6,180}/g;

function scanForPaths(buf) {
  const out = new Set();
  let raw = buf;
  // CWS 先解压，才能看到字符串
  if (buf.length > 8 && buf.slice(0, 3).toString('ascii') === 'CWS') {
    try { raw = zlib.inflateSync(buf.slice(8)); } catch (e) { return out; }
  } else if (buf.length > 8 && buf.slice(0, 3).toString('ascii') === 'ZWS') {
    try { raw = zlib.inflateSync(buf.slice(12)); } catch (e) { return out; }
  }
  const text = raw.toString('latin1');
  let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text)) !== null) {
    let s = m[0].replace(/[\\:*?"<>|,\s].*$/, '');
    const em = s.match(/^(.*?\.(?:swf|xml|mp3|png|jpg|jpeg|gif|txt|sol))/i);
    if (em && em[1].length >= 10 && em[1].length <= 180) out.add(em[1]);
  }
  return out;
}

// ── 经代理抓取 ──────────────────────────────────────────────

function fetchViaProxy(relPath) {
  return new Promise(function (resolve) {
    const target = ORIGIN + relPath;
    const req = http.request({
      host: PROXY.host, port: PROXY.port,
      method: 'GET', path: target,
      headers: { Host: 'mole.61.com', 'User-Agent': 'mole-crawler/0.1' },
      timeout: 30000,
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { resolve({ status: 0, error: e.message, body: Buffer.alloc(0) }); });
    req.end();
  });
}

// ── 主流程 ──────────────────────────────────────────────────

(async function main() {
  const seeds = loadSeeds();
  console.log('[crawl] 种子路径 ' + seeds.size + ' 条，预算 ' + BUDGET + ' 次请求' + (DRY ? '（dry-run）' : ''));

  if (DRY) {
    Array.from(seeds).slice(0, 40).forEach(function (s) { console.log('   ' + s); });
    console.log('   ...共 ' + seeds.size);
    return;
  }

  const seen = new Set();
  const results = [];           // {path, status, bytes, from}
  const discoveredFrom = {};    // path -> 发现来源
  let queue = Array.from(seeds);
  queue.forEach(function (p) { discoveredFrom[p] = 'seed'; });

  let fetched = 0;
  let ok = 0, notFound = 0, errs = 0;
  let totalBytes = 0;
  const newByDiscovery = { seed: seeds.size };

  while (queue.length > 0 && fetched < BUDGET) {
    // 取一批
    const batch = [];
    while (queue.length > 0 && batch.length < CONCURRENCY) {
      const p = queue.shift();
      if (seen.has(p)) continue;
      seen.add(p);
      batch.push(p);
    }
    if (batch.length === 0) continue;

    const settled = await Promise.all(batch.map(function (p) {
      return fetchViaProxy(p).then(function (r) { return { p: p, r: r }; });
    }));

    for (let i = 0; i < settled.length; i++) {
      const p = settled[i].p;
      const r = settled[i].r;
      fetched++;
      if (r.status === 200) {
        ok++;
        totalBytes += r.body.length;
        results.push({ path: p, status: 200, bytes: r.body.length });
        // 递归发现
        if (/\.swf$/i.test(p)) {
          const found = scanForPaths(r.body);
          let added = 0;
          found.forEach(function (np) {
            if (!seen.has(np) && np !== p) {
              queue.push(np);
              discoveredFrom[np] = p;
              added++;
            }
          });
          if (added > 0) newByDiscovery[p] = added;
        }
      } else if (r.status === 404 || r.status === 403) {
        notFound++;
        results.push({ path: p, status: r.status, bytes: 0 });
      } else {
        errs++;
        results.push({ path: p, status: r.status, bytes: 0, error: r.error });
      }
    }

    if (fetched % 100 < CONCURRENCY) {
      console.log('  进度: 已请求 ' + fetched + ' | 200=' + ok + ' 404=' + notFound + ' err=' + errs +
        ' | 队列剩余 ' + queue.length + ' | 累计 ' + (totalBytes / 1048576).toFixed(1) + ' MB');
    }
  }

  // 找出「发现新路径最多」的 SWF —— 这些是资源索引型文件
  const topDiscoverers = Object.keys(newByDiscovery)
    .filter(function (k) { return k !== 'seed'; })
    .sort(function (a, b) { return newByDiscovery[b] - newByDiscovery[a]; })
    .slice(0, 20);

  const report = {
    generatedAt: new Date().toISOString(),
    budget: BUDGET,
    fetched: fetched,
    ok: ok, notFound: notFound, errors: errs,
    totalBytes: totalBytes,
    uniquePathsTried: seen.size,
    queueRemaining: queue.length,
    topDiscoverers: topDiscoverers.map(function (k) { return { path: k, discovered: newByDiscovery[k] }; }),
    results: results,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const md = [];
  md.push('# Phase 2 递归爬取报告');
  md.push('');
  md.push('- 时间: ' + report.generatedAt);
  md.push('- 请求数: ' + fetched + '（200 = ' + ok + '，404/403 = ' + notFound + '，错误 = ' + errs + '）');
  md.push('- 抓取总量: ' + (totalBytes / 1048576).toFixed(2) + ' MB');
  md.push('- 去重路径: ' + seen.size + '，队列剩余: ' + queue.length);
  md.push('');
  md.push('## 发现新路径最多的文件（资源索引型）');
  md.push('');
  md.push('| 文件 | 新发现路径数 |');
  md.push('|---|---|');
  report.topDiscoverers.forEach(function (t) { md.push('| `' + t.path + '` | ' + t.discovered + ' |'); });
  md.push('');
  md.push('## 成功抓取（按体积 Top 40）');
  md.push('');
  md.push('| 路径 | 字节 |');
  md.push('|---|---|');
  results.filter(function (r) { return r.status === 200; })
    .sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, 40)
    .forEach(function (r) { md.push('| `' + r.path + '` | ' + r.bytes + ' |'); });
  fs.writeFileSync(OUT_MD, md.join('\n'), 'utf8');

  console.log('\n[crawl] 完成: 请求 ' + fetched + ' | 200=' + ok + ' 404=' + notFound + ' err=' + errs);
  console.log('[crawl] 抓取 ' + (totalBytes / 1048576).toFixed(2) + ' MB，队列剩余 ' + queue.length);
  console.log('[crawl] 报告 -> ' + OUT_MD);
  console.log('[crawl] 数据 -> ' + OUT_JSON);
  console.log('\n--- 发现新路径最多的文件 ---');
  report.topDiscoverers.forEach(function (t) { console.log('   ' + String(t.discovered).padStart(5) + '  ' + t.path); });
})();
