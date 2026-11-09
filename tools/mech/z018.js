/* ============================================================================
   018 · 无限缩放 · 粒子版（v4）

   上一版是"花字 + 隧道"，被否了。这一版回到粒子：
   · 字形被采样成 1500~5600 颗粒子，每颗粒子知道自己的字（own），
     整句以涡心为中心，沿对数螺线**拧出来**（内圈先到、外圈后到，像从洞里长出来）。
   · YRC 逐字点亮：charGlow 驱动亮度/尺寸/该字的一团光晕；没唱到的字也有 0.55 亮度
     （骨架要求：不许只亮半句）。词团命中时爆一圈火花 + 顿帧 + 推进 + 震。
   · 无限缩放：每句结尾（lineDur-0.3）粒子被反拧回涡心；下一句再从涡心长出来，
     透视环一直在往镜头流，镜头持续漂移 + 呼吸变焦。
   · 背景质感：星云（按封面色现烤）+ 两层视差星点 + 透视隧道环 + 胶片颗粒（DOM 叠层）。
   ========================================================================== */

const VN = 5600;
const SPK = 480;

const vTx = new Float32Array(VN), vTy = new Float32Array(VN);
const vOwn = new Int16Array(VN), vPh = new Float32Array(VN);
const vTw = new Float32Array(VN), vDel = new Float32Array(VN), vSz = new Float32Array(VN);
const vAng = new Float32Array(VN), vRad = new Float32Array(VN);
const vSX = new Float32Array(VN), vSY = new Float32Array(VN);
const vSL = new Float32Array(VN), vSS = new Float32Array(VN);
let vn = 0, vLineT = 0, vLineDur = 4, vLineIdx = -1;
let vcX = null, vcY = null;
let vMaxRad = 1;

let C_CORE = '#fff', C_MID = '#ddd', C_DIM = '#999', C_TUN = '#bbb', C_GLOW = '#fff';
let nebCv = null, glowCv = null, grainEl = null;
let palKey = '';
const STARS = 170;
const starX = new Float32Array(STARS), starY = new Float32Array(STARS);
const starD = new Float32Array(STARS), starS = new Float32Array(STARS);
const starA = new Float32Array(STARS);

const spX = new Float32Array(SPK), spY = new Float32Array(SPK);
const spVX = new Float32Array(SPK), spVY = new Float32Array(SPK);
const spL = new Float32Array(SPK), spM = new Float32Array(SPK);
let spIx = 0;
let lastDt = 0.016;

/* 换句残影：上一句的粒子往涡心缩一小段，别让字“啪”地消失 */
const RN = 2600;
const rX = new Float32Array(RN), rY = new Float32Array(RN);
let rN = 0, rT0 = -99;

/* 入场蜂群：从涡心拧到各自的目标点，压到字上（字本身一直在位，所以任何一帧都读得出整句） */
const SWN = 1200;
const swTx = new Float32Array(SWN), swTy = new Float32Array(SWN);
const swAng = new Float32Array(SWN), swRad = new Float32Array(SWN);
const swDel = new Float32Array(SWN), swTw = new Float32Array(SWN);
let swN = 0;

/* ---------- 颜色（跟着封面 accent 走） ---------- */
function hsl(h, s, l, a) {
  h = ((h % 360) + 360) % 360;
  return 'hsla(' + h.toFixed(1) + ',' + (Math.max(0, Math.min(1, s)) * 100).toFixed(1) + '%,' +
    (Math.max(0, Math.min(1, l)) * 100).toFixed(1) + '%,' + a + ')';
}
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s];
}
function buildPalette() {
  const q = rgb2hsl(accent[0], accent[1], accent[2]);
  const h = q[0], s = Math.max(0.38, Math.min(0.92, q[1] * 0.85 + 0.24));
  C_CORE = hsl(h + 3, s * 0.90, 0.80, 1);
  C_MID = hsl(h + 8, s * 1.00, 0.68, 1);
  C_DIM = hsl(h + 16, s * 1.00, 0.60, 1);
  C_TUN = hsl(h + 20, s * 0.95, 0.56, 1);
  C_GLOW = hsl(h + 6, s * 0.75, 0.78, 1);
  palKey = accent.join(',');
}

