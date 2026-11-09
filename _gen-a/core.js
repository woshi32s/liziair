/* ============================================================================
   A 组公共骨架（构建期拼进每个形态的 <script> 里，不是外部依赖）
   ----------------------------------------------------------------------------
   机制文件需要实现（可选，缺省是空实现）：
     mechInit()                 脚本加载后一次
     mechResize()               resize 之后（W/H/DPR/SS 已更新）
     mechBuild(i) -> kit        换句预烘；返回该句要用的数据（可以在 i<0 时返回 null）
     mechCommit(kit)            切到这一句
     mechSeek()                 拖进度条：清状态
     mechUpdate(dt, T)          每帧物理（暂停时 dt = 0）
     mechDraw(T)                每帧绘制（背景已画好）
     mechEmpty(T)               无歌词 / 还没到第一句时的纯音频视觉
     mechChrome(T)              叠加本形态自己的文字（在通用角标之前画）
     mechStats()                额外塞进 window.__stage() 的字段
   机制文件还可以定义：
     const META = { label, sub, right, footer, cross, grid, song, ticks }
   ----------------------------------------------------------------------------
   骨架保证的四条纪律（每个形态都免费拿到，机制不用自己写）：
     · 空歌词   init 里 lines=[] → cur 永远是 null → 只走 mechEmpty()，不崩不空白
     · resize   W/H/DPR/SS 更新后重烘当前句；重建失败保留旧图，不黑屏
     · 减少动态 matchMedia 实时监听（不是启动时读一次），机制里读 RM 即得当前值
     · 暂停冻结 t 不再前进 → dt=0，mechUpdate 不再积分；画面逐字节不变
   另有 ERR 捕获：机制里任何一处抛异常，__stage().err 会变成非空（验收会红），
   而不是静默黑屏。
   ========================================================================== */

const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { alpha: false });
const hint = document.getElementById('hint');

/* 机制没实现的钩子就用这些空实现（同名 function 声明后面会覆盖掉它们） */
function mechInit() { }
function mechResize() { }
function mechBuild() { return null; }
function mechCommit() { }
function mechSeek() { }
function mechUpdate() { }
function mechDraw() { }
function mechEmpty() { }
let META = { label: '', sub: '', right: '', footer: '', grid: 0, grain: 0, cross: true };

let W = 1, H = 1, MN = 1, DPR = 1, SS = 1;

/* 减少动态：实时监听（用户中途改系统设置 / 验收脚本 setEmulatedMedia 都能收到），
   不是启动时读一次 —— 机制代码里读 RM 拿到的永远是当前值。 */
const rmq = matchMedia('(prefers-reduced-motion: reduce)');
let RM = rmq.matches;
try {
  rmq.addEventListener('change', (e) => { RM = !!e.matches; });
} catch (_) {
  try { rmq.addListener((e) => { RM = !!e.matches; }); } catch (__) {}
}

/* 机制抛错不要静默：记在 ERR 里，__stage().err 非空 = 这个形态坏了 */
let ERR = '';
function fail(where, e) {
  const m = (e && e.message ? e.message : String(e || 'unknown')).slice(0, 120);
  if (!ERR) ERR = where + ': ' + m;
  try { parent.postMessage({ __c100: 1, type: 'error', payload: { message: ERR } }, '*'); } catch (_) {}
}
function guard(where, fn, fallback) {
  try { return fn(); } catch (e) { fail(where, e); return fallback; }
}

/* 主色：只允许"主色 + 近白"两种强调色，饱和度压下来（不要彩虹） */
let ACC = [140, 208, 222];
function setAccent(a) {
  if (Array.isArray(a) && a.length >= 3) {
    const r = Math.max(0, Math.min(255, a[0] | 0));
    const g = Math.max(0, Math.min(255, a[1] | 0));
    const b = Math.max(0, Math.min(255, a[2] | 0));
    const mx = Math.max(r, g, b) || 1;
    const k = 0.66 / mx;
    ACC = [
      Math.round(r * k + 158 * (1 - k)),
      Math.round(g * k + 198 * (1 - k)),
      Math.round(b * k + 212 * (1 - k))
    ];
  }
}
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
const mixc = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
];
const FONT = (w, s) => w + ' ' + s + 'px "PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

