/*! title: 网格坍缩
    ----------------------------------------------------------------------------
    机制一句话：字被量化到一张**方格网**上，而这格子的边长在 1 秒里**跳着**坍缩 ——
    28 → 20 → 14 → 10 → 7px，每跳一格就重新取一次样（不是把图缩小，是重算覆盖率），
    于是同一句话从"大色块"一路变清楚；格与格之间留着按格宽算出的缝，粗的时候是网点、
    细的时候是字。

    与已有形态的边界：203 是 45° 半调网屏（点径随墨量、后面还有套印）；
    这里没有点、没有角度 —— 是**像素网格的边长在离散地跳**，网格线本身在动。

    做精的地方：
      ① 5 个等级各自烘一套 Path2D（按覆盖率分 3 档），每帧只 fill 三次，不逐格画；
      ② 缝宽 = 格子边长 × 0.14，所以粗的时候是网点阵、细的时候几乎连成字；
      ③ 左侧是"格子边长阶梯"，当前一级亮着；底部读格数 / 落墨格数；
      ④ 踩拍时整张网往里缩一下再弹回（网格自己在呼吸）；
      ⑤ 无歌词：一张空网在坍缩 / 展开。
    ========================================================================== */

META = {
  label: 'GRID COLLAPSE / RESAMPLE',
  sub: '方格网从 28px 跳到 7px · 每一级重新取样',
  right: 'LADDER 28·20·14·10·7',
  footer: 'COARSE → FINE',
  grid: 0,
  grain: 0.05,
  cross: true
};

const GC_L = [28, 20, 14, 10, 7];
let gcLv = 0, gcPop = 0;

function gcClamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function gcBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 9);
  const fs = fitFont(rows, W * 0.76, Math.min(184, H * 0.20));
  const lh = fs * 1.12;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.24);
  const chh = Math.ceil(rows.length * lh) + Math.ceil(fs * 0.08);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const gw = mcv.width, gh = mcv.height;
  const data = mcv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, gw, gh).data;
  const ink = new Uint8Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) ink[k] = data[k * 4 + 3] > 80 ? 1 : 0;

  const levels = [];
  for (let L = 0; L < GC_L.length; L++) {
    const cell = GC_L[L];
    const nx = Math.ceil(cw / cell), ny = Math.ceil(chh / cell);
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const gap = cell * 0.14;
    let inked = 0;
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < nx; gx++) {
        /* 3×3 采样估覆盖率（比逐像素求和快一个数量级，视觉上够用） */
        let hit = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const px = ((gx + (sx + 0.5) / 4) * cell * SS) | 0;
            const py = ((gy + (sy + 0.5) / 4) * cell * SS) | 0;
            if (px < gw && py < gh && ink[py * gw + px]) hit++;
          }
        }
        if (hit === 0) continue;
        inked++;
        const cov = hit / 16;
        const p = paths[cov > 0.62 ? 0 : cov > 0.28 ? 1 : 2];
        p.rect(gx * cell + gap * 0.5, gy * cell + gap * 0.5, cell - gap, cell - gap);
      }
    }
    levels.push({ cell: cell, nx: nx, ny: ny, paths: paths, inked: inked });
  }
  return { cw: cw, chh: chh, fs: fs, levels: levels, rows: rows };
}

function mechBuild(i) { return gcBuild(i); }
function mechCommit() { gcLv = 0; gcPop = 0; }
function mechSeek() { gcLv = 0; gcPop = 0; }

