export default {
  num: '248', slug: 'feather-iridescence', title: '羽毛虹彩',
  accent: [0.36, 0.86, 0.72],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.58,
  doc: `   248 · 羽毛虹彩 —— 字是把羽枝压平的那一块，虹彩整片地铺开

   机制一句话：
      羽毛的颜色不是色素，是**结构色**：小羽枝里有周期排列的黑色素棒（约 200nm），
      构成一维**衍射光栅**；光栅的栅距不变，但**栅的方向**随羽枝朝向转 ——
      所以颜色只随"羽枝朝向 vs 光的方向"变，与膜厚无关。
      字是羽枝被压平、方向被理齐的那一块：周围是碎成一片片、颜色乱跳的羽面，
      字里是一整片连续的虹彩（青 ↔ 金）。

   和前作的区别：
      217 是**薄膜干涉**（同一层膜的厚度变化 → 色相随厚度变，典型是肥皂膜/油膜）；
      这里是**光栅衍射**（栅距固定、栅的方向变 → 色相随角度变）：一个是厚度，一个是朝向，
      物理机制不同，视觉上也不一样 —— 薄膜是一片片云状的彩，羽毛是一条条随羽枝翻转的彩。

   动态：换句时羽枝被"理顺"（u_st）；唱到的那一段被压得更平（u_front）；拍点让光的方向一转（u_kick）。`,
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
    '  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 9.0;',
    '  return (texture2D(u_g, tc).r*255.0 - 128.0) * u_gk;',
    '}',
    /* 羽面：羽枝方向随位置缓慢转（羽片是包着鸟身长的），羽枝之间的间距固定 */
    'float barbs(vec2 p, float ang, out float phase){',
    '  vec2 d = vec2(cos(ang), sin(ang));',
    '  float across = dot(p, vec2(-d.y, d.x));',
    '  float along = dot(p, d);',
    /* 小羽枝：垂直于羽枝、更密的格栅（羽枝像梳齿） */
    '  float b1 = 0.5 + 0.5*sin(across*300.0 + vn(p*3.0)*1.1);',
    '  float b2 = 0.5 + 0.5*sin(along*150.0 + vn(p*2.0 + 5.0)*1.4);',
    '  phase = across*300.0;',
    '  return pow(b1, 5.0)*(0.70 + 0.30*pow(b2, 4.0));',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 羽枝方向：几层低频噪声叠出"包裹"的方向场 */
    '  float sy = -0.02 + 0.05*sin(uv.x*0.55 + 0.4);',
    '  float above = step(sy, uv.y);',
    '  float aNoise = (vn(uv*0.55 + 2.0) - 0.5)*0.30 + (vn(uv*1.70 - 3.0) - 0.5)*0.12;',
    '  float aUp = 0.92 + aNoise;',
    '  float aDn = -0.92 + aNoise;',
    '  float a0 = mix(aDn, aUp, above);',
    /* 压平区：字的法线/方向被理顺 */
    '  float g0 = 1.0 - smoothstep(-ep*2.2, ep*2.2, sd);',
    '  float flat_ = g0*u_st;',
    '  float ang = mix(a0, 0.06 + 0.10*vn(uv*2.0), flat_*0.92);',
    '  float ph;',
    '  float fil = barbs(uv*0.86 + vec2(0.0, vn(uv*1.3)*0.06), ang, ph);',
    /* 羽枝的朝向决定虹彩：光栅方向与光的方向的夹角 */
    '  vec2 L = vec2(cos(0.92 + uv.x*0.34 + uv.y*0.18 + t*0.02), sin(0.92 + uv.x*0.34 + uv.y*0.18 + t*0.02));',
    '  vec2 D = vec2(cos(ang), sin(ang));',
    '  float align = dot(D, L);',
    /* 衍射级次：色相只跟 |align| 有关（不是厚度！） */
    '  float hue = pow(abs(align), 1.1);',
    '  float band = smoothstep(0.55, 0.95, abs(align));',
    /* 两个色：青绿 ↔ 金（只有两个强调色） */
    '  vec3 teal = mix(vec3(0.06,0.22,0.20), vec3(0.20,0.85,0.72), 0.55);',
    '  vec3 gold = mix(vec3(0.24,0.14,0.04), vec3(1.00,0.80,0.38), 0.60);',
    '  vec3 irid = mix(teal, gold, smoothstep(0.15, 0.85, hue));',
    '  irid = mix(irid, u_ac*1.05, 0.18*band);',
    /* 羽毛的底：深褐的羽干与羽枝阴影 */
    '  vec3 base = vec3(0.045,0.038,0.034) + vec3(0.045,0.040,0.036)*vn(uv*7.0 + 9.0);',
    '  vec3 col = base + irid*pow(fil, 1.05)*0.62;',
    /* 羽轴：一根粗的轴，两侧的羽枝从它上面长出来；轴是骨白的，带一点高光 */
    '  float shaft = exp(-pow((uv.y - sy)/0.013, 2.0));',
    '  float shaftHl = exp(-pow((uv.y - sy + 0.008)/0.006, 2.0));',
    '  col = mix(col, vec3(0.30,0.30,0.28) + vec3(0.35,0.34,0.30)*shaftHl, shaft*0.80*(1.0 - flat_*0.55));',
    /* 羽枝的高光：每根羽枝的脊上一点亮（结构色的"闪"） */
    '  col += irid*band*pow(fil, 3.0)*0.30;',
    /* 压平的那块：羽枝被理齐 → 整片连续的虹彩，且更亮 */
    '  float sheet = flat_*smoothstep(0.10, 0.85, fil);',
    '  col = mix(col, irid*(0.42 + 0.55*fil) + vec3(0.10,0.11,0.10)*fil*0.3, flat_*0.86);',
    '  col += irid*flat_*0.22;',
    /* 压平的边缘：羽枝被压断，钩出一圈亮边 */
    '  float rim = exp(-pow((abs(sd) - 0.006)/0.0072, 2.0))*(1.0 - smoothstep(16.0*ep, 26.0*ep, abs(sd)));',
    '  col += irid*rim*0.55*u_st;',
    /* 唱过的那一段：更平、虹彩更整齐 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += irid*litFront*flat_*0.10;',
    /* 环境：暗处一块被侧光照到的羽面 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.20 + pq.y*pq.y*1.15));',
    '  float vig = 1.0 - smoothstep(0.18, 1.30, length(uv*vec2(0.60,0.88)));',
    '  col *= 0.26 + 0.74*vig;',
    '  col += vec3(0.05,0.07,0.065)*pool*0.35;',
    '  col *= 1.0 + 0.05*u_kick;',
    '  col = 1.0 - exp(-col*1.70);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 61.0) - 0.5)*0.011;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 压平的羽片：整片虹彩（青↔金），羽枝的纹还在，只是被理齐了 */
  g.save();
  g.globalAlpha = 0.40;
  g.fillStyle = '#05080a';
  g.filter = 'blur(' + (fs * 0.018).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.010, cy + fs * 0.018);
  g.filter = 'none';
  g.restore();

  const ir = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  ir.addColorStop(0.00, '#bff5df');
  ir.addColorStop(0.22, '#7fe0c4');
  ir.addColorStop(0.44, '#4fbfa6');
  ir.addColorStop(0.62, '#c8b06a');
  ir.addColorStop(0.82, '#8a6a32');
  ir.addColorStop(1.00, '#4a3a1c');
  g.fillStyle = ir;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 羽枝：密密的斜线（压平后方向一致） */
  g.lineCap = 'round';
  for (let i = 0; i < 320; i++) {
    const y = -ph * 0.2 + Math.random() * ph * 1.4;
    const a = 0.04 + Math.random() * 0.14;
    g.strokeStyle = Math.random() < 0.6
      ? 'rgba(226,255,244,' + a.toFixed(3) + ')'
      : 'rgba(20,34,30,' + (a * 1.2).toFixed(3) + ')';
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    g.moveTo(-pw * 0.1, y);
    g.lineTo(pw * 1.1, y + pw * 0.10);
    g.stroke();
  }
  /* 虹彩的漂移：一层很淡的斜向彩色带（结构色随角度变） */
  const sh = g.createLinearGradient(pw * 0.05, cy + fs * 0.4, pw * 0.75, cy - fs * 0.5);
  sh.addColorStop(0.00, 'rgba(80,255,216,0.00)');
  sh.addColorStop(0.34, 'rgba(96,255,214,0.16)');
  sh.addColorStop(0.56, 'rgba(255,226,150,0.16)');
  sh.addColorStop(0.80, 'rgba(255,210,120,0.06)');
  sh.addColorStop(1.00, 'rgba(255,210,120,0.00)');
  g.fillStyle = sh;
  g.fillRect(0, 0, pw, ph);
  /* 边缘：压断的羽枝，一圈稍亮的细边 */
  g.strokeStyle = 'rgba(220,255,244,0.24)';
  g.lineWidth = 1.2;
  g.strokeText(L.text, cx, cy);
  g.restore();`,
  post: ''
};
