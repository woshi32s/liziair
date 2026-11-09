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

/* ===== lizi72 · 引力弹弓 · slingshot —— PHYSICS =====
   粒子从左侧射入，被中间那颗暗行星"甩"一下（双曲线轨迹），出射方向正好落在字位上；
   出射后拖一条速度拉伸的尾迹。**字是实体**（三档 + 暗影 + 光晕），行星只做前景遮挡 + 引力透镜亮环。
   镜头缓慢横移，命中时冲击变焦。                                                  */

const S72 = 900;
const s72x = new Float32Array(S72), s72y = new Float32Array(S72);
const s72a = new Float32Array(S72), s72t = new Float32Array(S72), s72sp = new Float32Array(S72);
let inited72 = 0, hit72 = 0;

function mechUpdate(dt, T) {
  if (!inited72) {
    inited72 = 1;
    for (let i = 0; i < S72; i++) {
      s72a[i] = rnd(-0.9, 0.9);            /* 出射方向 */
      s72t[i] = rnd(0, 1);                 /* 沿轨迹进度 */
      s72sp[i] = rnd(0.22, 0.5);
    }
  }
  if (hit72 > 0) hit72 = Math.max(0, hit72 - dt * 2.2);
  for (let i = 0; i < S72; i++) {
    s72t[i] += dt * s72sp[i];
    if (s72t[i] > 1.6) s72t[i] = 0;
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit72 = 1; vPulse = 1; if (first) cam.tz = 1.09; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx - 330, blockGy + 10), cy = pjY(blockGx - 330, blockGy + 10);
  const R = 118 * z;

  /* 行星 + 引力透镜亮环 */
  ctx.globalAlpha = 0.95; ctx.fillStyle = '#04060a';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 0.55; ctx.strokeStyle = 'rgba(150,200,255,0.55)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, 6.2832); ctx.stroke();
  ctx.globalAlpha = 1;

  /* 轨迹：从左侧进入 → 绕过行星 → 向右上出射（用两段折线近似双曲线） */
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.16, 0.30, 0.55][band];
    ctx.fillStyle = [vDim, vMid, vCore][band];
    ctx.beginPath();
    let any = 0;
    for (let i = band; i < S72; i += 3) {
      const t = s72t[i];
      if (t > 1) continue;
      /* 入口段：(-720, y0) → 行星近旁；出射段：→ (600*cos a, ...) */
      const ang = s72a[i];
      const y0 = Math.sin(ang) * 190;
      let X, Y;
      if (t < 0.45) {
        const u = t / 0.45;
        X = -720 + (720 - 150) * u;
        Y = y0 * (1 - u) + Math.sin(ang) * 12 * u;
      } else {
        const u = (t - 0.45) / 0.55;
        X = -150 + u * (760 + 150);
        Y = Math.sin(ang) * 12 + u * Math.sin(ang) * 320;
      }
      const px = pjX(blockGx + X * 0.92, blockGy + Y * 0.92);
      const py = pjY(blockGx + X * 0.92, blockGy + Y * 0.92);
      const r = (1.2 + 1.6 * (1 - t)) * z;
      ctx.rect(px - r * 2.4, py - r, r * 4.8, r * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.20) * 0.18, pit = 0.08 * Math.sin(T * 0.17 + 0.4);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.05 - X1 / 260) + 0.28 * gl) + hit72 * 0.06;
  }
  ctx.globalAlpha = 0.34; ctx.fillStyle = '#000';
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