/* ---------------------------- 画布 / 底色 ---------------------------- */
let bgGrad = null, glowGrad = null, grainPat = null;
function bakeGrain() {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < n * n; i++) {
    const v = 128 + (Math.random() - 0.5) * 96;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, window.innerWidth);
  H = Math.max(1, window.innerHeight);
  MN = Math.min(W, H);
  SS = Math.max(1, Math.min(2, DPR));
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#05080d');
  bgGrad.addColorStop(0.5, '#04060a');
  bgGrad.addColorStop(1, '#020406');
  glowGrad = ctx.createRadialGradient(W * 0.5, H * 0.48, 0, W * 0.5, H * 0.48, MN * 0.92);
  glowGrad.addColorStop(0, rgba(ACC, 0.055));
  glowGrad.addColorStop(0.55, rgba(ACC, 0.014));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  if (!grainPat) grainPat = bakeGrain();
  guard('resize', mechResize);
}

/* 网格 / 颗粒：形态可以只用其中一层 */
const GRID_STEP = 72;
function drawBackdrop(T) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = bgGrad || '#04060a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = glowGrad || 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, W, H);
  if (META.grid) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += GRID_STEP) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += GRID_STEP) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.strokeStyle = rgba(ACC, META.grid);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (META.grain && grainPat) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = META.grain;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------- 字形工具 ---------------------------- */
const off = document.createElement('canvas');
const octx = off.getContext('2d', { willReadFrequently: true });

function wrapRows(text, maxChars) {
  const chars = Array.from(text || '');
  if (chars.length <= maxChars) return [text || ''];
  const R = Math.ceil(chars.length / maxChars);
  const per = Math.ceil(chars.length / R);
  const out = [];
  for (let i = 0; i < chars.length; i += per) out.push(chars.slice(i, i + per).join(''));
  return out;
}
function measureRows(rows, fs, weight) {
  octx.font = FONT(weight || 800, fs);
  let w = 0;
  for (let i = 0; i < rows.length; i++) {
    const m = octx.measureText(rows[i]).width;
    if (m > w) w = m;
  }
  return w;
}
function fitFont(rows, maxW, maxFs, weight) {
  let fs = maxFs;
  const w = measureRows(rows, fs, weight);
  if (w > maxW) fs = Math.max(18, fs * (maxW / w));
  return fs;
}
/* 把字画成一张白色遮罩（device px = CSS × SS） */
function maskCanvas(rows, fs, lh, cw, chh, weight, align) {
  const m = document.createElement('canvas');
  m.width = Math.max(2, Math.ceil(cw * SS));
  m.height = Math.max(2, Math.ceil(chh * SS));
  const g = m.getContext('2d', { willReadFrequently: true });
  g.setTransform(SS, 0, 0, SS, 0, 0);
  g.font = FONT(weight || 800, fs);
  g.textAlign = align || 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  const ax = align === 'left' ? 0 : cw / 2;
  for (let r = 0; r < rows.length; r++) g.fillText(rows[r], ax, (r + 0.5) * lh);
  return m;
}
function tintMask(mcv, col) {
  const c = document.createElement('canvas');
  c.width = mcv.width; c.height = mcv.height;
  const g = c.getContext('2d');
  g.drawImage(mcv, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
/* 渐变实心字：上白下淡主色 */
function bakeCore(mcv, top, bottom) {
  const c = document.createElement('canvas');
  c.width = mcv.width; c.height = mcv.height;
  const g = c.getContext('2d');
  g.drawImage(mcv, 0, 0);
  g.globalCompositeOperation = 'source-in';
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, top || '#ffffff');
  grd.addColorStop(0.45, '#f4fbff');
  grd.addColorStop(0.84, '#dceef6');
  grd.addColorStop(1, bottom || rgba([Math.min(255, ACC[0] + 90), Math.min(255, ACC[1] + 40), Math.min(255, ACC[2] + 26)], 1));
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
function bakeHalo(mcv, blurPx, scale) {
  const sc = scale || 0.5;
  const t = document.createElement('canvas');
  t.width = Math.max(2, Math.round(mcv.width * sc));
  t.height = Math.max(2, Math.round(mcv.height * sc));
  const g = t.getContext('2d');
  g.filter = 'blur(' + (blurPx || 5) + 'px)';
  g.drawImage(mcv, 0, 0, t.width, t.height);
  g.filter = 'none';
  return t;
}

/* 两遍 chamfer 距离变换（4 邻 + 对角，权重 1 / √2） */
function edt(gw, gh, target, d) {
  const INF = 1e8, A = 1, B = Math.SQRT2;
  for (let j = 0; j < gh; j++) {
    const row = j * gw;
    for (let i = 0; i < gw; i++) d[row + i] = target[row + i] ? 0 : INF;
  }
  for (let j = 0; j < gh; j++) {
    const row = j * gw;
    for (let i = 0; i < gw; i++) {
      const k = row + i;
      let v = d[k];
      if (i > 0) { const t = d[k - 1] + A; if (t < v) v = t; }
      if (j > 0) {
        let t = d[k - gw] + A; if (t < v) v = t;
        if (i > 0) { t = d[k - gw - 1] + B; if (t < v) v = t; }
        if (i < gw - 1) { t = d[k - gw + 1] + B; if (t < v) v = t; }
      }
      d[k] = v;
    }
  }
  for (let j = gh - 1; j >= 0; j--) {
    const row = j * gw;
    for (let i = gw - 1; i >= 0; i--) {
      const k = row + i;
      let v = d[k];
      if (i < gw - 1) { const t = d[k + 1] + A; if (t < v) v = t; }
      if (j < gh - 1) {
        let t = d[k + gw] + A; if (t < v) v = t;
        if (i < gw - 1) { t = d[k + gw + 1] + B; if (t < v) v = t; }
        if (i > 0) { t = d[k + gw - 1] + B; if (t < v) v = t; }
      }
      d[k] = v;
    }
  }
}
function blurField(src, gw, gh, passes) {
  let a = src, b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < gh; j++) {
      const row = j * gw;
      const up = j > 0 ? row - gw : row;
      const dn = j < gh - 1 ? row + gw : row;
      for (let i = 0; i < gw; i++) {
        const l = i > 0 ? i - 1 : i, r = i < gw - 1 ? i + 1 : i;
        b[row + i] = (a[up + l] + a[up + i] + a[up + r] +
                      a[row + l] + a[row + i] + a[row + r] +
                      a[dn + l] + a[dn + i] + a[dn + r]) / 9;
      }
    }
    const t = a; a = b; b = t;
  }
  return a;
}

