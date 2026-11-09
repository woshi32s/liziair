/*! title: 按版心配字
    ----------------------------------------------------------------------------
    机制一句话：这句话的字号不是设好的，是**解出来的** —— 版心宽度跟着音乐呼吸
    （0.50W ↔ 0.72W），每帧拿"版心宽 ÷ 这行的自然宽"反解出一个缩放，于是整句永远
    恰好顶住左右两条版心线（FILL 恒为 100%），音乐一开一合，字就跟着放大缩小。

    与已有形态的边界：204 是版心固定、字号自己收 13% 并**重新断行**（行数会变）；
    这里**永远一行、永远不断行**，变的是版心，字号是被约束解出来的；
    206 变的是字距；202 变的是字重。

    做精的地方：
      ① 版心线（两条竖线 + 上下横线）+ 顶部一把带刻度的"开度尺"，量的是版心本身；
      ② 字身网格（每个字一条竖线）跟着缩放一起动，能看出"格在变、字在填格"；
      ③ FILL 是真算的：字宽 ÷ 版心宽，恒等于 1.000（这就是"配"的含义）；
      ④ 呼吸是慢的（0.5Hz），踩拍再撑开一下；减少动态时幅度减半；
      ⑤ 无歌词：一对版心线在开合，中间是一把空尺。
    ========================================================================== */

META = {
  label: 'FIT TO MEASURE / SOLVED SIZE',
  sub: '版心呼吸 · 字号每帧反解，整句永远顶满',
  right: 'FILL 100%',
  footer: 'MEASURE → SIZE → FILL',
  grid: 0,
  grain: 0.045,
  cross: true
};

let fmOpen = 0.6;         /* 版心开度 0..1（0 = 最窄，1 = 最宽） */
let fmSize = 0;

function fmBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 9);
  /* 只取一行：太长的句子按 9 字断行（极少发生），断行后仍按最宽一行配 */
  const text = line.text;
  const fs0 = Math.min(168, H * 0.20);
  const lh = fs0 * 1.14;
  const cw = Math.ceil(measureRows(rows, fs0)) + Math.ceil(fs0 * 0.10);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs0, lh, cw, chh);
  /* 每个字的宽度（按自然排版量宽），用来画字身网格 */
  const advs = [];
  let acc = 0;
  const chars = Array.from(text);
  for (let k = 0; k < chars.length; k++) {
    const w = measureRows([chars[k]], fs0);
    advs.push({ x: acc, w: w });
    acc += w;
  }
  return { cw: cw, chh: chh, fs0: fs0, core: bakeCore(mcv), advs: advs, text: text, rows: rows };
}

function mechBuild(i) { return fmBuild(i); }
function mechCommit() { fmOpen = 0.42; }
function mechSeek() { fmOpen = 0.42; }

function mechUpdate(dt, time) {
  const age = Math.max(0, time - lineAt);
  const amp = RM ? 0.45 : 1;
  /* 换句后从窄张开，然后按 0.5Hz 呼吸；踩拍再撑一下 */
  const open0 = 0.34 + 0.66 * Math.min(1, Math.max(0, (age - 0.05) / 0.9));
  const br = 0.5 + 0.5 * Math.sin(time * 0.9 + 0.6);
  const target = 0.34 + (0.30 + 0.36 * br * amp + kick * 0.04) * open0;
  /* 一阶跟随，避免目标抖动（dt=0 时不动 → 暂停冻结） */
  if (dt > 0) fmOpen += (Math.min(1, target) - fmOpen) * Math.min(1, dt * 7);
}

