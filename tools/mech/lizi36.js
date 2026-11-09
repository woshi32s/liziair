/* lizi36 · 磁粉检漏 · magnaflux
   字 = 工件表面裂纹里的磁粉脊。
   磁粉撒满暗钢工件，唱到某个字，那一带的粉被磁场吸过去、落进裂纹，
   越堆越厚；脊上再长出毛茸茸的短刺。没吸过去的粉留在表面，画得很淡。
   词团命中：镜头横甩一下 + 弹簧变焦；全程微距缓推 1.0 → 1.04，焦点在工件上慢慢滑。 */

const N36 = 5000;   /* 会被磁场吸走的磁粉 */
const NF36 = 550;   /* 表面浮粉（永远不被吸，负责底噪和运动感） */
const NS36 = 750;  /* 脊上的短刺 */
const NT36 = 2000;  /* 裂纹本身的极淡磁痕（还没充磁时就看得出字） */

const mX = new Float32Array(N36), mY = new Float32Array(N36);
const mVX = new Float32Array(N36), mVY = new Float32Array(N36);
const mTX = new Float32Array(N36), mTY = new Float32Array(N36);
const mAT = new Float32Array(N36), mSZ = new Float32Array(N36);
const mTH = new Float32Array(N36), mEF = new Float32Array(N36);
const mCA = new Float32Array(N36), mSA = new Float32Array(N36);
const mH = new Float32Array(N36);
const mOW = new Int16Array(N36), mST = new Uint8Array(N36);
const scrX = new Float32Array(N36), scrY = new Float32Array(N36);
const mFO = new Float32Array(N36);
const band = new Uint8Array(N36);

const fX = new Float32Array(NF36), fY = new Float32Array(NF36);
const fVX = new Float32Array(NF36), fVY = new Float32Array(NF36);
const fSZ = new Float32Array(NF36), fPH = new Float32Array(NF36);

const sX = new Float32Array(NS36), sY = new Float32Array(NS36);
const sCA = new Float32Array(NS36), sSA = new Float32Array(NS36);
const sL = new Float32Array(NS36), sAT = new Float32Array(NS36);
const sOW = new Int16Array(NS36);

const tX = new Float32Array(NT36), tY = new Float32Array(NT36);
const tSZ = new Float32Array(NT36), tOW = new Int16Array(NT36);

let n36 = 0, steelCv = null, mpZoom = 0, zRef = 1, szK = 1;

