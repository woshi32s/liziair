/*!
title: 引力透镜歌词
机制一句话：把当前句的墨迹当成一块**引力质量**——坐标网格被掰弯、绕到笔画外面去，
笔画内部被挖空（网格在这里止步，字的边就是视界），边缘挤成一道暖色爱因斯坦环，
字外还挂着一圈被"拉"出去的残像。空间感来自光线的偏折，而不是把字做大。

实现要点：
  · 偏折场只做两件事：一句预烘一张 chamfer 距离场（给"离字多远"），再糊一张**粗**的
    掩码取负梯度（给"往哪边推"）。糊得要粗（约半个字高），方向才连贯 —— 细掩码的梯度
    在笔画之间会打架，把网格撕成一团乱线。
  · 位移 = A·(1-d/R)²，A 只有 16px：够看出弯，又不会让顶点互相穿越；
    另外剔除"被甩出去"的超长段（顶点在字缝里撞车时会出现长对角线）。
  · 近质量的段另攒一条路径单独描一道暖色：那一圈就是爱因斯坦环。
  · 叠影：把预烘的模糊字形按 1.09/1.18/1.27 三次径向放大、lighter 叠上去 —— 字被"拉"出去了。
  · 空歌词：质量消失，网格吃一道极慢的平面波，星场照旧（纯音频视觉）。
  · RM：偏折收到 42%、停掉平移与闪烁、叠影砍一半。
*/

/* ───────────────────────── 场 ───────────────────────── */
const G = { GS: 27, A: 16, R: 0 };
let bgGrad = null, vigGrad = null;
let starX = new Float32Array(0), starY = new Float32Array(0), starB = new Float32Array(0);

function buildStars() {
  const n = Math.max(160, Math.round(W * H / 2600));
  starX = new Float32Array(n); starY = new Float32Array(n); starB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    starX[i] = Math.random() * W;
    starY[i] = Math.random() * H;
    starB[i] = 0.25 + Math.random() * 0.75;
  }
}

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  bgGrad = ctx.createRadialGradient(VX, VY, 0, VX, VY, Math.max(W, H) * 0.86);
  bgGrad.addColorStop(0, 'rgb(' + (8 + (r * 0.020 | 0)) + ',' + (11 + (g * 0.024 | 0)) + ',' + (20 + (b * 0.032 | 0)) + ')');
  bgGrad.addColorStop(0.55, 'rgb(' + (4 + (r * 0.009 | 0)) + ',' + (6 + (g * 0.011 | 0)) + ',' + (12 + (b * 0.016 | 0)) + ')');
  bgGrad.addColorStop(1, 'rgb(3,4,8)');
  vigGrad = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.36, VX, VY, Math.min(W, H) * 1.10);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(1, 'rgba(1,2,6,0.70)');
};

S.onResize = function () { buildStars(); S.onAccent(); ensureGrid(); };

/* ───────────────────────── 预烘 ───────────────────────── */
/* 实心黑字形（DPR 分辨率）：网格画完以后拿它把笔画内部"挖空"——
   字是空的、边是齐的，网格不会在字里糊成一团碎玻璃。 */
function blackSprite(lay, bw, bh, pad) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(bw * DPR));
  c.height = Math.max(2, Math.round(bh * DPR));
  const g = c.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#000';
  paintRows(g, lay, pad, pad);
  return c;
}

S.bake = function (text) {
  const fs = 100;
  const g = bake(text, {
    /* 盒子（0.78fs）比影响半径（0.62fs）大一圈：出框即无偏折，接缝恒为 0 */
    padR: 0.78, padPx: 12, mask: true, field: true, dir: 20, cap: 110,
    blur: [Math.max(7, fs * 0.07)],
    shadow: 13, shadowColor: 'rgba(0,0,0,1)',
    glow: 10, glowColor: 'rgb(' + Math.min(255, ACC[0] + 46) + ',' + Math.min(255, ACC[1] + 38) + ',' + Math.min(255, ACC[2] + 20) + ')'
  });
  if (g) g.ink = blackSprite(g.lay, g.bw, g.bh, g.pad);
  return g;
};

/* ───────────────────────── 网格 ───────────────────────── */
let cols = 0, rows = 0;
let vx = new Float32Array(0), vy = new Float32Array(0), vd = new Float32Array(0);

function ensureGrid() {
  const c = Math.ceil(W / G.GS) + 3, r = Math.ceil(H / G.GS) + 3;
  if (c * r > vx.length) {
    vx = new Float32Array(c * r); vy = new Float32Array(c * r); vd = new Float32Array(c * r);
  }
  cols = c; rows = r;
}

S.reset = function () { ensureGrid(); };