/* Marching squares：抽等值线段（塞进 out，不做连线） */
const MS_TABLE = {
  1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 5: [3, 0, 1, 2], 6: [0, 2],
  7: [3, 2], 8: [2, 3], 9: [0, 2], 10: [0, 1, 2, 3], 11: [1, 2],
  12: [1, 3], 13: [0, 1], 14: [3, 0], 15: []
};
function isoLines(sd, gw, gh, level, out) {
  for (let j = 0; j < gh - 1; j++) {
    const r0 = j * gw, r1 = r0 + gw;
    for (let i = 0; i < gw - 1; i++) {
      const a = sd[r0 + i], b = sd[r0 + i + 1], c = sd[r1 + i + 1], d = sd[r1 + i];
      let idx = 0;
      if (a > level) idx |= 1;
      if (b > level) idx |= 2;
      if (c > level) idx |= 4;
      if (d > level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const t1 = (level - a) / (b - a), t2 = (level - b) / (c - b);
      const t3 = (level - c) / (d - c), t4 = (level - d) / (a - d);
      const P = [i + t1, j, i + 1, j + t2, i + t3, j + 1, i, j + t4];
      const e = MS_TABLE[idx];
      for (let q = 0; q < e.length; q += 2) {
        out.push(P[e[q] * 2], P[e[q] * 2 + 1], P[e[q + 1] * 2], P[e[q + 1] * 2 + 1]);
      }
    }
  }
}

/* ---------------------------- 歌词时序 ---------------------------- */
let lines = [];
let cur = null, curIdx = -1, brewIdx = -1, prep = null, lastT = -1;
let lineAt = 0, kick = 0, lastBuild = 0;
let clockT = 0, clockAt = 0, playing = false, lastTickAt = 0;
let frames = 0, ready = false, T = 0;
let songTitle = '', songArtist = '';

const nowT = () => clockT + ((playing && performance.now() - lastTickAt < 1000) ? (performance.now() - clockAt) / 1000 : 0);
const isLive = () => playing && (performance.now() - lastTickAt < 1000);

/* 每个字的起唱时刻：chars 逐字可信才用 YRC，否则按句长均分 */
function onsetOf(line, k, n) {
  const ch = line && line.chars;
  if (ch && ch.length === n && ch[k] && typeof ch[k].t === 'number') return ch[k].t;
  const dur = (line && line.dur) || 4;
  return ((line && line.t) || 0) + (k / Math.max(1, n)) * dur * 0.85;
}

function timing(t) {
  if (!lines.length) {
    if (cur) { cur = null; curIdx = -1; mechSeek(); }
    return;
  }
  const jump = (t < lastT - 0.6) || (t > lastT + 2.0);
  if (jump) {
    cur = null; curIdx = -1; brewIdx = -1; prep = null; kick = 0;
    mechSeek();
    hint.style.opacity = '1';
    hint.textContent = '等待第一句…';
  }
  lastT = t;
  let ci = curIdx;
  while (ci + 1 < lines.length && t >= lines[ci + 1].t) ci++;
  if (ci !== curIdx) {
    curIdx = ci;
    brewIdx = -1;
    const t0 = performance.now();
    const kit = (prep && prep.i === ci) ? prep.kit : guard('build', () => mechBuild(ci), null);
    lastBuild = performance.now() - t0;
    prep = null;
    if (ci >= 0) {
      cur = kit;
      lineAt = t;
      kick = Math.max(kick, 0.4);
      hint.style.opacity = '0';
      guard('commit', () => mechCommit(kit));
    } else {
      cur = null;
    }
  }
  const nx = curIdx + 1;
  if (nx < lines.length && brewIdx !== nx) {
    const gap = lines[nx].t - (curIdx >= 0 ? lines[curIdx].t : lines[nx].t - 4);
    const lead = Math.min(1.2, Math.max(0.35, gap * 0.45));
    if (t >= lines[nx].t - lead) { brewIdx = nx; prep = { i: nx, kit: guard('prep', () => mechBuild(nx), null) }; }
  }
}

/* ---------------------------- 交互 ---------------------------- */
let ptrX = -999, ptrY = -999, ptrIn = false, ptrDown = false;
const ping = () => { try { parent.postMessage({ __c100: 1, type: 'activity' }, '*'); } catch (_) {} };
addEventListener('pointermove', (e) => { ptrX = e.clientX; ptrY = e.clientY; ptrIn = true; ping(); }, { passive: true });
addEventListener('pointerleave', () => { ptrIn = false; }, { passive: true });
addEventListener('pointerdown', (e) => { ptrDown = true; if (typeof mechDown === 'function') mechDown(e.clientX, e.clientY); }, { passive: true });
addEventListener('pointerup', () => { ptrDown = false; }, { passive: true });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    try { parent.postMessage({ __c100: 1, type: 'key', payload: { key: 'Space' } }, '*'); } catch (_) {}
  }
}, true);

