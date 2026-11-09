/* lizi58 · 极地风暴 · polar-storm
   暴风雪横扫：雪粒被风拉成一道道白线，遇到"看不见的挡板"就粘住、堆成雪脊 ——
   **字就是雪堆出来的那道浮雕**。风越大，雪脊越往背风侧飘。
   AE：定向震动 + 缓急变速（阵风）+ 抽帧。 */

const N58 = 5200;
const nx58 = new Float32Array(N58), ny58 = new Float32Array(N58);
const nvx58 = new Float32Array(N58), nvy58 = new Float32Array(N58);
const ntx58 = new Float32Array(N58), nty58 = new Float32Array(N58);
const nat58 = new Float32Array(N58), nst58 = new Uint8Array(N58);
const nsz58 = new Float32Array(N58), nown58 = new Int16Array(N58);
let n58 = 0, gust58 = 0, wind58 = 1;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N58; i++) {
    nx58[i] = Math.random() * W; ny58[i] = Math.random() * H;
    nvx58[i] = rnd(300, 700); nvy58[i] = rnd(20, 140);
    nsz58[i] = 1 + Math.random() * 1.5;
    nst58[i] = 0;
  }
  n58 = N58;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n58 = Math.max(2000, Math.min(N58, Math.round(pc * 1.2)));
  for (let i = 0; i < n58; i++) {
    const pi = ((i * pc / n58) | 0) % pc;
    ntx58[i] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    nty58[i] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    nat58[i] = use.at[g.own[pi]] || use.lineT;
    nown58[i] = g.own[pi];
    nst58[i] = 0;
    nx58[i] = ntx58[i] - rnd(120, 420);
    ny58[i] = nty58[i] + rnd(-60, 60);
  }
}

function mechEvent(k, first) {
  gust58 = first ? 1.8 : 1;
  wind58 = 1 + (first ? 0.7 : 0.35);
  camCamSnap(first);
  cam.ox = -(first ? 34 : 18);
  cam.oy = 5;
}
function camCamSnap(first) { cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.04 : 0.02)); }

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  gust58 *= Math.pow(0.06, dt);
  wind58 += (1 - wind58) * Math.min(1, dt * 1.6);
  cam.ox *= Math.pow(0.04, dt);
  cam.oy *= Math.pow(0.05, dt);
  const Wv = (520 + Math.sin(T * 1.3) * 120) * wind58;
  for (let i = 0; i < n58; i++) {
    if (nst58[i]) continue;
    if (T < nat58[i] - 0.5) {
      /* 还没轮到：被风横着吹 */
      nx58[i] += Wv * dt;
      ny58[i] += (60 + Math.sin(T * 2 + i) * 40) * dt;
      if (nx58[i] > W + 40) { nx58[i] = -40; ny58[i] = Math.random() * H; }
      if (ny58[i] > H + 40) ny58[i] = -40;
      continue;
    }
    /* 被雪板挡住：硬弹簧 + 强阻尼（雪是脆的，一次就停） */
    const dx = ntx58[i] - nx58[i], dy = nty58[i] - ny58[i];
    const d = Math.hypot(dx, dy);
    const near = d < 60;
    nvx58[i] += dx * (near ? 40 : 16) * dt - nvx58[i] * (near ? 12 : 3) * dt;
    nvy58[i] += dy * (near ? 40 : 16) * dt - nvy58[i] * (near ? 12 : 3) * dt;
    nvx58[i] += Wv * 0.25 * dt;
    nx58[i] += nvx58[i] * dt; ny58[i] += nvy58[i] * dt;
    if (d < 1.8) { nst58[i] = 1; nx58[i] = ntx58[i]; ny58[i] = nty58[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 背景：极地平面上的一层冷雾（几条横带） */
  ctx.fillStyle = 'rgba(120,150,190,0.05)';
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const y = H * (0.25 + k * 0.11) + Math.sin(T * 0.6 + k) * 8;
    ctx.rect(0, pjY(0, y), W, 24 * z);
  }
  ctx.fill();

  /* 风雪：速度拉伸的白线（两档深浅） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? 'rgba(170,200,235,0.20)' : 'rgba(235,248,255,0.65)';
    ctx.beginPath();
    for (let i = 0; i < n58; i++) {
      if (nst58[i]) continue;
      if ((i % 3 === 0) !== (pass === 1)) continue;
      const px = pjX(nx58[i], ny58[i]), py = pjY(nx58[i], ny58[i]);
      if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
      const len = 12 + (i % 5) * 4;
      ctx.rect(px - len, py, len, 1.4);
    }
    ctx.fill();
  }

  /* 雪脊（字）：暗影 + 亮面 */
  if (!L) return;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(120,150,185,0.25)'
      : `rgba(${Math.min(255, ar + 50)},${Math.min(255, ag + 56)},${Math.min(255, ab + 56)},0.95)`;
    ctx.beginPath();
    for (let i = 0; i < n58; i++) {
      if (!nst58[i]) continue;
      const px = pjX(nx58[i], ny58[i]), py = pjY(nx58[i], ny58[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = nsz58[i] * (pass ? 1.7 : 2.6) * z;
      /* 背风侧拉出雪尾 */
      if (pass) ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      else ctx.rect(px - s * 0.5 + gust58 * 3, py - s * 0.5, s, s * 1.2);
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



