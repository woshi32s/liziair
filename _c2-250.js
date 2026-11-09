/*!
title: 薄透镜光路
机制一句话：字是一块**会发光的物**，摆在一张光学平台上；一块薄透镜按 1/f = 1/u + 1/v
把它成像到右侧的像面上 —— 像是**倒立的实像**，放大率 m = v/u 由物距与焦距算出来。
焦距每几秒轻微呼吸一次，像距跟着变，像面于是慢慢离焦（弥散圆按 |v-像面|/v 长大）；
同时画出三条真实的主光线（平行光折向像方焦点、过光心的直线、过物方焦点的出射平行），
它们在像点相交 —— 空间感来自"光走了多远、在哪里重新聚拢"，而不是把字做大。

实现要点：
  · 物/像两块字形都是预烘好的位图；失焦时切成 3 档预烘模糊层，帧里只 drawImage。
  · 每帧只是一条轴线 + 6 条折线 + 2 次贴图 + 40 粒浮尘，帧预算极松。
  · 暂停即冻结（一切随时间量都取自 vT）；RM 时把焦距呼吸幅度压到 40%。
*/

CFG.maxW = 0.36; CFG.maxH = 0.32;

let lbBg = null, lbVig = null, lbBench = null;
let lbCone = null, lbLensGrad = null;
let lbAcc = [255, 226, 190];
const LBS = { ox: 0, oy: 0, ow: 0, oh: 0, ix: 0, iy: 0, iw: 0, ih: 0, v: 0, u: 0, f: 0, axisY: 0, lensX: 0 };

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  lbAcc = [Math.min(255, Math.round(r * 0.70 + 74)), Math.min(255, Math.round(g * 0.66 + 66)), Math.min(255, Math.round(b * 0.54 + 44))];
  lbBg = ctx.createLinearGradient(0, 0, 0, H);
  lbBg.addColorStop(0, 'rgb(4,5,9)');
  lbBg.addColorStop(0.55, 'rgb(7,8,14)');
  lbBg.addColorStop(1, 'rgb(10,9,12)');
  lbVig = ctx.createRadialGradient(W * 0.52, H * 0.48, Math.min(W, H) * 0.30, W * 0.52, H * 0.48, Math.min(W, H) * 1.05);
  lbVig.addColorStop(0, 'rgba(0,0,0,0)');
  lbVig.addColorStop(1, 'rgba(2,3,6,0.86)');
};

S.onResize = function () { S.onAccent(); };

S.bake = function (text) {
  return bake(text, {
    padR: 0.18, padPx: 12,
    blur: [3, 7, 13], blurColor: 'rgba(255,238,214,1)',
    glow: 9, glowColor: 'rgba(255,230,196,1)'
  });
};

S.reset = function () { LBS.ow = 0; };

/* 几何：由 f 与 u 解出像距 v、放大率 m */
function lbSolve() {
  const g = glyph;
  const axisY = VY + H * 0.02;
  const lensX = W * 0.50;
  const u = Math.min(W * 0.30, 460);
  const amp = RM ? 0.40 : 1;
  const f = u * 0.355 * (1 + 0.105 * amp * Math.sin(vT * 0.42));
  const v = u * f / (u - f);
  const m = v / u;

  let ow = 0, oh = 0;
  if (g) {
    const boxW = Math.min(W * 0.34, 520);
    const boxH = H * 0.30;
    const s = Math.min(boxW / g.bw, boxH / g.bh);
    ow = g.bw * s; oh = g.bh * s;
  }
  LBS.axisY = axisY; LBS.lensX = lensX; LBS.u = u; LBS.f = f; LBS.v = v;
  LBS.ow = ow; LBS.oh = oh;
  LBS.ox = lensX - u - ow * 0.5 - 4;
  LBS.oy = axisY - oh * 0.5;
  LBS.iw = ow * m; LBS.ih = oh * m;
  LBS.ix = lensX + v;
  LBS.iy = axisY;
  return m;
}

