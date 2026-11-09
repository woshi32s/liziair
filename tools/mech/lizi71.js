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

/* ===== lizi71 · 行星环 · ringed —— PHYSICS =====
   中间一颗暗行星 + 三道细环，环里成千上万颗粒子公转；**字是环面上被"推开"的密集带**——
   为了可读，字本身用实体层画在环前面（三档 + 暗影），环只做外圈装饰与密度波。
   镜头缓慢环绕 + 环面倾角变化。                                                  */

const RN71 = 2600;
const r71a = new Float32Array(RN71), r71r = new Float32Array(RN71);
const r71s = new Float32Array(RN71), r71t = new Float32Array(RN71);
let inited71 = 0, hit71 = 0;

function mechResize71() {
  if (!W || !H) return;
  for (let i = 0; i < RN71; i++) {
    r71a[i] = Math.random() * 6.2832;
    r71r[i] = 0.72 + Math.random() * 0.42;
    r71s[i] = 0.05 + Math.random() * 0.09;
    r71t[i] = Math.random() * 6.2832;
  }
  inited71 = 1;
}

function mechUpdate(dt, T) {
  if (!inited71) mechResize71();
  if (hit71 > 0) hit71 = Math.max(0, hit71 - dt * 2.4);
  for (let i = 0; i < RN71; i++) {
    r71a[i] += r71s[i] * dt * (1.6 - r71r[i]);
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit71 = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!inited71) mechResize71();
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const R = 420 * z;
  const tilt = 0.42 + 0.06 * Math.sin(T * 0.20), roll = Math.sin(T * 0.13) * 0.08;
  const ct = Math.cos(tilt), cr = Math.cos(roll), sr = Math.sin(roll);

  /* 行星剪影 */
  ctx.globalAlpha = 0.95; ctx.fillStyle = '#04060b';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.30, 0, 6.2832);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = 'rgba(240,214,170,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.30, 0, 6.2832);
  ctx.stroke();

  /* 环粒子（三层亮度） */
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.30, 0.55, 0.85][band];
    ctx.fillStyle = [vDim, vMid, vCore][band];
    ctx.beginPath();
    let any = 0;
    for (let i = band; i < RN71; i += 3) {
      const rad = R * r71r[i];
      const x0 = Math.cos(r71a[i]) * rad, y0 = Math.sin(r71a[i]) * rad * ct;
      const X = x0 * cr - y0 * sr, Y = x0 * sr + y0 * cr;
      const px = cx + X, py = cy + Y;
      const rr = (0.9 + 1.2 * Math.abs(Math.sin(r71t[i] + T))) * z;
      ctx.rect(px - rr, py - rr, rr * 2, rr * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* 实体字（叠在环上，保证整句可读） */
  if (!vn) return;
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + vx[i], blockGy + vy[i]);
    vsy[i] = pjY(blockGx + vx[i], blockGy + vy[i]);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.05 - vx[i] / 280) + 0.28 * gl) + hit71 * 0.06;
  }
  ctx.globalAlpha = 0.36; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.06; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.66) continue; const r = 5.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  ctx.globalAlpha = 1;
}




