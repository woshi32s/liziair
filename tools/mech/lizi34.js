/* lizi34 · 生物荧光 · bioluma
   荧光素在海水中扩散：字形上的每一点都是一个发光源，唱到时点亮，
   然后**向外扩散**出一圈正在变淡的荧光前沿；字是那圈前沿还没散掉的核心。
   AE：升格慢动作（前沿速度压慢）+ 体积光（预烘光晕贴图）+ 缓推。 */

const N34 = 5600;
const ux34 = new Float32Array(N34), uy34 = new Float32Array(N34);
const utx34 = new Float32Array(N34), uty34 = new Float32Array(N34);
const uown34 = new Float32Array(N34), uat34 = new Float32Array(N34);
const ulife34 = new Float32Array(N34), usz34 = new Float32Array(N34);
const uph34 = new Float32Array(N34);
let n34 = 0, bloom34 = 1;
let glowCv34 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N34; i++) {
    ux34[i] = Math.random() * W; uy34[i] = Math.random() * H;
    ulife34[i] = 0; usz34[i] = 1 + Math.random() * 1.3;
    uph34[i] = Math.random() * 6.283;
  }
  n34 = N34;
  /* 体积光：一张柔和的冷绿光斑，预烘一次 */
  if (!glowCv34) glowCv34 = document.createElement('canvas');
  glowCv34.width = 180; glowCv34.height = 180;
  const g = glowCv34.getContext('2d');
  const rg = g.createRadialGradient(90, 90, 0, 90, 90, 88);
  rg.addColorStop(0, 'rgba(150,255,220,0.55)');
  rg.addColorStop(0.35, 'rgba(60,220,170,0.18)');
  rg.addColorStop(1, 'rgba(10,90,80,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 180, 180);
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n34 = Math.max(2000, Math.min(N34, Math.round(pc * 1.5)));
  for (let i = 0; i < n34; i++) {
    const pi = ((i * pc / n34) | 0) % pc;
    utx34[i] = blockGx + g.px[pi] + rnd(-1, 1);
    uty34[i] = blockGy + g.py[pi] + rnd(-1, 1);
    uown34[i] = g.own[pi];
    uat34[i] = use.at[g.own[pi]] || use.lineT;
    ux34[i] = utx34[i]; uy34[i] = uty34[i];
    ulife34[i] = 0;
  }
  bloom34 = 1;
}

function mechEvent(k, first) {
  bloom34 = first ? 1.7 : 1.1;
  cam.tz = Math.max(cam.tz, 1.035);
  cam.oy = -5;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  bloom34 *= Math.pow(0.06, dt);
  cam.oy *= Math.pow(0.05, dt);
  const dt2 = dt * 0.75;     /* 升格：扩散慢一点 */
  for (let i = 0; i < n34; i++) {
    const age = T - uat34[i];
    if (age < 0) { ux34[i] = utx34[i]; uy34[i] = uty34[i]; ulife34[i] = 0; continue; }
    if (age < 1.6) {
      /* 前沿：从核心向外扩散，速度先快后慢 */
      const r = 26 * Math.sqrt(age) * (1 + bloom34 * 0.2);
      const a = uph34[i] + age * 0.6;
      ux34[i] = utx34[i] + Math.cos(a) * r;
      uy34[i] = uty34[i] + Math.sin(a) * r * 0.8;
      ulife34[i] = 1 - age / 1.6;
    } else {
      /* 前沿散了，回到核心继续微弱发光 */
      ux34[i] += (utx34[i] - ux34[i]) * Math.min(1, dt2 * 2.4);
      uy34[i] += (uty34[i] - uy34[i]) * Math.min(1, dt2 * 2.4);
      ulife34[i] = 0.55 + 0.2 * Math.sin(T * 2 + uph34[i]);
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 体积光：只给亮着的区域贴几张柔光斑（数量少，不是逐颗） */
  if (glowCv34 && L) {
    ctx.globalCompositeOperation = 'lighter';
    const gr = 130 * z;
    for (let i = 0; i < n34; i += 140) {
      const px = pjX(ux34[i], uy34[i]), py = pjY(ux34[i], uy34[i]);
      if (px < -80 || px > W + 80 || py < -80 || py > H + 80) continue;
      const a = Math.min(1, 0.08 + ulife34[i] * 0.22);
      ctx.globalAlpha = a;
      ctx.drawImage(glowCv34, px - gr * 0.5, py - gr * 0.5, gr, gr);
    }
    ctx.globalAlpha = 1;
  }

  /* 荧光粒子：两档（前沿淡青 / 核心亮绿） */
  for (let pass = 0; pass < 2; pass++) {
    const core = pass === 1;
    ctx.fillStyle = core
      ? `rgba(${Math.min(255, ar - 60)},${Math.min(255, ag + 40)},${Math.min(255, ab - 10)},0.95)`
      : 'rgba(90,220,190,0.35)';
    ctx.beginPath();
    for (let i = 0; i < n34; i++) {
      const l = ulife34[i];
      if (core !== (l > 0.5)) continue;
      const px = pjX(ux34[i], uy34[i]), py = pjY(ux34[i], uy34[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = usz34[i] * (core ? 1.6 : 1.25) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
