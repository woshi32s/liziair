/*!
title: 百叶窗视差
机制一句话：字在**后面**的一块灯箱玻璃上，前面立着一排竖着的百叶板；相机左右缓移时，
百叶板按近景的速度平移、字按远景的速度只挪一点点 —— **两者的位移差就是深度**。
百叶板还会随视角微微转动：缝隙一张一合，字就从缝里被"切"成一竖条一竖条地露出来，
板子在字上投下的影子也跟着扫过去。空间感来自遮挡与视差，不来自把字做小。

实现要点：
  · 22 块板、每块一个梯形正面 + 侧面 + 板沿高光；缝隙用一个 Path2D 的矩形集做 clip，只裁一次字。
  · 影子：每块板在字层上投一条渐变暗带，偏移量 = 相机位移 × 板子高度。
  · 一切位移都取自 vT：暂停即冻结；RM 时相机摆幅砍到 30%（缝几乎不动，字照样读）。
*/

CFG.maxW = 0.62; CFG.maxH = 0.36;

let lvBg = null, lvVig = null, lvIce = [232, 242, 255];
const LV = { NS: 13 };

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  lvIce = [Math.min(255, Math.round(r * 0.32 + 180)), Math.min(255, Math.round(g * 0.34 + 184)), Math.min(255, Math.round(b * 0.28 + 192))];
  lvBg = ctx.createLinearGradient(0, 0, 0, H);
  lvBg.addColorStop(0, 'rgb(3,4,8)');
  lvBg.addColorStop(0.55, 'rgb(6,7,12)');
  lvBg.addColorStop(1, 'rgb(5,6,10)');
  lvVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.25, VX, VY, Math.min(W, H) * 1.06);
  lvVig.addColorStop(0, 'rgba(0,0,0,0)');
  lvVig.addColorStop(1, 'rgba(1,2,4,0.88)');
};

S.onResize = function () { S.onAccent(); };

S.bake = function (text) {
  return bake(text, { padR: 0.16, padPx: 10, mask: true, glow: 14, glowColor: 'rgba(222,238,255,1)' });
};

S.reset = function () { };

S.draw = function () {
  const g = glyph;
  const r = lvIce[0], gg = lvIce[1], bb = lvIce[2];
  const rev = 0.5 + 0.5 * reveal;
  const amp = RM ? 0.30 : 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = lvBg;
  ctx.fillRect(0, 0, W, H);

  /* 相机横移（慢、幅度小） */
  const pan = Math.sin(vT * 0.23) * 46 * amp;
  const tilt = Math.sin(vT * 0.17 + 0.7) * 0.16 * amp;

  /* 灯箱：字后面那块发光的板（有一点透视） */
  const bw = Math.min(W * 0.86, 1180), bh = Math.min(H * 0.62, 560);
  const bx = VX - bw * 0.5 - pan * 0.10, by = VY - bh * 0.5;
  const plate = ctx.createLinearGradient(bx, by, bx, by + bh);
  plate.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.030)');
  plate.addColorStop(0.5, 'rgba(' + r + ',' + gg + ',' + bb + ',0.055)');
  plate.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0.022)');
  ctx.fillStyle = plate;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);

  /* 板：几何先算好，字要按缝隙裁 */
  const NS = LV.NS;
  const period = W / NS;
  const slatW = period * 0.42;
  const open = 0.44 + 0.10 * Math.cos(tilt);
  const gapW = period * 0.58;
  const shift = pan * 1.0;

  /* 字：远景，位移只有相机的 0.18 倍 */
  if (g && g.crisp) {
    const tx = g.gx - pan * 0.18, ty = g.gy - pan * 0.03;
    ctx.save();
    const gp = new Path2D();
    for (let i = -1; i <= NS; i++) {
      const x0 = i * period + shift + (period - gapW) * 0.5;
      gp.rect(x0, 0, gapW, H);
    }
    ctx.clip(gp);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42 * rev;
    ctx.drawImage(g.glow, tx - g.bw * 0.03, ty - g.bh * 0.03, g.bw * 1.06, g.bh * 1.06);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.97 * rev;
    ctx.drawImage(g.crisp, tx, ty, g.bw, g.bh);

    /* 板的影子落在字上：只做一层很轻的暗压（别把字压死） */
    ctx.globalCompositeOperation = 'multiply';
    for (let i = -1; i <= NS; i++) {
      const x0 = i * period + shift * 1.55;
      const sg = ctx.createLinearGradient(x0, 0, x0 + slatW * 1.1, 0);
      sg.addColorStop(0, 'rgba(96,104,118,1)');
      sg.addColorStop(0.7, 'rgba(170,178,192,1)');
      sg.addColorStop(1, 'rgba(226,232,242,1)');
      ctx.fillStyle = sg;
      ctx.fillRect(x0, 0, slatW * 1.1, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 百叶板本体：正面 + 侧面 + 板沿高光 */
  for (let i = -1; i <= NS; i++) {
    const x0 = i * period + shift - slatW * 0.5;
    const faceW = slatW * (0.55 + 0.45 * Math.abs(Math.cos(tilt)));
    const sideW = slatW * 0.42 * Math.sin(tilt);
    const fg = ctx.createLinearGradient(x0, 0, x0 + faceW, 0);
    fg.addColorStop(0, 'rgba(9,11,16,0.97)');
    fg.addColorStop(0.35, 'rgba(15,18,25,0.97)');
    fg.addColorStop(0.78, 'rgba(22,26,35,0.97)');
    fg.addColorStop(1, 'rgba(30,36,48,0.97)');
    ctx.fillStyle = fg;
    ctx.fillRect(x0, 0, faceW, H);
    /* 侧面（转向时露出来的那一窄条） */
    if (Math.abs(sideW) > 0.6) {
      ctx.fillStyle = 'rgba(' + Math.min(255, r + 10) + ',' + Math.min(255, gg + 10) + ',' + Math.min(255, bb + 14) + ',0.10)';
      ctx.fillRect(sideW > 0 ? x0 + faceW : x0 + sideW, 0, Math.abs(sideW), H);
    }
    /* 板沿高光 */
    ctx.fillStyle = 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 40) + ',' + Math.min(255, bb + 40) + ',0.16)';
    ctx.fillRect(x0 + faceW - 1.2, 0, 1.2, H);
  }

  /* 上下两道横梁，把百叶窗框住 */
  const railY = [by - 26, by + bh + 26];
  for (let q = 0; q < 2; q++) {
    ctx.fillStyle = 'rgba(8,10,15,0.98)';
    ctx.fillRect(0, railY[q] - 14, W, 28);
    ctx.fillStyle = 'rgba(' + Math.min(255, r + 30) + ',' + Math.min(255, gg + 30) + ',' + Math.min(255, bb + 34) + ',0.10)';
    ctx.fillRect(0, railY[q] + (q ? 13 : -14), W, 1);
  }

  ctx.fillStyle = lvVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.slats = LV.NS; };
