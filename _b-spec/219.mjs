export default {
  num: '219', slug: 'gauze-shadow', title: '纱幕投影',
  accent: [0.94, 0.82, 0.62],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0,
  doc: `   219 · 纱幕投影 —— 三层薄纱，字是投在每一层上的影

   机制一句话：
     三张半透明的纱（不同深度）挂在逆光的灯前；字是**投影**落在每一层上 ——
     越靠后的层影子越偏、越淡（视差），纱的经纬织纹把影子**网点化**，
     纱被绷出的褶皱让织纹和影子一起起伏；亮的地方是灯透过纱眼的点，暗的是纱线。

   和前作的区别：
     215 是雾里的体积投影（单次散射的雾，一团糊影）；这里是**三张实体薄纱**：
     每层有独立的影子、独立的织纹网格、独立的视差，最后加色叠起来 ——
     所以字的边缘会有三层错动的"重影"，像真的投影落在纱上。

   读字：最前面那层影子最实（0.82），后面两层是"回声"，字的主轮廓始终清楚。`,
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
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    /* 逆光：灯在右上后方，越靠那儿越亮 */
    '  vec2 lamp = vec2(0.18, 0.16);',
    '  float back = exp(-pow(length((uv - lamp)*vec2(0.80,1.00))/1.05, 2.0));',
    '  back = 0.05 + 0.80*back;',
    /* 后场的暗：纱外是黑的 */
    '  vec3 col = vec3(0.010,0.011,0.014);',
    /* 三层纱：i=0 最靠前（影子最实），i=2 最靠后（影子偏、淡） */
    '  for (int i = 0; i < 3; i++) {',
    '    float fi = float(i);',
    /* 视差：后层影子往左上偏一点（灯在右上） */
    '    vec2 off = vec2(-0.012, 0.008)*(fi + 0.5);',
    '    float sd = gsd(uv + off);',
    '    float sh = 1.0 - smoothstep(-u_epx*2.0, u_epx*(5.0 + 3.0*fi), sd);',
    /* 纱的经纬：网格 + 褶皱（低频扭曲，让网格弯） */
    '    float sag = vn(uv*2.1 + fi*3.0 + t*0.01)*0.17 + vn(uv*5.3 - fi)*0.075;',
    '    vec2 gp = uv*46.0 + vec2(sag*30.0, sag*11.0) + vec2(fi*2.7, fi*1.9);',
    '    float wx = 0.5 + 0.5*sin(gp.x*6.2832);',
    '    float wy = 0.5 + 0.5*sin(gp.y*6.2832);',
    '    float weave = wy*(0.42 + 0.58*wx);',
    /* 纱线的粗细不匀 */
    '    weave = mix(weave, 0.5, 0.35*vn(gp*0.11));',
    '    float trans = 0.50 + 0.60*weave;',
    /* 每层的亮：灯的透过 × 织纹 × 影子 */
    '    float depth = 0.26 - fi*0.055;',
    '    vec2 cp = uv - vec2(0.0, -0.04 + fi*0.012);',
    '    float hw = 1.30 + 0.05*sin(cp.y*1.7 + fi*1.3);',
    '    float hh = 0.80 + 0.03*sin(cp.x*1.1 + fi);',
    '    float panel = (1.0 - smoothstep(hw - 0.05, hw + 0.04, abs(cp.x)))*(1.0 - smoothstep(hh - 0.10, hh + 0.05, abs(cp.y)));',
    '    depth *= panel;',
    '    float lum = back*(0.18 + 1.00*trans)*(1.0 - (0.74 + 0.06*(2.0 - fi))*sh);',
    '    vec3 tint = mix(vec3(0.86,0.90,0.98), vec3(1.00,0.92,0.78), fi*0.45 + 0.15);',
    '    col += tint*lum*depth;',
    /* 纱眼的亮点：织纹最透的地方透出灯 */
    '    col += tint*pow(weave, 5.0)*back*0.20*(1.0 - 0.5*sh)*panel;',
    '  }',
    /* 灯本身：一小团过曝的光 */
    '  col += vec3(1.00,0.94,0.82)*pow(back, 3.0)*0.16;',
    '  float hem = exp(-pow((abs(uv.x) - 1.30)/0.016, 2.0)) + exp(-pow((abs(uv.y) - 0.80)/0.016, 2.0));',
    '  col += vec3(0.55,0.48,0.36)*hem*0.10;',
    /* 已经唱过的那一段：影子更硬 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col *= 1.0 - 0.05*litFront;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境 */
    '  float vig = 1.0 - smoothstep(0.35, 1.60, length(uv*vec2(0.60,0.86)));',
    '  col *= 0.34 + 0.66*vig;',
    '  col = 1.0 - exp(-col*1.45);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 13.0) - 0.5)*0.011;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: '',
  post: ''
};
