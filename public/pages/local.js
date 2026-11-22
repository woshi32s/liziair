/**
 * pages/local.js —— 本地音乐（自定义音源）页（ESM）
 *
 * 桌面和 /m 共用同一份代码、同一个 #view-local：
 *   · 列表来自 local/lib.js（IndexedDB），曲目形状和平台曲目一致，
 *     只是 source:'local' —— 点一行 / 播放全部都走 Player.playQueue，
 *     队列、随机、循环、交叉淡化、歌词全走原路径，这里不复制一份播放逻辑。
 *   · 导入入口有两个：页头的「导入」（跳到设置 → 平台管理）和空态按钮。
 *     设置页改完之后 local/lib.js 会发 lizi-local-change，这里跟着重画。
 *   · 安卓壳（window.__liziNative.scanAudio 存在）额外多一个「从手机导入」：
 *     扫描 MediaStore 里其它 App 下载的歌，勾选后只写路径引用（不复制文件），
 *     播放走 /api/local-file。桌面没有这个桥，按钮 / 横幅 / 扫描都不出现。
 *   · 页面本身不做搜索：手机导航里的「本地」只负责进来，搜索页签另接
 *     （桌面 SEARCH_SOURCES / 手机 SEARCH_SRCS 里的 local 源）。
 *
 * CSS 在 /local/local.css（设置页的 .local-* / 本页的 .lc-* / 扫描面板的
 * .lsc-* 都在那）：通过 <link> 注入一次，桌面 / 手机共用。
 */

import { ensureCss, esc, fmtDur } from './util.js';
import { supported as scanSupported, scan as nativeScan } from '../local/scan.js';

const W = () => (typeof window !== 'undefined' ? window : null);
const LIB = () => (W() ? W().LIZI_LOCAL : null);

let cssDone = false;
function ensureLocalCss() {
  if (cssDone || document.querySelector('link[data-local-css]')) { cssDone = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../local/local.css', import.meta.url).href;
  l.setAttribute('data-local-css', '1');
  document.head.appendChild(l);
  cssDone = true;
}

let el = null;          // #view-local
let items = [];         // 当前列表（tracks 原样）
let bound = false;

/* 扫描导入（只有安卓壳会用到）：
   scanTried  本次会话是否已自动扫过（mount 可能被调多次，别反复弹权限）
   scanResult 最近一次扫描结果（横幅 / 面板复用）
   sheet      打开中的面板状态；null = 没开
   importing  正在批量写库：这期间忽略 lizi-local-change 的重画，免得刷几百次 */
let scanTried = false;
let scanResult = null;
let sheet = null;
let importing = false;
let noteTimer = 0;

function baseName(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1073741824).toFixed(1).replace(/\.0$/, '')} GB`;
  if (n >= 1024 * 1024) return `${(n / 1048576).toFixed(1).replace(/\.0$/, '')} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fmtMB(bytes) {
  const mb = (Number(bytes) || 0) / 1048576;
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

function isSameTrack(t, item) {
  if (!t || !item) return false;
  if (t.path && item.path && t.path === item.path) return true;
  return !!t.fileName &&
    t.fileName === baseName(item.path) &&
    Number(t.size || 0) === Number(item.size || 0);
}

function isImported(item) {
  return items.some((t) => isSameTrack(t, item));
}

/* ------------------------------------------------------------------ *
 * 曲目 → 播放器队列项
 * ------------------------------------------------------------------ */
function toTrack(t) {
  return {
    id: t.id,
    source: 'local',
    name: t.name || '未命名',
    artists: t.artists || '未知歌手',
    album: t.album || '本地文件',
    duration: t.duration || 0,
    cover: t.cover || '',
  };
}

function coverHtml(t, cls) {
  const src = t.cover || '';
  if (!src) {
    return `<span class="${cls} lc-art lc-art--ph" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 18V6l10-2v12" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="6.6" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="16.6" cy="16" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
    </span>`;
  }
  return `<img class="${cls} lc-art" src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">`;
}

/* ------------------------------------------------------------------ *
 * 外壳
 * ------------------------------------------------------------------ */
function shell(root) {
  if (root.querySelector('[data-lc]')) return;
  root.innerHTML = `
  <div class="lc" data-lc>
    <header class="lc-head">
      <div class="lc-headl">
        <p class="lc-kicker">自定义音源</p>
        <h1 class="lc-title">本地音乐</h1>
        <p class="lc-sub" data-lc-sub>存在本机，不上传服务器</p>
      </div>
      <div class="lc-acts">
        ${scanSupported() ? '<button class="lc-btn lc-btn--ghost" type="button" data-lc-scan>从手机导入</button>' : ''}
        <button class="lc-btn lc-btn--ghost" type="button" data-lc-import>导入文件</button>
        <button class="lc-btn" type="button" data-lc-playall>播放全部</button>
      </div>
    </header>
    ${scanSupported() ? `<div class="lsc-bar" data-lc-scanbar hidden>
      <span class="lsc-bar__txt" data-lc-scanbar-txt></span>
      <button class="lc-btn lc-btn--ghost lsc-bar__btn" type="button" data-lc-scanbar-open>导入</button>
    </div>` : ''}
    ${scanSupported() ? '<p class="lsc-note" data-lc-note hidden></p>' : ''}
    <div class="lc-list" data-lc-list role="list"></div>
    <p class="lc-empty" data-lc-empty hidden>
      <span>还没有本地歌曲。在「设置 → 平台管理 → 自定义音源」里选音频文件，
      可以一起选 LRC / YRC 歌词（按同名自动配对）。</span>
      <button class="lc-btn" type="button" data-lc-import>去导入</button>
    </p>
    <p class="lc-tip">支持 MP3 / FLAC / WAV / M4A / OGG / AAC / OPUS；歌词支持 LRC / YRC。
    文件只在本机浏览器存储里，清应用数据或换设备要重新导入。${
      scanSupported() ? '安卓版「从手机导入」只记录路径，不复制文件。' : ''
    }</p>
  </div>`;
}

/** 扫描横幅：只显示「还没导入」的数量；桌面 / 没扫过 / 全导过了都不出现 */
function paintScanBar() {
  if (!el) return;
  const bar = el.querySelector('[data-lc-scanbar]');
  if (!bar) return;
  if (!scanSupported() || !scanResult || scanResult.status !== 'ok') {
    bar.hidden = true;
    return;
  }
  const remain = (scanResult.items || []).filter((it) => !isImported(it)).length;
  if (!remain) { bar.hidden = true; return; }
  const txt = bar.querySelector('[data-lc-scanbar-txt]');
  if (txt) txt.textContent = `手机里发现 ${remain} 首歌`;
  bar.hidden = false;
}

function showNote(text, ms) {
  if (!el) return;
  const p = el.querySelector('[data-lc-note]');
  if (!p) return;
  p.textContent = text;
  p.hidden = false;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { p.hidden = true; }, ms || 6000);
}

