export default {
  num: '211', slug: 'linen-jacquard', title: '亚麻提花',
  accent: [0.92, 0.88, 0.80],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 1.0,
  doc: `   211 · 亚麻提花 —— 同一块布上织了两种织法，字是**缎纹区**

   机制一句话：
     经纬两组纱线的圆柱截面 + 平纹/缎纹的"谁压在上面"矩阵构成布料高度场；
     整块布没有字，只有**织法**变了 —— 字区是 5 枚缎纹（长浮线，反光连成一片），
     其余是平纹（一上一下，反光被切碎），于是字靠**反射方向的不同**显形，
     不是压上去、也不是贴上去的。字的边缘就是织法的分界线。

   和前作的区别：
     061 是 Verlet 布料模拟（质点+约束+重力），lizi79 是粒子织机（粒子排成经纬线）；
     这里没有任何质点，织物是**逐像素的高度场**，而且字不是被"织出来"的图案颜色，
     是同一块亚麻上换了一种织法 —— 所以凑近看，字里是长浮线，字外是一上一下。

   附加：整块布有低频褶皱（手工织机张力不匀），缎纹区在掠射光下连成一条丝光带。
   换句：织法矩阵换新，缎纹区从旧字"退织"成平纹、新字"织"上来（用 u_st 过渡）。`,
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
    /* 织物高度场：TH = 每 uv 多少根纱（≈6.5 css px 一根） */
    'const float TH = 68.0;',
    'float clothH(vec2 p, float satin, out float top){',
    '  vec2 g = p*TH;',
    '  vec2 id = floor(g), f = fract(g);',
    /* 平纹：一上一下；缎纹（5 枚 3 浮）：长浮线，反光连成带 */
    '  float plain = mod(id.x + id.y, 2.0);',
    '  float sat = mod(id.x + 3.0*id.y, 5.0);',
    '  float warpTop = mix(step(0.5, plain), step(sat, 2.5), satin);',
    /* 纱线截面（圆柱）：warp 沿 y 走 → 随 x 起伏；weft 沿 x 走 → 随 y 起伏 */
    '  float cx = sqrt(max(0.0, 1.0 - pow(f.x*2.0-1.0, 2.0)));',
    '  float cy = sqrt(max(0.0, 1.0 - pow(f.y*2.0-1.0, 2.0)));',
    '  float h = mix(cy*0.62 + cx*0.16, cx*0.66 + cy*0.14, warpTop);',
    /* 纱线之间的缝：压下去，光在这里断开 */
    '  float gap = min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y));',
    '  h *= 0.62 + 0.38*smoothstep(0.0, 0.20, gap);',
    '  top = warpTop;',
    '  return h;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float e = u_epx*1.05;',
    '  float sd = gsd(uv);',
    '  float satin = 1.0 - smoothstep(-u_epx*1.6, u_epx*1.6, sd);',
    /* 织法过渡：换句时缎纹区从 0 长到 1（u_st） */
    '  satin *= u_st;',
    /* 高度：织物 + 低频褶皱（手工织机的张力不匀） */
    '  float top0 = 0.0;',
    '  float w0 = clothH(uv, satin, top0);',
    '  float t1 = 0.0;',
    '  float wx = clothH(uv + vec2(e, 0.0), satin, t1);',
    '  float t2 = 0.0;',
    '  float wy = clothH(uv + vec2(0.0, e), satin, t2);',
    '  float fold = vn(uv*2.1 + 5.0)*0.55 + vn(uv*4.7 - 2.0)*0.45;',
    '  float foldX = vn((uv + vec2(e,0.0))*2.1 + 5.0)*0.55 + vn((uv + vec2(e,0.0))*4.7 - 2.0)*0.45;',
    '  float foldY = vn((uv + vec2(0.0,e))*2.1 + 5.0)*0.55 + vn((uv + vec2(0.0,e))*4.7 - 2.0)*0.45;',
    '  w0 += fold*0.150; wx += foldX*0.150; wy += foldY*0.150;',
    '  float gx = (wx-w0)/e, gy = (wy-w0)/e;',
    '  vec2 gr = clamp(vec2(gx, gy)*0.0075, vec2(-2.4), vec2(2.4));',
    '  vec3 N = normalize(vec3(-gr, 1.0));',
    /* 天光：主光左上（暖），补光右下（冷），缎纹区再加一束掠射的丝光 */
    '  vec3 L1 = normalize(vec3(-0.58, 0.52, 0.62));',
    '  vec3 L2 = normalize(vec3(0.45, -0.35, 0.72));',
    '  vec3 V = vec3(0.0,0.0,1.0);',
    '  float d1 = max(dot(N,L1), 0.0);',
    '  float d2 = max(dot(N,L2), 0.0);',
    '  vec3 H1 = normalize(L1+V);',
    '  float spec = pow(max(dot(N,H1), 0.0), 46.0);',
    /* 丝的绒光：缎纹的长浮线让高光连成一条，平纹只有碎点 */
    '  float sheen = pow(max(dot(N,H1), 0.0), 7.0);',
    /* 纱线的纤维毛羽 */
    '  float fuzz = vn(vec2(uv.x*24.0, uv.y*340.0))*0.6 + vn(vec2(uv.x*320.0, uv.y*30.0))*0.4;',
    /* 布面：深靛的亚麻（本色偏灰），缎纹区是米白的丝 */
    '  vec3 linen = vec3(0.078,0.080,0.096);',
    '  linen += vec3(0.105,0.100,0.096)*fuzz;',
    '  linen += vec3(0.055,0.060,0.080)*(fold-0.5);',
    '  vec3 silk = mix(vec3(0.66,0.62,0.53), u_ac*0.62, 0.35);',
    '  vec3 alb = mix(linen, silk, satin);',
    '  float graze = 1.0 - smoothstep(-0.55, 0.95, uv.x*0.6 + uv.y*0.8);',
    '  vec3 col = alb*(0.16 + 0.95*d1) + alb*vec3(0.55,0.64,0.82)*d2*0.22;',
    '  col *= 0.72 + 0.55*graze;',
    /* 缎纹的丝光带：掠射角上一条亮的横光 */
    '  col += silk*sheen*satin*0.55;',
    '  col += vec3(1.0,0.96,0.86)*spec*(0.10 + 0.55*satin)*(0.4+0.6*fuzz);',
    /* 平纹的"一上一下"阴影：vit 让布面有颗粒 */
    '  float gapSh = 1.0 - 0.45*(1.0-top0)*(1.0-satin);',
    '  col *= mix(1.0, gapSh, 0.55);',
    /* 织法分界线：一道很细的暗缝，字才"切"得出来 */
    '  float seam = exp(-pow(sd/(u_epx*1.5), 2.0));',
    '  col *= 1.0 - 0.35*seam*u_st;',
    /* 已经唱到的那一段：缎纹更满、光更硬 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += silk*litFront*satin*0.07*(0.4+0.6*d1);',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：四周压暗，中间一块棚灯的光池 */
    '  vec2 q = uv - u_gc;',
    '  float pool = exp(-(q.x*q.x*0.16 + q.y*q.y*1.10));',
    '  float vig = 1.0 - smoothstep(0.26, 1.42, length(uv*vec2(0.66,0.90)));',
    '  col *= 0.34 + 0.66*vig;',
    '  col += vec3(0.05,0.055,0.07)*pool*0.35;',
    '  col = 1.0 - exp(-col*1.75);',
    '  col += (h21(gl_FragCoord.xy*0.7 + 3.0) - 0.5)*0.008;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 缎纹浮线：先丝光渐变，再用 source-atop 把横向浮线压进字里 */
  g.save();
  g.globalAlpha = 0.46;
  g.fillStyle = '#08070d';
  g.filter = 'blur(' + (fs * 0.022).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.012, cy + fs * 0.017);
  g.filter = 'none';
  g.restore();

  const grad = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  grad.addColorStop(0, '#f7f0e0');
  grad.addColorStop(0.26, '#efe6d2');
  grad.addColorStop(0.58, '#d9cdb5');
  grad.addColorStop(0.84, '#b3a68c');
  grad.addColorStop(1, '#8e8168');
  g.fillStyle = grad;
  g.fillText(L.text, cx, cy);

  /* 浮线：横向细线（缎纹的经浮线在光下是一条条亮边） */
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const pitch = 3.4;
  for (let y = 0; y < ph; y += pitch) {
    const k = 0.5 + 0.5 * Math.sin(y * 0.42 + 1.1);
    /* 浮线的顶面：受光的一条亮带 */
    g.fillStyle = 'rgba(255,253,242,' + (0.26 + 0.34 * k).toFixed(3) + ')';
    g.fillRect(0, y, pw, 1.15);
    /* 浮线的下沿：压进布里的一条暗缝 */
    g.fillStyle = 'rgba(34,28,20,' + (0.30 + 0.22 * (1 - k)).toFixed(3) + ')';
    g.fillRect(0, y + 1.7, pw, 1.1);
    g.fillStyle = 'rgba(120,106,84,0.22)';
    g.fillRect(0, y + 2.9, pw, 0.5);
  }
  /* 一道斜向的丝光 */
  const sh = g.createLinearGradient(0, cy - fs, pw, cy + fs);
  sh.addColorStop(0, 'rgba(255,255,255,0)');
  sh.addColorStop(0.42, 'rgba(255,252,238,0.30)');
  sh.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, pw, ph);
  /* 顶面压一点点暗边，字才在布里 */
  const in2 = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  in2.addColorStop(0, 'rgba(255,255,255,0.22)');
  in2.addColorStop(0.55, 'rgba(0,0,0,0)');
  in2.addColorStop(1, 'rgba(16,11,6,0.42)');
  g.fillStyle = in2;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
