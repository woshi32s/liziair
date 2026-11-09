export default {
  num: '274', slug: 'spun-caramel', title: '焦糖拉丝',
  accent: [0.98, 0.60, 0.18],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.10,
  doc: `   274 · 焦糖拉丝 —— 字是被拉过的那一块糖，糖分子被拉成一根根玻璃丝

   机制一句话：
      同一锅糖，两种状态：**没拉过**的是过饱和的糖浆，凉下来就**结晶**——
      糖霜的晶粒把光全打散，看着哑、发白、一粒一粒；**拉过**的那一块，
      糖被反复折叠拉伸，分子顺着拉伸方向排起来，变成**糖玻璃**：
      一根根丝是圆柱形的透光体，每根丝的脊上各有一条锐利的高光，丝与丝之间的沟是暗的，
      光从丝里透过来带一层琥珀色 —— 字的形就是"哪一块被拉过"。

   和前作的区别：
      243 毛毡 / 211 亚麻是**纤维织物**：丝是捻出来的、漫反射；
      248 羽毛是**衍射**（颜色随角度变）：
      这里是**糖玻璃**：透明、有折射与吸收（琥珀色是穿过糖体出来的，不是涂上去的），
      高光是一根根圆柱的脊 —— 一条一条平行地排着，因为糖是被一个方向拉出来的。

   动态：换句时糖刚被拉开（u_st：丝从粗拉到细）；唱到的那一段拉得更细更透（u_front）；
   拍点上丝轻轻一颤（u_kick，高光顺着丝滑动）。`,
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
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float g0 = 1.0 - smoothstep(-ep*1.8, ep*1.8, sd);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.6, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    /* ---- 没拉过的糖：结晶，糖霜的晶粒把光打散 ---- */
    '  float grain = vn(uv*260.0)*0.55 + vn(uv*90.0)*0.45;',
    '  float crystal = smoothstep(0.55, 0.95, vn(uv*38.0 + 7.0));',
    '  vec3 crys = vec3(0.145,0.088,0.036)*(0.72 + 0.55*grain);',
    '  crys += vec3(0.38,0.29,0.18)*crystal*0.22*grain;',
    '  crys *= 0.86 + 0.22*vn(uv*7.0 + 2.0);',
    /* ---- 拉过的糖：一根根圆柱形的丝 ---- */
    '  float pull = 0.86 + 0.14*u_st;',
    '  vec2 sp = uv;',
    /* 拉的方向略斜，丝在拉力下有点弯 */
    '  sp.y += sp.x*0.16 + vn(uv*2.2 + 4.0)*0.020 + vn(uv*6.5 - 1.0)*0.005;',
    '  float thick = mix(0.0245, 0.0165, u_st);',
    '  float ph = sp.y/thick;',
    '  float tw = ph*6.2832;',
    '  float cw = cos(tw);',
    '  float arc = sqrt(max(0.0001, 1.0 - cw*cw));',
    '  float slope = -sin(tw);',
    /* 每根丝的粗细/亮度不完全一样（拉的力度不匀） */
    '  float srnd = h21(vec2(floor(ph), 3.0));',
    '  vec3 fsN = normalize(vec3(slope*0.85*mix(1.0, 0.55, u_st), 0.10, 1.0));',
    '  vec3 L = normalize(vec3(-0.42,0.52,0.74));',
    '  vec3 H = normalize(L + vec3(0.0,0.0,1.0));',
    '  float spec = pow(max(dot(fsN, H), 0.0), 34.0);',
    '  float side = max(dot(fsN, L), 0.0);',
    '  /* 透光：丝中心的糖最厚 → 吸收最多；靠丝边缘薄 → 亮 */',
    '  float thru = 1.0 - arc*0.55;',
    '  vec3 glass = vec3(0.95,0.52,0.12)*thru*0.85;',
    '  glass += vec3(0.42,0.16,0.03)*arc*0.28;',
    '  glass += vec3(1.00,0.95,0.84)*spec*(0.30 + 0.70*srnd)*1.9;',
    '  glass += vec3(0.72,0.36,0.07)*side*0.45;',
    /* 丝与丝之间的沟：暗 */
    '  glass *= 0.42 + 0.85*arc;',
    '  /* 拉丝的边缘：糖玻璃断开的地方挂一道亮 */',
    '  float edgeG = exp(-pow((dist - 0.006)/0.006, 2.0));',
    '  glass += vec3(1.0,0.86,0.62)*edgeG*0.22;',
    /* 合起来：字的边界不是硬切，糖在边界上糊成一片 */
    '  float mixw = g0*(0.82 + 0.18*smoothstep(0.0, 0.4, u_st));',
    '  vec3 col = mix(crys, glass, mixw);',
    /* 结晶区的一点透光：糖浆厚的地方暖（不是高光） */
    '  col += vec3(0.30,0.13,0.03)*exp(-dist/0.05)*0.25;',
    /* 光的走向：一束低斜光从左上来 */
    '  col *= 0.55 + 0.60*smoothstep(-0.9, 0.8, uv.x*0.6 + uv.y*0.8);',
    /* 唱过的那一段：拉得更细，丝更密更亮 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(1.0,0.66,0.22)*litFront*mixw*0.06;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：一块糖在暖光下，四周暗 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.16 + pq.y*pq.y*1.00));',
    '  float vig = 1.0 - smoothstep(0.22, 1.24, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.22 + 0.78*vig;',
    '  col += vec3(0.050,0.028,0.010)*pool*0.60;',
    '  col = 1.0 - exp(-col*1.95);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 71.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 拉过的那一块：琥珀色的糖玻璃，沿拉伸方向的一根根亮丝 */
  const ag = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  ag.addColorStop(0.00, '#f0b062');
  ag.addColorStop(0.22, '#d98a34');
  ag.addColorStop(0.48, '#b0631c');
  ag.addColorStop(0.74, '#7d3f0c');
  ag.addColorStop(1.00, '#4a2305');
  g.fillStyle = ag;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 丝：顺着拉伸方向（略斜）一根根，脊上亮、沟里暗 */
  g.lineCap = 'butt';
  for (let i = 0; i < 150; i++) {
    const y0 = -ph * 0.3 + Math.random() * ph * 1.6;
    const a = 0.06 + Math.random() * 0.22;
    g.strokeStyle = Math.random() < 0.5
      ? 'rgba(255,236,190,' + a.toFixed(3) + ')'
      : 'rgba(60,24,2,' + (a * 1.1).toFixed(3) + ')';
    g.lineWidth = 0.7 + Math.random() * 2.2;
    g.beginPath();
    g.moveTo(-pw * 0.15, y0);
    g.lineTo(pw * 1.15, y0 + pw * 0.16);
    g.stroke();
  }
  /* 糖玻璃的边缘：断开处挂的一道亮 */
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,242,210,0.26)';
  g.lineWidth = Math.max(1, fs * 0.016);
  g.strokeText(L.text, cx, cy);
  /* 顶上的一层暖光 */
  const top = g.createLinearGradient(0, cy - fs * 0.58, 0, cy);
  top.addColorStop(0, 'rgba(255,250,220,0.26)');
  top.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
