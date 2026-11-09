/* lizi21 · 陀螺进动 · gyro
   字 = 进动锥的包络面。
   每个字形采样点是一枚陀螺的轴心：三颗粒子落在同一圈进动轨道上、相隔 120°，
   随进动角前进（每颗速度略不同），三档亮度把它们画成一条拖影弧；
   一圈圈锥面叠起来，就是能读出字的管状轮廓。
   换句：进动半径先甩到约 2.3 倍再弹簧收回 1 倍。
   命中：相位整体"甩"一下（相干），镜头滚转反向给冲量，cam.ox 缓慢环绕。 */

const NM21 = 7800, NP21 = 2600, TAU21 = Math.PI * 2;

/* 粒子（i = 轴心 p * 3 + 相位 ph） */
const cx21 = new Float32Array(NM21), cy21 = new Float32Array(NM21);
const ax21 = new Float32Array(NM21), ay21 = new Float32Array(NM21);
const ar21 = new Float32Array(NM21), aa21 = new Float32Array(NM21);
const aw21 = new Float32Array(NM21), at21 = new Float32Array(NM21);
const as21 = new Float32Array(NM21), aown21 = new Int16Array(NM21);
const aon21 = new Uint8Array(NM21), aA21 = new Float32Array(NM21);
let n21 = 0, nP21 = 0, T21 = 0;

/* 轴心 / 锥体（每个字形采样点一份） */
const qx21 = new Float32Array(NP21), qy21 = new Float32Array(NP21);
const qr21 = new Float32Array(NP21), qh21 = new Float32Array(NP21);
const qp21 = new Float32Array(NP21), qown21 = new Int16Array(NP21);

let swoop = 1, swoopV = 0, kick21 = 0, oxI21 = 0, oyI21 = 0, dir21 = 1;
let bg21 = null;

/* 环绕尘埃：跟 W/H 相关，必须在 mechResize 里撒点 */
const ND21 = 170;
const ddr21 = new Float32Array(ND21), dda21 = new Float32Array(ND21);
const ddv21 = new Float32Array(ND21);

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < ND21; i++) {
    ddr21[i] = rnd(Math.min(W, H) * 0.12, Math.max(W, H) * 0.58);
    dda21[i] = rnd(0, TAU21);
    ddv21[i] = rnd(0.04, 0.30) * (Math.random() < 0.5 ? -1 : 1);
  }

  /* 背景预烘一次，之后每帧只 blit */
  if (!bg21) bg21 = document.createElement('canvas');
  bg21.width = Math.max(2, Math.round(W * 0.5));
  bg21.height = Math.max(2, Math.round(H * 0.5));
  const c = bg21.getContext('2d');
  const bw = bg21.width, bh = bg21.height;

  const gd = c.createLinearGradient(0, 0, 0, bh);
  gd.addColorStop(0, '#04060b');
  gd.addColorStop(0.5, '#070b13');
  gd.addColorStop(1, '#0c1320');
  c.fillStyle = gd; c.fillRect(0, 0, bw, bh);

  const rg = c.createRadialGradient(bw * 0.5, bh * 0.44, 0, bw * 0.5, bh * 0.44, Math.max(bw, bh) * 0.62);
  rg.addColorStop(0, 'rgba(96,150,225,0.11)');
  rg.addColorStop(0.55, 'rgba(52,92,150,0.05)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rg; c.fillRect(0, 0, bw, bh);

  /* 陀螺刻度环（静态，只烘一次） */
  c.strokeStyle = 'rgba(150,190,240,0.055)';
  c.lineWidth = 1;
  for (let k = 0; k < 9; k++) {
    const rr = bw * (0.10 + k * 0.052);
    c.beginPath();
    c.ellipse(bw * 0.5, bh * 0.44, rr, rr * 0.42, 0, 0, TAU21);
    c.stroke();
  }

  c.fillStyle = 'rgba(140,180,235,0.028)';
  c.beginPath();
  for (let y = 0; y < bh; y += 3) c.rect(0, y, bw, 1);
  c.fill();

  c.fillStyle = 'rgba(190,220,255,0.09)';
  c.beginPath();
  for (let i = 0; i < 900; i++) c.rect(Math.random() * bw, Math.random() * bh, 1, 1);
  c.fill();

  const vg = c.createRadialGradient(bw * 0.5, bh * 0.5, Math.min(bw, bh) * 0.3, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.58)');
  c.fillStyle = vg; c.fillRect(0, 0, bw, bh);
}

