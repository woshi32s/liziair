export default {
  num: '244', slug: 'rust-steel', title: '锈蚀钢',
  accent: [0.92, 0.46, 0.18],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.80,
  doc: `   244 · 锈蚀钢 —— 字是锈壳剥落的那一块，露出来的钢还在反光

   机制一句话：
      钢板上盖着一层**氧化壳**（锈）：多孔的赤铁矿，漫反射、无高光，厚的地方起鳞片、
      薄的地方透出钢的青灰；字是壳被整片**剥落**的地方 —— 露出底下的钢，
      钢有轧制的横向纹理，高光被拉成一条水平的亮带。剥落的边界是一圈翘起的锈鳞：
      迎光侧一道白边，背光侧一道黑缝。字的亮度就是**壳与钢的反射差**。

   和前作的区别：
      216 是熔岩裂隙（壳 vs 缝，热从里面透出来，靠自发光）；这里是**两种固体材料**：
      锈是氧化物的漫反射，钢是金属的镜面，显形靠反射率与反射的"锐/钝"，没有热、没有发光。

   动态：换句时锈壳"剥落"（u_st，边界从字心往外推开），唱到的那一段钢被擦得更亮
   （u_front），锈粉随拍点一颤（u_kick）。`,
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
    '  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 9.0;',
    '  return (texture2D(u_g, tc).r*255.0 - 128.0) * u_gk;',
    '}',
    /* 锈壳：三层噪声（大块锈斑 / 中等颗粒 / 细孔），值域 0..1 */
    'float rustTex(vec2 p){',
    '  float a = vn(p*3.2 + 1.0)*0.50;',
    '  float b = vn(p*9.5 - 4.0)*0.30;',
    '  float c = vn(p*27.0 + 7.0)*0.20;',
    '  return a + b + c;',
    '}',
    /* 锈鳞的片：Voronoi 的边（片与片之间翘起来） */
    'float plate(vec2 p){',
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
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 剥落边界：被噪声咬过的锯齿（锈壳不是切出来的，是崩下来的） */
    '  float jag = (vn(uv*70.0) - 0.5)*0.0060 + (vn(uv*210.0 + 3.0) - 0.5)*0.0022;',
    '  float sdw = sd + jag*(0.6 + 0.8*u_st);',
    '  float bare = (1.0 - smoothstep(-ep*1.3, ep*1.3, sdw))*u_st;',
    /* 锈壳的厚度：厚的地方起鳞、色更深 */
    '  float r1 = rustTex(uv);',
    '  float pl = plate(uv*5.6 + 2.0);',
    '  float plEdge = smoothstep(0.045, 0.0, pl);',
    '  float plEdge2 = smoothstep(0.13, 0.05, pl) - plEdge;',
    '  float r2 = rustTex(uv*2.4 + 9.0);',
    '  float thick = clamp(r1*0.6 + r2*0.4 + 0.10, 0.0, 1.0);',
    /* 锈鳞:高频的边缘（片状剥落留下的台阶） */
    '  float flake = smoothstep(0.62, 0.74, vn(uv*46.0 + 2.0))*(1.0 - smoothstep(0.80, 0.92, vn(uv*46.0 + 2.0)));',
    '  /* 钢：轧制的横向纹理（细的横条 + 低频起伏） */',
    '  float roll = vn(vec2(uv.x*3.0, uv.y*260.0))*0.6 + vn(vec2(uv.x*8.0, uv.y*640.0))*0.4;',
    '  float rollB = vn(vec2(uv.x*2.0, uv.y*70.0))*0.5 + vn(vec2(uv.x*6.0, uv.y*180.0))*0.5;',
    /* 钢的法线：横向纹理让法线在 y 方向抖 */
    '  vec3 Ns = normalize(vec3((rollB - 0.5)*0.10, (roll - 0.5)*0.30, 1.0));',
    /* 锈的法线：粗糙的颗粒 */
    '  vec3 Nr = normalize(vec3((vn(uv*60.0) - 0.5)*0.55, (vn(uv*66.0 + 5.0) - 0.5)*0.55, 1.0));',
    '  vec3 N = normalize(mix(Nr, Ns, bare));',
    /* 光：左上一盏冷白，右下一点暖的反射 */
    '  vec3 L1 = normalize(vec3(-0.52, 0.44, 0.73));',
    '  vec3 V = vec3(0.0, 0.0, 1.0);',
    '  vec3 H1 = normalize(L1 + V);',
    '  float d1 = max(dot(N, L1), 0.0);',
    '  float spec = pow(max(dot(N, H1), 0.0), 90.0);',
    '  float gloss = pow(max(dot(N, H1), 0.0), 12.0);',
    /* 锈：赤铁矿的漫反射，厚处深、薄处透出钢的青 */
    '  vec3 rustA = vec3(0.265,0.112,0.042);',
    '  vec3 rustB = vec3(0.140,0.058,0.026);',
    '  vec3 rustC = vec3(0.355,0.175,0.072);',
    '  vec3 rust = mix(rustA, rustB, thick*0.85);',
    '  rust = mix(rust, rustC, smoothstep(0.55, 0.85, r2)*0.55);',
    '  rust *= 0.72 + 0.55*r1;',
    /* 锈鳞的台阶：一侧亮、一侧暗（片翘起来） */
    '  float fl = flake*(1.0 - bare*0.9);',
    '  rust *= 1.0 + 0.55*fl*(d1 - 0.35);',
    /* 锈片之间：一道黑缝 + 贴着亮边（片翘起来的厚度） */
    '  rust *= 1.0 - 0.30*plEdge*(1.0 - bare);',
    '  rust += vec3(0.40,0.19,0.07)*plEdge2*(0.10 + 0.30*d1)*(1.0 - bare);',
    /* 锈的凹坑（孔蚀）：极小的暗点 */
    '  vec2 pc = fract(uv*170.0) - 0.5;',
    '  float pit = smoothstep(0.30, 0.06, length(pc))*step(0.86, h21(floor(uv*170.0) + 5.0))*(1.0 - bare);',
    '  rust *= 1.0 - 0.55*pit;',
    /* 钢：青灰，靠高光说话 */
    '  vec3 steel = vec3(0.185,0.200,0.215);',
    '  steel *= 0.80 + 0.42*rollB;',
    '  vec3 steelLit = steel*(0.30 + 0.85*d1) + vec3(0.90,0.94,1.00)*spec*1.25 + vec3(0.55,0.62,0.75)*gloss*0.22;',
    /* 锈面：只有很弱的漫射 + 一点粗糙的"绒光" */
    '  vec3 rustLit = rust*(0.42 + 0.80*d1) + rust*gloss*0.10;',
    '  vec3 col = mix(rustLit, steelLit, bare);',
    /* 剥落边缘：翘起的锈鳞（迎光白边 + 背光黑缝） */
    '  float rim = exp(-pow((sdw + 0.0015)/0.0035, 2.0));',
    '  float above = smoothstep(-0.001, 0.006, sdw);',
    '  col += vec3(1.00,0.86,0.68)*rim*above*0.45*u_st;',
    '  col *= 1.0 - 0.55*rim*(1.0 - above)*u_st;',
    /* 锈粉：剥落处周围落的橙色细点 */
    '  float dust = smoothstep(0.78, 0.95, vn(uv*140.0 + 11.0))*(1.0 - bare)',
    '    *exp(-pow(max(sdw - 0.012, 0.0)/0.017, 2.0));',
    '  col += vec3(0.44,0.19,0.07)*dust*0.55;',
    '  col *= 1.0 + 0.10*u_kick;',
    /* 唱过的那一段：钢被擦亮 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += steelLit*litFront*bare*0.14;',
    '  col *= 1.0 + 0.04*u_kick;',
    /* 环境：暗厂房里一盏顶灯 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.20 + pq.y*pq.y*1.15));',
    '  float vig = 1.0 - smoothstep(0.18, 1.30, length(uv*vec2(0.60,0.88)));',
    '  col *= 0.24 + 0.76*vig;',
    '  col += vec3(0.085,0.062,0.045)*pool*0.45;',
    '  col = 1.0 - exp(-col*1.80);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 23.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 剥落露出的钢：冷青灰 + 轧制横纹 + 一道被拉长的水平高光 */
  g.save();
  g.globalAlpha = 0.50;
  g.fillStyle = '#0a0806';
  g.filter = 'blur(' + (fs * 0.020).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.012, cy + fs * 0.020);
  g.filter = 'none';
  g.restore();

  const stl = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  stl.addColorStop(0.00, '#c8d2dc');
  stl.addColorStop(0.20, '#a6b2c0');
  stl.addColorStop(0.46, '#7d8a99');
  stl.addColorStop(0.72, '#5d6977');
  stl.addColorStop(0.90, '#454f5c');
  stl.addColorStop(1.00, '#333b46');
  g.fillStyle = stl;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 轧制横纹：极细的横线，疏密不匀（钢板的轧痕） */
  for (let i = 0; i < 520; i++) {
    const yy = Math.random() * ph;
    const a = 0.03 + Math.random() * 0.10;
    g.fillStyle = Math.random() < 0.5
      ? 'rgba(255,255,255,' + a.toFixed(3) + ')'
      : 'rgba(18,24,32,' + (a * 1.2).toFixed(3) + ')';
    g.fillRect(0, yy, pw, 0.7 + Math.random() * 1.1);
  }
  /* 一道被轧纹拉长的水平高光（金属的镜面被纹理抹成条） */
  const hb = g.createLinearGradient(0, cy - fs * 0.40, 0, cy - fs * 0.02);
  hb.addColorStop(0.00, 'rgba(255,255,255,0)');
  hb.addColorStop(0.46, 'rgba(248,252,255,0.50)');
  hb.addColorStop(0.60, 'rgba(255,255,255,0.06)');
  hb.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = hb;
  g.fillRect(0, 0, pw, ph);
  /* 剥落边界上残留的锈：贴着字边的一圈暗橙（钢没露全） */
  g.strokeStyle = 'rgba(96,40,14,0.55)';
  g.lineWidth = 2.4;
  g.strokeText(L.text, cx, cy);
  g.strokeStyle = 'rgba(198,96,36,0.30)';
  g.lineWidth = 0.9;
  g.strokeText(L.text, cx, cy);
  /* 钢上的小凹坑 */
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const r = 0.6 + Math.random() * 2.0;
    g.fillStyle = 'rgba(20,26,34,0.30)';
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(226,236,246,0.16)';
    g.beginPath(); g.arc(x - 0.7, y - 0.7, r * 0.6, 0, 6.2832); g.fill();
  }
  g.restore();`,
  post: ''
};
