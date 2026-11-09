export default {
  num: '240', slug: 'celadon-crackle', title: '瓷釉开片',
  accent: [0.62, 0.86, 0.78],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.97,
  doc: `   240 · 瓷釉开片 —— 字是釉下压出来的一道脊，脊上的釉更厚，开片也更疏

   机制一句话：
      青瓷的釉层被**开片**（craquelure）切成一片片釉砖：裂纹是釉与胎收缩率不同拉出来的，
      间距随**釉层厚度**变 —— 字是坯上压出的釉脊，脊顶釉最厚，裂纹最疏、釉最透亮；
      脊沟里釉薄，裂纹密得像蛛网。每片釉砖是一个微微鼓起的穹面（裂纹处釉塌下去），
      所以整片釉面在斜光下是一格一格的"釉光"；裂纹断面露出深灰的胎，一侧压黑、一侧挂白。

   和前作的区别：
      210 是纸浆压凸（纤维材料的浮雕，纯漫反射、没有镜面）；这里是**玻璃质的釉**：
      有镜面高光、半透（脊顶透出胎的暖锈色）、显影靠"裂纹网的疏密 + 釉砖穹面的反光差"，
      不是靠高度差打出的明暗。三级开片网（粗疏/中密/细密）叠出真实的冰裂层次。

   动态：换句时新脊"长"出来（u_st）；被唱到的那一段釉被"养"得更润（u_front 处高光更紧）；
   底部积釉的亮边随拍点轻轻一亮（u_kick）。`,
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
    /* 开片网：返回 (F2-F1, 指向最近釉砖芯的单位向量)
       釉在裂纹处塌下去 → 每片砖是穹面，穹面坡度就是这条向芯向量 */
    'vec3 cell(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float d1 = 8.0, d2 = 8.0;',
    '  vec2 r1 = vec2(0.0);',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g + 1.7), h21(ip + g + 5.3));',
    '      vec2 r = g + o - fp;',
    '      float d = dot(r, r);',
    '      if (d < d1) { d2 = d1; d1 = d; r1 = r; } else if (d < d2) { d2 = d; }',
    '    }',
    '  }',
    '  return vec3(sqrt(d2) - sqrt(d1), normalize(r1 + vec2(1e-5)));',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 釉脊：脊宽 0.05uv，高度剖面 h（边缘 0，中心 1） */
    '  float w = 0.055;',
    '  float q = clamp(-sd/w, 0.0, 1.0);',
    '  float h = q*(2.0-q);',
    '  float e = max(ep*1.5, 0.0016);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = clamp(gr, vec2(-2.5), vec2(2.5));',
    '  gr = normalize(gr + vec2(1e-6));',
    /* 开片：粗/中/细 三级。真实开片不是均匀网：细裂成片地长在局部，
       靠低频噪声做"冰裂片区"的遮罩；脊顶釉厚，只剩粗裂 */
    '  vec2 cellWarp = vec2(vn(uv*0.85 + 1.0) - 0.5, vn(uv*0.75 - 2.0) - 0.5)*0.62;',
    '  vec2 wp = uv + cellWarp + vec2(vn(uv*2.3 + 7.0) - 0.5, vn(uv*2.1 - 3.0) - 0.5)*0.11;',
    '  vec3 A = cell(wp*7.0 + 3.0);',
    '  vec3 B = cell(wp*17.0 - 4.0);',
    '  vec3 C = cell(wp*34.0 + 9.0);',
    /* 细裂的片区遮罩：0.35~0.75 的地方才长细裂 */
    '  float zone = vn(uv*1.35 + 17.0)*0.65 + vn(uv*3.1 - 5.0)*0.35;',
    '  float zoneB = smoothstep(0.28, 0.62, zone);',
    '  float zoneC = smoothstep(0.46, 0.72, zone)*0.9;',
    '  float dd = A.x;',
    '  float dome = smoothstep(0.0, 0.95, dd);',
    /* 釉面很平：只留极轻的穹面坡度（真实釉砖几乎是平的） */
    '  float slope = smoothstep(0.0, 0.22, dd)*(1.0 - smoothstep(0.36, 0.85, dd));',
    '  vec3 N = normalize(vec3(-gr*(1.0 - q)*0.40 - A.yz*slope*0.055*mix(1.0, 0.05, h), 1.0));',
    '  float flow = vn(uv*1.7 + 3.0)*0.62 + vn(uv*4.1 - 1.0)*0.38;',
    '  float fe = 0.05;',
    '  float f1 = vn((uv + vec2(fe,0.0))*1.7 + 3.0)*0.62 + vn((uv + vec2(fe,0.0))*4.1 - 1.0)*0.38;',
    '  float f2 = vn((uv + vec2(0.0,fe))*1.7 + 3.0)*0.62 + vn((uv + vec2(0.0,fe))*4.1 - 1.0)*0.38;',
    '  N = normalize(N + vec3(-(f1-flow)/fe, -(f2-flow)/fe, 0.0)*0.010);',
    /* 裂纹：细而黑的一根线 + 紧贴着的釉断口白唇 */
    '  float l1 = smoothstep(0.016, 0.0, A.x);',
    '  float l2 = smoothstep(0.013, 0.0, B.x)*(0.25 + 0.75*zoneB)*mix(1.0, 0.06, h);',
    '  float l3 = smoothstep(0.010, 0.0, C.x)*zoneC*mix(1.0, 0.0, h);',
    '  float crk = clamp(l1*0.85 + l2*0.42 + l3*0.26, 0.0, 1.0);',
    '  float lip = clamp((smoothstep(0.020, 0.005, A.x) - l1)*1.6 + (smoothstep(0.017, 0.004, B.x) - l2)*0.9, 0.0, 1.0);',
    /* 光的成分：左上一扇冷天光，右下一点暖反光 */
    '  vec3 L1 = normalize(vec3(-0.50, 0.44, 0.74));',
    '  vec3 L2 = normalize(vec3(0.55, -0.42, 0.72));',
    '  vec3 V = vec3(0.0,0.0,1.0);',
    '  float d1 = max(dot(N,L1), 0.0);',
    '  float d2 = max(dot(N,L2), 0.0);',
    '  vec3 H1 = normalize(L1+V);',
    '  float spec = pow(max(dot(N,H1), 0.0), 58.0);',
    '  float sheen = pow(max(dot(N,H1), 0.0), 11.0);',
    /* 胎：深灰带一点暖的瓷土 */
    '  vec3 body = vec3(0.085,0.078,0.068) + vec3(0.045,0.038,0.030)*(flow-0.5);',
    /* 釉：淡青，厚处偏绿、薄处偏白；只有极低频的浓淡（别让釉面碎成鱼鳞） */
    '  vec3 glaze = mix(vec3(0.080,0.112,0.104), vec3(0.30,0.40,0.36), 0.15 + 0.50*dome);',
    '  glaze = mix(glaze, u_ac*0.30, 0.16);',
    '  glaze *= 0.72 + 0.20*flow;',
    '  vec3 alb = mix(glaze, body, crk*0.88);',
    /* 裂纹：沟底黑，沟唇挂白（釉断口翻起来的釉唇） */
    '  alb *= 1.0 - 0.42*l1 - 0.18*l2;',
    '  alb += vec3(0.92,0.96,0.90)*lip*0.055*(0.3 + 0.7*d1);',
    /* 老釉的针孔：几粒极小的凹点（釉里排不出去的气） */
    '  vec2 pc = fract(uv*230.0) - 0.5;',
    '  float pin = smoothstep(0.34, 0.10, length(pc))*step(0.93, h21(floor(uv*230.0) + 31.0));',
    '  alb *= 1.0 - 0.45*pin;',
    '  vec3 col = alb*(0.34 + 0.86*d1);',
    '  col += alb*vec3(0.46,0.58,0.74)*d2*0.26;',
    '  col += vec3(0.90,0.96,0.92)*spec*(0.05 + 0.50*h)*(1.0 - 0.7*l1);',
    '  col += glaze*sheen*(0.05 + 0.30*h);',
    /* 整片釉面的大窗反射：随法线弯（釉脊上的反光会"断"一下），玻璃质靠它 */
    '  vec2 wq = vec2((uv + N.xy*0.55).x*0.62 + (uv + N.xy*0.55).y*1.05, (uv + N.xy*0.55).y*0.52 - (uv + N.xy*0.55).x*0.28);',
    '  float win = exp(-pow((wq.x + 0.26)/0.80, 2.0))*(0.58 + 0.42*vn(uv*3.0 + 11.0));',
    '  float win2 = exp(-pow((wq.x - 1.05)/0.11, 2.0))*0.55;',
    '  col += vec3(0.56,0.66,0.62)*(win*0.072 + win2*0.075)*(1.0 - 0.25*crk);',
    /* 脊顶半透：釉厚处透出胎里的暖（很克制，别糊成一团光） */
    '  col += vec3(0.30,0.24,0.15)*h*h*0.075*(0.4 + 0.6*d1);',
    /* 脊缘积釉：一圈很窄的釉堆（不是发光描边） */
    '  float rim = exp(-pow((sd + 0.008)/0.013, 2.0));',
    '  col += u_ac*rim*0.030*(0.35 + 0.65*d1);',
    '  col *= 1.0 - 0.42*smoothstep(-0.015, 0.075, sd);',
    /* 已经唱过的那一段：釉更润，高光更紧 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.80,0.90,0.86)*litFront*h*(0.03 + 0.10*spec);',
    '  col *= 1.0 + 0.035*u_kick;',
    /* 环境：天光落在字上的一池，四周压得很暗 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.20 + pq.y*pq.y*1.30));',
    '  float vig = 1.0 - smoothstep(0.16, 1.20, length(uv*vec2(0.60,0.88)));',
    '  col *= 0.22 + 0.78*vig;',
    '  col += vec3(0.045,0.060,0.056)*pool*0.55;',
    '  col *= 1.0 - 0.25*(1.0 - u_st);',
    '  col = 1.0 - exp(-col*2.05);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 21.0) - 0.5)*0.009;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 釉脊的字：青瓷竖向渐变 + 脊顶一道冷光 + 疏落的老裂 + 底部积釉 */
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#04070a';
  g.filter = 'blur(' + (fs * 0.014).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.012, cy + fs * 0.022);
  g.filter = 'none';
  g.restore();

  const cel = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.62);
  cel.addColorStop(0.00, '#c8d8c6');
  cel.addColorStop(0.20, '#aec2b0');
  cel.addColorStop(0.46, '#8ba395');
  cel.addColorStop(0.72, '#6c8577');
  cel.addColorStop(0.90, '#46605a');
  cel.addColorStop(1.00, '#33493f');
  g.fillStyle = cel;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 立体：整字往右下"沉"一层暗（clip 在字里 → 上左留出一道亮边，像釉脊的坡） */
  g.save();
  g.globalAlpha = 0.85;
  g.filter = 'blur(' + (fs * 0.018).toFixed(1) + 'px)';
  g.fillStyle = '#1b2c27';
  g.fillText(L.text, cx + fs * 0.020, cy + fs * 0.028);
  g.restore();
  g.save();
  g.globalAlpha = 0.26;
  g.filter = 'blur(' + (fs * 0.016).toFixed(1) + 'px)';
  g.fillStyle = '#eaf7ea';
  g.fillText(L.text, cx - fs * 0.012, cy - fs * 0.018);
  g.filter = 'none';
  g.restore();
  /* 釉里的薄雾：横向的细带，让渐变不是塑料 */
  for (let i = 0; i < 30; i++) {
    const yy = Math.random() * ph;
    const a = 0.02 + Math.random() * 0.05;
    g.fillStyle = 'rgba(250,255,244,' + a.toFixed(3) + ')';
    g.fillRect(0, yy, pw, 1 + Math.random() * 7);
  }
  /* 字上的老裂：几道细的，走向随机，一侧压黑一侧挂白 */
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const y0 = cy - fs * 0.58 + Math.random() * fs * 1.16;
    let x = -10, y = y0;
    const pts = [[x, y]];
    while (x < pw + 10) {
      x += 9 + Math.random() * 30;
      y += (Math.random() - 0.5) * fs * 0.20;
      pts.push([x, y]);
    }
    g.strokeStyle = 'rgba(24,40,36,0.22)';
    g.lineWidth = 0.8 + Math.random() * 0.7;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,240,0.10)';
    g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1] - 1.2);
    for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1] - 1.2);
    g.stroke();
  }
  /* 釉面上一条窄的窗光：比大渐变亮、比描边窄 */
  const gband = g.createLinearGradient(0, cy - fs * 0.50, 0, cy - fs * 0.02);
  gband.addColorStop(0.0, 'rgba(255,255,255,0)');
  gband.addColorStop(0.55, 'rgba(236,255,246,0.30)');
  gband.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = gband;
  g.fillRect(0, 0, pw, ph);
  /* 脊顶的冷天光：一条斜的宽带，扫在字的上半部 */
  const sk = g.createLinearGradient(pw * 0.10, cy - fs * 0.85, pw * 0.72, cy + fs * 0.42);
  sk.addColorStop(0.00, 'rgba(255,255,255,0)');
  sk.addColorStop(0.33, 'rgba(244,255,250,0.22)');
  sk.addColorStop(0.52, 'rgba(255,255,255,0.04)');
  sk.addColorStop(0.70, 'rgba(255,255,255,0)');
  g.fillStyle = sk;
  g.fillRect(0, 0, pw, ph);
  /* 底部积釉：更亮更绿的一条边（釉往下淌） */
  const pool2 = g.createLinearGradient(0, cy + fs * 0.06, 0, cy + fs * 0.62);
  pool2.addColorStop(0.0, 'rgba(150,220,200,0)');
  pool2.addColorStop(0.70, 'rgba(172,232,210,0.20)');
  pool2.addColorStop(1.0, 'rgba(70,120,108,0.46)');
  g.fillStyle = pool2;
  g.fillRect(0, 0, pw, ph);
  /* 顶面压一点暗边，让字嵌进釉里 */
  const in3 = g.createLinearGradient(0, cy - fs * 0.60, 0, cy - fs * 0.06);
  in3.addColorStop(0, 'rgba(255,255,250,0.18)');
  in3.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = in3;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
