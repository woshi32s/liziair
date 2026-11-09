/* lizi100 · 终章 · 星环 · finale
   一颗暖金的恒星被一整圈冷银蓝星环包住。
   · 环：7000 颗极坐标粒子（4 道环带，r≈258~542，厚度 12），y*0.32 压成 3D 斜环，
     每帧沿环绕行；靠近字位的粒子被"推开"——缺口内缘堆积的亮点就是笔画轮廓。
   · 字：字形采样点投到环的极坐标上（x→极角、y→半径；按 1/|N| 做各向异性补偿，
     所以屏幕上每个字都是同一高度，不受环的压扁影响）。极角由弧长积分求出，
     屏幕横向量永远等长。缺口边缘再撒一圈细白粒子 = 能读出字的那层。
     基座把长句折成多行时，第 1 行上环、第 2 行下环（像钱币铭文），各自补偿。
   · 恒星：两块预烘贴图（日冕晕 + 光球）各 blit 一次；表面几条亮弧当米粒组织。
   · 爆发：每句首词命中，720 颗日冕粒子从恒星抛出，扫过缺口时边缘整片点亮。
   · AE：顿帧 + difference 负片闪白（冻结期间一直负着）+ 冲击推镜 + 滚转；
     镜头椭圆环绕 + 缓推。
   每帧 fillStyle 8 次，全部同色 batch rect；不逐颗 drawImage / arc / 渐变 / 阴影。
*/

const TILT100 = 0.32;             /* 环面 3D 倾斜：屏幕 y = v*0.32 */
const N100 = 7000;                /* 环粒子 */
const NRIM100 = 3000;             /* 缺口边缘细亮粒子 */
const NS100 = 820;                /* 背景星尘 */
const NCOR100 = 720;              /* 日冕爆发粒子 */
const RIN100 = 258, ROUT100 = 542, RCTR100 = 400;
const FC100 = 3;                  /* 缺口场格子（世界单位） */

/* ---------------- 环粒子 ---------------- */
const pr100 = new Float32Array(N100), pa100 = new Float32Array(N100);
const ph100 = new Float32Array(N100), pv100 = new Float32Array(N100);
const ps100 = new Float32Array(N100), pb100 = new Uint8Array(N100);
const sx100 = new Float32Array(N100), sy100 = new Float32Array(N100);
let ring100 = 0, SC100 = 1;

/* ---------------- 背景星尘（W/H 预撒，mechResize 里初始化） ---------------- */
const stx100 = new Float32Array(NS100), sty100 = new Float32Array(NS100);
const smg100 = new Float32Array(NS100), sdr100 = new Float32Array(NS100);

/* ---------------- 字 = 缺口边缘 ---------------- */
const rimU100 = new Float32Array(NRIM100), rimV100 = new Float32Array(NRIM100);
const rimR100 = new Float32Array(NRIM100);
let nrim100 = 0;

/* 缺口密度场（blur 过的墨水掩码）：粒子在里面就沿 -∇F 被推出去 */
let fld100 = null, fldW100 = 2, fldH100 = 2, fldX010 = 0, fldY010 = 0, fldOn100 = 0;
let pgf100 = 0, pgu100 = 0, pgv100 = 0;

/* 环上一圈的排字表：每段文字一份 θ(x) 弧长积分表 */
let groups100 = null, K100 = 1, RC100 = 400;

/* ---------------- 恒星贴图 / 日冕 ---------------- */
let glow100 = null, ball100 = null;
const corA100 = new Float32Array(NCOR100), corJ100 = new Float32Array(NCOR100);
const corH100 = new Float32Array(NCOR100), corS100 = new Float32Array(NCOR100);
let corReady100 = 0;

/* ---------------- AE / 相机 ---------------- */
let bAge100 = -1, bR100 = 0;
let punch100 = 0, roll100 = 0, neg100 = 0;
let lastUse100 = null;

function bake100() {
  const n = 256;
  const mk = (stops) => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, n, n);
    return c;
  };
  glow100 = mk([[0, 'rgba(255,232,182,0.50)'], [0.20, 'rgba(255,200,124,0.24)'],
  [0.52, 'rgba(255,152,72,0.085)'], [1, 'rgba(255,120,40,0)']]);
  ball100 = mk([[0, '#fffdf4'], [0.30, '#ffefbc'], [0.50, '#ffd07c'],
  [0.60, '#ff9f48'], [0.66, 'rgba(255,124,42,0.45)'], [1, 'rgba(255,90,30,0)']]);
}

