/*! title: 字怀漫灌
    ----------------------------------------------------------------------------
    机制一句话：字被当成**盛墨的容器** —— 只在"字怀"（闭口负形）里灌墨：
    从画布边界 flood-fill 标记出"字外"，剩下的非墨像素就是字怀，逐个连通域标号、
    每个字怀烘成一张自己的遮罩画布；液面是一根**水平线**，从字脚涨到字顶，
    每个字怀按自己被这根线切到的高度算出填充比（大怀涨得慢、小怀先满）。

    与已有形态的边界：200 是距离场的等高线（线在字外一圈圈退）；203 是网点面积率；
    209 是拓包逐点拍墨；这里是**字的负形**被当成容器灌满 —— 换一句，灌的位置全变。

    做精的地方：
      ① 字怀是 flood-fill + 连通域算出来的，不是猜的；细缝（>=26 device px）也算一个；
      ② 灌的是"形"不是矩形：每怀一张遮罩，液面用 drawImage 取遮罩的下半截裁剪；
      ③ 弯月面：液面处 2px 的近白亮边也从遮罩里切出来，随形走；
      ④ 液面的水平延长线穿过字外，把"这只墨盘"交代出来；底部读 COUNTERS / AREA / LEVEL；
      ⑤ 无歌词：一个方框（口字的怀）在自己的液面上呼吸。
    ========================================================================== */

META = {
  label: 'COUNTER FLOOD / NEGATIVE SPACE',
  sub: '字怀（闭口负形）被墨从下往上灌满',
  right: 'LEVEL',
  footer: 'INK RISES IN THE COUNTERS',
  grid: 0.012,
  grain: 0.045,
  cross: true
};

const cfClamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/* 墨色：比主色更饱和更沉一档，才能在近白的字身上看得出来（每次烘都按当前主色算） */
const CF_RIM = [236, 250, 255];
/* 墨色：主色的"加饱和"版（同一支色，只是把色度推上去），
   才在近白的字身上和黑底上都看得出来 —— 不引入第三种强调色 */
function cfInk0() { return [Math.round(ACC[0] * 0.50), Math.min(255, Math.round(ACC[1] * 0.94)), Math.min(255, Math.round(ACC[2] * 1.00))]; }
function cfInk1() { return [Math.round(ACC[0] * 0.32), Math.min(255, Math.round(ACC[1] * 0.62)), Math.min(255, Math.round(ACC[2] * 0.72))]; }

let cfLevel = 0;            /* 0 = 全空，1 = 灌满 */

function cfBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 9);
  const fs = fitFont(rows, W * 0.78, Math.min(186, H * 0.20));
  const lh = fs * 1.14;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.30);
  const chh = Math.ceil(rows.length * lh) + Math.ceil(fs * 0.10);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const gw = mcv.width, gh = mcv.height;
  const src = mcv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, gw, gh).data;

  const ink = new Uint8Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) ink[k] = src[k * 4 + 3] > 96 ? 1 : 0;

  /* ① 从边界 flood-fill 出"字外" */
  const ext = new Uint8Array(gw * gh);     /* 0 未定 / 1 字外 */
  const stack = new Int32Array(gw * gh);
  let sp = 0;
  const seed = (k) => { if (!ink[k] && !ext[k]) { ext[k] = 1; stack[sp++] = k; } };
  for (let x = 0; x < gw; x++) { seed(x); seed((gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { seed(y * gw); seed(y * gw + gw - 1); }
  while (sp) {
    const k = stack[--sp];
    const x = k % gw, y = (k - x) / gw;
    if (x > 0) seed(k - 1);
    if (x < gw - 1) seed(k + 1);
    if (y > 0) seed(k - gw);
    if (y < gh - 1) seed(k + gw);
  }
  /* ② 没被标到的非墨像素 = 字怀，连通域标号 */
  const lab = new Int32Array(gw * gh);
  const comps = [];
  let nextLab = 0;
  for (let k = 0; k < gw * gh; k++) {
    if (ink[k] || ext[k] || lab[k]) continue;
    nextLab++;
    let n = 0, minX = gw, maxX = 0, minY = gh, maxY = 0;
    lab[k] = nextLab; stack[sp++] = k;
    while (sp) {
      const p = stack[--sp];
      const x = p % gw, y = (p - x) / gw;
      n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && !ink[p - 1] && !ext[p - 1] && !lab[p - 1]) { lab[p - 1] = nextLab; stack[sp++] = p - 1; }
      if (x < gw - 1 && !ink[p + 1] && !ext[p + 1] && !lab[p + 1]) { lab[p + 1] = nextLab; stack[sp++] = p + 1; }
      if (y > 0 && !ink[p - gw] && !ext[p - gw] && !lab[p - gw]) { lab[p - gw] = nextLab; stack[sp++] = p - gw; }
      if (y < gh - 1 && !ink[p + gw] && !ext[p + gw] && !lab[p + gw]) { lab[p + gw] = nextLab; stack[sp++] = p + gw; }
    }
    if (n >= 26) comps.push({ id: nextLab, n: n, x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 });
  }

  /* ③ 每个字怀一张遮罩画布（device px），坐标一律留在遮罩自己的像素里 */
  const ctr = [];
  let area = 0;
  for (let q = 0; q < comps.length; q++) {
    const c = comps[q];
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    if (bw < 2 || bh < 2) continue;
    area += c.n;
    const mk = (col) => {
      const cn = document.createElement('canvas');
      cn.width = bw; cn.height = bh;
      const g = cn.getContext('2d');
      const id = g.createImageData(bw, bh);
      const d = id.data;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (lab[(c.y0 + y) * gw + (c.x0 + x)] !== c.id) continue;
          const o = (y * bw + x) * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
      }
      g.putImageData(id, 0, 0);
      return cn;
    };
    /* 墨：竖向渐变，按整句的高度对齐（相邻字怀的色阶是连的） */
    const fillCv = document.createElement('canvas');
    fillCv.width = bw; fillCv.height = bh;
    const fg = fillCv.getContext('2d');
    const oy = c.y0 / SS, oh = chh;
    const grd = fg.createLinearGradient(0, -oy, 0, oh - oy);
    const i0 = cfInk0(), i1 = cfInk1();
    grd.addColorStop(0, rgba(mixc(i0, [255, 255, 255], 0.34), 1));
    grd.addColorStop(0.55, rgba(i0, 1));
    grd.addColorStop(1, rgba(i1, 1));
    fg.fillStyle = grd;
    fg.fillRect(0, 0, bw, bh);
    fg.globalCompositeOperation = 'destination-in';
    fg.drawImage(mk([255, 255, 255]), 0, 0);
    fg.globalCompositeOperation = 'source-over';
    const rim = mk(CF_RIM);
    /* 墨的湿光：字怀外面一圈被墨洇开的晕（预烘一次，不每帧建） */
    const gsc = 0.5, gb = Math.max(1.6, Math.min(5, bw * 0.12));
    const glow = document.createElement('canvas');
    glow.width = Math.max(2, Math.round(bw * gsc));
    glow.height = Math.max(2, Math.round(bh * gsc));
    const gg = glow.getContext('2d');
    gg.filter = 'blur(' + gb.toFixed(1) + 'px)';
    gg.drawImage(rim, 0, 0, glow.width, glow.height);
    gg.filter = 'none';
    gg.globalCompositeOperation = 'source-in';
    gg.fillStyle = rgba(cfInk0(), 1);
    gg.fillRect(0, 0, glow.width, glow.height);
    ctr.push({
      cv: fillCv, rim: rim, glow: glow, gpad: gb * 0.9 / gsc,
      dx: c.x0 / SS, dy: c.y0 / SS,       /* 相对整句左上角的 CSS 偏移 */
      dw: bw / SS, dh: bh / SS,
      pw: bw, ph: bh                       /* 遮罩的 device px 尺寸 */
    });
  }
  ctr.sort((a, b) => a.dy - b.dy);
  return { fs: fs, cw: cw, chh: chh, core: bakeCore(mcv), ctr: ctr, areaRate: area / (gw * gh) };
}

function mechBuild(i) { return cfBuild(i); }
function mechCommit() { cfLevel = 0; }
function mechSeek() { cfLevel = 0; }

