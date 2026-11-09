/* ---------------------------------------------------------------------------
   202 · 机制实现：字重轴（400→900）+ 逐字重音波 + 真实字距重排
   ------------------------------------------------------------------------- */
META = {
  label: 'WEIGHT AXIS / WGHT',
  sub: '逐字字重 400→900 · 字距随重音重排',
  right: 'AXIS 05',
  footer: 'WGHT 400—900',
  grid: 0.018,
  grain: 0.05,
  cross: true
};

/* 5 档字重：同一个字用"填充 + 逐渐加粗的描边"模拟可变字重轴 */
const WLEV = [0, 2.2, 4.6, 7.6, 11];
const WNAME = [400, 500, 620, 760, 900];

function bakeCharLevels(ch, fs) {
  const adv = Math.max(1, measureRows([ch], fs, 400));
  const pad = Math.ceil(WLEV[WLEV.length - 1] / 2) + Math.ceil(fs * 0.10);
  const cw = Math.ceil(adv) + pad * 2;
  const chh = Math.ceil(fs * 1.30) + pad * 2;
  const levels = [];
  for (let li = 0; li < WLEV.length; li++) {
    const m = document.createElement('canvas');
    m.width = Math.max(2, Math.ceil(cw * SS));
    m.height = Math.max(2, Math.ceil(chh * SS));
    const g = m.getContext('2d');
    g.setTransform(SS, 0, 0, SS, 0, 0);
    g.font = FONT(300, fs);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(ch, cw / 2, chh / 2);
    if (WLEV[li] > 0) {
      g.lineWidth = WLEV[li];
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = '#fff';
      g.strokeText(ch, cw / 2, chh / 2);
    }
    levels.push({ img: bakeCore(m), w: cw, h: chh });
  }
  return { levels, adv, pad };
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 13);
  const fs = fitFont(rows, W * 0.78, Math.min(150, H * 0.165), 400);
  const cache = new Map();
  const grid = [];
  for (let r = 0; r < rows.length; r++) {
    const chars = Array.from(rows[r]);
    const lineCells = [];
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k];
      let g = cache.get(ch);
      if (!g) { g = bakeCharLevels(ch, fs); cache.set(ch, g); }
      lineCells.push(g);
    }
    grid.push(lineCells);
  }
  return { grid, fs, rowH: Math.round(fs * 1.32) };
}

let wSweep = 0;
let wBase = 0.22;
function mechCommit() { wSweep = -0.35; wBase = 0.22; }
function mechSeek() { }

