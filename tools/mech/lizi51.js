/* lizi51 · 立体浮雕 · relief
   字 = 一块抬起来的青铜浮雕板。
   每个字形采样点有高度 z（平滑起伏 + 中心穹顶），法线取自高度场梯度；
   同一批采样点再往深度方向推 32px 画一层暗侧面 —— 镜头一公转就露厚度。
   自建 3D：绕 Y(yaw) → 绕 X(pitch) → 一点透视，最后交给 base 的 pjX/pjY。
   掠射光方位角走台阶（0.5 rad/s），命中时整道光跳一格；
   暗/中/亮 三档实色 + 一层白高光，全部同色 batch rect。 */

const NF51 = 6600;                 /* 正面浮雕粒子 */
const ND51 = 3200;                 /* 侧面粒子（取正面点一半，隔 2 取 1） */
const px51 = new Float32Array(NF51), py51 = new Float32Array(NF51);
const pz51 = new Float32Array(NF51);
const nx51 = new Float32Array(NF51), ny51 = new Float32Array(NF51), nz51 = new Float32Array(NF51);
const sz51 = new Float32Array(NF51);
const bd51 = new Uint8Array(NF51);
/* 正面 / 侧面 屏幕坐标 */
const f0x = new Float32Array(NF51), f0y = new Float32Array(NF51);
const f1x = new Float32Array(NF51), f1y = new Float32Array(NF51);
const dsel = new Uint16Array(ND51);
let nf51 = 0;
let kickX51 = 0, kickY51 = 0, lift51 = 0, roll51 = 0, lightStep51 = 0;

/* 远景点阵星尘：resize 时预撒，每帧 batch */
const NS51 = 900;
const stx51 = new Float32Array(NS51), sty51 = new Float32Array(NS51);
const smag51 = new Float32Array(NS51), sdr51 = new Float32Array(NS51);

