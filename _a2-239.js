/*! title: 书页版心
    ----------------------------------------------------------------------------
    机制一句话：这一句不是排在屏幕上，而是排进**一页书**的版心 —— 天头地脚、书眉、
    页码、折标都在，句与句之间整页沿书脊**翻过去**（横向折叠：先折到看不见，
    再从书脊展开，折的时候书脊一侧压暗、折口亮一道）。

    与已有形态的边界：208 是竖排分栏（排版方向）；204 是版心固定、字号坍缩；
    036/040 是卡片/等距房间的几何。这里是**书页这种容器**本身：字号由版心的宽高
    解出来，翻页是容器在换，不是字在动。

    做精的地方：
      ① 版心（text block）四条边、书眉（曲名）、页码（第几句）、右下折标都是真的；
      ② 翻页是"折"不是"滑"：横向 scale 过零再展开，书脊侧有渐变阴影，折口一道亮线；
      ③ 页码跟着句号走，书眉是歌名 —— 一页书的身份信息随歌曲变；
      ④ 字号由"版心宽 ÷ 这行自然宽"解出来，长句自动小一档（最多两行）；
      ⑤ 无歌词：一本空白页，只有版心、书眉和页码。
    ========================================================================== */

META = {
  label: 'BOOK PAGE / TEXT BLOCK',
  sub: '一句一页 · 沿书脊翻过去',
  right: 'PAGE',
  footer: 'FOLIO · RUNNING HEAD · SIGNATURE',
  grid: 0,
  grain: 0.05,
  cross: true
};

let ptFlip = 1;          /* 0..1 翻页进度 */

function ptBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const pw = Math.min(W * 0.44, 620);
  const ph = Math.min(H * 0.90, 800);
  const mx = pw * 0.135, my = ph * 0.115;
  const tw = pw - mx * 2, th = ph - my * 2;
  /* 版心宽度决定每行字数（先按 5.2 em 试，长句两行） */
  const chars = Array.from(line.text);
  const n = chars.length;
  /* 一句话在两行里排开（书的行长不会顶到版心边）：断在六成处，
     末尾别剩一两个字（book widow），剩下的并进上一行 */
  let per = n <= 5 ? n : Math.min(n, Math.max(3, Math.ceil(n * 0.62)));
  if (per < n && n - per < 3) per = Math.ceil(n / 2);
  const rows = [];
  for (let q = 0; q < n; q += per) rows.push(chars.slice(q, q + per).join(''));
  const fs = Math.min(fitFont(rows, tw * 0.94, Math.min(138, th * 0.40)), H * 0.15);
  const lh = fs * 1.62;                                   /* 书的行距大 */
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.18);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  return {
    pw: pw, ph: ph, mx: mx, my: my, tw: tw, th: th,
    cw: cw, chh: chh, fs: fs, lh: lh, rows: rows,
    core: bakeCore(mcv), text: line.text
  };
}

function mechBuild(i) { return ptBuild(i); }
function mechCommit() { ptFlip = 0; }
function mechSeek() { ptFlip = 1; }

