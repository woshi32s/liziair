/* lizi59 · 龙卷风 · tornado
   字 = 被卷到漏斗壁上的碎屑，转到字形采样点的角度就被"卡"住。
   每颗碎屑有 角度 a / 高度 h / 半径系数；
     y = 底 - h*(底-顶)，r = 40 + 260*h^1.6，x = 轴 + cos(a)*r，z = sin(a)*r
   角速度随 h 衰减（底部最快），h 缓慢上升，到顶从底重生。
   字形采样点 (x,y) 映射成 (角度, 高度)，卡住时角速度归零、亮度拉满、微抖。
   镜头跟着漏斗底部左右追；命中 tz 冲一下、rot 滚一点；地面粒子环抽帧。
   同色 batch rect；暖光背景 resize 时预烘一张 canvas。 */

const NA59 = 3200, NT59 = 4600, NG59 = 1200;
const TAU59 = Math.PI * 2;
const R059 = 40, R159 = 300;
const YB59 = 0.86, YT59 = 0.10;
const PF59 = 0.00105;
const HARC59 = 1.20;
/* 半径档位查表：r(h) 每帧要算上万次，pow 换成插值 */
const RLUT59 = new Float32Array(513);
function buildLut59() {
  for (let i = 0; i <= 512; i++) {
    const h = i / 512;
    RLUT59[i] = R059 + (R159 - R059) * Math.pow(h, 1.6);
  }
}
buildLut59();
function r59(h) {
  let f = h * 512;
  let i = f | 0;
  if (i < 0) i = 0; else if (i > 511) i = 511;
  const t = f - i;
  return RLUT59[i] + (RLUT59[i + 1] - RLUT59[i]) * t;
}

/* ---- 尘土：沿壁上升 ---- */
const aa59 = new Float32Array(NA59);
const ah59 = new Float32Array(NA59);
const av59 = new Float32Array(NA59);
const am59 = new Float32Array(NA59);
const ar59 = new Float32Array(NA59);
const az59 = new Float32Array(NA59);
const asx59 = new Float32Array(NA59), asy59 = new Float32Array(NA59);
const asz59 = new Float32Array(NA59);
const ab59 = new Uint8Array(NA59);

/* ---- 字：卡在壁上的碎屑 ---- */
const ta59 = new Float32Array(NT59), th59 = new Float32Array(NT59);
const tm59 = new Float32Array(NT59), tv59 = new Float32Array(NT59);
const tA59 = new Float32Array(NT59), tH59 = new Float32Array(NT59);
const tD59 = new Float32Array(NT59), tS59 = new Float32Array(NT59);
const tR59 = new Float32Array(NT59);
const tsx59 = new Float32Array(NT59), tsy59 = new Float32Array(NT59);
const tsz59 = new Float32Array(NT59);
const tb59 = new Uint8Array(NT59);

/* ---- 地面碎屑环 ---- */
const ga59 = new Float32Array(NG59), gr59 = new Float32Array(NG59);
const gv59 = new Float32Array(NG59), gz59 = new Float32Array(NG59);
const gl59 = new Float32Array(NG59);
const gsx59 = new Float32Array(NG59), gsy59 = new Float32Array(NG59);
const gss59 = new Float32Array(NG59);

let glow59 = null;
let gRef59 = null, hasT59 = false;
let tl59 = 0, ld59 = 2.8, lineNo59 = 0;
let kick59 = 0, roll59 = 0, gAcc59 = 0, lastStep59 = -1;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < NA59; i++) {
    aa59[i] = rnd(0, TAU59);
    ah59[i] = Math.pow(Math.random(), 0.9);
    av59[i] = rnd(0.05, 0.17);
    am59[i] = rnd(0.75, 1.3);
    ar59[i] = rnd(0.84, 1.16);
    az59[i] = rnd(1.8, 3.4);
  }
  for (let i = 0; i < NT59; i++) {
    ta59[i] = rnd(0, TAU59);
    th59[i] = Math.pow(Math.random(), 0.9);
    tm59[i] = rnd(0.8, 1.25);
    tv59[i] = rnd(0.05, 0.15);
    tS59[i] = rnd(4.4, 5.4);
  }
  for (let i = 0; i < NG59; i++) {
    ga59[i] = rnd(0, TAU59);
    gr59[i] = rnd(0.16, 1.0);
    gv59[i] = rnd(3.2, 9.0);
    gz59[i] = rnd(1.2, 2.8);
    gl59[i] = Math.pow(Math.random(), 3) * rnd(0, 70);
  }
  makeGlow59();
  if (hasT59 && gRef59) buildTargets59(gRef59);
  lastStep59 = -1; gAcc59 = 0;
}

