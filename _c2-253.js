/*!
title: 欧拉网格流体
机制一句话：屏幕上铺一张 112×70 的**欧拉网格**，每帧解一次不可压流：加涡旋与浮力、
半拉格朗日平流、4 次 Jacobi 迭代解压力泊松方程并减去压力梯度（散度归零）。
当前句的字就是**墨源**：墨被注入网格，浮力把它拎起来、涡把它卷成丝 ——
于是字的上方永远拖着一片从笔画里冒出来的墨羽；字本身只随这股流做极缓的整体漂移
（逐条扭曲会把字撕碎，所以不做），字是干净的，动的是它吐出来的墨。

实现要点：
  · 网格速度单位"格/秒"，平流用双线性回采样，边界法向速度置零（闭盒子）。
  · 墨每帧从当前句补一点（0.020 的回灌），所以字口永远在冒墨，而墨会飘走、衰减、被卷。
  · 所有缓冲在 resize 时分配，帧里只读写 Float32Array；暂停即冻结，RM 时涡强砍到 45%。
*/

CFG.maxW = 0.66; CFG.maxH = 0.38; CFG.vy = 0.66;

const GF = {
  GW: 112, GH: 70, n: 0,
  u: null, v: null, u2: null, v2: null, p: null, d: null, d2: null,
  rc: null, rctx: null, img: null, ready: false, t: 0,
  px: null, py: null, life: null, trail: null, tn: 0
};
let gfBg = null, gfVig = null;
let gfIce = [216, 236, 255];
let gfAcc = [120, 170, 255];

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  gfAcc = [r, g, b];
  gfIce = [Math.min(255, Math.round(r * 0.30 + 172)), Math.min(255, Math.round(g * 0.32 + 176)), Math.min(255, Math.round(b * 0.28 + 184))];
  gfBg = ctx.createLinearGradient(0, 0, 0, H);
  gfBg.addColorStop(0, 'rgb(3,5,9)');
  gfBg.addColorStop(0.55, 'rgb(5,8,14)');
  gfBg.addColorStop(1, 'rgb(6,7,12)');
  gfVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.24, VX, VY, Math.min(W, H) * 1.06);
  gfVig.addColorStop(0, 'rgba(0,0,0,0)');
  gfVig.addColorStop(1, 'rgba(1,2,5,0.86)');
};

function gfAlloc() {
  GF.GW = 112;
  GF.GH = Math.max(40, Math.round(GF.GW * H / W));
  const n = GF.GW * GF.GH;
  GF.n = n;
  GF.u = new Float32Array(n); GF.v = new Float32Array(n);
  GF.u2 = new Float32Array(n); GF.v2 = new Float32Array(n);
  GF.p = new Float32Array(n); GF.d = new Float32Array(n); GF.d2 = new Float32Array(n);
  GF.rc = document.createElement('canvas');
  GF.rc.width = GF.GW; GF.rc.height = GF.GH;
  GF.rctx = GF.rc.getContext('2d');
  GF.img = GF.rctx.createImageData(GF.GW, GF.GH);
  GF.px = new Float32Array(56); GF.py = new Float32Array(56); GF.life = new Float32Array(56);
  GF.trail = new Float32Array(56 * 8 * 2); GF.tn = 0;
  for (let q = 0; q < 56; q++) GF.life[q] = -1;
  GF.ready = true;
}

S.onResize = function () { S.onAccent(); gfAlloc(); };

S.bake = function (text) {
  return bake(text, { padR: 0.16, padPx: 10, mask: true, inner: true, capInner: 26, glow: 11, glowColor: 'rgba(210,232,255,1)' });
};

/* 双线性采样（网格） */
function gfS(arr, x, y) {
  const GW = GF.GW, GH = GF.GH;
  if (x < 0) x = 0; else if (x > GW - 1.001) x = GW - 1.001;
  if (y < 0) y = 0; else if (y > GH - 1.001) y = GH - 1.001;
  const i0 = x | 0, j0 = y | 0, tx = x - i0, ty = y - j0;
  const o = j0 * GW + i0;
  const a = arr[o], b = arr[o + 1], c = arr[o + GW], e = arr[o + GW + 1];
  const t0 = a + (b - a) * tx, t1 = c + (e - c) * tx;
  return t0 + (t1 - t0) * ty;
}

/* 把当前句灌进墨场（换句 / seek 时用） */
function gfSeed(amount) {
  const g = glyph;
  if (!GF.ready) return;
  const GW = GF.GW, GH = GF.GH;
  const sx = W / GW, sy = H / GH;
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      let m = 0;
      if (g && g.mask) m = inkAt(g, (i + 0.5) * sx, (j + 0.5) * sy) ? 1 : 0;
      GF.d[k] = Math.max(GF.d[k] * (1 - amount), m * amount);
    }
  }
}

