/*!
title: 体积光线步进
机制一句话：屏幕每个像素都从一台**真的在绕飞的透视相机**里发出一条视线，在"当前句墨迹的挤出体"
的**有符号距离场**里做球步进（SDF = max(二维带符号距离, |z| − 厚度)），求到第一个交点：
交在正面就按法线打光，交在侧壁就露出笔画的**厚度**，掠角处起一道菲涅尔边光；
没打中的视线用"离表面最近的距离"回一份很淡的体积光晕。—— 字是一个在暗场里缓慢转身的物件，
而不是一张贴在屏幕上的图。

实现要点：
  · 预烘一次：笔迹掩码 → 外距离场 + 笔画内距离场，合成一张**带符号距离表**（CSS 像素）。
  · 步进只在"厚度板"那一段里进行（解析算出进/出板面），所以平均 2~6 步就收敛；
    渲染在 0.19 倍分辨率（≈36k 像素）的 ImageData 上做，再上采样，帧预算 2~3ms。
  · 相机偏航 ±15°、俯仰缓慢呼吸；光随相机走，所以侧壁的明暗一直在变。
  · 暂停即冻结；RM 时相机停摆（只留极慢的呼吸），步进分辨率减半。
*/

const RMA = { BW: 0, BH: 0, rc: null, rctx: null, img: null, sd: null, cap: 60 };
let rmaBg = null, rmaVig = null;
let rmaIce = [226, 238, 255];

CFG.maxW = 0.72; CFG.maxH = 0.52;

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  rmaIce = [Math.min(255, Math.round(r * 0.34 + 168)), Math.min(255, Math.round(g * 0.36 + 172)), Math.min(255, Math.round(b * 0.30 + 182))];
  rmaBg = ctx.createLinearGradient(0, 0, W * 0.3, H);
  rmaBg.addColorStop(0, 'rgb(4,5,10)');
  rmaBg.addColorStop(0.6, 'rgb(6,8,15)');
  rmaBg.addColorStop(1, 'rgb(9,10,16)');
  rmaVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.28, VX, VY, Math.min(W, H) * 1.05);
  rmaVig.addColorStop(0, 'rgba(0,0,0,0)');
  rmaVig.addColorStop(1, 'rgba(1,2,5,0.82)');
};

S.onResize = function () {
  S.onAccent();
  const sc = RM ? 0.17 : 0.24;
  RMA.BW = Math.max(64, Math.round(W * sc));
  RMA.BH = Math.max(40, Math.round(RMA.BW * H / W));
  RMA.rc = document.createElement('canvas');
  RMA.rc.width = RMA.BW;
  RMA.rc.height = RMA.BH;
  RMA.rctx = RMA.rc.getContext('2d');
  RMA.img = RMA.rctx.createImageData(RMA.BW, RMA.BH);
};

/* ── 预烘：把 mask / 外距离 / 内距离合成一张带符号距离表（CSS 像素） ── */
S.bake = function (text) {
  const g = bake(text, { padR: 0.20, padPx: 12, mask: true, field: true, inner: true, cap: 88, capInner: 30 });
  if (!g || !g.mask || !g.df || !g.dfi) return g;
  const n = g.mw * g.mh;
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = (g.mask[i] ? -g.dfi[i] : g.df[i]) / MS;
  g.sd = sd;
  RMA.sd = sd;
  return g;
};

/* 双线性取带符号距离（CSS 像素；框外返回大正数） */
function rmaSD(x, y) {
  const g = glyph;
  if (!g || !g.sd) return 80;
  const fx = (x - g.mox) * MS - 0.5, fy = (y - g.moy) * MS - 0.5;
  if (!(fx >= 0 && fy >= 0 && fx <= g.mw - 1.001 && fy <= g.mh - 1.001)) return 80;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0;
  const a = g.sd, o = j0 * g.mw + i0, mw = g.mw;
  const t0 = a[o] + (a[o + 1] - a[o]) * tx;
  const t1 = a[o + mw] + (a[o + mw + 1] - a[o + mw]) * tx;
  return t0 + (t1 - t0) * ty;
}

S.reset = function () { };

