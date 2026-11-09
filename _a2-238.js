/*! title: 绕排避让
    ----------------------------------------------------------------------------
    机制一句话：一图压字 —— 版心里有个圆形的"障碍"，句中的字**真的绕开它**：
    每一行的可用区间由"版心宽减去圆在该行的横向投影"得到，排到障碍前面就跳到
    障碍**另一侧**继续排，一行排满才换行，于是行数会随着障碍的移动变多或变少。

    与已有形态的边界：201 是字阵被波"整体推开"（每行都在、只挪一点）；
    204 是按字号重新断行（没有障碍）；206 是两端对齐的弹簧字距。
    这里的断行**是被一个几何障碍逼出来的**：洞在哪一行，那一行就分成两段。

    做精的地方：
      ① 每帧解一次真实的行分段（圆与行带的交叠），不是把字整体挪开做样子；
      ② 字的位置有一阶跟随，所以障碍移动时字是"让开"而不是瞬移；
      ③ 障碍画成一个环 + 柔和的光晕，环上有四个方向的刻度；
      ④ 版心的左右竖线 + 每行的基线 + 洞的边界虚线，都是可见的排版容器；
      ⑤ 无歌词：一个空版心 + 一个环在里面来回，行的分段线跟着变。
    ========================================================================== */

META = {
  label: 'TEXT WRAP / OBSTACLE',
  sub: '字绕开版心里的圆形障碍 · 真的重新断行',
  right: 'WRAP',
  footer: 'MEASURE − OBSTACLE = LINES',
  grid: 0,
  grain: 0.045,
  cross: true
};

let tfObs = { x: 0, y: 0, r: 0 };
let tfRows = 1;
let tfDt = 0;
const tfPos = [];              /* 每个字的当前显示位置（一阶跟随） */

function tfBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!n) return null;
  const fs = Math.max(18, Math.min(88, (W * 0.56) / Math.max(3, Math.ceil(n / 2)), H * 0.105));
  const pad = Math.ceil(fs * 0.10);
  const cells = [];
  for (let k = 0; k < n; k++) {
    const adv = Math.max(fs * 0.36, measureRows([chars[k]], fs));
    const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.30) + pad * 2;
    const m = maskCanvas([chars[k]], fs, fs * 1.30, cw, chh);
    cells.push({ img: bakeCore(m), w: cw, h: chh, adv: adv, ch: chars[k] });
  }
  return { cells: cells, n: n, fs: fs, text: line.text, lh: fs * 1.42 };
}

function mechBuild(i) { return tfBuild(i); }
function mechCommit() { tfPos.length = 0; }
function mechSeek() { tfPos.length = 0; }

function mechUpdate(dt, time) {
  tfDt = dt;
  if (!cur) return;
  const amp = RM ? 0.4 : 1;
  const r = Math.min(W, H) * (RM ? 0.070 : 0.104);
  /* 障碍在版心里缓慢巡游（跟 T 走，暂停即停） */
  tfObs = {
    x: W / 2 + Math.sin(time * 0.38 + 2.1) * (W * 0.17) * amp,
    y: H * 0.47 + Math.sin(time * 0.57 + 0.8) * (H * 0.055) * amp,
    r: r
  };
}

/* 计算每个字的目标位置：按行贪心，遇到障碍就跨过去 */
function tfLayout() {
  const fs = cur.fs, lh = cur.lh;
  const boxW = W * 0.70;
  const x0 = W / 2 - boxW / 2;
  const ob = tfObs;
  const pad = fs * 0.16;
  const res = [];
  let row = 0, x = 0;
  const maxRow = 4;
  for (let k = 0; k < cur.n; k++) {
    const adv = cur.cells[k].adv;
    for (let guard = 0; guard < 24; guard++) {
      const rowY = H * 0.46 + (row - 0.5) * lh;   /* 两行的块，行 0 在上、行 1 在下 */
      /* 该字要占的区间 [x, x+adv]（版心局部坐标）→ 屏幕 x */
      let sx = x0 + x, ex = sx + adv;
      const dy = Math.abs(rowY - ob.y);
      if (dy < ob.r + fs * 0.55) {
        /* 这一行被圆切到：算出圆在该行的横向占位 */
        const half = Math.sqrt(Math.max(0, (ob.r + pad) * (ob.r + pad) - dy * dy));
        const holeL = ob.x - half, holeR = ob.x + half;
        const overlap = ex > holeL && sx < holeR;
        if (overlap) {
          if (holeR + adv < x0 + boxW) { x = holeR - x0 + fs * 0.10; continue; }  /* 跳到洞的另一侧 */
          row++; x = 0; continue;                                                 /* 右边界放不下就换行 */
        }
      }
      if (ex > x0 + boxW) { row++; x = 0; continue; }                             /* 行满 */
      res.push({ x: sx + adv / 2, y: rowY });
      x += adv;
      break;
    }
    if (res.length <= k) res.push({ x: x0 + x + adv / 2, y: H * 0.46 });
    if (row >= maxRow) { row = maxRow - 1; }
  }
  tfRows = row + 1;
  return res;
}

