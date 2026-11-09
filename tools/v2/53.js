/* ===== lizi53 · 万花筒 · kaleidoscope —— PHYSICS =====
   中央是**正着写的字**（保证整句可读），外圈六重镜像成花瓣状幽灵，绕中心缓慢旋转、逐瓣呼吸。
   镜片缓慢转动 → 花瓣像被万花筒折过去；命中时整朵花收一下再散开。
   这样既保留"万花筒"的镜像气质，又不会像旧版那样把字叠成花、读不出来。      */

let k53rot = 0, k53zoom = 1, k53hit = 0;

function mechAssign(use) {                  /* 覆盖核心：镜像要 6 份，粒子降一半 */
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2000, Math.round(pc * 0.48)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 18;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  const a = accent || [186, 206, 255];
  vCore = 'rgb(244,248,255)';
  vMid = `rgb(${(140 + a[0] * 0.30) | 0},${(170 + a[1] * 0.24) | 0},${Math.min(255, 200 + a[2] * 0.18) | 0})`;
  vDim = `rgb(${(40 + a[0] * 0.30) | 0},${(52 + a[1] * 0.26) | 0},${(82 + a[2] * 0.22) | 0})`;
  vPulse = 1;
}

function mechUpdate(dt, T) {
  k53rot += dt * 0.22;
  k53zoom += ((1 + 0.035 * Math.sin(T * 0.55)) - k53zoom) * Math.min(1, dt * 3);
  if (k53hit > 0) k53hit = Math.max(0, k53hit - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { k53hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cxD = blockGx, cyD = blockGy;
  const roll = Math.sin(T * 0.19) * 0.05;
  const cr = Math.cos(roll), sr = Math.sin(roll);

  /* ---------- 1) 六重镜像幽灵（外圈，先画、压暗） ---------- */
  const spread = 2.25 * k53zoom * (1 + k53hit * 0.10);
  for (let m = 0; m < 6; m++) {
    const ang = k53rot + m * Math.PI / 3;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pulse = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(T * 1.1 - m * 1.05));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = m % 2 ? vMid : vDim;
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i += 3) {                 /* 隔三点采样，省 overdraw */
      const bx = vx[i] * spread, by = vy[i] * spread;
      const X = bx * ca - by * sa, Y = bx * sa + by * ca;
      const px = pjX(cxD + X * cr - Y * sr, cyD + X * sr + Y * cr);
      const py = pjY(cxD + X * cr - Y * sr, cyD + X * sr + Y * cr);
      const r = 2.2;
      ctx.rect(px - r, py - r, r * 2, r * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* ---------- 2) 中央正字（可读的那份） ---------- */
  for (let i = 0; i < vn; i++) {
    const X = vx[i] * k53zoom, Y = vy[i] * k53zoom;
    vsx[i] = pjX(cxD + X * cr - Y * sr, cyD + X * sr + Y * cr);
    vsy[i] = pjY(cxD + X * cr - Y * sr, cyD + X * sr + Y * cr);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    const lit = 0.60 + 0.20 * Math.sin(T * 1.25 - X / 240) + 0.16 * gl + k53hit * 0.18;
    vlum[i] = clamp01(lit) + vPulse * 0.12;
  }
  ctx.globalAlpha = 0.30; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.07; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.52) continue;
    const r = 5.0;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  /* 中心柔光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.07 + k53hit * 0.06;
  ctx.drawImage(vLightCv, W * 0.5 - 620, H * 0.5 - 620, 1240, 1240);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}


