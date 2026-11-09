/* lizi41 · 声呐回波 · sonar
   声呐脉冲一圈圈扫出去，**回波扫到哪，字就在哪亮起来**；脉冲过去后余辉衰减。
   字只在被扫到时可见 —— 整句就是一次一次的回波把字"读"出来。
   AE：扫描线 + 抽帧（回波按 1/20s 量化）+ 缓推。 */

const N41 = 5200;
const px41 = new Float32Array(N41), py41 = new Float32Array(N41);
const ptx41 = new Float32Array(N41), pty41 = new Float32Array(N41);
const pon41 = new Int16Array(N41), pat41 = new Float32Array(N41);
const psz41 = new Float32Array(N41), peel41 = new Float32Array(N41);
let n41 = 0, srcX41 = 0, srcY41 = 0, ringR41 = 0, ringOn41 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N41; i++) {
    px41[i] = Math.random() * W; py41[i] = Math.random() * H;
    psz41[i] = 1.2 + Math.random() * 1.6;
    peel41[i] = 0;
  }
  n41 = N41;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n41 = Math.max(2000, Math.min(N41, Math.round(pc * 1.5)));
  srcX41 = blockGx - (W * 0.42); srcY41 = blockGy;
  for (let i = 0; i < n41; i++) {
    const pi = ((i * pc / n41) | 0) % pc;
    ptx41[i] = blockGx + g.px[pi] + rnd(-1, 1);
    pty41[i] = blockGy + g.py[pi] + rnd(-1, 1);
    pon41[i] = g.own[pi];
    pat41[i] = use.at[g.own[pi]] || use.lineT;
    px41[i] = ptx41[i] + rnd(-20, 20); py41[i] = pty41[i] + rnd(-6, 6);
    peel41[i] = 0;
  }
  ringR41 = 0; ringOn41 = 1;
}

function mechEvent(k, first) {
  ringR41 = 0; ringOn41 = 1;
  cam.ox = (k % 2 ? 1 : -1) * (first ? 26 : 14);
  cam.tz = Math.max(cam.tz, 1.02 + (first ? 0.02 : 0.01));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.03, dt);
  /* 回波：从左边那个声源一圈圈扩散，到边就重置 */
  ringR41 += 420 * dt;
  if (ringR41 > W * 1.25) ringR41 = 0;
  for (let i = 0; i < n41; i++) {
    const d = Math.hypot(ptx41[i] - srcX41, pty41[i] - srcY41);
    const band = Math.exp(-Math.pow((d - ringR41) / 120, 2));
    if (band > peel41[i]) peel41[i] = band;
    peel41[i] *= Math.pow(0.55, dt);
    if (T < pat41[i] - 0.6) { peel41[i] = 0; continue; }
    px41[i] += (ptx41[i] - px41[i]) * Math.min(1, dt * 6);
    py41[i] += (pty41[i] - py41[i]) * Math.min(1, dt * 6);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const q = Math.floor(T * 20) / 20;   /* 抽帧 */

  /* 声呐屏的同心刻度圈 */
  ctx.strokeStyle = 'rgba(90,160,150,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cx = pjX(srcX41, srcY41), cy = pjY(srcX41, srcY41);
  for (let k = 1; k <= 5; k++) {
    const rr = (k * W * 0.11) * z;
    ctx.moveTo(cx + rr, cy);
    ctx.ellipse(cx, cy, rr, rr, 0, 0, 6.2832);
  }
  ctx.stroke();

  /* 当前回波环 */
  const rr = ringR41 * z;
  ctx.strokeStyle = 'rgba(150,255,220,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + rr, cy);
  ctx.ellipse(cx, cy, rr, rr, 0, 0, 6.2832);
  ctx.stroke();

  /* 回波扫到的字：两档（余辉 / 正被扫到） */
  if (L) {
    for (let pass = 0; pass < 2; pass++) {
      const hot = pass === 1;
      ctx.fillStyle = hot
        ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 70)},${Math.min(255, ab + 50)},0.95)`
        : `rgba(${Math.min(255, ar - 10)},${Math.min(255, ag + 30)},${Math.min(255, ab + 40)},0.38)`;
      ctx.beginPath();
      for (let i = 0; i < n41; i++) {
        const e = peel41[i];
        if (hot !== (e > 0.45)) continue;
        /* 底子常亮一点点：字不至于完全看不见 */
        const px = pjX(px41[i], py41[i]), py = pjY(px41[i], py41[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = psz41[i] * (hot ? 1.7 : 1.2) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }
  void q;
}
