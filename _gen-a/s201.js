/* ---------------------------------------------------------------------------
   201 · 机制实现：整屏字阵 + 一道横向的波
   ------------------------------------------------------------------------- */
META = {
  label: 'TYPE ARRAY / WAVE',
  sub: '7 行字阵 · 波压字距、推行距',
  right: 'λ 2.4',
  footer: 'ROWS 07',
  grid: 0.022,
  grain: 0.05,
  cross: true
};

const WALL_ROWS = 9;
let wallRows = 0;

/* 一行字烘成一张图（居中对齐，四周留一点余量） */
function bakeRow(text, fs, isCenter, blur) {
  const cw = Math.ceil(measureRows([text], fs)) + Math.ceil(fs * 0.34);
  const chh = Math.ceil(fs * 1.26);
  const mcv = maskCanvas([text], fs, fs * 1.26, cw, chh);
  const img = isCenter
    ? bakeCore(mcv)
    : tintMask(mcv, rgba(mixc(ACC, [236, 247, 253], 0.56), 1));
  if (!isCenter && blur > 0) {
    /* 离焦：越远的行越软，中心句是唯一"对上焦"的那一行 */
    const b = document.createElement('canvas');
    b.width = img.width; b.height = img.height;
    const g = b.getContext('2d');
    g.filter = 'blur(' + blur + 'px)';
    g.drawImage(img, 0, 0);
    g.filter = 'none';
    return { img: b, w: cw, h: chh, fs: fs };
  }
  return { img, w: cw, h: chh, fs: fs };
}

function mechBuild(i) {
  if (i < 0) return null;
  const center = lines[i];
  if (!center || !center.text) return null;
  const half = (WALL_ROWS - 1) / 2;
  const cfs = Math.min(80, H * 0.090);
  const rows = [];
  for (let r = -half; r <= half; r++) {
    const j = i + r;
    const txt = (lines[j] && lines[j].text) || '';
    if (!txt) continue;
    const isC = r === 0;
    const maxW = W * (isC ? 0.70 : 0.84);
    const maxFs = isC ? cfs : Math.max(18, cfs * (0.58 - 0.045 * Math.abs(r)));
    const fs = fitFont([txt], maxW, maxFs);
    const row = bakeRow(txt, fs, isC, isC ? 0 : 0.5 + Math.abs(r) * 0.28);
    row.r = r;
    row.isC = isC;
    row.alpha = isC ? 1 : Math.max(0.10, 0.27 - 0.034 * Math.abs(r));
    rows.push(row);
  }
  if (!rows.length) return null;
  wallRows = rows.length;
  return { rows, fs: cfs, rowH: Math.round(cfs * 1.02), center: rows.filter((x) => x.isC)[0] };
}

function mechCommit() {
  waveImp = 1;
}
function mechSeek() {
  wallRows = 0;
  waveImp = 0;
}

let waveImp = 0;