/* ---------------------------- 通用角标 ---------------------------- */
function drawFurniture() {
  const m = 26, L = 13;
  const c = rgba(ACC, 0.34);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1;
  ctx.font = '500 10px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (META.ticks !== false) {
  ctx.beginPath();
  ctx.moveTo(m, m + L); ctx.lineTo(m, m); ctx.lineTo(m + L, m);
  ctx.moveTo(W - m - L, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + L);
  ctx.moveTo(W - m, H - m - L); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m - L, H - m);
  ctx.moveTo(m + L, H - m); ctx.lineTo(m, H - m); ctx.lineTo(m, H - m - L);
  ctx.stroke();
  }

  ctx.fillStyle = rgba(ACC, 0.30);
  ctx.fillText(META.label || '', m + 20, m + 9);
  ctx.font = '500 8.5px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.17);
  if (META.sub) ctx.fillText(META.sub, m + 20, m + 23);
  if (META.song !== false && songTitle) {
    ctx.font = '500 9px ui-monospace,Consolas,monospace';
    ctx.fillStyle = rgba(ACC, 0.24);
    ctx.fillText(songTitle + (songArtist ? ' — ' + songArtist : ''), m + 20, m + 37);
  }
  ctx.font = '500 10px ui-monospace,Consolas,monospace';
  ctx.fillStyle = rgba(ACC, 0.28);
  ctx.textAlign = 'right';
  if (META.right) ctx.fillText(META.right, W - m - 20, m + 9);
  const total = lines.length;
  const no = total && curIdx >= 0 ? String(curIdx + 1).padStart(2, '0') : '--';
  ctx.fillText(no + ' / ' + String(total || 0).padStart(2, '0'), W - m - 20, H - m - 12);
  ctx.textAlign = 'left';
  ctx.fillText(META.footer || '', m + 20, H - m - 12);

  if (META.cross !== false && ptrIn) {
    ctx.strokeStyle = rgba(ACC, 0.16);
    ctx.beginPath();
    ctx.moveTo(ptrX, 0); ctx.lineTo(ptrX, H);
    ctx.moveTo(0, ptrY); ctx.lineTo(W, ptrY);
    ctx.stroke();
    ctx.strokeStyle = rgba(ACC, 0.44);
    ctx.beginPath();
    ctx.arc(ptrX, ptrY, 4.5, 0, Math.PI * 2);
    ctx.moveTo(ptrX - 10, ptrY); ctx.lineTo(ptrX - 7, ptrY);
    ctx.moveTo(ptrX + 7, ptrY); ctx.lineTo(ptrX + 10, ptrY);
    ctx.moveTo(ptrX, ptrY - 10); ctx.lineTo(ptrX, ptrY - 7);
    ctx.moveTo(ptrX, ptrY + 7); ctx.lineTo(ptrX, ptrY + 10);
    ctx.stroke();
  }
}

