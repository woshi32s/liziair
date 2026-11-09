/*!
title: 涡管歌词
机制一句话：每一笔的**中心线就是一根涡轴**（从墨迹的距离场里抽出来的脊线），上千颗粒子绕着
各自的涡轴做螺旋运动 —— 于是笔画不是被描出来的，而是被"绕"出来的发光涡管：
管子正面的粒子亮而大、背面的暗而小，管壁因此有厚度；涡轴本身留一根细亮丝，
粒子沿轴还会缓慢漂移，整根管子像在流。

实现要点：
  · 涡轴 = 距离场的脊线（chamfer 局部极大），轴向 = 朝外法向转 90°，半径 = 半边宽。
    每句预烘一次，帧里只做"极坐标 → 屏幕"的一次线性投影。
  · 伪三维：把屏外方向 z 按倾斜投影成屏幕位移（TZX/TZY），圆轨道因此变成椭圆轨道，
    正/背面的亮度差就是体积感；这是个纯 2D 相机，字身保持正对、笔画永远读得清。
  · 粒子按前/中/后三档合批，带一小段拖尾（上一帧位置连过来），才看得出"在绕"。
  · 空歌词：四根自由涡（半径 40）慢慢漂，粒子照转 —— 纯音频视觉。
  · RM：角速度降到 35%、拖尾砍掉、倾斜压平，形状保留。
*/

/* ───────────────────────── 相机 / 颜色 ───────────────────────── */
const TZX = 0.12, TZY = 0.52;      /* 屏外方向在屏幕上的投影（伪三维的"倾角"） */
let bgGrad = null, vigGrad = null;
let AXW = 1;

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  bgGrad = ctx.createRadialGradient(VX, VY, 0, VX, VY, Math.max(W, H) * 0.86);
  bgGrad.addColorStop(0, 'rgb(' + (9 + (r * 0.018 | 0)) + ',' + (12 + (g * 0.022 | 0)) + ',' + (22 + (b * 0.030 | 0)) + ')');
  bgGrad.addColorStop(0.58, 'rgb(' + (4 + (r * 0.008 | 0)) + ',' + (6 + (g * 0.010 | 0)) + ',' + (12 + (b * 0.015 | 0)) + ')');
  bgGrad.addColorStop(1, 'rgb(3,4,9)');
  vigGrad = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.34, VX, VY, Math.min(W, H) * 1.08);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(1, 'rgba(1,2,6,0.72)');
};

S.onResize = function () { S.onAccent(); };

/* ───────────────────────── 预烘 ───────────────────────── */
S.bake = function (text) {
  return bake(text, {
    padR: 0.34, padPx: 18, mask: true, inner: true, dir: 6, capInner: 60,
    blur: [Math.max(6, 100 * 0.06)],
    glow: 9, glowColor: 'rgb(' + Math.min(255, ACC[0] + 50) + ',' + Math.min(255, ACC[1] + 42) + ',' + Math.min(255, ACC[2] + 24) + ')'
  });
};

/* ───────────────────────── 涡轴（脊线） ───────────────────────── */
let cores = []; var ridgeN = -1, onlineN = 0; var _nf = 0;                 /* {x,y,r,ax,ay} —— 轴向单位向量 ax/ay，半径 r（CSS 像素） */

function freeCores() {
  cores = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.2832 + 0.6;
    cores.push({
      x: VX + Math.cos(a) * MN * 0.30,
      y: VY + Math.sin(a) * MN * 0.22,
      r: MN * 0.055,
      ax: Math.cos(a + 1.57), ay: Math.sin(a + 1.57)
    });
  }
}

