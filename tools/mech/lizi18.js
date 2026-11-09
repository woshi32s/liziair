/* lizi18 · 霜花结晶 · frost
   字 = 窗玻璃上从字心往外结晶的霜。
   字形采样点里等间隔挑 ~330 个结晶核；每核长 6 条六角枝晶（60° 递增 + 抖动），
   每条 3~4 段，部分枝再分一条小叉；每个霜粒都预计算固定坐标 + 所属字 own +
   生长进度 prog（沿枝越远越晚）。
   句内时间推进 → 全局生长量 g；prog < 该字有效生长量 的霜粒才显形。
   新长的亮白、旧霜灰蓝；核附近密而亮、枝尖淡；换句时旧霜先化掉（ghost）再重结晶。 */

const NC18 = 8600;
const f18x = new Float32Array(NC18), f18y = new Float32Array(NC18);
const f18p = new Float32Array(NC18);   /* 生长进度 0..~1.2 */
const f18s = new Float32Array(NC18);   /* 霜粒尺寸 */
const f18d = new Float32Array(NC18);   /* 视深（近大而亮 / 远淡） */
const f18r = new Float32Array(NC18);   /* 0 = 核，1 = 枝尖 */
const f18a = new Float32Array(NC18);   /* 枝晶方向（画针状用） */
const f18w = new Float32Array(NC18);   /* 闪烁相位 */
const f18o = new Int16Array(NC18);     /* 所属字 */
const f18c = new Uint8Array(NC18);     /* 1 = 核 / 第一段 */

/* 换句时上一批霜的位置，用来做"化掉"的残影 */
const p18x = new Float32Array(NC18), p18y = new Float32Array(NC18);
const p18s = new Float32Array(NC18);
let n18 = 0, pn18 = 0;

/* 玻璃上原本就有的散霜（背景层，W/H 相关 → 只在 mechResize 里撒） */
const NA18 = 420;
const a18x = new Float32Array(NA18), a18y = new Float32Array(NA18);
const a18s = new Float32Array(NA18), a18a = new Float32Array(NA18);

let mist18 = null;
let g18T = 0, g18D = 2.0;   /* 句内生长时间 / 总时长 */
let m18T = 0;               /* 旧霜融化残影 */
let r18 = 0;                /* 命中时的霜面亮脉冲 */
let vx18 = 0, vy18 = 0;     /* 镜头偏移的弹簧速度 */

const CG18 = 160;
const gm18 = new Float32Array(CG18);  /* 每个字见过的最大 charGlow（只增不减，霜才不回退） */
const gg18 = new Float32Array(CG18);

function mechResize() {
  if (!W || !H) return;

  for (let i = 0; i < NA18; i++) {
    a18x[i] = Math.random() * W;
    a18y[i] = Math.random() * H;
    a18s[i] = 0.8 + Math.random() * 1.9;
    a18a[i] = 0.2 + Math.random() * 0.8;
  }

  /* 预烘一层很淡的雾面 + 霜点 + 细划痕，之后每帧只 blit */
  const mw = Math.max(4, Math.round(W * 0.33)), mh = Math.max(4, Math.round(H * 0.33));
  if (!mist18) mist18 = document.createElement('canvas');
  mist18.width = mw; mist18.height = mh;
  const mc = mist18.getContext('2d');
  mc.clearRect(0, 0, mw, mh);
  for (let k = 0; k < 22; k++) {
    const x = Math.random() * mw, y = Math.random() * mh;
    const r = (0.10 + Math.random() * 0.22) * Math.max(mw, mh);
    const gr = mc.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(178,214,242,' + (0.030 + Math.random() * 0.045).toFixed(3) + ')');
    gr.addColorStop(0.55, 'rgba(140,186,222,0.016)');
    gr.addColorStop(1, 'rgba(120,170,210,0)');
    mc.fillStyle = gr;
    mc.fillRect(x - r, y - r, r * 2, r * 2);
  }
  mc.fillStyle = 'rgba(218,240,255,0.12)';
  mc.beginPath();
  for (let i = 0; i < 2600; i++) mc.rect(Math.random() * mw, Math.random() * mh, 1, 1);
  mc.fill();
  mc.strokeStyle = 'rgba(200,228,250,0.035)';
  mc.lineWidth = 1;
  mc.beginPath();
  for (let k = 0; k < 18; k++) {
    let x = Math.random() * mw, y = Math.random() * mh;
    mc.moveTo(x, y);
    const a = Math.random() * Math.PI;
    for (let s = 0; s < 4; s++) {
      x += Math.cos(a) * (6 + Math.random() * 12);
      y += Math.sin(a) * (6 + Math.random() * 12);
      mc.lineTo(x, y);
    }
  }
  mc.stroke();
}