function paint() {
  if (!el) return;
  shell(el);
  const list = el.querySelector('[data-lc-list]');
  const empty = el.querySelector('[data-lc-empty]');
  const playAll = el.querySelector('[data-lc-playall]');
  const sub = el.querySelector('[data-lc-sub]');
  if (!list) return;

  const n = items.length;
  if (sub) sub.textContent = n ? `${n} 首 · 存在本机，不上传服务器` : '存在本机，不上传服务器';
  if (playAll) playAll.disabled = !n;
  if (empty) empty.hidden = !!n;
  list.hidden = !n;
  paintScanBar();

  if (!n) { list.innerHTML = ''; return; }
  list.innerHTML = items.map((t, i) => `
    <div class="lc-row" role="listitem" tabindex="0" data-lc-i="${i}"
         aria-label="播放 ${esc(t.name)}">
      <span class="lc-i">${String(i + 1).padStart(2, '0')}</span>
      ${coverHtml(t, 'lc-cover')}
      <span class="lc-txt">
        <span class="lc-name">${esc(t.name || '未命名')}</span>
        <span class="lc-artist">${esc(t.artists || '未知歌手')}${
          t.hasYrc ? ' · <b class="lc-ly">YRC</b>' : t.hasLrc ? ' · <b class="lc-ly">LRC</b>' : ''
        }</span>
      </span>
      <span class="lc-dur">${t.duration ? fmtDur(t.duration) : '--:--'}</span>
      <button class="lc-del" type="button" data-lc-del="${esc(t.id)}"
              aria-label="删除 ${esc(t.name)}"
              title="${t.ref ? '从列表移除（不删手机里的原文件）' : '从这个列表删掉（音频一起删）'}">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor"
                stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`).join('');
}

