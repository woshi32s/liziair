/* lizi19 · 露珠挂丝 · silk-dew
   字 = 蛛丝网上停驻的露珠。
   节点全部来自字形采样（每节点记 own / at），节点间按最近邻连成丝网（一次预计算）；
   每颗露珠挂在节点上，先从丝上偏 40~120px 处滑过来，近目标强阻尼停住；
   风一来整张网连珠子相干摆动，丝跟着珠子弯；命中时甩出镜头。
   景深：焦点缓慢滑动，近处珠大而亮，远处小且淡。 */

const N19 = 1500;      /* 字形节点 / 露珠上限 */
const SEG19 = 5400;    /* 丝段上限 */
const MIC19 = 2400;    /* 丝上微露 */
const DUST19 = 760;    /* 空气浮尘 */
const SPK19 = 200;     /* 命中甩出的水星 */

/* 节点 = 字形采样点 = 一颗停驻露珠 */
const nX = new Float32Array(N19), nY = new Float32Array(N19);
const nVX = new Float32Array(N19), nVY = new Float32Array(N19);
const nTX = new Float32Array(N19), nTY = new Float32Array(N19);
const nAT = new Float32Array(N19), nDEP = new Float32Array(N19);
const nSZ = new Float32Array(N19), nPH = new Float32Array(N19);
const nOWN = new Int16Array(N19), nFIRST = new Int32Array(N19);
const nSCX = new Float32Array(N19), nSCY = new Float32Array(N19);
const nDRP = new Float32Array(N19);
const nB = new Float32Array(N19);
let n19 = 0;

/* 丝：预计算线段，每帧只投影节点 */
const sA = new Int32Array(SEG19), sB = new Int32Array(SEG19);
let sN = 0;

/* 丝上的微露：附着在丝段上，随丝一起弯 */
const mA = new Int32Array(MIC19), mB = new Int32Array(MIC19);
const mT = new Float32Array(MIC19), mSZ = new Float32Array(MIC19);
const mD = new Float32Array(MIC19);
let mn19 = 0;

/* 空气浮尘：必须在 mechResize 里按 W/H 预撒 */
const dX = new Float32Array(DUST19), dY = new Float32Array(DUST19);
const dVX = new Float32Array(DUST19), dVY = new Float32Array(DUST19);
const dSZ = new Float32Array(DUST19), dD = new Float32Array(DUST19);
let dn19 = 0;

/* 命中甩出的水星 */
const kX = new Float32Array(SPK19), kY = new Float32Array(SPK19);
const kVX = new Float32Array(SPK19), kVY = new Float32Array(SPK19);
const kL = new Float32Array(SPK19), kSZ = new Float32Array(SPK19);

let wnd19 = 0, gst19 = 0, foc19 = 0.5;
let bg19 = null;

