/* lizi26 · 磁畴壁 · domain-wall
   整片磁膜切成小方块（磁畴）。唱到一个字，那个字覆盖的磁畴一块块翻转，
   **翻转边界那一圈**发亮 —— 字就是这条边界线；边界随唱词推进一路扫过去。
   AE：冲击帧 + 镜头滚转 + 抽帧（边界按 1/24s 量化闪烁）。 */

const CELL26 = 9;
let gw26 = 0, gh26 = 0;
let mask26 = null, bnd26 = null, bnx26 = null, bny26 = null, btm26 = null;
let nb26 = 0, ctime26 = null, cellPulse26 = 0;
let grid26 = null;

function mechResize() {
  if (!W || !H) return;
  gw26 = Math.ceil(W / CELL26) + 1;
  gh26 = Math.ceil(H / CELL26) + 1;
  mask26 = new Uint8Array(gw26 * gh26);
  ctime26 = new Float32Array(gw26 * gh26);
  bnd26 = new Uint8Array(gw26 * gh26);
  bnx26 = new Float32Array(12000); bny26 = new Float32Array(12000);
  btm26 = new Float32Array(12000);
  grid26 = new Uint8Array(gw26 * gh26);
  for (let i = 0; i < grid26.length; i++) grid26[i] = Math.random() < 0.5 ? 1 : 0;
  nb26 = 0;
}

function mechAssign(use) {
  const g = use.g;
  mask26.fill(0); ctime26.fill(1e9); bnd26.fill(0);
  /* 1. 字形采样点落到格子：格子就是磁畴 */
  for (let k = 0; k < g.pc; k++) {
    const cx = ((blockGx + g.px[k]) / CELL26) | 0;
    const cy = ((blockGy + g.py[k]) / CELL26) | 0;
    if (cx < 1 || cy < 1 || cx >= gw26 - 1 || cy >= gh26 - 1) continue;
    const id = cy * gw26 + cx;
    mask26[id] = 1;
    const at = use.at[g.own[k]] || use.lineT;
    if (at < ctime26[id]) ctime26[id] = at;
  }
  /* 2. 边界 = 字形内、四邻有在字形外的格子（这就是"字"） */
  nb26 = 0;
  for (let cy = 1; cy < gh26 - 1; cy++) {
    for (let cx = 1; cx < gw26 - 1; cx++) {
      const id = cy * gw26 + cx;
      if (!mask26[id]) continue;
      if (mask26[id - 1] && mask26[id + 1] && mask26[id - gw26] && mask26[id + gw26]) continue;
      let t = 1e9;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = (cy + dy) * gw26 + cx + dx;
        if (ctime26[j] < t) t = ctime26[j];
      }
      if (t > 1e8) t = use.lineT;
      bnd26[id] = 1;
      if (nb26 < 12000) {
        bnx26[nb26] = cx; bny26[nb26] = cy; btm26[nb26] = t; nb26++;
      }
    }
  }
  cellPulse26 = 1;
}

function mechEvent(k, first) {
  cellPulse26 = first ? 1.8 : 1.1;
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.9 : 0.45);
  cam.ox = (k % 2 ? 1 : -1) * (first ? 40 : 22);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cellPulse26 *= Math.pow(0.03, dt);
  cam.ox *= Math.pow(0.02, dt);
  /* 非字形区域的磁畴：低频随机翻转，画面才不会死 */
  const n = 10 + ((dt * 400) | 0);
  for (let k = 0; k < n; k++) {
    const id = (Math.random() * grid26.length) | 0;
    grid26[id] ^= 1;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  ctx.globalCompositeOperation = 'source-over';

  /* 背景磁畴：暗方块，隔两个格抽一个，省面积 */
  ctx.fillStyle = 'rgba(28,36,56,0.55)';
  ctx.beginPath();
  for (let cy = 1; cy < gh26 - 1; cy += 3) {
    for (let cx = 1; cx < gw26 - 1; cx += 3) {
      const id = cy * gw26 + cx;
      if (mask26[id] || !grid26[id]) continue;
      const px = pjX(cx * CELL26, cy * CELL26), py = pjY(cx * CELL26, cy * CELL26);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      ctx.rect(px, py, CELL26 * 2.4 * z, CELL26 * 2.4 * z);
    }
  }
  ctx.fill();

  if (!L) return;

  /* 字形内部的磁畴：暗蓝的实体，让边界有"里面" */
  ctx.fillStyle = 'rgba(30,42,66,0.72)';
  ctx.beginPath();
  for (let cy = 1; cy < gh26 - 1; cy++) {
    for (let cx = 1; cx < gw26 - 1; cx++) {
      const id = cy * gw26 + cx;
      if (!mask26[id] || bnd26[id]) continue;
      const px = pjX(cx * CELL26, cy * CELL26), py = pjY(cx * CELL26, cy * CELL26);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      ctx.rect(px, py, CELL26 * 0.92 * z, CELL26 * 0.92 * z);
    }
  }
  ctx.fill();

  /* 未翻转的边界：暗 */
  ctx.fillStyle = `rgba(${Math.min(255, ar - 40)},${Math.min(255, ag - 30)},${Math.min(255, ab + 10)},0.20)`;
  ctx.beginPath();
  for (let i = 0; i < nb26; i++) {
    if (T >= btm26[i]) continue;
    const px = pjX(bnx26[i] * CELL26, bny26[i] * CELL26), py = pjY(bnx26[i] * CELL26, bny26[i] * CELL26);
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    ctx.rect(px, py, CELL26 * 0.95 * z, CELL26 * 0.95 * z);
  }
  ctx.fill();

  /* 已翻转的边界：亮，按 1/24s 量化闪 */
  const q = Math.floor(T * 24) % 2 ? 1 : 0.8;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 36)},${Math.min(255, ab + 24)},${(0.7 * q).toFixed(3)})`;
  ctx.beginPath();
  for (let i = 0; i < nb26; i++) {
    if (T < btm26[i]) continue;
    const d = T - btm26[i];
    const pop = d < 0.16 ? 1 + (0.16 - d) * 1.6 : 1;
    const s = CELL26 * 0.95 * pop * z;
    const px = pjX(bnx26[i] * CELL26, bny26[i] * CELL26), py = pjY(bnx26[i] * CELL26, bny26[i] * CELL26);
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    ctx.rect(px - (s - CELL26 * 0.95 * z) * 0.5, py - (s - CELL26 * 0.95 * z) * 0.5, s, s);
  }
  ctx.fill();

  /* 正在翻转的那一圈：暖白高光 */
  ctx.fillStyle = 'rgba(255,238,212,0.42)';
  ctx.beginPath();
  for (let i = 0; i < nb26; i++) {
    const d = T - btm26[i];
    if (d < 0 || d > 0.22) continue;
    const px = pjX(bnx26[i] * CELL26, bny26[i] * CELL26), py = pjY(bnx26[i] * CELL26, bny26[i] * CELL26);
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    ctx.rect(px, py, CELL26 * 0.8 * z, CELL26 * 0.8 * z);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
