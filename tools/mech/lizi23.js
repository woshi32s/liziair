/* lizi23 · 偏振显影 · polarize
   每个粒子带一个偏振相位；检偏器角度 A 一直在转，只有相位与 A 同相的那批显影。
   同一个字上放了 3 个不同相位的粒子，所以字一直在"显影—隐去"地沸腾，
   而显影带从字头扫到字尾（相位跟着 x 走）。 */

const N23 = 7200;
const qx = new Float32Array(N23), qy = new Float32Array(N23);
const qvx = new Float32Array(N23), qvy = new Float32Array(N23);
const qtx = new Float32Array(N23), qty = new Float32Array(N23);
const qph = new Float32Array(N23), qat = new Float32Array(N23);
const qsz = new Float32Array(N23), qon = new Int16Array(N23);
const qset = new Uint8Array(N23);
let n23 = 0, ana23 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N23; i++) {
    qx[i] = Math.random() * W; qy[i] = Math.random() * H;
    qvx[i] = 0; qvy[i] = 0;
    qset[i] = 0; qsz[i] = 1.2 + Math.random() * 1.5;
    qph[i] = Math.random() * 6.283;
  }
  n23 = N23;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n23 = Math.max(2400, Math.min(N23, Math.round(pc * 1.8)));
  for (let i = 0; i < n23; i++) {
    const pi = ((i * pc / n23) | 0) % pc;
    qtx[i] = blockGx + g.px[pi] + rnd(-1.0, 1.0);
    qty[i] = blockGy + g.py[pi] + rnd(-1.0, 1.0);
    qon[i] = g.own[pi];
    qat[i] = use.at[g.own[pi]] || use.lineT;
    qph[i] = (qtx[i] / W) * 9.5 + (i % 3) * 2.094;
    qset[i] = 0;
    if (!(qx[i] >= 0 && qx[i] <= W)) qx[i] = Math.random() * W;
    if (!(qy[i] >= 0 && qy[i] <= H)) qy[i] = Math.random() * H;
  }
}

function mechEvent(k, first) {
  ana23 += (first ? 1.1 : 0.5) * (k % 2 ? 1 : -1);
  cam.ox = (k % 2 ? 1 : -1) * (first ? 42 : 22);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.02, dt);
  ana23 *= Math.pow(0.2, dt);
  const A = T * 1.15 + ana23;
  for (let i = 0; i < n23; i++) {
    if (T < qat[i] - 0.45) continue;
    const dx = qtx[i] - qx[i], dy = qty[i] - qy[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    const kk = near ? 30 : 9;
    qvx[i] += dx * kk * dt - qvx[i] * (near ? 9.2 : 1.7) * dt;
    qvy[i] += dy * kk * dt - qvy[i] * (near ? 9.2 : 1.7) * dt;
    const sp = Math.hypot(qvx[i], qvy[i]);
    if (sp > 900) { const s = 900 / sp; qvx[i] *= s; qvy[i] *= s; }
    qx[i] += qvx[i] * dt; qy[i] += qvy[i] * dt;
    if ((d < 2.4 && sp < 130) || T > qat[i] + 1.6) {
      qset[i] = 1; qx[i] = qtx[i]; qy[i] = qty[i];
    }
  }
  void A;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const A = T * 1.15 + ana23;

  /* 检偏器：几根缓慢转动的斜线（偏振片的栅格） */
  ctx.strokeStyle = 'rgba(150,190,255,0.055)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ang = A * 0.35;
  const nx = Math.cos(ang), ny = Math.sin(ang);
  for (let k = -14; k <= 14; k++) {
    const ox = W / 2 + (k * 96) * nx, oy = H / 2 + (k * 96) * ny;
    ctx.moveTo(ox - ny * 900, oy + nx * 900);
    ctx.lineTo(ox + ny * 900, oy - nx * 900);
  }
  ctx.stroke();

  /* 粒子：同相（亮） / 异相（暗） */
  for (let pass = 0; pass < 2; pass++) {
    const lit = pass === 1;
    ctx.fillStyle = lit
      ? `rgba(${Math.min(255, ar + 44)},${Math.min(255, ag + 34)},${Math.min(255, ab + 14)},0.95)`
      : `rgba(${Math.min(255, ar - 46)},${Math.min(255, ag - 40)},${Math.min(255, ab - 24)},0.30)`;
    ctx.beginPath();
    for (let i = 0; i < n23; i++) {
      if (T < qat[i] - 0.45) continue;
      const c = 0.5 + 0.5 * Math.cos(qph[i] - A);
      const vis = c * c * c;
      if ((vis > 0.30) !== lit) continue;
      const px = pjX(qx[i], qy[i]), py = pjY(qx[i], qy[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = qsz[i] * (lit ? 1.5 : 1.15) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 同相带扫过时的白闪条（很淡，一次 fill） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(220,236,255,0.03)';
  ctx.beginPath();
  const band = ((A / 6.283) % 1) * W * 1.4 - W * 0.2;
  ctx.rect(band, 0, 60, H);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
