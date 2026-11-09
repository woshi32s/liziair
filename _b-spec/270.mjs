export default {
  num: '270', slug: 'underglaze-cobalt', title: '釉下彩',
  accent: [0.42, 0.58, 0.92],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.62,
  doc: `   270 · 釉下彩 —— 字是在坯上画的钴料，上面还罩着一层透明的釉

   机制一句话：
      字不是表面上的东西，是**埋在一层透明釉下面**的：钴料是磨细的氧化钴粉，
      调了胶画在生坯上，再罩一层透明釉、一次烧成 ——
      所以字有两层身份：**料**（粉层：边缘积料、颗粒粗、有干笔的飞白）和
      **釉**（罩在它上面的一层玻璃：整片的高光扫过幅面，横穿字面也不断，
      因为高光属于釉面、不属于字）。字缘一圈略深 —— 钴料颗粒被水带到笔触边缘堆下来；
      字外一圈极淡的蓝 —— 颜料顺着釉往坯里渗开的一点晕。

   和前作的区别：
      这是本组唯一的**画**：不是压、不是刻、不是蚀、不是反射 ——
      字是"画上去的一层粉 + 盖在上面的一层玻璃"，靠**颜料密度**显形。
      高光在字上面（post 里画，压住字），这一点没有任何一个前作有。

   动态：换句时新的一笔"洇"开（u_st）；唱到的那一段料更沉、釉更亮（u_front）；
   拍点让釉上的高光一晃（u_kick）。`,
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
    '  float g = 1.0 - smoothstep(-ep*2.0, ep*2.0, sd);',
    '  float e = max(ep*1.8, 0.0022);',
    '  vec2 gr = vec2(gsd(uv+vec2(e,0.0)) - sd, gsd(uv+vec2(0.0,e)) - sd)/e;',
    '  gr = normalize(gr + vec2(1e-6));',
    '  float dist = abs(sd);',
    /* 釉面几乎全平（玻璃），只有拉坯的极缓弧面 + 料层把釉顶起的极薄一层 */
    '  vec2 N = vec2(vn(uv*0.85 + 3.0) - 0.5, vn(uv*0.85 - 2.0) - 0.5)*0.045;',
    '  float rise = 1.0 - smoothstep(-0.016, 0.028, sd);',
    '  N -= gr*rise*0.055;',
    '  vec3 N3 = normalize(vec3(N, 1.0));',
    /* 胎：灰白的瓷，有一点点拉坯的纹、几点针孔里的小铁点 */
    '  vec3 body = vec3(0.255,0.258,0.248);',
    '  body *= 0.88 + 0.13*vn(uv*7.0 + 1.0) + 0.07*vn(uv*23.0 - 3.0);',
    '  float iron = step(0.9986, h21(floor(uv*420.0) + 7.0));',
    '  body *= 1.0 - 0.40*iron;',
    /* 钴料：粉层，密度不匀；笔触边缘积料（颗粒被水带走堆下来） */
    '  float dens = 0.64 + 0.30*vn(uv*7.5 + 5.0) + 0.12*vn(uv*24.0 - 2.0);',
    '  float gran = exp(-pow((dist - 0.0055)/0.0080, 2.0));',
    '  dens += gran*0.40;',
    '  dens *= 0.78 + 0.42*u_st;',
    '  vec3 pig = mix(vec3(0.042,0.058,0.120), vec3(0.100,0.152,0.300), clamp(dens - 0.45, 0.0, 1.0));',
    '  pig = mix(pig, u_ac*0.36, 0.10);',
    '  vec3 alb = mix(body, pig, clamp(g*0.95, 0.0, 1.0));',
    /* 字外的一点晕：料顺着釉渗进坯里 */
    '  float halo = exp(-dist/0.015)*(1.0 - g);',
    '  alb = mix(alb, vec3(0.085,0.125,0.245), halo*0.24);',
    /* 釉：一层青白的薄玻璃，微微提亮、压一点红 */
    '  alb *= vec3(0.96,1.00,0.99);',
    '  alb *= 0.95 + 0.08*vn(uv*3.4 + 9.0);',
    /* 光：左上一扇冷窗，右下一盏暖灯（漫反射很平，因为釉面平） */
    '  float d1 = max(dot(N3, normalize(vec3(-0.34,0.44,0.83))), 0.0);',
    '  float d2 = max(dot(N3, normalize(vec3(0.56,-0.30,0.77))), 0.0);',
    '  vec3 col = alb*(0.30 + 0.80*d1);',
    '  col += alb*vec3(0.50,0.58,0.70)*d2*0.22;',
    /* 釉面上的那扇窗：一整块柔和的亮斑（post 里再压一层更亮的，见下） */
    '  vec2 wq = uv + N*0.9;',
    '  float win = smoothstep(0.70, 0.06, length((wq - vec2(-0.36, 0.28))*vec2(0.60, 1.02)));',
    '  col += vec3(0.30,0.36,0.44)*win*0.22;',
    '  float wframe = exp(-pow((wq.x + 0.92)/0.055, 2.0))*smoothstep(0.62, 0.10, abs(wq.y - 0.16));',
    '  col += vec3(0.44,0.50,0.58)*wframe*0.26;',
    /* 唱过的那一段：料显得更沉、釉更亮 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col *= 1.0 - 0.10*litFront*g;',
    '  col += vec3(0.55,0.66,0.86)*litFront*g*0.030;',
    '  col *= 1.0 + 0.03*u_kick;',
    /* 环境：暗处的一件瓷器，只有一束光落在字上 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.17 + pq.y*pq.y*1.10));',
    '  float vig = 1.0 - smoothstep(0.18, 1.18, length(uv*vec2(0.58,0.90)));',
    '  col *= 0.18 + 0.82*vig;',
    '  col += vec3(0.026,0.030,0.042)*pool*0.75;',
    '  col = 1.0 - exp(-col*2.05);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 31.0) - 0.5)*0.009;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 钴料的一笔：竖向由深到浅、边缘积料更深、干笔处飞白 */
  const cg = g.createLinearGradient(0, cy - fs * 0.60, 0, cy + fs * 0.60);
  cg.addColorStop(0.00, '#22355c');
  cg.addColorStop(0.22, '#1a2846');
  cg.addColorStop(0.48, '#111c36');
  cg.addColorStop(0.72, '#0b1428');
  cg.addColorStop(1.00, '#070c1a');
  g.fillStyle = cg;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 干笔：短横的道子，浅的地方透出一点釉的白 */
  for (let i = 0; i < 300; i++) {
    const y = cy - fs * 0.60 + Math.random() * fs * 1.20;
    const x = Math.random() * pw;
    const w = fs * (0.03 + Math.random() * 0.26);
    g.fillStyle = Math.random() < 0.52
      ? 'rgba(126,156,206,' + (0.030 + Math.random() * 0.080).toFixed(3) + ')'
      : 'rgba(3,7,16,' + (0.070 + Math.random() * 0.130).toFixed(3) + ')';
    g.fillRect(x, y, w, 1 + Math.random() * 2.4);
  }
  /* 料的浓淡：几块不均匀的深浅（料在笔里沉下来了） */
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * pw, y = cy + (Math.random() - 0.5) * fs;
    const rr = fs * (0.16 + Math.random() * 0.34);
    const rg = g.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, Math.random() < 0.5 ? 'rgba(2,5,14,0.32)' : 'rgba(96,132,190,0.16)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  g.restore();
  /* 积料：贴边一圈更深（颗粒被水带到笔触边缘） */
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(3,7,16,0.32)';
  g.lineWidth = Math.max(1, fs * 0.028);
  g.strokeText(L.text, cx, cy);`,
  post: `
  /* 釉面上的高光：它属于罩在字上面的那层玻璃 —— 横穿字面也不断，
     而且随拍点轻轻一晃（玻璃不会跟着字动，这是"字在釉下"的证据） */
  {
    const sp = rm ? 0.2 : 1;
    const hx = W * (0.60 + 0.030 * Math.sin(T * 0.11 * sp));
    const hy = H * (0.30 + 0.020 * Math.sin(T * 0.07 * sp + 1.3));
    const rx = W * 0.46, ry = H * 0.30;
    const kg = 1 + 0.10 * Math.min(1, kick);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(hx, hy);
    ctx.scale(rx * kg, ry * kg);
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g1.addColorStop(0.00, 'rgba(150,172,205,0.16)');
    g1.addColorStop(0.45, 'rgba(120,142,180,0.07)');
    g1.addColorStop(1.00, 'rgba(90,110,150,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.2832); ctx.fill();
    ctx.restore();
    /* 一根窗框的窄亮边（玻璃上最亮的那条） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(W * (0.34 + 0.018 * Math.sin(T * 0.09 * sp + 0.7)), H * 0.5);
    ctx.rotate(-0.055);
    const g2 = ctx.createLinearGradient(0, -H * 0.34, 0, H * 0.34);
    g2.addColorStop(0.00, 'rgba(190,210,240,0)');
    g2.addColorStop(0.42, 'rgba(200,218,246,0.13)');
    g2.addColorStop(0.56, 'rgba(226,238,255,0.20)');
    g2.addColorStop(0.72, 'rgba(190,210,240,0.06)');
    g2.addColorStop(1.00, 'rgba(190,210,240,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(-W * 0.02, -H * 0.34, W * 0.045, H * 0.68);
    ctx.restore();
  }`
};
