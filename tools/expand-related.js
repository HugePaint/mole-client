'use strict';
/**
 * 以「最近新落盘的缓存」为种子，沿项目已知的运行时命名模板展开出**相关文件**候选。
 *
 * 为什么需要它：
 *   上次游玩新落盘了 24 个资源（cloth 位图、兽皮/宠物装扮、坐骑位图、BGM 等）。
 *   这些路径都带**运行时 ID**，静态爬取（crawl-resources.js）触达不到 —— 见
 *   resources/gap-analysis.md 的「仍待枚举的命名空间」。它们一旦出现，就说明对应的
 *   ID 空间在源站是活的：同族的兄弟文件（同 ID 的其他组号/其他变体/配套图标）大概率也存在。
 *   本工具把「游玩暴露出的 ID」补成「整族候选」，交给 tools/fetch-list.js 定向补齐。
 *
 * 展开规则（每条都注明来源，改动前请先看对应文档）：
 *   resource/cloth/bmpswf/<组>/<衣服ID>.swf   组空间固定 {1001,1002,1003}      docs/cloth-group-pattern.md
 *   resource/cloth/icon/<衣服ID>.swf          与 prevIcon 同 ID 成对            resources/gap-analysis.md
 *   resource/cloth/prevIcon/<衣服ID>.swf
 *   resource/dragon/bmpswf/<ID>_<变体>.swf    变体实测集合 {1,2,big_a,big_b}   本地 cache 实测
 *   resource/petcloth/swf<组>/<宠物ID>.swf    组空间 {1,2,3}                    resources/gap-analysis.md
 *   resource/petcloth/body/pet<ID>/<名>.swf   同宠物目录下的 skill_<N> 特效     resources/gap-analysis.md
 *   resource/bgSounds/BGM_<ID><后缀>.mp3      同 ID 的字母后缀变体 a..z         本地 cache 实测（BGM_001/BGM_001g）
 *   resource/bgSounds/FX_<ID>.mp3             FX 编号小范围枚举                  本地 cache 实测（FX_002/FX_004）
 *
 * 用法:
 *   node tools/expand-related.js [选项]
 *     --since <ISO|ms>   种子起点（默认取 cache-index.json 里最后一次「Client.swf」之后的条目）
 *     --list <文件>      改用外部种子列表（每行一个相对路径或完整 URL）
 *     --out  <文件>      输出候选列表（默认 resources/related-from-new-cache.txt）
 *     --all              连已缓存的一并输出（默认剔除，省请求）
 *     --dry              只打印统计，不写文件
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'logs', 'cache-index.json');

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argOf(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const OUT = path.resolve(ROOT, argOf('--out', 'resources/related-from-new-cache.txt'));
const LIST = argOf('--list', null);
const SINCE = argOf('--since', null);
const DRY = argv.includes('--dry');
const INCLUDE_CACHED = argv.includes('--all');

// ── 读缓存索引：URL -> {bytes,ts,empty} ────────────────────────────────
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8').replace(/^\uFEFF/, ''));
const cached = new Set(Object.keys(index).map(u => u.replace('http://mole.61.com/', '')));
console.log(`[expand-related] 缓存索引 ${cached.size} 条`);

// ── 种子 ────────────────────────────────────────────────────────────────
let seeds = [];
if (LIST) {
  seeds = fs.readFileSync(path.resolve(ROOT, LIST), 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^https?:\/\/[^/]+\//, ''));
  console.log(`[expand-related] 种子来自列表文件 ${LIST}`);
} else {
  // 「上次运行」的起点 = 请求日志里最后一次 /Client.swf 的时刻（= 最后一次开游戏）。
  // 注意不能用 cache-index.json 里 Client.swf 的 ts：索引记的是「首次落盘时间」，
  // 之后每次命中缓存都不会更新它，拿它当起点会把整个索引都当种子。
  let since = SINCE ? (Number.isFinite(Number(SINCE)) ? Number(SINCE) : Date.parse(SINCE)) : NaN;
  if (SINCE && !Number.isFinite(since)) throw new Error(`--since 无法解析: ${SINCE}`);
  if (!Number.isFinite(since)) {
    // 1) 索引里最新的落盘时刻 = 最近一次「真的抓到了新资源」
    let lastWrite = 0;
    for (const v of Object.values(index)) if (v.ts > lastWrite) lastWrite = v.ts;
    if (!lastWrite) throw new Error('cache-index.json 是空的');

    // 2) 那次落盘之前（含）最近的一次开游戏 = 这一轮运行的起点。
    //    这样即使之后又开过几次游戏但没抓到新资源（例如本地已全命中），
    //    种子仍然是「产出过新落盘的那一轮」，符合"根据新落盘的缓存"的语义。
    const reqPath = path.join(ROOT, 'logs', 'requests.jsonl');
    const lines = fs.readFileSync(reqPath, 'utf8').split(/\r?\n/);
    let runStart = 0;
    for (const line of lines) {
      if (!line || line.indexOf('/Client.swf') < 0) continue;
      try {
        const r = JSON.parse(line);
        if (/\/Client\.swf$/.test(r.url) && r.ts <= lastWrite && r.ts > runStart) runStart = r.ts;
      } catch { }
    }
    since = runStart ? runStart - 2000 : lastWrite - 300000; // 找不到就退回"最近 5 分钟"
    console.log(`[expand-related] 最近一次新落盘 ${new Date(lastWrite).toLocaleString()}；` +
      `对应运行起点 ${runStart ? new Date(runStart).toLocaleString() : '(未找到 Client.swf，按最近 5 分钟)'}`);
  }
  seeds = Object.entries(index)
    .filter(([, v]) => v.ts >= since)
    .sort((a, b) => a[1].ts - b[1].ts)
    .map(([u]) => u.replace('http://mole.61.com/', ''));
  console.log(`[expand-related] 种子 = 自 ${new Date(since).toLocaleString()}（上次开游戏）起新落盘的 ${seeds.length} 条`);
}

// ── 展开 ────────────────────────────────────────────────────────────────
const candidates = new Map(); // 相对路径 -> 规则说明
const add = (p, why) => { if (p && !candidates.has(p)) candidates.set(p, why); };

const CLOTH_GROUPS = ['1001', '1002', '1003'];
const PETCLOTH_GROUPS = ['1', '2', '3'];

for (const seed of seeds) {
  let m;

  // 衣服位图 → 三个组 + 配套图标
  if ((m = seed.match(/^resource\/cloth\/bmpswf\/\d+\/(\d+)\.swf$/))) {
    const id = m[1];
    CLOTH_GROUPS.forEach(g => add(`resource/cloth/bmpswf/${g}/${id}.swf`, 'cloth 组空间 {1001,1002,1003}'));
    add(`resource/cloth/icon/${id}.swf`, '与衣服位图同 ID 的图标');
    add(`resource/cloth/prevIcon/${id}.swf`, '与衣服位图同 ID 的预览图标');
  }

  // 衣服图标 / 预览图标 → 三组位图 + 另一个图标
  if ((m = seed.match(/^resource\/cloth\/(icon|prevIcon)\/(\d+)\.swf$/))) {
    const which = m[1], id = m[2];
    CLOTH_GROUPS.forEach(g => add(`resource/cloth/bmpswf/${g}/${id}.swf`, '同 ID 的衣服位图（三组）'));
    add(`resource/cloth/icon/${id}.swf`, '同 ID 图标');
    add(`resource/cloth/prevIcon/${id}.swf`, '同 ID 预览图标');
    void which;
  }

  // 坐骑：变体是「同目录内的同族文件」，不同目录用不同后缀（实测）：
  //   resource/dragon/bmpswf/<ID>_big_a.swf | _big_b.swf      大图
  //   resource/dragon/show/<ID>_2.swf   （另有极少数 _1）      展示
  //   resource/dragon/icon/<ID>_2.swf   （另有极少数 _1）      图标
  if ((m = seed.match(/^resource\/dragon\/([a-z]+)\/(\d+)_([a-z_0-9]+)\.swf$/))) {
    const dir = m[1], id = m[2];
    const variants = dir === 'bmpswf' ? ['big_a', 'big_b'] : ['1', '2'];
    variants.forEach(v => add(`resource/dragon/${dir}/${id}_${v}.swf`, `坐骑同目录变体（${dir}: ${variants.join(' / ')}）`));
  }

  // 宠物装扮 → 三个组 + 图标 + 旧版目录
  if ((m = seed.match(/^resource\/petcloth\/swf\d*\/(\d+)\.swf$/))) {
    const id = m[1];
    PETCLOTH_GROUPS.forEach(g => add(`resource/petcloth/swf${g}/${id}.swf`, 'petcloth 组空间 {1,2,3}'));
    add(`resource/petcloth/swf/cloth/${id}.swf`, 'petcloth 旧版路径');
    add(`resource/petcloth/icon/${id}.swf`, '同 ID 宠物装扮图标');
  }

  // 宠物装扮图标 → 位图与旧版路径
  if ((m = seed.match(/^resource\/petcloth\/icon\/(\d+)\.swf$/))) {
    const id = m[1];
    PETCLOTH_GROUPS.forEach(g => add(`resource/petcloth/swf${g}/${id}.swf`, '同 ID 宠物装扮位图'));
    add(`resource/petcloth/swf/cloth/${id}.swf`, 'petcloth 旧版路径');
  }

  // 宠物特效目录 → 同目录 skill_<N>
  if ((m = seed.match(/^resource\/petcloth\/body\/pet(\d+)\/[^/]+\.swf$/))) {
    const pet = m[1];
    for (let n = 1; n <= 8; n++) add(`resource/petcloth/swf2/pet${pet}/skill_${n}.swf`, '宠物技能特效编号枚举');
  }

  // BGM → 同 ID 的字母后缀变体（以及无后缀）
  if ((m = seed.match(/^resource\/bgSounds\/BGM_(\d{3})([a-z]?)\.mp3$/))) {
    const num = m[1];
    add(`resource/bgSounds/BGM_${num}.mp3`, 'BGM 无后缀基名');
    for (let c = 97; c <= 122; c++) add(`resource/bgSounds/BGM_${num}${String.fromCharCode(c)}.mp3`, 'BGM 字母后缀变体 a..z');
  }

  // 音效 FX：编号空间小，成批枚举
  if (/^resource\/bgSounds\/FX_\d{3}\.mp3$/.test(seed)) {
    for (let n = 1; n <= 12; n++) add(`resource/bgSounds/FX_${String(n).padStart(3, '0')}.mp3`, 'FX 编号枚举 001..012');
  }
}

// ── 剔除已缓存 ──────────────────────────────────────────────────────────
const all = [...candidates.keys()].sort();
const fresh = all.filter(p => !cached.has(p));
const out = INCLUDE_CACHED ? all : fresh;

const byRule = {};
for (const p of out) {
  const why = candidates.get(p);
  byRule[why] = (byRule[why] || 0) + 1;
}
console.log(`[expand-related] 候选 ${all.length} 条，其中已缓存 ${all.length - fresh.length} 条，待抓 ${out.length} 条`);
Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([why, n]) => console.log(`   ${String(n).padStart(4)}  ${why}`));
console.log('   待抓样例:');
out.slice(0, 12).forEach(p => console.log('     ' + p));

if (!DRY) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.join('\n') + (out.length ? '\n' : ''), 'utf8');
  console.log(`[expand-related] 已写 ${OUT}`);
}
