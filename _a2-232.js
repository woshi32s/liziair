/*! title: 字形软体
    ----------------------------------------------------------------------------
    机制一句话：整句字是一块**有质量的软体** —— 字形被切成 48 根竖条，每根是一个
    质点，被"回正弹簧"（k）和"相邻耦合"（c，横波沿字形传播）连在一起；换句和踩拍
    给中间一记冲量，字就真的像果冻一样抖（半隐式欧拉积分），静止时字完全可读。

    与已有形态的边界：206 是**字距**弹簧（字与字之间的间距，一维横向）；
    这里是**字形自己**在形变（每一竖条各自上下位移，波在字身上传），
    再叠一条"静止位残影"，抖了多少一眼能量出来。

    做精的地方：
      ① 位移是每帧积分出来的（不是 sin 假动），冲量落点、传播、回弹都是物理；
      ② 静止位画成 9% 的残影，形变与原始的差就是"软"；
      ③ 字形底下有一排弹簧 + 节点，把"这是一个质点链"交代出来；
      ④ 竖条之间 0.7px 的重叠，抖起来也不会裂开；
      ⑤ 无歌词：一排弹簧顶着一根横梁上下弹。
    ========================================================================== */

META = {
  label: 'GLYPH SOFT BODY / 48 NODES',
  sub: '字被切成 48 根竖条 · 每根是弹簧上的质点',
  right: 'SPRING k=90 c=260',
  footer: 'IMPULSE → WAVE → REST',
  grid: 0.012,
  grain: 0.045,
  cross: true
};

const BJ_N = 48;
const BJ_K = 90, BJ_C = 260, BJ_D = 7.0;
const bjD = new Float32Array(BJ_N);
const bjV = new Float32Array(BJ_N);
let bjAmp = 0;

function bjHit(power, center) {
  const c = (center === undefined ? 0.5 : center) * (BJ_N - 1);
  for (let i = 0; i < BJ_N; i++) {
    const x = (i - c) / 6.2;
    bjV[i] += power * Math.exp(-x * x);
  }
}
/* 常驻的一点"呼吸波"（只跟 T 走，暂停就冻住）：即使冲量已经衰减完，
   字也不是硬邦邦的一行 —— 形变与残影的差一直看得见 */
function bjWave(T, i) { return 3.9 * Math.sin(T * 0.85 + i * 0.22); }
function bjClear() {
  for (let i = 0; i < BJ_N; i++) { bjD[i] = 0; bjV[i] = 0; }
  bjAmp = 0;
}

function bjBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 9);
  const fs = fitFont(rows, W * 0.76, Math.min(182, H * 0.20));
  const lh = fs * 1.12;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.24);
  const chh = Math.ceil(rows.length * lh) + Math.ceil(fs * 0.10);
  if (cw < 8) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  return { cw: cw, chh: chh, fs: fs, core: bakeCore(mcv), rows: rows };
}

function mechBuild(i) { return bjBuild(i); }
function mechCommit() { bjClear(); bjHit(64, 0.5); }
function mechSeek() { bjClear(); }

