'use strict';
/**
 * 压缩一份**原始** Ruffle 日志：把已知无害的重复告警折叠成一行汇总。
 *
 * 用在哪：
 *   - run.ps1 走的是「Ruffle stdout 直写 logs\ruffle_out.txt」，那里没有降噪管道；
 *   - 也适用于历史上已经攒下来的大日志（启动器改造前的 launcher.log）。
 *   启动器自己的日志管道已在 RuffleLogFilter.cs 里做同样的事（新日志默认就是干净的）。
 *
 * 折叠规则与 launcher\MoleLauncher\Services\RuffleLogFilter.cs 保持一致：
 *   Movie clip <N>: Duplicated frame label   —— Ruffle 对重复帧标签的例行提醒，无影响
 *
 * 用法:
 *   node tools/filter-ruffle-log.js <原始日志> [输出文件]
 *   不给输出文件则只统计、不落盘（原文件绝不被覆盖）。
 */

const fs = require('fs');
const path = require('path');

const NOISE = [
  { name: 'Duplicated frame label', re: /Movie clip \d+: Duplicated frame label/ },
];

const input = process.argv[2];
const output = process.argv[3];
if (!input) {
  console.error('用法: node tools/filter-ruffle-log.js <原始日志> [输出文件]');
  process.exit(1);
}

// PowerShell 写出来的文件可能带 BOM（见 docs/encoding-notes.md），先剥掉
const text = fs.readFileSync(path.resolve(input), 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);

const counts = {};
const kept = [];
let dropped = 0;

for (const line of lines) {
  const hit = NOISE.find(n => n.re.test(line));
  if (hit) {
    counts[hit.name] = (counts[hit.name] || 0) + 1;
    dropped++;
    continue;
  }
  kept.push(line);
}

// 汇总行插到最前面，方便一眼看到被折叠了什么
const summary = Object.entries(counts).map(([name, n]) =>
  `# [filter-ruffle-log] 已折叠 ${n} 条 "${name}"（对运行无影响）`);
const out = summary.concat(kept.filter((l, i) => l.length > 0 || i < kept.length - 1));

console.log(`[filter-ruffle-log] 输入 ${lines.length} 行，折叠 ${dropped} 行，保留 ${lines.length - dropped} 行`);
for (const [name, n] of Object.entries(counts)) console.log(`   ${String(n).padStart(6)}  ${name}`);
if (counts['Duplicated frame label']) {
  const pct = (counts['Duplicated frame label'] / lines.length * 100).toFixed(1);
  console.log(`   占了全文 ${pct}%`);
}

if (output) {
  const dest = path.resolve(output);
  // 与 LogService.cs 一致：带 BOM 的 UTF-8，记事本/PowerShell 5.1 都不会读成乱码
  fs.writeFileSync(dest, '\uFEFF' + out.join('\r\n') + '\r\n', 'utf8');
  console.log(`[filter-ruffle-log] 输出 ${dest}`);
} else {
  console.log('[filter-ruffle-log] 未给输出文件，只统计不落盘（原文件未被改动）');
}
