export default {
  num: '278', slug: 'maki-e-lacquer', title: '莳绘黑漆',
  accent: [0.98, 0.80, 0.42],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.34,
  doc: `   278 · 莳绘黑漆 —— 字是一层堆起来的漆，金粉撒在还没干的漆上

   机制一句话：
      底是**黑漆**：一层几乎全黑的透光介质，垂直看几乎不反光（折射率 1.55，
      正入射只有 4%），只有**掠射**才亮起来（菲涅尔），所以整块漆面像一口黑水，
      只在弯起来的地方（漆边、器物的弧面）才挂出一道冷光。
      字是**莳绘**：漆被描得比底高一点（堆漆），金粉撒上去 —— 金是金属，
      每一粒都是一面小镜子，随角度闪；粉下面的漆还是黑的，所以金面并不"平"，
      有厚有薄。字的边不是画出来的：是堆起来的那道漆脊，它比字本身更亮。

   和前作的区别：
      212 锤纹黄铜 / 241 锡箔是**整片金属**：反射连续、有明确的高光走向；
      这里是**介质镜（黑漆）+ 金属颗粒（金粉）**：底几乎不反光、只吃菲涅尔，
      字是无数小镜子的统计结果 —— 所以金面没有方向性高光，只有密度与颗粒。

   动态：换句时金粉刚落上去（u_st：粉从疏到密）；唱到的那一段被手指抹得更亮（u_front）；
   拍点上金面一闪（u_kick）。`,
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
    /* 金粉：两套尺度的颗粒（细粉 + 几片大的金箔屑），每粒有自己的朝向 */
    'float gold(vec2 p, float d){',
    '  vec2 g1 = floor(p*760.0);',
    '  vec2 g2 = floor(p*260.0);',
    '  float a = h21(g1 + 1.0);',
    '  float b = h21(g2 + 9.0);',
    '  float s1 = smoothstep(0.42, 0.98, a);',
    '  float s2 = smoothstep(0.74, 0.99, b);',
    '  return s1*0.65 + s2*0.35 + d*0.25;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.7, ep*1.7, sd);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.6, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    /* 漆面：几乎全平，只有器物的弧（极缓）—— 所以只有掠射才有光 */
    '  float wob = vn(uv*1.1 + 2.0)*0.6 + vn(uv*2.4 - 3.0)*0.4;',
    '  vec2 Nl = vec2(wob - 0.5)*0.030;',
    /* 堆漆：字上比底面高一点点（0.2mm 量级），漆脊在字的边上 */
    '  float raise_ = 1.0 - smoothstep(-0.010, 0.026, sd);',
    '  Nl -= gr*raise_*0.16;',
    '  vec3 N3 = normalize(vec3(Nl, 1.0));',
    /* 黑漆：介质镜，菲涅尔随视角（这里用表面法线的倾角代替） */
    '  float fres = pow(1.0 - clamp(N3.z, 0.0, 1.0), 2.0);',
    '  float graze = pow(clamp(1.0 - abs(N3.z), 0.0, 1.0), 1.4);',
    '  vec3 lac = vec3(0.020,0.019,0.018)*(0.60 + 0.55*vn(uv*6.0 + 1.0));',
    /* 漆里的一点暖：器物对面有一盏灯，掠射时被漆面收进来 */
    '  lac += vec3(0.085,0.062,0.038)*(graze*2.6 + fres*0.9);',
    /* 漆面的一道冷窗光：只在弧起来的地方 */
    '  vec2 wq = uv + Nl*1.6;',
    '  float win = exp(-pow((wq.x + 0.62)/0.22, 2.0))*smoothstep(0.55, 0.05, abs(wq.y - 0.10));',
    '  lac += vec3(0.42,0.48,0.56)*win*(graze*3.2 + 0.05);',
    /* 金：粉的密度 + 每粒的朝向（金粒的反射是散开的，没有统一的高光方向） */
    '  float dens = 0.45 + 0.55*vn(uv*10.0 + 5.0);',
    '  dens *= 0.70 + 0.30*vn(uv*34.0 - 2.0);',
    '  dens *= 0.70 + 0.55*u_st;',
    '  float d = clamp(dens, 0.0, 1.4);',
    '  float gp = gold(uv, d);',
    '  float spk = pow(gp, 2.2);',
    '  vec3 goldc = mix(vec3(0.30,0.20,0.070), vec3(1.00,0.84,0.44), clamp(gp*1.1, 0.0, 1.0));',
    '  goldc *= 0.55 + 0.85*d;',
    '  goldc += vec3(1.0,0.92,0.62)*spk*0.55;',
    /* 金面下面还是黑漆：粒与粒之间的缝里透出漆的暗 */
    '  goldc *= 0.62 + 0.55*smoothstep(0.30, 0.85, gp);',
    /* 合：字的边界是漆脊（比字本身亮） */
    '  float goldw = g0*(0.55 + 0.45*smoothstep(0.10, 0.55, d));',
    '  vec3 col = mix(lac, goldc, goldw);',
    '  /* 漆脊：贴边一圈被光咬住的高光（堆起来的漆最高、最亮） */',
    '  float ridge = exp(-pow((dist - 0.009)/0.005, 2.0));',
    '  col += vec3(0.55,0.60,0.68)*ridge*(0.20 + 0.55*max(0.0, dot(gr, normalize(vec2(-0.40,0.50)))))*0.55;',
    '  /* 金边：字的最外一圈是漆脊上的金，亮而细 */',
    '  col += vec3(1.0,0.86,0.50)*exp(-pow((dist - 0.004)/0.0035, 2.0))*0.22;',
    /* 唱过的那一段：被抹得更亮（金被压实） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(1.0,0.86,0.52)*litFront*g0*0.055;',
    '  col *= 1.0 + 0.06*u_kick;',
    /* 环境：黑漆器，四周是黑的，只有一件东西被光照到 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.15 + pq.y*pq.y*0.95));',
    '  float vig = 1.0 - smoothstep(0.16, 1.16, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.16 + 0.84*vig;',
    '  col += vec3(0.035,0.026,0.016)*pool*0.65;',
    '  col = 1.0 - exp(-col*2.10);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 111.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 洒了金粉的一段漆：粉有厚薄，稠的地方成片、稀的地方透出漆的黑 */
  const gg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  gg.addColorStop(0.00, '#e8c274');
  gg.addColorStop(0.24, '#cfa050');
  gg.addColorStop(0.50, '#a97c34');
  gg.addColorStop(0.76, '#6f5222');
  gg.addColorStop(1.00, '#3c2a10');
  g.fillStyle = gg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 金粉：细的亮点 + 几片金箔屑，分布不匀（撒粉的手不会匀） */
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const big = Math.random() < 0.06;
    const rr = big ? 1.4 + Math.random() * 2.4 : 0.4 + Math.random() * 0.9;
    const a = big ? 0.30 + Math.random() * 0.45 : 0.10 + Math.random() * 0.45;
    g.fillStyle = 'rgba(255,' + (222 + (Math.random() * 26) | 0) + ',' + (150 + (Math.random() * 70) | 0) + ',' + a.toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  /* 粉薄的几块：透出底下的黑漆 */
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * pw, y = cy + (Math.random() - 0.5) * fs;
    const rr = fs * (0.10 + Math.random() * 0.28);
    const rg = g.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, 'rgba(14,10,6,0.30)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  g.restore();
  /* 堆漆的脊：字的外缘一道很细的暖亮 */
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,236,190,0.26)';
  g.lineWidth = Math.max(1, fs * 0.012);
  g.strokeText(L.text, cx, cy);`,
  post: ''
};
