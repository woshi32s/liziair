/* lizi37 · 沙画灯箱 · sand-art
   灯箱上铺满一层厚沙，光从下面透上来。唱到一个字，那个字的沙被抹开，
   **沙薄的地方透光 —— 透光的那块就是字**；抹开的沙在笔画边缘堆成更厚的暗脊。
   AE：漏光（预烘暖光带缓慢扫过）+ 微距缓推 + 甩镜。 */

const STEP37 = 14;
let gw37 = 0, gh37 = 0;
let smask37 = null, stime37 = null, srim37 = null;
let lightCv37 = null, leakCv37 = null;
const GRAIN37 = 2400;
const gx37 = new Float32Array(GRAIN37), gy37 = new Float32Array(GRAIN37);
const gs37 = new Float32Array(GRAIN37);

function mechResize() {
  if (!W || !H) return;
  gw37 = Math.ceil(W / STEP37) + 1;
  gh37 = Math.ceil(H / STEP37) + 1;
  smask37 = new Uint8Array(gw37 * gh37);
  stime37 = new Float32Array(gw37 * gh37);
  srim37 = new Uint8Array(gw37 * gh37);
  for (let i = 0; i < stime37.length; i++) stime37[i] = 1e9;
  for (let i = 0; i < GRAIN37; i++) {
    gx37[i] = Math.random() * W; gy37[i] = Math.random() * H;
    gs37[i] = 1 + Math.random() * 1.8;
  }

  /* 灯箱：暖白光从中间透出来 */
  if (!lightCv37) lightCv37 = document.createElement('canvas');
  lightCv37.width = Math.max(2, Math.round(W / 2));
  lightCv37.height = Math.max(2, Math.round(H / 2));
  const lc = lightCv37.getContext('2d');
  const bw = lightCv37.width, bh = lightCv37.height;
  const g = lc.createRadialGradient(bw * 0.5, bh * 0.46, 0, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.62);
  g.addColorStop(0, 'rgba(255,236,190,0.92)');
  g.addColorStop(0.42, 'rgba(226,176,106,0.55)');
  g.addColorStop(0.78, 'rgba(110,74,38,0.18)');
  g.addColorStop(1, 'rgba(30,20,10,0.02)');
  lc.fillStyle = g; lc.fillRect(0, 0, bw, bh);

  /* 漏光带 */
  if (!leakCv37) leakCv37 = document.createElement('canvas');
  leakCv37.width = 600; leakCv37.height = 600;
  const gc = leakCv37.getContext('2d');
  const lg = gc.createLinearGradient(0, 0, 600, 600);
  lg.addColorStop(0, 'rgba(255,190,90,0)');
  lg.addColorStop(0.45, 'rgba(255,205,130,0.10)');
  lg.addColorStop(0.55, 'rgba(255,230,175,0.16)');
  lg.addColorStop(1, 'rgba(255,190,90,0)');
  gc.fillStyle = lg; gc.fillRect(0, 0, 600, 600);
}

function mechAssign(use) {
  const g = use.g;
  smask37.fill(0); srim37.fill(0);
  for (let i = 0; i < stime37.length; i++) stime37[i] = 1e9;
  for (let k = 0; k < g.pc; k++) {
    const cx = ((blockGx + g.px[k]) / STEP37) | 0;
    const cy = ((blockGy + g.py[k]) / STEP37) | 0;
    if (cx < 1 || cy < 1 || cx >= gw37 - 1 || cy >= gh37 - 1) continue;
    const id = cy * gw37 + cx;
    smask37[id] = 1;
    const at = use.at[Math.min(g.n - 1, g.own[k])] || use.lineT;
    if (at < stime37[id]) stime37[id] = at;
  }
  /* 笔画外沿 = 堆沙的暗脊 */
  for (let cy = 1; cy < gh37 - 1; cy++) {
    for (let cx = 1; cx < gw37 - 1; cx++) {
      const id = cy * gw37 + cx;
      if (smask37[id]) continue;
      if (smask37[id - 1] || smask37[id + 1] || smask37[id - gw37] || smask37[id + gw37]) srim37[id] = 1;
    }
  }
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? 1 : -1) * (first ? 30 : 16);
  cam.tz = Math.max(cam.tz, 1.02 + (first ? 0.02 : 0.01));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.03, dt);
}