/* 每个字块先烘一张"高度场"：字形采样密度（笔画内部高、边缘削下去）
   + 低频起伏 + 中心穹顶。法线用高度场的中心差分，得到真实的倒角。 */

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < NS51; i++) {
    stx51[i] = rnd(0, W);
    sty51[i] = rnd(-H * 0.04, H);
    smag51[i] = Math.pow(Math.random(), 2.4);
    sdr51[i] = rnd(0.8, 5.5);
  }
  nf51 = 0; lift51 = 0; kickX51 = 0; kickY51 = 0;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { nf51 = 0; return; }
  nf51 = Math.max(4200, Math.min(NF51, Math.round(pc * 1.15)));

  /* --- 烘焙一块"浮雕高度场"：字形密度倒角 + 低频起伏 + 中心穹顶 --- */
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (let p = 0; p < pc; p++) {
    const x = g.px[p], y = g.py[p];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  const PAD = 30;
  let CELL = 4;
  const spanX = mxx - mnx + PAD * 2, spanY = mxy - mny + PAD * 2;
  while (spanX / CELL > 520 || spanY / CELL > 280) CELL++;
  const gx0 = mnx - PAD, gy0 = mny - PAD;
  const gw = Math.max(2, Math.ceil(spanX / CELL) + 1);
  const gh = Math.max(2, Math.ceil(spanY / CELL) + 1);
  const dens = new Float32Array(gw * gh);
  for (let p = 0; p < pc; p++) {
    const ix = ((g.px[p] - gx0) / CELL) | 0;
    const iy = ((g.py[p] - gy0) / CELL) | 0;
    if (ix >= 0 && iy >= 0 && ix < gw && iy < gh) dens[iy * gw + ix]++;
  }
  /* 1-2-1 模糊两轮再归一化：笔画内部≈1，边缘削下去 → 倒角 */
  const tmpd = new Float32Array(gw * gh);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const k = row + x;
        tmpd[k] = ((x > 0 ? dens[k - 1] : dens[k]) + dens[k] * 2 +
          (x < gw - 1 ? dens[k + 1] : dens[k])) * 0.25;
      }
    }
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const k = row + x;
        dens[k] = ((y > 0 ? tmpd[k - gw] : tmpd[k]) + tmpd[k] * 2 +
          (y < gh - 1 ? tmpd[k + gw] : tmpd[k])) * 0.25;
      }
    }
  }
  let dm = 1e-6;
  for (let k = 0; k < dens.length; k++) if (dens[k] > dm) dm = dens[k];
  for (let k = 0; k < dens.length; k++) {
    const v = dens[k] / dm;
    dens[k] = v < 0.16 ? 0 : v > 0.82 ? 1 : (v - 0.16) / 0.66;
  }

  const hg = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const wy = gy0 + y * CELL;
    for (let x = 0; x < gw; x++) {
      const wx = gx0 + x * CELL;
      hg[y * gw + x] = 14 * dens[y * gw + x] +
        12 * Math.sin(wx * 0.029) * Math.cos(wy * 0.035) +
        5 * Math.sin((wx + wy) * 0.055) +
        18 * Math.exp(-(wx * wx + wy * wy) / 150000) - 5;
    }
  }
  function sampleH(x, y) {
    const fx = (x - gx0) / CELL, fy = (y - gy0) / CELL;
    let ix = fx | 0, iy = fy | 0;
    if (ix < 0) ix = 0; else if (ix > gw - 2) ix = gw - 2;
    if (iy < 0) iy = 0; else if (iy > gh - 2) iy = gh - 2;
    const tx = fx - ix, ty = fy - iy, k = iy * gw + ix;
    const a = hg[k] + (hg[k + 1] - hg[k]) * tx;
    const b = hg[k + gw] + (hg[k + gw + 1] - hg[k + gw]) * tx;
    return a + (b - a) * ty;
  }

  for (let i = 0; i < nf51; i++) {
    const pi = ((i * pc / nf51) | 0) % pc;
    const x = g.px[pi] + rnd(-0.8, 0.8);
    const y = g.py[pi] + rnd(-0.8, 0.8);
    px51[i] = x; py51[i] = y;
    pz51[i] = sampleH(x, y);
    /* 中心差分法线 */
    const hx = (sampleH(x + 2, y) - sampleH(x - 2, y)) * 0.338;
    const hy = (sampleH(x, y + 2) - sampleH(x, y - 2)) * 0.338;
    const il = 1 / Math.sqrt(hx * hx + hy * hy + 1);
    nx51[i] = -hx * il; ny51[i] = -hy * il; nz51[i] = il;
    sz51[i] = 1.9 + Math.random() * 1.25;
  }
  /* 侧面从正面点里等距抽 1/3 */
  for (let j = 0; j < ND51; j++) dsel[j] = (j * nf51 / ND51) | 0;
  lift51 = 0; lightStep51 = Math.floor(Math.random() * 6) * 0.5;
}

function mechEvent(k, first) {
  kickX51 = (k % 2 ? 1 : -1) * (first ? 22 : 13);
  kickY51 = -7;
  roll51 = (k % 2 ? -1 : 1) * (first ? 0.030 : 0.018);
  lift51 = first ? 16 : 10;
  lightStep51 += (k % 2 ? 1 : -1) * (first ? 0.55 : 0.32);
  cam.tz = first ? 1.06 : 1.05;
}

function mechUpdate(dt, T) {
  const d = dt > 0 ? dt : 0;
  const kd = Math.exp(-d * 3.6);
  kickX51 *= kd; kickY51 *= kd;
  roll51 *= Math.exp(-d * 4.2);
  lift51 *= Math.exp(-d * 7.2);

  /* 镜头绕浮雕缓慢环绕 */
  cam.ox = Math.sin(T * 0.23) * 18 + kickX51;
  cam.oy = Math.cos(T * 0.19) * 11 + kickY51;
  cam.rot = Math.sin(T * 0.13) * 0.038 + roll51;
}

