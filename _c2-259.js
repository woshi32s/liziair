/*!
title: 帷幕投影
机制一句话：字不是画在屏幕上的，是**投影仪**投在一块有竖褶的布幕上 ——
褶皱的表面法线 n(x) 决定该处收多少光（n·L），亮的地方是正面迎光的褶脊、暗的是背光的褶谷；
布幕的上下缘跟着褶皱起伏，投影仪的镜筒在最左边，光锥里飘着灰。
于是画面里的字只是一片被**弯曲表面**接住的光，而不是贴图。

实现要点：
  · 褶皱 = 三重不同波长的正弦叠加（相位随 vT 漂移），每 6px 取一次法线，画成一条条竖带。
  · 字与竖带是同构的：字用一次 drawImage 贴（整幅、无缝），再把同一组褶皱以 multiply 压上去，
    所以字面上也有明暗起伏 —— 折一次，字的边缘跟着歪一点。
  · 帧里约 90 次 fillRect + 1 次 drawImage；暂停即冻结，RM 时褶皱漂移几乎停住。
*/

CFG.maxW = 0.60; CFG.maxH = 0.34;

const CP = { bands: 44 };
let cpBg = null, cpVig = null, cpIce = [226, 240, 255];
let cpL = [0.62, -0.32, 0.72];

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  cpIce = [Math.min(255, Math.round(r * 0.34 + 172)), Math.min(255, Math.round(g * 0.34 + 178)), Math.min(255, Math.round(b * 0.28 + 186))];
  cpBg = ctx.createLinearGradient(0, 0, 0, H);
  cpBg.addColorStop(0, 'rgb(3,4,8)');
  cpBg.addColorStop(0.55, 'rgb(6,7,12)');
  cpBg.addColorStop(1, 'rgb(4,5,9)');
  cpVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.26, VX, VY, Math.min(W, H) * 1.05);
  cpVig.addColorStop(0, 'rgba(0,0,0,0)');
  cpVig.addColorStop(1, 'rgba(1,2,4,0.86)');
};

S.onResize = function () { S.onAccent(); };

S.bake = function (text) {
  return bake(text, { padR: 0.16, padPx: 10, mask: true, glow: 13, glowColor: 'rgba(222,238,255,1)' });
};

S.reset = function () { };

/* 褶皱的高度相位（只用 vT，所以暂停就停） */
function cpFold(x, t) {
  return Math.sin(x * 0.021 + t * 0.32) * 0.55
    + Math.sin(x * 0.047 - t * 0.21 + 1.7) * 0.28
    + Math.sin(x * 0.009 + t * 0.13 + 0.4) * 0.17;
}

