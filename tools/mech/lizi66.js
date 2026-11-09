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

/* ===== lizi66 · 磁轨列车 · maglev —— PHYSICS =====
   光点像列车一样从左侧沿轨道飞驰，**到自己的字位那一格减速停住**，停住的光点连成字。
   速度拉伸成横条尾迹（拖影），停下的位置留下短亮条；命中时全线闪一下 + 轻微横向震动。
   轨道是两条极淡的横向线（描边），让"列车"有路可走。                              */

const v66v = new Float32Array(VN), v66run = new Float32Array(VN);
let m66init = 0, m66hit = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(pc * 0.8)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vx[i] = -900 - Math.random() * 700;
    vy[i] = vty[i] + rnd(-4, 4);
    vz[i] = (Math.random() - 0.5) * 16;
    v66v[i] = 900 + Math.random() * 900;
    v66run[i] = 0;
  }
  vCore = 'rgb(240,250,255)';
  vMid = 'rgb(130,200,245)';
  vDim = 'rgb(28,60,92)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (m66hit > 0) m66hit = Math.max(0, m66hit - dt * 2.8);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const target = vtx[i];
    if (vx[i] < target - 1) {
      /* 巡航 → 临近目标按 gap 减速（缓急变速） */
      const gap = target - vx[i];
      const brake = clamp01(gap / 260);
      let sp = v66v[i] * (0.16 + 0.84 * brake);
      if (gl > 0.02) sp *= 1.45;                     /* 被唱到的车先冲一下 */
      vx[i] = Math.min(target, vx[i] + sp * dt);
      v66run[i] = sp;
    } else {
      vx[i] = target;
      v66run[i] *= 0.86;
    }
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 11);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { m66hit = 1; vPulse = 1; if (first) camShake(1, 0.1, 7); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  /* 轨道：两条淡线 */
  ctx.strokeStyle = 'rgba(90,150,200,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const y1 = pjY(blockGx - 700, blockGy - 96), y2 = pjY(blockGx - 700, blockGy + 96);
  ctx.moveTo(pjX(blockGx - 720, blockGy - 96), y1);
  ctx.lineTo(pjX(blockGx + 720, blockGy - 96), pjY(blockGx + 720, blockGy - 96));
  ctx.moveTo(pjX(blockGx - 720, blockGy + 96), y2);
  ctx.lineTo(pjX(blockGx + 720, blockGy + 96), pjY(blockGx + 720, blockGy + 96));
  ctx.stroke();

  /* 尾迹：按速度拉伸的横条（三档亮度：远/中/近） */
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.28, 0.55, 0.92][band];
    ctx.fillStyle = [vDim, vMid, vCore][band];
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i++) {
      const sp = v66run[i];
      const len = Math.min(78, 3 + sp * 0.045);
      const lv = sp > 420 ? 2 : sp > 120 ? 1 : 0;
      if (lv !== band) continue;
      const px = pjX(blockGx + vx[i], blockGy + vy[i]);
      const py = pjY(blockGx + vx[i], blockGy + vy[i]);
      ctx.rect(px - len, py - 1.4, len, 2.8);
      any++;
    }
    if (any) ctx.fill();
  }
  /* 停住的光点：核心亮点 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.95; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (v66run[i] > 60) continue;
    const px = pjX(blockGx + vx[i], blockGy + vy[i]);
    const py = pjY(blockGx + vx[i], blockGy + vy[i]);
    const r = 1.9;
    ctx.rect(px - r, py - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.06 + m66hit * 0.06;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(vLightCv, W * 0.5 - 900, H * 0.45 - 500, 1800, 1000);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}



