/* ============================================================================
   player-skins.js — 大厅底部播放条的 10 套皮肤
   ----------------------------------------------------------------------------
   约束：
   - 不改 app.js / player.js / app.css，不重写播放条自身逻辑。
   - 只给 #player 加一层 pointer-events:none 的视觉层；进度、按钮、拖动全交给原逻辑。
   - 只在大厅（body[data-view="hall"]）启用；切走立即停 rAF、移除层、还原默认。
   - 任何时刻最多一个「实际皮肤」rAF + 一个「设置页悬停预览」rAF。
   - DPR 上限 2；document.hidden 停；prefers-reduced-motion 只画静态帧。
   - 粒子画布不接收指针事件，不覆盖 #bar / #vol 的命中区。

   参考来源（原生移植，非直接引库）：
   01 React Bits            Particles
   02 Fancy Components      Cursor Attractor & Gravity
   03 Magic UI              Meteors
   04 Aceternity UI          Sparkles
   05 React Bits             Ballpit
   06 Hover.dev              Magnet Button
   07 Magic UI               Shine Border
   08 React Bits             StarBorder
   09 Aceternity UI          Tracing Beam
   10 Fancy Components       Gooey SVG Filter
   ========================================================================== */
(() => {
  'use strict';

  const STORE_KEY = 'lizi.player.skin';
  const DPR_CAP = 2;
  const TAU = Math.PI * 2;
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const player = $('#player');
  const barEl = $('#bar');
  const barFill = $('#bar-fill');
  const barBuf = $('#bar-buf');
  const volFill = $('#vol-fill');
  const playBtn = $('#btn-play');
  const coverEl = $('#np-cover');
  const curEl = $('#t-cur');
  const totalEl = $('#t-total');
  const mount = $('#player-skins-picker');

  /* ==========================================================================
     Canvas helpers
     ========================================================================== */
  function fitCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  const glowCache = new Map();
  function glowSprite(key, inner, outer) {
    if (glowCache.has(key)) return glowCache.get(key);
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, inner);
    grad.addColorStop(0.52, outer);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glowCache.set(key, c);
    return c;
  }

  function blitGlow(ctx, key, x, y, size, a) {
    const sprite = glowSprite(key, glowColors[key][0], glowColors[key][1]);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  const glowColors = {
    cyan: ['rgba(103,232,249,.95)', 'rgba(34,211,238,0)'],
    violet: ['rgba(196,181,253,.9)', 'rgba(139,92,246,0)'],
    gold: ['rgba(255,236,170,.95)', 'rgba(245,158,11,0)'],
    warm: ['rgba(255,190,150,.9)', 'rgba(251,113,133,0)'],
    magenta: ['rgba(244,114,182,.9)', 'rgba(217,70,239,0)'],
    silver: ['rgba(255,255,255,.92)', 'rgba(148,163,184,0)'],
    blue: ['rgba(147,197,253,.9)', 'rgba(59,130,246,0)']
  };

  const ballCache = new Map();
  function ballSprite(color) {
    if (ballCache.has(color)) return ballCache.get(color);
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size * 0.34, size * 0.3, 1, size * 0.5, size * 0.55, size * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,.98)');
    grad.addColorStop(0.22, color);
    grad.addColorStop(0.82, color);
    grad.addColorStop(1, 'rgba(20,30,55,.28)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 1, 0, TAU);
    g.fill();
    ballCache.set(color, c);
    return c;
  }

  function drawBall(ctx, color, x, y, r) {
    const s = ballSprite(color);
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  }

  /* ==========================================================================
     Geometry / progress
     ========================================================================== */
  function pctOf(el) {
    if (!el) return 0;
    const v = parseFloat(el.style.width);
    return Number.isFinite(v) ? clamp(v / 100, 0, 1) : 0;
  }

  function clockToSec(txt) {
    if (!txt) return 0;
    const parts = String(txt).trim().split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return 0;
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] || 0;
  }

  function readProgress() {
    const fill = pctOf(barFill);
    const buffered = Math.max(fill, pctOf(barBuf));
    return {
      fill,
      buffered,
      volume: pctOf(volFill),
      empty: clockToSec(totalEl && totalEl.textContent) <= 0,
      playing: document.body.classList.contains('is-playing')
    };
  }

  function rectRel(el, pr) {
    const r = el.getBoundingClientRect();
    return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
  }

  const barY = (g) => g.bar.y + g.bar.h / 2;

  function actualGeom(active) {
    const pr = player.getBoundingClientRect();
    const p = readProgress();
    const ptr = active.pointer;
    return {
      w: active.w,
      h: active.h,
      bar: rectRel(barEl, pr),
      play: rectRel(playBtn, pr),
      cover: rectRel(coverEl || player, pr),
      progress: p.fill,
      buffered: p.buffered,
      volume: p.volume,
      empty: p.empty,
      playing: p.playing,
      pointer: {
        x: ptr.x - pr.left,
        y: ptr.y - pr.top,
        inside: ptr.x >= pr.left && ptr.x <= pr.right && ptr.y >= pr.top && ptr.y <= pr.bottom
      },
      preview: false,
      reduced: reducedMQ.matches
    };
  }

  function previewGeom(st) {
    const w = st.w;
    const h = st.h;
    const pad = Math.max(16, Math.min(34, w * 0.04));
    const barW = Math.max(100, w - pad * 2 - 168);
    const progress = clamp(0.5 + Math.sin(st.t * 0.62) * 0.16, 0.08, 0.92);
    return {
      w,
      h,
      bar: { x: Math.round((w - barW) / 2 + 10), y: Math.round(h * 0.69), w: Math.round(barW), h: 18 },
      play: { x: Math.round(w / 2 - 21), y: Math.round(h * 0.345), w: 42, h: 42 },
      cover: { x: pad, y: Math.round((h - 44) / 2), w: 44, h: 44 },
      progress,
      buffered: Math.min(1, progress + 0.12),
      volume: 0.64,
      empty: false,
      playing: true,
      pointer: st.pointer,
      preview: true,
      reduced: false
    };
  }

  function makeState() {
    return {
      t: rand(0, 20),
      particles: null,
      meteors: null,
      balls: null,
      sparkles: null,
      spring: 0,
      pointer: { x: -9999, y: -9999, inside: false },
      w: 0,
      h: 0
    };
  }

  /* ==========================================================================
     Preview mock surface
     ========================================================================== */
  const MOCK_THEME = {
    light: {
      bg1: '#fafbfe', bg2: '#e9edf5', panel: 'rgba(255,255,255,.62)',
      line: 'rgba(26,31,48,.11)', text: 'rgba(26,31,48,.78)', muted: 'rgba(26,31,48,.34)',
      track: 'rgba(26,31,48,.13)'
    },
    dark: {
      bg1: '#070a13', bg2: '#111a2d', panel: 'rgba(255,255,255,.045)',
      line: 'rgba(255,255,255,.14)', text: 'rgba(255,255,255,.86)', muted: 'rgba(255,255,255,.36)',
      track: 'rgba(255,255,255,.16)'
    }
  };

  const DEFAULT_VISUAL = { id: 'default', theme: 'light', accent: ['#d9dde7', '#aeb6c6'] };

  function drawMock(ctx, g, visual) {
    const th = MOCK_THEME[visual.theme === 'dark' ? 'dark' : 'light'];
    const w = g.w;
    const h = g.h;
    const a0 = visual.accent[0];
    const a1 = visual.accent[1];

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, th.bg1);
    bg.addColorStop(1, th.bg2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const halo = ctx.createRadialGradient(w * 0.52, h * 0.48, 0, w * 0.52, h * 0.48, h * 0.95);
    halo.addColorStop(0, alpha(a0, visual.theme === 'dark' ? 0.22 : 0.16));
    halo.addColorStop(1, alpha(a0, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    roundRectPath(ctx, 8, 8, w - 16, h - 16, 16);
    ctx.fillStyle = th.panel;
    ctx.fill();
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    // cover
    const cv = g.cover;
    roundRectPath(ctx, cv.x, cv.y, cv.w, cv.h, 10);
    const cg = ctx.createLinearGradient(cv.x, cv.y, cv.x + cv.w, cv.y + cv.h);
    cg.addColorStop(0, a0);
    cg.addColorStop(1, a1);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(cv.x + cv.w * 0.42, cv.y + cv.h * 0.58, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillRect(cv.x + cv.w * 0.52, cv.y + cv.h * 0.3, 1.8, cv.h * 0.34);

    // title lines
    ctx.fillStyle = th.text;
    roundRectPath(ctx, cv.x + cv.w + 10, cv.y + 7, Math.min(104, w * 0.25), 5, 2.5);
    ctx.fill();
    ctx.fillStyle = th.muted;
    roundRectPath(ctx, cv.x + cv.w + 10, cv.y + 19, Math.min(74, w * 0.18), 3.5, 2);
    ctx.fill();

    // transport
    const pc = { x: g.play.x + g.play.w / 2, y: g.play.y + g.play.h / 2 };
    const playFill = visual.theme === 'dark' ? 'rgba(255,255,255,.94)' : a1;
    const glyph = visual.theme === 'dark' ? '#0b1020' : '#ffffff';
    ctx.fillStyle = playFill;
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = glyph;
    ctx.beginPath();
    ctx.moveTo(pc.x - 4, pc.y - 7);
    ctx.lineTo(pc.x + 8, pc.y);
    ctx.lineTo(pc.x - 4, pc.y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = th.text;
    [pc.x - 40, pc.x + 40].forEach((x, i) => {
      ctx.globalAlpha = 0.62;
      ctx.fillRect(x - 1, pc.y - 5, 2, 10);
      ctx.beginPath();
      ctx.moveTo(x + (i ? 3 : -3), pc.y - 5);
      ctx.lineTo(x + (i ? -3 : 3), pc.y);
      ctx.lineTo(x + (i ? 3 : -3), pc.y + 5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // mode / mute dots
    ctx.fillStyle = th.muted;
    ctx.fillRect(pc.x + 58, pc.y - 1, 8, 2);
    ctx.fillRect(w - 72, pc.y - 3, 10, 6);

    // timeline
    const ty = g.bar.y + g.bar.h / 2;
    ctx.fillStyle = th.track;
    roundRectPath(ctx, g.bar.x, ty - 1.5, g.bar.w, 3, 1.5);
    ctx.fill();
    const headX = g.bar.x + g.bar.w * g.progress;
    const fg = ctx.createLinearGradient(g.bar.x, 0, headX || g.bar.x + 1, 0);
    fg.addColorStop(0, a0);
    fg.addColorStop(1, a1);
    ctx.fillStyle = fg;
    roundRectPath(ctx, g.bar.x, ty - 1.5, Math.max(2, headX - g.bar.x), 3, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.beginPath();
    ctx.arc(headX, ty, 2.6, 0, TAU);
    ctx.fill();

    // times / volume
    ctx.fillStyle = th.muted;
    ctx.fillRect(g.bar.x - 24, ty - 1, 16, 2);
    ctx.fillRect(g.bar.x + g.bar.w + 9, ty - 1, 16, 2);
    const vx = w - padRight(w) - 34;
    ctx.fillStyle = th.track;
    roundRectPath(ctx, vx, ty - 1.5, 34, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = a1;
    roundRectPath(ctx, vx, ty - 1.5, 22, 3, 1.5);
    ctx.fill();
  }

  const padRight = (w) => Math.max(24, Math.min(42, w * 0.055));

  /* ==========================================================================
     Skin 01 — React Bits / Particles
     3D 景深粒子场 + 发光、闪烁、近邻连线、指针视差/排斥；进度头是一颗彗星。
     ========================================================================== */
  function drawStarfield(ctx, g, st, dt) {
    const w = g.w;
    const h = g.h;
    const n = Math.round(clamp(w / 13, 46, 132));
    if (!st.particles || st.particles.length !== n) {
      st.particles = Array.from({ length: n }, () => ({
        x: Math.random(), y: Math.random(), z: rand(0.12, 1.18),
        r: rand(0.7, 2.2), ph: rand(0, TAU), sp: rand(0.012, 0.05), tw: rand(0.7, 2.6),
        dx: 0, dy: 0, dz: 0
      }));
    }
    const cx = w / 2;
    const cy = h / 2;
    const headX = g.bar.x + g.bar.w * Math.max(0.001, g.progress);
    const headY = barY(g);

    if (!g.preview) {
      const bg = ctx.createRadialGradient(w * 0.2, 0, 0, w * 0.2, 0, w * 0.85);
      bg.addColorStop(0, 'rgba(31,94,160,.20)');
      bg.addColorStop(0.42, 'rgba(30,52,130,.10)');
      bg.addColorStop(1, 'rgba(4,7,16,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const bg2 = ctx.createRadialGradient(w * 0.84, h, 0, w * 0.84, h, w * 0.7);
      bg2.addColorStop(0, 'rgba(120,54,170,.16)');
      bg2.addColorStop(1, 'rgba(4,7,16,0)');
      ctx.fillStyle = bg2;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < n; i++) {
      const p = st.particles[i];
      p.z -= dt * (0.012 + p.sp);
      if (p.z < 0.04) {
        p.z = 1.24;
        p.x = Math.random();
        p.y = Math.random();
      }
      const scale = 0.32 + p.z * 0.92;
      let x = cx + (p.x * w - cx) * scale + Math.sin(st.t * 0.25 + p.ph) * 7 * scale;
      let y = cy + (p.y * h - cy) * scale + Math.cos(st.t * 0.21 + p.ph) * 4.5 * scale;

      if (g.pointer.inside) {
        const pdx = x - g.pointer.x;
        const pdy = y - g.pointer.y;
        const d = Math.hypot(pdx, pdy);
        if (d < 92 && d > 0.01) {
          const f = (1 - d / 92) * 26 * (g.preview ? 0.7 : 1);
          x += (pdx / d) * f;
          y += (pdy / d) * f;
        }
      }

      const tw = 0.34 + 0.66 * (0.5 + 0.5 * Math.sin(st.t * p.tw + p.ph));
      let boost = 0;
      if (Math.abs(y - headY) < 26) {
        const hd = Math.abs(x - headX);
        if (hd < 86) boost = (1 - hd / 86) * 0.72;
      }
      const a = clamp(tw * (0.14 + 0.55 * p.z) + boost, 0, 0.95);
      const size = Math.max(1.2, p.r * (0.7 + p.z * 1.8) * (2.4 + boost * 2));
      blitGlow(ctx, p.z > 0.68 ? 'cyan' : 'violet', x, y, size * 4.4, a * 0.62);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.z > 0.72 ? 'rgba(230,250,255,.98)' : 'rgba(196,181,253,.92)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.55, size * 0.42), 0, TAU);
      ctx.fill();

      p.dx = x;
      p.dy = y;
      p.dz = p.z;
    }

    // constellation lines — 只连前 28 颗近景粒子，避免 O(n²) 失控
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.55;
    const linked = Math.min(28, n);
    for (let i = 0; i < linked; i++) {
      const a = st.particles[i];
      if (!a.dz || a.dz < 0.56) continue;
      for (let j = i + 1; j < linked; j++) {
        const b = st.particles[j];
        if (!b.dz || b.dz < 0.56) continue;
        const d = Math.hypot(a.dx - b.dx, a.dy - b.dy);
        if (d < 62) {
          ctx.strokeStyle = `rgba(125,211,252,${(1 - d / 62) * 0.13})`;
          ctx.beginPath();
          ctx.moveTo(a.dx, a.dy);
          ctx.lineTo(b.dx, b.dy);
          ctx.stroke();
        }
      }
    }

    // progress comet
    ctx.globalCompositeOperation = 'lighter';
    const tailStart = Math.max(g.bar.x, headX - 74);
    const tg = ctx.createLinearGradient(tailStart, headY, headX, headY);
    tg.addColorStop(0, 'rgba(103,232,249,0)');
    tg.addColorStop(0.68, 'rgba(125,211,252,.42)');
    tg.addColorStop(1, 'rgba(255,255,255,.92)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailStart, headY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    blitGlow(ctx, 'cyan', headX, headY, 52, g.empty ? 0.46 : 0.92);
    blitGlow(ctx, 'violet', headX, headY, 34, 0.45);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(245,252,255,.98)';
    ctx.beginPath();
    ctx.arc(headX, headY, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ==========================================================================
     Skin 02 — Fancy Components / Cursor Attractor & Gravity
     软粒子受重力下落，被播放键/鼠标吸引，近距离产生涡旋。
     ========================================================================== */
  function drawGravity(ctx, g, st, dt) {
    const w = g.w;
    const h = g.h;
    const n = Math.round(clamp(w / 27, 28, 58));
    if (!st.particles || st.particles.length !== n) {
      st.particles = Array.from({ length: n }, () => ({
        x: rand(0, w), y: rand(0, h), vx: rand(-10, 10), vy: rand(-4, 8),
        r: rand(1.1, 3.1), ph: rand(0, TAU)
      }));
    }
    const px = g.pointer.x;
    const py = g.pointer.y;
    const target = g.pointer.inside ? { x: px, y: py, field: 148, pull: 980 }
      : { x: g.play.x + g.play.w / 2, y: g.play.y + g.play.h / 2, field: 118, pull: 330 };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of st.particles) {
      p.vy += 58 * dt;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const inf = Math.max(0, 1 - d / target.field);
      p.vx += (dx / d) * target.pull * inf * dt;
      p.vy += (dy / d) * target.pull * inf * dt;
      p.vx += (-dy / d) * target.pull * 0.16 * inf * dt;
      p.vy += (dx / d) * target.pull * 0.16 * inf * dt;

      if (g.pointer.inside) {
        const sdx = p.x - px;
        const sdy = p.y - py;
        const sd = Math.hypot(sdx, sdy);
        if (sd < 38 && sd > 0.01) {
          p.vx += (sdx / sd) * 120 * dt;
          p.vy += (sdy / sd) * 120 * dt;
        }
      }

      const damp = Math.pow(0.986, dt * 60);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.62; }
      if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx) * 0.62; }
      if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.5; }
      if (p.y > h - p.r - 2) { p.y = h - p.r - 2; p.vy = -Math.abs(p.vy) * 0.56; }

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 22) {
        ctx.globalAlpha = clamp(speed / 220, 0, 0.32);
        ctx.strokeStyle = 'rgba(255,190,150,.8)';
        ctx.lineWidth = p.r * 0.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      blitGlow(ctx, 'warm', p.x, p.y, p.r * 8.5, 0.36);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(255,214,186,.96)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      ctx.beginPath();
      ctx.arc(p.x - p.r * 0.28, p.y - p.r * 0.3, Math.max(0.45, p.r * 0.34), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ==========================================================================
     Skin 03 — Magic UI / Meteors
     斜向流星雨 + 进度彗尾；空态也一直在下流星。
     ========================================================================== */
  function resetMeteor(m, g, seed) {
    m.x = rand(-40, g.w + 160);
    m.y = seed ? rand(-g.h, g.h * 0.7) : rand(-80, -12);
    m.vx = -rand(90, 210);
    m.vy = rand(130, 300);
    m.len = rand(18, 52);
    m.a = rand(0.22, 0.72);
    m.w = Math.random() < 0.18 ? 1.6 : 1;
    return m;
  }

  function drawMeteors(ctx, g, st, dt) {
    const n = Math.round(clamp(g.w / 44, 14, 30));
    if (!st.meteors || st.meteors.length !== n) {
      st.meteors = Array.from({ length: n }, () => resetMeteor({}, g, true));
    }
    if (!g.preview) {
      const bg = ctx.createRadialGradient(g.w * 0.72, 0, 0, g.w * 0.72, 0, g.w * 0.9);
      bg.addColorStop(0, 'rgba(29,78,150,.24)');
      bg.addColorStop(0.5, 'rgba(12,25,60,.12)');
      bg.addColorStop(1, 'rgba(5,7,15,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, g.w, g.h);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const m of st.meteors) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y > g.h + 70 || m.x < -90) resetMeteor(m, g, false);
      const v = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / v) * m.len;
      const ty = m.y - (m.vy / v) * m.len;
      const grad = ctx.createLinearGradient(tx, ty, m.x, m.y);
      grad.addColorStop(0, 'rgba(96,165,250,0)');
      grad.addColorStop(0.55, `rgba(125,211,252,${m.a * 0.6})`);
      grad.addColorStop(1, `rgba(255,255,255,${m.a})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = m.w;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      blitGlow(ctx, 'blue', m.x, m.y, 20, m.a * 0.7);
      ctx.globalAlpha = m.a;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.1, 0, TAU);
      ctx.fill();
    }

    // progress = meteor runway
    const y = barY(g);
    const x0 = g.bar.x;
    const x1 = g.bar.x + g.bar.w * Math.max(0.0015, g.progress);
    const tg = ctx.createLinearGradient(x0, y, x1, y);
    tg.addColorStop(0, 'rgba(56,189,248,0)');
    tg.addColorStop(0.55, 'rgba(56,189,248,.42)');
    tg.addColorStop(0.88, 'rgba(147,197,253,.78)');
    tg.addColorStop(1, 'rgba(255,255,255,.96)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    blitGlow(ctx, 'blue', x1, y, 46, g.empty ? 0.34 : 0.86);
    blitGlow(ctx, 'cyan', x1, y, 24, 0.55);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.beginPath();
    ctx.arc(x1, y, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ==========================================================================
     Skin 04 — Aceternity UI / Sparkles
     tsparticles 式随机尺寸、速度、透明闪烁的星尘；进度头附近聚成一簇。
     ========================================================================== */
  function drawSparkles(ctx, g, st, dt) {
    const n = Math.round(clamp(g.w / 10.5, 48, 100));
    if (!st.sparkles || st.sparkles.length !== n) {
      const pcx = g.play.x + g.play.w / 2;
      const pcy = g.play.y + g.play.h / 2;
      st.sparkles = Array.from({ length: n }, (_, i) => {
        const orbital = i < n * 0.55;
        const ang = rand(0, TAU);
        const radius = rand(20, Math.min(150, g.w * 0.22));
        return {
          x: orbital ? pcx + Math.cos(ang) * radius : rand(0, g.w),
          y: orbital ? pcy + Math.sin(ang) * radius * 0.55 : rand(0, g.h),
          bx: 0, by: 0,
          vx: rand(-3, 3), vy: rand(-2.2, 2.2),
          r: rand(0.5, 1.7), ph: rand(0, TAU), sp: rand(0.7, 2.9),
          orbital, ang, radius, va: rand(-0.18, 0.18)
        };
      });
    }
    const headX = g.bar.x + g.bar.w * g.progress;
    const headY = barY(g);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of st.sparkles) {
      if (p.orbital) {
        p.ang += p.va * dt;
        p.x = (g.play.x + g.play.w / 2) + Math.cos(p.ang) * p.radius;
        p.y = (g.play.y + g.play.h / 2) + Math.sin(p.ang) * p.radius * 0.55;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -4) p.x = g.w + 4;
        if (p.x > g.w + 4) p.x = -4;
        if (p.y < -4) p.y = g.h + 4;
        if (p.y > g.h + 4) p.y = -4;
      }
      const tw = Math.pow(0.5 + 0.5 * Math.sin(st.t * p.sp + p.ph), 3);
      const arm = p.r * (0.7 + tw * 2.4);
      ctx.globalAlpha = 0.14 + tw * 0.7;
      ctx.strokeStyle = 'rgba(255,246,213,.95)';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(p.x - arm, p.y);
      ctx.lineTo(p.x + arm, p.y);
      ctx.moveTo(p.x, p.y - arm);
      ctx.lineTo(p.x, p.y + arm);
      ctx.stroke();
      blitGlow(ctx, 'gold', p.x, p.y, (3 + p.r * 7) * (0.7 + tw), 0.18 + tw * 0.45);
    }

    for (let i = 0; i < 8; i++) {
      const a = st.t * (0.7 + i * 0.05) + i * 0.8;
      const rr = 8 + (i % 4) * 7;
      const x = headX + Math.cos(a) * rr;
      const y = headY + Math.sin(a) * rr * 0.55;
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(st.t * 2.1 + i));
      blitGlow(ctx, 'gold', x, y, 14 + tw * 9, tw * 0.5);
      ctx.globalAlpha = tw;
      ctx.fillStyle = 'rgba(255,249,222,.95)';
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ==========================================================================
     Skin 05 — React Bits / Ballpit
     软光小球在播放条里做重力/碰撞，鼠标能推；进度头是一颗玻璃珠。
     ========================================================================== */
  const BALL_COLORS = ['#8ecae6', '#ffd166', '#a78bfa', '#5eead4', '#f9a8d4', '#93c5fd'];

  function drawBallpit(ctx, g, st, dt) {
    const n = Math.round(clamp(g.w / 38, 15, 34));
    if (!st.balls || st.balls.length !== n) {
      st.balls = Array.from({ length: n }, () => ({
        x: rand(6, Math.max(7, g.w - 6)),
        y: rand(0, Math.max(1, g.h * 0.7)),
        vx: rand(-16, 16), vy: rand(-8, 6),
        r: rand(2.2, 5.4),
        color: BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
      }));
    }
    const balls = st.balls;
    const floor = g.h - 4;

    for (const b of balls) {
      b.vy += 260 * dt;
      b.vx *= Math.pow(0.995, dt * 60);
      b.vy *= Math.pow(0.997, dt * 60);
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (g.pointer.inside) {
        const dx = b.x - g.pointer.x;
        const dy = b.y - g.pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < 66 && d > 0.01) {
          const f = (1 - d / 66) * 460;
          b.vx += (dx / d) * f * dt;
          b.vy += (dy / d) * f * dt;
        }
      }

      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
      if (b.x > g.w - b.r) { b.x = g.w - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.55; }
      if (b.y > floor - b.r) { b.y = floor - b.r; b.vy = -Math.abs(b.vy) * 0.68; }
    }

    // simple pair collisions
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = (min - d) * 0.5;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const imp = -(1 + 0.68) * vn * 0.5;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
          }
        }
      }
    }

    for (const b of balls) drawBall(ctx, b.color, b.x, b.y, b.r);

    // progress bead
    const hx = g.bar.x + g.bar.w * g.progress;
    const hy = barY(g);
    drawBall(ctx, '#ffffff', hx, hy, 5.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    blitGlow(ctx, 'blue', hx, hy, 22, 0.5);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.68)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, 5.2, 0, TAU);
    ctx.stroke();
  }

  /* ==========================================================================
     Skin 06 — Hover.dev / Magnet Button
     播放键附近的磁场线；按钮会被指针「吸」过去；圆环文字沿 SVG textPath 旋转。
     ========================================================================== */
  function drawMagnet(ctx, g, st) {
    const cx = g.play.x + g.play.w / 2;
    const cy = g.play.y + g.play.h / 2;
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const r = 27 + i * 14 + Math.sin(st.t * 0.8 + i) * 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(124,58,237,${0.16 - i * 0.028})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash(i % 2 ? [2, 6] : [1, 9]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (g.pointer.inside) {
      const dx = g.pointer.x - cx;
      const dy = g.pointer.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        ctx.strokeStyle = 'rgba(109,40,217,.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + dx * 0.35 - dy * 0.12, cy + dy * 0.35 + dx * 0.12, g.pointer.x, g.pointer.y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(124,58,237,.42)';
      ctx.beginPath();
      ctx.arc(g.pointer.x, g.pointer.y, 2, 0, TAU);
      ctx.fill();
    }

    const hx = g.bar.x + g.bar.w * g.progress;
    const hy = barY(g);
    ctx.strokeStyle = 'rgba(124,58,237,.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(196,181,253,.9)';
    ctx.beginPath();
    ctx.arc(hx, hy, 1.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const MAGNET_RING_SVG =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<defs><path id="pskin-magnet-path" d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0"/></defs>' +
    '<text><textPath href="#pskin-magnet-path" startOffset="0">PLAY · PAUSE · PLAY · PAUSE · </textPath></text>' +
    '</svg>';

  /* ==========================================================================
     Skin 07 — Magic UI / Shine Border
     radial-gradient + mask-composite 的扫光边框（CSS），canvas 再叠一层边缘扫光。
     ========================================================================== */
  function edgeSweep(ctx, y, w, phase, len, colors) {
    const x = phase * (w + len * 2) - len;
    const grad = ctx.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
    grad.addColorStop(0, 'rgba(34,211,238,0)');
    grad.addColorStop(0.4, 'rgba(34,211,238,.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.9)');
    grad.addColorStop(0.63, 'rgba(217,70,239,.62)');
    grad.addColorStop(1, 'rgba(217,70,239,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.lineTo(x + len / 2, y);
    ctx.stroke();
    blitGlow(ctx, colors || 'magenta', x, y, len * 0.5, 0.3);
  }

  function drawNeon(ctx, g, st) {
    const sweep = (st.t * 0.105) % 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    edgeSweep(ctx, 1.4, g.w, sweep, 190, 'cyan');
    edgeSweep(ctx, g.h - 1.4, g.w, (sweep + 0.52) % 1, 190, 'magenta');

    const hx = g.bar.x + g.bar.w * g.progress;
    const hy = barY(g);
    const vg = ctx.createLinearGradient(0, 0, 0, g.h);
    vg.addColorStop(0, 'rgba(217,70,239,0)');
    vg.addColorStop(0.45, 'rgba(217,70,239,.12)');
    vg.addColorStop(0.55, 'rgba(34,211,238,.14)');
    vg.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(hx - 15, 0, 30, g.h);
    blitGlow(ctx, 'magenta', hx, hy, 34, 0.6);
    blitGlow(ctx, 'cyan', hx, hy, 22, 0.7);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.arc(hx, hy, 1.8, 0, TAU);
    ctx.fill();

    if (g.preview) {
      // canvas 预览里没有 CSS 的 mask 边框，这里补一圈霓虹描边
      roundRectPath(ctx, 2, 2, g.w - 4, g.h - 4, 15);
      const border = ctx.createLinearGradient(0, 0, g.w, g.h);
      border.addColorStop(0, 'rgba(34,211,238,.0)');
      border.addColorStop(0.35, 'rgba(34,211,238,.55)');
      border.addColorStop(0.55, 'rgba(217,70,239,.55)');
      border.addColorStop(1, 'rgba(217,70,239,0)');
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ==========================================================================
     Skin 08 — React Bits / StarBorder
     沿圆角轮廓奔跑的光点 + 拖尾；玻璃高光与光束扫过。
     ========================================================================== */
  function perimeterPoint(x, y, w, h, r, t) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    const straightX = Math.max(0, w - rr * 2);
    const straightY = Math.max(0, h - rr * 2);
    const arc = (Math.PI * rr) / 2;
    const total = straightX * 2 + straightY * 2 + arc * 4;
    let d = (((t % 1) + 1) % 1) * total;
    if (d < straightX) return { x: x + rr + d, y };
    d -= straightX;
    if (d < arc) {
      const a = -Math.PI / 2 + d / rr;
      return { x: x + w - rr + Math.cos(a) * rr, y: y + rr + Math.sin(a) * rr };
    }
    d -= arc;
    if (d < straightY) return { x: x + w, y: y + rr + d };
    d -= straightY;
    if (d < arc) {
      const a = d / rr;
      return { x: x + w - rr + Math.cos(a) * rr, y: y + h - rr + Math.sin(a) * rr };
    }
    d -= arc;
    if (d < straightX) return { x: x + w - rr - d, y: y + h };
    d -= straightX;
    if (d < arc) {
      const a = Math.PI / 2 + d / rr;
      return { x: x + rr + Math.cos(a) * rr, y: y + h - rr + Math.sin(a) * rr };
    }
    d -= arc;
    if (d < straightY) return { x, y: y + h - rr - d };
    d -= straightY;
    const a = Math.PI + d / rr;
    return { x: x + rr + Math.cos(a) * rr, y: y + rr + Math.sin(a) * rr };
  }

  function drawStarBorder(ctx, g, st) {
    const w = g.w;
    const h = g.h;
    const head = (st.t * 0.075) % 1;
    const steps = 30;
    const trail = 0.075;
    const x = 2;
    const y = 2;
    const rw = Math.max(1, w - 4);
    const rh = Math.max(1, h - 4);
    const radius = Math.min(16, rh / 2);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let prev = perimeterPoint(x, y, rw, rh, radius, head);
    for (let i = 1; i <= steps; i++) {
      const t = head - trail * (i / steps);
      const pt = perimeterPoint(x, y, rw, rh, radius, t);
      const u = 1 - i / steps;
      const fade = u * u;
      ctx.strokeStyle = `rgba(255,255,255,${fade * 0.72})`;
      ctx.lineWidth = 0.6 + fade * 1.1;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(160,220,255,${fade * 0.28})`;
      ctx.lineWidth = 4 + fade * 6;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      prev = pt;
    }
    const hp = perimeterPoint(x, y, rw, rh, radius, head);
    blitGlow(ctx, 'silver', hp.x, hp.y, 34, 0.7);
    blitGlow(ctx, 'cyan', hp.x, hp.y, 18, 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 1.7, 0, TAU);
    ctx.fill();

    // 玻璃色散：斜向的冷/暖光带
    ctx.globalCompositeOperation = 'screen';
    ctx.save();
    ctx.translate(-w * 0.25, 0);
    ctx.rotate(-0.32);
    for (let k = 0; k < 3; k++) {
      const bx = ((st.t * 0.045 + k * 0.37) % 1.3) * w * 1.4;
      const bg = ctx.createLinearGradient(bx, 0, bx + w * 0.1, 0);
      bg.addColorStop(0, 'rgba(255,255,255,0)');
      bg.addColorStop(0.45, k === 1 ? 'rgba(255,170,230,.12)' : 'rgba(150,220,255,.13)');
      bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(bx, -h, w * 0.1, h * 3);
    }
    ctx.restore();

    // 进度头：玻璃珠
    const hx = g.bar.x + g.bar.w * g.progress;
    const hy = barY(g);
    const orb = ctx.createRadialGradient(hx - 2, hy - 2, 0, hx, hy, 8);
    orb.addColorStop(0, 'rgba(255,255,255,.98)');
    orb.addColorStop(0.35, 'rgba(210,240,255,.82)');
    orb.addColorStop(1, 'rgba(120,200,255,.18)');
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(hx, hy, 6.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.76)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
  }

  /* ==========================================================================
     Skin 09 — Aceternity UI / Tracing Beam
     机械刻度 + 带弹簧滞后的描线光束；空态做一次慢速校准扫描。
     ========================================================================== */
  function drawMechanical(ctx, g, st, dt) {
    const w = g.w;
    const h = g.h;
    const bar = g.bar;
    const ty = barY(g);
    const target = g.empty ? (st.t * 0.055) % 1 : g.progress;
    st.spring = st.spring ? lerp(st.spring, target, 1 - Math.pow(0.001, dt)) : target;

    ctx.save();
    // engraved groove
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bar.x, ty + 6);
    ctx.lineTo(bar.x + bar.w, ty + 6);
    ctx.stroke();

    // ruler ticks
    const gap = Math.max(5, Math.round(bar.w / 110));
    let idx = 0;
    for (let x = bar.x; x <= bar.x + bar.w + 0.5; x += gap, idx++) {
      const d = (x - bar.x) / Math.max(1, bar.w);
      const lit = d <= st.spring + 0.002;
      const major = idx % 5 === 0;
      const len = major ? 9 : 4;
      ctx.strokeStyle = lit
        ? `rgba(245,214,140,${major ? 0.92 : 0.52})`
        : `rgba(255,255,255,${major ? 0.22 : 0.12})`;
      ctx.lineWidth = major ? 1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, ty - len / 2);
      ctx.lineTo(x, ty + len / 2);
      ctx.stroke();
      if (lit) {
        ctx.fillStyle = `rgba(245,214,140,${major ? 0.20 : 0.1})`;
        ctx.fillRect(x - 0.5, ty - len / 2, 1, len);
      }
    }

    // full-width bottom ruler
    const by = h - 11;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(10, by);
    ctx.lineTo(w - 10, by);
    ctx.stroke();
    const bottomGap = Math.max(7, Math.round(w / 150));
    for (let x = 10, k = 0; x <= w - 10; x += bottomGap, k++) {
      const d = (x - 10) / Math.max(1, w - 20);
      const lit = d <= st.spring;
      ctx.strokeStyle = lit ? 'rgba(245,214,140,.55)' : 'rgba(255,255,255,.12)';
      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.lineTo(x, by - (k % 5 === 0 ? 5 : 2));
      ctx.stroke();
    }

    // tracing beam
    const bx = bar.x + bar.w * st.spring;
    const bg = ctx.createLinearGradient(bar.x, 0, bx, 0);
    bg.addColorStop(0, 'rgba(245,214,140,0)');
    bg.addColorStop(0.55, 'rgba(245,214,140,.55)');
    bg.addColorStop(1, 'rgba(255,246,214,.98)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = bg;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bar.x, ty);
    ctx.lineTo(bx, ty);
    ctx.stroke();
    blitGlow(ctx, 'gold', bx, ty, 42, g.empty ? 0.55 : 0.9);
    blitGlow(ctx, 'gold', bx, ty, 22, 0.8);

    // vertical tracing line (actual progress, not spring)
    if (!g.empty) {
      const ax = bar.x + bar.w * g.progress;
      const vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, 'rgba(245,214,140,0)');
      vg.addColorStop(0.5, 'rgba(245,214,140,.16)');
      vg.addColorStop(1, 'rgba(245,214,140,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(ax - 0.5, 0, 1, h);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,250,232,.98)';
    ctx.beginPath();
    ctx.arc(bx, ty, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ==========================================================================
     Skin 10 — Fancy Components / Gooey SVG Filter
     DOM 液态球在 SVG goo 滤镜下黏合；canvas 补金属高光/进度液滴。
     ========================================================================== */
  function drawLiquid(ctx, g, st, dt) {
    const w = g.w;
    const h = g.h;
    const ty = barY(g);
    const head = g.bar.x + g.bar.w * g.progress;

    if (!g.preview) {
      const sheen = ctx.createLinearGradient(0, 0, w, h);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.42, 'rgba(255,255,255,.07)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,.22)');
      sheen.addColorStop(0.58, 'rgba(255,255,255,.05)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    }

    // liquid ribbon on the progress line
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ribbon = ctx.createLinearGradient(g.bar.x, 0, Math.max(head, g.bar.x + 1), 0);
    ribbon.addColorStop(0, 'rgba(148,163,184,.08)');
    ribbon.addColorStop(0.65, 'rgba(203,213,225,.55)');
    ribbon.addColorStop(1, 'rgba(255,255,255,.98)');
    ctx.strokeStyle = ribbon;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = g.bar.x; x <= head; x += 4) {
      const y = ty + Math.sin(x * 0.055 + st.t * 2.1) * 1.15;
      if (x === g.bar.x) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // chrome blob at the head
    for (let i = 0; i < 4; i++) {
      const a = st.t * (1.1 + i * 0.2) + i * 1.7;
      const rr = 3 + i * 2.2;
      const x = head + Math.cos(a) * rr;
      const y = ty + Math.sin(a) * rr * 0.5;
      blitGlow(ctx, 'silver', x, y, 16 + i * 3, 0.3);
    }
    ctx.globalAlpha = 1;
    const blob = ctx.createRadialGradient(head - 2, ty - 2, 0, head, ty, 12);
    blob.addColorStop(0, 'rgba(255,255,255,1)');
    blob.addColorStop(0.34, 'rgba(229,238,248,.96)');
    blob.addColorStop(0.76, 'rgba(148,163,184,.62)');
    blob.addColorStop(1, 'rgba(100,116,139,0)');
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(head, ty, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.98)';
    ctx.beginPath();
    ctx.arc(head - 2.4, ty - 2.6, 2.3, 0, TAU);
    ctx.fill();

    // preview fallback: canvas blur blobs approximate the SVG goo filter
    if (g.preview) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(5px)';
      for (let i = 0; i < 5; i++) {
        const ph = (i / 5 + st.t * (0.03 + i * 0.006)) % 1;
        const x = g.bar.x + g.bar.w * ph;
        const y = ty + Math.sin(st.t * 0.9 + i) * 3;
        const r = i === 0 ? 9 : 6 + (i % 3) * 2;
        ctx.fillStyle = 'rgba(183,198,216,.78)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 5; i++) {
        const ph = (i / 5 + st.t * (0.03 + i * 0.006)) % 1;
        const x = g.bar.x + g.bar.w * ph;
        const y = ty + Math.sin(st.t * 0.9 + i) * 3 - 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ==========================================================================
     Skin registry
     ========================================================================== */
  const SKINS = [
    {
      id: '01', name: '星轨粒子', site: 'React Bits', comp: 'Particles',
      particle: true, theme: 'dark', accent: ['#67e8f9', '#a78bfa'],
      effect: '3D 景深粒子场，进度头是一颗发光彗星',
      draw: drawStarfield
    },
    {
      id: '02', name: '重力软粒', site: 'Fancy Components', comp: 'Cursor Attractor & Gravity',
      particle: true, theme: 'light', accent: ['#fdba74', '#fb7185'],
      effect: '软粒子受重力下落，被指针和播放键吸成涡旋',
      draw: drawGravity
    },
    {
      id: '03', name: '流星跑道', site: 'Magic UI', comp: 'Meteors',
      particle: true, theme: 'dark', accent: ['#38bdf8', '#818cf8'],
      effect: '斜向流星雨，进度条是流星的尾迹',
      draw: drawMeteors
    },
    {
      id: '04', name: '星尘光晕', site: 'Aceternity UI', comp: 'Sparkles',
      particle: true, theme: 'light', accent: ['#fde68a', '#f59e0b'],
      effect: '随机尺寸与速度的星尘，在播放键周围聚簇',
      draw: drawSparkles
    },
    {
      id: '05', name: '玻璃球池', site: 'React Bits', comp: 'Ballpit',
      particle: true, theme: 'light', accent: ['#8ecae6', '#a78bfa'],
      effect: '软光小球在条里碰撞弹跳，鼠标可以推开',
      draw: drawBallpit
    },
    {
      id: '06', name: '磁吸按钮', site: 'Hover.dev', comp: 'Magnet Button',
      particle: false, theme: 'light', accent: ['#c4b5fd', '#7c3aed'],
      effect: '控制键被指针磁吸，播放键外圈有旋转环字',
      draw: drawMagnet,
      build(layer) {
        const ring = document.createElement('div');
        ring.className = 'pskin-magnet-ring';
        ring.innerHTML = MAGNET_RING_SVG;
        layer.appendChild(ring);
        const buttons = Array.from(document.querySelectorAll('.transport__row .icbtn'));
        return {
          ring,
          buttons: buttons.map((el) => ({ el, x: 0, y: 0 }))
        };
      },
      frame(layer, g, st, dt, refs) {
        if (!refs) return;
        const cx = g.play.x + g.play.w / 2;
        const cy = g.play.y + g.play.h / 2;
        refs.ring.style.left = cx + 'px';
        refs.ring.style.top = cy + 'px';
        const pr = player.getBoundingClientRect();
        const px = pr.left + g.pointer.x;
        const py = pr.top + g.pointer.y;
        for (const b of refs.buttons) {
          const r = b.el.getBoundingClientRect();
          const bx = r.left + r.width / 2;
          const by = r.top + r.height / 2;
          const dx = px - bx;
          const dy = py - by;
          const d = Math.hypot(dx, dy);
          let tx = 0;
          let ty = 0;
          if (g.pointer.inside && d < 112 && d > 0.01) {
            const pull = (1 - d / 112) * 9;
            tx = (dx / d) * pull;
            ty = (dy / d) * pull;
          }
          const k = 1 - Math.pow(0.0015, Math.max(0.001, dt));
          b.x = lerp(b.x, tx, k);
          b.y = lerp(b.y, ty, k);
          const isPlay = b.el === playBtn;
          const hover = b.el.matches(':hover') ? 0.04 : 0;
          const scale = isPlay ? 1 + hover + Math.hypot(b.x, b.y) * 0.006 : 1;
          b.el.style.transform = `translate3d(${b.x.toFixed(2)}px,${b.y.toFixed(2)}px,0) scale(${scale.toFixed(3)})`;
        }
      },
      cleanup(layer, refs) {
        if (refs) {
          refs.buttons.forEach((b) => { b.el.style.transform = ''; });
          refs.ring.remove();
        }
      }
    },
    {
      id: '07', name: '霓虹扫边', site: 'Magic UI', comp: 'Shine Border',
      particle: false, theme: 'dark', accent: ['#22d3ee', '#e879f9'],
      effect: 'radial-gradient 蒙版扫光边框，进度头泛霓虹',
      draw: drawNeon,
      build(layer) {
        const neon = document.createElement('div');
        neon.className = 'pskin-neon';
        layer.appendChild(neon);
        return { neon };
      }
    },
    {
      id: '08', name: '棱镜玻璃', site: 'React Bits', comp: 'StarBorder',
      particle: false, theme: 'light', accent: ['#a5f3fc', '#c4b5fd'],
      effect: '沿边框奔跑的白光，玻璃面与色散光带',
      draw: drawStarBorder,
      build(layer) {
        const sheen = document.createElement('div');
        sheen.className = 'pskin-glass-sheen';
        layer.appendChild(sheen);
        return { sheen };
      }
    },
    {
      id: '09', name: '机械刻度', site: 'Aceternity UI', comp: 'Tracing Beam',
      particle: false, theme: 'dark', accent: ['#f5d68c', '#b0894f'],
      effect: '黄铜刻度尺 + 带弹簧滞后的描线光束',
      draw: drawMechanical
    },
    {
      id: '10', name: '液态汞滴', site: 'Fancy Components', comp: 'Gooey SVG Filter',
      particle: false, theme: 'light', accent: ['#e2e8f0', '#94a3b8'],
      effect: 'SVG goo 滤镜下黏合的液态金属球',
      draw: drawLiquid,
      build(layer) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const defs = document.createElementNS(svgNS, 'svg');
        defs.setAttribute('class', 'pskin-defs');
        defs.setAttribute('aria-hidden', 'true');
        defs.innerHTML =
          '<defs><filter id="pskin-goo-filter" x="-30%" y="-80%" width="160%" height="260%">' +
          '<feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>' +
          '<feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo"/>' +
          '<feComposite in="SourceGraphic" in2="goo" operator="atop"/>' +
          '</filter></defs>';
        const goo = document.createElement('div');
        goo.className = 'pskin-goo';
        const blobs = [];
        for (let i = 0; i < 7; i++) {
          const b = document.createElement('i');
          b.className = 'pskin-goo__b';
          b.style.width = (14 + (i % 4) * 5) + 'px';
          b.style.height = (14 + (i % 4) * 5) + 'px';
          goo.appendChild(b);
          blobs.push(b);
        }
        layer.appendChild(defs);
        layer.appendChild(goo);
        return { goo, blobs };
      },
      frame(layer, g, st, dt, refs) {
        if (!refs) return;
        const ty = barY(g);
        const head = g.bar.x + g.bar.w * g.progress;
        for (let i = 0; i < refs.blobs.length; i++) {
          const b = refs.blobs[i];
          let x;
          let y;
          let sx = 1;
          let sy = 1;
          if (i === 0) {
            x = head;
            y = ty;
            sx = g.empty ? 1.15 : 1.7;
            sy = g.empty ? 1.15 : 0.92;
          } else {
            const ph = (i / (refs.blobs.length - 1) + st.t * (0.022 + i * 0.004)) % 1;
            x = g.bar.x + g.bar.w * ph;
            y = ty + Math.sin(st.t * 0.95 + i * 1.3) * 3;
            sx = 1 + Math.sin(st.t * 1.2 + i) * 0.18;
            sy = 1 - Math.sin(st.t * 1.1 + i) * 0.14;
          }
          b.style.transform =
            `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${sx.toFixed(2)},${sy.toFixed(2)})`;
        }
      }
    }
  ];

  const SKIN_MAP = new Map(SKINS.map((s) => [s.id, s]));
  const VALID_ID = /^(0[1-9]|10)$/;

  function normalizeSkin(v) {
    return VALID_ID.test(String(v || '')) ? String(v) : '';
  }

  function readStored() {
    try {
      return normalizeSkin(localStorage.getItem(STORE_KEY));
    } catch (_) {
      return '';
    }
  }

  function writeStored(id) {
    try {
      if (id) localStorage.setItem(STORE_KEY, id);
      else localStorage.removeItem(STORE_KEY);
    } catch (_) { /* 隐私模式：只保留本次会话 */ }
  }

  /* ==========================================================================
     Actual runtime (hall only)
     ========================================================================== */
  let currentId = readStored();
  let active = null;
  let preview = null;
  let hoverCard = null;
  let idleTimer = 0;

  function isHall() {
    return document.body.dataset.view === 'hall';
  }
  function isSettings() {
    return document.body.dataset.view === 'settings';
  }
  function isHidden() {
    return document.hidden || document.visibilityState === 'hidden';
  }

  function setPointer(e) {
    if (!active) return;
    active.pointer.x = e.clientX;
    active.pointer.y = e.clientY;
  }
  window.addEventListener('pointermove', setPointer, { passive: true });

  function mountLayer(skin) {
    const layer = document.createElement('div');
    layer.className = `pskin-layer pskin-layer--${skin.id}`;
    layer.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'pskin-canvas';
    layer.appendChild(canvas);
    player.insertBefore(layer, player.firstChild);
    const state = makeState();
    let refs = null;
    if (skin.build) {
      try { refs = skin.build(layer, state); } catch (_) { refs = null; }
    }
    return { layer, canvas, state, refs };
  }

  function fitActive(a) {
    if (!a) return;
    const r = player.getBoundingClientRect();
    if (!r.width || !r.height) return;
    a.w = r.width;
    a.h = r.height;
    a.ctx = fitCanvas(a.canvas, r.width, r.height);
  }

  function drawFrame(a, dt) {
    if (!a || !a.ctx) return;
    const g = actualGeom(a);
    if (!g.w || !g.h) return;
    a.ctx.clearRect(0, 0, g.w, g.h);
    try {
      a.skin.draw(a.ctx, g, a.state, dt, a.refs);
      if (a.skin.frame) a.skin.frame(a.layer, g, a.state, dt, a.refs);
    } catch (err) {
      // 单帧异常不能打断播放器；停用当前皮肤即可
      console.warn('[player-skins] frame error', err);
      stopActive();
    }
  }

  function loop(now) {
    const a = active;
    if (!a) return;
    if (!isHall() || isHidden()) {
      stopActive();
      return;
    }
    const dt = a.last ? Math.min(0.05, (now - a.last) / 1000) : 0.016;
    a.last = now;
    a.state.t += dt;
    drawFrame(a, dt);
    if (active === a) a.raf = requestAnimationFrame(loop);
  }

  function startActive(id) {
    const skin = SKIN_MAP.get(id);
    if (!skin || !player) return;
    /* 播放器本体当前不可见（新版光河播放条接管时 #player 是 display:none）：
       这时量不到尺寸，fitActive 会失败 → 立刻 stopActive()；而 stopActive 改
       body 的 pskin-* 类又会触发下面的 MutationObserver → syncAll → 回到这里，
       形成「加类 / 去类」无限循环（每轮还建一层 canvas）。没有尺寸就什么都不做，
       等可见时那次同步自然会把它挂起来。 */
    const box = player.getBoundingClientRect();
    if (!box.width || !box.height) return;
    stopActive();

    document.body.classList.add(`pskin-${skin.id}`);
    document.body.dataset.pskin = skin.id;

    const built = mountLayer(skin);
    active = {
      id: skin.id,
      skin,
      layer: built.layer,
      canvas: built.canvas,
      ctx: null,
      state: built.state,
      refs: built.refs,
      w: 0,
      h: 0,
      raf: 0,
      last: 0,
      pointer: { x: -9999, y: -9999 },
      ro: null
    };
    fitActive(active);
    if (!active.ctx) {
      stopActive();
      return;
    }

    if (prefersReducedNow()) {
      active.state.t = 1.4;
      drawFrame(active, 0.016);
    } else {
      // 先同步画一帧：首帧不留白，goo / 磁吸圆环也不会闪在 0,0
      drawFrame(active, 0.016);
      if (active) {
        active.last = 0;
        active.raf = requestAnimationFrame(loop);
      }
    }

    if (active && 'ResizeObserver' in window) {
      active.ro = new ResizeObserver(() => {
        if (!active) return;
        const oldW = active.w;
        const oldH = active.h;
        fitActive(active);
        if (!active.ctx) return;
        if (prefersReducedNow() && (oldW !== active.w || oldH !== active.h)) {
          drawFrame(active, 0.016);
        }
      });
      active.ro.observe(player);
    }
  }

  function stopActive() {
    const a = active;
    if (!a) return;
    active = null;
    if (a.raf) cancelAnimationFrame(a.raf);
    if (a.ro) a.ro.disconnect();
    try {
      if (a.skin.cleanup) a.skin.cleanup(a.layer, a.refs);
    } catch (_) { /* noop */ }
    if (a.layer && a.layer.parentNode) a.layer.parentNode.removeChild(a.layer);
    document.body.classList.remove(`pskin-${a.id}`);
    if (document.body.dataset.pskin === a.id) delete document.body.dataset.pskin;
  }

  function syncActive() {
    if (isHall() && !isHidden() && currentId) {
      if (!active || active.id !== currentId) {
        startActive(currentId);
      } else if (prefersReducedNow()) {
        // 运行中切到「减少动效」：停掉 rAF，重建成静态帧
        if (active.raf) {
          stopActive();
          startActive(currentId);
        }
      } else if (!active.raf) {
        active.last = 0;
        active.raf = requestAnimationFrame(loop);
      }
    } else {
      stopActive();
    }
  }

  function syncAll() {
    syncActive();
    if (isSettings() && !isHidden()) {
      if (!preview) drawPreviewIdle();
    } else {
      stopPreview(false);
    }
  }

  document.addEventListener('visibilitychange', syncAll);
  if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', syncAll);

  const bodyObserver = new MutationObserver(syncAll);
  if (document.body) {
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['data-view', 'class'] });
  }

  window.addEventListener('resize', () => {
    if (active) {
      fitActive(active);
      if (prefersReducedNow()) drawFrame(active, 0.016);
    }
    if (preview) resizePreview();
    else if (isSettings()) drawPreviewIdle();
  }, { passive: true });

  /* ==========================================================================
     Picker
     ========================================================================== */
  function prefersReducedNow() {
    return reducedMQ.matches;
  }

  function cardMarkup(skin) {
    const on = skin ? skin.id === currentId : currentId === '';
    const tag = skin ? (skin.particle ? '粒子' : '视觉') : '重置';
    const sub = skin ? `${skin.site} · ${skin.comp}` : '回到原生播放条';
    return (
      `<button class="psp__card${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" data-skin="${skin ? skin.id : 'default'}">` +
        `<span class="psp__thumb psp__thumb--${skin ? skin.id : 'default'}" aria-hidden="true"></span>` +
        `<span class="psp__body">` +
          `<span class="psp__name">${skin ? skin.name : '默认'}</span>` +
          `<span class="psp__src">${sub}</span>` +
          `<span class="psp__tag${skin && skin.particle ? ' is-particle' : ''}">${tag}</span>` +
        `</span>` +
        `<span class="psp__check" aria-hidden="true"></span>` +
      `</button>`
    );
  }

  function initPicker() {
    if (!mount) return;
    const cards = [cardMarkup(null)].concat(SKINS.map(cardMarkup)).join('');
    mount.innerHTML =
      `<div class="psp">` +
        `<div class="psp__bar">` +
          `<span class="psp__blurb">10 套播放条皮肤 · 只改大厅底部这条 · 播放页内部保持原样</span>` +
          `<span class="psp__now" id="psp-now" aria-live="polite"></span>` +
        `</div>` +
        `<div class="psp__stagehead">` +
          `<span class="psp__sel" id="psp-sel">实时预览</span>` +
          `<span class="psp__live" id="psp-live">悬停 / 聚焦卡片预览</span>` +
        `</div>` +
        `<div class="psp__stage" id="psp-stage">` +
          `<canvas class="psp__canvas" id="psp-canvas" aria-hidden="true"></canvas>` +
        `</div>` +
        `<div class="psp__grid" id="psp-grid" role="radiogroup" aria-label="播放条皮肤">${cards}</div>` +
      `</div>`;

    const grid = $('#psp-grid', mount);
    const stage = $('#psp-stage', mount);
    const canvas = $('#psp-canvas', mount);

    updatePickerState();

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.psp__card');
      if (!card) return;
      selectSkin(card.dataset.skin === 'default' ? '' : card.dataset.skin);
      previewSkin(card.dataset.skin === 'default' ? '' : card.dataset.skin);
    });

    grid.addEventListener('keydown', (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      const list = Array.from(grid.querySelectorAll('.psp__card'));
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      let next = i;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      list[next].focus();
    });

    grid.querySelectorAll('.psp__card').forEach((card) => {
      card.addEventListener('pointerenter', () => {
        hoverCard = card;
        clearTimeout(idleTimer);
        const id = card.dataset.skin === 'default' ? '' : card.dataset.skin;
        previewSkin(id);
      });
      card.addEventListener('pointerleave', () => {
        if (hoverCard === card) hoverCard = null;
        scheduleIdle();
      });
      card.addEventListener('focus', () => {
        hoverCard = card;
        clearTimeout(idleTimer);
        const id = card.dataset.skin === 'default' ? '' : card.dataset.skin;
        previewSkin(id);
      });
      card.addEventListener('blur', (e) => {
        if (e.relatedTarget && grid.contains(e.relatedTarget)) return;
        if (hoverCard === card) hoverCard = null;
        scheduleIdle();
      });
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!preview) return;
      const r = canvas.getBoundingClientRect();
      preview.st.pointer.x = e.clientX - r.left;
      preview.st.pointer.y = e.clientY - r.top;
      preview.st.pointer.inside = true;
    }, { passive: true });
    canvas.addEventListener('pointerleave', () => {
      if (preview) preview.st.pointer.inside = false;
    });

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        if (preview) resizePreview();
        else if (isSettings()) drawPreviewIdle();
      });
      ro.observe(stage);
    }
  }

  function updatePickerState() {
    const nowEl = $('#psp-now', mount);
    if (nowEl) {
      const skin = SKIN_MAP.get(currentId);
      nowEl.textContent = '当前：' + (skin ? `${skin.id} ${skin.name}` : '默认');
    }
    const grid = $('#psp-grid', mount);
    if (!grid) return;
    grid.querySelectorAll('.psp__card').forEach((card) => {
      const id = card.dataset.skin === 'default' ? '' : card.dataset.skin;
      const on = id === currentId;
      card.classList.toggle('is-on', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function updateStageLabel(skin) {
    const sel = $('#psp-sel', mount);
    const live = $('#psp-live', mount);
    if (sel) sel.textContent = skin ? `${skin.id} · ${skin.name}` : '默认播放条';
    if (live) live.textContent = skin
      ? (skin.particle ? '粒子 · ' : '视觉 · ') + skin.site
      : '无皮肤 · 原生外观';
  }

  function selectSkin(id) {
    currentId = normalizeSkin(id);
    writeStored(currentId);
    updatePickerState();
    syncActive();
    if (isSettings() && !preview) drawPreviewIdle();
  }

  function previewSkin(id) {
    if (!isSettings() || isHidden()) return;
    const skin = SKIN_MAP.get(id) || null;
    stopPreview(false);
    const stage = $('#psp-stage', mount);
    const canvas = $('#psp-canvas', mount);
    if (!stage || !canvas) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const st = makeState();
    st.w = r.width;
    st.h = r.height;
    st.pointer = { x: r.width * 0.62, y: r.height * 0.5, inside: false };
    const ctx = fitCanvas(canvas, r.width, r.height);
    if (!ctx) return;
    preview = { skin, st, canvas, ctx, w: r.width, h: r.height, raf: 0, last: 0 };
    updateStageLabel(skin);
    const live = $('#psp-live', mount);
    if (live) live.textContent = '正在预览 · ' + (skin ? skin.site : '原生');
    preview.last = performance.now();
    if (prefersReducedNow()) {
      renderPreviewFrame(preview, 0.016);
    } else {
      preview.raf = requestAnimationFrame(previewLoop);
    }
  }

  function renderPreviewFrame(p, dt) {
    if (!p || !p.ctx) return;
    const g = previewGeom(p.st);
    g.w = p.w;
    g.h = p.h;
    p.ctx.clearRect(0, 0, p.w, p.h);
    drawMock(p.ctx, g, p.skin || DEFAULT_VISUAL);
    if (p.skin) {
      try { p.skin.draw(p.ctx, g, p.st, dt, null); } catch (_) { /* preview 静默 */ }
    }
  }

  function previewLoop(now) {
    const p = preview;
    if (!p) return;
    if (!isSettings() || isHidden()) {
      stopPreview(true);
      return;
    }
    const dt = p.last ? Math.min(0.05, (now - p.last) / 1000) : 0.016;
    p.last = now;
    p.st.t += dt;
    renderPreviewFrame(p, dt);
    if (preview === p) {
      if (prefersReducedNow()) {
        p.raf = 0;
        renderPreviewFrame(p, 0.016);
        return;
      }
      p.raf = requestAnimationFrame(previewLoop);
    }
  }

  function stopPreview(drawIdle) {
    if (preview) {
      if (preview.raf) cancelAnimationFrame(preview.raf);
      preview = null;
    }
    clearTimeout(idleTimer);
    if (drawIdle) drawPreviewIdle();
  }

  function resizePreview() {
    if (!preview) {
      if (isSettings()) drawPreviewIdle();
      return;
    }
    const stage = $('#psp-stage', mount);
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    preview.w = r.width;
    preview.h = r.height;
    preview.st.w = r.width;
    preview.st.h = r.height;
    preview.ctx = fitCanvas(preview.canvas, r.width, r.height);
    preview.st.pointer.x = clamp(preview.st.pointer.x, 0, r.width);
    preview.st.pointer.y = clamp(preview.st.pointer.y, 0, r.height);
    if (prefersReducedNow()) renderPreviewFrame(preview, 0.016);
  }

  function drawPreviewIdle() {
    if (!mount || !isSettings() || isHidden()) return;
    const stage = $('#psp-stage', mount);
    const canvas = $('#psp-canvas', mount);
    if (!stage || !canvas) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const st = makeState();
    st.w = r.width;
    st.h = r.height;
    st.t = 1.75;
    const ctx = fitCanvas(canvas, r.width, r.height);
    if (!ctx) return;
    const skin = SKIN_MAP.get(currentId) || null;
    const g = previewGeom(st);
    g.w = r.width;
    g.h = r.height;
    ctx.clearRect(0, 0, r.width, r.height);
    drawMock(ctx, g, skin || DEFAULT_VISUAL);
    if (skin) {
      try { skin.draw(ctx, g, st, 0.016, null); } catch (_) { /* noop */ }
    }
    updateStageLabel(skin);
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!hoverCard && !(mount && mount.contains(document.activeElement)) && !preview) return;
      if (hoverCard) return;
      if (mount && mount.contains(document.activeElement)) return;
      stopPreview(true);
    }, 240);
  }

  /* ==========================================================================
     Boot
     ========================================================================== */
  initPicker();
  if (document.body && document.body.dataset.view === undefined) {
    // app.js 还没写 data-view 时不做任何事；它一定会先于 defer 脚本执行。
  }
  syncAll();
})();
