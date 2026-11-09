/**
 * dj.js —— 音乐实验室「DJ 台」的 UI 层（ESM）
 *
 * 由 app.js 动态 import（老式脚本里 `await import('./lab/dj.js')`）。
 * 音频全在 dj-engine.js；这里只负责 DOM、单 rAF 循环、键盘、曲库。
 *
 * 约定：
 *   · 所有 canvas 按 devicePixelRatio 缩放（否则 4K 屏上糊）
 *   · 只有一个 requestAnimationFrame 循环（不要多个各画各的）
 *   · 数字全用等宽 + tabular-nums；没数据就写 —，不编
 */
import { createEngine, fmtTime, clamp } from './dj-engine.js';

const TAU = Math.PI * 2;

/* ================================================================== *
 * 样式：index.html 只许动 #view-lab 内部，所以 CSS 由模块自己挂
 * ================================================================== */
function ensureCss() {
  if (document.querySelector('link[data-djx]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./dj.css', import.meta.url).href;
  l.setAttribute('data-djx', '1');
  document.head.appendChild(l);
}

/* ================================================================== *
 * 状态
 * ================================================================== */
let E = null;
let mounted = false;
let active = false;
let raf = 0;
let lastTs = 0;

const S = {
  tab: 'dj',
  master: 'A',
  lib: [],
  libByKey: new Map(),
  filter: '',
  libSource: 'queue',
  pfl: { A: false, B: false },
  fx: {
    A: { kind: 'off', wet: 0.35, param: 0.5 },
    B: { kind: 'off', wet: 0.35, param: 0.5 },
  },
  ctl: {
    A: { trim: 0.5, high: 0.5, mid: 0.5, low: 0.5, filter: 0.5, chan: 0.85 },
    B: { trim: 0.5, high: 0.5, mid: 0.5, low: 0.5, filter: 0.5, chan: 0.85 },
  },
  pitchPos: { A: 0.5, B: 0.5 },
  cross: 0.5,
  crossCurve: 'power',
  masterVol: 0.8,
  cueMix: 0,
  autoloaded: false,
};

const D = {};   // 每台 deck 的 DOM 引用
const CV = {};  // 每台 deck 的 canvas 缓存

const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ================================================================== *
 * 每台 deck 的 DOM
 * ================================================================== */
function cacheDom() {
  for (const k of ['A', 'B']) {
    const root = document.getElementById('djx-deck-' + k);
    if (!root) continue;
    D[k] = {
      root,
      el: (n) => q('[data-el="' + n + '"]', root),
      title: q('[data-el="title"]', root),
      artist: q('[data-el="artist"]', root),
      state: q('[data-el="state"]', root),
      bpm: q('[data-el="bpm"]', root),
      rate: q('[data-el="rate"]', root),
      tcur: q('[data-el="tcur"]', root),
      trem: q('[data-el="trem"]', root),
      pitchval: q('[data-el="pitchval"]', root),
      loopnow: q('[data-el="loopnow"]', root),
      fxval: q('[data-el="fxpval"]', root),
      over: q('[data-el="over"]', root),
      wave: q('[data-el="wave"]', root),
      platter: q('[data-el="platter"]', root),
      cover: q('[data-el="cover"]', root),
      ptime: q('[data-el="ptime"]', root),
      play: q('[data-act="play"]', root),
      cue: q('[data-act="cue"]', root),
      sync: q('[data-act="sync"]', root),
      master: q('[data-act="master"]', root),
      keylock: q('[data-act="keylock"]', root),
      load: q('[data-act="load"]', root),
      hotcues: qa('[data-hc]', root),
      loopToggle: q('[data-act="loop-toggle"]', root),
      ranges: qa('[data-range]', root),
    };
    CV[k] = { over: null, overW: 0, overH: 0, dpr: 0 };
  }
  D.mix = {
    root: document.getElementById('djx-mix'),
    cross: q('[data-fader="cross"]'),
    master: q('[data-fader="master"]'),
    curve: q('[data-act="curve"]'),
    masterval: q('[data-el="masterval"]'),
  };
  D.lib = {
    root: document.getElementById('djx-lib-wrap'),
    body: q('#djx-lib tbody'),
    table: q('#djx-lib'),
    search: q('#djx-search'),
    file: q('#djx-file'),
    count: q('[data-el="libcount"]'),
    empty: q('[data-el="libempty"]'),
  };
}

/* ================================================================== *
 * 旋钮 / 推子
 * ================================================================== */
const KNOB_WIDTH_PX = 140;   // 上下拖 140px = 满量程

function decorateKnob(el) {
  if (q('.djx-knob__ticks', el)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'djx-knob__ticks');
  svg.setAttribute('viewBox', '0 0 32 32');
  const cx = 16, cy = 16;
  for (let i = 0; i <= 10; i++) {
    const a = (135 + i * 27) * Math.PI / 180;
    const r1 = 14.2, r2 = i === 5 ? 9.6 : 10.9;
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', (cx + Math.cos(a) * r1).toFixed(2));
    ln.setAttribute('y1', (cy + Math.sin(a) * r1).toFixed(2));
    ln.setAttribute('x2', (cx + Math.cos(a) * r2).toFixed(2));
    ln.setAttribute('y2', (cy + Math.sin(a) * r2).toFixed(2));
    if (i === 5) ln.setAttribute('class', 'mid');
    svg.appendChild(ln);
  }
  el.prepend(svg);
}

function bindKnob(el, get, set, def) {
  decorateKnob(el);
  const paint = () => {
    const v = get();
    el.style.setProperty('--rot', ((v * 270 - 135).toFixed(1)) + 'deg');
  };
  let drag = false, y0 = 0, v0 = 0;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = true; y0 = e.clientY; v0 = get();
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    set(clamp(v0 + (y0 - e.clientY) / KNOB_WIDTH_PX, 0, 1));
    paint();
  });
  const end = () => { if (!drag) return; drag = false; el.classList.remove('is-drag'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(def); paint(); });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(clamp(get() + (e.deltaY < 0 ? 0.02 : -0.02), 0, 1));
    paint();
  }, { passive: false });
  el.paintKnob = paint;
  paint();
}

/** 竖向推子：pos 0..1（下→上），带双击回中 */
function bindVFader(el, get, set, def, trackSel) {
  const paint = () => {
    const v = get();
    el.style.setProperty('--p', v.toFixed(4));
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  const track = () => el.querySelector(trackSel || '.djx-fader__track') || el;
  const at = (e) => {
    const r = track().getBoundingClientRect();
    return clamp((r.bottom - e.clientY) / (r.height || 1), 0, 1);
  };
  let drag = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = true;
    el.setPointerCapture(e.pointerId);
    set(at(e)); paint();
  });
  el.addEventListener('pointermove', (e) => { if (!drag) return; set(at(e)); paint(); });
  const end = () => { drag = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(def); paint(); });
  el.paintFader = paint;
  paint();
}

function bindHFader(el, get, set, def) {
  const paint = () => {
    const v = get();
    el.style.setProperty('--p', v.toFixed(4));
    el.setAttribute('aria-valuenow', String(Math.round(v * 200 - 100)));
  };
  const at = (e) => {
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
  };
  let drag = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = true;
    el.setPointerCapture(e.pointerId);
    set(at(e)); paint();
  });
  el.addEventListener('pointermove', (e) => { if (!drag) return; set(at(e)); paint(); });
  const end = () => { drag = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(def); paint(); });
  el.paintH = paint;
  paint();
}

