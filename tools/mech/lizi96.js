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

/* ===== lizi96 · 雪崩 · avalanche —— PHYSICS =====
   雪檐断裂，雪流从右上冲下来，**堆在字位上**：字是实体（三档 + 暗影），
   前景是一整片向下冲的雪粒（带风偏），命中时雪流加速 + 定向震动。                      */

const A96 = 2600;
const a96x = new Float32Array(A96), a96y = new Float32Array(A96);
const a96vx = new Float32Array(A96), a96vy = new Float32Array(A96);
const a96r = new Float32Array(A96), a96p = new Float32Array(A96);
let inited96 = 0, hit96 = 0, rush96 = 0;

function a96spawn(i, top) {
  a96x[i] = rnd(-260, W * 0.95);
  a96y[i] = top ? rnd(-H * 0.6, -10) : rnd(-H * 0.1, H);
  a96r[i] = rnd(1.0, 2.4);
  a96p[i] = rnd(0, 6.28);
}

function mechUpdate(dt, T) {
  if (!inited96) { inited96 = 1; for (let i = 0; i < A96; i++) a96spawn(i, false); }
  if (hit96 > 0) hit96 = Math.max(0, hit96 - dt * 2.2);
  rush96 = Math.max(rush96 * 0.94, hit96);
  const wind = 260 + rush96 * 420, fall = 520 + rush96 * 700;
  for (let i = 0; i < A96; i++) {
    a96x[i] += (wind + Math.sin(T * 2.4 + a96p[i]) * 60) * dt;
    a96y[i] += fall * dt * (0.7 + 0.6 * Math.sin(a96p[i]));
    if (a96y[i] > H + 40 || a96x[i] > W + 60) a96spawn(i, true);
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit96 = 1; vPulse = 1; camShake(1, 0.5, first ? 13 : 7); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  /* 雪流背景（先画，暗层） */
  ctx.globalAlpha = 0.30; ctx.fillStyle = 'rgb(150,180,215)';
  ctx.beginPath();
  for (let i = 0; i < A96; i++) {
    const rr = a96r[i];
    ctx.rect(a96x[i] - rr, a96y[i] - rr, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.55; ctx.fillStyle = 'rgb(226,240,255)';
  ctx.beginPath();
  for (let i = 0; i < A96; i += 2) {
    const rr = a96r[i] * 0.8;
    ctx.rect(a96x[i] - rr, a96y[i] - rr, rr * 2, rr * 2);
  }
  ctx.fill();

  /* 实体字 */
  const yaw = Math.sin(T * 0.22) * 0.18, pit = 0.08 * Math.sin(T * 0.18 + 0.5);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.64 + 0.20 * Math.sin(T * 1.1 - X1 / 250) + 0.30 * gl) + hit96 * 0.06;
  }
  ctx.globalAlpha = 0.38; ctx.fillStyle = '#000';
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




