/* lizi87 · 电流体 · electrofluid
   高压击穿液体：放电通道在介质里分叉、再分叉，通道连起来就是字。
   每次击穿整片液体亮一下，通道边缘留下细小的气泡。
   AE：冲击帧 + 负片闪白 + 框外抽帧。 */

const N87 = 3600;
const rx87 = new Float32Array(N87), ry87 = new Float32Array(N87);
const rtx87 = new Float32Array(N87), rty87 = new Float32Array(N87);
const rbr87 = new Float32Array(N87), rtm87 = new Float32Array(N87);
const rsz87 = new Float32Array(N87), rown87 = new Int16Array(N87);
let n87 = 0, bolt87 = 0, seed87 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N87; i++) {
    rx87[i] = 0; ry87[i] = 0; rtm87[i] = 1e9;
    rsz87[i] = 1 + Math.random() * 1.4; rown87[i] = 0;
  }
  n87 = N87;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n87 = Math.max(1400, Math.min(N87, Math.round(pc * 0.7)));
  for (let i = 0; i < n87; i++) {
    const pi = ((i * pc / n87) | 0) % pc;
    rtx87[i] = blockGx + g.px[pi] + rnd(-1, 1);
    rty87[i] = blockGy + g.py[pi] + rnd(-1, 1);
    rown87[i] = g.own[pi];
    rtm87[i] = use.at[g.own[pi]] || lineT;
    /* 分支层级：决定电弧的粗细与抖动 */
    rbr87[i] = (pi % 3) * 0.5;
    rx87[i] = rtx87[i] + rnd(-60, 60);
    ry87[i] = -40 - rnd(0, 80);   /* 从上方电极劈下来 */
  }
  bolt87 = 1;
  seed87 = Math.random() * 100;
}

function mechEvent(k, first) {
  bolt87 = first ? 1.9 : 1.15;
  seed87 = Math.random() * 100;
  camShake(1, 0.4, first ? 12 : 6);
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.04 : 0.02));
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  bolt87 *= Math.pow(0.04, dt);
  cam.ox = Math.sin(T * 0.4) * 12;
  const q = Math.floor(T * 18) / 18;   /* 抽帧：电弧重连 */
  for (let i = 0; i < n87; i++) {
    const age = T - rtm87[i];
    if (age < -0.5) {
      /* 还没到：在液体里游荡 */
      ry87[i] += 40 * dt;
      rx87[i] += Math.sin(T * 2 + i) * 30 * dt;
      if (ry87[i] > H + 40) ry87[i] = -40;
      continue;
    }
    /* 通道成形：从上方电极"劈"到字位，带锯齿抖动 */
    const k = Math.min(1, dt * 6);
    const jx = Math.sin(q * 11 + i * 0.7) * 6 * (1 - Math.abs(rty87[i] - ry87[i]) / 300);
    rx87[i] += (rtx87[i] + jx - rx87[i]) * k;
    ry87[i] += (rty87[i] - ry87[i]) * k;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 液体里的电极 + 一点浑浊介质 */
  ctx.fillStyle = 'rgba(8,20,34,0.55)';
  ctx.fillRect(0, 0, W, H);

  if (!L) return;

  /* 放电通道：只在相邻粒子之间连短线（不做全屏长弧，避免大面积过绘） */
  ctx.strokeStyle = 'rgba(150,210,255,0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n87 - 1; i += 3) {
    if (T < rtm87[i] - 0.5) continue;
    const x0 = pjX(rx87[i], ry87[i]), y0 = pjY(rx87[i], ry87[i]);
    const x1 = pjX(rx87[i + 1], ry87[i + 1]), y1 = pjY(rx87[i + 1], ry87[i + 1]);
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 40) continue;
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  }
  ctx.stroke();

  /* 通道上的亮点（字）*/
  ctx.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? 'rgba(235,250,255,0.95)'
      : 'rgba(120,190,255,0.35)';
    ctx.beginPath();
    for (let i = 0; i < n87; i++) {
      if (T < rtm87[i] - 0.5) continue;
      if ((i % 2 === 0) !== (pass === 1)) continue;
      const px = pjX(rx87[i], ry87[i]), py = pjY(rx87[i], ry87[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = rsz87[i] * (pass ? 1.7 : 2.6) * (1 + bolt87 * 0.4) * z;
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



