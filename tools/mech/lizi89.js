/* lizi89 · 全息立方 · holo-cube
   字被投射在一个缓慢自转的立方体表面；转到正面时最实，转到侧面被压扁、变淡，
   投影仪在下面打出一束锥形光，边缘有扫描线和噪点。
   AE：环绕运镜 + 抽帧 + 冲击帧（每转 90° 闪一下）。 */

const N89 = 4200;
const hx89 = new Float32Array(N89), hy89 = new Float32Array(N89);
const hz89 = new Float32Array(N89);
const htx89 = new Float32Array(N89), hty89 = new Float32Array(N89);
const hown89 = new Int16Array(N89), htm89 = new Float32Array(N89);
const hsz89 = new Float32Array(N89);
let n89 = 0, yaw89 = 0, pitch89 = 0, flash89 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N89; i++) {
    hx89[i] = 0; hy89[i] = 0; hz89[i] = 0;
    hsz89[i] = 1 + Math.random() * 1.3;
  }
  n89 = N89;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n89 = Math.max(1800, Math.min(N89, Math.round(pc * 1.1)));
  flash89 = 1;
  for (let i = 0; i < n89; i++) {
    const pi = ((i * pc / n89) | 0) % pc;
    /* 把字卷到立方体的四个侧面上（按 x 分段） */
    const gx = g.px[pi], gy = g.py[pi];
    const face = Math.floor(((gx + W * 0.5) / W) * 4) % 4;
    const side = 260;
    const u = ((gx + W * 0.5) / W * 4 - face) - 0.5;   /* -0.5..0.5 */
    hx89[i] = (face === 0 || face === 2) ? u * side * 1.2 : (face === 1 ? side * 0.5 : -side * 0.5);
    hz89[i] = (face === 0 || face === 2) ? (face === 2 ? side * 0.5 : -side * 0.5) : u * side * 1.2;
    hy89[i] = gy * 0.9;
    htx89[i] = gx; hty89[i] = gy;      /* 兜底：也存平面位置 */
    hown89[i] = g.own[pi];
    htm89[i] = use.at[g.own[pi]] || lineT;
    void htx89; void hty89;
  }
}

function mechEvent(k, first) {
  flash89 = first ? 1.8 : 1;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.045 : 0.02));
  cam.ox = (k % 2 ? 1 : -1) * (first ? 14 : 7);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  flash89 *= Math.pow(0.06, dt);
  cam.ox *= Math.pow(0.05, dt);
  /* 立方体自转；镜头轻微公转 */
  yaw89 = T * 0.42;
  pitch89 = -0.12 + Math.sin(T * 0.3) * 0.08;
  cam.oy = Math.sin(T * 0.35) * 8;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const cyaw = Math.cos(yaw89), syaw = Math.sin(yaw89);
  const cp = Math.cos(pitch89), sp = Math.sin(pitch89);
  const cx = W / 2, cy = H * 0.44;
  const F = 620;

  /* 投影仪的锥形光：从下往上 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${Math.min(255, ar - 30)},${Math.min(255, ag + 30)},${Math.min(255, ab + 50)},0.05)`;
  ctx.beginPath();
  ctx.moveTo(pjX(cx, H * 1.02), pjY(cx, H * 1.02));
  ctx.lineTo(pjX(cx - 420, cy - 60), pjY(cx - 420, cy - 60));
  ctx.lineTo(pjX(cx + 420, cy - 60), pjY(cx + 420, cy - 60));
  ctx.closePath();
  ctx.fill();

  /* 立方体的棱（8 个顶点，12 条边） */
  const S = 150;
  const V = [];
  for (let k = 0; k < 8; k++) {
    const bx = (k & 1 ? 1 : -1) * S, by = (k & 2 ? 1 : -1) * S, bz = (k & 4 ? 1 : -1) * S;
    const rx = bx * cyaw - bz * syaw, rz = bx * syaw + bz * cyaw;
    const ry = by * cp - rz * sp, rz2 = by * sp + rz * cp;
    const s = F / (F + rz2);
    V.push([cx + rx * s * 2.2, cy + ry * s * 2.2, s]);
  }
  ctx.strokeStyle = 'rgba(120,200,255,0.20)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const E = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  for (const [a, b] of E) {
    ctx.moveTo(pjX(V[a][0], V[a][1]), pjY(V[a][0], V[a][1]));
    ctx.lineTo(pjX(V[b][0], V[b][1]), pjY(V[b][0], V[b][1]));
  }
  ctx.stroke();

  if (!L) return;

  /* 立方体上的字：绕 yaw/pitch 旋转，按深度分两档 */
  for (let pass = 0; pass < 2; pass++) {
    const front = pass === 1;
    ctx.fillStyle = front
      ? `rgba(${Math.min(255, ar + 50)},${Math.min(255, ag + 60)},${Math.min(255, ab + 60)},0.95)`
      : 'rgba(90,160,200,0.22)';
    ctx.beginPath();
    for (let i = 0; i < n89; i++) {
      if (T < htm89[i] - 0.5) continue;
      const rx = hx89[i] * cyaw - hz89[i] * syaw;
      const rz = hx89[i] * syaw + hz89[i] * cyaw;
      const ry = hy89[i] * cp - rz * sp, rz2 = hy89[i] * sp + rz * cp;
      if ((rz2 < 0) !== front) continue;
      const s = F / (F + rz2);
      const X = cx + rx * s, Y = cy + ry * s;
      const px = pjX(X, Y), py = pjY(X, Y);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      /* 扫描线：按 y 抽行 */
      if ((Math.floor(py / 4) % 2) === 0) continue;
      const sz = hsz89[i] * (front ? 1.5 : 1.2) * z * s;
      ctx.rect(px - sz * 0.5, py - sz * 0.5, sz, sz);
    }
    ctx.fill();
  }

  /* 投影噪声 + 底部的发射口 */
  ctx.fillStyle = 'rgba(200,240,255,0.5)';
  ctx.beginPath();
  ctx.rect(pjX(cx - 26, H * 0.98), pjY(cx - 26, H * 0.98), 52, 4);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  void flash89;
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



