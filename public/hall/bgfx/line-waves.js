/**
 * LineWaves（ReactBits 背景）→ 原生 JS 版（2026-11-08）
 * 来源：https://www.reactbits.dev/backgrounds/line-waves
 *
 * 用法：
 *   const fx = window.LiziLineWaves.mount(el, {
 *     colors: ['#ffffff', '#ffffff', '#ffffff'], // → uColor1 / uColor2 / uColor3
 *     speed: 0.3, quality: 1, interactive: true,
 *     dpr: Math.min(devicePixelRatio, 1.5), paused: false,
 *   });
 *   fx.setColors(['#ffd9a0', '#ffb45e', '#fff0d6']); // 只换调色板，不重建 GL
 *   fx.setPaused(true);                              // 暂停 / 继续 rAF
 *   fx.destroy();                                    // 摘监听、删 GL、移除 canvas
 *
 * 和原版的差别只在宿主：React 的 useEffect/useRef/props 换成普通 mount 闭包，
 * 着色器、uniform 语义、渲染管线、鼠标透镜 / 点击涟漪状态机照原版 1:1 搬。
 * 默认值取自 LineWaves.preset.js 的 LOOK（其余取组件默认值）。
 * WebGL2 或着色器不可用时返回 null，容器保持原样。
 */
