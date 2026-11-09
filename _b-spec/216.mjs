export default {
  num: '216', slug: 'lava-crack', title: '熔岩裂隙',
  accent: [1.0, 0.52, 0.16],
  fibers: false, motes: false, plateBlend: 'lighter', plateAlpha: 0.86,
  doc: `   216 · 熔岩裂隙 —— 字是冷却的岩壳上被烧穿的一道缝，缝底是还在流的熔岩

   机制一句话：
     壳是黑的（玄武岩：低频起伏 + 龟裂纹），字是**穿过壳的裂缝**：缝里是熔岩通道，
     亮度随句龄**冷却**（炽白 → 橙 → 暗红），通道里的流纹在缓慢蠕动，缝缘把壳烧成
     一圈炭黑的焦边 + 橙红的余热 —— 字不是被照亮的，是自己的温度在发光。

   和前作的区别：
     lizi17 是熔岩流过（流动的液面）、lizi84 是熔炉（火与热浪）、lizi42 是激光烧蚀；
     这里是**壳 vs 缝**的对照：壳几乎全黑、只有龟裂纹和字缝在发光，热是"从里面透出来"。

   冷却曲线：换句时 u_st 把温度推满，之后按句龄衰减（壳长回去一点，缝变暗）。`,
  fs: [
    'precision highp float;',
    'uniform vec2 u_res;',
    'uniform float u_t;',
    'uniform float u_rm;',
    'uniform sampler2D u_g;',
    'uniform vec2 u_gc;',
    'uniform vec2 u_gh;',
    'uniform float u_gk;',
    'uniform float u_st;',
    'uniform float u_front;',
    'uniform float u_kick;',
    'uniform vec3 u_ac;',
    'uniform float u_epx;',

    'float h21(vec2 p){ p = fract(p*vec2(127.11,311.7)); p += dot(p,p+34.53); return fract(p.x*p.y); }',
    'float vn(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f*f*(3.0-2.0*f);',
    '  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),u.x), mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),u.x), u.y);',
    '}',
    'float gsd(vec2 uv){',
    '  vec2 tc = vec2(0.5 + (uv.x-u_gc.x)/(2.0*u_gh.x), 0.5 - (uv.y-u_gc.y)/(2.0*u_gh.y));',
    '  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 127.0*u_gk;',
    '  return (texture2D(u_g, tc).r*255.0 - 128.0) * u_gk;',
    '}',
    /* 龟裂纹：两级 Voronoi 的边（F2-F1 最小的地方就是缝） */
    'float crack(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float d1 = 8.0, d2 = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g + 1.7), h21(ip + g + 5.3));',
    '      float d = length(g + o - fp);',
    '      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }',
    '    }',
    '  }',
    '  return d2 - d1;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float sd = gsd(uv);',
    /* 温度：换句时最热，之后缓慢冷却（u_st 从 1 开始衰减到 0.35） */
    '  float heat = 0.30 + 0.70*(1.0 - smoothstep(0.0, 1.0, (1.0-u_st)));',
    '  heat = 0.34 + 0.66*u_st;',
    '  float chan = 1.0 - smoothstep(-u_epx*2.0, u_epx*2.0, sd);',
    /* 壳：低频起伏 + 焦黑 */
    '  float rock = vn(uv*7.0 + 3.0)*0.6 + vn(uv*17.0 - 1.0)*0.4;',
    '  float grain = vn(uv*70.0)*0.5 + vn(uv*160.0)*0.5;',
    '  vec3 crust = vec3(0.030,0.025,0.023) + vec3(0.055,0.045,0.040)*rock + vec3(0.016,0.012,0.010)*grain;',
    /* 龟裂纹：暗缝里透一点点橙（壳还很薄的地方） */
    '  float bounce0 = 0.0;',
    '  float c1 = crack(uv*5.5 + 2.0);',
    '  float c2 = crack(uv*11.0 - 4.0);',
    '  float crk = smoothstep(0.16, 0.0, c1) + 0.7*smoothstep(0.12, 0.0, c2);',
    '  crust *= 1.0 - 0.62*clamp(crk,0.0,1.0);',
    '  crust += vec3(0.55,0.13,0.02)*clamp(crk,0.0,1.0)*(0.03 + 0.20*bounce0)*heat;',
    /* 缝缘：炭黑的焦边 + 橙的余热 */
    '  float burned = exp(-pow(max(sd,0.0)/(u_epx*9.0), 2.0));',
    '  crust *= 1.0 - 0.75*burned;',
    '  float halo = exp(-pow(max(sd,0.0)/(u_epx*5.0), 2.0));',
    '  float bounce = exp(-pow(max(sd,0.0)/(u_epx*16.0), 2.0));',
    '  crust += vec3(0.55,0.16,0.03)*bounce*0.22*heat;',
    /* 缝里的熔岩：流纹 + 通道中心最热 */
    '  float flow = vn(vec2(uv.x*9.0 - t*0.18, uv.y*22.0 + sin(uv.x*6.0 + t*0.5)*1.4));',
    '  float flow2 = vn(vec2(uv.x*21.0 + t*0.10, uv.y*46.0 - t*0.22));',
    '  float core = 1.0 - smoothstep(0.0, u_epx*3.0, abs(sd));',
    '  vec3 hot = mix(vec3(0.70,0.10,0.02), vec3(1.00,0.42,0.06), clamp(flow*1.3,0.0,1.0));',
    '  hot = mix(hot, vec3(1.00,0.86,0.52), clamp(core*0.85 + flow2*0.35 - 0.20, 0.0, 1.0));',
    '  hot *= 0.55 + 1.25*heat;',
    /* 已经唱到的那一段：温度更高、更白 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  hot += vec3(0.55,0.34,0.12)*litFront*0.35;',
    '  vec3 col = crust;',
    '  col += hot*chan;',
    '  col += hot*halo*0.55;',
    '  float lip = smoothstep(-u_epx*5.0, -u_epx*0.8, sd)*chan;',
    '  col *= 1.0 - 0.55*lip;',
    '  col += vec3(0.35,0.06,0.01)*burned*0.30*heat;',
    /* 缝底的黑：真正的开口处比两边深（有厚度） */
    '  col *= 1.0 - 0.25*chan*(1.0 - core);',
    /* 环境 */
    '  vec2 q = uv - u_gc;',
    '  float pool = exp(-(q.x*q.x*0.22 + q.y*q.y*1.15));',
    '  col += vec3(0.20,0.05,0.01)*pool*0.35*heat;',
    '  float vig = 1.0 - smoothstep(0.22, 1.48, length(uv*vec2(0.62,0.88)));',
    '  col *= 0.38 + 0.62*vig;',
    '  col *= 1.0 + 0.09*u_kick;',
    '  col = 1.0 - exp(-col*1.30);',
    '  col += (h21(gl_FragCoord.xy*0.8 + 9.0) - 0.5)*0.014;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 熔岩芯：白热 → 橙 → 暗红，带流纹；用 lighter 叠在缝里，glow 由着色器补 */
  const grad = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  grad.addColorStop(0, '#fff0c8');
  grad.addColorStop(0.30, '#ffc061');
  grad.addColorStop(0.62, '#ff7a1e');
  grad.addColorStop(0.86, '#c03c06');
  grad.addColorStop(1, '#7a1f02');
  g.fillStyle = grad;
  g.fillText(L.text, cx, cy);

  /* 流纹：横向慢速拉长的亮带（熔岩在缝里淌） */
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let y = 0; y < ph; y += 4) {
    const a = 0.06 + 0.16 * (0.5 + 0.5 * Math.sin(y * 0.7 + 2.0));
    g.fillStyle = 'rgba(255,238,190,' + a.toFixed(3) + ')';
    g.fillRect(0, y, pw, 1.4);
    g.fillStyle = 'rgba(90,12,0,' + (a * 0.8).toFixed(3) + ')';
    g.fillRect(0, y + 2.2, pw, 1.2);
  }
  /* 缝心更白：中间一条热芯 */
  const core = g.createLinearGradient(0, cy - fs * 0.30, 0, cy + fs * 0.30);
  core.addColorStop(0, 'rgba(255,255,235,0)');
  core.addColorStop(0.5, 'rgba(255,252,225,0.42)');
  core.addColorStop(1, 'rgba(255,255,235,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: `  /* 缝里溅出来的余烬：受 T 驱动，暂停即冻 */
  if (hasLine) {
    ctx.globalCompositeOperation = 'lighter';
    const N = 44;
    for (let i = 0; i < N; i++) {
      const sp = rm ? 0.25 : 1;
      const life = 2.4;
      const tt = (((T * 0.6 * sp + i * 0.317) % life) / life);
      const px = W * (0.16 + ((i * 0.618) % 1) * 0.68) + Math.sin(T * 0.9 + i * 1.7) * 22 - tt * 26;
      const py = H * (0.56 - tt * 0.30) + Math.cos(T * 1.2 + i * 2.1) * 12;
      const a = (1 - tt) * (1 - tt) * (0.22 + 0.30 * (0.5 + 0.5 * Math.sin(T * 5.0 + i)));
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = i % 7 === 0 ? 'rgba(255,240,200,1)' : 'rgba(255,140,40,1)';
      const s = 1 + (i % 3) * 0.8;
      ctx.fillRect(px, py, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }`
};
