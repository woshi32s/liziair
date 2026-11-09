/* lizi52 · 极光帷幕 · aurora
   高能粒子沿磁力线落下，铺成一层层竖立的极光帷幕；
   帷幕在三维里前后错开（7 层 z），被风吹得折叠、被 gust 整片甩动。
   字不是画上去的：字形采样点吸附到最近的那层帘上，
   一小片粒子的亮度被抬到最亮的一档、位置往字形点收 ——
   于是"字"就是帘上最亮的那一块，暗部仍是流动的青绿 / 紫光帘。 */

const A52_N = 8000;          /* 总粒子 8000（5000~9000） */
const A52_L = 7;             /* 帷幕层数 */
const A52_MS = 5;            /* 每层最多几条帘股 */

/* ---- 粒子（按层连续铺，字粒子在数组尾部） ---- */
const a52u = new Float32Array(A52_N);    /* 帘面参数 u 0..1 */
const a52v = new Float32Array(A52_N);    /* 帘面参数 v 0..1（0 顶 / 1 底） */
const a52uR = new Float32Array(A52_N);   /* 字粒子：未点亮时的帘面 u */
const a52vR = new Float32Array(A52_N);
const a52uG = new Float32Array(A52_N);   /* 字粒子：字形点对应的 u */
const a52vG = new Float32Array(A52_N);
const a52gx = new Float32Array(A52_N);   /* 字形点（设计坐标） */
const a52gy = new Float32Array(A52_N);
const a52jx = new Float32Array(A52_N);
const a52jy = new Float32Array(A52_N);
const a52sz = new Float32Array(A52_N);
const a52spd = new Float32Array(A52_N);  /* 沿磁力线下落速度 */
const a52core = new Float32Array(A52_N); /* 距帘股核心的程度 0..1 */
const a52wt = new Float32Array(A52_N);
const a52lay = new Uint8Array(A52_N);
const a52band = new Uint8Array(A52_N);
const a52att = new Int16Array(A52_N).fill(-1);
const a52ch = new Uint8Array(A52_N);

/* ---- 每帧投影后的屏幕坐标 ---- */
const a52sx = new Float32Array(A52_N);
const a52sy = new Float32Array(A52_N);
const a52sw = new Float32Array(A52_N);
const a52sh = new Float32Array(A52_N);
const a52sb = new Uint8Array(A52_N);

let a52Body = A52_N, a52Let = 0, a52Host = 3;
let a52Gust = 0, a52GustDir = 1;
let a52Sky = null, a52Glow = null, a52Tex = null;

/* ---- 每层几何 ---- */
const a52D = new Float32Array(A52_L);
const a52Ph = new Float32Array(A52_L);
const a52X0 = new Float32Array(A52_L);
const a52WW = new Float32Array(A52_L);
const a52Top = new Float32Array(A52_L);
const a52Bot = new Float32Array(A52_L);
const a52Fold = new Float32Array(A52_L);
const a52Boom = new Float32Array(A52_L);
const a52Z = new Float32Array(A52_L);
const a52NC = new Uint8Array(A52_L);              /* 帘股数 */
const a52SC = new Float32Array(A52_L * A52_MS);   /* 帘股中心 x */
const a52SW = new Float32Array(A52_L * A52_MS);   /* 帘股半宽 px */

/* 字形采样密度：长句稀疏一点，短句密一点（保证字粒子能铺满字） */
function mechStep(text) { return text.length > 18 ? 4 : 3; }

