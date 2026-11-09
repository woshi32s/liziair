export default {
  num: '245', slug: 'thermochromic', title: '热敏变色膜',
  accent: [1.00, 0.46, 0.26],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.82,
  doc: `   245 · 热敏变色膜 —— 字是被加热到变色点的那一块膜，凉下来就自己退回去

   机制一句话：
      整张膜涂着**热致变色颜料**（leuco dye + 显色剂 + 溶剂的三元体系）：低于变色点是有机
      颜料的深色，一过 31℃ 左右溶剂熔化、显色剂断开，颜料褪成浅色的"开环"态。
      字是膜背后的一排加热点 —— 热量**扩散**（不是贴着字形，是沿着 sdf 往外渗），
      所以变色区比字略胖；变色区的边界是一条等温线（那圈过渡带最亮）；
      加热断电后热量散掉，字自己淡回去。

   和前作的区别：
      216 是壳被烧穿（自发光、有余烬）；这里是**阈值型相变**：同一块膜、同一个表面，
      只有"温度过没过那条线"，颜色是开关式的；热量会扩散、会冷却，字有自己的热历史。

   动态：u_st 是这一句的余温（换句时推满、之后衰减）；唱到的那一段更热（u_front）；
   拍点让加热点再冲一下（u_kick）。`,
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
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 热量：加热点在字后面，热沿 sdf 往外渗（0 = 凉，1 = 到点） */
    '  float spread = exp(-max(sd, 0.0)/0.021);',
    '  float core = 1.0 - smoothstep(-ep*2.0, ep*2.6, sd);',
    '  float heat = clamp(core*0.62 + spread*0.95, 0.0, 1.0);',
    /* 热的不均匀：膜里的溶剂分布不匀，变色点也就有早有晚 */
    '  float mott = vn(uv*5.5 + 3.0)*0.62 + vn(uv*13.0 - 2.0)*0.38;',
    '  heat *= 0.86 + 0.24*mott;',
    /* 这一句的余温（换句时推满、之后散掉）+ 拍点的冲击 */
    '  heat *= 0.42 + 0.58*u_st + 0.10*u_kick;',
    /* 唱到的那一段再热一点 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  heat += 0.20*litFront*core;',
    /* 变色开关：等温线在 0.47 附近，过渡很窄（热致变色是开关式的） */
    '  float pig = smoothstep(0.44, 0.50, heat);',
    '  float band = exp(-pow((heat - 0.47)/0.055, 2.0));',
    /* 膜面：一层哑光的塑料，有一点很宽的柔光（涂层是有光泽的） */
    '  vec3 film = vec3(0.035,0.070,0.068);',
    '  film = mix(film, vec3(0.020,0.045,0.048), mott*0.6);',
    /* 涂层里的细颗粒（颜料微胶囊：一颗颗小球） */
    '  vec2 mc = fract(uv*135.0 + h21(floor(uv*135.0))*0.7) - 0.5;',
    '  float caps = smoothstep(0.30, 0.05, length(mc))*step(0.25, h21(floor(uv*135.0) + 7.0));',
    /* 凉态：微胶囊是深青绿；热态：开环的浅暖色 */
    '  vec3 coldC = mix(vec3(0.030,0.062,0.060), vec3(0.070,0.115,0.105), caps);',
    '  vec3 hotC = mix(vec3(0.520,0.180,0.090), u_ac*0.82, caps*0.75);',
    '  vec3 alb = mix(coldC, hotC, pig);',
    /* 光：左上一盏柔光；膜面很平，高光是一条宽的 */
    '  vec3 N = normalize(vec3((vn(uv*44.0) - 0.5)*0.06, (vn(uv*40.0 + 5.0) - 0.5)*0.06, 1.0));',
    '  vec3 L1 = normalize(vec3(-0.45, 0.42, 0.79));',
    '  vec3 H1 = normalize(L1 + vec3(0.0,0.0,1.0));',
    '  float d1 = max(dot(N, L1), 0.0);',
    '  float spec = pow(max(dot(N, H1), 0.0), 30.0);',
    '  vec3 col = alb*(0.52 + 0.72*d1);',
    '  col += vec3(0.92,0.96,1.00)*spec*0.10;',
    /* 等温线：过渡带里颜料正在开环，反光最强 —— 一圈亮线把字的边界画出来 */
    '  col += mix(vec3(0.90,0.55,0.24), u_ac, 0.55)*band*0.46;',
    /* 热区中心更亮（温度高、颜料褪得更彻底） */
    '  col += u_ac*pig*core*0.10*(0.4 + 0.6*d1);',
    /* 环境：暗室里一盏顶灯 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.20 + pq.y*pq.y*1.10));',
    '  float vig = 1.0 - smoothstep(0.20, 1.34, length(uv*vec2(0.60,0.88)));',
    '  col *= 0.32 + 0.68*vig;',
    '  col += vec3(0.045,0.050,0.052)*pool*0.5;',
    '  col = 1.0 - exp(-col*1.95);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 31.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 变色的那块膜：暖珊瑚色的开环颜料 + 细密的微胶囊颗粒 + 一条等温线的亮边 */
  g.save();
  g.globalAlpha = 0.46;
  g.fillStyle = '#050708';
  g.filter = 'blur(' + (fs * 0.020).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.012, cy + fs * 0.020);
  g.filter = 'none';
  g.restore();

  const hot = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  hot.addColorStop(0.00, '#ffcfae');
  hot.addColorStop(0.18, '#ff9b74');
  hot.addColorStop(0.44, '#e3613c');
  hot.addColorStop(0.70, '#b8432a');
  hot.addColorStop(0.90, '#8a2f1e');
  hot.addColorStop(1.00, '#6d2517');
  g.fillStyle = hot;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 微胶囊：一颗颗极小的圆点，疏密不匀（颜料的颗粒感） */
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const r = 0.5 + Math.random() * 1.5;
    const bright = Math.random() < 0.5;
    g.fillStyle = bright
      ? 'rgba(255,232,206,' + (0.05 + Math.random() * 0.14).toFixed(3) + ')'
      : 'rgba(70,16,8,' + (0.06 + Math.random() * 0.16).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  /* 变色前沿：一条偏亮的等温线（贴在字边内侧一点） */
  g.strokeStyle = 'rgba(255,214,160,0.20)';
  g.lineWidth = 3.0;
  g.strokeText(L.text, cx, cy);
  /* 膜面的柔光 */
  const gl2 = g.createLinearGradient(pw * 0.12, cy - fs * 0.9, pw * 0.62, cy + fs * 0.4);
  gl2.addColorStop(0.00, 'rgba(255,255,255,0)');
  gl2.addColorStop(0.38, 'rgba(255,246,238,0.16)');
  gl2.addColorStop(0.55, 'rgba(255,255,255,0.02)');
  gl2.addColorStop(0.72, 'rgba(255,255,255,0)');
  g.fillStyle = gl2;
  g.fillRect(0, 0, pw, ph);
  /* 下缘压暗：膜的厚度感 */
  const dk = g.createLinearGradient(0, cy + fs * 0.08, 0, cy + fs * 0.62);
  dk.addColorStop(0.0, 'rgba(0,0,0,0)');
  dk.addColorStop(1.0, 'rgba(40,8,4,0.32)');
  g.fillStyle = dk;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