/* ───────────────────────── 绘制 ───────────────────────── */
S.draw = function () {
  const AC = ACC;
  const hr = Math.min(255, AC[0] + 78), hg = Math.min(255, AC[1] + 64), hb = Math.min(255, AC[2] + 34);

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const g = glyph;
  const R = g ? Math.max(58, g.lay.fs * 0.62) : 0;
  G.R = R;
  const breathe = 1 + 0.06 * Math.sin(vT * 0.5);
  const amp = g ? (RM ? 0.42 : 1) * (G.A * breathe + beat * 6) : 0;
  const drift = RM ? 0.4 : 4.6;
  const ox = drift * Math.sin(vT * 0.085), oy = drift * 0.8 * Math.cos(vT * 0.072);
  /* 没有质量的时候网格自己慢慢流，画面不至于死 */
  const live = g ? 0 : 1;
  const px0 = -G.GS + (((vT * (RM ? 1.4 : 6.0)) * live) % G.GS);
  const py0 = -G.GS + (((vT * (RM ? 1.0 : 3.6)) * live) % G.GS);

  let k = 0;
  for (let j = 0; j < rows; j++) {
    const y = py0 + j * G.GS + oy;
    for (let i = 0; i < cols; i++) {
      const x = px0 + i * G.GS + ox;
      let dxs = 0, dys = 0, dd = 999;
      if (g) {
        const dv = sampleField(g, g.df, x, y);
        dd = dv < 0 ? 999 : dv * 2;
        if (dd < R) {
          let dx = sampleField(g, g.dx, x, y), dy = sampleField(g, g.dy, x, y);
          if (dx < -1.001 || dx > 1.001) dx = 0;
          if (dy < -1.001 || dy > 1.001) dy = 0;
          const s = 1 - dd / R;
          const mag = amp * s * s;
          dxs = dx * mag; dys = dy * mag;
        }
      } else {
        /* 空歌词：一道极慢的平面波（有方向感，但没有质量） */
        dxs = (RM ? 1.5 : 6.5) * Math.sin(y * 0.008 + vT * 0.5);
        dys = (RM ? 1.0 : 4.2) * Math.sin(x * 0.007 - vT * 0.42);
      }
      vx[k] = x + dxs;
      vy[k] = y + dys;
      vd[k] = dd;
      k++;
    }
  }

  /* 近质量的段单独攒一条（爱因斯坦环）；顺带剔除被甩出去的长对角线 */
  const hotR = R * 0.72;
  const lim = G.GS * G.GS * 4.2;
  const pDim = new Path2D(), pHot = new Path2D();
  for (let j = 0; j < rows; j++) {
    const row = j * cols;
    for (let i = 0; i < cols; i++) {
      const a = row + i, da = vd[a], ax = vx[a], ay = vy[a];
      if (i + 1 < cols) {
        const b = a + 1, ex = vx[b] - ax, ey = vy[b] - ay;
        if (ex * ex + ey * ey < lim) {
          const p = (g && (da < hotR || vd[b] < hotR)) ? pHot : pDim;
          p.moveTo(ax, ay); p.lineTo(vx[b], vy[b]);
        }
      }
      if (j + 1 < rows) {
        const b = a + cols, ex = vx[b] - ax, ey = vy[b] - ay;
        if (ex * ex + ey * ey < lim) {
          const p = (g && (da < hotR || vd[b] < hotR)) ? pHot : pDim;
          p.moveTo(ax, ay); p.lineTo(vx[b], vy[b]);
        }
      }
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';

  /* ---- 星：同一股场推开（近处推得多 → 字里空掉） ---- */
  for (let band = 0; band < 2; band++) {
    ctx.fillStyle = band ? 'rgba(208,224,250,0.60)' : 'rgba(166,188,224,0.30)';
    for (let i = 0; i < starX.length; i++) {
      if ((starB[i] > 0.62) !== (band === 1)) continue;
      let x = starX[i], y = starY[i];
      if (g) {
        const dv = sampleField(g, g.df, x, y);
        const dd = dv < 0 ? 999 : dv * 2;
        if (dd < R) {
          const ax = sampleField(g, g.dx, x, y), ay = sampleField(g, g.dy, x, y);
          if (ax > -1.001 && ax < 1.001 && ay > -1.001 && ay < 1.001) {
            const s = 1 - dd / R;
            const mag = amp * 0.7 * s * s;
            x += ax * mag; y += ay * mag;
          }
        }
      }
      const tw = RM ? 0.9 : (0.74 + 0.26 * Math.sin(vT * 2.1 + i * 1.7));
      const sz = 1.0 + starB[i] * 1.6;
      ctx.globalAlpha = (band ? 0.95 : 0.55) * tw;
      ctx.fillRect(x, y, sz, sz);
    }
  }
  ctx.globalAlpha = 1;

  /* ---- 网格 ---- */
  ctx.strokeStyle = 'rgba(' + Math.min(255, AC[0] + 22) + ',' + Math.min(255, AC[1] + 22) + ',' + Math.min(255, AC[2] + 18) + ',0.105)';
  ctx.lineWidth = 1.0;
  ctx.stroke(pDim);
  if (g) {
    ctx.strokeStyle = 'rgba(' + hr + ',' + hg + ',' + hb + ',' + (0.30 + beat * 0.30).toFixed(3) + ')';
    ctx.lineWidth = 1.15;
    ctx.stroke(pHot);
  }

  /* ---- 字：先把笔画内部挖空（网格在这里止步），再套叠影 / 暖边 / 幽灵层 ---- */
  if (g) {
    /* 环外的残像：字被透镜往外拉出去的那几圈 */
    for (let e = 0; e < (RM ? 2 : 3); e++) {
      const sc = 1 + 0.10 * (e + 1);
      const w2 = g.bw * sc, h2 = g.bh * sc;
      ctx.globalAlpha = (0.11 - e * 0.022) * (0.35 + 0.65 * reveal);
      ctx.drawImage(g.soft[0], g.gx + (g.bw - w2) / 2, g.gy + (g.bh - h2) / 2, w2, h2);
    }
    ctx.globalCompositeOperation = 'source-over';
    /* 挖空：黑字形盖住网格，边是 DPR 分辨率所以不毛 */
    ctx.globalAlpha = 0.94;
    ctx.drawImage(g.ink, g.gx, g.gy, g.bw, g.bh);
    /* 暖边：紧贴笔画外缘的一圈光（爱因斯坦环的主体） */
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.42 + beat * 0.20) * (0.55 + 0.45 * reveal);
    ctx.drawImage(g.glow, g.gx, g.gy, g.bw, g.bh);
    /* 幽灵层：把"是哪个字"钉死 */
    ctx.globalAlpha = 0.42 * (0.5 + 0.5 * reveal);
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) {
  o.lensR = Math.round(G.R);
  o.grid = cols * rows;
};
