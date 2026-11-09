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

/* ===== lizi98 · 线框 · wireframe —— PHYSICS =====
   一张向前起伏的线框曲面，**等值线 / 网格交点密起来的地方就是字**：
   字用实体层画（三档 + 暗影），背景是透视网格（横向 + 纵向线）+ 上下游走的波形。
   镜头低角度贴着曲面推进，命中时曲面抖一下。                                        */

const WG98 = 34, WG98B = 16;                 /* 纵向线数 / 横向线数 */
let inited98 = 0, hit98 = 0;

function mechUpdate(dt, T) {
  if (hit98 > 0) hit98 = Math.max(0, hit98 - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit98 = 1; vPulse = 1; camShake(0.3, 1, first ? 9 : 5); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const horizon = cy - 210 * z;
  const roll = Math.sin(T * 0.18) * 0.05;
  const cr = Math.cos(roll), sr = Math.sin(roll);

  /* 透视网格：横向线（越靠下越疏）+ 纵向线（汇聚到消失点） */
  ctx.strokeStyle = 'rgba(90,220,190,0.26)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 1; r <= WG98B; r++) {
    const t = r / WG98B;
    const yy = horizon + Math.pow(t, 1.9) * (H * 0.95);
    const half = (60 + Math.pow(t, 1.5) * W * 0.75) * z;
    const x0 = cx - half, x1 = cx + half;
    const y0 = yy + Math.sin(T * 1.2 + r * 0.7) * 10 * t;
    ctx.moveTo(x0 * cr - (y0 - cy) * sr, y0);
    ctx.lineTo(x1 * cr - (y0 - cy) * sr, y0);
  }
  for (let c = -WG98; c <= WG98; c++) {
    const t = c / WG98;
    const xb = cx + t * W * 0.9 * z;
    ctx.moveTo(cx + (xb - cx) * 0.06, horizon);
    ctx.lineTo(xb, H * 1.02);
  }
  ctx.stroke();

  /* 曲面波：几条被扰动的横向亮线 */
  ctx.strokeStyle = 'rgba(150,255,220,0.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const yy = cy + (k - 1) * 60 * z + Math.sin(T * 1.6 + k) * 14 * z;
    ctx.moveTo(cx - W * 0.45, yy);
    for (let s = 1; s <= 12; s++) {
      const xx = cx - W * 0.45 + (W * 0.9 * s) / 12;
      const yy2 = yy + Math.sin(T * 2.2 + s * 0.7 + k) * 16 * z + hit98 * 10;
      ctx.lineTo(xx, yy2);
    }
  }
  ctx.stroke();

  /* 实体字 */
  const yaw = Math.sin(T * 0.20) * 0.22, pit = 0.10 * Math.sin(T * 0.17 + 0.6);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.1 - X1 / 260) + 0.30 * gl) + hit98 * 0.06;
  }
  ctx.globalAlpha = 0.42; ctx.fillStyle = '#000';
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




