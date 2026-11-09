export default {
  num: '276', slug: 'blind-deboss-leather', title: '压花皮革',
  accent: [0.90, 0.62, 0.36],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.38,
  doc: `   276 · 压花皮革 —— 字是烫压模子压进去的一个浅坑，皮革的粒面在坑里被压平了

   机制一句话：
      皮革的表面是一层**粒面**：一粒一粒鼓起来的小丘（真皮的粒面 = 毛囊与纤维束撑起来的
      圆顶），粒与粒之间是深沟。字是**冷压**进去的浅坑：模子把这一块粒面**压塌**了 ——
      粒变扁、沟变浅、表面被压得发亮（压光的蜡感），坑的上缘翻起一道被推挤的褶，
      下缘是一条被压出来的硬边。所以字不是画上去的，是"这一块皮被压过"：
      亮度完全来自斜光在粒面上的走向 —— 迎光的一侧亮、坑底和背光侧沉下去。

   和前作的区别：
      210 纸浆压凸是**加料**（纸浆堆起来，纤维材料、无光泽）；
      240 是釉脊（玻璃质、有高光）；243 毛毡是被针戳（竖直的孔，纤维纠缠）；
      这里是**皮革的粒面**：圆顶的粒、压塌的粒、被压光的那层蜡 —— 一种有"粒"的材料被压平。

   动态：换句时模子刚压下去、皮还在回弹（u_st）；唱到的那一段被压得更实更亮（u_front）；
   拍点上整块皮微微一沉（u_kick）。`,
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
    /* 粒面：一团 Voronoi —— F1 到格心的向量就是这粒的坡度，F2-F1 是粒之间的沟 */
    'vec4 pebble(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float d1 = 8.0, d2 = 8.0;',
    '  vec2 r1 = vec2(0.0);',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g + 1.7), h21(ip + g + 5.3))*0.78 + 0.11;',
    '      vec2 r = g + o - fp;',
    '      float d = dot(r, r);',
    '      if (d < d1) { d2 = d1; d1 = d; r1 = r; } else if (d < d2) { d2 = d; }',
    '    }',
    '  }',
    '  return vec4(sqrt(d1), sqrt(d2) - sqrt(d1), r1);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.8, ep*1.8, sd);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.6, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    /* 两套粒面：细的（没压过的）和压塌后稍大的（粒被摊开） */
    '  vec4 A = pebble(uv*56.0 + 3.0);',
    '  vec4 B = pebble(uv*40.0 - 7.0);',
    '  vec4 P = mix(A, B, g0*0.55);',
    '  vec2 gd = normalize(P.zw + vec2(1e-5));',
    '  float rr = clamp(P.x/0.46, 0.0, 0.985);',
    '  float slope = rr/sqrt(1.0 - rr*rr);',
    /* 粒面的法线：粒心平、靠边陡（圆顶），粒与粒之间是一道塌下去的沟 */
    '  float amp = mix(1.0, 0.42 + 0.14*u_st, g0);',
    '  vec2 N = gd*slope*0.42*amp;',
    '  float crease = smoothstep(0.22, 0.02, P.y);',
    '  N *= 1.0 - 0.45*crease;',
    '  /* 坑：字比皮面低一层，坑的上内壁压出褶、下内壁是硬的亮边 */',
    '  float faceLit = dot(gr, normalize(vec2(-0.58, 0.46)));',
    '  float wall = exp(-pow(dist/0.013, 2.0));',
    '  N += gr*mix(0.34, -0.10, g0)*exp(-pow((dist - 0.004)/0.010, 2.0));',
    '  vec3 N3 = normalize(vec3(N, 1.0));',
    '  /* 皮：深棕，压过的地方更暗一点（蜡被压进去了）、更滑 */',
    '  vec3 leather = vec3(0.205,0.125,0.070);',
    '  leather *= 0.80 + 0.36*vn(uv*9.0 + 1.0);',
    '  leather *= 0.90 + 0.18*vn(uv*31.0 - 4.0);',
    '  leather *= mix(1.0, 1.78, g0);',
    '  /* 粒上的灰（毛孔里的脏）：一点极细的点 */',
    '  float pore = smoothstep(0.90, 0.995, h21(floor(uv*340.0) + 11.0));',
    '  leather *= 1.0 - 0.35*pore;',
    /* 光：左上一束斜光（压印全靠它才看得见） */
    '  vec3 L = normalize(vec3(-0.56,0.44,0.70));',
    '  vec3 V = vec3(0.0,0.0,1.0);',
    '  float d1 = max(dot(N3, L), 0.0);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N3, H), 0.0), 22.0);',
    '  float sheen = pow(max(dot(N3, H), 0.0), 5.0);',
    /* 第二盏灯：右下一点很弱的补光（皮是有厚度的，坑底不能全黑） */
    '  vec3 L2 = normalize(vec3(0.58,-0.30,0.76));',
    '  float d2 = max(dot(N3, L2), 0.0);',
    '  vec3 col = leather*(0.24 + 1.05*d1);',
    '  col += leather*vec3(1.0,0.86,0.72)*d2*0.30;',
    /* 压光的蜡面：只有被模子压过的地方才有的那片宽反光（真皮用久了也是亮的） */
    '  float wax = pow(max(dot(N3, normalize(H + vec3(0.10,0.06,0.0))), 0.0), 7.0);',
    '  col += vec3(0.66,0.48,0.30)*wax*g0*0.42;',
    /* 坑底的接触影（AO）：贴壁一圈压暗，坑心稍亮 —— 一眼能看出这是个坑 */
    '  float aoIn = 1.0 - 0.26*exp(-pow((dist - 0.004)/0.012, 2.0));',
    '  col *= mix(1.0, aoIn, g0);',
    '  /* 压光的地方（字里）有一点蜡的镜面 —— 皮革被压过才会那样 */',
    '  col += vec3(0.78,0.58,0.34)*spec*mix(0.16, 1.70, g0)*0.80;',
    '  col += vec3(0.55,0.40,0.24)*exp(-pow((sd - 0.0045)/0.0055, 2.0))*max(0.0, faceLit)*0.45;',
    '  col += leather*vec3(1.0,0.86,0.70)*sheen*0.20;',
    '  float inward = smoothstep(0.005, -0.005, sd);',
    /* 压痕的上下两条内壁：上壁被唇口挡出影、下壁被模子压光 —— 盲压全靠这一对边看 */
    '  float topE = max(0.0, gr.y);',
    '  float botE = max(0.0, -gr.y);',
    '  float edgeB = exp(-pow((dist - 0.0030)/0.0052, 2.0));',
    '  col *= 1.0 - 0.66*edgeB*inward*topE;',
    '  col += vec3(0.52,0.35,0.19)*edgeB*inward*botE*0.95;',
    '  col *= 1.0 - 0.18*wall*inward*max(0.0, -faceLit);',
    '  col += vec3(0.22,0.15,0.08)*wall*inward*max(0.0, faceLit)*0.40;',
    '  col *= 1.0 + 0.10*wall*faceLit*(1.0 - g0*0.6);',
    '  /* 坑底：贴壁的一圈暗（影子落进坑里） */',
    '  col *= 1.0 - 0.42*exp(-pow((dist - 0.002)/0.006, 2.0))*(1.0 - max(0.0, faceLit))*1.0;',
    '  /* 唱过的那一段：压得更实、更亮 */',
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.55,0.38,0.20)*litFront*g0*0.045;',
    '  col *= 1.0 + 0.03*u_kick;',
    /* 环境：一大张皮，只有中间被光照到 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.15 + pq.y*pq.y*0.95));',
    '  float vig = 1.0 - smoothstep(0.18, 1.20, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.20 + 0.80*vig;',
    '  col += vec3(0.050,0.030,0.016)*pool*0.70;',
    '  col = 1.0 - exp(-col*1.55);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 91.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 压过的那一块皮：更平、更暗一点，上缘压出一道褶、下缘是硬亮的边 */
  /* 压痕：上内壁落下来的影 → 下缘被压光的亮（这就是盲压一眼能认出来的原因） */
  const lg = g.createLinearGradient(0, cy - fs * 0.58, 0, cy + fs * 0.60);
  lg.addColorStop(0.00, 'rgba(26,14,6,0.62)');
  lg.addColorStop(0.22, 'rgba(40,22,10,0.42)');
  lg.addColorStop(0.48, 'rgba(96,60,30,0.20)');
  lg.addColorStop(0.74, 'rgba(176,122,72,0.26)');
  lg.addColorStop(1.00, 'rgba(206,150,96,0.34)');
  g.fillStyle = lg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 压光的粒：贴合字形的细圆点（被压塌的粒面） */
  for (let i = 0; i < 520; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const rr = 1 + Math.random() * 5;
    g.fillStyle = Math.random() < 0.5
      ? 'rgba(158,112,66,' + (0.03 + Math.random() * 0.09).toFixed(3) + ')'
      : 'rgba(28,15,6,' + (0.05 + Math.random() * 0.12).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  /* 下缘的亮边（被模子压出来的硬边） */
  const edge = g.createLinearGradient(0, cy + fs * 0.20, 0, cy + fs * 0.60);
  edge.addColorStop(0, 'rgba(214,168,116,0.00)');
  edge.addColorStop(0.70, 'rgba(206,158,104,0.16)');
  edge.addColorStop(1.00, 'rgba(120,82,44,0.00)');
  g.fillStyle = edge;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
