/* lizi47 · 湍流静区 · curl-calm
   满屏 curl noise 湍流，粒子被卷着到处跑；只有**字的位置是一块静区** ——
   粒子一进那片区域就被"冻住"，湍流在字的周围绕过。字 = 湍流里的静止岛。
   AE：多层级视差（三层不同速度的流）+ 缓推 + 顿帧。 */

const N47 = 5600;
const fx47 = new Float32Array(N47), fy47 = new Float32Array(N47);
const ftx47 = new Float32Array(N47), fty47 = new Float32Array(N47);
const fat47 = new Float32Array(N47), fown47 = new Int16Array(N47);
const fsz47 = new Float32Array(N47), fdep47 = new Float32Array(N47);
const fcap47 = new Uint8Array(N47);
let n47 = 0, calm47 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N47; i++) {
    fx47[i] = Math.random() * W; fy47[i] = Math.random() * H;
    fsz47[i] = 1 + Math.random() * 1.6;
    fdep47[i] = 0.4 + Math.random() * 0.8;
    fcap47[i] = 0;
  }
  n47 = N47;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n47 = Math.max(2200, Math.min(N47, Math.round(pc * 1.5)));
  for (let i = 0; i < n47; i++) {
    const pi = ((i * pc / n47) | 0) % pc;
    ftx47[i] = blockGx + g.px[pi] + rnd(-1, 1);
    fty47[i] = blockGy + g.py[pi] + rnd(-1, 1);
    fown47[i] = g.own[pi];
    fat47[i] = use.at[g.own[pi]] || use.lineT;
    fcap47[i] = 0;
  }
}

function mechEvent(k, first) {
  calm47 = first ? 1.7 : 1;
  cam.ox = (k % 2 ? -1 : 1) * (first ? 28 : 15);
  cam.oy = -5;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  calm47 *= Math.pow(0.05, dt);
  cam.ox *= Math.pow(0.03, dt);
  cam.oy *= Math.pow(0.04, dt);
  const t = T * 0.7;
  for (let i = 0; i < n47; i++) {
    if (fcap47[i]) continue;
    if (T < fat47[i] - 0.5) {
      /* curl noise：势函数的旋度（保证无散，看起来才像流体） */
      const s = 0.0055 * fdep47[i], a = 42 * fdep47[i] * (1 + calm47 * 0.4);
      const vx = Math.cos(fy47[i] * s + t * 1.3) * a + Math.sin((fx47[i] + fy47[i]) * s * 0.7 - t) * a * 0.5;
      const vy = -Math.sin(fx47[i] * s + t * 1.1) * a + Math.cos((fx47[i] - fy47[i]) * s * 0.6 + t) * a * 0.5;
      fx47[i] += vx * dt; fy47[i] += vy * dt;
      if (fx47[i] < -20) fx47[i] = W + 20; if (fx47[i] > W + 20) fx47[i] = -20;
      if (fy47[i] < -20) fy47[i] = H + 20; if (fy47[i] > H + 20) fy47[i] = -20;
      continue;
    }
    /* 轮到：被卷进静区，硬弹簧 + 近目标强阻尼 */
    const dx = ftx47[i] - fx47[i], dy = fty47[i] - fy47[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    if (d < 3.2) { fcap47[i] = 1; fx47[i] = ftx47[i]; fy47[i] = fty47[i]; continue; }
    const kk = near ? 24 : 7;
    const vx = fx47[i] * 0 + dx * kk * dt * 60;
    const vy = dy * kk * dt * 60;
    /* 用指数逼近，省掉速度数组 */
    const k = Math.min(1, dt * (near ? 7.5 : 2.2));
    fx47[i] += (dx) * k;
    fy47[i] += (dy) * k;
    if (T > fat47[i] + 1.5) { fcap47[i] = 1; fx47[i] = ftx47[i]; fy47[i] = fty47[i]; }
    void vx; void vy;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 流线：三层视差，用短条表示流向（不做逐点积分） */
  ctx.fillStyle = 'rgba(120,160,200,0.10)';
  ctx.beginPath();
  for (let i = 0; i < n47; i += 3) {
    if (fcap47[i] || T < fat47[i] - 0.5) continue;
    const s = 0.0055 * fdep47[i];
    const vx = Math.cos(fy47[i] * s + T * 0.9) * 26;
    const vy = -Math.sin(fx47[i] * s + T * 0.8) * 26;
    const px = pjX(fx47[i], fy47[i]), py = pjY(fx47[i], fy47[i]);
    if (px < -16 || px > W + 16 || py < -16 || py > H + 16) continue;
    ctx.rect(px - vx * 0.35, py - vy * 0.35, Math.abs(vx) * 0.7 + 1.2, Math.abs(vy) * 0.7 + 1.2);
  }
  ctx.fill();

  /* 被冻住的字：两档 */
  if (L) {
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0
        ? 'rgba(90,130,170,0.30)'
        : `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 50)},${Math.min(255, ab + 50)},0.95)`;
      ctx.beginPath();
      for (let i = 0; i < n47; i++) {
        if (!fcap47[i]) continue;
        const px = pjX(fx47[i], fy47[i]), py = pjY(fx47[i], fy47[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = fsz47[i] * (pass ? 1.7 : 2.4) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }
}