function initRing100() {
  const CL = [302, 366, 430, 494], WG = [0.30, 0.28, 0.25, 0.17];
  for (let i = 0; i < N100; i++) {
    let u = Math.random(), ci = 3, acc = 0;
    for (let k = 0; k < 4; k++) { acc += WG[k]; if (u <= acc) { ci = k; break; } }
    let r = CL[ci] + (Math.random() + Math.random() + Math.random() - 1.5) * 11;
    if (Math.random() < 0.07) r = RIN100 + Math.random() * (ROUT100 - RIN100);  /* 环缝里的浮尘 */
    pr100[i] = r * SC100;
    pa100[i] = Math.random() * Math.PI * 2;
    ph100[i] = (Math.random() + Math.random() + Math.random() - 1.5) * 6;      /* 厚度 12 */
    pv100[i] = 0.052 + 0.030 * (1 - (r - RIN100) / (ROUT100 - RIN100)) + Math.random() * 0.010;
    ps100[i] = (1.3 + Math.random() * 1.3) * SC100;
    pb100[i] = Math.random() < 0.46 ? 1 : 0;
  }
  ring100 = 1;
}

function initCor100() {
  for (let i = 0; i < NCOR100; i++) {
    corA100[i] = Math.random() * Math.PI * 2;
    corJ100[i] = (Math.random() + Math.random() - 1) * 15;
    corH100[i] = (Math.random() + Math.random() - 1) * 8;
    corS100[i] = 1.5 + Math.random() * 2.0;
  }
  corReady100 = 1;
}

function mechResize() {
  if (!W || !H) return;
  const ns = Math.max(0.62, Math.min(1.55, Math.min(W / 1440, H / 810)));
  if (ring100) {
    const k = ns / SC100;
    for (let i = 0; i < N100; i++) { pr100[i] *= k; ph100[i] *= k; ps100[i] *= k; }
  }
  SC100 = ns;
  for (let i = 0; i < NS100; i++) {
    stx100[i] = Math.random() * W;
    sty100[i] = Math.random() * H;
    smg100[i] = Math.pow(Math.random(), 2.6);
    sdr100[i] = 0.5 + Math.random() * 4.6;
  }
  if (!glow100) bake100();
  if (!ring100) initRing100();
  if (!corReady100) initCor100();
  neg100 = 0; punch100 = 0; roll100 = 0; bAge100 = -1; bR100 = 0;
  if (lastUse100) layout100(lastUse100);
}

/* ==========================================================================
   锥形排字：字形点 → 环的极坐标
   x 方向走弧长积分（屏幕每列等宽），y 方向按 1/|N_screen| 补偿（屏幕每行等高）。
   基座的排版可能把长句折成 2 行 → 上环一段、下环一段（下环整段翻转 180° 保持正立）。
   ========================================================================== */
