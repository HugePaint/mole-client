'use strict';
/**
 * molemirror — 摩尔庄园本地客户端资源镜像
 *
 * 两种模式共用一套缓存与日志：
 *   1) 正向代理 (forward)  ：监听 proxyPort，供 Ruffle 用 --proxy / HTTP_PROXY 接入。
 *   2) 反向代理源站 (origin)：监听 originPort，配合 hosts 把 mole.61.com 指向 127.0.0.1。
 *
 * 设计要点：
 *   - 缓存键保留原始 URL 的目录结构（不 hash），便于人工核对与打包分发。
 *   - 上游解析走独立的 dns.Resolver（绕过 hosts 文件），因此「hosts 劫持 + 本地回源」不会自环。
 *   - 只缓存静态 GET（无 query、在 staticHosts 白名单、返回 200）；登录/POST/动态一律透传。
 *   - 全量请求日志 = 客户端资源全景清单（替代未知的 TaomeeVersionManager manifest）。
 *
 * 兼容 Node 14（只用核心模块，CommonJS，无 fs.rmSync / replaceAll / fetch）。
 */

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');

// ─────────────────────────── 配置 ───────────────────────────

const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  proxyPort: Number(process.env.MOLEMIRROR_PROXY_PORT || 8899),
  controlPort: Number(process.env.MOLEMIRROR_CONTROL_PORT || 8898),
  originPort: Number(process.env.MOLEMIRROR_ORIGIN_PORT || 8080),
  cacheDir: process.env.MOLEMIRROR_CACHE || path.join(ROOT, 'cache'),
  logDir: process.env.MOLEMIRROR_LOGS || path.join(ROOT, 'logs'),
  offline: process.argv.indexOf('--offline') >= 0,

  // 只对这些主机的静态资源做缓存（客户端资源 CDN + Flex SWZ 宿主）
  staticHosts: [
    'mole.61.com',
    'webres.61.com',
    'game-res.61.com',
    'res.61.com',
    'fpdownload.adobe.com',
    'fpdownload.macromedia.com',
  ],

  // 上游解析专用 DNS（绕过 hosts）。国内可达性优先。
  dnsServers: ['223.5.5.5', '119.29.29.29'],
  dnsTtlMs: 5 * 60 * 1000,

  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) molemirror/0.1',
  upstreamTimeoutMs: 30000,
};

fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
fs.mkdirSync(CONFIG.logDir, { recursive: true });

const LOG_FILE = path.join(CONFIG.logDir, 'requests.jsonl');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// ─────────────────────── 统计 ───────────────────────

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  upstreamOk: 0,
  upstreamErr: 0,
  offlineHits: 0,
  offlineMisses: 0,
  overrides: 0,
  bytesServed: 0,
  bytesFetched: 0,
  byHost: {},          // host -> {requests, cached}
  cacheable: {},       // url -> {bytes, contentType, ts}
};

// 启动时载入既有缓存索引（扫描磁盘）
function indexPath() {
  return path.join(CONFIG.logDir, 'cache-index.json');
}

function loadIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), 'utf8');
    const obj = JSON.parse(raw);
    Object.keys(obj).forEach(function (k) { stats.cacheable[k] = obj[k]; });
    console.log('[molemirror] 载入缓存索引 ' + Object.keys(stats.cacheable).length + ' 条');
  } catch (e) {
    console.log('[molemirror] 无既有缓存索引，从零开始');
  }
}

let indexDirty = false;
function saveIndex() {
  if (!indexDirty) return;
  indexDirty = false;
  const tmp = indexPath() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(stats.cacheable));
    fs.renameSync(tmp, indexPath());
  } catch (e) {
    console.error('[molemirror] 索引写入失败: ' + e.message);
  }
}
setInterval(saveIndex, 5000);

// ─────────────────────── DNS（绕过 hosts） ───────────────────────

const resolver = new dns.Resolver();
try { resolver.setServers(CONFIG.dnsServers); } catch (e) { /* 忽略 */ }

const ipCache = new Map(); // host -> {ip, exp}

