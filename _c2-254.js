/*!
title: 断层重建
机制一句话：当前句先被"扫描"成一张 **Radon 正弦图**（64 个角度 × 128 条射线，每张投影就是
一次沿射线的线积分），再逐角度做**滤波反投影**把二维分布反解回来 —— 像 CT 一样，
字不是画出来的，是从它在各个方向上的投影里**重建**出来的；
左边的正弦图、绕字旋转的机架（源点 + 扇形束）与重建出的字是三件互相印证的东西：
角度越多，字越清楚，星芒伪影越少。

实现要点：
  · 字形密度一次采样到 128×128；投影与反投影都用双线性，每帧只推进 2 个角度（≈0.5s 扫完）。
  · 反投影是累加的：角度一颗一颗加进去，画面就一点点"显影" —— 这是进度条，也是机制本身。
  · 全在 CPU 上算（每帧 ~65k 次乘加）；重建图 128² 上采样后叠一层极淡的清晰字保证读得出来。
  · 暂停即冻结（角度计数器只在 step 里推进）；RM 时扫描线转速不变但环形光减弱。
*/

const TG = {
  N: 192, NA: 96, dens: null, acc: null, sino: null, ang: 0, done: 0,
  rc: null, rctx: null, img: null, sc: null, sctx: null, simg: null, ready: false
};
let tgBg = null, tgVig = null;
let tgIce = [222, 238, 255];

CFG.maxW = 0.62; CFG.maxH = 0.36;

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  tgIce = [Math.min(255, Math.round(r * 0.30 + 170)), Math.min(255, Math.round(g * 0.34 + 174)), Math.min(255, Math.round(b * 0.28 + 182))];
  tgBg = ctx.createLinearGradient(0, 0, 0, H);
  tgBg.addColorStop(0, 'rgb(3,5,9)');
  tgBg.addColorStop(0.6, 'rgb(5,7,13)');
  tgBg.addColorStop(1, 'rgb(7,8,13)');
  tgVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.24, VX, VY, Math.min(W, H) * 1.06);
  tgVig.addColorStop(0, 'rgba(0,0,0,0)');
  tgVig.addColorStop(1, 'rgba(1,2,5,0.85)');
};

function tgAlloc() {
  const N = TG.N;
  TG.dens = new Float32Array(N * N);
  TG.acc = new Float32Array(N * N);
  TG.sino = new Float32Array(TG.NA * N);
  TG.tmp = new Float32Array(N);
  TG.rc = document.createElement('canvas');
  TG.rc.width = N; TG.rc.height = N;
  TG.rctx = TG.rc.getContext('2d');
  TG.img = TG.rctx.createImageData(N, N);
  const SW2 = 96, SH2 = TG.NA;
  TG.sc = document.createElement('canvas');
  TG.sc.width = SW2; TG.sc.height = SH2;
  TG.sctx = TG.sc.getContext('2d');
  TG.simg = TG.sctx.createImageData(SW2, SH2);
  TG.sinW = SW2;
  TG.ready = true;
  TG.ang = 0; TG.done = 0;
  TG.acc.fill(0); TG.sino.fill(0);
}

S.onResize = function () { S.onAccent(); tgAlloc(); };

S.bake = function (text) {
  const g = bake(text, { padR: 0.18, padPx: 12, mask: true, glow: 10, glowColor: 'rgba(214,234,255,1)' });
  if (g && g.mask) {
    /* 字形密度：把墨迹采到 128×128（以字盒中心为原点，等比缩放到圆内） */
    const N = TG.N;
    if (!TG.dens) tgAlloc();
    const c = (N - 1) * 0.5;
    const sc2 = (N * 0.86) / Math.max(g.bw, g.bh);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const sx = g.gx + g.bw * 0.5 + (i - c) / sc2;
        const sy = g.gy + g.bh * 0.5 + (j - c) / sc2;
        TG.dens[j * N + i] = inkAt(g, sx, sy) ? 1 : 0;
      }
    }
    /* 支撑域（ROI 窗）：把有限角带来的远处星芒掐掉，只留字所在的椭圆 */
    const sup = new Float32Array(N * N);
    const hw = (g.bw * 0.5 * sc2) * 1.04, hh = (g.bh * 0.5 * sc2) * 1.16;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const dx2 = (i - c) / hw, dy2 = (j - c) / hh;
        const rr2 = dx2 * dx2 + dy2 * dy2;
        sup[j * N + i] = rr2 >= 1 ? 0 : (rr2 > 0.55 ? (1 - (rr2 - 0.55) / 0.45) : 1);
      }
    }
    TG.sup = sup;
    TG.acc.fill(0); TG.sino.fill(0); TG.ang = 0; TG.done = 0;
  }
  return g;
};