function bindMini(el, get, set) {
  const paint = () => el.style.setProperty('--p', get().toFixed(4));
  const at = (e) => {
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
  };
  let drag = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); drag = true;
    el.setPointerCapture(e.pointerId); set(at(e)); paint();
  });
  el.addEventListener('pointermove', (e) => { if (!drag) return; set(at(e)); paint(); });
  const end = () => { drag = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.paintMini = paint;
  paint();
}

/* ================================================================== *
 * 把控制量发到音频节点
 * ================================================================== */
function applyDeck(k) {
  const d = E.decks[k], c = S.ctl[k];
  if (!d || !d.nodes) return;
  d.setTrim(c.trim);
  d.setEq('high', c.high);
  d.setEq('mid', c.mid);
  d.setEq('low', c.low);
  d.setFilter(c.filter);
  d.setChan(c.chan);
  d.setPfl(S.pfl[k]);
  const f = S.fx[k];
  d.setFx(f.kind, f.wet, f.param);
}

function applyMaster() {
  if (!E || !E.ctx) return;
  E.setMaster(S.masterVol);
  E.setCueMix(S.cueMix);
  E.setCrossCurve(S.crossCurve);
  E.setCross(S.cross * 2 - 1);
}

/** 值 → 旋钮 dB 文案（旋钮上不写小数，读数区才写） */
function deckStatus(d) {
  if (!d) return '未载入';
  if (d.loading) return d.status;
  if (d.err) return d.err;
  if (d.scratching) return Math.abs(d.scrRate) < 0.02 ? '搓碟 · 停转' : (d.scrRate > 0 ? '搓碟 · 正转' : '搓碟 · 倒转');
  if (d.playing) return d.bending ? 'bend' : '播放中';
  if (d.buf) return '暂停';
  return '未载入';
}

/* ================================================================== *
 * 波形
 * ================================================================== */
const WAVE = {
  played: '#17171a',
  unplayed: '#cdc9c2',
  beat: '#ddd9d2',
  bar: '#b9b4ac',
  center: '#f0eee9',
  accent: 'oklch(62% .22 12)',
};

function fitCanvas(cv, cssH) {
  const w = cv.clientWidth || 320;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const h = cssH || cv.clientHeight || 80;
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h, dpr };
}

/** 拍网格：画在波形之上，否则已播的黑块会把拍线整个盖掉 */
function drawBeats(g, d, w, h, t0, span) {
  if (!(d.bpmBase > 0)) return;
  const bd = 60 / d.bpmBase;
  const k0 = Math.floor((t0 - d.firstBeat) / bd) - 1;
  const k1 = Math.ceil((t0 + span - d.firstBeat) / bd) + 1;
  for (let k = k0; k <= k1; k++) {
    const t = d.firstBeat + k * bd;
    if (t < 0 || t > d.dur) continue;
    const x = Math.round(((t - t0) / span) * w) + 0.5;
    if (x < 0 || x > w) continue;
    const isBar = ((k % 4) + 4) % 4 === 0;
    g.fillStyle = isBar ? WAVE.bar : WAVE.beat;
    g.fillRect(x, isBar ? 0 : h * 0.12, 1, isBar ? h : h * 0.76);
  }
}
/** 细节波形：播放头居中；靠近曲首/曲尾时窗口贴边，避免半边空白 */
function drawDetail(cv, d) {
  const { g, w, h } = fitCanvas(cv, 84);
  const mid = h / 2;
  g.fillStyle = WAVE.center;
  g.fillRect(0, mid, w, 1);
  if (!d || !d.buf || !d.peaks) return;

  const pos = d.audioPos();
  const span = 8;
  const half = span / 2;
  const t0 = d.dur <= span ? 0 : clamp(pos - half, 0, d.dur - span);
  const pps = d.peaks.length / d.dur;
  const px = clamp(((pos - t0) / span) * w, 0, w);

  /* loop 区间淡墨底 */
  if (d.loop.on && d.loop.b > d.loop.a) {
    const x1 = ((d.loop.a - t0) / span) * w;
    const x2 = ((d.loop.b - t0) / span) * w;
    if (x2 > 0 && x1 < w) {
      g.fillStyle = 'rgba(23,23,26,.10)';
      g.fillRect(Math.max(0, x1), 0, Math.min(w, x2) - Math.max(0, x1), h);
      g.fillStyle = 'rgba(23,23,26,.35)';
      if (x1 > 0 && x1 < w) g.fillRect(Math.round(x1), 0, 1, h);
      if (x2 > 0 && x2 < w) g.fillRect(Math.round(x2), 0, 1, h);
    }
  }


  drawBeats(g, d, w, h, t0, span);

  /* 波形柱：一条 Path2D 填两次（未播 / 已播），避免 per-pixel 多次 fill */
  const path = new Path2D();
  let any = false;
  for (let x = 0; x < w; x++) {
    const t = t0 + (x / w) * span;
    if (t < 0 || t > d.dur) continue;
    const i = Math.floor(t * pps);
    if (i < 0 || i >= d.peaks.length) continue;
    const bh = Math.max(1, d.peaks[i] * (h * 0.86));
    path.rect(x, mid - bh / 2, 1, bh);
    any = true;
  }
  if (any) {
    g.fillStyle = WAVE.unplayed;
    g.fill(path);
    /* 已播部分（播放头左边）上墨 */
    if (px > 0) {
      g.save();
      g.beginPath(); g.rect(0, 0, px, h); g.clip();
      g.fillStyle = WAVE.played;
      g.fill(path);
      g.restore();
    }
  }


  /* cue 三角（白三角 + 墨描边：在已播的墨底上也看得见） */
  if (d.cue > 0 || d.buf) {
    const x = ((d.cue - t0) / span) * w;
    if (x > -8 && x < w + 8) {
      g.beginPath();
      g.moveTo(x, 2); g.lineTo(x + 5, 2); g.lineTo(x, 9); g.closePath();
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = WAVE.played; g.lineWidth = 1; g.stroke();
    }
  }

  /* 热键：底部小刻度 + 编号 */
  g.font = '7px ui-monospace, monospace';
  d.hotcues.forEach((t, i) => {
    if (t == null) return;
    const x = ((t - t0) / span) * w;
    if (x < -6 || x > w + 6) return;
    g.fillStyle = WAVE.accent;
    g.fillRect(Math.round(x), h - 7, 1, 7);
    g.fillText(String(i + 1), Math.round(x) + 2, h - 1);
  });

  /* 居中播放头（靠边时贴边） */
  g.fillStyle = WAVE.played;
  g.fillRect(Math.round(px), 0, 1, h);
}

/** 概览波形：整首缩成一条。离屏缓存灰/墨两份，每帧只 blit + 画标记 */
function buildOverviewCache(cv, d) {
  const w = cv.clientWidth || 320;
  const h = 26;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = CV[d.key];
  if (!c) return;
  const mk = () => {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * dpr));
    off.height = Math.max(1, Math.round(h * dpr));
    return off;
  };
  const gray = c.overGray || mk();
  const ink = c.overInk || mk();
  for (const [cv2, color] of [[gray, WAVE.unplayed], [ink, WAVE.played]]) {
    if (cv2.width !== Math.round(w * dpr) || cv2.height !== Math.round(h * dpr)) {
      cv2.width = Math.max(1, Math.round(w * dpr));
      cv2.height = Math.max(1, Math.round(h * dpr));
    }
    const g = cv2.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!d.peaks) continue;
    const n = d.peaks.length;
    const path = new Path2D();
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * n);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
      let m = 0;
      for (let i = i0; i < i1 && i < n; i++) if (d.peaks[i] > m) m = d.peaks[i];
      const bh = Math.max(0.8, m * (h * 0.8));
      path.rect(x, h / 2 - bh / 2, 1, bh);
    }
    g.fillStyle = color;
    g.fill(path);
  }
  c.overGray = gray; c.overInk = ink; c.overW = w; c.overH = h;
}
function CV_cur(d) { return CV[d.key]; }

