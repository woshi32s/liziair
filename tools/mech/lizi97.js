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

/* ===== lizi97 · 瀑布 · waterfall —— PHYSICS =====
   水帘从上方倾泻下来，**字是水帘被"撕开"的那块留白**：字本身画实体（三档 + 暗影），
   周围是成条的竖向水线（速度拉伸）+ 底部溅起的水雾。命中时水帘被扯一下（横向震动）。 */

const F97 = 900;
const f97x = new Float32Array(F97), f97y = new Float32Array(F97);
const f97v = new Float32Array(F97), f97h = new Float32Array(F97), f97w = new Float32Array(F97);
let inited97 = 0, hit97 = 0;

function mechUpdate(dt, T) {
  if (!inited97) {
    inited97 = 1;
    for (let i = 0; i < F97; i++) {
      f97x[i] = rnd(-W * 0.42, W * 0.42);
      f97y[i] = rnd(-H, H);
      f97v[i] = rnd(760, 1400);
      f97h[i] = rnd(40, 190);
      f97w[i] = rnd(1.0, 2.6);
    }
  }
  if (hit97 > 0) hit97 = Math.max(0, hit97 - dt * 2.4);
  const boost = 1 + hit97 * 0.5;
  for (let i = 0; i < F97; i++) {
    f97y[i] += f97v[i] * boost * dt;
    f97x[i] += Math.sin(T * 1.4 + i) * 8 * dt;
    if (f97y[i] - f97h[i] > H * 0.62) {
      f97y[i] = -H * 0.6;
      f97x[i] = rnd(-W * 0.42, W * 0.42);
    }
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit97 = 1; vPulse = 1; camShake(0.5, 1, first ? 11 : 6); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  /* 水帘：竖向拉长的条（速度拉伸） */
  const cxS = W / 2, cyS = H * 0.46;
  ctx.globalAlpha = 0.30; ctx.fillStyle = 'rgb(90,180,220)';
  ctx.beginPath();
  for (let i = 0; i < F97; i++) {
    const px = cxS + f97x[i] * z, py = cyS + f97y[i] * z;
    ctx.rect(px - f97w[i], py - f97h[i] * z, f97w[i] * 2, f97h[i] * z);
  }
  ctx.fill();
  ctx.globalAlpha = 0.45; ctx.fillStyle = 'rgb(190,236,255)';
  ctx.beginPath();
  for (let i = 0; i < F97; i += 2) {
    const px = cxS + f97x[i] * z, py = cyS + f97y[i] * z;
    ctx.rect(px - f97w[i] * 0.6, py - f97h[i] * 0.75 * z, f97w[i] * 1.2, f97h[i] * 0.75 * z);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.20) * 0.16, pit = 0.07 * Math.sin(T * 0.16 + 0.8);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cy + vz[i] * sy, Z1 = -vx[i] * sy + vz[i] * cy;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.26 * Math.sin(T * 1.15 - X1 / 270) + 0.28 * gl) + hit97 * 0.06;
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
  ctx.globalAlpha = 1;
}




