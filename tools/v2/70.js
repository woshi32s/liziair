/* ===== lizi70 · 玻璃破碎 · shatter —— PHYSICS =====
   一块玻璃被打碎，**碎片先在空间里翻飞，然后落回原位拼成字**。
   每 ~40 颗粒子组成一枚碎片：碎片有爆散方向 + 翻转角，随"唱到这个字"逐步收拢、转平。
   碎片暗面 + 亮边（玻璃棱），收拢完成的碎片边缘发白。命中时再崩出一圈碎屑。          */

const SH70 = 40;
const s70dx = new Float32Array(VN), s70dy = new Float32Array(VN), s70rot = new Float32Array(VN);
const s70p = new Float32Array(VN), s70cx = new Float32Array(VN), s70cy = new Float32Array(VN);
let s70hit = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2800, Math.round(pc * 0.95)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 24;
    vx[i] = vtx[i]; vy[i] = vty[i];
    s70p[i] = 0;
  }
  /* 碎片：每 40 颗一组 */
  for (let s = 0; s * SH70 < vn; s++) {
    const i0 = s * SH70, i1 = Math.min(vn, i0 + SH70);
    let cx = 0, cy = 0, n = 0;
    for (let i = i0; i < i1; i++) { cx += vtx[i]; cy += vty[i]; n++; }
    cx /= Math.max(1, n); cy /= Math.max(1, n);
    const dir = Math.atan2(cy, cx) + (Math.random() - 0.5) * 0.8;
    const dist = 240 + Math.random() * 520;
    const dx = Math.cos(dir) * dist, dy = Math.sin(dir) * dist;
    const rot = (Math.random() - 0.5) * 2.2;
    for (let i = i0; i < i1; i++) { s70dx[i] = dx; s70dy[i] = dy; s70rot[i] = rot; s70cx[i] = cx; s70cy[i] = cy; }
  }
  vCore = 'rgb(250,252,255)';
  vMid = 'rgb(176,214,240)';
  vDim = 'rgb(52,74,96)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (s70hit > 0) s70hit = Math.max(0, s70hit - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const want = clamp01((T - lineT - 0.05) / 1.0);
    s70p[i] += (want - s70p[i]) * Math.min(1, dt * 3.6);
    const k = 1 - s70p[i];
    const a = s70rot[i] * k;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = vtx[i] - s70cx[i], dy = vty[i] - s70cy[i];
    const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
    vx[i] = s70cx[i] + rx + s70dx[i] * k * k;
    vy[i] = s70cy[i] + ry + s70dy[i] * k * k;
    vz[i] = -k * 180 + Math.sin(T * 1.4 + i * 0.03) * 3;
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { s70hit = 1; vPulse = 1; if (first) camShake(1, 0.6, 13); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.28) * 0.30, pit = 0.11 * Math.sin(T * 0.2 + 0.9);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z1 * 0.6);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    vlum[i] = clamp01(0.40 + 0.34 * s70p[i] + 0.24 * gl);
  }
  /* 玻璃暗面 */
  ctx.globalAlpha = 0.8; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 3.2 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 半透明玻璃体 */
  ctx.globalAlpha = 0.55; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.4) continue;
    const r = 2.2 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 棱边高光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.78) continue;
    const r = 1.2 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