function drawOverview(cv, d) {
  const w = cv.clientWidth || 320;
  const h = 26;
  const cache = CV[d.key];
  if (!cache || !cache.overGray || cache.overW !== w) buildOverviewCache(cv, d);
  const { g } = fitCanvas(cv, h);
  const c = CV[d.key];
  if (!c || !c.overGray) return;
  g.drawImage(c.overGray, 0, 0, w, h);
  if (!d.buf || !d.peaks) return;

  const pos = d.audioPos();
  const px = clamp(pos / d.dur, 0, 1) * w;

  /* 已播部分用墨版盖上去 */
  if (px > 0) {
    g.save();
    g.beginPath(); g.rect(0, 0, px, h); g.clip();
    g.drawImage(c.overInk, 0, 0, w, h);
    g.restore();
  }

  /* loop 区间 */
  if (d.loop.on && d.loop.b > d.loop.a) {
    const x1 = (d.loop.a / d.dur) * w, x2 = (d.loop.b / d.dur) * w;
    g.fillStyle = 'rgba(23,23,26,.10)';
    g.fillRect(x1, 0, Math.max(1, x2 - x1), h);
  }

  /* cue 三角 */
  if (d.cue > 0) {
    const x = (d.cue / d.dur) * w;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath();
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = WAVE.played; g.lineWidth = 1; g.stroke();
  }

  /* 热键刻度 */
  g.fillStyle = WAVE.accent;
  d.hotcues.forEach((t, i) => {
    if (t == null) return;
    const x = Math.round((t / d.dur) * w);
    g.fillRect(x, 0, 1, 5 + (i % 3));
  });

  /* 播放头 */
  g.fillStyle = WAVE.played;
  g.fillRect(Math.round(px), 0, 1, h);
}

/* ================================================================== *
 * 电平表
 * ================================================================== */
function drawMeter(cv, l, r, hl, hr) {
  const w = 18, h = 132;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#f4f2ee';
  g.fillRect(0, 0, w, h);
  /* 刻度：-6 / -12 / -24 dB */
  g.fillStyle = '#e8e5df';
  for (const db of [-6, -12, -24]) {
    const y = Math.round(h * (1 - (db + 60) / 60));
    g.fillRect(0, y, w, 1);
  }
  const barW = (w - 5) / 2;
  const posOf = (a) => {
    if (!(a > 0)) return h;
    const db = 20 * Math.log10(a);
    return h * (1 - clamp((db + 60) / 60, 0, 1));
  };
  const segH = 3, segGap = 2, step = segH + segGap;
  const clip = (l >= 0.995 || r >= 0.995);
  for (const [i, a, hold] of [[0, l, hl], [1, r, hr]]) {
    const x = 1 + i * (barW + 3);
    const y = posOf(a);
    g.fillStyle = clip ? WAVE.accent : '#26262b';
    /* 分段亮起，像硬件上的 LED 表 */
    for (let yy = h - segH; yy >= y - segH; yy -= step) {
      const top = Math.max(y, yy);
      const height = yy + segH - top;
      if (height <= 0) break;
      g.fillRect(x, top, barW, height);
    }
    const hy = posOf(hold);
    if (hold > 0.0005) { g.fillStyle = 'rgba(23,23,26,.45)'; g.fillRect(x, hy, barW, 1); }
  }
}

/* ================================================================== *
 * 曲库
 * ================================================================== */
/* ================================================================== *
 * 封面
 *   · 网易云 / QQ / 搜索：服务端统一给了 cover（http 直链），走 API.img 代理
 *   · 本地文件：自己从 ID3v2(APIC) / FLAC(PICTURE) / MP4(covr) 里把内嵌图抠出来
 *   · 什么都拿不到 → 中性占位 SVG（64×64，所以「有没有真封面」是可测的）
 * ================================================================== */
const COVER_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f4f2ee"/>'
  + '<path d="M32 20a12 12 0 100 24 12 12 0 000-24zm0 4.5a7.5 7.5 0 110 15 7.5 7.5 0 010-15z" fill="#cdc9c2"/>'
  + '<circle cx="32" cy="32" r="2.4" fill="#cdc9c2"/></svg>'
);

/** 把各种来源的封面字段收敛成一个能直接塞进 <img> 的地址 */
function coverUrlOf(t, size = 240) {
  if (!t) return '';
  const raw = t.coverUrl || t.cover;
  if (!raw) return '';
  if (/^(blob:|data:)/.test(raw)) return raw;
  const api = typeof API !== 'undefined' ? API : null;
  if (!api) return raw;
  /* 网易云封面有防盗链 + 支持 ?param= 缩图 → 必须走 /api/img 代理；
     其它源（QQ 的 y.gtimg.cn 等）本身就能直接 <img>，别多插一层代理和 param */
  const isNC = /(^|\/\/|\.)((p\d|m\d|g)?\.?music\.126\.net|music\.163\.com|126\.net)\//.test(raw);
  return isNC ? api.img(raw, size) : raw;
}

const _coverCache = new Map();   // key -> blob/data URL，避免重复解析同一个文件

const be32 = (u8, i) => ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
const syncsafe = (u8, i) => ((u8[i] & 0x7f) << 21) | ((u8[i + 1] & 0x7f) << 14) | ((u8[i + 2] & 0x7f) << 7) | (u8[i + 3] & 0x7f);
const ascii = (u8, i, n) => String.fromCharCode(...u8.subarray(i, i + n));

function blobUrlFor(u8, start, len, mime) {
  if (!(len > 64) || start + len > u8.length) return '';
  const type = mime && /^image\//.test(mime) ? mime : 'image/jpeg';
  return URL.createObjectURL(new Blob([u8.subarray(start, start + len)], { type }));
}

