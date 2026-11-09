export default {
  num: '215', slug: 'mist-shadow', title: '雾幕投影',
  accent: [0.70, 0.78, 0.90],
  fibers: false, motes: true, plateBlend: 'source-over', plateAlpha: 0,
  doc: `   215 · 雾幕投影 —— 画面里没有字，只有雾里一块被挡住的光

   机制一句话：
     一束斜光穿过后场的雾，雾被照亮成一片发光的光幕；字是**某个不在画面里的
     东西投在雾上的影**：影子把那个区域的散射光吃掉，边缘被雾的密度场糊开、随雾
     缓慢漂移 —— 你读到的字，是"没有光的那块地方"。

   和前作的区别：
     016 极光是"发光体本身"，019 墨云是"墨在纸上的沉积"，都是往画面上**加**东西；
     这里反过来 —— 字是**减掉**光的结果，亮度全靠雾的散射（单次散射模型：
     光强 ∝ 雾密度 × 光束内积），影子是乘性遮罩，不是黑色贴图。

   为什么读得出来：影子边缘只糊开 ~3px，笔画还有 10px 宽；影子内部几乎全黑，
     周围是亮的雾，对比足够。`,
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
    'float fbm(vec2 p){',
    '  float s = 0.0, a = 0.5;',
    '  for (int i = 0; i < 3; i++) { s += a*vn(p); p *= 2.07; a *= 0.5; }',
    '  return s;',
    '}',
    'float gsd(vec2 uv){',
    '  vec2 tc = vec2(0.5 + (uv.x-u_gc.x)/(2.0*u_gh.x), 0.5 - (uv.y-u_gc.y)/(2.0*u_gh.y));',
    '  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 127.0*u_gk;',
    '  return (texture2D(u_g, tc).r*255.0 - 128.0) * u_gk;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    /* 光幕：自右上斜射下来的一片扇形，越靠中心越亮 */
    '  float band = uv.x*0.52 + uv.y*0.85;',
    '  float beam = exp(-pow((band - 0.42)/0.52, 2.0));',
    '  float cone = smoothstep(-1.25, 0.15, uv.y*0.7 + uv.x*0.35);',
    /* 雾：两层慢速漂移的密度场，越靠近光幕越亮 */
    '  float f1 = fbm(uv*4.4 + vec2(t*0.022, -t*0.014));',
    '  float f2 = fbm(uv*9.5 - vec2(t*0.036, t*0.024) + 11.0);',
    '  float fog = 0.52 + 0.48*(f1*0.58 + f2*0.42);',
    '  fog *= 0.55 + 0.85*cone;',
    /* 影子：采样点被雾推着走一点点，边缘就毛了 */
    '  vec2 wob = vec2(vn(uv*3.1 + t*0.06) - 0.5, vn(uv*2.7 - t*0.05 + 9.0) - 0.5)*0.0055;',
    '  vec2 soff = vec2(-0.010, -0.007);   /* 光在右上，影落左下 */',
    '  float s1 = gsd(uv + soff + wob);',
    '  float sh = 1.0 - smoothstep(-0.008 - 0.010*fog, 0.020 + 0.026*fog, s1);',
    '  float shSoft = 1.0 - smoothstep(-0.030, 0.046, gsd(uv + soff*1.9 + wob));',
    /* 雾的亮度：光 × 密度 */
    '  float lit = beam*fog*(0.42 + 0.95*f1);',
    '  vec3 cool = vec3(0.30,0.38,0.46);',
    '  vec3 warm = mix(vec3(0.85,0.80,0.70), u_ac, 0.35);',
    '  vec3 col = mix(cool*0.20, warm, clamp(lit*1.9, 0.0, 1.0))*lit*1.25;',
    /* 影子的乘性遮罩：影子里只剩一点点环境光 */
    '  col *= (1.0 - 0.90*sh)*(1.0 - 0.35*shSoft);',
    '  col += cool*0.010*(1.0 - sh);',
    /* 影子边缘的散射亮边（光绕过物体） */
    '  float edge = exp(-pow((s1 - 0.004)/(0.008), 2.0));',
    '  col += warm*edge*0.16*(0.4 + 0.6*lit);',
    /* 空气里的浮尘：光幕里的亮点 */
    '  float dust = smoothstep(0.985, 1.0, h21(floor(uv*220.0) + floor(t*2.0)*13.0));',
    '  col += warm*dust*beam*0.35*fog;',
    /* 已经唱过的那一段：影子更实（像被声音"定"住） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col *= 1.0 - 0.10*sh*litFront;',
    '  col *= 1.0 + 0.05*u_kick;',
    '  float vig = 1.0 - smoothstep(0.15, 1.55, length(uv*vec2(0.60,0.86)));',
    '  col *= 0.42 + 0.58*vig;',
    '  col = 1.0 - exp(-col*1.35);',
    '  col += (h21(gl_FragCoord.xy*0.85 + 4.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: '',
  post: ''
};
