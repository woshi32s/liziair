/* lizi40 · 液滴飞溅 · splash
   一滴水砸在水面上，皇冠状的水珠溅起 —— 水珠在空中被字的位置"接住"，
   落成字形，再一颗颗落回水里。**字 = 悬在空中的那圈水珠**。
   AE：升格超慢镜（重力压到 0.25）+ 冲击帧 + 定向震动。 */

const N40 = 5000;
const dx40 = new Float32Array(N40), dy40 = new Float32Array(N40);
const dvx40 = new Float32Array(N40), dvy40 = new Float32Array(N40);
const dtx40 = new Float32Array(N40), dty40 = new Float32Array(N40);
const don40 = new Int16Array(N40), dat40 = new Float32Array(N40);
const dsz40 = new Float32Array(N40), dph40 = new Float32Array(N40);
const dfree40 = new Uint8Array(N40);
let n40 = 0, surf40 = 0, impact40 = 0;
const RIP40 = 4;
const rip40 = [];

function mechResize() {
  if (!W || !H) return;
  surf40 = H * 0.76;
  for (let i = 0; i < N40; i++) {
    dx40[i] = W / 2; dy40[i] = surf40;
    dvx40[i] = 0; dvy40[i] = 0;
    dsz40[i] = 1.2 + Math.random() * 1.8;
    dph40[i] = Math.random() * 6.283;
    dfree40[i] = 0;
  }
  n40 = N40;
  rip40.length = 0;
  for (let k = 0; k < RIP40; k++) rip40.push({ r: 0, a: 0 });
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n40 = Math.max(1800, Math.min(N40, Math.round(pc * 1.35)));
  impact40 = 1;
  for (let i = 0; i < n40; i++) {
    const pi = ((i * pc / n40) | 0) % pc;
    dtx40[i] = blockGx + g.px[pi] + rnd(-1.0, 1.0);
    dty40[i] = blockGy + g.py[pi] + rnd(-1.0, 1.0);
    don40[i] = g.own[pi];
    dat40[i] = use.at[g.own[pi]] || use.lineT;
    dfree40[i] = 0;
    dx40[i] = W / 2 + rnd(-30, 30); dy40[i] = surf40 - 4;
    dvx40[i] = 0; dvy40[i] = 0;
  }
}

function mechEvent(k, first) {
  impact40 = first ? 1.6 : 1;
  cam.oy = -8;
  cam.tz = Math.max(cam.tz, 1.02 + (first ? 0.03 : 0.015));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  impact40 *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  const g40 = 900 * 0.25;    /* 升格：重力压到 1/4 */
  for (let i = 0; i < n40; i++) {
    const age = T - dat40[i];
    if (age < 0) {
      dx40[i] = W / 2 + Math.cos(dph40[i]) * 20;
      dy40[i] = surf40;
      continue;
    }
    if (dfree40[i]) {
      dvy40[i] += g40 * dt;
      dx40[i] += dvx40[i] * dt; dy40[i] += dvy40[i] * dt;
      if (dy40[i] > surf40 + 6) {
        dfree40[i] = 0; dy40[i] = surf40 - 2;
        dvx40[i] = 0; dvy40[i] = 0;
      }
      continue;
    }
    if (age < 0.35) {
      /* 皇冠：先斜着溅出去 */
      const ud = dph40[i];
      dvy40[i] -= 260 * dt;
      dvx40[i] += Math.cos(ud) * 220 * dt;
      dx40[i] += dvx40[i] * dt; dy40[i] += dvy40[i] * dt;
      continue;
    }
    /* 被字接住：硬弹簧 + 强阻尼 */
    const ddx = dtx40[i] - dx40[i], ddy = dty40[i] - dy40[i];
    const d = Math.hypot(ddx, ddy);
    const near = d < 80;
    const kk = near ? 26 : 8;
    dvx40[i] += ddx * kk * dt - dvx40[i] * (near ? 9.2 : 2.2) * dt;
    dvy40[i] += ddy * kk * dt - dvy40[i] * (near ? 9.2 : 2.2) * dt;
    const sp = Math.hypot(dvx40[i], dvy40[i]);
    if (sp > 900) { const s = 900 / sp; dvx40[i] *= s; dvy40[i] *= s; }
    dx40[i] += dvx40[i] * dt; dy40[i] += dvy40[i] * dt;
  }
  /* 水面的涟漪环 */
  for (let k = 0; k < RIP40; k++) {
    const r = rip40[k];
    r.r += (120 + k * 40) * dt;
    r.a -= dt * 0.6;
    if (r.r > W * 0.6) { r.r = 0; r.a = 1; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 水面：一条渐变带 + 涟漪（用 rect 描环很贵，用几段短线近似） */
  ctx.fillStyle = 'rgba(8,22,30,0.55)';
  ctx.fillRect(0, pjY(0, surf40), W, H - pjY(0, surf40) + 2);
  ctx.strokeStyle = 'rgba(150,220,240,0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 0; k < RIP40; k++) {
    const r = rip40[k];
    if (r.a <= 0) continue;
    const cx = pjX(W / 2, surf40), cy = pjY(W / 2, surf40);
    const rx = r.r * z;
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, rx * 0.16, 0, 0, 6.2832);
  }
  ctx.stroke();

  /* 水珠：在空中的亮、落回水里的暗 */
  for (let pass = 0; pass < 2; pass++) {
    const air = pass === 1;
    ctx.fillStyle = air
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 54)},${Math.min(255, ab + 60)},0.95)`
      : 'rgba(90,150,170,0.35)';
    ctx.beginPath();
    for (let i = 0; i < n40; i++) {
      if (T < dat40[i]) continue;
      const px = pjX(dx40[i], dy40[i]), py = pjY(dx40[i], dy40[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const inAir = dy40[i] < surf40 - 8;
      if (inAir !== air) continue;
      const s = dsz40[i] * (air ? 1.6 : 1.1) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      if (air) ctx.rect(px - s * 0.2, py - s * 0.62, s * 0.34, s * 0.34);
    }
    ctx.fill();
  }
}