function layout100(use) {
  nrim100 = 0; fldOn100 = 0; groups100 = null;
  const g = use && use.g;
  if (!g || !g.pc) return;
  const pc = g.pc, gx = g.px, gy = g.py;
  if (!ring100) initRing100();

  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let p = 0; p < pc; p++) {
    const x = gx[p], y = gy[p];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!(x1 - x0 > 1e-3) || !(y1 - y0 > 1e-3)) return;
  const lh = y1 - y0;
  const RC = RCTR100 * SC100;
  RC100 = RC;

  /* --- 按 y 方向的空档把字形块拆成基座排出来的几行 --- */
  const CH = 3;
  const NB = Math.max(8, Math.ceil(lh / CH) + 2);
  const hist = new Uint16Array(NB);
  for (let p = 0; p < pc; p++) {
    let b = ((gy[p] - y0) / CH) | 0;
    if (b < 0) b = 0; else if (b >= NB) b = NB - 1;
    hist[b]++;
  }
  const minGap = 2;   /* 基座的行距很紧（≈6~15 单位），空 2 格就算换行 */
  const bands = [];
  let bs = -1;
  for (let b = 0; b <= NB; b++) {
    const on = b < NB && hist[b] > 0;
    if (on) { if (bs < 0) bs = b; continue; }
    if (bs < 0) continue;
    let e = b;
    while (e < NB && hist[e] === 0) e++;
    if (e - b >= minGap || e >= NB) { bands.push([y0 + bs * CH, y0 + b * CH]); bs = -1; }
    b = e - 1;
  }
  if (!bands.length) bands.push([y0, y1]);
  /* 太薄的带（零星的点 / 标点的上沿）并回上一条，别把一行字劈开 */
  const solid = [];
  for (let i = 0; i < bands.length; i++) {
    const bd = bands[i];
    let n = 0;
    for (let p = 0; p < pc; p++) if (gy[p] >= bd[0] - 0.6 && gy[p] <= bd[1] + 0.6) n++;
    if (solid.length && (n < pc * 0.09 || bd[1] - bd[0] < lh * 0.07)) solid[solid.length - 1][1] = bd[1];
    else solid.push([bd[0], bd[1]]);
  }
  bands.length = 0;
  for (let i = 0; i < solid.length; i++) bands.push(solid[i]);

  /* 每行的横向范围 */
  const meta = [];
  for (let i = 0; i < bands.length; i++) {
    const ya = bands[i][0], yb = bands[i][1];
    let xa = 1e9, xb = -1e9, n = 0;
    for (let p = 0; p < pc; p++) {
      const y = gy[p];
      if (y < ya - 0.6 || y > yb + 0.6) continue;
      const x = gx[p];
      if (x < xa) xa = x; if (x > xb) xb = x; n++;
    }
    if (n > 3 && xb > xa) meta.push({ ya: ya, yb: yb, yc: (ya + yb) * 0.5, xa: xa, xb: xb });
  }
  if (!meta.length) return;

  /* 1~2 行就一行一段；更多行时合并成上下两段 */
  let grp;
  if (meta.length <= 2) {
    grp = meta.map((r) => ({ y0: r.ya, y1: r.yb, yc: r.yc, xa: r.xa, xb: r.xb }));
  } else {
    const h = Math.ceil(meta.length / 2);
    const pack = (arr) => {
      let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        if (r.xa < xa) xa = r.xa; if (r.xb > xb) xb = r.xb;
        if (r.ya < ya) ya = r.ya; if (r.yb > yb) yb = r.yb;
      }
      return { y0: ya, y1: yb, yc: (ya + yb) * 0.5, xa: xa, xb: xb };
    };
    grp = [pack(meta.slice(0, h)), pack(meta.slice(h))];
  }
  grp[0].sdir = 1; grp[0].upS = 1; grp[0].target = -Math.PI / 2;
  if (grp[1]) { grp[1].sdir = -1; grp[1].upS = -1; grp[1].target = Math.PI / 2; }

  /* 字号：屏幕上每行字高 ≈ S */
  const swOf = (gp, S2) => ((gp.xb - gp.xa) * S2 / Math.max(1, gp.y1 - gp.y0)) / (RC * 0.84);
  let S = 62 * SC100, mx = 0;
  for (let i = 0; i < grp.length; i++) { const s = swOf(grp[i], S); if (s > mx) mx = s; }
  if (mx > 1.95) S *= 1.95 / mx;
  if (S < 30 * SC100) S = 30 * SC100;

  /* 每段一张 θ(x) 弧长积分表（两遍：先量总转角，再居中） */
  for (let i = 0; i < grp.length; i++) {
    const gp = grp[i];
    const K = S / Math.max(1, gp.y1 - gp.y0);
    const NX = 96, dx = (gp.xb - gp.xa) / NX;
    const th = new Float32Array(NX + 1);
    let th0 = gp.target;
    for (let pass = 0; pass < 3; pass++) {
      let a = th0;
      th[0] = a;
      for (let j = 0; j < NX; j++) {
        const tm = Math.hypot(Math.sin(a), Math.cos(a) * TILT100);
        a += gp.sdir * (dx * K) / (RC * (tm > 0.30 ? tm : 0.30));
        th[j + 1] = a;
      }
      if (pass < 2) th0 = gp.target - (a - th[0]) * 0.5;
    }
    gp.K = K; gp.th = th; gp.dx = dx;
  }
  groups100 = grp;

  const thOf = (gp, x) => {
    let f = (x - gp.xa) / gp.dx;
    if (f < 0) f = 0; else if (f > 96) f = 96;
    const i = f | 0, t = f - i;
    return gp.th[i] + (gp.th[i + 1] - gp.th[i]) * t;
  };
  const gpOfY = (y) => {
    if (!grp[1]) return grp[0];
    const mid = (grp[0].y1 + grp[1].y0) * 0.5;
    return y <= mid ? grp[0] : grp[1];
  };
  const toPlane = (x, y, out) => {
    const gp = gpOfY(y);
    const th = thOf(gp, x);
    const c = Math.cos(th), s = Math.sin(th);
    let nm = Math.hypot(c, s * TILT100);
    if (nm < 0.18) nm = 0.18;
    const r = RC - ((y - gp.yc) * gp.K * gp.upS) / nm;
    out[0] = r * c; out[1] = r * s;
  };

  /* --- 字形占据格（细，用来抽缺口边缘） --- */
  const CEL = 2;
  const gw = Math.max(3, Math.ceil((x1 - x0) / CEL) + 1);
  const gh = Math.max(3, Math.ceil((y1 - y0) / CEL) + 1);
  const occ = new Uint8Array(gw * gh);
  for (let p = 0; p < pc; p++) {
    const ix = ((gx[p] - x0) / CEL) | 0, iy = ((gy[p] - y0) / CEL) | 0;
    if (ix >= 0 && iy >= 0 && ix < gw && iy < gh) occ[iy * gw + ix] = 1;
  }
  /* 基座的字形采样本来就是 2 单位的稠密点阵（笔画内部全填满），
     再膨胀会把笔画之间的细缝糊掉 —— 所以直接拿点阵当墨水掩码。 */

  /* --- 一遍扫：边界点（字） + 墨水点（缺口场） --- */
  const cap = Math.max(4096, Math.min(60000, gw * gh));
  const bU = new Float32Array(cap), bV = new Float32Array(cap);
  let nb = 0;
  const fu = new Float32Array(cap), fv = new Float32Array(cap);
  let nf = 0;
  const out2 = [0, 0];
  for (let y = 1; y < gh - 1; y++) {
    const row = y * gw;
    for (let x = 1; x < gw - 1; x++) {
      const k = row + x;
      if (!occ[k]) continue;
      toPlane(x0 + (x + 0.5) * CEL, y0 + (y + 0.5) * CEL, out2);
      if (!occ[k - 1] || !occ[k + 1] || !occ[k - gw] || !occ[k + gw]) {
        if (nb < cap) { bU[nb] = out2[0]; bV[nb] = out2[1]; nb++; }
      }
      if (nf < cap) { fu[nf] = out2[0]; fv[nf] = out2[1]; nf++; }
    }
  }

  /* 边界抽稀到 NRIM100，清一色白点（就是笔画轮廓） */
  if (nb > 0) {
    const st = Math.max(1, Math.ceil(nb / NRIM100));
    for (let i = 0; i < nb && nrim100 < NRIM100; i += st) {
      rimU100[nrim100] = bU[i]; rimV100[nrim100] = bV[i];
      rimR100[nrim100] = Math.hypot(bU[i], bV[i]);
      nrim100++;
    }
  }

  /* --- 缺口密度场 --- */
  if (nf > 2) {
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (let i = 0; i < nf; i++) {
      if (fu[i] < mnx) mnx = fu[i]; if (fu[i] > mxx) mxx = fu[i];
      if (fv[i] < mny) mny = fv[i]; if (fv[i] > mxy) mxy = fv[i];
    }
    mnx -= 26; mny -= 26; mxx += 26; mxy += 26;
    fldW100 = Math.max(3, Math.ceil((mxx - mnx) / FC100) + 1);
    fldH100 = Math.max(3, Math.ceil((mxy - mny) / FC100) + 1);
    const F = new Float32Array(fldW100 * fldH100);
    for (let i = 0; i < nf; i++) {
      const ix = ((fu[i] - mnx) / FC100) | 0, iy = ((fv[i] - mny) / FC100) | 0;
      for (let b = 0; b < 3; b++) {
        const yy = iy + b - 1;
        if (yy < 0 || yy >= fldH100) continue;
        const rr = yy * fldW100;
        for (let a = 0; a < 3; a++) {
          const xx = ix + a - 1;
          if (xx >= 0 && xx < fldW100) F[rr + xx] += 1;
        }
      }
    }
    /* 1-2-1 两轮：缺口边缘变成一团平滑的"排斥坡" */
    const T2 = new Float32Array(F.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < fldH100; y++) {
        const rr = y * fldW100;
        for (let x = 0; x < fldW100; x++) {
          const k = rr + x;
          T2[k] = ((x > 0 ? F[k - 1] : F[k]) + F[k] * 2 + (x < fldW100 - 1 ? F[k + 1] : F[k])) * 0.25;
        }
      }
      for (let y = 0; y < fldH100; y++) {
        const rr = y * fldW100;
        for (let x = 0; x < fldW100; x++) {
          const k = rr + x;
          F[k] = ((y > 0 ? T2[k - fldW100] : T2[k]) + T2[k] * 2 +
            (y < fldH100 - 1 ? T2[k + fldW100] : T2[k])) * 0.25;
        }
      }
    }
    let fmax = 1e-6;
    for (let k = 0; k < F.length; k++) if (F[k] > fmax) fmax = F[k];
    const iv = 1 / fmax;
    for (let k = 0; k < F.length; k++) F[k] *= iv;
    fld100 = F; fldX010 = mnx; fldY010 = mny; fldOn100 = 1;
  }

  /* --- 换句时把环上粒子一次推干净（字立刻成形） --- */
  for (let it = 0; it < 7; it++) pushAll100(4.5);
}