/* ---------------- 背景：暗钢工件 + 极淡磨削纹（resize 时预烘一次） ---------------- */
function bakeSteel() {
  if (!steelCv) steelCv = document.createElement('canvas');
  const sw = Math.max(2, Math.round(W * 0.6)), sh = Math.max(2, Math.round(H * 0.6));
  steelCv.width = sw; steelCv.height = sh;
  const s = steelCv.getContext('2d');

  const grd = s.createLinearGradient(0, 0, sw * 0.3, sh);
  grd.addColorStop(0, '#242b33');
  grd.addColorStop(0.42, '#1a2028');
  grd.addColorStop(1, '#0d1218');
  s.fillStyle = grd; s.fillRect(0, 0, sw, sh);

  /* 磨削纹：大量极淡的横向细线，方向略有斜（不能抢字的戏） */
  s.lineWidth = 1;
  for (let k = 0; k < 70; k++) {
    const y = Math.random() * sh, sl = rnd(-0.035, 0.035) * sh;
    s.strokeStyle = 'rgba(170,184,200,' + rnd(0.012, 0.028).toFixed(3) + ')';
    s.beginPath(); s.moveTo(0, y); s.lineTo(sw, y + sl); s.stroke();
  }
  for (let k = 0; k < 380; k++) {
    const x = Math.random() * sw, y = Math.random() * sh, len = rnd(10, 76);
    s.strokeStyle = 'rgba(196,210,226,' + rnd(0.010, 0.026).toFixed(3) + ')';
    s.beginPath(); s.moveTo(x, y); s.lineTo(x + len, y + rnd(-1.4, 1.4)); s.stroke();
  }
  /* 工件棱边：上沿一道冷高光，下沿一道暗边 */
  s.strokeStyle = 'rgba(206,220,238,0.085)'; s.lineWidth = 2.2;
  s.beginPath(); s.moveTo(0, sh * 0.108); s.lineTo(sw, sh * 0.096); s.stroke();
  s.strokeStyle = 'rgba(104,120,138,0.07)'; s.lineWidth = 2;
  s.beginPath(); s.moveTo(0, sh * 0.925); s.lineTo(sw, sh * 0.936); s.stroke();

  /* 铸件的斑驳：柔和的明暗块，避免平涂感 */
  for (let k = 0; k < 170; k++) {
    const bx = Math.random() * sw, by = Math.random() * sh, br = rnd(24, 110);
    const bg2 = s.createRadialGradient(bx, by, 0, bx, by, br);
    const up = Math.random() < 0.5;
    bg2.addColorStop(0, up ? 'rgba(196,212,230,0.035)' : 'rgba(3,6,11,0.055)');
    bg2.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = bg2; s.fillRect(bx - br, by - br, br * 2, br * 2);
  }  /* 检漏区一层极淡冷光，让字所在的工件稍亮一点点 */
  const rg = s.createRadialGradient(sw * 0.5, sh * 0.46, 0, sw * 0.5, sh * 0.46, Math.max(sw, sh) * 0.6);
  rg.addColorStop(0, 'rgba(132,158,186,0.085)');
  rg.addColorStop(0.6, 'rgba(96,116,140,0.028)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  s.fillStyle = rg; s.fillRect(0, 0, sw, sh);

  /* 暗角，压住四边（避免亮像素贴边） */
  const vg = s.createRadialGradient(sw * 0.5, sh * 0.48, Math.min(sw, sh) * 0.24, sw * 0.5, sh * 0.48, Math.max(sw, sh) * 0.76);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,4,7,0.82)');
  s.fillStyle = vg; s.fillRect(0, 0, sw, sh);

  /* 铸件颗粒 */
  s.fillStyle = 'rgba(182,198,216,0.055)';
  s.beginPath();
  for (let i = 0; i < 2400; i++) s.rect(Math.random() * sw, Math.random() * sh, 1, 1);
  s.fill();
}

/* ---------------- resize ---------------- */
function mechResize() {
  if (!W || !H) return;
  bakeSteel();
  for (let i = 0; i < N36; i++) {
    mX[i] = rnd(0, W); mY[i] = rnd(0, H);
    mVX[i] = rnd(-10, 10); mVY[i] = rnd(-10, 10);
    mST[i] = 0; mTH[i] = 0;
    mSZ[i] = 0.8 + Math.random() * 0.9;
    mEF[i] = 0.5 + Math.random() * 1.1;
    mH[i] = Math.random() * 6.2832;
    /* 毛刺方向场：位置相关 + 一点随机，同一片脊方向大体一致 */
    const a = Math.sin(mX[i] * 0.0045) * 1.7 + Math.cos(mY[i] * 0.0038) * 1.2 + mH[i] * 0.35;
    mCA[i] = Math.cos(a); mSA[i] = Math.sin(a);
    band[i] = 9;
  }
  for (let i = 0; i < NF36; i++) {
    fX[i] = rnd(0, W); fY[i] = rnd(0, H);
    fVX[i] = rnd(-9, 13); fVY[i] = rnd(-7, 7);
    fSZ[i] = 0.8 + Math.random() * 1.3;
    fPH[i] = Math.random() * 6.2832;
  }
  for (let i = 0; i < NS36; i++) { sAT[i] = 1e9; sOW[i] = 0; sL[i] = 2; }
  n36 = 0;
}

