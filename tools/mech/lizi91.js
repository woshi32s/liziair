/* lizi91 · 星系碰撞 · galaxy-collision
   两个旋涡星系对撞：旋臂粒子在引力扰动下被拉成桥，碰撞带的粒子被激波压缩、
   甩到字位停住 —— **字是激波前沿扫出来的那条带**。
   AE：冲击帧 + 环绕运镜 + 速度拉伸 + 抽帧。 */

const N91 = 5200;
const gx91 = new Float32Array(N91), gy91 = new Float32Array(N91);
const gp91 = new Float32Array(N91), gr91 = new Float32Array(N91);
const gw91 = new Float32Array(N91), garm91 = new Float32Array(N91);
const gtx91 = new Float32Array(N91), gty91 = new Float32Array(N91);
const gtm91 = new Float32Array(N91), gst91 = new Uint8Array(N91);
const gsz91 = new Float32Array(N91), gcl91 = new Uint8Array(N91);
const gvx91 = new Float32Array(N91), gvy91 = new Float32Array(N91);
let n91 = 0, cax91 = 0, cay91 = 0, cbx91 = 0, cby91 = 0, shock91 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N91; i++) {
    gx91[i] = 0; gy91[i] = 0; gst91[i] = 0; gvx91[i] = 0; gvy91[i] = 0;
    gsz91[i] = 1 + Math.random() * 1.3;
    gcl91[i] = i % 2;
    garm91[i] = Math.floor(Math.random() * 3);
    gr91[i] = 40 + Math.random() * 220;
    gp91[i] = Math.random() * 6.283;
    gw91[i] = 0.6 / Math.sqrt(gr91[i] / 60);
  }
  n91 = N91;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n91 = Math.max(2200, Math.min(N91, Math.round(pc * 1.3)));
  for (let i = 0; i < n91; i++) {
    const pi = ((i * pc / n91) | 0) % pc;
    gtx91[i] = blockGx + g.px[pi] + rnd(-1, 1);
    gty91[i] = blockGy + g.py[pi] + rnd(-1, 1);
    gtm91[i] = use.at[g.own[pi]] || lineT;
    gst91[i] = 0;
  }
  shock91 = 1;
}

function mechEvent(k, first) {
  shock91 = first ? 1.9 : 1.2;
  cam.tz = Math.max(cam.tz, 1.0 + (first ? 0.05 : 0.022));
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.3 : 0.14);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  shock91 *= Math.pow(0.05, dt);
  /* 两个核互相绕行、靠近又分开 */
  const ph = T * 0.34;
  cax91 = W * 0.5 - Math.cos(ph) * W * 0.16;
  cay91 = H * 0.46 - Math.sin(ph) * H * 0.05;
  cbx91 = W * 0.5 + Math.cos(ph) * W * 0.16;
  cby91 = H * 0.46 + Math.sin(ph) * H * 0.05;
  /* 镜头环绕 */
  const orb = T * 0.2;
  cam.ox = Math.cos(orb) * 22;
  cam.oy = Math.sin(orb * 1.2) * 10;
  for (let i = 0; i < n91; i++) {
    const A = gcl91[i] === 0;
    const cx = A ? cax91 : cbx91, cy = A ? cay91 : cby91;
    const age = T - gtm91[i];
    if (age < -0.6) {
      /* 在旋臂上公转 */
      gp91[i] += gw91[i] * dt;
      const r = gr91[i] * (1 + 0.08 * Math.sin(T * 0.7 + i));
      const a = gp91[i] + garm91[i] * 2.094 + Math.log(r / 60) * 1.1;
      gx91[i] = cx + Math.cos(a) * r * 1.15;
      gy91[i] = cy + Math.sin(a) * r * 0.42;
      gst91[i] = 0;
      continue;
    }
    if (gst91[i]) continue;
    /* 激波压缩：甩向字位 */
    const dx = gtx91[i] - gx91[i], dy = gty91[i] - gy91[i];
    const d = Math.hypot(dx, dy);
    const near = d < 90;
    gvx91[i] += dx * (near ? 32 : 9) * dt - gvx91[i] * (near ? 9.5 : 1.6) * dt;
    gvy91[i] += dy * (near ? 32 : 9) * dt - gvy91[i] * (near ? 9.5 : 1.6) * dt;
    const sp = Math.hypot(gvx91[i], gvy91[i]);
    if (sp > 1000) { const s = 1000 / sp; gvx91[i] *= s; gvy91[i] *= s; }
    gx91[i] += gvx91[i] * dt; gy91[i] += gvy91[i] * dt;
    if (d < 2.2 || T > gtm91[i] + 1.5) { gst91[i] = 1; gx91[i] = gtx91[i]; gy91[i] = gty91[i]; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 两个星系核的辉光（合成到画面，不逐颗 drawImage） */
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    const cx = k === 0 ? cax91 : cbx91, cy = k === 0 ? cay91 : cby91;
    const px = pjX(cx, cy), py = pjY(cx, cy);
    for (let j = 3; j >= 1; j--) {
      const r = j * 12 * z;
      ctx.fillStyle = k === 0 ? `rgba(120,180,255,${0.06 / j})` : `rgba(255,170,90,${0.06 / j})`;
      ctx.beginPath();
      ctx.rect(px - r, py - r, r * 2, r * 2);
      ctx.fill();
    }
  }

  /* 旋臂粒子：冷蓝 / 暖橙 / 白色（碰撞带） */
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(110,160,240,0.45)'
      : pass === 1
        ? 'rgba(255,170,90,0.42)'
        : `rgba(${Math.min(255, ar + 60)},${Math.min(255, ag + 60)},${Math.min(255, ab + 50)},0.95)`;
    ctx.beginPath();
    for (let i = 0; i < n91; i++) {
      const band = gst91[i] ? 2 : gcl91[i] === 0 ? 0 : 1;
      if (band !== pass) continue;
      if (T < gtm91[i] - 0.6) continue;
      const px = pjX(gx91[i], gy91[i]), py = pjY(gx91[i], gy91[i]);
      if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
      const s = gsz91[i] * (pass === 2 ? 1.7 : 1.25) * z;
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