/* 脊线抽样：距离场 4 邻域极大 + 最小间距，半径 = 半边宽；轴向 = 法向转 90° */
function buildCores(g) {
  cores = [];
  if (!g || !g.dfi || !g.mask) { freeCores(); return; }
  const mw = g.mw, mh = g.mh, mask = g.mask, df = g.dfi, dx = g.dx, dy = g.dy;
  const minGap2 = 9.5 * 9.5 * MS * MS;         /* 9.5 CSS 像素，换成掩码格 */
  const ridge = [];
  for (let y = 1; y < mh - 1; y++) {
    const row = y * mw;
    for (let x = 1; x < mw - 1; x++) {
      const i = row + x;
      if (!mask[i]) continue;
      const v = df[i];
      if (v < 1) continue;
      if (v < df[i - 1] || v < df[i + 1] || v < df[i - mw] || v < df[i + mw]) continue;
      ridge.push(i);
    }
  }
  /* 太细的笔画没有稳定脊线：退化成"任意墨迹格" */
  const pool = ridge.length >= 60 ? ridge : (function () {
    const out = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] && df[i] >= 1) out.push(i);
    return out;
  })();

  for (let k = 0; k < pool.length; k++) {
    const i = pool[k];
    const gx = (i % mw) / MS + g.mox, gy = ((i / mw) | 0) / MS + g.moy;
    let ok = true;
    for (let q = 0; q < cores.length; q++) {
      const c = cores[q], ddx = c.x - gx, ddy = c.y - gy;
      if (ddx * ddx + ddy * ddy < minGap2 * 4) { ok = false; break; }
    }
    if (!ok) continue;
    let nx = dx ? dx[i] : 0, ny = dy ? dy[i] : 0;
    if (!(nx * nx + ny * ny > 1e-4)) { nx = 0; ny = 1; }
    cores.push({ x: gx, y: gy, r: Math.max(2.2, df[i] * 2 * 0.92), ax: -ny, ay: nx });
  }
  ridgeN = ridge.length; if (!cores.length) freeCores();
}

/* ───────────────────────── 粒子 ───────────────────────── */
const NP = 1500;
const pC = new Int32Array(NP), pR = new Float32Array(NP), pPh = new Float32Array(NP);
const pW = new Float32Array(NP), pU = new Float32Array(NP), pV = new Float32Array(NP);
const pPX = new Float32Array(NP), pPY = new Float32Array(NP);
let seeded = false;

function seedParticles() {
  for (let i = 0; i < NP; i++) {
    pC[i] = cores.length ? (Math.random() * cores.length) | 0 : -1;
    const c = cores[pC[i]];
    pR[i] = c ? c.r * (1.35 + Math.random() * 0.85) : 0;
    pPh[i] = Math.random() * 6.2832;
    pW[i] = (0.9 + Math.random() * 1.7) * (Math.random() < 0.5 ? 1 : -1);
    pU[i] = (Math.random() * 2 - 1) * 7;
    pV[i] = (Math.random() * 2 - 1) * 9;
  }
  seeded = true;
  for (let i = 0; i < NP; i++) { pPX[i] = -999; pPY[i] = -999; }
}

S.onLine = function (i, g) { onlineN++; _nf++; if (g) buildCores(g); else freeCores(); seedParticles(); };
S.onEmpty = function () { freeCores(); seedParticles(); };
S.onSeek = function () { seeded = false; };
S.reset = function () { seeded = false; cores = []; freeCores(); seedParticles(); };

S.step = function (dt) {
  if (!seeded) seedParticles();
  const k = RM ? 0.35 : 1;
  for (let i = 0; i < NP; i++) {
    pPh[i] += pW[i] * k * dt;
    if (pPh[i] > 6.2832) pPh[i] -= 6.2832; else if (pPh[i] < 0) pPh[i] += 6.2832;
    pU[i] += pV[i] * k * dt;
    if (pU[i] > 8) pU[i] = -8; else if (pU[i] < -8) pU[i] = 8;
  }
};

