/* lizi64 · 粒子印刷 · print
   一支墨辊自上而下压过纸面：辊子压过的地方，油墨只留在字的位置上；
   辊子离开后，纸面留下一点点压痕和墨的毛边。
   AE：冲击帧 + 抽帧（辊子按 1/12s 步进）+ 缓急变速。 */

const N64 = 4600;
const ix64 = new Float32Array(N64), iy64 = new Float32Array(N64);
const itx64 = new Float32Array(N64), ity64 = new Float32Array(N64);
const iown64 = new Int16Array(N64), iat64 = new Float32Array(N64);
const isz64 = new Float32Array(N64), ist64 = new Uint8Array(N64);
let n64 = 0, roller64 = 0, paperCv64 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N64; i++) {
    ix64[i] = 0; iy64[i] = 0; ist64[i] = 0;
    isz64[i] = 1.2 + Math.random() * 1.4;
  }
  n64 = N64;
  if (!paperCv64) paperCv64 = document.createElement('canvas');
  paperCv64.width = Math.max(2, Math.round(W / 2));
  paperCv64.height = Math.max(2, Math.round(H / 2));
  const pc = paperCv64.getContext('2d');
  const bw = paperCv64.width, bh = paperCv64.height;
  const g = pc.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#1c1a16');
  g.addColorStop(0.5, '#232019');
  g.addColorStop(1, '#171512');
  pc.fillStyle = g; pc.fillRect(0, 0, bw, bh);
  /* 纸纹 */
  pc.strokeStyle = 'rgba(210,200,180,0.045)';
  pc.lineWidth = 1;
  for (let k = 0; k < 140; k++) {
    const y = Math.random() * bh;
    pc.beginPath(); pc.moveTo(0, y); pc.lineTo(bw, y + rnd(-1, 1)); pc.stroke();
  }
  pc.fillStyle = 'rgba(230,220,195,0.05)';
  pc.beginPath();
  for (let i = 0; i < 2200; i++) pc.rect(Math.random() * bw, Math.random() * bh, 1, 1);
  pc.fill();
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n64 = Math.max(1800, Math.min(N64, Math.round(pc * 1.15)));
  roller64 = 0;
  for (let i = 0; i < n64; i++) {
    const pi = ((i * pc / n64) | 0) % pc;
    itx64[i] = blockGx + g.px[pi] + rnd(-0.8, 0.8);
    ity64[i] = blockGy + g.py[pi] + rnd(-0.8, 0.8);
    iown64[i] = g.own[pi];
    iat64[i] = use.at[g.own[pi]] || use.lineT;
    ist64[i] = 0;
    /* 墨点从辊子上被压下来 */
    ix64[i] = itx64[i];
    iy64[i] = ity64[i] - 400;
  }
}

function mechEvent(k, first) {
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.03 : 0.015));
  cam.oy = first ? 6 : 3;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.oy *= Math.pow(0.05, dt);
  /* 辊子行程：句内从画面上方走到下方 */
  roller64 = clamp01((T - lineT) / Math.max(1.0, lineDur * 0.9));
  const ry = -40 + roller64 * (H + 80);
  for (let i = 0; i < n64; i++) {
    if (ist64[i]) continue;
    if (T < iat64[i] - 0.35) continue;
    /* 被辊子压到纸上：快速下压 → 定住 */
    iy64[i] += (ity64[i] - iy64[i]) * Math.min(1, dt * 18);
    if (Math.abs(iy64[i] - ity64[i]) < 1.2) { ist64[i] = 1; iy64[i] = ity64[i]; }
    void ry;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (paperCv64) ctx.drawImage(paperCv64, 0, 0, W, H);

  if (!L) return;
  /* 墨迹：未干（亮，带一点反光） */
  ctx.fillStyle = `rgba(${Math.min(255, ar + 20)},${Math.min(255, ag + 12)},${Math.min(255, ab - 30)},0.92)`;
  ctx.beginPath();
  for (let i = 0; i < n64; i++) {
    if (!ist64[i]) continue;
    const px = pjX(ix64[i], iy64[i]), py = pjY(ix64[i], iy64[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = isz64[i] * 1.7 * z;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 1.1);
  }
  ctx.fill();

  /* 正在被压的墨点：拉长一点（下落残影） */
  ctx.fillStyle = 'rgba(255,220,160,0.35)';
  ctx.beginPath();
  for (let i = 0; i < n64; i++) {
    if (ist64[i]) continue;
    if (T < iat64[i] - 0.35) continue;
    const px = pjX(ix64[i], iy64[i]), py = pjY(ix64[i], iy64[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    ctx.rect(px - 1.2, py - 9 * z, 2.4, 12 * z);
  }
  ctx.fill();

  /* 墨辊：一条横贯画面的暗条 + 一条高光 */
  const ry = -40 + roller64 * (H + 80);
  const py = pjY(0, ry);
  ctx.fillStyle = 'rgba(18,18,20,0.95)';
  ctx.fillRect(0, py - 12, W, 24);
  ctx.fillStyle = 'rgba(160,180,210,0.20)';
  ctx.fillRect(0, py - 12, W, 3);
  /* 辊子下缘的压痕阴影 */
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, py + 12, W, 10);
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