/* ---------------- 换句：撒粉 → 定缺陷点 ---------------- */
function mechAssign(use) {
  const g = use.g, pc = g.pc, at = use.at;
  /* 有些 YRC 的逐字时间会溢出到下一句，兜一下：保证整句在句尾之前全部充磁 */
  const atCap = use.lineT + use.lineDur * 0.82;
  if (!pc) return;
  n36 = Math.max(3000, Math.min(N36, Math.round(pc * 1.5)));
  mpZoom = 0;
  szK = Math.max(0.46, Math.min(1.12, g.fs / 108));   /* 粉粒尺寸跟笔画粗细走，小字才不会糊成一块 */
  const inv = pc / n36;

  for (let i = 0; i < n36; i++) {
    let pi = (i * inv) | 0;
    if (pi >= pc) pi = pc - 1;
    const tx = blockGx + g.px[pi], ty = blockGy + g.py[pi];
    mTX[i] = tx; mTY[i] = ty;
    mOW[i] = g.own[pi];
    mAT[i] = Math.min(at[g.own[pi]] || use.lineT, atCap);
    const was = mST[i];
    mST[i] = 0; mTH[i] = 0;
    mSZ[i] = (1.15 + Math.random() * 0.95) * szK;
    mEF[i] = 0.45 + Math.random() * 1.15;
    mH[i] = Math.random() * 6.2832;
    const a = Math.sin(tx * 0.0045) * 1.7 + Math.cos(ty * 0.0038) * 1.2 + mH[i] * 0.55;
    mCA[i] = Math.cos(a); mSA[i] = Math.sin(a);

    /* 工件上本来就撒着粉：上一次留下的粉脊有近半还留在原地（松开一点，别复刻上一句），
       剩下的重新撒 —— 一半全幅，一半撒在字附近，吸起来更有层次 */
    const keep = was === 2 ? 0.45 : was === 0 ? 0.35 : 0;
    if (Math.random() < keep) {
      mX[i] = clamp01((mX[i] + rnd(-34, 34)) / W) * W;
      mY[i] = clamp01((mY[i] + rnd(-28, 28)) / H) * H;
    } else if (Math.random() < 0.55) {
      mX[i] = rnd(-20, W + 20); mY[i] = rnd(-20, H + 20);
    } else {
      const ang = Math.random() * 6.2832, rr = rnd(20, Math.max(W, H) * 0.42);
      mX[i] = tx + Math.cos(ang) * rr; mY[i] = ty + Math.sin(ang) * rr * 0.7;
    }
    mVX[i] = rnd(-14, 14); mVY[i] = rnd(-12, 12);
  }

  /* 裂纹里本来就有极淡的一层磁痕：整句一直隐约看得出字 */
  for (let i = 0; i < NT36; i++) {
    let pi = ((i * pc / NT36) | 0); if (pi >= pc) pi = pc - 1;
    tX[i] = blockGx + g.px[pi] + rnd(-1.1, 1.1) * szK;
    tY[i] = blockGy + g.py[pi] + rnd(-1.1, 1.1) * szK;
    tSZ[i] = (1.5 + Math.random() * 0.9) * szK;
    tOW[i] = g.own[pi];
  }

  /* 脊上短刺：每条脊周围撒少量短刺，方向随机 */
  for (let i = 0; i < NS36; i++) {
    const pi = (Math.random() * pc) | 0;
    const o = g.own[pi];
    sX[i] = blockGx + g.px[pi] + rnd(-5, 5) * szK;
    sY[i] = blockGy + g.py[pi] + rnd(-5, 5) * szK;
    const a = Math.random() * 6.2832;
    sCA[i] = Math.cos(a); sSA[i] = Math.sin(a);
    sL[i] = (1.7 + Math.random() * 3.8) * szK;
    sOW[i] = o;
    sAT[i] = Math.min(at[o] || use.lineT, atCap) + rnd(0.4, 1.4);
  }
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? 1 : -1) * (first ? 40 : 22);
  cam.oy = first ? -7 : -3;
}