function mechUpdate(dt, time) {
  if (dt > 0) {
    /* 半隐式欧拉：先加速度，再位置 */
    for (let i = 0; i < BJ_N; i++) {
      const l = i > 0 ? bjD[i - 1] : bjD[i];
      const r = i < BJ_N - 1 ? bjD[i + 1] : bjD[i];
      const acc = -BJ_K * bjD[i] + BJ_C * (l + r - 2 * bjD[i]) - BJ_D * bjV[i];
      bjV[i] += acc * dt;
    }
    let mx = 0;
    for (let i = 0; i < BJ_N; i++) {
      bjD[i] += bjV[i] * dt;
      if (bjD[i] > 24) { bjD[i] = 24; bjV[i] = 0; }
      if (bjD[i] < -24) { bjD[i] = -24; bjV[i] = 0; }
      const a = bjD[i] < 0 ? -bjD[i] : bjD[i];
      if (a > mx) mx = a;
    }
    bjAmp = bjAmp * 0.86 + mx * 0.14;
  }
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const x0 = cx - cur.cw / 2, y0 = cy - cur.chh / 2;
  const sw = cur.cw / BJ_N;                 /* 每根竖条的 CSS 宽 */
  const pw = cur.core.width / BJ_N;         /* 对应 device px */
  const amp = RM ? 0.4 : 1;

  /* ① 弹簧 + 节点（画在字后面，把"质点链"交代出来） */
  const baseY = y0 + cur.chh + 24;
  ctx.strokeStyle = rgba(ACC, 0.17);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < BJ_N; i++) {
    const x = x0 + (i + 0.5) * sw + 0.5;
    const dy = (bjD[i] + bjWave(T, i)) * amp;
    ctx.moveTo(x, baseY);
    /* 弹簧：5 折的锯齿，长度随位移伸缩 */
    const len = 18 + dy * 0.5;
    for (let s = 0; s < 5; s++) {
      const yy = baseY - len * (s / 5);
      ctx.lineTo(x + (s % 2 ? 3.1 : -3.1), yy);
    }
    ctx.lineTo(x, baseY - len);
  }
  ctx.stroke();
  ctx.fillStyle = rgba(ACC, 0.42);
  for (let i = 0; i < BJ_N; i++) {
    const x = x0 + (i + 0.5) * sw;
    const dy = (bjD[i] + bjWave(T, i)) * amp;
    ctx.fillRect(x - 1.1, baseY - 18 - dy * 0.5 - 1.4, 2.2, 2.8);
  }
  /* 静止位的一条细线 */
  ctx.strokeStyle = rgba(ACC, 0.12);
  ctx.beginPath();
  ctx.moveTo(x0, baseY + 0.5); ctx.lineTo(x0 + cur.cw, baseY + 0.5);
  ctx.stroke();

  /* ② 静止位残影 */
  ctx.globalAlpha = 0.085;
  ctx.drawImage(cur.core, x0, y0, cur.cw, cur.chh);
  ctx.globalAlpha = 1;

  /* ③ 软体：48 根竖条各自上下位移 */
  ctx.globalAlpha = 0.94;
  for (let i = 0; i < BJ_N; i++) {
    const dy = (bjD[i] + bjWave(T, i)) * amp;
    const dx = i * sw;
    ctx.drawImage(cur.core, i * pw, 0, pw, cur.core.height,
      x0 + dx, y0 + dy, sw + 0.8, cur.chh);
  }
  ctx.globalAlpha = 1;

  /* ④ 形变最大的地方：一条短的读数标尺 */
  let mi = 0, mv = 0;
  for (let i = 0; i < BJ_N; i++) {
    const a = Math.abs((bjD[i] + bjWave(T, i)) * amp);
    if (a > mv) { mv = a; mi = i; }
  }
  const mx = x0 + (mi + 0.5) * sw;
  ctx.strokeStyle = rgba(ACC, 0.34);
  ctx.beginPath();
  ctx.moveTo(mx + 0.5, y0 + cur.chh + 34);
  ctx.lineTo(mx + 0.5, y0 + cur.chh + 34 + mv * 1.4 + 3);
  ctx.stroke();
  ctx.font = '500 8px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.44);
  ctx.textAlign = 'left';
  ctx.fillText('Δ ' + mv.toFixed(1) + 'px', mx + 6, y0 + cur.chh + 48);

  /* ⑤ 仪表 */
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  const by = y0 + cur.chh + 78;
  ctx.fillText('NODES ' + BJ_N + '   k ' + BJ_K + '   c ' + BJ_C + '   damp ' + BJ_D, x0, by);
  ctx.fillStyle = rgba(ACC, 0.16);
  ctx.fillText('AMP ' + mv.toFixed(1) + 'px   NODE ' + sw.toFixed(2) + 'px   SET ' + Math.round(cur.fs) + 'px', x0, by + 13);
  ctx.textAlign = 'left';
}

/* 无歌词：一排弹簧顶着一根横梁 */
function mechEmpty(T) {
  const cx = W / 2, cy = H * 0.5;
  const n = 22, span = Math.min(W * 0.60, 760), step = span / n;
  const x0 = cx - span / 2;
  const ph = T * 1.6;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * step;
    const dy = Math.sin(ph + i * 0.34) * 9;
    const baseY = cy + 60;
    ctx.strokeStyle = rgba(ACC, 0.26);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    for (let s = 1; s <= 5; s++) {
      const yy = baseY - 90 * (s / 5);
      ctx.lineTo(x + (s % 2 ? 3.4 : -3.4), yy);
    }
    ctx.stroke();
    ctx.fillStyle = rgba(ACC, 0.5);
    ctx.fillRect(x - 1, baseY - 90 + dy - 1, 2, 2);
  }
  /* 横梁 */
  ctx.strokeStyle = rgba(ACC, 0.65);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * step;
    const dy = Math.sin(ph + i * 0.34) * 9;
    if (i === 0) ctx.moveTo(x, cy - 30 + dy); else ctx.lineTo(x, cy - 30 + dy);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.font = '500 9px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.32);
  ctx.textAlign = 'left';
  ctx.fillText('NO COPY · SOFT BODY AT REST', x0, cy + 96);
}

function mechStats() {
  return { nodes: BJ_N, amp: +bjAmp.toFixed(2), rmAmp: RM ? 0.4 : 1 };
}
