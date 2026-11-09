/** 把 LIZI-PLAN.md 的进度行与 05 行更新成"50 个全部完成"。 */
import fs from 'node:fs';
const PLAN = 'E:/DSHdesktop/work/music-player/LIZI-PLAN.md';
let s = fs.readFileSync(PLAN, 'utf8');
s = s.replace(/^\|\s*(?:✅|⚠|✔|★)?\s*05\s*\|/m, '| ✅05 |');
s = s.replace(/^> 进度：.*$/m,
  '> 进度：✅ 50 个全部完成并验收（01-50，均已注册进播放器，`?stage=lizi01` 可直接看）。' +
  '05 已按新流水线重做（旧的 `_wip-lizi05-ferrofluid.html` 保留但未注册）。' +
  '16-50 由 `tools/lizi-make.mjs`（通用骨架 + `tools/mech/liziNN.js` 机制片段）生成，改骨架后跑 `node tools/rebuild-all.mjs` 重建。');
fs.writeFileSync(PLAN, s);
console.log('plan updated to 50');
