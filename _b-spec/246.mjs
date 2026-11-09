export default {
  num: '246', slug: 'sand-lightbox', title: '沙画台',
  accent: [1.00, 0.72, 0.36],
  fibers: false, motes: false, plateBlend: 'source-over', plateAlpha: 0.70,
  doc: `   246 · 沙画台 —— 字是压在灯箱玻璃上的那层厚沙，沙越厚灯越透不过来

   机制一句话：
      灯箱从下面打光，玻璃上铺着一层**粗细不匀的沙**：透过的光按**比尔-朗伯定律**
      随沙层厚度指数衰减（厚 → 黑，薄 → 亮）；字是沙堆得最厚的地方，
      沙堆的坡沿上光从沙粒缝里漏出来，所以字的边缘有一圈发亮的沙脊；
      沙粒本身是一颗颗半透的石英，颗粒之间的阴影让沙面有"糙"的颗粒感。

   和前作的区别：
      214 是水下焦散（折射亮纹）、242 是湿沥青（镜面反射）；这里是**透射吸收**：
      没有反射、没有折射花纹，只有"厚度 → 透光量"这一条 Beer-Lambert 关系，
      外加沙粒的颗粒散射。它是这一批里唯一以"暗字亮底"显形的。

   动态：换句时沙被"推"上去（u_st），唱过的那一段沙被抹薄（u_front），
   沙粒随拍点轻轻一颤（u_kick）。`,
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
    'void main(){',
    '  float mn = min(u_res.x, u_res.y);',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res)/mn;',
    '  float t = u_t;',
    '  float ep = u_epx;',
    '  float sd = gsd(uv);',
    /* 沙层厚度：一层底沙（薄） + 字上堆起来的厚沙（用 sdf 的穹顶） */
    '  float w = 0.030;',
    '  float q = clamp(-sd/w, 0.0, 1.0);',
    '  float dome = q*(2.0-q);',
    /* 底沙的厚薄不匀（铺沙的手势） */
    '  float base = 0.15 + 0.20*vn(uv*2.3 + 5.0) + 0.12*vn(uv*6.1 - 2.0);',
    /* 刷痕：抹沙留下的长弧（低频拉伸噪声） */
    '  float sweep = vn(vec2((uv.x*0.55 + uv.y*0.85)*3.2, (uv.y*0.55 - uv.x*0.85)*22.0))*0.5',
    '              + vn(vec2((uv.x*0.55 + uv.y*0.85)*6.0, (uv.y*0.55 - uv.x*0.85)*48.0))*0.5;',
    '  base += (sweep - 0.5)*0.055;',
    /* 字：厚沙堆，坡沿 0.03uv ≈ 13px */
    '  float pile = dome*(1.05 + 0.16*vn(uv*9.0 + 3.0))*u_st;',
    '  float thick = clamp(base + pile, 0.0, 2.0);',
    /* 沙粒：一颗颗石英（高频颗粒，让厚度抖） */
    '  float grain = vn(uv*78.0)*0.5 + vn(uv*168.0)*0.32 + vn(uv*330.0)*0.18;',
    '  thick += (grain - 0.5)*0.10;',
    /* 唱过的那一段：沙被抹薄一点 */
    '  float litFront = 1.0 - smoothstep(u_front-0.02, u_front+0.012, uv.x);',
    '  thick -= 0.10*litFront*dome;',
    /* 灯箱：底下的一池暖光（中间最亮，边上暗下去） */
    '  vec2 pq = uv - u_gc;',
    '  float pool = exp(-(pq.x*pq.x*0.34 + pq.y*pq.y*1.90));',
    '  float lamp = 0.05 + 1.55*pool;',
    /* Beer-Lambert：透过的光 = 入射 × exp(-k·厚度) */
    '  float k = 3.10;',
    '  float trans = exp(-k*thick);',
    /* 沙的颜色：石英砂是暖白的，光穿过它偏琥珀 */
    '  vec3 sandTint = mix(vec3(1.00,0.70,0.34), vec3(1.00,0.86,0.62), clamp(trans*1.4, 0.0, 1.0));',
    '  vec3 col = sandTint*trans*lamp;',
    /* 沙粒的闪光：颗粒的边缘把光散射出来（只在高光的一侧） */
    '  float glint = smoothstep(0.86, 0.995, grain)*trans;',
    '  col += vec3(1.00,0.92,0.74)*glint*lamp*0.85;',
    /* 厚度大的地方，沙缝里还有一点点漏光（不然纯黑太死） */
    '  col += vec3(0.30,0.16,0.07)*exp(-k*thick*1.9)*0.35;',
    /* 字的坡沿：光从坡上更薄的那一圈漏出来 —— 一圈沙脊的亮边 */
    '  float near = 1.0 - smoothstep(12.0*ep, 22.0*ep, abs(sd));',
    '  float rim = exp(-pow((abs(sd) - w*0.80)/(w*0.50), 2.0))*near;',
    '  col += vec3(1.00,0.78,0.44)*rim*lamp*0.10*u_st;',
    /* 桌面外的黑边（灯箱的边框） */
    '  float vig = 1.0 - smoothstep(0.30, 1.30, length(uv*vec2(0.80,0.96)));',
    '  col *= 0.10 + 0.90*vig;',
    '  col *= 1.0 + 0.05*u_kick;',
    '  col *= 0.55 + 0.55*grain;',
    '  col = 1.0 - exp(-col*1.45);',
    '  col += (h21(gl_FragCoord.xy*0.9 + 41.0) - 0.5)*0.010;',
    '  gl_FragColor = vec4(max(col,0.0), 1.0);',
    '}'
  ],
  plate: `  /* 厚沙：几乎不透光的暖褐，颗粒粗、坡沿有一圈被灯漏出来的亮边 */
  g.save();
  g.globalAlpha = 0.34;
  g.fillStyle = '#120a04';
  g.filter = 'blur(' + (fs * 0.012).toFixed(1) + 'px)';
  g.fillText(L.text, cx + fs * 0.006, cy + fs * 0.020);
  g.filter = 'none';
  g.restore();

  const sand = g.createLinearGradient(0, cy - fs * 0.62, 0, cy + fs * 0.62);
  sand.addColorStop(0.00, '#5a3a1e');
  sand.addColorStop(0.20, '#4a2f18');
  sand.addColorStop(0.50, '#3a2412');
  sand.addColorStop(0.78, '#2c1a0d');
  sand.addColorStop(1.00, '#20130a');
  g.fillStyle = sand;
  g.fillText(L.text, cx, cy);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  /* 沙粒：密密麻麻的小点（石英颗粒） */
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * pw, y = Math.random() * ph;
    const r = 0.4 + Math.random() * 1.1;
    const bright = Math.random() < 0.34;
    g.fillStyle = bright
      ? 'rgba(255,206,132,' + (0.05 + Math.random() * 0.16).toFixed(3) + ')'
      : 'rgba(18,10,5,' + (0.06 + Math.random() * 0.16).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  /* 抹沙的弧线：几道长弧从字上扫过去 */
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y0 = Math.random() * ph;
    g.beginPath();
    g.moveTo(-20, y0);
    g.bezierCurveTo(pw * 0.3, y0 + (Math.random() - 0.5) * 26, pw * 0.7, y0 + (Math.random() - 0.5) * 26, pw + 20, y0 + (Math.random() - 0.5) * 10);
    g.strokeStyle = Math.random() < 0.5
      ? 'rgba(255,196,120,0.06)'
      : 'rgba(16,8,4,0.10)';
    g.lineWidth = 1 + Math.random() * 7;
    g.stroke();
  }
  /* 沙脊：坡沿上被灯漏出来的一圈亮边（只在上沿） */
  const rimG = g.createLinearGradient(0, cy - fs * 0.60, 0, cy);
  rimG.addColorStop(0.0, 'rgba(255,196,120,0.34)');
  rimG.addColorStop(0.5, 'rgba(255,180,96,0.08)');
  rimG.addColorStop(1.0, 'rgba(255,180,96,0)');
  g.strokeStyle = rimG;
  g.lineWidth = 2.6;
  g.strokeText(L.text, cx, cy - 1.2);
  /* 下沿更暗：沙堆的阴影 */
  const dk2 = g.createLinearGradient(0, cy + fs * 0.04, 0, cy + fs * 0.62);
  dk2.addColorStop(0.0, 'rgba(0,0,0,0)');
  dk2.addColorStop(1.0, 'rgba(10,5,2,0.42)');
  g.fillStyle = dk2;
  g.fillRect(0, 0, pw, ph);
  g.restore();`,
  post: `  /* 沙粒：全分辨率的一张砂纸纹理，用 overlay 叠上去 —— 着色器分辨率太低，
     颗粒必须在 2D 层画，否则糊成一片 */
  if (!window.__spat) {
    const S = 200;
    const sc = document.createElement('canvas');
    sc.width = S; sc.height = S;
    const g2 = sc.getContext('2d');
    const im = g2.createImageData(S, S);
    const dd = im.data;
    for (let i = 0; i < S * S; i++) {
      const r = Math.random();
      const v = r < 0.10 ? 40 : (r > 0.92 ? 224 : 118 + Math.random() * 40);
      dd[i * 4] = v; dd[i * 4 + 1] = v * 0.96; dd[i * 4 + 2] = v * 0.86; dd[i * 4 + 3] = 255;
    }
    g2.putImageData(im, 0, 0);
    window.__spat = ctx.createPattern(sc, 'repeat');
  }
  if (window.__spat) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = window.__spat;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }`
};
