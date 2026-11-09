/* ══════════════════════════════════════════════════════════════════════════
   C 组共享内核（单文件内联；形态不加载任何外部资源）
   协议 / 排版 / 预烘 / 时钟 / 四条纪律（空歌词 · 暂停冻结 · resize · 降级）
   —— 形态只实现 S.* 里的机制：bake / draw / step / onLine / onEmpty / ...
   ══════════════════════════════════════════════════════════════════════════ */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { alpha: false });
const hint = document.getElementById('hint');

let W = 1, H = 1, DPR = 1, MN = 1, VX = 1, VY = 1;
const CFG = { vy: 0.5, maxW: 0.72, maxH: 0.34, track: 0.035 };
let ACC = [126, 178, 255];
const S = {};                    /* 形态实现挂在这里 */

/* ---- prefers-reduced-motion：运行中切换也要跟得上（验收会中途改它） ---- */
let RM = false;
try {
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) {
    RM = !!mq.matches;
    const onMQ = function (e) {
      RM = !!e.matches;
      dirty = true;
      if (S.onRM) S.onRM();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMQ);
    else if (mq.addListener) mq.addListener(onMQ);
  }
} catch (_) {}

/* ══════════════════════════════ 排版 ══════════════════════════════ */
const FAMILY = '"PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans SC",system-ui,sans-serif';
const OPUNCT = '，。、；：！？）】》」』”’,.!?;:)]}%…';
const LPUNCT = '（【《「『“‘({[';
const measCtx = document.createElement('canvas').getContext('2d');
const fontOf = (fs) => '800 ' + fs + 'px ' + FAMILY;

function measureStr(s, fs) {
  measCtx.font = fontOf(fs);
  let w = 0;
  for (let i = 0; i < s.length; i++) w += measCtx.measureText(s[i]).width + fs * CFG.track;
  return Math.max(0, w - fs * CFG.track);
}

/* 长句折行：在标点处断，不把标点摔到行首 */
function splitRows(s, L) {
  const n = s.length, cuts = [];
  for (let i = 1; i < L; i++) {
    let c = Math.round(i * n / L);
    while (c < n && OPUNCT.indexOf(s[c]) >= 0) c++;
    if (c > 0 && c < n && LPUNCT.indexOf(s[c - 1]) >= 0) c--;
    if (c <= 0 || c >= n) continue;
    if (cuts.length && c <= cuts[cuts.length - 1]) continue;
    cuts.push(c);
  }
  const rows = [];
  let prev = 0;
  for (let i = 0; i < cuts.length; i++) { rows.push(s.slice(prev, cuts[i])); prev = cuts[i]; }
  rows.push(s.slice(prev));
  return rows.filter((r) => r.length > 0);
}

/* 排版：试 1~3 行，取字号最大的那一种（长句自动折行，不缩成蚂蚁） */
function layout(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const n = s.length;
  const maxW = Math.min(W * CFG.maxW, 1120);
  const maxH = H * CFG.maxH;
  const maxL = n <= 12 ? 1 : (n <= 24 ? 2 : 3);
  let best = null;
  for (let L = 1; L <= maxL; L++) {
    if (L > 1 && n < L + 2) continue;
    const rows = splitRows(s, L);
    let w100 = 0;
    for (let i = 0; i < rows.length; i++) w100 = Math.max(w100, measureStr(rows[i], 100));
    const fs = Math.min(maxW / (Math.max(1, w100) / 100), maxH / (1.22 * rows.length), 168);
    if (fs < 24) continue;
    if (best && fs < best.fs * 1.07) continue;
    best = { rows: rows, fs: fs };
  }
  if (!best) {
    const w100 = Math.max(1, measureStr(s, 100));
    best = { rows: [s], fs: Math.max(20, Math.min(maxW / (w100 / 100), maxH / 1.22, 168)) };
  }
  const fs = best.fs, lh = fs * 1.22;
  measCtx.font = fontOf(fs);
  const rows = [];
  let bw = 0;
  for (let r = 0; r < best.rows.length; r++) {
    const txt = best.rows[r], chars = [];
    let x = 0;
    for (let k = 0; k < txt.length; k++) {
      const c = txt[k], wch = measCtx.measureText(c).width;
      if (c !== ' ') chars.push({ c: c, x: x, w: wch });
      x += wch + fs * CFG.track;
    }
    const rw = Math.max(0, x - fs * CFG.track);
    rows.push({ chars: chars, w: rw, ly: (r + 0.5) * lh });
    if (rw > bw) bw = rw;
  }
  return { rows: rows, fs: fs, lh: lh, bw: Math.max(1, bw), bh: lh * rows.length };
}

