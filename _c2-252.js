/*!
title: 柱面卷绕
机制一句话：整句字被**卷在一只竖立的圆鼓面上** —— 横向坐标变成圆周角（θ = x/R），
于是每一竖条的屏幕宽度按 cosθ 压扁、亮度按 n·L 变暗（曲面因此有明暗过渡），
θ 超过 90° 的部分转到鼓背、直接被背面剔除。鼓很慢地来回转，字跟着在曲面上滑动；
上下两道椭圆鼓沿、一圈刻度、一条扫过鼓面的高光，交代出这是一只**圆柱**而不是一张纸。

实现要点：
  · 换句时裁字（预烘 crisp）；帧里把字按 4px 一条竖切成 ~200 条，逐条按 cosθ 缩放贴回去，
    亮度用 globalAlpha 调制（深底 + lighter，所以等价于加光）。
  · 一切随时间量取自 vT：暂停即冻结；RM 时把转动幅度砍到 35%（字仍然正对）。
  · 空歌词：只剩一只亮着边沿的空鼓，刻度还在转。
*/

CFG.maxW = 0.62; CFG.maxH = 0.40;

let cwBg = null, cwVig = null;
let cwAcc = [214, 228, 255];

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  cwAcc = [Math.min(255, Math.round(r * 0.36 + 168)), Math.min(255, Math.round(g * 0.34 + 176)), Math.min(255, Math.round(b * 0.28 + 186))];
  cwBg = ctx.createLinearGradient(0, 0, 0, H);
  cwBg.addColorStop(0, 'rgb(4,5,10)');
  cwBg.addColorStop(0.5, 'rgb(6,8,14)');
  cwBg.addColorStop(1, 'rgb(8,9,15)');
  cwVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.26, VX, VY, Math.min(W, H) * 1.05);
  cwVig.addColorStop(0, 'rgba(0,0,0,0)');
  cwVig.addColorStop(1, 'rgba(1,2,4,0.84)');
};

S.onResize = function () { S.onAccent(); };

S.bake = function (text) {
  return bake(text, {
    padR: 0.16, padPx: 10, mask: true,
    glow: 12, glowColor: 'rgba(226,236,255,1)'
  });
};

S.reset = function () { };

/* 鼓面法线朝前：θ=0 正对观众，θ<0 偏左 */
const CW_L = { x: -0.38, y: -0.30, z: 0.88 };

