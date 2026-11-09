/**
 * player-bar-next —— 「光河」底部播放状态栏（原生 JS，无构建）
 * ============================================================================
 * 不是换皮：整条底栏变成可拖拽的光河，播放/暂停/切歌/音量/展开都换了操作。
 *
 * ReactBits 组件移植（源码读过 github.com/DavidHDev/react-bits）：
 *   Aurora（Backgrounds）      → WebGL2 光河片元着色器（simplex / 三层 / reveal / dither）
 *   Particles（Backgrounds）   → 河中粒子（深度 / bob / twinkle / 指针斥力 / 冲击波）
 *   Magnet（Animations）       → 弹簧 170/16/1 + smoothstep reach（光球 / 光点 / 卡片倾斜）
 *   ClickSpark（Animations）   → 点击与拖拽松手的线状火花
 *   SpotlightCard（Components）→ 唱片卡跟随光斑 + 边缘辉光 + 颗粒
 *   StarBorder（Animations）   → 唱片卡圆角边框参数化 + 彗星拖尾
 *
 * 只调用 Player.* 和 Player.on(...)，不改 app.js。
 * 旧 footer.player 由 body.pbn-on 隐藏，DOM 与事件原样保留。
 * 默认**不挂载**：设置页「主页面播放条」开着（localStorage lizi.home.playerbar='1'）
 * 才 boot；关着时连 CSS 都不注入 —— 不建 WebGL、不起 rAF。关时 body.pbn-off
 * 同时藏住新栏和旧 footer（只藏一个另一个会露出来）。
 * 地址带 ?oldbar=1 时本脚本撤掉 pbn-off 后直接退出（调试回退到旧栏）。
 * ============================================================================
 */
