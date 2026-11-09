/*! title: 斜切 · 反白 · 错版
    ----------------------------------------------------------------------------
    机制一句话：整句被一把**斜刀**切开 —— 切线左边是墨字（近白印在黑上），
    右边是**反白**（主色版上把字挖掉）；两半并不是同一块版：右半的字相对左半
    **错位 3.2 / −1.6px**（真的跑版），所以切线两侧的笔画颜色翻转、位置还错开一截，
    缝上留一道亮线。刀从左边扫到右边，扫到哪儿，哪儿就翻过来。

    与已有形态的边界：203 是 45° 半调网屏 + 套印；205 是工程图剖面线；
    这里没有网点 —— 是**一条裁切线 + 一次版位错动**，正/负形在缝上对不齐。

    做精的地方：
      ① 反白版是"主色矩形 + 字形的 destination-out 洞"，不是把字涂黑；
      ② 错位用的是同一张字形遮罩的偏移副本 —— 缝上能数出错了几像素；
      ③ 切线右侧压一道 26px 的暗影，纸/版"翘起来"的那点厚度就出来了；
      ④ 版边有裁切角标（crop marks）和套准十字，底部读 CUT / REG / 反白比例；
      ⑤ 无歌词：一块空版被一刀一刀切过去。
    ========================================================================== */

META = {
  label: 'KNIFE CUT / REVERSE PLATE',
  sub: '斜切一刀 · 右半反白 · 两半错位',
  right: 'REG +3.2 −1.6',
  footer: 'CUT · REVERSE · OUT OF REGISTER',
  grid: 0,
  grain: 0.05,
  cross: true
};

const KR_ANG = 0.42;          /* 切线与竖直的夹角（tan） */
const KR_DX = 3.2, KR_DY = -1.6;
let krCut = 0;                /* 0 = 还没切，1 = 切到底 */

function krBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 9);
  const fs = fitFont(rows, W * 0.75, Math.min(184, H * 0.20));
  const lh = fs * 1.12;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.26);
  const chh = Math.ceil(rows.length * lh) + Math.ceil(fs * 0.10);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  /* 反白版的"洞"：字形遮罩染成背景色 */
  const hole = tintMask(mcv, '#05090e');
  return {
    cw: cw, chh: chh, fs: fs,
    ink: bakeCore(mcv),          /* 左半：墨 */
    hole: hole,                  /* 右半：版上挖掉的字 */
    mcv: mcv
  };
}

function mechBuild(i) { return krBuild(i); }
function mechCommit() { krCut = 0; }
function mechSeek() { krCut = 0; }

