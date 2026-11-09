/* lizi88 · 冰晶悬浮 · ice-float
   六角冰晶在失重舱里缓慢自转，晶面的反光在转动时扫过 ——
   晶体的**排列**组成字：每个字形点悬浮着一片冰晶，晶面一亮一暗。
   AE：环绕运镜 + 焦点滑动 + 抽帧。 */

const N88 = 2200;
const cx88 = new Float32Array(N88), cy88 = new Float32Array(N88);
const cz88 = new Float32Array(N88), cr88 = new Float32Array(N88);
const ca88 = new Float32Array(N88), csp88 = new Float32Array(N88);
const ctm88 = new Float32Array(N88), csz88 = new Float32Array(N88);
const cown88 = new Int16Array(N88);
let n88 = 0, orb88 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N88; i++) {
    cz88[i] = rnd(-1, 1); cr88[i] = 6 + Math.random() * 8;
    ca88[i] = Math.random() * 6.283; csp88[i] = rnd(-1.2, 1.2);
    csz88[i] = 1; ctm88[i] = 1e9;
  }
  n88 = N88;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  /* 冰晶用稀疏采样：每个晶体覆盖一小片笔画 */
  const step = Math.max(1, (pc / 1400) | 0);
  n88 = 0;
  for (let k = 0; k < pc && n88 < N88; k += step * 2) {
    cx88[n88] = blockGx + g.px[k] + rnd(-2, 2);
    cy88[n88] = blockGy + g.py[k] + rnd(-2, 2);
    cz88[n88] = rnd(-1, 1);
    cr88[n88] = 5 + Math.random() * 7;
    ca88[n88] = Math.random() * 6.283;
    csp88[n88] = rnd(-1.4, 1.4);
    ctm88[n88] = use.at[g.own[k]] || lineT;
    cown88[n88] = g.own[k];
    csz88[n88] = 1;
    n88++;
  }
  orb88 = 0;
}

function mechEvent(k, first) {
  orb88 += (k % 2 ? 1 : -1) * (first ? 0.5 : 0.2);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.035 : 0.016));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.rot = Math.sin(T * 0.14) * 0.07;
  const orb = T * 0.2 + orb88;
  cam.ox = Math.cos(orb) * 20;
  cam.oy = Math.sin(orb * 1.3) * 10;
  for (let i = 0; i < n88; i++) {
    if (T < ctm88[i] - 0.5) continue;
    ca88[i] += csp88[i] * dt;
    /* 深度：缓慢前后漂浮 */
    cz88[i] += Math.sin(T * 0.4 + i) * 0.002;
    if (cz88[i] > 1) cz88[i] = 1; if (cz88[i] < -1) cz88[i] = -1;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (!L) return;

  /* 分两档深度：后面暗、前面亮 */
  for (let pass = 0; pass < 2; pass++) {
    const near = pass === 1;
    ctx.fillStyle = near
      ? `rgba(${Math.min(255, ar + 70)},${Math.min(255, ag + 80)},${Math.min(255, ab + 90)},0.95)`
      : 'rgba(110,160,200,0.30)';
    ctx.beginPath();
    for (let i = 0; i < n88; i++) {
      if (T < ctm88[i] - 0.5) continue;
      if ((cz88[i] > 0) !== near) continue;
      const persp = 1 + cz88[i] * 0.22;
      const sx = pjX(cx88[i], cy88[i]), sy = pjY(cx88[i], cy88[i]);
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
      const r = cr88[i] * persp * z;
      /* 六角冰晶：三个方向的菱形叠出六角星 */
      const a = ca88[i];
      const c1 = Math.cos(a), s1 = Math.sin(a);
      /* 竖菱形 */
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r * 0.55 * c1, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r * 0.55 * c1, sy);
      ctx.closePath();
      /* 横菱形 */
      ctx.moveTo(sx - r * 0.9, sy + r * 0.2 * s1);
      ctx.lineTo(sx, sy - r * 0.3);
      ctx.lineTo(sx + r * 0.9, sy + r * 0.2 * s1);
      ctx.lineTo(sx, sy + r * 0.5);
      ctx.closePath();
    }
    ctx.fill();
  }

  /* 晶面的高光（一次性小亮点） */
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  for (let i = 0; i < n88; i += 3) {
    if (T < ctm88[i] - 0.5) continue;
    const sx = pjX(cx88[i], cy88[i]), sy = pjY(cx88[i], cy88[i]);
    if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
    const r = cr88[i] * z;
    ctx.rect(sx - r * 0.18, sy - r * 0.7, r * 0.36, r * 0.36);
  }
  ctx.fill();
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



