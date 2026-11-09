/* ---------------------------------------------------------------------------
   204 · 机制实现：排版坍缩（真的逐帧重排：字号 / 行距 / 字距）
   ------------------------------------------------------------------------- */
META = {
  label: 'TYPE COLLAPSE / ETH',
  sub: '逐帧重排：字号 × 行距 × 字距',
  right: 'REFLOW',
  footer: 'ETH 1.52 → 0.94',
  grid: 0.02,
  grain: 0.05,
  cross: true
};

let collapse = 0;      /* 0 = 舒展，1 = 压到最紧 */
let lineCount = 1;

function bakeChar(ch, fs) {
  const adv = Math.max(1, measureRows([ch], fs));
  const pad = Math.ceil(fs * 0.12);
  const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.32) + pad * 2;
  const mcv = maskCanvas([ch], fs, fs * 1.32, cw, chh);
  return { img: bakeCore(mcv), w: cw, h: chh, adv: adv };
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const base = Math.min(146, H * 0.158);
  const cache = new Map();
  const chars = Array.from(line.text);
  const cells = [];
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k];
    let c = cache.get(ch);
    if (!c) { c = bakeChar(ch, base); cache.set(ch, c); }
    cells.push(c);
  }
  /* 坍缩**之前**的排版：留在画面上的旧基线（对比用），所以字不坍也能看出落差 */
  const n = cells.length;
  const adv0 = base;
  const maxPer0 = Math.max(1, Math.floor((W * 0.76) / adv0));
  const nRows0 = Math.max(1, Math.ceil(n / maxPer0));
  const per0 = Math.ceil(n / nRows0);
  const lh0 = base * 1.52;
  const top0 = H * 0.5 - (nRows0 * lh0) / 2 + lh0 / 2;
  const was = [];
  for (let r = 0; r < nRows0; r++) {
    const cnt = Math.min(per0, n - r * per0);
    was.push({ y: top0 + r * lh0, w: cnt * adv0 });
  }
  return { cells, base, text: line.text, was };
}

