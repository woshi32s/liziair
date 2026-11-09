/*!
title: 结构光扫描
机制一句话：一排**等距条纹**被投影到字的浮雕上（字的厚度 = 笔画内距离场），
条纹在笔画边缘被"顶"得往下弯 —— 这就是结构光三维扫描的全部秘密：形变里带着深度。
每一条弯折的亮线就是一个采样；一条"扫描带"从上往下扫过，扫到的地方点云被点亮，
于是你看到的不是画出来的字，而是**被量出来的表面**。

实现要点：
  · 换句时把"弯折条纹"预烘成一张只有字盒那么大的贴图（每像素查一次笔画内距离场）。
  · 帧里只做：贴图带相位偏移贴一次 + 一条扫描带 + 预先采好的点云按高度分两批画。
  · 相位只在 vT 上推进：暂停即冻结；RM 时把条纹漂移与扫描带速度减半。
*/

CFG.maxW = 0.62; CFG.maxH = 0.40; CFG.vy = 0.54;

const SL = {
  cv: null, g2: null, ox: 0, oy: 0, w: 0, h: 0,
  px: null, py: null, ph: null, pn: 0, ph0: null, ph1: null, n0: 0, n1: 0
};
let slBg = null, slVig = null, slIce = [226, 240, 255];
const SL_PERIOD = 11;

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  slIce = [Math.min(255, Math.round(r * 0.34 + 176)), Math.min(255, Math.round(g * 0.36 + 180)), Math.min(255, Math.round(b * 0.30 + 188))];
  slBg = ctx.createLinearGradient(0, 0, 0, H);
  slBg.addColorStop(0, 'rgb(3,4,8)');
  slBg.addColorStop(0.6, 'rgb(6,7,12)');
  slBg.addColorStop(1, 'rgb(7,8,13)');
  slVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.26, VX, VY, Math.min(W, H) * 1.05);
  slVig.addColorStop(0, 'rgba(0,0,0,0)');
  slVig.addColorStop(1, 'rgba(1,2,4,0.86)');
};

S.onResize = function () { S.onAccent(); };

/* 换句时：预烘条纹贴图 + 点云 */
S.bake = function (text) {
  const g = bake(text, { padR: 0.18, padPx: 12, mask: true, inner: true, capInner: 22, glow: 10, glowColor: 'rgba(220,236,255,1)' });
  if (!g || !g.dfi || !g.mask) return g;
  /* 条纹贴图：分辨率取 mask 级，只有字盒大小 */
  const w = g.mw, h = g.mh;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cg = c.getContext('2d');
  const img = cg.createImageData(w, h);
  const d = img.data;
  const K = 1.35;                       /* 条纹被高度顶弯的系数 */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const hv = g.mask[k] ? Math.min(1, g.dfi[k] / 7) : 0;
      const yy = y - hv * K * SL_PERIOD * 0.85;
      let f = yy / SL_PERIOD;
      f = f - Math.floor(f);
      let v = 1 - Math.abs(f - 0.5) * 2;          /* 0..1 三角波 */
      v = v * v * v;                              /* 变细 */
      /* 字上亮、字外暗；再乘一个椭圆窗，让贴图边界化掉 */
      const ex = (x - w * 0.5) / (w * 0.56), ey = (y - h * 0.5) / (h * 0.62);
      let win = 1 - (ex * ex + ey * ey);
      win = win < 0 ? 0 : (win > 0.55 ? 1 : win / 0.55);
      const edge = (hv > 0.02 ? 1 : 0.22) * win;
      const o = k * 4;
      d[o] = 220 * v * edge; d[o + 1] = 236 * v * edge; d[o + 2] = 255 * v * edge;
      d[o + 3] = 235 * win;
      /* 空间不够就直接跳过（避免整屏黑） */
    }
  }
  cg.putImageData(img, 0, 0);
  SL.cv = c; SL.ox = g.mox; SL.oy = g.moy; SL.w = w; SL.h = h;

  /* 点云：每 2 个 mask 像素取一个墨点，按高度分成两批（远/近） */
  const cap = Math.ceil(w * h / 4) + 16;
  if (!SL.px || SL.px.length < cap) {
    SL.px = new Float32Array(cap); SL.py = new Float32Array(cap);
    SL.ph = new Float32Array(cap); SL.ph0 = new Float32Array(cap); SL.ph1 = new Float32Array(cap);
  }
  let n = 0;
  for (let y = 1; y < h; y += 3) {
    for (let x = 1; x < w; x += 3) {
      const k = y * w + x;
      if (!g.mask[k]) continue;
      if (n >= cap) break;
      SL.px[n] = x / MS + g.mox; SL.py[n] = y / MS + g.moy;
      SL.ph[n] = Math.min(1, g.dfi[k] / 7);
      n++;
    }
  }
  SL.pn = n;
  return g;
};

