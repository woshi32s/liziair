/**
 * lizi2.mjs —— 用「v2 核心（实心字+厚度+打光+3D 环绕）」+ 一份本形态物理文件，拼出 tools/mech/liziNN.js，
 * 然后可选地直接构建 + 验收。
 *
 *   node tools/lizi2.mjs 54 tunnel 粒子隧道 tools/v2/54.js          # 只拼 mech
 *   node tools/lizi2.mjs 54 tunnel 粒子隧道 tools/v2/54.js --build  # 拼 + 构建
 *
 * 物理文件里应当定义：mechResize / mechAssign / mechUpdate / mechDraw / mechEvent
 * （核心已提供 vx/vy/vtx/vty/von/vlum/vsx/vsy/vss/vn/vBands/vCore/vMid/vDim/vLightCv/vPulse，
 *  以及 base 的 W/H/ctx/cam/L/spans/charGlow/blockGx/blockGy/pjX/pjY/accent/clamp01/rnd）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'E:/DSHdesktop/work/music-player';
const [id, short, title, physPath] = process.argv.slice(2);
if (!id || !short || !title || !physPath) {
  console.error('用法: node tools/lizi2.mjs <id> <short> <中文名> <物理文件> [--build]');
  process.exit(1);
}
const core = fs.readFileSync(path.join(ROOT, 'tools/mech/_v2-core.js'), 'utf8');
const phys = fs.readFileSync(path.resolve(ROOT, physPath), 'utf8');
if (!core.includes('/*__PHYSICS__*/')) { console.error('核心文件缺 /*__PHYSICS__*/ 标记'); process.exit(1); }
const out = core.replace('/*__PHYSICS__*/', phys);
const mechPath = path.join(ROOT, 'tools/mech', `lizi${id}.js`);
fs.writeFileSync(mechPath, out, 'utf8');
console.log(`wrote ${mechPath} (${(out.length / 1024).toFixed(1)} KB)`);

if (process.argv.includes('--build')) {
  execFileSync('node', ['tools/lizi-make.mjs', `lizi${id}`, short, title, `tools/mech/lizi${id}.js`],
    { cwd: ROOT, stdio: 'inherit' });
}