function resolveUpstream(host, cb) {
  const hit = ipCache.get(host);
  if (hit && hit.exp > Date.now()) return cb(null, hit.ip);

  // 已经是 IP 就不再解析
  if (net.isIP(host)) return cb(null, host);

  resolver.resolve4(host, function (err, addrs) {
    if (err || !addrs || !addrs.length) {
      // 解析失败则退回系统解析（可能被 hosts 影响，但总比完全不可用强）
      return cb(null, host);
    }
    const ip = addrs[0];
    ipCache.set(host, { ip: ip, exp: Date.now() + CONFIG.dnsTtlMs });
    cb(null, ip);
  });
}

// ─────────────────────── 缓存路径映射 ───────────────────────

const MIME = {
  '.swf': 'application/x-shockwave-flash',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.swz': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.ico': 'image/x-icon',
  '.sol': 'application/octet-stream',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sanitizeSegment(s) {
  return s.replace(/[<>:"|?*\x00-\x1f\\]/g, '_');
}

function cachePathFor(u) {
  const host = sanitizeSegment(u.hostname);
  let pathname = u.pathname;
  try { pathname = decodeURIComponent(pathname); } catch (e) { /* 保持原样 */ }

  let parts = pathname.split('/').filter(function (s) {
    return s && s !== '.' && s !== '..';
  }).map(sanitizeSegment);

  if (!parts.length) parts = ['_index'];
  const file = parts.pop();
  return path.join.apply(path, [CONFIG.cacheDir, host].concat(parts, [file]));
}

// 带 TTL 的「探针」资源：既要保持在线时的新鲜度，又必须是离线时的硬依赖。
//
// 教训：version/zzz_config.txt 是**硬依赖**——它一旦失败，客户端会走
// TaomeeVersionLoader/configErrorHandler 直接终止整条加载链（绝不继续加载 dll 模块）。
// 所以不能「永不缓存」，而要：在线超过 TTL 则回源刷新，离线则用陈旧值兜底。
const TTL_RESOURCES = [
  { re: /^\/version\/zzz_config\.txt$/i, ttlMs: 6 * 3600 * 1000 },
];

function ttlFor(u) {
  for (let i = 0; i < TTL_RESOURCES.length; i++) {
    if (TTL_RESOURCES[i].re.test(u.pathname)) return TTL_RESOURCES[i].ttlMs;
  }
  return null;
}

// 本地覆写：把官方已失效或需要接管的端点直接由本地应答（值为响应正文）
const LOCAL_OVERRIDES = {
  // config/Server.xml 里 MOUrl="login.mole.61.com"，客户端据此查询登录服地址。
  // 实测该主机 80 端口早已关闭（connect ECONNREFUSED 123.206.131.236:80），
  // 客户端会空等 ~2s 并向上报错误服务器刷失败埋点（那些服务器也早已下线）。
  // 按 RecMole loginip.lua 的约定，ip.txt 正文即 "host:port"。
  'login.mole.61.com/ip.txt': '123.206.131.236:1863',
};

function overrideFor(u) {
  const key = u.hostname + u.pathname;
  return Object.prototype.hasOwnProperty.call(LOCAL_OVERRIDES, key) ? LOCAL_OVERRIDES[key] : null;
}

/**
 * 缓存键归一化。
 *
 * 关键：客户端会给几乎每个静态资源追加缓存击穿参数（?i447fa34 / ?iekywkx4 / ?i816xnyw …）。
 * 若把 query 计入缓存键，同一份资源会被无限次重复回源，「资源全量本地化」永远无法完成。
 * 因此对静态文件类型一律剥掉 query 再作为缓存键。
 */
function normalizeForCache(u) {
  const c = new URL(u.toString());
  c.search = '';
  return c;
}

function isCacheable(u, method) {
  if (method !== 'GET') return false;
  if (CONFIG.staticHosts.indexOf(u.hostname) < 0) return false;
  if (/\.(php|jsp|asp|aspx|cgi)$/i.test(u.pathname)) return false;
  const ext = path.extname(u.pathname).toLowerCase();
  if (!ext) return false;                                     // 无扩展名视为动态接口
  return true;
}

// ─────────────────────── 日志 ───────────────────────

function logRequest(rec) {
  try { logStream.write(JSON.stringify(rec) + '\n'); } catch (e) { /* 忽略 */ }
}

// ─────────────────────── 上游抓取 ───────────────────────

function fetchUpstream(targetUrl, cb) {
  let u;
  try { u = new URL(targetUrl); } catch (e) { return cb(e); }

  const isHttps = u.protocol === 'https:';
  if (!isHttps && u.protocol !== 'http:') return cb(new Error('不支持协议 ' + u.protocol));

  resolveUpstream(u.hostname, function (err, ip) {
    const useIp = !isHttps && ip && ip !== u.hostname;

    const options = {
      host: useIp ? ip : u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: {
        'Host': u.hostname + (u.port ? ':' + u.port : ''),
        'User-Agent': CONFIG.userAgent,
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
      timeout: CONFIG.upstreamTimeoutMs,
    };
    if (isHttps) options.servername = u.hostname;

    const mod = isHttps ? https : http;
    const req = mod.request(options, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        cb(null, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('上游超时')); });
    req.on('error', function (e) { cb(e); });
    req.end();
  });
}

// ─────────────────────── 请求处理（正/反向共用） ───────────────────────

function handleProxyRequest(req, res, targetUrl, via) {
  const t0 = Date.now();
  stats.requests++;

  let u;
  try { u = new URL(targetUrl); } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('bad url: ' + targetUrl);
  }

  const hostKey = u.hostname;
  stats.byHost[hostKey] = stats.byHost[hostKey] || { requests: 0, cached: 0 };
  stats.byHost[hostKey].requests++;

  // ── 本地覆写（优先于缓存与回源）──
  const ov = overrideFor(u);
  if (ov !== null && req.method === 'GET') {
    const body = Buffer.from(ov, 'utf8');
    stats.overrides++;
    stats.bytesServed += body.length;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'X-MoleMirror': 'OVERRIDE',
    });
    res.end(body);
    logRequest({
      ts: t0, via: via, method: req.method, url: targetUrl, host: hostKey,
      status: 200, source: 'override', bytes: body.length, ms: Date.now() - t0,
    });
    return;
  }

  const cacheable = isCacheable(u, req.method);
  const cacheKey = cacheable ? normalizeForCache(u) : null;
  const cacheFile = cacheKey ? cachePathFor(cacheKey) : null;

  // ── 命中缓存 ──
  // TTL 资源在线时可能已过期：过期就跳过缓存命中，落到下面回源刷新；
  // 离线时无论多旧都照用（陈旧值远好过整条加载链崩掉）。
  let cacheStale = false;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const ttl = ttlFor(u);
    if (ttl !== null && !CONFIG.offline) {
      const idx = stats.cacheable[cacheKey.toString()];
      let born = idx && idx.ts;
      if (!born) {
        try { born = fs.statSync(cacheFile).mtimeMs; } catch (e) { born = Date.now(); }
      }
      if (Date.now() - born > ttl) cacheStale = true;
    }
  }
  if (cacheFile && !cacheStale && fs.existsSync(cacheFile)) {
    let body;
    try { body = fs.readFileSync(cacheFile); } catch (e) { body = null; }
    if (body) {
      stats.cacheHits++;
      stats.bytesServed += body.length;
      stats.byHost[hostKey].cached++;
      const ct = mimeFor(cacheFile);
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': body.length,
        'X-MoleMirror': 'HIT',
      });
      res.end(body);
      logRequest({
        ts: t0, via: via, method: req.method, url: targetUrl, host: hostKey,
        status: 200, source: 'cache', bytes: body.length, contentType: ct, ms: Date.now() - t0,
      });
      return;
    }
  }

  // ── 离线模式：彻底不回源（覆写仍然生效，因为它在更前面处理）──
  // 注意这里不再区分 cacheable：离线语义就是「一个字节都不上网」，
  // 非静态请求（埋点等）同样返回 504，从而真实暴露「哪些资源还没本地化」。
  if (CONFIG.offline) {
    stats.offlineMisses++;
    res.writeHead(504, { 'Content-Type': 'text/plain', 'X-MoleMirror': 'OFFLINE-MISS' });
    res.end('offline: not cached: ' + targetUrl);
    logRequest({
      ts: t0, via: via, method: req.method, url: targetUrl, host: hostKey,
      status: 504, source: 'offline-miss', bytes: 0, ms: Date.now() - t0,
    });
    return;
  }

  // ── 回源 ──
  if (cacheable) stats.cacheMisses++;

  fetchUpstream(targetUrl, function (err, up) {
    if (err) {
      stats.upstreamErr++;
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('upstream error: ' + err.message);
      logRequest({
        ts: t0, via: via, method: req.method, url: targetUrl, host: hostKey,
        status: 502, source: 'upstream-error', bytes: 0, error: err.message, ms: Date.now() - t0,
      });
      return;
    }

    stats.upstreamOk++;
    stats.bytesFetched += up.body.length;

    // 只缓存 200 且可缓存的
    if (cacheable && up.status === 200) {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const tmp = cacheFile + '.tmp';
        fs.writeFileSync(tmp, up.body);
        fs.renameSync(tmp, cacheFile);
        stats.cacheable[cacheKey.toString()] = {
          bytes: up.body.length,
          contentType: mimeFor(cacheFile),
          ts: Date.now(),
          // 源站对部分资源返回「200 + 空 body」（实测 cloth/bmpswf 里有数百个）。
          // 镜像仍忠实落盘，但必须打标，否则统计会把它们当成正常资源。
          empty: up.body.length === 0,
          sha256: crypto.createHash('sha256').update(up.body).digest('hex').slice(0, 16),
        };
        indexDirty = true;
      } catch (e) {
        console.error('[molemirror] 缓存写入失败 ' + targetUrl + ': ' + e.message);
      }
    }

    stats.bytesServed += up.body.length;
    const outHeaders = {
      'Content-Type': up.headers['content-type'] || mimeFor(u.pathname),
      'Content-Length': up.body.length,
      'X-MoleMirror': 'MISS',
    };
    res.writeHead(up.status, outHeaders);
    res.end(up.body);

    logRequest({
      ts: t0, via: via, method: req.method, url: targetUrl, host: hostKey,
      status: up.status, source: 'upstream', bytes: up.body.length,
      contentType: outHeaders['Content-Type'], cached: !!(cacheable && up.status === 200),
      ms: Date.now() - t0,
    });
  });
}