function mechUpdate(dt, time) {
  const age = Math.max(0, time - lineAt);
  /* 刀在 0.85 秒里从版子左边切到中间偏右就**停在那儿**（微微游走），
     所以整句的后半段是"一半墨、一半反白"的稳定状态；踩拍再把刀口抖一下 */
  const p = Math.min(1, Math.max(0, age / 0.85));
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  krCut = 0.53 * e + 0.022 * Math.sin(time * 0.55) + kick * 0.018;
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const x0 = cx - cur.cw / 2, y0 = cy - cur.chh / 2;
  const pad = 46;
  const px0 = x0 - pad, py0 = y0 - pad * 0.72;
  const pw = cur.cw + pad * 2, ph = cur.chh + pad * 1.44;
  const amp = RM ? 0.4 : 1;

  /* 切线：一条斜线，随 krCut 从左扫到右 */
  const sweep = RM ? krCut * 0.9 : krCut;
  const cutX = px0 + pw * (0.06 + 0.90 * sweep);
  const cutAt = (y) => cutX + (y - (py0 + ph / 2)) * KR_ANG;

  /* ---------- 版块：先整个铺一层极淡的底，交代"这是一块版" ---------- */
  ctx.fillStyle = 'rgba(9,14,20,0.55)';
  ctx.fillRect(px0, py0, pw, ph);
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);

  /* ---------- 左半：墨字 ---------- */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 20), py0 - 20);
  ctx.lineTo(px0 - 20, py0 - 20);
  ctx.lineTo(px0 - 20, py0 + ph + 20);
  ctx.lineTo(cutAt(py0 + ph + 20), py0 + ph + 20);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.95;
  ctx.drawImage(cur.ink, x0, y0, cur.cw, cur.chh);
  ctx.globalAlpha = 1;
  ctx.restore();

  /* ---------- 右半：主色版 + 挖掉的字（还错位） ---------- */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 20), py0 - 20);
  ctx.lineTo(px0 + pw + 20, py0 - 20);
  ctx.lineTo(px0 + pw + 20, py0 + ph + 20);
  ctx.lineTo(cutAt(py0 + ph + 20), py0 + ph + 20);
  ctx.closePath();
  ctx.clip();
  /* 版：竖向渐变（上亮下暗） */
  const pg = ctx.createLinearGradient(0, py0, 0, py0 + ph);
  pg.addColorStop(0, rgba(mixc(ACC, [255, 255, 255], 0.42), 0.94));
  pg.addColorStop(0.55, rgba(ACC, 0.92));
  pg.addColorStop(1, rgba(mixc(ACC, [12, 22, 32], 0.42), 0.94));
  ctx.fillStyle = pg;
  ctx.fillRect(px0, py0, pw, ph);
  /* 跑版：字挖在偏了 (3.2, −1.6) 的位置上 */
  ctx.globalAlpha = 0.97;
  ctx.drawImage(cur.hole, x0 + KR_DX * amp, y0 + KR_DY * amp, cur.cw, cur.chh);
  /* 第二道更淡的重影：版被压了两次，错位看得更清楚 */
  ctx.globalAlpha = 0.16;
  ctx.drawImage(cur.hole, x0 - KR_DX * 3 * amp, y0 - KR_DY * 3 * amp, cur.cw, cur.chh);
  ctx.globalAlpha = 1;
  /* 版上一道压印的暗边（字的内侧）—— 抄纸/压版的厚度 */
  ctx.strokeStyle = 'rgba(6,12,18,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
  ctx.restore();

  /* ---------- 缝：亮线 + 右侧的投影 ---------- */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 20), py0 - 20);
  ctx.lineTo(px0 + pw + 20, py0 - 20);
  ctx.lineTo(px0 + pw + 20, py0 + ph + 20);
  ctx.lineTo(cutAt(py0 + ph + 20), py0 + ph + 20);
  ctx.closePath();
  ctx.clip();
  /* 投影：紧贴切线往右的 30px 里压暗 */
  const sg = ctx.createLinearGradient(cutX - 14, 0, cutX + 30, 0);
  sg.addColorStop(0, 'rgba(2,5,9,0.62)');
  sg.addColorStop(1, 'rgba(2,5,9,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cutX - 16, py0, 60, ph);
  ctx.restore();

  ctx.strokeStyle = 'rgba(250,254,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 20), py0 - 20);
  ctx.lineTo(cutAt(py0 + ph + 20), py0 + ph + 20);
  ctx.stroke();

  /* ---------- 裁切角标 + 套准十字 ---------- */
  const cl = 16, off = 10;
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.beginPath();
  const corners = [[px0, py0, -1, -1], [px0 + pw, py0, 1, -1], [px0, py0 + ph, -1, 1], [px0 + pw, py0 + ph, 1, 1]];
  for (let q = 0; q < 4; q++) {
    const C = corners[q];
    const sx = C[0] + C[2] * off, sy = C[1] + C[3] * off;
    ctx.moveTo(sx, sy); ctx.lineTo(C[0] + C[2] * (off + cl), sy);
    ctx.moveTo(sx, sy); ctx.lineTo(sx, C[1] + C[3] * (off + cl));
  }
  ctx.stroke();

  /* 套准十字（版心正中偏左） */
  const rx = px0 + pw * 0.5, ry = py0 - 22;
  ctx.strokeStyle = rgba(ACC, 0.50);
  ctx.beginPath();
  ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
  ctx.moveTo(rx - 11, ry); ctx.lineTo(rx - 7, ry);
  ctx.moveTo(rx + 7, ry); ctx.lineTo(rx + 11, ry);
  ctx.moveTo(rx, ry - 11); ctx.lineTo(rx, ry - 7);
  ctx.moveTo(rx, ry + 7); ctx.lineTo(rx, ry + 11);
  ctx.stroke();

  /* ---------- 读数 ---------- */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.32);
  const by = py0 + ph + 34;
  ctx.fillText('CUT ' + Math.round(Math.atan(KR_ANG) * 180 / Math.PI) + '°   REG +' + KR_DX.toFixed(1) + ' / ' + KR_DY.toFixed(1) +
    'px   REVERSE ' + Math.round(sweep * 100) + '%', px0, by);
  ctx.fillStyle = rgba(ACC, 0.17);
  ctx.fillText('PLATE ' + Math.round(pw) + '×' + Math.round(ph) + 'px   SET ' + Math.round(cur.fs) + 'px   KNIFE ' + Math.round(cutX) + 'px', px0, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一块空版被一刀一刀切过去（切过的地方反白） */
function mechEmpty(T) {
  const cx = W / 2, cy = H / 2;
  const pw = Math.min(W * 0.62, 820), ph = Math.min(H * 0.34, 300);
  const px0 = cx - pw / 2, py0 = cy - ph / 2;
  const p = 0.5 + 0.5 * Math.sin(T * 0.5);
  const cutX = px0 + pw * (0.08 + 0.84 * p);
  const cutAt = (y) => cutX + (y - (py0 + ph / 2)) * KR_ANG;
  ctx.fillStyle = 'rgba(9,14,20,0.6)';
  ctx.fillRect(px0, py0, pw, ph);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 10), py0 - 10);
  ctx.lineTo(px0 + pw + 10, py0 - 10);
  ctx.lineTo(px0 + pw + 10, py0 + ph + 10);
  ctx.lineTo(cutAt(py0 + ph + 10), py0 + ph + 10);
  ctx.closePath();
  ctx.clip();
  const pg = ctx.createLinearGradient(0, py0, 0, py0 + ph);
  pg.addColorStop(0, rgba(mixc(ACC, [255, 255, 255], 0.38), 0.55));
  pg.addColorStop(1, rgba(mixc(ACC, [12, 22, 32], 0.4), 0.55));
  ctx.fillStyle = pg;
  ctx.fillRect(px0, py0, pw, ph);
  ctx.restore();
  ctx.strokeStyle = 'rgba(250,254,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(cutAt(py0 - 10), py0 - 10);
  ctx.lineTo(cutAt(py0 + ph + 10), py0 + ph + 10);
  ctx.stroke();
  ctx.strokeStyle = rgba(ACC, 0.18);
  ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY PLATE · CUT ' + Math.round(p * 100) + '%', px0, py0 + ph + 30);
}

function mechStats() {
  return { cut: +krCut.toFixed(2), reg: KR_DX + '/' + KR_DY, rmAmp: RM ? 0.4 : 1 };
}