/* 单点场采样（双线性 + 中心差分梯度） */
function fldGrad100(x, y) {
  pgf100 = 0;
  if (!fldOn100) return;
  const fx = (x - fldX010) / FC100, fy = (y - fldY010) / FC100;
  if (fx < 1 || fy < 1 || fx > fldW100 - 2.001 || fy > fldH100 - 2.001) return;
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * fldW100 + i;
  const F = fld100, W1 = fldW100;
  const a0 = F[k] + (F[k + 1] - F[k]) * tx;
  const b0 = F[k + W1] + (F[k + W1 + 1] - F[k + W1]) * tx;
  pgf100 = a0 + (b0 - a0) * ty;
  if (pgf100 < 0.02) { pgf100 = 0; return; }
  pgu100 = (F[k + 1] - F[k]) * (1 - ty) + (F[k + W1 + 1] - F[k + W1]) * ty;
  pgv100 = (F[k + W1] - F[k]) * (1 - tx) + (F[k + W1 + 1] - F[k + 1]) * tx;
}

/* 沿 -∇F 把粒子推出缺口；k = 最大步长 */
function pushAll100(k) {
  if (!fldOn100) return;
  const lo = RIN100 * SC100, hi = ROUT100 * SC100;
  for (let i = 0; i < N100; i++) {
    const th = pa100[i], r = pr100[i];
    const u = Math.cos(th) * r, v = Math.sin(th) * r;
    fldGrad100(u, v);
    if (pgf100 <= 0.02) continue;
    const gg = Math.sqrt(pgu100 * pgu100 + pgv100 * pgv100);
    let nr = r;
    if (gg > 1e-5) {
      const st = Math.min(k, pgf100 * k * 1.7);
      nr = r - (u * pgu100 + v * pgv100) / (gg * (r > 1 ? r : 1)) * st;
    } else {
      nr = r + (Math.random() - 0.5) * k * 1.6;
    }
    if (nr < lo) nr = lo; else if (nr > hi) nr = hi;
    pr100[i] = nr;
  }
}