function mechDraw(T, z, pjX, pjY) {
  /* ---- 1 · 远处星尘 ---- */
  const px0 = cam.ox * 0.16, py0 = cam.oy * 0.12;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(132,158,220,0.42)';
  ctx.beginPath();
  for (let i = 0; i < NS51; i++) {
    const u = (stx51[i] + T * sdr51[i]) % W;
    const v = sty51[i] + Math.sin(T * 0.11 + i) * 1.6;
    const s = 0.8 + smag51[i] * 1.5;
    ctx.rect(u + px0, v + py0, s, s);
  }
  ctx.fill();

  if (!L || !nf51) return;

  /* ---- 2 · 一帧只算一次 3D 投影（正面 + 一层厚度） ---- */
  const yaw = Math.sin(T * 0.33) * 0.34 + cam.rot;
  const pitch = -0.18 + Math.sin(T * 0.21) * 0.05;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);

  /* 掠射光：台阶式方位角 + 命中跳格 */
  const la = Math.floor(T * 5) * 0.1 + lightStep51;
  const lxx = Math.cos(la) * 0.98, lyy = Math.sin(la) * 0.52, lzz = 0.30;
  const li = 1 / Math.sqrt(lxx * lxx + lyy * lyy + lzz * lzz);
  const lxn = lxx * li, lyn = lyy * li, lzn = lzz * li;

  const bx = blockGx, by = blockGy;
  const lift = lift51 + Math.sin(T * 0.4) * 3;
  const DEP = 28;

  for (let i = 0; i < nf51; i++) {
    const zz = pz51[i] + lift;
    const lx = px51[i], ly = py51[i];

    /* 绕 Y (yaw) */
    const x1 = lx * cy + zz * sy;
    const z1 = zz * cy - lx * sy;
    /* 绕 X (pitch) + 一点透视 */
    let y2 = ly * cp - z1 * sp;
    let z2 = z1 * cp + ly * sp;
    let pp = 1 / (1 + z2 * 0.0006);
    let X = bx + x1 * pp, Y = by + y2 * pp;
    const u = pjX(X, Y), v = pjY(X, Y);
    f0x[i] = u; f0y[i] = v;
    const on = u > -40 && u < W + 40 && v > -40 && v < H + 40;
    if (!on) { bd51[i] = 255; continue; }

    /* 亮度分档 */
    const sh = 0.35 + 0.65 * (nx51[i] * lxn + ny51[i] * lyn + nz51[i] * lzn) + zz * 0.0016;
    bd51[i] = sh > 0.90 ? 3 : sh > 0.60 ? 2 : sh > 0.30 ? 1 : 0;
  }

  /* 侧面：投影（只用隔 3 取 1 的点） */
  for (let j = 0; j < ND51; j++) {
    const i = dsel[j];
    if (bd51[i] === 255) { f1x[i] = -9999; continue; }
    const zz = pz51[i] + lift;
    const lx = px51[i], ly = py51[i];
    const x1 = lx * cy + zz * sy;
    const z1 = zz * cy - lx * sy;
    /* 深度方向 -32：等价于 x1-32*sy, z1-32*cy */
    const xm = x1 - DEP * sy, zm = z1 - DEP * cy;
    const y2 = ly * cp - zm * sp;
    const z2 = zm * cp + ly * sp;
    const pp = 1 / (1 + z2 * 0.0006);
    const X = bx + xm * pp, Y = by + y2 * pp;
    f1x[i] = pjX(X, Y);
    f1y[i] = pjY(X, Y);
  }

  /* ---- 3 · 厚度侧面（暗） ---- */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgb(46,32,29)';
  ctx.beginPath();
  for (let j = 0; j < ND51; j++) {
    const i = dsel[j];
    if (f1x[i] === -9999) continue;
    const s = sz51[i] * 1.7 * z;
    ctx.rect(f1x[i] - s * 0.5, f1y[i] - s * 0.5, s, s * 0.92);
  }
  ctx.fill();

  /* ---- 4 · 正面：暗 / 中 / 亮 三档实色 + 白高光 ---- */
  const cDark = 'rgb(62,46,46)';
  const cMid = 'rgb(130,96,68)';
  const cLit = 'rgb(211,167,120)';
  const cSpec = 'rgba(255,244,220,0.86)';
  const cols = [cDark, cMid, cLit, cSpec];

  for (let b = 0; b < 4; b++) {
    ctx.globalCompositeOperation = b === 3 ? 'lighter' : 'source-over';
    ctx.fillStyle = cols[b];
    ctx.beginPath();
    for (let i = 0; i < nf51; i++) {
      if (bd51[i] !== b) continue;
      const s = sz51[i] * (1 + (pz51[i] + lift) * 0.004) * z;
      ctx.rect(f0x[i] - s * 0.5, f0y[i] - s * 0.5, s, s * 0.92);
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



