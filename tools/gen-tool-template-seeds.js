'use strict';
/**
 * 从「淘米素材查看器」的易语言源码里抽出的路径模板（64 条）生成补充种子。
 *
 * 这些模板补上了纯爬取发现不了的命名空间，例如:
 *   resource/allJob/icon/           （已实测 200）
 *   resource/elementCard/icon/      resource/elementCard/show/
 *   resource/goods/icon/            resource/magicSpirit/icon/
 *   resource/newAngel/icon|show|skillico/   resource/farm/icon/
 *   resource/pet/icon|head/         resource/newNpc/oneSide/
 *   module/home/home.swf            module/house/house.swf
 *
 * 输出: resources/tool-template-seeds.txt  （每行一个相对路径，供爬虫消费）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '_re', 'corpus', 'tools', '淘米素材查看器Ver0.4', '源码（易语言）', '查看器.e');
const OUT = path.join(ROOT, 'resources', 'tool-template-seeds.txt');

// 手工整理自扫描结果：模板 → 该模板适用的 ID 枚举方式
// 'concrete' = 本身就是完整路径；'smallint' = 小整数 ID；null = ID 未知，仅记录
const TEMPLATES = [
  // ── 完整路径，直接抓 ──
  ['module/angelFight/AngelFight.swf', 'concrete'],
  ['module/external/logo/51moleInfo0.swf', 'concrete'],
  ['module/external/logo/Logo.swf', 'concrete'],
  ['module/external/logo/randomMC.swf', 'concrete'],
  ['module/external/logo/loadlerMC.swf', 'concrete'],
  ['module/external/sirenNewHand.swf', 'concrete'],
  ['module/external/Speaker.swf', 'concrete'],
  ['module/external/NeverDisposePanel.swf', 'concrete'],
  ['module/home/home.swf', 'concrete'],
  ['module/house/house.swf', 'concrete'],
  ['module/lamuPKSys/AnimalSkillControler.swf', 'concrete'],
  ['resource/alertIco/angry.swf', 'concrete'],
  ['resource/alertIco/smile.swf', 'concrete'],
  ['resource/allJob/mainJobIcon/small/dou.swf', 'concrete'],
  ['resource/login/Advertisement.swf', 'concrete'],
  ['resource/lucas/20130723/dailyKnight.swf', 'concrete'],
  ['resource/lucas/20130723/lecelGetArm.swf', 'concrete'],
  ['resource/map/worldMap/Worldmap_BG.swf', 'concrete'],
  ['resource/worldMap/worldMap.swf', 'concrete'],
  ['resource/ui/topUI.swf', 'concrete'],
  ['resource/ui/index.swf', 'concrete'],
  ['resource/soundLib/lib1.swf', 'concrete'],
  // 海妖（siren）组件是明列的具体文件
  ['resource/siren/compoment/advToolBar.swf', 'concrete'],
  ['resource/siren/compoment/areaPanel.swf', 'concrete'],
  ['resource/siren/compoment/expandPanel.swf', 'concrete'],
  ['resource/siren/compoment/friendList.swf', 'concrete'],
  ['resource/siren/compoment/handBook.swf', 'concrete'],
  ['resource/siren/compoment/levelPanel.swf', 'concrete'],
  ['resource/siren/compoment/loginPanel.swf', 'concrete'],
  ['resource/siren/compoment/mountPanel.swf', 'concrete'],
  ['resource/siren/compoment/siShop.swf', 'concrete'],
  ['resource/siren/compoment/storage.swf', 'concrete'],
  ['resource/siren/compoment/toolBar.swf', 'concrete'],
  ['resource/siren/compoment/trainPanel.swf', 'concrete'],

  // ── 小整数 ID（实测 resource/allJob/icon/1.swf = 200）──
  ['resource/allJob/icon/{id}.swf', 'smallint'],

  // ── ID 空间未知，仅登记（不生成，避免无谓 404）──
  ['resource/activity/icon/{?}.swf', null],
  ['resource/effect/icon/{?}.swf', null],
  ['resource/elementCard/icon/{?}.swf', null],
  ['resource/elementCard/show/{?}.swf', null],
  ['resource/farm/icon/{?}.swf', null],
  ['resource/fitment/item/{?}.swf', null],
  ['resource/flower/icon/{?}.swf', null],
  ['resource/goods/icon/{?}.swf', null],
  ['resource/groupFightResource/pet/{?}.swf', null],
  ['resource/home/seed/icon/{?}.swf', null],
  ['resource/item/cloth/icon/{?}.swf', null],
  ['resource/item/throw/icon/{?}.swf', null],
  ['resource/jobNpc/jobBookNPC/{?}.swf', null],
  ['resource/magicSpirit/icon/{?}.swf', null],
  ['resource/newAngel/icon/{?}.swf', null],
  ['resource/newAngel/show/{?}.swf', null],
  ['resource/newAngel/skillico/{?}.swf', null],
  ['resource/newNpc/oneSide/{?}.swf', null],
  ['resource/pet/head/{?}.swf', null],
  ['resource/pet/icon/{?}.swf', null],
  ['resource/postcard/preIcon/{?}.swf', null],
  ['resource/restaurant/eventResource/goods/{?}.swf', null],
  ['resource/restaurant/swf/{?}.swf', null],
  ['resource/siren/icon/{?}.swf', null],
  ['resource/siren/swf/{?}.swf', null],
  ['resource/NPC/new_face/npc_{?}.swf', null],
  ['resource/bgSounds/BGM_{?}.mp3', null],
  ['resource/newTask/task{?}.swf', null],
  ['resource/oneBigStree/swf/{?}.swf', null],
];

const lines = [];
let n = 0, skipped = 0;
TEMPLATES.forEach(function (t) {
  const tpl = t[0], kind = t[1];
  if (kind === 'concrete') { lines.push(tpl); n++; return; }
  if (kind === 'smallint') {
    for (let i = 1; i <= 300; i++) { lines.push(tpl.replace('{id}', i)); n++; }
    return;
  }
  skipped++;
});

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

// 顺带把「已知但 ID 未知」的模板记录成文档，供后续破解
const docOut = path.join(ROOT, 'resources', 'tool-templates-unresolved.txt');
fs.writeFileSync(docOut,
  TEMPLATES.filter(function (t) { return t[1] === null; })
    .map(function (t) { return t[0]; }).join('\n') + '\n', 'utf8');

console.log('[tool-templates] 生成候选 ' + n + ' 条 -> ' + OUT);
console.log('[tool-templates] 已知但 ID 未解 ' + skipped + ' 条 -> ' + docOut);
console.log('');
console.log('未解模板（下一轮攻这些）:');
TEMPLATES.filter(function (t) { return t[1] === null; })
  .forEach(function (t) { console.log('   ' + t[0]); });
