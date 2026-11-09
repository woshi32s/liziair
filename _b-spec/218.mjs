export default {
  num: '218', slug: 'frost-bloom', title: '霜花成字',
  accent: [0.72, 0.86, 0.98],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.92,
  doc: `   218 · 霜花成字 —— 冷玻璃上的水汽先在字里结晶，字是**霜长出来的地方**

   机制一句话：
     霜不是画上去的：字形是**成核密度场**（字内的过饱和度最高，字外一圈指数衰减），
     水汽沿着这个密度用枝晶（ridged noise 沿一个方向拉长）结晶，霜层把光散射成白色；
     句龄推进 → 霜从字缘往外长（生长前沿推进），越靠外越薄、越像雾 —— 字是被冻出来的。

   和前作的区别：
     lizi18 是霜花结晶（对称的冰枝图案）、lizi32 是蒸汽凝结（水汽/液滴）；
     这里霜的**形状由字决定**：不是先有霜再看图案，是成核场让霜只肯长在字上，
     所以字的轮廓就是霜层的边界，外面那一圈是过渡的雾凇。

   换句：上一句的霜先化开（u_st 回 0），新的一句重新结晶（u_st 长到 1）。`,
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
    /* 枝晶：脊状噪声（1-|2n-1|），沿一个方向拉长就是冰的针 */
    'float ridge(vec2 p){ float n = vn(p); return 1.0 - abs(2.0*n - 1.0); }',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float sd = gsd(uv);',
    '  float grow = u_st;',
    /* 成核场：字内最浓，字外按指数衰减；随生长前沿往外推 */
    '  float reach = u_epx*(3.0 + 12.0*grow);',
    '  float nuc = 1.0 - smoothstep(-u_epx*2.0, reach, sd);',
    /* 晶体：三层枝晶，方向各不相同（霜不是规整的格子） */
    '  float c1 = ridge(vec2(uv.x*52.0, uv.y*13.0) + 3.0);',
    '  float c2 = ridge(vec2(uv.x*17.0 - uv.y*9.0, uv.y*27.0) + 9.0);',
    '  float c3 = ridge(vec2(uv.x*128.0, uv.y*128.0) + 21.0);',
    '  float cryst = clamp(c1*0.52 + c2*0.30 + c3*0.22, 0.0, 1.0);',
    '  cryst = pow(cryst, 2.2);',
    /* 霜层厚度：成核场 × 晶体，生长前沿处变薄（雾凇） */
    '  float frost = nuc*(0.35 + 1.15*cryst);',
    '  frost = clamp(frost*(0.18 + 0.88*grow)*0.88, 0.0, 1.0);',
    /* 水汽：还没结霜的地方有一层薄雾（在玻璃上） */
    '  float mist = 1.0 - smoothstep(-u_epx*40.0, u_epx*80.0, sd);',
    '  mist = clamp(mist*0.22*(0.6 + 0.4*vn(uv*6.0 + t*0.03)), 0.0, 1.0);',
    /* 冷玻璃底：深蓝灰 + 一点内反射 */
    '  vec3 glass = vec3(0.022,0.030,0.044);',
    '  glass += vec3(0.030,0.045,0.062)*(1.0 - smoothstep(0.0, 1.3, length(uv*vec2(0.7,1.0))));',
    '  glass += vec3(0.020,0.028,0.038)*vn(uv*2.2 + 4.0);',
    '  glass += vec3(0.010,0.016,0.024)*mist*4.0;',
    /* 霜：散射成白，晶体脊上更亮 */
    '  vec3 ice = mix(vec3(0.78,0.86,0.96), vec3(0.96,0.99,1.00), cryst);',
    '  ice *= 0.55 + 0.75*cryst;',
    '  vec3 col = mix(glass, ice, frost*0.94);',
    '  col += ice*cryst*frost*0.22;',
    /* 生长前沿：霜薄的地方有一圈亮边（霜的边缘会反光） */
    '  float front = exp(-pow((sd - reach*0.85)/(reach*0.55), 2.0));',
    '  col += vec3(0.55,0.70,0.88)*front*0.11*grow;',
    /* 字缘：霜最厚的地方压一点暗（霜层下面透不出光） */
    '  float body = 1.0 - smoothstep(-u_epx*3.0, u_epx*3.0, sd);',
    '  col *= 1.0 - 0.10*body;',
    /* 已经唱过的那一段：霜更厚更白 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += vec3(0.10,0.13,0.16)*litFront*body*frost;',
    '  col *= 1.0 + 0.04*u_kick;',
    /* 环境 */
    '  float vig = 1.0 - smoothstep(0.24, 1.50, length(uv*vec2(0.62,0.88)));',
    '  col *= 0.38 + 0.62*vig;',
    '  col = 1.0 - exp(-col*1.50);',
    '  col += (h21(gl_FragCoord.xy*0.85 + 11.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 霜的实体：字里是密实的白霜（带晶体颗粒），边缘稍透 */
  const grad = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  grad.addColorStop(0, '#fdfeff');
  grad.addColorStop(0.34, '#eef5ff');
  grad.addColorStop(0.72, '#d6e6f8');
  grad.addColorStop(1, '#b9cfe8');
  g.fillStyle = grad;
  g.fillText(L.text, cx, cy);

  /* 晶体颗粒：小亮点 + 针状纹，裁在字里 */
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const r = 0.6 + Math.random() * 1.7;
    g.fillStyle = 'rgba(255,255,255,' + (0.25 + Math.random() * 0.55).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.30)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const a = Math.random() * 0.7 - 0.35;
    const l = 4 + Math.random() * 16;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(a) * l, y + Math.cos(a) * l);
    g.stroke();
  }
  /* 字的下缘压一点冷影，霜才有厚度 */
  const sh = g.createLinearGradient(0, cy + fs * 0.10, 0, cy + fs * 0.64);
  sh.addColorStop(0, 'rgba(40,60,86,0)');
  sh.addColorStop(1, 'rgba(40,60,86,0.30)');
  g.fillStyle = sh;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: `  /* 玻璃上的水珠：预烘一张珠光贴图，每帧只 drawImage（不要每帧 createRadialGradient） */
  if (hasLine) {
    if (!window.__drop) {
      const S = 64;
      const dc = document.createElement('canvas');
      dc.width = S; dc.height = S;
      const dg = dc.getContext('2d');
      const rg = dg.createRadialGradient(S * 0.38, S * 0.34, 0, S * 0.5, S * 0.5, S * 0.5);
      rg.addColorStop(0, 'rgba(236,246,255,0.95)');
      rg.addColorStop(0.42, 'rgba(178,206,236,0.40)');
      rg.addColorStop(0.82, 'rgba(120,160,200,0.14)');
      rg.addColorStop(1, 'rgba(110,150,190,0)');
      dg.fillStyle = rg;
      dg.beginPath(); dg.arc(S * 0.5, S * 0.5, S * 0.5, 0, 6.2832); dg.fill();
      window.__drop = dc;
    }
    const drop = window.__drop;
    const sp = rm ? 0.2 : 1;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 26; i++) {
      const bx = ((i * 0.618) % 1) * W + Math.sin(T * 0.25 * sp + i) * 7;
      const by = ((i * 0.377) % 1) * H + ((T * 0.9 * sp + i * 13) % 60) * 0.42;
      const s2 = 5 + (i % 5) * 3.2;
      ctx.globalAlpha = 0.30 + (i % 3) * 0.10;
      ctx.drawImage(drop, bx - s2 / 2, by - s2 / 2, s2, s2);
    }
    ctx.globalAlpha = 1;
  }`
};
