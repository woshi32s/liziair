/* lizi69 · 深海热泉 · hydrothermal
   海底裂口喷出滚烫的黑烟柱，矿物微粒在烟柱里沉降、堆成硫化物丘 ——
   字是那些**堆起来的高地**。喷口每唱一句就喷发一次，烟柱把字埋掉一半又露出来。
   AE：缓推 + 体积雾 + 冲击帧。 */

const N69 = 5400;
const px69 = new Float32Array(N69), py69 = new Float32Array(N69);
const pvx69 = new Float32Array(N69), pvy69 = new Float32Array(N69);
const ptx69 = new Float32Array(N69), pty69 = new Float32Array(N69);
const pown69 = new Int16Array(N69), pat69 = new Float32Array(N69);
const pst69 = new Uint8Array(N69), psz69 = new Float32Array(N69);
const pheat69 = new Float32Array(N69);
let n69 = 0, ventY69 = 0, ventX69 = 0, erupt69 = 0;

function mechResize() {
  if (!W || !H) return;
  ventY69 = H * 0.88;
  ventX69 = W * 0.5;
  for (let i = 0; i < N69; i++) {
    px69[i] = ventX69 + rnd(-10, 10); py69[i] = ventY69;
    pvx69[i] = 0; pvy69[i] = 0; pst69[i] = 0; pheat69[i] = 0;
    psz69[i] = 1 + Math.random() * 1.4;
  }
  n69 = N69;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n69 = Math.max(2200, Math.min(N69, Math.round(pc * 1.25)));
  erupt69 = 1;
  for (let i = 0; i < n69; i++) {
    const pi = ((i * pc / n69) | 0) % pc;
    ptx69[i] = blockGx + g.px[pi] + rnd(-1, 1);
    pty69[i] = blockGy + g.py[pi] + rnd(-1, 1);
    pown69[i] = g.own[pi];
    pat69[i] = use.at[g.own[pi]] || use.lineT;
    pst69[i] = 0; pheat69[i] = 0;
    px69[i] = ventX69 + rnd(-14, 14); py69[i] = ventY69 - rnd(0, 20);
    pvx69[i] = rnd(-30, 30); pvy69[i] = -rnd(120, 320);
  }
}

function mechEvent(k, first) {
  erupt69 = first ? 1.8 : 1.1;
  cam.oy = first ? -8 : -4;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  erupt69 *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  cam.ox = Math.sin(T * 0.35) * 14;
  for (let i = 0; i < n69; i++) {
    if (pst69[i]) { pheat69[i] *= Math.exp(-dt / 2); continue; }
    if (T < pat69[i] - 0.5) {
      /* 还在烟柱里翻：被热对流托着 */
      pvy69[i] += (-140 - erupt69 * 120) * dt;
      pvx69[i] += Math.sin(py69[i] * 0.02 + T * 1.3 + i) * 60 * dt;
      pvy69[i] *= Math.pow(0.9, dt);
      px69[i] += pvx69[i] * dt; py69[i] += pvy69[i] * dt;
      if (py69[i] < -40) { px69[i] = ventX69 + rnd(-16, 16); py69[i] = ventY69; }
      continue;
    }
    /* 该落到字位上了：矿物沉降 */
    const dx = ptx69[i] - px69[i], dy = pty69[i] - py69[i];
    const d = Math.hypot(dx, dy);
    const near = d < 90;
    pvx69[i] += dx * (near ? 26 : 8) * dt - pvx69[i] * (near ? 8.5 : 1.6) * dt;
    pvy69[i] += dy * (near ? 26 : 8) * dt - pvy69[i] * (near ? 8.5 : 1.6) * dt;
    const sp = Math.hypot(pvx69[i], pvy69[i]);
    if (sp > 900) { const s = 900 / sp; pvx69[i] *= s; pvy69[i] *= s; }
    px69[i] += pvx69[i] * dt; py69[i] += pvy69[i] * dt;
    if (d < 2.4 || T > pat69[i] + 1.6) { pst69[i] = 1; px69[i] = ptx69[i]; py69[i] = pty69[i]; pheat69[i] = 1; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 海底：底部暗红 + 一层热泉的浑水 */
  const vy = pjY(0, ventY69);
  ctx.fillStyle = 'rgba(12,8,8,0.9)';
  ctx.fillRect(0, vy, W, H - vy + 2);
  ctx.fillStyle = 'rgba(120,60,30,0.10)';
  ctx.beginPath();
  for (let k = 0; k < 6; k++) ctx.rect(0, pjY(0, ventY69 - 30 - k * 26), W, 18);
  ctx.fill();

  /* 黑烟柱：还没落定的粒子，越远越淡 */
  ctx.fillStyle = 'rgba(60,50,55,0.35)';
  ctx.beginPath();
  for (let i = 0; i < n69; i++) {
    if (pst69[i] || T >= pat69[i] - 0.5) continue;
    const px = pjX(px69[i], py69[i]), py = pjY(px69[i], py69[i]);
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    const s = psz69[i] * 3.4 * z;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
  }
  ctx.fill();

  /* 喷口 */
  ctx.fillStyle = 'rgba(30,20,18,0.95)';
  ctx.beginPath();
  ctx.rect(pjX(ventX69 - 26, ventY69), vy, 52 * z, (H - ventY69) * z + 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,120,40,0.35)';
  ctx.beginPath();
  ctx.rect(pjX(ventX69 - 18, ventY69), vy - 2, 36 * z, 5);
  ctx.fill();

  if (!L) return;

  /* 先画一层很暗的字形幽灵：还没沉降过来的粒子也标出字位，保证任何时刻都读得出来 */
  ctx.fillStyle = 'rgba(120,90,60,0.16)';
  ctx.beginPath();
  for (let i = 0; i < n69; i++) {
    if (pst69[i]) continue;
    const px2 = pjX(ptx69[i], pty69[i]), py2 = pjY(ptx69[i], pty69[i]);
    if (px2 < -10 || px2 > W + 10 || py2 < -10 || py2 > H + 10) continue;
    ctx.rect(px2 - 1.2, py2 - 1.2, 2.4, 2.4);
  }
  ctx.fill();

  /* 硫化物丘（字）：暗色丘体 + 亮的热斑 */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(120,90,60,0.42)'
      : `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 24)},${Math.min(255, ab - 20)},0.95)`;
    ctx.beginPath();
    for (let i = 0; i < n69; i++) {
      if (!pst69[i]) continue;
      const px = pjX(px69[i], py69[i]), py = pjY(px69[i], py69[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = psz69[i] * (pass ? 1.7 : 2.8) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
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



