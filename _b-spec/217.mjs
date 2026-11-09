export default {
  num: '217', slug: 'thin-film', title: '薄膜干涉',
  accent: [0.78, 0.62, 0.95],
  fibers: false, motes: false, plateBlend: 'lighter', plateAlpha: 0.26,
  doc: `   217 · 薄膜干涉 —— 字是一层膜的厚度台阶，颜色是光在膜里自己干涉出来的

   机制一句话：
     一层薄膜（膜厚 300nm 上下、缓慢流动）+ 字形处**多出 180nm 的台阶**；
     对 R/G/B 三个波长分别算薄膜反射（cos(4πnd/λ)）—— 同一个像素对红光是相长、
     对蓝光是相消，于是颜色是算出来的、不是调色板；字的边界是膜厚的台阶，
     所以字缘会跳出一圈圈**干涉条纹**（每一级 ≈ 半个波长）。

   和前作的区别：
     lizi11 全息是"载波条纹 + 离轴色散"（相位调制），lizi22 棱镜是几何色散，
     lizi23 偏振是偏振片；这里是真的**薄膜干涉**：颜色只由膜厚和波长决定，
     换一个膜厚，整条色带就整体平移 —— 所以字是"厚度差"读出来的。

   换句：台阶从 0 长到 180nm（u_st），条纹会一圈圈从字缘推开。`,
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
    /* 薄膜反射率：两层界面的干涉，相位 4πnd/λ */
    'float film(float d, float lam){',
    '  float phase = 12.5663706*1.34*d/lam + 3.1415926;',
    '  return 0.5 + 0.5*cos(phase);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float sd = gsd(uv);',
    '  float inside = 1.0 - smoothstep(-u_epx*2.0, u_epx*2.0, sd);',
    /* 膜厚：基础厚度缓慢流动（肥皂膜那样），字处多 180nm 的台阶 */
    '  float base = 300.0 + 165.0*(uv.x*0.55 + uv.y*0.80) + 16.0*(vn(uv*2.0 + t*0.03) - 0.5);',
    '  float stepN = 210.0*u_st + 22.0*(vn(uv*8.0 + 5.0) - 0.5);',
    '  float d = base + inside*stepN;',
    /* 三波长各自的反射 */
    '  float rr = film(d, 640.0);',
    '  float gg = film(d, 550.0);',
    '  float bb = film(d, 450.0);',
    '  vec3 irid = vec3(rr, gg, bb);',
    /* 反射率再乘一个整体的 Fresnel（斜看更亮） */
    '  float lum = 0.30 + 0.95*max(max(rr,gg),bb);',
    '  float filmMask = 1.0 - smoothstep(0.62, 1.22, length((uv - u_gc)*vec2(0.70,1.02)));',
    '  vec3 col = irid*lum*0.42*filmMask;',
    '  col *= mix(0.30, 1.0, filmMask);',
    '  col *= 1.0 - 0.55*inside;',
    /* 膜面的镜面反光（很软的一层） */
    '  float spec = pow(max(0.0, 0.55 + 0.45*vn(uv*3.0 + t*0.02)), 20.0);',
    '  col += vec3(0.10,0.10,0.12)*spec;',
    /* 台阶处：厚度梯度最大 → 干涉条纹挤成一条暗线再一条亮线 */
    '  float stepLine = exp(-pow(sd/(u_epx*1.7), 2.0));',
    '  col *= 1.0 - 0.55*stepLine*u_st;',
    '  col += irid*stepLine*0.25*u_st;',
    '  float fring = exp(-pow((max(sd,0.0) - u_epx*3.0)/(u_epx*1.3), 2.0));',
    '  col += vec3(0.92,0.95,1.00)*fring*0.30*u_st;',
    /* 字内亮度略高（膜更厚，反射整体更强） */
    '  col *= 1.0 + 0.04*inside;',
    /* 已经唱过的那一段：膜更薄一点（颜色偏冷） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.05,0.07,0.10)*litFront*inside;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：只有中间一小片有膜（四周是黑的），像一块飘着的薄膜 */
    '  vec2 q = uv - u_gc;',
    '  float edgeFade = 1.0 - smoothstep(0.55, 1.25, length(q*vec2(0.72,1.05)));',
    '  col *= 0.22 + 0.78*edgeFade;',
    '  float vig = 1.0 - smoothstep(0.30, 1.55, length(uv*vec2(0.60,0.86)));',
    '  col *= 0.40 + 0.60*vig;',
    '  col = 1.0 - exp(-col*1.55);',
    '  col += (h21(gl_FragCoord.xy*0.8 + 7.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 只加一层极淡的虹彩，帮眼睛把字的轮廓抓出来；不画硬边 */
  const grad = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  grad.addColorStop(0, 'rgba(150,255,225,0.55)');
  grad.addColorStop(0.32, 'rgba(140,170,255,0.50)');
  grad.addColorStop(0.62, 'rgba(255,150,235,0.55)');
  grad.addColorStop(1, 'rgba(255,220,150,0.45)');
  g.fillStyle = grad;
  g.fillText(L.text, cx, cy);`,
  post: ''
};
