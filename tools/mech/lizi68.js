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

/* ===== lizi68 · 全息地形 · terrain —— PHYSICS =====
   一片由点构成的三维地形，**等高线（高度带）亮起来的地方连成字**：
   先把字形烘进一张掩膜，地形高度 = 掩膜隆起 + 低频起伏，按高度分带配色，
   镜头贴着地表低空飞行（俯仰缓慢变化 + 视差）。命中时一次"地震"——整片地形抖一下。 */

const TG68 = 150, TH68 = 74, TW68 = 13, TD68 = 11;   /* 网格 / 间距 / 深度间距 */
const t68gx = new Float32Array(TG68 * TH68), t68gy = new Float32Array(TG68 * TH68);
const t68h = new Float32Array(TG68 * TH68), t68own = new Int16Array(TG68 * TH68);
let t68init = 0, t68hit = 0, t68mask = null, t68mw = 0, t68mh = 0;

function t68buildMask(g) {
  const pad = 40;
  t68mw = Math.ceil((g.w + pad * 2) / 4); t68mh = Math.ceil((g.h + pad * 2) / 4);
  t68mask = new Float32Array(t68mw * t68mh);
  for (let p = 0; p < g.pc; p++) {
    const mx = ((g.px[p] + g.w / 2 + pad) / 4) | 0;
    const my = ((g.py[p] + g.h / 2 + pad) / 4) | 0;
    if (mx >= 0 && my >= 0 && mx < t68mw && my < t68mh) t68mask[my * t68mw + mx] = 1;
  }
  /* 模糊两轮，让地形有坡 */
  const tmp = new Float32Array(t68mask.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < t68mh; y++) for (let x = 0; x < t68mw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= t68mw || yy >= t68mh) continue;
        s += t68mask[yy * t68mw + xx]; n++;
      }
      tmp[y * t68mw + x] = s / n;
    }
    t68mask.set(tmp);
  }
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  t68buildMask(g);
  const n = TG68 * TH68;
  vn = Math.min(VN, n);
  for (let i = 0; i < n; i++) {
    const gi = i % TG68, hi = (i / TG68) | 0;
    t68gx[i] = (gi - TG68 / 2) * TW68;
    t68gy[i] = (hi - TH68 / 2) * TD68;
    /* 采样掩膜（按设计坐标对齐字形块） */
    const mx = ((t68gx[i] + g.w / 2 + 40) / 4) | 0, my = ((t68gy[i] + g.h / 2 + 40) / 4) | 0;
    let m = 0;
    if (mx >= 0 && my >= 0 && mx < t68mw && my < t68mh) m = t68mask[my * t68mw + mx];
    const low = Math.sin(t68gx[i] * 0.004) * 10 + Math.cos(t68gy[i] * 0.006 + 1.2) * 8;
    t68h[i] = m * 76 + low;
    if (i < vn) {
      vtx[i] = t68gx[i]; vty[i] = t68gy[i];
      von[i] = m > 0.25 ? 0 : 1;
      vx[i] = t68gx[i]; vy[i] = t68gy[i];
    }
  }
  vCore = 'rgb(190,255,240)';
  vMid = 'rgb(70,190,200)';
  vDim = 'rgb(18,52,66)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (t68hit > 0) t68hit = Math.max(0, t68hit - dt * 2.4);
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { t68hit = 1; vPulse = 1; camShake(0.4, 1, 10); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.22) * 0.10;
  const pit = 0.62 + 0.05 * Math.sin(T * 0.17);        /* 低空俯视 */
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const fly = (T * 26) % 1200 - 600;                    /* 镜头横移 */
  const n = TG68 * TH68;
  for (let i = 0; i < n; i++) {
    const X0 = t68gx[i] + fly, Y0 = t68gy[i], Z0 = -t68h[i] * 1.15;
    let X1 = X0 * cyw + Y0 * syw, Z1 = -X0 * syw + Y0 * cyw;
    let Y1 = Z0 * cp - Z1 * sp; Z1 = Z0 * sp + Z1 * cp;
    const s = 1200 / (1200 + Y1 + 260);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Z1 * s + 20);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Z1 * s + 20);
    vss[i] = s * 1.1;
    /* 等高线带：高度对 16 取模，靠近交界就亮 */
    const band = Math.abs(((t68h[i] % 16) + 16) % 16 - 8);
    const contour = band > 6.2 ? 1 : 0.22;
    vlum[i] = clamp01(0.16 + 0.72 * contour * (0.45 + 0.55 * clamp01(t68h[i] / 70))) + t68hit * 0.12;
  }
  ctx.globalAlpha = 0.24; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.rect(vsx[i] + 1.5, vsy[i] + 2.5, 2.6, 2.6);
  ctx.fill();
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.55, 0.8, 0.95][band];
    ctx.fillStyle = [vDim, vMid, vCore][band];
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < n; i++) {
      const lv = vlum[i] > 0.6 ? 2 : vlum[i] > 0.3 ? 1 : 0;
      if (lv !== band) continue;
      const r = 1.5 * vss[i];
      ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
      any++;
    }
    if (any) ctx.fill();
  }
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



