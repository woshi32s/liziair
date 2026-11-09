/* ============================ 2 · 分词（词典法 + 双向最大匹配） ============================ */
let DICT = null;
fetch('/segdict.bin').then((r) => (r.ok ? r.arrayBuffer() : null))
  .then((b) => { if (b) DICT = new Uint32Array(b); }).catch(() => {});
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function isWord(s, i, Ln) {
  if (!DICT) return false;
  const h = fnv(s.substr(i, Ln));
  let lo = 0, hi = DICT.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = DICT[m]; if (v === h) return true; if (v < h) lo = m + 1; else hi = m - 1; }
  return false;
}
function segWords(text) {
  const fwd = [];
  for (let i = 0; i < text.length;) {
    let hit = 0;
    for (let Ln = Math.min(4, text.length - i); Ln >= 2; Ln--) if (isWord(text, i, Ln)) { hit = Ln; break; }
    if (hit) { fwd.push(text.substr(i, hit)); i += hit; } else { fwd.push(text[i]); i++; }
  }
  const bwd = [];
  for (let j = text.length; j > 0;) {
    let hit = 0;
    for (let Ln = Math.min(4, j); Ln >= 2; Ln--) if (isWord(text, j - Ln, Ln)) { hit = Ln; break; }
    if (hit) { bwd.unshift(text.substr(j - hit, hit)); j -= hit; } else { bwd.unshift(text[j - 1]); j--; }
  }
  return fwd.length <= bwd.length ? fwd : bwd;
}
const MAXG = 3;
const PUNCT = /[，。！？、；：,.!?;:…—~·「」『』（）()《》【】"]/;
const SPACE = /\s/;
function isLatin(text) { let la = 0, cjk = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) la++; else if (c >= '\u4e00' && c <= '\u9fff') cjk++; } return la > cjk; }
function latinSpans(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    if (SPACE.test(text[i])) { i++; continue; }
    let j = i; while (j < text.length && !SPACE.test(text[j])) j++;
    out.push({ i0: i, i1: j }); i = j;
  }
  return out;
}
const SUFFIX = /^[的了着过地得吗呢吧啊嘛]$/;
const PREFIX = /^[但还就才又也都把被在从向对和与而却很不没最更将已曾让给]$/;
const countChars = (s) => { let n = 0; for (let i = 0; i < s.length; i++) if (!PUNCT.test(s[i]) && !SPACE.test(s[i])) n++; return n; };
function groupByWords(text) {
  const words = segWords(text), out = [];
  let cur = '', start = 0, chars = 0, pos = 0;
  const flush = (end) => { if (cur) { out.push({ i0: start, i1: end }); cur = ''; chars = 0; } };
  for (const w of words) {
    const at = pos; pos += w.length;
    const isP = PUNCT.test(w);
    if (!cur) { cur = w; start = at; chars = isP ? 0 : w.length; continue; }
    if (isP) { cur += w; if (chars >= 2) flush(pos); continue; }
    const single = w.length === 1;
    if (single && SUFFIX.test(w)) { cur += w; chars++; if (chars >= MAXG) flush(pos); continue; }
    if (single && PREFIX.test(w) && chars >= 2) { flush(at); cur = w; start = at; chars = 1; continue; }
    if (chars + w.length <= MAXG) { cur += w; chars += w.length; } else { flush(at); cur = w; start = at; chars = w.length; }
  }
  flush(text.length);
  for (let k = 0; k < out.length; k++) {
    const g = out[k];
    if (countChars(text.slice(g.i0, g.i1)) > 1) continue;
    const prev = out[k - 1], next = out[k + 1];
    if (prev && prev.i1 === g.i0 && countChars(text.slice(prev.i0, prev.i1)) < MAXG) { prev.i1 = g.i1; out.splice(k, 1); k--; }
    else if (next && next.i0 === g.i1 && countChars(text.slice(next.i0, next.i1)) < MAXG) { next.i0 = g.i0; out.splice(k, 1); k--; }
  }
  return out;
}
function groupByRule(text) {
  const out = []; let start = 0, chars = 0;
  for (let i = 0; i < text.length; i++) {
    const s = PUNCT.test(text[i]) || SPACE.test(text[i]);
    if (!s) chars++;
    if (s && chars >= 2) { out.push({ i0: start, i1: i + 1 }); start = i + 1; chars = 0; continue; }
    if (!s && chars > MAXG) { out.push({ i0: start, i1: i }); start = i; chars = 1; }
  }
  if (start < text.length) out.push({ i0: start, i1: text.length });
  return out;
}
const spansForLine = (t) => (isLatin(t) ? latinSpans(t) : (DICT ? groupByWords(t) : groupByRule(t)));