/** ID3v2：找第一个 APIC 帧 */
function coverFromId3(u8) {
  const ver = u8[3];
  const flags = u8[5];
  const end = Math.min(u8.length, 10 + syncsafe(u8, 6));
  let p = 10;
  if (flags & 0x40) {                       // 扩展头
    p += ver === 4 ? syncsafe(u8, p) : be32(u8, p) + 4;
  }
  while (p + 10 <= end) {
    const id = ascii(u8, p, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4 ? syncsafe(u8, p + 4) : be32(u8, p + 4);
    const body = p + 10;
    if (id === 'APIC' && size > 32) {
      let q2 = body + 1;                    // 编码字节
      while (q2 < end && u8[q2] !== 0) q2++; // mime（latin1，0 结尾）
      const mime = ascii(u8, body + 1, q2 - body - 1);
      q2 += 1 + 1;                          // 跳过 mime 的 0 + picture type
      const enc = u8[body];
      if (enc === 1 || enc === 2) {         // UTF-16 描述：两个 0 字节结尾
        while (q2 + 1 < end && !(u8[q2] === 0 && u8[q2 + 1] === 0)) q2++;
        q2 += 2;
      } else {
        while (q2 < end && u8[q2] !== 0) q2++;
        q2 += 1;
      }
      return blobUrlFor(u8, q2, body + size - q2, mime);
    }
    p = body + size;
    if (!(size > 0)) break;
  }
  return '';
}

/** FLAC：METADATA_BLOCK 里的 PICTURE(type 6) */
function coverFromFlac(u8) {
  let p = 4;
  while (p + 4 <= u8.length) {
    const type = u8[p] & 0x7f;
    const last = (u8[p] & 0x80) !== 0;
    const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
    if (type === 6) {
      const b = p + 4;
      const mimeLen = be32(u8, b + 4);
      const mime = ascii(u8, b + 8, mimeLen);
      let q2 = b + 8 + mimeLen;
      const descLen = be32(u8, q2);
      q2 += 4 + descLen + 16;               // 描述 + 宽高深色
      const dataLen = be32(u8, q2);
      return blobUrlFor(u8, q2 + 4, dataLen, mime);
    }
    p += 4 + len;
    if (last) break;
  }
  return '';
}

/** MP4/M4A：moov/udta/meta/ilst/covr（这里只做宽容扫描） */
function coverFromMp4(u8) {
  const find = (needle, from, to) => {
    const n = needle.length;
    for (let i = from; i + n <= to; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) if (u8[i + j] !== needle.charCodeAt(j)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };
  const covr = find('covr', 0, Math.min(u8.length, 3 << 20));
  if (covr < 0) return '';
  const data = find('data', covr + 4, Math.min(u8.length, covr + 96));
  if (data < 0) return '';
  const atomLen = be32(u8, data - 4);
  const start = data + 12;                  // 'data' + 4 字节版本/标志 + 4 字节 locale
  const len = Math.max(0, atomLen - 16);
  return blobUrlFor(u8, start, len, 'image/jpeg');
}

/** 从本地文件抠内嵌封面；读不出来返回 ''（UI 用占位块） */
async function coverFromFile(file) {
  if (!file) return '';
  const key = 'file:' + file.name + ':' + file.size;
  if (_coverCache.has(key)) return _coverCache.get(key);
  let url = '';
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) url = coverFromId3(head);
    else if (ascii(head, 0, 4) === 'fLaC') url = coverFromFlac(head);
    else if (ascii(head, 4, 4) === 'ftyp') url = coverFromMp4(head);
    if (!url) url = coverFromMp4(head) || coverFromId3(head) || coverFromFlac(head);
  } catch { url = ''; }
  _coverCache.set(key, url);
  return url;
}

/** 给一批本地曲目补封面（串行，加完就重画，封面到了再刷一次） */
async function attachLocalCovers(items) {
  let changed = false;
  for (const it of items) {
    if (!it || it.kind !== 'file' || it.cover || !it.file) continue;
    const url = await coverFromFile(it.file);
    if (url) { it.cover = url; changed = true; }
  }
  if (changed) libRender();
}

function entryFromTrack(t) {
  if (!t) return null;
  const kind = t.kind === 'file' ? 'file' : 'netease';
  const title = t.title || t.name || '(无标题)';
  const key = kind === 'file' ? 'file:' + title + ':' + (t.size || 0) : 'nc:' + t.id;
  const cached = safeLs('lizi.dj.meta.' + key);
  return {
    key, kind,
    id: t.id,
    file: t.file,
    size: t.size,
    title,
    artist: t.artist || t.artists || '',
    cover: t.coverUrl || t.cover || '',   // 原样存；渲染时再按来源决定要不要走代理
    bpm: cached && cached.bpm ? cached.bpm : 0,
    dur: cached && cached.dur ? cached.dur : 0,
  };
}

function safeLs(k) {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; }
}

function libAdd(items) {
  let added = 0;
  for (const it of items) {
    if (!it || !it.key) continue;
    const old = S.libByKey.get(it.key);
    if (old) {
      if (it.bpm) old.bpm = it.bpm;
      if (it.dur) old.dur = it.dur;
      if (it.cover && !old.cover) old.cover = it.cover;
      continue;
    }
    S.lib.push(it);
    S.libByKey.set(it.key, it);
    added++;
  }
  return added;
}

function libRender() {
  const { body, empty, count } = D.lib;
  if (!body) return;
  const f = S.filter.trim().toLowerCase();
  const rows = S.lib.filter((it) => !f
    || it.title.toLowerCase().includes(f)
    || (it.artist || '').toLowerCase().includes(f));
  const frag = document.createDocumentFragment();
  rows.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.dataset.key = it.key;
    tr.draggable = true;
    if ((E.decks.A.track && E.decks.A.track.key === it.key) || (E.decks.B.track && E.decks.B.track.key === it.key)) {
      tr.classList.add('is-loaded');
    }
    const mk = (cls, txt) => {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = txt;
      tr.appendChild(td);
      return td;
    };
    /* 小封面：没有就塞占位 SVG（也走 <img>，行高不跳、可断言） */
    const cov = document.createElement('td');
    cov.className = 'c-cov';
    const im = document.createElement('img');
    im.className = 'djx-thumb';
    im.alt = '';
    im.draggable = false;
    im.loading = 'lazy';
    const cu = coverUrlOf(it, 80);
    im.src = cu || COVER_PH;
    im.dataset.cover = cu ? '1' : '0';
    im.addEventListener('error', () => { im.src = COVER_PH; im.dataset.cover = '0'; });
    cov.appendChild(im);
    tr.appendChild(cov);

    mk('c-n', String(i + 1));
    const tt = mk('c-t', it.title);
    tt.title = it.title + (it.artist ? ' · ' + it.artist : '');
    mk('c-a', it.artist || '—');
    mk('c-bpm', it.bpm ? it.bpm.toFixed(1) : '—');
    mk('c-dur', it.dur ? fmtTime(it.dur) : '—');
    const op = mk('c-op', '');
    for (const k of ['A', 'B']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.load = k;
      b.textContent = k;
      b.title = '载入 ' + k + ' 台';
      op.appendChild(b);
    }
    frag.appendChild(tr);
  });
  body.textContent = '';
  body.appendChild(frag);
  if (count) count.textContent = rows.length + (f ? ' / ' + S.lib.length : '') + ' 首';
  if (empty) empty.hidden = S.lib.length > 0;
}

async function libFromQueue() {
  const Player_ = typeof Player !== 'undefined' ? Player : null;
  const q_ = (Player_ && Player_.state && Player_.state.queue) || [];
  if (!q_.length) { flash('播放器队列是空的：先去大厅点一张歌单'); return; }
  const items = q_.map(entryFromTrack).filter(Boolean);
  const n = libAdd(items);
  libRender();
  flash(n ? '从播放队列加入 ' + n + ' 首' : '队列里的歌都已在曲库里');
}

async function libFromSearch() {
  const api = typeof API !== 'undefined' ? API : null;
  if (!api) { flash('API 不可用'); return; }
  const kw = (D.lib.search.value || '').trim();
  if (!kw) { flash('先在搜索框里写点东西'); D.lib.search.focus(); return; }
  flash('搜索「' + kw + '」…');
  try {
    const r = await api.search(kw, 30);
    const items = (r.tracks || []).map(entryFromTrack).filter(Boolean);
    const n = libAdd(items);
    S.filter = '';
    D.lib.search.value = '';
    libRender();
    flash('搜到 ' + items.length + ' 首，新加 ' + n + ' 首');
  } catch (e) {
    flash('搜索失败：' + e.message);
  }
}

async function addLocalFiles(files) {
  const list = Array.from(files || []).filter((f) => {
    return /audio|\.(mp3|flac|wav|m4a|ogg|aac|opus|aiff|wma)$/i.test(f.type + ' ' + f.name);
  });
  if (!list.length) { flash('没识别到音频文件'); return; }
  const items = list.map((f) => entryFromTrack({
    kind: 'file', file: f, size: f.size,
    title: f.name.replace(/\.[^.]+$/, ''), artist: '本地文件',
  })).filter(Boolean);
  libAdd(items);
  libRender();
  flash('加入 ' + items.length + ' 个本地文件（载入时才解码测 BPM）');
  /* 内嵌封面要读文件头，异步补上（读不到就留占位块） */
  attachLocalCovers(items);
}

