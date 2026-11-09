/* ---------------------------------------------------------------------------
   208 · 机制实现：竖排（右起分栏 + 逐字落格 + 行气波）
   ------------------------------------------------------------------------- */
META = {
  label: 'VERTICAL / TB-RL',
  sub: '右起竖排 · 逐字落格 · 界栏',
  right: 'TB · RL',
  footer: 'COL RULE 1.0',
  grid: 0.014,
  grain: 0.05,
  cross: true
};

let nCols = 0, nCells = 0, landedN = 0;

function bakeCell(ch, fs) {
  const pad = Math.ceil(fs * 0.14);
  const cw = Math.ceil(fs) + pad * 2, chh = Math.ceil(fs * 1.12) + pad * 2;
  const mcv = maskCanvas([ch], fs, fs * 1.12, cw, chh);
  return { img: bakeCore(mcv), w: cw, h: chh };
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!n) return null;

  /* 竖排：一栏的字数由栏高定，超了就从右往左换栏 */
  let fs = Math.max(46, Math.min(124, H * 0.108, W * 0.085));
  let adv = fs * 1.20;
  let perCol = Math.max(3, Math.floor((H * 0.70) / adv));
  let cols = Math.ceil(n / perCol);
  if (cols > 4) { cols = 4; perCol = Math.ceil(n / 4); adv = Math.min(adv, (H * 0.86) / perCol); fs = Math.min(fs, adv / 1.20); }
  const colGap = adv * 1.42;

  const cache = new Map();
  const cells = [];
  const blockTop = H * 0.5 - (Math.min(perCol, n) * adv) / 2 + adv * 0.02;
  const xRight = W * 0.5 + ((cols - 1) * colGap) / 2;
  for (let k = 0; k < n; k++) {
    const ch = chars[k];
    let g = cache.get(ch);
    if (!g) { g = bakeCell(ch, fs); cache.set(ch, g); }
    const col = Math.floor(k / perCol);
    const row = k - col * perCol;
    cells.push({
      g: g,
      x: xRight - col * colGap,
      y: blockTop + row * adv,
      tOn: onsetOf(line, k, n),
      on: 0, imp: 0, age: 0,
      col: col, row: row
    });
  }
  return { cells, fs, adv, colGap, cols, perCol, blockTop, xRight, text: line.text };
}

function mechCommit() { landedN = 0; }
function mechSeek() { landedN = 0; }

function mechUpdate(dt, time) {
  if (!cur) return;
  const cs = cur.cells;
  let c0 = 0;
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k];
    if (!c.on && time >= c.tOn) { c.on = 1; c.imp = 1; c.age = 0; }
    c.imp *= Math.exp(-dt * 7.5);
    if (c.on) { c.age += dt; c0++; }
  }
  landedN = c0;
  nCols = cur.cols;
  nCells = cs.length;
}

