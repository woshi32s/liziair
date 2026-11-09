/* lizi86 · 沙暴 · sandstorm
   一堵沙墙从右侧横扫过来，墙上的**缺口**就是字 —— 缺口边缘的沙被撕成丝，
   透过缺口能看到后面干净的天空。风越大，缺口边缘越亮。
   AE：缓急变速（阵风）+ 多层级视差 + 冲击帧。 */

const N86 = 6000;
const sx86 = new Float32Array(N86), sy86 = new Float32Array(N86);
const svx86 = new Float32Array(N86), svy86 = new Float32Array(N86);
const sz86 = new Float32Array(N86), sph86 = new Float32Array(N86);
const smask86 = new Uint8Array(N86), stm86 = new Float32Array(N86);
const scx86 = new Float32Array(N86), scy86 = new Float32Array(N86);
let n86 = 0, wallX86 = 0, gust86 = 0, skyCv86 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N86; i++) {
    sx86[i] = Math.random() * W; sy86[i] = Math.random() * H;
    svx86[i] = rnd(60, 160); svy86[i] = rnd(-10, 10);
    sz86[i] = 1 + Math.random() * 2; sph86[i] = Math.random() * 6.283;
    smask86[i] = 0;
  }
  n86 = N86;
  if (!skyCv86) skyCv86 = document.createElement('canvas');
  skyCv86.width = 4; skyCv86.height = 256;
  const c = skyCv86.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(16,20,26,1)');
  g.addColorStop(0.45, 'rgba(58,46,32,1)');
  g.addColorStop(0.75, 'rgba(86,64,38,1)');
  g.addColorStop(1, 'rgba(36,26,16,1)');
  c.fillStyle = g; c.fillRect(0, 0, 4, 256);
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n86 = Math.max(2400, Math.min(N86, Math.round(pc * 1.4)));
  for (let i = 0; i < n86; i++) {
    const pi = ((i * pc / n86) | 0) % pc;
    scx86[i] = blockGx + g.px[pi];
    scy86[i] = blockGy + g.py[pi];
    stm86[i] = use.at[g.own[pi]] || lineT;
    /* 字形附近撒一圈"缺口"粒子 */
    sx86[i] = scx86[i] + rnd(-3, 3);
    sy86[i] = scy86[i] + rnd(-3, 3);
    smask86[i] = 1;
  }
  gust86 = 1;
}

function mechEvent(k, first) {
  gust86 = first ? 1.8 : 1;
  cam.ox = -(first ? 36 : 18);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  gust86 *= Math.pow(0.05, dt);
  cam.ox *= Math.pow(0.04, dt);
  wallX86 = W * 0.55 + Math.sin(T * 0.5) * W * 0.1;
  const Wv = 220 * (1 + gust86);
  for (let i = 0; i < n86; i++) {
    if (smask86[i]) {
      /* 缺口粒子：被风撕开，往缺口外缘跑 */
      const dx = sx86[i] - scx86[i], dy = sy86[i] - scy86[i];
      const l = Math.hypot(dx, dy) || 1;
      const push = 4 + Math.sin(T * 3 + sph86[i]) * 2;
      const tx = scx86[i] + dx / l * (8 + push);
      const ty = scy86[i] + dy / l * (8 + push);
      sx86[i] += (tx - sx86[i]) * Math.min(1, dt * 2.4);
      sy86[i] += (ty - sy86[i]) * Math.min(1, dt * 2.4);
      continue;
    }
    /* 沙墙：从右向左 */
    sx86[i] -= (Wv + 60 + Math.sin(sy86[i] * 0.01 + T) * 40) * dt;
    sy86[i] += Math.sin(T * 2 + sph86[i]) * 26 * dt;
    if (sx86[i] < -60) { sx86[i] = W + 60; sy86[i] = Math.random() * H; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 天空：干净的暖色（透过缺口能看到） */
  if (skyCv86) ctx.drawImage(skyCv86, 0, 0, W, H);
  ctx.fillStyle = 'rgba(10,8,6,0.35)';
  ctx.fillRect(0, 0, W, H);

  if (!L) return;

  /* 沙墙：大量沙粒，暗金色（三档密度） */
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(120,90,50,0.10)'
      : pass === 1
        ? 'rgba(170,125,70,0.12)'
        : 'rgba(215,170,105,0.14)';
    ctx.beginPath();
    for (let i = 0; i < n86; i++) {
      if (smask86[i]) continue;
      if ((i % 3) !== pass) continue;
      const px = pjX(sx86[i], sy86[i]), py = pjY(sx86[i], sy86[i]);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      const s = sz86[i] * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s * 1.6, s);
    }
    ctx.fill();
  }

  /* 缺口边缘：被撕开的沙丝（亮） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 50)},${Math.min(255, ag + 40)},${Math.min(255, ab + 10)},0.9)`
      : 'rgba(200,160,100,0.25)';
    ctx.beginPath();
    for (let i = 0; i < n86; i++) {
      if (!smask86[i]) continue;
      if (T < stm86[i] - 0.4) continue;
      const px = pjX(sx86[i], sy86[i]), py = pjY(sx86[i], sy86[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = sz86[i] * (pass ? 1.5 : 2.2) * z;
      /* 沿风向拉成丝 */
      ctx.rect(px - s * 0.5, py - s * 0.35, s * (pass ? 2.4 : 1.4), s * 0.7);
    }
    ctx.fill();
  }
  void wallX86;
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