/* ---------- 星云（1/3 分辨率，现烤一次） ---------- */
function buildNebula() {
  const bw = Math.max(2, Math.round(W / 3)), bh = Math.max(2, Math.round(H / 3));
  if (!nebCv) nebCv = document.createElement('canvas');
  nebCv.width = bw; nebCv.height = bh;
  const g = nebCv.getContext('2d');
  const q = rgb2hsl(accent[0], accent[1], accent[2]);
  const h = q[0], s = Math.max(0.35, Math.min(0.9, q[1] * 0.9 + 0.2));
  const base = g.createRadialGradient(bw * 0.5, bh * 0.5, 0, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.75);
  base.addColorStop(0, hsl(h, s * 0.55, 0.075, 1));
  base.addColorStop(0.5, hsl(h, s * 0.55, 0.040, 1));
  base.addColorStop(1, hsl(h, s * 0.60, 0.016, 1));
  g.fillStyle = base; g.fillRect(0, 0, bw, bh);
  /* 银河带：一条斜向的柔光，给背景一点方向感 */
  g.save();
  g.translate(bw * 0.5, bh * 0.5);
  g.rotate(-0.42);
  const band = g.createLinearGradient(0, -bh * 0.30, 0, bh * 0.30);
  band.addColorStop(0, hsl(h + 6, s * 0.8, 0.45, 0));
  band.addColorStop(0.5, hsl(h + 6, s * 0.8, 0.52, 0.06));
  band.addColorStop(1, hsl(h + 6, s * 0.8, 0.45, 0));
  g.fillStyle = band;
  g.fillRect(-bw, -bh * 0.30, bw * 2, bh * 0.60);
  g.restore();
  /* 云团：同一色系的明暗呼吸，给背景“料” */
  for (let i = 0; i < 22; i++) {
    const bx = bw * (0.10 + 0.80 * ((i * 37) % 89) / 89);
    const by = bh * (0.08 + 0.84 * ((i * 53) % 83) / 83);
    const br = Math.max(bw, bh) * (0.10 + 0.20 * ((i * 29) % 71) / 71);
    const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
    const dh = i % 3 === 0 ? 14 : i % 3 === 1 ? -10 : 4;
    gr.addColorStop(0, hsl(h + dh, s * 0.85, 0.46, 0.07 + 0.04 * (i % 3)));
    gr.addColorStop(1, hsl(h + dh, s * 0.85, 0.35, 0));
    g.fillStyle = gr;
    g.beginPath(); g.arc(bx, by, br, 0, 6.28318); g.fill();
  }
  /* 细碎星尘 */
  for (let i = 0; i < 420; i++) {
    const x = (Math.random() * bw) | 0, y = (Math.random() * bh) | 0;
    g.fillStyle = hsl(h + 10, s * 0.5, 0.72, 0.05 + Math.random() * 0.20);
    g.fillRect(x, y, 1, 1);
  }
}

/* ---------- 星点（两层视差） ---------- */
function buildStars() {
  for (let i = 0; i < STARS; i++) {
    starX[i] = Math.random() * W;
    starY[i] = Math.random() * H;
    starD[i] = 0.25 + Math.random() * 0.75;     /* 视差深度 */
    starS[i] = starD[i] > 0.75 ? 1.7 : 1.0;
    starA[i] = 0.10 + starD[i] * 0.34;
  }
}

