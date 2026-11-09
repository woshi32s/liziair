/* lizi24 · 电子云 · orbital
   字形采样点上各有一个"原子核"，电子在它周围的三维轨道上转；
   **高概率轨道面**（投影成椭圆）叠出来的密度就是字。
   唱到某个字，那个字的电子云从混沌里收拢到轨道面上 —— 概率坍缩。 */

const N24 = 8400;
const ex = new Float32Array(N24), ey = new Float32Array(N24);
const etx = new Float32Array(N24), ety = new Float32Array(N24);
const eown = new Int16Array(N24), eat = new Float32Array(N24);
const erad = new Float32Array(N24), espd = new Float32Array(N24);
const eph = new Float32Array(N24), etil = new Float32Array(N24);
const esz = new Float32Array(N24), ecoll = new Uint8Array(N24);
let n24 = 0, dolly24 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N24; i++) {
    ex[i] = Math.random() * W; ey[i] = Math.random() * H;
    esz[i] = 1.15 + Math.random() * 1.4;
    ecoll[i] = 0;
  }
  n24 = N24;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n24 = Math.max(2400, Math.min(N24, Math.round(pc * 2.1)));
  for (let i = 0; i < n24; i++) {
    const pi = ((i * pc / n24) | 0) % pc;
    etx[i] = blockGx + g.px[pi] + rnd(-0.8, 0.8);
    ety[i] = blockGy + g.py[pi] + rnd(-0.8, 0.8);
    eown[i] = g.own[pi];
    eat[i] = use.at[g.own[pi]] || use.lineT;
    erad[i] = 3.5 + Math.random() * 7.5;
    espd[i] = (0.8 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1);
    eph[i] = Math.random() * 6.283;
    etil[i] = 0.3 + Math.random() * 0.55;
    ecoll[i] = 0;
  }
  dolly24 = 1;
}

function mechEvent(k, first) {
  dolly24 = first ? 1.6 : 1;
  cam.tz = Math.max(cam.tz, 1.04);
  cam.oy = (k % 2 ? 1 : -1) * 6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  dolly24 *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  const A = T + dolly24 * 0.4;
  for (let i = 0; i < n24; i++) {
    if (T < eat[i] - 0.5) continue;
    ecoll[i] = 1;
    /* 概率云：绕着核的椭圆轨道 + 一点进动 */
    const a = eph[i] + T * espd[i] * 1.5;
    const r = erad[i] * (0.72 + 0.28 * Math.sin(T * 0.9 + eph[i]));
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r * etil[i];
    const tx = etx[i] + ox, ty = ety[i] + oy;
    const k = Math.min(1, dt * (5.5 + dolly24 * 3));
    ex[i] += (tx - ex[i]) * k;
    ey[i] += (ty - ey[i]) * k;
    void A;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  /* 轨道面：每个核画一条很淡的椭圆轨道边（只画一部分，省时间） */
  ctx.strokeStyle = `rgba(${Math.min(255, ar - 40)},${Math.min(255, ag - 20)},${Math.min(255, ab + 30)},0.10)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n24; i += 9) {
    if (!ecoll[i]) continue;
    const cx = pjX(etx[i], ety[i]), cy = pjY(etx[i], ety[i]);
    if (cx < -20 || cx > W + 20 || cy < -20 || cy > H + 20) continue;
    const rr = erad[i] * z;
    ctx.moveTo(cx + rr, cy);
    ctx.ellipse(cx, cy, rr, rr * etil[i], 0, 0, 6.2832);
  }
  ctx.stroke();

  /* 电子：按轨道远近分两档（近的亮、远的暗） */
  for (let pass = 0; pass < 2; pass++) {
    const near = pass === 1;
    ctx.fillStyle = near
      ? `rgba(${Math.min(255, ar + 50)},${Math.min(255, ag + 42)},${Math.min(255, ab + 26)},0.95)`
      : `rgba(${Math.min(255, ar - 34)},${Math.min(255, ag - 22)},${Math.min(255, ab + 6)},0.34)`;
    ctx.beginPath();
    for (let i = 0; i < n24; i++) {
      if (!ecoll[i]) continue;
      if ((Math.abs(Math.sin(T * espd[i] * 1.5 + eph[i])) > 0.45) !== near) continue;
      const px = pjX(ex[i], ey[i]), py = pjY(ex[i], ey[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = esz[i] * (near ? 1.5 : 1.25) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
}