S.draw = function () {
  const g = glyph;
  const r = cwAcc[0], gg = cwAcc[1], bb = cwAcc[2];
  const rev = 0.45 + 0.55 * reveal;
  const amp = RM ? 0.35 : 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = cwBg;
  ctx.fillRect(0, 0, W, H);

  const cx = VX;
  const hasG = !!(g && g.crisp);
  const bh = hasG ? g.bh : Math.min(H * 0.34, 300);
  const bw = hasG ? g.bw : Math.min(W * 0.6, 820);
  const gy = hasG ? g.gy : VY - bh * 0.5;
  const Rc = bw * 0.60;
  const spin = 0.072 * amp * Math.sin(vT * 0.23) + 0.016 * amp * Math.sin(vT * 0.07 + 1.3);

  /* 鼓身：一块从背后透出来的柱面光（左前亮、右边暗） */
  const bodyTop = gy + bh * 0.05, bodyH = bh * 0.90;
  const cg = ctx.createLinearGradient(cx - Rc * 0.95, 0, cx + Rc * 0.95, 0);
  cg.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0.020)');
  cg.addColorStop(0.26, 'rgba(' + r + ',' + gg + ',' + bb + ',0.075)');
  cg.addColorStop(0.5, 'rgba(' + r + ',' + gg + ',' + bb + ',0.038)');
  cg.addColorStop(0.8, 'rgba(' + r + ',' + gg + ',' + bb + ',0.016)');
  cg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0.008)');
  ctx.fillStyle = cg;
  ctx.fillRect(cx - Rc, bodyTop, Rc * 2, bodyH);

  /* 刻度环：一圈细刻度，随鼓转（这是"鼓在转"的唯一硬证据） */
  const ry2 = Rc * 0.125;
  const tickA = gy + bh * 0.045, tickB = gy + bh * 0.955;
  ctx.lineWidth = 1;
  for (let k = 0; k < 72; k++) {
    const th = k / 72 * Math.PI * 2 + vT * 0.42;
    const c = Math.cos(th), s = Math.sin(th);
    if (c <= 0.04) continue;
    const px = cx + Rc * s;
    const al = 0.05 + 0.16 * c;
    ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',' + al.toFixed(3) + ')';
    const long = (k % 6 === 0) ? 1 : 0.55;
    ctx.beginPath();
    ctx.moveTo(px, tickA);
    ctx.lineTo(px, tickA + ry2 * 1.5 * long);
    ctx.moveTo(px, tickB);
    ctx.lineTo(px, tickB - ry2 * 1.5 * long);
    ctx.stroke();
  }

  /* ── 字：逐竖条绕轴贴到鼓面上 ── */
  if (hasG && g.mask) {
    const step = bw > 900 ? 5 : 4;
    const oy = gy, oh = bh;
    const src = g.crisp, sw = src.width / DPR, sh = src.height / DPR;
    ctx.globalCompositeOperation = 'lighter';
    const n = Math.min(320, Math.ceil(sw / step));
    for (let i = 0; i < n; i++) {
      const x0 = i * step;
      const xw = x0 + step * 0.5;
      const th = (xw - sw * 0.5) / Rc + spin;
      const c = Math.cos(th), s = Math.sin(th);
      if (c <= 0.05) continue;
      /* 法线 n=(sinθ,0,cosθ) 与光向量的点积 → 柱面明暗 */
      let dif = s * CW_L.x + c * CW_L.z;
      if (dif < 0) dif = 0;
      const w = step * c;
      const px = cx + Rc * s;
      ctx.globalAlpha = Math.min(1, (0.30 + 0.92 * dif) * rev);
      ctx.drawImage(src, x0 * DPR, 0, Math.min(step, sw - x0) * DPR, src.height,
        px - w * 0.5, oy, Math.max(0.6, w), oh);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* 鼓面高光：一道竖着的柔光，压在字上 —— 字在玻璃后面 */
    const hx = cx + Rc * Math.sin(-0.55 + spin * 0.4);
    const hg2 = ctx.createLinearGradient(hx - 60, 0, hx + 60, 0);
    hg2.addColorStop(0, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 30) + ',0)');
    hg2.addColorStop(0.5, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 30) + ',' + (0.075 * rev).toFixed(3) + ')');
    hg2.addColorStop(1, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, gg + 36) + ',' + Math.min(255, bb + 30) + ',0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hg2;
    ctx.fillRect(hx - 70, bodyTop, 140, bodyH);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── 上下鼓沿：两道椭圆，把"圆柱"这件事钉死 ── */
  const rim = function (y, alpha) {
    const cr = Math.min(255, r + 26), cg2 = Math.min(255, gg + 26), cb = Math.min(255, bb + 26);
    /* 远端半圈（转到鼓背的那一半）很淡 */
    ctx.strokeStyle = 'rgba(' + cr + ',' + cg2 + ',' + cb + ',' + (alpha * 0.30).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, y, Rc, ry2, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    /* 近端半圈朝向观众：亮，带一圈内壁的薄光 */
    ctx.strokeStyle = 'rgba(' + cr + ',' + cg2 + ',' + cb + ',' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, y, Rc, ry2, 0, 0, Math.PI);
    ctx.stroke();
    const ig = ctx.createLinearGradient(0, y - ry2 * 0.2, 0, y + ry2 * 1.7);
    ig.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',' + (alpha * 0.40).toFixed(3) + ')');
    ig.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(cx, y, Rc, ry2, 0, 0, Math.PI);
    ctx.fill();
  };
  rim(tickA, 0.30);
  rim(tickB, 0.42);

  /* 鼓的左右轮廓线：从两道鼓沿连下来的母线 */
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - Rc, tickA);
  ctx.lineTo(cx - Rc, tickB);
  ctx.moveTo(cx + Rc, tickA);
  ctx.lineTo(cx + Rc, tickB);
  ctx.stroke();

  ctx.fillStyle = cwVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.drum = 1;
};