S.reset = function () {
  if (!TG.ready) return;
  TG.acc.fill(0); TG.sino.fill(0); TG.ang = 0; TG.done = 0;
};
S.onLine = function () { S.reset(); };
S.onEmpty = function () { S.reset(); };

/* 双线性采样（N×N 密度） */
function tgD(x, y) {
  const N = TG.N, d = TG.dens;
  if (x < 0 || y < 0 || x > N - 1.001 || y > N - 1.001) return 0;
  const i0 = x | 0, j0 = y | 0, tx = x - i0, ty = y - j0;
  const o = j0 * N + i0;
  const a = d[o], b = d[o + 1], c = d[o + N], e = d[o + N + 1];
  const t0 = a + (b - a) * tx, t1 = c + (e - c) * tx;
  return t0 + (t1 - t0) * ty;
}

/* 一个角度：正向投影（线积分 + 斜坡滤波）→ 反投影累加 */
function tgAngle(a) {
  const N = TG.N, c = (N - 1) * 0.5;
  const th = (a / TG.NA) * Math.PI;
  const dx = Math.cos(th), dy = Math.sin(th);
  const base = a * N;
  /* ① 投影 */
  for (let r = 0; r < N; r++) {
    const o = r - c;
    let sum = 0;
    for (let t = 0; t < N; t += 1) {
      const s = t - c;
      sum += tgD(c + s * dx - o * dy, c + s * dy + o * dx);
    }
    TG.sino[base + r] = sum / N;
  }
  /* ② 斜坡滤波（5 抽头差分核，压掉低频星芒） */
  const tmp = TG.tmp;
  for (let r = 0; r < N; r++) tmp[r] = TG.sino[base + r];
  for (let r = 0; r < N; r++) {
    const a2 = tmp[r > 1 ? r - 2 : 0], b2 = tmp[r > 0 ? r - 1 : 0];
    const d2 = tmp[r < N - 1 ? r + 1 : N - 1], e2 = tmp[r < N - 2 ? r + 2 : N - 1];
    TG.sino[base + r] = 1.45 * tmp[r] - 0.8 * (b2 + d2) + 0.075 * (a2 + e2);
  }
  /* ③ 反投影累加 */
  const acc = TG.acc;
  for (let j = 0; j < N; j++) {
    const ry = j - c;
    for (let i = 0; i < N; i++) {
      const rx = i - c;
      const u = ry * dx - rx * dy + c;
      const u0 = u | 0;
      if (u0 < 0 || u0 >= N - 1) continue;
      const tf = u - u0;
      acc[j * N + i] += TG.sino[base + u0] * (1 - tf) + TG.sino[base + u0 + 1] * tf;
    }
  }
}

S.step = function (dt) {
  if (!TG.ready || !glyph) return;
  const per = 3;
  for (let i = 0; i < per && TG.ang < TG.NA; i++) { tgAngle(TG.ang); TG.ang++; }
  TG.done = TG.ang;
};