function mechDraw(T) {
  if (!cur) return;
  const fs = cur.fs, lh = cur.lh;
  const targets = tfLayout();
  const boxW = W * 0.70;
  const x0 = W / 2 - boxW / 2;
  const topY = H * 0.46 - lh * 0.95;
  const botY = H * 0.46 + lh * 0.95;

  /* ① 版心：左右竖线 + 两行基线（块的高度固定为两行，行少了也不塌） */
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 14.5, topY - lh * 0.20); ctx.lineTo(x0 - 14.5, botY + lh * 0.20);
  ctx.moveTo(x0 + boxW + 14.5, topY - lh * 0.20); ctx.lineTo(x0 + boxW + 14.5, botY + lh * 0.20);
  ctx.stroke();
  ctx.strokeStyle = rgba(ACC, 0.08);
  ctx.beginPath();
  for (let r = 0; r < 2; r++) {
    const y = H * 0.46 + (r - 0.5) * lh + fs * 0.5;
    ctx.moveTo(x0, y + 0.5); ctx.lineTo(x0 + boxW, y + 0.5);
  }
  ctx.stroke();

  /* ② 障碍：环 + 光晕 */
  const ob = tfObs;
  const glow = ctx.createRadialGradient(ob.x, ob.y, ob.r * 0.5, ob.x, ob.y, ob.r * 1.9);
  glow.addColorStop(0, rgba(ACC, 0.10));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba(ACC, 0.62);
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;
  /* 四个方向的刻度 */
  ctx.strokeStyle = rgba(ACC, 0.40);
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2;
    ctx.moveTo(ob.x + Math.cos(a) * ob.r, ob.y + Math.sin(a) * ob.r);
    ctx.lineTo(ob.x + Math.cos(a) * (ob.r + 9), ob.y + Math.sin(a) * (ob.r + 9));
  }
  ctx.stroke();
  ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.44);
  ctx.textAlign = 'left';
  ctx.fillText('R ' + Math.round(ob.r), ob.x + ob.r + 12, ob.y + 3);

  /* ③ 字：位置一阶跟随（让开而不是瞬移） */
  for (let k = 0; k < cur.n; k++) {
    const cell = cur.cells[k];
    const tgt = targets[k] || { x: W / 2, y: H * 0.46 };
    if (!tfPos[k]) tfPos[k] = { x: tgt.x, y: tgt.y };
    const p = tfPos[k];
    const ease = 1 - Math.exp(-tfDt * (RM ? 4 : 9));   /* 暂停时不跟随 → 画面冻结 */
    p.x += (tgt.x - p.x) * ease;
    p.y += (tgt.y - p.y) * ease;
    ctx.globalAlpha = 0.94;
    ctx.drawImage(cell.img, p.x - cell.w / 2, p.y - cell.h / 2, cell.w, cell.h);
    ctx.globalAlpha = 1;
  }

  /* ④ 仪表 */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'left';
  const by = botY + lh * 0.42;
  const holeW = Math.round(ob.r * 2);
  ctx.fillText('MEASURE ' + Math.round(boxW) + 'px   OBSTACLE Ø' + holeW + 'px   LINES ' + tfRows +
    '   CHARS ' + cur.n, x0, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('WRAP: x ∈ MEASURE − HOLE(y)   SET ' + Math.round(fs) + 'px   LEAD ' + Math.round(lh - fs) + 'px', x0, by + 13);
}

/* 无歌词：空版心 + 一个环在巡游 */
function mechEmpty(T) {
  const boxW = Math.min(W * 0.70, 900), x0 = W / 2 - boxW / 2;
  const cy = H * 0.46, lh = 92;
  const rows = 3, top = cy - (rows * lh) / 2;
  ctx.strokeStyle = rgba(ACC, 0.18);
  ctx.beginPath();
  ctx.moveTo(x0 - 14.5, top - 20); ctx.lineTo(x0 - 14.5, top + rows * lh + 20);
  ctx.moveTo(x0 + boxW + 14.5, top - 20); ctx.lineTo(x0 + boxW + 14.5, top + rows * lh + 20);
  ctx.stroke();
  ctx.strokeStyle = rgba(ACC, 0.09);
  ctx.beginPath();
  for (let r = 0; r <= rows; r++) { const y = top + r * lh; ctx.moveTo(x0, y + 0.5); ctx.lineTo(x0 + boxW, y + 0.5); }
  ctx.stroke();
  const obx = W / 2 + Math.sin(T * 0.5) * boxW * 0.34;
  const oby = cy + Math.sin(T * 0.7) * lh * 0.5;
  const r = Math.min(W, H) * 0.09;
  ctx.strokeStyle = rgba(ACC, 0.5);
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(obx, oby, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY MEASURE', x0, top + rows * lh + 44);
}

function mechStats() {
  return { rows: tfRows, obsR: Math.round(tfObs.r), rmAmp: RM ? 0.4 : 1 };
}
