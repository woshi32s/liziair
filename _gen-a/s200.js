/* ---------------------------------------------------------------------------
   200 · 机制实现：距离场 → 等值线 → 分组烘焙
   ------------------------------------------------------------------------- */
META = {
  label: 'CONTOUR / GLYPH',
  sub: '等高距 8 px · 9 圈 · 笔画高程',
  right: '1 : 1',
  footer: 'ISO 9 LINES',
  grid: 0.030,
  grain: 0.055,
  cross: true
};

const PAD = 142;                                   /* 外圈等高线要留的地 */
const LEVELS = [8, 17, 27, 39, 53, 69, 87, 107, 130];
const GROUPS = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
let CS = 1.5;
let field = null;

/* ---------------------------- 背景：低频噪声等高线 ---------------------------- */
function noise2(x, y) {
  let s = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 3; o++) {
    const xi = Math.floor(x * f), yi = Math.floor(y * f);
    const xf = x * f - xi, yf = y * f - yi;
    const h = (a, b) => {
      let n = a * 374761393 + b * 668265263;
      n = (n ^ (n >> 13)) * 1274126177;
      return ((n ^ (n >> 16)) >>> 0) / 4294967295;
    };
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a00 = h(xi, yi), a10 = h(xi + 1, yi), a01 = h(xi, yi + 1), a11 = h(xi + 1, yi + 1);
    s += amp * ((a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v);
    amp *= 0.5; f *= 2.1;
  }
  return s;
}
function bakeField() {
  const gw = 176, gh = 110;
  const v = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    v[j * gw + i] = noise2(i / 26 + 3.1, j / 17 + 7.7) + 0.42 * noise2(i / 9.5, j / 6.4);
  }
  const segs = [];
  for (let L = 0; L < 9; L++) isoLines(v, gw, gh, 0.20 + L * 0.082, segs);
  if (!segs.length) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(W); c.height = Math.round(H);
  const g = c.getContext('2d');
  g.setTransform(c.width / gw, 0, 0, c.height / gh, 0, 0);
  g.beginPath();
  for (let k = 0; k < segs.length; k += 4) {
    g.moveTo((segs[k] + 0.5) * 1, (segs[k + 1] + 0.5) * 1);
    g.lineTo((segs[k + 2] + 0.5) * 1, (segs[k + 3] + 0.5) * 1);
  }
  g.strokeStyle = rgba(ACC, 1);
  g.lineWidth = 1.35 / (c.width / gw);
  g.stroke();
  return c;
}

/* ---------------------------- 烘焙等值线 ---------------------------- */
function bakeContours(segsAll, cw, chh, style) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil((cw + PAD * 2) * CS));
  c.height = Math.max(2, Math.ceil((chh + PAD * 2) * CS));
  const g = c.getContext('2d');
  g.setTransform(CS, 0, 0, CS, 0, 0);
  g.translate(PAD, PAD);
  g.lineCap = 'round';
  for (let s = 0; s < segsAll.length; s++) {
    const item = segsAll[s];
    const segs = item.segs;
    if (!segs.length) continue;
    g.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      g.moveTo(segs[k], segs[k + 1]);
      g.lineTo(segs[k + 2], segs[k + 3]);
    }
    g.lineWidth = item.index ? style.lw + 0.30 : style.lw;
    g.strokeStyle = rgba(item.col, item.index ? style.aInd : style.aSec);
    g.stroke();
    /* 计曲线上的海拔读数：做进底图，每帧不重画文字 */
    if (item.label && segs.length > 24) {
      const k = Math.floor(segs.length / 4 * 0.46) * 4;
      const x0 = segs[k], y0 = segs[k + 1], x1 = segs[k + 2], y1 = segs[k + 3];
      if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const txt = String(item.label);
        g.font = '500 8px ui-monospace,Consolas,monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.strokeStyle = 'rgba(3,6,10,0.9)';
        g.lineWidth = 2.4;
        g.strokeText(txt, mx, my + 0.5);
        g.fillStyle = rgba(item.col, 0.62);
        g.fillText(txt, mx, my + 0.5);
      }
    }
  }
  return c;
}

/* 字心：渐变实心 + 1.4px 主色描边（让白字属于这张图） */
function bakeCoreRim(mcv) {
  const c = bakeCore(mcv);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = 0.62;
  const rim = tintMask(mcv, rgba(mixc(ACC, [255, 255, 255], 0.30), 1));
  const d = Math.max(1, Math.round(1.4 * SS));
  g.drawImage(rim, -d, 0); g.drawImage(rim, d, 0);
  g.drawImage(rim, 0, -d); g.drawImage(rim, 0, d);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return c;
}