function mechUpdate(dt, time) {
  const age = Math.max(0, time - lineAt);
  const p = cfClamp((age - 0.10) / 1.05);
  const e = 1 - Math.pow(1 - p, 3);
  const br = 0.012 * Math.sin(time * 0.8) + kick * 0.03;
  cfLevel = cfClamp(e * 0.99 + (p >= 1 ? br : 0));
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const x0 = cx - cur.cw / 2, y0 = cy - cur.chh / 2;
  const amp = RM ? 0.35 : 1;
  const lv = cfLevel;
  const surfL = cur.chh * (1 - lv);          /* 液面相对整句顶的 CSS y */
  const surf = y0 + surfL;

  /* 版心竖线 + 液面的水平延长线（这只墨盘的边） */
  ctx.strokeStyle = rgba(ACC, 0.09);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 20.5, y0 - 10); ctx.lineTo(x0 - 20.5, y0 + cur.chh + 12);
  ctx.moveTo(x0 + cur.cw + 20.5, y0 - 10); ctx.lineTo(x0 + cur.cw + 20.5, y0 + cur.chh + 12);
  ctx.stroke();
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.beginPath();
  ctx.moveTo(x0 - 40, surf + 0.5); ctx.lineTo(x0 + cur.cw + 40, surf + 0.5);
  ctx.moveTo(x0 - 40, surf - 4.5); ctx.lineTo(x0 - 40, surf + 5.5);
  ctx.moveTo(x0 + cur.cw + 40, surf - 4.5); ctx.lineTo(x0 + cur.cw + 40, surf + 5.5);
  ctx.stroke();
  /* 左侧液位标尺 0 / 50 / 100 */
  ctx.strokeStyle = rgba(ACC, 0.13);
  ctx.beginPath();
  for (let s = 0; s <= 4; s++) {
    const yy = y0 + cur.chh * (s / 4);
    ctx.moveTo(x0 - 27, yy + 0.5); ctx.lineTo(x0 - 20.5, yy + 0.5);
  }
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.38);
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(lv * 100) + '%', x0 - 46, surf + 3);

  /* ① 字：近白的实体，字怀是它身上的洞 */
  ctx.globalAlpha = 0.92;
  ctx.drawImage(cur.core, x0, y0, cur.cw, cur.chh);
  ctx.globalAlpha = 1;

  /* ② 字怀里的墨（外面先洇一圈湿光，让灌进去的东西看得见） */
  const ctr = cur.ctr;
  for (let q = 0; q < ctr.length; q++) {
    const c = ctr[q];
    let f = cfClamp((c.dy + c.dh - surfL) / c.dh);
    if (f <= 0.008) continue;
    const dh = c.dh * f, sh = c.ph * f;
    const gp = c.gpad;
    ctx.globalAlpha = 0.13 + 0.15 * f;
    ctx.drawImage(c.glow, x0 + c.dx - gp, y0 + c.dy - gp, c.dw + gp * 2, c.dh + gp * 2);
    ctx.globalAlpha = 1;
    ctx.drawImage(c.cv, 0, c.ph - sh, c.pw, sh,
      x0 + c.dx, y0 + c.dy + c.dh - dh, c.dw, dh);
    /* ③ 弯月面 / 满溢的顶边 */
    if (f < 0.995) {
      const rh = Math.min(2 * SS, sh);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(c.rim, 0, c.ph - sh, c.pw, rh,
        x0 + c.dx, y0 + c.dy + c.dh - dh - rh / SS * 0.5, c.dw, rh / SS);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.42 + 0.18 * amp;
      const rh = Math.min(1.5 * SS, c.ph);
      ctx.drawImage(c.rim, 0, 0, c.pw, rh, x0 + c.dx, y0 + c.dy, c.dw, rh / SS);
      ctx.globalAlpha = 1;
    }
  }

  /* ④ 仪表 */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.30);
  const bx = x0 - 20, by = y0 + cur.chh + 40;
  ctx.fillText('COUNTERS ' + String(ctr.length).padStart(2, '0') +
    '   AREA ' + (cur.areaRate * 100).toFixed(1) + '%', bx, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('LEVEL ' + (lv * 100).toFixed(0) + '%   SURFACE ' + Math.round(surfL) + 'px / ' + Math.round(cur.chh) + 'px', bx, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一个"口"的方框，墨在自己的怀面涨落 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.5;
  const s = Math.min(W, H) * 0.30;
  const x = cx - s / 2, y = cy - s / 2;
  const lv = 0.26 + 0.44 * (0.5 + 0.5 * Math.sin(T * 0.55));
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, s, s);
  const iw = s * 0.62, ih = s * 0.66;
  const ix = cx - iw / 2, iy = cy - ih / 2 + s * 0.02;
  const surf = iy + ih * (1 - lv);
  const grd = ctx.createLinearGradient(0, iy, 0, iy + ih);
  const i0 = cfInk0(), i1 = cfInk1();
  grd.addColorStop(0, rgba(mixc(i0, [255, 255, 255], 0.34), 0.95));
  grd.addColorStop(1, rgba(i1, 0.95));
  ctx.fillStyle = grd;
  ctx.fillRect(ix, surf, iw, iy + ih - surf);
  ctx.fillStyle = 'rgba(240,251,255,0.78)';
  ctx.fillRect(ix, surf, iw, 1.6);
  ctx.strokeStyle = rgba(ACC, 0.14);
  ctx.setLineDash([4, 5]);
  ctx.strokeRect(ix + 0.5, iy + 0.5, iw, ih);
  ctx.setLineDash([]);
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY COUNTER ' + (lv * 100).toFixed(0) + '%', cx - s * 0.5, cy + s * 0.62);
}

function mechStats() {
  return {
    counters: cur ? cur.ctr.length : 0,
    level: +cfLevel.toFixed(2),
    rmAmp: RM ? 0.35 : 1
  };
}
