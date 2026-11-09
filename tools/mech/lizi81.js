/* lizi81 · 粒子书法 · brush
   一支看不见的毛笔在空中写字：笔锋带墨，墨点飞出去、悬在半空不落 ——
   字是**悬停的墨迹**，笔锋过处墨色由湿到干，飞白处留下断续的点。
   AE：镜头锁定追踪（跟着笔尖）+ 缓急变速 + 顿帧。 */

const N81 = 4200;
const mx81 = new Float32Array(N81), my81 = new Float32Array(N81);
const mtx81 = new Float32Array(N81), mty81 = new Float32Array(N81);
const mown81 = new Int16Array(N81), mat81 = new Float32Array(N81);
const msz81 = new Float32Array(N81), mwet81 = new Float32Array(N81);
const mord81 = new Float32Array(N81);
let n81 = 0, tipX81 = 0, tipY81 = 0, pen81 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N81; i++) {
    mx81[i] = 0; my81[i] = 0; mwet81[i] = 0;
    msz81[i] = 1.2 + Math.random() * 1.6;
  }
  n81 = N81;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n81 = Math.max(2000, Math.min(N81, Math.round(pc * 1.2)));
  pen81 = 0;
  for (let i = 0; i < n81; i++) {
    const pi = ((i * pc / n81) | 0) % pc;
    mtx81[i] = blockGx + g.px[pi] + rnd(-1.4, 1.4);
    mty81[i] = blockGy + g.py[pi] + rnd(-1.4, 1.4);
    mown81[i] = g.own[pi];
    mat81[i] = use.at[g.own[pi]] || lineT;
    mord81[i] = pi / pc;
    mx81[i] = mtx81[i]; my81[i] = mty81[i];
    mwet81[i] = 0;
  }
}

function mechEvent(k, first) {
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.04 : 0.02));
  cam.ox = (k % 2 ? 1 : -1) * (first ? 12 : 6);
  cam.oy = first ? -6 : -3;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  /* 笔锋沿笔画顺序推进（YRC 时间驱动） */
  pen81 = clamp01((T - lineT) / Math.max(1.0, lineDur * 0.9));
  for (let i = 0; i < n81; i++) {
    const age = T - mat81[i];
    if (age < 0) { mwet81[i] = Math.min(1, Math.max(0, 1 + age)); continue; }
    /* 墨点被"甩"到空中一点点，再定住 */
    if (mwet81[i] < 1.4) mwet81[i] += dt * 3;
    mx81[i] += (mtx81[i] - mx81[i]) * Math.min(1, dt * 7);
    my81[i] += (mty81[i] - my81[i]) * Math.min(1, dt * 7);
    /* 笔尖位置跟随正在写的那一段 */
    if (Math.abs(mord81[i] - pen81) < 0.02) { tipX81 = mtx81[i]; tipY81 = mty81[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (!L) return;

  /* 墨迹：湿墨（亮、偏冷）与干墨（暗、偏褐）两档 */
  for (let pass = 0; pass < 2; pass++) {
    const wet = pass === 1;
    ctx.fillStyle = wet
      ? `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 30)},${Math.min(255, ab + 34)},0.95)`
      : 'rgba(40,34,30,0.55)';
    ctx.beginPath();
    for (let i = 0; i < n81; i++) {
      const w = mwet81[i];
      if (w < 0.05 || T < mat81[i]) continue;
      if ((w > 0.8) !== wet) continue;
      const px = pjX(mx81[i], my81[i]), py = pjY(mx81[i], my81[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = msz81[i] * (wet ? 1.7 : 2.2) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 1.05);
    }
    ctx.fill();
  }

  /* 飞白：笔锋扫过时被甩出去的小墨点 */
  ctx.fillStyle = 'rgba(220,215,205,0.35)';
  ctx.beginPath();
  for (let i = 0; i < n81; i += 11) {
    if (mwet81[i] < 1) continue;
    const px = pjX(mx81[i] + Math.sin(T * 2 + i) * 7, my81[i] - 9 - (i % 5) * 3);
    const py = pjY(mx81[i] + Math.sin(T * 2 + i) * 7, my81[i] - 9 - (i % 5) * 3);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px - 0.9, py - 0.9, 1.8, 1.8);
  }
  ctx.fill();

  /* 笔尖：一个小亮点（让"在写"这件事看得见） */
  const tx = pjX(tipX81, tipY81), ty = pjY(tipX81, tipY81);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,250,235,0.55)';
  ctx.beginPath();
  ctx.rect(tx - 2.4, ty - 2.4, 4.8, 4.8);
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



