/* lizi79 · 粒子织机 · loom
   经纬线在织机上交错：梭子拖着纬线穿过经线，织出的图案就是字。
   每一根纬线只在需要的位置压下去（形成凸起的纹样），所以字是织出来的浮雕。
   AE：缓推 + 抽帧（梭子按 1/16s 走格）+ 顿帧。 */

const N79 = 5200;
const lx79 = new Float32Array(N79), ly79 = new Float32Array(N79);
const ltx79 = new Float32Array(N79), lty79 = new Float32Array(N79);
const lown79 = new Int16Array(N79), lat79 = new Float32Array(N79);
const lsz79 = new Float32Array(N79), lph79 = new Float32Array(N79);
let n79 = 0, shuttle79 = 0, weaveCv79 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N79; i++) {
    lx79[i] = 0; ly79[i] = 0; lph79[i] = Math.random() * 6.283;
    lsz79[i] = 1.1 + Math.random() * 1.3;
  }
  n79 = N79;
  if (!weaveCv79) weaveCv79 = document.createElement('canvas');
  weaveCv79.width = Math.max(2, Math.round(W / 2));
  weaveCv79.height = Math.max(2, Math.round(H / 2));
  const c = weaveCv79.getContext('2d');
  const bw = weaveCv79.width, bh = weaveCv79.height;
  c.fillStyle = '#12100e'; c.fillRect(0, 0, bw, bh);
  /* 经线：竖向的细密线 */
  c.strokeStyle = 'rgba(220,205,175,0.10)';
  c.lineWidth = 1;
  for (let x = 0; x < bw; x += 6) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, bh); c.stroke();
  }
  /* 纬线：横向，稍粗 */
  c.strokeStyle = 'rgba(200,185,155,0.08)';
  for (let y = 0; y < bh; y += 7) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(bw, y); c.stroke();
  }
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n79 = Math.max(2000, Math.min(N79, Math.round(pc * 1.2)));
  shuttle79 = 0;
  for (let i = 0; i < n79; i++) {
    const pi = ((i * pc / n79) | 0) % pc;
    ltx79[i] = blockGx + g.px[pi] + rnd(-0.9, 0.9);
    lty79[i] = blockGy + g.py[pi] + rnd(-0.9, 0.9);
    lown79[i] = g.own[pi];
    lat79[i] = use.at[g.own[pi]] || lineT;
    /* 从最近的经线位置开始（沿 x 对齐） */
    lx79[i] = ltx79[i];
    ly79[i] = lty79[i] - rnd(20, 120);
  }
}

function mechEvent(k, first) {
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
  cam.oy = first ? 5 : 2;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.oy *= Math.pow(0.05, dt);
  /* 梭子横向推进，每 1/16s 走一格 */
  shuttle79 = (Math.floor(T * 16) % 120) / 120;
  for (let i = 0; i < n79; i++) {
    const ready = T >= lat79[i];
    const target = ready ? lty79[i] : lty79[i] - 30;
    const k = Math.min(1, dt * (ready ? 7 : 2));
    ly79[i] += (target - ly79[i]) * k;
    /* 纬线压下去之后，左右微微张开（织纹） */
    lx79[i] += (ltx79[i] + (ready ? Math.sin(T * 3 + lph79[i]) * 1.4 : 0) - lx79[i]) * Math.min(1, dt * 6);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (weaveCv79) ctx.drawImage(weaveCv79, 0, 0, W, H);

  if (!L) return;
  /* 纬线：一条正在推进的亮线 */
  const sy = pjY(0, H * 0.16);
  ctx.fillStyle = 'rgba(255,220,150,0.16)';
  ctx.fillRect(0, sy, W, 2);

  /* 织纹（字）：凸起的纬线 + 高光 */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 24)},${Math.min(255, ag + 20)},${Math.min(255, ab + 10)},0.92)`
      : 'rgba(150,135,110,0.30)';
    ctx.beginPath();
    for (let i = 0; i < n79; i++) {
      if (T < lat79[i]) continue;
      const px = pjX(lx79[i], ly79[i]), py = pjY(lx79[i], ly79[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = lsz79[i] * (pass ? 1.5 : 1.1) * z;
      /* 织纹是横向的短段 */
      if (pass) ctx.rect(px - s * 1.2, py - s * 0.42, s * 2.4, s * 0.84);
      else ctx.rect(px - s * 1.6, py - s * 0.5, s * 3.2, s);
    }
    ctx.fill();
  }

  /* 梭子：一个小小的亮点，从左往右 */
  const px = pjX(shuttle79 * W, H * 0.16);
  ctx.fillStyle = 'rgba(255,240,200,0.85)';
  ctx.beginPath();
  ctx.rect(px - 4, sy - 3, 8, 5);
  ctx.fill();
  void T;
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



