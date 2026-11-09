/* lizi73 · 粒子日食 · eclipse
   月亮挡住太阳，日冕的流束向外抛出；流束被"磁场"弯到字的位置，停在字上 ——
   **字是日冕流束的末端**。月亮是暗的，只有一圈金边和几道向外拉长的光。
   AE：环绕运镜 + 冲击帧 + 负片闪白（日冕爆发那一下）。 */

const N73 = 4800;
const ex73 = new Float32Array(N73), ey73 = new Float32Array(N73);
const et73 = new Float32Array(N73), eown73 = new Int16Array(N73);
const eang73 = new Float32Array(N73), espd73 = new Float32Array(N73);
const etgt73 = new Float32Array(N73), etgy73 = new Float32Array(N73);
const esz73 = new Float32Array(N73), ehit73 = new Uint8Array(N73);
let n73 = 0, cx73 = 0, cy73 = 0, moonR73 = 0, flare73 = 0;

function mechResize() {
  if (!W || !H) return;
  cx73 = W * 0.16; cy73 = H * 0.26;
  moonR73 = Math.min(W, H) * 0.075;
  for (let i = 0; i < N73; i++) {
    ex73[i] = 0; ey73[i] = 0; ehit73[i] = 0;
    eang73[i] = Math.random() * 6.283;
    espd73[i] = 0.6 + Math.random() * 1.6;
    esz73[i] = 1 + Math.random() * 1.5;
  }
  n73 = N73;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n73 = Math.max(2000, Math.min(N73, Math.round(pc * 1.2)));
  for (let i = 0; i < n73; i++) {
    const pi = ((i * pc / n73) | 0) % pc;
    etgt73[i] = blockGx + g.px[pi] + rnd(-1, 1);
    etgy73[i] = blockGy + g.py[pi] + rnd(-1, 1);
    eown73[i] = g.own[pi];
    et73[i] = use.at[g.own[pi]] || use.lineT;
    ehit73[i] = 0;
    /* 从日冕边缘出发 */
    ex73[i] = cx73 + Math.cos(eang73[i]) * moonR73 * 1.1;
    ey73[i] = cy73 + Math.sin(eang73[i]) * moonR73 * 1.1;
  }
  flare73 = 1;
}

function mechEvent(k, first) {
  flare73 = first ? 1.9 : 1;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.045 : 0.02));
  cam.rot += (k % 2 ? 1 : -1) * (first ? 0.05 : 0.02);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  flare73 *= Math.pow(0.05, dt);
  /* 环绕：镜头绕太阳走小椭圆 */
  const orb = T * 0.25;
  cam.ox = Math.cos(orb) * 26;
  cam.oy = Math.sin(orb * 1.2) * 12;
  for (let i = 0; i < n73; i++) {
    const age = T - et73[i];
    if (age < -0.6) {
      /* 还在日冕里：沿流束缓慢外扩 */
      const r = moonR73 * (1.1 + 0.5 * ((T * 0.2 + i * 0.001) % 1));
      eang73[i] += 0.25 * dt;
      ex73[i] = cx73 + Math.cos(eang73[i]) * r;
      ey73[i] = cy73 + Math.sin(eang73[i]) * r;
      continue;
    }
    if (ehit73[i]) continue;
    /* 被弯到字位 */
    const dx = etgt73[i] - ex73[i], dy = etgy73[i] - ey73[i];
    const d = Math.hypot(dx, dy);
    const near = d < 60;
    const k = Math.min(1, dt * (near ? 9 : 2.6));
    /* 沿流束方向先向外，再折向字：用切向分量制造弧线 */
    const rx = ex73[i] - cx73, ry = ey73[i] - cy73;
    const rl = Math.hypot(rx, ry) || 1;
    const swirl = (1 - Math.min(1, d / 300)) * 60;
    ex73[i] += dx * k + (-ry / rl) * swirl * dt;
    ey73[i] += dy * k + (rx / rl) * swirl * dt;
    if (d < 3) { ehit73[i] = 1; ex73[i] = etgt73[i]; ey73[i] = etgy73[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const mx = pjX(cx73, cy73), my = pjY(cx73, cy73);
  const mr = moonR73 * z;

  /* 日冕辉光：几层同心椭圆（暖金） */
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 3; k >= 1; k--) {
    ctx.strokeStyle = `rgba(255,${170 + k * 10},${90 + k * 20},${(0.05 + 0.03 * k).toFixed(3)})`;
    ctx.lineWidth = (6 + k * 8) * z;
    ctx.beginPath();
    ctx.moveTo(mx + mr * (1 + k * 0.16), my);
    ctx.ellipse(mx, my, mr * (1 + k * 0.16), mr * (1 + k * 0.16), 0, 0, 6.2832);
    ctx.stroke();
  }
  /* 月面（暗） */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(2,3,6,0.99)';
  ctx.beginPath();
  ctx.moveTo(mx + mr, my);
  ctx.ellipse(mx, my, mr, mr, 0, 0, 6.2832);
  ctx.fill();
  /* 边缘的金环（日珥） */
  ctx.strokeStyle = 'rgba(255,200,120,0.55)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(mx + mr, my);
  ctx.ellipse(mx, my, mr, mr, 0, 0, 6.2832);
  ctx.stroke();

  if (!L) return;

  /* 日冕流束（还没到位的粒子，被拉长） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,190,120,0.22)';
  ctx.beginPath();
  for (let i = 0; i < n73; i++) {
    if (ehit73[i] || T >= et73[i]) continue;
    const px = pjX(ex73[i], ey73[i]), py = pjY(ex73[i], ey73[i]);
    if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
    ctx.rect(px - 6 * z, py - 1, 12 * z, 2);
  }
  ctx.fill();

  /* 字：流束末端（白亮 + 金） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 1
      ? `rgba(${Math.min(255, ar + 60)},${Math.min(255, ag + 50)},${Math.min(255, ab + 20)},0.96)`
      : 'rgba(255,170,90,0.30)';
    ctx.beginPath();
    for (let i = 0; i < n73; i++) {
      if (!ehit73[i]) continue;
      const px = pjX(ex73[i], ey73[i]), py = pjY(ex73[i], ey73[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = esz73[i] * (pass ? 1.8 : 2.8) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  void flare73;
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