function mechAssign(use) {
  const g = use.g;

  /* 旧霜 → 残影，然后重新结晶 */
  pn18 = n18;
  for (let i = 0; i < n18; i++) {
    p18x[i] = f18x[i]; p18y[i] = f18y[i]; p18s[i] = f18s[i];
  }
  m18T = 1;
  g18T = 0; r18 = 0;
  n18 = 0;
  for (let i = 0; i < CG18; i++) gm18[i] = 0;
  g18D = Math.max(1.4, Math.min(3.2, (use.lineDur || 2.6) * 0.78));
  cam.oy = -6; vy18 = 0;

  if (!g || !g.pc) return;
  const pc = g.pc;

  /* 用采样点算字身尺度，段长/粒宽跟着字号缩放 */
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mo = 0;
  for (let i = 0; i < pc; i++) {
    const x = g.px[i], y = g.py[i];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (g.own[i] > mo) mo = g.own[i];
  }
  const nch = mo + 1;
  let cell = Math.min((mxx - mnx) / Math.max(1, nch), (mxy - mny));
  if (!(cell > 4)) cell = Math.max(30, (mxy - mny) || 40);
  cell = Math.max(14, Math.min(240, cell));

  const segB = cell * 0.055;                      /* 每段枝晶长度 */
  const szB = Math.max(1.0, Math.min(2.8, cell * 0.045));
  const NC = Math.min(110, Math.max(1, pc >> 4));
  const stride = pc / NC;
  const gx0 = blockGx, gy0 = blockGy;

  const push = (x, y, own, prog, rad, core, dep, sz, ang) => {
    if (n18 >= NC18) return;
    const i = n18++;
    f18x[i] = x; f18y[i] = y;
    f18o[i] = own; f18p[i] = prog; f18r[i] = rad;
    f18c[i] = core; f18d[i] = dep; f18s[i] = sz; f18a[i] = ang;
    f18w[i] = Math.random();
  };

  for (let c = 0; c < NC; c++) {
    const pi = (c * stride) | 0;
    const own = g.own[pi] | 0;
    const dep = 0.30 + Math.random() * 0.70;
    const cx = gx0 + g.px[pi], cy = gy0 + g.py[pi];
    const cd = Math.random() * 0.30;                      /* 每核起始延迟 */
    const size = szB * (0.72 + Math.random() * 0.6) * (0.62 + dep * 0.7);

    /* 霜核：5 粒挤在一起，比枝上的更亮更密 */
    for (let k = 0; k < 5; k++) {
      push(cx + rnd(-0.65, 0.65) * size, cy + rnd(-0.65, 0.65) * size,
        own, cd * 0.5 + Math.random() * 0.05, 0, 1, dep,
        size * (0.95 + Math.random() * 0.6), Math.random() * 3.14);
    }

    /* 6 条六角枝晶，每段两粒 → 连成针叶 */
    const a0 = Math.random() * Math.PI * 2;
    const ext = 0.62 + Math.random() * 0.9;
    for (let a = 0; a < 6; a++) {
      const ang = a0 + a * (Math.PI / 3) + rnd(-0.12, 0.12);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const segs = Math.random() < 0.36 ? 4 : 3;
      const br = Math.random() < 0.24 ? ((Math.random() * (segs - 1)) | 0) : -1;
      let x = cx, y = cy;
      for (let s = 0; s < segs; s++) {
        const L = segB * ext * (1 - s * 0.12) * rnd(0.8, 1.2);
        for (let q = 0; q < 2; q++) {
          const f = q ? 1 : 0.55;
          const rad = (s + f) / segs;
          const jx = -dy * rnd(-0.18, 0.18) * L, jy = dx * rnd(-0.18, 0.18) * L;
          push(x + dx * L * f + jx, y + dy * L * f + jy, own,
            cd + 0.09 + rad * 0.74 + Math.random() * 0.03,
            rad, (s === 0 && q === 0) ? 1 : 0, dep,
            size * (1.02 - rad * 0.3), ang);
        }
        x += dx * L; y += dy * L;
        /* 小叉：两条更细的侧枝 */
        if (s === br) {
          for (let b = 0; b < 2; b++) {
            const ba = ang + (b ? -1 : 1) * rnd(0.7, 1.05);
            const bl = segB * ext * rnd(0.55, 0.9);
            for (let q = 0; q < 2; q++) {
              const ff = q ? 1 : 0.55;
              push(x + Math.cos(ba) * bl * ff, y + Math.sin(ba) * bl * ff, own,
                cd + 0.09 + (s + 1) / segs * 0.74 + 0.05 + q * 0.03,
                Math.min(1, (s + 1) / segs + ff * 0.1), 0, dep, size * 0.62, ba);
            }
          }
        }
      }
    }
  }

  /* 字身上的细密霜核：等间隔铺满采样点，先把字的形状"印"出来 */
  const rest = NC18 - n18 - 80;
  if (rest > 0) {
    const NR = Math.min(pc, rest);
    const st2 = pc / NR;
    for (let i = 0; i < NR; i++) {
      const pi = (i * st2) | 0;
      const own = g.own[pi] | 0;
      const dep = 0.22 + Math.random() * 0.78;
      push(gx0 + g.px[pi] + rnd(-0.6, 0.6), gy0 + g.py[pi] + rnd(-0.6, 0.6),
        own, 0.02 + Math.random() * 0.30, 0.55, 0, dep,
        szB * (0.85 + Math.random() * 0.45) * (0.75 + dep * 0.45), Math.random() * 3.14);
    }
  }
}

