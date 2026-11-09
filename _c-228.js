/*!
title: 等距体素歌词
机制一句话：把当前句的墨迹体素化成一片**等距立柱**（每根柱子的高度 = 它离笔画边缘有多深），
再按"从远到近"逐柱画出侧面与柱顶，配一盏斜上方的主光和一束扫过的光 ——
于是字不是平面上的墨，而是一块从地面长出来的立体浮雕：你能看到柱子的侧壁、柱顶的台阶、
以及柱子投在地上的一层影子。

实现要点：
  · 体素表在换句时算一次（约 1k 根柱子）：笔迹掩码 + 笔画**内部**距离场（chamfer）。
  · 帧里只做"柱子 → 三个四边形"的投影：侧面按高度分三档合批（3 条路径 + 3 次 fill），
    柱顶合成一条路径一次填 —— 所以一千根柱子也只有 4 次 fill，帧预算很松。
  · 高度是 vT 的函数：一道很慢的行波从字上淌过去（暂停即停），RM 时幅度砍到 30%。
  · 影子：换句时预烘一张模糊黑字，压在柱阵下方；因为柱子从影子里"长出来"，
    地面与高度的关系一眼就成立。
  · 空歌词：只留一片地台 + 一盏游走的灯（纯音频视觉）。
*/

/* ───────────────────────── 颜色 / 背景 ───────────────────────── */
let bgGrad = null, vigGrad = null, floorGrad = null;
let ICE = [232, 240, 252];

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  ICE = [Math.min(255, Math.round(r * 0.62 + 132)), Math.min(255, Math.round(g * 0.60 + 138)), Math.min(255, Math.round(b * 0.52 + 146))];
  bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, 'rgb(' + (3 + (r * 0.006 | 0)) + ',' + (4 + (g * 0.007 | 0)) + ',' + (9 + (b * 0.010 | 0)) + ')');
  bgGrad.addColorStop(0.66, 'rgb(' + (6 + (r * 0.014 | 0)) + ',' + (9 + (g * 0.016 | 0)) + ',' + (17 + (b * 0.022 | 0)) + ')');
  bgGrad.addColorStop(1, 'rgb(' + (10 + (r * 0.022 | 0)) + ',' + (14 + (g * 0.024 | 0)) + ',' + (26 + (b * 0.030 | 0)) + ')');
  floorGrad = ctx.createRadialGradient(VX, VY + H * 0.14, 0, VX, VY + H * 0.14, Math.min(W, H) * 0.62);
  floorGrad.addColorStop(0, 'rgba(' + Math.min(255, r + 40) + ',' + Math.min(255, g + 36) + ',' + Math.min(255, b + 26) + ',0.10)');
  floorGrad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
  vigGrad = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.36, VX, VY, Math.min(W, H) * 1.12);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(1, 'rgba(1,2,5,0.74)');
};

S.onResize = function () { S.onAccent(); };

/* ───────────────────────── 预烘 ───────────────────────── */
S.bake = function (text) {
  return bake(text, {
    padR: 0.30, padPx: 20, mask: true, inner: true, capInner: 40,
    shadow: 18, shadowColor: 'rgba(0,0,0,1)',
    glow: 11, glowColor: 'rgb(' + Math.min(255, ACC[0] + 36) + ',' + Math.min(255, ACC[1] + 30) + ',' + Math.min(255, ACC[2] + 16) + ')'
  });
};

/* ───────────────────────── 体素表 ───────────────────────── */
const VS = 7.4;                 /* 柱距（CSS 像素） */
const HMAX = 56;                /* 柱高上限 */
let colX = new Float32Array(0), colY = new Float32Array(0), colH = new Float32Array(0), colN = 0;

function buildVoxels(g) {
  colN = 0;
  if (!g || !g.dfi) return;
  const cap = Math.ceil(g.bw / VS) * Math.ceil(g.bh / VS) + 8;
  if (colX.length < cap) {
    colX = new Float32Array(cap); colY = new Float32Array(cap); colH = new Float32Array(cap);
  }
  const x0 = g.gx + VS * 0.5, y0 = g.gy + VS * 0.5;
  const xe = g.gx + g.bw, ye = g.gy + g.bh;
  for (let y = y0; y < ye; y += VS) {
    for (let x = x0; x < xe; x += VS) {
      if (!inkAt(g, x, y)) continue;
      const d = sampleField(g, g.dfi, x, y);
      if (d < 0) continue;
      if (colN >= colX.length) break;
      colX[colN] = x;
      colY[colN] = y;
      /* 高度：笔画内深度 × 2（CSS）换高度，取 3px 的台阶 —— 体素味就是这么来的 */
      const hh = Math.min(HMAX, 7 + d * 2 * 2.7);
      colH[colN] = Math.max(3, Math.round(hh / 3) * 3);
      colN++;
    }
  }
}

