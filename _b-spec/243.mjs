export default {
  num: '243', slug: 'felt-needle', title: '毛毡针戳',
  accent: [0.86, 0.62, 0.44],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.74,
  doc: `   243 · 毛毡针戳 —— 字是一针一针戳进去的凹槽，槽边是被针带起来的绒毛

   机制一句话：
      毛毡是**没有经纬、只有纠缠**的纤维层：表面由四组方向不同、沿自身方向拉长几十倍的
      脊状噪声（每一道脊就是一根纤维束）叠成，完全没有镜面高光，只有极软的绒面明暗；
      字是**针毡**戳出来的凹槽 —— 纤维被针带着上下穿插，槽里的毡更密更暗（吸光多），
      槽沿的纤维被挑起来，逆光的一侧钩出一圈发亮的毛边，顺光的一侧是阴影。
      字的边界不是线，是**绒毛**。

   和前作的区别：
      211 是亚麻提花（经纬结构 + 缎纹浮线的丝光）；这里是**无方向、无高光的纠缠纤维**：
      靠吸光差（密/疏）和绒毛的逆光轮廓显形，全片没有一个镜面高光 ——
      它是这一批里唯一"没有反光"的材料。

   动态：换句时新槽被"戳"下去（u_st），唱到的那一段毛被抚平（u_front），
   槽沿的绒毛随拍点轻轻一颤（u_kick）。`,
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
    /* 一根纤维：沿 fa 方向拉长、横跨方向高频；取 1-|2n-1| 变成"脊"，
       脊线就是纤维束，比原始噪声更像毛 */
    'float fiber(vec2 p, float ang, float fa, float fb){',
    '  vec2 d = vec2(cos(ang), sin(ang));',
    '  vec2 q = vec2(dot(p, d)*fa, dot(p, vec2(-d.y, d.x))*fb);',
    '  float n = vn(q);',
    '  return 1.0 - abs(2.0*n - 1.0);',
    '}',
    /* 毡：四组纤维束，方向互不相干；坐标先被低频噪声搓弯（纤维是弯的） */
    'float feltTex(vec2 p){',
    '  vec2 warp = vec2(vn(p*1.6 + 3.0) - 0.5, vn(p*1.4 - 5.0) - 0.5)*0.16;',
    '  vec2 q = p + warp;',
    '  float a = fiber(q, 0.42, 5.5, 38.0)*0.36;',
    '  float b = fiber(q, 1.75, 8.5, 54.0)*0.28;',
    '  float c = fiber(q, 3.05, 11.0, 70.0)*0.20;',
    '  float d = fiber(q, 4.55, 15.0, 92.0)*0.16;',
    '  return a + b + c + d;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 槽：字里 1，字外 0；坡度 = 槽壁 */
    '  float g0 = 1.0 - smoothstep(-ep*1.5, ep*1.5, sd);',
    '  float groove = g0*u_st;',
    /* sdf 的梯度：槽壁朝哪边（绒毛只在逆光侧亮） */
    '  float e = max(ep*1.5, 0.0016);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(clamp(gr, vec2(-2.5), vec2(2.5)) + vec2(1e-6));',
    /* 毡面：四组纤维 × 低频的团 */
    '  float f1 = feltTex(uv);',
    '  float f2 = feltTex(uv*2.05 + 4.0);',
    '  float clump = vn(uv*1.45 + 11.0)*0.62 + vn(uv*3.0 - 2.0)*0.38;',
    '  float dens = clamp(f1*0.55 + f2*0.25 + clump*0.45, 0.0, 1.0);',
    /* 被针戳过：纤维压紧、密实 */
    '  float punch = groove*(0.60 + 0.40*h21(floor(uv*190.0)));',
    '  float densG = mix(dens, 0.30 + 0.34*f1, groove*0.85);',
    /* 极软的绒面光照：一片天光从左上洒下来，几乎没有方向性 */
    '  float lit = 0.48 + 0.42*vn(uv*1.20 + 7.0) + 0.26*clump;',
    '  lit *= 1.0 - 0.46*punch;',
    /* 槽壁挡住一部分天光：迎光的一侧亮、背光的一侧压黑（槽才有深度） */
    '  float side = clamp(-gr.x*0.62 - gr.y*0.78, -1.0, 1.0);',
    '  lit *= 1.0 + 0.26*side*groove;',
    '  float ao = 1.0 - 0.44*exp(-pow((sd - 0.007)/0.014, 2.0))*step(0.0, sd);',
    '  lit *= ao;',
    /* 毛毡本色：米白偏暖的羊毛；压紧处偏灰褐 */
    '  vec3 wool = mix(vec3(0.245,0.215,0.180), vec3(0.395,0.352,0.294), f1*0.95);',
    '  wool = mix(wool, vec3(0.105,0.088,0.074), punch*0.94);',
    '  wool *= 0.62 + 0.66*densG;',
    '  wool += u_ac*0.024*f2;',
    '  vec3 col = wool*lit;',
    /* 毛羽：极细的高频亮丝（毡面唯一的"亮"，但很小） */
    '  float hair = smoothstep(0.80, 0.99, f2)*0.8;',
    '  col += vec3(0.70,0.62,0.50)*hair*(0.05 + 0.09*(1.0 - groove));',
    /* 槽沿挑起的绒毛：只在逆光（左/上）那一侧亮，顺光侧压暗 —— 这样才是毛不是描边 */
    '  float rim = exp(-pow((abs(sd) - 0.0065)/0.0068, 2.0));',
    '  float fuzz = clamp(fiber(uv, 2.7, 26.0, 170.0)*1.4 - 0.10, 0.0, 1.0);',
    '  float back = smoothstep(-0.15, 0.75, -gr.y*0.72 - gr.x*0.58);',
    '  col += vec3(0.86,0.75,0.58)*rim*fuzz*back*(0.52 + 0.24*u_st);',
    '  col *= 1.0 - 0.22*rim*(1.0 - back)*u_st;',
    /* 唱过的那一段：毛被抚平，绒毛少 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col *= 1.0 - 0.10*litFront*groove;',
    '  col *= 1.0 + 0.030*u_kick;',
    /* 环境：一块毡放在暗桌上，中间一片柔光 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.24 + pq.y*pq.y*1.30));',
    '  float vig = 1.0 - smoothstep(0.14, 1.18, length(uv*vec2(0.56,0.84)));',
    '  col *= 0.16 + 0.84*vig;',
    '  col += vec3(0.060,0.050,0.038)*pool*0.40;',
    '  col = 1.0 - exp(-col*2.05);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 17.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 针毡的槽：比周围密、比周围暗，槽沿挑起来的绒毛是唯一的高光 */
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#0a0705';
  g.filter = 'blur(' + (fs * 0.026).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.008, cy + fs * 0.020);
  g.filter = 'none';
  g.restore();

  const flt = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  flt.addColorStop(0.00, '#4e4638');
  flt.addColorStop(0.24, '#3e372c');
  flt.addColorStop(0.54, '#2f2a22');
  flt.addColorStop(0.82, '#23201a');
  flt.addColorStop(1.00, '#181510');
  g.fillStyle = flt;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 毡的密度斑 */
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const r = 3 + Math.random() * 18;
    const dark = Math.random() < 0.64;
    g.fillStyle = dark ? 'rgba(10,8,6,0.14)' : 'rgba(112,98,76,0.10)';
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  /* 纤维丝：极细的短线，方向随机（毡的纠缠） */
  g.lineCap = 'round';
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const ang = Math.random() * 6.2832;
    const len = 1.2 + Math.random() * 6.0;
    const bright = Math.random() < 0.38;
    g.strokeStyle = bright
      ? 'rgba(198,180,148,' + (0.04 + Math.random() * 0.10).toFixed(3) + ')'
      : 'rgba(12,10,8,' + (0.06 + Math.random() * 0.16).toFixed(3) + ')';
    g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  /* 槽沿挑起的绒毛：朝上（逆光）的短毛 */
  for (let i = 0; i < 430; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const ang = -1.95 + (Math.random() - 0.5) * 1.9;
    const len = 1.4 + Math.random() * 4.6;
    g.strokeStyle = 'rgba(234,212,174,' + (0.07 + Math.random() * 0.26).toFixed(3) + ')';
    g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  /* 底边压暗：槽的深度 */
  const deep = g.createLinearGradient(0, cy + fs * 0.04, 0, cy + fs * 0.62);
  deep.addColorStop(0.0, 'rgba(0,0,0,0)');
  deep.addColorStop(1.0, 'rgba(8,6,5,0.40)');
  g.fillStyle = deep;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
