/*! title: 弧线排字
    ----------------------------------------------------------------------------
    机制一句话：整句被排到**一条圆弧**上 —— 每个字按弧长定位、按切线方向旋转，
    曲率是一个弹簧量：换句时弧很弯（半径 ~620px），慢慢回弹到近直（~1600px），
    踩拍再压弯一次；那条弧线本身画在字下面，还带等弧长的刻度。

    与已有形态的边界：028 是"字被正弦上下推"（只位移、不转向、没有路径）；
    017/057 是几何图案；这里是**排版路径**本身在弯 —— 字的 x/y 和转角都由同一个
    曲率决定，路径一画出来，字就必须跟着走。

    做精的地方：
      ① 位置与转角同源：θ = s·κ，字绕自己的中心转 θ，天然贴着弧走（不是摆样子）；
      ② 弧线、法线刻度、半径读数都画出来 —— 这是一张"排字路径图"；
      ③ 曲率是弹簧（k/c/damp），换句与踩拍各给一次冲量，回弹是算出来的；
      ④ 半径限制在 520~2400，保证两端的字转角不超过 ~26°，始终读得出；
      ⑤ 无歌词：一条空弧在弯与直之间来回。
    ========================================================================== */

META = {
  label: 'ARC TYPESET / PATH',
  sub: '字排在一段圆弧上 · 曲率是弹簧',
  right: 'RADIUS',
  footer: 's → θ → POSITION',
  grid: 0,
  grain: 0.045,
  cross: true
};

let atK = 0.0016;      /* 曲率 1/r */
let atV = 0;           /* 曲率速度 */

function atBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!n) return null;
  const fs = Math.max(20, Math.min(132, (W * 0.62) / n, H * 0.165));
  const pad = Math.ceil(fs * 0.10);
  const cells = [];
  let S = 0;
  for (let k = 0; k < n; k++) {
    const adv = Math.max(fs * 0.4, measureRows([chars[k]], fs));
    const cw = Math.ceil(adv) + pad * 2, chh = Math.ceil(fs * 1.30) + pad * 2;
    const m = maskCanvas([chars[k]], fs, fs * 1.30, cw, chh);
    cells.push({ img: bakeCore(m), w: cw, h: chh, adv: adv, s: S + adv / 2 });
    S += adv;
  }
  return { cells: cells, n: n, S: S, fs: fs, text: line.text };
}

function mechBuild(i) { return atBuild(i); }
function mechCommit() { atK = 0.0016; atV = 0; }
function mechSeek() { atK = 0.0016; atV = 0; }