function mechAssign(use) {
  lastUse100 = use;
  layout100(use);
}

function mechEvent(k, first) {
  punch100 = first ? 0.075 : 0.032;
  roll100 = (k % 2 ? 1 : -1) * (first ? 0.052 : 0.024);
  if (first) {
    hitStop(0.058);
    flash(0.44);
    camShake(0.35, 1, 14);
    neg100 = 1;              /* 负片闪白：冻结这几帧一直负着 */
    bAge100 = 0; bR100 = 68 * SC100;
  }
}

function mechUpdate(dt, T) {
  const d = dt > 0 ? dt : 0;
  punch100 *= Math.exp(-d * 3.4);
  roll100 *= Math.exp(-d * 4.7);
  if (neg100 > 0) neg100 -= d * 6.2;

  /* 环绕运镜：椭圆漂移 + 缓推 + 命中滚一下 */
  cam.ox = Math.sin(T * 0.19) * 26 + Math.sin(T * 0.43) * 5;
  cam.oy = Math.cos(T * 0.15) * 15;
  cam.tz = 1.02 + 0.032 * Math.sin(T * 0.115) + punch100;
  cam.rot = Math.sin(T * 0.11) * 0.014 + roll100;

  /* 日冕物质外扩 */
  if (bAge100 >= 0) {
    bAge100 += d;
    const u = Math.min(1, bAge100 / 0.9);
    bR100 = (68 + 520 * (1 - Math.pow(1 - u, 3))) * SC100;
    if (bAge100 > 1.35) { bAge100 = -1; bR100 = 0; }
  }

  /* 粒子绕行 + 被缺口推开 */
  const lo = RIN100 * SC100, hi = ROUT100 * SC100;
  const on = fldOn100 && d > 0;
  for (let i = 0; i < N100; i++) {
    let th = pa100[i] + pv100[i] * d;
    if (th > 6.2831853) th -= 6.2831853; else if (th < 0) th += 6.2831853;
    let r = pr100[i];
    if (on) {
      const u = Math.cos(th) * r, v = Math.sin(th) * r;
      fldGrad100(u, v);
      if (pgf100 > 0.03) {
        const gg = Math.sqrt(pgu100 * pgu100 + pgv100 * pgv100);
        if (gg > 1e-5) {
          const st = Math.min(7 * SC100, pgf100 * 62 * d);
          r -= (u * pgu100 + v * pgv100) / (gg * (r > 1 ? r : 1)) * st;
          if (r < lo) r = lo; else if (r > hi) r = hi;
        }
      }
    }
    pa100[i] = th; pr100[i] = r;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const SX = W / 2, SY = H * 0.48;
  const cyaw = Math.cos(Math.sin(T * 0.17) * 0.10);
  const hotOn = bAge100 >= 0;

  /* ---- 0 · 远处星尘 ---- */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(118,148,206,0.44)';
  ctx.beginPath();
  const px0 = cam.ox * 0.10, py0 = cam.oy * 0.08;
  for (let i = 0; i < NS100; i++) {
    const u = (stx100[i] + T * sdr100[i]) % W;
    const v = sty100[i] + Math.sin(T * 0.13 + i * 1.7) * 1.8;
    const s = 0.8 + smg100[i] * 1.5;
    ctx.rect(u + px0, v + py0, s, s);
  }
  ctx.fill();

  /* ---- 1 · 环：先投影一遍，暗/亮两档同色 batch ---- */
  for (let i = 0; i < N100; i++) {
    const th = pa100[i], rr = pr100[i];
    const wx = SX + Math.cos(th) * rr * cyaw;
    const wy = SY + Math.sin(th) * rr * TILT100 + ph100[i] * cyaw;
    sx100[i] = pjX(wx, wy);
    sy100[i] = pjY(wx, wy);
  }
  ctx.globalCompositeOperation = 'lighter';

  ctx.fillStyle = 'rgba(74,116,186,0.55)';
  ctx.beginPath();
  for (let i = 0; i < N100; i++) {
    if (pb100[i] === 1) continue;
    if (hotOn && Math.abs(pr100[i] - bR100) < 30 * SC100) continue;
    const s = ps100[i] * z;
    ctx.rect(sx100[i] - s * 0.5, sy100[i] - s * 0.5, s, s * 0.92);
  }
  ctx.fill();

  ctx.fillStyle = 'rgba(200,228,255,0.80)';
  ctx.beginPath();
  for (let i = 0; i < N100; i++) {
    if (pb100[i] === 0 && !(hotOn && Math.abs(pr100[i] - bR100) < 30 * SC100)) continue;
    const s = ps100[i] * z;
    ctx.rect(sx100[i] - s * 0.5, sy100[i] - s * 0.5, s, s * 0.92);
  }
  ctx.fill();

  /* ---- 2 · 恒星：预烘晕 + 光球，各 blit 一次 ---- */
  const scx = pjX(SX, SY), scy = pjY(SX, SY);
  const SR = 92 * SC100 * z;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(glow100, scx - SR * 1.6, scy - SR * 1.6, SR * 3.2, SR * 3.2);
  ctx.globalAlpha = 1;
  const BR = SR * 2.15;
  ctx.drawImage(ball100, scx - BR * 0.5, scy - BR * 0.5, BR, BR);

  /* ---- 3 · 米粒组织：几条亮弧（同色 batch） ---- */
  const Rb = BR * 0.255;
  ctx.fillStyle = 'rgba(255,242,208,0.42)';
  ctx.beginPath();
  const spin = T * 0.5 + cam.rot;
  for (let k = 0; k < 7; k++) {
    const lat = 0.22 + k * 0.23;
    const ex = Rb * Math.cos(lat), ey = Rb * Math.sin(lat) * 0.94;
    const ph = spin * (k % 2 ? 1.25 : 1) + k * 2.1;
    for (let j = 0; j < 13; j++) {
      const tt = ph + (j / 13 - 0.5) * 1.6;
      const ct = Math.cos(tt), stt = Math.sin(tt);
      const xx = scx + ct * ex - stt * ey * 0.42;
      const yy = scy + stt * ey;
      const s = 2.2 * z;
      ctx.rect(xx - s * 0.5, yy - s * 0.5, s, s * 0.8);
    }
  }
  ctx.fill();

  /* ---- 4 · 日冕爆发：一圈粒子从恒星往外扫 ---- */
  if (hotOn) {
    const fade = 1 - Math.max(0, (bAge100 - 0.55) / 0.8);
    ctx.fillStyle = 'rgba(255,212,146,' + (0.60 + 0.38 * fade).toFixed(3) + ')';
    ctx.beginPath();
    for (let i = 0; i < NCOR100; i++) {
      const th = corA100[i] + T * 0.22;
      const rr = bR100 + corJ100[i] * SC100;
      const wx = SX + Math.cos(th) * rr * cyaw;
      const wy = SY + Math.sin(th) * rr * TILT100 + corH100[i] * SC100;
      const X = pjX(wx, wy), Y = pjY(wx, wy);
      const s = corS100[i] * SC100 * z * (0.75 + 0.8 * fade);
      ctx.rect(X - s * 0.5, Y - s * 0.5, s, s * 0.9);
    }
    ctx.fill();
  }

  /* ---- 5 · 缺口边缘：能读出字的那层细亮粒子 ---- */
  if (nrim100) {
    ctx.fillStyle = 'rgba(232,246,255,0.86)';
    ctx.beginPath();
    for (let i = 0; i < nrim100; i++) {
      const wx = SX + rimU100[i] * cyaw;
      const wy = SY + rimV100[i] * TILT100;
      const X = pjX(wx, wy), Y = pjY(wx, wy);
      const s = 1.8 * z;
      ctx.rect(X - s * 0.5, Y - s * 0.5, s, s);
    }
    ctx.fill();

    /* 日冕扫过缺口时，边缘整片点亮 */
    if (hotOn) {
      let any = 0;
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      for (let i = 0; i < nrim100; i++) {
        const dd = rimR100[i] - bR100;
        if (dd > 34 * SC100 || dd < -34 * SC100) continue;
        const f = 1 - Math.abs(dd) / (34 * SC100);
        const s = (1.9 + 2.4 * f) * z;
        const wx = SX + rimU100[i] * cyaw;
        const wy = SY + rimV100[i] * TILT100;
        const X = pjX(wx, wy), Y = pjY(wx, wy);
        ctx.rect(X - s * 0.5, Y - s * 0.5, s, s);
        any++;
      }
      if (any) ctx.fill();
    }
  }

  /* ---- 6 · 冲击帧 / 负片闪白 ---- */
  if (neg100 > 0.22) {
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.92, neg100).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
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



