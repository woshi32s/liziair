export default {
  num: '277', slug: 'velvet-nap', title: '丝绒绒面',
  accent: [0.86, 0.34, 0.40],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.06,
  doc: `   277 · 丝绒绒面 —— 字是顺着笔画被抚过的那一片，绒毛全都倒向另一边

   机制一句话：
      丝绒的颜色不跟着色走，跟着**绒毛的倒向**走：绒面是一层竖着的短绒，
      光从哪边来，倒向哪边的绒就亮（绒尖迎着光），倒向相反的那边就暗 ——
      同一块料、同一个颜色，只要把绒**抚反**，明暗就整个翻过来。
      字是人用手（或刷子）顺着笔画抚过的一片：绒全倒向一侧，于是它在一片朝向相反、
      发暗的绒里亮起来；字的边上一圈绒被推得半倒，是渐渐过渡的，不是切出来的。

   和前作的区别：
      243 毛毡是**没有方向**的纠缠纤维（纯漫反射，只剩明暗）；
      277 这里整块布的明暗**只由一个方向决定**：绒毛的倒向。
      它没有高光、没有阴影、没有高度差 —— 只有"绒往哪边倒"这一件事。

   动态：换句时手刚抚过去（u_st：绒从半倒到全倒）；唱到的那一段被抚得更顺（u_front）；
   拍点上绒面一颤（u_kick，明暗界线轻轻晃）。`,
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
    /* 一组沿 nap 方向拉长的绒：q 的 y 是"跨过绒"的方向，所以频率高 */
    'float pile(vec2 uv, float a){',
    '  vec2 d = vec2(cos(a), sin(a));',
    '  vec2 q = vec2(dot(uv, d), dot(uv, vec2(-d.y, d.x)));',
    '  float f1 = vn(vec2(q.x*14.0, q.y*150.0));',
    '  float f2 = vn(vec2(q.x*40.0 + 5.0, q.y*330.0));',
    '  float f3 = vn(vec2(q.x*6.0 - 3.0, q.y*68.0));',
    '  return f1*0.45 + f2*0.32 + f3*0.23;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.7, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    /* 光从左上来（2D 角度） */
    '  float aL = 2.36;',
    /* 绒的倒向：整块布都倒向一边，字里被抚成反的；边界上还有一圈半倒的 */
    '  float aOut = aL + 3.1416 + 0.22*sin(uv.x*2.2 + uv.y*1.3) + 0.10*(vn(uv*2.4) - 0.5);',
    '  float aIn = aL + 0.16 + 0.18*(vn(uv*1.9 + 4.0) - 0.5);',
    '  float flipw = smoothstep(0.010, -0.010, sd)*(0.55 + 0.45*u_st);',
    '  float bend = exp(-pow(dist/0.013, 2.0));',
    '  float a = mix(aOut, aIn, flipw);',
    '  a += bend*0.55;',
    /* 绒面亮度：绒尖迎着光就亮，背过去就暗 —— 这是丝绒唯一的"颜色" */
    '  float al = 0.5 + 0.5*cos(a - aL);',
    '  float sh = pow(al, 2.2);',
    '  float pv = pile(uv, a);',
    /* 大块的绒被压过/抚过的痕（不是花纹，是绒的松紧） */
    '  float crush = vn(uv*3.2 + 7.0)*0.6 + vn(uv*7.5 - 2.0)*0.4;',
    '  sh *= 0.78 + 0.42*crush;',
    
    /* 绒：深酒红；亮的地方是绒尖上的光，暗的地方是绒根 */
    '  vec3 deep = vec3(0.145,0.034,0.058);',
    '  vec3 litc = vec3(0.760,0.250,0.270);',
    '  vec3 col = mix(deep, litc, clamp(sh, 0.0, 1.0));',
    /* 绒根的一点过渡：亮区里也有一点暗的颗粒（绒不是均匀的） */
    '  col *= 0.58 + 0.86*pv;',
    '  col += deep*(0.55 + 0.75*pv)*0.75;',
    /* 边界那圈半倒的绒：比两边都暗一点点（绒折过去，挡住了自己） */
    '  col *= 1.0 - 0.22*bend;',
    /* 唱过的那一段：绒更顺（更亮、更少颗粒） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.20,0.05,0.055)*litFront*flipw*0.35;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：一块搭着的绒，光从左上斜进来 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.15 + pq.y*pq.y*0.95));',
    '  float vig = 1.0 - smoothstep(0.20, 1.24, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.42 + 0.58*vig;',
    '  col += vec3(0.045,0.012,0.018)*pool*0.60;',
    '  col = 1.0 - exp(-col*1.70);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 101.0) - 0.5)*0.011;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 抚顺的那一片：绒尖的亮，很薄一层，让着色器的绒还在底下 */
  const vg = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  vg.addColorStop(0.00, 'rgba(196,86,86,0.30)');
  vg.addColorStop(0.34, 'rgba(168,62,66,0.26)');
  vg.addColorStop(0.70, 'rgba(120,36,44,0.20)');
  vg.addColorStop(1.00, 'rgba(78,20,28,0.16)');
  g.fillStyle = vg;
  g.fillText(L.text, cx, cy);`,
  post: ''
};