function mechResize() {
  if (!W || !H) return;

  /* 7 层帷幕：z 从 -1（近）到 +1（远） */
  for (let L = 0; L < A52_L; L++) {
    const d = -1 + (2 * L) / (A52_L - 1);
    a52D[L] = d;
    a52Ph[L] = L * 1.71 + rnd(0, 0.5);
    a52X0[L] = -W * 0.13 + rnd(-W * 0.02, W * 0.02);
    a52WW[L] = W * 1.26;
    a52Top[L] = H * (0.040 + 0.020 * L) + rnd(-H * 0.012, H * 0.012);
    let b = H * (0.70 + 0.15 * Math.sin(L * 2.15 + 0.7));
    if (b - a52Top[L] < H * 0.50) b = a52Top[L] + H * 0.50;
    if (b - a52Top[L] > H * 0.80) b = a52Top[L] + H * 0.80;
    a52Bot[L] = b;
    a52Fold[L] = W * (0.018 + 0.010 * Math.abs(Math.sin(L * 1.3 + 2))) * (1 - d * 0.18);
    a52Boom[L] = H * (0.020 + 0.018 * Math.abs(Math.sin(L * 2.7 + 1.1)));

    /* 每层 3~4 条竖向帘股，层与层错开，叠出极光的层次 */
    const n = 3 + (L % 2);
    a52NC[L] = n;
    for (let s = 0; s < n; s++) {
      const k = L * A52_MS + s;
      a52SC[k] = a52X0[L] + a52WW[L] * (0.09 + 0.82 * ((s + 0.5) / n + rnd(-0.08, 0.08)));
      a52SW[k] = W * (0.030 + Math.random() * 0.035);
    }
  }

  /* 分层撒点：近层多一点；帘股附近密、股间稀 */
  const wt = [1.16, 1.11, 1.06, 1.0, 0.95, 0.90, 0.86];
  let sum = 0;
  for (let L = 0; L < A52_L; L++) sum += wt[L];
  a52Body = A52_N; a52Let = 0;
  let idx = 0;
  for (let L = 0; L < A52_L; L++) {
    const cnt = (L === A52_L - 1) ? A52_N - idx
      : Math.round(A52_N * wt[L] / sum);
    const n = a52NC[L];
    for (let k = 0; k < cnt && idx < A52_N; k++, idx++) {
      const i = idx;
      a52lay[i] = L;
      const s = (Math.random() * n) | 0;
      const kk = L * A52_MS + s;
      const uc = (a52SC[kk] - a52X0[L]) / a52WW[L];
      const su = a52SW[kk] / a52WW[L];
      let u;
      if (Math.random() < 0.13) u = Math.random();               /* 股间薄纱 */
      else u = uc + ((Math.random() + Math.random() + Math.random() - 1.5) / 1.5) * su;
      u = clamp01(u);
      let core = 1 - Math.abs(u - uc) / Math.max(0.0001, su);
      core = core < 0 ? 0 : core * core;

      a52u[i] = a52uR[i] = u;
      let v = Math.pow(Math.random(), 0.45);
      if (Math.random() < 0.30) v = 0.86 + Math.random() * 0.14; /* 底缘亮边 */
      a52v[i] = a52vR[i] = v;
      a52core[i] = core;

      const ph = a52Ph[L];
      /* 上半透成紫，底部保持青绿 */
      a52band[i] = (v < 0.40 + 0.15 * Math.sin(u * 9.0 + ph) || core < 0.08) ? 1 : 0;
      const dep = 1 - a52D[L] * 0.22;
      a52sz[i] = (0.72 + Math.random() * 0.7) * dep * (0.75 + 0.5 * core)
        * (v > 0.86 ? 1.22 : 1);
      a52spd[i] = 0.010 + Math.random() * 0.045;
      a52jx[i] = rnd(-1.5, 1.5);
      a52jy[i] = rnd(-2, 2);
      a52att[i] = -1;
    }
  }

  a52BakeSky();
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) return;
  a52Host = 3;                 /* 离文字平面最近的那层帘 */
  a52Gust = 0.9;
  a52Let = Math.min(pc, A52_N - 3200, 5000);
  a52Body = A52_N - a52Let;

  for (let k = 0; k < a52Let; k++) {
    const i = a52Body + k;
    let q = a52Let === pc ? k : ((k * pc) / a52Let + Math.random() * 0.7) | 0;
    if (q >= pc) q = pc - 1;
    const gx = blockGx + g.px[q];
    const gy = blockGy + g.py[q];
    const L = (Math.random() * A52_L) | 0;

    a52att[i] = q;
    a52ch[i] = g.own[q];
    a52gx[i] = gx; a52gy[i] = gy;
    a52wt[i] = 0.82 + Math.random() * 0.18;
    a52lay[i] = L;
    a52uR[i] = Math.random();
    a52vR[i] = Math.pow(Math.random(), 0.52);
    /* 字形点反算到那层帘的帘面参数 */
    a52uG[i] = clamp01((gx - a52X0[L]) / a52WW[L]);
    a52vG[i] = clamp01((gy - a52Top[L]) / (a52Bot[L] - a52Top[L]));
    a52sz[i] = 1.0 + Math.random() * 0.4;
    a52jx[i] = rnd(-1.0, 1.0);
    a52jy[i] = rnd(-1.2, 1.2);
    a52core[i] = 1;
    a52band[i] = Math.random() < 0.5 ? 0 : 1;
  }
}

function mechEvent(k, first) {
  a52GustDir = (k % 2) ? -1 : 1;
  a52Gust = first ? 1.75 : 1.15;
  cam.ox = a52GustDir * (first ? 42 : 24);
  cam.oy = -7;
  cam.rot = -a52GustDir * (first ? 0.0075 : 0.005);   /* 轻微滚转 */
}