function mechAssign(use) {
  const g = use.g, pc = g.pc | 0;
  if (!pc || !W || !H) return;

  nP21 = Math.max(1000, Math.min(NP21, Math.round(pc * 0.9)));
  dir21 = Math.random() < 0.5 ? 1 : -1;          /* 整句同向，弧线才对得上 */
  for (let p = 0; p < nP21; p++) {
    const pi = Math.min(pc - 1, (p * pc / nP21) | 0);
    qx21[p] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    qy21[p] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    qr21[p] = 3.0 + Math.random() * 3.0;          /* 进动半径，贴住笔画不糊成团 */
    qh21[p] = 0.38 + Math.random() * 0.22;        /* 锥面透视压扁 */
    qp21[p] = Math.random() * TAU21;              /* 该点的基准相位 */
    qown21[p] = g.own[pi];
  }

  n21 = nP21 * 3;
  for (let i = 0; i < n21; i++) {
    const p = (i / 3) | 0, ph = i % 3;
    ax21[i] = qx21[p]; ay21[i] = qy21[p];
    aa21[i] = qp21[p] + ph * 2.0943951 + rnd(-0.14, 0.14);
    ar21[i] = qr21[p] * (0.90 + ph * 0.06 + rnd(0, 0.12));
    aw21[i] = (1.25 + Math.random() * 1.35) * dir21 * (Math.random() < 0.12 ? -1 : 1);
    at21[i] = qh21[p] + rnd(-0.03, 0.03);
    as21[i] = (1.4 + Math.random() * 0.7) * (0.80 + ph * 0.17);
    aown21[i] = qown21[p];
    if (!aon21[i]) {
      const a0 = aa21[i] + T21 * aw21[i];
      cx21[i] = ax21[i] + Math.cos(a0) * ar21[i];
      cy21[i] = ay21[i] + Math.sin(a0) * ar21[i] * at21[i];
      aon21[i] = 1;
    }
  }

  /* 换句：半径先甩大 */
  swoop = 1.75; swoopV = 0;
  kick21 = 0.5;
}

