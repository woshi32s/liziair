/* lizi27 · 沙丘风蚀 · dune
   风把沙粒吹成沙丘脊，脊线连成字；字一直在被风吹变形 ——
   沙粒落定后仍被阵风掀起 3~5px 再落回，整个字像浮在流沙上。
   AE：缓急变速（阵风）+ 弹簧变焦 + 甩镜（风方向）。 */

const N27 = 7000;
const dx27 = new Float32Array(N27), dy27 = new Float32Array(N27);
const dvx27 = new Float32Array(N27), dvy27 = new Float32Array(N27);
const dtx27 = new Float32Array(N27), dty27 = new Float32Array(N27);
const dat27 = new Float32Array(N27), dsz27 = new Float32Array(N27);
const dset27 = new Uint8Array(N27), dph27 = new Float32Array(N27);
let n27 = 0, wind27 = 1, gust27 = 0;

/* 远景沙幕 */
const NF27 = 420;
const fx27 = new Float32Array(NF27), fy27 = new Float32Array(NF27), fz27 = new Float32Array(NF27);

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N27; i++) {
    dx27[i] = rnd(-W * 0.2, W * 1.1);
    dy27[i] = rnd(H * 0.66, H + 30);
    dvx27[i] = rnd(30, 90); dvy27[i] = 0;
    dset27[i] = 0; dph27[i] = Math.random() * 6.283;
    dsz27[i] = 1.1 + Math.random() * 1.4;
  }
  for (let i = 0; i < NF27; i++) {
    fx27[i] = Math.random() * W; fy27[i] = rnd(H * 0.48, H);
    fz27[i] = 0.3 + Math.random() * 0.7;
  }
  n27 = N27;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n27 = Math.max(2200, Math.min(N27, Math.round(pc * 1.7)));
  for (let i = 0; i < n27; i++) {
    const pi = ((i * pc / n27) | 0) % pc;
    /* 沙丘脊：落点被风压出一点上风侧的偏移 */
    dtx27[i] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    dty27[i] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    dat27[i] = use.at[g.own[pi]] || use.lineT;
    dset27[i] = 0;
    if (!(dx27[i] > -W * 0.25 && dx27[i] < W * 1.15)) dx27[i] = rnd(-W * 0.2, W * 0.9);
    if (!(dy27[i] > H * 0.5 && dy27[i] < H + 40)) dy27[i] = rnd(H * 0.66, H + 20);
    dvx27[i] = rnd(60, 140); dvy27[i] = 0;
  }
  gust27 = 1;
}

