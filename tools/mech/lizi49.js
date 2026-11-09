/* lizi49 · 像素量化 · quantize
   粒子先是一团连续的点云，随着句子推进被**一步步量化到像素栅格**上：
   每量化一次，点就并到更大的格子里，最后字变成一块块像素 —— 字是量化之后的块状像。
   AE：抽帧（量化步长按镜头"档位"跳变）+ 变焦（每档跳一次）+ 顿帧。 */

const N49 = 6400;
const qx49 = new Float32Array(N49), qy49 = new Float32Array(N49);
const qtx49 = new Float32Array(N49), qty49 = new Float32Array(N49);
const qown49 = new Int16Array(N49), qat49 = new Float32Array(N49);
const qph49 = new Float32Array(N49), qsz49 = new Float32Array(N49);
let n49 = 0, qstep49 = 2, zoom49 = 1;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N49; i++) {
    qx49[i] = Math.random() * W; qy49[i] = Math.random() * H;
    qph49[i] = Math.random() * 6.283;
    qsz49[i] = 1 + Math.random() * 1.4;
  }
  n49 = N49;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n49 = Math.max(2200, Math.min(N49, Math.round(pc * 1.5)));
  for (let i = 0; i < n49; i++) {
    const pi = ((i * pc / n49) | 0) % pc;
    qtx49[i] = blockGx + g.px[pi] + rnd(-1, 1);
    qty49[i] = blockGy + g.py[pi] + rnd(-1, 1);
    qown49[i] = g.own[pi];
    qat49[i] = use.at[g.own[pi]] || use.lineT;
  }
  qstep49 = 2;
}

function mechEvent(k, first) {
  cam.tz = Math.max(cam.tz, 1.02 + (first ? 0.03 : 0.015));
  cam.ox = (k % 2 ? 1 : -1) * (first ? 22 : 12);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.03, dt);
  /* 量化档位：2 → 4 → 7 → 11 px，按句子进度跳 */
  const prog = clamp01((T - lineT) / Math.max(1.2, lineDur));
  qstep49 = prog < 0.25 ? 2 : prog < 0.5 ? 4 : prog < 0.75 ? 7 : 11;
  zoom49 = 1 + qstep49 * 0.008;
  for (let i = 0; i < n49; i++) {
    if (T < qat49[i] - 0.5) continue;
    const k = Math.min(1, dt * 6);
    qx49[i] += (qtx49[i] - qx49[i]) * k;
    qy49[i] += (qty49[i] - qy49[i]) * k;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const st = qstep49;
  /* 已经量化的字：把位置吸到格点上，一步一块 */
  if (!L) return;
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 2
      ? `rgba(${Math.min(255, ar + 46)},${Math.min(255, ag + 40)},${Math.min(255, ab + 24)},0.96)`
      : pass === 1
        ? `rgba(${Math.min(255, ar - 4)},${Math.min(255, ag + 2)},${Math.min(255, ab + 6)},0.7)`
        : 'rgba(60,72,100,0.42)';
    ctx.beginPath();
    for (let i = 0; i < n49; i++) {
      if (T < qat49[i] - 0.5) continue;
      const qi = (i % 3);
      if (qi !== pass) continue;
      const gx = Math.round(qx49[i] / st) * st;
      const gy = Math.round(qy49[i] / st) * st;
      const px = pjX(gx, gy), py = pjY(gx, gy);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      const s = st * (pass === 2 ? 0.92 : 0.8) * z * zoom49;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 栅格线：量化越狠，格线越明显 */
  if (st >= 7) {
    ctx.strokeStyle = 'rgba(140,180,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < W; x += st * 3) { ctx.moveTo(pjX(x, 0), pjY(x, 0)); ctx.lineTo(pjX(x, H), pjY(x, H)); }
    for (let y = 0; y < H; y += st * 3) { ctx.moveTo(pjX(0, y), pjY(0, y)); ctx.lineTo(pjX(W, y), pjY(W, y)); }
    ctx.stroke();
  }
}