S.draw = function () {
  const g = glyph;
  const m = lbSolve();
  const { axisY, lensX, u, f, v, ox, oy, ow, oh, ix, iy, iw, ih } = LBS;
  const xp = lensX - u;
  const rev = 0.5 + 0.5 * reveal;
  const r = lbAcc[0], gg = lbAcc[1], bb = lbAcc[2];

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = lbBg;
  ctx.fillRect(0, 0, W, H);

  /* 平台：一条极暗的水平台面，交代光轴躺在什么上 */
  const bench = ctx.createLinearGradient(0, axisY - 2, 0, axisY + H * 0.20);
  bench.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.055)');
  bench.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  ctx.fillStyle = bench;
  ctx.fillRect(0, axisY - 2, W, H * 0.20);

  /* ── 台面 + 三根立柱（物 / 透镜 / 像面各站一根）：给光轴一个地平面 ── */
  const floorY = axisY + H * 0.27;
  const fl2 = ctx.createLinearGradient(0, axisY + 6, 0, floorY);
  fl2.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.00)');
  fl2.addColorStop(0.72, 'rgba(' + r + ',' + gg + ',' + bb + ',0.030)');
  fl2.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0.075)');
  ctx.fillStyle = fl2;
  ctx.fillRect(0, axisY + 6, W, floorY - axisY - 6);
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, floorY + 0.5);
  ctx.lineTo(W, floorY + 0.5);
  ctx.stroke();
  const post = (px2, tall) => {
    if (px2 < -20 || px2 > W + 20) return;
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.11)';
    ctx.beginPath();
    ctx.moveTo(px2 + 0.5, axisY + 8);
    ctx.lineTo(px2 + 0.5, floorY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.07)';
    ctx.beginPath();
    ctx.ellipse(px2, floorY, tall ? 16 : 11, tall ? 3.4 : 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  post(xp, true);
  post(lensX, true);
  if (g && ow > 0) post(ix, true);

  /* ── 光轴 ── */
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.16)';  ctx.lineWidth = 1;
  ctx.setLineDash([2, 9]);
  ctx.beginPath();
  ctx.moveTo(W * 0.02, axisY);
  ctx.lineTo(W * 0.985, axisY);
  ctx.stroke();
  ctx.setLineDash([]);

  /* ── 像方光锥：从透镜口径收到像点 ── */
  const ap = Math.min(H * 0.30, 250) * 0.5;
  if (g && ow > 0) {
    const cone = ctx.createLinearGradient(lensX, 0, ix, 0);
    cone.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.085)');
    cone.addColorStop(0.72, 'rgba(' + r + ',' + gg + ',' + bb + ',0.028)');
    cone.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0.10)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(lensX, axisY - ap);
    ctx.lineTo(ix, iy - ih * 0.30);
    ctx.lineTo(ix, iy + ih * 0.30);
    ctx.lineTo(lensX, axisY + ap);
    ctx.closePath();
    ctx.fill();

    /* ── 主光线：3 个物点 × 2 条（平行→像方焦点；过光心→不变向） ── */
    const pts = [axisY - oh * 0.40, axisY, axisY + oh * 0.40];
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      const py = pts[i];
      const ipy = axisY + (axisY - py) * m;      /* 倒像 */
      /* A：平行于光轴 → 折射后过像方焦点 F' */
      ctx.strokeStyle = 'rgba(' + Math.min(255, r + 30) + ',' + gg + ',' + Math.max(0, bb - 20) + ',' + (0.38 * rev).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(xp + 6, py);
      ctx.lineTo(lensX, py);
      ctx.lineTo(ix + 30, py + (axisY - py) * (v + 30) / f);
      ctx.stroke();
      /* B：过光心 → 直线 */
      ctx.strokeStyle = 'rgba(' + Math.min(255, r + 20) + ',' + Math.min(255, gg + 18) + ',' + Math.min(255, bb + 20) + ',' + (0.22 * rev).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(xp + 6, py);
      ctx.lineTo(lensX, axisY);
      ctx.lineTo(ix + 30, axisY + (axisY - py) * (v + 30) / u);
      ctx.stroke();
      /* 交点处一个小亮点：三线确实聚在这里 */
      const rg = ctx.createRadialGradient(ix, ipy, 0, ix, ipy, 12);
      rg.addColorStop(0, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 30) + ',' + Math.min(255, bb + 20) + ',0.55)');
      rg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
      ctx.fillStyle = rg;
      ctx.fillRect(ix - 12, ipy - 12, 24, 24);
    }
  }

  /* ── 物：一块自发光的字牌 ── */
  if (g && ow > 0) {
    const ga = ctx.createRadialGradient(ox + ow * 0.5, oy + oh * 0.5, 0, ox + ow * 0.5, oy + oh * 0.5, Math.max(ow, oh) * 0.72);
    ga.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.16)');
    ga.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    ctx.fillStyle = ga;
    ctx.fillRect(ox - ow * 0.3, oy - oh * 0.3, ow * 1.6, oh * 1.6);

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 * rev;
    ctx.drawImage(g.glow, ox - ow * 0.06, oy - oh * 0.06, ow * 1.12, oh * 1.12);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(g.crisp, ox, oy, ow, oh);

    /* ── 像：倒立实像（旋转 180°），离焦时换模糊层 ── */
    ctx.fillStyle = 'rgba(255,255,255,0.020)';
    ctx.fillRect(ix - iw * 0.62, iy - ih * 0.68, iw * 1.24, ih * 1.36);
    ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.055)';
    ctx.fillRect(ix - iw * 0.62, iy - ih * 0.68, iw * 1.24, 1);
    ctx.fillRect(ix - iw * 0.62, iy + ih * 0.68, iw * 1.24, 1);
    const planeOff = 1 + 0.11 * (RM ? 0.4 : 1) * Math.sin(vT * 0.27 + 1.7);
    const blurPx = Math.abs(v * planeOff - v) / Math.max(1, v) * 26;
    let img = g.crisp, layAlpha = 0.62 * rev;
    if (blurPx > 1.6 && g.soft && g.soft.length) {
      const k = blurPx < 5 ? 0 : (blurPx < 11 ? 1 : 2);
      img = g.soft[k];
      layAlpha = (0.62 - k * 0.09) * rev;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0.10, layAlpha);
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, -iw * 0.5, -ih * 0.5, iw, ih);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* 像面那道细线 */
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.10)';
    ctx.beginPath();
    ctx.moveTo(ix, iy - ih * 0.62);
    ctx.lineTo(ix, iy + ih * 0.62);
    ctx.stroke();
  }

  /* ── 物方/像方焦点记号 ── */
  const fl = (x, tag) => {
    if (x < 0 || x > W) return;
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.34)';
    ctx.beginPath();
    ctx.moveTo(x, axisY - 5);
    ctx.lineTo(x, axisY + 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.42)';
    ctx.fillRect(x - 1, axisY - 1, 2, 2);
    if (tag) {
      ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.30)';
      ctx.font = '500 10px ui-monospace,Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tag, x, axisY + 9);
    }
  };
  fl(lensX - f, 'F');
  fl(lensX + f, "F'");

  /* ── 透镜：一片立着的玻璃，边缘起光 ── */
  const lensH = Math.min(H * 0.34, 300);
  const lg = ctx.createLinearGradient(lensX - 16, 0, lensX + 16, 0);
  lg.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  lg.addColorStop(0.42, 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 30) + ',' + Math.min(255, bb + 34) + ',0.20)');
  lg.addColorStop(0.5, 'rgba(' + Math.min(255, r + 60) + ',' + Math.min(255, gg + 60) + ',' + Math.min(255, bb + 66) + ',0.34)');
  lg.addColorStop(0.58, 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 30) + ',' + Math.min(255, bb + 34) + ',0.20)');
  lg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.ellipse(lensX, axisY, Math.max(7, lensH * 0.055), lensH * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(' + Math.min(255, r + 50) + ',' + Math.min(255, gg + 52) + ',' + Math.min(255, bb + 60) + ',0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(lensX, axisY, Math.max(7, lensH * 0.055), lensH * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  /* 浮尘：只在这一段光路里飘，给"距离"一点尺度 */
  ctx.fillStyle = 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 30) + ',0.30)';
  const t = vT;
  for (let i = 0; i < 46; i++) {
    const sd = (i * 2654435761) % 1000 / 1000;
    const sd2 = (i * 40503) % 997 / 997;
    const span = Math.max(60, ix + 40 - (lensX - 40));
    const px = lensX - 40 + ((sd * span + t * (6 + sd2 * 16)) % span);
    const py = axisY + (sd2 - 0.5) * Math.min(H * 0.26, 210) * (0.3 + sd * 0.7) + Math.sin(t * 0.7 + i) * 3;
    const s = 0.7 + sd * 1.5;
    ctx.fillRect(px, py, s, s);
  }
  ctx.globalCompositeOperation = 'source-over';

  /* ── 空歌词：光锥里一道很慢的光脉冲，沿光轴走 ── */
  if (!g) {
    const ph = (vT * 0.22) % 1;
    const px = lensX - 40 + ph * (ix + 40 - (lensX - 40));
    const pr = 90;
    const pg = ctx.createRadialGradient(px, axisY, 0, px, axisY, pr);
    pg.addColorStop(0, 'rgba(' + Math.min(255, r + 50) + ',' + Math.min(255, gg + 44) + ',' + Math.min(255, bb + 30) + ',0.16)');
    pg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = pg;
    ctx.fillRect(px - pr, axisY - pr, pr * 2, pr * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.fillStyle = lbVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.v = +LBS.v.toFixed(1);
  o.m = +(LBS.v / Math.max(1, LBS.u)).toFixed(2);
};
