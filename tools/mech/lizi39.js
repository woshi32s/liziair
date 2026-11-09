/* lizi39 · 气泡上浮 · bubble
   气泡从水底升起，被字形的"气场"托住，密集地停在笔画上；停一会儿又挣脱往上飘走。
   **字 = 悬停在半空的那群气泡**，整句一直在冒泡、一直在换班。
   AE：折射感（气泡里有高光偏移）+ 缓升 + 顿帧。 */

const N39 = 6000;
const bx39 = new Float32Array(N39), by39 = new Float32Array(N39);
const bvx39 = new Float32Array(N39), bvy39 = new Float32Array(N39);
const btx39 = new Float32Array(N39), bty39 = new Float32Array(N39);
const bon39 = new Int16Array(N39), bat39 = new Float32Array(N39);
const bsz39 = new Float32Array(N39), bph39 = new Float32Array(N39);
const bhold39 = new Float32Array(N39), bfree39 = new Uint8Array(N39);
let n39 = 0, waterCv39 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N39; i++) {
    bx39[i] = Math.random() * W; by39[i] = H + Math.random() * H;
    bvx39[i] = 0; bvy39[i] = -rnd(40, 120);
    bsz39[i] = 1.6 + Math.random() * 2.6;
    bph39[i] = Math.random() * 6.283;
    bfree39[i] = 0; bhold39[i] = 0;
  }
  n39 = N39;
  if (!waterCv39) waterCv39 = document.createElement('canvas');
  waterCv39.width = Math.max(2, Math.round(W / 2));
  waterCv39.height = Math.max(2, Math.round(H / 2));
  const wc = waterCv39.getContext('2d');
  const bw = waterCv39.width, bh = waterCv39.height;
  const g = wc.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#04121a');
  g.addColorStop(0.45, '#061a22');
  g.addColorStop(1, '#02080c');
  wc.fillStyle = g; wc.fillRect(0, 0, bw, bh);
  /* 水里的光柱 */
  wc.fillStyle = 'rgba(120,200,220,0.045)';
  for (let k = 0; k < 8; k++) wc.fillRect(bw * (0.06 + k * 0.12), 0, bw * 0.03, bh);
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n39 = Math.max(2200, Math.min(N39, Math.round(pc * 1.5)));
  for (let i = 0; i < n39; i++) {
    const pi = ((i * pc / n39) | 0) % pc;
    btx39[i] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    bty39[i] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    bon39[i] = g.own[pi];
    bat39[i] = use.at[g.own[pi]] || use.lineT;
    bfree39[i] = 0; bhold39[i] = 0;
    bx39[i] = btx39[i] + rnd(-60, 60);
    by39[i] = H + rnd(0, 120);
    bvy39[i] = -rnd(120, 240);
  }
}

function mechEvent(k, first) {
  cam.oy = first ? -12 : -6;
  cam.tz = Math.max(cam.tz, 1.035);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.oy *= Math.pow(0.05, dt);
  for (let i = 0; i < n39; i++) {
    if (bfree39[i]) {
      /* 挣脱：继续上浮，出画顶就回到水底重新来 */
      by39[i] += bvy39[i] * dt * 1.6;
      bx39[i] += Math.sin(T * 2 + bph39[i]) * 26 * dt;
      if (by39[i] < -30) {
        by39[i] = H + 30; bx39[i] = btx39[i] + rnd(-40, 40);
        bfree39[i] = 0; bhold39[i] = 0;
      }
      continue;
    }
    if (T < bat39[i] - 0.7) {
      by39[i] += bvy39[i] * dt;
      bx39[i] += Math.sin(by39[i] * 0.02 + T) * 20 * dt;
      if (by39[i] < H * 0.5) { by39[i] = H + 20; }
      continue;
    }
    /* 被字形托住：弹簧上浮到落点，然后悬停一会儿 */
    const dx = btx39[i] - bx39[i], dy = bty39[i] - by39[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    const kk = near ? 22 : 7;
    bvx39[i] += dx * kk * dt - bvx39[i] * (near ? 9 : 2.2) * dt;
    bvy39[i] += dy * kk * dt - bvy39[i] * (near ? 9 : 2.2) * dt;
    const sp = Math.hypot(bvx39[i], bvy39[i]);
    if (sp > 900) { const s = 900 / sp; bvx39[i] *= s; bvy39[i] *= s; }
    bx39[i] += bvx39[i] * dt; by39[i] += bvy39[i] * dt;
    if (d < 2.4) {
      bhold39[i] += dt;
      if (bhold39[i] > 1.6 + (i % 5) * 0.25) { bfree39[i] = 1; bvy39[i] = -rnd(90, 200); }
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (waterCv39) ctx.drawImage(waterCv39, 0, 0, W, H);

  /* 气泡：暗环 + 亮心（两个批次） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(30,70,80,0.5)'
      : `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 60)},${Math.min(255, ab + 50)},0.9)`;
    ctx.beginPath();
    for (let i = 0; i < n39; i++) {
      if (T < bat39[i] - 0.7) continue;
      const px = pjX(bx39[i], by39[i]), py = pjY(bx39[i], by39[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = bsz39[i] * (bfree39[i] ? 1.1 : 1.45) * z;
      if (pass === 0) ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      else ctx.rect(px - s * 0.42, py - s * 0.42, s * 0.62, s * 0.62);
    }
    ctx.fill();
  }

  /* 水面的浮光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(140,220,230,0.05)';
  ctx.beginPath();
  const yy = H * 0.12;
  for (let x = -20; x < W + 20; x += 26) {
    const py = pjY(x, yy + Math.sin(x * 0.02 + T * 1.4) * 6);
    ctx.rect(pjX(x, yy), py, 18, 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
