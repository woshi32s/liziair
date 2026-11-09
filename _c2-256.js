/*!
title: 长曝光光绘
机制一句话：相机绕着字**慢慢转**，感光器一直开着 —— 每一帧都把当前视角下的粒子按
"越近越亮越大"投到一张**累积缓冲**上，缓冲每帧按 9% 衰减；
于是字被自己的运动拖成一条条光轨（长曝光），而"此刻"的那一帧是清楚的。
空间感来自视差：同一颗粒子在相机转过 30° 后落在完全不同的位置，轨迹的弯曲方向就是深度。

实现要点：
  · 粒子从当前句的墨迹里采（带厚度，厚度取自笔画内距离场），上限 6k；投影只是一次透视除法。
  · 累积缓冲 0.55 倍分辨率：衰减一次 fillRect + 一批粒子 fill，再整体上采样贴回屏幕。
  · 当前帧另画一遍清晰的字（带一点随视角的斜切）保证读得出来。
  · 暂停即冻结（累积只在 step 里推进）；RM 时轨道振幅砍到 35%。
*/

CFG.maxW = 0.60; CFG.maxH = 0.34;

const LP = {
  px: null, py: null, pz: null, pb: null, n: 0,
  ac: null, actx: null, aw: 0, ah: 0
};
let lpBg = null, lpVig = null, lpIce = [230, 240, 255];

S.onAccent = function () {
  const r = ACC[0] | 0, g = ACC[1] | 0, b = ACC[2] | 0;
  lpIce = [Math.min(255, Math.round(r * 0.34 + 176)), Math.min(255, Math.round(g * 0.34 + 180)), Math.min(255, Math.round(b * 0.30 + 190))];
  lpBg = ctx.createLinearGradient(0, 0, 0, H);
  lpBg.addColorStop(0, 'rgb(3,4,8)');
  lpBg.addColorStop(0.6, 'rgb(5,6,11)');
  lpBg.addColorStop(1, 'rgb(7,7,12)');
  lpVig = ctx.createRadialGradient(VX, VY, Math.min(W, H) * 0.22, VX, VY, Math.min(W, H) * 1.05);
  lpVig.addColorStop(0, 'rgba(0,0,0,0)');
  lpVig.addColorStop(1, 'rgba(1,2,4,0.84)');
};

S.onResize = function () {
  S.onAccent();
  LP.aw = Math.max(64, Math.round(W * 0.55));
  LP.ah = Math.max(40, Math.round(LP.aw * H / W));
  LP.ac = document.createElement('canvas');
  LP.ac.width = LP.aw; LP.ac.height = LP.ah;
  LP.actx = LP.ac.getContext('2d');
  LP.actx.fillStyle = '#000';
  LP.actx.fillRect(0, 0, LP.aw, LP.ah);
};

S.bake = function (text) {
  const g = bake(text, { padR: 0.18, padPx: 12, mask: true, inner: true, capInner: 20, glow: 9, glowColor: 'rgba(224,238,255,1)' });
  if (!g || !g.mask) return g;
  /* 采粒子：每 1.4 个 mask 像素一个，深度按笔画内距离场（笔画中心更厚） */
  const cap = Math.ceil(g.mw * g.mh / 2) + 16;
  if (!LP.px || LP.px.length < cap) {
    LP.px = new Float32Array(cap); LP.py = new Float32Array(cap);
    LP.pz = new Float32Array(cap); LP.pb = new Float32Array(cap);
  }
  let n = 0;
  for (let y = 1; y < g.mh; y += 2) {
    for (let x = 1; x < g.mw; x += 2) {
      const k = y * g.mw + x;
      if (!g.mask[k]) continue;
      if (n >= cap) break;
      const h = Math.min(1, g.dfi[k] / 7);
      LP.px[n] = x / MS + g.mox;
      LP.py[n] = y / MS + g.moy;
      LP.pz[n] = (h - 0.45) * 34;
      LP.pb[n] = 0.45 + 0.55 * h;
      n++;
    }
  }
  LP.n = n;
  if (LP.actx) { LP.actx.fillStyle = '#000'; LP.actx.fillRect(0, 0, LP.aw, LP.ah); }
  return g;
};

S.reset = function () {
  LP.n = 0;
  if (LP.actx) { LP.actx.fillStyle = '#000'; LP.actx.fillRect(0, 0, LP.aw, LP.ah); }
};
S.onSeek = function () { S.reset(); };
S.onEmpty = function () { S.reset(); };
S.onLine = function () { };

S.step = function (dt) {
  if (!LP.actx || !LP.n || !glyph) return;
  const amp = RM ? 0.35 : 1;
  const yaw = 0.55 * amp * Math.sin(vT * 0.22);
  const pit = 0.13 + 0.05 * amp * Math.sin(vT * 0.11 + 1);
  const cx0 = glyph.gx + glyph.bw * 0.5, cy0 = glyph.gy + glyph.bh * 0.5;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const R = Math.max(W, H) * 0.95;
  const kw = LP.aw / W, kh = LP.ah / H;

  const ac = LP.actx;
  /* 衰减：一帧 9%，轨迹才不会糊成一片 */
  ac.globalCompositeOperation = 'source-over';
  ac.fillStyle = 'rgba(0,0,0,0.11)';
  ac.fillRect(0, 0, LP.aw, LP.ah);
  ac.globalCompositeOperation = 'lighter';

  const r = lpIce[0], g2 = lpIce[1], b = lpIce[2];
  const n = LP.n;
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    /* 绕着字心旋转 + 俯仰，再透视投影 */
    const dx = LP.px[i] - cx0, dy = LP.py[i] - cy0, dz = LP.pz[i];
    const rx = dx * cy + dz * sy;
    const rz = -dx * sy + dz * cy;
    const ry = dy * cp - rz * sp;
    const rz2 = dy * sp + rz * cp;
    const zc = R + rz2;
    if (zc < 40) continue;
    const sc2 = R / zc;
    const sxp = (cx0 + rx * sc2) * kw;
    const syp = (cy0 + ry * sc2) * kh;
    const sz = Math.max(0.8, 1.9 * sc2 * LP.pb[i]);
    path.rect(sxp, syp, sz, sz);
  }
  ac.fillStyle = 'rgb(' + r + ',' + g2 + ',' + b + ')';
  ac.fill(path);
  ac.globalCompositeOperation = 'source-over';
};

S.draw = function () {
  const g = glyph;
  const rev = 0.5 + 0.5 * reveal;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = lpBg;
  ctx.fillRect(0, 0, W, H);

  /* 累积缓冲（长曝光的那张底片） */
  if (LP.ac) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * rev;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(LP.ac, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 此刻的这一帧：清晰的字，带一点随视角的斜切 */
  if (g && g.crisp) {
    const amp = RM ? 0.35 : 1;
    const yaw = 0.55 * amp * Math.sin(vT * 0.22);
    const sk = Math.sin(yaw) * 0.05;
    const cxp = VX, cyp = VY;
    ctx.save();
    ctx.setTransform(DPR, sk * DPR, 0, DPR, 0, 0);
    ctx.globalAlpha = 0.40 * rev;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(g.glow, g.gx - g.bw * 0.03, g.gy - g.bh * 0.03, g.bw * 1.06, g.bh * 1.06);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.97 * rev;
    ctx.drawImage(g.crisp, g.gx, g.gy, g.bw, g.bh);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    cxp; cyp;
  }

  ctx.fillStyle = lpVig;
  ctx.fillRect(0, 0, W, H);
};

S.extra = function (o) { o.pts = LP.n; };