function mechDraw(T) {
  if (!cur) return;
  const cs = cur.cells, n = cs.length;
  const amp = RM ? 0.30 : 1;
  const fs = cur.fs, adv = cur.adv;

  /* ---- 界栏：每栏右边一条细线（右起竖排的栏界） ---- */
  const top = cur.blockTop - adv * 0.60;
  const colH = Math.min(cur.perCol, n) * adv + adv * 0.20;
  for (let c = 0; c < cur.cols; c++) {
    const x = cur.xRight - c * cur.colGap;
    const w = Math.max(1, Math.min(cur.perCol, n - c * cur.perCol)) * adv;
    ctx.strokeStyle = rgba(ACC, c === 0 ? 0.24 : 0.13);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + cur.colGap * 0.5 + 0.5, top);
    ctx.lineTo(x + cur.colGap * 0.5 + 0.5, top + w + adv * 0.1);
    ctx.stroke();
    /* 栏号 */
    ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
    ctx.fillStyle = rgba(ACC, 0.20);
    ctx.textAlign = 'center';
    ctx.fillText('C' + (c + 1), x + cur.colGap * 0.5, top - 8);
  }
  ctx.textAlign = 'left';

  /* ---- 格：每个字一个竖排字面框（还没落字的格子只有格线） ---- */
  for (let k = 0; k < n; k++) {
    const c = cs[k];
    const half = fs * 0.52;
    ctx.strokeStyle = rgba(ACC, c.on ? 0.08 : 0.17);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.x - half + 0.5, c.y - half);
    ctx.lineTo(c.x + half - 0.5, c.y - half);
    ctx.lineTo(c.x + half - 0.5, c.y + half);
    ctx.lineTo(c.x - half + 0.5, c.y + half);
    ctx.closePath();
    ctx.stroke();
    if (!c.on) {
      /* 未落字的格子：四个角上的小记号（活字的空位） */
      ctx.strokeStyle = rgba(ACC, 0.20);
      const q = half * 0.30;
      ctx.beginPath();
      ctx.moveTo(c.x - half, c.y - half + q); ctx.lineTo(c.x - half, c.y - half); ctx.lineTo(c.x - half + q, c.y - half);
      ctx.moveTo(c.x + half - q, c.y + half); ctx.lineTo(c.x + half, c.y + half); ctx.lineTo(c.x + half, c.y + half - q);
      ctx.stroke();
    }
  }

  /* ---- 字：已落字的满墨，未落字的残影（保证整句读得出来） ---- */
  for (let k = 0; k < n; k++) {
    const c = cs[k];
    /* 行气：一道很慢的纵向亮度波顺栏而下 */
    const wave = 0.5 + 0.5 * Math.sin((c.y / (H || 1)) * 5.4 - T * 0.62 * amp);
    const bright = c.on ? (0.80 + 0.20 * wave * amp) : 0;
    const ghost = c.on ? 0 : 0.20 + 0.04 * wave;
    const al = Math.max(bright, ghost);
    /* 落字瞬间：压一下（上下一收一张），落完再松 */
    const sq = c.imp * 0.055;
    const sc = 1 + c.imp * 0.012;
    ctx.save();
    ctx.translate(c.x, c.y + (c.on ? Math.sin(c.y * 0.03 + T * 0.9) * 0.5 * amp : 0));
    ctx.scale(sc + sq, sc - sq);
    ctx.globalAlpha = al;
    const g = c.g;
    ctx.drawImage(g.img, -g.w / 2, -g.h / 2, g.w, g.h);
    ctx.restore();

    /* 落字那一瞬的压印线（0.24s 内可见） */
    if (c.on && c.age < 0.24) {
      const u = c.age / 0.24;
      ctx.globalAlpha = (1 - u) * 0.45;
      ctx.strokeStyle = rgba(ACC, 1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x - fs * 0.62, c.y + fs * 0.50 + 0.5);
      ctx.lineTo(c.x + fs * 0.62, c.y + fs * 0.50 + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /* ---- 版心：竖排的"心"（两条很淡的竖线 + 天头地脚） ---- */
  const bx0 = cur.xRight - (cur.cols - 1) * cur.colGap - fs * 0.98;
  const bx1 = cur.xRight + fs * 0.98;
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx0 + 0.5, top + 0.5, bx1 - bx0, colH + adv * 0.1);

  /* ---- 读数 ---- */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'left';
  ctx.fillText('TB-RL  ' + landedN + '/' + n + ' 落位', bx0, top + colH + adv * 0.42);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('COL ' + cur.cols + '  CH/COL ' + cur.perCol + '  FS ' + Math.round(fs), bx0, top + colH + adv * 0.42 + 13);
}

/* 无歌词：三栏空格 + 界栏，一道行气波顺栏而下 */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  const fs = Math.max(46, Math.min(112, H * 0.10));
  const adv = fs * 1.20;
  const cols = 3, perCol = Math.max(3, Math.floor((H * 0.62) / adv));
  const colGap = adv * 1.42;
  const xRight = cx + ((cols - 1) * colGap) / 2;
  const top = cy - (perCol * adv) / 2;
  for (let c = 0; c < cols; c++) {
    const x = xRight - c * colGap;
    ctx.strokeStyle = rgba(ACC, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + colGap * 0.5 + 0.5, top);
    ctx.lineTo(x + colGap * 0.5 + 0.5, top + perCol * adv);
    ctx.stroke();
    for (let r = 0; r < perCol; r++) {
      const y = top + r * adv + adv * 0.5;
      const on = 0.5 + 0.5 * Math.sin((y / (H || 1)) * 5.4 - T * 0.62);
      ctx.strokeStyle = rgba(ACC, 0.05 + 0.10 * on);
      const half = fs * 0.52;
      ctx.beginPath();
      ctx.moveTo(x - half + 0.5, y - half);
      ctx.lineTo(x + half - 0.5, y - half);
      ctx.lineTo(x + half - 0.5, y + half);
      ctx.lineTo(x - half + 0.5, y + half);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function mechStats() {
  return {
    rmAmp: RM ? 0.3 : 1, cols: nCols, cells: nCells, landed: landedN };
}