function playAt(i) {
  if (!items.length) return;
  const iN = Math.max(0, Math.min(items.length - 1, Number(i) || 0));
  const queue = items.map(toTrack);
  try {
    if (W().Player && typeof W().Player.playQueue === 'function') {
      W().Player.playQueue(queue, iN);
    }
  } catch (e) { /* 播放器还没就绪：列表照常显示 */ }
}

function openManage() {
  document.dispatchEvent(new CustomEvent('lizi:open-platform-manage'));
}

/* ------------------------------------------------------------------ *
 * 「从手机导入」面板（只有安卓壳会走到这里）
 *   自绘 sheet，不用 alert；底部「全选 / 全不选」「已选 N 首 · 共 X MB」
 *   「导入 N 首」。点行切换勾选，已导入的行不可勾。
 * ------------------------------------------------------------------ */
function closeSheet(force) {
  if (!sheet) return;
  if (sheet.busy && !force) return;
  const st = sheet;
  sheet = null;
  try { st.root.remove(); } catch (e) { /* 已经不在 DOM 里 */ }
  document.removeEventListener('keydown', st.onKey);
  /* 恢复安卓返回键（只在没人又包了一层时） */
  if (st.backWrap && window.__liziPhoneBack === st.backWrap) {
    try { window.__liziPhoneBack = st.baseBack; } catch (e) { /* 忽略 */ }
  }
}

function sheetMessage(st) {
  if (st.phase === 'loading') return '正在扫描手机里的歌曲…';
  if (st.phase === 'denied') {
    return '没有读取音频的权限，去系统设置 → 应用 → LIZI → 权限里打开。';
  }
  if (st.phase === 'permission') return '请在系统弹窗里允许 LIZI 读取音频，允许后会自动继续。';
  if (st.phase === 'unsupported') return '当前环境不支持从手机导入。';
  if (st.phase === 'busy') return '扫描还在进行，稍等一下再试。';
  if (st.phase === 'empty') return '这部手机里没找到别的 App 下载的歌。';
  if (st.phase === 'error') {
    return `扫描失败${st.error ? '：' + st.error : ''}，稍后再试。`;
  }
  return '';
}

function sheetRows(st) {
  return st.items.map((it, i) => {
    const imp = isImported(it);
    const name = it.name || baseName(it.path).replace(/\.[^.]+$/, '') || '未命名';
    const artist = it.artist || '未知歌手';
    const folder = it.folder || '手机存储';
    return `
      <label class="lsc-row${imp ? ' is-imported' : ''}">
        <input class="lsc-check" type="checkbox" data-lsc-check="${i}"
               ${st.selected.has(i) ? 'checked' : ''} ${imp ? 'disabled' : ''}>
        <span class="lsc-txt">
          <span class="lsc-name">${esc(name)}</span>
          <span class="lsc-meta"><span class="lsc-artist">${esc(artist)}</span><span
            class="lsc-sep">·</span><span class="lsc-folder">${esc(folder)}</span></span>
        </span>
        ${imp ? '<span class="lsc-badge">已导入</span>' : ''}
        <span class="lsc-dur">${it.duration ? fmtDur(it.duration) : '--:--'}</span>
        <span class="lsc-size">${fmtSize(it.size)}</span>
      </label>`;
  }).join('');
}

function selectedStats(st) {
  let count = 0;
  let bytes = 0;
  st.selected.forEach((i) => {
    const it = st.items[i];
    if (!it || isImported(it)) return;
    count += 1;
    bytes += Number(it.size) || 0;
  });
  return { count, bytes };
}

function updateSheetFoot(st) {
  const stats = selectedStats(st);
  const sum = st.root.querySelector('[data-lsc-sum]');
  const go = st.root.querySelector('[data-lsc-go]');
  const prog = st.root.querySelector('[data-lsc-progress]');
  if (sum) sum.textContent = `已选 ${stats.count} 首 · 共 ${fmtMB(stats.bytes)}`;
  if (go) {
    go.textContent = st.busy ? '正在导入…' : `导入 ${stats.count} 首`;
    go.disabled = st.busy || stats.count === 0;
  }
  if (prog) {
    prog.hidden = !st.progress;
    prog.textContent = st.progress || '';
  }
}

