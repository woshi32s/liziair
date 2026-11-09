/* lizi33 · 毛细上升 · capillary
   液体在多孔材料里毛细上升：每一列有一条细孔，水从底部往上爬，
   爬到该列对应的**字高**就停住、横向渗开 —— 字是渗透前沿停住的那条湿痕。
   AE：微距缓推 + 焦点滑动 + 顿帧。 */

const N33 = 5200;
const kx33 = new Float32Array(N33), ky33 = new Float32Array(N33);
const ktx33 = new Float32Array(N33), kty33 = new Float32Array(N33);
const kown33 = new Float32Array(N33), kat33 = new Float32Array(N33);
const ksp33 = new Float32Array(N33), ksz33 = new Float32Array(N33);
const kst33 = new Uint8Array(N33);
let n33 = 0, front33 = 0;
let paperCv33 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N33; i++) {
    kx33[i] = Math.random() * W; ky33[i] = H * (0.85 + Math.random() * 0.15);
    kst33[i] = 0; ksz33[i] = 1 + Math.random() * 1.2;
  }
  n33 = N33;
  /* 多孔纸：纤维 + 孔洞，预烘 */
  if (!paperCv33) paperCv33 = document.createElement('canvas');
  paperCv33.width = Math.max(2, Math.round(W / 2));
  paperCv33.height = Math.max(2, Math.round(H / 2));
  const pc = paperCv33.getContext('2d');
  const bw = paperCv33.width, bh = paperCv33.height;
  pc.fillStyle = '#0b0a08'; pc.fillRect(0, 0, bw, bh);
  pc.strokeStyle = 'rgba(190,170,140,0.05)';
  pc.lineWidth = 1;
  for (let k = 0; k < 90; k++) {
    const x = Math.random() * bw, y = Math.random() * bh;
    pc.beginPath(); pc.moveTo(x, y);
    pc.lineTo(x + rnd(-30, 30), y + rnd(-8, 8));
    pc.stroke();
  }
  pc.fillStyle = 'rgba(40,36,30,0.5)';
  pc.beginPath();
  for (let i = 0; i < 2200; i++) pc.rect(Math.random() * bw, Math.random() * bh, 1.4, 1.4);
  pc.fill();
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n33 = Math.max(1800, Math.min(N33, Math.round(pc * 1.35)));
  front33 = 0;
  for (let i = 0; i < n33; i++) {
    const pi = ((i * pc / n33) | 0) % pc;
    ktx33[i] = blockGx + g.px[pi] + rnd(-1, 1);
    kty33[i] = blockGy + g.py[pi] + rnd(-1, 1);
    kown33[i] = g.own[pi];
    kat33[i] = use.at[g.own[pi]] || use.lineT;
    kst33[i] = 0;
    ksp33[i] = rnd(260, 460);
    kx33[i] = ktx33[i] + rnd(-3, 3);
    ky33[i] = H * 0.97 + rnd(0, 20);
  }
}

function mechEvent(k, first) {
  cam.oy = first ? -10 : -5;
  cam.tz = Math.max(cam.tz, 1.04);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.oy *= Math.pow(0.05, dt);
  for (let i = 0; i < n33; i++) {
    if (kst33[i]) continue;
    if (T < kat33[i] - 0.6) continue;
    /* 毛细上升：沿着自己那一列往上爬，快到字高时减速 */
    const dy = ky33[i] - kty33[i];
    const sp = ksp33[i] * (dy < 40 ? Math.max(0.2, dy / 40) : 1);
    ky33[i] -= sp * dt;
    if (ky33[i] <= kty33[i] + 1.2) {
      ky33[i] = kty33[i];
      kst33[i] = 1;
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (paperCv33) ctx.drawImage(paperCv33, 0, 0, W, H);

  /* 湿痕：只留一点点底部的暗（不再画整条色带） */
  ctx.fillStyle = 'rgba(30,42,58,0.35)';
  ctx.fillRect(0, H * 0.93, W, H * 0.07);

  /* 上升中的水柱：细长条 */
  ctx.fillStyle = `rgba(${Math.min(255, ar - 10)},${Math.min(255, ag + 16)},${Math.min(255, ab + 40)},0.12)`;
  ctx.beginPath();
  for (let i = 0; i < n33; i++) {
    if (kst33[i]) continue;
    if (T < kat33[i] - 0.6) continue;
    const px = pjX(kx33[i], ky33[i]), py = pjY(kx33[i], ky33[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px, py, 1.5, 7 * z);
  }
  ctx.fill();

  /* 停住的湿前沿（字）：两档 */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0
      ? `rgba(${Math.min(255, ar - 40)},${Math.min(255, ag - 10)},${Math.min(255, ab + 20)},0.45)`
      : `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 56)},${Math.min(255, ab + 70)},0.95)`;
    ctx.beginPath();
    for (let i = 0; i < n33; i++) {
      if (!kst33[i]) continue;
      const px = pjX(kx33[i], ky33[i]), py = pjY(kx33[i], ky33[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = ksz33[i] * (pass ? 1.7 : 2.6) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
}
