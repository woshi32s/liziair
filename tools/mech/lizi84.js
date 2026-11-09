/* lizi84 · 熔炉 · furnace
   炉膛里火星翻滚，炉栅的缝隙透出滚烫的光；**字是炉栅缝隙的形状** ——
   铁水从缝里往下滴，滴到的地方更亮。风箱一推，整炉火猛地一亮。
   AE：冲击帧 + 热浪（每帧小位移）+ 缓急变速。 */

const N84 = 4200;
const ex84 = new Float32Array(N84), ey84 = new Float32Array(N84);
const evx84 = new Float32Array(N84), evy84 = new Float32Array(N84);
const et84 = new Float32Array(N84), esz84 = new Float32Array(N84);
const eph84 = new Float32Array(N84);
let n84 = 0, grateY84 = 0, blow84 = 0;
const DROP84 = 260;
const qx84 = new Float32Array(DROP84), qy84 = new Float32Array(DROP84);
const qv84 = new Float32Array(DROP84), ql84 = new Float32Array(DROP84);
let qh84 = 0;

function mechResize() {
  if (!W || !H) return;
  grateY84 = H * 0.74;
  for (let i = 0; i < N84; i++) {
    ex84[i] = Math.random() * W; ey84[i] = rnd(H * 0.2, grateY84);
    evx84[i] = rnd(-20, 20); evy84[i] = rnd(-60, -10);
    et84[i] = rnd(0.4, 1); esz84[i] = 1 + Math.random() * 1.8;
    eph84[i] = Math.random() * 6.283;
  }
  for (let i = 0; i < DROP84; i++) ql84[i] = 0;
  n84 = N84;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n84 = Math.max(2000, Math.min(N84, Math.round(pc * 1.15)));
  for (let i = 0; i < n84; i++) {
    const pi = ((i * pc / n84) | 0) % pc;
    /* 火星被"炉栅的缝隙"吸住：字位就是缝隙 */
    ex84[i] = blockGx + g.px[pi] + rnd(-2, 2);
    ey84[i] = blockGy + g.py[pi] + rnd(-2, 2);
    evx84[i] = rnd(-30, 30); evy84[i] = rnd(-40, 10);
    et84[i] = use.at[g.own[pi]] || lineT;
  }
  blow84 = 1;
}

function mechEvent(k, first) {
  blow84 = first ? 1.9 : 1.2;
  camShake(1, 0.3, first ? 10 : 5);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.035 : 0.016));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  blow84 *= Math.pow(0.06, dt);
  cam.oy = -3 + Math.sin(T * 0.7) * 3;
  for (let i = 0; i < n84; i++) {
    const ready = T >= et84[i];
    if (!ready) {
      /* 还没轮到：往上飘的火星 */
      ey84[i] += evy84[i] * dt;
      ex84[i] += (evx84[i] + Math.sin(T * 2 + eph84[i]) * 20) * dt;
      if (ey84[i] < H * 0.15) { ey84[i] = grateY84 - rnd(0, 40); ex84[i] = Math.random() * W; }
      continue;
    }
    /* 被缝隙吸住，在字位上抖动（炉火在跳） */
    const jx = Math.sin(T * 7 + eph84[i]) * 1.6;
    const jy = Math.cos(T * 6.3 + eph84[i]) * 1.4;
    const tx = blockGx + (ex84[i] - blockGx) * 0.9 + jx;
    ex84[i] += (blockGx + (ex84[i] - blockGx) * 0.02 - ex84[i]) * 0 + jx * dt * 8;
    ey84[i] += (blockGy + (ey84[i] - blockGy) * 0.02 - ey84[i]) * 0 + jy * dt * 8;
    void tx;
  }
  /* 铁水从缝里滴下来 */
  for (let i = 0; i < DROP84; i++) {
    if (ql84[i] <= 0) continue;
    qv84[i] += 900 * dt;
    qy84[i] += qv84[i] * dt;
    ql84[i] -= dt * 0.5;
  }
  if (Math.random() < 0.5 && blow84 > 0.2) {
    const j = (qh84 = (qh84 + 1) % DROP84);
    qx84[j] = blockGx + rnd(-420, 420);
    qy84[j] = blockGy + rnd(-40, 40);
    qv84[j] = 0; ql84[j] = 1;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 炉膛：底部暗红 + 炉栅的横条 */
  const gy = pjY(0, grateY84);
  ctx.fillStyle = 'rgba(14,8,6,0.96)';
  ctx.fillRect(0, gy, W, H - gy + 2);
  ctx.fillStyle = 'rgba(255,90,20,0.10)';
  ctx.beginPath();
  for (let k = 0; k < 5; k++) ctx.rect(0, gy + k * 12, W, 6);
  ctx.fill();

  if (!L) return;

  /* 缝隙光（字）：白热 → 橙 → 暗红三档 */
  for (let pass = 0; pass < 3; pass++) {
    ctx.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';
    ctx.fillStyle = pass === 0
      ? 'rgba(90,30,14,0.55)'
      : pass === 1
        ? 'rgba(255,110,40,0.55)'
        : 'rgba(255,236,190,0.9)';
    ctx.beginPath();
    for (let i = 0; i < n84; i++) {
      if (T < et84[i]) continue;
      const band = (i % 3);
      if (band !== pass) continue;
      const px = pjX(ex84[i], ey84[i]), py = pjY(ex84[i], ey84[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = esz84[i] * (pass === 2 ? 1.8 : 1.3) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 火星（未就位的） */
  ctx.fillStyle = 'rgba(255,170,80,0.6)';
  ctx.beginPath();
  for (let i = 0; i < n84; i++) {
    if (T >= et84[i]) continue;
    const px = pjX(ex84[i], ey84[i]), py = pjY(ex84[i], ey84[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px - 0.9, py - 1.4, 1.8, 2.8);
  }
  ctx.fill();

  /* 铁水滴 */
  ctx.fillStyle = 'rgba(255,200,120,0.9)';
  ctx.beginPath();
  for (let i = 0; i < DROP84; i++) {
    if (ql84[i] <= 0) continue;
    const px = pjX(qx84[i], qy84[i]), py = pjY(qx84[i], qy84[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px - 1.2, py - 3.4, 2.4, 6.8);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  void ag; void ab;
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



