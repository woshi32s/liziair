/**
 * tools/apply-overlay.mjs —— 给「10-27 那批薄实现」的 mech 追加实体字覆盖层。
 *   node tools/apply-overlay.mjs          # 只处理缺少 vBands 的 mech
 *   node tools/apply-overlay.mjs --force  # 连已有覆盖层的也重加（会跳过已加过的）
 * 幂等：已含 "v2 实体字覆盖层" 的文件会跳过。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const MECH = path.join(ROOT, 'tools/mech');
const ov = fs.readFileSync(path.join(ROOT, 'tools/v2/_overlay.js'), 'utf8');
const MARK = 'v2 实体字覆盖层';

const files = fs.readdirSync(MECH).filter((f) => /^lizi\d+\.js$/.test(f)).sort();
let touched = 0, skipped = 0;
for (const f of files) {
  const p = path.join(MECH, f);
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes(MARK)) { skipped++; continue; }
  if (src.includes('vBands')) { skipped++; continue; }   /* 这批已经有 v2 实体字 */
  if (!/function mechDraw\s*\(/.test(src)) { console.log('skip (无 mechDraw): ' + f); continue; }
  src = src.trimEnd() + '\n' + ov;
  fs.writeFileSync(p, src, 'utf8');
  touched++;
  console.log('overlay -> ' + f);
}
console.log(`done: overlay ${touched}, skip ${skipped}`);