function flash(msg) {
  const sub = document.getElementById('lab-sub');
  if (sub) sub.textContent = msg;
}

/* ================================================================== *
 * 载入
 * ================================================================== */
async function loadInto(k, entry) {
  if (!entry) { flash('先选一首'); return false; }
  const d = E.decks[k];
  E.init();
  E.decks[k].ensure();
  applyDeck(k);
  /* 本地文件的封面可能还没解析过（异步补的），载入前再试一次 */
  if (entry.kind === 'file' && !entry.cover && entry.file) {
    try { entry.cover = await coverFromFile(entry.file) || ''; } catch { /* 占位块 */ }
  }
  const ok = await d.load({
    kind: entry.kind, id: entry.id, file: entry.file, size: entry.size,
    title: entry.title, artist: entry.artist, name: entry.title,
    cover: coverUrlOf(entry, 240),
  });
  if (ok) {
    /* BPM / 时长回写曲库 + 缓存 */
    entry.bpm = d.bpmBase;
    entry.dur = d.dur;
    libRender();
    buildOverviewCache(D[k].over, d);
    flash('A/B 装台：' + entry.title + (d.bpmBase ? ' · ' + d.bpmBase.toFixed(1) + ' BPM' : ' · BPM 未测出'));
  } else {
    flash(d.err || '载入失败');
  }
  return ok;
}

function deckFromTrack(t, pref) {
  /* 载入按钮：A 用播放器当前曲，B 用下一首 */
  const Player_ = typeof Player !== 'undefined' ? Player : null;
  const st = Player_ ? Player_.state : null;
  const queue = (st && st.queue) || [];
  if (!queue.length) { flash('播放器里还没有歌'); return; }
  const i = st.index >= 0 ? st.index : 0;
  const tr = pref === 'next' ? queue[(i + 1) % queue.length] : queue[i];
  const entry = entryFromTrack(tr);
  libAdd([entry]);
  libRender();
  return loadInto(t, entry);
}

/* ================================================================== *
 * 转盘（搓碟 / bend）
 * ================================================================== */