function paintRows(g, lay, ox, oy) {
  g.font = fontOf(lay.fs);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (let r = 0; r < lay.rows.length; r++) {
    const row = lay.rows[r];
    for (let k = 0; k < row.chars.length; k++) g.fillText(row.chars[k].c, ox + row.chars[k].x, oy + row.ly);
  }
}

/* ══════════════════════════════ 预烘 ══════════════════════════════
   每句只做一次：清晰版（DPR）+ 若干模糊/发光/影子层 + 半分辨率墨迹掩码
   + 距离场（chamfer）+ 朝外法向。帧里只 drawImage / 查表，绝不每帧 filter。 */
const MS = 0.5;
const offCv = document.createElement('canvas');
const offCtx = offCv.getContext('2d', { willReadFrequently: true });

function tintLayer(lay, bw, bh, pad, blurPx, color) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(bw));
  c.height = Math.max(2, Math.round(bh));
  const g = c.getContext('2d');
  if (blurPx > 0) g.filter = 'blur(' + (Math.round(blurPx * 10) / 10) + 'px)';
  g.fillStyle = color;
  paintRows(g, lay, pad, pad);
  return c;
}

/* 两遍 chamfer 距离变换（单位：掩码像素；除 MS 得 CSS 像素） */
function chamfer(mask, mw, mh) {
  const d = new Float32Array(mw * mh);
  const BIG = 1e5;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : BIG;
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) { const t = d[i - 1] + 1; if (t < v) v = t; }
      if (y > 0) {
        const up = i - mw;
        let t = d[up] + 1; if (t < v) v = t;
        if (x > 0) { t = d[up - 1] + 1.4142; if (t < v) v = t; }
        if (x < mw - 1) { t = d[up + 1] + 1.4142; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  for (let y = mh - 1; y >= 0; y--) {
    const row = y * mw;
    for (let x = mw - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < mw - 1) { const t = d[i + 1] + 1; if (t < v) v = t; }
      if (y < mh - 1) {
        const dn = i + mw;
        let t = d[dn] + 1; if (t < v) v = t;
        if (x < mw - 1) { t = d[dn + 1] + 1.4142; if (t < v) v = t; }
        if (x > 0) { t = d[dn - 1] + 1.4142; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  return d;
}

/* o: { padR, padPx, blur:[px], blurColor, glow:px, glowColor, shadow:px, shadowColor,
        mask:bool, field:bool, normals:bool, cap:float } */
function bake(text, o) {
  o = o || {};
  let lay = null;
  try { lay = layout(text); } catch (_) { lay = null; }
  if (!lay) return null;
  const pad = Math.round(lay.fs * (o.padR || 0.30)) + (o.padPx === undefined ? 16 : o.padPx);
  const bw = Math.ceil(lay.bw) + pad * 2;
  const bh = Math.ceil(lay.bh) + pad * 2;
  if (bw < 8 || bh < 8) return null;
  const out = { lay: lay, bw: bw, bh: bh, pad: pad, gx: VX - bw / 2, gy: VY - bh / 2, text: lay.rows.map((r) => r.chars.map((c) => c.c).join('')).join('') };

  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(bw * DPR));
  c.height = Math.max(2, Math.round(bh * DPR));
  const g = c.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#fff';
  paintRows(g, lay, pad, pad);
  out.crisp = c;

  const bl = o.blur || [], soft = [];
  for (let i = 0; i < bl.length; i++) soft.push(tintLayer(lay, bw, bh, pad, bl[i], o.blurColor || '#fff'));
  out.soft = soft;
  if (o.glow) out.glow = tintLayer(lay, bw, bh, pad, o.glow, o.glowColor || '#fff');
  if (o.shadow) out.shadow = tintLayer(lay, bw, bh, pad, o.shadow, o.shadowColor || 'rgba(0,0,0,1)');

  if (o.mask) {
    const mw = Math.max(2, Math.round(bw * MS)), mh = Math.max(2, Math.round(bh * MS));
    offCv.width = mw; offCv.height = mh;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.clearRect(0, 0, mw, mh);
    offCtx.setTransform(MS, 0, 0, MS, 0, 0);
    offCtx.fillStyle = '#fff';
    paintRows(offCtx, lay, pad, pad);
    const d = offCtx.getImageData(0, 0, mw, mh).data;
    const mask = new Uint8Array(mw * mh);
    for (let i = 0, p = 3; i < mask.length; i++, p += 4) if (d[p] > 110) mask[i] = 1;
    out.mask = mask; out.mw = mw; out.mh = mh; out.mox = out.gx; out.moy = out.gy;
    if (o.field) {
      const df = chamfer(mask, mw, mh);
      const cap = o.cap || 80;
      for (let i = 0; i < df.length; i++) if (df[i] > cap) df[i] = cap;
      out.df = df;
    }
    /* 笔画**内部**的距离场（到笔画外沿的距离）：脊线 = 中心线，值 = 半边宽 */
    if (o.inner) {
      const inv = new Uint8Array(mask.length);
      for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
      const dfi = chamfer(inv, mw, mh);
      const capI = o.capInner || 40;
      for (let i = 0; i < dfi.length; i++) if (dfi[i] > capI) dfi[i] = capI;
      out.dfi = dfi;
    }
    /* 朝外方向场：把掩码糊一下取负梯度（墨迹内外都有定义，粗笔画中间也不会退化） */
    if (o.dir) {
      const dc = document.createElement('canvas');
      dc.width = mw; dc.height = mh;
      const dg = dc.getContext('2d');
      const img = dg.createImageData(mw, mh);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
      }
      dg.putImageData(img, 0, 0);
      const bc = document.createElement('canvas');
      bc.width = mw; bc.height = mh;
      const bg2 = bc.getContext('2d');
      bg2.filter = 'blur(' + (o.dir | 0) + 'px)';
      bg2.drawImage(dc, 0, 0);
      const pd = bg2.getImageData(0, 0, mw, mh).data;
      const dx = new Float32Array(mw * mh), dy = new Float32Array(mw * mh);
      for (let y = 1; y < mh - 1; y++) {
        for (let x = 1; x < mw - 1; x++) {
          const i = y * mw + x;
          const ax = pd[(i + 1) * 4 + 3] - pd[(i - 1) * 4 + 3];
          const ay = pd[(i + mw) * 4 + 3] - pd[(i - mw) * 4 + 3];
          const m = Math.sqrt(ax * ax + ay * ay);
          if (m > 1e-4) { dx[i] = -ax / m; dy[i] = -ay / m; }
        }
      }
      out.dx = dx; out.dy = dy;
    }
  }
  return out;
}

/* 双线性取样判据：掩码/距离场（返回 CSS 像素；框外返回 -1） */
function sampleField(g, arr, sx, sy) {
  const fx = (sx - g.mox) * MS - 0.5, fy = (sy - g.moy) * MS - 0.5;
  if (!arr || fx < 0 || fy < 0 || fx > g.mw - 1.001 || fy > g.mh - 1.001) return -1;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0;
  const o = j0 * g.mw + i0, mw = g.mw;
  const a = arr[o], b = arr[o + 1], c = arr[o + mw], d = arr[o + mw + 1];
  const t0 = a + (b - a) * tx, t1 = c + (d - c) * tx;
  return t0 + (t1 - t0) * ty;
}
function inkAt(g, sx, sy) {
  if (!g || !g.mask) return 0;
  const i = ((sy - g.moy) * MS) | 0, j = ((sx - g.mox) * MS) | 0;
  if (i < 0 || j < 0 || i >= g.mh || j >= g.mw) return 0;
  return g.mask[i * g.mw + j];
}

/* ══════════════════════════════ 时钟 / 状态 ══════════════════════════════ */
let lines = [];
let curIdx = -1, brewIdx = -1, lastT = -1;
let glyph = null, prep = null, prepIdx = -1;
let reveal = 0, needRebake = false, dirty = true;
let clockT = 0, clockAt = 0, playing = false;
let vT = 0, beat = 0, bass = 0;
let frames = 0, jsMs = 0, errMsg = '';
let readySent = false;
const now = () => clockT + (playing ? (performance.now() - clockAt) / 1000 : 0);

/* ① 空歌词 ② seek 重建 ③ 句首切换（显示与酝酿分离）
   —— 暂停时 vT 完全不推进：动画不许靠 performance.now() 偷跑 */
function timing(T) {
  if (!lines.length) return;
  if (T < lastT - 0.6) {
    curIdx = -1; brewIdx = -1; prep = null; prepIdx = -1; glyph = null; reveal = 0;
    if (S.onSeek) S.onSeek();
    dirty = true;
  }
  lastT = T;
  let ci = curIdx;
  while (ci + 1 < lines.length && T >= lines[ci + 1].t) ci++;
  if (ci !== curIdx) {
    curIdx = ci; brewIdx = -1;
    glyph = ci >= 0 ? ((prep && prepIdx === ci) ? prep : safeBake(lines[ci].text)) : null;
    reveal = 0; prep = null; prepIdx = -1;
    if (S.onLine) S.onLine(ci, glyph);
    hint.style.opacity = ci >= 0 ? '0' : '1';
    dirty = true;
  }
  const nx = curIdx + 1;
  if (nx < lines.length && brewIdx !== nx) {
    const gap = lines[nx].t - (curIdx >= 0 ? lines[curIdx].t : lines[nx].t - 4);
    const lead = Math.min(1.7, Math.max(0.55, gap * 0.62));
    if (T >= lines[nx].t - lead) { brewIdx = nx; prep = safeBake(lines[nx].text); prepIdx = nx; }
  }
}

function safeBake(text) {
  try { return S.bake ? S.bake(text) : null; }
  catch (e) { errMsg = 'bake: ' + (e && e.message ? e.message : e); try { console.error(errMsg); } catch (_) {} return null; }
}

/* ══════════════════════════════ 尺寸 ══════════════════════════════ */
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(2, window.innerWidth);
  H = Math.max(2, window.innerHeight);
  MN = Math.min(W, H);
  VX = W / 2;
  VY = H * CFG.vy;
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (S.onResize) S.onResize();
  needRebake = true;
  dirty = true;
}

let rzTimer = 0;
addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(resize, 140);
});

