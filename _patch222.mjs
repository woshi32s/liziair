import fs from 'node:fs';
const p = 'E:/DSHdesktop/work/music-player/public/stages/222-flow-field-lyrics.html';
let t = fs.readFileSync(p, 'utf8');

const a = t.indexOf('function integrate(seeds, fwd) {');
const b = t.indexOf('function bakeField(text) {');
if (a < 0 || b < 0) { console.log('anchor fail'); process.exit(1); }

const NEW = `function integrate(seeds, fwd) {
  const FWDN = fwd || FWD;
  const dir = [0, 0];
  for (let s = 0; s < seeds.length / 2; s++) {
    const sx = seeds[s * 2], sy = seeds[s * 2 + 1];
    /* 反向 FWDN 步 + 正向 FWDN 步，拼成一条穿过种子的长线 */
    const back = [];
    let x = sx, y = sy;
    for (let i = 0; i < FWDN; i++) {
      dirAt(x, y, dir);
      const mx2 = x - dir[0] * STEP * 0.5, my2 = y - dir[1] * STEP * 0.5;
      dirAt(mx2, my2, dir);
      x -= dir[0] * STEP; y -= dir[1] * STEP;
      if (x < -80 || x > W + 80 || y < -80 || y > H + 80) break;
      back.push(x, y);
    }
    const seq = [];
    for (let i = back.length - 2; i >= 0; i -= 2) seq.push(back[i], back[i + 1]);
    seq.push(sx, sy);
    x = sx; y = sy;
    for (let i = 0; i < FWDN; i++) {
      dirAt(x, y, dir);
      const mx2 = x + dir[0] * STEP * 0.5, my2 = y + dir[1] * STEP * 0.5;
      dirAt(mx2, my2, dir);
      x += dir[0] * STEP; y += dir[1] * STEP;
      if (x < -80 || x > W + 80 || y < -80 || y > H + 80) break;
      seq.push(x, y);
    }
    const n = seq.length / 2;
    if (n < 4) continue;
    for (let i = 0; i < n; i++) {
      const px2 = seq[i * 2], py2 = seq[i * 2 + 1];
      gX.push(px2); gY.push(py2); gP.push(i / (n - 1)); gI.push(inkAt(px2, py2));
    }
    gO.push(gX.length);
  }
}

/* 两批种子（笔画内 + 画面自由）要**追加**到同一份里再收口 ——
   分两次 integrate 各自重建数组的话，第二批会把第一批整个覆盖掉。 */
function resetField() { gX = []; gY = []; gP = []; gI = []; gO = [0]; }
function finishField() {
  fN = gX.length;
  fX = new Float32Array(fN); fY = new Float32Array(fN);
  fPar = new Float32Array(fN); fInk = new Uint8Array(fN);
  for (let i = 0; i < fN; i++) { fX[i] = gX[i]; fY[i] = gY[i]; fPar[i] = gP[i]; fInk[i] = gI[i]; }
  fOff = new Int32Array(gO);
  resetField();
}

`;
t = t.slice(0, a) + NEW + t.slice(b);

// 累加缓冲 + STEP/FWD 常量（原来常量在 bakeField 之上，保留一份即可）
t = t.replace(`const STEP = 8;
const FWD = 22;
`, '');
t = t.replace('const gX = ', 'const gX = ');
// 把 STEP/FWD 与缓冲区插到 integrate 之前
t = t.replace('function integrate(seeds, fwd) {', `const STEP = 8;            // 积分步长（CSS 像素）
const FWD = 22;            // 正/反各走多少步
let gX = [], gY = [], gP = [], gI = [], gO = [0];

function integrate(seeds, fwd) {`);

// 调用点：先 reset，两批积分，再收口
t = t.replace(`  integrate(inSeeds, 9);
  integrate(ambSeeds, 26);`, `  resetField();
  integrate(inSeeds, 9);
  integrate(ambSeeds, 26);
  finishField();`);

// 无歌词分支
t = t.replace(`    const ambN = RM ? 150 : 300;
    for (let i = 0; i < ambN; i++) seeds.push(rnd() * W, rnd() * H);
    integrate(seeds);
    return null;`, `    const ambN = RM ? 150 : 300;
    for (let i = 0; i < ambN; i++) seeds.push(rnd() * W, rnd() * H);
    resetField();
    integrate(seeds, 26);
    finishField();
    return null;`);

fs.writeFileSync(p, t);
console.log('ok', t.length);