function mechCommit() { collapse = 0; }
function mechSeek() { collapse = 0; }
function mechUpdate(dt, time) {
  /* 坍缩：换句后 1.2 秒压到最紧，然后带呼吸的轻微回弹；踩拍再压一下 */
  const age = time - lineAt;
  const push = Math.min(1, Math.max(0, age / 1.15));
  const e = 1 - Math.pow(1 - push, 3);
  const breathe = 0.06 * Math.sin(time * 0.7) + kick * 0.14;
  collapse = Math.max(0, Math.min(1, e * 0.94 + breathe));
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const amp = RM ? 0.4 : 1;
  const c = collapse * (RM ? 0.5 : 1);
  const fs = cur.base * (1 - 0.13 * c);
  const lh = cur.base * (1.52 - 0.58 * c);       /* 行距：1.52 → 0.94 倍字号 */
  const track = fs * (-0.055 * c);               /* 字距：0 → -0.055 em（再紧就叠字了） */
  const maxW = W * 0.76;
  const cells = cur.cells;
  const nAll = cells.length;

  /* ---- 真的重排：逐字量宽、均分断行（行数会从 2 变 1） ---- */
  const adv = fs + track;
  const maxPer = Math.max(1, Math.floor(maxW / adv));
  const nRows = Math.max(1, Math.ceil(nAll / maxPer));
  const per = Math.ceil(nAll / nRows);
  const rows = [];
  for (let s = 0; s < nAll; s += per) {
    const cnt = Math.min(per, nAll - s);
    rows.push({ cells: cells.slice(s, s + cnt), w: cnt * adv - track });
  }
  lineCount = rows.length;

  const top = cy - (rows.length * lh) / 2 + lh / 2;
  const colX = cx - maxW / 2;

  /* 版心：一条竖线 + 刻度，把"重排"的容器显影 */
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(colX - 16.5, cy - rows.length * lh / 2 - 12);
  ctx.lineTo(colX - 16.5, cy + rows.length * lh / 2 + 12);
  ctx.moveTo(colX + maxW + 16.5, cy - rows.length * lh / 2 - 12);
  ctx.lineTo(colX + maxW + 16.5, cy + rows.length * lh / 2 + 12);
  ctx.stroke();
  for (let s = 0; s < 6; s++) {
    const yy = cy - rows.length * lh / 2 - 12 + (rows.length * lh + 24) * (s / 5);
    ctx.beginPath();
    ctx.moveTo(colX - 22, yy + 0.5); ctx.lineTo(colX - 16.5, yy + 0.5);
    ctx.stroke();
  }

  /* ---- 坍缩前的旧基线（1.52 的排版坍缩之前长这样）---- */
  const fade = Math.min(1, Math.max(0, (c - 0.04) / 0.35));
  if (cur.was && fade > 0) {
    ctx.setLineDash([5, 6]);
    for (let r = 0; r < cur.was.length; r++) {
      const gy = cur.was[r].y + cur.base * 0.48;
      ctx.strokeStyle = rgba(ACC, 0.20 * fade);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - cur.was[r].w / 2, gy + 0.5);
      ctx.lineTo(cx + cur.was[r].w / 2, gy + 0.5);
      ctx.stroke();
      /* 旧基线的行号（现在是空的 —— 文字已经离开它了） */
      ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
      ctx.fillStyle = rgba(ACC, 0.22 * fade);
      ctx.textAlign = 'right';
      ctx.fillText('1.52', cx - cur.was[r].w / 2 - 6, gy + 3);
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
  }

  for (let r = 0; r < rows.length; r++) {
    const y = top + r * lh + Math.sin(T * 0.9 + r * 0.7) * 1.4 * amp;
    const rowW = rows[r].w;
    /* 每一行按自己的宽度居中（压得越紧，行越窄，居中的效果越明显） */
    let x = cx - rowW / 2;
    /* 行基线：排版的"骨架"，看得见 */
    ctx.strokeStyle = rgba(ACC, 0.14);
    ctx.beginPath();
    ctx.moveTo(cx - maxW / 2, y + fs * 0.48 + 0.5);
    ctx.lineTo(cx + maxW / 2, y + fs * 0.48 + 0.5);
    ctx.stroke();

    for (let k = 0; k < rows[r].cells.length; k++) {
      const cell = rows[r].cells[k];
      const sc = fs / cur.base;
      const dw = cell.w * sc, dh = cell.h * sc;
      /* 行首/行尾的字略微抬一点（光学对齐），压紧时不至于糊成一坨 */
      ctx.globalAlpha = 0.86 + 0.14 * (1 - c);
      ctx.drawImage(cell.img, x + fs / 2 - dw / 2, y - dh / 2, dw, dh);
      x += fs + track;
    }
    ctx.globalAlpha = 1;
  }

  /* 读数：行距 / 字距 / 行数 —— 排版机的仪表 */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'left';
  const bx = colX - 16, by = cy + rows.length * lh / 2 + 40;
  ctx.fillText('ETH ' + (lh / cur.base).toFixed(2) + '  TRK ' + (track / fs).toFixed(2) + 'em  LINES ' + rows.length, bx, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('SIZE ' + Math.round(fs) + 'px / BASE ' + Math.round(cur.base) + 'px', bx, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一组基线在收放，一个游标在量行距 —— 排版机空转 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.5;
  const c = 0.5 + 0.5 * Math.sin(T * 0.55);
  const lh = 96 * (1.5 - 0.55 * c);
  for (let r = -4; r <= 4; r++) {
    const y = cy + r * lh;
    const w = W * (0.30 + 0.22 * (1 - c)) * (1 - 0.045 * Math.abs(r));
    ctx.strokeStyle = rgba(ACC, 0.18 + 0.10 * (1 - c));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y + 0.5);
    ctx.lineTo(cx + w / 2, y + 0.5);
    ctx.moveTo(cx - w / 2 + 0.5, y - 5); ctx.lineTo(cx - w / 2 + 0.5, y + 5);
    ctx.moveTo(cx + w / 2 - 0.5, y - 5); ctx.lineTo(cx + w / 2 - 0.5, y + 5);
    ctx.stroke();
  }
  /* 行距游标：两行之间量一次 */
  const py = cy + lh * 0.5;
  ctx.strokeStyle = rgba(ACC, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + W * 0.27, cy + 0.5); ctx.lineTo(cx + W * 0.27, py + 0.5);
  ctx.moveTo(cx + W * 0.27 - 4, cy + 0.5); ctx.lineTo(cx + W * 0.27 + 4, cy + 0.5);
  ctx.moveTo(cx + W * 0.27 - 4, py + 0.5); ctx.lineTo(cx + W * 0.27 + 4, py + 0.5);
  ctx.stroke();
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.55);
  ctx.textAlign = 'left';
  ctx.fillText((lh / 96).toFixed(2) + ' em', cx + W * 0.27 + 9, (cy + py) / 2 + 3);
  ctx.fillStyle = rgba(ACC, 0.26);
  ctx.fillText('NO COPY · 纯音频', cx - W * 0.30, cy + lh * 4.5 + 26);
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.4 : 1, collapse: +collapse.toFixed(2), eth: cur ? +(1.52 - 0.58 * collapse).toFixed(2) : 0, rows: lineCount };
}