function mechUpdate(dt, time) {
  /* 重音以很慢的速度从左扫到右，扫完一轮停一下再回来 */
  const cyc = 7.2;
  const ph = (time % cyc) / cyc;
  wSweep = ph < 0.78 ? -0.18 + (ph / 0.78) * 1.36 : 1.18;
  wBase = 0.20 + 0.10 * kick;
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const fs = cur.fs;
  const amp = RM ? 0.35 : 1;
  const nRows = cur.grid.length;
  const startY = cy - (nRows - 1) * cur.rowH * 0.5;
  let wSum = 0, wCnt = 0;

  for (let r = 0; r < nRows; r++) {
    const cells = cur.grid[r];
    const n = cells.length;
    if (!n) continue;
    /* ---- 先算这一行每个字的字重 ---- */
    const wt = new Array(n);
    let sumW = 0, avg = 0;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : (k + 0.5) / n;
      const d = u - wSweep;
      const bump = Math.exp(-(d * d) / (2 * 0.17 * 0.17));
      const t = wBase + (1 - wBase) * bump * amp;
      wt[k] = Math.max(0, Math.min(1, t));
      sumW += wt[k];
    }
    avg = sumW / n;
    wSum += sumW; wCnt += n;

    /* ---- 字重影响侧边距：重的字把邻居顶开一点，整行仍然居中 ---- */
    let total = 0;
    const advs = new Array(n), xs = new Array(n);
    for (let k = 0; k < n; k++) {
      advs[k] = cells[k].adv * (1 + 0.11 * wt[k]);
      total += advs[k];
    }
    const track = (-0.055 + 0.06 * Math.sin(T * 0.45 + r)) * fs * (0.6 + 0.4 * avg);
    total += track * (n - 1);
    let x = cx - total / 2;
    for (let k = 0; k < n; k++) { xs[k] = x + advs[k] / 2; x += advs[k] + track; }

    const y = startY + r * cur.rowH + Math.sin(T * 0.6 + r * 0.9) * 1.2 * amp;

    /* ---- 画字：相邻两档交叉淡入，字重是连续的 ---- */
    for (let k = 0; k < n; k++) {
      const w = wt[k] * (WLEV.length - 1);
      const i0 = Math.min(WLEV.length - 1, Math.floor(w));
      const i1 = Math.min(WLEV.length - 1, i0 + 1);
      const f = w - i0;
      const a = 0.50 + 0.50 * wt[k];
      const g0 = cells[k].levels[i0], g1 = cells[k].levels[i1];
      const yy = y + (wt[k] - 0.5) * 0.6;
      ctx.globalAlpha = a * (1 - f);
      ctx.drawImage(g0.img, xs[k] - g0.w / 2, yy - g0.h / 2, g0.w, g0.h);
      if (f > 0.01) {
        ctx.globalAlpha = a * f;
        ctx.drawImage(g1.img, xs[k] - g1.w / 2, yy - g1.h / 2, g1.w, g1.h);
      }
    }
    ctx.globalAlpha = 1;

    /* ---- 字重谱：每个字头顶一根细刻度，高度 = 字重 ---- */
    const specY = y - fs * 0.80;
    ctx.strokeStyle = rgba(ACC, 0.30);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const h = 2 + wt[k] * 9;
      ctx.moveTo(xs[k] + 0.5, specY + 10 - h);
      ctx.lineTo(xs[k] + 0.5, specY + 10);
    }
    ctx.stroke();
    /* 基线 */
    ctx.strokeStyle = rgba(ACC, 0.10);
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.40, y + fs * 0.56 + 0.5);
    ctx.lineTo(cx + W * 0.40, y + fs * 0.56 + 0.5);
    ctx.stroke();
  }

  /* ---- 底部字重轴：0—1 的标尺 + 移动的读数 ---- */
  const axX = cx - W * 0.20, axW = W * 0.40, axY = Math.min(H - 118, cy + fs * 1.42);
  ctx.strokeStyle = rgba(ACC, 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(axX, axY + 0.5); ctx.lineTo(axX + axW, axY + 0.5);
  for (let t = 0; t <= 4; t++) {
    const x = Math.round(axX + axW * (t / 4)) + 0.5;
    ctx.moveTo(x, axY - (t === 0 || t === 4 ? 5 : 3));
    ctx.lineTo(x, axY + (t === 0 || t === 4 ? 5 : 3));
  }
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.26);
  ctx.textAlign = 'center';
  for (let t = 0; t < WNAME.length; t++) {
    ctx.fillText(String(WNAME[t]), axX + axW * (t / 4), axY + 18);
  }
  /* 波前在轴上的位置 */
  const mx = axX + axW * Math.max(0, Math.min(1, wSweep));
  ctx.fillStyle = rgba(ACC, 0.75);
  ctx.beginPath();
  ctx.moveTo(mx, axY - 9); ctx.lineTo(mx - 3.4, axY - 15); ctx.lineTo(mx + 3.4, axY - 15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(ACC, 0.40);
  ctx.beginPath();
  ctx.moveTo(mx + 0.5, axY - 9); ctx.lineTo(mx + 0.5, axY + 6);
  ctx.stroke();
  ctx.fillStyle = rgba(ACC, 0.35);
  ctx.fillText('WGHT ' + Math.round(400 + 500 * (0.2 + 0.8 * (wCnt ? wSum / wCnt : 0.2))), axX + axW + 68, axY + 3);
  ctx.textAlign = 'left';
}

/* 无歌词：整幅的"字重谱"（一条 400—900 的刻度尺）+ 扫描轴 —— 纯音频时它是一台字重仪 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.52;
  const span = Math.min(W * 0.74, 1120);
  const n = 44, gap = span / (n - 1);
  const sweep = -0.18 + ((T * 0.2) % 1) * 1.36;
  const top = Math.min(H * 0.16, 132);
  /* 谱线 */
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const bump = Math.exp(-((u - sweep) ** 2) / 0.022);
    const h = 5 + top * (0.10 + 0.90 * bump);
    const x = Math.round(cx - span / 2 + k * gap) + 0.5;
    ctx.strokeStyle = rgba(ACC, 0.16 + 0.42 * bump);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, cy + 3);
    ctx.lineTo(x, cy + 3 - h);
    ctx.stroke();
  }
  /* 基线 + 两端刻度（400 / 900） */
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - span / 2 - 16, cy + 3.5);
  ctx.lineTo(cx + span / 2 + 16, cy + 3.5);
  for (let q = 0; q <= 4; q++) {
    const x = cx - span / 2 + span * (q / 4);
    ctx.moveTo(x + 0.5, cy + 3.5);
    ctx.lineTo(x + 0.5, cy + 11.5);
  }
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('400', cx - span / 2 - 16, cy + 22);
  ctx.textAlign = 'right';
  ctx.fillText('900', cx + span / 2 + 16, cy + 22);
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.35 : 1, wlev: WLEV.length, wrow: cur ? cur.grid.length : 0 };
}
