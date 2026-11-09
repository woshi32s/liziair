/* ---------------------------------------------------------------------------
   205 · 机制实现：字形工程图（剖面线 + 轮廓 + 尺寸标注）
   ------------------------------------------------------------------------- */
META = {
  label: 'GLYPH / GENERAL ARRANGEMENT',
  sub: 'DWG 205 · 剖面线 45° · 尺寸标注',
  right: 'SCALE 1 : 1',
  footer: 'SHEET 01',
  grid: 0.045,
  grain: 0.035,
  cross: false,
  ticks: false
};

let DCS = 1.5;
function mechResize() { DCS = Math.max(1.5, Math.min(2, DPR)); }

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 14);
  const fs = fitFont(rows, W * 0.70, Math.min(166, H * 0.163));
  const lh = fs * 1.16;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.26);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);

  /* ---- 轮廓：morphology（mask 减腐蚀）—— 故意不用距离场/等值线，和 200 划清界限 ---- */
  const EDGE = Math.max(1, Math.round(1.2 * DCS));      /* device px */
  const oc = document.createElement('canvas');
  oc.width = Math.ceil(cw * DCS); oc.height = Math.ceil(chh * DCS);
  const og = oc.getContext('2d');
  og.drawImage(mcv, 0, 0, oc.width, oc.height);

  const tmp = document.createElement('canvas');
  tmp.width = oc.width; tmp.height = oc.height;
  const tg = tmp.getContext('2d');
  tg.drawImage(mcv, 0, 0, oc.width, oc.height);
  tg.globalCompositeOperation = 'destination-in';
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let d = 0; d < 8; d++) {
    tg.drawImage(mcv, dirs[d][0] * EDGE, dirs[d][1] * EDGE, oc.width, oc.height);
  }
  og.globalCompositeOperation = 'destination-out';
  og.drawImage(tmp, 0, 0);

  /* 线宽的一半落在字内、一半字外，更像制图的线 */
  og.globalCompositeOperation = 'source-in';
  og.fillStyle = rgba(mixc(ACC, [235, 250, 255], 0.55), 1);
  og.fillRect(0, 0, oc.width, oc.height);
  og.globalCompositeOperation = 'source-over';

  /* ---- 极淡的实体底：让 45° 线有地方"坐" ---- */
  const fc = document.createElement('canvas');
  fc.width = oc.width; fc.height = oc.height;
  const fg = fc.getContext('2d');
  fg.drawImage(mcv, 0, 0, fc.width, fc.height);
  fg.globalCompositeOperation = 'source-in';
  fg.fillStyle = rgba(mixc(ACC, [235, 250, 255], 0.35), 1);
  fg.fillRect(0, 0, fc.width, fc.height);

  /* ---- 剖面线：45° 线，用遮罩裁剪 = 字的"实体" ---- */
  const hc = document.createElement('canvas');
  hc.width = oc.width; hc.height = oc.height;
  const hg = hc.getContext('2d');
  hg.setTransform(DCS, 0, 0, DCS, 0, 0);
  hg.strokeStyle = rgba(ACC, 1);
  hg.lineWidth = 0.85;
  hg.beginPath();
  for (let d = -chh; d < cw + chh; d += 7.5) {
    hg.moveTo(d, 0); hg.lineTo(d + chh, chh);
  }
  hg.stroke();
  hg.setTransform(1, 0, 0, 1, 0, 0);
  hg.globalCompositeOperation = 'destination-in';
  hg.drawImage(mcv, 0, 0, hc.width, hc.height);
  hg.globalCompositeOperation = 'source-over';

  return { cw, chh, fs, rows, edge: oc, hatch: hc, fill: fc, edgePx: EDGE / DCS };
}

