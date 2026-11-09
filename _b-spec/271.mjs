export default {
  num: '271', slug: 'raked-gravel', title: '枯山水砂纹',
  accent: [0.72, 0.78, 0.86],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.58,
  doc: `   271 · 枯山水砂纹 —— 字埋在砂下，耙纹骑在它上面，线被顶起来的地方就是等高线

   机制一句话：
      耙过的白砂是**等高线**：耙齿等距走一圈，留下一条条砂脊，脊的走向就是地面高度的
      等值线。砂下埋着一块字的形状 —— 耙齿经过时被顶起来，于是**线在坡上挤密、在顶面
      拉开**；字没有轮廓线，是"线的疏密"把它画出来的（离坡越近，线越挤，
      挤到快并成一条就是坡脚）。低斜光擦过砂脊：迎光的一侧亮成一道白，背光的一侧
      埋进影子里，一条线就是一道明暗。

   和前作的区别：
      246 沙画台是**沙的厚度**（比尔-朗伯，光从下面透上来，厚就黑）；
      这里是**沙的表面形状**（耙出的脊 + 低角度掠射光），沙子不透光、只反光；
      而且字根本不"贴"在砂上：它埋在下面，只通过耙纹的**弯曲与疏密**显形。

   动态：换句时新的那一块慢慢"顶"起来（u_st 让埋深从 0 长到 1，线跟着往里挤）；
   唱到的那一段坡脚更陡、线更密（u_front）；拍点上砂面轻轻一震（u_kick，脊不动、光动）。`,
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
    /* 砂面高度 = 耙出的等距砂脊（等值线） + 埋在下面那块字的隆起 */
    'float hgt(vec2 p, float lift){',
    '  float sd = gsd(p);',
    '  float hb = 1.0 - smoothstep(-0.034, 0.016, sd);',
    '  hb *= lift;',
    /* 耙纹绕着一颗画外下方的石，所以是弧线；字把等值线顶起来 → 疏密就是坡度 */
    '  float R = length(p - vec2(0.02, -1.18));',
    '  float F = R + 0.098*hb;',
    '  float ridge = sin(F*176.0)*(1.0 - 0.62*hb);',
    '  return 0.0034*ridge + 0.013*hb + 0.0009*vn(p*260.0);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float dist = abs(sd);',
    '  float lift = 0.30 + 0.70*u_st;',
    '  float e = max(ep*0.9, 0.0014);',
    '  float h0 = hgt(uv, lift);',
    '  float hx = hgt(uv + vec2(e,0.0), lift);',
    '  float hy = hgt(uv + vec2(0.0,e), lift);',
    '  vec3 N = normalize(vec3(-(hx-h0)/e, -(hy-h0)/e, 1.0));',
    /* 低斜光：从左上来，几乎擦着砂面 → 迎光的一道白、背光的一道影 */
    '  vec3 L = normalize(vec3(-0.62, 0.40, 0.52));',
    '  float diff = max(dot(N, L), 0.0);',
    '  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.75, N.z));',
    /* 砂：灰白的石英砾，颗粒之间是一层很细的明暗 */
    '  float grit = vn(uv*330.0)*0.55 + vn(uv*120.0)*0.45;',
    '  float speck = smoothstep(0.72, 0.98, h21(floor(uv*520.0) + 3.0));',
    '  vec3 sand = vec3(0.60,0.60,0.575);',
    '  sand *= 0.82 + 0.30*grit;',
    '  sand += vec3(0.10,0.10,0.10)*speck*0.35;',
    /* 埋着的那块：砂被压实了，比松砂暗一点、也更细（没有大的颗粒阴影） */
    '  float plateau = (1.0 - smoothstep(-0.024, 0.012, sd))*lift;',
    '  sand *= mix(1.0, 1.10, plateau);',
    '  vec3 col = sand*(0.10 + 1.02*diff)*ao;',
    /* 砂脊上的一点点亮：石英的解理面正对着光时才闪 */
    '  vec3 H = normalize(L + vec3(0.0,0.0,1.0));',
    '  float glint = pow(max(dot(N, H), 0.0), 46.0);',
    '  col += vec3(0.92,0.94,0.98)*glint*0.30*smoothstep(0.35, 0.9, grit);',
    /* 坡脚：等值线挤在一起的地方，光被吃掉一层（砂粒互相遮挡） */
    '  float steep = 1.0 - smoothstep(0.30, 0.95, N.z);',
    /* 坡脚：被压出来的一圈矮坎 —— 迎光侧挂白、背光侧压黑 */
    '  vec2 gs = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd);',
    '  gs = normalize(gs + vec2(1e-6));',
    '  float foot = exp(-pow((dist - 0.014)/0.009, 2.0));',
    '  float footLit = max(0.0, dot(gs, normalize(vec2(-0.62,0.40))));',
    '  sand *= 1.0 + 0.07*foot*(footLit - 0.55);',
    '  col *= 1.0 - 0.42*steep;',
    /* 唱过的那一段：坡脚被踩得更实（线更密一点，暗一点） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col *= 1.0 - 0.10*litFront*plateau;',
    '  /* 砂面的一层薄霜似的微光（夜里） */',
    '  col += vec3(0.10,0.12,0.16)*exp(-length(uv - u_gc)*1.1)*0.25;',
    '  col *= 1.0 + 0.05*u_kick*plateau;',
    /* 环境：一颗石在画外，压出一片暗；四周荒得很 */
    '  float stone = exp(-pow(length(uv - vec2(0.02, -1.18))/0.95, 2.0));',
    '  col *= 1.0 - 0.55*smoothstep(0.45, 1.0, stone);',
    '  float vig = 1.0 - smoothstep(0.28, 1.26, length(uv*vec2(0.60,0.92)));',
    '  col *= 0.22 + 0.78*vig;',
    '  col = 1.0 - exp(-col*1.75);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 41.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 被压实的砂面：颗粒更细、更平，所以整体略亮一点、没有大颗粒的阴影 */
  const sg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  sg.addColorStop(0.00, '#cfccc0');
  sg.addColorStop(0.26, '#c2bfb3');
  sg.addColorStop(0.58, '#b4b1a6');
  sg.addColorStop(1.00, '#a3a098');
  g.fillStyle = sg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 压实后的砂：细的颗粒不见了，只剩一点点很淡的斑 */
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * pw, y = Math.random() * ph, rr = 2 + Math.random() * 12;
    const rg = g.createRadialGradient(x, y, 0, x, y, rr);
    const dark = Math.random() < 0.55;
    rg.addColorStop(0, dark ? 'rgba(58,58,54,0.16)' : 'rgba(226,224,214,0.14)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  /* 顶面：一道从左上擦过来的光 */
  const hl = g.createLinearGradient(pw * 0.08, cy - fs * 0.80, pw * 0.70, cy + fs * 0.30);
  hl.addColorStop(0.00, 'rgba(255,252,240,0.00)');
  hl.addColorStop(0.34, 'rgba(255,252,240,0.26)');
  hl.addColorStop(0.62, 'rgba(255,255,250,0.04)');
  hl.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  g.fillStyle = hl;
  g.fillRect(0, 0, pw, ph);
  /* 下缘：坡脚沉进影子里 */
  const sadow = g.createLinearGradient(0, cy + fs * 0.10, 0, cy + fs * 0.62);
  sadow.addColorStop(0, 'rgba(16,17,16,0)');
  sadow.addColorStop(1, 'rgba(14,15,14,0.50)');
  g.fillStyle = sadow;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
