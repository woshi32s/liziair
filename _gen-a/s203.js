/* ---------------------------------------------------------------------------
   203 · 机制实现：半调网点 + 套印偏移 + 印刷标记
   ------------------------------------------------------------------------- */
META = {
  label: 'HALFTONE / 2-INK PRESS',
  sub: '网点 45° · 套印 2 色 · 纸纹',
  right: 'SCREEN 75 LPI',
  footer: 'INK 01+02',
  grid: 0.014,
  grain: 0.07,
  cross: true
};

const PITCH = 6.8;
let paper = null;

/* 纸：深炭 + 纤维。烘一次，挂在 resize 上 */
function bakePaper() {
  const c = document.createElement('canvas');
  c.width = Math.round(W); c.height = Math.round(H);
  const g = c.getContext('2d');
  g.fillStyle = '#0a0908';
  g.fillRect(0, 0, c.width, c.height);
  /* 纤维：短而淡的斜线 */
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const a = (Math.random() - 0.5) * 0.5 + 0.5;
    const L = 6 + Math.random() * 26;
    g.strokeStyle = 'rgba(190,180,160,' + (0.008 + Math.random() * 0.016).toFixed(3) + ')';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
    g.stroke();
  }
  /* 大块的明暗不匀（油墨滚过的痕迹） */
  for (let i = 0; i < 5; i++) {
    const grd = g.createRadialGradient(
      Math.random() * W, Math.random() * H, 0,
      Math.random() * W, Math.random() * H, MN * (0.4 + Math.random() * 0.5)
    );
    grd.addColorStop(0, 'rgba(120,130,140,0.020)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  return c;
}

/* 半调：45° 网点，点的半径 = 局部墨量。
   先把遮罩柔化一次，然后每个网点只取一个样 —— 100k 次取样降到 1 次查找 */
function bakeHalftone(mcv, cw, chh, color, ox, oy, scale) {
  const soft = document.createElement('canvas');
  soft.width = mcv.width; soft.height = mcv.height;
  const sg = soft.getContext('2d', { willReadFrequently: true });
  sg.filter = 'blur(1.6px)';
  sg.drawImage(mcv, 0, 0);
  sg.filter = 'none';
  const src = sg.getImageData(0, 0, soft.width, soft.height).data;

  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(cw * SS));
  c.height = Math.max(2, Math.ceil(chh * SS));
  const g = c.getContext('2d');
  const mw = soft.width, mh = soft.height;
  const s = Math.max(1, Math.round(SS));
  const p = PITCH * s * (scale || 1);
  const ca = Math.cos(Math.PI / 4), sa = Math.sin(Math.PI / 4);
  const diag = Math.ceil((cw * SS + chh * SS) / p) + 2;
  g.fillStyle = color;
  const path = new Path2D();
  for (let j = -diag; j < diag; j++) {
    for (let i = -diag; i < diag; i++) {
      const gx = (i * ca - j * sa) * p + (ox || 0) * s;
      const gy = (i * sa + j * ca) * p + (oy || 0) * s;
      if (gx < -p || gy < -p || gx > c.width + p || gy > c.height + p) continue;
      const px = gx | 0, py = gy | 0;
      const a = src[(py * mw + px) * 4 + 3];
      if (a < 14) continue;
      const r = p * 0.55 * Math.sqrt(a / 255);
      path.moveTo(gx + r, gy);
      path.arc(gx, gy, r, 0, Math.PI * 2);
    }
  }
  g.fill(path);
  return c;
}

function mechResize() {
  paper = bakePaper();
}

function mechBuild(i) {
  const line = lines[i];
  if (!line || !line.text) return null;
  const rows = wrapRows(line.text, 14);
  const fs = fitFont(rows, W * 0.76, Math.min(170, H * 0.17));
  const lh = fs * 1.16;
  const cw = Math.ceil(measureRows(rows, fs)) + Math.ceil(fs * 0.22);
  const chh = Math.ceil(rows.length * lh);
  if (cw < 4) return null;
  const mcv = maskCanvas(rows, fs, lh, cw, chh);
  const inkA = bakeHalftone(mcv, cw, chh, '#ffffff', 0, 0, 1);
  /* 第二色版：同形状、错位 —— 真正的套印误差 */
  const inkB = bakeHalftone(mcv, cw, chh, rgba(mixc(ACC, [255, 255, 255], 0.25), 1), 0, 0, 1.02);
  return { cw, chh, fs, rows, inkA, inkB };
}

let regOff = 2.6;
function mechCommit() { regOff = 2.4 + Math.random() * 0.8; }
function mechSeek() { regOff = 2.6; }
function mechUpdate(dt, time) {
  /* 套印偏移随拍子轻微跑版，然后回到基准 */
  const base = 2.2 + Math.sin(time * 0.37) * 1.0;
  regOff = base + kick * 4.2;
}