function buildBG19() {
  if (!bg19) bg19 = document.createElement('canvas');
  const bw = Math.max(2, Math.round(W * 0.5)), bh = Math.max(2, Math.round(H * 0.5));
  bg19.width = bw; bg19.height = bh;
  const c = bg19.getContext('2d');
  const gd = c.createLinearGradient(0, 0, 0, bh);
  gd.addColorStop(0, '#02060a');
  gd.addColorStop(0.52, '#06141a');
  gd.addColorStop(1, '#020609');
  c.fillStyle = gd; c.fillRect(0, 0, bw, bh);
  const rg = c.createRadialGradient(bw * 0.5, bh * 0.56, 0, bw * 0.5, bh * 0.56, Math.max(bw, bh) * 0.78);
  rg.addColorStop(0, 'rgba(34,118,136,0.20)');
  rg.addColorStop(0.55, 'rgba(16,58,72,0.10)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rg; c.fillRect(0, 0, bw, bh);
  /* 远处旧网：静态，制造纵深 */
  c.strokeStyle = 'rgba(126,196,208,0.06)';
  c.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    let x = Math.random() * bw, y = Math.random() * bh;
    c.beginPath(); c.moveTo(x, y);
    for (let q = 0; q < 3; q++) {
      const nx2 = x + rnd(-bw * 0.22, bw * 0.22), ny2 = y + rnd(-bh * 0.18, bh * 0.2);
      c.quadraticCurveTo(x + rnd(-30, 30), y + rnd(-20, 60), nx2, ny2);
      x = nx2; y = ny2;
    }
    c.stroke();
  }
  c.fillStyle = 'rgba(150,214,226,0.10)';
  c.beginPath();
  for (let i = 0; i < 2200; i++) c.rect(Math.random() * bw, Math.random() * bh, 1, 1);
  c.fill();
  /* 暗角 */
  const vg = c.createRadialGradient(bw * 0.5, bh * 0.5, Math.min(bw, bh) * 0.3, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.fillStyle = vg; c.fillRect(0, 0, bw, bh);
}

function mechResize() {
  if (!W || !H) return;
  dn19 = DUST19;
  for (let i = 0; i < DUST19; i++) {
    dX[i] = rnd(0, W); dY[i] = rnd(0, H);
    dVX[i] = rnd(-14, 14); dVY[i] = rnd(-10, 6);
    dSZ[i] = 0.6 + Math.random() * 1.5; dD[i] = Math.random();
  }
  for (let i = 0; i < SPK19; i++) { kL[i] = 0; kX[i] = rnd(0, W); kY[i] = rnd(0, H); kSZ[i] = 1; }
  buildBG19();
}

function mechAssign(use) {
  if (!W || !H || !use || !use.g) return;
  const g = use.g, pc = g.pc;
  const n = Math.min(N19, Math.max(600, Math.min(pc, 1350)));
  n19 = n; sN = 0; mn19 = 0;
  const step = pc / n;
  for (let i = 0; i < n; i++) {
    const pi = Math.min(pc - 1, (i * step) | 0);
    const tx = blockGx + g.px[pi], ty = blockGy + g.py[pi];
    nTX[i] = tx + rnd(-0.7, 0.7);
    nTY[i] = ty + rnd(-0.7, 0.7);
    nOWN[i] = g.own[pi] | 0;
    nAT[i] = use.at[nOWN[i]] || use.lineT || 0;
    const depv = 0.5 + 0.5 * Math.sin(nTX[i] * 0.0052 + nTY[i] * 0.0041 + 1.7);
    nDEP[i] = clamp01(depv * 0.72 + Math.random() * 0.28);
    nSZ[i] = (1.15 + Math.random() * 1.15) * (0.8 + nDEP[i] * 0.45);
    nPH[i] = Math.random() * 6.283;
    nFIRST[i] = -1;
  }

  /* ---- 最近邻连丝（格点加速，一次算完） ---- */
  const cell = 52;
  const gw = Math.max(1, Math.ceil(W / cell) + 3), gh = Math.max(1, Math.ceil(H / cell) + 3);
  const head = new Int32Array(gw * gh).fill(-1);
  const nxt = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let cx = ((nTX[i] / cell) | 0) + 1, cy = ((nTY[i] / cell) | 0) + 1;
    if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
    if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
    const idx = cy * gw + cx;
    nxt[i] = head[idx]; head[idx] = i;
  }
  for (let i = 0; i < n; i++) {
    let cx = ((nTX[i] / cell) | 0) + 1, cy = ((nTY[i] / cell) | 0) + 1;
    if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
    if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
    let b1 = -1, b2 = -1, b3 = -1, d1 = 1e9, d2 = 1e9, d3 = 1e9;
    for (let oy = -2; oy <= 2; oy++) {
      const yy = cy + oy;
      if (yy < 0 || yy >= gh) continue;
      const row = yy * gw;
      for (let ox = -2; ox <= 2; ox++) {
        const xx = cx + ox;
        if (xx < 0 || xx >= gw) continue;
        for (let j = head[row + xx]; j >= 0; j = nxt[j]) {
          if (j === i) continue;
          const dx0 = nTX[j] - nTX[i], dy0 = nTY[j] - nTY[i];
          const dd = dx0 * dx0 + dy0 * dy0;
          if (dd < 30 || dd > 16900) continue;   /* 6 ~ 130 px */
          if (dd < d1) { d3 = d2; b3 = b2; d2 = d1; b2 = b1; d1 = dd; b1 = j; }
          else if (dd < d2) { d3 = d2; b3 = b2; d2 = dd; b2 = j; }
          else if (dd < d3) { d3 = dd; b3 = j; }
        }
      }
    }
    nFIRST[i] = b1;
    if (b1 > i && sN < SEG19) { sA[sN] = i; sB[sN++] = b1; }
    if (b2 > i && sN < SEG19) { sA[sN] = i; sB[sN++] = b2; }
    if (b3 > i && Math.random() < 0.34 && sN < SEG19) { sA[sN] = i; sB[sN++] = b3; }
  }
  /* 跨丝的几根长桥：让整张网连起来，而不是一堆平行短线 */
  for (let k = 0; k < 150 && sN < SEG19; k++) {
    const a = (Math.random() * n) | 0, b = (Math.random() * n) | 0;
    if (a === b) continue;
    const dd = Math.hypot(nTX[a] - nTX[b], nTY[a] - nTY[b]);
    if (dd < 60 || dd > 150) continue;
    sA[sN] = a; sB[sN++] = b;
  }

  /* 丝上微露 */
  if (sN > 8) {
    mn19 = Math.min(MIC19, Math.round(sN * 0.62));
    for (let i = 0; i < mn19; i++) {
      const s = (Math.random() * sN) | 0;
      mA[i] = sA[s]; mB[i] = sB[s];
      mT[i] = Math.random();
      mSZ[i] = 0.7 + Math.random() * 1.35;
      mD[i] = Math.random();
    }
  }

  /* 露珠先沿丝偏出 40~120px，再阻尼滑到落点 */
  for (let i = 0; i < n; i++) {
    const f = nFIRST[i];
    let ux = Math.cos(nPH[i]), uy = Math.sin(nPH[i]) * 0.6;
    if (f >= 0) {
      const dx0 = nTX[f] - nTX[i], dy0 = nTY[f] - nTY[i];
      const l = Math.hypot(dx0, dy0) || 1;
      ux = dx0 / l; uy = dy0 / l;
    }
    /* 大多数珠几乎直接落位（字形第一时间就可认），少数从丝上滑 40~110px 过来 */
    const rr = Math.random();
    const off = (rr < 0.62 ? rnd(3, 10) : rr < 0.85 ? rnd(12, 35) : rnd(40, 110)) * (Math.random() < 0.5 ? -1 : 1);
    nX[i] = nTX[i] + ux * off + rnd(-10, 10);
    nY[i] = nTY[i] + uy * off + rnd(-8, 8) + 6;
    nVX[i] = -ux * off * 3.2;
    nVY[i] = -uy * off * 3.2;
  }
}