function mechUpdate(dt, T) {
  if (dt <= 0) return;
  a52Gust *= Math.exp(-dt * 2.2);
  /* 缓推：1.0 → 1.04 往复；不压掉骨架命中时的猛推 */
  const breath = 1.021 + 0.019 * Math.sin(T * 0.36);
  if (cam.tz < breath) cam.tz = breath;
}

/* 帷幕面在高度 vv 处被风吹出的横向位移（粒子与辉光共用） */
function a52Sway(xc, vv, L, T) {
  const ph = a52Ph[L];
  return Math.sin(vv * 3.4 + ph + T * 0.62) * a52Fold[L] * (0.35 + 0.65 * vv)
    + Math.sin(xc * 0.006 + ph * 1.7 - T * 0.85) * a52Fold[L] * 0.5
    + a52Gust * (a52GustDir * 26 + 18 * Math.sin(vv * 2.4 + ph + T * 1.6));
}

/* 预烘一张竖长条帘体贴图：底亮顶淡、两侧羽化、带一点纤维纹（青绿 / 紫） */
function a52BakeTex() {
  const cols = [[70, 245, 195], [150, 125, 255]];
  const out = [];
  for (let k = 0; k < 2; k++) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 256;
    const g = c.getContext('2d');
    const col = cols[k];
    const vg = g.createLinearGradient(0, 0, 0, 256);
    vg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    vg.addColorStop(0.28, `rgba(${col[0]},${col[1]},${col[2]},0.06)`);
    vg.addColorStop(0.62, `rgba(${col[0]},${col[1]},${col[2]},0.22)`);
    vg.addColorStop(0.88, `rgba(${col[0]},${col[1]},${col[2]},0.54)`);
    vg.addColorStop(0.97, `rgba(${col[0]},${col[1]},${col[2]},0.26)`);
    vg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = vg; g.fillRect(0, 0, 96, 256);
    /* 纤维：几条细竖纹，上下跟着帘体的浓淡一起淡出 */
    g.globalCompositeOperation = 'lighter';
    const fg = g.createLinearGradient(0, 0, 0, 256);
    fg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    fg.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},0.05)`);
    fg.addColorStop(0.9, `rgba(${col[0]},${col[1]},${col[2]},0.22)`);
    fg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = fg;
    for (let f = 0; f < 15; f++) {
      const fx = 6 + f * 5.8 + Math.random() * 3;
      g.fillRect(fx, 0, 1.4, 256);
    }
    /* 横向羽化 */
    g.globalCompositeOperation = 'destination-in';
    const hg = g.createLinearGradient(0, 0, 96, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.26, 'rgba(0,0,0,1)');
    hg.addColorStop(0.74, 'rgba(0,0,0,1)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, 0, 96, 256);
    g.globalCompositeOperation = 'source-over';
    out.push(c);
  }
  return out;
}

/* ============================ 预烘 ============================ */
function a52BakeSky() {
  const bw = Math.max(2, Math.round(W)), bh = Math.max(2, Math.round(H));

  if (!a52Sky) a52Sky = document.createElement('canvas');
  a52Sky.width = bw; a52Sky.height = bh;
  const sc = a52Sky.getContext('2d');
  const g = sc.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#03050d');
  g.addColorStop(0.34, '#050e1e');
  g.addColorStop(0.60, '#07182b');
  g.addColorStop(0.84, '#051120');
  g.addColorStop(1, '#02060c');
  sc.fillStyle = g; sc.fillRect(0, 0, bw, bh);
  /* 地平线附近很淡的冷光 */
  const hz = sc.createRadialGradient(bw * 0.5, bh * 1.02, 0, bw * 0.5, bh * 1.02, bh * 0.8);
  hz.addColorStop(0, 'rgba(26,96,104,0.16)');
  hz.addColorStop(0.55, 'rgba(16,56,74,0.07)');
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  sc.fillStyle = hz; sc.fillRect(0, 0, bw, bh);

  /* 星点：三档亮度批一次画完 */
  const stars = [];
  for (let i = 0; i < 380; i++) {
    const sx = 26 + Math.random() * (bw - 52);
    const sy = 22 + Math.pow(Math.random(), 1.25) * (bh * 0.9 - 22);
    stars.push([sx, sy, Math.random()]);
  }
  const tiers = [
    ['rgba(180,205,255,0.14)', 0, 0.55, 0.55],
    ['rgba(210,228,255,0.26)', 0.55, 0.88, 0.8],
    ['rgba(238,248,255,0.46)', 0.88, 1.01, 1.1]
  ];
  for (let t = 0; t < tiers.length; t++) {
    const [col, lo, hi, sz] = tiers[t];
    sc.fillStyle = col;
    sc.beginPath();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i][2];
      if (s < lo || s >= hi) continue;
      sc.rect(stars[i][0], stars[i][1], sz, sz);
    }
    sc.fill();
  }

  /* 帘体体积光：预烘的竖长条贴图，按帘股一次烘进夜空 */
  if (!a52Tex) a52Tex = a52BakeTex();
  for (let L = 0; L < A52_L; L++) {
    const n = a52NC[L];
    const tex = a52Tex[L & 1];
    for (let s = 0; s < n; s++) {
      const kk = L * A52_MS + s;
      const xc = a52SC[kk];
      const topY = a52Top[L] + H * 0.05;
      const hh = a52Bot[L] - topY;
      if (hh < 20) continue;
      const wv = a52SW[kk] * 3.0;
      /* 贴边的帘股淡下去，画面边缘保持干净 */
      let ef = Math.min(xc, W - xc) / (W * 0.20);
      ef = ef < 0 ? 0 : ef > 1 ? 1 : ef;
      ef = 0.10 + 0.90 * ef;
      sc.save();
      sc.globalCompositeOperation = 'lighter';
      sc.translate(xc, topY);
      sc.transform(1, 0, 0.045, 1, 0, 0);
      sc.globalAlpha = (0.20 - a52D[L] * 0.06) * ef;
      sc.drawImage(tex, -wv * 0.95, 0, wv * 1.9, hh);
      sc.globalAlpha = (0.26 - a52D[L] * 0.08) * ef;
      sc.drawImage(tex, -wv * 0.5, 0, wv, hh);
      sc.restore();
    }
  }

  /* 暗角：压住画面边缘（也避免亮帘贴边） */
  const vg2 = sc.createRadialGradient(bw * 0.5, bh * 0.5, bh * 0.24,
    bw * 0.5, bh * 0.5, bw * 0.68);
  vg2.addColorStop(0, 'rgba(2,4,10,0)');
  vg2.addColorStop(0.62, 'rgba(2,4,10,0.20)');
  vg2.addColorStop(1, 'rgba(2,4,10,0.72)');
  sc.fillStyle = vg2; sc.fillRect(0, 0, bw, bh);

  /* 底缘辉光贴图：青绿 / 紫 两张，预烘（半径小于半高，四边透明） */
  if (!a52Glow) {
    a52Glow = [document.createElement('canvas'), document.createElement('canvas')];
    const gc = [
      ['rgba(80,245,200,0.50)', 'rgba(40,185,165,0.18)'],
      ['rgba(150,120,255,0.44)', 'rgba(85,75,215,0.16)']
    ];
    for (let k = 0; k < 2; k++) {
      const c = a52Glow[k];
      c.width = 256; c.height = 128;
      const cc = c.getContext('2d');
      const rg = cc.createRadialGradient(128, 64, 0, 128, 64, 58);
      rg.addColorStop(0, gc[k][0]);
      rg.addColorStop(0.5, gc[k][1]);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      cc.fillStyle = rg; cc.fillRect(0, 0, 256, 128);
    }
  }
}

/* ============================ 每帧 ============================ */
function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  if (a52Sky) ctx.drawImage(a52Sky, 0, 0, W, H);

  const cosR = Math.cos(cam.rot), sinR = Math.sin(cam.rot);
  const ax = W / 2 + cam.shx, ay = H / 2 + cam.shy;
  for (let L = 0; L < A52_L; L++) a52Z[L] = z * (1 - a52D[L] * 0.05);
  const zHost = a52Z[a52Host];

  ctx.globalCompositeOperation = 'lighter';

  /* ---- 帷幕底缘的辉光：被风带着走 ---- */
  const gust = a52Gust;
  for (let L = 0; L < A52_L; L++) {
    const ph = a52Ph[L];
    let gxp = W * 0.5 + Math.sin(T * 0.40 + ph) * W * 0.30
      + gust * a52GustDir * 30;
    if (gxp < W * 0.20) gxp = W * 0.20;
    if (gxp > W * 0.80) gxp = W * 0.80;
    const by = a52Bot[L] + Math.sin(gxp * 0.0038 + ph * 2.1 + T * 0.3) * a52Boom[L];
    const gw = W * (0.24 + 0.06 * Math.sin(ph)), gh = H * 0.075;
    let al = 0.08 + 0.04 * Math.sin(T * 0.8 + ph) + 0.15 * gust;
    al = Math.max(0, Math.min(0.26, al));
    ctx.globalAlpha = al;
    ctx.drawImage(a52Glow[L & 1], gxp - gw * 0.5, by - gh * 0.5, gw, gh);
  }
  ctx.globalAlpha = 1;

  /* ---- 粒子：先算一遍屏幕位置，再按亮度 3 档批量填 ---- */
  /* 文字整体跟着宿主帘轻轻摆，但每个字形点仍被精确吸住 */
  const tsw = a52Sway(W * 0.5, 0.7, a52Host, T) * 0.12;
  for (let i = 0; i < A52_N; i++) {
    const L = a52lay[i];
    let u = a52u[i], v = a52v[i], band = a52band[i], sz = a52sz[i];
    let a = 0, gx = 0, gy = 0;

    if (i >= a52Body) {
      const gl = charGlow[a52ch[i]] || 0;
      a = gl * a52wt[i];
      if (a > 1) a = 1;
      a = a * a * (3 - 2 * a);
      if (a > 0.0005) {
        gx = a52gx[i]; gy = a52gy[i];
        u = a52uR[i] + (a52uG[i] - a52uR[i]) * a;
        v = a52vR[i] + (a52vG[i] - a52vR[i]) * a;
      }
    }

    let vv = v + T * a52spd[i] * (1 - a);
    vv -= Math.floor(vv);

    const xBase = a52X0[L] + u * a52WW[L];
    const x = xBase + a52Sway(xBase, vv, L, T) + a52jx[i];
    const bot = a52Bot[L] + Math.sin(x * 0.0038 + a52Ph[L] * 2.1 + T * 0.3) * a52Boom[L]
      + gust * a52GustDir * 12 * vv;
    let y = a52Top[L] + vv * (bot - a52Top[L]) + a52jy[i];

    let xf = x, yf = y;
    if (a > 0.0005) {
      xf = x + (gx + tsw - x) * a;
      yf = y + (gy - y) * a;
      if (a > 0.55) band = 2;
      else if (a > 0.20) band = 1;
    }

    const zl = a52Z[L] + (zHost - a52Z[L]) * a;
    const dx = (xf - cam.x) * zl, dy = (yf - cam.y) * zl;
    const px = ax + dx * cosR - dy * sinR;
    const py = ay + dx * sinR + dy * cosR;
    if (px < 15 || px > W - 15 || py < 15 || py > H - 15) continue;

    let w, h;
    if (band === 2) { w = 1.35 + 0.35 * sz; h = 2.0 + 0.6 * sz; }
    else {
      const hb = L === a52Host ? 1.12 : 1;     /* 承载文字的那层帘最亮 */
      w = sz * 1.02 * hb; h = sz * (1.7 + 3.1 * vv) * hb;
    }
    a52sx[i] = px; a52sy[i] = py; a52sw[i] = w; a52sh[i] = h; a52sb[i] = band;
  }

  ctx.fillStyle = 'rgba(30,226,168,0.40)';
  ctx.beginPath();
  for (let i = 0; i < A52_N; i++) {
    if (a52sb[i] !== 0) continue;
    const w = a52sw[i], h = a52sh[i];
    ctx.rect(a52sx[i] - w * 0.5, a52sy[i] - h * 0.5, w, h);
  }
  ctx.fill();

  ctx.fillStyle = `rgba(${Math.min(255, ar)},${Math.max(0, ag - 78)},${Math.min(255, ab)},0.33)`;
  ctx.beginPath();
  for (let i = 0; i < A52_N; i++) {
    if (a52sb[i] !== 1) continue;
    const w = a52sw[i], h = a52sh[i];
    ctx.rect(a52sx[i] - w * 0.5, a52sy[i] - h * 0.5, w, h);
  }
  ctx.fill();

  /* 字的外晕：只有最亮那档参与，范围很小，避免糊成白条 */
  if (a52Let > 0) {
    ctx.fillStyle = 'rgba(190,255,236,0.05)';
    ctx.beginPath();
    for (let i = a52Body; i < A52_N; i++) {
      if (a52sb[i] !== 2) continue;
      const w = a52sw[i], h = a52sh[i];
      ctx.rect(a52sx[i] - w * 0.6, a52sy[i] - h * 0.6, w * 1.2, h * 1.2);
    }
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(238,255,250,0.95)';
  ctx.beginPath();
  for (let i = 0; i < A52_N; i++) {
    if (a52sb[i] !== 2) continue;
    const w = a52sw[i], h = a52sh[i];
    ctx.rect(a52sx[i] - w * 0.5, a52sy[i] - h * 0.5, w, h);
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