S.onLine = function () { gfSeed(0.42); };
S.onEmpty = function () { if (GF.ready) GF.d.fill(0); };
S.onSeek = function () { if (GF.ready) { GF.u.fill(0); GF.v.fill(0); GF.d.fill(0); } };
S.reset = function () {
  if (!GF.ready) return;
  GF.u.fill(0); GF.v.fill(0); GF.d.fill(0);
  GF.t = 0;
};

/* ── 一步求解 ── */
S.step = function (dt) {
  if (!GF.ready) return;
  const GW = GF.GW, GH = GF.GH, n = GF.n;
  const u = GF.u, v = GF.v, u2 = GF.u2, v2 = GF.v2, d = GF.d, d2 = GF.d2, p = GF.p;
  const step = Math.min(1 / 50, Math.max(1 / 90, dt || 1 / 60));
  GF.t += step;
  const t = GF.t;
  const amp = RM ? 0.45 : 1;

  /* ① 力：两个慢转的涡 + 墨的浮力（墨比周围"热"，往上走） */
  const c1x = GW * (0.38 + 0.16 * Math.sin(t * 0.21));
  const c1y = GH * (0.40 + 0.12 * Math.cos(t * 0.17));
  const c2x = GW * (0.62 - 0.18 * Math.sin(t * 0.13 + 1.7));
  const c2y = GH * (0.34 + 0.14 * Math.sin(t * 0.23 + 0.6));
  for (let j = 1; j < GH - 1; j++) {
    const wind = Math.sin(t * 0.35 + j * 0.06) * 0.20;
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      const dx1 = i - c1x, dy1 = j - c1y;
      const dx2 = i - c2x, dy2 = j - c2y;
      const r1 = Math.exp(-(dx1 * dx1 + dy1 * dy1) / 620);
      const r2 = Math.exp(-(dx2 * dx2 + dy2 * dy2) / 360);
      const fx = (-dy1 * r1 * 0.34 + dy2 * r2 * 0.30 + wind) * amp;
      const fy = (dx1 * r1 * 0.34 - dx2 * r2 * 0.30) * amp - (d[k] * 5.0 + 0.55) * amp;
      u[k] = (u[k] + fx * step) * 0.994;
      v[k] = (v[k] + fy * step) * 0.994;
      if (u[k] > 6) u[k] = 6; else if (u[k] < -6) u[k] = -6;
      if (v[k] > 6) v[k] = 6; else if (v[k] < -6) v[k] = -6;
    }
  }

  /* ② 平流：速度（半拉格朗日回采样） */
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      const x = i - u[k] * step, y = j - v[k] * step;
      u2[k] = gfS(u, x, y);
      v2[k] = gfS(v, x, y);
    }
  }
  for (let i = 0; i < GW; i++) { u2[i] = 0; v2[i] = 0; }
  for (let i = 0; i < GW; i++) { u2[n - GW + i] = u2[n - 2 * GW + i]; v2[n - GW + i] = v2[n - 2 * GW + i]; }
  for (let j = 0; j < GH; j++) { u2[j * GW] = 0; v2[j * GW] = 0; u2[j * GW + GW - 1] = 0; v2[j * GW + GW - 1] = 0; }
  GF.u = u2; GF.u2 = u; GF.v = v2; GF.v2 = v;
  const U = GF.u, V = GF.v;

  /* ③ 压力投影（4 次 Jacobi） */
  p.fill(0);
  for (let it = 0; it < 4; it++) {
    for (let j = 1; j < GH - 1; j++) {
      for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i;
        const div = 0.5 * (U[k + 1] - U[k - 1] + V[k + GW] - V[k - GW]);
        p[k] = (div + p[k - 1] + p[k + 1] + p[k - GW] + p[k + GW]) * 0.25;
      }
    }
  }
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      U[k] -= 0.5 * (p[k + 1] - p[k - 1]);
      V[k] -= 0.5 * (p[k + GW] - p[k - GW]);
    }
  }

  /* ③b 底噪上升气流：盒子里有个持续的上冲（顶边开口，所以散度在这里是零） */
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      U[k] *= 0.62; V[k] = V[k] * 0.64 - 1.35 * amp;
    }
  }

  /* ④ 墨：平流 + 从当前句回灌 */
  const g = glyph;
  const sxp = W / GW, syp = H / GH;
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      const x = i - U[k] * step, y = j - V[k] * step;
      let dd = gfS(d, x, y) * 0.994;
      if (g && g.mask && inkAt(g, (i + 0.5) * sxp, (j + 0.5) * syp)) dd += 0.030 * amp;
      d2[k] = dd > 1 ? 1 : dd;
    }
  }
  GF.d = d2; GF.d2 = d;

  /* ⑤ 示踪粒子：只是让这张流场看得见（56 条短拖尾） */
  const px = GF.px, py = GF.py, life = GF.life, trail = GF.trail;
  for (let q = 0; q < 56; q++) {
    const base = q * 16;
    if (life[q] < 0 || life[q] > 6.5) {
      let sx0 = 0, sy0 = 0, got = false;
      for (let tr = 0; tr < 12 && !got; tr++) {
        const cx2 = g ? g.gx + Math.random() * g.bw : Math.random() * W;
        const cy2 = g ? g.gy + Math.random() * g.bh : Math.random() * H;
        if (!g || inkAt(g, cx2, cy2)) { sx0 = cx2 / W * GW; sy0 = cy2 / H * GH; got = true; }
      }
      if (!got) { life[q] = -1; continue; }
      life[q] = 0;
      for (let m = 0; m < 8; m++) { trail[base + m * 2] = sx0; trail[base + m * 2 + 1] = sy0; }
      px[q] = sx0; py[q] = sy0;
      continue;
    }
    life[q] += step;
    const uu = gfS(U, px[q], py[q]), vv = gfS(V, px[q], py[q]);
    for (let m = 7; m > 0; m--) {
      trail[base + m * 2] = trail[base + (m - 1) * 2];
      trail[base + m * 2 + 1] = trail[base + (m - 1) * 2 + 1];
    }
    px[q] += uu * step; py[q] += vv * step;
    if (px[q] < 1 || px[q] > GW - 2 || py[q] < 1 || py[q] > GH - 2) { life[q] = -1; continue; }
    trail[base] = px[q]; trail[base + 1] = py[q];
  }
};

