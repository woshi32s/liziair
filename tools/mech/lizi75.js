/* lizi75 · 拉花曲线 · spirograph
   几百条缎带从画面外甩进来，互相叠成花；缎带收束的地方正好落在字上 ——
   字是**缎带的汇聚点**。缎带走的是三次贝塞尔，控制点随时间绕圈，所以一直在卷。
   AE：环绕运镜 + 抽帧 + 缓急变速。 */

const N75 = 4200;
const rx75 = new Float32Array(N75), ry75 = new Float32Array(N75);
const tx75 = new Float32Array(N75), ty75 = new Float32Array(N75);
const ox75 = new Float32Array(N75), oy75 = new Float32Array(N75);
const tk75 = new Float32Array(N75), tph75 = new Float32Array(N75);
const ts75 = new Float32Array(N75), town75 = new Int16Array(N75);
const tat75 = new Float32Array(N75);
let n75 = 0, cx75 = 0, cy75 = 0;

function mechResize() {
  if (!W || !H) return;
  cx75 = W / 2; cy75 = H * 0.46;
  for (let i = 0; i < N75; i++) {
    rx75[i] = 0; ry75[i] = 0; ox75[i] = 0; oy75[i] = 0;
    tph75[i] = Math.random() * 6.283; ts75[i] = 1 + Math.random() * 1.4;
  }
  n75 = N75;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n75 = Math.max(1800, Math.min(N75, Math.round(pc * 1.15)));
  for (let i = 0; i < n75; i++) {
    const pi = ((i * pc / n75) | 0) % pc;
    tx75[i] = blockGx + g.px[pi] + rnd(-0.8, 0.8);
    ty75[i] = blockGy + g.py[pi] + rnd(-0.8, 0.8);
    town75[i] = g.own[pi];
    tat75[i] = use.at[g.own[pi]] || use.lineT;
    /* 起点在画面外一圈 */
    const a = Math.random() * 6.283;
    const rr = Math.max(W, H) * (0.62 + Math.random() * 0.3);
    ox75[i] = cx75 + Math.cos(a) * rr;
    oy75[i] = cy75 + Math.sin(a) * rr * 0.7;
    tk75[i] = 0.25 + Math.random() * 0.5;
  }
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? 1 : -1) * (first ? 26 : 13);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.035 : 0.016));
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.25 : 0.12);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.04, dt);
  /* 环绕：镜头缓慢绕圈 */
  const orb = T * 0.23;
  cam.oy = Math.sin(orb) * 16;
  const q = Math.floor(T * 20) / 20;   /* 抽帧：贝塞尔控制点按 1/20s 跳 */
  for (let i = 0; i < n75; i++) {
    const age = T - tat75[i];
    /* 汇聚进度：唱到就把缎带收到字位 */
    const want = age < -0.5 ? 0 : (age < 0 ? (age + 0.5) * 2 : 1);
    tk75[i] += (want - tk75[i]) * Math.min(1, dt * (want > tk75[i] ? 5 : 2));
    /* 控制点：绕着字位打转 */
    const a = tph75[i] + q * 0.9;
    const rad = 60 + 90 * Math.sin(q * 0.7 + tph75[i]);
    const cxp = tx75[i] + Math.cos(a) * rad;
    const cyp = ty75[i] + Math.sin(a * 1.3) * rad * 0.6;
    /* 在起点与字位之间做二次贝塞尔（t 由 tk 决定） */
    const t = tk75[i];
    const u = 1 - t;
    const x = u * u * ox75[i] + 2 * u * t * cxp + t * t * tx75[i];
    const y = u * u * oy75[i] + 2 * u * t * cyp + t * t * ty75[i];
    rx75[i] = x; ry75[i] = y;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (!L) return;
  /* 缎带：每颗粒子拉成一小段（沿切线），两档 */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 40)},${Math.min(255, ab + 40)},0.85)`
      : 'rgba(110,140,190,0.22)';
    ctx.beginPath();
    for (let i = 0; i < n75; i++) {
      if ((i % 4 === 0) !== (pass === 1)) continue;
      const px = pjX(rx75[i], ry75[i]), py = pjY(rx75[i], ry75[i]);
      if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
      const s = ts75[i] * (pass ? 1.5 : 1.1) * z;
      /* 拉长的短条 = 缎带的丝 */
      ctx.rect(px - s * 1.8, py - s * 0.42, s * 3.6, s * 0.84);
    }
    ctx.fill();
  }

  /* 缎带汇聚处（字）的亮结 */
  ctx.fillStyle = 'rgba(255,246,225,0.55)';
  ctx.beginPath();
  for (let i = 0; i < n75; i += 5) {
    if (tk75[i] < 0.9) continue;
    const px = pjX(rx75[i], ry75[i]), py = pjY(rx75[i], ry75[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px - 1.1, py - 1.1, 2.2, 2.2);
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