function mechDraw(T) {
  if (!cur) return;
  const cy = H * 0.5;
  const cw0 = cur.cw, chh0 = cur.chh;
  const measMin = W * 0.50, measMax = W * 0.74;
  const meas = measMin + (measMax - measMin) * Math.max(0, Math.min(1, fmOpen));
  const sc = meas / cw0;
  const x0 = W / 2 - meas / 2;
  const dh = chh0 * sc;
  const y0 = cy - dh / 2;
  fmSize = cur.fs0 * sc;
  const amp = RM ? 0.5 : 1;

  /* ① 字身网格（每字一条竖线，随缩放一起动） */
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k <= cur.advs.length; k++) {
    const ax = k < cur.advs.length ? cur.advs[k].x : cw0;
    const x = x0 + ax * sc;
    ctx.moveTo(x + 0.5, y0 - 26); ctx.lineTo(x + 0.5, y0 + dh + 26);
  }
  ctx.stroke();

  /* ② 版心：两条竖线 + 上下横线（这是"配"的约束） */
  ctx.strokeStyle = rgba(ACC, 0.60);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 - 38); ctx.lineTo(x0 + 0.5, y0 + dh + 38);
  ctx.moveTo(x0 + meas - 0.5, y0 - 38); ctx.lineTo(x0 + meas - 0.5, y0 + dh + 38);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 38.5); ctx.lineTo(x0 + meas, y0 - 38.5);
  ctx.moveTo(x0, y0 + dh + 38.5); ctx.lineTo(x0 + meas, y0 + dh + 38.5);
  ctx.stroke();

  /* ③ 字 */
  ctx.globalAlpha = 0.96;
  ctx.drawImage(cur.core, x0, y0, meas, dh);
  ctx.globalAlpha = 1;

  /* ④ 顶上的开度尺：量版心本身 */
  const ry = y0 - 58;
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, ry); ctx.lineTo(x0 + meas - 0.5, ry);
  for (let q = 0; q <= 20; q++) {
    const x = x0 + (meas * q) / 20;
    const big = q % 5 === 0;
    ctx.moveTo(x + 0.5, ry - (big ? 6 : 3));
    ctx.lineTo(x + 0.5, ry);
  }
  ctx.stroke();
  /* 尺两端的箭头 + 读数 */
  ctx.fillStyle = rgba(ACC, 0.55);
  ctx.textAlign = 'center';
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillText(Math.round(meas) + 'px', x0 + meas / 2, ry - 12);
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.22);
  ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
  ctx.fillText('MEASURE', x0 + meas + 8, ry + 3);

  /* ⑤ 两端"顶住"的标记：竖线内侧两点 */
  ctx.fillStyle = rgba(ACC, 0.85);
  ctx.fillRect(x0 + 3, y0 + dh / 2 - 1, 2.4, 2.4);
  ctx.fillRect(x0 + meas - 5.4, y0 + dh / 2 - 1, 2.4, 2.4);

  /* ⑥ 仪表 */
  ctx.textAlign = 'left';
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.32);
  const by = y0 + dh + 58;
  const fillPct = (meas / (cw0 * sc)) * 100;
  ctx.fillText('MEASURE ' + Math.round(meas) + 'px   SET ' + fmSize.toFixed(1) + 'px   ' +
    'FILL ' + fillPct.toFixed(1) + '%   OPEN ' + Math.round(fmOpen * 100) + '%', x0, by);
  ctx.fillStyle = rgba(ACC, 0.17);
  ctx.fillText('SOLVED: SIZE = MEASURE ÷ NATURAL(' + Math.round(cw0) + 'px @ ' + Math.round(cur.fs0) + 'px)   ' +
    'SCALE ' + sc.toFixed(3), x0, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一对版心线在开合，中间是一把空尺 */
function mechEmpty(T) {
  const cy = H / 2;
  const open = 0.5 + 0.5 * Math.sin(T * 0.6);
  const meas = W * (0.34 + 0.34 * open);
  const x0 = W / 2 - meas / 2;
  const h = Math.min(H * 0.26, 220);
  ctx.strokeStyle = rgba(ACC, 0.5);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, cy - h / 2); ctx.lineTo(x0 + 0.5, cy + h / 2);
  ctx.moveTo(x0 + meas - 0.5, cy - h / 2); ctx.lineTo(x0 + meas - 0.5, cy + h / 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.beginPath();
  ctx.moveTo(x0, cy - h / 2 - 0.5); ctx.lineTo(x0 + meas, cy - h / 2 - 0.5);
  ctx.moveTo(x0, cy + h / 2 + 0.5); ctx.lineTo(x0 + meas, cy + h / 2 + 0.5);
  ctx.stroke();
  /* 空尺 */
  const ry = cy - h / 2 - 34;
  ctx.strokeStyle = rgba(ACC, 0.22);
  ctx.beginPath();
  ctx.moveTo(x0, ry); ctx.lineTo(x0 + meas, ry);
  for (let q = 0; q <= 16; q++) {
    const x = x0 + (meas * q) / 16;
    ctx.moveTo(x + 0.5, ry - (q % 4 === 0 ? 6 : 3)); ctx.lineTo(x + 0.5, ry);
  }
  ctx.stroke();
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.36);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY MEASURE ' + Math.round(meas) + 'px', x0, cy + h / 2 + 34);
}

function mechStats() {
  return {
    open: +fmOpen.toFixed(2),
    size: +fmSize.toFixed(1),
    fill: 1,
    rmAmp: RM ? 0.5 : 1
  };
}