function mechResize() {
  CS = Math.max(1.5, Math.min(2, DPR));
  field = bakeField();
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 15);
  const maxW = Math.min(W * 0.745, 1180);
  const fs = fitFont(rows, maxW, Math.min(184, Math.max(74, MN * 0.18)));
  const lh = fs * 1.12;
  const width = measureRows(rows, fs);
  const cw = Math.ceil(width) + Math.ceil(fs * 0.26);
  const chh = Math.ceil(rows.length * lh + fs * 0.10);
  if (cw < 4 || chh < 4) return null;

  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const data = mcv.getContext('2d').getImageData(0, 0, mcv.width, mcv.height).data;

  /* 距离场：网格步长 2 CSS px，网格比字框大一圈 PAD */
  const GS = 2;
  const GX = -PAD, GY = -PAD;
  const gw = Math.ceil((cw + PAD * 2) / GS) + 1;
  const gh = Math.ceil((chh + PAD * 2) / GS) + 1;
  const ink = new Uint8Array(gw * gh);
  const cwI = mcv.width, chhI = mcv.height;
  for (let j = 0; j < gh; j++) {
    const sy = Math.round((j * GS + GY) * SS);
    if (sy < 0 || sy >= chhI) continue;
    const rowDev = sy * cwI;
    for (let i = 0; i < gw; i++) {
      const sx = Math.round((i * GS + GX) * SS);
      if (sx < 0 || sx >= cwI) continue;
      ink[j * gw + i] = data[(rowDev + sx) * 4 + 3] > 118 ? 1 : 0;
    }
  }
  const notInk = new Uint8Array(gw * gh);
  for (let k = 0; k < ink.length; k++) notInk[k] = ink[k] ? 0 : 1;
  const dOut = new Float32Array(gw * gh), dIn = new Float32Array(gw * gh);
  edt(gw, gh, ink, dOut);
  edt(gw, gh, notInk, dIn);
  const sd = new Float32Array(gw * gh);
  /* 符号：墨外为正（到笔画的距离），墨内为负（笔画深度） */
  for (let k = 0; k < sd.length; k++) sd[k] = ink[k] ? -(dIn[k] * GS) : (dOut[k] * GS);
  const sds = blurField(sd, gw, gh, 2);

  const groups = [];
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const all = [];
    for (let q = 0; q < GROUPS[gi].length; q++) {
      const li = GROUPS[gi][q];
      const L = LEVELS[li];
      const segs = [];
      isoLines(sds, gw, gh, L, segs);
      if (!segs.length) continue;
      for (let k = 0; k < segs.length; k += 2) {
        segs[k] = segs[k] * GS + GX;
        segs[k + 1] = segs[k + 1] * GS + GY;
      }
      const index = (li % 3 === 0);
      const col = mixc(ACC, [238, 250, 255], 0.16 + gi * 0.06);
      all.push({ segs, index, col, label: index ? L : 0 });
    }
    if (!all.length) continue;
    groups.push({
      img: bakeContours(all, cw, chh, {
        lw: 1.15 - gi * 0.04,
        aSec: 0.42 - gi * 0.075,
        aInd: 0.66 - gi * 0.10
      }),
      phase: gi * 0.9,
      lag: gi * 0.075
    });
  }
  return {
    cw, chh, fs, rows,
    core: bakeCoreRim(mcv),
    halo: bakeHalo(mcv, 5, 0.5),
    groups: groups,
    levels: LEVELS.length
  };
}

function mechCommit(kit) { }

function mechSeek() { }

function mechUpdate(dt) { }