function renderSheet(st) {
  const body = st.root.querySelector('[data-lsc-body]');
  const foot = st.root.querySelector('[data-lsc-foot]');
  const sub = st.root.querySelector('[data-lsc-sub]');
  if (!body) return;
  if (st.phase === 'ready') {
    body.innerHTML = sheetRows(st);
    if (foot) foot.hidden = false;
    if (sub) sub.textContent = `找到 ${st.items.length} 首 · 不复制文件，只记录路径`;
    updateSheetFoot(st);
    return;
  }
  body.innerHTML = `<p class="lsc-msg">${esc(sheetMessage(st))}</p>`;
  if (foot) foot.hidden = true;
  if (sub) sub.textContent = '扫描手机里其它 App 下载的歌曲';
}

function applyScanResult(st, r) {
  st.error = (r && r.error) || '';
  if (!r || r.status !== 'ok') {
    st.items = [];
    st.phase = (r && r.status) || 'error';
    renderSheet(st);
    return;
  }
  st.items = r.items || [];
  st.selected = new Set();
  st.phase = st.items.length ? 'ready' : 'empty';
  renderSheet(st);
}

function selectAllRows(st, on) {
  if (st.busy) return;
  st.selected.clear();
  if (on) {
    st.items.forEach((it, i) => { if (!isImported(it)) st.selected.add(i); });
  }
  st.root.querySelectorAll('[data-lsc-check]').forEach((cb) => {
    cb.checked = st.selected.has(Number(cb.dataset.lscCheck));
  });
  updateSheetFoot(st);
}

async function importSelected(st) {
  if (st.busy) return;
  const lib = LIB();
  if (!lib || typeof lib.addRef !== 'function') {
    st.phase = 'error';
    st.error = '本地库不可用';
    renderSheet(st);
    return;
  }
  const idxs = [];
  st.selected.forEach((i) => {
    if (st.items[i] && !isImported(st.items[i])) idxs.push(i);
  });
  idxs.sort((a, b) => a - b);
  if (!idxs.length) return;

  st.busy = true;
  importing = true;                 // 别让每条 addRef 的 emit 都重画整页
  let ok = 0;
  let fail = 0;
  try {
    for (let k = 0; k < idxs.length; k++) {
      const it = st.items[idxs[k]];
      st.progress = `正在导入 ${k + 1} / ${idxs.length}`;
      updateSheetFoot(st);
      try {
        await lib.addRef({
          path: it.path,
          name: it.name,
          artists: it.artist,
          album: it.album,
          duration: it.duration,
          size: it.size,
          mime: it.mime,
          fileName: baseName(it.path),
          folder: it.folder,
        });
        ok += 1;
        st.selected.delete(idxs[k]);
      } catch (e) {
        fail += 1;
      }
    }
  } finally {
    st.busy = false;
    importing = false;
    st.progress = '';
  }
  closeSheet(true);
  await refresh();
  showNote(`已导入 ${ok} 首${fail ? `，${fail} 首失败` : ''}`, fail ? 8000 : 5000);
}

function buildSheet() {
  const root = document.createElement('div');
  root.className = 'lsc-ov';
  root.innerHTML = `
    <section class="lsc-sheet" role="dialog" aria-modal="true" aria-label="从手机导入">
      <header class="lsc-head">
        <div class="lsc-headl">
          <h2 class="lsc-title">从手机导入</h2>
          <p class="lsc-sub" data-lsc-sub>扫描手机里其它 App 下载的歌曲</p>
        </div>
        <button class="lsc-close" type="button" data-lsc-close aria-label="关闭">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor"
                  stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </header>
      <div class="lsc-body" data-lsc-body></div>
      <footer class="lsc-foot" data-lsc-foot hidden>
        <div class="lsc-tools">
          <button class="lsc-link" type="button" data-lsc-all>全选</button>
          <button class="lsc-link" type="button" data-lsc-none>全不选</button>
        </div>
        <div class="lsc-sum">
          <span data-lsc-sum>已选 0 首 · 共 0 MB</span>
          <button class="lc-btn lsc-go" type="button" data-lsc-go disabled>导入 0 首</button>
        </div>
        <p class="lsc-progress" data-lsc-progress hidden></p>
      </footer>
    </section>`;

  const st = {
    root,
    items: [],
    selected: new Set(),
    phase: 'loading',
    busy: false,
    error: '',
    progress: '',
  };

  root.addEventListener('click', (e) => {
    if (e.target === root) { closeSheet(); return; }
    if (e.target.closest('[data-lsc-close]')) { closeSheet(); return; }
    if (e.target.closest('[data-lsc-all]')) { selectAllRows(st, true); return; }
    if (e.target.closest('[data-lsc-none]')) { selectAllRows(st, false); return; }
    if (e.target.closest('[data-lsc-go]')) { importSelected(st); }
  });

  root.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-lsc-check]');
    if (!cb) return;
    const i = Number(cb.dataset.lscCheck);
    if (cb.checked) st.selected.add(i); else st.selected.delete(i);
    updateSheetFoot(st);
  });

  st.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
  };
  document.addEventListener('keydown', st.onKey);

  /* 安卓返回键：面板开着时先收面板，别让系统返回把页面切走留下一个浮层 */
  st.baseBack = window.__liziPhoneBack;
  if (typeof st.baseBack === 'function') {
    st.backWrap = function () {
      if (sheet === st) { closeSheet(); return true; }
      return st.baseBack.apply(this, arguments);
    };
    window.__liziPhoneBack = st.backWrap;
  }

  document.body.appendChild(root);
  return st;
}