S.draw = function () {
  const g = glyph;
  const bw = RMA.BW, bh = RMA.BH;
  const r = rmaIce[0], gg = rmaIce[1], bb = rmaIce[2];

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = rmaBg;
  ctx.fillRect(0, 0, W, H);

  /* 远处一团极暗的背光，让暗场有"深度"而不是纯黑 */
  const halo = ctx.createRadialGradient(VX, VY, 0, VX, VY, Math.min(W, H) * 0.72);
  halo.addColorStop(0, 'rgba(' + ACC[0] + ',' + ACC[1] + ',' + ACC[2] + ',0.055)');
  halo.addColorStop(1, 'rgba(' + ACC[0] + ',' + ACC[1] + ',' + ACC[2] + ',0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  if (!g || !g.sd || !RMA.rc) {
    drawRMAEmpty();
    ctx.fillStyle = rmaVig;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  /* ── 相机：绕字转，距离足够远所以透视温和、字不会被拉歪 ── */
  const R = Math.max(W, H) * 0.70;
  const amp = RM ? 0.22 : 1;
  const yaw = 0.30 * amp * Math.sin(vT * 0.21);
  const pitch = 0.10 + 0.055 * amp * Math.sin(vT * 0.17 + 1.1);
  const cx0 = g.gx + g.bw * 0.5, cy0 = g.gy + g.bh * 0.5;
  const camX = cx0 + R * Math.sin(yaw) * Math.cos(pitch);
  const camY = cy0 + R * Math.sin(pitch);
  const camZ = R * Math.cos(yaw) * Math.cos(pitch);
  /* 前向 / 右 / 上（世界 up = (0,-1,0)，即屏幕向上） */
  let fx2 = cx0 - camX, fy2 = cy0 - camY, fz2 = -camZ;
  const fl = Math.sqrt(fx2 * fx2 + fy2 * fy2 + fz2 * fz2) || 1;
  fx2 /= fl; fy2 /= fl; fz2 /= fl;
  let rx2 = -fz2, ry2 = 0, rz2 = fx2;            /* right = up × forward（世界 up=(0,-1,0)） */
  const rl = Math.sqrt(rx2 * rx2 + rz2 * rz2) || 1;
  rx2 /= rl; ry2 /= rl; rz2 /= rl;
  const ux = ry2 * fz2 - rz2 * fy2;              /* up' = right × forward */
  const uy = rz2 * fx2 - rx2 * fz2;
  const uz = rx2 * fy2 - ry2 * fx2;

  const focal = R;
  const T = Math.max(26, Math.min(58, Math.min(g.bw, g.bh) * 0.135));  /* 挤出厚度（CSS px） */
  const lightX = -0.46, lightY = -0.68, lightZ = 0.57;   /* 光从左上前方来 */
  const data = RMA.img.data;
  const sx = W / bw, sy = H / bh;

  /* 浮尘：真的给出三维位置，按相机基投影 —— 相机一转，前后层就错开 */
  const dust = function (frontOnly) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(' + r + ',' + gg + ',' + bb + ')';
    for (let i = 0; i < 96; i++) {
      const s1 = (i * 7919 % 997) / 997;
      const s2 = (i * 40503 % 991) / 991;
      const s3 = (i * 1299721 % 983) / 983;
      const mz = -320 + s3 * 520;
      if (frontOnly ? mz < 0 : mz >= 0) continue;
      const mx = cx0 + (s1 - 0.5) * W * 1.6 + Math.sin(vT * 0.13 + i) * 16;
      const my = cy0 + (s2 - 0.5) * H * 1.4 + Math.cos(vT * 0.11 + i * 1.7) * 13;
      const qx = mx - camX, qy = my - camY, qz = mz - camZ;
      const zc = qx * fx2 + qy * fy2 + qz * fz2;
      if (zc < 120) continue;
      const xs = (qx * rx2 + qy * ry2 + qz * rz2) / zc * focal + VX;
      const ys = (qx * ux + qy * uy + qz * uz) / zc * focal + VY;
      if (xs < -10 || xs > W + 10 || ys < -10 || ys > H + 10) continue;
      const near = (R - zc) / 320;
      const sz = 1.1 + Math.max(0, near) * 2.6;
      ctx.globalAlpha = 0.10 + 0.34 * Math.min(1, Math.max(0, near));
      ctx.fillRect(xs, ys, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  dust(false);

  /* 背景色（写进缓冲的空像素留给主画布） */
  for (let i = 3, n = data.length; i < n; i += 4) data[i] = 0;

  let hits = 0;
  for (let py = 0; py < bh; py++) {
    const vy = ((py + 0.5) * sy - VY) / focal;
    for (let px = 0; px < bw; px++) {
      const vx = ((px + 0.5) * sx - VX) / focal;
      let dx = fx2 + rx2 * vx + ux * vy;
      let dy = fy2 + ry2 * vx + uy * vy;
      let dz = fz2 + rz2 * vx + uz * vy;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      if (dz > -0.55) continue;                 /* 掠射：这一像素跳过，避免除零 */
      /* 解析求出"厚度板"那一段 t 区间，只在板里步进 */
      const tA = (camZ - T) / (-dz);
      const tB = (camZ + T) / (-dz);
      let t = tA > 0 ? tA : 0;
      const tEnd = tB;
      let hit = -1, minD = 1e9;
      for (let s = 0; s < 26; s++) {
        const x = camX + dx * t, y = camY + dy * t, z = camZ + dz * t;
        const d2 = rmaSD(x, y);
        const d3 = Math.abs(z) - T;
        const d = d2 > d3 ? d2 : d3;
        if (d < minD) minD = d;
        if (d < 0.9) { hit = t; break; }
        t += (d > 1.2 ? d * 0.92 : 1.2);
        if (t > tEnd) break;
      }
      const o = (py * bw + px) * 4;
      if (hit < 0) {
        if (minD < 26) {
          const gl = (1 - minD / 26);
          const a2 = gl * gl * 0.30;
          data[o] = r * 0.55; data[o + 1] = gg * 0.55; data[o + 2] = bb * 0.60;
          data[o + 3] = a2 * 255;
        }
        continue;
      }
      hits++;
      const hx = camX + dx * hit, hy = camY + dy * hit, hz = camZ + dz * hit;
      /* 法线：靠板面 → (0,0,±1)；靠侧壁 → 二维距离场梯度 */
      const zAbs = Math.abs(hz);
      const isSide = zAbs <= T - 1.6;
      const e = 2.4;
      const gx = rmaSD(hx + e, hy) - rmaSD(hx - e, hy);
      const gy = rmaSD(hx, hy + e) - rmaSD(hx, hy - e);
      let nx, ny, nz;
      if (!isSide) {
        const w = 0.18;
        const ax2 = -gx, ay2 = -gy;
        const al = Math.sqrt(ax2 * ax2 + ay2 * ay2) || 1;
        nx = ax2 / al * w; ny = ay2 / al * w; nz = (hz > 0 ? 1 : -1) * (1 - w);
      } else {
        const al = Math.sqrt(gx * gx + gy * gy) || 1;
        nx = -gx / al; ny = -gy / al; nz = 0;
      }
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      let dif = nx * lightX + ny * lightY + nz * lightZ;
      if (dif < 0) dif = 0;
      /* 视线与法线的夹角 → 菲涅尔边光 */
      const dotv = -(nx * dx + ny * dy + nz * dz);
      let fres = 1 - (dotv > 0 ? dotv : 0);
      fres = fres * fres * fres;
      /* 正面比背面亮（背面半透） */
      const back = hz < 0 ? 0.45 : 1;
      const dd = Math.abs(hit - R) / (R * 0.42);
      const fog = 1 - 0.55 * (dd > 1 ? 1 : dd);
      const base = (0.16 + 0.88 * dif) * back * (isSide ? 0.52 : 1);
      const spec = dif > 0.5 ? (dif - 0.5) * 0.9 : 0;
      const wall = isSide ? 0.34 : 0;
      let cr = r * base + ACC[0] * (fres * 0.55 + wall) + r * spec * 0.9;
      let cg = gg * base + ACC[1] * (fres * 0.55 + wall) + gg * spec * 0.9;
      let cb = bb * base + ACC[2] * (fres * 0.55 + wall) + bb * spec * 0.9;
      cr *= fog; cg *= fog; cb *= fog;
      data[o] = cr > 255 ? 255 : cr;
      data[o + 1] = cg > 255 ? 255 : cg;
      data[o + 2] = cb > 255 ? 255 : cb;
      data[o + 3] = 255;
    }
  }
  RMA.rctx.putImageData(RMA.img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.45 * reveal;
  ctx.drawImage(RMA.rc, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  dust(true);
  if (!hits) drawRMAEmpty();

  ctx.fillStyle = rmaVig;
  ctx.fillRect(0, 0, W, H);
};

/* 空歌词：一块在透视里缓缓转动的空板 + 一道扫光，什么都没有但空间还在 */
function drawRMAEmpty() {
  const r = rmaIce[0], gg = rmaIce[1], bb = rmaIce[2];
  const t = vT * 0.18;
  const pw = Math.min(W, H) * 0.46, ph = pw * 0.42;
  const sk = Math.sin(t) * 0.28;
  const cxp = VX, cyp = VY;
  ctx.strokeStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cxp - pw / 2, cyp - ph / 2 + sk * ph * 0.5);
  ctx.lineTo(cxp + pw / 2, cyp - ph / 2 - sk * ph * 0.5);
  ctx.lineTo(cxp + pw / 2, cyp + ph / 2 - sk * ph * 0.5);
  ctx.lineTo(cxp - pw / 2, cyp + ph / 2 + sk * ph * 0.5);
  ctx.closePath();
  ctx.stroke();
  for (let i = 1; i < 6; i++) {
    const f = i / 6;
    ctx.globalAlpha = 0.30;
    ctx.beginPath();
    ctx.moveTo(cxp - pw / 2 + pw * f, cyp - ph / 2 + sk * ph * (0.5 - f));
    ctx.lineTo(cxp - pw / 2 + pw * f, cyp + ph / 2 + sk * ph * (0.5 - f) - sk * ph * 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const lg = ctx.createLinearGradient(cxp - pw / 2, 0, cxp + pw / 2, 0);
  lg.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  lg.addColorStop(0.5, 'rgba(' + r + ',' + gg + ',' + bb + ',0.10)');
  lg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
  ctx.fillStyle = lg;
  ctx.fillRect(cxp - pw / 2, cyp - ph / 2, pw, ph);
}

S.extra = function (o) {
  o.res = RMA.BW + 'x' + RMA.BH;
};
