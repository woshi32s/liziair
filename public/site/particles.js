/* ==========================================================================
   LIZI 官网 · 粒子舞台
   --------------------------------------------------------------------------
   一小块常驻的粒子场：切到哪个区块，它就重新聚成对应的形状（数字 / 符号）。
   做法和主应用的开场引导同一套：文字画进离屏 canvas → 采样 alpha 像素当目标点 →
   粒子按「绕重心角度」排序后一一对应，弹簧飞过去。

   点一下舞台 = 炸开再聚回来（唯一的手势，不需要说明）。
   减弱动效：直接落位，不跑循环。
   ========================================================================== */

window.SITE_PARTICLES = (() => {
  const cv = document.getElementById('pstage');
  if (!cv) return { set: () => {} };

  const ctx = cv.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, dpr = 1;
  let parts = [];
  let shape = null;
  let raf = 0, last = 0;
  let root = null;

  /* ---------- 形状：把文字画进离屏 canvas 再采样 ---------- */
  const cache = new Map();
  function sampleText(text, weight = 700) {
    const key = `${text}|${weight}`;
    if (cache.has(key)) return cache.get(key);

    const SS = 260;
    const off = document.createElement('canvas');
    off.width = off.height = SS;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    /* 让字正好铺满画布：从大往小试，直到宽度和高度都装得下 */
    let size = SS * 0.9;
    for (let i = 0; i < 40; i++) {
      g.font = `${weight} ${size}px Geist, system-ui, sans-serif`;
      const m = g.measureText(text);
      const w = m.width;
      const h = (m.actualBoundingBoxAscent || size * 0.7) + (m.actualBoundingBoxDescent || size * 0.2);
      if (w <= SS * 0.86 && h <= SS * 0.8) break;
      size *= 0.9;
    }
    g.fillText(text, SS / 2, SS / 2);

    const d = g.getImageData(0, 0, SS, SS).data;
    const px = [];
    for (let y = 0; y < SS; y++) {
      for (let x = 0; x < SS; x++) {
        if (d[(y * SS + x) * 4 + 3] > 130) px.push(x, y);
      }
    }
    const pts = new Float32Array(px.length);
    for (let i = 0; i < px.length; i++) pts[i] = px[i] / SS - 0.5;

    /* 记下这个字的真实包围盒：画的时候按它铺满舞台，而不是按那个正方形画布。
       （不这么做的话 "↓" 这种窄字会缩成一细条，舞台上大片留白） */
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i += 2) {
      mx = Math.max(mx, Math.abs(pts[i]));
      my = Math.max(my, Math.abs(pts[i + 1]));
    }
    const out = { pts, n: px.length / 2, mx: Math.max(mx, 0.02), my: Math.max(my, 0.02) };
    cache.set(key, out);
    return out;
  }

  /* ---------- 粒子池 ---------- */
  function build() {
    const n = Math.max(900, Math.min(2600, Math.round((W * H) / 90)));
    parts = new Array(n);
    for (let i = 0; i < n; i++) {
      parts[i] = {
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H / 2 + (Math.random() - 0.5) * H * 0.6,
        vx: 0, vy: 0,
        nx: Math.random() - 0.5, ny: Math.random() - 0.5,
        phase: Math.random() * Math.PI * 2,
        freq: 0.0006 + Math.random() * 0.0016,
        size: 1 + Math.random() * 1.1,
        alpha: 0.3 + Math.random() * 0.5,
        accent: i % 31 === 0,
      };
    }
  }

  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (shape) assign(shape);
    draw(performance.now(), true);
  }

  /* ---------- 分配：两边都按角度排序，变形是一条涡流而不是乱飞 ---------- */
  function assign(s) {
    const n = parts.length;
    const tAng = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) tAng[i] = Math.atan2(s.pts[i * 2 + 1], s.pts[i * 2]);
    const tOrder = Array.from({ length: s.n }, (_, i) => i).sort((a, b) => tAng[a] - tAng[b]);

    const pOrder = Array.from({ length: n }, (_, i) => i);
    const pAng = new Float32Array(n);
    for (let i = 0; i < n; i++) pAng[i] = Math.atan2(parts[i].y - H / 2, parts[i].x - W / 2);
    pOrder.sort((a, b) => pAng[a] - pAng[b]);

    for (let k = 0; k < n; k++) {
      const p = parts[pOrder[k]];
      const ti = tOrder[Math.min(s.n - 1, Math.floor((k * s.n) / n))];
      p.nx = s.pts[ti * 2];
      p.ny = s.pts[ti * 2 + 1];
      p.dead = false;
    }
  }

  /* ---------- 每帧 ---------- */
  function draw(now, once) {
    if (!once) raf = requestAnimationFrame(draw);
    const dt = last ? Math.min(64, now - last) : 16.67;
    last = now;

    const f = Math.min(2.5, dt / 16.67);
    /* 按当前形状的包围盒铺满舞台（留 8% 边）：宽字贴宽、窄字贴高 */
    const S = shape
      ? Math.min((W * 0.84) / (2 * shape.mx), (H * 0.84) / (2 * shape.my))
      : Math.min(W * 0.72, H * 0.78);
    ctx.clearRect(0, 0, W, H);

    const ink = new Path2D();
    const acc = new Path2D();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const wob = Math.sin(now * p.freq + p.phase) * 1.6;
      const tx = W / 2 + p.nx * S + wob;
      const ty = H / 2 + p.ny * S + wob;

      if (once || (tx - p.x) ** 2 + (ty - p.y) ** 2 > 6400) {
        p.x = tx; p.y = ty; p.vx = 0; p.vy = 0;
      }
      p.vx += (tx - p.x) * 0.12 * f;
      p.vy += (ty - p.y) * 0.12 * f;
      p.vx *= Math.pow(0.80, f);
      p.vy *= Math.pow(0.80, f);
      p.x += p.vx * f;
      p.y += p.vy * f;

      (p.accent ? acc : ink).rect(p.x, p.y, p.size, p.size);
    }

    ctx.fillStyle = 'rgba(23, 23, 26, 0.60)';
    ctx.fill(ink);
    ctx.fillStyle = 'rgba(213, 55, 60, 0.82)';
    ctx.fill(acc);

    if (once) raf = 0;
  }

  /* 炸开：给每颗粒子一个向外的初速，它自己会飞回来 */
  function scatter() {
    for (const p of parts) {
      const dx = p.x - W / 2, dy = p.y - H / 2;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * (6 + Math.random() * 8);
      p.vy += (dy / d) * (6 + Math.random() * 8);
    }
  }

  function start() {
    root = document.getElementById('pstage-wrap');
    if (!root) return;
    resize();
    root.addEventListener('click', () => {
      scatter();
      if (reduced.matches) { draw(performance.now(), true); }
    });
    new ResizeObserver(() => resize()).observe(root);
    if (!reduced.matches) raf = requestAnimationFrame(draw);
    else draw(performance.now(), true);
  }

  return {
    start,
    set(text) {
      shape = sampleText(text);
      if (!root) return;
      assign(shape);
      if (reduced.matches) { cancelAnimationFrame(raf); draw(performance.now(), true); }
    },
  };
})();
