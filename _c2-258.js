/*!
title: 散景调焦
机制一句话：字的每一处墨都是一颗**点光源**，它们不在同一个深度上（笔画越厚越靠前）；
镜头对焦在某个深度 z_f 上时，离焦量 |z − z_f| 决定每颗点光源被摊成多大的**光圈散景**（PSF）——
于是调焦环一转，字就在"清楚"与"一片游动的光斑"之间来回；散景是圆形的、边缘略亮，
这是真实镜头的光圈形状，不是高斯模糊。

实现要点：
  · 换句时采 ~450 颗点光源（位置 + 深度 + 亮度），并预烘两张散景精灵（大/小各一）。
  · 帧里每个点只做一次 drawImage（半径随离焦量线性长大），外加 14 团背景虚焦光斑。
  · 焦点 6 秒一个来回，但字始终有一层 0.8 的清晰度打底 —— 再虚也读得出来。
  · 暂停即冻结；RM 时调焦行程砍到 40%。
*/

CFG.maxW = 0.60; CFG.maxH = 0.34;

const BK = { px: null, py: null, pz: null, pb: null, n: 0, sp: null, spb: null, focus: 0 };
let bkBg = null, bkVig = null, bkIce = [232, 242, 255];

function bkSprite(size, rim) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const r = size * 0.5;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,' + (0.30 * rim).toFixed(3) + ')');
  gr.addColorStop(0.55, 'rgba(255,255,255,' + (0.30 * rim).toFixed(3) + ')');
  gr.addColorStop(0.80, 'rgba(255,255,255,' + (0.75 * rim).toFixed(3) + ')');
  gr.addColorStop(0.94, 'rgba(255,255,255,' + (0.42 * rim).toFixed(3) + ')');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  bkIce = [Math.min(255, Math.round(r * 0.30 + 178)), Math.min(255, Math.round(g * 0.32 + 182)), Math.min(255, Math.round(b * 0.26 + 190))];
  bkBg = ctx.createLinearGradient(0, 0, 0, H);
  bkBg.addColorStop(0, 'rgb(3,4,9)');
  bkBg.addColorStop(0.6, 'rgb(5,6,12)');
  bkBg.addColorStop(1, 'rgb(7,7,12)');
  bkVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.24, VX, VY, Math.min(W, H) * 1.05);
  bkVig.addColorStop(0, 'rgba(0,0,0,0)');
  bkVig.addColorStop(1, 'rgba(1,2,4,0.84)');
  if (!BK.sp) { BK.sp = bkSprite(64, 1); BK.spb = bkSprite(32, 0.7); }
};

S.onResize = function () { S.onAccent(); };

S.bake = function (text) {
  const g = bake(text, { padR: 0.18, padPx: 12, mask: true, inner: true, capInner: 18, glow: 9, glowColor: 'rgba(226,240,255,1)' });
  if (!g || !g.mask) return g;
  const cap = 520;
  if (!BK.px) { BK.px = new Float32Array(cap); BK.py = new Float32Array(cap); BK.pz = new Float32Array(cap); BK.pb = new Float32Array(cap); }
  /* 均匀采 450 颗：按 mask 步长遍历，够就停 */
  const stepM = Math.max(2, Math.round(Math.sqrt(g.mw * g.mh / 1200)));
  let n = 0;
  for (let y = 1; y < g.mh && n < cap; y += stepM) {
    for (let x = 1; x < g.mw && n < cap; x += stepM) {
      const k = y * g.mw + x;
      if (!g.mask[k]) continue;
      const h = Math.min(1, g.dfi[k] / 6);
      BK.px[n] = x / MS + g.mox;
      BK.py[n] = y / MS + g.moy;
      BK.pz[n] = (h - 0.35) * 60;
      BK.pb[n] = 0.55 + 0.45 * h;
      n++;
    }
  }
  BK.n = n;
  return g;
};

S.reset = function () { BK.n = 0; BK.focus = 0; };
S.onLine = function () { };

S.draw = function () {
  const g = glyph;
  const r = bkIce[0], gg = bkIce[1], bb = bkIce[2];
  const rev = 0.5 + 0.5 * reveal;
  const amp = RM ? 0.40 : 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = bkBg;
  ctx.fillRect(0, 0, W, H);

  /* 背景里几团更远的虚焦光斑（大、暗、慢慢飘） */
  if (BK.spb) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const s1 = (i * 7919 % 997) / 997, s2 = (i * 40503 % 991) / 991;
      const px = W * (0.08 + s1 * 0.84) + Math.sin(vT * 0.09 + i) * 22;
      const py = H * (0.10 + s2 * 0.80) + Math.cos(vT * 0.07 + i * 2) * 18;
      const rad = 26 + s1 * 46;
      ctx.globalAlpha = 0.05 + 0.05 * s2;
      ctx.drawImage(BK.spb, px - rad, py - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 焦点：在字的前后缓慢来回扫 */
  const focus = Math.sin(vT * 0.33) * 46 * amp;
  BK.focus = focus;

  /* 点光源：离焦量 → 散景半径 */
  if (BK.sp && BK.n) {
    ctx.globalCompositeOperation = 'lighter';
    const n = BK.n;
    for (let i = 0; i < n; i++) {
      let d = BK.pz[i] - focus;
      if (d < 0) d = -d;
      const rad = 2.4 + d * 0.55;
      const a2 = Math.max(0.06, 0.62 / (1 + d * 0.12)) * BK.pb[i] * rev;
      ctx.globalAlpha = a2;
      ctx.drawImage(BK.sp, BK.px[i] - rad, BK.py[i] - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 清晰的底：读得出来永远是第一位的 */
  if (g && g.crisp) {
    ctx.globalAlpha = 0.80 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  /* 光圈刻度：底部一条离焦标尺（HUD，很轻） */
  const barW = Math.min(W * 0.42, 520), barX = VX - barW * 0.5, barY = H - 54;
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + barW, barY);
  ctx.stroke();
  const fpos = barX + barW * (0.5 + focus / (46 * amp || 1) * 0.34);
  ctx.fillStyle = 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 34) + ',' + Math.min(255, bb + 26) + ',0.55)';
  ctx.fillRect(fpos - 1, barY - 5, 2, 10);

  ctx.fillStyle = bkVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.pts = BK.n; o.focus = Math.round(BK.focus); };
