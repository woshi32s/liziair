/* lizi61 · 星云丝 · filaments
   卷曲噪波把气体拉成一束束细丝，丝在字形的位置打结、变亮；
   镜头在两三层丝之间缓慢横移，做出星云的厚度。
   AE：多层级视差 + 缓推 + 抽帧闪烁。 */

const N61 = 5600;
const fx61 = new Float32Array(N61), fy61 = new Float32Array(N61);
const ftx61 = new Float32Array(N61), fty61 = new Float32Array(N61);
const fown61 = new Int16Array(N61), fat61 = new Float32Array(N61);
const fdep61 = new Float32Array(N61), fsz61 = new Float32Array(N61);
const fz61 = new Float32Array(N61), fph61 = new Float32Array(N61);
let n61 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N61; i++) {
    fx61[i] = Math.random() * W; fy61[i] = Math.random() * H;
    fz61[i] = Math.random(); fph61[i] = Math.random() * 6.283;
    fsz61[i] = 0.9 + Math.random() * 1.4;
    fdep61[i] = 0;
  }
  n61 = N61;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n61 = Math.max(2400, Math.min(N61, Math.round(pc * 1.5)));
  for (let i = 0; i < n61; i++) {
    const pi = ((i * pc / n61) | 0) % pc;
    ftx61[i] = blockGx + g.px[pi] + rnd(-6, 6);
    fty61[i] = blockGy + g.py[pi] + rnd(-6, 6);
    fown61[i] = g.own[pi];
    fat61[i] = use.at[g.own[pi]] || use.lineT;
    fdep61[i] = 0;
  }
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? 1 : -1) * (first ? 30 : 15);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.04, dt);
  /* 缓慢横移 + 推拉：像镜头在丝之间穿过 */
  cam.oy = Math.sin(T * 0.24) * 18;
  const t = T * 0.55;
  for (let i = 0; i < n61; i++) {
    if (T < fat61[i] - 0.6) {
      /* 卷曲噪波：丝在漂 */
      const s = 0.008 * (0.5 + fz61[i]);
      const vx = Math.cos(fy61[i] * s + t) * 40 + Math.sin((fx61[i] - fy61[i]) * s * 0.6 - t * 0.7) * 26;
      const vy = -Math.sin(fx61[i] * s + t * 1.2) * 34 + Math.cos((fx61[i] + fy61[i]) * s * 0.5 + t) * 22;
      fx61[i] += vx * dt; fy61[i] += vy * dt;
      if (fx61[i] < -30) fx61[i] = W + 30; if (fx61[i] > W + 30) fx61[i] = -30;
      if (fy61[i] < -30) fy61[i] = H + 30; if (fy61[i] > H + 30) fy61[i] = -30;
      continue;
    }
    /* 丝打结：被拉到字形点上 */
    const dx = ftx61[i] - fx61[i], dy = fty61[i] - fy61[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    const k = Math.min(1, dt * (near ? 7.5 : 2.6));
    fx61[i] += dx * k; fy61[i] += dy * k;
    if (d < 3) { fdep61[i] = 1; fx61[i] = ftx61[i]; fy61[i] = fty61[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 三层丝：越远越暗 */
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(60,90,140,0.10)'
      : pass === 1
        ? 'rgba(90,140,200,0.16)'
        : 'rgba(140,200,255,0.24)';
    ctx.beginPath();
    for (let i = 0; i < n61; i++) {
      const band = fz61[i] < 0.34 ? 0 : fz61[i] < 0.7 ? 1 : 2;
      if (band !== pass) continue;
      const px = pjX(fx61[i], fy61[i]), py = pjY(fx61[i], fy61[i]);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      const s = fsz61[i] * (1.2 + fz61[i]) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s * (2.4 + fz61[i] * 2), s);
    }
    ctx.fill();
  }

  /* 结（字）：亮白 + 主色 */
  if (!L) return;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 44)},${Math.min(255, ab + 40)},0.95)`
      : 'rgba(120,170,220,0.30)';
    ctx.beginPath();
    for (let i = 0; i < n61; i++) {
      if (!fdep61[i]) continue;
      const px = pjX(fx61[i], fy61[i]), py = pjY(fx61[i], fy61[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = fsz61[i] * (pass ? 1.9 : 2.8) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
  void fown61;
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



