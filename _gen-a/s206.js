/* ---------------------------------------------------------------------------
   206 · 机制实现：字距弹簧链（1D 弹簧 + 碰撞 + 两端对齐）
   ------------------------------------------------------------------------- */
META = {
  label: 'TRACKING / SPRING CHAIN',
  sub: '两端对齐 · 字距是弹簧',
  right: 'K 42 N/m',
  footer: 'JUSTIFIED',
  grid: 0.016,
  grain: 0.05,
  cross: true
};

function bakeChar(ch, fs) {
  const adv = Math.max(1, measureRows([ch], fs));
  const pad = Math.ceil(fs * 0.10);
  const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.3) + pad * 2;
  const mcv = maskCanvas([ch], fs, fs * 1.3, cw, chh);
  return { img: bakeCore(mcv), w: cw, h: chh, adv };
}

function mkSim(cells, fs) {
  const n = cells.length;
  const span = W * 0.78;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += cells[i].adv;
  const gap = n > 1 ? (span - sum) / (n - 1) : 0;
  const rest = new Float64Array(n), x = new Float64Array(n), v = new Float64Array(n);
  let cx = W / 2 - span / 2;
  for (let i = 0; i < n; i++) {
    const a = cells[i].adv;
    rest[i] = cx + a / 2;
    x[i] = rest[i];
    cx += a + gap;
  }
  return { n, rest, x, v, gap, span, fs, sum };
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const fs = fitFont([line.text], W * 0.52, Math.min(132, H * 0.145));
  const cells = [];
  const chars = Array.from(line.text);
  for (let k = 0; k < chars.length; k++) cells.push(bakeChar(chars[k], fs));
  return { cells, fs, sim: mkSim(cells, fs) };
}

function mechCommit() {
  if (cur) cur.sim = mkSim(cur.cells, cur.fs);
}
function mechSeek() { }

function mechUpdate(dt, time) {
  if (!cur || !cur.sim) return;
  const s = cur.sim;
  const n = s.n;
  if (!n) return;
  const k = 140, damp = 9.0;
  for (let i = 0; i < n; i++) {
    const f = -k * (s.x[i] - s.rest[i]) - damp * s.v[i];
    s.v[i] += f * dt;
    s.x[i] += s.v[i] * dt;
  }
  /* 碰撞：字不能叠到一起（否则读不出来） */
  for (let it = 0; it < 3; it++) {
    for (let i = 1; i < n; i++) {
      const minGap = (cur.cells[i].adv + cur.cells[i - 1].adv) * 0.5 * 0.94;
      const d = s.x[i] - s.x[i - 1];
      if (d < minGap) {
        const push = (minGap - d) / 2;
        s.x[i] += push; s.x[i - 1] -= push;
        s.v[i] *= 0.55; s.v[i - 1] *= 0.55;
      }
    }
  }
  /* 踩拍：从右侧推一把，整条链会传回来 */
  if (kick > 0.55 && s.n > 1) {
    s.v[s.n - 1] -= 26 * kick;
    s.v[0] += 18 * kick;
  }
}

