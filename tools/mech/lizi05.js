/* lizi05 · 铁磁尖刺 · ferrofluid
   磁铁悬在油面上方，铁磁流体长出尖刺阵列；**字是尖刺顶端的包络**：
   字形上的每个采样点长出一根尖刺，顶端亮点连起来就是字；
   油面被磁场吸得微微隆起，尖刺在磁场抖动里轻轻摆。
   AE：滑动变焦 Dolly Zoom（磁铁靠近 → 焦距拉长、尖刺拔高）+ 顿帧 + 定向震动。
   性能注意：尖刺锥体**必须短**（≤ 90px）。早先让它从液面一直顶到字形（300px+），
   同样 5600 根、每根两根矩形，fps 直接掉到 4.5 —— 是面积，不是数量。 */

const N05 = 5200;
const sx05 = new Float32Array(N05), sty05 = new Float32Array(N05);
const stx05 = new Float32Array(N05);
const sh05 = new Float32Array(N05), sv05 = new Float32Array(N05);
const son05 = new Int16Array(N05), sat05 = new Float32Array(N05);
const sph05 = new Float32Array(N05), ssz05 = new Float32Array(N05);
let n05 = 0, poolY05 = 0, magY05 = 0, field05 = 0, dolly05 = 0;

function mechResize() {
  if (!W || !H) return;
  poolY05 = H * 0.80;
  magY05 = H * 0.09;
  for (let i = 0; i < N05; i++) {
    sx05[i] = Math.random() * W; sty05[i] = poolY05;
    sh05[i] = 0; sv05[i] = 0;
    sph05[i] = Math.random() * 6.283;
    ssz05[i] = 1.3 + Math.random() * 1.5;
  }
  n05 = N05;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n05 = Math.max(1400, Math.min(N05, Math.round(pc * 0.55)));
  /* 液面就压在字块下面一点：尖刺不用长太高就能顶到字形 */
  const gh = g.h || H * 0.2;
  poolY05 = Math.min(H * 0.9, blockGy + gh * 0.5 + 26);
  magY05 = Math.max(H * 0.06, blockGy - gh * 0.5 - H * 0.22);
  for (let i = 0; i < n05; i++) {
    const pi = ((i * pc / n05) | 0) % pc;
    stx05[i] = blockGx + g.px[pi] + rnd(-0.9, 0.9);
    sty05[i] = blockGy + g.py[pi] + rnd(-0.9, 0.9);
    son05[i] = g.own[pi];
    sat05[i] = use.at[g.own[pi]] || use.lineT;
    sx05[i] = stx05[i];
    sh05[i] = 0; sv05[i] = 0;
  }
  dolly05 = 1;
}

function mechEvent(k, first) {
  field05 = first ? 1.8 : 1.15;
  dolly05 = first ? 1.5 : 1;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.05 : 0.025));
  cam.oy = first ? 8 : 4;
  camShake(0, 1, first ? 9 : 5);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  field05 *= Math.pow(0.06, dt);
  dolly05 *= Math.pow(0.08, dt);
  cam.oy *= Math.pow(0.06, dt);
  const pull = 1 + dolly05 * 0.7;
  for (let i = 0; i < n05; i++) {
    const age = T - sat05[i];
    if (age < -0.5) { sh05[i] += (0 - sh05[i]) * Math.min(1, dt * 4); continue; }
    const want = Math.min(1.15, (age < 0 ? 0.2 : 0.92) + field05 * 0.2) * pull;
    /* 临界阻尼：既快又不振荡 */
    sv05[i] += ((want - sh05[i]) * 120 - sv05[i] * 19) * dt;
    sh05[i] += sv05[i] * dt;
    if (sh05[i] < 0.02) { sh05[i] = 0.02; sv05[i] = 0; }
    if (sh05[i] > 1.2) { sh05[i] = 1.2; sv05[i] *= 0.4; }
    sx05[i] = stx05[i] + Math.sin(T * 2.1 + sph05[i]) * 2.4 * sh05[i] * (0.4 + field05 * 0.6);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  /* 油面：暗底 + 磁场吸出来的隆起（一条起伏的亮边） */
  const poolTop = pjY(0, poolY05);
  ctx.fillStyle = 'rgba(6,7,12,0.96)';
  ctx.fillRect(0, poolTop, W, H - poolTop + 2);
  ctx.strokeStyle = 'rgba(150,190,255,0.20)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = -20; x < W + 20; x += 12) {
    const y = poolY05 + Math.sin(x * 0.013 + T * 1.6) * 2.5 - field05 * 1.6;
    const px = pjX(x, y), py = pjY(x, y);
    if (x === -20) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  /* 磁铁 */
  const mx = pjX(W / 2, magY05), my = pjY(W / 2, magY05);
  ctx.fillStyle = 'rgba(26,30,40,0.96)';
  ctx.beginPath();
  ctx.rect(mx - W * 0.2, my - 12 * z, W * 0.4, 24 * z);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,185,255,0.28)';
  ctx.beginPath();
  ctx.rect(mx - W * 0.2, my + 7 * z, W * 0.4, 4 * z);
  ctx.fill();
  /* 磁场线 */
  ctx.strokeStyle = 'rgba(140,180,255,0.09)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 0; k < 9; k++) {
    const x0 = W * (0.28 + k * 0.055), y0 = magY05 + 14;
    ctx.moveTo(pjX(x0, y0), pjY(x0, y0));
    const xm = x0 + Math.sin(T * 0.8 + k) * 26, ym = (y0 + poolY05) * 0.5;
    ctx.quadraticCurveTo(pjX(xm, ym), pjY(xm, ym), pjX(x0, poolY05), pjY(x0, poolY05));
  }
  ctx.stroke();

  if (!L) return;

  /* ① 锥体：由 3 颗逐渐变小的"珠"串成（细长矩形在软件渲染里极慢，方点才便宜） */
  ctx.fillStyle = 'rgba(20,24,36,0.94)';
  ctx.beginPath();
  for (let i = 0; i < n05; i++) {
    const h = sh05[i];
    if (h < 0.05) continue;
    const px = pjX(sx05[i], sty05[i]);
    const py = pjY(sx05[i], sty05[i]);
    const pbase = pjY(sx05[i], poolY05);
    const len = Math.min(70, Math.max(0, pbase - py)) * Math.min(1, h);
    if (len < 4) continue;
    if (px < -20 || px > W + 20) continue;
    for (let k = 0; k < 2; k++) {
      const f = 0.28 + k * 0.42;
      const s = ssz05[i] * (2.4 - k * 0.5) * z;
      ctx.rect(px - s * 0.5, py + len * f, s, s);
    }
  }
  ctx.fill();


  /* ③ 顶端：字（两档，刚立起来的更亮） */
  for (let pass = 0; pass < 2; pass++) {
    const hot = pass === 1;
    ctx.fillStyle = hot
      ? `rgba(${Math.min(255, ar + 46)},${Math.min(255, ag + 40)},${Math.min(255, ab + 26)},0.95)`
      : `rgba(${Math.min(255, ar - 24)},${Math.min(255, ag - 14)},${Math.min(255, ab + 18)},0.45)`;
    ctx.beginPath();
    for (let i = 0; i < n05; i++) {
      const h = sh05[i];
      if (h < 0.3) continue;
      if ((h > 0.8) !== hot) continue;
      const px = pjX(sx05[i], sty05[i]);
      const py = pjY(sx05[i], sty05[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = ssz05[i] * (hot ? 1.5 : 1.2) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
}
