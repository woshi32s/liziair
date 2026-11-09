/* ==========================================================================
   LIZI · 全息卡（HoloCard）材质 —— ReactBits 原生 WebGL2 移植
   --------------------------------------------------------------------------
   来源：
     ReactBits · HoloCard（HoloCard.jsx / HoloCard.css）
     https://reactbits.dev
     https://www.reactbits.dev/r/HoloCard-JS-CSS.json
     原版权归 ReactBits 所有。许可证：MIT + Commons Clause。
     本文件保留原着色器（GLSL）、preset 图案、弹簧与指针逻辑，只把 React
     组件外壳换成原生 JS，并按下面的说明做了 3:4 cover 裁剪和暂停/释放。

   做什么：
     mount(faceEl, imgEl, opts) 往 .hc-face 里插一张绝对定位的 canvas，用
     HoloCard 原来的片元着色器画全息箔、六边形边缘闪片、sheen/shine 高光；
     同时把原来的弹簧倾斜（perspective + scale + rotateX/rotateY）写到
     faceEl.style.transform 上。外壳的 DOM 结构、尺寸和其它样式一概不动。

   与 ReactBits 原版的差异（只有这三类）：
     1) React 组件外壳 → 原生 JS（mount / setPreset / setIntensity / destroy）；
     2) 原版会把卡片比例改成图片自然比例；这里大卡固定 3:4，改为在片元
        着色器采样时做居中 cover 裁剪（uArtRatio / uCardRatio），箔纹和
        圆角仍然按卡片坐标算，所以不会跟着图片比例变形；
     3) 增加了 IntersectionObserver 离屏暂停、document.hidden 暂停、
        运动量静止 0.3s 停 rAF、prefers-reduced-motion 静态帧，以及
        destroy() 时主动 loseContext() 释放 WebGL 上下文。

   失败约定：
     · webgl2 不可用 / 着色器编译或链接失败 / 挂载时纹理上传失败（图片
       跨域且没有 CORS，texImage2D 抛 SECURITY_ERR）→ mount() 返回 null，
       外壳保留 CSS 近似（同时会调 opts.onUnavailable(reason)）。
     · 图片晚于 mount 才加载完、加载/上传时才发现失败 → 实例自行销毁
       （移除 canvas、释放上下文、撤掉外壳的 .has-shader 接管标记），并
       回调 opts.onUnavailable('texture')，让 CSS 近似重新露出来。

   用法：
     const inst = window.LIZI_HOLO_SHADER.mount(faceEl, imgEl, {
       preset: 'bursts', intensity: 0.85, glare: 0.5, edgeSparkle: 0.8,
       radius: 14, tiltMax: 14, hoverScale: 1.04,
     });
     inst?.setPreset('gold');
     inst?.setIntensity(0.7);
     inst?.destroy();
   ========================================================================== */

window.LIZI_HOLO_SHADER = (() => {
  'use strict';

  const PRESETS = ['bursts', 'stars', 'shards', 'cosmos', 'rainbow', 'swirl', 'glitter', 'gold'];
  const DEFAULT_PERSPECTIVE = 1100;

  /* 顶点着色器：全屏三角形，和原版一致。 */
  const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  /* 片元着色器：除 uArtRatio / uCardRatio 和 main() 里的 cover 裁剪外，
     与 ReactBits HoloCard.jsx 中的 FRAGMENT 逐字一致。 */
  const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uArt;
uniform vec2 uSize;
uniform float uAspect;
uniform float uArtRatio;   // LIZI: image natural aspect ratio (w/h)
uniform float uCardRatio;  // LIZI: card aspect ratio (w/h)
uniform vec2 uTilt;
uniform vec2 uLight;
uniform float uDistance;
uniform int uPreset;
uniform float uIntensity;
uniform float uScale;
uniform float uEdge;
uniform float uFrame;
uniform float uRadius;
uniform float uGlare;
uniform vec3 uFoil;
uniform float uReady;

out vec4 outColor;

const float TAU = 6.28318530718;

struct Foil {
  float mask;
  float angle;
  float jitter;
  vec2 facet;
};

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + 17.31));
}