function makeGlow59() {
  glow59 = document.createElement('canvas');
  glow59.width = Math.max(2, W | 0);
  glow59.height = Math.max(2, H | 0);
  const g2 = glow59.getContext('2d');
  const yB = H * YB59, ax = W * 0.57;
  const lg = g2.createLinearGradient(0, H * 0.40, 0, H);
  lg.addColorStop(0, 'rgba(42,24,15,0)');
  lg.addColorStop(0.55, 'rgba(104,58,30,0.30)');
  lg.addColorStop(0.86, 'rgba(82,44,22,0.44)');
  lg.addColorStop(1, 'rgba(34,17,10,0.55)');
  g2.fillStyle = lg;
  g2.fillRect(0, H * 0.40, W, H * 0.60);
  const rg = g2.createRadialGradient(ax, yB, 0, ax, yB, Math.max(W, H) * 0.52);
  rg.addColorStop(0, 'rgba(255,164,86,0.36)');
  rg.addColorStop(0.32, 'rgba(176,98,48,0.17)');
  rg.addColorStop(1, 'rgba(120,64,32,0)');
  g2.fillStyle = rg;
  g2.fillRect(0, 0, W, H);
  const vg = g2.createLinearGradient(0, 0, 0, H * 0.45);
  vg.addColorStop(0, 'rgba(0,0,0,0.30)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  g2.fillStyle = vg;
  g2.fillRect(0, 0, W, H * 0.45);
  /* 四周削掉一圈，免得暖光糊到画布边缘 */
  g2.globalCompositeOperation = 'destination-out';
  function edgeMask(x0, y0, x1, y1, rx, ry, rw, rh) {
    const gr = g2.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = gr;
    g2.fillRect(rx, ry, rw, rh);
  }
  const F = 64;
  edgeMask(0, 0, 0, F, 0, 0, W, F);
  edgeMask(0, H, 0, H - F, 0, H - F, W, F);
  edgeMask(0, 0, F, 0, 0, 0, F, H);
  edgeMask(W, 0, W - F, 0, W - F, 0, F, H);
  g2.globalCompositeOperation = 'source-over';
}

/* 把字形采样点转成 (角度, 高度)。x→角度，y→高度。
   长句会被 base 折成两行：先找中间那条空带切成两行，
   两行各自拉直后上下错开一个行距，避免在漏斗壁上叠成一团。 */
function buildTargets59(g) {
  const pc = g.pc | 0;
  if (!pc || !W || !H) return;
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (let p = 0; p < pc; p++) {
    const x = g.px[p], y = g.py[p];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  const spanX = Math.max(1, mxx - mnx), spanY = Math.max(1, mxy - mny);
  const cx = (mnx + mxx) * 0.5;

  /* 行分割：竖直投影里中间最长的一段空白 → 两行 */
  let splitY = mxy;
  {
    const HN = 96, hbins = new Uint16Array(HN), k = HN / spanY;
    for (let p = 0; p < pc; p++) {
      let bi = ((g.py[p] - mny) * k) | 0;
      if (bi < 0) bi = 0; else if (bi >= HN) bi = HN - 1;
      hbins[bi]++;
    }
    let run = 0, bestLen = 0, bestMid = -1;
    for (let b = 1; b < HN - 1; b++) {
      if (!hbins[b]) { run++; continue; }
      if (run >= 8 && run > bestLen) {
        const mid = b - run * 0.5;
        if (mid > HN * 0.33 && mid < HN * 0.67) { bestLen = run; bestMid = mid; }
      }
      run = 0;
    }
    if (bestMid > 0) splitY = mny + (bestMid / HN) * spanY;
  }
  const two = splitY < mxy - 1;

  /* 两行各自的横向范围（折行后的两段接成一条连续的文本流） */
  let x0mn = 1e9, x0mx = -1e9, x1mn = 1e9, x1mx = -1e9;
  for (let p = 0; p < pc; p++) {
    const gx = g.px[p];
    if (!two || g.py[p] < splitY) {
      if (gx < x0mn) x0mn = gx; if (gx > x0mx) x0mx = gx;
    } else {
      if (gx < x1mn) x1mn = gx; if (gx > x1mx) x1mx = gx;
    }
  }
  if (x0mx < x0mn) { x0mn = mnx; x0mx = mxx; }
  if (x1mx < x1mn) { x1mn = x0mn; x1mx = x0mx; }
  const w0 = Math.max(1, x0mx - x0mn), w1 = Math.max(1, x1mx - x1mn);
  const totalW = w0 + (two ? w1 * 1.02 : 0);

  /* 字带：按弧长决定绕几圈。长句拆成几段，每段占一条正面弧，
     越往下越窄 → 形成一圈圈螺旋往下的字。 */
  const hb = 0.92;
  const rT = r59(hb) * 1.36;
  const arcPx = 2 * Math.sin(HARC59) * rT;
  let R = Math.round(totalW / (arcPx * 1.00));
  if (R < 1) R = 1; else if (R > 3) R = 3;
  let scale = arcPx * R / totalW;
  if (scale > 1.25) scale = 1.25;
  const kH = Math.max(1, H * (YB59 - YT59));
  const rowH = two ? Math.max(splitY - mny, mxy - splitY) : spanY;
  let glyphH = (rowH * scale * 1.12) / kH;
  if (glyphH > 0.10) glyphH = 0.10;
  let rowGap = glyphH * 1.18;
  /* 别掉到漏斗下半段 */
  const maxDrop = hb - 0.22;
  const need = (R - 1) * rowGap + glyphH * 0.5;
  if (need > maxDrop) {
    const k = maxDrop / need;
    glyphH *= k; rowGap *= k;
  }

  for (let i = 0; i < NT59; i++) {
    /* 黄金分割序列撒点：均匀铺满字形，又不会和扫描线顺序共振出条纹空洞 */
    const pi = (((i * 0.6180339887498949) % 1) * pc) | 0;
    let gx = g.px[pi], gy = g.py[pi];
    const row = two && gy >= splitY ? 1 : 0;
    const s = row
      ? (w0 * 1.02 + (gx - x1mn)) / totalW
      : (gx - x0mn) / totalW;
    const A = -HARC59 + s * 2 * HARC59 * R;
    let ring = ((A + HARC59) / (2 * HARC59)) | 0;
    if (ring < 0) ring = 0; else if (ring >= R) ring = R - 1;
    const aw = A - ring * 2 * HARC59;
    /* 正面朝镜头：a = -PI/2 + 弧内偏移 */
    tA59[i] = -Math.PI * 0.5 + aw;
    const ty = row ? (gy - splitY) / (mxy - splitY) : (gy - mny) / ((two ? splitY : mxy) - mny);
    const tyc = ty < 0 ? 0 : ty > 1 ? 1 : ty;
    const hc = hb - ring * rowGap;
    let hh = hc + (0.5 - tyc) * glyphH;
    if (hh < 0.04) hh = 0.04; else if (hh > 0.98) hh = 0.98;
    tH59[i] = hh;
    /* 半径按圈取定值：同一圈的字落在同一段圆柱面上，不会被锥面斜切 */
    tR59[i] = r59(hc) * 1.36 + 2;
    /* 卡住的顺序：沿文本流从左到右扫，加一点散 */
    let d = 0.03 + 0.55 * s + Math.random() * 0.16;
    if (d > 0.82) d = 0.82;
    tD59[i] = d;
  }
}

function mechAssign(use) {
  lineNo59++;
  tl59 = 0;
  ld59 = use && use.lineDur > 0.4 ? Math.min(6, use.lineDur) : 2.8;
  const g = use && use.g;
  gRef59 = g && g.pc ? g : null;
  hasT59 = !!gRef59;
  if (hasT59) buildTargets59(gRef59);
}

function mechEvent(k, first) {
  kick59 = (k % 2 ? 1 : -1) * (first ? 16 : 10);
  roll59 = (k % 2 ? -1 : 1) * (first ? 0.022 : 0.013);
  cam.tz = first ? 1.06 : 1.045;
}

function mechUpdate(dt, T) {
  const d = dt > 0 ? dt : 0;
  tl59 += d;

  for (let i = 0; i < NA59; i++) {
    let h = ah59[i] + av59[i] * d;
    if (h >= 1) h -= 1;
    ah59[i] = h;
    let a = aa59[i] + (1.9 + 5.6 * (1 - h)) * am59[i] * d;
    if (a >= TAU59) a -= TAU59;
    aa59[i] = a;
  }
  for (let i = 0; i < NT59; i++) {
    let h = th59[i] + tv59[i] * d;
    if (h >= 1) h -= 1;
    th59[i] = h;
    let a = ta59[i] + (1.9 + 5.6 * (1 - h)) * tm59[i] * d;
    if (a >= TAU59) a -= TAU59;
    ta59[i] = a;
  }

  /* 地面碎屑：抽帧（16fps 步进），低而快 */
  gAcc59 += d;
  const st = Math.floor(T * 16);
  if (st !== lastStep59) {
    lastStep59 = st;
    const dd = gAcc59;
    gAcc59 = 0;
    for (let i = 0; i < NG59; i++) {
      let a = ga59[i] + gv59[i] * dd;
      if (a >= TAU59) a -= TAU59;
      ga59[i] = a;
    }
  }

  /* 镜头锁定追踪：跟着漏斗底部左右摆；命中额外冲一下 */
  const kd = Math.exp(-d * 5.5);
  kick59 *= kd;
  roll59 *= kd;
  cam.ox = Math.sin(T * 0.62) * 20 + Math.sin(T * 1.47) * 5 + kick59;
  cam.oy = Math.sin(T * 0.45) * 7;
  cam.rot = Math.sin(T * 0.27) * 0.018 + roll59;
}

function mechDraw(T, z, pjX, pjY) {
  if (!W || !H) return;
  const axis = (blockGx || W * 0.5) + W * 0.07;
  const yB = H * YB59, spanY = H * (YB59 - YT59);
  const Rg = Math.min(W * 0.30, 430);

  if (glow59) ctx.drawImage(glow59, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  /* ---------- 1 · 地面碎屑环：后端（暗） ---------- */
  for (let i = 0; i < NG59; i++) {
    const a = ga59[i], sn = Math.sin(a), rg = gr59[i] * Rg;
    const X = axis + Math.cos(a) * rg * 1.28;
    const Y = yB - sn * rg * 0.20 - gl59[i] * (0.5 - sn * 0.5);
    gsx59[i] = pjX(X, Y); gsy59[i] = pjY(X, Y);
    gss59[i] = gz59[i] * z * (0.8 + 0.5 * (0.5 - sn * 0.5));
  }
  ctx.fillStyle = 'rgb(74,56,44)';
  ctx.beginPath();
  for (let i = 0; i < NG59; i++) {
    if (Math.sin(ga59[i]) <= 0) continue;
    const s = gss59[i];
    if (gsx59[i] < 12 || gsx59[i] > W - 12 || gsy59[i] < 12 || gsy59[i] > H - 12) continue;
    ctx.rect(gsx59[i] - s * 0.5, gsy59[i] - s * 0.5, s * 1.6, s * 0.8);
  }
  ctx.fill();

  /* ---------- 2 · 漏斗壁上的尘土（3 档亮度） ---------- */
  const pjR = 1 / PF59;
  for (let i = 0; i < NA59; i++) {
    const h = ah59[i], a = aa59[i];
    /* 两条螺旋臂：同样 a/h 的碎屑被拉宽、提亮，静止画面也能看出在转 */
    const arm = Math.sin(a * 2 - T * 4.5 + h * 5.0);
    const r = r59(h) * ar59[i] * (1 + 0.14 * arm);
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    const pp = pjR / (pjR + lz);
    const X = axis + lx * pp;
    const Y = yB - h * spanY * (0.86 + 0.14 * pp);
    const u = pjX(X, Y), v = pjY(X, Y);
    if (u < 12 || u > W - 12 || v < 12 || v > H - 12) {
      ab59[i] = 255;
      continue;
    }
    asx59[i] = u; asy59[i] = v;
    asz59[i] = (az59[i] * z * pp * (1 + 0.85 * (1 - h)));
    const sh = 0.46 - lz * 0.00115 + h * 0.12 + arm * 0.10;
    ab59[i] = sh > 0.66 ? 2 : sh > 0.38 ? 1 : 0;
  }
  const acol = ['rgb(60,49,44)', 'rgb(104,83,66)', 'rgb(166,127,88)'];
  for (let b = 0; b < 3; b++) {
    ctx.fillStyle = acol[b];
    ctx.beginPath();
    for (let i = 0; i < NA59; i++) {
      if (ab59[i] !== b) continue;
      const s = asz59[i];
      const st = 1.2 + 2.3 * (1 - ah59[i]);       /* 底部甩得更快 → 拉丝更长 */
      ctx.rect(asx59[i] - s * st * 0.5, asy59[i] - s * 0.42, s * st, s * 0.84);
    }
    ctx.fill();
  }

  /* ---------- 3 · 地面碎屑环：前端（亮，被吸起来） ---------- */
  ctx.fillStyle = 'rgb(196,132,74)';
  ctx.beginPath();
  for (let i = 0; i < NG59; i++) {
    if (Math.sin(ga59[i]) > 0) continue;
    const s = gss59[i];
    if (gsx59[i] < 12 || gsx59[i] > W - 12 || gsy59[i] < 12 || gsy59[i] > H - 12) continue;
    ctx.rect(gsx59[i] - s * 0.5, gsy59[i] - s * 0.5, s * 1.7, s * 0.9);
  }
  ctx.fill();

  /* ---------- 4 · 卡在壁上的字 ---------- */
  if (!hasT59 || !L) return;
  const prog = clamp01(tl59 / (ld59 * 0.62));
  if (prog <= 0) return;

  let vis = 0;
  for (let i = 0; i < NT59; i++) {
    let k = (prog - tD59[i]) / 0.09;
    if (k <= 0) { tb59[i] = 0; continue; }
    if (k > 1) k = 1;
    const sm = k * k * (3 - 2 * k);

    const th = tH59[i], ta = tA59[i];
    const tr = tR59[i];
    const lzT = Math.sin(ta) * tr;
    const ppT = pjR / (pjR + lzT);
    const TX = axis + Math.cos(ta) * tr * ppT;
    const TY = yB - th * spanY * (0.86 + 0.14 * ppT);

    const oh = th59[i], oa = ta59[i];
    const orr = r59(oh) * 0.99;
    const lzO = Math.sin(oa) * orr;
    const ppO = pjR / (pjR + lzO);
    const OX = axis + Math.cos(oa) * orr * ppO;
    const OY = yB - oh * spanY * (0.86 + 0.14 * ppO);

    const jx = Math.sin(T * 31 + i * 1.7) * 1.5 * sm;
    const jy = Math.cos(T * 27 + i * 1.13) * 1.5 * sm;
    const X = OX + (TX - OX) * sm + jx;
    const Y = OY + (TY - OY) * sm + jy;
    tsx59[i] = pjX(X, Y); tsy59[i] = pjY(X, Y);
    tsz59[i] = tS59[i] * z * (0.6 + 0.4 * sm) * ppT;
    if (tsx59[i] < 12 || tsx59[i] > W - 12 || tsy59[i] < 12 || tsy59[i] > H - 12) { tb59[i] = 0; continue; }
    tb59[i] = 1;
    vis++;
  }
  if (!vis) return;

  /* 暗底：把字后面的尘土压下去，笔画才有对比 */
  ctx.fillStyle = 'rgba(16,10,8,0.88)';
  ctx.beginPath();
  for (let i = 0; i < NT59; i++) {
    if (!tb59[i]) continue;
    const s = tsz59[i] * 1.3;
    ctx.rect(tsx59[i] - s * 0.5, tsy59[i] - s * 0.5, s, s * 0.96);
  }
  ctx.fill();

  ctx.fillStyle = 'rgb(255,206,124)';
  ctx.beginPath();
  for (let i = 0; i < NT59; i++) {
    if (!tb59[i]) continue;
    const s = tsz59[i];
    ctx.rect(tsx59[i] - s * 0.5, tsy59[i] - s * 0.5, s, s * 0.94);
  }
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,246,222,0.9)';
  ctx.beginPath();
  for (let i = 0; i < NT59; i += 3) {
    if (!tb59[i]) continue;
    const s = tsz59[i] * 0.9;
    ctx.rect(tsx59[i] - s * 0.5, tsy59[i] - s * 0.5, s, s * 0.94);
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