/* ---------- 光晕贴图（带主色，不要纯白） ---------- */
function buildGlow() {
  const S = 128;
  if (!glowCv) glowCv = document.createElement('canvas');
  glowCv.width = S; glowCv.height = S;
  const g = glowCv.getContext('2d');
  const q = rgb2hsl(accent[0], accent[1], accent[2]);
  const h = q[0], s = Math.max(0.38, Math.min(0.92, q[1] * 0.85 + 0.24));
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, hsl(h + 4, s * 0.85, 0.80, 0.95));
  gr.addColorStop(0.35, hsl(h + 8, s * 0.95, 0.64, 0.38));
  gr.addColorStop(1, hsl(h + 8, s * 1.00, 0.55, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
}

/* ---------- 胶片颗粒（DOM 叠层，合成器做，不进 canvas 帧耗） ---------- */
function buildGrain() {
  if (grainEl) return;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const im = g.createImageData(S, S);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  grainEl = document.createElement('div');
  grainEl.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;opacity:.09;' +
    'mix-blend-mode:overlay;background-repeat:repeat;background-image:url(' + c.toDataURL() + ')';
  document.body.appendChild(grainEl);
}

function spawnSparks(cx, cy, n, spread) {
  for (let k = 0; k < n; k++) {
    const i = spIx++ % SPK;
    const a = Math.random() * 6.28318;
    const r = Math.random() * spread;
    spX[i] = cx + Math.cos(a) * r;
    spY[i] = cy + Math.sin(a) * r;
    const v = 40 + Math.random() * 160;
    spVX[i] = Math.cos(a) * v;
    spVY[i] = Math.sin(a) * v;
    spL[i] = 0.35 + Math.random() * 0.35;
    spM[i] = 0.35 + Math.random() * 0.65;
  }
}

/* ---------- 钩子 ---------- */
function mechResize() {
  buildPalette();
  buildNebula();
  buildStars();
  buildGlow();
  buildGrain();
  spIx = 0;
  for (let i = 0; i < SPK; i++) spL[i] = 0;
}

function mechInitLine() {
  vn = 0;
  vLineIdx = -1;
  rN = 0;
  for (let i = 0; i < SPK; i++) spL[i] = 0;
}

function mechAssign(use) {
  const g = use.g;
  /* 只有换句才留残影；resize / 同一句重排时不能把同一句再叠一层 */
  const sameLine = (use.idx === vLineIdx);
  rT0 = use.lineT;
  rN = 0;
  if (!sameLine && vn > 0) {
    const stride = Math.max(1, Math.ceil(vn / RN));
    for (let i = 0, k = 0; i < vn && k < RN; i += stride, k++) { rX[k] = vTx[i]; rY[k] = vTy[i]; rN = k + 1; }
  }
  vLineIdx = use.idx;
  vLineT = use.lineT;
  vLineDur = use.lineDur;
  /* 字块放在中下（字幕位），宽 ~56% 屏宽 */
  blockGx = W / 2;
  blockGy = H * 0.52;
  let K = Math.min((W * 0.56) / Math.max(1, g.w), (H * 0.40) / Math.max(1, g.h), 1.3);
  if (K < 0.34) K = 0.34;

  vn = Math.min(VN, Math.max(800, Math.round(g.pc * 0.42)));
  const pc = g.pc;
  vMaxRad = 1;
  for (let i = 0; i < vn; i++) {
    const pi = ((i * pc / vn) | 0) % pc;
    /* 采样网格是规则的，加一点抖动，才像"粒子"而不是点阵 */
    const x = g.px[pi] * K + (Math.random() - 0.5) * 1.6;
    const y = g.py[pi] * K + (Math.random() - 0.5) * 1.6;
    vTx[i] = x; vTy[i] = y;
    vOwn[i] = g.own[pi];
    vPh[i] = Math.random() * 6.28318;
    vTw[i] = (0.9 + Math.random() * 1.5) * (i % 2 ? 1 : -1);
    vSz[i] = 0.85 + Math.random() * 0.4;
    const r = Math.hypot(x, y);
    vAng[i] = Math.atan2(y, x);
    vRad[i] = r;
    if (r > vMaxRad) vMaxRad = r;
  }
  /* 内圈先到、外圈后到：从涡心“长”出来 */
  for (let i = 0; i < vn; i++) vDel[i] = 0.04 + Math.random() * 0.05 + 0.20 * (vRad[i] / vMaxRad);

  /* 入场蜂群（1200 颗）：位置从涡心螺旋飞到目标，落地即"压"进字里 */
  swN = Math.min(SWN, Math.max(600, Math.round(vn * 0.28)));
  for (let k = 0; k < swN; k++) {
    const pi = (Math.random() * pc) | 0;
    const x = g.px[pi] * K, y = g.py[pi] * K;
    swTx[k] = x; swTy[k] = y;
    swAng[k] = Math.atan2(y, x);
    swRad[k] = Math.hypot(x, y);
    swTw[k] = (0.8 + Math.random() * 1.6) * (k % 2 ? 1 : -1);
    swDel[k] = 0.02 + Math.random() * 0.08 + 0.16 * (swRad[k] / Math.max(1, vMaxRad));
  }

  vcX = new Float32Array(g.n); vcY = new Float32Array(g.n);
  for (let c = 0; c < g.n; c++) { vcX[c] = g.charCx[c] * K; vcY[c] = g.charCy[c] * K; }

  if (palKey !== accent.join(',')) { buildPalette(); buildNebula(); }
  spawnSparks(0, 0, 26, 22);
}

function mechEvent(k, first) {
  /* 词团命中：在该团中心炸一小圈火花（用字心近似） */
  if (!L || !vcX) return;
  const sp = spans[k];
  if (!sp) return;
  const c = Math.min(L.n - 1, Math.floor((sp.i0 + sp.i1 - 1) / 2));
  spawnSparks(vcX[c], vcY[c], first ? 34 : 18, first ? 26 : 16);
}

function mechUpdate(dt, T) {
  lastDt = Math.min(0.05, dt || 0.016);
  if (palKey !== accent.join(',')) { buildPalette(); buildNebula(); buildStars(); buildGlow(); }
  /* 镜头：一直在动 —— 横移 + 升降 + 慢滚转（词团命中另有推进/震动叠加） */
  cam.ox = Math.sin(T * 0.19) * W * 0.045 + Math.sin(T * 0.41 + 1.1) * W * 0.014;
  cam.oy = Math.sin(T * 0.15 + 0.7) * H * 0.032 + Math.cos(T * 0.29) * H * 0.010;
}

/* ---------- 绘制 ---------- */
function mechDraw(T, z, pjX, pjY) {
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  /* 慢滚转只加在绘制侧：不和基座的震动/回弹抢 cam.rot */
  const rotT = cam.rot + Math.sin(T * 0.23) * 0.020;
  const cosR = Math.cos(rotT), sinR = Math.sin(rotT);
  const br = 1 + 0.035 * Math.sin(T * 0.27);
  const zz = z * br;
  const base = Math.min(W, H);

  ctx.globalCompositeOperation = 'source-over';

  /* --- 星云：轻微视差，铺满 --- */
  if (nebCv) {
    const ox = -cam.ox * 0.06, oy = -cam.oy * 0.06;
    ctx.globalAlpha = 1;
    ctx.drawImage(nebCv, ox - W * 0.03, oy - H * 0.03, W * 1.06, H * 1.06);
  }

  /* --- 星点：两层视差 --- */
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < STARS; i++) {
    const sx = starX[i] + (cam.x - W / 2) * starD[i] * 0.55 + cam.shx * starD[i];
    const sy = starY[i] + (cam.y - H * 0.48) * starD[i] * 0.55 + cam.shy * starD[i];
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    ctx.globalAlpha = starA[i];
    ctx.fillStyle = i % 5 === 0 ? C_GLOW : C_MID;
    const s = starS[i];
    ctx.fillRect(sx, sy, s, s);
  }

  /* --- 透视隧道环：从涡心往镜头流 --- */
  const tunN = 16;
  ctx.setLineDash([]);
  for (let i = 0; i < tunN; i++) {
    const ph = ((T * 0.42 + i / tunN) % 1);
    const zr = 1 + ph * 7.2;
    const r = base * 0.62 / zr;
    if (r < 5) continue;
    const near = Math.min(1, ph / 0.18);
    const far = Math.min(1, (1 - ph) / 0.35);
    const a = 0.19 * near * far;
    if (a < 0.012) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = C_TUN;
    ctx.lineWidth = Math.max(0.7, 2.2 - zr * 0.16);
    const rr = r * zz;
    const st = T * 0.5 + i * 1.7;
    /* 两段弧分开 stroke：同一 path 里连画会拉出弦，成了波浪线 */
    ctx.beginPath(); ctx.arc(cx, cy, rr, st, st + 2.15); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rr, st + 3.1416, st + 3.1416 + 2.15); ctx.stroke();
  }

  /* --- 涡心光：小一点、弱一点，别把字压暗 --- */
  if (glowCv) {
    const gr = base * (0.24 + 0.03 * Math.sin(T * 0.8));
    ctx.globalAlpha = 0.07;
    ctx.drawImage(glowCv, cx - gr, cy - gr, gr * 2, gr * 2);
  }

  /* --- 粒子文字（正片叠底：保持颗粒感，不让叠加糊成一片白） --- */
  if (vn && L) {
    ctx.globalCompositeOperation = 'source-over';
    const lo0 = 0.86, lo1 = 0.64;
    /* 位置/亮度先算一遍，再分三档批量画 */
    for (let i = 0; i < vn; i++) {
      const gl = charGlow[vOwn[i]] || 0;
      const lum = (0.74 + 0.26 * gl) * (0.86 + 0.26 * ((i & 7) / 7));
      const ox = vTx[i] * zz, oy = vTy[i] * zz;
      vSX[i] = cx + ox * cosR - oy * sinR;
      vSY[i] = cy + ox * sinR + oy * cosR;
      vSL[i] = lum;
      vSS[i] = (0.92 + 0.34 * lum) * vSz[i] * zz * (0.88 + 0.20 * gl);
    }
    for (let b = 0; b < 3; b++) {
      ctx.fillStyle = b === 0 ? C_CORE : b === 1 ? C_MID : C_DIM;
      ctx.globalAlpha = b === 0 ? 1 : b === 1 ? 0.95 : 0.88;
      ctx.beginPath();
      let any = 0;
      for (let i = 0; i < vn; i++) {
        const lum = vSL[i];
        const tier = lum >= lo0 ? 0 : lum >= lo1 ? 1 : 2;
        if (tier !== b) continue;
        const s = vSS[i];
        ctx.rect(vSX[i] - s, vSY[i] - s, s * 2, s * 2);
        any++;
      }
      if (any) ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* --- 入场蜂群：从涡心沿螺线拧到字上，落地即消失 --- */
    const age0 = T - vLineT;
    if (swN && age0 >= 0 && age0 < 0.95) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = C_CORE;
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = b === 0 ? 0.95 : b === 1 ? 0.60 : 0.32;
        ctx.beginPath();
        let any = 0;
        for (let k = 0; k < swN; k++) {
          const e = clamp01((age0 - swDel[k]) / 0.42);
          if (e >= 1) continue;
          const bk = e < 0.34 ? 0 : e < 0.67 ? 1 : 2;
          if (bk !== b) continue;
          const a = swAng[k] + (1 - e) * swTw[k];
          const r = swRad[k] * e;
          const ox = Math.cos(a) * r * zz, oy = Math.sin(a) * r * zz;
          const sx = cx + ox * cosR - oy * sinR;
          const sy = cy + ox * sinR + oy * cosR;
          const s = 1.0 + 1.3 * (1 - e);
          ctx.rect(sx - s, sy - s, s * 2, s * 2);
          any++;
        }
        if (any) ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* --- 逐字（YRC）光晕：唱到的字亮一团 --- */
    ctx.globalCompositeOperation = 'lighter';
    if (vcX && glowCv) {
      for (let c = 0; c < L.n; c++) {
        const gl = charGlow[c];
        if (!gl || gl < 0.04) continue;
        const ox = vcX[c] * zz, oy = vcY[c] * zz;
        const sx = cx + ox * cosR - oy * sinR;
        const sy = cy + ox * sinR + oy * cosR;
        const gr = 38 * zz * (0.8 + 0.5 * gl);
        ctx.globalAlpha = 0.13 * gl;
        ctx.drawImage(glowCv, sx - gr, sy - gr, gr * 2, gr * 2);
      }
      /* 正在唱的那个字：再压一团亮光，像镜头/光斑跟着走 */
      let curC = -1;
      for (let c = 0; c < L.n; c++) if (charGlow[c] > 0.02) curC = c;
      if (curC >= 0) {
        const ox = vcX[curC] * zz, oy = vcY[curC] * zz;
        const sx = cx + ox * cosR - oy * sinR;
        const sy = cy + ox * sinR + oy * cosR;
        const gr = 54 * zz;
        ctx.globalAlpha = 0.24;
        ctx.drawImage(glowCv, sx - gr, sy - gr, gr * 2, gr * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* --- 换句残影：上一句缩回涡心（0.4s，不挡住新句的“整句可读”） --- */
  if (rN) {
    const rAge = T - rT0;
    if (rAge >= 0 && rAge < 0.40) {
      const k = 1 - rAge / 0.40;
      ctx.fillStyle = C_MID;
      ctx.globalAlpha = 0.30 * k * k;
      ctx.beginPath();
      for (let i = 0; i < rN; i++) {
        const ox = rX[i] * k * zz, oy = rY[i] * k * zz;
        const sx = cx + ox * cosR - oy * sinR;
        const sy = cy + ox * sinR + oy * cosR;
        ctx.rect(sx - 1.6, sy - 1.6, 3.2, 3.2);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* --- 火花（词团命中） --- */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = C_CORE;
  for (let i = 0; i < SPK; i++) {
    if (spL[i] <= 0) continue;
    spL[i] -= lastDt;
    spX[i] += spVX[i] * lastDt;
    spY[i] += spVY[i] * lastDt;
    const damp = Math.pow(0.02, lastDt);
    spVX[i] *= damp; spVY[i] *= damp;
    const ox = spX[i] * zz, oy = spY[i] * zz;
    const sx = cx + ox * cosR - oy * sinR;
    const sy = cy + ox * sinR + oy * cosR;
    const lf = Math.max(0, spL[i]) / 0.7;
    ctx.globalAlpha = Math.min(1, lf) * 0.9 * spM[i];
    const s = 1.2 + spM[i] * 1.6;
    ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
