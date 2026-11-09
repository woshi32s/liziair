export default {
  num: '279', slug: 'terrazzo-patch', title: '水磨石补块',
  accent: [0.90, 0.72, 0.46],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.12,
  doc: `   279 · 水磨石补块 —— 字是同一个平面上、用另一种级配的骨料补浇的一块

   机制一句话：
      水磨石是**骨料的横切面**：把石子拌进水泥、浇上、磨平、抛光 —— 磨到的那个面上，
      每一颗石子被切出一个多边形截面，颜色就是那颗石子自己的颜色。
      字是**补浇**的一块：把这一块凿掉、用另一种级配的骨料重新浇上（深色的石子多、
      白的大理石少），和原地一起磨平、一起抛光 —— 所以字**没有高度差、没有光泽差**，
      只有骨料的颜色和密度不一样；交界处是一道锯缝（切割机的刀口），比周围略深。

   和前作的区别：
      242 湿沥青的差别是**粗糙度**（干/湿两种表面的反光不同）；
      279 这里两种区域的粗糙度、高度、光泽完全一样，只有**组成**不同：
      一个是靠"表面怎么反光"，一个是靠"里面有什么"。
      这是本组唯一一个"没有光影也能看见"的字 —— 把灯关了，它还在。

   动态：换句时补块刚浇上、还没磨（u_st：骨料从模糊到清晰）；唱到的那一段被磨得更亮（u_front）；
   拍点上抛光机的光扫过（u_kick）。`,
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
    /* 骨料的截面：Voronoi 一格就是一颗石子（切出来的多边形），格心是它自己的随机 */
    'vec4 chip(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float d1 = 8.0, d2 = 8.0;',
    '  vec2 id1 = ip;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g + 2.3), h21(ip + g + 6.1))*0.92 + 0.04;',
    '      vec2 r = g + o - fp;',
    '      float d = dot(r, r);',
    '      if (d < d1) { d2 = d1; d1 = d; id1 = ip + g; } else if (d < d2) { d2 = d; }',
    '    }',
    '  }',
    '  return vec4(id1, sqrt(d1), sqrt(d2) - sqrt(d1));',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.6, ep*1.6, sd);',
    '  float dist = abs(sd);',
    /* 骨料在两套尺度上都有（细砂粒 + 大石子） */
    '  vec4 A = chip(uv*30.0 + 3.0);',
    '  vec2 idA = A.xy;',
    '  vec2 idB = floor(uv*118.0 + 7.0);',
    '  float ha = h21(idA + 0.7);',
    '  float hb = h21(idA + 4.3);',
    '  float hc = h21(idA + 8.9);',
    '  float hd = h21(idB + 5.5);',
    /* 原地：浅的石灰石/白云石为主，夹几颗深的花岗岩 */
    '  vec3 fchip = mix(vec3(0.80,0.775,0.715), vec3(0.60,0.578,0.530), ha);',
    '  fchip = mix(fchip, vec3(0.36,0.345,0.325), step(0.88, hb));',
    '  fchip = mix(fchip, vec3(0.80,0.775,0.715), step(0.92, hc));',
    /* 补块：深色的玄武岩/黑石子为主，间几颗白的大理石和琥珀色玻璃 */
    '  vec3 pchip = mix(vec3(0.095,0.092,0.090), vec3(0.235,0.222,0.208), ha);',
    '  pchip = mix(pchip, vec3(0.72,0.700,0.640), step(0.72, hb));',
    '  pchip = mix(pchip, u_ac*0.55, step(0.93, hc));',
    /* 水泥浆：比骨料细、更匀；补块的浆也深一点（配比不同） */
    
    '  float seam = smoothstep(0.013, 0.003, A.w);',
    '  vec3 cementF = vec3(0.540,0.522,0.487)*(0.92 + 0.14*vn(uv*160.0));',
    '  vec3 cementP = vec3(0.265,0.258,0.248)*(0.90 + 0.18*vn(uv*160.0));',
    '  vec3 aggF = mix(fchip, cementF, seam*0.85);',
    '  vec3 aggP = mix(pchip, cementP, seam*0.85);',
    /* 细砂：两套骨料里都有，但补块的砂更密更暗 */
    '  float fine = h21(idB + 1.9);',
    '  aggF = mix(aggF, vec3(0.66,0.640,0.590), step(0.80, fine)*0.45);',
    '  aggP = mix(aggP, vec3(0.34,0.330,0.315), step(0.72, fine)*0.45);',
    '  vec3 alb = mix(aggF, aggP, g0);',
    /* 抛光：两种骨料磨在同一个平面上 —— 同一片柔光，同样的粗糙度 */
    '  vec2 lq = uv - vec2(-0.30, 0.34);',
    '  float sheen = exp(-(lq.x*lq.x*0.55 + lq.y*lq.y*1.10));',
    '  float fineSheen = 0.5 + 0.5*vn(uv*22.0 + 3.0);',
    '  vec3 col = alb*(0.62 + 0.55*sheen);',
    '  col += vec3(0.34,0.34,0.35)*sheen*0.34*(0.6 + 0.4*fineSheen);',
    /* 磨过的面：极细的抛光道子（同一台机器，两个区域都有） */
    '  float polish = vn(vec2(uv.x*260.0, uv.y*26.0))*0.5 + vn(vec2(uv.x*80.0, uv.y*9.0))*0.5;',
    '  col *= 0.94 + 0.10*polish;',
    /* 交界：一道锯缝（切割机的刀口），比两边都深；补块一侧的水泥略深一圈 */
    '  float saw = exp(-pow(dist/0.0035, 2.0));',
    '  col *= 1.0 - 0.38*saw;',
    '  col *= 1.0 - 0.10*exp(-dist/0.020);',
    /* 还没磨完的地方（换句时）：骨料发糊 */
    '  float unpol = (1.0 - u_st);',
    '  vec3 blur = mix(aggF, aggP, g0)*1.0;',
    '  col = mix(col, blur*0.72 + vec3(0.10,0.10,0.10), unpol*0.55);',
    /* 唱过的那一段：磨得更亮 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.10,0.10,0.11)*litFront*sheen*0.35;',
    '  col *= 1.0 + 0.03*u_kick;',
    /* 环境：地面的一块，灯在左上，远处暗下去 */
    '  float vig = 1.0 - smoothstep(0.30, 1.26, length(uv*vec2(0.60,0.92)));',
    '  col *= 0.30 + 0.70*vig;',
    '  col = 1.0 - exp(-col*1.65);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 121.0) - 0.5)*0.013;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 补块的那一块：深骨料的一层薄色，压一层很轻的水泥灰 */
  const tg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  tg.addColorStop(0.00, 'rgba(64,62,58,0.42)');
  tg.addColorStop(0.30, 'rgba(56,54,50,0.36)');
  tg.addColorStop(0.66, 'rgba(48,46,42,0.32)');
  tg.addColorStop(1.00, 'rgba(40,38,35,0.30)');
  g.fillStyle = tg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 深色石子：一小块一小块的暗斑（切面） */
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const rr = 1.5 + Math.random() * 7;
    const dark = Math.random() < 0.7;
    g.fillStyle = dark
      ? 'rgba(26,25,23,' + (0.10 + Math.random() * 0.26).toFixed(3) + ')'
      : 'rgba(206,200,186,' + (0.06 + Math.random() * 0.18).toFixed(3) + ')';
    g.beginPath();
    const n = 3 + (Math.random() * 3) | 0;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.2832 + Math.random() * 0.5;
      const rr2 = rr * (0.7 + Math.random() * 0.5);
      const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  g.restore();
  /* 锯缝：字的外缘一道很细的深 */
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(22,21,19,0.42)';
  g.lineWidth = Math.max(1, fs * 0.010);
  g.strokeText(L.text, cx, cy);`,
  post: ''
};
