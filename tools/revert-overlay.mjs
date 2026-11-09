/**
 * tools/revert-overlay.mjs —— 把误加到 01-50（第一批，已验收过）mech 上的覆盖层剪掉。
 *   node tools/revert-overlay.mjs 1 50      # 对 id 在 [1,50] 的文件生效
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const MECH = path.join(ROOT, 'tools/mech');
const lo = Number(process.argv[2] || 1), hi = Number(process.argv[3] || 50);
const MARK = '/* ===== v2 实体字覆盖层（自足版）';
let n = 0;
for (const f of fs.readdirSync(MECH).filter((x) => /^lizi\d+\.js$/.test(x))) {
  const id = Number(f.match(/lizi(\d+)/)[1]);
  if (id < lo || id > hi) continue;
  const p = path.join(MECH, f);
  let src = fs.readFileSync(p, 'utf8');
  const i = src.indexOf(MARK);
  if (i < 0) continue;
  src = src.slice(0, i).trimEnd() + '\n';
  fs.writeFileSync(p, src, 'utf8');
  n++;
  console.log('reverted ' + f);
}
console.log('reverted ' + n);