async function openScanSheet(fresh) {
  if (sheet) return;
  const st = buildSheet();
  sheet = st;

  if (!fresh && scanResult) {
    applyScanResult(st, scanResult);
    return;
  }

  st.phase = 'loading';
  renderSheet(st);
  const r = await nativeScan();
  scanResult = r;
  if (sheet !== st) {
    /* 面板被用户关了：结果仍然留给横幅 */
    if (r && r.status === 'ok' && r.items.length) paintScanBar();
    return;
  }
  applyScanResult(st, r);
}

/** 进页面时静默扫一次：只出横幅，不弹面板、不自动导入 */
async function autoDetect() {
  if (scanTried || !scanSupported()) return;
  scanTried = true;
  try {
    const r = await nativeScan();
    scanResult = r;
    if (r && r.status === 'ok' && r.items.length) paintScanBar();
  } catch (e) { /* 自动检测失败就安静地算了，手动按钮还能再试 */ }
}

/* ------------------------------------------------------------------ *
 * 事件：只挂一次
 * ------------------------------------------------------------------ */
function bind(root) {
  if (bound) return;
  bound = true;

  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-lc-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.lcDel;
      const t = items.find((x) => x.id === id);
      const tip = t && t.ref
        ? `从列表移除「${t.name || '这首歌'}」？手机里的原文件不会被删除。`
        : `删除「${(t && t.name) || '这首歌'}」？音频文件也会一起删掉。`;
      if (!confirm(tip)) return false;
      const l = LIB();
      if (l) l.remove(id).then(() => refresh(), () => {});
      return false;
    }
    if (e.target.closest('[data-lc-scan]')) { openScanSheet(true); return; }
    if (e.target.closest('[data-lc-scanbar-open]')) { openScanSheet(false); return; }
    if (e.target.closest('[data-lc-import]')) { openManage(); return; }
    if (e.target.closest('[data-lc-playall]')) { playAt(0); return; }
    const row = e.target.closest('[data-lc-i]');
    if (row) playAt(Number(row.dataset.lcI));
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const row = e.target.closest('[data-lc-i]');
    if (!row) return;
    e.preventDefault();
    playAt(Number(row.dataset.lcI));
  });

  document.addEventListener('lizi-local-change', () => {
    if (importing) return;          // 批量导入时每条记录都会 emit，最后统一刷新
    if (el && el.classList.contains('is-active')) refresh();
  });

  /* 切走页面 / 回大厅时把面板收掉，别把浮层留在别的页面上 */
  document.addEventListener('lizi:show', () => {
    if (sheet) closeSheet();
  });
}

/* ------------------------------------------------------------------ *
 * 对外
 * ------------------------------------------------------------------ */
export async function refresh() {
  const l = LIB();
  if (!l) { items = []; paint(); return 0; }
  try { items = await l.list(); } catch (e) { items = []; }
  paint();
  return items.length;
}

export async function mount(viewEl) {
  ensureCss();
  ensureLocalCss();
  el = viewEl || document.getElementById('view-local');
  if (!el) return 0;
  shell(el);
  bind(el);
  const n = await refresh();
  /* 安卓壳：后台静默扫一次（本次会话只一遍）。不 await —— 扫描期间页面照常可用 */
  if (scanSupported() && !scanTried) autoDetect();
  return n;
}

export function open() {
  document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'local' } }));
  return mount();
}

/** 当前列表（验收 / 调试用） */
export function tracks() {
  return items.map(toTrack);
}