function mechEvent(k, first) {
  /* 命中：镜头甩一下，霜面亮一下 */
  cam.ox = (k % 2 ? 1 : -1) * (first ? 40 : 22);
  vx18 = (k % 2 ? 1 : -1) * 250;
  cam.oy = -8; vy18 = 0;
  r18 = first ? 1.2 : 0.8;
}

function mechUpdate(dt, T) {
  if (dt <= 0) return;
  g18T += dt;
  m18T *= Math.pow(0.015, dt);
  r18 *= Math.pow(0.05, dt);

  if (charGlow) {
    for (let i = 0; i < CG18; i++) {
      const v = charGlow[i] || 0;
      if (v > gm18[i]) gm18[i] = v;
    }
  }

  /* 镜头硬弹簧回中：近目标强阻尼 + 速度上限（甩镜后迅速收紧，不飘） */
  vx18 += (-cam.ox * 240 - vx18 * 34) * dt;
  if (vx18 > 1500) vx18 = 1500; else if (vx18 < -1500) vx18 = -1500;
  cam.ox += vx18 * dt;
  vy18 += (-cam.oy * 170 - vy18 * 27) * dt;
  if (vy18 > 900) vy18 = 900; else if (vy18 < -900) vy18 = -900;
  cam.oy += vy18 * dt;
}

function mechDraw(T, z, pjX, pjY) {
  const zz = z > 0.15 ? z : 1;

  /* 雾面（预烘） */
  if (mist18) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(mist18, 0, 0, W, H);
  }

  /* 玻璃上原本的散霜 */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(132,172,204,0.16)';
  ctx.beginPath();
  for (let i = 0; i < NA18; i++) {
    const px = pjX(a18x[i], a18y[i]), py = pjY(a18x[i], a18y[i]);
    if (px < -6 || px > W + 6 || py < -6 || py > H + 6) continue;
    const s = a18s[i] * zz;
    ctx.rect(px, py, s, s * (1 + a18a[i] * 0.6));
  }
  ctx.fill();

  if (!L || !n18) { ctx.globalCompositeOperation = 'source-over'; return; }

  /* 上一句的霜：化掉（只画一小会儿） */
  if (m18T > 0.04 && pn18) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(138,178,210,' + (m18T * 0.28).toFixed(3) + ')';
    ctx.beginPath();
    for (let i = 0; i < pn18; i++) {
      const px = pjX(p18x[i], p18y[i]), py = pjY(p18x[i], p18y[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = p18s[i] * zz * (0.5 + m18T * 0.7);
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }

  /* 每字的有效生长量：句内时间 × 该字已经唱到的程度 */
  const grow = Math.min(1.3, g18T / g18D);
  for (let i = 0; i < CG18; i++) gg18[i] = grow * (0.34 + 0.92 * gm18[i]);

  /* 3 档亮度 batch：旧霜灰蓝 → 新霜青白 → 刚长出的白 */
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(120,164,198,0.52)';
    } else if (pass === 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(172,214,244,0.52)';
    } else {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(246,252,255,0.92)';
    }
    ctx.beginPath();
    for (let i = 0; i < n18; i++) {
      const oi = f18o[i];
      const gg = oi < CG18 ? gg18[oi] : grow * 1.26;
      if (f18p[i] > gg) continue;
      const age = gg - f18p[i];
      const t = 0.16 + f18d[i] * 0.42 + (f18c[i] ? 0.34 : 0)
        + (1 - f18r[i]) * 0.26 + (age < 0.05 ? 0.45 : 0) + r18 * 0.25;
      const tier = t > 0.92 ? 2 : (t > 0.55 ? 1 : 0);
      if (tier !== pass) continue;
      const px = pjX(f18x[i], f18y[i]), py = pjY(f18x[i], f18y[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      /* 沿枝方向拉成小针，读得出六角晶枝而不是一团噪点 */
      const ca = Math.abs(Math.cos(f18a[i])), sa = Math.abs(Math.sin(f18a[i]));
      const ph = (T * 0.55 + f18w[i]) % 1;
      const tw = 0.80 + (ph < 0.5 ? ph : 1 - ph) * 0.5;   /* 霜面慢慢闪 */
      const s = f18s[i] * zz * tw * (1 + r18 * 0.3);
      const hw = s * (0.5 + ca * 1.0), hh = s * (0.5 + sa * 1.0);
      ctx.rect(px - hw * 0.5, py - hh * 0.5, hw, hh);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