function rebakeNow() {
  needRebake = false;
  prep = null; prepIdx = -1;
  if (curIdx >= 0 && lines[curIdx]) {
    glyph = safeBake(lines[curIdx].text);
    reveal = 1;
    if (S.onLine) S.onLine(curIdx, glyph);
  } else {
    glyph = null;
    if (S.onEmpty) S.onEmpty();
  }
  dirty = true;
}

/* ══════════════════════════════ 主循环 ══════════════════════════════ */
let last = performance.now(), raf = 0;

function frame(ms) {
  const js0 = performance.now();
  const dt = Math.min(0.05, Math.max(0, (ms - last) / 1000));
  last = ms;
  frames++;
  if (playing) {
    vT += dt;
    beat *= Math.exp(-dt * 3.0);
    bass *= Math.exp(-dt * 2.0);
    if (reveal < 1) reveal = Math.min(1, reveal + dt / 0.45);
    if (S.step) { try { S.step(dt); } catch (e) { errMsg = 'step: ' + (e && e.message ? e.message : e); try { console.error(errMsg); } catch (_) {} } }
  }
  try { timing(now()); } catch (e) { errMsg = 'timing: ' + (e && e.message ? e.message : e); try { console.error(errMsg); } catch (_) {} }
  if (needRebake) rebakeNow();
  /* 暂停时不重画：像素逐字节不变（冻结纪律的最硬保证） */
  if (playing || dirty) {
    try { if (S.draw) S.draw(dt); } catch (e) { errMsg = 'draw: ' + (e && e.message ? e.message : e); try { console.error(errMsg); } catch (_) {} }
    dirty = false;
  }
  if (!readySent) {
    readySent = true;
    try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (_) {}
  }
  jsMs = performance.now() - js0;
  raf = requestAnimationFrame(frame);
}

