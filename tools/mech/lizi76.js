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

/* ===== lizi76 · 萤火虫群 · fireflies —— PHYSICS =====
   三级景深的萤火虫在暗色空气里飘，**唱到就一起落到字位上并闪一下**；
   字本身是实体层（三档 + 暗影 + 光晕），萤火虫是前景的暖黄光点（大而虚）+ 极淡的雾。
   命中时整群同步闪烁（相干），镜头缓慢环绕 + 轻微呼吸。                        */

const F76 = 520;
const f76x = new Float32Array(F76), f76y = new Float32Array(F76), f76z = new Float32Array(F76);
const f76ph = new Float32Array(F76), f76sp = new Float32Array(F76), f76bl = new Float32Array(F76);
let inited76 = 0, hit76 = 0, sync76 = 0;

function mechUpdate(dt, T) {
  if (!inited76) {
    inited76 = 1;
    for (let i = 0; i < F76; i++) {
      f76x[i] = rnd(-W * 0.55, W * 0.55);
      f76y[i] = rnd(-H * 0.45, H * 0.45);
      f76z[i] = rnd(-300, 160);
      f76ph[i] = rnd(0, 6.28);
      f76sp[i] = rnd(0.4, 1.1);
      f76bl[i] = rnd(0, 6.28);
    }
  }
  if (hit76 > 0) hit76 = Math.max(0, hit76 - dt * 1.9);
  sync76 = Math.max(sync76 * 0.985, hit76);
  for (let i = 0; i < F76; i++) {
    f76x[i] += Math.sin(T * 0.7 * f76sp[i] + f76ph[i]) * 26 * dt;
    f76y[i] += Math.cos(T * 0.9 * f76sp[i] + f76ph[i] * 1.3) * 20 * dt;
    f76z[i] += Math.sin(T * 0.5 + f76ph[i]) * 30 * dt;
    if (f76z[i] > 200) f76z[i] = -300;
    if (f76x[i] > W * 0.55) f76x[i] = -W * 0.55;
    if (f76x[i] < -W * 0.55) f76x[i] = W * 0.55;
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit76 = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);

  /* 远景萤火（小、暗、慢） */
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.18, 0.34, 0.62][band];
    ctx.fillStyle = band === 2 ? 'rgb(255,238,170)' : 'rgb(220,200,120)';
    ctx.beginPath();
    let any = 0;
    for (let i = band; i < F76; i += 3) {
      const s = 760 / (760 + f76z[i]);
      const px = cx + f76x[i] * s, py = cy + f76y[i] * s;
      const blink = 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin(T * 1.8 + f76bl[i] + sync76 * 6)), 3);
      if (blink < 0.28) continue;
      const r = (1.1 + 1.7 * blink) * s;
      ctx.rect(px - r, py - r, r * 2, r * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  /* 萤火暖光晕（少量大点的柔光） */
  ctx.globalAlpha = 0.10 + sync76 * 0.08;
  ctx.fillStyle = 'rgb(255,214,120)';
  ctx.beginPath();
  for (let i = 0; i < F76; i += 5) {
    const s = 760 / (760 + f76z[i]);
    const px = cx + f76x[i] * s, py = cy + f76y[i] * s;
    const r = 7 * s;
    ctx.rect(px - r, py - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.19) * 0.18, pit = 0.07 * Math.sin(T * 0.16 + 0.5);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.22 * Math.sin(T * 1.0 - X1 / 270) + 0.28 * gl) + hit76 * 0.05;
  }
  ctx.globalAlpha = 0.36; ctx.fillStyle = '#000';
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



