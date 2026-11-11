/**
 * LIZI · 手机大厅 · 封面半调切换
 * --------------------------------------------------------------------------
 * 照 ReactBits HalftoneReveal 的 mono（单色网点）模式：
 *   https://www.reactbits.dev/c/animations/halftone-reveal
 * 原组件把照片印成纸上的黑点，再用一块移动的遮罩把清晰照片从网点里揭出来。
 *
 * 这里把它接到「换封面」：
 *   0.00–0.44  当前封面 A：清晰图先退回网点，网点再胀满整块 → 全黑
 *   0.44       在纯黑那一帧换纹理（onSwap 回调）
 *   0.44–1.00  新封面 B：网点从画面中心往外长出，随后在网点内部揭出清晰彩图
 * 静止时永远是清晰的彩色封面，不是半调印刷态。
 *
 * 对外：
 *   const fx = CoverFX.mount(canvas)      // WebGL2 不可用返回 null
 *   fx.show(url, { immediate, onSwap })   // Promise<boolean>
 *   fx.clear()                            // 画布清成透明，露出 CSS 占位
 *   fx.active()
 *
 * 性能：只在切换/首图入场时跑 rAF；结束就停。DPR 上限 2，纹理生成 mipmap
 * 供网点按格子大小取样（和原组件一致）。页面隐藏就停帧。
 */
