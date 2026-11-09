/**
 * rebuild-all.mjs —— 骨架改动后，用 tools/mech/*.js 重新拼出所有已生成的 stage。
 *   node tools/rebuild-all.mjs
 * 只重建 public/stages 里已有同名 liziNN-*.html 的机制（标题从旧文件读）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'E:/DSHdesktop/work/music-player';
const MECH = path.join(ROOT, 'tools/mech');
const STAGES = path.join(ROOT, 'public/stages');
const files = fs.readdirSync(MECH).filter((f) => /^lizi\d+\.js$/.test(f)).sort();
let n = 0;
for (const f of files) {
  const id = f.replace('.js', '');
  const hit = fs.readdirSync(STAGES).find((s) => s.startsWith(id + '-') && s.endsWith('.html'));
  if (!hit) { console.log('skip (无 stage): ' + f); continue; }
  const short = hit.slice(id.length + 1, -5);
  const old = fs.readFileSync(path.join(STAGES, hit), 'utf8');
  const m = old.match(/<title>([^<]*)<\/title>/);
  const title = m ? m[1] : short;
  execFileSync(process.execPath, [path.join(ROOT, 'tools/lizi-make.mjs'), id, short, title, path.join(MECH, f)], { stdio: 'inherit' });
  n++;
}
console.log('rebuilt ' + n);
