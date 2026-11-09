/* ===== lizi62 · 蜂巢 · honeycomb —— PHYSICS =====
   六边形巢格铺满画面，**被唱到的那片格子依次点亮**，亮格连起来就是字。
   格子本身是描边六边形（暗金属边 + 内部微光），格心里有 2~3 颗粒子做质感；
   命中时整片亮格的边闪一下（抽帧）。                                            */

const HC = 26;                                   /* 六边形外接圆半径 */
let hc62 = null, hc62n = 0, hc62hit = 0;
const h62x = new Float32Array(1400), h62y = new Float32Array(1400);
const h62lit = new Float32Array(1400), h62gl = new Float32Array(1400);

function hc62build() {
  if (!L || !L.pc) return;
  /* 在屏幕空间铺六边形，再判断哪些落在字形上 */
  const rows = Math.ceil(H / (HC * 1.5)) + 1, cols = Math.ceil(W / (HC * 1.732)) + 2;
  hc62 = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + (r % 2) * 0.5) * HC * 1.732 - HC;
      const cy = r * HC * 1.5 - HC;
      hc62.push({ x: cx, y: cy, lit: 0, own: -1, d: 0 });
    }
  }
  hc62n = hc62.length;
  /* 把每个格心映射到"最近的粒子"来判断是否属于字：用字形点包围盒 + 采样点距离 */
  for (let i = 0; i < hc62n; i++) {
    const cell = hc62[i];
    const dx = cell.x - W / 2, dy = cell.y - H * 0.46;
    if (Math.abs(dx) > 700 || Math.abs(dy) > 260) continue;
    let best = 1e9, bi = -1;
    for (let p = 0; p < L.pc; p += 7) {
      const gx = L.px[p] + blockGx - W / 2, gy = L.py[p] + blockGy - H * 0.46;
      const d2 = (gx - dx) * (gx - dx) + (gy - dy) * (gy - dy);
      if (d2 < best) { best = d2; bi = p; }
    }
    if (bi >= 0 && best < HC * HC * 1.15) { cell.own = L.own[bi]; cell.lit = 0; }
  }
  for (let i = 0; i < 1400; i++) { h62x[i] = 0; h62y[i] = 0; h62lit[i] = 0; h62gl[i] = 0; }
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(pc * 0.5)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 8;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  const a = accent || [186, 206, 255];
  vCore = 'rgb(255,244,206)';
  vMid = `rgb(${(230 + a[0] * 0.08) | 0},${(196 + a[1] * 0.08) | 0},${(120 + a[2] * 0.06) | 0})`;
  vDim = 'rgb(46,42,30)';
  hc62build();
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (!hc62 && L && L.pc) hc62build();
  if (!hc62) return;
  if (hc62hit > 0) hc62hit = Math.max(0, hc62hit - dt * 2.6);
  for (let i = 0; i < hc62n; i++) {
    const cell = hc62[i];
    if (cell.own < 0) continue;
    const gl = charGlow[cell.own] || 0;
    const want = gl > 0.05 ? 1 : 0;
    cell.lit += (want - cell.lit) * Math.min(1, dt * (want ? 9 : 3));
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hc62hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!hc62) return;
  const zoom = 1 + 0.02 * Math.sin(T * 0.5) + hc62hit * 0.02;

  /* ---------- 1) 暗格网（未点亮） ---------- */
  ctx.strokeStyle = 'rgba(70,74,86,0.30)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < hc62n; i++) {
    const c = hc62[i];
    if (c.lit > 0.12) continue;
    const px = W / 2 + (c.x - W / 2) * zoom, py = H * 0.46 + (c.y - H * 0.46) * zoom;
    if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
    for (let k = 0; k < 6; k++) {
      const a1 = Math.PI / 3 * k, a2 = Math.PI / 3 * (k + 1);
      const x1 = px + Math.cos(a1) * HC * zoom, y1 = py + Math.sin(a1) * HC * zoom;
      const x2 = px + Math.cos(a2) * HC * zoom, y2 = py + Math.sin(a2) * HC * zoom;
      if (k === 0) ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  }
  ctx.stroke();

  /* ---------- 2) 点亮格：先填暗金，再描亮边 ---------- */
  ctx.fillStyle = 'rgb(86,70,32)';
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (let i = 0; i < hc62n; i++) {
    const c = hc62[i];
    if (c.lit <= 0.12) continue;
    const px = W / 2 + (c.x - W / 2) * zoom, py = H * 0.46 + (c.y - H * 0.46) * zoom;
    const rr = HC * 0.86 * zoom * (0.6 + 0.4 * c.lit);
    ctx.rect(px - rr, py - rr, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(255,226,150,0.85)';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  for (let i = 0; i < hc62n; i++) {
    const c = hc62[i];
    if (c.lit <= 0.12) continue;
    const px = W / 2 + (c.x - W / 2) * zoom, py = H * 0.46 + (c.y - H * 0.46) * zoom;
    for (let k = 0; k < 6; k++) {
      const a1 = Math.PI / 3 * k, a2 = Math.PI / 3 * (k + 1);
      const x1 = px + Math.cos(a1) * HC * zoom, y1 = py + Math.sin(a1) * HC * zoom;
      const x2 = px + Math.cos(a2) * HC * zoom, y2 = py + Math.sin(a2) * HC * zoom;
      if (k === 0) ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  }
  ctx.stroke();

  /* ---------- 3) 格心粒子（亮点） ---------- */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgb(255,248,220)';
  ctx.beginPath();
  for (let i = 0; i < hc62n; i++) {
    const c = hc62[i];
    if (c.lit <= 0.4) continue;
    const px = W / 2 + (c.x - W / 2) * zoom, py = H * 0.46 + (c.y - H * 0.46) * zoom;
    const r = 1.6 * c.lit + 0.6;
    ctx.rect(px - r, py - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




/* ===== 实体字覆盖层（保证整句可读、有厚度；装饰层留在下面） ===== */
const v2BaseDraw = mechDraw;
mechDraw = function (T, z, pjX, pjY) {
  v2BaseDraw(T, z, pjX, pjY);
  if (!vn) return;
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + vtx[i], blockGy + vty[i]);
    vsy[i] = pjY(blockGx + vtx[i], blockGy + vty[i]);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.40 * gl);
  }
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.05; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.56) continue; const r = 5.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  ctx.globalAlpha = 1;
};
