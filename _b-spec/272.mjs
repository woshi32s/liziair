export default {
  num: '272', slug: 'burned-paper', title: '火烧纸边',
  accent: [1.00, 0.56, 0.22],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.10,
  doc: `   272 · 火烧纸边 —— 字是被火从纸里吃掉的洞，洞边还红着

   机制一句话：
      纸是被**燃烧前沿**吃穿的：纤维先热解成炭（黑、龟裂成小片），再氧化掉，留下一个洞。
      所以从洞里往外是一条**分层**的带：洞（什么都没有）→ 炭（黑、有龟裂）→
      焦褐（热解但还没烧掉的纸，棕黄、越远越淡）→ 原纸（米白、纤维、被烤得微微翘起）。
      洞缘那一圈还在**阴燃**：一条断续的橙红余烬（纸的边在缺氧处慢慢烧），
      它比洞亮、比纸暗，是整幅唯一"自己在发光"的东西。

   和前作的区别：
      210 是纸浆压凸（纸的**形**）；247 是烟熏玻璃（烟被**擦掉**）；
      这里是纸被**烧掉**：不可逆地少了一块，而且缺口的边缘有温度（分层的炭/焦/纸）。
      不是一个洞的剪影，是一条有化学梯度的边。

   动态：换句时新的洞"烧"开（u_st：余烬先亮、焦褐再退）；唱到的那一段余烬更旺（u_front）；
   拍点上余烬一明（u_kick）。`,
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
    /* 纸面的起伏：受热的地方翘起来一点，再叠一层纤维的细纹 */
    'float hgt(vec2 p){',
    '  float s2 = gsd(p);',
    '  float curl = exp(-pow(max(s2, 0.0)/0.075, 1.6))*0.030;',
    '  return vn(p*2.1)*0.012 + vn(p*6.0 + 3.0)*0.004 + curl;',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.4, 0.0018);',
    '  float h0 = hgt(uv);',
    '  vec2 N = vec2(hgt(uv+vec2(e,0.0)) - h0, hgt(uv+vec2(0.0,e)) - h0)/e;',
    '  vec3 N3 = normalize(vec3(-N*7.0, 1.0));',
    /* 纸：米白偏暖，纤维是长短不一的道子 */
    '  float fib = vn(vec2(uv.x*150.0, uv.y*19.0))*0.55 + vn(vec2(uv.x*26.0, uv.y*170.0))*0.45;',
    '  float pulp = vn(uv*70.0)*0.6 + vn(uv*180.0)*0.4;',
    '  vec3 paper = vec3(0.880,0.790,0.630);',
    '  paper *= 0.78 + 0.34*fib;',
    '  paper *= 0.94 + 0.10*pulp;',
    /* 前沿：低频噪声决定"这一小段烧到哪" —— 有的烧穿了、有的只焦黄、有的刚起泡 */
    '  float burnN = vn(uv*2.3 + 3.0)*0.62 + vn(uv*5.1 - 7.0)*0.38;',
    '  float sdE = sd + (burnN - 0.5)*0.017;',
    '  float distE = abs(sdE);',
    /* 纸的厚度感：被烤过的纸更薄更透，边缘透出一点后面的暖 */
    '  float thin = exp(-pow(max(sdE, 0.0)/0.050, 1.5));',
    '  paper += vec3(0.10,0.052,0.020)*thin*0.55;',
    /* 焦褐：热解但还没烧掉的纸（棕→黄，越远越淡） */
    '  float scorch = smoothstep(0.054, 0.010, sdE);',
    '  vec3 burnt = vec3(0.185,0.090,0.032);',
    '  paper = mix(paper, burnt, scorch*0.92);',
    /* 炭：黑、龟裂成小片（裂口里更黑） */
    '  float charT = smoothstep(0.016, 0.004, sdE)*smoothstep(0.30, 0.56, burnN);',
    '  float crack = smoothstep(0.46, 0.60, vn(uv*54.0 + 7.0))*smoothstep(0.30, 0.62, vn(uv*23.0 - 3.0));',
    '  vec3 coal = vec3(0.042,0.036,0.032)*(0.50 + 0.80*pulp);',
    '  coal *= 1.0 - 0.55*crack;',
    '  paper = mix(paper, coal, charT*0.95);',
    /* 起泡：焦黄带上被烤鼓的小泡（只在前沿后面一窄条，断断续续） */
    '  float bl = abs(burnN - 0.44);',
    '  float blister = 1.0 - smoothstep(0.10, 0.20, bl);',
    '  blister *= smoothstep(0.006, 0.018, sdE)*(1.0 - smoothstep(0.030, 0.062, sdE));',
    '  blister *= smoothstep(0.58, 0.90, vn(uv*74.0 + 3.0));',
    '  paper += vec3(0.34,0.170,0.055)*blister*0.55;',
    '  paper *= 1.0 - 0.30*blister;',
    /* 洞：纸没了，后面是黑的（只有洞里极深处有一点暖反光） */
    '  float hole = 1.0 - smoothstep(-0.0035, 0.0035, sdE);',
    '  vec3 voidc = vec3(0.009,0.008,0.008)*(0.7 + 0.5*vn(uv*3.2 + 5.0));',
    '  voidc += vec3(0.10,0.040,0.012)*exp(-distE/0.020)*0.55;',
    /* 阴燃：洞缘一条断续的余烬 */
    '  float flick = 0.40 + 0.60*vn(uv*15.0 + vec2(t*0.8, -t*0.55));',
    '  float ember = exp(-pow((sdE - 0.0016)/0.0030, 2.0));',
    '  ember *= smoothstep(0.46, 0.76, burnN)*flick*flick;',
    '  ember *= 0.65 + 0.35*u_st + 0.55*u_kick;',
    /* 光：左上一束暖光，纸的翘曲让明暗走 */
    '  vec3 L = normalize(vec3(-0.40,0.46,0.79));',
    '  float diff = max(dot(N3, L), 0.0);',
    '  float ao = 0.60 + 0.40*smoothstep(-0.06, 0.05, sdE);',
    '  vec3 col = paper*(0.46 + 0.72*diff)*ao;',
    '  col = mix(col, voidc, hole);',
    '  col += vec3(1.00,0.30,0.05)*ember*0.85;',
    '  col += vec3(1.00,0.50,0.15)*exp(-pow((sdE - 0.008)/0.014, 2.0))*0.10*flick*smoothstep(0.40, 0.72, burnN);',
    /* 唱过的那一段：余烬往那边爬（那边烧得更透） */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(1.0,0.40,0.10)*litFront*ember*0.55;',
    /* 环境：桌上一张被火吃过的纸，只有一束斜光 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.16 + pq.y*pq.y*1.05));',
    '  float vig = 1.0 - smoothstep(0.22, 1.24, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.36 + 0.64*vig;',
    '  col += vec3(0.055,0.040,0.028)*pool*0.55;',
    '  col = 1.0 - exp(-col*1.85);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 51.0) - 0.5)*0.011;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 洞里什么也没有：一层很薄的暖黑，让洞口在暗处也稳 */
  const vg = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  vg.addColorStop(0.00, 'rgba(40,30,24,0.55)');
  vg.addColorStop(0.40, 'rgba(22,17,14,0.62)');
  vg.addColorStop(0.72, 'rgba(14,11,9,0.66)');
  vg.addColorStop(1.00, 'rgba(9,7,6,0.62)');
  g.fillStyle = vg;
  g.fillText(L.text, cx, cy);
  /* 洞口内缘的一点暖（余烬落在洞壁上的反光） */
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const ig = g.createLinearGradient(0, cy - fs * 0.58, 0, cy + fs * 0.58);
  ig.addColorStop(0.00, 'rgba(120,52,16,0.00)');
  ig.addColorStop(0.30, 'rgba(150,62,18,0.10)');
  ig.addColorStop(0.62, 'rgba(96,38,10,0.05)');
  ig.addColorStop(1.00, 'rgba(60,22,6,0.00)');
  g.fillStyle = ig;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