(() => {
  'use strict';

  /* 0. 回退开关与依赖 ------------------------------------------------------ */
  const params = new URLSearchParams(location.search);
  const oldbar = params.get('oldbar') === '1';

  /* 主页面播放条默认关：localStorage['lizi.home.playerbar'] === '1' 才挂载。
     关着的时候连样式都不加载 —— 没有 init()、没有 WebGL、没有 rAF。
     「关」必须同时藏新栏和旧 footer（只藏 #pbn 的话旧 footer 会露出来），
     所以统一靠 body.pbn-off（app.css 和本目录 css 各有一组规则）。 */
  const HOME_BAR_KEY = 'lizi.home.playerbar';
  const readHomeBar = () => {
    try { return localStorage.getItem(HOME_BAR_KEY) === '1'; } catch { return false; }
  };
  let homeOn = readHomeBar();
  let booted = false;
  let ctl = null;                       // init() 暴露的 { syncVisibility, stopLoop }

  function paintHomeBar(on) {
    const body = document.body;
    if (!body) return;
    body.classList.toggle('pbn-off', !on);
    if (!on) body.classList.remove('pbn-on');
  }
  /* oldbar=1 是调试回退：明确要旧栏，撤销默认的 pbn-off，也不再挂新栏。 */
  paintHomeBar(oldbar || homeOn);

  /* 设置页开关的唯一入口（app.js 只调这里）。先挂上 API：
     脚本此时可能还在等 CSS，但 key 和类的兜底已经能生效。 */
  window.LIZI_PLAYERBAR = {
    enabled() { return homeOn; },
    setEnabled(on) {
      on = !!on;
      homeOn = on;
      try { localStorage.setItem(HOME_BAR_KEY, on ? '1' : '0'); } catch { /* 隐私模式 */ }
      if (oldbar) return;             // ?oldbar=1：调试回退优先，不参与新栏开关
      paintHomeBar(on);
      if (on) {
        if (!P) return;               // 没有 Player 就只剩 key + 类
        boot();
        /* 已经建过（只是被关掉）时 init 不会再跑：要自己把类补回来 */
        if (document.getElementById('pbn')) document.body.classList.add('pbn-on');
        if (ctl) ctl.syncVisibility();
      } else {
        /* 没有建过就没什么可停的；建过就让可见性立刻为 false 并明确停一次 rAF。 */
        if (!document.getElementById('pbn')) booted = false;
        if (ctl) {
          ctl.syncVisibility();       // 顺带收起唱片卡 / 音量弧带
          ctl.stopLoop();             // 双保险：可见性已经 false 时也不会漏帧
        }
      }
    },
  };

  if (oldbar) return;

  const P = typeof Player !== 'undefined' ? Player : null;
  /* 没有 Player 也把 API 留出来：设置页开关不会抛错，key 照常记。 */
  if (!P) return;

  const script = document.currentScript;
  const base = script && script.src
    ? new URL('.', script.src)
    : new URL('/player-bar-next/', location.href);
  const CSS_HREF = new URL('player-bar-next.css?v=20261107-1', base).href;

  /* 1. 样式就位后再挂载，避免新栏无样式地闪一下 --------------------------- */
  function boot() {
    if (booted || !homeOn) return;
    booted = true;
    const start = () => {
      /* 样式还没到就被关掉了：不 init；下次打开会重新走 boot。 */
      if (!homeOn) return;
      try {
        init();
      } catch (err) {
        try { console.warn('[player-bar-next]', err); } catch { /* ignore */ }
        /* 初始化失败不能让用户失去播放条：回滚成旧栏。 */
        try {
          document.body.classList.remove('pbn-on');
          const node = document.getElementById('pbn');
          if (node) node.remove();
          const oldBar = document.getElementById('player');
          if (oldBar) {
            oldBar.removeAttribute('aria-hidden');
            oldBar.removeAttribute('inert');
          }
        } catch { /* ignore */ }
        /* 允许下次打开时重新尝试（否则开关会把指针留给一个已经不存在的 host）。 */
        booted = false;
        ctl = null;
      }
    };
    const old = document.querySelector('link[data-pbn-next]');
    if (old) {
      /* 已有样式（脚本被重复执行）也要等本轮同步代码跑完：TEMPLATE 在下方声明。 */
      setTimeout(start, 0);
    } else {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      link.dataset.pbnNext = '1';
      link.addEventListener('load', start, { once: true });
      link.addEventListener('error', start, { once: true });
      document.head.appendChild(link);
      setTimeout(start, 900);
    }
  }
  if (homeOn) boot();

  /* 2. 主流程 -------------------------------------------------------------- */
  function init() {
    if (document.getElementById('pbn')) return;
    /* 等 CSS 的这一小段时间里可能已经被设置页关掉了，别再白建 WebGL。 */
    if (!homeOn) return;
    const body = document.body;
    if (!body) return;

    /* 旧栏：隐藏 + 不再接受焦点。DOM / app.js 绑定全部保留。 */
    body.classList.add('pbn-on');
    const oldBar = document.getElementById('player');
    if (oldBar) {
      oldBar.setAttribute('aria-hidden', 'true');
      oldBar.setAttribute('inert', '');
    }

    const host = document.createElement('aside');
    host.id = 'pbn';
    host.className = 'pbn';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', '播放状态栏');
    host.dataset.playing = 'false';
    host.dataset.expanded = 'false';
    host.innerHTML = TEMPLATE;
    body.appendChild(host);

    /* ---- 元素 ---- */
    const q = (s) => host.querySelector(s);
    const el = {
      aurora: q('#pbn-aurora'),
      sparks: q('#pbn-sparks'),
      cardStar: q('#pbn-card-star'),
      art: q('#pbn-art'),
      cover: q('#pbn-cover'),
      title: q('#pbn-title'),
      sub: q('#pbn-sub'),
      badge: q('#pbn-badge'),
      paint: q('#pbn-paint'),
      rail: q('#pbn-rail'),
      fill: q('#pbn-fill'),
      buf: q('#pbn-buf'),
      glint: q('#pbn-glint'),
      head: q('#pbn-head'),
      bubble: q('#pbn-bubble'),
      prev: q('#pbn-prev'),
      next: q('#pbn-next'),
      prevIn: q('#pbn-prev .pbn__orb-in'),
      nextIn: q('#pbn-next .pbn__orb-in'),
      volWrap: q('#pbn-vol'),
      volBtn: q('#pbn-vol-btn'),
      volUse: q('#pbn-vol-use'),
      arcFill: q('#pbn-arc-fill'),
      arcNum: q('#pbn-arc-num'),
      modeBtn: q('#pbn-mode'),
      modeUse: q('#pbn-mode-use'),
      modeLabel: q('#pbn-mode-label'),
      grip: q('#pbn-expand'),
      coach: q('#pbn-coach'),
      cardWrap: q('#pbn-card-wrap'),
      card: q('#pbn-card'),
      cardTilt: q('#pbn-card-tilt'),
      cardArt: q('#pbn-card-art'),
      cardCover: q('#pbn-card-cover'),
      cardTitle: q('#pbn-card-title'),
      cardSub: q('#pbn-card-sub'),
      cardMode: q('#pbn-card-mode'),
      lyricCur: q('#pbn-lyric-cur'),
      lyricTr: q('#pbn-lyric-tr'),
      lyricNext: q('#pbn-lyric-next'),
      cardCur: q('#pbn-card-cur'),
      cardFill: q('#pbn-card-fill'),
      cardTotal: q('#pbn-card-total'),
      cardVol: q('#pbn-card-vol'),
      cardVolFill: q('#pbn-card-vol-fill'),
      cardVolNum: q('#pbn-card-vol-num'),
      cardVolUse: q('#pbn-card-vol-use'),
      cardMute: q('#pbn-card-mute'),
      cardOpen: q('#pbn-open-now'),
      cardX: q('#pbn-card-x'),
    };

    /* ---- 常量 ---- */
    const TAU = Math.PI * 2;
    const BLEED = 26;
    const MODE = {
      order:   { short: '顺序', full: '顺序播放', icon: '#i-list' },
      loop:    { short: '循环', full: '列表循环', icon: '#i-order' },
      single:  { short: '单曲', full: '单曲循环', icon: '#i-single' },
      shuffle: { short: '随机', full: '随机播放', icon: '#i-shuffle' },
    };
    const DEFAULT_COLORS = [
      [86, 212, 255], [150, 124, 255], [255, 126, 192], [255, 204, 120], [120, 255, 208],
    ];

    /* ---- prefers-reduced-motion ---- */
    const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduce = !!(reduceMQ && reduceMQ.matches);

    /* ---- 工具 ---- */
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const fmt = (sec) => {
      if (!Number.isFinite(sec) || sec < 0) sec = 0;
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    };
    const cssRgb = (c) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`;
    const cssRgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${clamp(a, 0, 1).toFixed(3)})`;

    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      let h = 0, s = 0;
      if (d > 0.00001) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return [h, s, l];
    }

    function hslToRgb(h, s, l) {
      h = (((h % 360) + 360) % 360) / 60;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h % 2) - 1));
      let r = 0, g = 0, b = 0;
      if (h < 1) { r = c; g = x; }
      else if (h < 2) { r = x; g = c; }
      else if (h < 3) { g = c; b = x; }
      else if (h < 4) { g = x; b = c; }
      else if (h < 5) { r = x; b = c; }
      else { r = c; b = x; }
      const m = l - c / 2;
      return [
        Math.round(clamp(r + m, 0, 1) * 255),
        Math.round(clamp(g + m, 0, 1) * 255),
        Math.round(clamp(b + m, 0, 1) * 255),
      ];
    }

    function buildPalette(colors) {
      const c0 = (colors && colors[0]) || DEFAULT_COLORS[0];
      const hsl = rgbToHsl(c0[0] || 0, c0[1] || 0, c0[2] || 0);
      let h = Number.isFinite(hsl[0]) ? hsl[0] : 220;
      const s = clamp(Number.isFinite(hsl[1]) ? hsl[1] : 0.45, 0.42, 0.84);
      const l = clamp(Number.isFinite(hsl[2]) ? hsl[2] : 0.48, 0.50, 0.68);
      return [
        hslToRgb(h - 16, s * 0.92, l * 0.70),
        hslToRgb(h, s, l),
        hslToRgb(h + 26, s * 0.90, Math.min(0.82, l * 1.14)),
        hslToRgb(h + 58, s * 0.70, Math.min(0.88, l * 1.26)),
        hslToRgb(h + 106, s * 0.52, Math.min(0.92, l * 1.38)),
      ];
    }

    const DEFAULT_PALETTE = buildPalette(DEFAULT_COLORS);

    /* ---- 运行状态 ---- */
    const S = {
      playing: false,
      hasTrack: false,
      dur: 0,
      targetBase: 0,
      target: 0,
      display: 0,
      buffer: 0,
      scrubbing: false,
      preview: 0,
      lockTimeUntil: 0,
      lastTimeEvent: performance.now(),
      lastSeekAt: 0,
      visible: true,
      expanded: false,
      mode: 'order',
      vol: 1,
      muted: false,
      lyricLines: [],
      lyricActive: -1,
      palette: DEFAULT_PALETTE.slice(),
      stopsFlat: new Float32Array(15),
      paletteToken: 0,
      shaderTime: 0,
      reveal: reduce ? 1 : 0,
      revealTarget: 1,
      pointerPresence: 0,
      pointerTarget: 0,
      pointerX: 0.5,
      pointerY: 0.5,
      pointerXCss: 0,
      pointerYCss: 0,
      railW: 0,
      hostW: 0,
      hostH: 0,
      dpr: 1,
      coachShown: false,
      coachTimer: 0,
      arcTimer: 0,
      starPhase: 0,
      starW: 0,
      starH: 0,
      hidden: false,
    };

    let raf = 0;
    let lastTs = 0;
    const headMag = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    const tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    const orbSprings = [
      { el: el.prevIn, btn: el.prev, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
      { el: el.nextIn, btn: el.next, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
    ];
    let moteColors = S.palette.map(cssRgb);
    let lastTrigger = null;
    let gesture = { active: false, id: -1, x0: 0, y0: 0, mode: 'pending', ratio: 0 };

    /* ---- 调色板应用 ---- */
    function applyPalette(colors) {
      const p = (colors && colors.length ? colors : DEFAULT_PALETTE).slice(0, 5);
      while (p.length < 5) p.push(p[p.length - 1] || [150, 170, 220]);
      S.palette = p;
      for (let i = 0; i < 5; i++) {
        S.stopsFlat[i * 3] = p[i][0] / 255;
        S.stopsFlat[i * 3 + 1] = p[i][1] / 255;
        S.stopsFlat[i * 3 + 2] = p[i][2] / 255;
      }
      host.style.setProperty('--pbn-c1', cssRgb(p[1]));
      host.style.setProperty('--pbn-c2', cssRgb(p[0]));
      host.style.setProperty('--pbn-c3', cssRgb(p[2]));
      host.style.setProperty('--pbn-c4', cssRgb(p[3]));
      host.style.setProperty('--pbn-c5', cssRgb(p[4]));
      moteColors = p.map(cssRgb);
      uploadStops();
      if (reduce) paintStatic();
    }

    /* ---- Aurora：ReactBits Backgrounds/Aurora 的 WebGL2 片元着色器移植 ----
       保留了 snoise / 三层 curtain / 指针 reach / reveal / dither 的结构；
       坐标系从「顶部极光帘」改成「贴着底边的河」，色带由 OKLCH 改成 sRGB stops
       （颜色仍由封面取色推导）。流速同时吃 uTime 和 uProgress，所以进度本身
       就是水流的相位；暂停时只剩很慢的呼吸。 */
    const AURORA_VERT = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

    const AURORA_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uTime;
uniform float uProgress;
uniform float uPlaying;
uniform vec3 uStops[5];
uniform int uStopCount;
uniform vec3 uPointer;
uniform float uReveal;
out vec4 outColor;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uStops[i], uStops[i + 1], f);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float x = uv.x;
  float y = uv.y;
  float t = uTime;
  float head = clamp(uProgress, 0.0, 1.0);
  float reach = uPointer.z * exp(-pow((x - uPointer.x) / 0.20, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;

  for (int k = 0; k < 3; k++) {
    float layer = float(k);
    float seed = layer * 12.7;
    float pace = t * (0.90 - layer * 0.17) + uProgress * 2.10;

    float warp = snoise(vec2(x * 1.65 + pace * 0.10 + seed, pace * 0.055 + seed));
    float wave = snoise(vec2(x * 2.70 + warp * 0.55 - pace * 0.13 + seed, pace * 0.090 + seed * 0.4)) * 0.70
               + snoise(vec2(x * 5.30 + warp * 0.70 + pace * 0.075 - seed, pace * 0.125 + seed * 0.7)) * 0.30;

    float hem = 0.17 + layer * 0.055 + wave * (0.075 + 0.035 * uPlaying);
    hem += reach * 0.028;

    float rise = hem - y;
    float soft = 0.042 + layer * 0.028;
    float body = pow(smootherstep(-soft, soft * 3.0 + 0.035, rise), 1.18 + 0.18 * layer);
    body *= 1.0 - smootherstep(0.44, 0.99, y);

    float headGlow = exp(-pow((x - head) / 0.012, 2.0));
    float traveled = 1.0 - smoothstep(head - 0.05, head + 0.05, x);
    float amp = mix(0.62, 1.10, traveled) + headGlow * 1.35;
    float lobes = 0.80 + 0.20 * snoise(vec2(x * 3.10 - pace * 0.07 + seed, y * 2.20 + pace * 0.05));

    float alpha = body * lobes * amp * (0.56 + 0.44 * uPlaying);
    alpha += headGlow * 0.30 * exp(-pow((y - hem) / 0.055, 2.0));
    alpha *= 1.0 - layer * 0.16;
    alpha = clamp(alpha, 0.0, 1.0);

    vec3 tint = ramp(x * 0.52 + layer * 0.17 + 0.14 * sin(pace * 0.15 + layer * 2.1) + max(rise, 0.0) * 0.42);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.82, uReveal);
  glow *= fade;
  cover *= fade;
  float dither = (hash(frag) - 0.5) / 160.0;
  glow = clamp(glow + dither, 0.0, 1.0);

  /* premultiplied alpha：glow 已经是 alpha 加权后的颜色 */
  outColor = vec4(glow, clamp(cover * 0.94, 0.0, 1.0));
}`;

    let aurora = null;

    function compileShader(gl, type, src) {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        try { console.warn('[player-bar-next] shader', gl.getShaderInfoLog(sh)); } catch { /* ignore */ }
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    function initAurora() {
      if (aurora) return;
      let gl = null;
      try {
        gl = el.aurora.getContext('webgl2', {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          powerPreference: 'low-power',
        });
      } catch { gl = null; }
      if (!gl) { host.classList.add('pbn--no-webgl'); return; }

      const vs = compileShader(gl, gl.VERTEX_SHADER, AURORA_VERT);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, AURORA_FRAG);
      if (!vs || !fs) { host.classList.add('pbn--no-webgl'); return; }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        host.classList.add('pbn--no-webgl');
        return;
      }

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, 'aPosition');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);

      aurora = {
        gl, prog, buffer,
        loc: {
          res: gl.getUniformLocation(prog, 'uRes'),
          time: gl.getUniformLocation(prog, 'uTime'),
          progress: gl.getUniformLocation(prog, 'uProgress'),
          playing: gl.getUniformLocation(prog, 'uPlaying'),
          stops: gl.getUniformLocation(prog, 'uStops[0]'),
          count: gl.getUniformLocation(prog, 'uStopCount'),
          pointer: gl.getUniformLocation(prog, 'uPointer'),
          reveal: gl.getUniformLocation(prog, 'uReveal'),
        },
      };
      host.classList.remove('pbn--no-webgl');
    }

    function uploadStops() {
      if (!aurora) return;
      const { gl, prog, loc } = aurora;
      if (!loc.stops) return;
      gl.useProgram(prog);
      gl.uniform3fv(loc.stops, S.stopsFlat);
    }

    function drawAurora() {
      if (!aurora) return;
      const { gl, prog, loc } = aurora;
      const cw = el.aurora.width;
      const ch = el.aurora.height;
      if (!cw || !ch) return;
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform2f(loc.res, cw, ch);
      gl.uniform1f(loc.time, S.shaderTime);
      gl.uniform1f(loc.progress, clamp(S.display, 0, 1));
      gl.uniform1f(loc.playing, S.playing ? 1 : 0);
      gl.uniform3fv(loc.stops, S.stopsFlat);
      gl.uniform1i(loc.count, 5);
      gl.uniform3f(loc.pointer, S.pointerX, S.pointerY, S.pointerPresence);
      gl.uniform1f(loc.reveal, S.reveal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    el.aurora.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      aurora = null;
      host.classList.add('pbn--no-webgl');
    }, false);
    el.aurora.addEventListener('webglcontextrestored', () => {
      initAurora();
      uploadStops();
      if (reduce) paintStatic();
      else wake();
    }, false);

    /* ---- 2D 画布上下文 ---- */
    const sparksCtx = el.sparks.getContext('2d');
    const starCtx = el.cardStar.getContext('2d');

    function setCanvasPixels(cv, cssW, cssH, dpr) {
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
      return false;
    }

    /* ---- ClickSpark：点击 / 松手的线状火花 ------------------------------------ */
    const bursts = [];
    let sparksActive = false;
    let sparksDpr = 1;

    function sparkAt(clientX, clientY, scale) {
      if (reduce) return;
      const k = scale || 1;
      const color = moteColors[(Math.random() * moteColors.length) | 0] || '#fff';
      bursts.push({
        x: clientX,
        y: clientY,
        t0: performance.now(),
        dur: 460 + Math.random() * 120,
        count: Math.round(7 + 5 * k),
        color,
        seed: Math.random() * TAU,
      });
      if (bursts.length > 8) bursts.shift();
      sparksActive = true;
      wake();
    }

    function sparkFromEl(node, scale) {
      if (!node) return;
      const r = node.getBoundingClientRect();
      sparkAt(r.left + r.width / 2, r.top + r.height / 2, scale);
    }

    function drawSparks() {
      if (!sparksCtx) return;
      if (!bursts.length) {
        if (sparksActive) {
          sparksCtx.setTransform(1, 0, 0, 1, 0, 0);
          sparksCtx.clearRect(0, 0, el.sparks.width, el.sparks.height);
          sparksActive = false;
        }
        return;
      }
      const cw = el.sparks.width;
      const ch = el.sparks.height;
      sparksCtx.setTransform(1, 0, 0, 1, 0, 0);
      sparksCtx.clearRect(0, 0, cw, ch);
      sparksCtx.setTransform(sparksDpr, 0, 0, sparksDpr, 0, 0);
      sparksCtx.globalCompositeOperation = 'lighter';
      const now = performance.now();

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        const p = (now - b.t0) / b.dur;
        if (p >= 1) { bursts.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - p, 3);
        const fade = 1 - smoothstep(0.45, 1, p);
        for (let k = 0; k < b.count; k++) {
          const ang = (k / b.count) * TAU + b.seed;
          const dist = (12 + (k * 13 % 23)) * e;
          const len = (8 + (k * 7 % 13)) * (1 - p);
          const x1 = b.x + Math.cos(ang) * dist;
          const y1 = b.y + Math.sin(ang) * dist;
          const x2 = x1 + Math.cos(ang) * len;
          const y2 = y1 + Math.sin(ang) * len;
          sparksCtx.strokeStyle = b.color;
          sparksCtx.globalAlpha = fade * 0.12;
          sparksCtx.lineWidth = 5;
          sparksCtx.beginPath();
          sparksCtx.moveTo(x1, y1);
          sparksCtx.lineTo(x2, y2);
          sparksCtx.stroke();
          sparksCtx.globalAlpha = fade * 0.9;
          sparksCtx.lineWidth = 1.3;
          sparksCtx.beginPath();
          sparksCtx.moveTo(x1, y1);
          sparksCtx.lineTo(x2, y2);
          sparksCtx.stroke();
        }
      }
      sparksCtx.globalAlpha = 1;
      sparksCtx.globalCompositeOperation = 'source-over';
    }

    /* ---- StarBorder：唱片卡边框的彗星 ---------------------------------------
       圆角矩形按周长参数化（outline / pointAt 直接照搬 StarBorder 的几何），
       一个星头沿边框跑，尾巴由 34 段渐隐线组成。暂停时速度降到 0.16。 */
    function outline(width, height, radius) {
      const r = Math.max(0, Math.min(radius, width / 2, height / 2));
      const arc = (Math.PI * r) / 2;
      const across = Math.max(0, width - 2 * r);
      const down = Math.max(0, height - 2 * r);
      const segments = [
        { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
        { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
        { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
        { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
        { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
        { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
        { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
        { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI },
      ];
      return {
        r,
        segments,
        total: Math.max(1, segments.reduce((sum, seg) => sum + seg.length, 0)),
      };
    }

    const wrap = (v, total) => ((v % total) + total) % total;

    function pointAt(shape, distance, out) {
      let s = wrap(distance, shape.total);
      for (let i = 0; i < shape.segments.length; i++) {
        const seg = shape.segments[i];
        if (seg.length > 0 && s <= seg.length) {
          if (seg.angle === null) {
            out.x = seg.x + seg.dx * s;
            out.y = seg.y + seg.dy * s;
          } else {
            const a = seg.angle + s / shape.r;
            out.x = seg.x + Math.cos(a) * shape.r;
            out.y = seg.y + Math.sin(a) * shape.r;
          }
          return out;
        }
        s -= seg.length;
      }
      out.x = 0;
      out.y = 0;
      return out;
    }

    function measureCardStar() {
      const w = el.cardTilt.offsetWidth;
      const h = el.cardTilt.offsetHeight;
      if (!w || !h) return;
      S.starW = w;
      S.starH = h;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round((w + BLEED * 2) * dpr));
      const ch = Math.max(1, Math.round((h + BLEED * 2) * dpr));
      if (el.cardStar.width !== cw || el.cardStar.height !== ch) {
        el.cardStar.width = cw;
        el.cardStar.height = ch;
      }
      el.cardStar.style.width = `${w + BLEED * 2}px`;
      el.cardStar.style.height = `${h + BLEED * 2}px`;
    }

    function drawCardStar(dt, staticFrame) {
      if (!S.expanded || !starCtx) return;
      const w = S.starW;
      const h = S.starH;
      if (!w || !h) return;
      const cw = el.cardStar.width;
      const ch = el.cardStar.height;
      if (!cw || !ch) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const headRgb = S.palette[1] || [180, 220, 255];
      const trailRgb = S.palette[2] || headRgb;
      const shape = outline(Math.max(1, w - 1), Math.max(1, h - 1), 21);
      const total = shape.total;
      if (!staticFrame && !reduce) {
        S.starPhase = (S.starPhase + dt * (total / 6.8) * (S.playing ? 1 : 0.16)) % total;
      }
      const head = S.starPhase;

      starCtx.setTransform(1, 0, 0, 1, 0, 0);
      starCtx.clearRect(0, 0, cw, ch);
      starCtx.setTransform(dpr, 0, 0, dpr, (BLEED + 0.5) * dpr, (BLEED + 0.5) * dpr);
      starCtx.globalCompositeOperation = 'lighter';
      starCtx.lineCap = 'round';

      const length = total * 0.20;
      const steps = 34;
      let prev = pointAt(shape, head, {});
      for (let i = 1; i <= steps; i++) {
        const u = 1 - i / steps;
        const pt = pointAt(shape, head - length * (i / steps), {});
        const a = u * u;
        starCtx.strokeStyle = cssRgba(trailRgb, a * 0.9);
        starCtx.lineWidth = 1.1;
        starCtx.beginPath();
        starCtx.moveTo(prev.x, prev.y);
        starCtx.lineTo(pt.x, pt.y);
        starCtx.stroke();
        starCtx.strokeStyle = cssRgba(trailRgb, a * 0.12);
        starCtx.lineWidth = 7;
        starCtx.beginPath();
        starCtx.moveTo(prev.x, prev.y);
        starCtx.lineTo(pt.x, pt.y);
        starCtx.stroke();
        prev = pt;
      }

      const hp = pointAt(shape, head, {});
      const grad = starCtx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 26);
      grad.addColorStop(0, cssRgba([255, 255, 255], 0.95));
      grad.addColorStop(0.28, cssRgba(headRgb, 0.55));
      grad.addColorStop(1, cssRgba(headRgb, 0));
      starCtx.fillStyle = grad;
      starCtx.beginPath();
      starCtx.arc(hp.x, hp.y, 26, 0, TAU);
      starCtx.fill();

      const spike = 7;
      starCtx.strokeStyle = cssRgba([255, 255, 255], 0.9);
      starCtx.lineWidth = 1;
      starCtx.beginPath();
      starCtx.moveTo(hp.x - spike, hp.y);
      starCtx.lineTo(hp.x + spike, hp.y);
      starCtx.moveTo(hp.x, hp.y - spike);
      starCtx.lineTo(hp.x, hp.y + spike);
      starCtx.stroke();
      starCtx.globalCompositeOperation = 'source-over';
    }

    /* ---- Player → UI ----------------------------------------------------- */
    function currentTrack() {
      const st = P.state;
      if (!st || !st.queue || st.index < 0) return null;
      return st.queue[st.index] || null;
    }

    function renderLyric() {
      const lines = S.lyricLines || [];
      const idx = S.lyricActive;
      const cur = (idx >= 0 && lines[idx]) ? lines[idx] : lines[0];
      const next = (idx >= 0 ? lines[idx + 1] : lines[1]);
      el.lyricCur.textContent = cur ? (cur.text || '…') : '暂无歌词';
      el.lyricTr.textContent = cur && cur.tr ? cur.tr : '';
      el.lyricNext.textContent = next ? (next.text || '') : '';
    }

    function loadPalette(url) {
      if (!url) return;
      const token = ++S.paletteToken;
      try {
        Promise.resolve(P.extractColors(url)).then((colors) => {
          if (token !== S.paletteToken) return;
          if (colors && colors.length) applyPalette(buildPalette(colors));
        }).catch(() => { /* 取色失败保持现色 */ });
      } catch { /* ignore */ }
    }

    function setTrack(track) {
      /* 自动切歌时如果手还按在光河上，先把拖拽状态收掉，别把新歌锁在旧进度。 */
      S.scrubbing = false;
      if (gesture.active) endGesture();
      const t = track || null;
      S.hasTrack = !!t;
      S.dur = t && Number.isFinite(t.duration) && t.duration > 0 ? t.duration / 1000 : 0;
      S.targetBase = 0;
      S.target = 0;
      S.display = 0;
      S.buffer = 0;
      S.reveal = reduce ? 1 : 0;
      S.revealTarget = 1;

      const title = t ? (t.name || '未命名') : '未播放';
      const sub = t
        ? ([t.artists, t.album].filter(Boolean).join(' · ') || '—')
        : '从大厅选一首开始';
      el.title.textContent = title;
      el.sub.textContent = sub;
      el.cardTitle.textContent = title;
      el.cardSub.textContent = sub;
      host.dataset.hasTrack = S.hasTrack ? 'true' : 'false';
      el.rail.setAttribute('aria-disabled', S.hasTrack ? 'false' : 'true');
      el.badge.hidden = true;
      el.badge.removeAttribute('title');

      S.lyricLines = [];
      S.lyricActive = -1;
      renderLyric();

      if (t && t.cover && typeof API !== 'undefined' && API.img) {
        const barUrl = API.img(t.cover, 120);
        const cardUrl = API.img(t.cover, 400);
        if (barUrl) { el.cover.src = barUrl; el.cover.hidden = false; }
        if (cardUrl) { el.cardCover.src = cardUrl; el.cardCover.hidden = false; loadPalette(cardUrl); }
      } else {
        el.cover.removeAttribute('src');
        el.cover.hidden = true;
        el.cardCover.removeAttribute('src');
        el.cardCover.hidden = true;
        S.paletteToken++;
        applyPalette(DEFAULT_PALETTE);
      }

      updateProgressUI();
      if (reduce) paintStatic();
      else wake();
    }

    function setMode(mode) {
      const m = MODE[mode] ? mode : 'order';
      S.mode = m;
      el.modeUse.setAttribute('href', MODE[m].icon);
      el.modeLabel.textContent = MODE[m].short;
      el.modeBtn.classList.toggle('is-on', m !== 'order');
      el.modeBtn.setAttribute('aria-label', `播放模式：${MODE[m].full}`);
      el.modeBtn.title = MODE[m].full;
      el.cardMode.textContent = MODE[m].full;
    }

    function effectiveVolume() {
      return S.muted ? 0 : clamp(S.vol, 0, 1);
    }

    function syncVolumeUI() {
      const v = effectiveVolume();
      const icon = (S.muted || S.vol <= 0.0001) ? '#i-mute' : '#i-volume';
      el.volUse.setAttribute('href', icon);
      el.cardVolUse.setAttribute('href', icon);
      el.volBtn.classList.toggle('is-muted', S.muted || S.vol <= 0.0001);
      el.volBtn.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      el.volBtn.setAttribute('aria-valuetext', S.muted ? '静音' : `${Math.round(v * 100)}%`);
      el.arcFill.style.strokeDasharray = `${(v * 100).toFixed(2)} 100`;
      el.arcNum.textContent = `${Math.round(v * 100)}%`;
      el.cardVolFill.style.width = `${(v * 100).toFixed(2)}%`;
      el.cardVolNum.textContent = String(Math.round(v * 100));
      el.cardVol.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      el.cardVol.setAttribute('aria-valuetext', S.muted ? '静音' : `${Math.round(v * 100)}%`);
      el.cardMute.setAttribute('aria-label', S.muted ? '取消静音' : '静音');
      host.style.setProperty('--pbn-vol', v.toFixed(3));
    }

    function openArcTemporarily() {
      el.volWrap.classList.add('is-open');
      clearTimeout(S.arcTimer);
      S.arcTimer = setTimeout(() => el.volWrap.classList.remove('is-open'), 1700);
    }

    function setVolume(v, flashArc) {
      S.vol = clamp(Number.isFinite(v) ? v : 0, 0, 1);
      /* 拖动音量视为“我要听”，顺手解除静音（包括旧栏留下的 muted 状态）。 */
      const wasMuted = S.muted || !!(P.audio && P.audio.muted);
      if (wasMuted) {
        S.muted = false;
        try { P.audio.muted = false; } catch { /* ignore */ }
      }
      try { P.setVolume(S.vol); } catch { /* ignore */ }
      syncVolumeUI();
      if (flashArc) openArcTemporarily();
      if (reduce) paintStatic();
    }

    function toggleMute() {
      S.muted = !S.muted;
      try { P.audio.muted = S.muted; } catch { /* ignore */ }
      syncVolumeUI();
      openArcTemporarily();
    }

    const uiCache = { pct: '', buf: '', cur: '', total: '', aria: '' };

    function updateProgressUI() {
      const p = clamp(S.scrubbing ? S.preview : S.display, 0, 1);
      const pct = (p * 100).toFixed(3) + '%';
      if (uiCache.pct !== pct) {
        uiCache.pct = pct;
        el.fill.style.width = pct;
        el.glint.style.width = pct;
        el.cardFill.style.width = pct;
      }
      /* 底部整条渐变进度带：视觉上取代旧的细进度条，和主播放器 dock__paint
         同一条 90° 渐变；只用 clip-path 裁出左侧已播放部分，整条高度铺满。 */
      el.paint.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
      const bufPct = `${(clamp(S.buffer, 0, 1) * 100).toFixed(2)}%`;
      if (uiCache.buf !== bufPct) {
        uiCache.buf = bufPct;
        el.buf.style.width = bufPct;
      }
      const railW = S.railW || el.rail.clientWidth || 0;
      const hx = railW * p + (reduce ? 0 : headMag.x);
      const hy = reduce ? 0 : headMag.y;
      el.head.style.transform = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0)`;

      const sec = S.dur > 0 ? p * S.dur : 0;
      const curText = fmt(sec);
      const totalText = fmt(S.dur);
      /* 栏上不再显示时间读数；时间只留给展开后的唱片卡和 aria 描述。 */
      if (uiCache.cur !== curText) {
        uiCache.cur = curText;
        el.cardCur.textContent = curText;
      }
      if (uiCache.total !== totalText) {
        uiCache.total = totalText;
        el.cardTotal.textContent = totalText;
      }
      const aria = `${Math.round(p * 100)}|${curText}|${totalText}`;
      if (uiCache.aria !== aria) {
        uiCache.aria = aria;
        el.rail.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        el.rail.setAttribute('aria-valuetext', `${curText} / ${totalText}`);
      }
    }

    function paintStatic() {
      if (!S.visible) return;
      updateProgressUI();
      drawAurora();
      if (S.expanded) {
        measureCardStar();
        drawCardStar(0, true);
      }
    }

    function onTime(payload) {
      const data = payload || {};
      const cur = Number(data.cur) || 0;
      let total = Number(data.total) || 0;
      if (!(total > 0)) {
        const d = P.audio && P.audio.duration;
        if (Number.isFinite(d) && d > 0) total = d;
      }
      if (total > 0) S.dur = total;
      const ratio = S.dur > 0 ? clamp(cur / S.dur, 0, 1) : 0;
      S.lastTimeEvent = performance.now();

      if (!S.scrubbing && performance.now() >= S.lockTimeUntil) {
        S.targetBase = ratio;
        S.target = ratio;
        if (reduce) S.display = ratio;
      }
      updateProgressUI();
      if (reduce) paintStatic();
      else wake();
    }

    function onPlaystate(playing) {
      S.playing = !!playing;
      host.dataset.playing = S.playing ? 'true' : 'false';

      try {
        S.muted = !!(P.audio && P.audio.muted);
        S.vol = clamp(Number(P.volume) || 0, 0, 1);
        syncVolumeUI();
      } catch { /* ignore */ }

      const a = P.audio;
      if (a && S.dur > 0) {
        const r = clamp((Number(a.currentTime) || 0) / S.dur, 0, 1);
        S.targetBase = r;
        S.target = r;
        S.lastTimeEvent = performance.now();
      }
      if (reduce) paintStatic();
      else wake();
    }

    function onSource(payload) {
      const d = payload || {};
      if (d.demo) {
        el.badge.hidden = false;
        el.badge.textContent = '演示';
        el.badge.title = d.reason === 'vip'
          ? 'VIP 专属曲目，当前播放的是演示音轨；登录后可听原曲。'
          : '当前播放的是演示音轨。';
      } else if (d.preview) {
        el.badge.hidden = false;
        el.badge.textContent = '试听';
        el.badge.title = '当前账号只能播放试听片段。';
      } else {
        el.badge.hidden = true;
        el.badge.removeAttribute('title');
      }
    }

    /* ---- 展开 / 收起唱片卡 ------------------------------------------------ */
    function setExpanded(on, trigger, focusCard) {
      if (!on && !S.expanded) return;
      if (on === S.expanded) {
        if (on && focusCard) { try { el.card.focus({ preventScroll: true }); } catch { /* ignore */ } }
        return;
      }
      S.expanded = on;
      host.dataset.expanded = on ? 'true' : 'false';
      el.art.setAttribute('aria-expanded', on ? 'true' : 'false');
      el.grip.setAttribute('aria-expanded', on ? 'true' : 'false');
      el.cardWrap.setAttribute('aria-hidden', on ? 'false' : 'true');
      try { el.card.inert = !on; } catch { /* older browser */ }

      if (on) {
        lastTrigger = trigger || document.activeElement;
        hideCoach();
        requestAnimationFrame(() => {
          measureCardStar();
          if (reduce) paintStatic();
          else wake();
        });
        setTimeout(measureCardStar, 480);
        if (focusCard) { try { el.card.focus({ preventScroll: true }); } catch { /* ignore */ } }
      } else {
        el.volWrap.classList.remove('is-open');
        tilt.tx = 0;
        tilt.ty = 0;
        el.cardTilt.style.transform = '';
        el.card.style.setProperty('--pbn-mx', '72%');
        el.card.style.setProperty('--pbn-my', '18%');
        if (focusCard && lastTrigger && lastTrigger.focus) {
          try { lastTrigger.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
      }
      if (reduce) paintStatic();
      else wake();
    }

    function maybeCoach() {
      if (S.coachShown) return;
      S.coachShown = true;
      let seen = false;
      try { seen = localStorage.getItem('pbn.next.coach.v1') === '1'; } catch { /* ignore */ }
      if (seen) return;
      el.coach.classList.add('is-on');
      clearTimeout(S.coachTimer);
      S.coachTimer = setTimeout(hideCoach, 7000);
    }

    function hideCoach() {
      el.coach.classList.remove('is-on');
      clearTimeout(S.coachTimer);
      try { localStorage.setItem('pbn.next.coach.v1', '1'); } catch { /* ignore */ }
    }

    function togglePlayback() {
      try { P.toggle(); } catch { /* ignore */ }
    }

    function commitSeek(sec) {
      if (!(S.dur > 0)) return;
      const ratio = clamp(sec / S.dur, 0, 1);
      S.preview = ratio;
      S.display = ratio;
      S.target = ratio;
      S.targetBase = ratio;
      S.lockTimeUntil = performance.now() + 280;
      try { P.seek(sec); } catch { /* ignore */ }
      updateProgressUI();
      if (reduce) paintStatic();
      else wake();
    }

    function seekBy(delta) {
      if (!(S.dur > 0)) return;
      const base = (S.scrubbing ? S.preview : S.display) * S.dur;
      commitSeek(clamp(base + delta, 0, S.dur));
    }

    /* ---- 订阅 Player ------------------------------------------------------ */
    P.on('trackchange', ({ track }) => setTrack(track));
    P.on('playstate', onPlaystate);
    P.on('time', onTime);
    P.on('buffer', (end) => {
      const total = S.dur || (P.audio && P.audio.duration) || 0;
      if (total > 0) S.buffer = clamp(Number(end) / total, 0, 1);
      updateProgressUI();
      if (reduce) paintStatic();
    });
    P.on('lyric', (payload) => {
      const d = payload || {};
      S.lyricLines = d.lines || [];
      S.lyricActive = Number.isInteger(d.active) ? d.active : -1;
      renderLyric();
    });
    P.on('mode', (m) => setMode(m));
    P.on('source', onSource);
    P.on('sourceerror', () => {
      el.badge.hidden = false;
      el.badge.textContent = '无法播放';
      el.badge.title = '这首歌当前无法播放。';
    });

    /* ---- 首次同步 -------------------------------------------------------- */
    setMode(P.state.mode || 'order');
    S.vol = clamp(Number.isFinite(P.volume) ? P.volume : 1, 0, 1);
    S.muted = !!(P.audio && P.audio.muted);
    syncVolumeUI();
    S.playing = !!P.state.playing;
    host.dataset.playing = S.playing ? 'true' : 'false';
    S.hasTrack = !!currentTrack();
    setTrack(currentTrack());
    {
      const a = P.audio;
      if (a) {
        const d = Number(a.duration);
        if (Number.isFinite(d) && d > 0) S.dur = d;
        const r = S.dur > 0 ? clamp((Number(a.currentTime) || 0) / S.dur, 0, 1) : 0;
        S.targetBase = r;
        S.target = r;
        S.display = r;
      }
    }
    S.lyricLines = P.state.lyric || [];
    S.lyricActive = Number.isInteger(P.state.lyricIndex) ? P.state.lyricIndex : -1;
    renderLyric();

    /* ---- 光河拖拽 / 轻点 / 上拖 ------------------------------------------ */
    function barRatio(clientX) {
      const r = el.rail.getBoundingClientRect();
      if (!r.width) return 0;
      return clamp((clientX - r.left) / r.width, 0, 1);
    }

    function showBubble(clientX, ratio) {
      const r = host.getBoundingClientRect();
      const left = clamp(clientX - r.left, 58, Math.max(58, r.width - 58));
      el.bubble.style.left = `${left.toFixed(1)}px`;
      el.bubble.textContent = `${fmt(ratio * S.dur)} / ${fmt(S.dur)}`;
      el.bubble.hidden = false;
    }

    function endGesture() {
      const id = gesture.id;
      gesture.active = false;
      gesture.id = -1;
      host.classList.remove('is-pressing', 'is-scrubbing');
      el.bubble.hidden = true;
      S.scrubbing = false;
      if (id >= 0) {
        try { host.releasePointerCapture(id); } catch { /* ignore */ }
      }
    }

    function onBarDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('button, .pbn__card-wrap, .pbn__coach, .pbn__arc, .pbn__vol')) return;
      maybeCoach();
      if (S.expanded) setExpanded(false, null, false);
      gesture.active = true;
      gesture.id = e.pointerId;
      gesture.x0 = e.clientX;
      gesture.y0 = e.clientY;
      gesture.mode = 'pending';
      gesture.ratio = barRatio(e.clientX);
      host.classList.add('is-pressing');
      try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      try { el.rail.focus({ preventScroll: true }); } catch { /* ignore */ }
      e.preventDefault();
    }

    function onBarMove(e) {
      if (!gesture.active || e.pointerId !== gesture.id) return;
      const dx = e.clientX - gesture.x0;
      const dy = e.clientY - gesture.y0;

      if (gesture.mode === 'pending') {
        if (Math.hypot(dx, dy) <= 7) return;
        if (dy < -28 && Math.abs(dy) > Math.abs(dx) * 1.1) {
          gesture.mode = 'expand';
          host.classList.remove('is-pressing', 'is-scrubbing');
          el.bubble.hidden = true;
          S.scrubbing = false;
          setExpanded(true, el.art, false);
          return;
        }
        if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
          gesture.mode = 'seek';
          S.scrubbing = true;
          host.classList.add('is-scrubbing');
          try { el.rail.focus({ preventScroll: true }); } catch { /* ignore */ }
        } else {
          /* 纵向往下拖不是展开手势；标记 ignore，松手也不要误触播放/暂停。 */
          gesture.mode = 'ignore';
          return;
        }
      }

      if (gesture.mode !== 'seek') return;
      gesture.ratio = barRatio(e.clientX);
      S.preview = gesture.ratio;
      S.display = gesture.ratio;
      S.target = gesture.ratio;
      S.targetBase = gesture.ratio;
      updateProgressUI();
      showBubble(e.clientX, gesture.ratio);

      const now = performance.now();
      if (S.dur > 0 && now - S.lastSeekAt > 150) {
        S.lastSeekAt = now;
        try { P.seek(gesture.ratio * S.dur); } catch { /* ignore */ }
        S.lockTimeUntil = now + 260;
      }
      if (reduce) paintStatic();
      else wake();
      e.preventDefault();
    }

    function onBarUp(e) {
      if (!gesture.active || e.pointerId !== gesture.id) return;
      const mode = gesture.mode;
      const ratio = gesture.ratio;
      /* 先上锁再松手：松手后的 seek 会立刻触发 timeupdate，别让旧值把光点拉回去。 */
      S.lockTimeUntil = performance.now() + 320;
      endGesture();

      if (mode === 'seek') {
        if (S.dur > 0) {
          try { P.seek(ratio * S.dur); } catch { /* ignore */ }
        }
        S.preview = ratio;
        S.display = ratio;
        S.target = ratio;
        S.targetBase = ratio;
        sparkAt(e.clientX, e.clientY, 1.05);
        updateProgressUI();
        if (reduce) paintStatic();
        else wake();
      } else if (mode === 'pending') {
        togglePlayback();
        sparkAt(e.clientX, e.clientY, 0.95);
        if (reduce) paintStatic();
      }
      if (e.pointerType === 'touch') S.pointerTarget = 0;
    }

    host.addEventListener('pointerdown', onBarDown);
    host.addEventListener('pointermove', onBarMove);
    host.addEventListener('pointerup', onBarUp);
    host.addEventListener('pointercancel', onBarUp);

    /* 触摸没有 pointerleave：手指抬起后要主动收掉指针斥力，不然粒子会一直躲。 */
    const clearPointerField = (e) => {
      if (e && e.pointerType && e.pointerType !== 'touch') return;
      S.pointerTarget = 0;
      S.pointerPresence = 0;
      headMag.tx = 0;
      headMag.ty = 0;
      for (let i = 0; i < orbSprings.length; i++) { orbSprings[i].tx = 0; orbSprings[i].ty = 0; }
      if (reduce) paintStatic();
      else wake();
    };
    host.addEventListener('pointerup', clearPointerField, true);
    host.addEventListener('pointercancel', clearPointerField, true);
    window.addEventListener('blur', () => {
      S.pointerTarget = 0;
      S.pointerPresence = 0;
      headMag.tx = 0;
      headMag.ty = 0;
      tilt.tx = 0;
      tilt.ty = 0;
      for (let i = 0; i < orbSprings.length; i++) { orbSprings[i].tx = 0; orbSprings[i].ty = 0; }
    });

    /* ---- 键盘：滑块与按钮 -------------------------------------------------- */
    el.rail.addEventListener('keydown', (e) => {
      let handled = true;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') seekBy(e.shiftKey ? 15 : 5);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') seekBy(-(e.shiftKey ? 15 : 5));
      else if (e.key === 'PageUp' && S.dur > 0) commitSeek((S.scrubbing ? S.preview : S.display) * S.dur + S.dur * 0.1);
      else if (e.key === 'PageDown' && S.dur > 0) commitSeek((S.scrubbing ? S.preview : S.display) * S.dur - S.dur * 0.1);
      else if (e.key === 'Home') commitSeek(0);
      else if (e.key === 'End' && S.dur > 0) commitSeek(S.dur);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    el.volBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation(); setVolume(S.vol + 0.05, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation(); setVolume(S.vol - 0.05, true);
      } else if (e.key === 'Home') {
        e.preventDefault(); e.stopPropagation(); setVolume(0, true);
      } else if (e.key === 'End') {
        e.preventDefault(); e.stopPropagation(); setVolume(1, true);
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault(); e.stopPropagation(); toggleMute();
      }
    });

    el.cardVol.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation(); setVolume(S.vol + 0.05, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation(); setVolume(S.vol - 0.05, true);
      } else if (e.key === 'Home') {
        e.preventDefault(); e.stopPropagation(); setVolume(0, true);
      } else if (e.key === 'End') {
        e.preventDefault(); e.stopPropagation(); setVolume(1, true);
      }
    });

    /* ---- 按钮 ------------------------------------------------------------- */
    el.art.addEventListener('click', (e) => {
      setExpanded(!S.expanded, el.art, e.detail === 0);
      if (!S.expanded) sparkFromEl(el.art, 0.7);
    });
    el.grip.addEventListener('click', (e) => {
      setExpanded(!S.expanded, el.grip, e.detail === 0);
      if (!S.expanded) sparkFromEl(el.grip, 0.6);
    });
    el.cardX.addEventListener('click', () => setExpanded(false, null, true));
    el.cardArt.addEventListener('click', () => {
      togglePlayback();
      sparkFromEl(el.cardArt, 0.95);
    });
    el.prev.addEventListener('click', () => {
      try { P.prev(); } catch { /* ignore */ }
      sparkFromEl(el.prev, 0.8);
    });
    el.next.addEventListener('click', () => {
      try { P.next(); } catch { /* ignore */ }
      sparkFromEl(el.next, 0.8);
    });
    el.modeBtn.addEventListener('click', () => {
      let m = S.mode;
      try {
        m = P.cycleMode();
        try { localStorage.setItem('playMode', m); } catch { /* ignore */ }
      } catch { /* ignore */ }
      setMode(m);
      sparkFromEl(el.modeBtn, 0.7);
    });
    el.cardMute.addEventListener('click', toggleMute);
    el.cardOpen.addEventListener('click', () => {
      setExpanded(false, null, true);
      const oldBtn = document.getElementById('btn-open-now');
      if (oldBtn && oldBtn.click) oldBtn.click();
    });

    /* ---- 音量：上下拖，单击静音 ------------------------------------------- */
    let volDrag = null;
    el.volBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.volBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      volDrag = { id: e.pointerId, y: e.clientY, v: S.vol, moved: false };
      el.volWrap.classList.add('is-open');
    });
    el.volBtn.addEventListener('pointermove', (e) => {
      if (!volDrag || e.pointerId !== volDrag.id) return;
      const dy = volDrag.y - e.clientY;
      if (Math.abs(dy) > 3) volDrag.moved = true;
      if (volDrag.moved) setVolume(volDrag.v + dy / 150, false);
    });
    el.volBtn.addEventListener('pointerup', (e) => {
      if (!volDrag || e.pointerId !== volDrag.id) return;
      const moved = volDrag.moved;
      volDrag = null;
      try { el.volBtn.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (!moved) toggleMute();
      openArcTemporarily();
    });
    el.volBtn.addEventListener('pointercancel', () => { volDrag = null; });

    let cardVolDrag = false;
    const setCardVolFromX = (clientX) => {
      const r = el.cardVol.getBoundingClientRect();
      if (!r.width) return;
      setVolume((clientX - r.left) / r.width, false);
    };
    el.cardVol.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.cardVol.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      cardVolDrag = true;
      setCardVolFromX(e.clientX);
    });
    el.cardVol.addEventListener('pointermove', (e) => {
      if (cardVolDrag) setCardVolFromX(e.clientX);
    });
    el.cardVol.addEventListener('pointerup', (e) => {
      cardVolDrag = false;
      try { el.cardVol.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.cardVol.addEventListener('pointercancel', () => { cardVolDrag = false; });

    /* ---- 指针：光点 / 光球磁吸、卡片倾斜、光斑 --------------------------- */
    function updateOrbTargets(e) {
      if (reduce) return;
      const PAD = 96;
      const STRENGTH = 2.6;
      const MAX = 11;
      for (let i = 0; i < orbSprings.length; i++) {
        const o = orbSprings[i];
        const r = o.btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const outside = Math.hypot(
          Math.max(0, Math.abs(dx) - r.width / 2),
          Math.max(0, Math.abs(dy) - r.height / 2)
        );
        if (outside > PAD) { o.tx = 0; o.ty = 0; continue; }
        const pull = 1 - smoothstep(PAD * 0.5, PAD, outside);
        o.tx = clamp((dx / STRENGTH) * pull, -MAX, MAX);
        o.ty = clamp((dy / STRENGTH) * pull, -MAX, MAX);
      }
    }

    host.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      S.pointerXCss = e.clientX - r.left;
      S.pointerYCss = e.clientY - r.top;
      S.pointerX = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      S.pointerY = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
      S.pointerTarget = 1;

      if (!reduce && e.pointerType !== 'touch') {
        const hr = el.rail.getBoundingClientRect();
        const hx = hr.left + S.railW * S.display;
        if (Math.abs(e.clientX - hx) < 54 && e.clientY > r.top + r.height * 0.55) {
          headMag.tx = clamp((e.clientX - hx) * 0.28, -9, 9);
          headMag.ty = clamp((e.clientY - (hr.top + hr.height / 2)) * 0.22, -7, 7);
        } else {
          headMag.tx = 0;
          headMag.ty = 0;
        }
        updateOrbTargets(e);
        wake();
      }
    }, { passive: true });

    host.addEventListener('pointerleave', () => {
      S.pointerTarget = 0;
      headMag.tx = 0;
      headMag.ty = 0;
      for (let i = 0; i < orbSprings.length; i++) { orbSprings[i].tx = 0; orbSprings[i].ty = 0; }
      tilt.tx = 0;
      tilt.ty = 0;
      if (reduce) paintStatic();
      else wake();
    });

    el.card.addEventListener('pointermove', (e) => {
      if (reduce) return;
      const r = el.card.getBoundingClientRect();
      const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      tilt.tx = -ny * 4.5;
      tilt.ty = nx * 5.5;
      el.card.style.setProperty('--pbn-mx', `${(clamp((e.clientX - r.left) / r.width, 0, 1) * 100).toFixed(2)}%`);
      el.card.style.setProperty('--pbn-my', `${(clamp((e.clientY - r.top) / r.height, 0, 1) * 100).toFixed(2)}%`);
      wake();
    }, { passive: true });

    el.card.addEventListener('pointerleave', () => {
      tilt.tx = 0;
      tilt.ty = 0;
      if (reduce) paintStatic();
      else wake();
    });

    /* ---- 提示 / 点外部收起 / Esc ----------------------------------------- */
    host.addEventListener('pointerenter', maybeCoach, { passive: true });
    host.addEventListener('focusin', maybeCoach);

    document.addEventListener('pointerdown', (e) => {
      if (!S.expanded) return;
      if (el.cardWrap.contains(e.target)) return;
      if (el.art.contains(e.target) || el.grip.contains(e.target)) return;
      setExpanded(false, null, false);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!S.expanded || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setExpanded(false, null, true);
    }, true);

    /* ---- 渲染循环 --------------------------------------------------------- */
    function springStep(s, dt) {
      const SUB = 2;
      const h = dt / SUB;
      const k = 170;
      const c = 16;
      for (let i = 0; i < SUB; i++) {
        const denom = 1 + h * c + h * h * k;
        s.vx = (s.vx + h * k * (s.tx - s.x)) / denom;
        s.vy = (s.vy + h * k * (s.ty - s.y)) / denom;
        s.x += s.vx * h;
        s.y += s.vy * h;
      }
      if (Math.abs(s.tx - s.x) < 0.02 && Math.abs(s.vx) < 0.02) { s.x = s.tx; s.vx = 0; }
      if (Math.abs(s.ty - s.y) < 0.02 && Math.abs(s.vy) < 0.02) { s.y = s.ty; s.vy = 0; }
    }

    function stopLoop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      lastTs = 0;
    }

    function wake() {
      if (reduce || !S.visible || document.hidden) return;
      if (raf) return;
      lastTs = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function tick(dt) {
      S.shaderTime += dt * (S.playing ? 1 : 0.18);
      if (S.shaderTime > 3600) S.shaderTime -= 3600;

      const rk = 1 - Math.exp(-dt * 2.2);
      S.reveal += (S.revealTarget - S.reveal) * rk;
      if (Math.abs(S.revealTarget - S.reveal) < 0.001) S.reveal = S.revealTarget;

      const pk = 1 - Math.exp(-dt * 3.4);
      S.pointerPresence += (S.pointerTarget - S.pointerPresence) * pk;
      if (Math.abs(S.pointerTarget - S.pointerPresence) < 0.001) S.pointerPresence = S.pointerTarget;

      if (!S.scrubbing && S.dur > 0) {
        if (S.playing) {
          const since = Math.max(0, (performance.now() - S.lastTimeEvent) / 1000);
          S.target = clamp(S.targetBase + since / S.dur, 0, 1);
        } else {
          S.target = clamp(S.targetBase, 0, 1);
        }
        const k = 1 - Math.exp(-dt * (S.playing ? 9 : 14));
        S.display += (S.target - S.display) * k;
        if (Math.abs(S.target - S.display) < 0.0002) S.display = S.target;
      }

      springStep(headMag, dt);
      springStep(tilt, dt);
      for (let i = 0; i < orbSprings.length; i++) {
        const o = orbSprings[i];
        springStep(o, dt);
        o.el.style.transform = `translate3d(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px, 0)`;
      }
      if (Math.abs(tilt.x) + Math.abs(tilt.y) > 0.02) {
        el.cardTilt.style.transform = `rotateX(${tilt.x.toFixed(3)}deg) rotateY(${tilt.y.toFixed(3)}deg)`;
      } else if (el.cardTilt.style.transform) {
        el.cardTilt.style.transform = '';
      }

      updateProgressUI();
      drawAurora();
      drawSparks();
      if (S.expanded) drawCardStar(dt, false);
    }

    function frame(ts) {
      raf = 0;
      if (reduce || !S.visible || document.hidden) return;
      const dt = lastTs ? clamp((ts - lastTs) / 1000, 0.001, 0.05) : 1 / 60;
      lastTs = ts;
      tick(dt);
      raf = requestAnimationFrame(frame);
    }

    /* ---- 显隐：播放页 / 形态页 / 后台标签不跑 rAF ------------------------ */
    function computeVisible() {
      return !document.hidden
        && !document.body.classList.contains('pbn-off')
        && !document.body.classList.contains('is-now')
        && !document.body.classList.contains('is-stage')
        && document.body.dataset.view !== 'settings';
    }

    function syncVisibility() {
      const v = computeVisible();
      if (v === S.visible) {
        host.inert = !v;
        return false;
      }
      S.visible = v;
      host.inert = !v;
      if (!v) {
        stopLoop();
        if (S.expanded) setExpanded(false, null, false);
        el.volWrap.classList.remove('is-open');
        clearTimeout(S.arcTimer);
      } else {
        resizeAll();
        if (reduce) paintStatic();
        else wake();
      }
      return true;
    }

    /* ---- 尺寸 ------------------------------------------------------------- */
    function resizeAll() {
      if (!document.body.contains(host)) return;
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      S.hostW = r.width;
      S.hostH = r.height;
      /* 手机上把光河降一点分辨率：3 层噪声 + 全宽，1.5x 足够，省 GPU。 */
      S.dpr = Math.min(window.devicePixelRatio || 1, r.width < 900 ? 1.5 : 2);
      setCanvasPixels(el.aurora, r.width, r.height, S.dpr);
      S.railW = el.rail.getBoundingClientRect().width;

      sparksDpr = Math.min(window.devicePixelRatio || 1, 2);
      const sw = Math.max(1, Math.round(window.innerWidth * sparksDpr));
      const sh = Math.max(1, Math.round(window.innerHeight * sparksDpr));
      if (el.sparks.width !== sw || el.sparks.height !== sh) {
        el.sparks.width = sw;
        el.sparks.height = sh;
      }

      if (S.expanded) measureCardStar();
      if (reduce) {
        if (S.visible) paintStatic();
      } else if (S.visible && !document.hidden) {
        drawAurora();
      }
    }

    let resizeTimer = 0;
    const scheduleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = 0;
        resizeAll();
      }, 110);
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(scheduleResize);
      ro.observe(host);
      ro.observe(el.cardTilt);
    }
    window.addEventListener('resize', scheduleResize, { passive: true });
    window.addEventListener('orientationchange', scheduleResize);

    /* ---- 减少动态：停掉连续 rAF，只画状态帧 ------------------------------- */
    if (reduceMQ && reduceMQ.addEventListener) {
      reduceMQ.addEventListener('change', (ev) => {
        reduce = !!ev.matches;
        if (reduce) {
          stopLoop();
          S.reveal = 1;
          S.revealTarget = 1;
          S.pointerPresence = 0;
          bursts.length = 0;
          if (sparksCtx) {
            sparksCtx.setTransform(1, 0, 0, 1, 0, 0);
            sparksCtx.clearRect(0, 0, el.sparks.width, el.sparks.height);
            sparksActive = false;
          }
          if (S.expanded) measureCardStar();
          paintStatic();
        } else {
          S.reveal = 1;
          S.revealTarget = 1;
          wake();
        }
      });
    }

    /* ---- 启动 ------------------------------------------------------------- */
    /* 设置页开关要能立刻停帧 / 恢复：把闭包里的两个函数交出去。 */
    ctl = { syncVisibility, stopLoop };
    try { el.card.inert = true; } catch { /* older browser */ }
    initAurora();
    applyPalette(DEFAULT_PALETTE);
    resizeAll();
    S.visible = computeVisible();
    host.inert = !S.visible;
    if (S.visible) {
      if (reduce) paintStatic();
      else wake();
    }

    if (window.MutationObserver) {
      new MutationObserver(() => syncVisibility()).observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-view'],
      });
    }
    document.addEventListener('visibilitychange', syncVisibility);
  }

  /* 3. DOM 模板 ------------------------------------------------------------ */
  const TEMPLATE = `
    <canvas class="pbn__aurora" id="pbn-aurora" aria-hidden="true"></canvas>
    <div class="pbn__veil" aria-hidden="true"></div>
    <!-- 蒙版：压在光河 / veil 之上、内容之下，把光河压暗一档（z 2）。 -->
    <div class="pbn__mask" id="pbn-mask" aria-hidden="true"></div>
    <!-- 渐变进度带：整条高度铺满，按已播放比例裁切；在蒙版之后 → 压在蒙版上。 -->
    <div class="pbn__paint" id="pbn-paint" aria-hidden="true"></div>

    <div class="pbn__coach" id="pbn-coach" role="status">
      <span><b>拖</b> 光河定位</span>
      <span><b>点</b> 播放/暂停</span>
      <span><b>上拖</b> 唱片卡</span>
      <span><b>右端上下拖</b> 音量</span>
    </div>

    <div class="pbn__inner">
      <div class="pbn__now">
        <button class="pbn__art" id="pbn-art" type="button"
                aria-label="展开唱片卡" aria-expanded="false" aria-controls="pbn-card">
          <span class="pbn__art-disc" aria-hidden="true"></span>
          <img class="pbn__art-img" id="pbn-cover" alt="" hidden>
          <svg class="ico ico--solid pbn__art-ph" aria-hidden="true"><use href="#i-note"/></svg>
          <span class="pbn__art-ring" aria-hidden="true"></span>
        </button>
        <div class="pbn__text">
          <div class="pbn__title" id="pbn-title">未播放</div>
          <div class="pbn__sub" id="pbn-sub">从大厅选一首开始</div>
        </div>
        <span class="pbn__badge" id="pbn-badge" hidden></span>
      </div>

      <div class="pbn__center">
        <!-- 栏上不再放时间读数 / 播放中状态，只留一条悬停才出现的操作提示。 -->
        <div class="pbn__hint">拖 光河 定位 · 轻点 播放/暂停 · 向上拖 展开</div>
      </div>

      <div class="pbn__tail">
        <button class="pbn__orb pbn__orb--prev" id="pbn-prev" type="button" aria-label="上一首" title="上一首">
          <span class="pbn__orb-in"><svg class="ico ico--solid" aria-hidden="true"><use href="#i-prev"/></svg></span>
        </button>
        <button class="pbn__orb pbn__orb--next" id="pbn-next" type="button" aria-label="下一首" title="下一首">
          <span class="pbn__orb-in"><svg class="ico ico--solid" aria-hidden="true"><use href="#i-next"/></svg></span>
        </button>
        <div class="pbn__vol" id="pbn-vol">
          <button class="pbn__orb pbn__vol-btn" id="pbn-vol-btn" type="button"
                  role="slider" aria-label="音量" aria-valuemin="0" aria-valuemax="100"
                  aria-valuenow="100" aria-valuetext="100%"
                  title="上下拖动调音量 · 单击静音">
            <svg class="ico ico--solid" aria-hidden="true"><use id="pbn-vol-use" href="#i-volume"/></svg>
          </button>
          <div class="pbn__arc" id="pbn-arc" aria-hidden="true">
            <svg viewBox="0 0 132 118">
              <defs>
                <linearGradient id="pbn-arc-grad" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" style="stop-color:var(--pbn-c2)"/>
                  <stop offset=".55" style="stop-color:var(--pbn-c1)"/>
                  <stop offset="1" style="stop-color:var(--pbn-c3)"/>
                </linearGradient>
              </defs>
              <path class="pbn__arc-track" d="M 18 106 A 88 88 0 0 1 106 18" pathLength="100"/>
              <path class="pbn__arc-fill" id="pbn-arc-fill" d="M 18 106 A 88 88 0 0 1 106 18" pathLength="100"/>
            </svg>
            <span class="pbn__arc-cap">VOL</span>
            <span class="pbn__arc-num" id="pbn-arc-num">100%</span>
          </div>
        </div>
        <button class="pbn__mode" id="pbn-mode" type="button" aria-label="播放模式：顺序播放" title="顺序播放">
          <svg class="ico ico--solid" aria-hidden="true"><use id="pbn-mode-use" href="#i-list"/></svg>
          <span id="pbn-mode-label">顺序</span>
        </button>
        <button class="pbn__grip" id="pbn-expand" type="button"
                aria-label="展开唱片卡" aria-expanded="false" aria-controls="pbn-card">
          <svg class="ico" aria-hidden="true"><use href="#i-chevron"/></svg>
        </button>
      </div>
    </div>

    <div class="pbn__rail" id="pbn-rail" role="slider" tabindex="0"
         aria-label="播放进度" aria-valuemin="0" aria-valuemax="100"
         aria-valuenow="0" aria-valuetext="0:00 / 0:00">
      <div class="pbn__rail-buffer" id="pbn-buf"></div>
      <div class="pbn__rail-fill" id="pbn-fill"></div>
      <div class="pbn__rail-glint" id="pbn-glint"></div>
      <div class="pbn__head" id="pbn-head" aria-hidden="true">
        <span class="pbn__head-halo"></span>
        <span class="pbn__head-core"></span>
      </div>
    </div>
    <div class="pbn__bubble" id="pbn-bubble" hidden>0:00</div>

    <div class="pbn__card-wrap" id="pbn-card-wrap" aria-hidden="true">
      <div class="pbn__card" id="pbn-card" role="dialog" aria-modal="false"
           aria-label="唱片卡" tabindex="-1">
        <div class="pbn__card-tilt" id="pbn-card-tilt">
          <canvas class="pbn__card-star" id="pbn-card-star" aria-hidden="true"></canvas>
          <div class="pbn__spot" aria-hidden="true"></div>
          <div class="pbn__card-inner">
            <button class="pbn__card-art" id="pbn-card-art" type="button" aria-label="播放或暂停">
              <span class="pbn__vinyl" aria-hidden="true"></span>
              <img id="pbn-card-cover" alt="" hidden>
              <svg class="ico ico--solid pbn__card-ph" aria-hidden="true"><use href="#i-note"/></svg>
            </button>
            <div class="pbn__card-copy">
              <div class="pbn__card-kicker">现在播放 <span id="pbn-card-mode">顺序播放</span></div>
              <div class="pbn__card-title" id="pbn-card-title">未播放</div>
              <div class="pbn__card-sub" id="pbn-card-sub">—</div>
              <p class="pbn__lyric">
                <span class="pbn__lyric-cur" id="pbn-lyric-cur">暂无歌词</span>
                <span class="pbn__lyric-tr" id="pbn-lyric-tr"></span>
                <span class="pbn__lyric-next" id="pbn-lyric-next"></span>
              </p>
              <div class="pbn__card-times">
                <span id="pbn-card-cur">0:00</span>
                <span class="pbn__card-time-bar"><i id="pbn-card-fill"></i></span>
                <span id="pbn-card-total">0:00</span>
              </div>
              <div class="pbn__card-tools">
                <div class="pbn__card-vol">
                  <button class="pbn__card-mute" id="pbn-card-mute" type="button" aria-label="静音">
                    <svg class="ico ico--solid" aria-hidden="true"><use id="pbn-card-vol-use" href="#i-volume"/></svg>
                  </button>
                  <div class="pbn__card-vol-track" id="pbn-card-vol" role="slider" tabindex="0"
                       aria-label="音量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
                    <i id="pbn-card-vol-fill"></i>
                  </div>
                  <span id="pbn-card-vol-num">100</span>
                </div>
                <button class="pbn__card-open" id="pbn-open-now" type="button">打开播放页</button>
              </div>
            </div>
          </div>
          <button class="pbn__card-x" id="pbn-card-x" type="button" aria-label="收起唱片卡">
            <svg class="ico" aria-hidden="true"><use href="#i-close"/></svg>
          </button>
        </div>
      </div>
    </div>

    <canvas class="pbn__sparks" id="pbn-sparks" aria-hidden="true"></canvas>
  `;
})();