function bindPlatter(k) {
  const el = D[k].platter;
  const d = E.decks[k];
  let drag = false, angle0 = 0, lastAngle = 0, lastT = 0, acc = 0;
  let mode = 'idle';   // idle | bend | scratch
  let vel = 0;
  let lastMoveAt = 0;

  const angleAt = (e) => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  const norm = (x) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!d.buf) { flash('先载入一首'); return; }
    E.init(); E.resume();
    drag = true; mode = 'idle'; acc = 0; vel = 0;
    angle0 = lastAngle = angleAt(e);
    lastT = performance.now();
    D[k].lastMoveAt = lastT;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-scratch');
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const a = angleAt(e);
    const da = norm(a - lastAngle);
    const now = performance.now();
    const dt = Math.max(8, now - lastT) / 1000;
    lastAngle = a; lastT = now; lastMoveAt = now; D[k].lastMoveAt = now;
    acc += da;
    /* 角速度（圈/秒）→ 播放倍率：一圈 ≈ 1.8 秒素材 */
    const rps = (da / 360) / dt;
    vel = vel * 0.6 + (rps * 1.8) * 0.4;

    if (mode === 'idle') {
      if (Math.abs(acc) > 9) {
        mode = 'scratch';
        if (d.bending) d.bendEnd();
        d.scratchBegin();
      } else if (d.playing) {
        mode = 'bend';
        d.bendStart();
      }
    }
    if (mode === 'scratch') d.scratchSet(vel);
    else if (mode === 'bend') d.bendSet(clamp(vel, -0.35, 0.35));
  });

  const end = () => {
    if (!drag) return;
    drag = false;
    el.classList.remove('is-scratch');
    if (mode === 'scratch') d.scratchEnd();
    else if (mode === 'bend') d.bendEnd();
    mode = 'idle';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

/* ================================================================== *
 * FX
 * ================================================================== */
function bindFx(k) {
  const root = D[k].root;
  qa('[data-fx]', root).forEach((b) => {
    b.addEventListener('click', () => {
      S.fx[k].kind = b.dataset.fx;
      qa('[data-fx]', root).forEach((x) => x.classList.toggle('is-on', x === b));
      applyDeck(k);
      updateFxLabel(k);
    });
  });
  const knob = q('[data-knob="fxw"]', root);
  if (knob) {
    bindKnob(knob, () => S.fx[k].wet, (v) => { S.fx[k].wet = v; applyDeck(k); updateFxLabel(k); }, 0.35);
  }
  const mini = q('[data-fader="fxp"]', root);
  if (mini) {
    bindMini(mini, () => S.fx[k].param, (v) => { S.fx[k].param = v; applyDeck(k); updateFxLabel(k); });
  }
}

function updateFxLabel(k) {
  const d = D[k];
  if (!d || !d.fxval) return;
  const f = S.fx[k];
  if (f.kind === 'off') { d.fxval.textContent = '—'; return; }
  if (f.kind === 'reverb') d.fxval.textContent = 'TONE ' + Math.round(900 + f.param * 11000) + 'Hz';
  else d.fxval.textContent = 'TIME ' + Math.round((0.05 + f.param * 0.45) * 1000) + 'ms';
}

/* ================================================================== *
 * 键盘
 * ================================================================== */
function onKey(e) {
  if (!active) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const key = e.key;
  const shift = e.shiftKey;

  if (key === ' ') {
    e.preventDefault();
    const k = shift ? 'B' : 'A';
    E.decks[k].toggle();
    return;
  }
  if (key === 'c' || key === 'C') {
    e.preventDefault();
    E.decks[shift ? 'B' : 'A'].cuePress();
    return;
  }
  if (key === '\\') {
    e.preventDefault();
    setCross(0.5);
    return;
  }
  if (key === '[' || key === ']') {
    e.preventDefault();
    const k = key === '[' ? 'A' : 'B';
    toggleLoop(k);
    return;
  }
  if (/^[1-8]$/.test(key)) {
    e.preventDefault();
    const k = shift ? 'B' : 'A';
    hotcue(k, Number(key) - 1, shift);
  }
}

/* ================================================================== *
 * deck 控制
 * ================================================================== */
function hotcue(k, idx, isShift) {
  const d = E.decks[k];
  if (!d.buf) { flash('先载入一首'); return; }
  /* Shift+数字 = B 的热键；Shift+单击同一按钮 = 清除（与右键等价） */
  const cur = d.hotcues[idx];
  if (cur != null) {
    d.seek(cur);
    flash(k + ' 热键 ' + (idx + 1) + ' → ' + fmtTime(cur));
  } else {
    d.hotcues[idx] = d.audioPos();
    d.saveCues();
    flash(k + ' 热键 ' + (idx + 1) + ' 设在 ' + d.hotcues[idx].toFixed(2) + 's');
  }
  paintDeck(k);
}

function toggleLoop(k) {
  const d = E.decks[k];
  if (!d.buf) return;
  if (d.loop.b <= d.loop.a) {
    /* 没有区间就按 4 拍建一个 */
    const len = d.bpmBase > 0 ? 4 * 60 / d.bpmBase : 2;
    const start = d.bpmBase > 0 ? d.firstBeat + Math.floor((d.audioPos() - d.firstBeat) / (60 / d.bpmBase)) * (60 / d.bpmBase) : d.audioPos();
    d.loop = { on: true, a: clamp(start, 0, d.dur - 0.1), b: clamp(start + len, 0, d.dur) };
  } else {
    d.loop.on = !d.loop.on;
  }
  d.saveCues();
  if (d.playing) d.seek(d.loop.on ? d.loop.a : d.audioPos());
  paintDeck(k);
}

function setLoopBeats(k, beats) {
  const d = E.decks[k];
  if (!d.buf) return;
  const bd = d.bpmBase > 0 ? 60 / d.bpmBase : 0.5;
  const len = beatLen(d, beats, bd);
  /* 起点吸附到最近的拍 */
  let a = d.audioPos();
  if (d.bpmBase > 0) {
    const n = Math.round((a - d.firstBeat) / bd);
    a = d.firstBeat + n * bd;
  }
  d.loop = { on: true, a: clamp(a, 0, Math.max(0, d.dur - 0.05)), b: clamp(a + len, 0, d.dur) };
  d.saveCues();
  if (d.playing) d.seek(d.loop.a);
  paintDeck(k);
}

function beatLen(d, beats, bd) {
  return Math.max(0.03, beats * bd);
}

function beatJump(k, beats) {
  const d = E.decks[k];
  if (!d.buf) return;
  const bd = d.bpmBase > 0 ? 60 / d.bpmBase : 0.5;
  d.seek(d.audioPos() + beats * bd);
  if (d.loop.on) { /* 跳出 loop 就自动关 */ d.loop.on = false; d.saveCues(); }
  paintDeck(k);
}

function setPitchPos(k, pos) {
  const d = E.decks[k];
  S.pitchPos[k] = clamp(pos, 0, 1);
  const pct = (S.pitchPos[k] - 0.5) * 2 * d.range;
  d.setPitchPct(pct);
  if (D[k].pitchval) D[k].pitchval.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  const pf = q('[data-fader="pitch"]', D[k].root);
  if (pf) { pf.style.setProperty('--p', S.pitchPos[k].toFixed(4)); pf.setAttribute('aria-valuenow', String(Math.round(pct))); }
}

function setCross(pos) {
  S.cross = clamp(pos, 0, 1);
  E.setCross(S.cross * 2 - 1);
  if (D.mix.cross) D.mix.cross.paintH && D.mix.cross.paintH();
}

function setMasterVol(v) {
  S.masterVol = clamp(v, 0, 1);
  E.setMaster(S.masterVol);
  if (D.mix.masterval) {
    const db = 20 * Math.log10(Math.max(1e-4, Math.pow(S.masterVol, 1.4)));
    D.mix.masterval.textContent = (db <= -59.9 ? '-∞' : db.toFixed(1)) + ' dB';
  }
}

/* ================================================================== *
 * 按钮绑定
 * ================================================================== */
function bindDeckButtons(k) {
  const root = D[k].root;
  const d = E.decks[k];

  D[k].play.addEventListener('click', () => { E.init(); E.resume(); d.toggle(); paintDeck(k); });
  D[k].cue.addEventListener('click', () => { E.init(); E.resume(); d.cuePress(); paintDeck(k); });
  D[k].sync.addEventListener('click', () => {
    const other = E.decks[k === 'A' ? 'B' : 'A'];
    const master = S.master === k ? other : E.decks[S.master];
    d.syncTo(master);
    S.pitchPos[k] = (d.pitchPct / (2 * d.range)) + 0.5;
    syncRangeButtons(k);
    paintDeck(k);
    flash('SYNC ' + k + ' → ' + (master.bpmNow ? master.bpmNow.toFixed(2) : '—') + ' BPM');
  });
  D[k].master.addEventListener('click', () => {
    S.master = k;
    paintDeck('A'); paintDeck('B');
    flash(k + ' 是 master');
  });
  D[k].keylock.addEventListener('click', () => {
    d.setKeylock(!d.keylock);
    paintDeck(k);
  });
  D[k].load.addEventListener('click', () => deckFromTrack(k, k === 'B' ? 'next' : 'cur'));

  /* 速度推子 */
  const pf = q('[data-fader="pitch"]', root);
  if (pf) bindVFader(pf, () => S.pitchPos[k], (v) => setPitchPos(k, v), 0.5, '.djx-pitchf__track');

  D[k].hotcues.forEach((b) => {
    const idx = Number(b.dataset.hc) - 1;
    b.addEventListener('click', (e) => {
      /* Shift+单击已设的热键 = 清除（和右键等价） */
      if (e.shiftKey && d.hotcues[idx] != null) {
        d.hotcues[idx] = null;
        d.saveCues();
        paintDeck(k);
        flash(k + ' 热键 ' + (idx + 1) + ' 已清除');
        return;
      }
      hotcue(k, idx, e.shiftKey);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dk = E.decks[k];
      dk.hotcues[idx] = null;
      dk.saveCues();
      paintDeck(k);
      flash(k + ' 热键 ' + (idx + 1) + ' 已清除');
    });
  });

  qa('[data-range]', root).forEach((b) => {
    b.addEventListener('click', () => {
      d.setRange(Number(b.dataset.range));
      setPitchPos(k, S.pitchPos[k]);
      syncRangeButtons(k);
    });
  });

  qa('[data-act="loop-in"]', root).forEach((b) => b.addEventListener('click', () => {
    d.loop.a = d.audioPos();
    if (d.loop.b <= d.loop.a) d.loop.b = clamp(d.loop.a + (d.bpmBase ? 60 / d.bpmBase : 1), 0, d.dur);
    d.saveCues(); paintDeck(k);
  }));
  qa('[data-act="loop-out"]', root).forEach((b) => b.addEventListener('click', () => {
    const now = d.audioPos();
    if (now > d.loop.a + 0.05) { d.loop.b = now; d.loop.on = true; }
    else { d.loop.b = d.loop.a + (d.bpmBase ? 60 / d.bpmBase : 1); d.loop.on = true; }
    d.saveCues(); paintDeck(k);
  }));
  qa('[data-act="loop-toggle"]', root).forEach((b) => b.addEventListener('click', () => toggleLoop(k)));
  qa('[data-act="loop-half"]', root).forEach((b) => b.addEventListener('click', () => {
    if (d.loop.b > d.loop.a + 0.05) {
      const mid = (d.loop.a + d.loop.b) / 2;
      d.loop.a = mid - (d.loop.b - d.loop.a) / 4;
      d.loop.b = mid + (d.loop.b - d.loop.a) / 4;
      d.saveCues(); paintDeck(k);
    }
  }));
  qa('[data-act="loop-double"]', root).forEach((b) => b.addEventListener('click', () => {
    if (d.loop.b > d.loop.a + 0.05) {
      const len = d.loop.b - d.loop.a;
      d.loop.b = clamp(d.loop.a + len * 2, 0, d.dur);
      d.saveCues(); paintDeck(k);
    }
  }));
  qa('[data-beat]', root).forEach((b) => b.addEventListener('click', () => setLoopBeats(k, Number(b.dataset.beat))));
  qa('[data-jump]', root).forEach((b) => b.addEventListener('click', () => beatJump(k, Number(b.dataset.jump))));

  /* 概览波形点击 = seek */
  D[k].over.addEventListener('click', (e) => {
    if (!d.buf) return;
    const r = D[k].over.getBoundingClientRect();
    d.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * d.dur);
    paintDeck(k);
  });
  D[k].wave.addEventListener('click', (e) => {
    if (!d.buf) return;
    const r = D[k].wave.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    d.seek(d.audioPos() + (frac - 0.5) * 8);
    paintDeck(k);
  });

  /* 拖到 deck：曲库行 / 本地文件都往这儿扔。
     拖动过程中整台 deck 高亮描边（.is-over），并显示「松手载入」。 */
  let overDepth = 0;
  root.addEventListener('dragenter', (e) => {
    e.preventDefault();
    overDepth++;
    root.classList.add('is-over');
  });
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    root.classList.add('is-over');
  });
  root.addEventListener('dragleave', (e) => {
    overDepth = Math.max(0, overDepth - 1);
    /* 在子元素之间移动也会触发 dragleave，relatedTarget 还在 deck 里就不算离开 */
    if (overDepth === 0 && !(e.relatedTarget && root.contains(e.relatedTarget))) {
      root.classList.remove('is-over');
    }
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    overDepth = 0;
    root.classList.remove('is-over');
    handleDrop(e, k);
  });
}

