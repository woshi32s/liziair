export default {
  num: '247', slug: 'soot-glass', title: '烛烟熏黑',
  accent: [1.00, 0.66, 0.30],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.44,
  doc: `   247 · 烛烟熏黑 —— 字是在熏黑的玻璃上抹出来的那块干净地方，烛光从那儿漏过来

   机制一句话：
      玻璃被烛烟熏了一层**油烟**（不完全燃烧的碳粒，一层疏松的黑色沉积，越往上越薄）；
      字是用布**抹掉**的一扇窗 —— 抹的边界是拖出来的，不是切出来的（边缘有一道被拖薄的烟痕）；
      烛焰在玻璃后面轻轻跳，光只从抹干净的字母里透过来，所以字是**被擦出来的洞**，
      不是画上去的：它的亮度就是烛焰的亮度 × 玻璃的透过率 × (1 - 烟的不透明度)。

   和前作的区别：
      215 是雾幕减光（体积雾里的投影，字是"暗的影"）；这里是**油烟沉积膜**：
      一层附着在玻璃上的碳，字是把它擦掉（负空间），字比环境亮 —— 与 215 正好相反。

   动态：换句时新的一块被抹开（u_st），唱到的那一段更透（u_front），烛焰随拍点一颤（u_kick）。`,
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
    /* 油烟：碳粒沉积是"菜花状"的团 —— 取 |2n-1| 的反（脊）叠三层 */
    'float soot(vec2 p){',
    '  float a = 1.0 - abs(2.0*vn(p*5.0) - 1.0);',
    '  float b = 1.0 - abs(2.0*vn(p*13.0 + 3.0) - 1.0);',
    '  float c = 1.0 - abs(2.0*vn(p*31.0 - 5.0) - 1.0);',
    '  return clamp(a*0.55 + b*0.30 + c*0.15, 0.0, 1.0);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 烟层：越往上越薄（烟是往上飘的），中间偏下最厚 */
    '  float rise = smoothstep(-0.9, 0.7, -uv.y + 0.15);',
    '  float s1 = soot(uv*1.5 + 4.0);',
    '  float s2 = soot(uv*4.2 - 2.0);',
    '  float dens = (0.45 + 0.55*s1)*(0.60 + 0.40*s2);',
    '  dens *= 0.50 + 0.65*rise;',
    /* 抹的痕迹：抹布拖出来的方向（从左下往右上），边界被拖薄 */
    '  float smear = vn(vec2((uv.x*0.7 + uv.y*0.7)*7.0, (uv.y*0.7 - uv.x*0.7)*2.2))*0.5;',
    '  float g0 = 1.0 - smoothstep(-ep*4.5, ep*4.5, sd);',
    '  float wipe = g0*u_st*(0.86 + 0.30*smear);',
    /* 抹掉的地方烟少（但不完全干净：布擦不彻底，留一层薄烟） */
    '  float sootD = clamp(dens - wipe*1.25, 0.0, 1.0);',
    '  sootD = mix(sootD, sootD*0.35, g0*u_st*0.85);',
    /* 抹痕的边界：一圈被拖薄的烟（半透的褐色边） */
    '  float edge = exp(-pow((abs(sd) - 0.010)/(0.010), 2.0))*(1.0 - smoothstep(16.0*ep, 26.0*ep, abs(sd)));',
    '  sootD = clamp(sootD*(1.0 - 0.45*edge*u_st) + 0.10*edge*u_st, 0.0, 1.0);',
    /* 烛焰：在玻璃后面，跳（t 停了它就不跳了） */
    '  vec2 fp = vec2(-0.02, 0.02);',
    '  float flick = 0.86 + 0.10*sin(t*6.1) + 0.06*sin(t*11.3 + 1.7) + 0.04*sin(t*17.9 + 0.4);',
    '  flick *= 1.0 + 0.10*u_kick;',
    '  vec2 dq = (uv - fp)*vec2(1.0, 0.82);',
    '  float dist = length(dq);',
    '  float flame = exp(-pow(dist/0.62, 2.0))*flick;',
    '  float halo = exp(-pow(dist/1.25, 2.0))*0.35*flick;',
    /* 透过率：Beer-Lambert，烟越厚透过越少 */
    '  float trans = exp(-3.10*sootD);',
    /* 烛光的颜色：芯附近偏白黄，远处偏橙红 */
    '  vec3 fireC = mix(vec3(1.00,0.42,0.12), vec3(1.00,0.88,0.62), exp(-pow(dist/0.22, 2.0)));',
    '  vec3 col = fireC*(flame + halo)*trans;',
    /* 玻璃本身的反光：很弱的一层，让"没擦到"的地方不是纯黑 */
    '  col += vec3(0.070,0.062,0.058)*(1.0 - sootD)*0.42;',
    '  col += vec3(0.040,0.033,0.028)*(1.0 - sootD*0.6);',
    /* 烟层自己的微光（火焰照在烟上的散射，很弱） */
    '  col += vec3(0.16,0.10,0.06)*sootD*flame*0.10;',
    /* 玻璃上的划痕与灰点（擦了很多次的痕迹） */
    '  float scr = smoothstep(0.86, 0.99, vn(uv*vec2(30.0, 260.0)))*0.5',
    '            + smoothstep(0.90, 0.99, vn(uv*vec2(210.0, 34.0)))*0.5;',
    '  col += vec3(0.55,0.45,0.34)*scr*(1.0 - sootD)*0.20*flame;',
    /* 唱过的那一段：擦得更透 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += fireC*litFront*trans*g0*0.10;',
    /* 环境：暗室，只有烛光那一圈亮 */
    '  float vig = 1.0 - smoothstep(0.30, 1.35, length(uv*vec2(0.72,0.92)));',
    '  col *= 0.22 + 0.78*vig;',
    '  col = 1.0 - exp(-col*2.10);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 51.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 抹干净的那块玻璃：暖的烛光透过来，边缘是拖薄的烟痕（不是硬边） */
  const gls = g.createLinearGradient(0, cy - fs * 0.66, 0, cy + fs * 0.66);
  gls.addColorStop(0.00, 'rgba(255,206,140,0.30)');
  gls.addColorStop(0.28, 'rgba(255,178,96,0.22)');
  gls.addColorStop(0.58, 'rgba(232,138,62,0.16)');
  gls.addColorStop(0.86, 'rgba(180,96,42,0.12)');
  gls.addColorStop(1.00, 'rgba(140,70,30,0.10)');
  g.fillStyle = gls;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 抹布拖出来的条痕：斜向的宽笔触，边缘毛 */
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const y0 = cy - fs * 0.6 + Math.random() * fs * 1.2;
    const len = pw * (0.25 + Math.random() * 0.75);
    const x0 = Math.random() * (pw - len);
    g.strokeStyle = Math.random() < 0.55
      ? 'rgba(255,214,150,' + (0.03 + Math.random() * 0.10).toFixed(3) + ')'
      : 'rgba(60,30,14,' + (0.03 + Math.random() * 0.10).toFixed(3) + ')';
    g.lineWidth = 2 + Math.random() * 16;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + len, y0 + (Math.random() - 0.5) * fs * 0.20);
    g.stroke();
  }
  /* 烟熏的黄褐边：擦过的地方还留着一层薄烟 */
  g.strokeStyle = 'rgba(94,52,24,0.42)';
  g.lineWidth = 4.5;
  g.strokeText(L.text, cx, cy);
  g.strokeStyle = 'rgba(38,18,8,0.55)';
  g.lineWidth = 9.0;
  g.strokeText(L.text, cx, cy);
  /* 玻璃上的灰点 */
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    g.fillStyle = 'rgba(24,12,6,' + (0.05 + Math.random() * 0.18).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, 0.4 + Math.random() * 1.4, 0, 6.2832); g.fill();
  }
  g.restore();`,
  post: ''
};