/* ---------------- 每帧物理 ---------------- */
function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);
  /* 微距缓推：1.0 → 1.04；命中时的弹簧变焦更高时取更高者 */
  if (mpZoom < 1) mpZoom = Math.min(1, mpZoom + dt * 0.055);
  cam.tz = Math.max(cam.tz, 1 + 0.04 * mpZoom);

  for (let i = 0; i < n36; i++) {
    if (mST[i] === 2) {
      if (mTH[i] < 1) mTH[i] = Math.min(1, mTH[i] + dt * (0.9 + mTH[i]));
      continue;
    }
    let x = mX[i], y = mY[i], vx = mVX[i], vy = mVY[i];

    if (T < mAT[i] - 0.18) {
      /* 表面漫游：薄薄一层漂移带着粉粒走 */
      const h = mH[i];
      vx += (Math.sin(y * 0.012 + T * 0.85 + h) * 30 - vx * 2.1) * dt;
      vy += (Math.cos(x * 0.010 - T * 0.70 + h * 1.6) * 24 - vy * 2.1) * dt;
      x += vx * dt; y += vy * dt;
      if (x < 6) x = W - 6; else if (x > W - 6) x = 6;
      if (y < 6) y = H - 6; else if (y > H - 6) y = 6;
      mX[i] = x; mY[i] = y; mVX[i] = vx; mVY[i] = vy;
      continue;
    }

    mST[i] = 1;
    const dx = mTX[i] - x, dy = mTY[i] - y;
    const d2 = dx * dx + dy * dy;
    const near = d2 < 6400;                    /* d < 80 */
    vx += (dx * (near ? 34 : 9.5) - vx * (near ? 9 : 1.7)) * dt;
    vy += (dy * (near ? 34 : 9.5) - vy * (near ? 9 : 1.7)) * dt;
    const sp2 = vx * vx + vy * vy;
    if (sp2 > 810000) { const s = 900 / Math.sqrt(sp2); vx *= s; vy *= s; }
    x += vx * dt; y += vy * dt;

    if ((d2 < 6.0 && sp2 < 22500) || (d2 < 2200 && T > mAT[i] + 2.3)) {
      /* 落定：目标上再叠一点随机偏移 —— 粉脊因此有厚度，不是一个像素宽的线 */
      mST[i] = 2; mTH[i] = 0;
      mX[i] = mTX[i] + rnd(-1.7, 1.7) * szK;
      mY[i] = mTY[i] + rnd(-1.7, 1.7) * szK;
      mVX[i] = 0; mVY[i] = 0;
      continue;
    }
    mX[i] = x; mY[i] = y; mVX[i] = vx; mVY[i] = vy;
  }

  for (let i = 0; i < NF36; i++) {
    fX[i] += (fVX[i] + Math.sin(fY[i] * 0.02 + T * 0.9 + fPH[i]) * 9) * dt;
    fY[i] += (fVY[i] + Math.cos(fX[i] * 0.017 - T * 0.6) * 7) * dt;
    if (fX[i] < -10) fX[i] = W + 10; else if (fX[i] > W + 10) fX[i] = -10;
    if (fY[i] < -10) fY[i] = H + 10; else if (fY[i] > H + 10) fY[i] = -10;
  }
}

/* ---------------- 绘制 ---------------- */
/* mul：尺寸倍率；tip：要不要在法线方向再顶一撮毛 */
function depPass(b0, b1, comp, style, mul, tip) {
  ctx.globalCompositeOperation = comp;
  ctx.fillStyle = style;
  ctx.beginPath();
  for (let i = 0; i < n36; i++) {
    const b = band[i];
    if (b < b0 || b > b1) continue;
    const px = scrX[i], py = scrY[i], th = mTH[i];
    const s = mSZ[i] * zRef * (0.85 + 0.5 * th) * (0.78 + 0.45 * mFO[i]) * mul;
    const ef = mEF[i] * (0.5 + 0.8 * th);
    const ca = mCA[i] < 0 ? -mCA[i] : mCA[i];
    const sa = mSA[i] < 0 ? -mSA[i] : mSA[i];
    const w = s * (1 + ef * ca * 1.15);
    const h = s * (1 + ef * sa * 1.15);
    ctx.rect(px - w * 0.5, py - h * 0.5, w, h);
    if (tip && (i & 1) === 0) {
      /* 毛刺尖：沿脊的法线方向再顶出一小段，像毛边 */
      const t2 = s * (0.55 + 0.55 * th);
      ctx.rect(px + mCA[i] * (w * 0.5 + t2 * 0.35) - t2 * 0.5,
               py + mSA[i] * (h * 0.5 + t2 * 0.35) - t2 * 0.5, t2, t2);
    }
  }
  ctx.fill();
}

