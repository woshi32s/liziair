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

/* ===== lizi63 · 珊瑚生长 · coral —— PHYSICS =====
   枝状珊瑚从字心向外长：每颗粒子是一条枝条上的一节，枝条从"字块的种子点"伸到自己的字位，
   生长进度 = 该字的 YRC 点亮进度。枝尖最亮（珊瑚的白梢），枝干偏珊瑚粉；
   命中时整枝轻轻抽一下（次级动作）。                                            */

const cr63 = new Float32Array(VN), cg63 = new Float32Array(VN), cb63 = new Float32Array(VN);
const cd63 = new Float32Array(VN), cl63 = new Float32Array(VN);
let c63init = 0, c63hit = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(pc * 0.85)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    /* 种子：字块中心附近 + 一点随机，枝条从这里长出去 */
    cr63[i] = g.px[pi] * 0.18 + rnd(-70, 70);
    cg63[i] = g.py[pi] * 0.22 + rnd(-46, 46);
    cb63[i] = i / Math.max(1, vn);                 /* 沿枝的位置 0..1 */
    cd63[i] = Math.random() * 6.28;
    cl63[i] = 1;
    vz[i] = (Math.random() - 0.5) * 20;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  vCore = 'rgb(255,246,240)';
  vMid = 'rgb(238,150,140)';
  vDim = 'rgb(120,58,64)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (c63hit > 0) c63hit = Math.max(0, c63hit - dt * 2.6);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const grow = clamp01((T - lineT) / 1.0);
    /* 枝条从种子长到字位；未长到时停在半路（表现"正在长"） */
    const t = clamp01(grow * 1.05 - 0.05 * (1 - cb63[i]));
    const wob = Math.sin(T * 1.6 + cd63[i]) * 6 * (1 - t);
    vx[i] = cr63[i] + (vtx[i] - cr63[i]) * t + wob;
    vy[i] = cg63[i] + (vty[i] - cg63[i]) * t + Math.cos(T * 1.4 + cd63[i]) * 4 * (1 - t);
    vz[i] += (Math.sin(T * 1.2 + i * 0.02) * 10 - vz[i]) * Math.min(1, dt * 2);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { c63hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.26) * 0.20, pit = 0.09 * Math.sin(T * 0.21 + 1.1);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 940 / (940 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.30 + 0.52 * clamp01(gl * 1.2) * (0.60 + 0.40 * cb63[i]) + 0.18 * cb63[i]) + c63hit * 0.10;
  }
  /* 枝干：偏暗的珊瑚粉，粗 */
  ctx.globalAlpha = 0.80; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = (2.4 + 1.6 * cb63[i]) * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 枝身 */
  ctx.globalAlpha = 0.9; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.30) continue;
    const r = (1.4 + 1.1 * cb63[i]) * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 白梢 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.62) continue;
    const r = 1.1 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.06;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(vLightCv, W * 0.5 - 760, H * 0.42 - 760, 1520, 1520);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}


/* ===== 实体字覆盖层（保证整句可读、有厚度；装饰层留在下面） ===== */
const v2BaseDraw = mechDraw;
mechDraw = function (T, z, pjX, pjY) {
  v2BaseDraw(T, z, pjX, pjY);
  if (!vn) return;
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + vtx[i], blockGy + vty[i]);
    vsy[i] = pjY(blockGx + vtx[i], blockGy + vty[i]);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.40 * gl);
  }
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.05; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.56) continue; const r = 5.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  ctx.globalAlpha = 1;
};



