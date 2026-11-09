/* lizi43 · 喷砂雕刻 · sandblast
   喷砂枪从画面外侧对准工件，砂粒高速打在字的位置上、把表面凿毛；
   **字是被凿出来的那片哑光凹面**，砂粒打在字上就弹开、碎屑四溅。
   AE：碰撞碎屑 + 定向震动 + 缓推。 */

const N43 = 4800;
const ax43 = new Float32Array(N43), ay43 = new Float32Array(N43);
const avx43 = new Float32Array(N43), avy43 = new Float32Array(N43);
const atx43 = new Float32Array(N43), aty43 = new Float32Array(N43);
const aat43 = new Float32Array(N43), aet43 = new Float32Array(N43);
const asz43 = new Float32Array(N43), aown43 = new Int16Array(N43);
const abounce43 = new Uint8Array(N43);
let n43 = 0, jet43 = 0, nozX43 = 0, nozY43 = 0;
let workCv43 = null;

function mechResize() {
  if (!W || !H) return;
  nozX43 = W * 0.04; nozY43 = H * 0.88;
  for (let i = 0; i < N43; i++) {
    ax43[i] = nozX43; ay43[i] = nozY43;
    avx43[i] = 0; avy43[i] = 0;
    asz43[i] = 1 + Math.random() * 1.5;
    abounce43[i] = 0; aet43[i] = 0;
  }
  n43 = N43;
  if (!workCv43) workCv43 = document.createElement('canvas');
  workCv43.width = Math.max(2, Math.round(W / 2));
  workCv43.height = Math.max(2, Math.round(H / 2));
  const wc = workCv43.getContext('2d');
  const bw = workCv43.width, bh = workCv43.height;
  const g = wc.createRadialGradient(bw * 0.5, bh * 0.45, 0, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.8);
  g.addColorStop(0, '#14161a');
  g.addColorStop(0.6, '#0d0f13');
  g.addColorStop(1, '#06070a');
  wc.fillStyle = g; wc.fillRect(0, 0, bw, bh);
  /* 拉丝金属纹 */
  wc.strokeStyle = 'rgba(150,170,190,0.045)';
  wc.lineWidth = 1;
  for (let k = 0; k < 70; k++) {
    const y = Math.random() * bh;
    wc.beginPath(); wc.moveTo(0, y); wc.lineTo(bw, y + rnd(-2, 2)); wc.stroke();
  }
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n43 = Math.max(1800, Math.min(N43, Math.round(pc * 1.1)));
  jet43 = 1;
  for (let i = 0; i < n43; i++) {
    const pi = ((i * pc / n43) | 0) % pc;
    atx43[i] = blockGx + g.px[pi] + rnd(-1, 1);
    aty43[i] = blockGy + g.py[pi] + rnd(-1, 1);
    aown43[i] = g.own[pi];
    aat43[i] = use.at[g.own[pi]] || use.lineT;
    ax43[i] = nozX43 + rnd(-14, 14); ay43[i] = nozY43 + rnd(-14, 14);
    avx43[i] = rnd(140, 320); avy43[i] = rnd(-260, -80);
    abounce43[i] = 0; aet43[i] = 0;
  }
}

function mechEvent(k, first) {
  jet43 = first ? 1.7 : 1.1;
  cam.ox = (k % 2 ? -1 : 1) * (first ? 22 : 12);
  cam.oy = 6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  jet43 *= Math.pow(0.05, dt);
  cam.ox *= Math.pow(0.03, dt);
  cam.oy *= Math.pow(0.04, dt);
  for (let i = 0; i < n43; i++) {
    if (abounce43[i]) {
      /* 撞完弹开、落下去 */
      avy43[i] += 900 * dt;
      ax43[i] += avx43[i] * dt; ay43[i] += avy43[i] * dt;
      aet43[i] += dt;
      if (ay43[i] > H + 20 || aet43[i] > 2.2) {
        abounce43[i] = 0; aet43[i] = 0;
        ax43[i] = nozX43 + rnd(-14, 14); ay43[i] = nozY43 + rnd(-14, 14);
        avx43[i] = rnd(140, 340); avy43[i] = rnd(-280, -90);
      }
      continue;
    }
    if (T < aat43[i] - 0.5) {
      /* 还没轮到：在喷嘴附近绕 */
      ax43[i] = nozX43 + rnd(-10, 10); ay43[i] = nozY43 + rnd(-10, 10);
      continue;
    }
    const dx = atx43[i] - ax43[i], dy = aty43[i] - ay43[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    const kk = near ? 26 : 7;
    avx43[i] += dx * kk * dt - avx43[i] * (near ? 9 : 2) * dt;
    avy43[i] += dy * kk * dt - avy43[i] * (near ? 9 : 2) * dt;
    /* 砂粒是高速的：给一个朝字方向的基础速度 */
    const sp = Math.hypot(avx43[i], avy43[i]);
    if (sp > 1100) { const s = 1100 / sp; avx43[i] *= s; avy43[i] *= s; }
    ax43[i] += avx43[i] * dt; ay43[i] += avy43[i] * dt;
    if (d < 3 || T > aat43[i] + 1.6) {
      /* 打在字上：弹开 */
      abounce43[i] = 1;
      avx43[i] = rnd(-140, 140) + (ax43[i] - atx43[i]) * 6;
      avy43[i] = -rnd(120, 320);
      aet43[i] = 0;
      ax43[i] = atx43[i]; ay43[i] = aty43[i];
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (workCv43) ctx.drawImage(workCv43, 0, 0, W, H);

  /* 被凿毛的凹面：冷白哑光（字） */
  if (L) {
    ctx.fillStyle = `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 34)},${Math.min(255, ab + 38)},0.85)`;
    ctx.beginPath();
    for (let i = 0; i < n43; i++) {
      if (!abounce43[i]) continue;
      const px = pjX(atx43[i], aty43[i]), py = pjY(atx43[i], aty43[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = asz43[i] * 1.7 * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 砂粒：速度拉伸的亮条 */
  ctx.fillStyle = 'rgba(230,236,244,0.8)';
  ctx.beginPath();
  for (let i = 0; i < n43; i++) {
    if (abounce43[i]) continue;
    if (T < aat43[i] - 0.5) continue;
    const px = pjX(ax43[i], ay43[i]), py = pjY(ax43[i], ay43[i]);
    if (px < -14 || px > W + 14 || py < -14 || py > H + 14) continue;
    const sp = Math.hypot(avx43[i], avy43[i]);
    const st = Math.min(4, sp * 0.005);
    const s = asz43[i] * z;
    ctx.rect(px - s * (1 + st) * 0.5, py - s * 0.5, s * (1 + st), s * 1.6);
  }
  ctx.fill();

  /* 喷嘴 */
  const nx = pjX(nozX43, nozY43), ny = pjY(nozX43, nozY43);
  ctx.fillStyle = 'rgba(150,160,175,0.85)';
  ctx.beginPath();
  ctx.rect(nx - 12 * z, ny - 8 * z, 40 * z, 16 * z);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.rect(nx + 22 * z, ny - 4 * z, 10 * z, 8 * z);
  ctx.fill();
  void ar; void ag; void ab;
}
