/**
 * Canvas Reveal Effect（Aceternity）→ 原生 JS 版（2026-11-07）
 * 来源：https://ui.aceternity.com/components/canvas-reveal-effect
 * 原始实现：https://ui.aceternity.com/registry/canvas-reveal-effect.json
 *   - CanvasRevealEffect（opacities / colors / dotSize 3 / showGradient；原 animationSpeed 0.4）
 *     本项目把「慢显现」改成 200ms 归一化扫过（见 u_spread），其余照原样。
 *   - DotMatrix（totalSize 4 / dotSize 2 / 点阵片元着色器）
 *   - ShaderMaterial（GLSL3、u_resolution = 尺寸 × 2、SRC_ALPHA + ONE 的加法混合）
 *
 * 这里是同一套着色器逻辑，只把 React Three Fiber 换成裸 WebGL2：
 *   - 顶点/片元着色器、随机函数、透明度阶梯、颜色槽展开方式都照抄；
 *   - intro 显现从原版的慢速 step 改成 200ms 归一化扫过（u_spread）；
 *   - 时间 u_time 从「本次 hover / focus 开始」计 0，等于原组件刚 mount 时的时钟；
 *   - 画布尺寸 = CSS 尺寸 × min(devicePixelRatio, 2)，和原版固定的 ×2 一致。
 *
 * 挂载：MutationObserver 监听 #hall-tools（app.js 会整段重画 innerHTML），
 * 幂等地给每张 .hall-tools__i 挂一层绝对定位 canvas，旧卡断开时销毁。
 *
 * 降级：WebGL2 不可用 → 同一套点阵/opacity/颜色规则的 2D canvas；再失败 → no-op。
 * 性能：IntersectionObserver + 只在可见且 hover/focus 时跑 rAF；DPR 上限 2；
 * prefers-reduced-motion 时只画一张静态帧。
 */
