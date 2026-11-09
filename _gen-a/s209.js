/* ---------------------------------------------------------------------------
   209 · 机制实现：拓印（墨是拍上去的，一记一记累积成字）
   ------------------------------------------------------------------------- */
META = {
  label: 'RUBBING / TAKUHON',
  sub: '拓包拍墨 · 墨量累积 · 纸纤维',
  right: 'INK DAB 1.5s',
  footer: 'STONE → PAPER',
  grid: 0.010,
  grain: 0.03,
  cross: true,
  song: true
};

let paper = null;            /* 纸 + 石面纹理（烘一次） */
let ink = null, inkG = null;  /* 累积的墨（跨帧保留） */
let ghost = null, ghostG = null;
let IS = 1;                  /* 墨层的像素比 */
let sprites = null;          /* 三个墨斑贴图 */
let padX = -999, padY = -999, padR = 40;
let kInk = 0, nPts = 0, lastEl = -1;
let pulses = null;           /* 拍打冲击环（复用数组） */

function bakePaper() {
  const c = document.createElement('canvas');
  c.width = Math.round(W); c.height = Math.round(H);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, c.width, c.height);
  /* 石面：低频斑驳 */
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 40 + Math.random() * 260;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.012 + Math.random() * 0.022;
    grd.addColorStop(0, 'rgba(160,164,170,' + a.toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  /* 纸纤维：短毛边（拓片纸是薄宣，能看见纤维） */
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const a = Math.random() * Math.PI;
    const L = 4 + Math.random() * 22;
    g.strokeStyle = 'rgba(214,208,192,' + (0.006 + Math.random() * 0.020).toFixed(3) + ')';
    g.lineWidth = 0.6 + Math.random() * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L * 0.5);
    g.stroke();
  }
  /* 纸的云斑（墨吃得不匀） */
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 90 + Math.random() * 300;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(200,206,210,0.016)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

/* 墨斑贴图：不规则的三叶团，边缘毛，落点之间会叠出深浅 */
function bakeSprites() {
  const out = [];
  for (let s = 0; s < 3; s++) {
    const n = 40;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    for (let q = 0; q < 4; q++) {
      const ox = n / 2 + (Math.random() - 0.5) * 5;
      const oy = n / 2 + (Math.random() - 0.5) * 5;
      const rr = n * (0.16 + Math.random() * 0.12);
      const grd = g.createRadialGradient(ox, oy, 0, ox, oy, rr);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.80)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(ox, oy, rr, 0, Math.PI * 2);
      g.fill();
    }
    /* 墨偏冷一点，和整片的主色是一个族（不是纯白，也不是彩色） */
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = rgba(mixc(ACC, [255, 255, 255], 0.62), 1);
    g.fillRect(0, 0, n, n);
    g.globalCompositeOperation = 'source-over';
    out.push(c);
  }
  return out;
}

function mechResize() {
  IS = Math.max(1, Math.round(Math.min(2, DPR)));
  paper = bakePaper();
  if (!sprites) sprites = bakeSprites();
  ink = document.createElement('canvas');
  ink.width = Math.max(2, Math.round(W * IS));
  ink.height = Math.max(2, Math.round(H * IS));
  inkG = ink.getContext('2d');
  ghost = document.createElement('canvas');
  ghost.width = ink.width; ghost.height = ink.height;
  ghostG = ghost.getContext('2d');
  kInk = 0; lastEl = -1;
  if (cur && cur.pts) { /* resize 后旧墨作废，重新开始拍 */ kInk = 0; }
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 13);
  const fs = fitFont(rows, W * 0.72, Math.min(160, H * 0.16));
  const lh = fs * 1.16;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.20);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 6) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const data = mcv.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, mcv.width, mcv.height).data;

  /* 每个字在整行里的横向区间（决定墨点属于哪一句的哪个字） */
  const chars = Array.from(line.text);
  const n = chars.length;
  const rowsTxt = rows;
  const charX = [];
  {
    let acc = 0;
    const totalW = measureRows(rowsTxt, fs);
    for (let k = 0; k < n; k++) {
      const w = measureRows([chars[k]], fs);
      charX.push({ x0: (cw - totalW) / 2 + acc, x1: (cw - totalW) / 2 + acc + w });
      acc += w;
    }
  }
  const dur = line.dur || 4;

  /* 采样墨点：按 device px 走，隔 3 个取一个；上限 5200 点 */
  const MW = mcv.width, MH = mcv.height;
  const cand = [];
  for (let y = 0; y < MH; y += 2) {
    for (let x = 0; x < MW; x += 2) {
      if (data[(y * MW + x) * 4 + 3] > 40) cand.push(x, y);
    }
  }
  const total = cand.length / 2;
  if (!total) return null;
  const OX = W / 2 - cw / 2, OY = H / 2 - chh / 2;   /* 字块在画布上的位置：墨点是绝对坐标 */
  const cap = Math.min(7600, total);
  const step = total / cap;
  const pts = [];
  for (let q = 0; q < cap; q++) {
    const idx = Math.min(total - 1, Math.floor(q * step + Math.random() * step));
    const px = cand[idx * 2] / SS, py = cand[idx * 2 + 1] / SS;
    /* 属于哪个字：按横向区间二分（同一行内） */
    let k = 0;
    for (let c = 0; c < n; c++) {
      if (px >= charX[c].x0 - 2 && px <= charX[c].x1 + 2) { k = c; break; }
    }
    const tOn = onsetOf(line, k, n) - (line.t || 0);
    pts.push({
      x: px + OX + (Math.random() - 0.5) * 2.4,
      y: py + OY + (Math.random() - 0.5) * 2.4,
      t: Math.max(0, tOn + Math.random() * (dur / Math.max(6, n)) * 0.9),
      r: 3.6 + Math.random() * 3.2,
      s: (Math.random() * 3) | 0
    });
  }
  pts.sort((a, b) => a.t - b.t);
  return { pts, cw, chh, fs, rows, text: line.text };
}