S.onLine = function (i, g) { if (g) buildVoxels(g); else colN = 0; buildHorizon(); };
S.onEmpty = function () { colN = 0; buildHorizon(); };
S.reset = function () { colN = 0; buildHorizon(); };

/* 地平线那道光的渐变：换句/改尺寸时才重建 */
let hzGrad = null, baseY = 0;
function buildHorizon() {
  baseY = (glyph ? glyph.gy + glyph.bh : VY + MN * 0.16) - 4;
  hzGrad = ctx.createLinearGradient(0, baseY - 30, 0, baseY + 34);
  hzGrad.addColorStop(0, 'rgba(' + ACC[0] + ',' + ACC[1] + ',' + ACC[2] + ',0)');
  hzGrad.addColorStop(0.5, 'rgba(' + Math.min(255, ACC[0] + 50) + ',' + Math.min(255, ACC[1] + 54) + ',' + Math.min(255, ACC[2] + 44) + ',0.10)');
  hzGrad.addColorStop(1, 'rgba(' + ACC[0] + ',' + ACC[1] + ',' + ACC[2] + ',0)');
}

/* ───────────────────────── 绘制 ───────────────────────── */
const SHEAR = 0.30;             /* 柱顶向右偏的斜切量（一点点斜视，字仍然方正） */

S.draw = function () {
  const g = glyph;
  const rev = 0.55 + 0.45 * reveal;
  const wave = RM ? 0.30 : 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, 0, W, H);

  /* 地台：一道很淡的水平光缝，交代"地面在哪" */
  ctx.fillStyle = hzGrad;
  ctx.fillRect(0, baseY - 30, W, 64);

  if (g && colN) {
    /* 影子：柱子从影子里长出来，地面关系才成立 */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.66 * rev;
    ctx.drawImage(g.shadow, g.gx + 6, g.gy + 14, g.bw, g.bh);
    ctx.globalAlpha = 1;

    /* ---- 侧面：按高度分三档（每档一条路径，一次 fill） ---- */
    const p1 = new Path2D(), p2 = new Path2D(), p3 = new Path2D();
    const tops = new Path2D();
    const w = VS - 1.2;
    const capD = w * 0.52;
    for (let i = 0; i < colN; i++) {
      const x = colX[i], y = colY[i];
      /* 行波：一道很慢的起伏从字上淌过去 */
      const h = colH[i] * (1 + wave * 0.16 * Math.sin(vT * 1.15 - x * 0.011 + y * 0.006)) * rev;
      if (h < 1) continue;
      const dx = h * SHEAR;
      const p = h > 26 ? p3 : (h > 13 ? p2 : p1);
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w + dx, y - h);
      p.lineTo(x + dx, y - h);
      p.closePath();
      tops.rect(x + dx, y - h - capD, w, capD);
    }

    /* 侧壁：远/中/近三档，越高的柱子越接光（左上打光） */
    ctx.fillStyle = 'rgba(' + Math.round(ICE[0] * 0.30) + ',' + Math.round(ICE[1] * 0.31) + ',' + Math.round(ICE[2] * 0.36) + ',0.92)';
    ctx.fill(p1);
    ctx.fillStyle = 'rgba(' + Math.round(ICE[0] * 0.42) + ',' + Math.round(ICE[1] * 0.43) + ',' + Math.round(ICE[2] * 0.48) + ',0.95)';
    ctx.fill(p2);
    ctx.fillStyle = 'rgba(' + Math.round(ICE[0] * 0.56) + ',' + Math.round(ICE[1] * 0.57) + ',' + Math.round(ICE[2] * 0.62) + ',0.96)';
    ctx.fill(p3);
    /* 柱顶：一片亮面 */
    ctx.fillStyle = 'rgba(' + Math.min(255, ICE[0] + 8) + ',' + Math.min(255, ICE[1] + 8) + ',' + Math.min(255, ICE[2] + 4) + ',' + (0.94 * rev).toFixed(3) + ')';
    ctx.fill(tops);

    /* 扫过的一束光：斜上方主光慢慢摆，柱阵的明暗就活了 */
    const lx = VX + Math.sin(vT * 0.33) * W * 0.34;
    const ly = VY - H * 0.22 + Math.cos(vT * 0.27) * H * 0.10;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, MN * 0.72);
    lg.addColorStop(0, 'rgba(' + Math.min(255, ACC[0] + 60) + ',' + Math.min(255, ACC[1] + 56) + ',' + Math.min(255, ACC[2] + 40) + ',' + (0.20 * rev).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(' + ACC[0] + ',' + ACC[1] + ',' + ACC[2] + ',0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  } else if (g) {
    /* 体素表没建起来（极端细的句子）：退回一层淡字，绝不空屏 */
    ctx.globalAlpha = 0.5 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.cols3d = colN; };