function mechEvent(k, first) {
  const dir = k % 2 ? 1 : -1;
  gst19 = dir * (first ? 1.05 : 0.62);
  cam.ox = dir * (first ? 34 : 17);
  cam.oy = -6;
  cam.tz += (cam.tz >= 1 ? 1 : -1) * 0.028;
  for (let i = 0; i < SPK19; i++) {
    if (Math.random() < 0.45) continue;
    kX[i] = rnd(W * 0.12, W * 0.88);
    kY[i] = rnd(H * 0.28, H * 0.76);
    const a = rnd(0, 6.283), sp = rnd(90, 340);
    kVX[i] = Math.cos(a) * sp + dir * 90;
    kVY[i] = Math.sin(a) * sp - 70;
    kL[i] = 1;
    kSZ[i] = 0.8 + Math.random() * 2.2;
  }
}

function mechUpdate(dt, T) {
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;

  gst19 *= Math.pow(0.22, dt);
  const wBase = Math.sin(T * 0.47) * 0.55 + Math.sin(T * 1.13 + 2.1) * 0.22 + Math.sin(T * 2.7) * 0.06;
  wnd19 = wBase + gst19;
  foc19 = 0.5 + 0.42 * Math.sin(T * 0.19 + 0.7);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);

  /* 浮尘 */
  const wd = wnd19 * 55;
  for (let i = 0; i < dn19; i++) {
    dX[i] += (dVX[i] + wd * (0.4 + dD[i])) * dt;
    dY[i] += (dVY[i] + Math.sin(T * 0.8 + i * 0.7) * 5) * dt;
    if (dX[i] > W + 8) dX[i] -= W + 16; else if (dX[i] < -8) dX[i] += W + 16;
    if (dY[i] > H + 8) dY[i] -= H + 16; else if (dY[i] < -8) dY[i] += H + 16;
  }

  /* 水星 */
  for (let i = 0; i < SPK19; i++) {
    if (kL[i] <= 0) continue;
    kL[i] -= dt * 0.85;
    kVY[i] += 190 * dt;
    kVX[i] *= Math.pow(0.55, dt); kVY[i] *= Math.pow(0.85, dt);
    kX[i] += kVX[i] * dt; kY[i] += kVY[i] * dt;
  }

  if (!L) return;

  const sway = T * 1.25;
  const swx = wnd19 * 6.5;
  for (let i = 0; i < n19; i++) {
    const dep = nDEP[i];
    const wResp = 0.5 + dep * 0.95;
    /* 风：整张网同一方向的相干冲量，外加一点自身摆动 */
    nVX[i] += (wnd19 * 55 * wResp + Math.sin(T * 2.1 + nPH[i]) * 20) * dt;
    nVY[i] += (Math.sin(T * 1.7 + nPH[i] * 1.7) * 16 - gst19 * 26) * dt;

    /* 落点也在轻轻晃（整串丝一起荡），弹簧去追这个移动目标 */
    const gx = nTX[i] + swx + Math.sin(sway + nPH[i]) * 3.2;
    const gy = nTY[i] + 5 + (1 - dep) * 7 + Math.cos(sway * 0.8 + nPH[i]) * 2.6;

    const dx0 = gx - nX[i], dy0 = gy - nY[i];
    const d = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    const near = d < 80;
    const kk = near ? 26 : 105;         /* 追移动目标硬弹簧 */
    const damp = near ? 9 : 2.4;        /* 近目标强阻尼 */
    nVX[i] += (dx0 * kk - nVX[i] * damp) * dt;
    nVY[i] += (dy0 * kk - nVY[i] * damp) * dt;
    const sp = Math.sqrt(nVX[i] * nVX[i] + nVY[i] * nVY[i]);
    if (sp > 900) { const s = 900 / sp; nVX[i] *= s; nVY[i] *= s; }
    nX[i] += nVX[i] * dt;
    nY[i] += nVY[i] * dt;
  }
}