function syncRangeButtons(k) {
  const d = E.decks[k];
  qa('[data-range]', D[k].root).forEach((b) => b.classList.toggle('is-on', Number(b.dataset.range) === d.range));
}

function handleDrop(e, deckKey) {
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = dt.files;
  if (files && files.length) {
    addLocalFiles(files).then(() => {
      const last = S.lib[S.lib.length - 1];
      if (last && deckKey) loadInto(deckKey, last);
    });
    return;
  }
  const key = dt.getData('application/x-lizi-dj') || dt.getData('text/plain');
  if (!key) return;
  if (S.libByKey.has(key)) {
    if (deckKey) loadInto(deckKey, S.libByKey.get(key));
    return;
  }
  /* 曲库里没有（比如从别的列表拖过来的 key）→ 按「当前播放器队列」兜一次 */
  const Player_ = typeof Player !== 'undefined' ? Player : null;
  const queue = (Player_ && Player_.state && Player_.state.queue) || [];
  const tr = queue.find((t) => entryFromTrack(t) && entryFromTrack(t).key === key);
  if (tr) {
    const entry = entryFromTrack(tr);
    libAdd([entry]);
    libRender();
    if (deckKey) loadInto(deckKey, entry);
  }
}

/* ================================================================== *
 * 混音台绑定
 * ================================================================== */
function bindMixer() {
  qa('.djx-strip').forEach((strip) => {
    const k = strip.dataset.strip;
    qa('.djx-knob', strip).forEach((knob) => {
      const name = knob.dataset.knob;
      if (!name) return;
      bindKnob(knob, () => S.ctl[k][name], (v) => { S.ctl[k][name] = v; applyDeck(k); }, 0.5);
    });
  });
  for (const k of ['A', 'B']) {
    const fader = q('[data-fader="chan"][data-deck="' + k + '"]');
    if (fader) bindVFader(fader, () => S.ctl[k].chan, (v) => { S.ctl[k].chan = v; applyDeck(k); }, 0.85);
    const pfl = q('[data-act="pfl"][data-deck="' + k + '"]');
    if (pfl) pfl.addEventListener('click', () => {
      S.pfl[k] = !S.pfl[k];
      pfl.classList.toggle('is-on', S.pfl[k]);
      applyDeck(k);
    });
    D['meter' + k] = q('[data-meter="' + k + '"]');
  }
  if (D.mix.cross) bindHFader(D.mix.cross, () => S.cross, (v) => setCross(v), 0.5);
  if (D.mix.master) bindVFader(D.mix.master, () => S.masterVol, (v) => setMasterVol(v), 0.8);
  if (D.mix.curve) D.mix.curve.addEventListener('click', () => {
    S.crossCurve = S.crossCurve === 'power' ? 'sharp' : 'power';
    D.mix.curve.textContent = S.crossCurve === 'power' ? 'POWER' : 'SHARP';
    E.setCrossCurve(S.crossCurve);
  });
  const cm = q('[data-fader="cuel"]');
  if (cm) bindMini(cm, () => S.cueMix, (v) => { S.cueMix = v; E.setCueMix(v); });
  D.masterMeter = q('[data-meter="master"]');
}

/* ================================================================== *
 * 曲库绑定
 * ================================================================== */
function bindLib() {
  const { body, search, file } = D.lib;
  if (!body) return;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-load]');
    if (!b) return;
    const tr = b.closest('tr');
    const entry = tr && S.libByKey.get(tr.dataset.key);
    loadInto(b.dataset.load, entry);
  });
  body.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const entry = S.libByKey.get(tr.dataset.key);
    const target = !E.decks.A.buf ? 'A' : !E.decks.B.buf ? 'B' : 'A';
    loadInto(target, entry);
  });
  body.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const key = tr.dataset.key;
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData('text/plain', key);
    dt.setData('application/x-lizi-dj', key);
    dt.effectAllowed = 'copy';
    /* 拖动时带的就是那行的小封面 */
    const thumb = tr.querySelector('.djx-thumb');
    if (thumb && dt.setDragImage) {
      try { dt.setDragImage(thumb, 17, 17); } catch { /* 有的环境不支持就退默认 */ }
    }
    tr.classList.add('is-dragging');
    document.getElementById('djx')?.classList.add('is-drag-lib');
  });
  body.addEventListener('dragend', () => {
    body.querySelectorAll('tr.is-dragging').forEach((tr) => tr.classList.remove('is-dragging'));
    document.getElementById('djx')?.classList.remove('is-drag-lib');
    for (const k of ['A', 'B']) D[k].root.classList.remove('is-over');
  });

  if (search) {
    search.addEventListener('input', () => { S.filter = search.value; libRender(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); libFromSearch(); }
      e.stopPropagation();
    });
  }
  qa('[data-act="lib-queue"]').forEach((b) => b.addEventListener('click', libFromQueue));
  qa('[data-act="lib-nc"]').forEach((b) => b.addEventListener('click', libFromSearch));
  qa('[data-act="lib-local"]').forEach((b) => b.addEventListener('click', () => file && file.click()));
  if (file) file.addEventListener('change', () => { addLocalFiles(file.files); file.value = ''; });

  /* 拖到曲库区域 */
  const wrap = D.lib.root;
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addLocalFiles(e.dataTransfer.files);
  });
}

/* ================================================================== *
 * 每帧
 * ================================================================== */
