/**
 * tools/refresh-overlay.mjs —— 把 51-100 的 mech 里那份「实体字覆盖层」换成最新版（rev2：带字区压暗）。
 *   node tools/refresh-overlay.mjs
 * 只处理 51-100；01-50 不动。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const MECH = path.join(ROOT, 'tools/mech');
const ov = fs.readFileSync(path.join(ROOT, 'tools/v2/_overlay2.js'), 'utf8');
const MARK = '/* ===== v2 实体字覆盖层';
let n = 0, kept = 0;
for (const f of fs.readdirSync(MECH).filter((x) => /^lizi\d+\.js$/.test(x))) {
  const id = Number(f.match(/lizi(\d+)/)[1]);
  if (id < 51 || id > 100) { kept++; continue; }
  const p = path.join(MECH, f);
  const src = fs.readFileSync(p, 'utf8');
  const i = src.indexOf(MARK);
  if (i < 0) { kept++; continue; }                       /* 没有覆盖层的（我重做的 21 个）跳过 */
  const head = src.slice(0, i).trimEnd();
  fs.writeFileSync(p, head + '\n' + ov, 'utf8');
  n++;
}
console.log(`refreshed ${n}, untouched ${kept}`);