function mechUpdate(dt, time) {
  const age = Math.max(0, time - lineAt);
  /* 每 0.20s 跳一级 —— 离散地"落格"，不是平滑缩放 */
  const lv = Math.floor((age - 0.06) / 0.20);
  gcLv = lv < 0 ? 0 : lv > GC_L.length - 1 ? GC_L.length - 1 : lv;
  if (dt > 0) gcPop = gcPop * Math.exp(-dt * 6) + kick * 0.5;   /* dt=0（暂停）时绝不能累积 */
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const x0 = cx - cur.cw / 2, y0 = cy - cur.chh / 2;
  const amp = RM ? 0.4 : 1;
  const lvI = gcLv;
  const lv = cur.levels[lvI];
  const pop = gcPop * amp;
  const shrink = 1 - 0.16 * pop;             /* 踩拍时整张网往里缩 */

  /* ① 网格线（当前等级）*/
  ctx.strokeStyle = rgba(ACC, 0.075);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 1; gx < lv.nx; gx++) {
    const x = x0 + gx * lv.cell;
    ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y0 + cur.chh);
  }
  for (let gy = 1; gy < lv.ny; gy++) {
    const y = y0 + gy * lv.cell;
    ctx.moveTo(x0, y + 0.5); ctx.lineTo(x0 + cur.cw, y + 0.5);
  }
  ctx.stroke();

  /* ② 三级覆盖率各自一次 fill */
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(shrink, shrink);
  ctx.translate(-cx, -cy);
  const alphas = [0.98, 0.84, 0.56];
  for (let b = 0; b < 3; b++) {
    ctx.fillStyle = b === 0
      ? 'rgba(248,253,255,0.96)'
      : rgba(mixc(ACC, [235, 246, 252], 0.55), alphas[b]);
    ctx.translate(x0, y0);
    ctx.fill(lv.paths[b]);
    ctx.translate(-x0, -y0);
  }
  ctx.restore();

  /* ③ 版心 + 外框（网格的边界）*/
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.beginPath();
  ctx.moveTo(x0 - 10, y0 - 10); ctx.lineTo(x0 + cur.cw + 10, y0 - 10);
  ctx.lineTo(x0 + cur.cw + 10, y0 + cur.chh + 10);
  ctx.lineTo(x0 - 10, y0 + cur.chh + 10); ctx.closePath();
  ctx.stroke();

  /* ④ 左侧"格子边长阶梯" */
  const sx = x0 - 40;
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'right';
  for (let q = 0; q < GC_L.length; q++) {
    const yy = y0 + 6 + q * 15;
    const act = q === lvI;
    ctx.fillStyle = rgba(ACC, act ? 0.85 : 0.20);
    ctx.fillRect(sx - 3, yy - 3, 3, 3);
    ctx.fillStyle = rgba(ACC, act ? 0.85 : 0.24);
    ctx.fillText(String(GC_L[q]), sx - 9, yy + 3);
    if (act) {
      ctx.strokeStyle = rgba(ACC, 0.55);
      ctx.beginPath();
      ctx.moveTo(sx - 30, yy + 0.5); ctx.lineTo(sx - 24, yy + 0.5);
      ctx.stroke();
    }
  }

  /* ⑤ 仪表 */
  ctx.textAlign = 'left';
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  const by = y0 + cur.chh + 40;
  ctx.fillText('CELL ' + lv.cell + 'px   GRID ' + lv.nx + '×' + lv.ny +
    '   INK ' + lv.inked + ' cells', x0, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('STEP ' + (lvI + 1) + '/' + GC_L.length + '   GAP ' + (lv.cell * 0.14).toFixed(1) + 'px   SET ' + Math.round(cur.fs) + 'px', x0, by + 13);
}

/* 无歌词：一张空网反复坍缩 / 展开 */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  const span = Math.min(W * 0.62, 780);
  const ph = (T * 0.22) % 1;
  const ladder = [26, 19, 14, 10, 7];
  const cell = ladder[Math.min(ladder.length - 1, Math.floor(ph * ladder.length))];
  const nx = Math.floor(span / cell), ny = Math.floor(span * 0.34 / cell);
  const x0 = cx - (nx * cell) / 2, y0 = cy - (ny * cell) / 2;
  const gap = cell * 0.14;
  ctx.fillStyle = rgba(ACC, 0.12);
  ctx.beginPath();
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const w = 1 - Math.abs((gx + 0.5) / nx - 0.5) * 1.7;
      if (w <= 0.05) continue;
      ctx.rect(x0 + gx * cell + gap / 2, y0 + gy * cell + gap / 2, cell - gap, cell - gap);
    }
  }
  ctx.fill();
  ctx.strokeStyle = rgba(ACC, 0.18);
  ctx.strokeRect(x0 - 10.5, y0 - 10.5, nx * cell + 21, ny * cell + 21);
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY GRID ' + cell + 'px', x0, y0 + ny * cell + 30);
}

function mechStats() {
  return { cell: cur ? cur.levels[gcLv].cell : 0, level: gcLv + 1, rmAmp: RM ? 0.4 : 1 };
}
