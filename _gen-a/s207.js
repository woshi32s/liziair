/* ---------------------------------------------------------------------------
   207 · 机制实现：铅字块堆叠（把字切成水平铅条，每条有厚度、有顶面）
   ------------------------------------------------------------------------- */
META = {
  label: 'LETTERPRESS / SLAB STACK',
  sub: '字被切成水平铅条 · 逐条升起',
  right: 'DEPTH 6',
  footer: 'SLABS 09',
  grid: 0.014,
  grain: 0.055,
  cross: true
};

const DX = 5, DY = 5;          /* 铅条的挤出方向（右上） */

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 12);
  const fs = fitFont(rows, W * 0.78, Math.min(176, H * 0.175));
  const lh = fs * 1.16;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.20);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const data = mcv.getContext('2d').getImageData(0, 0, mcv.width, mcv.height).data;
  const W2 = mcv.width, H2 = mcv.height;

  /* 水平铅条：每条取 2 个采样行的并集（一条线扫过去，斜笔会断，取两行才连得上） */
  const band = Math.max(7, Math.round(fs * 0.082));
  const slabs = [];
  for (let y0 = 0; y0 < chh; y0 += band) {
    const y1 = Math.min(chh, y0 + band);
    const runs = [];
    const sample = [];
    for (let s = 0; s < 2; s++) sample.push(Math.min(H2 - 1, Math.round((y0 + (y1 - y0) * (s + 1) / 3) * SS)));
    for (let si = 0; si < sample.length; si++) {
      const sy = sample[si];
      let inside = false, start = 0;
      for (let x = 0; x < W2; x++) {
        const on = data[(sy * W2 + x) * 4 + 3] > 110;
        if (on && !inside) { inside = true; start = x; }
        else if (!on && inside) { inside = false; runs.push([start / SS, x / SS]); }
      }
      if (inside) runs.push([start / SS, W2 / SS]);
    }
    if (!runs.length) { slabs.push({ y0, y1, runs: [] }); continue; }
    runs.sort((a, b) => a[0] - b[0]);
    const merged = [runs[0]];
    for (let k = 1; k < runs.length; k++) {
      const last = merged[merged.length - 1];
      if (runs[k][0] <= last[1] + 1.0) last[1] = Math.max(last[1], runs[k][1]);
      else merged.push(runs[k]);
    }
    /* 每段左右各收 0.5px：字与字之间必须留一道缝，否则整行糊成一条 */
    for (let k = 0; k < merged.length; k++) {
      merged[k][0] += 0.5;
      merged[k][1] -= 0.5;
    }
    slabs.push({ y0, y1, runs: merged.filter((r) => r[1] - r[0] > 0.6) });
  }
  return { cw, chh, fs, rows, slabs, band };
}