function mechCommit() {
  /* 上一句的墨拓留在纸上（很淡），新的一句重新拍 */
  if (ink && ghostG) {
    ghostG.clearRect(0, 0, ghost.width, ghost.height);
    ghostG.drawImage(ink, 0, 0);
  }
  if (inkG) inkG.clearRect(0, 0, ink.width, ink.height);
  kInk = 0; lastEl = -1;
  padX = -999; padY = -999;
  pulses = [];
}
function mechSeek() {
  if (inkG) inkG.clearRect(0, 0, ink.width, ink.height);
  if (ghostG) ghostG.clearRect(0, 0, ghost.width, ghost.height);
  kInk = 0; lastEl = -1; padX = -999; padY = -999;
  pulses = [];
}

function dab(p, alpha) {
  const s = sprites[p.s % 3];
  const r = p.r * IS;
  /* 先垫一层更大更软的墨（压力大时墨会渗开），再落这一记的实心墨斑 */
  inkG.globalAlpha = alpha * 0.30;
  inkG.drawImage(s, (p.x - p.r * 1.9) * IS, (p.y - p.r * 1.9) * IS, r * 3.8, r * 3.8);
  inkG.globalAlpha = alpha;
  inkG.drawImage(s, (p.x - p.r) * IS, (p.y - p.r) * IS, r * 2, r * 2);
}

function mechUpdate(dt, time) {
  const amp = RM ? 0.25 : 1;
  if (pulses) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].t += dt;
      if (pulses[i].t > 0.55) pulses.splice(i, 1);
    }
  }
  /* 拓包追着墨点走（减少动态时直接跳过去） */
  if (cur && cur.pts && kInk > 0) {
    const p = cur.pts[Math.min(kInk - 1, cur.pts.length - 1)];
    const ease = RM ? 1 : Math.min(1, dt * 14);
    padX = padX < -500 ? p.x : padX + (p.x - padX) * ease;
    padY = padY < -500 ? p.y : padY + (p.y - padY) * ease;
    padR += ((cur.fs * 0.26) + Math.sin(time * 6) * 1.2 * amp - padR) * Math.min(1, dt * 6);
  }
}