function mechUpdate(dt) {
  waveImp *= Math.exp(-dt * 2.2);
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const age = T - lineAt;
  const amp = RM ? 0.35 : 1;

  /* 波前：在行阵里来回走，速度很慢（不是闪动） */
  const wf = Math.sin(T * 0.52) * (WALL_ROWS * 0.34) + Math.sin(T * 0.21 + 1.3) * 0.7;
  const rowH = cur.rowH;

  /* 行阵的格线：先铺，给"阵"一个底 */
  ctx.strokeStyle = rgba(ACC, 0.055);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = -4; r <= 4; r++) {
    const y = Math.round(cy + r * rowH) + 0.5;
    ctx.moveTo(W * 0.07, y); ctx.lineTo(W * 0.93, y);
  }
  ctx.stroke();
  /* 左右边界（字阵的"边栏"） */
  ctx.strokeStyle = rgba(ACC, 0.075);
  ctx.beginPath();
  ctx.moveTo(W * 0.07 + 0.5, H * 0.14); ctx.lineTo(W * 0.07 + 0.5, H * 0.86);
  ctx.moveTo(W * 0.93 - 0.5, H * 0.14); ctx.lineTo(W * 0.93 - 0.5, H * 0.86);
  ctx.stroke();

  /* 波峰所在的横线：一条很淡的亮带 */
  const wy = cy + wf * rowH;
  ctx.strokeStyle = rgba(ACC, 0.13);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.moveTo(W * 0.07, wy + 0.5); ctx.lineTo(W * 0.93, wy + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  /* 由外向内画，中心句最后画（保证最清楚） */
  const order = [];
  for (let q = 0; q < cur.rows.length; q++) order.push(q);
  order.sort((a, b) => Math.abs(cur.rows[b].r) - Math.abs(cur.rows[a].r));

  for (let oi = 0; oi < order.length; oi++) {
    const R = cur.rows[order[oi]];
    const r = R.r;
    const d = r - wf;
    const w = Math.exp(-(d * d) / 2.1);              /* 波在这一点的影响 */
    const ent = Math.min(1, Math.max(0, (age - Math.abs(r) * 0.045) / 0.5));
    const e = 1 - Math.pow(1 - ent, 3);

    /* 入场：左右交替滑进来；波经过时：行被推上下、字距被压 */
    const slide = (1 - e) * (r % 2 ? 46 : -46);
    const yOff = Math.sin(T * 1.55 + r * 0.62) * 3.2 * amp * w
               + Math.sin(T * 0.9 + r) * 1.6 * amp * (1 - w)
               + (1 - e) * (r === 0 ? 0 : Math.sign(r) * 20);
    const wob = w * 9 * Math.sin(T * 1.9 + r * 0.8) * amp + waveImp * (r === 0 ? 0 : 7);
    const xs = 1 - 0.10 * w - 0.02 * waveImp;
    const y = cy + r * rowH + yOff + wob;
    const ww = R.w * xs, hh = R.h;
    const a = Math.min(1, R.alpha * e * (1 + 0.55 * w));
    ctx.globalAlpha = a;
    const shear = w * 12 * Math.sin(T * 1.35 + r * 1.1) * amp;
    ctx.drawImage(R.img, cx - ww / 2 + slide + shear, y - hh / 2, ww, hh);
  }
  ctx.globalAlpha = 1;

  /* 中心句再补一层很淡的径向辉光：它是"正在唱的那一行" */
  const c = cur.center;
  if (c) {
    ctx.globalCompositeOperation = 'lighter';
    const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, MN * 0.46);
    g2.addColorStop(0, rgba(ACC, 0.055 + 0.05 * kick));
    g2.addColorStop(0.55, rgba(ACC, 0.014));
    g2.addColorStop(1, rgba(ACC, 0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* 无歌词：七条规则的波 + 一条跟着波走的亮带（不出现任何占位字） */
function mechEmpty(T) {
  const cy = H * 0.5, rowH = 86;
  const wf = Math.sin(T * 0.52) * 2;
  /* 波峰所在的带：一条横向的柔光，让"阵"在空的时候也有重心 */
  const by = cy + wf * rowH;
  const band = ctx.createLinearGradient(0, by - rowH * 0.5, 0, by + rowH * 0.5);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.5, rgba(ACC, 0.055));
  band.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, by - rowH * 0.5, W, rowH);
  for (let r = -3; r <= 3; r++) {
    const y = cy + r * rowH;
    const near = Math.exp(-((r - wf) ** 2) / 2.1);
    const amp = 10 * near + 2;
    ctx.beginPath();
    for (let x = 0; x <= 40; x++) {
      const px = W * 0.07 + (W * 0.86) * (x / 40);
      const py = y + Math.sin(px * 0.014 + T * 1.6 + r) * amp;
      if (x) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = rgba(ACC, 0.16 + 0.34 * near);
    ctx.lineWidth = 1.2 + 0.8 * near;
    ctx.stroke();
  }
}

/* 左侧行号 + 右侧波位 */
function mechChrome() {
  const cx = W / 2;
  const half = (WALL_ROWS - 1) / 2;
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(ACC, 0.20);
  for (let r = -half; r <= half; r++) {
    const y = H * 0.5 + r * (cur ? cur.rowH : 86);
    ctx.fillText((r > 0 ? '+' : r < 0 ? '-' : ' ') + Math.abs(r), W * 0.07 - 10, y + 3);
  }
  const wf = Math.sin(T * 0.52) * (WALL_ROWS * 0.34);
  const wy = H * 0.5 + wf * (cur ? cur.rowH : 86);
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.26);
  ctx.fillText('WAVE', W * 0.93 + 10, wy + 3);
  ctx.beginPath();
  ctx.moveTo(W * 0.93 + 2, wy); ctx.lineTo(W * 0.93 + 8, wy);
  ctx.strokeStyle = rgba(ACC, 0.3);
  ctx.stroke();
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.35 : 1, rows: cur ? cur.rows.length : 0 };
}
