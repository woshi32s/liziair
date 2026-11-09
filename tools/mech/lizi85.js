/* lizi85 · 粒子潮汐 · tidal
   三维水面被月亮拉起潮汐：水面起伏成浪，**浪脊连成字**。
   低角度看过去，浪脊是亮的一条条白线，字就浮在水面上。
   AE：低角度 + 缓推 + 抽帧（浪按 1/20s 步进）。 */

const GW85 = 96, GH85 = 46;
const N85 = GW85 * GH85;
const wx85 = new Float32Array(N85), wy85 = new Float32Array(N85);
const wz85 = new Float32Array(N85), wg85 = new Float32Array(N85);
const wb85 = new Float32Array(N85), wt85 = new Float32Array(N85);
let n85 = 0, moonPhase85 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N85; i++) {
    wz85[i] = 0; wg85[i] = 0; wb85[i] = 0; wt85[i] = 1e9;
  }
  n85 = N85;
}

function mechAssign(use) {
  const g = use.g;
  wg85.fill(0);
  for (let i = 0; i < N85; i++) wt85[i] = 1e9;
  /* 字形 → 水面网格 */
  for (let k = 0; k < g.pc; k++) {
    const wx = blockGx + g.px[k], wy = blockGy + g.py[k];
    const gi = ((wx / W) * GW85) | 0;
    const gj = (((wy - H * 0.34) / (H * 0.42)) * GH85) | 0;
    if (gi < 0 || gj < 0 || gi >= GW85 || gj >= GH85) continue;
    const id = gj * GW85 + gi;
    wg85[id] = 1;
    const at = use.at[Math.min(g.n - 1, g.own[k])] || lineT;
    if (at < wt85[id]) wt85[id] = at;
  }
  moonPhase85 = 1;
}

function mechEvent(k, first) {
  moonPhase85 = first ? 1.8 : 1;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.035 : 0.016));
  cam.oy = first ? -9 : -5;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  moonPhase85 *= Math.pow(0.05, dt);
  cam.oy *= Math.pow(0.05, dt);
  cam.ox = Math.sin(T * 0.22) * 20;
  const q = Math.floor(T * 20) / 20;
  for (let j = 0; j < GH85; j++) {
    for (let i = 0; i < GW85; i++) {
      const id = j * GW85 + i;
      const x = (i / (GW85 - 1) - 0.5) * W * 1.2;
      const y = H * 0.34 + (j / (GH85 - 1)) * H * 0.42;
      /* 基础波浪 + 字形隆起（浪脊就是字） */
      let h = Math.sin(x * 0.006 + q * 1.1) * 9 + Math.cos(y * 0.012 - q * 0.9) * 7;
      h += Math.sin((x + y) * 0.008 + q * 1.7) * 5;
      if (wg85[id]) h += 16 + Math.sin(q * 3 + i * 0.4) * 3;
      wz85[id] = h;
      wy85[id] = y;
      wx85[id] = x;
    }
  }
  void n85;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 海面：越远越暗（雾） */
  for (let j = 0; j < GH85; j++) {
    const yy = H * 0.34 + (j / (GH85 - 1)) * H * 0.42;
    const fog = 0.5 + 0.5 * (j / GH85);
    ctx.fillStyle = `rgba(40,80,110,${(0.05 * fog).toFixed(3)})`;
    ctx.beginPath();
    ctx.rect(0, pjY(0, yy), W, (H * 0.42 / GH85) * z + 1);
    ctx.fill();
  }

  if (!L) return;

  /* 浪脊：按高度分三档，亮的在脊上 */
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 0) ctx.fillStyle = 'rgba(40,80,110,0.35)';
    else if (pass === 1) ctx.fillStyle = `rgba(${Math.min(255, ar - 40)},${Math.min(255, ag + 10)},${Math.min(255, ab + 40)},0.45)`;
    else ctx.fillStyle = 'rgba(220,245,255,0.85)';
    ctx.beginPath();
    for (let j = 0; j < GH85; j++) {
      for (let i = 0; i < GW85; i++) {
        const id = j * GW85 + i;
        const h = wz85[id];
        const band = h > 14 ? 2 : h > 4 ? 1 : 0;
        if (band !== pass) continue;
        const px = pjX(wx85[id], wy85[id] - h * 0.9), py = pjY(wx85[id], wy85[id] - h * 0.9);
        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        const s = (band === 2 ? 3.2 : 2.2) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 0.8);
      }
    }
    ctx.fill();
  }

  /* 月亮在水面的倒影 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(200,225,255,0.06)';
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const y = H * 0.36 + k * 18;
    ctx.rect(W * 0.42, pjY(0, y), W * 0.16, 4);
  }
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