(function () {
  'use strict';

  const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

  const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uImageA;
uniform sampler2D uImageB;
uniform vec2 uResolution;
uniform vec2 uView;
uniform float uDpr;
uniform vec4 uFrame;
uniform float uTexels;
uniform float uUseB;
uniform float uCell;
uniform float uAngle;
uniform float uScale;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uContrast;
uniform float uBrightness;
uniform float uInvert;
uniform float uIntro;
uniform float uReveal;
uniform float uBoost;
uniform float uBlack;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

mat2 rotate(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float reach(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.785 ? sqrt(t / 3.14159) : mix(0.5, 0.72, (t - 0.785) / 0.215);
}

vec4 photo(vec2 p, float lod, float margin) {
  vec2 uv = (p - uFrame.xy) / uFrame.zw;
  vec4 c = uUseB > 0.5
    ? textureLod(uImageB, clamp(uv, 0.0, 1.0), lod)
    : textureLod(uImageA, clamp(uv, 0.0, 1.0), lod);
  vec2 slack = margin * uCell / uFrame.zw;
  vec2 inside = step(-slack, uv) * step(uv, 1.0 + slack);
  float keep = inside.x * inside.y * c.a;
  return vec4(c.rgb, keep);
}

float grade(float v) {
  v = clamp((v - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0);
  return mix(v, 1.0 - v, uInvert);
}

vec3 gradeColor(vec3 c) {
  return vec3(grade(c.r), grade(c.g), grade(c.b));
}

vec3 tone(vec3 c) {
  return pow(max(c, 0.0), vec3(1.5));
}

float press(float t, float alpha) {
  return (0.05 + clamp(t, 0.0, 1.0) * 0.89) * alpha;
}

float coverage(vec4 image) {
  float shade = dot(tone(gradeColor(image.rgb)), LUMA);
  float paper = dot(tone(uPaper), LUMA);
  float span = dot(tone(uInk), LUMA) - paper;
  float t = abs(span) < 0.02 ? 1.0 - shade : (shade - paper) / span;
  return press(t, image.a);
}

vec2 center(vec2 p, float angle) {
  vec2 q = rotate(angle) * p / uCell;
  vec2 c = floor(q) + 0.5;
  return rotate(-angle) * c * uCell;
}

float dots(vec2 p, float angle, float t, float grow, float boost) {
  vec2 q = rotate(angle) * p / uCell;
  float d = length(fract(q) - 0.5);
  float r = reach(t) * uScale * grow * boost;
  float w = max(fwidth(d), 0.0001) * 0.75;
  return smoothstep(r + w, r - w, d) * clamp(r / (w * 2.0), 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uDpr;
  float lod = log2(max(uCell * uTexels, 1.0));
  float base = uAngle;

  /* 网点从中心往外生长的空间延迟（和原组件的 intro 一致） */
  vec2 field = p / max(uView.x, uView.y) - uView / max(uView.x, uView.y) * 0.5;
  float delay = length(field) * 1.15 + hash(floor(p / uCell)) * 0.06;
  float growB = smoothstep(0.0, 1.0, clamp((uIntro * 1.7 - delay) / 0.45, 0.0, 1.0));
  float grow = uUseB > 0.5 ? growB : 1.0;

  float t = coverage(photo(center(p, base), lod, 0.5));
  float kdot = dots(p, base, pow(t, 1.9), grow, uBoost);
  vec3 print = mix(uPaper, uInk, kdot);
  print = mix(print, uInk, clamp(uBlack, 0.0, 1.0));

  /* 遮罩：清晰照片在网点内部被揭出来，也是从中心往外走 */
  float shown = smoothstep(0.0, 1.0, clamp((uReveal * 1.7 - delay) / 0.45, 0.0, 1.0));
  vec2 q = rotate(base) * p / uCell;
  float d = length(fract(q) - 0.5);
  float r = reach(1.0) * 1.08 * shown;
  float w = max(fwidth(d), 0.0001) * 0.75;
  float k = smoothstep(r + w, r - w, d) * clamp(r / (w * 2.0), 0.0, 1.0);

  vec4 sharp = photo(p, 0.0, 0.0);
  vec3 real = mix(uPaper, sharp.rgb, sharp.a);
  outColor = vec4(mix(print, real, k), 1.0);
}
`;

  const UNIFORMS = [
    'uImageA', 'uImageB', 'uResolution', 'uView', 'uDpr', 'uFrame',
    'uTexels', 'uUseB', 'uCell', 'uAngle', 'uScale', 'uInk', 'uPaper',
    'uContrast', 'uBrightness', 'uInvert', 'uIntro', 'uReveal', 'uBoost', 'uBlack',
  ];

  const SWITCH_MS = 1050;
  const SWITCH_AT = 0.44;
  const INTRO_MS = 900;
  const CELL = 7;
  const ANGLE = Math.PI / 4;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smoothstep = (a, b, v) => {
    const t = clamp01((v - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  };

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    gl.deleteShader(sh);
    return null;
  }

  function hexRgb(value) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
    if (!m) return [0, 0, 0];
    const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }

  function mount(canvas, options) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return null;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    const uniforms = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]));
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const cfg = {
      ink: options && options.ink ? options.ink : '#15121b',
      paper: options && options.paper ? options.paper : '#f4f2ee',
      cell: options && options.cell ? options.cell : CELL,
    };
    const ink = hexRgb(cfg.ink);
    const paper = hexRgb(cfg.paper);

    function newTexture() {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    }

    let texA = newTexture();
    let texB = newTexture();

    const view = { w: 0, h: 0, dpr: 1 };
    let cur = null;             // { url, img, tex }
    let state = null;           // 正在跑的一次切换
    let raf = 0;
    let seq = 0;
    let resolver = null;
    let destroyed = false;

    function upload(tex, img) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    function frameFor(img) {
      if (!img || !view.w || !view.h) return [0, 0, view.w || 1, view.h || 1];
      const scale = Math.max(view.w / img.naturalWidth, view.h / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      return [(view.w - w) / 2, (view.h - h) / 2, Math.max(1, w), Math.max(1, h)];
    }

    function resize() {
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.w = w;
      view.h = h;
      view.dpr = dpr;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      if (!state) drawIdle();
    }

    function bindTextures() {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texA);
      gl.uniform1i(uniforms.uImageA, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB);
      gl.uniform1i(uniforms.uImageB, 1);
    }

    function drawAt(img, useB, u) {
      const frame = frameFor(img);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      bindTextures();
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uView, view.w, view.h);
      gl.uniform1f(uniforms.uDpr, canvas.width / Math.max(1, view.w));
      gl.uniform4f(uniforms.uFrame, frame[0], frame[1], frame[2], frame[3]);
      gl.uniform1f(uniforms.uTexels, img ? img.naturalWidth / frame[2] : 1);
      gl.uniform1f(uniforms.uUseB, useB ? 1 : 0);
      gl.uniform1f(uniforms.uCell, cfg.cell);
      gl.uniform1f(uniforms.uAngle, ANGLE);
      gl.uniform1f(uniforms.uScale, 1);
      gl.uniform3f(uniforms.uInk, ink[0], ink[1], ink[2]);
      gl.uniform3f(uniforms.uPaper, paper[0], paper[1], paper[2]);
      gl.uniform1f(uniforms.uContrast, 1.1);
      gl.uniform1f(uniforms.uBrightness, 0);
      gl.uniform1f(uniforms.uInvert, 0);
      gl.uniform1f(uniforms.uIntro, u.intro);
      gl.uniform1f(uniforms.uReveal, u.reveal);
      gl.uniform1f(uniforms.uBoost, u.boost);
      gl.uniform1f(uniforms.uBlack, u.black);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    function drawIdle() {
      if (!view.w || !view.h) return;
      if (!cur) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      drawAt(cur.img, false, { intro: 1, reveal: 1, boost: 1, black: 0 });
    }

    function finish(ok) {
      if (state) {
        const done = state;
        state = null;
        if (done.resolve) {
          done.resolve(ok);
          if (resolver === done.resolve) resolver = null;
        }
      }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    /* 中途被新请求打断：如果已经切到 B，就把 B 认成当前图，别让画面弹回 A */
    function abort() {
      if (!state) return;
      if (state.swapped && state.imgB) {
        const t = texA;
        texA = texB;
        texB = t;
        cur = { url: state.url, img: state.imgB, tex: texA };
      }
      finish(false);
    }

    function load(url) {
      return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }

    function drawSwitch(p) {
      if (!state) return;
      if (p < SWITCH_AT) {
        const t = p / SWITCH_AT;
        drawAt(cur ? cur.img : state.imgB, false, {
          intro: 1,
          reveal: 1 - smoothstep(0, 0.85, t),
          boost: 1 + 1.6 * t * t,
          black: smoothstep(0.72, 1, t),
        });
        return;
      }
      if (!state.swapped) {
        state.swapped = true;
        if (state.onSwap) {
          try { state.onSwap(); } catch { /* 忽略 */ }
        }
      }
      const q = clamp01((p - SWITCH_AT) / (1 - SWITCH_AT));
      drawAt(state.imgB, true, {
        intro: smoothstep(0, 0.55, q),
        reveal: smoothstep(0.55, 0.95, q),
        boost: 1 + 1.6 * (1 - smoothstep(0.15, 0.6, q)),
        black: 1 - smoothstep(0, 0.18, q),
      });
    }

    function drawIntro(q) {
      if (!state) return;
      drawAt(state.imgB, true, {
        intro: 1,                       // 首帧直接是网点印刷态，别先闪一张纸
        reveal: smoothstep(0, 1, q),
        boost: 1,
        black: 0,
      });
    }

    function finishSwitch() {
      /* 收尾：B 变成当前 A，之后一律从 A 槽读（state 由 finish 收） */
      const t = texA;
      texA = texB;
      texB = t;
      cur = { url: state.url, img: state.imgB, tex: texA };
      drawIdle();
    }

    function tick() {
      raf = 0;
      if (destroyed || document.hidden || !state) return;
      const elapsed = performance.now() - state.start;
      if (state.mode === 'intro') {
        const q = clamp01(elapsed / INTRO_MS);
        if (q >= 1) { finishSwitch(); finish(true); return; }
        drawIntro(q);
        raf = requestAnimationFrame(tick);
        return;
      }
      if (elapsed >= SWITCH_MS) { finishSwitch(); finish(true); return; }
      drawSwitch(clamp01(elapsed / SWITCH_MS));
      raf = requestAnimationFrame(tick);
    }

    /* 首图走 intro：只把新图先放进 B 槽，画面从网点里长出来 */
    function showIntro(stateObj) {
      cur = null;
      stateObj.mode = 'intro';
      stateObj.start = performance.now();
      state = stateObj;
      drawIntro(0);
      wake();
    }

    function wake() {
      if (raf || destroyed || document.hidden) return;
      raf = requestAnimationFrame(tick);
    }

    function clear() {
      abort();
      seq++;
      if (resolver) { resolver(false); resolver = null; }
      cur = null;
      if (view.w && view.h) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      } else if (state) {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    drawIdle();

    return {
      show(url, opts) {
        opts = opts || {};
        if (state) { abort(); drawIdle(); }
        if (!url) { clear(); return Promise.resolve(true); }
        if (destroyed) return Promise.resolve(false);
        if (cur && cur.url === url && !opts.immediate) return Promise.resolve(true);
        const token = ++seq;
        if (resolver) { resolver(false); resolver = null; }
        return new Promise((resolve) => {
          resolver = resolve;
          load(url).then((img) => {
            if (token !== seq || destroyed) {
              resolve(false);
              if (resolver === resolve) resolver = null;
              return;
            }
            if (!img) {
              resolve(false);
              if (resolver === resolve) resolver = null;
              return;
            }

            if (!cur) {
              if (!(opts && opts.immediate)) {
                upload(texB, img);
                showIntro({ url, imgB: img, swapped: true, resolve, onSwap: null });
                return;
              }
              upload(texA, img);
              cur = { url, img, tex: texA };
              drawIdle();
              resolve(true);
              if (resolver === resolve) resolver = null;
              return;
            }

            if (opts && opts.immediate) {
              upload(texB, img);
              const t = texA; texA = texB; texB = t;
              cur = { url, img, tex: texA };
              drawIdle();
              resolve(true);
              if (resolver === resolve) resolver = null;
              return;
            }

            upload(texB, img);
            state = {
              url, imgB: img, start: performance.now(), mode: 'switch', swapped: false,
              resolve,
              onSwap: typeof opts.onSwap === 'function' ? opts.onSwap : null,
            };
            drawSwitch(0);
            wake();
          });
        });
      },
      clear,
      active: () => !!cur,
      destroy() {
        destroyed = true;
        finish(false);
        ro.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        gl.deleteTexture(texA);
        gl.deleteTexture(texB);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
      },
    };
  }

  window.CoverFX = { mount };
})();