// ─────────────────────── 正向代理服务器 ───────────────────────

const proxyServer = http.createServer(function (req, res) {
  let target = req.url;
  if (!/^https?:\/\//i.test(target)) {
    // origin-form：退化为用 Host 头拼绝对 URL（兼容反向代理模式）
    target = 'http://' + (req.headers.host || 'unknown') + target;
  }
  handleProxyRequest(req, res, target, 'forward');
});

// CONNECT 隧道（HTTPS 透传，不缓存）
proxyServer.on('connect', function (req, clientSocket, head) {
  const parts = req.url.split(':');
  const host = parts[0];
  const port = Number(parts[1] || 443);
  stats.requests++;

  resolveUpstream(host, function (err, ip) {
    const upstream = net.connect(port, ip || host, function () {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      logRequest({
        ts: Date.now(), via: 'forward', method: 'CONNECT', url: host + ':' + port,
        host: host, status: 200, source: 'tunnel', bytes: 0, ms: 0,
      });
    });
    upstream.on('error', function () { try { clientSocket.destroy(); } catch (e) {} });
    clientSocket.on('error', function () { try { upstream.destroy(); } catch (e) {} });
  });
});

proxyServer.on('clientError', function (err, socket) {
  try { socket.destroy(); } catch (e) {}
});