function mechDraw(T) {
  if (!cur) return;
  const pts = cur.pts;
  nPts = pts.length;
  const cx = W / 2, cy = H * 0.5;
  const age = T - lineAt;

  /* ---- 拍墨：按"该唱到哪"决定这一帧要落多少点 ---- */
  const el = Math.max(0, age);
  if (lastEl < 0 || el < lastEl - 0.25) {       /* 同句内回拖：重拍 */
    if (inkG) inkG.clearRect(0, 0, ink.width, ink.height);
    kInk = 0;
  }
  lastEl = el;
  let target = 0;
  while (target < pts.length && pts[target].t <= el * 0.92 + 0.06) target++;
  if (target > kInk) {
    const budget = RM ? 80 : 165;
    let n = 0;
    while (kInk < target && n < budget) {
      const p = pts[kInk];
      dab(p, 0.26 + Math.random() * 0.16);
      if ((kInk & 63) === 0 && pulses && pulses.length < 8) {
        pulses.push({ x: p.x, y: p.y, t: 0 });
      }
      kInk++; n++;
    }
  }

  /* ---- 纸 ---- */
  if (paper) ctx.drawImage(paper, 0, 0, W, H);

  /* ---- 上一句的残拓（碑上留下的旧痕） ---- */
  if (ghost) {
    ctx.globalAlpha = 0.16;
    ctx.drawImage(ghost, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  /* ---- 这一句的墨 ---- */
  if (ink) {
    ctx.globalAlpha = 1;
    ctx.drawImage(ink, 0, 0, W, H);
  }

  /* ---- 压印环：每拍一下，纸上荡开一圈 ---- */
  if (pulses) {
    ctx.lineWidth = 1;
    for (let i = 0; i < pulses.length; i++) {
      const q = pulses[i];
      const u = q.t / 0.55;
      ctx.strokeStyle = rgba(ACC, (1 - u) * 0.16);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6 + u * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ---- 拓包：最后落下的那一记（可见的"手"） ---- */
  if (padX > -500 && age < (pts[pts.length - 1].t / 0.92) + 3) {
    const r = Math.max(12, padR);
    ctx.globalCompositeOperation = 'source-over';
    const grd = ctx.createRadialGradient(padX, padY - r * 0.3, r * 0.15, padX, padY, r);
    grd.addColorStop(0, 'rgba(26,30,33,0.34)');
    grd.addColorStop(0.72, 'rgba(14,17,19,0.30)');
    grd.addColorStop(1, 'rgba(6,8,9,0.02)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(padX, padY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(mixc(ACC, [230, 240, 245], 0.5), 0.34);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(padX, padY, r - 1, 0, Math.PI * 2);
    ctx.stroke();
    /* 拓包上的布纹 */
    ctx.strokeStyle = 'rgba(220,228,232,0.05)';
    ctx.beginPath();
    for (let q = -2; q <= 2; q++) {
      const yy = padY + q * r * 0.34;
      const dx = Math.sqrt(Math.max(0, r * r * 0.86 - (q * r * 0.34) * (q * r * 0.34)));
      ctx.moveTo(padX - dx, yy);
      ctx.lineTo(padX + dx, yy);
    }
    ctx.stroke();
  }

  /* ---- 拓片框（纸的范围）+ 读数 ---- */
  const bx = cx - cur.cw / 2 - 26, by = cy - cur.chh / 2 - 26;
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, cur.cw + 52, cur.chh + 52);
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.28);
  ctx.textAlign = 'left';
  ctx.fillText('DABS ' + kInk + '/' + nPts, bx, by + cur.chh + 72);
  ctx.fillStyle = rgba(ACC, 0.15);
  ctx.fillText('PRESS ' + Math.round(100 * kInk / Math.max(1, nPts)) + '%   FIBER 1400', bx, by + cur.chh + 85);
}

/* 无歌词：一张空纸，拓包在原地一下一下地拍（墨点稀疏、不组成字） */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  const amp = RM ? 0.3 : 1;
  if (paper) ctx.drawImage(paper, 0, 0, W, H);
  /* 三块墨晕随呼吸晕开，像没对准的拓 */
  for (let i = 0; i < 3; i++) {
    const ph = (T * 0.12 + i / 3) % 1;
    const x = cx + Math.cos(i * 2.1 + T * 0.09) * W * 0.15 * amp;
    const y = cy + Math.sin(i * 1.7 + T * 0.07) * H * 0.11 * amp;
    const r = 90 + 110 * ph;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba(ACC, 0.13 * (1 - ph)));
    grd.addColorStop(0.55, rgba(ACC, 0.05 * (1 - ph)));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  /* 拍打环：一记一记往外荡 */
  for (let k = 0; k < 3; k++) {
    const ph = (T * 0.55 + k / 3) % 1;
    ctx.strokeStyle = rgba(ACC, 0.30 * (1 - ph));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 20 + ph * 120, 0, Math.PI * 2);
    ctx.stroke();
  }
  /* 拓包本体：一个压暗的圆（有布纹），随拍轻压 */
  const pr = 46 + Math.sin(T * 1.6) * 2.5 * amp;
  const pg = ctx.createRadialGradient(cx, cy - pr * 0.3, pr * 0.15, cx, cy, pr);
  pg.addColorStop(0, 'rgba(26,30,33,0.55)');
  pg.addColorStop(0.75, 'rgba(14,17,19,0.55)');
  pg.addColorStop(1, 'rgba(6,8,9,0.05)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(mixc(ACC, [230, 240, 245], 0.5), 0.42);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, pr - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,228,232,0.06)';
  ctx.beginPath();
  for (let q = -2; q <= 2; q++) {
    const yy = cy + q * pr * 0.34;
    const dx = Math.sqrt(Math.max(0, pr * pr * 0.86 - (q * pr * 0.34) * (q * pr * 0.34)));
    ctx.moveTo(cx - dx, yy); ctx.lineTo(cx + dx, yy);
  }
  ctx.stroke();
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.32);
  ctx.textAlign = 'center';
  ctx.fillText('NO INSCRIPTION · 纯音频', cx, cy + pr + 26);
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.3 : 1, dabs: kInk, pts: nPts, press: +(kInk / Math.max(1, nPts)).toFixed(2) };
}
