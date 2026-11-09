export default {
  num: '249', slug: 'liquid-mercury', title: '液态汞',
  accent: [0.80, 0.88, 0.94],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.10,
  doc: `   249 · 液态汞 —— 字是刻在钢板上的沟，沟里积满汞摊成一面镜子

   机制一句话：
      汞的表面张力（0.48 N/m）极大：沟里的一汪汞会**自己摊平**成一个近乎理想的镜面；
      沟沿上它被壁面拉住、爬上去一点又塌下来 —— 那就是一圈**弯月面**：
      一圈又窄又亮的弧（表面在这里斜率最大，把整面窗的光收成一条），弧的内侧是接触线压出的一道黑。
      所以画面里唯一能**映出东西**的地方就是字：字里是房间的倒影（一扇带十字框的窗、
      两根灯管、货架的剪影）；而沟外只剩一层薄薄的残汞（液面更低、更暗、碎成珠），
      底下的钢板从薄膜里透出来 —— 两层液面的高度差，就是"汞"和"抛光金属"的分界。

   和前作的区别：
      212 锤纹黄铜是抛光钢板：靠灯带的高光，反射的是"光"，不是"像"；
      242 湿沥青是水膜（反射率 2~4%，只映得出正上方那盏灯）；
      这里是**液态金属**：反射率 ~75%，而且**液面有高度差** ——
      沟里是一池、沟外是一层薄膜，两层液面差几微米，倒影因此错开；
      镜里能数清窗框，沟沿有一圈弯月面的亮弧 —— 这两件抛光的钢都做不到。

   动态：换句时沟里刚灌满（u_st，液面还在晃）；被唱到的那一段液面更平、倒影更清（u_front）；
   拍点激起毛细波（u_kick，幅度小、频率高 —— 表面张力大的液体的特征）。`,
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
    /* 汞里映出来的房间：一扇带十字框的窗、两根灯管、货架的剪影、角落一盏暖灯 */
    'vec3 scene(vec2 p){',
    '  vec3 c = vec3(0.135,0.150,0.175)*(0.82 + 0.34*vn(p*1.8 + 2.0));',
    /* 窗：占大半个视野的冷白天光（镜里数得清窗框） */
    '  vec2 wp = p - vec2(0.04, 0.04);',
    '  float pane = smoothstep(0.70, 0.63, max(abs(wp.x)/2.55, abs(wp.y)/0.58));',
    /* 每一格窗的亮度不一样（有的对着天、有的对着对面的楼）—— 一眼就是"窗的倒影" */
    '  vec2 pc = floor(vec2(wp.x/1.10, wp.y/1.15));',
    '  float ph = h21(pc + 11.0);',
    '  vec3 sky = vec3(0.80,0.86,0.93)*(0.52 + 0.66*ph);',
    '  sky *= 0.92 + 0.10*vn(p*3.2 + 7.0);',
    '  c = mix(c, sky, pane);',
    /* 窗棂：竖的每格一根、横的一根，笔直地跨过整句 */
    '  float mx = abs(fract(wp.x/1.10 + 0.5) - 0.5)*1.10;',
    '  float my = abs(fract(wp.y/1.15 + 0.5) - 0.5)*1.15;',
    '  float mull = exp(-pow(mx/0.030, 2.0)) + exp(-pow(my/0.026, 2.0));',
    '  c *= 1.0 - 0.92*clamp(mull, 0.0, 1.0)*pane;',
    /* 窗里更亮的一块（天光最足的那格） */
    '  c += vec3(0.14,0.15,0.17)*pane*exp(-pow(length((wp - vec2(-0.85,0.20))*vec2(0.75,1.5))/0.65, 2.0));',
    /* 两根灯管：极窄的亮线，横穿整幅（只有镜面才有一条笔直的、跨过每个字的亮线） */
    '  float tube = exp(-pow((p.y + 0.30)/0.016, 2.0))*0.95 + exp(-pow((p.y - 0.62)/0.012, 2.0))*0.45;',
    '  c += vec3(1.0,1.0,0.98)*tube;',
    /* 货架剪影：一条暗的横带 + 两根竖的分格（能认出来的"东西"） */
    '  float shelfY = smoothstep(0.030, 0.0, abs(p.y + 0.74));',
    '  float shelfX = smoothstep(0.022, 0.0, abs(abs(p.x) - 1.35));',
    '  c *= 1.0 - 0.45*clamp(shelfY + shelfX, 0.0, 1.0);',
    /* 屋里的一盏暖灯 */
    '  c += u_ac*exp(-pow((p.x + 1.55)/0.34, 2.0) - pow((p.y + 0.20)/0.24, 2.0))*0.30;',
    /* 远处暗下去 */
    '  c *= mix(1.0, 0.50, smoothstep(0.95, 1.60, abs(p.y)));',
    '  c *= mix(1.0, 0.62, smoothstep(1.90, 2.60, abs(p.x)));',
    '  return c;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.5, ep*1.5, sd);',
    '  float e = max(ep*1.6, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    '  float dist = abs(sd);',
    '  float inside = smoothstep(0.0045, -0.0025, sd);',
    /* 液面：几乎全平；拍点激出一圈高频小振幅的毛细波 */
    '  float amp = 0.008 + 0.042*u_kick + 0.052*(1.0 - u_st);',
    '  float w1 = sin(uv.x*29.0 + t*2.2 + vn(uv*2.0)*2.4);',
    '  float w2 = sin(uv.y*35.0 - t*1.7 + vn(uv*2.7 + 4.0)*2.6);',
    '  float wSlow = sin(uv.x*5.2 + uv.y*2.6 + t*0.55 + vn(uv*1.2)*3.4);',
    '  vec2 ripple = vec2(w1*amp, w2*amp*0.85 + wSlow*amp*1.6);',
    /* 沟里：一池满的汞。中央微鼓（起毛细面），贴壁一圈是弯月面 */
    '  vec2 N = ripple + (uv - u_gc)*0.150;',
    '  float wall = smoothstep(0.030, 0.0, dist);',
    '  N += gr*wall*wall*0.40*inside;',
    '  vec2 q = uv + N*0.85;',
    '  vec3 mer = scene(q*2.3);',
    /* 弯月面：斜率最大的一圈，把整面窗的光收成一道亮弧（比池面亮） */
    '  float men = exp(-pow((dist - 0.0068)/0.0028, 2.0))*inside;',
    '  mer += vec3(0.94,0.97,1.00)*men*0.40;',
    '  mer *= 0.94 + 0.22*pow(wall, 2.0);',
    /* 接触线：贴壁处镜面塌下去 → 一道很细的黑 */
    '  mer *= 1.0 - 0.50*exp(-pow((dist - 0.0026)/0.0022, 2.0))*inside;',
    '  mer *= (0.82 + 0.18*u_st);',
    /* 沟外：一层薄残汞（液面更低、更暗、碎成珠），底下是发黑的钢板 */
    '  float mach = 0.5 + 0.5*sin(uv.y*44.0 + vn(uv*1.7)*4.2 + uv.x*0.5);',
    '  float fine = vn(uv*46.0 + 3.0);',
    '  vec3 steel = vec3(0.020,0.021,0.023)*(0.74 + 0.40*mach)*(0.86 + 0.26*fine);',
    '  steel += vec3(0.045,0.048,0.052)*pow(mach, 6.0)*0.22;',
    /* 薄膜的覆盖率：成片地有、成片地没有（汞在钢上本来就不容易铺开），并且只摊在沟边 */
    '  float filmMask = smoothstep(0.34, 0.62, vn(uv*3.1 + 9.0)*0.7 + vn(uv*7.3 - 4.0)*0.3);',
    '  filmMask *= exp(-pow(max(sd, 0.0)/0.105, 1.4));',
    '  vec2 qf = uv + gr*0.10 + ripple*1.6 + vec2(0.0, -0.022);',
    '  vec3 film = scene(qf*2.3);',
    /* 薄膜很薄：只带走一部分光，还碎成一片珠（珠子把像打散） */
    '  float bead = 0.55 + 0.45*vn(uv*130.0 + 7.0);',
    '  vec3 filmc = film*0.30*bead + vec3(0.012,0.013,0.016);',
    '  vec3 outC = steel + filmc*filmMask*(1.0 - g0);',
    /* 沟沿：倒角上被侧光擦亮的一窄条 + 沟外紧挨着的一道黑（液面落差） */
    '  float wallOut = smoothstep(0.009, 0.0, dist)*(1.0 - inside);',
    '  float upFace = max(0.0, dot(gr, normalize(vec2(-0.30, 0.95))));',
    '  outC += vec3(0.24,0.26,0.28)*wallOut*upFace*0.55;',
    '  outC *= 1.0 - 0.45*exp(-pow((sd - 0.0045)/0.0040, 2.0));',
    '  vec3 col = mix(outC, mer, g0);',
    /* 板上偶尔一颗溅出来的汞珠（球镜：暗球 + 左上一点高光 + 下缘反光） */
    '  vec2 gq = uv*17.0;',
    '  vec2 ci = floor(gq), cf = fract(gq) - 0.5;',
    '  vec2 rp = (vec2(h21(ci + 1.3), h21(ci + 7.7)) - 0.5)*0.50;',
    '  float rr = 0.075 + 0.060*h21(ci + 3.1);',
    '  vec2 dv = cf - rp;',
    '  float dq = length(dv)/rr;',
    '  float has = smoothstep(1.0, 0.90, dq)*step(0.958, h21(ci + 11.9))*(1.0 - g0);',
    '  float sp = smoothstep(rr*0.50, 0.0, length(dv - vec2(-0.34,0.34)*rr))*(1.0 - smoothstep(0.50, 1.0, dq));',
    '  vec3 beadCol = vec3(0.030,0.033,0.037) + vec3(0.34,0.37,0.40)*pow(max(0.0, 1.0 - dq*dq), 2.0)*0.50;',
    '  beadCol += vec3(0.98,1.0,1.0)*sp*0.95;',
    '  beadCol += vec3(0.30,0.34,0.38)*smoothstep(0.55, 1.0, dq)*0.28;',
    '  col = mix(col, beadCol, has);',
    /* 唱过的那一段：倒影里的天光更亮（像有人从窗前走过） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.85,0.90,0.96)*litFront*g0*0.075;',
    /* 环境：只有一块被窗光照到的板，四周很暗 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.16 + pq.y*pq.y*0.95));',
    '  float vig = 1.0 - smoothstep(0.22, 1.22, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.16 + 0.84*vig;',
    '  col += vec3(0.030,0.036,0.044)*pool*0.80;',
    '  col = 1.0 - exp(-col*1.75);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 13.0) - 0.5)*0.009;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 汞面只压一层极淡的冷调：镜里的窗、灯管、弯月面全都由着色器画 */
  const mg = g.createLinearGradient(0, cy - fs * 0.64, 0, cy + fs * 0.66);
  mg.addColorStop(0.00, 'rgba(206,222,234,0.22)');
  mg.addColorStop(0.34, 'rgba(186,204,218,0.10)');
  mg.addColorStop(0.62, 'rgba(150,166,180,0.05)');
  mg.addColorStop(1.00, 'rgba(96,110,124,0.10)');
  g.fillStyle = mg;
  g.fillText(L.text, cx, cy);`,
  post: ''
};
