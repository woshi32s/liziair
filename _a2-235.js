/*! title: 活字过秤
    ----------------------------------------------------------------------------
    机制一句话：每个字先被**称一次墨量**（把单字烘成遮罩、数它的着墨面积率），
    整句一开始按**从重到轻**排好（像把一副活字按分量摊在台面上），唱的次序一到，
    字就滑回它在这句话里的位置；字下面一排墨量柱是**量出来的**，不是画上去的。

    与已有形态的边界：202 是字重轴（把字加粗）；206 是字距弹簧；204 是排版坍缩。
    这里字**一个像素都不变**，变的是**次序** —— 按测出来的墨量重排，再按句子复位。

    做精的地方：
      ① 墨量是烘完遮罩后数 alpha 得到的（0~100%），柱高与读数同源；
      ② 重排用的是稳定排序，同重的字保持原次序，不会乱跳；
      ③ 每个字有"在台面上"和"在该在的位置"两套坐标，按句内时刻滑动；
      ④ 柱底下有一条平均值虚线和一条 0~100% 的刻度轴；
      ⑤ 无歌词：一排柱子在起伏，一根"秤"的游标在走。
    ========================================================================== */

META = {
  label: 'TYPE WEIGH-IN / INK MASS',
  sub: '每个字称一次墨量 · 由重到轻摊开再复位',
  right: 'SORT BY MASS',
  footer: 'WEIGH · SORT · RESET',
  grid: 0.01,
  grain: 0.045,
  cross: true
};

const isSmooth = (v) => { const x = v < 0 ? 0 : v > 1 ? 1 : v; return x * x * (3 - 2 * x); };

function isBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!n) return null;
  const fs = Math.max(22, Math.min(150, (W * 0.74) / n, H * 0.19));
  const pad = Math.ceil(fs * 0.10);
  const cells = [];
  for (let k = 0; k < n; k++) {
    const ch = chars[k];
    const adv = Math.max(1, measureRows([ch], fs));
    const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.30) + pad * 2;
    const m = maskCanvas([ch], fs, fs * 1.30, cw, chh);
    /* 称墨：数遮罩的 alpha */
    const d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, m.width, m.height).data;
    let sum = 0;
    for (let q = 3; q < d.length; q += 4) sum += d[q];
    const mass = sum / (255 * m.width * m.height);       /* 着墨面积率 */
    cells.push({ img: bakeCore(m), w: cw, h: chh, adv: adv, mass: mass, ch: ch });
  }
  /* 句子里的位置 */
  let total = 0;
  for (let k = 0; k < n; k++) total += cells[k].adv;
  const slots = [];
  let ax = W / 2 - total / 2;
  for (let k = 0; k < n; k++) { slots.push({ x: ax + cells[k].adv / 2, adv: cells[k].adv }); ax += cells[k].adv; }
  /* 按墨量从重到轻（稳定） */
  const order = [];
  for (let k = 0; k < n; k++) order.push(k);
  order.sort((a, b) => (cells[b].mass - cells[a].mass) || (a - b));
  /* 台面上的位置：重排后的次序，用同样的字距 */
  const rack = [];
  let rx = W / 2 - total / 2;
  for (let q = 0; q < n; q++) {
    const k = order[q];
    rack[k] = { x: rx + cells[k].adv / 2 };
    rx += cells[k].adv;
  }
  const ons = [];
  for (let k = 0; k < n; k++) ons.push(onsetOf(line, k, n));
  let avg = 0, mx = 0, mn = 1;
  for (let k = 0; k < n; k++) {
    avg += cells[k].mass;
    if (cells[k].mass > mx) mx = cells[k].mass;
    if (cells[k].mass < mn) mn = cells[k].mass;
  }
  avg /= n;
  return {
    cells: cells, n: n, slots: slots, rack: rack, order: order, ons: ons,
    total: total, avg: avg, mx: mx, mn: mn, fs: fs, text: line.text
  };
}

function mechBuild(i) { return isBuild(i); }
function mechCommit() { }
function mechSeek() { }

/* 柱高：把本句的墨量区间归一化到 0.22~1.0（只把差别拉开看得见，不改变排序；
   柱下读的仍是真实百分比） */
function isNorm(m) {
  if (!cur) return 0.2;
  const span = cur.mx - cur.mn;
  const v = span > 1e-4 ? (m - cur.mn) / span : 0.5;
  return 0.22 + 0.78 * v;
}

