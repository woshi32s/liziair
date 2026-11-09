/* ===== lizi95 · 气泡柱 · bubble-column —— PHYSICS =====
   海底裂口不断冒气泡柱，气泡上升、摇摆，**被"字"挡住的那一批就贴在字位上**——
   于是字形是气泡堆出来的（还留着上浮的微动）。气泡画成"亮芯 + 暗环"两层，便宜又有体积。
   命中时裂口喷一股密集气泡（次级动作）。                                          */

const b95v = new Float32Array(VN), b95ph = new Float32Array(VN), b95sz = new Float32Array(VN);
const b95up = new Float32Array(VN);
let b95init = 0, b95hit = 0, b95burst = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(pc * 0.85)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    b95v[i] = 60 + Math.random() * 90;
    b95ph[i] = Math.random() * 6.28;
    b95sz[i] = 1.4 + Math.random() * 1.5;
    b95up[i] = -Math.random() * 900 - 200;      /* 初始在下方 */
    vx[i] = vtx[i] + rnd(-60, 60);
    vy[i] = vty[i];
    vz[i] = (Math.random() - 0.5) * 30;
  }
  vCore = 'rgb(226,250,255)';
  vMid = 'rgb(96,196,224)';
  vDim = 'rgb(18,58,78)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (b95hit > 0) b95hit = Math.max(0, b95hit - dt * 2.6);
  if (b95burst > 0) b95burst = Math.max(0, b95burst - dt * 1.4);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    if (gl > 0.06) {
      /* 到位：贴在字位上，留一点上浮 + 摇摆 */
      vx[i] += (vtx[i] + Math.sin(T * 2.1 + b95ph[i]) * 2.4 - vx[i]) * Math.min(1, dt * 6);
      vy[i] += (vty[i] + Math.cos(T * 2.7 + b95ph[i]) * 2.0 - vy[i]) * Math.min(1, dt * 6);
    } else {
      /* 还在上升：从下方冒上来，到顶部循环 */
      b95up[i] -= (b95v[i] * (1 + b95burst)) * dt;
      const yy = b95up[i];
      vy[i] += (yy - vy[i]) * Math.min(1, dt * 2.2);
      vx[i] += (vtx[i] * 0.5 + Math.sin(T * 1.6 + b95ph[i]) * 42 - vx[i]) * Math.min(1, dt * 0.9);
      if (vy[i] < -420) { b95up[i] = 0; vy[i] = 0; }
    }
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { b95hit = 1; b95burst = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.23) * 0.24, pit = 0.10 * Math.sin(T * 0.19 + 0.8);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const Z0 = vz[i];
    let X1 = vx[i] * cy + Z0 * sy, Z1 = -vx[i] * sy + Z0 * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 940 / (940 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s * b95sz[i];
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.16 + 0.80 * clamp01(gl * 1.2)) + b95hit * 0.1;
  }
  /* 气泡暗环 */
  ctx.globalAlpha = 0.72; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 2.9 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 气泡体 */
  ctx.globalAlpha = 0.5; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 1.9 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 亮芯（偏左上，像折射高光） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 0.9 * vss[i];
    ctx.rect(vsx[i] - r - 1.1 * vss[i], vsy[i] - r - 1.1 * vss[i], r * 2, r * 2);
  }
  ctx.fill();
  /* 裂口辉光 */
  ctx.globalAlpha = 0.09 + b95burst * 0.08;
  ctx.drawImage(vLightCv, W * 0.5 - 700, H * 0.92 - 500, 1400, 1000);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
