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
    const want = clamp01((gl - 0.04) * 2.2);
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
    vlum[i] = clamp01(0.15 + 0.78 * s70p[i]);
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



