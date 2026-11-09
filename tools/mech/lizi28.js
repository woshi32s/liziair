/* lizi28 · 冰川裂隙 · crevasse
   冰盖被应力撕开：字形覆盖的每个小格是一块**冰碎片**，唱到一个字，
   那些碎片先被顶开 2~4px、亮出裂缝，再咔一声落回；飞出去的冰屑带重力落下。
   字 = 碎片之间那道裂缝网络。 */

const STEP28 = 15;
let gw28 = 0, gh28 = 0;
let smask28 = null, st28 = null, sang28 = null, srd28 = null, ssz28 = null;
let slist = null, sn28 = 0;
const CH28 = 260;
const cx28 = new Float32Array(CH28), cy28 = new Float32Array(CH28);
const cvx28 = new Float32Array(CH28), cvy28 = new Float32Array(CH28);
const cl28 = new Float32Array(CH28);
let iceCv28 = null;

function mechResize() {
  if (!W || !H) return;
  gw28 = Math.ceil(W / STEP28) + 1;
  gh28 = Math.ceil(H / STEP28) + 1;
  smask28 = new Uint8Array(gw28 * gh28);
  st28 = new Float32Array(gw28 * gh28);
  sang28 = new Float32Array(gw28 * gh28);
  srd28 = new Float32Array(gw28 * gh28);
  ssz28 = new Float32Array(gw28 * gh28);
  for (let i = 0; i < smask28.length; i++) { st28[i] = 1e9; srd28[i] = rnd(6.2, 9.6); ssz28[i] = 0; }
  for (let i = 0; i < CH28; i++) cl28[i] = 0;

  /* 冰面底：冷蓝的裂纹底纹（预烘） */
  if (!iceCv28) iceCv28 = document.createElement('canvas');
  iceCv28.width = Math.max(2, Math.round(W / 2));
  iceCv28.height = Math.max(2, Math.round(H / 2));
  const ic = iceCv28.getContext('2d');
  const bw = iceCv28.width, bh = iceCv28.height;
  const g = ic.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#0a1218');
  g.addColorStop(0.55, '#0c1820');
  g.addColorStop(1, '#060d12');
  ic.fillStyle = g; ic.fillRect(0, 0, bw, bh);
  ic.strokeStyle = 'rgba(150,200,225,0.06)';
  ic.lineWidth = 1;
  for (let k = 0; k < 26; k++) {
    let x = Math.random() * bw, y = Math.random() * bh;
    ic.beginPath(); ic.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += rnd(-40, 40); y += rnd(-26, 26); ic.lineTo(x, y); }
    ic.stroke();
  }
}

function mechAssign(use) {
  const g = use.g;
  smask28.fill(0);
  for (let i = 0; i < st28.length; i++) st28[i] = 1e9;
  sn28 = 0;
  for (let k = 0; k < g.pc; k++) {
    const cx = ((blockGx + g.px[k]) / STEP28) | 0;
    const cy = ((blockGy + g.py[k]) / STEP28) | 0;
    if (cx < 1 || cy < 1 || cx >= gw28 - 1 || cy >= gh28 - 1) continue;
    const id = cy * gw28 + cx;
    smask28[id] = 1;
    const at = use.at[g.own[k]] || use.lineT;
    if (at < st28[id]) { st28[id] = at; sang28[id] = g.own[k]; }
  }
  for (let i = 0; i < smask28.length; i++) if (smask28[i]) sn28++;
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? 1 : -1) * (first ? 26 : 14);
  cam.oy = -6;
  for (let i = 0; i < CH28; i++) {
    if (Math.random() < 0.55 && L) {
      const c = (Math.random() * L.pc) | 0;
      cx28[i] = blockGx + L.px[c]; cy28[i] = blockGy + L.py[c];
      cvx28[i] = rnd(-160, 160); cvy28[i] = rnd(-260, -60);
      cl28[i] = 1;
    }
  }
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);
  for (let i = 0; i < CH28; i++) {
    if (cl28[i] <= 0) continue;
    cvy28[i] += 620 * dt;
    cx28[i] += cvx28[i] * dt; cy28[i] += cvy28[i] * dt;
    cl28[i] -= dt * 0.7;
    if (cy28[i] > H + 20) cl28[i] = 0;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (iceCv28) ctx.drawImage(iceCv28, 0, 0, W, H);

  /* 冰碎片：冷蓝的底，裂开过的亮一层（两个批次） */
  for (let pass = 0; pass < 2; pass++) {
    const fresh = pass === 1;
    ctx.fillStyle = fresh
      ? `rgba(${Math.min(255, ar + 36)},${Math.min(255, ag + 50)},${Math.min(255, ab + 60)},0.92)`
      : 'rgba(96,132,158,0.34)';
    ctx.beginPath();
    for (let cy = 1; cy < gh28 - 1; cy++) {
      for (let cx = 1; cx < gw28 - 1; cx++) {
        const id = cy * gw28 + cx;
        if (!smask28[id]) continue;
        if (T < st28[id]) continue;
        const age = T - st28[id];
        const opened = age < 0.5 ? 1 - age * 2 : 0;
        if (fresh && !(opened > 0.02)) continue;
        if (!fresh && opened > 0.02) continue;
        /* 碎片往外顶：离字心越远开得越大 */
        const rx = cx * STEP28, ry = cy * STEP28;
        const dx = rx - blockGx, dy = ry - blockGy;
        const dl = Math.hypot(dx, dy) || 1;
        const push = opened * 5;
        const px = pjX(rx + dx / dl * push, ry + dy / dl * push);
        const py = pjY(rx + dx / dl * push, ry + dy / dl * push);
        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        const r = srd28[id] * (fresh ? 1.02 : 0.86) * z;
        /* 四边略不规则的冰碎片 */
        const a0 = (id % 7) * 0.3;
        ctx.moveTo(px + Math.cos(a0) * r, py + Math.sin(a0) * r);
        ctx.lineTo(px + Math.cos(a0 + 1.57) * r * 1.05, py + Math.sin(a0 + 1.57) * r * 1.05);
        ctx.lineTo(px + Math.cos(a0 + 3.14) * r * 0.95, py + Math.sin(a0 + 3.14) * r * 0.95);
        ctx.lineTo(px + Math.cos(a0 + 4.71) * r, py + Math.sin(a0 + 4.71) * r);
        ctx.closePath();
      }
    }
    ctx.fill();
  }

  /* 冰屑 */
  ctx.fillStyle = 'rgba(208,236,255,0.85)';
  ctx.beginPath();
  for (let i = 0; i < CH28; i++) {
    if (cl28[i] <= 0) continue;
    const px = pjX(cx28[i], cy28[i]), py = pjY(cx28[i], cy28[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = (1.4 + cl28[i] * 2.4) * z;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 1.5);
  }
  ctx.fill();
}