const easeOut = (x) => 1 - Math.pow(1 - x, 3);

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const age = T - lineAt;
  const amp = RM ? 0.28 : 1;
  const k = kick;
  const breathe = 1 + 0.0045 * Math.sin(T * 0.62) * amp;
  const cyy = cy + Math.sin(T * 0.42) * 1.1 * amp;

  /* 远景等高线 */
  if (field) {
    ctx.globalAlpha = 0.085;
    const dx = Math.sin(T * 0.045) * 22, dy = Math.cos(T * 0.036) * 14;
    ctx.drawImage(field, dx - 24, dy - 18, W + 48, H + 36);
    ctx.globalAlpha = 1;
  }

  /* 柔光 */
  if (cur.halo) {
    const hw = cur.halo.width / 0.5, hh = cur.halo.height / 0.5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.13 + 0.06 * k;
    ctx.drawImage(cur.halo, cx - hw / 2, cyy - hh / 2, hw, hh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* 3 组等高线，由内向外错峰长出 */
  for (let gi = 0; gi < cur.groups.length; gi++) {
    const G = cur.groups[gi];
    const grow = Math.min(1, Math.max(0, (age - G.lag) / 0.7));
    if (grow <= 0) continue;
    const e = easeOut(grow);
    const ripple = 1 + (0.010 + gi * 0.004) * Math.sin(T * 0.75 - G.phase) * amp + (0.018 + gi * 0.006) * k;
    const sc = (0.80 + 0.20 * e) * ripple * breathe;
    const w = cur.cw + PAD * 2, h = cur.chh + PAD * 2;
    const ax = cx - (PAD + cur.cw / 2) * sc;
    const ay = cyy - (PAD + cur.chh / 2) * sc;
    ctx.globalAlpha = (0.30 + 0.70 * e) * (1 - gi * 0.14);
    ctx.drawImage(G.img, ax, ay, w * sc, h * sc);
  }
  ctx.globalAlpha = 1;

  /* 字心 */
  const coreSc = 1 + 0.003 * Math.sin(T * 0.8) * amp + 0.010 * k;
  const cw = cur.core.width / SS, chh = cur.core.height / SS;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(cur.core, cx - (cw / 2) * coreSc, cyy - (chh / 2) * coreSc, cw * coreSc, chh * coreSc);

  /* 开场扫描线 */
  const sweep = Math.min(1, Math.max(0, (age - 0.05) / 0.9));
  if (sweep < 1) {
    const sy = cyy - chh * 0.58 + chh * 1.16 * sweep;
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createLinearGradient(0, sy - 5, 0, sy + 5);
    grd.addColorStop(0, rgba(ACC, 0));
    grd.addColorStop(0.5, rgba(ACC, 0.17));
    grd.addColorStop(1, rgba(ACC, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(cx - cw * 0.52, sy - 5, cw * 1.04, 10);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}

/* 无歌词：一圈圈慢慢荡开的地形波（没有字，也要有看得见的东西） */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  ctx.globalCompositeOperation = 'source-over';
  /* 中心的柔光：纯音频时它是"地形的心" */
  const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, MN * 0.42);
  gl.addColorStop(0, rgba(ACC, 0.075 + 0.02 * Math.sin(T * 0.8)));
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 10; k++) {
    const ph = ((T * 0.11 + k / 10) % 1);
    const r = MN * (0.06 + ph * 0.64);
    ctx.beginPath();
    for (let a = 0; a <= 58; a++) {
      const th = a / 58 * Math.PI * 2;
      const rr = r * (1 + 0.038 * Math.sin(th * 3 + T * 0.45 + k) + 0.020 * Math.sin(th * 5 - T * 0.3));
      const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr * 0.60;
      if (a) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(ACC, 0.30 * (1 - ph) + 0.02);
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }
  /* 十字准星 + 中心点：地图上没有内容时，也还在地图上 */
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy + 0.5); ctx.lineTo(cx - 12, cy + 0.5);
  ctx.moveTo(cx + 12, cy + 0.5); ctx.lineTo(cx + 34, cy + 0.5);
  ctx.moveTo(cx + 0.5, cy - 34); ctx.lineTo(cx + 0.5, cy - 12);
  ctx.moveTo(cx + 0.5, cy + 12); ctx.lineTo(cx + 0.5, cy + 34);
  ctx.stroke();
  ctx.fillStyle = rgba(ACC, 0.70);
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2 + 1.2 * Math.sin(T * 2.0), 0, Math.PI * 2);
  ctx.fill();
}

/* 地图家具：罗盘 + 比例尺 */
function mechChrome() {
  const m = 26;
  const ncx = W - m - 34, ncy = m + 40;
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ncx, ncy, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ncx, ncy + 6); ctx.lineTo(ncx, ncy - 6);
  ctx.moveTo(ncx - 3.6, ncy - 2.6); ctx.lineTo(ncx, ncy - 7); ctx.lineTo(ncx + 3.6, ncy - 2.6);
  ctx.stroke();
  ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'center';
  ctx.fillText('N', ncx, ncy + 22);

  const bx = m + 20, by = H - m - 32;
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + 120, by);
  ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by + 3);
  ctx.moveTo(bx + 60, by - 2); ctx.lineTo(bx + 60, by + 2);
  ctx.moveTo(bx + 120, by - 3); ctx.lineTo(bx + 120, by + 3);
  ctx.stroke();
  ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.22);
  ctx.fillText('0', bx, by - 6);
  ctx.fillText('60', bx + 60, by - 6);
  ctx.fillText('120 px', bx + 120, by - 6);
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.28 : 1,
    contours: cur ? cur.levels : 0,
    groups: cur ? cur.groups.length : -1
  };
}