/* ============================ 3 · 字形采样（自动折行 + 逐字归属） ============================ */
const FONT = (px, wt) => `${wt || 800} ${px}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
function wrapText(text, fs, maxW, wt) {
  octx.font = FONT(fs, wt);
  const rows = [];
  let start = 0, w = 0;
  for (let i = 0; i < text.length; i++) {
    const cw = octx.measureText(text[i]).width;
    if (!cw) continue;
    if (w + cw > maxW && i > start) { rows.push({ i0: start, i1: i, w }); start = i; w = 0; }
    w += cw;
  }
  rows.push({ i0: start, i1: text.length, w });
  for (const r of rows) while (r.i1 - r.i0 > 1 && SPACE.test(text[r.i0])) r.i0++;
  return rows;
}
function sampleGlyph(text, opt) {
  opt = opt || {};
  const wt = opt.weight || 800;
  let fs = opt.fs || 88;
  const maxW = opt.maxW || Math.min(W * 0.74, 1180);
  const maxH = opt.maxH || H * 0.52;
  let rows = wrapText(text, fs, maxW, wt);
  let lh = fs * 1.14;
  if (rows.length * lh > maxH) {
    fs *= maxH / (rows.length * lh);
    rows = wrapText(text, fs, maxW, wt);
    lh = fs * 1.14;
  }
  octx.font = FONT(fs, wt);
  const widest = Math.max(1, ...rows.map((r) => octx.measureText(text.slice(r.i0, r.i1)).width));
  const padW = Math.ceil(widest) + 20, padH = Math.ceil(lh * rows.length) + 10;
  offCv.width = padW; offCv.height = padH;
  octx.font = FONT(fs, wt);
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillStyle = '#fff';
  octx.clearRect(0, 0, padW, padH);

  const n = text.length;
  const charCx = new Float32Array(n), charCy = new Float32Array(n);
  const rowMaps = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const str = text.slice(row.i0, row.i1);
    const cy = padH / 2 + (r - (rows.length - 1) / 2) * lh;
    octx.fillText(str, padW / 2, cy);
    const x0 = (padW - row.w) / 2;
    const map = new Int16Array(padW).fill(-1);
    let acc = 0;
    for (let i = row.i0; i < row.i1; i++) {
      const cw = octx.measureText(text[i]).width;
      charCx[i] = x0 + acc + cw / 2 - padW / 2;
      charCy[i] = cy - padH / 2;
      const a0 = Math.max(0, Math.floor(x0 + acc)), a1 = Math.min(padW, Math.ceil(x0 + acc + cw));
      for (let x = a0; x < a1; x++) map[x] = i;
      acc += cw;
    }
    rowMaps.push({ y0: cy - lh / 2, y1: cy + lh / 2, map });
  }
  const d = octx.getImageData(0, 0, padW, padH).data;
  const pxA = [], pyA = [], ownA = [];
  const step = opt.step || 2;
  for (let y = 0; y < padH; y += step) {
    let rm = null;
    for (let r = 0; r < rowMaps.length; r++) { const m = rowMaps[r]; if (y >= m.y0 && y < m.y1) { rm = m; break; } }
    if (!rm) continue;
    for (let x = 0; x < padW; x += step) {
      if (d[(y * padW + x) * 4 + 3] <= 128) continue;
      const c = rm.map[x];
      if (c < 0) continue;
      pxA.push(x - padW / 2); pyA.push(y - padH / 2); ownA.push(c);
    }
  }
  return {
    px: Float32Array.from(pxA), py: Float32Array.from(pyA), own: Int16Array.from(ownA),
    pc: pxA.length, n, charCx, charCy, fs, w: widest, h: lh * rows.length, rows: rows.length,
  };
}

/* ============================ 4 · 句索引 ============================ */
let brewIdx = -1, lastT = -1;
const LEAD = 1.5;
const hintShow = (s, o) => { hint.textContent = s; hint.style.opacity = o; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut5 = (p) => 1 - Math.pow(1 - p, 5);
const rnd = (a, b) => a + Math.random() * (b - a);

