/* ===== lizi65 · 粒子折纸 · origami —— PHYSICS =====
   字形被切成一片片三角形"纸面"，每片从随机翻折角度转平（绕自身中心），
   翻平的过程中边缘有 1px 亮边（纸的折痕）；全部翻平后整句可读。
   命中时新一轮折痕从中心扩散（抽帧 + 冲击）。                                  */

const TRI65 = 3;
let o65init = 0, o65hit = 0, o65seed = 0;
const o65ang = new Float32Array(VN), o65ph = new Float32Array(VN), o65cx = new Float32Array(VN), o65cy = new Float32Array(VN);
const o65t = new Float32Array(VN);

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(pc * 0.9)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    /* 三角形分组：每 3 颗一片，中心取它们的目标点均值 */
    const grp = (i / TRI65) | 0;
    o65ph[i] = grp * 0.37;
    o65ang[i] = (Math.random() * 2 - 1) * 2.6;
    o65t[i] = 0;
    vz[i] = (Math.random() - 0.5) * 40;
    vx[i] = vtx[i] + Math.sin(o65ph[i]) * 200;
    vy[i] = vty[i] + Math.cos(o65ph[i]) * 160;
  }
  /* 每片纸的中心 */
  for (let i = 0; i < vn; i++) {
    const i0 = i - (i % TRI65);
    let sx = 0, sy = 0, n = 0;
    for (let k = 0; k < TRI65 && i0 + k < vn; k++) { sx += vtx[i0 + k]; sy += vty[i0 + k]; n++; }
    o65cx[i] = sx / Math.max(1, n); o65cy[i] = sy / Math.max(1, n);
  }
  vCore = 'rgb(250,250,255)';
  vMid = 'rgb(214,226,244)';
  vDim = 'rgb(96,110,134)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (o65hit > 0) o65hit = Math.max(0, o65hit - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    /* 翻平进度：唱到这个字就折过去 */
    const want = clamp01((T - lineT - (i % 9) * 0.035) / 0.85);
    o65t[i] += (want - o65t[i]) * Math.min(1, dt * 5.2);
    const a = o65ang[i] * (1 - o65t[i]);            /* 剩余翻折角 */
    const dx = vtx[i] - o65cx[i], dy = vty[i] - o65cy[i];
    const ca = Math.cos(a), sa = Math.sin(a);
    vx[i] = o65cx[i] + dx * ca - dy * sa * 0.55;
    vy[i] = o65cy[i] + dy * ca * 0.92 + dx * sa * 0.25;
    vz[i] = Math.sin(a) * 90;
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { o65hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.30) * 0.26, pit = 0.12 * Math.sin(T * 0.2 + 0.4);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.42 + 0.30 * o65t[i] + 0.28 * gl + 0.12 * Math.sin(T * 1.7 - X1 / 200)) + o65hit * 0.12;
  }
  /* 纸面：暗面打底（未翻平的部分更暗） */
  ctx.globalAlpha = 0.78; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 3.0 * vss[i];
    const off = (1 - o65t[i]) * 6;
    ctx.rect(vsx[i] - r + off, vsy[i] - r + off, r * 2, r * 2);
  }
  ctx.fill();
  /* 亮面 */
  ctx.globalAlpha = 0.92; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.34) continue;
    const r = 2.7 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 折痕高光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.66) continue;
    const r = 1.4 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