/* ══════════════════════════════ 协议 ══════════════════════════════ */
const ping = () => { try { parent.postMessage({ __c100: 1, type: 'activity' }, '*'); } catch (_) {} };
addEventListener('pointermove', ping, { passive: true });
addEventListener('pointerdown', ping, { passive: true });
addEventListener('wheel', ping, { passive: true });
addEventListener('keydown', ping);
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    try { parent.postMessage({ __c100: 1, type: 'key', payload: { key: 'Space' } }, '*'); } catch (_) {}
  }
}, true);

addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__c100 !== 1) return;
  if (d.type === 'init') {
    const p = d.payload || {};
    lines = (p.lines || []).slice().sort((a, b) => a.t - b.t);
    curIdx = -1; brewIdx = -1; lastT = -1;
    prep = null; prepIdx = -1; glyph = null; reveal = 0;
    vT = 0; beat = 0; bass = 0;
    clockT = 0; clockAt = performance.now();
    if (p.accent && p.accent.length >= 3) ACC = [p.accent[0] | 0, p.accent[1] | 0, p.accent[2] | 0];
    if (S.reset) S.reset();
    if (S.onAccent) S.onAccent();
    if (!lines.length) { if (S.onEmpty) S.onEmpty(); }
    hint.textContent = lines.length ? '等待第一句…' : '这首没有歌词';
    hint.style.opacity = lines.length ? '1' : '0.45';
    dirty = true;
  } else if (d.type === 'tick') {
    clockT = d.payload.time;
    clockAt = performance.now();
    playing = !!d.payload.playing;
  } else if (d.type === 'beat') {
    beat = Math.min(1.0, beat + 0.30 + (d.payload.level || 0) * 0.5);
  } else if (d.type === 'live') {
    const lv = d.payload || {};
    if (typeof lv.bass === 'number') bass = Math.max(bass, Math.min(1, lv.bass));
    if (typeof lv.level === 'number') beat = Math.max(beat, Math.min(0.8, lv.level * 0.8));
  }
});
addEventListener('pagehide', () => { cancelAnimationFrame(raf); });

/* ══════════════════════════════ 自查钩子 ══════════════════════════════ */
window.__stage = () => {
  const st = {
    lines: lines.length,
    idx: curIdx,
    t: +now().toFixed(2),
    playing: playing,
    frames: frames,
    js: +jsMs.toFixed(2),
    err: errMsg,
    text: (curIdx >= 0 && lines[curIdx]) ? lines[curIdx].text : '',
    glyph: !!glyph,
    rm: RM,
    vT: +vT.toFixed(2)
  };
  if (S.extra) { try { S.extra(st); } catch (_) {} }
  return st;
};

/* ══════════════════════════════ 启动 ══════════════════════════════ */
function boot() {
  hint.textContent = '等待第一句…';
  if (S.onAccent) S.onAccent();
  resize();
  if (S.reset) S.reset();
  raf = requestAnimationFrame(frame);
}