/* ---------------------------- 主循环 ---------------------------- */
let raf = 0, prevMs = 0, jsMs = 0;
function frame(ms) {
  const jsT0 = performance.now();
  const dt = prevMs ? Math.min(0.05, (ms - prevMs) / 1000) : 0.016;
  prevMs = ms;
  T = nowT();
  timing(T);
  const live = isLive();
  kick *= Math.exp(-(live ? dt : 0) * 3.4);
  /* 暂停时 dt = 0：机制里的物理不再积分，画面逐字节冻结 */
  guard('update', () => mechUpdate(live ? dt : 0, T));
  drawBackdrop(T);
  if (cur) guard('draw', () => mechDraw(T)); else guard('empty', () => mechEmpty(T));
  if (typeof mechChrome === 'function') guard('chrome', () => mechChrome(T));
  drawFurniture();
  jsMs = performance.now() - jsT0;
  frames++;
  if (!ready) {
    ready = true;
    try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (_) {}
  }
  raf = requestAnimationFrame(frame);
}

/* ---------------------------- 生命周期 ---------------------------- */
/* 启动放在整段脚本最后（构建器拼在所有机制代码之后）：
   机制的 let/const 必须先初始化，resize 里才敢调 mechResize */
addEventListener('pagehide', () => { cancelAnimationFrame(raf); raf = 0; });

let rzTimer = 0;
addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(() => {
    resize();
    if (curIdx >= 0) {
      /* 重建失败就保留旧图（不黑屏），但 ERR 会记下来 → 验收会红 */
      const kit = guard('rebuild', () => mechBuild(curIdx), null);
      if (kit) { cur = kit; lineAt = T; guard('commit', () => mechCommit(kit)); }
    }
  }, 140);
});

addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__c100 !== 1) return;
  if (d.type === 'init') {
    const p = d.payload || {};
    lines = (p.lines || []).slice().sort((a, b) => a.t - b.t);
    if (p.accent) setAccent(p.accent);
    /* 父页给的是 song.name + artists[]，也兼容 title/artist 写法 */
    const sg = p.song || {};
    const ar = sg.artist || (Array.isArray(sg.artists) && sg.artists[0] && sg.artists[0].name) || '';
    songTitle = sg.title || sg.name || '';
    songArtist = typeof ar === 'string' ? ar : (ar.name || '');
    cur = null; curIdx = -1; brewIdx = -1; prep = null; lastT = -1;
    kick = 0;
    clockT = 0; clockAt = performance.now(); lastTickAt = 0; playing = false;
    hint.textContent = lines.length ? '等待第一句…' : '这首没有歌词 · 纯音频';
    hint.style.opacity = lines.length ? '1' : '0.55';
    resize();
    guard('seek', mechSeek);
  } else if (d.type === 'tick') {
    const pl = d.payload || {};
    clockT = +pl.time || 0;
    clockAt = performance.now();
    playing = !!pl.playing;
    lastTickAt = performance.now();
  } else if (d.type === 'beat') {
    kick = Math.min(1.1, kick + 0.20 + (d.payload.level || 0) * 0.45);
  } else if (d.type === 'live') {
    if (d.payload && d.payload.playing === false) playing = false;
  }
});

try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (_) {}

window.__stage = () => Object.assign({
  lines: lines.length,
  idx: curIdx,
  t: +T.toFixed(2),
  playing: isLive(),
  frames: frames,
  js: +jsMs.toFixed(2),
  hasLyric: !!cur,
  buildMs: +lastBuild.toFixed(1),
  rm: RM,
  err: ERR,
  /* 有句该唱却烘不出字 → false（验收据此判 resize 后是否还能读） */
  glyph: (lines.length === 0 || curIdx < 0) ? true : !!cur
}, typeof mechStats === 'function' ? mechStats() : {});