vec3 hue(float t) {
  t = abs(fract(t * 0.5) * 2.0 - 1.0);
  vec3 c = mix(vec3(0.1, 0.25, 1.0), vec3(0.0, 0.85, 1.0), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.25, 1.0, 0.2), smoothstep(0.25, 0.45, t));
  c = mix(c, vec3(1.0, 0.92, 0.05), smoothstep(0.45, 0.65, t));
  c = mix(c, vec3(1.0, 0.45, 0.05), smoothstep(0.65, 0.85, t));
  return mix(c, vec3(0.95, 0.12, 0.3), smoothstep(0.85, 1.0, t));
}

Foil bursts(vec2 p) {
  vec2 q = mat2(0.7071068, 0.7071068, -0.7071068, 0.7071068) * (p - vec2(0.5, 0.5 * uAspect)) / (0.283 / uScale);
  vec2 d = fract(q) - 0.5;
  float u = length(d) / 0.49;
  float angle = atan(d.y, d.x);
  if (u < 0.12) {
    float ring = min(floor(u / 0.045 + 0.5), 2.0);
    float count = max(1.0, ring * 6.0);
    float spot = (floor(angle / TAU * count) + 0.5) / count * TAU;
    vec2 dot = vec2(cos(spot), sin(spot)) * ring * 0.045;
    float m = smoothstep(0.024, 0.012, length(d / 0.49 - dot));
    return Foil(m, angle, 0.5, vec2(0.0));
  }
  bool inner = u < 0.66;
  float slot = angle / TAU * (inner ? 56.0 : 72.0);
  bool shifted = mod(floor(slot), 2.0) > 0.5;
  vec2 band = inner ? (shifted ? vec2(0.45, 0.61) : vec2(0.33, 0.49)) : (shifted ? vec2(0.84, 0.99) : vec2(0.7, 0.85));
  float across = abs(u - (band.x + band.y) * 0.5) / ((band.y - band.x) * 0.5);
  float along = abs(fract(slot) - 0.5) * 2.0;
  float width = inner ? 0.72 : 0.6;
  float m = smoothstep(1.0, 0.78, across) * smoothstep(width, width - 0.2, along);
  return Foil(m, angle, 0.5, vec2(0.0));
}

Foil stars(vec2 p) {
  Foil best = Foil(0.0, 0.0, 0.0, vec2(0.0));
  vec2 g = p / (0.08 / uScale);
  vec2 base = floor(g);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      float pick = hash(id + 1.3);
      vec2 d = g - (id + 0.5 + (hash2(id) - 0.5) * 0.55);
      float m = smoothstep(0.07, 0.035, length(d));
      if (pick < 0.62) {
        float size = mix(0.16, 0.5, pow(hash(id + 9.0), 1.8));
        float sector = TAU / (pick < 0.3 ? 4.0 : 5.0);
        float k = abs(fract((atan(d.y, d.x) + hash(id + 4.0) * TAU) / sector) - 0.5) * 2.0;
        float edge = size * mix(1.0, 0.36, pow(k, 0.6));
        m = smoothstep(edge, edge * 0.8, length(d));
      }
      if (m > best.mask) best = Foil(m, hash(id + 6.0) * TAU, hash(id + 8.0), (hash2(id + 2.0) - 0.5) * 0.6);
    }
  }
  return best;
}

Foil shards(vec2 p) {
  vec2 g = p * 19.0 * uScale;
  vec2 base = floor(g);
  float best = 9.0;
  float second = 9.0;
  vec2 id = base;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      float d = length(cell + 0.08 + hash2(cell) * 0.84 - g);
      if (d < best) {
        second = best;
        best = d;
        id = cell;
      } else if (d < second) {
        second = d;
      }
    }
  }
  float crack = smoothstep(0.015, 0.07, second - best);
  float shine = 0.25 + 0.75 * pow(hash(id + 7.7), 2.0);
  return Foil((0.2 + 0.8 * crack) * shine, hash(id + 3.17) * TAU, hash(id + 11.73), (hash2(id + 5.0) - 0.5) * 0.5);
}

