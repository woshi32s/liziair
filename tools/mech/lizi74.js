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

/* ===== lizi74 · 雨幕折射 · rain-glass —— PHYSICS =====
   雨夜玻璃：外面在下雨，玻璃上挂着水珠，**字是从水珠后面透出来的那一层**——
   字用实体层画（三档 + 暗影 + 光晕），水珠和雨丝在前景，比字更亮更虚，
   再加一层冷色玻璃反光斜条，把"隔着一层玻璃"的空间拉开。命中时雨突然变密。 */

const R74 = 240;
const r74x = new Float32Array(R74), r74y = new Float32Array(R74);
const r74v = new Float32Array(R74), r74r = new Float32Array(R74), r74h = new Float32Array(R74);
const d74x = new Float32Array(90), d74y = new Float32Array(90), d74r = new Float32Array(90);
let inited74 = 0, hit74 = 0;

function mechUpdate(dt, T) {
  if (!inited74) {
    inited74 = 1;
    for (let i = 0; i < R74; i++) {
      r74x[i] = rnd(-W * 0.52, W * 0.52); r74y[i] = rnd(-H * 0.55, H * 0.55);
      r74v[i] = rnd(150, 420); r74r[i] = rnd(0.7, 1.5); r74h[i] = rnd(14, 46);
    }
    for (let i = 0; i < 90; i++) {
      d74x[i] = rnd(-W * 0.45, W * 0.45); d74y[i] = rnd(-H * 0.42, H * 0.42); d74r[i] = rnd(2.2, 6.5);
    }
  }
  if (hit74 > 0) hit74 = Math.max(0, hit74 - dt * 2.0);
  for (let i = 0; i < R74; i++) {
    r74y[i] += r74v[i] * (1 + hit74 * 1.2) * dt;
    if (r74y[i] > H * 0.56) { r74y[i] = -H * 0.56; r74x[i] = rnd(-W * 0.52, W * 0.52); }
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit74 = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = W / 2, cy = H * 0.47;

  /* 玻璃冷反光斜条 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = 'rgb(150,200,255)';
  ctx.beginPath();
  ctx.moveTo(cx - 700, cy + 260); ctx.lineTo(cx - 520, cy + 260);
  ctx.lineTo(cx + 260, cy - 320); ctx.lineTo(cx + 80, cy - 320);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  /* 雨丝 */
  ctx.globalAlpha = 0.26; ctx.fillStyle = 'rgb(170,205,240)';
  ctx.beginPath();
  for (let i = 0; i < R74; i++) {
    ctx.rect(cx + r74x[i] - r74r[i], cy + r74y[i] - r74h[i], r74r[i] * 2, r74h[i]);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.18) * 0.14, pit = 0.06 * Math.sin(T * 0.15 + 0.7);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.68 + 0.16 * Math.sin(T * 1.0 - X1 / 280) + 0.26 * gl) + hit74 * 0.05;
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

  /* 水珠（前景，比字亮）：暗环 + 亮芯 + 高光点 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgb(120,170,220)';
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const rr = d74r[i] * z;
    ctx.rect(cx + d74x[i] * z - rr, cy + d74y[i] * z - rr, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgb(226,244,255)';
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const rr = d74r[i] * 0.42 * z;
    ctx.rect(cx + d74x[i] * z - rr - 1.5, cy + d74y[i] * z - rr - 1.5, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




