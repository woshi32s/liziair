export default {
  num: '275', slug: 'water-marbling', title: '水拓大理石',
  accent: [0.42, 0.62, 0.86],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.30,
  doc: `   275 · 水拓大理石 —— 字是浮在水面上的一块挡板：墨绕着它流过去，边上被挤成细脉

   机制一句话：
      水拓（Ebru）是把墨滴在加了胶的水面上，用梳子/针把墨**拨开**，再把纸覆上去印下来。
      字是水面上**挡着墨的那块模板**：墨绕着它流、在它边上被**挤密**——
      所以字的边界不是画出来的线，是一束被压紧的平行细脉（墨被挤到那儿去了）；
      字里是没沾到墨的纸（米白、有纤维），字外是被拨出漩涡的墨（靛青，一层层）。
      拓印出来的东西左右是**反的**，也是真的（纸覆上去时翻了一次面）。

   和前作的区别：
      216 熔岩是**光**在缝里；271 是砂的**形状**；
      这里是墨在**水面上的流动图案**：没有高度、没有高光、没有光源方向 ——
      只有吸进纸里的颜料密度。整幅是平涂的，靠"墨的旋"和"字边的挤"显形。

   动态：换句时新的一块模板浸下去（u_st：墨往边上让开）；唱到的那一段纸更干、墨更淡（u_front）；
   拍点上水面一颤（u_kick，墨脉轻轻错位）。`,
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
    '  float g0 = 1.0 - smoothstep(-ep*1.7, ep*1.7, sd);',
    '  float dist = abs(sd);',
    '  float e = max(ep*1.6, 0.002);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    /* 水面上的墨：被针拨出来的漩涡（几层错开的正弦 + 噪声） */
    '  vec2 p = uv;',
    '  p.x += 0.24*sin(p.y*2.05 + 1.20) + 0.090*sin(p.y*5.10 - 0.60);',
    '  p.y += 0.170*sin(p.x*2.55 + 2.40) + 0.055*sin(p.x*6.30 + 0.30);',
    '  p += vec2(vn(uv*1.15 + 3.0) - 0.5, vn(uv*1.05 - 2.0) - 0.5)*0.20;',
    /* 模板把墨挤开：位移场指向字外，墨脉因此在边上被压紧 */
    '  vec2 q = p - gr*(0.020*exp(-dist/0.030) + 0.004);',
    '  q += vec2(sin(t*0.5)*0.004, cos(t*0.4)*0.004);',
    '  float b1 = sin(q.y*13.0 + q.x*3.20 + vn(q*1.60)*3.60);',
    '  float b2 = sin(q.y*31.0 - q.x*7.40 + vn(q*3.10)*3.90);',
    '  float b3 = sin(q.y*67.0 + q.x*13.0 + vn(q*5.00)*4.20);',
    '  float inkA = smoothstep(0.12, 0.62, b1);',
    '  float ink = inkA*0.86 + smoothstep(0.30, 0.90, b2)*(0.10 + 0.30*inkA) + smoothstep(0.55, 0.98, b3)*0.10;',
    '  ink = clamp(ink, 0.0, 1.0);',
    /* 边上的挤压：越贴边墨越浓（被挤到那儿去了） */
    '  float press = exp(-dist/0.016);',
    '  ink = mix(ink, 1.0, press*0.55);',
    /* 纸：米白、有纤维（拓印时纸被压在墨上，纤维把墨带出细纹） */
    '  float fib = vn(vec2(uv.x*170.0, uv.y*23.0))*0.55 + vn(vec2(uv.x*31.0, uv.y*190.0))*0.45;',
    '  vec3 paper = vec3(0.800,0.755,0.640);',
    '  paper *= 0.86 + 0.22*fib;',
    '  paper *= 0.94 + 0.09*vn(uv*8.0 + 4.0);',
    /* 墨：靛青，浓的地方几乎黑，淡的地方泛灰蓝 */
    '  vec3 inkc = mix(vec3(0.115,0.160,0.235), vec3(0.022,0.032,0.062), ink);',
    '  inkc = mix(inkc, u_ac*0.30, 0.10*(1.0 - ink));',
    /* 字里没有墨 —— 模板挡着；但边界上墨会渗进纸里一丝 */
    '  float cover = ink*smoothstep(-0.006, 0.004, sd);',
    '  cover += exp(-dist/0.007)*0.30;',
    '  cover = clamp(cover, 0.0, 1.0);',
    /* 纸被水浸过的地方稍暗（模板压过的一圈） */
    '  paper *= 1.0 - 0.10*exp(-dist/0.022);',
    '  vec3 col = mix(paper, inkc, cover*0.96);',
    /* 拓印的麻点：颜料被纸的纤维吸住，有极细的颗粒 */
    '  float mot = vn(uv*300.0)*0.5 + vn(uv*120.0)*0.5;',
    '  col *= 0.97 + 0.05*mot;',
    /* 唱过的那一段：纸更干，墨淡下去一层 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col = mix(col, paper*0.96, litFront*cover*0.20);',
    '  col *= 1.0 + 0.02*u_kick;',
    /* 环境：一张拓片摊在桌上，边角被压暗 */
    '  float vig = 1.0 - smoothstep(0.26, 1.22, length(uv*vec2(0.60,0.90)));',
    '  col *= 0.40 + 0.60*vig;',
    '  col += (h21(gl_FragCoord.xy*0.9 + 81.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 模板挡出来的那块纸：米白、带纸的纤维；边上被墨压出一条细的深边 */
  const pg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  pg.addColorStop(0.00, 'rgba(214,206,186,0.85)');
  pg.addColorStop(0.34, 'rgba(198,190,170,0.72)');
  pg.addColorStop(0.70, 'rgba(176,168,150,0.62)');
  pg.addColorStop(1.00, 'rgba(150,143,128,0.55)');
  g.fillStyle = pg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 纸的纤维：细的短道子 */
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const len = fs * (0.02 + Math.random() * 0.16);
    const ang = Math.random() * 3.1416;
    g.strokeStyle = Math.random() < 0.5
      ? 'rgba(246,242,228,' + (0.05 + Math.random() * 0.14).toFixed(3) + ')'
      : 'rgba(110,100,84,' + (0.03 + Math.random() * 0.09).toFixed(3) + ')';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  g.restore();
  /* 模板的边：墨被挤在边上，压出一圈极细的深 */
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(38,54,80,0.26)';
  g.lineWidth = Math.max(1, fs * 0.014);
  g.strokeText(L.text, cx, cy);`,
  post: ''
};