function mechUpdate(dt, time) {
  /* 目标曲率：常驻一点弯 + 慢呼吸 + 踩拍；换句时把曲率推到很弯，让弹簧自己回 */
  const target = 1 / 1450 + 0.00013 * Math.sin(time * 0.5) + kick * 0.00018;
  if (dt > 0) {
    const acc = -(atK - target) * 26 - atV * 5.2;
    atV += acc * dt;
    atK += atV * dt;
    if (atK < 1 / 2400) { atK = 1 / 2400; if (atV < 0) atV = 0; }
    if (atK > 1 / 520) { atK = 1 / 520; if (atV > 0) atV = 0; }
  }
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.44;
  const k = atK;
  const R = 1 / k;
  const amp = RM ? 0.5 : 1;
  const S = cur.S;
  const half = S / 2;

  /* 弧心在下方 cy + R；圆心角 = S·k */
  const cyArc = cy + R;

  /* ① 路径弧 + 刻度：画在字的**下方**（半径更小 = 更靠近弧心） */
  const pathR = Math.max(40, R - cur.fs * 0.66);
  const spanK = half * k + 0.05;
  ctx.strokeStyle = rgba(ACC, 0.26);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cyArc, pathR, -Math.PI / 2 - spanK, -Math.PI / 2 + spanK);
  ctx.stroke();
  ctx.strokeStyle = rgba(ACC, 0.13);
  ctx.beginPath();
  for (let q = 0; q <= 24; q++) {
    const s = -(half + 0.04 / k) + ((S + 0.08 / k) * q) / 24;
    const th = s * k;
    const px = cx + Math.sin(th) * pathR;
    const py = cyArc - Math.cos(th) * pathR;
    const nx = Math.sin(th), ny = -Math.cos(th);
    const L = q % 4 === 0 ? 9 : 5;
    ctx.moveTo(px, py);
    ctx.lineTo(px - nx * L, py - ny * L);
  }
  ctx.stroke();

  /* ② 字：绕自己的中心转 θ，位置 = 弧上的点 */
  for (let i = 0; i < cur.n; i++) {
    const cell = cur.cells[i];
    const th = (cell.s - half) * k;
    const px = cx + Math.sin(th) * R;
    const py = cyArc - Math.cos(th) * R;
    const age = T - lineAt;
    const u = Math.min(1, Math.max(0, (age - i * 0.05) / 0.5));
    const e = 1 - Math.pow(1 - u, 3);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(th);
    const sc = 0.90 + 0.10 * e;
    const dw = cell.w * sc, dh = cell.h * sc;
    ctx.globalAlpha = 0.35 + 0.65 * e;
    ctx.drawImage(cell.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  /* ③ 半径读数：放在字的上面，别压着字 */
  const topY = cy - cur.fs * 1.02 - 16;
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, topY + 14);
  ctx.lineTo(cx + 0.5, topY + 30);
  ctx.stroke();
  ctx.fillStyle = rgba(ACC, 0.42);
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('R ' + Math.round(R) + 'px', cx, topY + 8);
  ctx.fillStyle = rgba(ACC, 0.20);
  ctx.fillText('θ ' + ((half * k) * 180 / Math.PI * 2).toFixed(0) + '°', cx, topY - 4);

  /* ④ 仪表 */
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ACC, 0.30);
  const by = cy + Math.max(120, H * 0.26);
  const bx = cx - Math.min(W * 0.36, 470);
  ctx.fillText('ARC LENGTH ' + Math.round(S) + 'px   RADIUS ' + Math.round(R) + 'px   CURVATURE ' +
    (k * 1000).toFixed(2) + 'e-3   CHARS ' + cur.n, bx, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('θ = s · κ   SCALE ' + Math.round(cur.fs) + 'px   SAG ' +
    Math.round(R * (1 - Math.cos(half * k))) + 'px', bx, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一条空弧在弯与直之间来回 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.48;
  const k = 1 / (900 + 700 * (0.5 + 0.5 * Math.sin(T * 0.55)));
  const R = 1 / k;
  const cyArc = cy + R;
  const span = Math.min(W * 0.62, 780);
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cyArc, R, -Math.PI / 2 - (span / 2) * k, -Math.PI / 2 + (span / 2) * k);
  ctx.stroke();
  /* 刻度：等弧长的小齿 */
  ctx.strokeStyle = rgba(ACC, 0.16);
  ctx.beginPath();
  for (let q = 0; q <= 28; q++) {
    const s = -span / 2 + (span * q) / 28;
    const th = s * k;
    const px = cx + Math.sin(th) * R, py = cyArc - Math.cos(th) * R;
    const nx = Math.sin(th), ny = -Math.cos(th);
    const L = q % 4 === 0 ? 10 : 5;
    ctx.moveTo(px - nx * 6, py - ny * 6);
    ctx.lineTo(px - nx * (6 + L), py - ny * (6 + L));
  }
  ctx.stroke();
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.34);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · EMPTY ARC  R ' + Math.round(R) + 'px', cx - span / 2, cy + 120);
}

function mechStats() {
  return { radius: Math.round(1 / atK), curv: +(atK * 1000).toFixed(2), rmAmp: RM ? 0.5 : 1 };
}
