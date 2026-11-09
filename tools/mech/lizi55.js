/* ============================================================
   v2 起手模板（lizi51-100 重做用）· rev4
   用法：整段拷到你 tools/mech/liziNN.js 的顶部，把 PHYSICS 段改成本形态的机制。
   变量全部 v 前缀，避免和 lizi-base.js 的 cam/L/ctx/spans 撞名。
   只允许在 mechResize / mechAssign / mechUpdate / mechDraw / mechEvent 里活动。

   这一版给了：实心三档笔画 + 暗影厚度 + 光晕 + 扫光 + 3D 环绕 + 逐字点亮。
   改机制时：只动 mechUpdate（运动学）和 mechDraw 里粒子的组织方式；
   下面的 vBands / 暗影 / 光晕 / 扫光 不要删，那就是「有厚度有打光」的来源。
   ============================================================ */

const VN = 8000;                                   /* 2000~9000 */
const vx = new Float32Array(VN), vy = new Float32Array(VN);
const vz = new Float32Array(VN), vsc = new Float32Array(VN);
const vtx = new Float32Array(VN), vty = new Float32Array(VN);
const von = new Int16Array(VN);
const vlum = new Float32Array(VN);
const vsx = new Float32Array(VN), vsy = new Float32Array(VN), vss = new Float32Array(VN);
let vn = 0, vYaw = 0, vPit = 0, vPulse = 0, vLightCv = null;
let vCore = 'rgb(240,244,252)', vMid = 'rgb(180,205,245)', vDim = 'rgb(70,90,120)';

function mechResize() {
  /* 扫光贴图：径向柔光，没有硬边；每帧只 blit 一次 */
  vLightCv = document.createElement('canvas');
  vLightCv.width = 512; vLightCv.height = 512;
  const g = vLightCv.getContext('2d');
  const gr = g.createRadialGradient(256, 256, 10, 256, 256, 250);
  gr.addColorStop(0, 'rgba(255,255,255,0.60)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  vn = 0;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(3200, Math.round(pc * 1.05)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 26;
    vsc[i] = 1;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  const a = accent || [186, 206, 255];
  vCore = `rgb(${Math.min(255, 205 + a[0] * 0.20) | 0},${Math.min(255, 212 + a[1] * 0.17) | 0},${Math.min(255, 226 + a[2] * 0.11) | 0})`;
  vMid = `rgb(${(120 + a[0] * 0.55) | 0},${(150 + a[1] * 0.42) | 0},${Math.min(255, 170 + a[2] * 0.32) | 0})`;
  vDim = `rgb(${(66 + a[0] * 0.30) | 0},${(84 + a[1] * 0.26) | 0},${(110 + a[2] * 0.22) | 0})`;
  vPulse = 1;
}

function vBands(rBase) {
  const lo = [0.56, 0.26, -1], al = [1.0, 0.80, 0.58], kk = [1.0, 0.90, 0.76];
  const cols = [vCore, vMid, vDim];
  for (let b = 0; b < 3; b++) {
    const hi = b === 0 ? 1.01 : lo[b - 1];
    ctx.globalAlpha = al[b];
    ctx.fillStyle = cols[b];
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i++) {
      const l = vlum[i];
      if (l < lo[b] || l >= hi) continue;
      const rr = rBase * kk[b] * vss[i];
      ctx.rect(vsx[i] - rr, vsy[i] - rr, rr * 2, rr * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ===== lizi55 · 陨石雨 · meteor —— PHYSICS =====
   字是**实体**（三档 + 暗影 + 光晕，保证整句可读），陨石与火花只做前景：
   燃烧的碎石从上方斜砸下来，带速度拖尾，落点炸出一圈白热火星。
   命中时冲击（震动 + 白闪由 base 负责）。                                          */

const M55 = 320;
const m55x = new Float32Array(M55), m55y = new Float32Array(M55);
const m55vx = new Float32Array(M55), m55vy = new Float32Array(M55);
const m55l = new Float32Array(M55), m55r = new Float32Array(M55);
let hit55 = 0, inited55 = 0;

function m55spawn(i) {
  m55x[i] = rnd(-140, W * 0.92);
  m55y[i] = rnd(-H * 0.5, -40);
  const sp = rnd(520, 920), ang = rnd(0.72, 1.05);
  m55vx[i] = Math.cos(ang) * sp;
  m55vy[i] = Math.sin(ang) * sp;
  m55l[i] = rnd(0.5, 1.4);
  m55r[i] = rnd(1.1, 2.4);
}

function mechUpdate(dt, T) {
  if (!inited55) { inited55 = 1; for (let i = 0; i < M55; i++) m55spawn(i); }
  if (hit55 > 0) hit55 = Math.max(0, hit55 - dt * 2.4);
  for (let i = 0; i < M55; i++) {
    m55l[i] -= dt;
    if (m55l[i] <= 0) { m55spawn(i); continue; }
    m55vy[i] += 620 * dt;
    m55x[i] += m55vx[i] * dt;
    m55y[i] += m55vy[i] * dt;
    if (m55y[i] > H * 0.95 || m55x[i] > W + 80) m55spawn(i);
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 10);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 10);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit55 = 1; vPulse = 1; camShake(0.9, 0.6, first ? 14 : 8); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.24) * 0.20, pit = 0.09 * Math.sin(T * 0.19 + 0.6);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);

  /* ---- 1) 实体字 ---- */
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.64 + 0.20 * Math.sin(T * 1.1 - X1 / 260) + 0.30 * gl) + hit55 * 0.06;
  }
  ctx.globalAlpha = 0.34; ctx.fillStyle = '#000';
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

  /* ---- 2) 陨石拖尾 + 白热头 ---- */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgb(255,136,58)';
  ctx.beginPath();
  for (let i = 0; i < M55; i++) {
    const px = pjX(blockGx + m55x[i] - W / 2, blockGy + m55y[i] - H * 0.46);
    const py = pjY(blockGx + m55x[i] - W / 2, blockGy + m55y[i] - H * 0.46);
    const tx = m55vx[i] * 0.030, ty = m55vy[i] * 0.030;
    for (let k = 1; k <= 5; k++) {
      const f = k / 5, rr = m55r[i] * (1 - f * 0.62);
      ctx.rect(px - tx * f - rr, py - ty * f - rr, rr * 2, rr * 2);
    }
  }
  ctx.fill();
  ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgb(255,246,224)';
  ctx.beginPath();
  for (let i = 0; i < M55; i++) {
    const px = pjX(blockGx + m55x[i] - W / 2, blockGy + m55y[i] - H * 0.46);
    const py = pjY(blockGx + m55x[i] - W / 2, blockGy + m55y[i] - H * 0.46);
    const rr = m55r[i] * 0.8;
    ctx.rect(px - rr, py - rr, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




