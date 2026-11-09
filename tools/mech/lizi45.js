/* lizi45 · 磁轨弹射 · railgun
   粒子在两条磁轨之间被加速，出膛的一瞬间拉成一道亮线，直接砸到字位上。
   **字 = 被一颗颗射钉在空中的弹体**。后坐力把镜头往后顶一下。
   AE：缓急变速（出膛加速）+ 后坐 + 冲击帧 + 速度拉伸。 */

const N45 = 4400;
const rx45 = new Float32Array(N45), ry45 = new Float32Array(N45);
const rvx45 = new Float32Array(N45), rvy45 = new Float32Array(N45);
const rtx45 = new Float32Array(N45), rty45 = new Float32Array(N45);
const rat45 = new Float32Array(N45), rsz45 = new Float32Array(N45);
const rset45 = new Uint8Array(N45), rph45 = new Float32Array(N45);
let n45 = 0, railY45 = 0, recoil45 = 0, muzzle45 = 0;

function mechResize() {
  if (!W || !H) return;
  railY45 = H * 0.62;
  for (let i = 0; i < N45; i++) {
    rx45[i] = 0; ry45[i] = railY45;
    rvx45[i] = 0; rvy45[i] = 0;
    rsz45[i] = 1.1 + Math.random() * 1.4;
    rph45[i] = Math.random() * 6.283;
    rset45[i] = 0;
  }
  n45 = N45;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n45 = Math.max(2000, Math.min(N45, Math.round(pc * 1.3)));
  for (let i = 0; i < n45; i++) {
    const pi = ((i * pc / n45) | 0) % pc;
    rtx45[i] = blockGx + g.px[pi] + rnd(-1, 1);
    rty45[i] = blockGy + g.py[pi] + rnd(-1, 1);
    rat45[i] = use.at[g.own[pi]] || use.lineT;
    rset45[i] = 0;
    rx45[i] = -20 - rnd(0, 60);
    ry45[i] = railY45 + rnd(-3, 3);
    rvx45[i] = rnd(200, 500); rvy45[i] = 0;
  }
}

function mechEvent(k, first) {
  recoil45 = first ? 1.6 : 1;
  muzzle45 = 1;
  cam.ox = (first ? 30 : 16);
  cam.vrot += (k % 2 ? 1 : -1) * 0.18;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  recoil45 *= Math.pow(0.03, dt);
  muzzle45 *= Math.pow(0.05, dt);
  cam.ox *= Math.pow(0.05, dt);
  for (let i = 0; i < n45; i++) {
    const age = T - rat45[i];
    if (age < 0) {
      rx45[i] = -20 - (i % 8) * 12; ry45[i] = railY45 + rnd(-2, 2);
      continue;
    }
    if (!rset45[i]) {
      if (age < 0.25) {
        /* 在轨加速：越来越快 */
        rvx45[i] += 6000 * dt * (0.4 + age * 3);
        rvx45[i] = Math.min(2600, rvx45[i]);
        rx45[i] += rvx45[i] * dt;
        ry45[i] += Math.sin(T * 8 + i) * 3 * dt;
        continue;
      }
      /* 出膛：直接冲向字位（高速，用速度上限兜住） */
      const dx = rtx45[i] - rx45[i], dy = rty45[i] - ry45[i];
      const d = Math.hypot(dx, dy);
      const near = d < 80;
      const kk = near ? 42 : 20;
      rvx45[i] += dx * kk * dt - rvx45[i] * (near ? 9.5 : 1.2) * dt;
      rvy45[i] += dy * kk * dt - rvy45[i] * (near ? 9.5 : 1.2) * dt;
      const sp = Math.hypot(rvx45[i], rvy45[i]);
      if (sp > 950) { const s = 950 / sp; rvx45[i] *= s; rvy45[i] *= s; }
      rx45[i] += rvx45[i] * dt; ry45[i] += rvy45[i] * dt;
      if (d < 2.4 || T > rat45[i] + 1.6) {
        rset45[i] = 1; rx45[i] = rtx45[i]; ry45[i] = rty45[i];
        rvx45[i] = 0; rvy45[i] = 0;
      }
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 两条磁轨 */
  const y1 = pjY(0, railY45 - 16), y2 = pjY(0, railY45 + 16);
  ctx.strokeStyle = 'rgba(150,180,220,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pjX(-40, railY45 - 16), y1); ctx.lineTo(pjX(W * 0.55, railY45 - 16), pjY(W * 0.55, railY45 - 16));
  ctx.moveTo(pjX(-40, railY45 + 16), y2); ctx.lineTo(pjX(W * 0.55, railY45 + 16), pjY(W * 0.55, railY45 + 16));
  ctx.stroke();
  /* 轨间电弧 */
  if (muzzle45 > 0.1) {
    ctx.strokeStyle = `rgba(180,220,255,${(0.3 * muzzle45).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const x = -20 + k * 40;
      ctx.moveTo(pjX(x, railY45 - 14), pjY(x, railY45 - 14));
      ctx.lineTo(pjX(x + 14, railY45 + 14), pjY(x + 14, railY45 + 14));
    }
    ctx.stroke();
  }

  if (!L) return;
  for (let pass = 0; pass < 2; pass++) {
    const set = pass === 1;
    ctx.fillStyle = set
      ? `rgba(${Math.min(255, ar + 50)},${Math.min(255, ag + 46)},${Math.min(255, ab + 26)},0.95)`
      : `rgba(${Math.min(255, ar - 20)},${Math.min(255, ag + 10)},${Math.min(255, ab + 40)},0.12)`;
    ctx.beginPath();
    for (let i = 0; i < n45; i++) {
      if (!!rset45[i] !== set) continue;
      if (!set && T < rat45[i]) continue;
      const px = pjX(rx45[i], ry45[i]), py = pjY(rx45[i], ry45[i]);
      if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
      const sp = set ? 0 : Math.hypot(rvx45[i], rvy45[i]);
      const st = Math.min(2.4, sp * 0.0024);
      const s = rsz45[i] * (set ? 2.0 : 1.1) * z;
      ctx.rect(px - s * (1 + st) * 0.5, py - s * 0.5, s * (1 + st), s);
    }
    ctx.fill();
  }
}
