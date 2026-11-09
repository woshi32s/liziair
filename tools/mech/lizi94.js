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

/* ===== lizi94 · 星座 · constellation —— PHYSICS =====
   三维空间里的星点先四散，唱到就各就各位；**星点之间连出星座的连线**——
   连线沿着字形笔画走，于是整句就是一张星座图。连线用细描边，星点带十字光芒。
   镜头缓慢环绕，连线随视差轻微错位（视差感）。                                    */

const K94 = 3;                                        /* 每个星点最多连 3 条 */
const n94a = new Int16Array(VN * K94).fill(-1), n94b = new Int16Array(VN * K94).fill(-1);
const n94d = new Float32Array(VN * K94);
let c94init = 0, c94hit = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(1700, Math.round(pc * 0.34)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 60;
    /* 未归位时散在四周 */
    vx[i] = vtx[i] * 2.4 + rnd(-260, 260);
    vy[i] = vty[i] * 2.2 + rnd(-200, 200);
  }
  /* 连线：找近邻（按字形点距离），只连同属一行/邻近的 */
  n94a.fill(-1); n94b.fill(-1);
  for (let i = 0; i < vn; i++) {
    let best1 = -1, best2 = -1, d1 = 1e9, d2 = 1e9;
    for (let j = Math.max(0, i - 26); j < Math.min(vn, i + 26); j++) {
      if (j === i) continue;
      const dx = vtx[j] - vtx[i], dy = vty[j] - vty[i];
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; best2 = best1; d1 = d; best1 = j; }
      else if (d < d2) { d2 = d; best2 = j; }
    }
    n94a[i * K94] = best1; n94b[i * K94] = best2;
    n94d[i * K94] = Math.sqrt(d1); n94d[i * K94 + 1] = Math.sqrt(d2);
  }
  vCore = 'rgb(255,252,238)';
  vMid = 'rgb(198,214,255)';
  vDim = 'rgb(52,64,104)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (c94hit > 0) c94hit = Math.max(0, c94hit - dt * 2.4);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const k = clamp01(gl * 1.25);
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * (2.2 + 8 * k));
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * (2.2 + 8 * k));
    vz[i] += ((Math.sin(T * 0.9 + i * 0.01) * 30) * (1 - k) - vz[i] * 0.4) * Math.min(1, dt * 1.6);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { c94hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.21) * 0.34, pit = 0.14 * Math.sin(T * 0.17 + 0.9);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const px = new Float32Array(0);  /* 占位，避免误用 */
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 940 / (940 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.22 + 0.72 * clamp01(gl * 1.3)) + c94hit * 0.12;
  }
  /* 连线 */
  ctx.strokeStyle = 'rgba(160,190,255,0.30)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.55) continue;
    for (let k = 0; k < 1; k++) {
      const j = n94a[i * K94 + k];
      if (j < 0 || j >= vn) continue;
      if (vlum[j] < 0.42) continue;
      ctx.moveTo(vsx[i], vsy[i]);
      ctx.lineTo(vsx[j], vsy[j]);
    }
  }
  ctx.stroke();
  /* 星点 */
  ctx.globalAlpha = 0.85; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 2.4 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.9; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.4) continue;
    const r = 1.9 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 十字光芒 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.8; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.66) continue;
    const r = 1.1 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
    ctx.rect(vsx[i] - r * 3, vsy[i] - 0.5, r * 6, 1);
    ctx.rect(vsx[i] - 0.5, vsy[i] - r * 3, 1, r * 6);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}