function mechEvent(k, first) {
  gust27 = first ? 1.7 : 1;
  wind27 = 1 + (first ? 0.9 : 0.5);
  cam.ox = -(first ? 34 : 18);
  cam.oy = 4;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  gust27 *= Math.pow(0.05, dt);
  wind27 += (1 - wind27) * Math.min(1, dt * 2);
  cam.ox *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  const Wv = (150 + Math.sin(T * 1.1) * 60) * wind27;
  const uplift = Math.sin(T * 2.3) * 0.5 + 0.5;

  for (let i = 0; i < n27; i++) {
    if (!dset27[i] && T >= dat27[i] - 0.4) {
      const ddx = dtx27[i] - dx27[i], ddy = dty27[i] - dy27[i];
      const d = Math.hypot(ddx, ddy);
      const near = d < 80;
      const kk = near ? 30 : 9;
      dvx27[i] += ddx * kk * dt - dvx27[i] * (near ? 9.2 : 2.2) * dt;
      dvy27[i] += ddy * kk * dt - dvy27[i] * (near ? 9.2 : 2.2) * dt;
      /* 风：横向输运 + 抬升 */
      dvx27[i] += Wv * dt * (1 + gust27 * 2);
      dvy27[i] -= 40 * uplift * dt * (d > 60 ? 1 : 0);
      const sp = Math.hypot(dvx27[i], dvy27[i]);
      if (sp > 900) { const s = 900 / sp; dvx27[i] *= s; dvy27[i] *= s; }
      dx27[i] += dvx27[i] * dt; dy27[i] += dvy27[i] * dt;
      if ((d < 2.6 && sp < 140) || T > dat27[i] + 1.6) {
        dset27[i] = 1; dx27[i] = dtx27[i]; dy27[i] = dty27[i];
        dvx27[i] = 0; dvy27[i] = 0;
      }
      continue;
    }
    if (dset27[i]) {
      /* 落定后仍被阵风掀起：整片相干地推，不是逐颗乱抖 */
      const push = (gust27 * 5.5 + 1.1) * (0.6 + 0.4 * Math.sin(T * 2.1 + dph27[i] * 0.2));
      dx27[i] = dtx27[i] - push + Math.sin(T * 1.3 + dph27[i]) * 0.9;
      dy27[i] = dty27[i] + Math.cos(T * 1.7 + dph27[i]) * 1.1;
    }
  }

  for (let i = 0; i < NF27; i++) {
    fx27[i] += (Wv * 1.6 * fz27[i] + 40) * dt;
    fy27[i] += Math.sin(T * 1.2 + i) * 6 * dt;
    if (fx27[i] > W + 20) { fx27[i] = -20; fy27[i] = rnd(H * 0.48, H); }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  /* 远景沙幕：细密的水平流线（视差层） */
  ctx.fillStyle = `rgba(${Math.min(255, ar - 20)},${Math.min(255, ag - 14)},${Math.min(255, ab - 16)},0.16)`;
  ctx.beginPath();
  for (let i = 0; i < NF27; i++) {
    const px = pjX(fx27[i], fy27[i]), py = pjY(fx27[i], fy27[i]);
    if (px < -20 || px > W + 20) continue;
    ctx.rect(px, py, 9 * fz27[i] * z, 1.1);
  }
  ctx.fill();

  /* 沙丘底：一层被拉得很长的沙脊（字后面有厚度） */
  ctx.fillStyle = `rgba(${Math.min(255, ar - 60)},${Math.min(255, ag - 46)},${Math.min(255, ab - 60)},0.5)`;
  ctx.beginPath();
  for (let k = 0; k < 9; k++) {
    const yy = H * (0.62 + k * 0.04);
    const off = (T * (70 + k * 14)) % (W + 400);
    for (let x = -180; x < W + 180; x += 46) {
      const qx = pjX(x + off - 180, yy), qy = pjY(x + off - 180, yy);
      ctx.rect(qx, qy, 30, 1.6);
    }
  }
  ctx.fill();

  /* 沙粒：落定的暖金（带一层柔光）/ 在空中的暗金流沙 */
  if (L) {
    /* ① 落定层的柔光（一次 fill） */
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,214,150,0.10)';
    ctx.beginPath();
    for (let i = 0; i < n27; i++) {
      if (!dset27[i]) continue;
      const px = pjX(dx27[i], dy27[i]), py = pjY(dx27[i], dy27[i]);
      if (px < -14 || px > W + 14 || py < -14 || py > H + 14) continue;
      const s = dsz27[i] * 4.2 * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();

    /* ② 在途沙粒：被风拉成短划 */
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(186,152,110,0.55)';
    ctx.beginPath();
    for (let i = 0; i < n27; i++) {
      if (dset27[i] || T < dat27[i] - 0.4) continue;
      const px = pjX(dx27[i], dy27[i]), py = pjY(dx27[i], dy27[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const sp = Math.hypot(dvx27[i], dvy27[i]);
      const st = Math.min(3.2, sp * 0.006);
      const s = dsz27[i];
      ctx.rect(px - s * (1 + st) * 0.5, py - s * 0.5, s * (1 + st), s);
    }
    ctx.fill();

    /* ③ 落定沙粒实体 */
    ctx.fillStyle = 'rgba(248,218,172,0.98)';
    ctx.beginPath();
    for (let i = 0; i < n27; i++) {
      if (!dset27[i]) continue;
      const px = pjX(dx27[i], dy27[i]), py = pjY(dx27[i], dy27[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = dsz27[i] * 2.4 * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}
