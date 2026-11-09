/* lizi82 · 脉冲星 · pulsar
   中子星高速自转，两道磁极光束扫过空间；被扫到的尘埃会**留亮**（磷光），
   一点点累积成字，然后缓慢暗下去。
   AE：扫描线 + 抽帧 + 冲击帧（光束扫过的瞬间）。 */

const N82 = 5200;
const dx82 = new Float32Array(N82), dy82 = new Float32Array(N82);
const dtx82 = new Float32Array(N82), dty82 = new Float32Array(N82);
const down82 = new Int16Array(N82), dat82 = new Float32Array(N82);
const dlit82 = new Float32Array(N82), dsz82 = new Float32Array(N82);
let n82 = 0, starX82 = 0, starY82 = 0, beam82 = 0, spin82 = 0;

function mechResize() {
  if (!W || !H) return;
  starX82 = W * 0.5; starY82 = H * 0.52;
  for (let i = 0; i < N82; i++) {
    dx82[i] = 0; dy82[i] = 0; dlit82[i] = 0;
    dsz82[i] = 1 + Math.random() * 1.4;
  }
  n82 = N82;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n82 = Math.max(2200, Math.min(N82, Math.round(pc * 1.25)));
  for (let i = 0; i < n82; i++) {
    const pi = ((i * pc / n82) | 0) % pc;
    dtx82[i] = blockGx + g.px[pi] + rnd(-1, 1);
    dty82[i] = blockGy + g.py[pi] + rnd(-1, 1);
    down82[i] = g.own[pi];
    dat82[i] = use.at[g.own[pi]] || lineT;
    dx82[i] = dtx82[i] + rnd(-40, 40);
    dy82[i] = dty82[i] + rnd(-40, 40);
    dlit82[i] = 0;
  }
  spin82 = 0;
}

function mechEvent(k, first) {
  spin82 += (first ? 1.2 : 0.5);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.04 : 0.02));
  camShake(1, 0.2, first ? 10 : 5);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.rot = Math.sin(T * 0.12) * 0.06;
  cam.ox = Math.sin(T * 0.2) * 18;
  beam82 = T * 2.6 + spin82;      /* 光束角 */
  /* 光束是两道对顶的锥，半角 0.16 */
  for (let i = 0; i < n82; i++) {
    if (T < dat82[i] - 0.5) continue;
    /* 尘埃被吸到字位 */
    dx82[i] += (dtx82[i] - dx82[i]) * Math.min(1, dt * 5);
    dy82[i] += (dty82[i] - dy82[i]) * Math.min(1, dt * 5);
    /* 光束扫过：算角度差 */
    const a = Math.atan2(dy82[i] - starY82, dx82[i] - starX82);
    let d1 = Math.abs(((a - beam82) % 6.283 + 6.283) % 6.283);
    if (d1 > 3.1416) d1 = 6.283 - d1;
    let d2 = Math.abs(((a - beam82 - 3.1416) % 6.283 + 6.283) % 6.283);
    if (d2 > 3.1416) d2 = 6.283 - d2;
    const on = Math.min(d1, d2) < 0.14;
    if (on) dlit82[i] = Math.min(1, dlit82[i] + dt * 9);
    else dlit82[i] *= Math.pow(0.45, dt);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const sx = pjX(starX82, starY82), sy = pjY(starX82, starY82);

  /* 两道光束：用锥形描边（两条射线 + 半透明扇形用矩形近似） */
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    const a = beam82 + k * 3.1416;
    for (let j = 0; j < 5; j++) {
      const w = 0.02 + j * 0.03;
      ctx.fillStyle = `rgba(150,200,255,${(0.05 - j * 0.008).toFixed(3)})`;
      ctx.beginPath();
      const rr = 900;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a - w) * rr, sy + Math.sin(a - w) * rr);
      ctx.lineTo(sx + Math.cos(a + w) * rr, sy + Math.sin(a + w) * rr);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* 中子星：小亮球 + 极点 */
  ctx.fillStyle = 'rgba(220,240,255,0.9)';
  ctx.beginPath();
  ctx.rect(sx - 5 * z, sy - 5 * z, 10 * z, 10 * z);
  ctx.fill();

  if (!L) return;

  /* 尘埃：被扫到的亮（磷光），没扫到的很暗 */
  for (let pass = 0; pass < 2; pass++) {
    const hot = pass === 1;
    ctx.fillStyle = hot
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 60)},${Math.min(255, ab + 60)},0.95)`
      : 'rgba(70,100,140,0.20)';
    ctx.beginPath();
    for (let i = 0; i < n82; i++) {
      if (T < dat82[i] - 0.5) continue;
      const lit = dlit82[i] > 0.35;
      if (lit !== hot) continue;
      const px = pjX(dx82[i], dy82[i]), py = pjY(dx82[i], dy82[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = dsz82[i] * (hot ? 1.7 : 1.2) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
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