function mechDraw(T, z, pjX, pjY) {
  if (steelCv) ctx.drawImage(steelCv, 0, 0, W, H);

  zRef = 0.84 + 0.26 * z;
  const fyc = H * 0.46 + Math.sin(T * 0.19) * H * 0.13;   /* 焦点慢慢滑 */
  const fxc = W * 0.5 + Math.cos(T * 0.13 + 1.1) * W * 0.16;
  const fr = Math.max(190, H * 0.52);
  /* 投影参数直接展开（和 pjX/pjY 同一套公式，省掉每颗一次闭包调用） */
  const cx = cam.x, cy = cam.y;
  const cR = Math.cos(cam.rot), sR = Math.sin(cam.rot);
  const hx = W * 0.5 + cam.shx, hy = H * 0.5 + cam.shy;

  /* 一次投影，顺手分档 —— 之后各档只读屏幕坐标，不再算投影 */
  for (let i = 0; i < n36; i++) {
    const dx = (mX[i] - cx) * z, dy = (mY[i] - cy) * z;
    const px = hx + dx * cR - dy * sR, py = hy + dx * sR + dy * cR;
    scrX[i] = px; scrY[i] = py;
    if (px < -34 || px > W + 34 || py < -34 || py > H + 34) { band[i] = 9; mFO[i] = 0; continue; }
    const st = mST[i];
    if (st !== 2) { band[i] = st; mFO[i] = 0; continue; }
    /* 落定粉按"离焦点远近 + 刚堆上去的热度"分档：近处大而亮、远处小淡；
       每颗自带一点确定性抖动，免得出现一条水平亮线 */
    const fdx = px - fxc, fdy = py - fyc;
    const fd = (fdx < 0 ? -fdx : fdx) * 0.55 + (fdy < 0 ? -fdy : fdy);
    const fo = fd < fr ? 1 - fd / fr : 0;
    mFO[i] = fo;
    const gl = charGlow[mOW[i]] || 0;
    const bb = 0.34 + 0.36 * fo + 0.38 * gl + 0.26 * (1 - mTH[i]) + ((i & 15) * 0.0147 - 0.11);
    band[i] = bb > 0.98 ? 4 : bb > 0.60 ? 3 : 2;
  }

  /* 1 · 表面浮粉（永远很淡，负责底噪） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(146,160,178,0.024)';
  ctx.beginPath();
  for (let i = 0; i < NF36; i++) {
    const dx = (fX[i] - cx) * z, dy = (fY[i] - cy) * z;
    const px = hx + dx * cR - dy * sR, py = hy + dx * sR + dy * cR;
    if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
    const tw = 0.5 + 0.5 * Math.sin(T * 1.9 + fPH[i]);
    const s = fSZ[i] * zRef * (0.9 + tw * 1.5);
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
  }
  ctx.fill();

  /* 2 · 还没被吸的磁粉：很淡 */
  ctx.fillStyle = 'rgba(178,188,202,0.022)';
  ctx.beginPath();
  for (let i = 0; i < n36; i++) {
    if (band[i] !== 0 || (i & 2)) continue;
    const s = mSZ[i] * zRef * 0.55;
    ctx.rect(scrX[i] - s * 0.5, scrY[i] - s * 0.5, s, s);
  }
  ctx.fill();

  /* 3 · 正被裂纹吸过去：带一点速度拖尾 */
  ctx.fillStyle = 'rgba(214,206,192,0.17)';
  ctx.beginPath();
  for (let i = 0; i < n36; i++) {
    if (band[i] !== 1) continue;
    const sp = Math.sqrt(mVX[i] * mVX[i] + mVY[i] * mVY[i]);
    const s = mSZ[i] * zRef * 1.05;
    const st = Math.min(1.8, sp * 0.0032);
    ctx.rect(scrX[i] - s * (1 + st) * 0.5, scrY[i] - s * 0.5, s * (1 + st), s);
  }
  ctx.fill();

  /* 4 · 裂纹里本来就有的极淡磁痕：整句一直隐约看得出字。
     采样点是沿着笔画顺序排的，相邻两点连成一段 rect —— 极少的点就有连续的一条痕 */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(160,172,190,0.155)';
  ctx.beginPath();
  let pvx = 1e9, pvy = 1e9, pvo = -2;
  for (let i = 0; i < NT36; i++) {
    const dx = (tX[i] - cx) * z, dy = (tY[i] - cy) * z;
    const px = hx + dx * cR - dy * sR, py = hy + dx * sR + dy * cR;
    const s = tSZ[i] * zRef;
    if (px > -8 && px < W + 8 && py > -8 && py < H + 8) {
      const ax = px > pvx ? px - pvx : pvx - px;
      const ay = py > pvy ? py - pvy : pvy - py;
      if (tOW[i] === pvo && ay < 1.6 && ax < 9) {
        ctx.rect((px < pvx ? px : pvx) - s * 0.5, (py < pvy ? py : pvy) - s * 0.28,
                 ax + s, ay + s * 0.56);
      } else {
        ctx.rect(px - s * 0.5, py - s * 0.28, s, s * 0.56);
      }
    }
    pvx = px; pvy = py; pvo = tOW[i];
  }
  ctx.fill();

  /* 5 · 粉脊外围的绒毛雾：整条脊看起来是"堆起来"的，不是印上去的 */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(122,134,150,0.062)';
  ctx.beginPath();
  for (let i = 0; i < n36; i++) {
    const b = band[i];
    if (b < 3 || b > 4) continue;
    const s = mSZ[i] * zRef * (0.95 + 0.5 * mTH[i]) * (0.9 + 0.7 * mFO[i]) * (1.45 + 0.5 * szK);
    const ef = mEF[i] * 0.8;
    const ca = mCA[i] < 0 ? -mCA[i] : mCA[i];
    const sa = mSA[i] < 0 ? -mSA[i] : mSA[i];
    ctx.rect(scrX[i] - s * (1 + ef * ca) * 0.5, scrY[i] - s * (1 + ef * sa) * 0.5,
             s * (1 + ef * ca), s * (1 + ef * sa));
  }
  ctx.fill();

  /* 5·6·7 · 堆成的磁粉脊：暗体 / 亮体 / 最亮的芯（近处大而亮，远处小淡） */
  depPass(2, 2, 'source-over', 'rgba(86,96,110,0.52)', 1, false);
  depPass(3, 4, 'source-over', 'rgba(172,184,200,0.52)', 1, true);
  depPass(4, 4, 'lighter', 'rgba(255,252,244,0.95)', 0.62, false);

  /* 8 · 脊上毛茸茸的短刺（两段阶梯，看起来像一根细毛） */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(160,170,184,0.42)';
  ctx.beginPath();
  for (let i = 0; i < NS36; i++) {
    let a = (T - sAT[i]) * 2.4;
    if (a <= 0.03) continue;
    if (a > 1) a = 1;
    const dx = (sX[i] - cx) * z, dy = (sY[i] - cy) * z;
    const px = hx + dx * cR - dy * sR, py = hy + dx * sR + dy * cR;
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const l = sL[i] * zRef * (0.35 + a * 0.75);
    for (let k = 0; k < 2; k++) {
      const t = 0.45 + k * 0.55;
      const r = 1.3 - k * 0.55;
      ctx.rect(px + sCA[i] * l * t - r * 0.5, py + sSA[i] * l * t - r * 0.5, r, r);
    }
  }
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}