function mechDraw(T, z, pjX, pjY) {
  if (bg19) ctx.drawImage(bg19, 0, 0, W, H);

  /* 浮尘：最远的一层 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(148,206,222,0.20)';
  ctx.beginPath();
  for (let i = 0; i < dn19; i++) {
    const px = pjX(dX[i], dY[i]), py = pjY(dX[i], dY[i]);
    if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
    const s = dSZ[i] * z * (0.7 + dD[i] * 0.8);
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 1.1);
  }
  ctx.fill();

  if (!L || !n19) { ctx.globalCompositeOperation = 'source-over'; return; }

  /* 节点投影一次，后面全用屏幕坐标；珠挂在丝下方 droop 处 */
  for (let i = 0; i < n19; i++) {
    nSCX[i] = pjX(nX[i], nY[i]);
    nSCY[i] = pjY(nX[i], nY[i]);
    nDRP[i] = (5 + (1 - nDEP[i]) * 7) * z;
  }

  /* ---- 丝：一次 beginPath + 多段二次曲线 + 一次 stroke ---- */
  ctx.globalCompositeOperation = 'source-over';
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) { ctx.strokeStyle = 'rgba(100,176,192,0.075)'; ctx.lineWidth = 2.2; }
    else { ctx.strokeStyle = 'rgba(158,220,232,0.19)'; ctx.lineWidth = 0.9; }
    ctx.beginPath();
    for (let s = 0; s < sN; s++) {
      const a = sA[s], b = sB[s];
      const ax = nSCX[a], ay = nSCY[a] - nDRP[a];
      const bx = nSCX[b], by = nSCY[b] - nDRP[b];
      if ((ax < -120 && bx < -120) || (ax > W + 120 && bx > W + 120) ||
          (ay < -120 && by < -120) || (ay > H + 120 && by > H + 120)) continue;
      const dx0 = bx - ax, dy0 = by - ay;
      const len = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      if (len < 0.4) continue;
      ctx.moveTo(ax, ay);
      if (len < 7) { ctx.lineTo(bx, by); continue; }
      const cxp = (ax + bx) * 0.5 + wnd19 * len * 0.26 + Math.sin(T * 1.7 + a * 0.37) * len * 0.06;
      const cyp = (ay + by) * 0.5 + len * 0.10 + Math.cos(T * 1.3 + b * 0.29) * len * 0.06;
      ctx.quadraticCurveTo(cxp, cyp, bx, by);
    }
    ctx.stroke();
  }

  /* ---- 丝上微露（同一批 rect） ---- */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(172,226,238,0.33)';
  ctx.beginPath();
  for (let i = 0; i < mn19; i++) {
    const a = mA[i], b = mB[i], t = mT[i];
    const ax = nSCX[a], ay = nSCY[a] - nDRP[a];
    const bx = nSCX[b], by = nSCY[b] - nDRP[b];
    if ((ax < -40 && bx < -40) || (ax > W + 40 && bx > W + 40) ||
        (ay < -40 && by < -40) || (ay > H + 40 && by > H + 40)) continue;
    const dx0 = bx - ax, dy0 = by - ay;
    const len = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    const cxp = (ax + bx) * 0.5 + wnd19 * len * 0.26 + Math.sin(T * 1.7 + a * 0.37) * len * 0.06;
    const cyp = (ay + by) * 0.5 + len * 0.10 + Math.cos(T * 1.3 + b * 0.29) * len * 0.06;
    const it = 1 - t;
    const px = it * it * ax + 2 * it * t * cxp + t * t * bx;
    const py = it * it * ay + 2 * it * t * cyp + t * t * by;
    if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
    const s = mSZ[i] * z * (0.7 + mD[i] * 0.8);
    ctx.rect(px - s * 0.5, py - s * 0.5 + s * 0.25, s, s * 1.3);
  }
  ctx.fill();

  /* ---- 露珠：亮度与尺寸来自景深焦点 + 字上的 glow ---- */
  for (let i = 0; i < n19; i++) {
    const gm = charGlow[nOWN[i]] || 0;
    const gl = gm > 0.02 ? gm : (T >= nAT[i] ? 0.28 : 0);
    nB[i] = (1 - Math.abs(nDEP[i] - foc19)) * 0.9 + gl * 1.35;
  }

  const [ar, ag, ab] = accent;
  const cHalo = `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 44)},${Math.min(255, ab + 40)},0.10)`;
  const cDim = `rgba(${Math.min(255, ar + 14)},${Math.min(255, ag + 26)},${Math.min(255, ab + 24)},0.36)`;
  const cMid = `rgba(${Math.min(255, ar + 66)},${Math.min(255, ag + 52)},${Math.min(255, ab + 44)},0.66)`;
  const cBright = `rgba(${Math.min(255, ar + 122)},${Math.min(255, ag + 94)},${Math.min(255, ab + 86)},0.96)`;

  /* 雾光：所有珠共用一批大 rect，先把整片字"打湿" */
  ctx.fillStyle = cHalo;
  ctx.beginPath();
  for (let i = 0; i < n19; i++) {
    const px = nSCX[i], py = nSCY[i];
    if (px < -18 || px > W + 18 || py < -18 || py > H + 18) continue;
    const s = nSZ[i] * z * (1.15 + nB[i] * 0.45);
    const h = s * 1.4;
    ctx.rect(px - s * 0.5, py - h * 0.42, s, h);
  }
  ctx.fill();

  for (let tier = 0; tier < 3; tier++) {
    ctx.fillStyle = tier === 2 ? cBright : tier === 1 ? cMid : cDim;
    ctx.beginPath();
    for (let i = 0; i < n19; i++) {
      const bness = nB[i];
      const band = bness > 1.0 ? 2 : bness > 0.62 ? 1 : 0;
      if (band !== tier) continue;
      const px = nSCX[i], py = nSCY[i];
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = nSZ[i] * z * (0.95 + bness * 0.6);
      const w = s, h = s * 1.5;
      const top = py - h * 0.5 + s * 0.18;
      ctx.rect(px - w * 0.5, top, w, h);                              /* 珠身 */
      ctx.rect(px - w * 0.28, top - h * 0.26, w * 0.56, h * 0.34);    /* 圆头 */
      if (tier === 2) ctx.rect(px - s * 0.24, top + h * 0.10, Math.max(1, s * 0.24), 1); /* 1px 高光 */
    }
    ctx.fill();
  }

  /* ---- 水星 ---- */
  ctx.fillStyle = 'rgba(226,255,250,0.78)';
  ctx.beginPath();
  for (let i = 0; i < SPK19; i++) {
    const lv = kL[i];
    if (lv <= 0.02) continue;
    const px = pjX(kX[i], kY[i]), py = pjY(kX[i], kY[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = kSZ[i] * z * (0.4 + lv * 0.9);
    ctx.rect(px - s * 0.5, py - s * 0.9, s, s * 1.9);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