function mechEvent(k, first) {
  kick21 += first ? 0.85 : 0.5;
  swoop = Math.max(swoop, first ? 1.45 : 1.22);
  swoopV += first ? 1.5 : 0.8;
  oxI21 += (k % 2 ? -1 : 1) * W * 0.018;
  oyI21 += (first ? -1 : 1) * H * 0.008;
  cam.vrot = (k % 2 ? -1 : 1) * (first ? 5.2 : 3.0);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  T21 = T;

  kick21 *= Math.pow(0.02, dt);
  oxI21 *= Math.pow(0.06, dt);
  oyI21 *= Math.pow(0.06, dt);

  swoopV += (1 - swoop) * 150 * dt;
  swoopV *= Math.exp(-dt * 9.5);
  swoop += swoopV * dt;
  if (swoop < 0.62) { swoop = 0.62; if (swoopV < 0) swoopV = 0; }

  const k = 1 - Math.exp(-dt * 20);
  for (let i = 0; i < n21; i++) {
    const a = aa21[i] + T * aw21[i] + kick21;
    aA21[i] = a;
    const rr = ar21[i] * swoop;
    const tx = ax21[i] + Math.cos(a) * rr;
    const ty = ay21[i] + Math.sin(a) * rr * at21[i];
    cx21[i] += (tx - cx21[i]) * k;
    cy21[i] += (ty - cy21[i]) * k;
  }

  for (let i = 0; i < ND21; i++) dda21[i] += ddv21[i] * dt;

  /* 缓慢环绕 + 命中冲量 */
  cam.ox = Math.sin(T * 0.10) * W * 0.030 + oxI21;
  cam.oy = Math.cos(T * 0.077) * H * 0.014 + oyI21;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (bg21) ctx.drawImage(bg21, 0, 0, W, H);
  if (!L || !n21) return;

  const sc = Math.max(0.85, Math.min(1.22, z || 1));
  ctx.globalCompositeOperation = 'lighter';

  /* 1 · 锥面浓雾：把每个轴心的整圈轨道铺成"管"，字靠它填满 */
  ctx.fillStyle = `rgba(${(ar * 0.40) | 0},${(ag * 0.50) | 0},${Math.min(255, (ab * 0.52 + 42)) | 0},0.032)`;
  ctx.beginPath();
  for (let p = 0; p < nP21; p++) {
    const px = pjX(qx21[p], qy21[p]), py = pjY(qx21[p], qy21[p]);
    const w = qr21[p] * swoop * 2.3 * sc;
    const h = w * qh21[p] * 0.98;
    ctx.rect(px - w * 0.5, py - h * 0.5, w, h);
  }
  ctx.fill();

  /* 2 · 轴心（锥尖）细线，保证字的中线可读 */
  ctx.fillStyle = 'rgba(196,226,255,0.20)';
  ctx.beginPath();
  for (let p = 0; p < nP21; p++) {
    const px = pjX(qx21[p], qy21[p]), py = pjY(qx21[p], qy21[p]);
    if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
    ctx.rect(px - 1.3, py - 1.15, 2.6, 2.3);
  }
  ctx.fill();

  /* 3 · 三个相位 = 暗 / 中 / 亮，同色批量画 */
  for (let b = 0; b < 3; b++) {
    if (b === 0) ctx.fillStyle = `rgba(${(ar * 0.55) | 0},${(ag * 0.62) | 0},${Math.min(255, (ab * 0.7 + 55)) | 0},0.20)`;
    else if (b === 1) ctx.fillStyle = `rgba(${Math.min(255, (ar * 0.8 + 20)) | 0},${Math.min(255, (ag * 0.86 + 26)) | 0},${Math.min(255, (ab * 0.86 + 38)) | 0},0.30)`;
    else ctx.fillStyle = 'rgba(198,228,255,0.42)';
    ctx.beginPath();
    for (let i = b; i < n21; i += 3) {
      const px = pjX(cx21[i], cy21[i]), py = pjY(cx21[i], cy21[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = as21[i] * sc;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      if (b === 2) {
        /* 拖影：沿轨道往回四格，读作一条弧 */
        const rr = ar21[i] * swoop;
        for (let k2 = 1; k2 <= 4; k2++) {
          const a2 = aA21[i] - 0.34 * k2;
          const tx = ax21[i] + Math.cos(a2) * rr;
          const ty = ay21[i] + Math.sin(a2) * rr * at21[i];
          const qx = pjX(tx, ty), qy = pjY(tx, ty);
          if (qx < -12 || qx > W + 12 || qy < -12 || qy > H + 12) continue;
          const s2 = s * (0.72 - 0.15 * k2);
          ctx.rect(qx - s2 * 0.5, qy - s2 * 0.5, s2, s2);
        }
      }
    }
    ctx.fill();
  }

  /* 4 · 正被唱到的字：亮相位粒子烧成暖白（只画最亮那一档，别糊成一片） */
  ctx.fillStyle = 'rgba(255,244,214,0.32)';
  ctx.beginPath();
  for (let i = 2; i < n21; i += 3) {
    if ((charGlow[aown21[i]] || 0) < 0.55) continue;
    const px = pjX(cx21[i], cy21[i]), py = pjY(cx21[i], cy21[i]);
    if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
    const s = as21[i] * 1.2 * sc;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
  }
  ctx.fill();

  /* 5 · 环绕尘埃 */
  ctx.fillStyle = 'rgba(180,214,255,0.17)';
  ctx.beginPath();
  for (let i = 0; i < ND21; i++) {
    const a = dda21[i];
    const wx = W * 0.5 + Math.cos(a) * ddr21[i];
    const wy = H * 0.46 + Math.sin(a) * ddr21[i] * 0.5;
    const px = pjX(wx, wy), py = pjY(wx, wy);
    if (px < -4 || px > W + 4 || py < -4 || py > H + 4) continue;
    ctx.rect(px, py, 1.6, 1.6);
  }
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}