function mechUpdate(dt, time) {
  const age = Math.max(0, time - lineAt);
  ptFlip = Math.min(1, Math.max(0, age / 0.66));
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const pw = cur.pw, ph = cur.ph;
  const px0 = cx - pw / 2, py0 = cy - ph / 2;
  const amp = RM ? 0.4 : 1;

  /* ---------- 翻页：横向折叠（0..0.5 折进去，0.5..1 展开） ---------- */
  const f = ptFlip;
  const spinX = px0 + 6;                 /* 书脊（左边） */
  let sx = 1, shade = 0;
  if (f < 0.5) { sx = 1 - f / 0.5; shade = f / 0.5; }
  else if (f < 1) { sx = (f - 0.5) / 0.5; shade = 1 - (f - 0.5) / 0.5; }
  const open = Math.max(0.012, sx);

  ctx.save();
  ctx.translate(spinX, 0);
  ctx.scale(open, 1);
  ctx.translate(-spinX, 0);

  /* 纸：一层极淡的暖底 + 上缘一线亮 */
  const pg = ctx.createLinearGradient(0, py0, 0, py0 + ph);
  pg.addColorStop(0, 'rgba(24,33,43,0.95)');
  pg.addColorStop(0.5, 'rgba(18,26,35,0.95)');
  pg.addColorStop(1, 'rgba(12,18,25,0.95)');
  ctx.fillStyle = pg;
  ctx.fillRect(px0, py0, pw, ph);
  ctx.fillStyle = rgba(ACC, 0.06);
  ctx.fillRect(px0, py0, pw, ph);
  ctx.strokeStyle = rgba(ACC, 0.20);
  ctx.lineWidth = 1;
  ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);

  /* 书脊阴影（左侧） */
  const sg = ctx.createLinearGradient(px0, 0, px0 + 54, 0);
  sg.addColorStop(0, 'rgba(2,5,9,0.72)');
  sg.addColorStop(1, 'rgba(2,5,9,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(px0, py0, 54, ph);

  /* ---------- 版心 ---------- */
  const tx0 = px0 + cur.mx, ty0 = py0 + cur.my;
  const tw = cur.tw, th = cur.th;
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.beginPath();
  ctx.moveTo(tx0 + 0.5, ty0); ctx.lineTo(tx0 + 0.5, ty0 + th);
  ctx.moveTo(tx0 + tw - 0.5, ty0); ctx.lineTo(tx0 + tw - 0.5, ty0 + th);
  ctx.stroke();

  /* 书眉（running head）：曲名 + 右端的小字 */
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.26);
  ctx.textAlign = 'left';
  const head = (songTitle || 'LIZI') + (songArtist ? '  ·  ' + songArtist : '');
  ctx.fillText(head.slice(0, 34), tx0, ty0 - 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(ACC, 0.18);
  ctx.fillText('LIZI / TYPE', tx0 + tw, ty0 - 16);
  /* 书眉的分隔线 */
  ctx.strokeStyle = rgba(ACC, 0.14);
  ctx.beginPath();
  ctx.moveTo(tx0, ty0 - 9.5); ctx.lineTo(tx0 + tw, ty0 - 9.5);
  ctx.stroke();

  /* 正文：竖向居中在版心里 */
  const byy = ty0 + th * 0.46 - cur.chh / 2;
  ctx.globalAlpha = 0.96;
  ctx.drawImage(cur.core, cx - cur.cw / 2, byy, cur.cw, cur.chh);
  ctx.globalAlpha = 1;

  /* 页码 + 花饰 */
  const folio = (curIdx >= 0 ? curIdx + 1 : 1);
  ctx.textAlign = 'center';
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.fillText('— ' + String(folio).padStart(2, '0') + ' —', cx, ty0 + th + 20);
  ctx.fillStyle = rgba(ACC, 0.14);
  ctx.fillText('◈', cx, ty0 + th + 38);

  /* 折标（signature mark）：右下角的小阶梯 */
  const msx = px0 + pw - 22, msy = py0 + ph - 20;
  ctx.fillStyle = rgba(ACC, 0.34);
  for (let q = 0; q < 4; q++) ctx.fillRect(msx + q * 3.4, msy + (3 - q) * 2.2, 2.6, 3 + q * 2.2);

  /* 折口的亮线（折到什么位置就亮到哪儿） */
  if (f > 0.002 && f < 0.998) {
    ctx.strokeStyle = 'rgba(244,251,255,' + (0.5 * (1 - Math.abs(f - 0.5) * 1.6)).toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px0 + pw * open - 0.5, py0 + 2);
    ctx.lineTo(px0 + pw * open - 0.5, py0 + ph - 2);
    ctx.stroke();
  }
  ctx.restore();

  /* 折页时的整体压暗（在外面画，免得被 scale 影响） */
  if (shade > 0.01) {
    ctx.fillStyle = 'rgba(3,6,10,' + (0.55 * shade).toFixed(3) + ')';
    ctx.fillRect(px0 - 6, py0 - 6, pw + 12, ph + 12);
  }

  /* ---------- 仪表 ---------- */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.30);
  const by = py0 + ph + 26;
  ctx.fillText('PAGE ' + Math.round(pw) + '×' + Math.round(ph) + 'px   TEXT BLOCK ' + Math.round(tw) + '×' + Math.round(th) +
    '   SET ' + Math.round(cur.fs) + 'px   LINES ' + cur.rows.length, px0, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('FOLIO ' + String((curIdx >= 0 ? curIdx + 1 : 1)).padStart(2, '0') + '   FLIP ' + Math.round(f * 100) + '%   ' +
    'LEADING ' + (cur.lh / cur.fs).toFixed(2) + 'em', px0, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一本空白页（版心 + 书眉 + 页码） */
function mechEmpty(T) {
  const pw = Math.min(W * 0.44, 620), ph = Math.min(H * 0.90, 800);
  const px0 = W / 2 - pw / 2, py0 = H / 2 - ph / 2;
  const mx = pw * 0.135, my = ph * 0.115;
  const tx0 = px0 + mx, ty0 = py0 + my, tw = pw - mx * 2, th = ph - my * 2;
  ctx.fillStyle = 'rgba(13,19,26,0.9)';
  ctx.fillRect(px0, py0, pw, ph);
  ctx.strokeStyle = rgba(ACC, 0.20);
  ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
  const sg = ctx.createLinearGradient(px0, 0, px0 + 54, 0);
  sg.addColorStop(0, 'rgba(2,5,9,0.7)');
  sg.addColorStop(1, 'rgba(2,5,9,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(px0, py0, 54, ph);
  ctx.strokeStyle = rgba(ACC, 0.10);
  ctx.beginPath();
  ctx.moveTo(tx0 + 0.5, ty0); ctx.lineTo(tx0 + 0.5, ty0 + th);
  ctx.moveTo(tx0 + tw - 0.5, ty0); ctx.lineTo(tx0 + tw - 0.5, ty0 + th);
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.24);
  ctx.textAlign = 'left';
  ctx.fillText('LIZI · EMPTY PAGE', tx0, ty0 - 16);
  ctx.strokeStyle = rgba(ACC, 0.13);
  ctx.beginPath();
  ctx.moveTo(tx0, ty0 - 9.5); ctx.lineTo(tx0 + tw, ty0 - 9.5);
  ctx.stroke();
  /* 空版的基线，一格格在呼吸 */
  ctx.strokeStyle = rgba(ACC, 0.09);
  ctx.beginPath();
  for (let r = 0; r < 6; r++) {
    const y = ty0 + th * 0.30 + r * 34;
    const w = tw * (0.55 + 0.32 * (0.5 + 0.5 * Math.sin(T * 0.6 + r * 0.7)));
    ctx.moveTo(tx0, y + 0.5); ctx.lineTo(tx0 + w, y + 0.5);
  }
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillText('— 00 —', W / 2, ty0 + th + 20);
  ctx.textAlign = 'left';
}

function mechStats() {
  return { flip: +ptFlip.toFixed(2), page: cur ? Math.round(cur.pw) + 'x' + Math.round(cur.ph) : '', rmAmp: RM ? 0.4 : 1 };
}