S.reset = function () { SL.pn = 0; SL.cv = null; };
S.onLine = function () { };

S.draw = function () {
  const g = glyph;
  const r = slIce[0], gg = slIce[1], bb = slIce[2];
  const rev = 0.5 + 0.5 * reveal;
  const spd = RM ? 0.5 : 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = slBg;
  ctx.fillRect(0, 0, W, H);

  /* 扫描带：从上往下扫（不用 time，只用 vT） */
  const scanY = ((vT * 0.16 * spd) % 1.35 - 0.18) * H;

  if (SL.cv && g) {
    /* 条纹贴图：相位随 vT 缓慢下移（结构光的相移法） */
    const ph = ((vT * 6 * spd) % SL_PERIOD) / SL_PERIOD * SL_PERIOD;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.62 * rev;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(SL.cv, SL.ox, SL.oy + ph, SL.w / MS, SL.h / MS);
    ctx.drawImage(SL.cv, SL.ox, SL.oy + ph - SL_PERIOD / MS, SL.w / MS, SL.h / MS);

    /* 点云：离扫描带越近越亮（"扫到才点亮"） */
    const n = SL.pn;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const hgt = SL.ph[i];
        if (pass === 0 ? hgt >= 0.5 : hgt < 0.5) continue;
        const px = SL.px[i], py = SL.py[i] + hgt * 7;
        const dScan = Math.abs(py - scanY);
        if (dScan > 150) continue;
        const on = dScan < 70 ? (1 - dScan / 70) : 0;
        const a2 = (0.16 + 0.72 * on) * rev * (pass === 0 ? 0.55 : 1);
        ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',' + a2.toFixed(3) + ')';
        ctx.fillRect(px, py, 1.6, 1.6);
      }
    }

    /* 扫描带本身：一条很亮的光带 + 上下沿 */
    const bgd = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
    bgd.addColorStop(0, 'rgba(' + Math.min(255, r + 26) + ',' + Math.min(255, gg + 22) + ',' + Math.min(255, bb + 16) + ',0)');
    bgd.addColorStop(0.5, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 34) + ',' + Math.min(255, bb + 26) + ',0.16)');
    bgd.addColorStop(1, 'rgba(' + Math.min(255, r + 26) + ',' + Math.min(255, gg + 22) + ',' + Math.min(255, bb + 16) + ',0)');
    ctx.fillStyle = bgd;
    ctx.fillRect(0, scanY - 40, W, 80);
    ctx.globalCompositeOperation = 'source-over';

    /* 可读性保险：一层极淡的清晰字（重建还没扫到的地方也不至于空） */
    ctx.globalAlpha = 0.20 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  /* 顶上的灯条：投影仪在哪 */
  const lg = ctx.createLinearGradient(0, 0, 0, H * 0.16);
  lg.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.10)');
  lg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H * 0.16);

  ctx.fillStyle = slVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.pts = SL.pn; };
