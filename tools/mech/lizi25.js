/* lizi25 · 晶格位错 · lattice
   一片完美的晶格点阵。位错线扫过去，扫过的格点被**永久推离**原位（滑移），
   离开的那条路径连起来就是字；字是位错线走过的痕迹。
   AE：抽帧 Step-Printing（位错核按 1/20s 跳格）+ 甩镜 + 冲击帧。 */

const STEP25 = 12;
let gw25 = 0, gh25 = 0;
let lmask25 = null, ltime25 = null, ldx25 = null, ldy25 = null, lown25 = null;
let coreX25 = 0, coreY25 = 0, coreT25 = 0, coreOn25 = 0;

function mechResize() {
  if (!W || !H) return;
  gw25 = Math.ceil(W / STEP25) + 1;
  gh25 = Math.ceil(H / STEP25) + 1;
  lmask25 = new Uint8Array(gw25 * gh25);
  ltime25 = new Float32Array(gw25 * gh25);
  ldx25 = new Float32Array(gw25 * gh25);
  ldy25 = new Float32Array(gw25 * gh25);
  lown25 = new Int16Array(gw25 * gh25);
  for (let i = 0; i < lmask25.length; i++) {
    ltime25[i] = 1e9;
    ldx25[i] = rnd(-1, 1); ldy25[i] = rnd(-1, 1);
  }
}

function mechAssign(use) {
  const g = use.g;
  lmask25.fill(0);
  for (let i = 0; i < ltime25.length; i++) ltime25[i] = 1e9;
  coreOn25 = 0;
  for (let k = 0; k < g.pc; k++) {
    const cx = ((blockGx + g.px[k]) / STEP25) | 0;
    const cy = ((blockGy + g.py[k]) / STEP25) | 0;
    if (cx < 1 || cy < 1 || cx >= gw25 - 1 || cy >= gh25 - 1) continue;
    const id = cy * gw25 + cx;
    lmask25[id] = 1;
    const at = use.at[g.own[k]] || use.lineT;
    if (at < ltime25[id]) { ltime25[id] = at; lown25[id] = g.own[k]; }
  }
}

function mechEvent(k, first) {
  coreT25 = 0.22;
  cam.ox = (k % 2 ? -1 : 1) * (first ? 44 : 24);
  cam.oy = -5;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  coreT25 = Math.max(0, coreT25 - dt);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);
  /* 位错核：跟着正在唱的那个字走（按 1/20s 跳格，做抽帧感） */
  const qT = Math.floor(T * 20) / 20;
  let best = -1, bt = 1e9;
  for (let c = 0; c < L.n; c++) {
    if (lown25.length && c > L.n) break;
  }
  /* 取当前时间正在出现的格点：核就停在那里 */
  for (let cy = 1; cy < gh25 - 1; cy += 1) {
    for (let cx = 1; cx < gw25 - 1; cx += 1) {
      const id = cy * gw25 + cx;
      if (!lmask25[id]) continue;
      const t = ltime25[id];
      if (t <= qT && t > best) { best = t; coreX25 = cx; coreY25 = cy; bt = t; }
    }
  }
  if (best > 0) coreOn25 = 1;
  void bt;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const qT = Math.floor(T * 20) / 20;

  /* 未滑移的完美晶格：暗点阵（隔格画，省面积） */
  ctx.fillStyle = 'rgba(96,120,168,0.20)';
  ctx.beginPath();
  for (let cy = 1; cy < gh25 - 1; cy += 2) {
    for (let cx = 1; cx < gw25 - 1; cx += 2) {
      const id = cy * gw25 + cx;
      if (lmask25[id] && qT >= ltime25[id]) continue;
      const px = pjX(cx * STEP25, cy * STEP25), py = pjY(cx * STEP25, cy * STEP25);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      ctx.rect(px, py, 2.1, 2.1);
    }
  }
  ctx.fill();

  /* 滑移区（字）：格点被推开，位置 = 原位 + 滑移矢量 */
  ctx.fillStyle = `rgba(${Math.min(255, ar + 24)},${Math.min(255, ag + 20)},${Math.min(255, ab + 10)},0.92)`;
  ctx.beginPath();
  for (let cy = 1; cy < gh25 - 1; cy += 1) {
    for (let cx = 1; cx < gw25 - 1; cx += 1) {
      const id = cy * gw25 + cx;
      if (!lmask25[id] || qT < ltime25[id]) continue;
      const dt2 = Math.min(0.5, qT - ltime25[id]);
      const push = 4.5 * (1 - Math.min(1, dt2 * 2.2));
      const px = pjX(cx * STEP25 + ldx25[id] * push, cy * STEP25 + ldy25[id] * push);
      const py = pjY(cx * STEP25 + ldx25[id] * push, cy * STEP25 + ldy25[id] * push);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      ctx.rect(px - 1.2, py - 1.2, 2.9, 2.9);
    }
  }
  ctx.fill();

  /* 位错核：一小圈亮环（唯一会用到的 ellipse，数量 = 1） */
  if (coreOn25) {
    const cx2 = pjX(coreX25 * STEP25, coreY25 * STEP25);
    const cy2 = pjY(coreX25 * STEP25, coreY25 * STEP25);
    ctx.strokeStyle = 'rgba(255,240,210,0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx2, cy2, 16 * z, 16 * z, 0, 0, 6.2832);
    ctx.stroke();
  }
}
