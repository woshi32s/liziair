/*! title: 活字盘取字
    ----------------------------------------------------------------------------
    机制一句话：这一句先散在**字盘**的格子里（铅字按部首散放在字盘上），
    排字工人按唱到的顺序一格一格把字**取下来**、推进下面的**排字尺**（composing
    stick）；取走的格子留下空框和编号，尺上的字按自然字宽从中心往两边排开。

    与已有形态的边界：207 是把字切成铅条再挤出；208 是竖排分栏；201 是字阵波；
    这里是**排字工序**本身 —— 同一个字同时存在两种尺寸（盘上的小字 / 尺上的大字），
    在"未取 / 在途 / 已落版"三种状态之间迁移。

    做精的地方：
      ① 字盘 10×4 是真格子，空格编号（A1…D10）留着，取走留一个虚线空框；
      ② 取字走一条抬高再落下的抛物线（0.42s），落定时压一下并在地脚亮一道光；
      ③ 尺有上下规矩线、左右挡块、虚线的地脚线，底部一道"已排"进度；
      ④ 每个字在盘上的位置是固定的散放（k*5+3 取模，撞格顺延），像真的字盘；
      ⑤ 无歌词：空字盘 + 一个游标在格子上巡回。
    ========================================================================== */

META = {
  label: 'TYPE CASE / COMPOSING STICK',
  sub: '字散在字盘里 · 按唱的次序逐格取下排进尺',
  right: 'CASE 8×3',
  footer: 'TAKE · SET · JUSTIFY',
  grid: 0,
  grain: 0.04,
  cross: true
};

const tcSmooth = (v) => { const x = v < 0 ? 0 : v > 1 ? 1 : v; return x * x * (3 - 2 * x); };
const tcClamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TC_COLS = 8, TC_ROWS = 3;

let tcTaken = 0;        /* 已落版的字数（仪表用） */

function tcChar(ch, fs) {
  const adv = Math.max(1, measureRows([ch], fs));
  const pad = Math.ceil(fs * 0.10);
  const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.30) + pad * 2;
  const m = maskCanvas([ch], fs, fs * 1.30, cw, chh);
  return { img: bakeCore(m), w: cw, h: chh, adv: adv };
}

function tcBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!n) return null;

  /* 盘上的小字与尺上的大字是同一批字形，两种尺寸 */
  const fsLine = Math.max(20, Math.min(112, (W * 0.60) / Math.max(1, n), H * 0.155));
  const cells = [];
  const cache = new Map();
  for (let k = 0; k < n; k++) {
    let c = cache.get(chars[k]);
    if (!c) { c = tcChar(chars[k], fsLine); cache.set(chars[k], c); }
    cells.push(c);
  }
  let total = 0;
  for (let k = 0; k < n; k++) total += cells[k].adv;
  const stickW = Math.min(W * 0.80, total + 150);
  const stickX = (W - stickW) / 2;
  const stickY = H * 0.685;
  const slots = [];
  let ax = W / 2 - total / 2;
  for (let k = 0; k < n; k++) { slots.push(ax + cells[k].adv / 2); ax += cells[k].adv; }

  /* 字盘：10×4 格 */
  const caseX = W * 0.085, caseY = H * 0.135;
  const caseW = W * 0.83;
  const caseH = Math.min(H * 0.30, caseW * 0.30);
  const cw = caseW / TC_COLS, chh = caseH / TC_ROWS;
  const nCell = TC_COLS * TC_ROWS;
  const order = [];
  for (let k = 0; k < n; k++) {
    const want = (k * 5 + 3) % nCell;
    let use = -1;
    for (let q = 0; q < nCell; q++) {
      const cand = (want + q) % nCell;
      if (order.indexOf(cand) < 0) { use = cand; break; }
    }
    order.push(use < 0 ? k % nCell : use);
  }
  const casePos = [];
  for (let k = 0; k < n; k++) {
    const idx = order[k];
    const gx = idx % TC_COLS, gy = (idx - gx) / TC_COLS;
    casePos.push({ x: caseX + (gx + 0.5) * cw, y: caseY + (gy + 0.5) * chh, gx: gx, gy: gy });
  }
  const caseScale = Math.min(0.50, (chh * 0.60) / (fsLine * 1.30));
  const ons = [];
  for (let k = 0; k < n; k++) ons.push(onsetOf(line, k, n));
  return {
    cells: cells, n: n, ons: ons, slots: slots, total: total,
    stickX: stickX, stickW: stickW, stickY: stickY,
    caseX: caseX, caseY: caseY, caseW: caseW, caseH: caseH,
    cw: cw, chh: chh, casePos: casePos, caseScale: caseScale,
    fs: fsLine, text: line.text
  };
}

function mechBuild(i) { return tcBuild(i); }
function mechCommit() { tcTaken = 0; }
function mechSeek() { tcTaken = 0; }

