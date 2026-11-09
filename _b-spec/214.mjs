export default {
  num: '214', slug: 'pool-floor', title: '池底的字',
  accent: [0.62, 0.88, 0.86],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0,
  doc: `   214 · 池底的字 —— 字是画在泳池瓷砖上的，你隔着一层晃动的水看它

   机制一句话：
     视线穿过水面（两组波的法线）折进水里，落点被**位移**，于是池底的瓷砖和
     墙上的字一起在水下晃；焦散的光斑从水面聚到池底，扫过字面；字的边缘有一圈
     水线（弯月面），越往画面外水越深越青 —— 字是**被水折射着看**的，不是浮在水上。

   和前作的区别：
     013 是"字在水前面、水在字后面"（字钉死不动，只有背景在流）；
     这里是**字本身被水折射**（采样点位移、焦散落在字面上、边缘有水线），
     而且画面里没有封面、没有粒子，只有瓷砖、水、光。

   换句：字重新"画"上去（未唱到的部分略暗），焦散相位跟着句首打一下。`,
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
    /* 池底瓷砖：错缝铺 + 缝里的暗 + 每块砖的色差 */
    'vec3 tiles(vec2 p, out float groutOut){',
    '  vec2 tp = p*7.0;',
    '  tp.x += step(1.0, mod(floor(tp.y), 2.0))*0.5;',
    '  vec2 id = floor(tp), f = fract(tp);',
    '  float gr = min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y));',
    '  float g = smoothstep(0.030, 0.085, gr);',
    '  float tone = h21(id + 3.7);',
    '  vec3 c = mix(vec3(0.040,0.098,0.104), vec3(0.072,0.158,0.158), tone);',
    '  c *= 0.62 + 0.38*g;',
    '  groutOut = g;',
    '  return c;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    /* 水面法线：两组波 + 一点细纹 */
    '  float t = u_t;',
    '  vec2 n = vec2(0.0);',
    '  n.x += cos(uv.x*5.2 + uv.y*1.7 + t*1.05)*0.55;',
    '  n.y += cos(uv.y*4.6 - uv.x*1.3 - t*0.85)*0.55;',
    '  n.x += cos(uv.x*11.0 - uv.y*3.4 + t*1.7)*0.22;',
    '  n.y += cos(uv.y*9.5 + uv.x*2.8 - t*1.35)*0.22;',
    '  n *= 0.0026;',
    '  vec2 ruv = uv + n;',
    '  float sd = gsd(ruv);',
    '  float e = u_epx;',
    /* 焦散：两组干涉的亮斑，慢速游走 */
    '  float c1 = sin(ruv.x*9.0 + t*0.55) * sin(ruv.y*7.4 - t*0.42);',
    '  float c2 = sin((ruv.x+ruv.y)*13.0 - t*0.75) * sin((ruv.x-ruv.y)*10.5 + t*0.62);',
    '  float caust = pow(clamp(0.5 + 0.5*c1, 0.0, 1.0), 5.0)*1.0 + pow(clamp(0.5 + 0.5*c2, 0.0, 1.0), 6.0)*0.7;',
    /* 池底 + 字 */
    '  float g = 1.0;',
    '  vec3 floorC = tiles(ruv, g);',
    '  float paint = 1.0 - smoothstep(-u_epx*1.6, u_epx*1.6, sd);',
    '  /* 字是刷在砖上的：砖缝还在，漆面有点旧 */',
    '  float age = vn(ruv*38.0 + 3.0)*0.55 + vn(ruv*90.0)*0.45;',
    '  vec3 cream = mix(vec3(0.78,0.74,0.62), u_ac*0.85, 0.18);',
    '  cream *= 0.80 + 0.30*age;',
    '  vec3 alb = mix(floorC, cream, paint*0.90);',
    '  alb *= 0.80 + 0.20*g;',
    /* 焦散落在池底上：字面上更亮（漆比砖亮，反射更多光） */
    '  vec3 col = alb*(0.55 + 1.55*caust*(0.75 + 0.55*paint));',
    '  /* 字缘的水线：一圈亮的水，把字"包"住 */',
    '  float men = exp(-pow((sd + u_epx*0.8)/(u_epx*1.7), 2.0));',
    '  col += vec3(0.42,0.68,0.70)*men*0.55;',
    /* 水的吸收：越远越青、越暗 */
    '  float depth = length(uv*vec2(0.72,0.95));',
    '  vec3 water = mix(vec3(0.020,0.070,0.086), vec3(0.006,0.026,0.040), clamp(depth,0.0,1.0));',
    '  col = mix(col, water, 0.22 + 0.52*clamp(depth - 0.18, 0.0, 1.0));',
    /* 水面反光：上方一条缓慢移动的亮带 */
    '  float surf = exp(-pow((uv.y - 0.42 - 0.06*sin(uv.x*2.4 + t*0.3))/0.13, 2.0));',
    '  col += vec3(0.10,0.22,0.24)*surf*(0.5 + 0.5*sin(t*0.9 + uv.x*3.0))*0.55;',
    '  col += vec3(0.06,0.12,0.13)*caust*0.18;',
    /* 已经唱过的那一段：漆更亮、水线更清楚 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += cream*litFront*paint*0.10;',
    '  col *= 1.0 + 0.06*u_kick;',
    '  float vig = 1.0 - smoothstep(0.18, 1.52, length(uv*vec2(0.62,0.88)));',
    '  col *= 0.40 + 0.60*vig;',
    '  col = 1.0 - exp(-col*1.45);',
    '  col += (h21(gl_FragCoord.xy*0.8 + 2.0) - 0.5)*0.009;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: '',
  post: ''
};
