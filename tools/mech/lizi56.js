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

/* ===== lizi56 · 沙漏 · hourglass —— PHYSICS =====
   沙粒从上方落下，按"唱到哪个字"依次落定，在下仓堆成字；上仓的沙面随进度变薄。
   玻璃体是标准沙漏轮廓（上罩 / 上锥 / 颈环 / 下锥 / 下罩），描边 + 一道内部反光。
   命中时颈口一抖（定向震动）。                                                   */

let g56inited = 0, g56shake = 0, g56fall = 0;
const g56x = new Float32Array(VN), g56y = new Float32Array(VN), g56v = new Float32Array(VN);
const g56on = new Uint8Array(VN);

function mechUpdate(dt, T) {
  if (!g56inited) {
    g56inited = 1;
    for (let i = 0; i < VN; i++) { g56x[i] = vtx[i]; g56y[i] = -H * 0.34; g56v[i] = 0; g56on[i] = 0; }
  }
  if (g56shake > 0) g56shake = Math.max(0, g56shake - dt * 3.2);
  const grav = 2100;
  let falling = 0;
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    /* 唱到这个字 → 放开这颗粒子（带一点随机延迟，像流沙） */
    if (!g56on[i]) {
      if (gl > 0.05) { g56on[i] = 1; g56y[i] = -H * 0.30 - Math.random() * 40; g56v[i] = 120 + Math.random() * 220; }
      else { g56x[i] = vtx[i] * 0.62; g56y[i] = -H * 0.34 + (i % 53) * 0.7; g56on[i] = 0; continue; }
    }
    /* 自由落体 + 向目标 x 收拢，落到字位停住 */
    if (g56y[i] < vty[i]) {
      g56v[i] += grav * dt;
      g56y[i] += g56v[i] * dt;
      g56x[i] += (vtx[i] - g56x[i]) * Math.min(1, dt * 3.2);
      if (g56y[i] >= vty[i]) { g56y[i] = vty[i]; g56v[i] = 0; }
      falling++;
    } else { g56x[i] = vtx[i]; g56y[i] = vty[i]; }
  }
  g56fall += (falling / Math.max(1, vn) - g56fall) * Math.min(1, dt * 4);
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { g56shake = 1; vPulse = 1; if (first) camShake(0.2, 1, 8); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const sh = g56shake * 2.0 * Math.sin(T * 62);
  const halfW = 150 * z, topY = H * 0.10, botY = H * 0.29, neck = (H * 0.10 + H * 0.29) / 2;

  /* ---------- 玻璃体 ---------- */
  ctx.strokeStyle = 'rgba(146,176,214,0.34)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  /* 上罩 + 上锥 */
  ctx.moveTo(cx - halfW * 0.62, topY - 26 * z); ctx.lineTo(cx + halfW * 0.62, topY - 26 * z);
  ctx.moveTo(cx - halfW, topY); ctx.lineTo(cx - 16 * z, neck);
  ctx.moveTo(cx + halfW, topY); ctx.lineTo(cx + 16 * z, neck);
  /* 下锥 + 下罩 */
  ctx.moveTo(cx - 16 * z, neck); ctx.lineTo(cx - halfW, botY);
  ctx.moveTo(cx + 16 * z, neck); ctx.lineTo(cx + halfW, botY);
  ctx.moveTo(cx - halfW * 0.62, botY + 26 * z); ctx.lineTo(cx + halfW * 0.62, botY + 26 * z);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(190,220,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.70, topY + 10 * z); ctx.lineTo(cx - 34 * z, neck - 20 * z);
  ctx.stroke();

  /* ---------- 上仓残沙（随进度变薄） ---------- */
  const pileY = topY + 16 * z;
  ctx.globalAlpha = 0.35; ctx.fillStyle = 'rgb(206,178,132)';
  ctx.beginPath();
  ctx.rect(cx - halfW * 0.86, pileY, halfW * 1.72, 8 * z);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* ---------- 沙粒 ---------- */
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + g56x[i], blockGy + g56y[i] + sh);
    vsy[i] = pjY(blockGx + g56x[i], blockGy + g56y[i] + sh);
    vss[i] = 1;
    const landed = g56y[i] >= vty[i] - 0.5;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = landed ? clamp01(0.42 + 0.5 * gl) : 0.20;
  }
  ctx.globalAlpha = 0.45; ctx.fillStyle = 'rgb(160,138,104)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] > 0.3) continue;
    const r = 1.5;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgb(226,200,158)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.3 || vlum[i] > 0.62) continue;
    const r = 2.5;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgb(255,246,224)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.62) continue;
    const r = 1.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}