function mechDraw(T) {
  if (!cur) return;
  const age = T - lineAt;
  const cy = H * 0.395;
  const n = cur.n;
  const amp = RM ? 0.4 : 1;
  const bw = Math.min(22, (W * 0.60) / n * 0.46);      /* 柱宽 */
  const barBase = H * 0.615;
  const barMax = Math.min(112, H * 0.13);

  /* ① 刻度轴 + 平均线（墨量的量具） */
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let q = 0; q <= 4; q++) {
    const y = barBase - barMax * (q / 4);
    ctx.moveTo(W / 2 - cur.total / 2 - 30, y + 0.5);
    ctx.lineTo(W / 2 + cur.total / 2 + 30, y + 0.5);
  }
  ctx.stroke();
  ctx.font = '500 7px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.22);
  ctx.textAlign = 'right';
  for (let q = 0; q <= 4; q++) {
    const y = barBase - barMax * (q / 4);
    if (q === 4) ctx.fillText('MASS', W / 2 - cur.total / 2 - 36, y + 2.5);
  }
  const avgY = barBase - barMax * isNorm(cur.avg);
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(W / 2 - cur.total / 2 - 30, avgY + 0.5);
  ctx.lineTo(W / 2 + cur.total / 2 + 30, avgY + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.fillText('MEAN', W / 2 + cur.total / 2 + 34, avgY + 2.5);

  /* ② 墨量柱（钉在句子位置上，不跟着字跑） */
  for (let k = 0; k < n; k++) {
    const cell = cur.cells[k];
    const x = cur.slots[k].x;
    const h = barMax * isNorm(cell.mass);
    const heavy = cell.mass >= cur.mx - 1e-6;
    ctx.fillStyle = heavy ? rgba(mixc(ACC, [255, 255, 255], 0.30), 0.90) : rgba(ACC, 0.50);
    ctx.fillRect(x - bw / 2, barBase - h, bw, h);
    /* 柱顶一道亮线 */
    ctx.fillStyle = rgba(mixc(ACC, [255, 255, 255], 0.45), heavy ? 0.95 : 0.4);
    ctx.fillRect(x - bw / 2, barBase - h - 1.4, bw, 1.4);
    /* 读数 */
    ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
    ctx.fillStyle = rgba(ACC, heavy ? 0.62 : 0.26);
    ctx.textAlign = 'center';
    ctx.fillText((cell.mass * 100).toFixed(0), x, barBase + 12);
  }
  /* 轴 */
  ctx.strokeStyle = rgba(ACC, 0.22);
  ctx.beginPath();
  ctx.moveTo(W / 2 - cur.total / 2 - 30, barBase + 0.5);
  ctx.lineTo(W / 2 + cur.total / 2 + 30, barBase + 0.5);
  ctx.stroke();

  /* ③ 字：从"重排台面"滑回句子里的位置 */
  for (let k = 0; k < n; k++) {
    const cell = cur.cells[k];
    const t0 = cur.ons[k] - lineAt;
    const e = isSmooth((age - t0 + 0.10) / 0.55);
    const fromX = cur.rack[k].x, toX = cur.slots[k].x;
    const x = fromX + (toX - fromX) * e;
    /* 滑的中途抬一点，落回时压一下 */
    const lift = -Math.sin(Math.PI * e) * 12 * amp;
    const sc = 0.94 + 0.06 * e;
    const dw = cell.w * sc, dh = cell.h * sc;
    ctx.globalAlpha = 0.55 + 0.45 * e;
    ctx.drawImage(cell.img, x - dw / 2, cy - dh / 2 + lift, dw, dh);
    ctx.globalAlpha = 1;
    /* 起唱的那一字：顶上一个小三角（重量的指针） */
    if (e > 0.05 && e < 0.92) {
      ctx.fillStyle = rgba(ACC, 0.70);
      ctx.beginPath();
      const ty = cy - cur.fs * 0.72 + lift;
      ctx.moveTo(x - 4, ty - 6); ctx.lineTo(x + 4, ty - 6); ctx.lineTo(x, ty);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ④ 仪表 */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.30);
  const by = barBase + 40;
  const b0 = W / 2 - cur.total / 2 - 30;
  ctx.fillText('INK MASS avg ' + (cur.avg * 100).toFixed(0) + '%   MAX ' + (cur.mx * 100).toFixed(0) +
    '%   MIN ' + (cur.mn * 100).toFixed(0) + '%   (柱高按句内区间归一)', b0, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  const ord = cur.order.map((k) => cur.cells[k].ch).join(' ');
  ctx.fillText('MASS ORDER ' + ord, b0, by + 13);
}

/* 无歌词：一排柱子在起伏 + 一根游标 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.52;
  const n = 14, step = 34, bw = 12;
  const x0 = cx - (n * step) / 2 + step / 2;
  const base = cy + 60;
  ctx.strokeStyle = rgba(ACC, 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - (n * step) / 2 - 24, base + 0.5);
  ctx.lineTo(cx + (n * step) / 2 + 24, base + 0.5);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    const h = 40 + 70 * (0.5 + 0.5 * Math.sin(T * 0.9 + i * 0.5));
    ctx.fillStyle = rgba(ACC, 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(T * 0.9 + i * 0.5)));
    ctx.fillRect(x - bw / 2, base - h, bw, h);
    ctx.fillStyle = rgba(ACC, 0.5);
    ctx.fillRect(x - bw / 2, base - h - 1.2, bw, 1.2);
  }
  const cur2 = cx - (n * step) / 2 + ((T * 0.5) % 1) * n * step;
  ctx.strokeStyle = rgba(ACC, 0.55);
  ctx.beginPath();
  ctx.moveTo(cur2 + 0.5, base - 120); ctx.lineTo(cur2 + 0.5, base + 8);
  ctx.stroke();
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY SCALE', cx - (n * step) / 2, base + 30);
}

function mechStats() {
  return {
    order: cur ? cur.order.map((k) => cur.cells[k].ch).join('') : '',
    avgMass: cur ? +(cur.avg * 100).toFixed(0) : 0,
    rmAmp: RM ? 0.4 : 1
  };
}