S.draw = function () {
  const g = glyph;
  const r = gfIce[0], gg = gfIce[1], bb = gfIce[2];
  const rev = 0.5 + 0.5 * reveal;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = gfBg;
  ctx.fillRect(0, 0, W, H);

  if (!GF.ready) { ctx.fillStyle = gfVig; ctx.fillRect(0, 0, W, H); return; }

  /* ── 墨：网格密度上色，拉大成一片会卷的烟 ── */
  const D = GF.d;
  const data = GF.img.data;
  const ar = gfAcc[0], ag = gfAcc[1], ab = gfAcc[2];
  const GW2 = GF.GW, GH2 = GF.GH;
  for (let j = 0; j < GH2; j++) {
    for (let i = 0; i < GW2; i++) {
      const k = j * GW2 + i, o = k * 4;
      let dd = D[k];
      if (dd < 0.008) { data[o + 3] = 0; continue; }
      if (dd > 1) dd = 1;
      /* 密度梯度的模当"墨丝"的亮度：烟才有结构，不然只是一团光 */
      const xl = i > 0 ? D[k - 1] : dd, xr = i < GW2 - 1 ? D[k + 1] : dd;
      const yl = j > 0 ? D[k - GW2] : dd, yr = j < GH2 - 1 ? D[k + GW2] : dd;
      const gx2 = xr - xl, gy2 = yr - yl;
      let gr = Math.sqrt(gx2 * gx2 + gy2 * gy2);
      if (gr > 1.2) gr = 1.2;
      const core = dd * dd * 0.40 + gr * 1.05;
      data[o] = (r * 0.58 + ar * 0.42) * core * 0.95;
      data[o + 1] = (gg * 0.58 + ag * 0.42) * core * 0.95;
      data[o + 2] = (bb * 0.58 + ab * 0.42) * core * 0.95;
      data[o + 3] = (core > 1 ? 1 : core) * 248;
    }
  }
  GF.rctx.putImageData(GF.img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85 * rev;
  ctx.drawImage(GF.rc, 0, 0, W, H);
  ctx.globalAlpha = 1;

  /* ── 示踪粒子：一串短拖尾，把"这里真的在流"写在画面上 ── */
  {
    const trail = GF.trail, px = GF.px, py = GF.py, life = GF.life;
    const kx = W / GF.GW, ky = H / GF.GH;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (let q = 0; q < 56; q++) {
      if (life[q] < 0) continue;
      const base = q * 16;
      const a0 = Math.min(1, life[q] * 1.4) * 0.16 * rev;
      ctx.strokeStyle = 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 26) + ',' + Math.min(255, bb + 20) + ',' + a0.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(trail[base] * kx, trail[base + 1] * ky);
      for (let m = 1; m < 8; m++) ctx.lineTo(trail[base + m * 2] * kx, trail[base + m * 2 + 1] * ky);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /* ── 字：整幅只做一次极缓的整体漂移（逐条扭曲会把字撕碎，这里不做） ── */
  if (g && g.crisp) {
    const uu = gfS(GF.u, (g.gx + g.bw * 0.5) / W * GF.GW, (g.gy + g.bh * 0.5) / H * GF.GH);
    const vv = gfS(GF.v, (g.gx + g.bw * 0.5) / W * GF.GW, (g.gy + g.bh * 0.5) / H * GF.GH);
    const dx = Math.max(-7, Math.min(7, uu * 1.1));
    const dy = Math.max(-5, Math.min(5, vv * 0.8));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.20 * rev;
    ctx.drawImage(g.glow, g.gx + dx - g.bw * 0.04, g.gy + dy - g.bh * 0.04, g.bw * 1.08, g.bh * 1.08);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.96 * rev;
    ctx.drawImage(g.crisp, g.gx + dx, g.gy + dy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = gfVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.grid = GF.GW + 'x' + GF.GH;
};
