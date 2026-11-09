export default {
  num: '242', slug: 'wet-asphalt', title: '湿沥青',
  accent: [0.98, 0.74, 0.42],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.24,
  doc: `   242 · 湿沥青 —— 字是车辙里积的一层水膜，只有水膜把灯照给你看

   机制一句话：
      同一块沥青上有两种**表面粗糙度**：干燥处是碎石骨料（微观法线乱翻，路灯的像被揉成
      一层碎闪的哑光），字是压进路面的车辙、里面积了一层水膜 —— 水把微观法线抹平，
      于是那盏正上方的钠灯的像只在字里聚成一条完整的光；雨点打出的涟漪把光拧出细纹。
      沥青本身几乎不发光，全片的光都是**反射**来的：字的亮度就是灯在水膜里的像。

   和前作的区别：
      214 是池底焦散（水下的光斑，靠折射亮纹）；这里是**镜面反射**：不折射、不进水里，
      只有"粗糙 vs 光滑"两种微表面在同一个平面上，字的边界是一条水膜的弯月面。

   动态：换句时水膜"铺开"（u_st），唱到的那一段涟漪更密（u_front），雨点随拍点一颤（u_kick）。`,
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
    /* 反射方向 r 上看到的东西：夜空 + 地平线辉光 + 正上方的钠灯 + 右边一扇冷光的店招 */
    'vec3 skyEnv(vec3 r){',
    '  float el = clamp(r.z, -1.0, 1.0);',
    '  vec3 c = mix(vec3(0.012,0.015,0.022), vec3(0.095,0.125,0.175), pow(max(el, 0.0), 1.6));',
    '  float hor = exp(-pow(el/0.22, 2.0));',
    '  c += vec3(0.26,0.21,0.16)*hor*0.30;',
    /* 钠灯：基本在正上方。字的平面正对着它，所以字的整块都在"灯里" */
    '  vec3 ld = normalize(vec3(-0.10, 0.06, 1.0));',
    '  float lam = max(dot(r, ld), 0.0);',
    '  c += vec3(1.00,0.74,0.42)*pow(lam, 34.0)*1.55;',
    '  c += vec3(1.00,0.83,0.58)*pow(lam, 6.0)*0.16;',
    /* 右边一扇冷光（店招/远处车灯） */
    '  vec3 ld2 = normalize(vec3(0.78, -0.34, 0.52));',
    '  c += vec3(0.42,0.62,0.96)*pow(max(dot(r, ld2), 0.0), 26.0)*0.85;',
    '  return c;',
    '}',
    /* 雨点的涟漪：几组同心圆环；一次算好高度和梯度（WebGL1 没有 dFdx） */
    'vec3 rippleG(vec2 p, float t){',
    '  float h = 0.0;',
    '  vec2 g = vec2(0.0);',
    '  for (int i = 0; i < 3; i++) {',
    '    float fi = float(i);',
    '    vec2 ctr = vec2(h21(vec2(fi*7.1 + 2.0, 3.0)), h21(vec2(fi*3.3, 9.0)))*3.4 - 1.7;',
    '    float ph = fract(t*0.6 + fi*0.37);',
    '    vec2 d = p - ctr;',
    '    float r = max(length(d), 0.0008);',
    '    float amp = exp(-r*2.0)*exp(-ph*3.2);',
    '    float arg = (r - ph*1.30)*52.0;',
    '    h += sin(arg)*amp;',
    '    float dh = cos(arg)*52.0*amp + sin(arg)*(-2.0*amp);',
    '    g += (d/r)*dh;',
    '  }',
    '  return vec3(h, g);',
    '}',
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 水膜：字里 1，字外 0；弯月面在 sd≈0 */
    '  float wet = 1.0 - smoothstep(-ep*1.4, ep*2.4, sd);',
    '  float film = wet*u_st;',
    /* 字外也有积水：低频噪声选出一片片水洼（形状要broken，别成圆斑） */
    '  float pudN = vn(uv*2.10 + 9.0)*0.60 + vn(uv*1.05 - 3.0)*0.40;',
    '  float pud = smoothstep(0.60, 0.78, pudN)*0.55;',
    '  float wetA = clamp(film + pud*(1.0 - film), 0.0, 1.0);',
    /* --- 沥青：骨料 + 砂粒 --- */
    '  float ag = vn(uv*112.0)*0.55 + vn(uv*44.0 + 3.0)*0.45;',
    '  float sand = vn(uv*420.0)*0.6 + vn(uv*170.0 - 5.0)*0.4;',
    '  float stone = smoothstep(0.56, 0.80, vn(uv*145.0 + 11.0));',
    '  float dsx = 0.0026;',
    '  float hx = vn((uv + vec2(dsx,0.0))*112.0)*0.55 + vn((uv + vec2(dsx,0.0))*44.0 + 3.0)*0.45;',
    '  float hy = vn((uv + vec2(0.0,dsx))*112.0)*0.55 + vn((uv + vec2(0.0,dsx))*44.0 + 3.0)*0.45;',
    '  vec2 gA = vec2((hx - ag)/dsx, (hy - ag)/dsx);',
    /* 干燥的沥青：微观法线乱翻（粗糙） */
    '  vec2 tiltD = gA*0.016 + vec2(sand - 0.5, vn(uv*390.0 + 7.0) - 0.5)*0.030;',
    /* 水膜：微观法线被抹平，只剩涟漪 */
    '  vec3 rp = rippleG(uv*1.30, t);',
    '  vec3 rp2 = rippleG(uv*2.10 + vec2(3.0, 1.0), t*1.21 + 0.4);',
    '  vec2 tiltW = rp.yz*0.052 + rp2.yz*0.020;',
    '  vec2 pudTilt = vec2(vn(uv*1.15 + 5.0) - 0.5, vn(uv*0.95 - 8.0) - 0.5)*0.045;',
    '  vec2 tilt = mix(tiltD, pudTilt, pud);',
    '  tilt = mix(tilt, tiltW, film);',
    '  vec3 N = normalize(vec3(-tilt, 1.0));',
    /* 视线：画面边上更掠射（透视），菲涅尔就自然出现 */
    '  vec3 V = normalize(vec3(uv.x*0.42, uv.y*0.42, 1.0));',
    '  vec3 R = reflect(-V, N);',
    '  vec3 refl = skyEnv(R);',
    /* 粗面把灯的像揉碎：粗糙表面上看到的是环境的**均值**（一小片夜空），不是那盏灯；
       所以干处几乎只剩一层冷冷的环境光，水膜里才聚得起那条亮 */
    '  vec3 amb = vec3(0.042,0.055,0.078);',
    '  vec3 refWet = refl;',
    '  vec3 refDry = amb + refl*0.150;',
    '  vec3 refSel = mix(refDry, refWet, wetA);',
    /* 湿沥青的漫反射：几乎黑的灰褐；石头略亮 */
    '  vec3 base = vec3(0.026,0.025,0.023) + vec3(0.030,0.028,0.025)*ag + vec3(0.020,0.019,0.017)*vn(uv*7.0 + 2.0);',
    '  base = mix(base, vec3(0.062,0.060,0.055), stone*0.5);',
    '  base += u_ac*0.008*sand;',
    '  vec3 diff = base*(0.55 + 0.45*clamp(N.y*0.5 + 0.5, 0.0, 1.0));',
    /* 菲涅尔：掠射角（画面边缘）更亮 —— 雨后地面的那层"油光" */
    '  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);',
    '  vec3 col = diff + refSel*0.72 + refSel*fres*0.90;',
    /* 水很薄：水下的沥青还看得见（骨料把反光压出斑驳），水本身有一点青 */
    '  col *= 1.0 - 0.30*wetA*(0.55 + 0.45*(1.0 - ag));',
    '  col += vec3(0.035,0.065,0.080)*wetA*0.30;',
    /* 弯月面：水膜边上一条极亮的细线（表面张力把水拉起来） */
    '  float men = exp(-pow((sd + 0.0040)/0.0040, 2.0));',
    '  col += vec3(0.96,0.90,0.78)*men*0.50*u_st;',
    /* 唱过的那一段：涟漪更密、反光更活 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  col += refSel*litFront*film*0.10;',
    '  col *= 1.0 + 0.05*u_kick;',
    /* 环境：远处暗下去，中间一池灯的光 */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.16 + pq.y*pq.y*1.05));',
    '  float vig = 1.0 - smoothstep(0.20, 1.34, length(uv*vec2(0.60,0.88)));',
    '  col *= 0.34 + 0.66*vig;',
    '  col += vec3(0.16,0.10,0.05)*pool*0.34;',
    '  col = 1.0 - exp(-col*1.95);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 3.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 水膜不是实体：只描一层极淡的青灰边 + 涟漪高光，别盖住下面的反射
     这一层很淡（0.30），主要让字的轮廓在低分辨率着色器之上保持锐利 */
  g.save();
  g.globalAlpha = 0.34;
  g.fillStyle = '#05070a';
  g.filter = 'blur(' + (fs * 0.018).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.014, cy + fs * 0.020);
  g.filter = 'none';
  g.restore();

  const wcol = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  wcol.addColorStop(0.00, 'rgba(196,216,232,0.14)');
  wcol.addColorStop(0.34, 'rgba(150,178,196,0.07)');
  wcol.addColorStop(0.72, 'rgba(110,132,148,0.05)');
  wcol.addColorStop(1.00, 'rgba(88,104,120,0.09)');
  g.fillStyle = wcol;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 水膜边上的亮线（弯月面） */
  g.strokeStyle = 'rgba(226,240,250,0.26)';
  g.lineWidth = 1.1;
  g.strokeText(L.text, cx, cy);
  /* 涟漪：横向的细波纹，只在水里 */
  for (let i = 0; i < 58; i++) {
    const yy = cy - fs * 0.6 + Math.random() * fs * 1.2;
    const a = 0.03 + Math.random() * 0.10;
    g.strokeStyle = 'rgba(228,242,255,' + a.toFixed(3) + ')';
    g.lineWidth = 0.8 + Math.random() * 0.7;
    const x0 = Math.random() * pw * 0.6;
    const w2 = fs * (0.25 + Math.random() * 1.0);
    g.beginPath();
    g.moveTo(x0, yy);
    g.quadraticCurveTo(x0 + w2 * 0.5, yy + (Math.random() - 0.5) * 5, x0 + w2, yy);
    g.stroke();
  }
  /* 一条竖直的灯的反光（水膜里最亮的一道，被涟漪打断） */
  const st = g.createLinearGradient(cx - fs * 0.34, 0, cx + fs * 0.34, 0);
  st.addColorStop(0.00, 'rgba(255,226,172,0)');
  st.addColorStop(0.42, 'rgba(255,229,180,0.12)');
  st.addColorStop(0.50, 'rgba(255,243,208,0.22)');
  st.addColorStop(1.00, 'rgba(255,226,172,0)');
  g.fillStyle = st;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: ''
};
