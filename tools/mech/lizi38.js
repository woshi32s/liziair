/* lizi38 · 烟圈涡环 · vortex-ring
   一个个烟圈在黑暗里穿过，烟圈扫过的地方被"顶开"，
   **字是烟圈穿过字形孔洞时被切出来的那道空腔** —— 满屏淡烟，只有字的位置没有烟。
   AE：体积烟（多层视差）+ 缓推 + 顿帧。 */

const N38 = 5600;
const rg38 = new Float32Array(N38), rr38 = new Float32Array(N38);
const ra38 = new Float32Array(N38), rv38 = new Float32Array(N38);
const rph38 = new Float32Array(N38), rsz38 = new Float32Array(N38);
const rdep38 = new Float32Array(N38), rkx38 = new Float32Array(N38);
let n38 = 0;
let gw38 = 0, gh38 = 0, mask38 = null;
const STEP38 = 10;
const RINGS = 5;
const ringC = [];
let ringT = 0;

function mechResize() {
  if (!W || !H) return;
  gw38 = Math.ceil(W / STEP38) + 1;
  gh38 = Math.ceil(H / STEP38) + 1;
  mask38 = new Uint8Array(gw38 * gh38);
  for (let i = 0; i < N38; i++) {
    rg38[i] = (Math.random() * RINGS) | 0;
    rr38[i] = 20 + Math.random() * 30;
    ra38[i] = Math.random() * 6.283;
    rv38[i] = (0.5 + Math.random() * 1.4) * (Math.random() < 0.5 ? 1 : -1);
    rph38[i] = rnd(0, 6.283);
    rsz38[i] = 1.5 + Math.random() * 2.4;
  }
  n38 = N38;
  ringC.length = 0;
  for (let k = 0; k < RINGS; k++) ringC.push({ x: W * (0.1 + k * 0.2), y: H * 0.5, z: 0.4 + k * 0.12 });
}

function mechAssign(use) {
  const g = use.g;
  mask38.fill(0);
  for (let k = 0; k < g.pc; k++) {
    const cx = ((blockGx + g.px[k]) / STEP38) | 0;
    const cy = ((blockGy + g.py[k]) / STEP38) | 0;
    if (cx < 0 || cy < 0 || cx >= gw38 || cy >= gh38) continue;
    mask38[cy * gw38 + cx] = 1;
  }
  ringT = 0;
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? -1 : 1) * (first ? 30 : 16);
  cam.oy = -4;
  ringT = first ? 1 : 0.6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.03, dt);
  cam.oy *= Math.pow(0.04, dt);
  ringT *= Math.pow(0.2, dt);
  for (let k = 0; k < RINGS; k++) {
    const r = ringC[k];
    r.x += (18 + k * 6) * dt;
    r.y = H * 0.5 + Math.sin(T * 0.5 + k * 1.7) * H * 0.16;
    r.z = 0.45 + 0.1 * Math.sin(T * 0.7 + k);
    if (r.x > W + 140) r.x = -140;
  }
  for (let i = 0; i < N38; i++) {
    ra38[i] += rv38[i] * dt * (1 + ringT);
    rr38[i] += Math.sin(T * 1.7 + rph38[i]) * 6 * dt;
    if (rr38[i] < 12) rr38[i] = 12;
    if (rr38[i] > 56) rr38[i] = 56;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 烟：淡灰蓝的小方块，分两档深度（体积感） */
  for (let pass = 0; pass < 2; pass++) {
    const far = pass === 0;
    ctx.fillStyle = far ? 'rgba(120,140,160,0.045)' : 'rgba(150,175,195,0.07)';
    ctx.beginPath();
    for (let i = 0; i < N38; i++) {
      const rc = ringC[rg38[i] % RINGS];
      const rx = rc.x + Math.cos(ra38[i]) * rr38[i];
      const ry = rc.y + Math.sin(ra38[i]) * rr38[i] * 0.55;
      const cz = (((rx / STEP38) | 0)), cz2 = ((ry / STEP38) | 0);
      /* 字形里不放烟：字就被"切"出来了 */
      if (cz >= 0 && cz2 >= 0 && cz < gw38 && cz2 < gh38 && mask38[cz2 * gw38 + cz]) continue;
      if (far !== (rg38[i] % 2 === 0)) continue;
      const px = pjX(rx, ry), py = pjY(rx, ry);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      const s = rsz38[i] * (far ? 2.6 : 3.6) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 烟圈的亮边（涡环的环流）：每个圈两道弧，一次 stroke */
  ctx.strokeStyle = 'rgba(190,210,230,0.10)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k < RINGS; k++) {
    const rc = ringC[k];
    const cx = pjX(rc.x, rc.y), cy = pjY(rc.x, rc.y);
    const rr = (58 + k * 6) * z;
    ctx.moveTo(cx + rr, cy);
    ctx.ellipse(cx, cy, rr, rr * 0.56, 0, 0, 6.2832);
  }
  ctx.stroke();

  /* 字形位置：极淡的暖光，提示"这里没烟" */
  if (L) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${Math.min(255, ar + 20)},${Math.min(255, ag + 16)},${Math.min(255, ab + 12)},0.055)`;
    ctx.beginPath();
    for (let k = 0; k < L.pc; k += 2) {
      const px = pjX(blockGx + L.px[k], blockGy + L.py[k]);
      const py = pjY(blockGx + L.px[k], blockGy + L.py[k]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      ctx.rect(px - 2.5, py - 2.5, 5, 5);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}