function mechDraw(T) {
  if (!cur) return;
  const s = cur.sim;
  const n = s.n;
  if (!n) return;
  const cy = H * 0.5;
  const fs = cur.fs;
  const amp = RM ? 0.4 : 1;
  const y = cy + Math.sin(T * 0.55) * 1.4 * amp;

  /* 左右页边 */
  ctx.strokeStyle = rgba(ACC, 0.22);
  ctx.lineWidth = 1;
  const mx = W / 2 - s.span / 2, my = W / 2 + s.span / 2;
  ctx.beginPath();
  ctx.moveTo(mx + 0.5, y - fs * 1.15); ctx.lineTo(mx + 0.5, y + fs * 0.9);
  ctx.moveTo(my - 0.5, y - fs * 1.15); ctx.lineTo(my - 0.5, y + fs * 0.9);
  ctx.stroke();
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.beginPath();
  /* 每个字的中心投影到基线上（字距的"锚点"） */
  for (let i = 0; i < n; i++) {
    ctx.moveTo(s.x[i] + 0.5, y - fs * 0.5); ctx.lineTo(s.x[i] + 0.5, y + fs * 0.5);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  /* 字身框 + 字距弹簧 */
  for (let i = 0; i < n; i++) {
    const a = cur.cells[i].adv;
    const x = s.x[i] - a / 2;
    /* 字身框（em box） */
    ctx.strokeStyle = rgba(ACC, 0.17);
    ctx.strokeRect(x + 0.5, y - fs * 0.5 + 0.5, a - 1, fs - 1);
    /* 边距刻度 */
    ctx.strokeStyle = rgba(ACC, 0.30);
    ctx.beginPath();
    ctx.moveTo(x, y - fs * 0.62); ctx.lineTo(x, y - fs * 0.74);
    ctx.moveTo(x + a, y - fs * 0.62); ctx.lineTo(x + a, y - fs * 0.74);
    ctx.stroke();
  }
  /* 弹簧：相邻字之间画锯齿，长度就是此刻的字距 */
  for (let i = 1; i < n; i++) {
    const x1 = s.x[i - 1] + cur.cells[i - 1].adv / 2;
    const x2 = s.x[i] - cur.cells[i].adv / 2;
    if (x2 - x1 < 2) continue;
    const segs = 8, amp2 = Math.min(4.2, (x2 - x1) * 0.13);
    ctx.strokeStyle = rgba(ACC, 0.30);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let q = 0; q <= segs; q++) {
      const u = q / segs;
      const px = x1 + (x2 - x1) * u;
      const py = y + fs * 0.68 + (q % 2 ? -amp2 : amp2) * (q === 0 || q === segs ? 0 : 1);
      if (q) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
    /* 两端限位刻度：字距是一段"被拉住的量"，不是装饰 */
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y + fs * 0.68 - 4); ctx.lineTo(x1 + 0.5, y + fs * 0.68 + 4);
    ctx.moveTo(x2 - 0.5, y + fs * 0.68 - 4); ctx.lineTo(x2 - 0.5, y + fs * 0.68 + 4);
    ctx.stroke();
  }

  /* 字 */
  for (let i = 0; i < n; i++) {
    const c = cur.cells[i];
    const tilt = Math.max(-0.035, Math.min(0.035, s.v[i] * 0.00028));
    ctx.save();
    ctx.translate(s.x[i], y);
    ctx.rotate(tilt * amp);
    ctx.drawImage(c.img, -c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }

  /* 基线 + 读数 */
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.beginPath();
  ctx.moveTo(mx - 40, y + fs * 0.5 + 0.5); ctx.lineTo(my + 40, y + fs * 0.5 + 0.5);
  ctx.stroke();
  let trackNow = 0;
  for (let i = 1; i < n; i++) trackNow += (s.x[i] - s.x[i - 1]) - (cur.cells[i].adv + cur.cells[i - 1].adv) / 2;
  trackNow = n > 1 ? trackNow / (n - 1) : 0;
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.32);
  ctx.textAlign = 'left';
  ctx.fillText('TRACK ' + (trackNow >= 0 ? '+' : '') + (trackNow / fs).toFixed(3) + ' em   GAP ' + Math.round(trackNow) + 'px', mx, y + fs * 1.02);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('JUSTIFY ' + Math.round(s.span) + 'px   N ' + n, mx, y + fs * 1.02 + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一条空链（字身框 + 字距锯齿）在呼吸，中间走一个量距游标 */
function mechEmpty(T) {
  const cy = H * 0.5, n = 9, gap = 58;
  const total = (n - 1) * gap;
  const squeeze = 0.82 + 0.18 * Math.sin(T * 0.6);
  const span = total * squeeze;
  const left = W / 2 - span * 0.5;
  /* 边距（两端对齐的两条竖线） */
  ctx.strokeStyle = rgba(ACC, 0.40);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left - 29 + 0.5, cy - 34); ctx.lineTo(left - 29 + 0.5, cy + 34);
  ctx.moveTo(left + span + 29 - 0.5, cy - 34); ctx.lineTo(left + span + 29 - 0.5, cy + 34);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const x = left + i * gap * squeeze;
    ctx.strokeStyle = rgba(ACC, 0.30);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 16.5, cy - 20.5, 33, 41);
    if (i) {
      const px = left + (i - 0.5) * gap * squeeze;
      const half = gap * squeeze * 0.5 - 17;
      ctx.strokeStyle = rgba(ACC, 0.26);
      ctx.beginPath();
      for (let q = 0; q <= 8; q++) {
        const u = q / 8;
        const py = cy + 30 + ((q === 0 || q === 8) ? 0 : (q % 2 ? -4 : 4));
        const qx = px - half + half * 2 * u;
        if (q) ctx.lineTo(qx, py); else ctx.moveTo(qx, py);
      }
      ctx.stroke();
    }
  }
  /* 量距游标：沿基线慢慢走 */
  const u = (Math.sin(T * 0.4) * 0.5 + 0.5);
  const mx = left + span * u;
  ctx.strokeStyle = rgba(ACC, 0.55);
  ctx.beginPath();
  ctx.moveTo(mx + 0.5, cy - 40); ctx.lineTo(mx + 0.5, cy + 44);
  ctx.stroke();
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.40);
  ctx.textAlign = 'center';
  ctx.fillText('N ' + n + ' · 空链', mx, cy + 58);
  ctx.textAlign = 'left';
}

function mechStats() {
  let travel = 0;
  if (cur && cur.sim) {
    for (let i = 0; i < cur.sim.n; i++) travel = Math.max(travel, Math.abs(cur.sim.x[i] - cur.sim.rest[i]));
  }
  return { rmAmp: RM ? 0.4 : 1, chain: cur ? cur.sim.n : 0, travel: +travel.toFixed(1) };
}