S.draw = function () {
  const g = glyph;
  const r = cpIce[0], gg = cpIce[1], bb = cpIce[2];
  const rev = 0.5 + 0.5 * reveal;
  const t = vT * (RM ? 0.25 : 1);
  const NB = CP.bands, bwid = W / NB;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = cpBg;
  ctx.fillRect(0, 0, W, H);

  /* 布幕本底：一块被微弱环境光照着的布 */
  const clothTop = H * 0.14, clothBot = H * 0.92;
  ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.020)';
  ctx.fillRect(0, clothTop, W, clothBot - clothTop);

  /* 字：一次贴整幅（无缝），再加一点整体的透视斜切 */
  if (g && g.crisp) {
    ctx.save();
    const sk = Math.sin(t * 0.12) * 0.02;
    ctx.setTransform(DPR, sk * DPR, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.46 * rev;
    ctx.drawImage(g.glow, g.gx - g.bw * 0.03, g.gy - g.bh * 0.03, g.bw * 1.06, g.bh * 1.06);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.90 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* 褶皱：一条条竖带，正面迎光的提亮、背光的压暗（先加后乘，等于 n·L 打光） */
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < NB; i++) {
    const x = i * bwid + bwid * 0.5;
    const h0 = cpFold(x - bwid, t), h1 = cpFold(x + bwid, t);
    const slope = (h1 - h0);                      /* 法线的 x 分量 */
    const nl = 1 / Math.sqrt(1 + slope * slope);
    const nx = -slope * nl, nz = nl;
    let dif = nx * cpL[0] + nz * cpL[2];
    if (dif < 0) dif = 0;
    const a2 = dif * dif * 0.24;
    if (a2 > 0.004) {
      const cg = ctx.createLinearGradient(0, clothTop, 0, clothBot);
      cg.addColorStop(0, 'rgba(' + Math.min(255, r + 20) + ',' + Math.min(255, gg + 18) + ',' + Math.min(255, bb + 14) + ',' + a2.toFixed(3) + ')');
      cg.addColorStop(0.5, 'rgba(' + Math.min(255, r + 32) + ',' + Math.min(255, gg + 28) + ',' + Math.min(255, bb + 20) + ',' + (a2 * 1.35).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(' + Math.min(255, r + 20) + ',' + Math.min(255, gg + 18) + ',' + Math.min(255, bb + 14) + ',0)');
      ctx.fillStyle = cg;
      ctx.fillRect(i * bwid, clothTop, bwid + 1, clothBot - clothTop);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  /* 背光的褶谷：用 multiply 压暗，字面上也有起伏 */
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < NB; i++) {
    const x = i * bwid + bwid * 0.5;
    const slope = cpFold(x + bwid, t) - cpFold(x - bwid, t);
    const nl = 1 / Math.sqrt(1 + slope * slope);
    const nx = -slope * nl, nz = nl;
    let dif = nx * cpL[0] + nz * cpL[2];
    if (dif < 0) dif = 0;
    const shade = 1 - dif * 0.42;
    if (shade < 0.98) {
      const v = Math.round(255 - 255 * (1 - shade) * 0.62);
      ctx.fillStyle = 'rgb(' + v + ',' + Math.min(255, v + 3) + ',' + Math.min(255, v + 8) + ')';
      ctx.fillRect(i * bwid, clothTop, bwid + 1, clothBot - clothTop);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  /* 布幕的上下缘：跟着褶皱起伏（这是"布"的轮廓） */
  ctx.beginPath();
  ctx.moveTo(0, clothTop);
  for (let i = 0; i <= NB; i++) {
    const x = i * bwid;
    ctx.lineTo(x, clothTop + cpFold(x, t) * 8);
  }
  for (let i = NB; i >= 0; i--) {
    const x = i * bwid;
    ctx.lineTo(x, clothBot + cpFold(x + 40, t) * 16);
  }
  ctx.closePath();
  /* 只用这条轮廓描边：整块填黑会把幕内的字一起盖掉 */
  ctx.strokeStyle = 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 26) + ',' + Math.min(255, bb + 20) + ',0.13)';
  ctx.lineWidth = 1;
  ctx.stroke();
  /* 幕外的上下两条压暗 */
  ctx.fillStyle = 'rgba(2,3,5,0.55)';
  ctx.fillRect(0, 0, W, clothTop);
  ctx.fillRect(0, clothBot + 8, W, H - clothBot);

  /* 投影仪：左边一个小镜筒 + 一束光锥 */
  const lx = W * 0.045, ly = VY - 40;
  const cone = ctx.createLinearGradient(lx, ly, W * 0.55, VY);
  cone.addColorStop(0, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 34) + ',' + Math.min(255, bb + 26) + ',0.13)');
  cone.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(lx + 16, ly - 4);
  ctx.lineTo(W * 0.62, VY - H * 0.30);
  ctx.lineTo(W * 0.62, VY + H * 0.26);
  ctx.lineTo(lx + 16, ly + 4);
  ctx.closePath();
  ctx.fill();
  /* 灰：光锥里漂的尘埃 */
  ctx.fillStyle = 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 30) + ',0.22)';
  for (let i = 0; i < 34; i++) {
    const s1 = (i * 7919 % 997) / 997, s2 = (i * 40503 % 991) / 991;
    const px = lx + 20 + ((s1 * 0.52 * W + t * (5 + s2 * 12)) % (W * 0.52));
    const spread = (px - lx) / (W * 0.52);
    const py = ly + (s2 - 0.5) * 90 * spread + Math.sin(t * 0.6 + i) * 5;
    ctx.fillRect(px, py, 1.2 + s1, 1.2 + s1);
  }
  ctx.globalCompositeOperation = 'source-over';
  /* 镜筒 */
  ctx.fillStyle = 'rgba(10,12,17,0.95)';
  ctx.fillRect(lx, ly - 12, 16, 24);
  ctx.fillStyle = 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 26) + ',0.55)';
  ctx.fillRect(lx + 13, ly - 7, 3, 14);

  ctx.fillStyle = cpVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.bands = CP.bands; };
