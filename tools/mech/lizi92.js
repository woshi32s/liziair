/* lizi92 · 粒子喷泉 · fountain
   水柱从池底喷起，在空中被字的位置"截住"：水珠悬停、聚成字，多余的水落回池里。
   AE：镜头锁定追踪（跟着最高的水柱）+ 升格（重力压到 0.3）+ 冲击帧。 */

const N92 = 4600;
const qx92 = new Float32Array(N92), qy92 = new Float32Array(N92);
const qvx92 = new Float32Array(N92), qvy92 = new Float32Array(N92);
const qtx92 = new Float32Array(N92), qty92 = new Float32Array(N92);
const qown92 = new Int16Array(N92), qtm92 = new Float32Array(N92);
const qst92 = new Uint8Array(N92), qsz92 = new Float32Array(N92);
let n92 = 0, poolY92 = 0, jetX92 = 0, burst92 = 0;

function mechResize() {
  if (!W || !H) return;
  poolY92 = H * 0.9; jetX92 = W * 0.5;
  for (let i = 0; i < N92; i++) {
    qx92[i] = jetX92; qy92[i] = poolY92;
    qvx92[i] = 0; qvy92[i] = 0; qst92[i] = 0;
    qsz92[i] = 1 + Math.random() * 1.3;
  }
  n92 = N92;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n92 = Math.max(2000, Math.min(N92, Math.round(pc * 1.2)));
  burst92 = 1;
  for (let i = 0; i < n92; i++) {
    const pi = ((i * pc / n92) | 0) % pc;
    qtx92[i] = blockGx + g.px[pi] + rnd(-1, 1);
    qty92[i] = blockGy + g.py[pi] + rnd(-1, 1);
    qown92[i] = g.own[pi];
    qtm92[i] = use.at[g.own[pi]] || lineT;
    qst92[i] = 0;
    /* 出水口：底部中央偏一点 */
    qx92[i] = jetX92 + rnd(-8, 8); qy92[i] = poolY92;
    /* 初速度朝字的方向，被重力拉成抛物线 */
    const dx = qtx92[i] - jetX92, dy = qty92[i] - poolY92;
    const l = Math.hypot(dx, dy) || 1;
    const sp = rnd(900, 1500);
    qvx92[i] = dx / l * sp * 0.35;
    qvy92[i] = dy / l * sp;
  }
}

