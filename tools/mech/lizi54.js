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

/* ===== lizi54 · 粒子隧道 · tunnel —— PHYSICS =====
   镜头在粒子管道里穿行：12 道环（描边 + 环上碎粒）沿 z 推进，字形刻在靠近镜头的管壁上、
   沿圆周微弯；命中时 speed ramp（冲一下再刹）+ 抽帧。
   坐标：x 右、y 下、z 深度（负数=远处），透视 s = f/(f+z)。                    */

const T54_N = 1500, T54_RINGS = 12, T54_GAP = 230, T54_R = 620, T54_F = 760;
const t54a = new Float32Array(T54_N);
const t54k = new Uint8Array(T54_N);
const t54j = new Float32Array(T54_N);
let t54inited = 0, t54head = 0, t54spd = 340, t54boost = 0, t54roll = 0;

function t54Init() {
  t54inited = 1;
  for (let i = 0; i < T54_N; i++) {
    t54a[i] = Math.random() * Math.PI * 2;
    t54k[i] = (i % T54_RINGS) | 0;
    t54j[i] = 0.90 + Math.random() * 0.22;
  }
}

function mechUpdate(dt, T) {
  if (!t54inited) t54Init();
  if (t54boost > 0) t54boost = Math.max(0, t54boost - dt * 3.1);
  const spd = t54spd * (1 + t54boost * 1.8) * (1 - 0.20 * Math.max(0, Math.sin(T * 0.7)));
  t54head += spd * dt;
  t54roll = Math.sin(T * 0.27) * 0.09 + t54boost * 0.04 * Math.sin(T * 42);
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 8.5);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 8.5);
    vz[i] += (gl * 30 - vz[i]) * Math.min(1, dt * 3.0);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) {
  t54boost = 1; vPulse = 1;
  if (first) cam.tz = 1.12;
}

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const span = T54_RINGS * T54_GAP;

  /* ---------- 1) 环本体：描边圆（近亮远暗） ---------- */
  for (let k = 0; k < T54_RINGS; k++) {
    let zz = (t54head + k * T54_GAP) % span;
    zz = span - zz - 420;
    if (zz < -T54_F + 90) continue;
    const s = T54_F / (T54_F + zz);
    if (s < 0.30) continue;
    ctx.globalAlpha = Math.min(0.50, 0.05 + s * 0.40);
    ctx.strokeStyle = vMid;
    ctx.lineWidth = Math.max(0.7, 1.8 * s);
    ctx.beginPath();
    ctx.arc(cx, cy, T54_R * s * z * (1 + 0.02 * Math.sin(T * 2 + k)), 0, 6.2832);
    ctx.stroke();
  }

  /* ---------- 2) 环上碎粒（三档深度） ---------- */
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = [0.20, 0.40, 0.70][band];
    ctx.fillStyle = [vDim, vMid, vCore][band];
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < T54_N; i++) {
      let zz = (t54head + t54k[i] * T54_GAP) % span;
      zz = span - zz - 420;
      if (zz < -T54_F + 90) continue;
      const s = T54_F / (T54_F + zz);
      if (s < 0.30) continue;
      const b = s > 0.82 ? 2 : s > 0.50 ? 1 : 0;
      if (b !== band) continue;
      const rr = T54_R * t54j[i] * s * z;
      const px = cx + Math.cos(t54a[i] + t54roll) * rr;
      const py = cy + Math.sin(t54a[i] + t54roll) * rr;
      const sz = 1.3 * s + 0.4;
      ctx.rect(px - sz, py - sz, sz * 2, sz * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0)';

  /* ---------- 3) 字：贴在管壁上，沿圆周微弯 ---------- */
  const RT = 1000;
  for (let i = 0; i < vn; i++) {
    const th = vx[i] / RT;
    const x0 = RT * Math.sin(th);
    const zc = 140 + RT * (1 - Math.cos(th)) - vz[i] * 0.7;
    const sc = T54_F / (T54_F + zc);
    const X = x0 * sc, Y = vy[i] * sc;
    vsx[i] = pjX(blockGx + X, blockGy + Y);
    vsy[i] = pjY(blockGx + X, blockGy + Y);
    vss[i] = sc;
    const gl = charGlow[von[i]] || 0;
    const lit = 0.68 + 0.16 * Math.sin(T * 1.15 - x0 / 260) + 0.18 * clamp01(20 - vz[i] * 0.6) / 20;
    vlum[i] = clamp01(lit) * (0.52 + 0.48 * gl) + vPulse * 0.18;
  }
  ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0 * vss[i]; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.07; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.52) continue;
    const r = 5.0 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  /* 管口体积光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.09 + t54boost * 0.10;
  const pu = 1 + 0.05 * Math.sin(T * 2.1);
  ctx.drawImage(vLightCv, W * 0.5 - 760 * pu, H * 0.5 - 760 * pu, 1520 * pu, 1520 * pu);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




