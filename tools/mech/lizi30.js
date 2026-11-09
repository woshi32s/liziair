/* lizi30 · 纸屑爆破 · confetti
   一张写满字的纸被炸成碎片：每个碎片先被冲击波掀飞、在空中翻面，
   再被"吸"回字位拼成字。字 = 一片片纸屑翻正之后的集合。
   AE：缓急变速（炸开用 ease-out，回收用 ease-in）+ 形变残影（翻面的透视压扁）。 */

const N30 = 4200;
const fx30 = new Float32Array(N30), fy30 = new Float32Array(N30);
const fvx30 = new Float32Array(N30), fvy30 = new Float32Array(N30);
const ftx30 = new Float32Array(N30), fty30 = new Float32Array(N30);
const fown30 = new Int16Array(N30), fat30 = new Float32Array(N30);
const fang30 = new Float32Array(N30), fspin30 = new Float32Array(N30);
const fsz30 = new Float32Array(N30), ft30 = new Uint8Array(N30);
let n30 = 0, burst30 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N30; i++) {
    fx30[i] = Math.random() * W; fy30[i] = Math.random() * H;
    fvx30[i] = 0; fvy30[i] = 0; fang30[i] = Math.random() * 6.283;
    fsz30[i] = 2.2 + Math.random() * 2.6;
    ft30[i] = 0;
  }
  n30 = N30;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n30 = Math.max(1800, Math.min(N30, pc));
  burst30 = 1;
  for (let i = 0; i < n30; i++) {
    const pi = ((i * pc / n30) | 0) % pc;
    ftx30[i] = blockGx + g.px[pi] + rnd(-1.4, 1.4);
    fty30[i] = blockGy + g.py[pi] + rnd(-1.4, 1.4);
    fown30[i] = g.own[pi];
    fat30[i] = use.at[g.own[pi]] || use.lineT;
    fspin30[i] = rnd(-9, 9);
    ft30[i] = 0;
    /* 从纸面中心被炸出去 */
    const dx = ftx30[i] - W / 2, dy = fty30[i] - H * 0.45;
    const l = Math.hypot(dx, dy) || 1;
    fx30[i] = W / 2 + dx * 0.15 + rnd(-30, 30);
    fy30[i] = H * 0.45 + dy * 0.15 + rnd(-30, 30);
    fvx30[i] = dx / l * rnd(300, 900) + rnd(-160, 160);
    fvy30[i] = dy / l * rnd(300, 900) + rnd(-260, 60);
  }
}

function mechEvent(k, first) {
  burst30 = 1;
  cam.ox = (k % 2 ? -1 : 1) * (first ? 46 : 22);
  cam.oy = -8;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  burst30 *= Math.pow(0.01, dt);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.03, dt);
  for (let i = 0; i < n30; i++) {
    const ready = T >= fat30[i] - 0.3;
    if (!ready) {
      /* 被炸飞：空气阻力 + 重力 */
      fvx30[i] *= Math.pow(0.22, dt);
      fvy30[i] += 320 * dt;
      fx30[i] += fvx30[i] * dt; fy30[i] += fvy30[i] * dt;
      fang30[i] += fspin30[i] * dt;
      continue;
    }
    if (ft30[i]) continue;
    /* 回收：硬弹簧 + 强阻尼 + 上限，纸屑翻正后停住 */
    const dx = ftx30[i] - fx30[i], dy = fty30[i] - fy30[i];
    const d = Math.hypot(dx, dy);
    const near = d < 90;
    const kk = near ? 32 : 9;
    fvx30[i] += dx * kk * dt - fvx30[i] * (near ? 9.5 : 2.4) * dt;
    fvy30[i] += dy * kk * dt - fvy30[i] * (near ? 9.5 : 2.4) * dt;
    const sp = Math.hypot(fvx30[i], fvy30[i]);
    if (sp > 900) { const s = 900 / sp; fvx30[i] *= s; fvy30[i] *= s; }
    fx30[i] += fvx30[i] * dt; fy30[i] += fvy30[i] * dt;
    fang30[i] += fspin30[i] * dt * Math.min(1, d / 60);
    if ((d < 2.2 && sp < 120) || T > fat30[i] + 1.5) {
      ft30[i] = 1; fx30[i] = ftx30[i]; fy30[i] = fty30[i]; fang30[i] = 0;
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 三档纸色：亮纸 / 主色 / 背光面 */
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(246,244,236,0.95)'
      : pass === 1
        ? `rgba(${Math.min(255, ar + 10)},${Math.min(255, ag + 6)},${Math.min(255, ab)},0.9)`
        : `rgba(${Math.max(0, ar - 70)},${Math.max(0, ag - 66)},${Math.max(0, ab - 44)},0.8)`;
    ctx.beginPath();
    for (let i = 0; i < n30; i++) {
      if (!L && ft30[i]) continue;
      const px = pjX(fx30[i], fy30[i]), py = pjY(fx30[i], fy30[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      /* 翻面：|cos| 就是纸片在屏幕上的投影宽度 */
      const cw = Math.abs(Math.cos(fang30[i]));
      const w = fsz30[i] * Math.max(0.18, cw) * z;
      const h = fsz30[i] * 1.15 * z;
      if (pass === 2 && cw > 0.45) continue;
      if (pass === 0 && fsz30[i] < 3.3) continue;
      if (pass === 1 && (fsz30[i] >= 3.3 || cw > 0.45)) continue;
      ctx.rect(px - w * 0.5, py - h * 0.5, w, h);
    }
    ctx.fill();
  }
}