function mechEvent(k, first) {
  burst92 = first ? 1.8 : 1.1;
  cam.oy = first ? -10 : -5;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  burst92 *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  const g92 = 900 * 0.3;      /* 升格：重力压到 0.3 */
  for (let i = 0; i < n92; i++) {
    if (T < qtm92[i] - 0.6) {
      qx92[i] = jetX92 + Math.sin(T * 8 + i) * 6; qy92[i] = poolY92;
      continue;
    }
    if (qst92[i]) continue;
    /* 抛物线上升，接近字位时被"截住" */
    qvy92[i] += g92 * dt;
    qvx92[i] *= Math.pow(0.9, dt);
    qx92[i] += qvx92[i] * dt; qy92[i] += qvy92[i] * dt;
    const dx = qtx92[i] - qx92[i], dy = qty92[i] - qy92[i];
    const d = Math.hypot(dx, dy);
    if (d < 70) {
      const near = d < 30;
      qvx92[i] += dx * (near ? 40 : 18) * dt - qvx92[i] * (near ? 11 : 2.6) * dt;
      qvy92[i] += dy * (near ? 40 : 18) * dt - qvy92[i] * (near ? 11 : 2.6) * dt;
    }
    if (d < 2 || T > qtm92[i] + 1.7) { qst92[i] = 1; qx92[i] = qtx92[i]; qy92[i] = qty92[i]; }
    if (qy92[i] > poolY92 + 10) { qst92[i] = 1; qx92[i] = qtx92[i]; qy92[i] = qty92[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const py0 = pjY(0, poolY92);
  /* 水池 */
  ctx.fillStyle = 'rgba(6,14,22,0.9)';
  ctx.fillRect(0, py0, W, H - py0 + 2);
  ctx.strokeStyle = 'rgba(140,210,240,0.20)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, py0); ctx.lineTo(W, py0); ctx.stroke();

  if (!L) return;

  /* 水柱：上升中是细长的亮条；悬停的是亮点 */
  for (let pass = 0; pass < 2; pass++) {
    const set = pass === 1;
    ctx.fillStyle = set
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 60)},${Math.min(255, ab + 60)},0.95)`
      : 'rgba(110,180,210,0.35)';
    ctx.beginPath();
    for (let i = 0; i < n92; i++) {
      if (T < qtm92[i] - 0.6) continue;
      if (!!qst92[i] !== set) continue;
      const px = pjX(qx92[i], qy92[i]), py = pjY(qx92[i], qy92[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = qsz92[i] * (set ? 1.6 : 1.1) * z;
      if (set) ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      else ctx.rect(px - s * 0.35, py - s * 1.6, s * 0.7, s * 3.2);
    }
    ctx.fill();
  }

  /* 水面反光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(140,220,240,0.06)';
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    ctx.rect(W * 0.2 + k * 60, py0 + 8 + (k % 3) * 10, 30, 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/* ===== v2 实体字覆盖层（自足版 rev2）：时间驱动 + 字区压暗，专治"旧机制自己那份字"错位重影 =====
   10-27 那批薄实现的机制留在下面当装饰；这一层在字区先铺一张柔边暗片（把底下的旧字压掉），
   再画实体字（三档 + 暗影 + 光晕），保证整句可读且不出现双描。                        */
const V2N = 7000;
const v2x = new Float32Array(V2N), v2y = new Float32Array(V2N);
const v2tx = new Float32Array(V2N), v2ty = new Float32Array(V2N);
const v2onw = new Int16Array(V2N), v2lum = new Float32Array(V2N);
const v2sx = new Float32Array(V2N), v2sy = new Float32Array(V2N), v2ss = new Float32Array(V2N);
const v2dz = new Float32Array(V2N);
let v2n = 0, v2lastL = null;
let v2core = 'rgb(244,248,255)', v2mid = 'rgb(178,205,242)', v2dim = 'rgb(64,84,116)';
let v2plate = null, v2pw = 0, v2ph = 0;

function v2prep() {
  const pc = L.pc;
  v2n = Math.min(V2N, Math.max(2000, pc >> 2));
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (let i = 0; i < v2n; i++) {
    const pi = (i * pc / v2n) | 0;
    v2tx[i] = L.px[pi]; v2ty[i] = L.py[pi];
    v2onw[i] = L.own[pi];
    v2dz[i] = (Math.random() - 0.5) * 22;
    v2x[i] = v2tx[i]; v2y[i] = v2ty[i];
    if (v2tx[i] < mnx) mnx = v2tx[i]; if (v2tx[i] > mxx) mxx = v2tx[i];
    if (v2ty[i] < mny) mny = v2ty[i]; if (v2ty[i] > mxy) mxy = v2ty[i];
  }
  const a = accent || [186, 206, 255];
  v2core = 'rgb(' + (Math.min(255, 205 + a[0] * 0.20) | 0) + ',' + (Math.min(255, 212 + a[1] * 0.17) | 0) + ',' + (Math.min(255, 226 + a[2] * 0.11) | 0) + ')';
  v2mid = 'rgb(' + ((120 + a[0] * 0.55) | 0) + ',' + ((150 + a[1] * 0.42) | 0) + ',' + (Math.min(255, 170 + a[2] * 0.32) | 0) + ')';
  v2dim = 'rgb(' + ((30 + a[0] * 0.28) | 0) + ',' + ((40 + a[1] * 0.26) | 0) + ',' + ((55 + a[2] * 0.26) | 0) + ')';
  /* 字区压暗片（柔边），把底下旧机制那份字压掉 */
  v2pw = Math.max(320, Math.ceil((mxx - mnx) + 360));
  v2ph = Math.max(200, Math.ceil((mxy - mny) + 280));
  v2plate = document.createElement('canvas');
  v2plate.width = v2pw; v2plate.height = v2ph;
  const g = v2plate.getContext('2d');
  const gr = g.createRadialGradient(v2pw / 2, v2ph / 2, Math.min(v2pw, v2ph) * 0.10,
    v2pw / 2, v2ph / 2, Math.max(v2pw, v2ph) * 0.72);
  gr.addColorStop(0, 'rgba(4,6,11,0.40)');
  gr.addColorStop(0.55, 'rgba(4,6,11,0.26)');
  gr.addColorStop(0.82, 'rgba(4,6,11,0.07)');
  gr.addColorStop(1, 'rgba(4,6,11,0)');
  g.fillStyle = gr; g.fillRect(0, 0, v2pw, v2ph);
}

const v2prevDraw = mechDraw;
mechDraw = function (T, z, pjX, pjY) {
  v2prevDraw(T, z, pjX, pjY);
  if (!L || !L.pc) return;
  if (v2lastL !== L) { v2lastL = L; v2prep(); }
  if (!v2n) return;
  const enter = clamp01((T - lineT) / 1.1);
  /* 1) 字区压暗（压掉旧机制自己的那份字） */
  if (v2plate && enter > 0.15) {
    const cxs = pjX(blockGx, blockGy), cys = pjY(blockGx, blockGy);
    const wp = v2pw * z, hp = v2ph * z;
    ctx.globalAlpha = Math.min(1, (enter - 0.15) * 1.6);
    ctx.drawImage(v2plate, cxs - wp / 2, cys - hp / 2, wp, hp);
    ctx.globalAlpha = 1;
  }
  const yaw = Math.sin(T * 0.20) * 0.15, pit = 0.06 * Math.sin(T * 0.17);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < v2n; i++) {
    const X0 = v2x[i], Y0 = v2y[i], Z0 = v2dz[i];
    const X1 = X0 * cy + Z0 * sy, Z1 = -X0 * sy + Z0 * cy;
    const Y1 = Y0 * cp - Z1 * sp, Z2 = Y0 * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    v2sx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    v2sy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    v2ss[i] = s;
    const gl = charGlow[v2onw[i]] || 0;
    v2lum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.05 - X1 / 260) + 0.26 * gl);
  }
  ctx.globalAlpha = 0.34 * enter; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < v2n; i++) { const r = 3.0 * v2ss[i]; ctx.rect(v2sx[i] + 3, v2sy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.06 * enter; ctx.fillStyle = v2core;
  ctx.beginPath();
  for (let i = 0; i < v2n; i++) { if (v2lum[i] < 0.66 || (i % 2)) continue; const r = 5.0 * v2ss[i]; ctx.rect(v2sx[i] - r, v2sy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const v2bands = [[0.56, 1.0, 1.0], [0.26, 0.80, 0.90], [-1, 0.58, 0.76]];
  const v2cols = [v2core, v2mid, v2dim];
  for (let b = 0; b < 3; b++) {
    const lo = v2bands[b][0], hi = b === 0 ? 1.01 : v2bands[b - 1][0];
    ctx.globalAlpha = v2bands[b][1] * enter;
    ctx.fillStyle = v2cols[b];
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < v2n; i++) {
      const l = v2lum[i];
      if (l < lo || l >= hi) continue;
      const rr = 3.0 * v2bands[b][2] * v2ss[i];
      ctx.rect(v2sx[i] - rr, v2sy[i] - rr, rr * 2, rr * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
};