function paintDeck(k) {
  const d = E.decks[k], ui = D[k];
  if (!ui) return;
  const pos = d.audioPos();
  const st = deckStatus(d);

  if (ui.title) ui.title.textContent = d.track ? (d.track.title || d.track.name || '—') : '未载入';
  if (ui.artist) ui.artist.textContent = d.track ? (d.track.artist || '—') : '拖入文件或双击曲库';
  if (ui.state) ui.state.textContent = st;
  if (ui.state) ui.state.style.color = d.err ? 'oklch(62% .22 12)' : '';
  if (ui.bpm) ui.bpm.textContent = d.bpmNow ? d.bpmNow.toFixed(2) : '—';
  if (ui.rate) {
    const f = (d.rate - 1) * 100;
    ui.rate.textContent = (f >= 0 ? '+' : '') + f.toFixed(2) + '%';
  }
  if (ui.tcur) ui.tcur.textContent = fmtTime(pos);
  if (ui.trem) ui.trem.textContent = fmtTime(Math.max(0, d.dur - pos), true);
  if (ui.loopnow) {
    ui.loopnow.textContent = (d.loop.b > d.loop.a)
      ? fmtTime(d.loop.a) + '–' + fmtTime(d.loop.b)
      : '—';
  }
  if (ui.pitchval) ui.pitchval.textContent = (d.pitchPct >= 0 ? '+' : '') + d.pitchPct.toFixed(1) + '%';
  if (ui.ptime) ui.ptime.textContent = fmtTime(pos);

  /* 转盘中央的专辑封面：换了歌才动 src；没封面就回落到渐变 label + 字母 */
  if (ui.cover) {
    const src = d.track ? (d.track.cover || '') : '';
    if (ui.cover.dataset.src !== src) {
      ui.cover.dataset.src = src;
      ui.cover.dataset.real = src ? '1' : '0';
      ui.cover.src = src || COVER_PH;
    }
    const empty = !src;
    ui.cover.classList.toggle('is-empty', empty);
    if (ui.platter) ui.platter.classList.toggle('is-empty', empty);
  }

  ui.play.classList.toggle('is-on', d.playing);
  ui.play.textContent = d.playing ? '❚❚' : '▶';
  ui.sync.classList.toggle('is-accent', S.master !== k && !!d.bpmNow && !!E.decks[S.master].bpmNow
    && Math.abs(d.bpmNow - E.decks[S.master].bpmNow) < 0.02 * Math.max(1, d.bpmNow));
  ui.master.classList.toggle('is-solid', S.master === k);
  ui.keylock.classList.toggle('is-sel', !!d.keylock);
  ui.loopToggle.classList.toggle('is-on', !!d.loop.on);
  ui.hotcues.forEach((b, i) => b.classList.toggle('is-on', d.hotcues[i] != null));

  /* 转盘旋转：按播放位置给角度 */
  if (ui.platter) {
    const deg = (-pos * 33.3) % 360;
    ui.platter.style.setProperty('--rot', deg.toFixed(1) + 'deg');
    ui.platter.setAttribute('aria-valuenow', d.scrRate ? d.scrRate.toFixed(2) : '0');
  }
  drawDetail(ui.wave, d);
  drawOverview(ui.over, d);
}

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (!active || !E || !E.ctx) return;
  /* 离开实验室（顶栏返回 / 去大厅 / 播放页）：暂停并下电。
     位置留着，回来还是暂停在原位 —— 不是 stop 清零。 */
  const viewEl = document.getElementById('view-lab');
  if (!viewEl || !viewEl.classList.contains('is-active')) {
    pauseAll();
    deactivate();
    return;
  }
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;

  for (const k of ['A', 'B']) {
    const d = E.decks[k];
    if (d.scratching) d.scratchTick(dt, performance.now() - (D[k].lastMoveAt || 0) < 90);
  }
  paintDeck('A');
  paintDeck('B');

  const mA = E.decks.A.readMeter(ts);
  const mB = E.decks.B.readMeter(ts);
  const mM = E.readMasterMeter(ts);
  if (D.meterA) drawMeter(D.meterA, mA.l, mA.r, mA.hl, mA.hr);
  if (D.meterB) drawMeter(D.meterB, mB.l, mB.r, mB.hl, mB.hr);
  if (D.masterMeter) drawMeter(D.masterMeter, mM.l, mM.r, mM.hl, mM.hr);
}

/* ================================================================== *
 * 对外
 * ================================================================== */
export function mount() {
  if (mounted) return;
  ensureCss();
  E = createEngine();
  cacheDom();
  if (!D.A || !D.B) { console.warn('[dj] DOM 不全，跳过'); return; }

  for (const k of ['A', 'B']) {
    decorateKnob(q('.djx-knob--fx', D[k].root));
    bindPlatter(k);
    bindDeckButtons(k);
    bindFx(k);
    setPitchPos(k, 0.5);
    syncRangeButtons(k);
    updateFxLabel(k);
  }
  bindMixer();
  bindLib();
  document.addEventListener('keydown', onKey);

  /* 双击标签回中已经在 bindKnob/bindVFader 里 */
  mounted = true;

  /* 测点：验收脚本用（不参与 UI） */
  window.__DJLAB = {
    engine: () => E,
    state: S,
    loadInto,
    libAdd,
    libRender,
    entryFrom: entryFromTrack,
    entries: () => S.lib,
    addLocalFiles,
    decks: () => E.decks,
    audio: () => audio(),
    coverFromFile,
    hotcue,
    setPitchPos,
    setCross,
    pauseAll,
    coverUrlOf,
    attachLocalCovers,
    paint: () => { paintDeck('A'); paintDeck('B'); },
    drawAll: () => { for (const k of ['A', 'B']) buildOverviewCache(D[k].over, E.decks[k]); },
  };
}

/** 退出 DJ 台：**暂停**（位置保留、回来还是暂停），并且保证没有任何声源还在响。
 *  Mixxx 关掉窗口当然会停；用户的要求是「离开碟机 = 暂停」，不是清零。 */
function pauseAll() {
  if (!E) return;
  for (const k of ['A', 'B']) {
    try { E.decks[k].pauseKeep(); } catch { /* 没载入就跳过 */ }
  }
}

export function show(tab) {
  S.tab = tab || 'dj';
  if (S.tab !== 'dj') { pauseAll(); deactivate(); return; }
  if (!mounted) mount();
  activate();
}

export function activate() {
  if (!mounted) mount();
  if (!E) return;
  active = true;
  E.init();
  E.resume();
  for (const k of ['A', 'B']) {
    E.decks[k].ensure();
    applyDeck(k);
  }
  applyMaster();
  setMasterVol(S.masterVol);
  setCross(S.cross);
  syncRangeButtons('A'); syncRangeButtons('B');
  for (const k of ['A', 'B']) {
    const f = q('[data-fader="pitch"]', D[k].root);
    if (f) { f.style.setProperty('--p', S.pitchPos[k]); if (f.paintFader) f.paintFader(); }
  }
  if (D.mix.cross && D.mix.cross.paintH) D.mix.cross.paintH();
  if (D.mix.master && D.mix.master.paintFader) D.mix.master.paintFader();
  if (D.mix.curve) D.mix.curve.textContent = S.crossCurve === 'power' ? 'POWER' : 'SHARP';
  const cm = q('[data-fader="cuel"]');
  if (cm && cm.paintMini) cm.paintMini();
  lastTs = 0;
  if (!raf) raf = requestAnimationFrame(frame);
  if (!S.autoloaded) { S.autoloaded = true; autoload(); }
  else { for (const k of ['A', 'B']) buildOverviewCache(D[k].over, E.decks[k]); }
}

export function deactivate() {
  active = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

/** 给自动过渡分页 / app.js 用：停成暂停（位置不丢） */
export function stopDecks() { pauseAll(); }

/** 给自动过渡分页用：同一个 AudioContext、同一条 master 总线 */
export function audio() {
  if (!E) { E = createEngine(); }
  E.init();
  E.resume();
  return { ctx: E.ctx, master: E.masterIn, engine: E };
}

export function engine() { return E; }

/* ---------- 首次进 DJ 台自动装台（当前曲 + 下一首） ---------- */
function autoload() {
  const Player_ = typeof Player !== 'undefined' ? Player : null;
  const st = Player_ ? Player_.state : null;
  const queue = (st && st.queue) || [];
  if (!queue.length) {
    flash('DJ 台：从下面曲库拉歌，或把文件拖进来');
    return;
  }
  const i = st.index >= 0 ? st.index : 0;
  const a = entryFromTrack(queue[i]);
  const b = queue.length > 1 ? entryFromTrack(queue[(i + 1) % queue.length]) : null;
  if (a) { libAdd([a]); loadInto('A', a); }
  if (b) { libAdd([b]); loadInto('B', b); }
  libRender();
}

export default { mount, show, activate, deactivate, audio, engine, stopDecks, pauseAll };
