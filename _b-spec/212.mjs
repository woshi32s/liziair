export default {
  num: '212', slug: 'hammered-brass', title: '锤纹黄铜',
  accent: [0.86, 0.72, 0.46],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.97,
  doc: `   212 · 锤纹黄铜 —— 字是这块铜上唯一没被锤过的地方

   机制一句话：
     铜板表面是一层**锤痕**（Voronoi 球冠凹坑）+ 拉丝方向；字形区被"抛光"过 ——
     凹坑被磨平、粗糙度降到底，于是画面里唯一像镜子的地方就是字：
     两条棚灯灯带在字面上被拉成锐利的高光，而铜板上只剩散开的一点暖光。

   为什么不是换色金属（也不是 015 / lizi57）：
     015 是液态金属 + 逐粒子法线，会流；这里是**固态**：坑的球冠法线是解析算出来的
     （每个像素只查一次 Voronoi，直接用冠心方向当法线），抛光靠"高度图振幅 + 粗糙度"
     两个参数在字内归零 —— 高光走向是反射向量决定的，不是画上去的一条亮带。

   端倪：铜的色温靠反射的冷暖两条灯带撑起来，所以字的高光必然带一点冷边。`,
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
    /* 锤痕：一次 Voronoi 找最近的锤点，球冠的高度和法线一起拿到（省两次采样） */
    'vec3 hammer(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float best = 8.0;',
    '  vec2 bc = vec2(0.0);',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g), h21(ip + g + 7.31));',
    '      vec2 r = g + o - fp;',
    '      float d = dot(r, r);',
    '      if (d < best) { best = d; bc = r; }',
    '    }',
    '  }',
    '  float d = sqrt(best)/0.78;',
    '  float h = sqrt(max(0.0, 1.0 - d*d));',
    '  return vec3(bc/0.78, h);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float sd = gsd(uv);',
    /* 抛光区：字内凹坑被磨平 */
    '  float pol = 1.0 - smoothstep(-u_epx*2.2, u_epx*2.2, sd);',
    '  pol = mix(pol, 1.0, 0.0);',
    /* 锤痕的尺度：每 uv 14 个坑（≈32px 一个坑） */
    '  vec3 hm = hammer(uv*14.0 + 3.0);',
    '  float amp = mix(1.0, 0.08, pol);        /* 字内几乎磨平 */',
    /* 拉丝：沿 x 拉长的细纹，抛光区更细更直 */
    '  float brush = vn(vec2(uv.x*(3.0 + 6.0*pol), uv.y*(260.0 - 120.0*pol)));',
    '  float brush2 = vn(vec2(uv.x*6.0, uv.y*520.0));',
    '  vec2 nxy = hm.xy*amp*0.85 + vec2(0.0, (brush-0.5)*mix(0.16,0.05,pol));',
    '  nxy += vec2((brush2-0.5)*0.05, 0.0)*mix(1.0,0.4,pol);',
    /* 大尺度的铜板不平（轧制留下的起伏） */
    '  float warp = vn(uv*2.4 + 11.0) - 0.5;',
    '  nxy += vec2(warp*0.10, (vn(uv*2.9 - 4.0)-0.5)*0.10);',
    '  vec3 N = normalize(vec3(-nxy*0.55, 1.0));',
    '  vec3 V = vec3(0.0,0.0,1.0);',
    '  vec3 R = reflect(-V, N);',
    /* 棚灯：左上一条暖、右侧一条冷；抛光区反射锐利，凹坑区反射散开 */
    '  float rough = mix(0.55, 0.06, pol);',
    '  float bandW = mix(0.24, 0.045, pol);',
    '  float warmBand = smoothstep(0.62 - bandW, 0.62 + bandW, R.y*0.9 - R.x*0.55);',
    '  float coolBand = smoothstep(0.55 - bandW, 0.55 + bandW, -R.x*0.95 + R.y*0.25);',
    '  float sky = smoothstep(-0.2, 0.85, R.y);',
    '  vec3 env = vec3(0.10,0.085,0.062)*0.55;',
    '  env += vec3(1.00,0.86,0.62)*warmBand*(1.15 + 0.9*pol);',
    '  env += vec3(0.55,0.68,0.92)*coolBand*(0.45 + 0.35*pol);',
    '  env += vec3(0.30,0.26,0.20)*sky*0.30;',
    /* 铜的本色 + 氧化暗部 */
    '  vec3 brass = mix(vec3(0.62,0.44,0.20), u_ac*0.80, 0.35);',
    '  float patina = vn(uv*22.0 - 7.0);',
    '  vec3 dark = brass*0.05 + vec3(0.020,0.026,0.020)*(0.4+0.6*patina);',
    '  vec3 col = mix(dark, env*brass*1.5, mix(0.45, 0.96, pol));',
    /* 抛光面再叠一层"镜面里的高光"（比灯带更细的一条） */
    '  float sharp = pow(max(dot(N, normalize(vec3(-0.30,0.52,0.80))), 0.0), 120.0);',
    '  col += vec3(1.0,0.95,0.86)*sharp*(0.25 + 1.4*pol);',
    /* 字缘：抛光边界的一道亮线 + 外侧一道暗（锤坑的影子） */
    '  float edge = exp(-pow((sd + u_epx*1.0)/(u_epx*1.4), 2.0));',
    '  col += vec3(1.0,0.90,0.72)*edge*0.22;',
    '  float shade = exp(-pow(max(sd,0.0)/(u_epx*3.2), 2.0));',
    '  col *= 1.0 - 0.30*shade;',
    /* 已经唱过的那一段：抛光更亮、反射更硬 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += brass*litFront*pol*0.10;',
    '  col *= 1.0 + 0.06*u_kick;',
    /* 环境 */
    '  vec2 q = uv - u_gc;',
    '  float pool = exp(-(q.x*q.x*0.18 + q.y*q.y*1.15));',
    '  float vig = 1.0 - smoothstep(0.24, 1.44, length(uv*vec2(0.64,0.88)));',
    '  col *= 0.32 + 0.68*vig;',
    '  col += vec3(0.10,0.075,0.045)*pool*0.35;',
    '  col = 1.0 - exp(-col*1.65);',
    '  col += (h21(gl_FragCoord.xy*0.75 + 5.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 抛光的字：黄铜竖渐变 + 一道斜的镜面高光 + 磨平的锤坑残影 */
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#0b0703';
  g.filter = 'blur(' + (fs * 0.022).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.016, cy + fs * 0.022);
  g.filter = 'none';
  g.restore();

  const grad = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  grad.addColorStop(0.00, '#5e3f16');
  grad.addColorStop(0.10, '#c79a52');
  grad.addColorStop(0.20, '#fff4d4');
  grad.addColorStop(0.27, '#f0d091');
  grad.addColorStop(0.42, '#8e6026');
  grad.addColorStop(0.58, '#5a3a12');
  grad.addColorStop(0.70, '#e8c58a');
  grad.addColorStop(0.84, '#a97a37');
  grad.addColorStop(1.00, '#4d3413');
  g.fillStyle = grad;
  g.fillText(L.text, cx, cy);

  /* 斜向镜面高光（固定的棚灯方向：左上高光、右下暗） */
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const sp = g.createLinearGradient(0, ph, pw * 0.85, 0);
  sp.addColorStop(0.00, 'rgba(255,246,220,0)');
  sp.addColorStop(0.34, 'rgba(255,246,220,0.06)');
  sp.addColorStop(0.46, 'rgba(255,250,235,0.55)');
  sp.addColorStop(0.50, 'rgba(255,255,250,0.75)');
  sp.addColorStop(0.55, 'rgba(255,240,205,0.10)');
  sp.addColorStop(0.78, 'rgba(60,36,12,0.10)');
  sp.addColorStop(1.00, 'rgba(40,22,6,0.34)');
  g.fillStyle = sp;
  g.fillRect(0, 0, pw, ph);
  /* 磨平后残留的一点锤坑：极淡的暗斑 */
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * pw, y = Math.random() * ph, r = fs * (0.02 + Math.random() * 0.05);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(120,80,34,0.18)');
    rg.addColorStop(1, 'rgba(120,80,34,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  /* 顶面一条冷边（灯带的反射在字的上沿） */
  const co = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.10);
  co.addColorStop(0, 'rgba(206,224,255,0.35)');
  co.addColorStop(1, 'rgba(206,224,255,0)');
  g.fillStyle = co;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
