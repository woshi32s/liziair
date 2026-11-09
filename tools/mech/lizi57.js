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

/* ===== lizi57 · 液态金属 · liquid-metal —— PHYSICS =====
   字形点是一滴滴"液态金属"：表面张力呼吸（尺寸/亮度起伏）、互相吸在一起，
   每滴画三层 → 暗金属体 + 亮核 + 左上高光点，整体在镜头里缓慢环转，命中时一波形变。
   参考 lizi02 的"实体感"：靠三层叠加和深暗部，而不是一片白点。            */

const L57 = 1.0;
let m57T = 0, m57Wob = 0;

/* 每个粒子一个相位/呼吸参数 */
const p57ph = new Float32Array(VN);
const p57sp = new Float32Array(VN);
let p57inited = 0;

function mechAssign(use) {                 /* 覆盖核心：密度低一点，每滴更大 */
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(pc * 0.72)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 30;
    vx[i] = vtx[i]; vy[i] = vty[i];
    p57ph[i] = Math.random() * 6.28;
    p57sp[i] = 0.6 + Math.random() * 0.8;
  }
  const a = accent || [186, 206, 255];
  vCore = 'rgb(238,245,255)';
  vMid = `rgb(${(120 + a[0] * 0.25) | 0},${(140 + a[1] * 0.22) | 0},${(170 + a[2] * 0.20) | 0})`;
  vDim = 'rgb(28,36,52)';
  vPulse = 1; p57inited = 1;
}

function mechUpdate(dt, T) {
  m57T = T;
  if (m57Wob > 0) m57Wob = Math.max(0, m57Wob - dt * 1.8);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    /* 融合：朝字位弹簧 + 命中时被推出去再吸回来 */
    const push = m57Wob * 26 * Math.sin(p57ph[i] + T * 3.1);
    vx[i] += ((vtx[i] + push * 0.4) - vx[i]) * Math.min(1, dt * 7.4);
    vy[i] += ((vty[i] + push * 0.3) - vy[i]) * Math.min(1, dt * 7.4);
    /* 唱到的字那几滴更"涨" */
    vsc[i] = 1 + 0.42 * Math.sin(T * 2.3 * p57sp[i] + p57ph[i]) + gl * 0.35;
  }
}

function mechEvent(k, first) { m57Wob = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.33) * 0.28, pit = 0.10 * Math.sin(T * 0.21 + 0.5);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s * vsc[i];
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.55 + 0.30 * gl + 0.18 * Math.sin(T * 1.6 - X1 / 300) + vPulse * 0.2);
  }
  /* 1) 金属暗体：大一点、深蓝黑、带一点下垂（像液滴） */
  ctx.globalAlpha = 0.85; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 4.6 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r + 1.5, r * 2, r * 2);
  }
  ctx.fill();
  /* 2) 中间亮体：偏冷的银蓝 */
  ctx.globalAlpha = 0.92; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    const r = 3.1 * vss[i] * (0.9 + 0.2 * Math.sin(p57ph[i] + T * 2.3));
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 3) 亮核 + 左上高光（金属反光的关键） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.62 || (i % 3)) continue;
    const r = 1.7 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.75; ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.80 || (i % 4)) continue;
    const r = 0.9 * vss[i];
    ctx.rect(vsx[i] - r - 1.6 * vss[i], vsy[i] - r - 1.6 * vss[i], r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  /* 4) 环境扫光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.06;
  ctx.drawImage(vLightCv, ((T * 150) % (W + 1200)) - 900, -120, 1300 * z, 1300 * z);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




