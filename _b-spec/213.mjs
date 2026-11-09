export default {
  num: '213', slug: 'thick-glass', title: '厚玻璃',
  accent: [0.72, 0.86, 0.92],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0,
  doc: `   213 · 厚玻璃 —— 字是一块磨砂的厚玻璃，背景的虚焦光斑被它折射

   机制一句话：
     字形是一块**有厚度的玻璃浮雕**：斜面处法线偏折，把背后的虚焦光斑位移出去
     （三通道位移量不同 → 边缘色散）；光穿过玻璃被吸收（Beer-Lambert，青绿），
     顶面被磨砂打散（三取样平均 + 提亮），边缘一道菲涅尔亮线 —— 字靠**光学畸变**显形。

   和前作的区别：
     lizi70 是玻璃碎（几何碎片飞散）、lizi74 是雨滴挂在玻璃上（水滴透镜）；
     这里没有碎片也没有水滴，只有一块玻璃的**厚度场**：折射、吸收、雾面、菲涅尔。

   为什么字读得出来：磨砂顶面把背后的光斑揉成一片更亮的雾，字的轮廓就是那片雾的边，
     再叠一圈亮边和右下方的接触影 —— 0.6 降采样下也够锐。`,
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
    /* 虚焦光斑（背景）：柔边的圆盘，边缘略亮（散景的环） */
    'vec3 bokeh(vec2 p){',
    '  vec3 col = vec3(0.020,0.028,0.040);',
    '  col += vec3(0.040,0.055,0.080)*(1.0 - smoothstep(-0.20, 1.10, length(p*vec2(0.7,1.0))));',
    '  col += vec3(0.20,0.26,0.33)*exp(-pow((p.y+0.01)/0.34, 2.0))*0.80;',
    '  col += vec3(0.10,0.12,0.14)*exp(-pow((p.x-0.15)/0.55, 2.0))*0.55;',
    '  float tt = u_t*0.035;',
    '  for (int i = 0; i < 8; i++) {',
    '    float fi = float(i);',
    '    vec2 c = vec2(sin(tt*1.7 + fi*2.1)*0.62, cos(tt*1.3 + fi*1.7)*0.46);',
    '    float r = 0.13 + 0.095*sin(fi*3.7 + 1.3);',
    '    vec3 tint = mix(vec3(0.55,0.80,0.95), vec3(1.00,0.82,0.55), fract(fi*0.37 + 0.15));',
    '    float d = length(p - c);',
    '    float disc = 1.0 - smoothstep(r*0.80, r, d);',
    '    float ring = smoothstep(r*0.72, r*0.97, d)*(1.0 - smoothstep(r*0.97, r*1.04, d));',
    '    col += tint*(disc*0.34 + ring*0.20);',
    '  }',
    '  return col;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float e = u_epx*1.2;',
    '  float sd = gsd(uv);',
    '  float gx = (gsd(uv + vec2(e,0.0)) - sd)/e;',
    '  float gy = (gsd(uv + vec2(0.0,e)) - sd)/e;',
    /* 厚度：斜面环 + 顶面 */
    '  float rim = exp(-pow(sd/(u_epx*5.0), 2.0));',
    '  float ins = 1.0 - smoothstep(-u_epx*1.2, u_epx*1.2, sd);',
    /* 折射位移：斜面处偏折最强，顶面也有一点（厚玻璃的放大） */
    '  vec2 off = -vec2(gx, gy)*0.0018*(rim*1.0 + ins*0.55);',
    /* 色散：三个通道的位移量不同 */
    '  vec3 bgR = bokeh(uv + off*1.09);',
    '  vec3 bgG = bokeh(uv + off);',
    '  vec3 bgB = bokeh(uv + off*0.91);',
    '  vec3 col = vec3(bgR.r, bgG.g, bgB.b);',
    /* 磨砂顶面：三次取样糊成一片亮雾 */
    '  vec3 fr = (bokeh(uv + vec2(0.006,0.0)) + bokeh(uv - vec2(0.006,0.0)) + bokeh(uv + vec2(0.0,0.006)))/3.0;',
    '  vec3 frost = fr*2.30 + vec3(0.022,0.030,0.036);',
    '  col = mix(col, frost, ins*0.88);',
    /* 玻璃吸收：厚的地方偏青绿（Beer-Lambert 的近似） */
    '  col *= mix(vec3(1.0), vec3(0.58,0.92,0.88), ins*0.50);',
    '  col *= 1.0 - 0.18*ins;',
    '  col *= mix(vec3(1.0), vec3(0.86,1.0,0.98), rim*0.35);',
    /* 菲涅尔：边缘亮线（掠射角反射天光） */
    '  float nz = 1.0/sqrt(1.0 + gx*gx*0.011 + gy*gy*0.011);',
    '  float fres = pow(1.0 - clamp(nz,0.0,1.0), 2.0);',
    '  col += vec3(0.62,0.84,1.00)*fres*(1.10 + 0.9*u_st);',
    '  col += vec3(0.85,0.96,1.00)*rim*0.12*u_st;',
    '  vec2 gdir = normalize(vec2(gx, gy) + vec2(0.0001));',
    '  float facing = clamp(dot(gdir, normalize(vec2(-0.62, 0.52))), 0.0, 1.0);',
    '  float bevel = exp(-pow((sd - u_epx*0.9)/(u_epx*2.0), 2.0));',
    '  col += vec3(0.80,0.92,1.00)*bevel*facing*0.55;',
    '  col *= 1.0 - 0.45*bevel*(1.0-facing);',
    /* 棚灯在玻璃顶面的一条高光 */
    '  vec3 N = normalize(vec3(-gx*0.0022, -gy*0.0022, 1.0));',
    '  vec3 L = normalize(vec3(-0.45, 0.62, 0.65));',
    '  vec3 H = normalize(L + vec3(0.0,0.0,1.0));',
    '  float spec = pow(max(dot(N,H),0.0), 90.0);',
    '  col += vec3(0.9,0.97,1.0)*spec*(0.5 + 0.8*ins);',
    /* 接触影：光在左上，影子落右下 */
    '  float sh = 0.0;',
    '  sh += (1.0 - smoothstep(0.0, 0.006, gsd(uv + vec2(-0.010, 0.012))))*0.55;',
    '  sh += (1.0 - smoothstep(0.0, 0.012, gsd(uv + vec2(-0.022, 0.026))))*0.30;',
    '  sh *= smoothstep(-u_epx*1.2, u_epx*1.2, sd);',
    '  col *= 1.0 - 0.55*sh;',
    /* 已经唱过的那一段：玻璃更透亮 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.10,0.16,0.20)*litFront*ins*0.35;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境 */
    '  float vig = 1.0 - smoothstep(0.20, 1.50, length(uv*vec2(0.62,0.86)));',
    '  col *= 0.34 + 0.66*vig;',
    '  col = 1.0 - exp(-col*1.55);',
    '  col += (h21(gl_FragCoord.xy*0.75 + 7.0) - 0.5)*0.008;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: '',
  post: ''
};