// ─────────────────────── 反向代理源站服务器 ───────────────────────
// 配合 hosts: 127.0.0.1 mole.61.com → 本地 :8080，SWF 自认仍在官网，域名守卫天然通过。

const originServer = http.createServer(function (req, res) {
  const target = 'http://' + (req.headers.host || 'mole.61.com') + req.url;
  handleProxyRequest(req, res, target, 'origin');
});

// ─────────────────────── 控制/管理接口 ───────────────────────

function jsonOut(res, obj, code) {
  const body = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

const controlServer = http.createServer(function (req, res) {
  const p = req.url.split('?')[0];

  if (p === '/__status') {
    const cachedUrls = Object.keys(stats.cacheable);
    let cachedBytes = 0;
    cachedUrls.forEach(function (k) { cachedBytes += stats.cacheable[k].bytes || 0; });
    return jsonOut(res, {
      startedAt: stats.startedAt,
      offline: CONFIG.offline,
      ports: { forward: CONFIG.proxyPort, origin: CONFIG.originPort, control: CONFIG.controlPort },
      cacheDir: CONFIG.cacheDir,
      logFile: LOG_FILE,
      requests: stats.requests,
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      upstreamOk: stats.upstreamOk,
      upstreamErr: stats.upstreamErr,
      offlineMisses: stats.offlineMisses,
      overrides: stats.overrides,
      cachedEntries: cachedUrls.length,
      cachedBytes: cachedBytes,
      bytesServed: stats.bytesServed,
      hitRate: stats.requests ? Number((stats.cacheHits / stats.requests).toFixed(3)) : 0,
      byHost: stats.byHost,
    });
  }

  if (p === '/__manifest') {
    const urls = Object.keys(stats.cacheable).sort();
    if (req.url.indexOf('?tsv') > 0) {
      const lines = ['url\tbytes\tcontentType\tsha256'];
      urls.forEach(function (u) {
        const e = stats.cacheable[u];
        lines.push([u, e.bytes, e.contentType, e.sha256].join('\t'));
      });
      const body = Buffer.from(lines.join('\n'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/tab-separated-values; charset=utf-8', 'Content-Length': body.length });
      return res.end(body);
    }
    return jsonOut(res, { count: urls.length, entries: stats.cacheable });
  }

  if (p === '/__empty') {
    const empties = [];
    Object.keys(stats.cacheable).forEach(function (u) {
      if (stats.cacheable[u].empty) empties.push(u);
    });
    empties.sort();
    if (req.url.indexOf('?tsv') > 0) {
      const body = Buffer.from(empties.join('\n'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
      return res.end(body);
    }
    return jsonOut(res, { count: empties.length, urls: empties });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('molemirror control: /__status  /__manifest  /__manifest?tsv  /__empty  /__empty?tsv');
});

// ─────────────────────── 启动 ───────────────────────

loadIndex();

function onListenError(which) {
  return function (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error('[molemirror] ' + which + ' 端口已被占用，另一个 molemirror 实例还在跑？');
      console.error('[molemirror] 结束它: Get-NetTCPConnection -LocalPort 8899 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }');
    } else {
      console.error('[molemirror] ' + which + ' 监听失败: ' + (err && err.message));
    }
    process.exit(1);
  };
}

proxyServer.on('error', onListenError('正向代理'));
originServer.on('error', onListenError('反向代理源站'));
controlServer.on('error', onListenError('控制接口'));

proxyServer.listen(CONFIG.proxyPort, '127.0.0.1', function () {
  console.log('[molemirror] 正向代理   http://127.0.0.1:' + CONFIG.proxyPort);
});
originServer.listen(CONFIG.originPort, '0.0.0.0', function () {
  console.log('[molemirror] 反向代理源站 http://0.0.0.0:' + CONFIG.originPort + '  (hosts 指向 127.0.0.1)');
});
controlServer.listen(CONFIG.controlPort, '127.0.0.1', function () {
  console.log('[molemirror] 控制接口   http://127.0.0.1:' + CONFIG.controlPort + '/__status');
});
console.log('[molemirror] 缓存目录   ' + CONFIG.cacheDir);
console.log('[molemirror] 请求日志   ' + LOG_FILE);
console.log('[molemirror] 离线模式   ' + (CONFIG.offline ? '开' : '关'));

process.on('SIGINT', function () { saveIndex(); process.exit(0); });
process.on('SIGTERM', function () { saveIndex(); process.exit(0); });