Foil cosmos(vec2 p) {
  Foil best = Foil(0.0, 0.0, 0.0, vec2(0.0));
  vec2 g = p / (0.16 / uScale);
  vec2 base = floor(g);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      vec2 d = g - (id + 0.5 + (hash2(id) - 0.5) * 0.7);
      float size = mix(0.16, 0.52, hash(id + 2.0));
      float r = length(d);
      float m = max(smoothstep(0.05, 0.0, abs(r - size)), smoothstep(size, size - 0.04, r) * 0.22);
      if (m > best.mask) best = Foil(m, hash(id + 6.0) * TAU + atan(d.y, d.x) * 0.5, hash(id + 1.0), (hash2(id + 4.0) - 0.5) * 0.5);
    }
  }
  vec2 fine = p / (0.035 / uScale);
  vec2 cell = floor(fine);
  float dots = smoothstep(0.2, 0.1, length(fine - cell - 0.5 - (hash2(cell + 9.0) - 0.5) * 0.6)) * step(0.55, hash(cell + 2.0));
  if (dots > best.mask) best = Foil(dots, hash(cell) * TAU, hash(cell + 3.0), (hash2(cell + 7.0) - 0.5) * 0.6);
  return best;
}

Foil rainbow(vec2 p) {
  return Foil(0.86 + 0.14 * hash(floor(p * 700.0 * uScale)), 0.2, 0.5, vec2(0.0));
}

Foil swirl(vec2 p) {
  vec2 d = p - vec2(0.5, 0.42 * uAspect);
  float angle = atan(d.y, d.x);
  float rays = 0.55 + 0.45 * smoothstep(0.3, 0.7, abs(fract(angle / TAU * 60.0 * uScale) - 0.5) * 2.0);
  return Foil(rays, angle, length(d), vec2(0.0));
}

Foil glitter(vec2 p) {
  vec2 g = p * 72.0 * uScale;
  vec2 cell = floor(g);
  float size = mix(0.18, 0.4, hash(cell + 3.0));
  float m = smoothstep(size, size * 0.55, length(fract(g) - 0.5 - (hash2(cell) - 0.5) * 0.5)) * step(0.25, hash(cell + 5.0));
  return Foil(m, hash(cell + 7.0) * TAU, hash(cell + 9.0), (hash2(cell + 11.0) - 0.5) * 0.9);
}

Foil gold(vec2 p) {
  Foil flake = glitter(p * 0.8);
  if (flake.mask > 0.5) return flake;
  float etch = 0.55 + 0.45 * smoothstep(0.2, 0.8, abs(fract((p.x * 0.6 + p.y) * 140.0 * uScale) - 0.5) * 2.0);
  return Foil(etch, 0.9, 0.4, vec2(0.0));
}

