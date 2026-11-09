/* lizi46 · 弹簧网格 · spring-lattice
   一张弹簧质点网被驻波模态撑起来，**波腹连成的线就是字**：
   字形所在的网格点振幅最大、亮起来，周围的网格被它们拽着一起起伏。
   AE：镜头滚转 + 抽帧（网格按 1/24s 步进）+ 缓推。 */

const GX46 = 34, GY46 = 20;
const N46 = GX46 * GY46;
const ox46 = new Float32Array(N46), oy46 = new Float32Array(N46);
const amp46 = new Float32Array(N46), ph46 = new Float32Array(N46);
const m46 = new Uint8Array(N46), at46 = new Float32Array(N46);
const dx46 = new Float32Array(N46), dy46 = new Float32Array(N46);
let cw46 = 0, ch46 = 0, mode46 = 0;

function mechResize() {
  if (!W || !H) return;
  cw46 = W * 0.86 / (GX46 - 1);
  ch46 = H * 0.62 / (GY46 - 1);
  for (let j = 0; j < GY46; j++) {
    for (let i = 0; i < GX46; i++) {
      const id = j * GX46 + i;
      ox46[id] = W * 0.07 + i * cw46;
      oy46[id] = H * 0.24 + j * ch46;
      amp46[id] = 0;
      ph46[id] = Math.random() * 6.283;
      m46[id] = 0;
    }
  }
}

function mechAssign(use) {
  const g = use.g;
  m46.fill(0);
  for (let k = 0; k < g.pc; k++) {
    const wx = blockGx + g.px[k], wy = blockGy + g.py[k];
    const i = Math.round((wx - W * 0.07) / cw46);
    const j = Math.round((wy - H * 0.24) / ch46);
    if (i < 0 || j < 0 || i >= GX46 || j >= GY46) continue;
    const id = j * GX46 + i;
    m46[id] = 1;
    const at = use.at[Math.min(g.n - 1, g.own[k])] || use.lineT;
    if (!at46[id] || at < at46[id]) at46[id] = at;
    if (amp46[id] < 0.4) amp46[id] = 0.4;
  }
  /* 邻近的网格点也被带动（波腹不是孤立的点） */
  for (let j = 1; j < GY46 - 1; j++) {
    for (let i = 1; i < GX46 - 1; i++) {
      const id = j * GX46 + i;
      if (m46[id]) continue;
      if (m46[id - 1] || m46[id + 1] || m46[id - GX46] || m46[id + GX46]) amp46[id] = 0.55;
    }
  }
  at46.fill(use.lineT);
  for (let j = 0; j < GY46; j++) for (let i = 0; i < GX46; i++) at46[j * GX46 + i] = use.lineT;
  mode46 = (mode46 + 1) % 3;
}

function mechEvent(k, first) {
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.5 : 0.25);
  cam.oy = -6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.oy *= Math.pow(0.05, dt);
  const q = Math.floor(T * 24) / 24;    /* 抽帧 */
  for (let j = 0; j < GY46; j++) {
    for (let i = 0; i < GX46; i++) {
      const id = j * GX46 + i;
      const a = amp46[id];
      const kx = (i / (GX46 - 1)) * 3.1416 * (1 + mode46 * 0.5);
      const ky = (j / (GY46 - 1)) * 3.1416 * (1.5 + mode46 * 0.5);
      const w = a * Math.sin(q * 5.2) * Math.sin(kx) * Math.sin(ky) * 16;
      dx46[id] = Math.cos(kx * 0.5) * w;
      dy46[id] = -w;
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 弹簧网格：一次 stroke 画完横竖线 */
  ctx.strokeStyle = 'rgba(120,150,190,0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 0; j < GY46; j++) {
    for (let i = 0; i < GX46; i++) {
      const id = j * GX46 + i;
      const x = ox46[id] + dx46[id], y = oy46[id] + dy46[id];
      if (i < GX46 - 1) {
        const n = id + 1;
        ctx.moveTo(pjX(x, y), pjY(x, y));
        ctx.lineTo(pjX(ox46[n] + dx46[n], oy46[n] + dy46[n]), pjY(ox46[n] + dx46[n], oy46[n] + dy46[n]));
      }
      if (j < GY46 - 1) {
        const n = id + GX46;
        ctx.moveTo(pjX(x, y), pjY(x, y));
        ctx.lineTo(pjX(ox46[n] + dx46[n], oy46[n] + dy46[n]), pjY(ox46[n] + dx46[n], oy46[n] + dy46[n]));
      }
    }
  }
  ctx.stroke();

  /* 网格点：普通点 / 波腹（字） */
  for (let pass = 0; pass < 2; pass++) {
    const hot = pass === 1;
    ctx.fillStyle = hot
      ? `rgba(${Math.min(255, ar + 44)},${Math.min(255, ag + 36)},${Math.min(255, ab + 18)},0.95)`
      : 'rgba(110,140,180,0.35)';
    ctx.beginPath();
    for (let j = 0; j < GY46; j++) {
      for (let i = 0; i < GX46; i++) {
        const id = j * GX46 + i;
        if ((amp46[id] > 0.2) !== hot) continue;
        if (T < at46[id]) continue;
        const x = ox46[id] + dx46[id], y = oy46[id] + dy46[id];
        const px = pjX(x, y), py = pjY(x, y);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = (hot ? 4.2 : 2) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
    }
    ctx.fill();
  }
}