function mechCommit() { settle = 1; }
function mechSeek() { settle = 0; }
let settle = 0;
function mechUpdate(dt) { settle *= Math.exp(-dt * 2.0); }

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H / 2;
  const age = T - lineAt;
  const amp = RM ? 0.35 : 1;
  const x0 = cx - cur.cw / 2;
  const y0 = cy - cur.chh / 2;
  const sink = settle * 4 + kick * 5;       /* 压印：整叠往下沉一点 */
  const nS = cur.slabs.length;

  /* 字盘：两条托条，告诉眼睛这是"一叠" */
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 26, y0 + cur.chh + 16.5);
  ctx.lineTo(x0 + cur.cw + 26, y0 + cur.chh + 16.5);
  ctx.stroke();

  /* 入场几何先算好：每条一份 slide / sy / sh */
  const geo = [];
  for (let si = 0; si < nS; si++) {
    const s = cur.slabs[si];
    const ent = Math.min(1, Math.max(0, (age - si * 0.028) / 0.46));
    const e = 1 - Math.pow(1 - ent, 3);
    geo.push({
      s: s, e: e,
      slide: (1 - e) * (si % 2 ? 58 : -58),
      sy: y0 + s.y0 + sink + (1 - e) * 8,
      sh: Math.max(1, s.y1 - s.y0)
    });
  }

  /* ① 先画所有挤出面（顶面 + 右侧面）—— 它们长在字的外面，应该压在字的下面 */
  for (let q = 0; q < geo.length; q++) {
    const G = geo[q];
    if (!G.s.runs.length) continue;
    for (let k = 0; k < G.s.runs.length; k++) {
      const rx0 = x0 + G.s.runs[k][0] + G.slide;
      const rx1 = x0 + G.s.runs[k][1] + G.slide;
      if (rx1 - rx0 < 0.6) continue;
      /* 顶面（向上一档，主色提亮） */
      ctx.fillStyle = rgba(mixc(ACC, [255, 255, 255], 0.42), 0.42);
      ctx.beginPath();
      ctx.moveTo(rx0, G.sy);
      ctx.lineTo(rx1, G.sy);
      ctx.lineTo(rx1 + DX, G.sy - DY);
      ctx.lineTo(rx0 + DX, G.sy - DY);
      ctx.closePath();
      ctx.fill();
      /* 右侧面（更暗） */
      ctx.fillStyle = rgba(mixc(ACC, [4, 8, 12], 0.62), 0.70);
      ctx.beginPath();
      ctx.moveTo(rx1, G.sy);
      ctx.lineTo(rx1, G.sy + G.sh);
      ctx.lineTo(rx1 + DX, G.sy + G.sh - DY);
      ctx.lineTo(rx1 + DX, G.sy - DY);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ② 再画所有正面：字面永远干净，缝不会被邻居的侧面糊住 */
  for (let q = 0; q < geo.length; q++) {
    const G = geo[q];
    if (!G.s.runs.length) continue;
    /* 一条铅条一个渐变（同一层的顶底一样），不是每段建一次 */
    const g = ctx.createLinearGradient(0, G.sy, 0, G.sy + G.sh);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#eef8fc');
    g.addColorStop(1, '#cfe4ee');
    ctx.fillStyle = g;
    for (let k = 0; k < G.s.runs.length; k++) {
      const rx0 = x0 + G.s.runs[k][0] + G.slide;
      const rx1 = x0 + G.s.runs[k][1] + G.slide;
      const w = rx1 - rx0;
      if (w < 0.6) continue;
      ctx.fillRect(rx0, G.sy, w, G.sh);
      /* 条与条之间一道极细的暗缝（堆叠感的关键） */
      ctx.fillStyle = 'rgba(4,8,12,0.55)';
      ctx.fillRect(rx0, G.sy + G.sh - 1, w, 1);
      ctx.fillStyle = g;
    }
  }

  /* 每一叠的厚度读数（最右侧） */
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.26);
  ctx.textAlign = 'left';
  ctx.fillText('SLAB ' + cur.band + 'px × ' + nS, x0 + cur.cw + 40, y0 + 4);
  ctx.fillStyle = rgba(ACC, 0.14);
  ctx.fillText('DEPTH ' + DX + ' / ' + DY, x0 + cur.cw + 40, y0 + 17);
}

/* 无歌词：一叠空白铅条在升降 */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  const n = 11, bw = 300, bh = 14, gap = 7;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(T * 1.1 - i * 0.42);
    const x = cx - bw / 2 + wave * 8;
    const y = cy - (n * (bh + gap)) / 2 + i * (bh + gap) + wave * 3;
    ctx.fillStyle = rgba(mixc(ACC, [255, 255, 255], 0.42), 0.30);
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = rgba(mixc(ACC, [4, 8, 12], 0.55), 0.8);
    ctx.beginPath();
    ctx.moveTo(x + bw, y); ctx.lineTo(x + bw, y + bh);
    ctx.lineTo(x + bw + DX, y + bh - DY); ctx.lineTo(x + bw + DX, y - DY);
    ctx.closePath();
    ctx.fill();
  }
}

function mechStats() {
  return {
    rmAmp: RM ? 0.35 : 1, slabs: cur ? cur.slabs.length : 0, band: cur ? cur.band : 0 };
}