vec3 sparkles(vec2 p, vec3 halfway, vec2 sweep, float awake) {
  vec2 g = p * 62.0;
  vec2 cell = floor(g);
  vec2 d = fract(g) - 0.5 - (hash2(cell) - 0.5) * 0.36;
  float spin = hash(cell + 3.0) * TAU;
  d = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * d;
  vec2 a = abs(d);
  float hexagon = max(a.x * 0.866 + a.y * 0.5, a.y);
  float size = mix(0.22, 0.38, hash(cell + 2.0));
  float piece = smoothstep(size, size - 0.07, hexagon) * step(0.42, hash(cell + 4.0));
  vec3 facet = normalize(vec3((hash2(cell + 6.0) - 0.5) * 0.9, 1.0));
  float flash = pow(max(dot(facet, halfway), 0.0), 6.0);
  vec3 tint = hue(dot(sweep, vec2(cos(spin), sin(spin))) * 1.2 + dot(sweep, vec2(0.8, 0.6)) * 0.8 + hash(cell + 8.0) * 0.5);
  vec3 color = piece * tint * (0.3 + 1.6 * flash) * awake;
  vec2 fine = p * 210.0;
  vec2 speckCell = floor(fine);
  float speck = smoothstep(0.24, 0.0, length(fract(fine) - 0.5 - (hash2(speckCell) - 0.5) * 0.5)) * step(0.72, hash(speckCell + 1.0));
  float speckFlash = pow(max(dot(normalize(vec3((hash2(speckCell + 2.0) - 0.5) * 0.9, 1.0)), halfway), 0.0), 10.0);
  return color + vec3(1.2) * speck * speckFlash * (1.0 - piece);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uSize.x, 1.0 - gl_FragCoord.y / uSize.y);

  // LIZI: center cover-crop inside the fixed 3:4 card.
  // Wider image -> crop left/right; taller image -> crop top/bottom.
  // p still uses the card aspect, so the foil, rounded SDF and sparkles
  // keep their original scale and are not distorted by the image ratio.
  vec2 artUV = uv;
  float artAspect = max(uArtRatio, 0.0001);
  float cardAspect = max(uCardRatio, 0.0001);
  if (artAspect > cardAspect) {
    artUV.x = 0.5 + (uv.x - 0.5) * (cardAspect / artAspect);
  } else {
    artUV.y = 0.5 + (uv.y - 0.5) * (artAspect / cardAspect);
  }

  vec2 p = vec2(uv.x, uv.y * uAspect);
  vec2 center = vec2(0.5, 0.5 * uAspect);
  vec2 q = abs(p - center) - center + uRadius;
  float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float pixel = 1.0 / uSize.x;
  float alpha = clamp(0.5 - outside / pixel, 0.0, 1.0);
  vec4 sampled = texture(uArt, artUV);
  if (uReady > 0.5) alpha *= sampled.a;
  if (alpha <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  vec3 art = uReady > 0.5 ? pow(sampled.rgb, vec3(2.2)) : vec3(0.12);

  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(uTilt.x), sin(uTilt.x), 0.0, -sin(uTilt.x), cos(uTilt.x));
  mat3 ry = mat3(cos(uTilt.y), 0.0, -sin(uTilt.y), 0.0, 1.0, 0.0, sin(uTilt.y), 0.0, cos(uTilt.y));
  mat3 turn = rx * ry;
  vec3 world = turn * vec3(p - center, 0.0);
  vec3 view = normalize(transpose(turn) * (vec3(0.0, 0.0, uDistance) - world));
  vec3 lamp = vec3((uLight - 0.5) * vec2(1.1, 1.1 * uAspect), 0.9);
  vec3 light = normalize(transpose(turn) * (lamp - world));
  vec3 halfway = normalize(light + view);
  vec2 sweep = light.xy + view.xy;
  float sheen = pow(max(halfway.z, 0.0), 10.0);
  float shine = pow(max(halfway.z, 0.0), 80.0);
  float frame = 1.0 - smoothstep(uFrame - pixel, uFrame + pixel, -outside);

  Foil f;
  if (uPreset == 0) f = bursts(p);
  else if (uPreset == 1) f = stars(p);
  else if (uPreset == 2) f = shards(p);
  else if (uPreset == 3) f = cosmos(p);
  else if (uPreset == 4) f = rainbow(p);
  else if (uPreset == 5) f = swirl(p);
  else if (uPreset == 6) f = glitter(p);
  else f = gold(p);

  vec3 metal = uPreset == 7 ? vec3(1.0, 0.74, 0.38) * dot(uFoil, vec3(0.3333)) * 1.15 : uFoil;
  vec4 look = uPreset == 0 ? vec4(0.25, 1.9, 0.12, 1.0)
    : uPreset == 1 ? vec4(0.6, 1.4, 0.3, 1.0)
    : uPreset == 2 ? vec4(0.9, 0.9, 0.6, 0.5)
    : uPreset == 3 ? vec4(0.7, 1.2, 0.35, 0.85)
    : uPreset == 4 ? vec4(0.0, 2.2, 0.0, 0.45)
    : uPreset == 5 ? vec4(1.6, 0.3, 0.0, 0.4)
    : uPreset == 6 ? vec4(0.9, 1.0, 0.6, 1.0)
    : vec4(0.3, 1.0, 0.2, 0.95);
  vec2 dir = vec2(cos(f.angle), sin(f.angle));
  float phase = dot(sweep, dir) * look.x + dot(sweep, vec2(0.8, 0.6)) * look.y + f.jitter * look.z;
  float spoke = 1.0;
  if (uPreset == 5) {
    float facing = dot(normalize(sweep + 0.0001), dir);
    phase = f.jitter * 2.4 + facing * 0.6 + length(sweep) * 0.8;
    spoke = 0.3 + 0.7 * smoothstep(0.25, 0.95, abs(facing));
  }
  vec3 tint = hue(phase);
  if (uPreset == 7) tint = mix(tint, metal, 0.65);
  float glint = pow(max(dot(normalize(vec3(f.facet, 1.0)), halfway), 0.0), 24.0) * step(0.001, length(f.facet));
  bool layered = uPreset == 2 || uPreset == 4 || uPreset == 5 || uPreset == 7;
  vec3 foil = (layered ? tint : mix(tint, vec3(1.0), 0.12)) * (1.15 + 0.3 * sheen) + metal * glint * 1.2;
  float tilted = smoothstep(0.02, 0.21, length(sin(uTilt)));
  float awake = mix(0.2, 1.0, tilted);
  float strength = uIntensity * f.mask * (1.0 - frame) * awake;
  float band = uPreset == 5 ? spoke : layered ? 0.25 + 0.75 * smoothstep(0.3, 0.95, 0.5 + 0.5 * cos(phase * TAU * 0.5 + 1.3)) : 1.0;
  vec3 color = layered
    ? 1.0 - (1.0 - art) * (1.0 - clamp(foil * look.w * band * strength, 0.0, 1.0))
    : mix(art, foil, clamp(strength * look.w, 0.0, 1.0));
  color += sparkles(p, halfway, sweep, mix(0.55, 1.0, tilted)) * uEdge * frame;
  color += uFoil * sheen * 0.12 * frame;
  color += vec3(sheen * 0.07 + shine * 0.3) * uGlare;
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));
  outColor = vec4(color * alpha, alpha);
}
`;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const callSafe = (fn, value) => {
    if (typeof fn !== 'function') return;
    try { fn(value); } catch (_) { /* 回调出错不影响材质本身 */ }
  };

  /* 与 ReactBits 一致：用 canvas 2d 解析任意 CSS 颜色，并转成线性空间。 */
  const parseColor = value => {
    const fallback = [0.78, 0.8, 0.84];
    if (typeof document === 'undefined') return fallback;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = value;
    const resolved = ctx.fillStyle;
    if (!resolved.startsWith('#') || resolved.length !== 7) return fallback;
    return [1, 3, 5].map(i => Math.pow(parseInt(resolved.slice(i, i + 2), 16) / 255, 2.2));
  };

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  const presetIndex = value => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return clamp(Math.floor(value), 0, PRESETS.length - 1);
    }
    const index = PRESETS.indexOf(String(value || '').toLowerCase());
    return index < 0 ? 0 : index;
  };

  function mount(faceEl, imgEl, options) {
    if (!faceEl || !imgEl || typeof window === 'undefined' || typeof document === 'undefined') {
      return null;
    }

    const opts = options || {};
    const unavailable = reason => callSafe(opts.onUnavailable, reason);

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');

    let gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false
      });
    } catch (_) {
      gl = null;
    }
    if (!gl) {
      unavailable('webgl2');
      return null;
    }

    const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      unavailable('compile');
      return null;
    }

    let program = gl.createProgram();
    if (!program) {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      unavailable('compile');
      return null;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      program = null;
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      unavailable('compile');
      return null;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

    const uniforms = {};
    for (const name of [
      'uArt',
      'uSize',
      'uAspect',
      'uArtRatio',
      'uCardRatio',
      'uTilt',
      'uLight',
      'uDistance',
      'uPreset',
      'uIntensity',
      'uScale',
      'uEdge',
      'uFrame',
      'uRadius',
      'uGlare',
      'uFoil',
      'uReady'
    ]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    /* 外壳给的 .hc-face：canvas 绝对定位铺满，pointer-events 关掉。 */
    canvas.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:block',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.3s ease'
    ].join(';') + ';';
    faceEl.appendChild(canvas);

    const previousTransform = faceEl.style.transform;

    const perspective = Math.max(1, num(opts.perspective, DEFAULT_PERSPECTIVE));
    const settings = {
      preset: presetIndex(opts.preset === undefined ? 'bursts' : opts.preset),
      intensity: clamp(num(opts.intensity, 0.85), 0, 1),
      scale: clamp(num(opts.scale, 1), 0.25, 4),
      edgeSparkle: clamp(num(opts.edgeSparkle, 0.8), 0, 1),
      frame: clamp(num(opts.frame, 4), 0, 20) / 100,
      glare: clamp(num(opts.glare, 0.5), 0, 1),
      foil: parseColor(opts.foilColor || '#e2e6ec'),
      radius: Math.max(0, num(opts.radius, 14)),
      tiltMax: clamp(num(opts.tiltMax, 14), 0, 45),
      hoverScale: clamp(num(opts.hoverScale, 1.04), 0.8, 1.3),
      idle: opts.idle !== false
    };

    /* 与 ReactBits 完全相同的弹簧状态。没有翻面（大卡只有正面）。 */
    const state = {
      tiltX: 0,
      tiltY: 0,
      tiltVX: 0,
      tiltVY: 0,
      lightX: 0.36,
      lightY: 0.26,
      lightVX: 0,
      lightVY: 0,
      lift: 1,
      liftV: 0,
      turn: 0,
      turnV: 0,
      clock: Math.random() * 40
    };
    const pointer = { x: 0.5, y: 0.5, inside: false };

    const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduce = Boolean(media && media.matches);
    let destroyed = false;
    let syncFailed = false;
    let raf = 0;
    let last = 0;
    let calm = 0;
    let visible = true;
    let textureReady = false;
    let artWidth = 0;
    let artHeight = 0;
    let pendingLoad = null;
    let pendingError = null;
    let resizeObserver = null;
    let intersectionObserver = null;

    const cssWidth = () => canvas.clientWidth || faceEl.clientWidth || 1;
    const cssHeight = () => canvas.clientHeight || faceEl.clientHeight || 1;

    const draw = () => {
      if (destroyed || !gl || !program) return;
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;
      const cardWidth = cssWidth();
      const cardRatio = cardWidth / cssHeight();
      const artRatio = textureReady && artWidth && artHeight ? artWidth / artHeight : cardRatio;

      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.uArt, 0);
      gl.uniform2f(uniforms.uSize, w, h);
      gl.uniform1f(uniforms.uAspect, h / w);
      gl.uniform1f(uniforms.uArtRatio, artRatio);
      gl.uniform1f(uniforms.uCardRatio, cardRatio);
      gl.uniform2f(
        uniforms.uTilt,
        (state.tiltX * Math.PI) / 180,
        ((state.tiltY + state.turn) * Math.PI) / 180
      );
      gl.uniform2f(uniforms.uLight, state.lightX, state.lightY);
      gl.uniform1f(uniforms.uDistance, perspective / Math.max(1, cardWidth));
      gl.uniform1i(uniforms.uPreset, settings.preset);
      gl.uniform1f(uniforms.uIntensity, settings.intensity);
      gl.uniform1f(uniforms.uScale, settings.scale);
      gl.uniform1f(uniforms.uEdge, settings.edgeSparkle);
      gl.uniform1f(uniforms.uFrame, settings.frame);
      gl.uniform1f(uniforms.uRadius, settings.radius / Math.max(1, cardWidth));
      gl.uniform1f(uniforms.uGlare, settings.glare);
      gl.uniform3f(uniforms.uFoil, settings.foil[0], settings.foil[1], settings.foil[2]);
      gl.uniform1f(uniforms.uReady, textureReady ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const spring = (value, velocity, target, stiffness, damping, dt) => {
      const next = velocity + ((target - value) * stiffness - velocity * damping) * dt;
      return [value + next * dt, next];
    };

    const applyTransform = () => {
      faceEl.style.transform =
        `perspective(${perspective}px) scale(${state.lift}) ` +
        `rotateX(${state.tiltX}deg) rotateY(${state.tiltY + state.turn}deg)`;
    };

    const tick = now => {
      raf = 0;
      if (destroyed || reduce || document.hidden || !visible) return;

      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
      last = now;

      let targetX = 0;
      let targetY = 0;
      let lightX = 0.36;
      let lightY = 0.26;
      let lift = 1;
      const drifting = settings.idle && !pointer.inside;

      if (pointer.inside) {
        targetX = (0.5 - pointer.y) * 2 * settings.tiltMax;
        targetY = (pointer.x - 0.5) * 2 * settings.tiltMax;
        lightX = pointer.x;
        lightY = pointer.y;
        lift = settings.hoverScale;
      } else if (drifting) {
        state.clock += dt;
        const t = state.clock;
        targetX = Math.sin(t * 0.7) * settings.tiltMax * 0.28;
        targetY = Math.sin(t * 0.53 + 1.2) * settings.tiltMax * 0.4;
        lightX = 0.5 + Math.sin(t * 0.41) * 0.42;
        lightY = 0.38 + Math.sin(t * 0.33 + 0.6) * 0.3;
      }

      /* 240Hz 子步积分，参数与 ReactBits 一致。
         倾斜 150/16、光位 220/30、放大 320/30。 */
      const steps = Math.ceil(dt / (1 / 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        [state.tiltX, state.tiltVX] = spring(state.tiltX, state.tiltVX, targetX, 150, 16, h);
        [state.tiltY, state.tiltVY] = spring(state.tiltY, state.tiltVY, targetY, 150, 16, h);
        [state.lightX, state.lightVX] = spring(state.lightX, state.lightVX, lightX, 220, 30, h);
        [state.lightY, state.lightVY] = spring(state.lightY, state.lightVY, lightY, 220, 30, h);
        [state.lift, state.liftV] = spring(state.lift, state.liftV, lift, 320, 30, h);
        /* 原版的翻面弹簧 k=170 / c=20。专注大卡没有背面，turn 恒为 0；
           保留这条积分是为了以后要加背面时不用再改状态机。 */
        [state.turn, state.turnV] = spring(state.turn, state.turnV, 0, 170, 20, h);
      }

      applyTransform();
      draw();

      const motion =
        Math.abs(state.tiltVX) +
        Math.abs(state.tiltVY) +
        Math.abs(state.liftV) * 40 +
        Math.abs(state.turnV) +
        (Math.abs(state.lightVX) + Math.abs(state.lightVY)) * 60 +
        Math.abs(state.tiltX - targetX) +
        Math.abs(state.tiltY - targetY);
      calm = motion > 0.02 ? 0 : calm + dt;

      /* 没有 idle、指针也不在卡上、弹簧已经停了 0.3s → 不再申请下一帧。 */
      if (!drifting && !pointer.inside && calm > 0.3) return;
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (destroyed) return;
      if (reduce) {
        draw();
        return;
      }
      if (raf || document.hidden || !visible) return;
      calm = 0;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      if (destroyed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(cssWidth() * dpr));
      const h = Math.max(1, Math.round(cssHeight() * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      draw();
      wake();
    };

    const upload = image => {
      if (destroyed || !gl) return false;
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
      } catch (_) {
        textureReady = false;
        return false;
      }
      artWidth = image.naturalWidth || image.width || 0;
      artHeight = image.naturalHeight || image.height || 0;
      textureReady = true;
      canvas.style.opacity = '1';
      draw();
      wake();
      return true;
    };

    const failAsync = reason => {
      if (destroyed) return;
      destroy();
      /* 外壳用 .has-shader 收起 CSS 近似；异步失败时把它退回去，
         否则 canvas 没了、CSS 膜也藏着，卡面会变成一张死图。 */
      try { faceEl.classList.remove('has-shader'); } catch (_) { /* noop */ }
      unavailable(reason);
    };

    const reloadWithCors = (src, done) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => { if (!destroyed) done(upload(image)); };
      image.onerror = () => { if (!destroyed) done(false); };
      image.src = src;
    };

    const startTexture = () => {
      if (destroyed) return;
      const src = imgEl.currentSrc || imgEl.src;
      if (!src) {
        failAsync('texture');
        return;
      }
      /* 外壳保证通常在 load 之后才 mount；直接上传卡面 <img>。
         万一它还没 load 完，只监听一次 load。 */
      if (imgEl.complete && imgEl.naturalWidth) {
        /* 外壳承诺通常在 load 之后才 mount：这里同步上传。失败（画布污染 /
         texImage2D 抛 SECURITY_ERR / GL 错）就按约定让 mount() 返回 null。 */
        if (!upload(imgEl)) {
          syncFailed = true;
          failAsync('texture');
        }
        return;
      }
      if (imgEl.complete) {
        /* 已经 complete 却没有自然尺寸：这张图加载失败了，让外壳保留空态。 */
        syncFailed = true;
        failAsync('texture');
        return;
      }
      pendingLoad = () => {
        imgEl.removeEventListener('load', pendingLoad);
        imgEl.removeEventListener('error', pendingError);
        pendingLoad = null;
        pendingError = null;
        if (destroyed) return;
        if (!upload(imgEl)) {
          reloadWithCors(src, ok => { if (!ok) failAsync('texture'); });
        }
      };
      pendingError = () => {
        imgEl.removeEventListener('load', pendingLoad);
        imgEl.removeEventListener('error', pendingError);
        pendingLoad = null;
        pendingError = null;
        failAsync('texture');
      };
      imgEl.addEventListener('load', pendingLoad);
      imgEl.addEventListener('error', pendingError);
    };

    const apply = () => {
      if (destroyed) return;
      if (reduce) draw();
      else wake();
    };

    const card = (faceEl.closest && faceEl.closest('.hc-card')) || faceEl;

    const track = event => {
      if (destroyed || reduce) return;
      /* 触摸设备手指没按下时（没有 hover）忽略，避免点一下卡就粘住。 */
      if (event.pointerType === 'touch' && !event.buttons) return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      pointer.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      pointer.inside = true;
      wake();
    };

    const leave = () => {
      if (destroyed) return;
      pointer.inside = false;
      if (reduce) return;
      wake();
    };

    card.addEventListener('pointerenter', track);
    card.addEventListener('pointermove', track);
    card.addEventListener('pointerdown', track);
    card.addEventListener('pointerleave', leave);
    card.addEventListener('pointercancel', leave);

    const onVisibility = () => {
      if (destroyed) return;
      if (document.hidden) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      } else {
        wake();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotionChange = () => {
      if (destroyed) return;
      reduce = Boolean(media && media.matches);
      if (reduce) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        pointer.inside = false;
        state.tiltX = 0;
        state.tiltY = 0;
        state.tiltVX = 0;
        state.tiltVY = 0;
        state.lift = 1;
        state.liftV = 0;
        state.lightX = 0.36;
        state.lightY = 0.26;
        state.lightVX = 0;
        state.lightVY = 0;
        state.turn = 0;
        state.turnV = 0;
        faceEl.style.transform = previousTransform;
        draw();
      } else {
        wake();
      }
    };
    if (media) {
      if (media.addEventListener) media.addEventListener('change', onMotionChange);
      else if (media.addListener) media.addListener(onMotionChange);
    }

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    if (window.IntersectionObserver) {
      intersectionObserver = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible) {
          wake();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      });
      intersectionObserver.observe(faceEl);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', resize);
      if (intersectionObserver) intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (media) {
        if (media.removeEventListener) media.removeEventListener('change', onMotionChange);
        else if (media.removeListener) media.removeListener(onMotionChange);
      }
      card.removeEventListener('pointerenter', track);
      card.removeEventListener('pointermove', track);
      card.removeEventListener('pointerdown', track);
      card.removeEventListener('pointerleave', leave);
      card.removeEventListener('pointercancel', leave);
      if (pendingLoad) {
        imgEl.removeEventListener('load', pendingLoad);
        pendingLoad = null;
      }
      if (pendingError) {
        imgEl.removeEventListener('error', pendingError);
        pendingError = null;
      }
      faceEl.style.transform = previousTransform;
      if (gl) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    resize();
    startTexture();
    /* 图片在 mount 时就绪、却同步上传失败 → 已清理干净，直接返回 null。 */
    if (syncFailed) return null;

    return {
      canvas,
      setPreset(value) {
        settings.preset = presetIndex(value);
        apply();
      },
      setIntensity(value) {
        settings.intensity = clamp(num(value, settings.intensity), 0, 1);
        apply();
      },
      setGlare(value) {
        settings.glare = clamp(num(value, settings.glare), 0, 1);
        apply();
      },
      setEdgeSparkle(value) {
        settings.edgeSparkle = clamp(num(value, settings.edgeSparkle), 0, 1);
        apply();
      },
      setRadius(value) {
        settings.radius = Math.max(0, num(value, settings.radius));
        apply();
      },
      setTiltMax(value) {
        settings.tiltMax = clamp(num(value, settings.tiltMax), 0, 45);
        apply();
      },
      setHoverScale(value) {
        settings.hoverScale = clamp(num(value, settings.hoverScale), 0.8, 1.3);
        apply();
      },
      setScale(value) {
        settings.scale = clamp(num(value, settings.scale), 0.25, 4);
        apply();
      },
      setFoilColor(value) {
        settings.foil = parseColor(value || '#e2e6ec');
        apply();
      },
      setIdle(value) {
        settings.idle = Boolean(value);
        apply();
      },
      wake,
      destroy,
      get ready() {
        return textureReady && !destroyed;
      },
      get preset() {
        return PRESETS[settings.preset];
      }
    };
  }

  return { mount, PRESETS };
})();