function mechDraw(T, z, pjX, pjY) {
  if (lightCv37) ctx.drawImage(lightCv37, 0, 0, W, H);

  /* 漏光扫过 */
  if (leakCv37) {
    const off = (T * 55) % (W + 800) - 400;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(leakCv37, off, 150 + Math.sin(T * 0.3) * 30, 800, 800);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 厚沙层：没被抹开的格子全是暗沙（字从被抹开的地方透出来） */
  ctx.fillStyle = 'rgba(22,15,8,0.90)';
  ctx.beginPath();
  for (let cy = 1; cy < gh37 - 1; cy++) {
    for (let cx = 1; cx < gw37 - 1; cx++) {
      const id = cy * gw37 + cx;
      if (smask37[id] && T >= stime37[id]) continue;
      const px = pjX(cx * STEP37, cy * STEP37), py = pjY(cx * STEP37, cy * STEP37);
      if (px < -24 || px > W + 24 || py < -24 || py > H + 24) continue;
      const s = STEP37 * 1.12 * z;
      ctx.rect(px, py, s, s);
    }
  }
  ctx.fill();

  /* 沙的颗粒质感 */
  ctx.fillStyle = 'rgba(120,92,56,0.16)';
  ctx.beginPath();
  for (let i = 0; i < GRAIN37; i++) {
    const px = pjX(gx37[i], gy37[i]), py = pjY(gx37[i], gy37[i]);
    if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
    ctx.rect(px, py, gs37[i], gs37[i]);
  }
  ctx.fill();

  /* 被抹开区域的薄沙：亮金小粒（透光的沙面） */
  if (L) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,232,180,0.16)';
    ctx.beginPath();
    for (let k = 0; k < L.pc; k += 2) {
      const own = L.own[k];
      const ct = charChars && charChars[own] ? charChars[own].t : 0;
      if (T < ct) continue;
      const px = pjX(blockGx + L.px[k], blockGy + L.py[k]);
      const py = pjY(blockGx + L.px[k], blockGy + L.py[k]);
      if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
      ctx.rect(px - 1.6, py - 1.6, 3.2, 3.2);
    }
    ctx.fill();

    /* 薄沙上的灯管高光：沿笔画一条很淡的暖线 */
    ctx.fillStyle = 'rgba(255,246,222,0.10)';
    ctx.beginPath();
    for (let k = 0; k < L.pc; k += 6) {
      const px = pjX(blockGx + L.px[k], blockGy + L.py[k]);
      const py = pjY(blockGx + L.px[k], blockGy + L.py[k]);
      if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
      ctx.rect(px - 2.4, py - 2.4, 4.8, 4.8);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 堆在字边的暗脊 */
  ctx.fillStyle = 'rgba(8,5,3,0.96)';
  ctx.beginPath();
  for (let cy = 1; cy < gh37 - 1; cy++) {
    for (let cx = 1; cx < gw37 - 1; cx++) {
      const id = cy * gw37 + cx;
      if (!srim37[id]) continue;
      const px = pjX(cx * STEP37, cy * STEP37), py = pjY(cx * STEP37, cy * STEP37);
      if (px < -24 || px > W + 24 || py < -24 || py > H + 24) continue;
      const s = STEP37 * 1.2 * z;
      ctx.rect(px - s * 0.06, py - s * 0.06, s, s);
    }
  }
  ctx.fill();

  /* 画布最外圈压黑：灯箱的光不该糊到边上 */
  ctx.fillStyle = 'rgba(2,2,3,0.94)';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, H - 10, W, 10);
  ctx.fillRect(0, 0, 10, H);
  ctx.fillRect(W - 10, 0, 10, H);
}
