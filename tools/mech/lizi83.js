/* lizi83 · 风铃 · wind-chime
   几排金属管挂在空中，被风吹得摆动；每根管子下端的光点在同一条线上排成字 ——
   **字是风铃管端点的位置**。风大时整排一起荡，管与管互相碰撞会闪一下。
   AE：环绕运镜 + 焦点滑动 + 顿帧。 */

const N83 = 180, MAXP83 = 4800;
const ct83 = new Float32Array(N83), cy83 = new Float32Array(N83);
const cl83 = new Float32Array(N83), ca83 = new Float32Array(N83);
const cv83 = new Float32Array(N83), cph83 = new Float32Array(N83);
const ctf83 = new Float32Array(N83);
let nch83 = 0;
const px83 = new Float32Array(MAXP83), py83 = new Float32Array(MAXP83);
const po83 = new Float32Array(MAXP83), psz83 = new Float32Array(MAXP83);
const pown83 = new Int16Array(MAXP83), ptm83 = new Float32Array(MAXP83);
let np83 = 0, wind83 = 0, gust83 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N83; i++) { ca83[i] = 0; cv83[i] = 0; cph83[i] = Math.random() * 6.283; }
  np83 = 0;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  /* 每根风铃管负责一段字：管子长度与位置按字形点的分布来 */
  nch83 = Math.min(N83, Math.max(12, (pc / 90) | 0));
  for (let i = 0; i < nch83; i++) {
    const pi = ((i * pc / nch83) | 0) % pc;
    ct83[i] = blockGx + g.px[pi];
    cy83[i] = blockGy + g.py[pi];
    cl83[i] = 60 + Math.random() * 120;
    ca83[i] = 0; cv83[i] = 0;
    ctf83[i] = use.at[g.own[pi]] || lineT;
  }
  /* 管端的光点：每根管子分到一批字形点 */
  np83 = 0;
  for (let k = 0; k < pc && np83 < MAXP83; k++) {
    const ci = Math.min(nch83 - 1, ((k * nch83 / pc) | 0));
    px83[np83] = blockGx + g.px[k];
    py83[np83] = blockGy + g.py[k];
    po83[np83] = ci;
    psz83[np83] = 1.1 + Math.random() * 1.3;
    pown83[np83] = g.own[k];
    ptm83[np83] = use.at[g.own[k]] || lineT;
    np83++;
  }
  gust83 = 1;
}

function mechEvent(k, first) {
  gust83 = first ? 1.8 : 1;
  wind83 = 1 + (first ? 0.7 : 0.3);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
  cam.ox = (k % 2 ? 1 : -1) * (first ? 16 : 8);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  gust83 *= Math.pow(0.05, dt);
  wind83 += (1 - wind83) * Math.min(1, dt * 1.5);
  cam.ox *= Math.pow(0.04, dt);
  const orb = T * 0.21;
  cam.oy = Math.sin(orb) * 12;
  /* 每根管：阻尼摆在风里 */
  for (let i = 0; i < nch83; i++) {
    const drive = Math.sin(T * 1.3 + cph83[i]) * 0.05 * wind83 + gust83 * Math.sin(T * 4 + i) * 0.03;
    cv83[i] += (-(ca83[i] - drive) * 26 - cv83[i] * 3.4) * dt;
    ca83[i] += cv83[i] * dt;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  /* 管：从挂点垂下的细线 + 一根金属管（描边） */
  ctx.strokeStyle = 'rgba(170,190,220,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < nch83; i++) {
    const ax = ct83[i], ay = cy83[i] - cl83[i];
    const bx = ct83[i] + Math.sin(ca83[i]) * cl83[i];
    const by = cy83[i] - Math.cos(ca83[i]) * cl83[i] * 0.55;
    const x0 = pjX(ax, ay), y0 = pjY(ax, ay), x1 = pjX(bx, by), y1 = pjY(bx, by);
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  }
  ctx.stroke();

  if (!L) return;

  /* 管身：粗一点的短线（两档） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? 'rgba(200,215,240,0.55)'
      : 'rgba(90,105,130,0.45)';
    ctx.beginPath();
    for (let i = 0; i < nch83; i++) {
      const bx = ct83[i] + Math.sin(ca83[i]) * cl83[i];
      const by = cy83[i] - Math.cos(ca83[i]) * cl83[i] * 0.55;
      const x1 = pjX(bx, by), y1 = pjY(bx, by);
      const x0 = pjX(ct83[i], cy83[i] - cl83[i] * 0.45), y0 = pjY(ct83[i], cy83[i] - cl83[i] * 0.45);
      if (x1 < -60 || x1 > W + 60 || y1 < -60 || y1 > H + 60) continue;
      const w = pass ? 3.2 : 5.2;
      ctx.rect((x0 + x1) * 0.5 - w * 0.5, Math.min(y0, y1), w, Math.abs(y1 - y0) + 1);
    }
    ctx.fill();
  }

  /* 管端的光点（字）：位置随管子摆动 */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 40)},${Math.min(255, ab + 30)},0.95)`
      : 'rgba(150,170,210,0.28)';
    ctx.beginPath();
    for (let i = 0; i < np83; i++) {
      if (T < ptm83[i] - 0.5) continue;
      const ci = po83[i];
      const bx = ct83[ci] + Math.sin(ca83[ci]) * cl83[ci];
      const by = cy83[ci] - Math.cos(ca83[ci]) * cl83[ci] * 0.55;
      const X = pjX(bx + (px83[i] - ct83[ci]) * 0.25, by + (py83[i] - (cy83[ci] - cl83[ci] * 0.55)) * 0.9);
      const Y = pjY(bx + (px83[i] - ct83[ci]) * 0.25, by + (py83[i] - (cy83[ci] - cl83[ci] * 0.55)) * 0.9);
      if (X < -10 || X > W + 10 || Y < -10 || Y > H + 10) continue;
      const s = psz83[i] * (pass ? 1.6 : 2.2) * z;
      ctx.rect(X - s * 0.5, Y - s * 0.5, s, s);
    }
    ctx.fill();
  }
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



