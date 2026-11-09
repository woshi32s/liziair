/* ===== lizi60 · 日冕环 · coronal-loop —— PHYSICS =====
   等离子沿磁环拱起再落下，**落点连成字**：每颗粒子沿二次贝塞尔从足点升到环顶再落到字位。
   背景有几条细的磁力线（描边贝塞尔），命中时整片环一起亮一下。
   构图：环拱在字的上方，字落在下沿，像日冕的"脚"。                            */

const C60 = 90;                          /* 磁环条数 */
const c60ax = new Float32Array(C60), c60ay = new Float32Array(C60);
const c60cx = new Float32Array(C60), c60cy = new Float32Array(C60);
const c60bx = new Float32Array(C60), c60by = new Float32Array(C60);
const c60ph = new Float32Array(C60);
let c60init = 0, c60hit = 0;

function mechUpdate(dt, T) {
  if (!c60init) {
    c60init = 1;
    for (let k = 0; k < C60; k++) {
      c60ax[k] = rnd(-620, 620); c60ay[k] = rnd(-40, 120);
      c60bx[k] = c60ax[k] + rnd(-260, 260); c60by[k] = rnd(-70, 130);
      c60cx[k] = (c60ax[k] + c60bx[k]) / 2;
      c60cy[k] = Math.min(c60ay[k], c60by[k]) - rnd(200, 460);
      c60ph[k] = Math.random() * 6.28;
    }
  }
  if (c60hit > 0) c60hit = Math.max(0, c60hit - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 7);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 7);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { c60hit = 1; vPulse = 1; }

function bez(a, c, b, t) { const u = 1 - t; return u * u * a + 2 * u * t * c + t * t * b; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.24) * 0.22, pit = 0.10 * Math.sin(T * 0.19);
  const cyr = Math.cos(yaw), syr = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);

  /* ---------- 1) 磁力线：细描边 ---------- */
  ctx.strokeStyle = 'rgba(120,170,235,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k < C60; k += 2) {
    const ph = (T * 0.35 + c60ph[k]) % 1;
    ctx.moveTo(pjX(blockGx, blockGy + 80), pjY(blockGx, blockGy + 80));
    for (let j = 1; j <= 10; j++) {
      const t = j / 10;
      const X = bez(c60ax[k], c60cx[k], c60bx[k], t);
      const Y = bez(c60ay[k], c60cy[k], c60by[k], t);
      ctx.lineTo(pjX(blockGx + X, blockGy + Y), pjY(blockGx + X, blockGy + Y));
    }
  }
  ctx.stroke();

  /* ---------- 2) 等离子粒子：沿环流动 + 落成字 ---------- */
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const k = i % C60;
    const ph = (T * (0.28 + 0.10 * (k % 5)) + c60ph[k]) % 1;
    /* 未唱：沿环飞；已唱：落在字位并微微上飘 */
    const along = clamp01((T - lineT) / 1.15);
    const aX = bez(c60ax[k], c60cx[k], c60bx[k], ph);
    const aY = bez(c60ay[k], c60cy[k], c60by[k], ph);
    const X0 = aX * (1 - along) + vx[i] * along;
    const Y0 = aY * (1 - along) + vy[i] * along;
    const Z0 = (1 - along) * Math.sin(ph * 3.14) * -90 + vz[i] * 0.6;
    let X1 = X0 * cyr + Z0 * syr, Z1 = -X0 * syr + Z0 * cyr;
    let Y1 = Y0 * cp - Z1 * sp; Z1 = Y0 * sp + Z1 * cp;
    const s = 920 / (920 + Z1);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const flow = Math.sin(ph * 3.1416);      /* 环顶最亮 */
    vlum[i] = clamp01(0.34 + 0.42 * along + 0.32 * gl + 0.30 * flow * (1 - along)) + c60hit * 0.16 + vPulse * 0.1;
  }
  /* 暗底 */
  ctx.globalAlpha = 0.26; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0 * vss[i]; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  /* 冷色环 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55; ctx.fillStyle = 'rgb(90,150,240)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] > 0.45) continue;
    const r = 2.6 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 热核 */
  ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgb(236,246,255)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.45) continue;
    const r = 2.4 * vss[i];
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.08 + c60hit * 0.06;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(vLightCv, W * 0.5 - 700, H * 0.3 - 700, 1400, 1400);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

