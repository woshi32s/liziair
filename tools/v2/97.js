/* ===== lizi97 · 瀑布 · waterfall —— PHYSICS =====
   水帘从上方倾泻下来，**字是水帘被"撕开"的那块留白**：字本身画实体（三档 + 暗影），
   周围是成条的竖向水线（速度拉伸）+ 底部溅起的水雾。命中时水帘被扯一下（横向震动）。 */

const F97 = 900;
const f97x = new Float32Array(F97), f97y = new Float32Array(F97);
const f97v = new Float32Array(F97), f97h = new Float32Array(F97), f97w = new Float32Array(F97);
let inited97 = 0, hit97 = 0;

function mechUpdate(dt, T) {
  if (!inited97) {
    inited97 = 1;
    for (let i = 0; i < F97; i++) {
      f97x[i] = rnd(-W * 0.42, W * 0.42);
      f97y[i] = rnd(-H, H);
      f97v[i] = rnd(760, 1400);
      f97h[i] = rnd(40, 190);
      f97w[i] = rnd(1.0, 2.6);
    }
  }
  if (hit97 > 0) hit97 = Math.max(0, hit97 - dt * 2.4);
  const boost = 1 + hit97 * 0.5;
  for (let i = 0; i < F97; i++) {
    f97y[i] += f97v[i] * boost * dt;
    f97x[i] += Math.sin(T * 1.4 + i) * 8 * dt;
    if (f97y[i] - f97h[i] > H * 0.62) {
      f97y[i] = -H * 0.6;
      f97x[i] = rnd(-W * 0.42, W * 0.42);
    }
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit97 = 1; vPulse = 1; camShake(0.5, 1, first ? 11 : 6); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  /* 水帘：竖向拉长的条（速度拉伸） */
  const cxS = W / 2, cyS = H * 0.46;
  ctx.globalAlpha = 0.30; ctx.fillStyle = 'rgb(90,180,220)';
  ctx.beginPath();
  for (let i = 0; i < F97; i++) {
    const px = cxS + f97x[i] * z, py = cyS + f97y[i] * z;
    ctx.rect(px - f97w[i], py - f97h[i] * z, f97w[i] * 2, f97h[i] * z);
  }
  ctx.fill();
  ctx.globalAlpha = 0.45; ctx.fillStyle = 'rgb(190,236,255)';
  ctx.beginPath();
  for (let i = 0; i < F97; i += 2) {
    const px = cxS + f97x[i] * z, py = cyS + f97y[i] * z;
    ctx.rect(px - f97w[i] * 0.6, py - f97h[i] * 0.75 * z, f97w[i] * 1.2, f97h[i] * 0.75 * z);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.20) * 0.16, pit = 0.07 * Math.sin(T * 0.16 + 0.8);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.26 * Math.sin(T * 1.15 - X1 / 270) + 0.28 * gl) + hit97 * 0.06;
  }
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0 * vss[i]; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.06; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.66) continue; const r = 5.0 * vss[i]; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  ctx.globalAlpha = 1;
}