let reveal = 0;
function mechCommit() { reveal = 0; }
function mechSeek() { reveal = 0; }

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const amp = RM ? 0.4 : 1;
  const age = T - lineAt;
  reveal = Math.min(1, Math.max(0, age / 1.05));

  const w = cur.cw, h = cur.chh;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const rev = reveal < 1 ? reveal : 1;

  /* ---- 实体（剖面线）与轮廓：从左向右"画"出来 ---- */
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - 8, y0 - 10, (w + 16) * rev, h + 20);
  ctx.clip();
  ctx.globalAlpha = 0.11;
  ctx.drawImage(cur.fill, x0, y0, w, h);
  ctx.globalAlpha = 0.50;
  ctx.drawImage(cur.hatch, x0, y0, w, h);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(cur.edge, x0, y0, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();

  /* 绘图头：一条亮线跟着轮廓生长 */
  if (rev < 1) {
    const px = x0 - 8 + (w + 16) * rev;
    ctx.strokeStyle = rgba(ACC, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, y0 - 18); ctx.lineTo(px + 0.5, y0 + h + 18);
    ctx.stroke();
  }

  /* ---- 中心线（点划线） ---- */
  const mid = cy + Math.sin(T * 0.5) * 0.8 * amp;
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.lineWidth = 1;
  ctx.setLineDash([14, 3, 2, 3]);
  ctx.beginPath();
  ctx.moveTo(x0 - 34, mid + 0.5); ctx.lineTo(x0 + w + 34, mid + 0.5);
  ctx.moveTo(cx + 0.5, y0 - 26); ctx.lineTo(cx + 0.5, y0 + h + 26);
  ctx.stroke();
  ctx.setLineDash([]);

  /* ---- 尺寸标注：宽 / 高 ---- */
  if (rev >= 1) {
    const dy = y0 + h + 44;
    ctx.strokeStyle = rgba(ACC, 0.55);
    ctx.lineWidth = 1;
    arrowDim(x0, dy, x0 + w, dy);
    ctx.font = '500 9px ui-monospace,Consolas,monospace';
    ctx.fillStyle = rgba(ACC, 0.62);
    ctx.textAlign = 'center';
    ctx.fillText('W ' + Math.round(w), cx, dy - 7);

    const dx = x0 - 46;
    arrowDim(dx, y0, dx, y0 + h);
    ctx.save();
    ctx.translate(dx - 9, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('H ' + Math.round(h), 0, 0);
    ctx.restore();
    /* 延伸线 */
    ctx.strokeStyle = rgba(ACC, 0.22);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h + 6); ctx.lineTo(x0, dy + 6);
    ctx.moveTo(x0 + w, y0 + h + 6); ctx.lineTo(x0 + w, dy + 6);
    ctx.moveTo(x0 - 6, y0); ctx.lineTo(dx - 6, y0);
    ctx.moveTo(x0 - 6, y0 + h); ctx.lineTo(dx - 6, y0 + h);
    ctx.stroke();

    /* 两处引线标注 */
    ctx.textAlign = 'left';
    leader(x0 + w * 0.14, y0 + h * 0.18, x0 + w * 0.14 + 54, y0 - 34, 'R 1.5');
    leader(x0 + w * 0.72, y0 + h * 0.86, x0 + w * 0.72 + 46, y0 + h + 30, '45°');
  }

  /* 标题栏 */
  const tw = 210, th = 54, tx = W - 26 - 20 - tw, ty = H - 26 - 38 - th;
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.lineWidth = 1;
  ctx.strokeRect(tx + 0.5, ty + 0.5, tw, th);
  ctx.beginPath();
  ctx.moveTo(tx + 0.5, ty + 22.5); ctx.lineTo(tx + tw + 0.5, ty + 22.5);
  ctx.moveTo(tx + 0.5, ty + 38.5); ctx.lineTo(tx + tw + 0.5, ty + 38.5);
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.50);
  ctx.textAlign = 'left';
  ctx.fillText('LIZI / GLYPH ARR.', tx + 7, ty + 14);
  ctx.fillStyle = rgba(ACC, 0.32);
  ctx.fillText('DWG 205   EDGE ' + (cur ? cur.edgePx.toFixed(1) : '0') + ' px', tx + 7, ty + 33);
  ctx.fillText('1 : 1     SHEET 01', tx + 7, ty + 49);
}

function arrowDim(x1, y, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y); ctx.lineTo(x2, y2);
  const a = Math.atan2(y2 - y, x2 - x1);
  for (const p of [[x1, y, a], [x2, y2, a + Math.PI]]) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[0] + Math.cos(p[2] + 0.32) * 8, p[1] + Math.sin(p[2] + 0.32) * 8);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[0] + Math.cos(p[2] - 0.32) * 8, p[1] + Math.sin(p[2] - 0.32) * 8);
  }
  ctx.stroke();
}
function leader(x1, y1, x2, y2, txt) {
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.lineTo(x2 + 16, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x1, y1, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = rgba(ACC, 0.55);
  ctx.fill();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.55);
  ctx.textAlign = 'left';
  ctx.fillText(txt, x2 + 20, y2 + 3);
}

/* 无歌词：一张空白图纸 + 十字准星 */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  ctx.strokeStyle = rgba(ACC, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(W * 0.18 + 0.5, H * 0.22 + 0.5, W * 0.64, H * 0.56);
  ctx.setLineDash([14, 3, 2, 3]);
  ctx.beginPath();
  ctx.moveTo(W * 0.18, cy + 0.5); ctx.lineTo(W * 0.82, cy + 0.5);
  ctx.moveTo(cx + 0.5, H * 0.22); ctx.lineTo(cx + 0.5, H * 0.78);
  ctx.stroke();
  ctx.setLineDash([]);
  const r = 26 + 3 * Math.sin(T * 1.4);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.28);
  ctx.textAlign = 'center';
  ctx.fillText('NO GEOMETRY — 纯音频', cx, H * 0.78 + 22);
  ctx.textAlign = 'left';
}

function mechStats() {
  return {
    rmAmp: RM ? 0.4 : 1, edge: cur ? +cur.edgePx.toFixed(2) : 0, rev: +reveal.toFixed(2) };
}