function mechDraw(T) {
  if (!cur) return;
  const cx = W / 2, cy = H * 0.5;
  const amp = RM ? 0.4 : 1;
  const age = T - lineAt;

  /* 纸 */
  if (paper) ctx.drawImage(paper, 0, 0, W, H);

  /* 滚筒：一道很宽的斜向高光缓慢扫过（油墨反光） */
  const rx = ((T * 0.055) % 1.6 - 0.3) * W;
  ctx.globalCompositeOperation = 'lighter';
  const rg = ctx.createLinearGradient(rx - 260, 0, rx + 260, H * 0.4);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(0.5, rgba(ACC, 0.035));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const w = cur.cw, h = cur.chh;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const lift = 1 + 0.006 * Math.sin(T * 0.8) * amp;

  /* 第二色版（先印）*/
  ctx.globalAlpha = 0.55;
  ctx.drawImage(cur.inkB, x0 + regOff, y0 - regOff * 0.72, w * lift, h * lift);
  /* 主色版 */
  ctx.globalAlpha = 0.95;
  ctx.drawImage(cur.inkA, x0, y0, w * lift, h * lift);
  ctx.globalAlpha = 1;

  /* 压印：字下一点点暗，让油墨"压"在纸上 */
  const sh = ctx.createLinearGradient(0, y0 + h, 0, y0 + h + 16);
  sh.addColorStop(0, 'rgba(0,0,0,0.30)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x0, y0 + h, w, 16);
}

/* 印刷标记：裁切线、套准靶、墨色条 */
function mechChrome() {
  const m = 26;
  ctx.strokeStyle = rgba(ACC, 0.30);
  ctx.lineWidth = 1;
  /* 四角裁切线 */
  const k = 18;
  ctx.beginPath();
  for (let s = 0; s < 4; s++) {
    const x = s % 2 ? W - m - 34 : m + 34;
    const y = s < 2 ? m + 34 : H - m - 34;
    ctx.moveTo(x - k, y); ctx.lineTo(x - k * 0.35, y);
    ctx.moveTo(x + k * 0.35, y); ctx.lineTo(x + k, y);
    ctx.moveTo(x, y - k); ctx.lineTo(x, y - k * 0.35);
    ctx.moveTo(x, y + k * 0.35); ctx.lineTo(x, y + k);
  }
  ctx.stroke();
  /* 套准靶（右上） */
  const tx = W - m - 76, ty = m + 46;
  ctx.beginPath();
  ctx.arc(tx, ty, 13, 0, Math.PI * 2);
  ctx.moveTo(tx - 19, ty); ctx.lineTo(tx + 19, ty);
  ctx.moveTo(tx, ty - 19); ctx.lineTo(tx, ty + 19);
  ctx.stroke();
  ctx.fillStyle = rgba(ACC, 0.5);
  ctx.beginPath();
  ctx.arc(tx, ty, 2.4, 0, Math.PI * 2);
  ctx.fill();
  /* 墨色条（左下）：两块实色 + 网目 */
  const bx = m + 20, by = H - m - 52;
  ctx.fillStyle = rgba(ACC, 0.75);
  ctx.fillRect(bx, by, 26, 12);
  ctx.fillStyle = 'rgba(244,250,252,0.86)';
  ctx.fillRect(bx + 30, by, 26, 12);
  ctx.fillStyle = rgba(ACC, 0.42);
  for (let i = 0; i < 5; i++) ctx.fillRect(bx + i * 6, by + 18, 3, 6);
  ctx.fillStyle = 'rgba(244,250,252,0.35)';
  for (let i = 0; i < 5; i++) ctx.fillRect(bx + 30 + i * 6, by + 18, 3, 6);
  ctx.font = '500 7.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.textAlign = 'left';
  ctx.fillText('INK 01', bx, by + 34);
  ctx.fillText('INK 02', bx + 30, by + 34);
}

/* 无歌词：套准靶 + 一张网点渐变（像晒版测试条） */
function mechEmpty(T) {
  const cy = H * 0.5;
  const p = 9;
  const ox = W * 0.5 - 260;
  ctx.fillStyle = 'rgba(244,250,252,0.9)';
  for (let row = 0; row < 7; row++) {
    for (let i = 0; i < 56; i++) {
      const u = i / 55;
      const cov = Math.pow(1 - u, 1.4) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * 0.8 + row * 0.7)));
      const r = p * 0.62 * Math.sqrt(Math.max(0, cov));
      if (r < 0.25) continue;
      ctx.beginPath();
      ctx.arc(ox + i * p, cy - 3 * p + row * p, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tx = W * 0.5, ty = cy - 150;
  ctx.strokeStyle = rgba(ACC, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(tx, ty, 26, 0, Math.PI * 2);
  ctx.moveTo(tx - 38, ty); ctx.lineTo(tx + 38, ty);
  ctx.moveTo(tx, ty - 38); ctx.lineTo(tx, ty + 38);
  ctx.stroke();
}

function mechStats() {
  return {
    rmAmp: RM ? 0.4 : 1, ink: 2, pitch: PITCH, reg: +regOff.toFixed(2) };
}
