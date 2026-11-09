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

/* ===== lizi93 · 回声 · echo —— PHYSICS =====
   声呐一样的波前一圈圈扩散，撞到画面右侧的"墙"再反射回来，**反射波前经过的地方留下字**。
   波前本身是描边圆弧（2~3 道），粒子在波前经过时点亮并停在字位；命中时打一道更亮的波。
   整体偏冷蓝 + 一点点暖色高光。                                                  */

const E93 = 5;
let e93init = 0, e93t = 0, e93hit = 0;
const e93r = new Float32Array(E93);
const e93own = new Uint8Array(VN);

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(pc * 0.8)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 16;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  vCore = 'rgb(226,244,255)';
  vMid = 'rgb(96,168,236)';
  vDim = 'rgb(20,46,74)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  e93t = T;
  if (e93hit > 0) e93hit = Math.max(0, e93hit - dt * 2.6);
  for (let i = 0; i < E93; i++) e93r[i] = ((T * 260 + i * 210) % 1100);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 6);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 6);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.2);
}

function mechEvent(k, first) { e93hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx - 60, blockGy), cy = pjY(blockGx - 60, blockGy);

  /* 波前：描边圆弧（右半边被"墙"截断） */
  ctx.strokeStyle = 'rgba(110,180,240,0.35)';
  for (let i = 0; i < E93; i++) {
    const rr = e93r[i] * z;
    ctx.globalAlpha = 0.30 * (1 - e93r[i] / 1200);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
    /* 反射波：从右墙回传 */
    if (rr > 420) {
      const rx = pjX(blockGx + 620, blockGy);
      ctx.globalAlpha = 0.18 * (1 - (rr - 420) / 900);
      ctx.beginPath();
      ctx.arc(rx, cy, (rr - 420) * 0.9 * z, Math.PI * 0.42, Math.PI * 1.58);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  /* 字粒子：按到"波前圆"的距离点亮 */
  for (let i = 0; i < vn; i++) {
    const X = vx[i], Y = vy[i];
    const d = Math.hypot(X + 60, Y);
    let lit = 0;
    for (let k = 0; k < E93; k++) {
      const dd = Math.abs(d - e93r[k]);
      if (dd < 70) lit = Math.max(lit, 1 - dd / 70);
    }
    vsx[i] = pjX(blockGx + X, blockGy + Y);
    vsy[i] = pjY(blockGx + X, blockGy + Y);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.18 + 0.62 * gl + 0.42 * lit) + e93hit * 0.1;
  }
  ctx.globalAlpha = 0.8; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalAlpha = 0.9; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.34) continue;
    const r = 2.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.7) continue;
    const r = 1.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}