(() => {
  const PIXEL_BUDGET = 2.4e6;
  const MAX_RIPPLES = 4;
  const DPR_CAP = 1.5;

  const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uPixel;
uniform float uTime;
uniform float uLines;
uniform float uWidth;
uniform float uGlow;
uniform float uBrightness;
uniform float uHighlight;
uniform float uHighlightWidth;
uniform float uWarp;
uniform float uScale;
uniform float uRotation;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uCycle;
uniform float uEdge;
uniform vec4 uMouse;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform float uReveal;
uniform float uLight;
uniform float uOpacity;
out vec4 fragColor;

vec2 rotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float bend(vec2 p, float t) {
  vec2 q = p * 2.0 / uScale;
  float w = 0.6 * sin(q.x * 0.55 + t * 0.4 + 0.6 * sin(q.y * 0.9 - t * 0.28));
  w += 0.21 * sin(q.x * 1.3 - t * 0.33 + q.y * 0.8 + 1.3);
  w += 0.12 * sin(q.y * 2.3 + q.x * 0.9 - t * 0.37 + 0.4);
  return w * uWarp * uScale * 0.46;
}

float river(vec2 p, float y, float t) {
  float drift = 0.7 * (0.18 * sin(p.x * 1.6 - t * 0.33 + 0.7) + 0.1 * sin(p.x * 3.1 + t * 0.21));
  float center = 0.5 * (0.2 * sin(t * 0.17) + 0.08 * sin(t * 0.29 + 1.3));
  float width = 0.13 * uHighlightWidth;
  float near = (y - center - drift) / width;
  float far = (y + 0.22 * sin(t * 0.13 + 2.0) - drift * 0.6 + 0.3) / (width * 0.55);
  return max(exp(-near * near), exp(-far * far) * 0.7);
}

vec3 palette(float x) {
  x = fract(x) * 3.0;
  if (x < 1.0) return mix(uColor1, uColor2, smoothstep(0.0, 1.0, x));
  if (x < 2.0) return mix(uColor2, uColor3, smoothstep(1.0, 2.0, x));
  return mix(uColor3, uColor1, smoothstep(2.0, 3.0, x));
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = rotate((gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y, uRotation);
  float t = uTime;

  vec2 mouse = rotate(uMouse.xy, uRotation);
  vec2 toMouse = p - mouse;
  float lens = exp(-dot(toMouse, toMouse) / (uMouse.w * uMouse.w));
  p.y -= (p.y - mouse.y) * lens * uMouse.z;

  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 ripple = uRipples[i];
    if (ripple.w <= 0.0) continue;
    float x = (length(p - rotate(ripple.xy, uRotation)) - ripple.z * 0.6) / 0.08;
    float fade = exp(-ripple.z * 1.3) * smoothstep(0.0, 0.12, ripple.z);
    float bump = exp(-x * x);
    p.y -= x * bump * 0.07 * fade;
    ring += bump * fade;
  }

  float w = bend(p, t);
  float y = p.y + w;
  float phi = y * uLines;
  float fw = max(fwidth(phi), 1e-5);
  float crowd = smoothstep(0.18, 0.5, fw);

  float fold = smoothstep(1.3, 2.2, fw * uResolution.y / uLines);
  float shimmer = mix(1.0, smoothstep(0.15, 0.85, noise(vec2(y * 1.6 + t * 0.07, p.x * 0.55 - t * 0.22))), 0.5);
  float lit = max(river(p, y, t), fold * 0.9) * shimmer;
  float light = mix(1.0, 0.07 + 0.93 * lit, uHighlight);
  light += (1.0 - light) * min(lens * step(0.0001, uMouse.z) * 0.9 + ring * 0.6, 1.0);

  float dist = abs(fract(phi + 0.5) - 0.5) / fw;
  float width = uWidth * uPixel * (1.0 + mix(1.5, 0.6, uLight) * lit * uHighlight);
  float cover = clamp(min(dist + width * 0.5, 0.5) - max(dist - width * 0.5, -0.5), 0.0, 1.0);
  cover = mix(cover, min(width * fw, 1.0), crowd);
  float halo = exp(-dist / (2.2 * uPixel)) * (1.0 - crowd) * uGlow;
  float thread = mix(1.0, 0.55 + 0.45 * hash(vec2(floor(phi + 0.5), 7.3)), 0.45 * (1.0 - crowd));

  float span = 0.5 * sqrt(aspect * aspect + 1.0);
  float sweep = -span + (2.0 * span + 0.6) * uReveal;
  float reveal = 1.0 - smoothstep(sweep - 0.6, sweep, p.x);

  float edge = 1.0;
  if (uEdge > 0.0) {
    float ex = min(uv.x, 1.0 - uv.x) * aspect;
    float ey = min(uv.y, 1.0 - uv.y);
    edge = smootherstep(0.0, uEdge * 0.5, ex) * smootherstep(0.0, uEdge * 0.5, ey);
  }

  vec3 tint = palette(y * 0.3 + p.x * 0.2 + uCycle);
  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

  if (uLight > 0.5) {
    float low = min(tint.r, min(tint.g, tint.b));
    float chroma = max(tint.r, max(tint.g, tint.b)) - low;
    vec3 hue = (tint - low) / max(chroma, 1e-3);
    vec3 ink = mix(vec3(0.08), hue * 0.56 + 0.06, smoothstep(0.04, 0.2, chroma));
    float alpha = (cover + halo * 0.35) * thread * light * uBrightness * reveal * edge * 0.78 * uOpacity;
    alpha = clamp(alpha + grain, 0.0, 1.0);
    fragColor = vec4(ink * alpha, alpha);
    return;
  }

  float strength = (cover + halo) * thread * light * uBrightness * reveal * edge;
  vec3 color = clamp(tint * strength * uOpacity, 0.0, 1.0);
  float alpha = max(color.r, max(color.g, color.b));
  color = clamp(color + grain, 0.0, 1.0);
  fragColor = vec4(min(color, vec3(alpha)), alpha);
}`;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const parseColor = (value) => {
    const text = String(value || '').trim();
    const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      const full = hex[1].length === 3 ? hex[1].replace(/./g, (digit) => digit + digit) : hex[1];
      return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
    }
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    if (rgb) return [rgb[1], rgb[2], rgb[3]].map((channel) => clamp(parseFloat(channel) / 255, 0, 1));
    return [1, 1, 1];
  };

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const link = (gl) => {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (!vertex || !fragment || !program) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index++) {
      const info = gl.getActiveUniform(program, index);
      if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  };

  // 默认值：LineWaves.preset.js 的 LOOK + 组件自身默认值
  const DEFAULTS = {
    color1: '#ffffff',
    color2: '#ffffff',
    color3: '#ffffff',
    colorCycleSpeed: 1,
    speed: 0.3,
    lineCount: 72,
    lineWidth: 1.3,
    glow: 0.6,
    brightness: 1,
    highlight: 1,
    highlightWidth: 1,
    warpIntensity: 1,
    warpScale: 1,
    rotation: -33,
    edgeFade: 0,
    enableMouseInteraction: true,
    mouseInfluence: 2,
    clickRipple: true,
    intro: true,
    lightMode: false,
    opacity: 1,
  };

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function mount(container, options) {
    if (!container || container.__liziLineWaves) return null;

    const source = options || {};
    const opts = Object.assign({}, DEFAULTS, {
      colors: null,
      quality: 1,
      dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
      paused: false,
    }, source);

    const palette = Array.isArray(opts.colors) && opts.colors.length ? opts.colors : null;
    const color1 = palette ? (palette[0] ?? DEFAULTS.color1) : opts.color1;
    const color2 = palette ? (palette[1] ?? palette[0] ?? DEFAULTS.color2) : opts.color2;
    const color3 = palette ? (palette[2] ?? palette[1] ?? palette[0] ?? DEFAULTS.color3) : opts.color3;
    const interactive = hasOwn(source, 'interactive')
      ? !!source.interactive
      : opts.enableMouseInteraction !== false;

    const settings = {
      color1: parseColor(color1),
      color2: parseColor(color2),
      color3: parseColor(color3),
      cycleSpeed: opts.colorCycleSpeed,
      speed: Math.max(0, opts.speed),
      lines: clamp(opts.lineCount, 2, 400),
      width: clamp(opts.lineWidth, 0.25, 12),
      glow: Math.max(0, opts.glow),
      brightness: Math.max(0, opts.brightness),
      highlight: clamp(opts.highlight, 0, 1),
      highlightWidth: clamp(opts.highlightWidth, 0.2, 5),
      warp: clamp(opts.warpIntensity, 0, 3),
      scale: clamp(opts.warpScale, 0.2, 4),
      rotation: (opts.rotation * Math.PI) / 180,
      edge: clamp(opts.edgeFade, 0, 1),
      mouse: interactive,
      influence: clamp(opts.mouseInfluence, 0, 3),
      clickRipple: !!opts.clickRipple,
      intro: !!opts.intro,
      light: !!opts.lightMode,
      opacity: clamp(opts.opacity, 0, 1),
      quality: clamp(Number(opts.quality) || 1, 0.25, 1),
      dpr: Math.min(
        Number(opts.dpr) > 0 ? Number(opts.dpr) : (window.devicePixelRatio || 1),
        DPR_CAP
      ),
    };

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    let shader = gl ? link(gl) : null;
    if (!gl || !shader) return null;

    container.__liziLineWaves = true;
    container.appendChild(canvas);

    let vao = gl.createVertexArray();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = { width: 1, height: 1, ratio: 1 };
    const pointer = { x: 0, y: 0, inside: false };
    const lens = { x: 0, y: 0, presence: 0, ready: false };
    const ripples = [];
    const rippleData = new Float32Array(MAX_RIPPLES * 4);
    let time = Math.random() * 60;
    let cycle = 0;
    let paused = !!opts.paused;
    let reveal = paused ? 1 : (settings.intro && !reduced ? 0 : 1);
    let raf = 0;
    let last = 0;
    let visible = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let lost = false;
    let alive = true;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        settings.dpr,
        Math.sqrt(PIXEL_BUDGET / (cssWidth * cssHeight))
      ) * settings.quality;
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(cssHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      size.width = cssWidth;
      size.height = cssHeight;
      size.ratio = width / cssWidth;
    };

    const toField = (x, y) => [(x - size.width / 2) / size.height, (size.height / 2 - y) / size.height];

    const draw = () => {
      if (lost || !shader) return;
      const s = settings;
      const eased = 1 - Math.pow(1 - reveal, 3);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(shader.program);
      gl.bindVertexArray(vao);
      const u = shader.uniforms;
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uPixel, size.ratio);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uLines, s.lines);
      gl.uniform1f(u.uWidth, s.width);
      gl.uniform1f(u.uGlow, s.glow);
      gl.uniform1f(u.uBrightness, s.brightness);
      gl.uniform1f(u.uHighlight, s.highlight);
      gl.uniform1f(u.uHighlightWidth, s.highlightWidth);
      gl.uniform1f(u.uWarp, s.warp * (0.25 + 0.75 * eased));
      gl.uniform1f(u.uScale, s.scale);
      gl.uniform1f(u.uRotation, s.rotation);
      gl.uniform3f(u.uColor1, s.color1[0], s.color1[1], s.color1[2]);
      gl.uniform3f(u.uColor2, s.color2[0], s.color2[1], s.color2[2]);
      gl.uniform3f(u.uColor3, s.color3[0], s.color3[1], s.color3[2]);
      gl.uniform1f(u.uCycle, cycle);
      gl.uniform1f(u.uEdge, s.edge);
      gl.uniform4f(u.uMouse, lens.x, lens.y, lens.presence * s.influence * 0.16, 0.2);
      gl.uniform4fv(u.uRipples, rippleData);
      gl.uniform1f(u.uReveal, eased);
      gl.uniform1f(u.uLight, s.light ? 1 : 0);
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now) => {
      raf = 0;
      if (lost || paused || !alive) return;
      const s = settings;
      const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
      last = Math.max(last, now);
      time += dt * s.speed * 2.5 * (reduced ? 0.25 : 1);
      cycle += dt * s.speed * s.cycleSpeed * 0.05;
      if (reveal < 1) reveal = Math.min(1, reveal + dt / 1.8);

      const tracking = s.mouse && pointer.inside && !reduced;
      if (tracking) {
        const [x, y] = toField(pointer.x, pointer.y);
        if (!lens.ready) {
          lens.x = x;
          lens.y = y;
          lens.ready = true;
        }
        const follow = 1 - Math.exp(-dt * 10);
        lens.x += (x - lens.x) * follow;
        lens.y += (y - lens.y) * follow;
      }
      const presence = tracking ? 1 : 0;
      lens.presence += (presence - lens.presence) * (1 - Math.exp(-dt * 5));
      if (lens.presence < 0.002 && !tracking) lens.ready = false;

      for (let index = ripples.length - 1; index >= 0; index--) {
        ripples[index].age += dt;
        if (ripples[index].age > 2.6) ripples.splice(index, 1);
      }
      rippleData.fill(0);
      ripples.forEach((ripple, index) => {
        rippleData[index * 4] = ripple.x;
        rippleData[index * 4 + 1] = ripple.y;
        rippleData[index * 4 + 2] = ripple.age;
        rippleData[index * 4 + 3] = 1;
      });

      draw();

      const settling = Math.abs(presence - lens.presence) > 0.002;
      const busy = (s.speed > 0 && !reduced) || reveal < 1 || settling || ripples.length > 0 || tracking;
      if (busy && visible && pageVisible) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || lost || paused || !alive || !visible || !pageVisible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const locate = (event) => {
      const rect = container.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside:
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      };
    };

    const onPointerMove = (event) => {
      const spot = locate(event);
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.inside = spot.inside;
      wake();
    };
    const onPointerDown = (event) => {
      const s = settings;
      const spot = locate(event);
      if (!spot.inside || !s.clickRipple || reduced) return;
      const [x, y] = toField(spot.x, spot.y);
      ripples.push({ x, y, age: 0 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
      wake();
    };
    const onLeave = () => {
      pointer.inside = false;
      wake();
    };
    const onPointerUp = (event) => {
      if (event.pointerType !== 'mouse') onLeave();
    };

    const onLost = (event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onRestored = () => {
      if (!alive) return;
      shader = link(gl);
      if (!shader) {
        lost = true;
        return;
      }
      lost = false;
      vao = gl.createVertexArray();
      resize();
      wake();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      wake();
    });
    resizeObserver.observe(container);

    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      wake();
    });
    intersection.observe(container);

    const onVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden';
      wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    draw();
    wake();

    return {
      /** 换平台时只换调色板，不重建 WebGL 上下文 */
      setColors(list) {
        if (!Array.isArray(list) || !list.length) return;
        const c1 = list[0] ?? DEFAULTS.color1;
        const c2 = list[1] ?? c1;
        const c3 = list[2] ?? c2;
        settings.color1 = parseColor(c1);
        settings.color2 = parseColor(c2);
        settings.color3 = parseColor(c3);
        if (paused) draw();
        else wake();
      },
      /** 暂停 / 恢复 rAF */
      setPaused(value) {
        paused = !!value;
        if (paused) {
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
          last = 0;
          draw();
        } else {
          last = performance.now();
          wake();
        }
      },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        raf = 0;
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        if (!gl.isContextLost()) {
          gl.deleteVertexArray(vao);
          if (shader) gl.deleteProgram(shader.program);
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
        delete container.__liziLineWaves;
      },
    };
  }

  window.LiziLineWaves = { mount };
})();
