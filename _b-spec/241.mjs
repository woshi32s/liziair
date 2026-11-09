export default {
  num: '241', slug: 'foil-crumple', title: '锡箔褶皱',
  accent: [0.72, 0.80, 0.90],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.74,
  doc: `   241 · 锡箔褶皱 —— 字是模子压平的那一块箔，周围还是揉皱的

   机制一句话：
      揉皱的锡箔表面是**一道道 V 形折棱**：高度场由三组方向不同、互相穿插的
      |sin| 折叠波叠加（相位被噪声扭过），法线由高度场的差分得到；
      字是**压模**把这一块箔压平 —— 高度振幅被压到 6%，法线回到 +Z，
      于是周围碎成一片片翻滚的金属反光，字里是一整条连续的反射带。
      显影靠"反射的**连贯性**"：不是明暗差、不是浮雕，是镜面的碎与整。

   和前作的区别：
      212 是锤纹黄铜（半球锤坑的法线扰动 + 抛光渐变）；这里是**零曲率的折面**：
      表面没有鼓包，只有折棱两侧的平面在翻滚，每一片的亮度由
      环境（左上的一扇窗 + 顶上冷天光 + 地下暖反光）与法线夹角决定 ——
      所以画面里会出现整片突然翻亮的折面，这是金属箔独有的。

   动态：换句时压模"压下去"（u_st）；唱到的那一段箔被压得更服帖（u_front）；
   折棱上的细碎闪点随拍点一颤（u_kick）。`,
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
    /* 环境：金属没有漫反射，只有"镜子里看到什么" */
    'vec3 env(vec3 n, float t){',
    '  float up = clamp(n.y*0.5 + 0.5, 0.0, 1.0);',
    '  vec3 c = mix(vec3(0.022,0.026,0.034), vec3(0.24,0.28,0.34), up*up);',
    '  vec3 wd = normalize(vec3(-0.58, 0.40, 0.70));',
    '  float w = max(dot(n, wd), 0.0);',
    '  c += vec3(1.00,0.98,0.93)*pow(w, 9.0)*0.95;',
    '  c += vec3(0.84,0.89,1.00)*pow(w, 3.0)*0.30;',
    '  vec3 wd2 = normalize(vec3(0.42, 0.10, 0.90));',
    '  float w2 = max(dot(n, wd2), 0.0);',
    '  c += vec3(0.72,0.80,0.96)*pow(w2, 26.0)*0.55;',
    '  float gb = clamp(-n.y*1.15, 0.0, 1.0);',
    '  c += vec3(0.34,0.22,0.13)*gb*gb*0.34;',
    '  c += vec3(0.09,0.10,0.12)*clamp(n.z, 0.0, 1.0)*0.25;',
    '  return c;',
    '}',
    /* 揉皱的箔：抖动网格取最近核 → 每片一个平面朝向；
       再加一层大尺度的"整张箔被弯折"的倾斜（sheet），片就成组成片，不像马赛克 */
    'vec4 facet(vec2 p){',
    '  vec2 ip = floor(p), fp = fract(p);',
    '  float d1 = 8.0, d2 = 8.0;',
    '  vec2 id = ip;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 g = vec2(float(x), float(y));',
    '      vec2 o = vec2(h21(ip + g + 1.7), h21(ip + g + 5.3));',
    '      vec2 r = g + o - fp;',
    '      float d = dot(r, r);',
    '      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }',
    '    }',
    '  }',
    '  float a = h21(id + 0.7), b = h21(id + 9.1);',
    '  return vec4((a - 0.5)*1.55, (b - 0.5)*1.55, sqrt(d2) - sqrt(d1), h21(id + 17.3));',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 压平程度：字里 1，字外 0；坡宽 0.042uv ≈ 19px */
    '  float w = 0.042;',
    '  float f0 = 1.0 - smoothstep(-w*0.55, w*0.80, sd);',
    '  float flat_ = f0*f0*(3.0 - 2.0*f0)*u_st;',
    /* 大尺度：整张箔被弯过（sheet 倾斜），让成片的折面朝同一侧翻 */
    '  vec2 sheet = vec2(vn(uv*0.78 + 3.0) - 0.5, vn(uv*0.71 - 5.0) - 0.5)*2.35;',
    '  vec2 sheet2 = vec2(vn(uv*1.9 + 13.0) - 0.5, vn(uv*1.7 + 2.0) - 0.5)*0.95;',
    /* 两级折面：大折片 + 小折片 */
    '  vec4 A = facet((uv + sheet*0.30)*6.0 + 2.0);',
    '  vec4 B = facet((uv + sheet*0.30)*15.0 - 5.0);',
    '  vec2 nxy = sheet*1.25 + sheet2 + A.xy*0.72 + B.xy*0.20;',
    /* 字的压平区：法线回到 +Z，只剩压痕坡 */
    '  float e = max(ep*1.4, 0.0016);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(clamp(gr, vec2(-2.5), vec2(2.5)) + vec2(1e-6));',
    '  nxy = mix(nxy, gr*0.16, flat_*0.94);',
    '  vec3 N = normalize(vec3(nxy, 1.0));',
    '  vec3 c = env(N, t);',
    /* 折棱：片与片之间是一条硬边 —— 亮棱 + 紧贴的一道暗沟 */
    '  float edA = smoothstep(0.085, 0.0, A.z)*mix(1.0, 0.06, flat_);',
    '  float edB = smoothstep(0.045, 0.0, B.z)*mix(1.0, 0.03, flat_);',
    '  c *= 1.0 - 0.16*edA - 0.08*edB;',
    '  c += vec3(0.98,0.99,1.0)*(edA*0.22 + edB*0.10)*(0.35 + 0.65*max(N.y*0.5+0.5, 0.0));',
    /* 金属的菲涅尔：掠射角更亮 */
    '  float fres = pow(1.0 - clamp(N.z, 0.0, 1.0), 3.0);',
    '  c += vec3(0.60,0.68,0.86)*fres*0.26;',
    /* 微米级粗糙：高光上撒极细的闪点 */
    '  float grain = vn(uv*540.0 + N.xy*60.0)*0.6 + vn(uv*190.0 - 7.0)*0.4;',
    '  c *= 0.90 + 0.22*grain;',
    '  c += vec3(0.9,0.93,1.0)*pow(max(N.y,0.0), 20.0)*0.10*grain;',
    /* 压痕：字边缘一道被压出来的亮棱 + 外侧一圈压下去的暗（AO） */
    '  float dent = exp(-pow((sd + 0.005)/(0.0070), 2.0));',
    '  c += vec3(0.95,0.97,1.0)*dent*0.34;',
    '  float ao = exp(-pow((sd - 0.014)/(0.012), 2.0))*step(0.0, sd);',
    '  c *= 1.0 - 0.34*ao;',
    /* 压平的一块：反射带更整齐 → 提亮；被唱到的段落再亮一丝 */
    '  c *= 1.0 + 0.30*flat_;',
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  c += vec3(0.74,0.80,0.92)*litFront*flat_*0.05;',
    /* 环境：暗棚里一池光 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.18 + pq.y*pq.y*1.20));',
    '  float vig = 1.0 - smoothstep(0.16, 1.24, length(uv*vec2(0.58,0.86)));',
    '  c *= 0.24 + 0.76*vig;',
    '  c += vec3(0.045,0.050,0.068)*pool*0.45;',
    '  c *= 1.0 + 0.06*u_kick;',
    '  c = 1.0 - exp(-c*1.45);',
    '  c += (h21(gl_FragCoord.xy*0.9 + 5.0) - 0.5)*0.012;',
    '  gl_FragColor = vec4(max(c,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 压平的箔：冷银竖向渐变（上部反射天光更亮）+ 一道极锐的窗光 + 没压到的死褶 */
  g.save();
  g.globalAlpha = 0.42;
  g.fillStyle = '#04060a';
  g.filter = 'blur(' + (fs * 0.016).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.012, cy + fs * 0.022);
  g.filter = 'none';
  g.restore();

  const sl = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  sl.addColorStop(0.00, '#f6f9fd');
  sl.addColorStop(0.16, '#e2e9f1');
  sl.addColorStop(0.38, '#bcc5d1');
  sl.addColorStop(0.60, '#8f99a7');
  sl.addColorStop(0.84, '#6a7381');
  sl.addColorStop(1.00, '#4f5764');
  g.fillStyle = sl;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 压模的边缘：上左硬高光、下右暗 */
  g.save();
  g.globalAlpha = 0.50;
  g.filter = 'blur(' + (fs * 0.009).toFixed(1) + 'px)';
  g.fillStyle = '#161d29';
  g.fillText(L.text, cx + fs * 0.013, cy + fs * 0.018);
  g.restore();
  g.save();
  g.globalAlpha = 0.56;
  g.filter = 'blur(' + (fs * 0.007).toFixed(1) + 'px)';
  g.fillStyle = '#ffffff';
  g.fillText(L.text, cx - fs * 0.009, cy - fs * 0.013);
  g.filter = 'none';
  g.restore();
  /* 极锐的窗光：一条窄的、断了的高光（金属反射窗框） */
  const wb = g.createLinearGradient(0, cy - fs * 0.44, 0, cy - fs * 0.08);
  wb.addColorStop(0.00, 'rgba(255,255,255,0)');
  wb.addColorStop(0.40, 'rgba(255,255,252,0.66)');
  wb.addColorStop(0.56, 'rgba(255,255,255,0.08)');
  wb.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = wb;
  g.fillRect(0, 0, pw, ph);
  /* 几道残留的折痕（压平没压到的死褶） */
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const y0 = cy - fs * 0.5 + Math.random() * fs;
    const x0 = pw * Math.random() * 0.35;
    g.beginPath(); g.moveTo(x0, y0);
    g.lineTo(x0 + pw * 0.35 + Math.random() * pw * 0.5, y0 + (Math.random() - 0.5) * fs * 0.40);
    g.strokeStyle = 'rgba(28,36,48,0.38)';
    g.lineWidth = 2.4;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.34)';
    g.lineWidth = 0.9;
    g.stroke();
  }
  /* 底部：反射地面的一点暖 */
  const gb2 = g.createLinearGradient(0, cy + fs * 0.12, 0, cy + fs * 0.62);
  gb2.addColorStop(0.0, 'rgba(130,100,72,0)');
  gb2.addColorStop(1.0, 'rgba(104,80,56,0.28)');
  g.fillStyle = gb2;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