S.draw = function () {
  const g = glyph;
  const r = tgIce[0], gg = tgIce[1], bb = tgIce[2];
  const rev = 0.5 + 0.5 * reveal;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = tgBg;
  ctx.fillRect(0, 0, W, H);

  if (!TG.ready) { ctx.fillStyle = tgVig; ctx.fillRect(0, 0, W, H); return; }

  const N = TG.N;
  const cxp = VX, cyp = VY;
  const R = Math.min(W * 0.22, H * 0.34);

  /* ── 重建图：128² 的累加场 → 一张会"显影"的字 ── */

  const data = TG.img.data;
  const A = TG.acc;
  /* 自曝光：拿 ROI 里的峰值当 1，滤波器改了增益也不会翻车 */
  let amax = 0.0001;
  if (TG.sup) { for (let k = 0; k < N * N; k++) { if (TG.sup[k] > 0.6 && A[k] > amax) amax = A[k]; } }
  const gain = 2.1 / amax;
  for (let k = 0, o = 0; k < N * N; k++, o += 4) {
    let v = A[k] * gain * (TG.sup ? TG.sup[k] : 1);
    if (v < 0.02) { data[o + 3] = 0; continue; }
    if (v > 1) v = 1;
    const v2 = Math.min(1, Math.pow(v, 0.55) * 1.5);
    data[o] = r * v2 + ACC[0] * v * 0.10;
    data[o + 1] = gg * v2 + ACC[1] * v * 0.10;
    data[o + 2] = bb * v2 + ACC[2] * v * 0.10;
    data[o + 3] = Math.min(1, v * 1.5) * 255;
  }
  TG.rctx.putImageData(TG.img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.92 * rev;
  ctx.drawImage(TG.rc, cxp - R, cyp - R, R * 2, R * 2);

  /* 极淡的清晰字垫底：重建有星芒时也不至于读不出（只做可读性保险） */
  if (g && g.crisp) {
    const s = (R * 1.9) / Math.max(g.bw, g.bh);
    ctx.globalAlpha = 0.10 * rev;
    ctx.drawImage(g.crisp, cxp - g.bw * s * 0.5, cyp - g.bh * s * 0.5, g.bw * s, g.bh * s);
  }
  ctx.globalAlpha = 1;

  /* ── 机架：一圈透视椭圆 + 源点 + 扇形束（正在扫的那个角度） ── */
  const tiltR = R * 1.30, tiltY = R * 0.42;
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cxp, cyp, tiltR, tiltY, 0, 0, Math.PI * 2);
  ctx.stroke();
  /* 刻度：每个已扫过的角度留一道短刻线 */
  for (let a = 0; a < TG.NA; a += 1) {
    const th = (a / TG.NA) * Math.PI * 2 - Math.PI * 0.5;
    const cth = Math.cos(th), sth = Math.sin(th);
    const px = cxp + tiltR * cth, py = cyp + tiltY * sth;
    const on = a < TG.done;
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',' + (on ? 0.30 : 0.07).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(cxp + (tiltR + (on ? 10 : 4)) * cth, cyp + (tiltY + (on ? 4 : 2)) * sth);
    ctx.stroke();
  }
  /* 源点：正在扫的角度 */
  if (TG.done > 0 && TG.ang < TG.NA) {
    const th = (TG.ang / TG.NA) * Math.PI * 2 - Math.PI * 0.5;
    const sxp = cxp + tiltR * Math.cos(th), syp = cyp + tiltY * Math.sin(th);
    const sg = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, 26);
    sg.addColorStop(0, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 34) + ',' + Math.min(255, bb + 26) + ',0.75)');
    sg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sxp - 26, syp - 26, 52, 52);
    /* 扇形束：源点 → 字的一排采样点 */
    ctx.strokeStyle = 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 26) + ',' + Math.min(255, bb + 20) + ',0.14)';
    for (let q = -6; q <= 6; q++) {
      const ex = cxp + q * R * 0.13, ey = cyp + q * R * 0.055;
      ctx.beginPath();
      ctx.moveTo(sxp, syp);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  /* ── 正弦图：左边一条斜放的长条，一行一个角度 ── */
  if (TG.done > 0) {
    const SW2 = TG.sinW, SH2 = TG.NA;
    const sd = TG.simg.data;
    for (let j = 0; j < SH2; j++) {
      const row = j * N;
      for (let i = 0; i < SW2; i++) {
        const o = (j * SW2 + i) * 4;
        if (j >= TG.done) { sd[o + 3] = 0; continue; }
        let v = TG.sino[row + Math.floor(i / SW2 * N)] * 22;
        if (v < 0) v = 0; else if (v > 1.4) v = 1.4;
        sd[o] = r * 0.85 * v + ACC[0] * 0.15 * v;
        sd[o + 1] = gg * 0.85 * v + ACC[1] * 0.15 * v;
        sd[o + 2] = bb * 0.85 * v + ACC[2] * 0.15 * v;
        sd[o + 3] = Math.min(1, v * 0.9) * 230;
      }
    }
    TG.sctx.putImageData(TG.simg, 0, 0);
    const pw = Math.min(W * 0.13, 190), ph = Math.min(H * 0.44, 400);
    const pxs = W * 0.055, pys = VY - ph * 0.5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.72 * rev;
    ctx.drawImage(TG.sc, pxs, pys, pw, ph);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.16)';
    ctx.strokeRect(pxs + 0.5, pys + 0.5, pw, ph);
    ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.35)';
    ctx.font = '500 10px ui-monospace,Consolas,monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('RADON  ' + TG.done + '/' + TG.NA, pxs, pys - 15);
  }

  ctx.fillStyle = tgVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.ang = TG.done;
};