function mechUpdate(dt, time) {
  if (!cur) return;
  let k = 0;
  for (let q = 0; q < cur.n; q++) if (time >= cur.ons[q]) k = q + 1;
  tcTaken = k;
}

function mechDraw(T) {
  if (!cur) return;
  const age = T - lineAt;
  const n = cur.n;
  const sy = cur.stickY;
  const halfW = Math.min(30, cur.cw * 0.3), halfH = Math.min(30, cur.chh * 0.34);

  /* ---------------- 字盘 ---------------- */
  /* 盘面：一层极淡的底 + 上缘的一线亮，让它像一只真的木盘 */
  ctx.fillStyle = rgba(ACC, 0.026);
  ctx.fillRect(cur.caseX, cur.caseY, cur.caseW, cur.caseH);
  ctx.fillStyle = rgba(ACC, 0.10);
  ctx.fillRect(cur.caseX, cur.caseY - 1.5, cur.caseW, 1);
  ctx.strokeStyle = rgba(ACC, 0.15);
  ctx.lineWidth = 1;
  ctx.strokeRect(cur.caseX + 0.5, cur.caseY + 0.5, cur.caseW, cur.caseH);
  ctx.strokeStyle = rgba(ACC, 0.075);
  ctx.beginPath();
  for (let c = 1; c < TC_COLS; c++) {
    const x = cur.caseX + c * cur.cw;
    ctx.moveTo(x + 0.5, cur.caseY); ctx.lineTo(x + 0.5, cur.caseY + cur.caseH);
  }
  for (let r = 1; r < TC_ROWS; r++) {
    const y = cur.caseY + r * cur.chh;
    ctx.moveTo(cur.caseX, y + 0.5); ctx.lineTo(cur.caseX + cur.caseW, y + 0.5);
  }
  ctx.stroke();
  /* 四角记号 */
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const cx0 = q & 1 ? cur.caseX + cur.caseW : cur.caseX;
    const cy0 = q & 2 ? cur.caseY + cur.caseH : cur.caseY;
    const dx = q & 1 ? -1 : 1, dy = q & 2 ? -1 : 1;
    ctx.moveTo(cx0 + dx * 8, cy0); ctx.lineTo(cx0, cy0); ctx.lineTo(cx0, cy0 + dy * 8);
  }
  ctx.stroke();

  /* 格号 + 盘上的小字 */
  ctx.font = '500 7px ui-monospace,Consolas,monospace';
  for (let k = 0; k < n; k++) {
    const cell = cur.cells[k], c = cur.casePos[k];
    const u = tcSmooth((age - (cur.ons[k] - lineAt)) / 0.42);
    ctx.fillStyle = rgba(ACC, 0.20);
    ctx.textAlign = 'left';
    const lx = cur.caseX + c.gx * cur.cw + 5, ly = cur.caseY + c.gy * cur.chh + 12;
    ctx.fillText(String.fromCharCode(65 + c.gy) + (c.gx + 1), lx, ly);
    if (u >= 1) {
      /* 取走之后：格子里留一个极淡的"印子"+ 虚线空框 + 取走记号 */
      const s0 = cur.caseScale;
      ctx.globalAlpha = 0.215;
      ctx.drawImage(cell.img, c.x - cell.w * s0 / 2, c.y - cell.h * s0 / 2, cell.w * s0, cell.h * s0);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(ACC, 0.17);
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(c.x - halfW + 0.5, c.y - halfH + 0.5, halfW * 2, halfH * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(ACC, 0.34);
      ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
      continue;
    }
    if (u > 0) {
      ctx.strokeStyle = rgba(ACC, 0.40 * (1 - u));
      ctx.strokeRect(c.x - halfW + 0.5, c.y - halfH + 0.5, halfW * 2, halfH * 2);
    }
    const s = cur.caseScale;
    ctx.globalAlpha = 0.40 + 0.26 * (1 - u);
    ctx.drawImage(cell.img, c.x - cell.w * s / 2, c.y - cell.h * s / 2, cell.w * s, cell.h * s);
    ctx.globalAlpha = 1;
  }
  /* 正在被取的那一格的游标 */
  for (let k = 0; k < n; k++) {
    const u = (age - (cur.ons[k] - lineAt)) / 0.42;
    if (u > -0.16 && u < 0.12) {
      const c = cur.casePos[k];
      ctx.strokeStyle = rgba(ACC, 0.75);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x - 8, c.y - halfH - 6);
      ctx.lineTo(c.x, c.y - halfH - 13);
      ctx.lineTo(c.x + 8, c.y - halfH - 6);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  /* ---------------- 排字尺 ---------------- */
  const rTop = sy - cur.fs * 0.80, rBot = sy + cur.fs * 0.74;
  ctx.strokeStyle = rgba(ACC, 0.28);
  ctx.beginPath();
  ctx.moveTo(cur.stickX, rTop + 0.5); ctx.lineTo(cur.stickX + cur.stickW, rTop + 0.5);
  ctx.moveTo(cur.stickX, rBot + 0.5); ctx.lineTo(cur.stickX + cur.stickW, rBot + 0.5);
  ctx.moveTo(cur.stickX + 0.5, rTop - 7); ctx.lineTo(cur.stickX + 0.5, rBot + 7);
  ctx.moveTo(cur.stickX + cur.stickW - 0.5, rTop - 7); ctx.lineTo(cur.stickX + cur.stickW - 0.5, rBot + 7);
  ctx.stroke();
  /* 地脚线（字的落点） */
  ctx.strokeStyle = rgba(ACC, 0.11);
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(cur.stickX, sy + cur.fs * 0.46 + 0.5); ctx.lineTo(cur.stickX + cur.stickW, sy + cur.fs * 0.46 + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  /* 已排进度 */
  const prog = n ? tcTaken / n : 0;
  ctx.fillStyle = rgba(ACC, 0.50);
  ctx.fillRect(cur.stickX, rBot + 3, cur.stickW * prog, 2);

  /* ---------------- 在途 / 已落版 ---------------- */
  for (let k = 0; k < n; k++) {
    const cell = cur.cells[k], c = cur.casePos[k];
    const t0 = cur.ons[k] - lineAt;
    const u = tcClamp((age - t0) / 0.42);
    const e = tcSmooth(u);
    const s = cur.caseScale + (1 - cur.caseScale) * e;
    const arcY = -76 * Math.sin(Math.PI * e);
    const px = c.x + (cur.slots[k] - c.x) * e;
    const py = c.y + (sy - c.y) * e + arcY;
    const press = u >= 1 ? Math.max(0, 1 - Math.abs(age - (t0 + 0.42)) / 0.18) : 0;
    const dw = cell.w * s, dh = cell.h * s * (1 - press * 0.06);
    ctx.globalAlpha = 0.40 + 0.60 * e;
    ctx.drawImage(cell.img, px - dw / 2, py - dh / 2 + press * 2.5, dw, dh);
    ctx.globalAlpha = 1;
    if (press > 0.04) {
      ctx.fillStyle = rgba(ACC, 0.36 * press);
      ctx.fillRect(px - cell.adv * 0.46, sy + cur.fs * 0.47, cell.adv * 0.92, 1.8);
    }
  }

  /* ---------------- 仪表 ---------------- */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.30);
  const ry = rBot + 26;
  ctx.fillText('TAKEN ' + String(tcTaken).padStart(2, '0') + ' / ' + String(n).padStart(2, '0') +
    '   STICK ' + Math.round(cur.total) + 'px', cur.stickX, ry);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('CASE ' + TC_COLS + '×' + TC_ROWS + '   CELL ' + Math.round(cur.cw) + '×' + Math.round(cur.chh) +
    '   SET ' + Math.round(cur.fs) + 'px', cur.stickX, ry + 13);
}

/* 无歌词：空字盘，一个游标在格子上巡回 */
function mechEmpty(T) {
  const caseX = W * 0.085, caseY = H * 0.26;
  const caseW = W * 0.83;
  const caseH = Math.min(H * 0.30, caseW * 0.30);
  const cw = caseW / TC_COLS, chh = caseH / TC_ROWS;
  ctx.strokeStyle = rgba(ACC, 0.15);
  ctx.lineWidth = 1;
  ctx.strokeRect(caseX + 0.5, caseY + 0.5, caseW, caseH);
  ctx.strokeStyle = rgba(ACC, 0.07);
  ctx.beginPath();
  for (let c = 1; c < TC_COLS; c++) { const x = caseX + c * cw; ctx.moveTo(x + 0.5, caseY); ctx.lineTo(x + 0.5, caseY + caseH); }
  for (let r = 1; r < TC_ROWS; r++) { const y = caseY + r * chh; ctx.moveTo(caseX, y + 0.5); ctx.lineTo(caseX + caseW, y + 0.5); }
  ctx.stroke();
  const t = T * 0.6;
  const idx = Math.floor(t) % (TC_COLS * TC_ROWS);
  const gx = idx % TC_COLS, gy = (idx - gx) / TC_COLS;
  const p = t - Math.floor(t);
  const px = caseX + (gx + 0.5) * cw, py = caseY + (gy + 0.5) * chh;
  ctx.strokeStyle = rgba(ACC, 0.55 * (1 - Math.abs(p - 0.5) * 1.3));
  ctx.strokeRect(px - cw / 2 + 6.5, py - chh / 2 + 6.5, cw - 13, chh - 13);
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY CASE', caseX, caseY + caseH + 30);
  ctx.textAlign = 'left';
}

function mechStats() {
  return { taken: tcTaken, caseCells: cur ? cur.n : 0, rmAmp: RM ? 0.35 : 1 };
}
