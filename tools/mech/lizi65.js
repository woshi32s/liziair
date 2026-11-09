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
    const want = clamp01((gl - 0.02) * 2.4);
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
    vlum[i] = clamp01(0.20 + 0.70 * o65t[i] * (0.6 + 0.4 * gl) + 0.16 * Math.sin(T * 1.7 - X1 / 200)) + o65hit * 0.12;
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



