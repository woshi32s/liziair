export default {
  num: '273', slug: 'beeswax-comb', title: '蜂蜡巢房',
  accent: [0.98, 0.72, 0.28],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.14,
  doc: `   273 · 蜂蜡巢房 —— 字是已经封盖的那一片巢房，蜜在下面把它顶得发亮

   机制一句话：
      蜂巢是一张**六边形的蜡墙网**：壁上蜡厚、房底蜡薄，光从斜上方来，
      壁的迎光面亮成一条、背光面沉下去 —— 没封盖的巢房是一格一格的深孔（暗）。
      字是**封了盖**的那一片：每格被一层半透的蜡膜盖住，膜微微鼓起来，
      于是每一格顶上各有一点高光，整片连成一个亮而暖的面；
      蜡是半透的，光从膜下面透上来带一点蜜的金（越靠格心越亮、越靠壁越浓）。

   和前作的区别：
      211、243 都是纤维（纱线 / 毡）：漫反射、没有固定的格子；
      这里是**蜡**：六边形阵列 + 半透（光进来再散出来）+ 封盖/未封盖两种状态。
      显形的不是明暗对比，而是"孔"和"盖"的结构差 —— 整幅只有一种材料。

   动态：换句时这片刚封上盖（u_st：盖从格心往外长满）；唱到的那一段蜡更软更透（u_front）；
   拍点让蜡膜轻轻一颤（u_kick，每格的高光挪一点）。`,
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
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.8, ep*1.8, sd);',
    '  float dist = abs(sd);',
    /* 六边形巢房：两套错开的格点取近的那个，就是一张蜂窝 */
    '  vec2 HS = vec2(1.0, 1.7320508);',
    '  vec2 hp = uv*23.0 + vec2(0.0, sin(uv.x*1.7)*0.20);',
    '  vec2 pa = mod(hp, HS) - HS*0.5;',
    '  vec2 pb = mod(hp - HS*0.5, HS) - HS*0.5;',
    '  float useA = step(dot(pa,pa), dot(pb,pb));',
    '  vec2 gv = mix(pb, pa, useA);',
    '  vec2 id = floor((hp - gv)/HS + 0.5);',
    '  vec2 q = abs(gv);',
    '  float hexr = q.x*0.8660254 + q.y*0.5;',
    '  float edge = 0.5 - max(hexr, q.y);',
    '  float rnd = h21(id + 3.7);',
    /* 壁：蜡在这里堆得最厚；房底薄，光从底下透上来 */
    '  float wall = smoothstep(0.085, 0.012, edge);',
    '  float deep = smoothstep(0.020, 0.30, edge);',
    '  vec2 wl = normalize(gv + vec2(1e-5));',
    '  float facing = max(0.0, dot(wl, normalize(vec2(-0.55, 0.60))));',
    /* 未封盖：深孔 + 迎光的壁 */
    '  vec3 waxy = vec3(0.36,0.24,0.085);',
    '  vec3 cOpen = vec3(0.030,0.022,0.010)*(0.55 + 0.75*vn(uv*14.0 + 2.0));',
    '  cOpen += waxy*pow(deep, 0.55)*0.55;',
    '  cOpen += vec3(0.52,0.36,0.12)*wall*(0.20 + 0.95*facing);',
    '  cOpen += vec3(0.55,0.36,0.10)*exp(-edge*10.0)*0.16;',
    /* 已封盖：一层半透的蜡膜，微微鼓起 */
    '  float seal = smoothstep(0.0, 0.35, u_st + rnd*0.25);',
    '  float dome = 1.0 - smoothstep(0.06, 0.44, edge);',
    '  vec2 lidN = gv*2.1*(1.0 + 0.15*sin(t*9.0 + rnd*6.28)*u_kick);',
    '  vec3 N3 = normalize(vec3(-lidN*0.9, 1.0));',
    '  float sp = pow(max(dot(N3, normalize(normalize(vec3(-0.42,0.50,0.75)) + vec3(0.0,0.0,1.0))), 0.0), 26.0);',
    '  float sheen = pow(max(dot(N3, normalize(vec3(-0.42,0.50,0.75))), 0.0), 4.0);',
    '  vec3 capCol = mix(vec3(0.46,0.33,0.11), vec3(0.90,0.74,0.36), clamp(dome*1.05 + seal*0.15, 0.0, 1.0));',
    '  capCol *= 0.82 + 0.26*smoothstep(0.02, 0.20, edge);',
    '  capCol *= 0.90 + 0.20*rnd;',
    '  capCol += vec3(0.28,0.18,0.06)*(1.0 - dome)*0.6;',
    '  capCol += vec3(1.00,0.94,0.76)*sp*(0.55 + 0.45*seal)*(0.55 + 0.45*u_st)*1.5;',
    '  capCol += vec3(0.55,0.42,0.20)*sheen*0.30;',
    /* 透光：光从膜的下面带上来一层蜜的金 */
    '  capCol += vec3(0.95,0.62,0.20)*exp(-edge*6.5)*0.22*(0.6 + 0.4*seal);',
    /* 盖和孔在字的边界上不是硬切：膜在最外一圈还被蜡粘着 */
    '  float capW = g0*(0.55 + 0.45*seal);',
    '  vec3 col = mix(cOpen, capCol, capW);',
    /* 蜡的半透：整片的暖雾（蜡在灯下会自己亮） */
    '  col += vec3(0.24,0.14,0.045)*(0.35 + 0.65*capW)*0.55;',
    /* 巢房整体的起伏（蜡片不是平的） */
    '  float sheet = vn(uv*2.6 + 5.0)*0.5 + vn(uv*5.2 - 1.0)*0.5;',
    '  col *= 0.80 + 0.36*sheet;',
    /* 唱过的那一段：蜡更软、更透（底下蜜多） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(1.0,0.70,0.26)*litFront*capW*0.10;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：一小块蜡片，只有一束暖光；边缘暗下去 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.15 + pq.y*pq.y*0.95));',
    '  float vig = 1.0 - smoothstep(0.20, 1.22, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.22 + 0.78*vig;',
    '  col += vec3(0.050,0.032,0.012)*pool*0.65;',
    '  col = 1.0 - exp(-col*1.90);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 61.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 封盖的蜡膜：暖金的一片，格心的亮、贴壁的地方浓 */
  const wg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  wg.addColorStop(0.00, '#f0d79a');
  wg.addColorStop(0.26, '#e2c176');
  wg.addColorStop(0.55, '#cfa955');
  wg.addColorStop(0.82, '#b08a3c');
  wg.addColorStop(1.00, '#8a6828');
  g.fillStyle = wg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 蜡里的丝：拉丝一样极细的亮纹 */
  g.lineCap = 'round';
  for (let i = 0; i < 170; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const len = fs * (0.06 + Math.random() * 0.4);
    const ang = -0.5 + Math.random() * 1.0;
    g.strokeStyle = Math.random() < 0.55
      ? 'rgba(255,246,214,' + (0.05 + Math.random() * 0.16).toFixed(3) + ')'
      : 'rgba(96,66,20,' + (0.04 + Math.random() * 0.12).toFixed(3) + ')';
    g.lineWidth = 0.6 + Math.random() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  /* 顶上的一道暖光（蜡膜鼓起来的地方） */
  const lite = g.createLinearGradient(0, cy - fs * 0.55, 0, cy - fs * 0.05);
  lite.addColorStop(0.0, 'rgba(255,252,230,0.00)');
  lite.addColorStop(0.55, 'rgba(255,250,224,0.26)');
  lite.addColorStop(1.0, 'rgba(255,255,255,0.00)');
  g.fillStyle = lite;
  g.fillRect(0, 0, pw, ph);
  /* 底下透上来的蜜色 */
  const honey = g.createLinearGradient(0, cy + fs * 0.02, 0, cy + fs * 0.62);
  honey.addColorStop(0.0, 'rgba(255,168,40,0.00)');
  honey.addColorStop(0.7, 'rgba(226,140,30,0.16)');
  honey.addColorStop(1.0, 'rgba(150,80,10,0.30)');
  g.fillStyle = honey;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