/* ───────────────────────── 绘制 ───────────────────────── */
const RSEG = 11;              /* 一个环画成 11 段 → 留一道缺口，缺口转起来就看得见"旋" */
S.draw = function () {
  const AC = ACC;
  const cr = Math.min(255, AC[0] + 46), cg = Math.min(255, AC[1] + 40), cb = Math.min(255, AC[2] + 24);
  const tzx = RM ? TZX * 0.45 : TZX, tzy = RM ? TZY * 0.45 : TZY;
  const spin = RM ? 0.25 : 1.0;
  const rev = 0.45 + 0.55 * reveal;

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const g = glyph;

  /* 笔画底：暗底 + 一点点白，保证"是哪个字"永远读得出来 */
  if (g) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.44 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 0.20 * rev;
    ctx.drawImage(g.glow, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  /* ---- 环：每一根轴上套一串椭圆环（环平面垂直于涡轴），正面亮、背面暗 ---- */
  const pF = new Path2D(), pB = new Path2D();
  const skip = 3;
  const stepA = (6.2832 * 0.78) / RSEG;
  for (let ci = 0; ci < cores.length; ci += skip) {
    const c = cores[ci];
    const rr = c.r * 1.95 + 2.4;
    const nx = -c.ay, ny = c.ax;
    const ph0 = vT * 1.75 * spin + ci * 0.9;
    let px0 = 0, py0 = 0;
    for (let s = 0; s <= RSEG; s++) {
      const ph = ph0 + s * stepA;
      const cs = Math.cos(ph), sn = Math.sin(ph);
      const z = rr * sn;
      const x = c.x + nx * rr * cs + tzx * z;
      const y = c.y + ny * rr * cs - tzy * z;
      if (s === 0) { px0 = x; py0 = y; continue; }
      const p = (sn > 0) ? pF : pB;
      p.moveTo(px0, py0); p.lineTo(x, y);
      px0 = x; py0 = y;
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(' + Math.min(255, cr - 24) + ',' + Math.min(255, cg - 20) + ',' + cb + ',0.055)';
  ctx.lineWidth = 1.0;
  ctx.stroke(pB);
  ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.34 + beat * 0.14).toFixed(3) + ')';
  ctx.lineWidth = 1.0;
  ctx.stroke(pF);

  /* ---- 粒子：沿轨道的一小段弧（不是点 —— 点看不出在绕） ---- */
  if (!seeded) seedParticles();
  const ARC = 0.38, ca = Math.cos(ARC), sa = Math.sin(ARC);
  for (let band = 0; band < 3; band++) {
    if (band === 0) {
      ctx.strokeStyle = 'rgba(' + Math.min(255, cr - 20) + ',' + Math.min(255, cg - 16) + ',' + cb + ',0.16)';
      ctx.lineWidth = 1.0;
    } else if (band === 1) {
      ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',0.36)';
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = 'rgba(' + Math.min(255, AC[0] + 104) + ',' + Math.min(255, AC[1] + 98) + ',' + Math.min(255, AC[2] + 84) + ',' + (0.78 + beat * 0.18).toFixed(3) + ')';
      ctx.lineWidth = 2.1;
    }
    ctx.beginPath();
    for (let i = 0; i < NP; i++) {
      const c = cores[pC[i]];
      if (!c) continue;
      const ph = pPh[i], rr = pR[i];
      const cs = Math.cos(ph), sn = Math.sin(ph);
      const nx = -c.ay, ny = c.ax, u = pU[i];
      const z = rr * sn, z1 = rr * (sn * ca - cs * sa);
      const x0 = c.x + c.ax * u + nx * rr * cs + tzx * z;
      const y0 = c.y + c.ay * u + ny * rr * cs - tzy * z;
      const x1 = c.x + c.ax * u + nx * rr * (cs * ca + sn * sa) + tzx * z1;
      const y1 = c.y + c.ay * u + ny * rr * (cs * ca + sn * sa) - tzy * z1;
      const b = sn > 0.42 ? 2 : (sn > -0.34 ? 1 : 0);
      if (b !== band) continue;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.cores = cores.length;
  o.part = NP;
};