(() => {
  'use strict';

  if (window.LiziCanvasReveal) return;

  const HALL_ID = 'hall-tools';
  const CARD_SEL = '.hall-tools__i';
  const STATIC_TIME = 100;          // reduced-motion 用的静态时刻（intro 已完成）
  const PHI = 1.61803398874989484820459;

  /* ------------------------------------------------------------------ */
  /* 集中配置：以后调点阵密度 / 速度 / 配色只改这里                        */
  /* ------------------------------------------------------------------ */
  const CONFIG = {
    /* 原组件默认值 */
    revealSeconds: 0.2,             // 悬停后 200ms 整卡铺满（归一化后按距离扫过）
    opacities: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
    revealSoftness: 0.08,           // 单个格子点亮的柔边（0..1 的 spread）
    totalSize: 4,
    dotSize: 3,
    showGradient: false,            // 原版是深色卡片上的黑色渐变；浅色纸面默认不用
    maxFps: 60,
    fallbackMaxFps: 30,             // 2D 降级时压到 30fps

    /* 宿主参数 */
    dprCap: 2,
    layerOpacity: 0.9,

    /* 自动配色：以卡片 --accent 的色相为锚，按「序号 × 黄金角」稳定铺开
       （四张卡各自有区分度），data-tool 哈希只做 ±10° 的稳定微调；
       每张卡内部再取 3 个邻近色相 / 低饱和 / 中低亮度，
       落在浅纸面上是「墨点」而不是霓虹。 */
    palette: {
      cardHueStep: 137.508,         // 黄金角：相邻序号的色相尽量拉开
      cardHueJitter: 10,            // data-tool 决定的稳定小偏移（±10°）
      hueOffsets: [-15, 0, 20],     // 同一张卡内部的 3 个和谐色相
      saturations: [0.28, 0.32, 0.24],
      lightness: [0.34, 0.30, 0.44],

      /* hover 时图标砖底色 / SVG 撞色 / 图标粒子色，都由同一个 base hue 推 */
      iconBg: { hue: 6, sat: 0.34, light: 0.25, alpha: 0.90 },
      iconInk: { hue: 30, sat: 0.58, light: 0.94 },
      iconDots: [
        { hue: 8, sat: 0.30, light: 0.97 },
        { hue: 34, sat: 0.62, light: 0.88 },
        { hue: -18, sat: 0.38, light: 0.94 },
      ],
    },

    /* 图标粒子化 */
    icon: {
      convergeMs: 480,              // 轮廓点聚成图标
      retractMs: 300,               // 移开时散开收回
      dotSize: 2.0,                 // CSS px（方点，和背景点阵同语言）
      maxPoints: 240,
      sampleSize: 96,
      scatter: 1.15,                // 起始散点范围（相对图标砖）
      fallbackDots: 18,             // 拿不到轮廓时绕图标轻抖的粒子数
      shimmer: 0.35,                // 成形后的轻微抖动（CSS px）
    },
  };

  /* ------------------------------------------------------------------ */
  /* 工具                                                                */
  /* ------------------------------------------------------------------ */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fract = (v) => v - Math.floor(v);
  const mod = (a, b) => ((a % b) + b) % b;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* 稳定哈希 → [0,1)。同一 data-tool 每次渲染都得到同一组颜色 */
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 10000 / 10000;
  }

  function rgbHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (!d) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return mod(h * 60, 360);
  }

  /** 读卡片计算后的 --accent，取出色相；解析不了返回 null（走稳定哈希） */
  function accentHue(card) {
    let raw = '';
    try { raw = getComputedStyle(card).getPropertyValue('--accent').trim(); } catch (e) { /* noop */ }
    if (!raw) return null;

    let m = /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+([\d.]+)/i.exec(raw);
    if (m) return parseFloat(m[1]);

    m = /^hsl\(\s*([\d.]+)/i.exec(raw);
    if (m) return parseFloat(m[1]);

    m = /^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(raw);
    if (m) return rgbHue(+m[1], +m[2], +m[3]);

    m = /^#([0-9a-f]{3,8})$/i.exec(raw);
    if (m) {
      let hex = m[1];
      if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length === 6 || hex.length === 8) {
        return rgbHue(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
      }
    }
    return null;
  }

  function hslToRgb(hue, s, l) {
    const h = mod(hue, 360) / 360;
    if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const h2r = (t) => {
      t = mod(t, 1);
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [
      Math.round(h2r(h + 1 / 3) * 255),
      Math.round(h2r(h) * 255),
      Math.round(h2r(h - 1 / 3) * 255),
    ];
  }

  /**
   * 自动配色（集中函数）：
   *   锚点 = 卡片 --accent 的色相；同一张卡按 data-tool 稳定偏移；
   *   产出 3 个邻近色相、低饱和、中低亮度的和谐色，适合浅纸面。
   * 不给四张卡写死四套颜色。
   */
  function paletteFor(card, index) {
    const id = card.dataset.tool || ('card-' + index);
    const anchor = accentHue(card);
    const p = CONFIG.palette;
    const jitter = (hash01(id) * 2 - 1) * p.cardHueJitter;
    const base = mod((anchor == null ? 12 : anchor) + index * p.cardHueStep + jitter, 360);
    return {
      base,
      colors: p.hueOffsets.map((dh, i) => hslToRgb(base + dh, p.saturations[i], p.lightness[i])),
      iconBg: hslToRgb(base + p.iconBg.hue, p.iconBg.sat, p.iconBg.light),
      iconInk: hslToRgb(base + p.iconInk.hue, p.iconInk.sat, p.iconInk.light),
      iconColors: p.iconDots.map((d) => hslToRgb(base + d.hue, d.sat, d.light)),
    };
  }

  /**
   * 原版 colors 展开（colors.length 1/2/3 时逐字一致）：
   *   1 → 6×c0；2 → c0 c0 c0 c1 c1 c1；3 → c0 c0 c1 c1 c2 c2。
   * 4 个时按同一规则均分 6 槽 → c0 c0 c1 c2 c2 c3（扩展，仅为了支持 2~4 色）。
   */
  function expandColors(colors) {
    const n = Math.max(1, Math.min(4, colors.length));
    const out = new Array(6);
    for (let i = 0; i < 6; i++) out[i] = colors[Math.min(n - 1, Math.floor(i * n / 6))];
    return out;
  }

  /* 原着色器的 random(vec2)：fract(tan(distance(xy*PHI, xy)*0.5) * xy.x) */
  function rand2(x, y) {
    const d = Math.abs(PHI - 1) * Math.sqrt(x * x + y * y);
    return fract(Math.tan(d * 0.5) * x);
  }

  /* ------------------------------------------------------------------ */
  /* 着色器（照抄 Aceternity registry 源码）                              */
  /* ------------------------------------------------------------------ */
  const VERT_SRC = `#version 300 es
in vec2 a_pos;
uniform vec2 u_resolution;
out vec2 fragCoord;
void main() {
  float x = a_pos.x;
  float y = a_pos.y;
  gl_Position = vec4(x, y, 0.0, 1.0);
  fragCoord = (a_pos + vec2(1.0)) * 0.5 * u_resolution;
  fragCoord.y = u_resolution.y - fragCoord.y;
}`;

  function fragmentSource() {
    return `#version 300 es
precision mediump float;
in vec2 fragCoord;

uniform float u_time;
uniform float u_spread;
uniform float u_softness;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform vec2 u_resolution;
out vec4 fragColor;

float PHI = 1.61803398874989484820459;
float random(vec2 xy) {
    return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}
float map(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}
void main() {
    vec2 st = fragCoord.xy;
    st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
    st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

    float opacity = step(0.0, st.x);
    opacity *= step(0.0, st.y);

    vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

    float frequency = 5.0;
    float show_offset = random(st2);
    float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency) + 1.0);
    opacity *= u_opacities[int(rand * 10.0)];
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

    vec3 color = u_colors[int(show_offset * 6.0)];

    /* 原版是 step(intro_offset, u_time * animation_speed_factor) 的慢显现；
       这里改成归一化扫过：u_spread 在 200ms 内 0→1，最远角在 1.0 前点亮完。
       点阵密度 / 透明度阶梯 / 5 秒闪烁节奏都保持原样。 */
    vec2 center_cells = u_resolution / 2.0 / u_total_size;
    float max_dist = max(1.0, distance(vec2(0.0), center_cells));
    float dist_norm = distance(center_cells, st2) / max_dist;
    float max_intro = max(0.0, 1.0 - u_softness);
    float intro_offset = clamp(dist_norm * 0.62 + show_offset * 0.30, 0.0, max_intro);
    opacity *= smoothstep(intro_offset, intro_offset + u_softness, u_spread);

    fragColor = vec4(color, opacity);
    fragColor.rgb *= fragColor.a;
}`;
  }

  /* ------------------------------------------------------------------ */
  /* renderer                                                            */
  /* ------------------------------------------------------------------ */
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function initWebGL(canvas, colors6) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
    } catch (e) { gl = null; }
    if (!gl) return null;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource());
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return null;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    if (aPos < 0) { gl.deleteProgram(prog); return null; }
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    /* 原版：CustomBlending / SrcAlphaFactor / OneFactor（加法混合，输出已预乘） */
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    const u = {
      time: gl.getUniformLocation(prog, 'u_time'),
      spread: gl.getUniformLocation(prog, 'u_spread'),
      softness: gl.getUniformLocation(prog, 'u_softness'),
      res: gl.getUniformLocation(prog, 'u_resolution'),
      opacities: gl.getUniformLocation(prog, 'u_opacities[0]'),
      colors: gl.getUniformLocation(prog, 'u_colors[0]'),
      total: gl.getUniformLocation(prog, 'u_total_size'),
      dot: gl.getUniformLocation(prog, 'u_dot_size'),
    };

    const flat = new Float32Array(18);
    for (let i = 0; i < 6; i++) {
      flat[i * 3] = colors6[i][0] / 255;
      flat[i * 3 + 1] = colors6[i][1] / 255;
      flat[i * 3 + 2] = colors6[i][2] / 255;
    }
    gl.uniform1fv(u.opacities, new Float32Array(CONFIG.opacities));
    gl.uniform3fv(u.colors, flat);
    gl.uniform1f(u.total, CONFIG.totalSize);
    gl.uniform1f(u.dot, CONFIG.dotSize);

    return { gl, prog, u };
  }

  /* 2D 降级：完全按着色器公式逐格画方块点（点本来就是方块，不是圆） */
  function build2DStyles(colors6) {
    const styles = [];
    for (let ci = 0; ci < 6; ci++) {
      const row = [];
      for (let oi = 0; oi < 10; oi++) {
        const a = CONFIG.opacities[oi];
        /* 原版 SRC_ALPHA + ONE 后再交给页面合成，等效于 alpha² */
        row.push(`rgba(${colors6[ci][0]},${colors6[ci][1]},${colors6[ci][2]},${a * a})`);
      }
      styles.push(row);
    }
    return styles;
  }

  function render2D(rec, time) {
    const canvas = rec.canvas;
    const ctx = rec.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, rec.bufW, rec.bufH);

    /* 原版 u_resolution = CSS 尺寸 × 2，和真实像素比无关；
       2D 在「着色器坐标」里画，再用 dpr/2 缩放，和 WebGL 完全同密度。 */
    const W = rec.cssW * 2;
    const H = rec.cssH * 2;
    const scale = rec.dpr / 2;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const total = CONFIG.totalSize;
    const dot = Math.min(CONFIG.dotSize, total);
    const offX = Math.abs(Math.floor((mod(W, total) - dot) * 0.5));
    const offY = Math.abs(Math.floor((mod(H, total) - dot) * 0.5));
    const cols = Math.ceil(Math.max(0, W - offX) / total);
    const rows = Math.ceil(Math.max(0, H - offY) / total);
    const cx = W / 2 / total;
    const cy = H / 2 / total;
    const maxDist = Math.max(1, Math.sqrt(cx * cx + cy * cy));
    const spread = clamp(time / CONFIG.revealSeconds, 0, 1);
    const soft = CONFIG.revealSoftness;
    const maxIntro = Math.max(0.001, 1 - soft);
    const styles = rec.styles;

    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const show = rand2(ix, iy);
        const dx = cx - ix;
        const dy = cy - iy;
        const distNorm = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const intro = clamp(distNorm * 0.62 + show * 0.30, 0, maxIntro);
        const reveal = smoothstep(intro, intro + soft, spread);
        if (reveal <= 0.001) continue;

        const span = Math.floor(time / 5 + show + 5);
        const rnd = rand2(ix * span + 1, iy * span + 1);
        const oi = clamp(Math.floor(rnd * 10), 0, 9);
        const ci = clamp(Math.floor(show * 6), 0, 5);
        /* styles 里的 alpha 已是 tier²；(tier*reveal)² = tier² * reveal² */
        ctx.globalAlpha = reveal * reveal;
        ctx.fillStyle = styles[ci][oi];
        ctx.fillRect(offX + ix * total, offY + iy * total, dot, dot);
      }
    }
    ctx.globalAlpha = 1;
  }

  function render(rec, time) {
    if (rec.webgl) {
      const { gl, prog, u } = rec.webgl;
      gl.viewport(0, 0, rec.bufW, rec.bufH);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(u.time, time);
      gl.uniform1f(u.spread, clamp(time / CONFIG.revealSeconds, 0, 1));
      gl.uniform1f(u.softness, CONFIG.revealSoftness);
      /* 原版固定 u_resolution = CSS 尺寸 × 2（R3F 的 size 是 CSS 尺寸） */
      gl.uniform2f(u.res, rec.cssW * 2, rec.cssH * 2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else if (rec.ctx) {
      render2D(rec, time);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 图标粒子化：inline SVG → data URL → 离屏采样轮廓 → 方点粒子          */
  /* ------------------------------------------------------------------ */
  function prepareIcon(rec) {
    const svg = rec.svg;
    if (!svg) { rec.iconFallback = true; return; }

    let markup = '';
    try {
      const clone = svg.cloneNode(true);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', '24');
      clone.setAttribute('height', '24');
      clone.style.color = '#000';       // stroke="currentColor" 在图片里也能解析
      markup = new XMLSerializer().serializeToString(clone);
    } catch (e) { rec.iconFallback = true; return; }

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const S = CONFIG.icon.sampleSize;
        const off = document.createElement('canvas');
        off.width = S;
        off.height = S;
        const ctx = off.getContext('2d');
        if (!ctx) throw new Error('no 2d');
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(img, 0, 0, S, S);
        const data = ctx.getImageData(0, 0, S, S).data;

        /* 按 2px 步长采 alpha，再按上限等距抽稀；结果只跟卡片身份有关，稳定 */
        const raw = [];
        const step = 2;
        for (let y = 0; y < S; y += step) {
          for (let x = 0; x < S; x += step) {
            if (data[(y * S + x) * 4 + 3] > 72) raw.push({ x: (x + 0.5) / S, y: (y + 0.5) / S });
          }
        }
        if (raw.length < 12) throw new Error('too few points');

        let picked = raw;
        if (raw.length > CONFIG.icon.maxPoints) {
          picked = [];
          const stride = raw.length / CONFIG.icon.maxPoints;
          for (let i = 0; i < CONFIG.icon.maxPoints; i++) picked.push(raw[Math.floor(i * stride)]);
        }

        const key = 'cr-' + rec.index + '-' + rec.colors6[0].join('') + '-';
        rec.iconPoints = picked.map((p, i) => {
          const rx = hash01(key + i + 'x');
          const ry = hash01(key + i + 'y');
          const rc = hash01(key + i + 'c');
          return {
            x: p.x, y: p.y,
            sx: 0.5 + (rx - 0.5) * CONFIG.icon.scatter,
            sy: 0.5 + (ry - 0.5) * CONFIG.icon.scatter,
            c: rc,
            ph: rx * Math.PI * 2,
          };
        });
        rec.iconNatural = true;
      } catch (e) { rec.iconFallback = true; }
    };
    img.onerror = () => { rec.iconFallback = true; };

    try { img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup); }
    catch (e) { rec.iconFallback = true; }
  }

  function measureIcon(rec) {
    const brick = rec.iconBrick;
    const canvas = rec.iconCanvas;
    if (!brick || !canvas) return;
    const box = brick.getBoundingClientRect();
    const s = rec.svg ? rec.svg.getBoundingClientRect() : null;
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    rec.iconDpr = dpr;
    rec.iconW = w;
    rec.iconH = h;
    rec.iconBox = {
      svgX: s ? s.left - box.left : 0,
      svgY: s ? s.top - box.top : 0,
      svgW: s && s.width > 1 ? s.width : w,
      svgH: s && s.height > 1 ? s.height : h,
    };
  }

  function advanceIcon(rec, now) {
    const a = rec.iconAnim;
    if (!a) return rec.iconP;
    const t = clamp((now - a.t0) / a.dur, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    rec.iconP = a.from + (a.to - a.from) * e;
    if (t >= 1) { rec.iconP = a.to; rec.iconAnim = null; }
    return rec.iconP;
  }

  function drawFallbackDots(rec, now) {
    const ctx = rec.iconCtx;
    const dpr = rec.iconDpr || 1;
    const cx = rec.iconW * dpr / 2;
    const cy = rec.iconH * dpr / 2;
    const rad = Math.min(rec.iconW, rec.iconH) * 0.36 * dpr;
    const dot = CONFIG.icon.dotSize * dpr;
    const n = CONFIG.icon.fallbackDots;
    const styles = rec.iconStyles || ['#fff'];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + now * 0.0007;
      const rr = rad * (0.90 + 0.10 * Math.sin(now * 0.004 + i * 1.7));
      const a = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.005 + i));
      ctx.globalAlpha = a;
      ctx.fillStyle = styles[i % styles.length];
      ctx.fillRect(cx + Math.cos(ang) * rr - dot / 2, cy + Math.sin(ang) * rr - dot / 2, dot, dot);
    }
    ctx.globalAlpha = 1;
  }

  /** 返回当前展开进度 p（0 = 全散开，1 = 轮廓成形） */
  function drawIcon(rec, now) {
    if (!rec.iconCtx || !rec.iconOn) return 0;
    const ctx = rec.iconCtx;
    const canvas = rec.iconCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (rec.iconMode === 'fallback') {
      drawFallbackDots(rec, now);
      return 1;
    }

    const p = advanceIcon(rec, now);
    if (p <= 0.001) return p;

    const dpr = rec.iconDpr || 1;
    const box = rec.iconBox || { svgX: 0, svgY: 0, svgW: rec.iconW, svgH: rec.iconH };
    const dot = CONFIG.icon.dotSize * dpr;
    const pts = rec.iconPoints || [];
    const styles = rec.iconStyles || ['#fff'];
    const settled = p > 0.995;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const tx = (box.svgX + pt.x * box.svgW) * dpr;
      const ty = (box.svgY + pt.y * box.svgH) * dpr;
      const ox = pt.sx * rec.iconW * dpr;
      const oy = pt.sy * rec.iconH * dpr;
      let x = ox + (tx - ox) * p;
      let y = oy + (ty - oy) * p;
      if (settled) {
        x += Math.sin(now * 0.0035 + pt.ph) * CONFIG.icon.shimmer * dpr;
        y += Math.cos(now * 0.0031 + pt.ph * 1.3) * CONFIG.icon.shimmer * dpr;
      }
      let a = clamp(p * 1.2, 0, 1);
      a *= 0.82 + 0.18 * Math.sin(now * 0.004 + pt.ph * 1.9);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = styles[(pt.c * 3) | 0] || styles[0];
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.globalAlpha = 1;
    return p;
  }

  function cancelIconRaf(rec) {
    if (rec.iconRaf) { cancelAnimationFrame(rec.iconRaf); rec.iconRaf = 0; }
  }

  function hideIconImmediate(rec) {
    cancelIconRaf(rec);
    rec.iconAnim = null;
    rec.iconP = 0;
    rec.iconOn = false;
    rec.iconMode = '';
    if (rec.iconCtx && rec.iconCanvas) {
      rec.iconCtx.setTransform(1, 0, 0, 1, 0, 0);
      rec.iconCtx.clearRect(0, 0, rec.iconCanvas.width, rec.iconCanvas.height);
    }
    if (rec.iconCanvas) rec.iconCanvas.style.opacity = '0';
    if (rec.svg) rec.svg.style.visibility = '';
  }

  function startIcon(rec) {
    if (!rec.iconCanvas || !rec.iconCtx) return;
    if (reduced()) { hideIconImmediate(rec); return; }  // 只即时撞色，不粒子化
    measureIcon(rec);
    cancelIconRaf(rec);
    rec.iconOn = true;
    rec.iconCanvas.style.opacity = '1';

    if (rec.iconNatural) {
      rec.iconMode = 'natural';
      if (rec.svg) rec.svg.style.visibility = 'hidden';
      rec.iconP = Math.max(rec.iconP, 0.08);
      rec.iconAnim = { from: rec.iconP, to: 1, t0: performance.now(), dur: CONFIG.icon.convergeMs };
      drawIcon(rec, performance.now());
    } else {
      /* 轮廓还没采到 / 采样失败：真 SVG 保持撞色，只加一圈轻抖粒子 */
      rec.iconMode = 'fallback';
      rec.iconAnim = null;
      rec.iconP = 1;
      drawIcon(rec, performance.now());
    }
  }

  function beginIconRetract(rec) {
    if (!rec.iconCanvas) return;
    rec.iconAnim = { from: rec.iconP, to: 0, t0: performance.now(), dur: CONFIG.icon.retractMs };
    cancelIconRaf(rec);
    const step = (now) => {
      rec.iconRaf = 0;
      let p = 0;
      try { p = drawIcon(rec, now); } catch (e) { hideIconImmediate(rec); return; }
      if (p > 0.001 && rec.iconOn) rec.iconRaf = requestAnimationFrame(step);
      else hideIconImmediate(rec);
    };
    rec.iconRaf = requestAnimationFrame(step);
  }

  function stopIcon(rec) {
    if (!rec.iconCanvas) return;
    if (!rec.iconOn) { hideIconImmediate(rec); return; }
    if (reduced() || document.hidden || rec.iconMode === 'fallback' || !rec.iconNatural) {
      hideIconImmediate(rec);
      return;
    }
    beginIconRetract(rec);
  }

  /* ------------------------------------------------------------------ */
  /* 挂载 / 生命周期                                                     */
  /* ------------------------------------------------------------------ */
  const records = new Map();          // card -> rec
  const reducedMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reducedMq && reducedMq.matches);

  let hall = null;
  let mo = null;
  let scanQueued = false;

  function focusVisible(card) {
    try { return card.matches(':focus-visible'); } catch (e) { return true; }
  }

  function resize(rec) {
    const rect = rec.card.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    rec.cssW = cssW;
    rec.cssH = cssH;
    rec.dpr = dpr;
    rec.bufW = bw;
    rec.bufH = bh;
    if (rec.canvas.width !== bw) rec.canvas.width = bw;
    if (rec.canvas.height !== bh) rec.canvas.height = bh;
  }

  function ensureRenderer(rec) {
    if (rec.webgl || rec.ctx) return true;
    if (rec.dead) return false;

    let hadWebGL = false;
    try {
      const webgl = initWebGL(rec.canvas, rec.colors6);
      if (webgl) {
        rec.webgl = webgl;
        return true;
      }
      hadWebGL = true; // 拿到过 context 但着色器没起来：换一块 canvas 再试 2D
    } catch (e) { hadWebGL = true; }

    if (hadWebGL) {
      const fresh = document.createElement('canvas');
      fresh.className = 'cr-canvas';
      fresh.style.cssText = 'display:block;width:100%;height:100%';
      rec.layer.replaceChild(fresh, rec.canvas);
      rec.canvas = fresh;
    }

    try {
      const ctx = rec.canvas.getContext('2d');
      if (ctx) {
        rec.ctx = ctx;
        rec.styles = build2DStyles(rec.colors6);
        return true;
      }
    } catch (e) { /* noop */ }

    /* 两种都不可用：删掉这一层，保持卡片原样 */
    rec.dead = true;
    rec.layer.remove();
    return false;
  }

  function stop(rec) {
    if (!rec.active) return;
    rec.active = false;
    rec.card.classList.remove('is-cr-on');
    rec.layer.style.opacity = '0';
    if (rec.raf) {
      cancelAnimationFrame(rec.raf);
      rec.raf = 0;
    }
    try { stopIcon(rec); } catch (e) { hideIconImmediate(rec); }
  }

  function tick(rec, now) {
    if (!rec.active) return;
    const fps = rec.ctx ? CONFIG.fallbackMaxFps : CONFIG.maxFps;
    if (now - rec.last >= 1000 / fps) {
      rec.last = now;
      render(rec, (now - rec.t0) / 1000);
      if (rec.iconOn) {
        try { drawIcon(rec, now); } catch (e) { hideIconImmediate(rec); }
      }
    }
    rec.raf = requestAnimationFrame((ts) => tick(rec, ts));
  }

  function start(rec) {
    if (rec.active || rec.dead) return;
    if (!ensureRenderer(rec)) return;
    resize(rec);                     // 放后面：2D 降级可能换过 canvas

    rec.active = true;
    rec.card.classList.add('is-cr-on');
    rec.layer.style.opacity = String(CONFIG.layerOpacity);
    rec.t0 = performance.now();
    rec.last = 0;
    try { startIcon(rec); } catch (e) { hideIconImmediate(rec); }

    if (reduced()) {
      render(rec, STATIC_TIME);      // 静态一帧：不跑 rAF
    } else {
      rec.raf = requestAnimationFrame((ts) => tick(rec, ts));
    }
  }

  function sync(rec) {
    if (!rec || rec.dead) return;
    const want = rec.visible &&
      !document.hidden &&
      (rec.hovered || (rec.focused && focusVisible(rec.card))) &&
      !rec.card.classList.contains('is-off');
    if (want) start(rec);
    else stop(rec);
  }

  function mount(card, index) {
    const layer = document.createElement('span');
    layer.className = 'cr-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;overflow:hidden;opacity:0;';

    const canvas = document.createElement('canvas');
    canvas.className = 'cr-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    layer.appendChild(canvas);

    if (CONFIG.showGradient) {
      const grad = document.createElement('span');
      grad.className = 'cr-gradient';
      grad.setAttribute('aria-hidden', 'true');
      layer.appendChild(grad);
    }

    card.insertBefore(layer, card.firstChild);

    /* 内容层永远压在 canvas 上（即使 CSS 尚未加载也不挡字） */
    for (let i = 0; i < card.children.length; i++) {
      const el = card.children[i];
      if (el === layer) continue;
      el.style.position = 'relative';
      el.style.zIndex = '1';
    }

    const pal = paletteFor(card, index);
    const rec = {
      card, layer, canvas,
      index,
      colors: pal.colors,
      colors6: null,
      baseHue: pal.base,
      iconBg: pal.iconBg,
      iconInk: pal.iconInk,
      iconColors: pal.iconColors,
      webgl: null,
      ctx: null,
      styles: null,
      active: false,
      visible: true,
      hovered: false,
      focused: false,
      dead: false,
      raf: 0,
      t0: 0,
      last: 0,
      cssW: 0, cssH: 0, dpr: 1, bufW: 1, bufH: 1,

      /* 图标粒子 */
      iconBrick: null, svg: null, iconCanvas: null, iconCtx: null,
      iconPoints: null, iconStyles: null,
      iconNatural: false, iconFallback: false,
      iconOn: false, iconMode: '', iconP: 0, iconAnim: null, iconRaf: 0,
      iconDpr: 1, iconW: 0, iconH: 0, iconBox: null,

      onEnter: null, onLeave: null, onFocusIn: null, onFocusOut: null,
      ro: null, io: null,
    };
    rec.colors6 = expandColors(rec.colors);
    records.set(card, rec);

    /* 卡片上的自动颜色 → CSS 变量（图标砖撞色 / 真 SVG 的 currentColor） */
    card.style.setProperty('--cr-icon-bg',
      `rgba(${pal.iconBg[0]},${pal.iconBg[1]},${pal.iconBg[2]},${CONFIG.palette.iconBg.alpha})`);
    card.style.setProperty('--cr-icon-ink', `rgb(${pal.iconInk[0]},${pal.iconInk[1]},${pal.iconInk[2]})`);

    /* 图标粒子画布：塞进图标砖，覆盖在真 SVG 上，pointer-events 由 CSS 关掉 */
    rec.iconBrick = card.querySelector('.tool-card__ico');
    rec.svg = rec.iconBrick ? rec.iconBrick.querySelector('svg') : null;
    if (rec.iconBrick) {
      const ic = document.createElement('canvas');
      ic.className = 'cr-icon';
      ic.setAttribute('aria-hidden', 'true');
      rec.iconBrick.appendChild(ic);
      try { rec.iconCtx = ic.getContext('2d'); } catch (e) { rec.iconCtx = null; }
      if (rec.iconCtx) {
        rec.iconCanvas = ic;
        rec.iconStyles = pal.iconColors.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
        try { prepareIcon(rec); } catch (e) { rec.iconFallback = true; }
      } else {
        ic.remove();
      }
    }

    rec.onEnter = (e) => {
      if (e.pointerType === 'touch') return;  // 触屏不靠「悬停」亮
      rec.hovered = true;
      sync(rec);
    };
    rec.onLeave = (e) => {
      if (e.pointerType === 'touch') return;
      rec.hovered = false;
      sync(rec);
    };
    rec.onFocusIn = () => { rec.focused = true; sync(rec); };
    rec.onFocusOut = (e) => {
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      rec.focused = false;
      sync(rec);
    };

    card.addEventListener('pointerenter', rec.onEnter);
    card.addEventListener('pointerleave', rec.onLeave);
    card.addEventListener('focusin', rec.onFocusIn);
    card.addEventListener('focusout', rec.onFocusOut);

    if (typeof ResizeObserver === 'function') {
      rec.ro = new ResizeObserver(() => {
        if (!rec.active) return;
        resize(rec);
        if (rec.iconOn) { try { measureIcon(rec); } catch (e) { /* noop */ } }
        if (reduced()) render(rec, STATIC_TIME);
      });
      rec.ro.observe(card);
    }

    if (typeof IntersectionObserver === 'function') {
      rec.io = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].target === card) rec.visible = entries[i].isIntersecting;
        }
        sync(rec);
      }, { rootMargin: '80px', threshold: 0.01 });
      rec.io.observe(card);
    }

    /* 重画时指针可能已经停在卡上（pointerenter 不会再补发） */
    try { rec.hovered = card.matches(':hover'); } catch (e) { /* noop */ }
    try { rec.focused = card.matches(':focus-visible'); } catch (e) { /* noop */ }
    if (rec.hovered || rec.focused) sync(rec);
  }

  function destroy(rec) {
    stop(rec);
    hideIconImmediate(rec);
    rec.dead = true;
    try { if (rec.ro) rec.ro.disconnect(); } catch (e) { /* noop */ }
    try { if (rec.io) rec.io.disconnect(); } catch (e) { /* noop */ }
    rec.card.removeEventListener('pointerenter', rec.onEnter);
    rec.card.removeEventListener('pointerleave', rec.onLeave);
    rec.card.removeEventListener('focusin', rec.onFocusIn);
    rec.card.removeEventListener('focusout', rec.onFocusOut);
    if (rec.webgl) {
      try {
        const lose = rec.webgl.gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) { /* noop */ }
    }
    rec.layer.remove();
    records.delete(rec.card);
  }

  function scan() {
    if (!hall || !hall.isConnected) return;

    records.forEach((rec, card) => {
      if (!card.isConnected || card.parentElement !== hall) destroy(rec);
    });

    const cards = hall.querySelectorAll(':scope > ' + CARD_SEL);
    for (let i = 0; i < cards.length; i++) {
      if (!records.has(cards[i])) mount(cards[i], i);
    }
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  function syncAll() {
    records.forEach((rec) => {
      /* 标签页切回来时指针可能已经不在卡上，重新问一次 :hover */
      try { rec.hovered = rec.card.matches(':hover'); } catch (e) { /* noop */ }
      sync(rec);
    });
  }

  function boot() {
    hall = document.getElementById(HALL_ID);
    if (!hall) return false;
    if (!mo) {
      mo = new MutationObserver(scheduleScan);
      mo.observe(hall, { childList: true });
    }
    scan();
    return true;
  }

  /* 页面切走时暂停所有 rAF；回来时只恢复当前仍 hover/focus 的卡 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      records.forEach((rec) => stop(rec));
    } else {
      syncAll();
    }
  });

  /* reduced-motion 切换：运行中的卡在「静态帧 / 动画」之间切换 */
  if (reducedMq) {
    const onMotionChange = () => {
      records.forEach((rec) => {
        if (!rec.active) {
          if (reduced()) hideIconImmediate(rec);
          return;
        }
        if (reduced()) {
          if (rec.raf) { cancelAnimationFrame(rec.raf); rec.raf = 0; }
          hideIconImmediate(rec);       // 只保留即时撞色
          render(rec, STATIC_TIME);
        } else {
          try { startIcon(rec); } catch (e) { hideIconImmediate(rec); }
          if (!rec.raf) {
            rec.t0 = performance.now();
            rec.last = 0;
            rec.raf = requestAnimationFrame((ts) => tick(rec, ts));
          }
        }
      });
    };
    if (reducedMq.addEventListener) reducedMq.addEventListener('change', onMotionChange);
    else if (reducedMq.addListener) reducedMq.addListener(onMotionChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }

  window.LiziCanvasReveal = {
    refresh: scheduleScan,
    config: CONFIG,
  };
})();
