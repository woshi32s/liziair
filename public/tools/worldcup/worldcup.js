/* ==========================================================================
   LIZI · 歌单世界杯（大厅「工具箱」里的一个趣味工具）
   --------------------------------------------------------------------------
   做什么：
     把一张歌单（或当前播放队列）随机抽签，按世界杯的方式一对一淘汰，
     小组赛 → 八强 → 半决赛 → 决赛，最后选出一首「这个歌单里最喜欢的歌」，
     并生成一张 1080×1440 的冠军海报。

   为什么单独一个文件：
     · 只读 Player / API 的公开接口，不改播放器和 app.js 的任何逻辑；
     · open / close 和 CSS 懒注入照 spatial.js 的约定，入口只加在
       TOOLBOX + hallEntries 两处；
     · 所有 DOM 都塞在自己的 #lizi-worldcup 里，根节点统一
       stopPropagation，不触发 app.js 的全局点击委托。

   赛制：
     n = 参赛曲目数（最多随机抽 64 首）
     G = clamp(2, 8, floor(n/5) 以下最大的 2 的幂)；n < 12 时 G = 0，直接淘汰赛
     小组赛：每 G 首一组，组内单败淘汰（奇数轮空），每组出线 1 首 → n-G 场
     淘汰赛：G 首随机排进 2 的幂淘汰赛（不够就轮空）→ G-1 场
     总场次恒为 n-1。所有对局对象在 buildPlan 时按轮次顺序排好，
     next 指针负责把胜者送进下一场；小组全部结束后才抽签生成淘汰赛。

   性能边界（安卓 WebView）：
     不用 WebGL、不用 backdrop-filter、不用 filter: blur；浮层底色不透明。
     动效只做 transform / opacity；唯一的小面积 filter 是败者卡去色。
     彩带是一块 2D canvas，最多 120 个粒子，document.hidden 时停。
   ========================================================================== */

window.LIZI_WORLDCUP = (() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量与工具
   * ------------------------------------------------------------------ */
  const MAX_TRACKS = 64;
  const MIN_TRACKS = 4;
  const MIN_QUEUE = 8;
  const TOTAL_ROUND_MS = 420;
  const NEXT_READY_MS = 300;
  const REDUCED = (() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  const SOURCE_LABELS = {
    netease: '网易云',
    qq: 'QQ 音乐',
    kugou: '酷狗',
    qishui: '汽水',
    bodian: '波点',
    local: '本地',
  };
  const TABS = [
    { id: 'netease', name: '网易云' },
    { id: 'qq', name: 'QQ' },
    { id: 'kugou', name: '酷狗' },
    { id: 'qishui', name: '汽水' },
    { id: 'bodian', name: '波点' },
  ];
  const LETTERS = 'ABCDEFGH'.split('');

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /* 16 首以内不再分组（2026-11-22）：16 首正好是一张 16 强签表。
     以前 n≥12 强制分组，16 首会变成 2 组小组赛 + 1 场总决赛，
     海报里根本没有 16 强；12–15 首同样走 16 槽淘汰赛，空槽轮空。 */
  function groupCountFor(n) {
    if (n <= 16) return 0;
    const target = Math.floor(n / 5);
    let g = 1;
    while (g * 2 <= target) g *= 2;
    return clamp(g, 2, 8);
  }

  function roundName(size) {
    if (size >= 64) return '六十四强';
    if (size >= 32) return '三十二强';
    if (size >= 16) return '十六强';
    if (size >= 8) return '八强';
    if (size >= 4) return '半决赛';
    return '决赛';
  }

  function colName(size) {
    if (size >= 64) return '64强';
    if (size >= 32) return '32强';
    if (size >= 16) return '16强';
    if (size >= 8) return '八强';
    if (size >= 4) return '四强';
    if (size >= 2) return '决赛';
    return size + '强';
  }

  function themeFor(size) {
    if (size <= 2) return 'final';
    if (size <= 4) return 'r4';
    if (size >= 16) return 'r16';
    return 'r8';
  }

  const fmtDate = () => {
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  };

  const trackKey = (t) => `${(t && t.source) || 'netease'}:${t && t.id != null ? t.id : ''}`;

  /** 用户数据永远走 textContent；这个函数只留给少量必须拼进 title/aria 的地方 */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function coverOf(t, size) {
    const u = t && (t.cover || t.albumPic || t.pic || '');
    if (!u) return '';
    try {
      if (typeof API !== 'undefined' && API && typeof API.img === 'function') {
        return API.img(u, size || 300);
      }
    } catch { /* API 还没加载：退回原图 */ }
    return u;
  }

  function trackName(t) { return (t && (t.name || t.songName || t.title)) || '未命名歌曲'; }
  function trackArtist(t) {
    return (t && (t.artists || t.artist || t.singer || t.albumArtist)) || '未知歌手';
  }

  /** player.js 顶层是 `const Player = ...`，不是 window 属性；先按标识符取 */
  function mainPlayer() {
    try { return (typeof Player !== 'undefined' && Player) || window.Player || null; }
    catch { return window.Player || null; }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function makeCover(t, cls, size) {
    const wrap = el('span', cls || 'wc-cover');
    const url = coverOf(t, size);
    if (!url) {
      wrap.classList.add('is-ph');
      return wrap;
    }
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      wrap.classList.add('is-ph');
    }, { once: true });
    img.src = url;
    wrap.appendChild(img);
    return wrap;
  }

  /* 本文件的绝对 URL：worldcup.css 从它派生 */
  const SCRIPT_URL = (() => {
    const s = document.currentScript ||
      document.querySelector('script[src*="tools/worldcup/worldcup.js"]');
    if (s && s.src) return s.src;
    try { return new URL('tools/worldcup/worldcup.js', document.baseURI).href; }
    catch { return 'tools/worldcup/worldcup.js'; }
  })();

  (function injectCss() {
    if (document.querySelector('link[data-lizi-worldcup-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('worldcup.css', SCRIPT_URL).href;
    link.setAttribute('data-lizi-worldcup-css', '');
    document.head.appendChild(link);
  })();

  /* ------------------------------------------------------------------ *
   * 状态 / DOM
   * ------------------------------------------------------------------ */
  let root = null;
  let els = {};
  let built = false;
  let lastFocus = null;
  let playerHooked = false;
  let resizeHooked = false;

  const state = {
    open: false,
    screen: 'pick',           // pick | draw | battle | champion
    tab: 'netease',
    cache: {},                // 平台 → { status, items, error, seq }
    tabSeq: 0,
    plMap: new Map(),
    plSeq: 0,
    busy: false,
    pickSeq: 0,
    sessionName: '',
    sessionSource: '',
    tracks: [],               // 实际参赛曲目（<= 64）
    allCount: 0,
    trackIndex: new Map(),
    plan: null,
    planSeq: 0,
    currentMatch: null,
    matchesPlayed: 0,
    locked: false,
    drawTimer: null,
    advanceTimer: null,
    confirmOpen: false,
    posterOpen: false,
    poster: null,
    posterStyle: null,
    posterSeq: 0,
    posterBusy: false,
    /* 海报预览的平移/缩放（WebView 禁了原生缩放，只能自己算） */
    posterView: { z: 1, x: 0, y: 0 },
    confetti: null,
    confettiRaf: 0,
  };

  /* ------------------------------------------------------------------ *
   * 构建静态外壳
   * ------------------------------------------------------------------ */
  function build() {
    if (built) return;
    built = true;

    root = document.createElement('div');
    root.id = 'lizi-worldcup';
    root.className = 'wc';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'wc-title');
    root.dataset.screen = 'pick';
    root.innerHTML = `
      <div class="wc__grain" aria-hidden="true"></div>
      <div class="wc__speed" aria-hidden="true"></div>

      <header class="wc__head">
        <div class="wc__brand">
          <span class="wc__kicker">LIZI · PLAYLIST WORLD CUP</span>
          <h2 class="wc__title" id="wc-title">歌单世界杯</h2>
        </div>
        <div class="wc__headright">
          <span class="wc__meta" id="wc-meta"></span>
          <button class="wc__close" id="wc-close" type="button" aria-label="关闭歌单世界杯">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
              stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M5 5l14 14M19 5 5 19"/>
            </svg>
          </button>
        </div>
      </header>

      <main class="wc__main" id="wc-main"></main>

      <div class="wc__busy" id="wc-busy" hidden>
        <div class="wc__busybox">
          <i class="wc__spinner" aria-hidden="true"></i>
          <span id="wc-busy-text">正在载入…</span>
        </div>
      </div>

      <div class="wc__toast" id="wc-toast" role="status" aria-live="polite" hidden></div>

      <div class="wc__layer wc__confirm" id="wc-confirm" hidden>
        <div class="wc__dialog" role="alertdialog" aria-modal="true"
          aria-labelledby="wc-confirm-title" aria-describedby="wc-confirm-text">
          <span class="wc__dialog-kicker">QUIT?</span>
          <h3 class="wc__dialog-title" id="wc-confirm-title">比赛还没打完</h3>
          <p class="wc__dialog-text" id="wc-confirm-text">现在退出会丢失这一届的进度，确定要关闭吗？</p>
          <div class="wc__dialog-actions">
            <button class="wc-btn wc-btn--ghost" id="wc-confirm-continue" type="button">继续比赛</button>
            <button class="wc-btn wc-btn--danger" id="wc-confirm-quit" type="button">退出并关闭</button>
          </div>
        </div>
      </div>

      <div class="wc__layer wc__posterlayer" id="wc-posterlayer" hidden>
        <div class="wc__postersheet" role="dialog" aria-modal="true" aria-labelledby="wc-poster-title">
          <div class="wc__posterhead">
            <b id="wc-poster-title">冠军海报</b>
            <div class="wc__postertools">
              <button class="wc__stylebtn" id="wc-poster-style" type="button"
                aria-label="切换海报样式，当前：冠军海报">样式 · 冠军</button>
              <button class="wc__close wc__close--sm" id="wc-poster-x" type="button" aria-label="关闭海报预览">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                  stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M5 5l14 14M19 5 5 19"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="wc__posterimgwrap">
            <img id="wc-poster-img" alt="歌单世界杯冠军海报">
          </div>
          <div class="wc__posteractions">
            <button class="wc-btn wc-btn--gold" id="wc-poster-save" type="button">保存图片</button>
            <button class="wc-btn wc-btn--ghost" id="wc-poster-close" type="button">关闭</button>
          </div>
          <p class="wc__posterhint" id="wc-poster-hint"></p>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    els = {
      main: root.querySelector('#wc-main'),
      meta: root.querySelector('#wc-meta'),
      close: root.querySelector('#wc-close'),
      busy: root.querySelector('#wc-busy'),
      busyText: root.querySelector('#wc-busy-text'),
      toast: root.querySelector('#wc-toast'),
      confirm: root.querySelector('#wc-confirm'),
      confirmContinue: root.querySelector('#wc-confirm-continue'),
      confirmQuit: root.querySelector('#wc-confirm-quit'),
      posterLayer: root.querySelector('#wc-posterlayer'),
      posterTitle: root.querySelector('#wc-poster-title'),
      posterImg: root.querySelector('#wc-poster-img'),
      posterStyle: root.querySelector('#wc-poster-style'),
      posterSave: root.querySelector('#wc-poster-save'),
      posterClose: root.querySelector('#wc-poster-close'),
      posterX: root.querySelector('#wc-poster-x'),
      posterHint: root.querySelector('#wc-poster-hint'),
    };

    /* 根上截断点击 / 指针事件：app.js 的全局委托收不到 */
    ['click', 'pointerdown', 'pointerup', 'pointercancel', 'dblclick', 'contextmenu'].forEach((evt) => {
      root.addEventListener(evt, (e) => e.stopPropagation());
    });

    els.close.addEventListener('click', requestClose);
    els.confirmContinue.addEventListener('click', cancelConfirm);
    els.confirmQuit.addEventListener('click', () => { cancelConfirm(); close(); });
    els.posterClose.addEventListener('click', closePoster);
    els.posterX.addEventListener('click', closePoster);
    els.posterSave.addEventListener('click', savePoster);
    els.posterStyle.addEventListener('click', cyclePosterStyle);
    els.main.addEventListener('click', onMainClick);
    bindPosterGestures();

    state.posterStyle = loadPosterStyle();
    syncPosterStyleUI();

    if (!resizeHooked) {
      resizeHooked = true;
      window.addEventListener('resize', () => {
        if (!state.open) return;
        if (state.posterOpen) { clampPosterPan(); paintPosterView(); }
        if (state.screen === 'champion') startConfetti(true);
      });
    }

    subscribePlayer();
  }

  /* ------------------------------------------------------------------ *
   * 播放器试听
   * ------------------------------------------------------------------ */
  function subscribePlayer() {
    if (playerHooked) return;
    const P = mainPlayer();
    if (!P || typeof P.on !== 'function') return;
    playerHooked = true;
    const sync = () => syncPlaybackUI();
    P.on('trackchange', sync);
    P.on('playstate', sync);
    P.on('source', sync);
  }

  function queueMatches(list) {
    const P = mainPlayer();
    if (!P) return false;
    const q = Array.isArray(P.state.queue) ? P.state.queue : [];
    if (q.length !== list.length) return false;
    for (let i = 0; i < q.length; i++) {
      if (trackKey(q[i]) !== trackKey(list[i])) return false;
    }
    return true;
  }

  function currentTrackKey() {
    const P = mainPlayer();
    if (!P) return '';
    const q = P.state.queue || [];
    const cur = q[P.state.index];
    return cur ? trackKey(cur) : '';
  }

  function syncPlaybackUI() {
    if (!state.open || !root) return;
    const P = mainPlayer();
    const key = currentTrackKey();
    const playing = !!(P && P.state.playing);
    root.querySelectorAll('.wc-track').forEach((btn) => {
      const on = btn.dataset.key && btn.dataset.key === key;
      btn.classList.toggle('is-current', on);
      btn.classList.toggle('is-playing', on && playing);
      btn.setAttribute('aria-pressed', on && playing ? 'true' : 'false');
    });
  }

  /** 点封面：队列已经是这一份且当前就是这首 → 暂停/续播；否则换队列从这首开始 */
  function auditionTrack(track) {
    const P = mainPlayer();
    if (!P || typeof P.playQueue !== 'function') { toast('播放器还没准备好，刷新页面后再试'); return; }
    const idx = state.trackIndex.get(trackKey(track));
    if (idx == null || idx < 0) { toast('这首歌不在本届参赛名单里'); return; }
    const same = queueMatches(state.tracks);
    const curKey = currentTrackKey();
    if (same && curKey === trackKey(track)) {
      P.toggle();
      return;
    }
    P.playQueue(state.tracks, idx);
  }

  /** 判定胜者时顺手开始播放：正在放这首就不动，暂停中就续播，放别的就切队列 */
  function ensurePlaying(track) {
    const P = mainPlayer();
    if (!P || typeof P.playQueue !== 'function') return;
    const idx = state.trackIndex.get(trackKey(track));
    if (idx == null || idx < 0) return;
    const curKey = currentTrackKey();
    if (curKey === trackKey(track)) {
      if (!P.state.playing && typeof P.toggle === 'function') P.toggle();
      return;
    }
    P.playQueue(state.tracks, idx);
  }

  /* ------------------------------------------------------------------ *
   * 选歌单
   * ------------------------------------------------------------------ */
  function showPicker() {
    if (!built) build();
    stopConfetti();
    state.currentMatch = null;
    state.locked = false;
    clearTimers();
    setScreen('pick');
    root.classList.remove('is-champion');
    els.meta.textContent = '选一张歌单，开打';

    els.main.innerHTML = '';
    const sec = el('section', 'wc-screen wc-pick');
    sec.innerHTML = `
      <div class="wc-pick__intro">
        <p class="wc-kicker">PICK YOUR PLAYLIST</p>
        <h3 class="wc-pick__h">选一张歌单，开打</h3>
        <p class="wc-pick__sub">随机抽签 · 一对一淘汰 · 选出这个歌单里最喜欢的一首</p>
      </div>
      <div class="wc-tabs" id="wc-tabs" role="tablist" aria-label="歌单平台"></div>
      <div class="wc-queue" id="wc-queue"></div>
      <div class="wc-pick__list" id="wc-plays"></div>
    `;
    els.main.appendChild(sec);
    els.tabs = sec.querySelector('#wc-tabs');
    els.queue = sec.querySelector('#wc-queue');
    els.plays = sec.querySelector('#wc-plays');

    paintTabs();
    paintQueueCard();
    paintTab(state.tab, false);
    syncPlaybackUI();
    focusFirst();
  }

  function clearTimers() {
    if (state.drawTimer) { clearTimeout(state.drawTimer); state.drawTimer = null; }
    if (state.advanceTimer) { clearTimeout(state.advanceTimer); state.advanceTimer = null; }
  }

  function focusFirst() {
    if (!root) return;
    const target = els.main.querySelector('.wc-tabs button, #wc-queue, .wc-track');
    if (target) try { target.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function setScreen(name) {
    state.screen = name;
    root.dataset.screen = name;
    if (name !== 'champion') stopConfetti();
  }

  function paintTabs() {
    if (!els.tabs) return;
    els.tabs.innerHTML = '';
    TABS.forEach((t) => {
      const b = el('button', 'wc-tab' + (state.tab === t.id ? ' is-active' : ''), t.name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.tab === t.id ? 'true' : 'false');
      b.dataset.wcTab = t.id;
      els.tabs.appendChild(b);
    });
  }

  function paintQueueCard() {
    if (!els.queue) return;
    const P = mainPlayer();
    const q = P && Array.isArray(P.state.queue) ? P.state.queue : [];
    const n = q.length;
    const ok = n >= MIN_QUEUE;
    els.queue.innerHTML = '';
    const card = el('button', 'wc-queue__card' + (ok ? ' is-on' : ' is-off'));
    card.type = 'button';
    card.disabled = !ok;
    card.dataset.wcQueue = '1';

    const ico = el('span', 'wc-queue__ico');
    ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.5l10-2V16"/>
      <circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`;
    const body = el('span', 'wc-queue__body');
    body.appendChild(el('b', 'wc-queue__name', '当前播放队列'));
    body.appendChild(el('small', 'wc-queue__sub',
      ok ? `${n} 首 · 不用联网，直接开赛` : `当前只有 ${n} 首，至少 ${MIN_QUEUE} 首才能开赛`));
    const go = el('span', 'wc-queue__go', ok ? '用它开赛 →' : '还没凑够');
    card.appendChild(ico);
    card.appendChild(body);
    card.appendChild(go);
    els.queue.appendChild(card);
  }

  function paintTab(pid, force) {
    state.tab = pid;
    paintTabs();
    if (!els.plays) return;
    const c = state.cache[pid];
    if (force || !c || c.status === 'idle') {
      loadTab(pid, true);
      return;
    }
    if (c.status === 'loading') {
      renderListState(pid, 'load', `正在载入${SOURCE_LABELS[pid] || ''}的歌单…`);
      return;
    }
    if (c.status === 'error') {
      renderListState(pid, 'error', c.error || '载入失败', true);
      return;
    }
    if (!c.items.length) {
      renderListState(pid, 'empty', c.note || `还没有${SOURCE_LABELS[pid] || ''}的歌单`);
      return;
    }
    renderPlaylistGrid(pid, c.items);
  }

  function renderListState(pid, kind, text, retry) {
    if (!els.plays) return;
    els.plays.innerHTML = '';
    const box = el('div', 'wc-state wc-state--' + kind);
    if (kind === 'load') box.appendChild(el('i', 'wc__spinner'));
    box.appendChild(el('p', 'wc-state__text', text));
    if (retry) {
      const b = el('button', 'wc-btn wc-btn--sm wc-btn--ghost', '重新载入');
      b.type = 'button';
      b.dataset.wcRetry = pid;
      box.appendChild(b);
    }
    els.plays.appendChild(box);
  }

  function renderPlaylistGrid(pid, items) {
    if (!els.plays) return;
    state.plMap.clear();
    els.plays.innerHTML = '';
    const grid = el('div', 'wc-plgrid');
    items.forEach((p) => {
      const key = 'p' + (++state.plSeq);
      state.plMap.set(key, { p, pid });
      const card = el('button', 'wc-pl');
      card.type = 'button';
      card.dataset.wcPl = key;
      card.appendChild(makeCover(p, 'wc-pl__cover', 400));
      const body = el('span', 'wc-pl__body');
      body.appendChild(el('b', 'wc-pl__name', p.name || '未命名歌单'));
      const sub = p.trackCount ? `${p.trackCount} 首` : '';
      const who = p.creator && p.creator.nickname ? p.creator.nickname : '';
      body.appendChild(el('small', 'wc-pl__sub', [sub, who].filter(Boolean).join(' · ') || '歌单'));
      card.appendChild(body);
      card.appendChild(el('span', 'wc-pl__go', '开赛 →'));
      grid.appendChild(card);
    });
    els.plays.appendChild(grid);
  }

  function friendlyError(e, pid) {
    const msg = String((e && e.message) || e || '未知错误');
    if (/HTTP 5\d\d/.test(msg)) {
      return `载入失败：${msg}（本机服务或${SOURCE_LABELS[pid] || ''}边车可能没起来）`;
    }
    return '载入失败：' + msg;
  }

  async function loadTab(pid, force) {
    if (!els.plays) return;
    const old = state.cache[pid];
    if (!force && old && (old.status === 'loading' || old.status === 'ready')) return;
    const cache = { status: 'loading', items: [], error: '', note: '', seq: ++state.tabSeq };
    state.cache[pid] = cache;
    if (state.tab === pid) renderListState(pid, 'load', `正在载入${SOURCE_LABELS[pid] || ''}的歌单…`);

    const alive = () => state.open && state.cache[pid] === cache;
    try {
      let items = [];
      let note = '';

      if (typeof API === 'undefined' || !API) throw new Error('接口层还没准备好，请刷新页面');

      if (pid === 'netease') {
        const s = await API.session();
        if (!alive()) return;
        if (!s || !s.loggedIn || !s.profile || !s.profile.userId) {
          cache.status = 'empty';
          cache.note = '先在设置里登录网易云，才能看到你的歌单';
          if (state.tab === pid) paintTab(pid, false);
          return;
        }
        const d = await API.userPlaylists(s.profile.userId);
        if (!alive()) return;
        const list = ((d && d.playlists) || []).filter((p) => p && p.id);
        /* 「我喜欢的音乐」是 specialType 5 的系统歌单，排最前 */
        items = list.slice().sort((a, b) => (b.specialType === 5 ? 1 : 0) - (a.specialType === 5 ? 1 : 0));
        if (!items.length) note = '你的网易云账号下还没有歌单';
      } else if (pid === 'qq') {
        const d = await API.qqUserPlaylists();
        if (!alive()) return;
        items = ((d && d.playlists) || []).filter((p) => p && p.id);
        if (!items.length) note = (d && d.error) || 'QQ 音乐没有返回歌单（可能还没登录）';
      } else if (pid === 'kugou') {
        const d = await API.kugouUserPlaylists();
        if (!alive()) return;
        items = ((d && d.playlists) || []).filter((p) => p && p.id);
        if (!items.length) note = (d && d.error) || '酷狗账号下还没有收藏的歌单';
      } else if (pid === 'qishui') {
        const d = await API.qishuiUserPlaylists();
        if (!alive()) return;
        items = ((d && d.playlists) || []).filter((p) => p && p.id);
        if (!items.length) note = (d && d.error) || '汽水没有返回歌单（可能还没登录）';
      } else if (pid === 'bodian') {
        const d = await API.bodianUserPlaylists();
        if (!alive()) return;
        items = ((d && d.playlists) || []).filter((p) => p && p.id);
        if (!items.length) note = (d && d.error) || '波点没有返回歌单（可能还没登录）';
      }

      cache.status = items.length ? 'ready' : 'empty';
      cache.items = items;
      cache.note = note;
      if (state.tab === pid) paintTab(pid, false);
    } catch (e) {
      if (!alive()) return;
      cache.status = 'error';
      cache.error = friendlyError(e, pid);
      if (state.tab === pid) paintTab(pid, false);
    }
  }

  async function fetchPlaylistTracks(p, pid) {
    if (typeof API === 'undefined' || !API) throw new Error('接口层还没准备好，请刷新页面');
    if (pid === 'qq') return API.qqPlaylistDetail(p.id, p.dirId);
    if (pid === 'kugou') return API.kugouPlaylistTracksAll(p.id);
    if (pid === 'qishui') return API.qishuiPlaylistTracks(p.id, 100);
    if (pid === 'bodian') return API.bodianPlaylistTracks(p.id, 100, p.sourceType, p.trackCount);
    return API.playlistDetail(p.id);
  }

  async function choosePlaylist(p, pid) {
    if (state.busy) return;
    const seq = ++state.pickSeq;
    state.busy = true;
    showBusy(`正在读取「${p.name || '歌单'}」的曲目…`);
    try {
      const d = await fetchPlaylistTracks(p, pid);
      if (seq !== state.pickSeq || !state.open) return;
      const tracks = (d && d.tracks) || [];
      if (d && d.error && !tracks.length) throw new Error(d.error);
      if (!tracks.length) throw new Error('这张歌单没有曲目');
      startSession(p.name || '未命名歌单', tracks, pid);
    } catch (e) {
      if (seq !== state.pickSeq) return;
      toast('取歌单曲目失败：' + ((e && e.message) || e));
    } finally {
      if (seq === state.pickSeq) {
        state.busy = false;
        hideBusy();
      }
    }
  }

  function showBusy(text) {
    if (!els.busy) return;
    els.busyText.textContent = text || '正在载入…';
    els.busy.hidden = false;
    root.setAttribute('aria-busy', 'true');
  }

  function hideBusy() {
    if (!els.busy) return;
    els.busy.hidden = true;
    root.removeAttribute('aria-busy');
  }

  /* ------------------------------------------------------------------ *
   * 会话 / 参赛曲目
   * ------------------------------------------------------------------ */
  function normalizeTracks(raw, fallbackSource) {
    const out = [];
    const seen = new Set();
    for (const t of raw || []) {
      if (!t || typeof t !== 'object') continue;
      if (t.id == null || String(t.id) === '') continue;
      const source = t.source || fallbackSource || 'netease';
      const key = `${source}:${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...t, source, name: trackName(t), artists: trackArtist(t), cover: t.cover || t.albumPic || '' });
    }
    return out;
  }

  function startSession(name, rawTracks, source) {
    const list = normalizeTracks(rawTracks, source);
    if (list.length < MIN_TRACKS) {
      showPicker();
      toast(`至少要 ${MIN_TRACKS} 首才能开赛（这张歌单只有 ${list.length} 首）`);
      return;
    }
    const allCount = list.length;
    const use = allCount > MAX_TRACKS ? shuffle(list).slice(0, MAX_TRACKS) : list;
    state.sessionName = name || '未命名歌单';
    state.sessionSource = source || '';
    state.tracks = shuffle(use);
    state.allCount = allCount;
    state.trackIndex = new Map();
    state.tracks.forEach((t, i) => state.trackIndex.set(trackKey(t), i));
    state.matchesPlayed = 0;
    state.locked = false;
    state.currentMatch = null;
    state.poster = null;
    buildPlan();
    showDraw();
  }

  /* ------------------------------------------------------------------ *
   * 赛制生成
   * ------------------------------------------------------------------ */
  function makeKoStages(participantCount) {
    const p = nextPow2(Math.max(2, participantCount));
    const stages = [];
    let size = p;
    while (size > 1) {
      stages.push({
        size,
        colName: colName(size),
        matchLabel: roundName(size),
        slots: new Array(size).fill(null),
        slotEls: [],
      });
      size /= 2;
    }
    return stages;
  }

  /** 首轮槽位：轮空对固定「一 track + 一个 null」，其余两两成对，然后打乱对的顺序 */
  function makeFirstRoundSlots(tracks, byes) {
    const pairs = [];
    let idx = 0;
    for (let i = 0; i < byes; i++) pairs.push([tracks[idx++], null]);
    while (idx < tracks.length) pairs.push([tracks[idx++], tracks[idx++]]);
    const mixed = shuffle(pairs);
    const slots = [];
    mixed.forEach((pair) => { slots.push(pair[0] || null, pair[1] || null); });
    return slots;
  }

  function buildMatchesFromSlots(plan, slots, group) {
    let current = slots.map((t) => (t ? { kind: 'track', track: t } : null));
    const startLen = plan.matches.length;
    const stages = plan.koStages;

    for (let round = 0; current.length > 1; round++) {
      const stage = group ? null : stages[round];
      const nextStage = group ? null : stages[round + 1];
      const next = new Array(current.length / 2).fill(null);

      for (let i = 0; i < current.length; i += 2) {
        const A = current[i];
        const B = current[i + 1];
        const ni = i / 2;

        if (!A && !B) { next[ni] = null; continue; }
        if (!A || !B) {
          const keep = A || B;
          next[ni] = keep;
          if (nextStage && keep.kind === 'track') nextStage.slots[ni] = keep.track;
          continue;
        }

        const m = {
          a: A.kind === 'track' ? A.track : null,
          b: B.kind === 'track' ? B.track : null,
          label: group ? `小组赛 · ${group.letter}组` : stage.matchLabel,
          group: group || null,
          isGroup: !!group,
          isGroupFinal: false,
          isFinal: !group && current.length === 2,
          stageIndex: group ? -1 : round,
          matchIndex: ni,
          nextStageIndex: group ? -1 : round + 1,
          roundTheme: group ? 'group' : themeFor(current.length),
          next: null,
          winner: null,
          loser: null,
          done: false,
        };
        if (A.kind === 'match') A.match.next = { match: m, slot: 'a' };
        if (B.kind === 'match') B.match.next = { match: m, slot: 'b' };
        plan.matches.push(m);
        next[ni] = { kind: 'match', match: m };
      }
      current = next;
    }

    if (group && plan.matches.length > startLen) {
      plan.matches[plan.matches.length - 1].isGroupFinal = true;
    }
    return current[0] || null;
  }

  function buildPlan() {
    const tracks = state.tracks.slice();
    const n = tracks.length;
    const G = groupCountFor(n);
    const plan = {
      n,
      total: n - 1,
      allCount: state.allCount,
      groupCount: G,
      groups: [],
      matches: [],
      nextIndex: 0,
      koStages: makeKoStages(G > 0 ? G : n),
      koBuilt: false,
      groupDone: false,
      champion: null,
      playerName: state.sessionName,
      truncated: state.allCount > n,
    };

    if (G > 0) {
      const shuffled = shuffle(tracks);
      for (let i = 0; i < G; i++) {
        plan.groups.push({
          letter: LETTERS[i],
          tracks: [],
          winner: null,
          finalMatch: null,
          slotEl: null,
        });
      }
      shuffled.forEach((t, i) => plan.groups[i % G].tracks.push(t));
      plan.groups.forEach((g) => {
        g.tracks = shuffle(g.tracks);
        if (g.tracks.length <= 1) {
          g.winner = g.tracks[0] || null;
          return;
        }
        const p = nextPow2(g.tracks.length);
        const slots = makeFirstRoundSlots(g.tracks.slice(), p - g.tracks.length);
        const startLen = plan.matches.length;
        buildMatchesFromSlots(plan, slots, g);
        const own = plan.matches.slice(startLen);
        g.finalMatch = own[own.length - 1] || null;
        if (g.finalMatch) g.finalMatch.isGroupFinal = true;
      });
    } else {
      const p = nextPow2(n);
      const slots = makeFirstRoundSlots(tracks, p - n);
      plan.koStages[0].slots = slots.slice();
      buildMatchesFromSlots(plan, slots, null);
      plan.koBuilt = true;
    }

    champImg = null;   // 新签表不能复用上一届冠军的封面缓存
    state.plan = plan;
    state.planSeq++;
    return plan;
  }

  function seedKnockout(plan) {
    if (plan.koBuilt) return true;
    const winners = plan.groups.map((g) => g.winner).filter(Boolean);
    if (!winners.length) return false;
    const stage0 = plan.koStages[0];
    const p = stage0.size;
    const byes = p - winners.length;
    const slots = makeFirstRoundSlots(shuffle(winners), Math.max(0, byes));
    stage0.slots = slots.slice();
    for (let r = 1; r < plan.koStages.length; r++) {
      plan.koStages[r].slots = new Array(plan.koStages[r].size).fill(null);
      plan.koStages[r].slotEls.forEach((elx, i) => paintSlot(elx, null, i));
    }
    paintStageSlots(plan, 0);
    buildMatchesFromSlots(plan, slots, null);
    plan.koBuilt = true;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 抽签揭晓页
   * ------------------------------------------------------------------ */
  function showDraw() {
    if (!built) build();
    stopConfetti();
    root.classList.remove('is-champion');
    setScreen('draw');
    clearTimers();
    const plan = state.plan;
    els.meta.textContent = `歌单 · ${state.sessionName}`;

    els.main.innerHTML = '';
    const sec = el('section', 'wc-screen wc-draw');
    sec.innerHTML = `
      <div class="wc-draw__head">
        <p class="wc-kicker">DRAW REVEAL</p>
        <h3 class="wc-draw__h">抽签揭晓</h3>
        <p class="wc-draw__stats" id="wc-draw-stats"></p>
      </div>
      <div class="wc-groups" id="wc-groups"></div>
      <div class="wc-draw__actions">
        <button class="wc-btn wc-btn--ghost" id="wc-redraw" type="button">重新抽签</button>
        <button class="wc-btn wc-btn--go" id="wc-start" type="button">开赛 <span aria-hidden="true">→</span></button>
      </div>
      <p class="wc-draw__hint">1.6 秒后自动开赛，也可以直接点「开赛」</p>
    `;
    els.main.appendChild(sec);
    els.groups = sec.querySelector('#wc-groups');
    els.drawStats = sec.querySelector('#wc-draw-stats');

    const stats = [];
    stats.push(plan.truncated ? `参赛 ${plan.n} / 共 ${plan.allCount} 首` : `参赛 ${plan.n} 首`);
    if (plan.groupCount) stats.push(`${plan.groupCount} 组`);
    stats.push(`共 ${plan.total} 场`);
    els.drawStats.textContent = stats.join(' · ');

    if (plan.groupCount) {
      plan.groups.forEach((g, gi) => {
        const card = el('article', 'wc-group');
        card.style.setProperty('--i', String(gi));
        const head = el('div', 'wc-group__head');
        head.appendChild(el('b', 'wc-group__letter', g.letter));
        head.appendChild(el('span', 'wc-group__meta', `${g.tracks.length} 首 · 出线 1`));
        card.appendChild(head);
        const thumbs = el('div', 'wc-group__thumbs');
        g.tracks.forEach((t) => {
          const th = makeCover(t, 'wc-thumb', 160);
          th.title = `${trackName(t)} — ${trackArtist(t)}`;
          thumbs.appendChild(th);
        });
        card.appendChild(thumbs);
        card.appendChild(el('span', 'wc-group__line', ''));
        els.groups.appendChild(card);
      });
    } else {
      const card = el('article', 'wc-group wc-group--solo');
      const head = el('div', 'wc-group__head');
      head.appendChild(el('b', 'wc-group__letter', 'KO'));
      head.appendChild(el('span', 'wc-group__meta', `直接淘汰赛 · ${plan.n} 首`));
      card.appendChild(head);
      const thumbs = el('div', 'wc-group__thumbs wc-group__thumbs--all');
      state.tracks.forEach((t) => {
        const th = makeCover(t, 'wc-thumb', 160);
        th.title = `${trackName(t)} — ${trackArtist(t)}`;
        thumbs.appendChild(th);
      });
      card.appendChild(thumbs);
      card.appendChild(el('span', 'wc-group__line', ''));
      els.groups.appendChild(card);
    }

    if (!REDUCED) {
      els.groups.querySelectorAll('.wc-group').forEach((card, i) => {
        try {
          card.animate([
            { opacity: 0, transform: 'translateY(26px) scale(.92) rotate(-2deg)' },
            { opacity: 1, transform: 'none' },
          ], { duration: 420, delay: i * 55, easing: 'cubic-bezier(.2,1.25,.3,1)', fill: 'backwards' });
        } catch { /* 老内核不支持 WAAPI */ }
      });
    }

    const go = () => {
      clearTimers();
      startBattle();
    };
    const startBtn = sec.querySelector('#wc-start');
    const redrawBtn = sec.querySelector('#wc-redraw');
    startBtn.addEventListener('click', go);
    redrawBtn.addEventListener('click', () => {
      clearTimers();
      state.matchesPlayed = 0;
      buildPlan();
      showDraw();
    });

    const thisPlan = plan;
    state.drawTimer = setTimeout(() => {
      if (!state.open || state.screen !== 'draw' || state.plan !== thisPlan) return;
      startBattle();
    }, 1600);
  }

  /* ------------------------------------------------------------------ *
   * 比赛页
   * ------------------------------------------------------------------ */
  function startBattle() {
    if (!state.open || !state.plan) return;
    clearTimers();
    stopConfetti();
    root.classList.remove('is-champion');
    setScreen('battle');
    state.matchesPlayed = 0;
    state.locked = false;
    state.currentMatch = null;
    state.plan.nextIndex = 0;
    state.plan.champion = null;
    els.meta.textContent = `歌单 · ${state.sessionName}`;

    els.main.innerHTML = '';
    const sec = el('section', 'wc-screen wc-battle');
    sec.dataset.round = 'group';
    sec.innerHTML = `
      <div class="wc-battle__top">
        <div class="wc-round">
          <span class="wc-round__name" id="wc-round-name">小组赛</span>
          <span class="wc-round__no" id="wc-match-no"></span>
        </div>
        <div class="wc-progress" id="wc-progress" role="progressbar"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      </div>
      <div class="wc-arena">
        <article class="wc-fighter wc-fighter--l" id="wc-fighter-0" data-side="0"></article>
        <div class="wc-vs" aria-hidden="true"><span>VS</span></div>
        <article class="wc-fighter wc-fighter--r" id="wc-fighter-1" data-side="1"></article>
      </div>
      <div class="wc-strip" id="wc-strip" aria-label="赛程"></div>
      <p class="wc-keys">← / → 试听 · 1 / 2 选胜 · Esc 退出</p>
    `;
    els.main.appendChild(sec);
    els.battle = sec;
    els.f0 = sec.querySelector('#wc-fighter-0');
    els.f1 = sec.querySelector('#wc-fighter-1');
    els.roundName = sec.querySelector('#wc-round-name');
    els.matchNo = sec.querySelector('#wc-match-no');
    els.progress = sec.querySelector('#wc-progress');
    els.progressBar = els.progress.querySelector('i');
    els.strip = sec.querySelector('#wc-strip');

    renderStrip();
    nextMatch();
  }

  function renderStrip() {
    if (!els.strip || !state.plan) return;
    const plan = state.plan;
    els.strip.innerHTML = '';

    if (plan.groupCount) {
      const col = el('div', 'wc-strip__col wc-strip__col--group');
      col.appendChild(el('span', 'wc-strip__name', '小组赛'));
      const slots = el('div', 'wc-strip__slots');
      plan.groups.forEach((g) => {
        const slot = el('span', 'wc-strip__slot wc-strip__slot--group');
        slot.dataset.group = g.letter;
        g.slotEl = slot;
        slots.appendChild(slot);
        paintGroupSlot(g);
      });
      col.appendChild(slots);
      els.strip.appendChild(col);
    }

    plan.koStages.forEach((stage, si) => {
      const col = el('div', 'wc-strip__col');
      col.appendChild(el('span', 'wc-strip__name', stage.colName));
      const slots = el('div', 'wc-strip__slots');
      stage.slotEls = [];
      for (let i = 0; i < stage.size; i++) {
        const slot = el('span', 'wc-strip__slot');
        stage.slotEls.push(slot);
        slots.appendChild(slot);
        paintSlot(slot, stage.slots[i] || null, i);
      }
      col.appendChild(slots);
      els.strip.appendChild(col);
    });

    const champCol = el('div', 'wc-strip__col wc-strip__col--champ');
    champCol.appendChild(el('span', 'wc-strip__name', '冠军'));
    const champSlot = el('span', 'wc-strip__slot wc-strip__slot--champ');
    els.champSlot = champSlot;
    paintSlot(champSlot, plan.champion || null, 0, true);
    const champWrap = el('div', 'wc-strip__slots');
    champWrap.appendChild(champSlot);
    champCol.appendChild(champWrap);
    els.strip.appendChild(champCol);
  }

  function paintSlot(slotEl, track, index, gold) {
    if (!slotEl) return;
    slotEl.innerHTML = '';
    slotEl.classList.toggle('is-filled', !!track);
    if (gold) slotEl.classList.add('wc-strip__slot--champ');
    if (!track) {
      const ph = el('i', 'wc-strip__ph', '?');
      ph.setAttribute('aria-hidden', 'true');
      slotEl.appendChild(ph);
      slotEl.title = '';
      return;
    }
    const imgWrap = makeCover(track, 'wc-strip__cover', 100);
    slotEl.appendChild(imgWrap);
    slotEl.title = `${trackName(track)} — ${trackArtist(track)}`;
  }

  function paintGroupSlot(g) {
    if (!g || !g.slotEl) return;
    const slot = g.slotEl;
    slot.innerHTML = '';
    slot.classList.toggle('is-decided', !!g.winner);
    const letter = el('b', 'wc-strip__letter', g.letter);
    slot.appendChild(letter);
    if (g.winner) slot.appendChild(makeCover(g.winner, 'wc-strip__cover', 100));
    else slot.appendChild(el('i', 'wc-strip__ph', '?'));
    slot.title = g.winner ? `${g.letter}组出线：${trackName(g.winner)}` : `${g.letter}组`;
  }

  function paintStageSlots(plan, stageIndex) {
    const stage = plan.koStages[stageIndex];
    if (!stage) return;
    stage.slots.forEach((track, i) => {
      if (stage.slotEls[i]) paintSlot(stage.slotEls[i], track || null, i, false);
    });
  }

  function fillStageSlot(stageIndex, slotIndex, track) {
    const stage = state.plan && state.plan.koStages[stageIndex];
    if (!stage || slotIndex < 0 || slotIndex >= stage.size) return;
    stage.slots[slotIndex] = track;
    paintSlot(stage.slotEls[slotIndex], track, slotIndex, false);
  }

  function nextMatch() {
    const plan = state.plan;
    if (!plan) return;
    state.locked = false;

    for (let guard = 0; guard < 6; guard++) {
      if (plan.nextIndex >= plan.matches.length) {
        if (plan.groupCount && !plan.koBuilt) {
          if (!seedKnockout(plan)) { toast('出线名单异常，无法继续赛程'); return; }
          continue;
        }
        if (plan.champion) { showChampion(); }
        else { toast('赛程结束了，但没有决出冠军'); }
        return;
      }

      const m = plan.matches[plan.nextIndex++];
      if (!m.a || !m.b) continue;   // 轮空场不展示（正常构建下不会出现）
      state.currentMatch = m;
      paintMatch(m);
      return;
    }
    toast('赛程异常，请重新抽签');
  }

  function paintMatch(m) {
    const plan = state.plan;
    if (!plan || !els.battle) return;
    els.battle.dataset.round = m.roundTheme || 'group';
    els.roundName.textContent = m.label;
    updateProgress();

    paintFighter(0, m.a, m);
    paintFighter(1, m.b, m);
    syncPlaybackUI();

    if (!REDUCED) {
      [els.f0, els.f1].forEach((node, i) => {
        if (!node) return;
        try {
          node.animate([
            { opacity: 0, transform: `translateY(22px) scale(.96) rotate(${i ? 2 : -2}deg)` },
            { opacity: 1, transform: 'none' },
          ], { duration: 360, easing: 'cubic-bezier(.2,1.25,.3,1)' });
        } catch { /* noop */ }
      });
    }
  }

  function paintFighter(side, track, m) {
    const card = side === 0 ? els.f0 : els.f1;
    if (!card) return;
    card.classList.remove('is-win', 'is-ko');
    card.innerHTML = '';

    const tag = el('span', 'wc-fighter__tag', m.group ? `${m.group.letter}组` : m.label);
    card.appendChild(tag);

    const btn = el('button', 'wc-track');
    btn.type = 'button';
    btn.dataset.side = String(side);
    btn.dataset.key = trackKey(track);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${trackName(track)}，点封面试听`);

    const cover = makeCover(track, 'wc-cover wc-fighter__cover', 600);
    const badge = el('span', 'wc-track__badge');
    badge.innerHTML = `
      <svg class="wc-ico-play" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"
        aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>
      <svg class="wc-ico-pause" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"
        aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/></svg>`;
    cover.appendChild(badge);

    const eq = el('span', 'wc-track__eq');
    eq.innerHTML = '<i></i><i></i><i></i><i></i>';
    cover.appendChild(eq);
    cover.appendChild(el('span', 'wc-track__hint', '点封面试听'));

    const info = el('span', 'wc-fighter__info');
    info.appendChild(el('b', 'wc-fighter__name', trackName(track)));
    info.appendChild(el('small', 'wc-fighter__artist', trackArtist(track)));

    btn.appendChild(cover);
    btn.appendChild(info);
    card.appendChild(btn);

    const pick = el('button', 'wc-pick');
    pick.type = 'button';
    pick.dataset.side = String(side);
    pick.appendChild(el('span', 'wc-pick__label', '就它了'));
    pick.appendChild(el('span', 'wc-pick__arrow', '→'));
    card.appendChild(pick);

    const win = el('span', 'wc-stamp wc-stamp--win', 'WIN');
    win.setAttribute('aria-hidden', 'true');
    const ko = el('span', 'wc-stamp wc-stamp--ko', 'KO');
    ko.setAttribute('aria-hidden', 'true');
    card.appendChild(win);
    card.appendChild(ko);
  }

  function updateProgress() {
    const plan = state.plan;
    if (!plan) return;
    const total = plan.total;
    const done = Math.min(state.matchesPlayed, total);
    const x = Math.min(done + 1, total);
    if (els.matchNo) els.matchNo.textContent = `第 ${x} / ${total} 场`;
    if (els.progress) {
      const pct = total > 0 ? (done / total) * 100 : 0;
      els.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
      els.progress.setAttribute('aria-valuemax', '100');
    }
    if (els.progressBar) els.progressBar.style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
  }

  function pickWinner(side) {
    const m = state.currentMatch;
    if (!m || state.locked) return;
    const winner = side === 0 ? m.a : m.b;
    const loser = side === 0 ? m.b : m.a;
    if (!winner || !loser) return;

    const winnerCard = side === 0 ? els.f0 : els.f1;
    const loserCard = side === 0 ? els.f1 : els.f0;
    if (!winnerCard || !loserCard) return;

    state.locked = true;
    const plan = state.plan;
    const coverEl = winnerCard.querySelector('.wc-fighter__cover');
    const fromRect = coverEl ? coverEl.getBoundingClientRect() : null;

    ensurePlaying(winner);

    winnerCard.classList.add('is-win');
    loserCard.classList.add('is-ko');

    resolveMatch(m, winner, loser);

    const target = targetElForMatch(m);
    if (fromRect && target) flyWinner(winner, fromRect, target);

    const wait = m.isFinal ? TOTAL_ROUND_MS : NEXT_READY_MS;
    state.advanceTimer = setTimeout(() => {
      if (!state.open || state.plan !== plan) return;
      state.locked = false;
      if (m.isFinal) { showChampion(); return; }
      nextMatch();
    }, wait);
  }

  function resolveMatch(m, winner, loser) {
    const plan = state.plan;
    m.winner = winner;
    m.loser = loser;
    m.done = true;
    state.matchesPlayed++;

    if (m.next) {
      if (m.next.slot === 'a') m.next.match.a = winner;
      else m.next.match.b = winner;
    }

    if (m.isGroupFinal && m.group) {
      m.group.winner = winner;
      paintGroupSlot(m.group);
      plan.groupDone = plan.groups.every((g) => !!g.winner);
    } else if (m.isFinal) {
      plan.champion = winner;
      if (els.champSlot) paintSlot(els.champSlot, winner, 0, true);
    } else if (m.stageIndex >= 0) {
      fillStageSlot(m.nextStageIndex, m.matchIndex, winner);
    }

    updateProgress();
  }

  function targetElForMatch(m) {
    if (m.group) return m.group.slotEl;
    if (m.isFinal) return els.champSlot;
    const plan = state.plan;
    const stage = plan && plan.koStages[m.nextStageIndex];
    if (!stage) return null;
    return stage.slotEls[m.matchIndex] || null;
  }

  function flyWinner(track, fromRect, targetEl) {
    if (REDUCED || !fromRect || !targetEl) return;
    const strip = els.strip;
    if (strip) {
      const sr = strip.getBoundingClientRect();
      const tr0 = targetEl.getBoundingClientRect();
      if (tr0.left < sr.left + 6 || tr0.right > sr.right - 6) {
        strip.scrollLeft += (tr0.left - sr.left) - (sr.width - tr0.width) / 2;
      }
    }
    const tr = targetEl.getBoundingClientRect();
    if (!tr.width || !tr.height) return;

    const wrap = el('span', 'wc-fly');
    const img = new Image();
    const url = coverOf(track, 200);
    if (url) img.src = url;
    img.alt = '';
    wrap.appendChild(img);
    wrap.style.left = `${fromRect.left}px`;
    wrap.style.top = `${fromRect.top}px`;
    wrap.style.width = `${fromRect.width}px`;
    wrap.style.height = `${fromRect.height}px`;
    root.appendChild(wrap);

    const dx = (tr.left + tr.width / 2) - (fromRect.left + fromRect.width / 2);
    const dy = (tr.top + tr.height / 2) - (fromRect.top + fromRect.height / 2);
    const scale = Math.max(0.12, Math.min(1, tr.width / Math.max(1, fromRect.width)));

    const anim = (() => {
      try {
        return wrap.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) scale(${scale})`, opacity: 0.95 },
        ], { duration: 420, easing: 'cubic-bezier(.2,1.25,.3,1)', fill: 'forwards' });
      } catch { return null; }
    })();

    const remove = () => { if (wrap.parentNode) wrap.remove(); };
    if (anim) anim.addEventListener('finish', remove);
    else setTimeout(remove, 420);
  }

  /* ------------------------------------------------------------------ *
   * 冠军页 + 彩带
   * ------------------------------------------------------------------ */
  function championPath(plan) {
    if (!plan || !plan.champion) return [];
    const key = trackKey(plan.champion);
    const out = [];
    plan.matches.forEach((m) => {
      if (m.winner && trackKey(m.winner) === key && m.loser) {
        out.push({ label: m.label, loser: m.loser });
      }
    });
    return out;
  }

  function showChampion() {
    const plan = state.plan;
    if (!plan || !plan.champion) return;
    maybeAutoBracketStyle();
    clearTimers();
    state.locked = false;
    setScreen('champion');
    root.classList.add('is-champion');
    els.meta.textContent = 'CHAMPION';
    const champ = plan.champion;
    const path = championPath(plan);

    els.main.innerHTML = '';
    const sec = el('section', 'wc-screen wc-champ');
    sec.innerHTML = `
      <div class="wc-champ__rays" aria-hidden="true"></div>
      <canvas class="wc-champ__confetti" id="wc-confetti" aria-hidden="true"></canvas>
      <div class="wc-champ__body">
        <p class="wc-champ__kicker">CHAMPION · 歌单冠军</p>
        <div class="wc-champ__frame" id="wc-champ-frame"></div>
        <h3 class="wc-champ__name" id="wc-champ-name"></h3>
        <p class="wc-champ__artist" id="wc-champ-artist"></p>
        <p class="wc-champ__stat" id="wc-champ-stat"></p>
        <div class="wc-champ__pathbox">
          <b class="wc-champ__pathh">晋级之路</b>
          <ol class="wc-champ__path" id="wc-champ-path"></ol>
        </div>
        <div class="wc-champ__actions">
          <button class="wc-btn wc-btn--gold" id="wc-poster-btn" type="button">生成海报</button>
          <button class="wc-btn wc-btn--go" id="wc-again" type="button">再来一届</button>
          <button class="wc-btn wc-btn--ghost" id="wc-champ-close" type="button">关闭</button>
        </div>
      </div>
    `;
    els.main.appendChild(sec);
    els.confetti = sec.querySelector('#wc-confetti');
    els.champFrame = sec.querySelector('#wc-champ-frame');
    els.champFrame.appendChild(makeCover(champ, 'wc-champ__cover', 900));

    sec.querySelector('#wc-champ-name').textContent = trackName(champ);
    sec.querySelector('#wc-champ-artist').textContent = trackArtist(champ);
    sec.querySelector('#wc-champ-stat').textContent =
      `击败 ${plan.total} 首 · ${plan.playerName || state.sessionName}`;

    const ol = sec.querySelector('#wc-champ-path');
    path.forEach((row, i) => {
      const li = el('li', 'wc-champ__prow');
      li.appendChild(el('span', 'wc-champ__pno', String(i + 1).padStart(2, '0')));
      li.appendChild(el('span', 'wc-champ__plabel', row.label));
      li.appendChild(el('span', 'wc-champ__pname', trackName(row.loser)));
      li.appendChild(el('span', 'wc-champ__partist', trackArtist(row.loser)));
      ol.appendChild(li);
    });
    if (!path.length) ol.appendChild(el('li', 'wc-champ__prow', '一路轮空，直接夺冠'));

    sec.querySelector('#wc-champ-close').addEventListener('click', close);
    sec.querySelector('#wc-again').addEventListener('click', () => {
      state.matchesPlayed = 0;
      state.locked = false;
      state.currentMatch = null;
      buildPlan();
      showDraw();
    });
    sec.querySelector('#wc-poster-btn').addEventListener('click', generatePoster);

    startConfetti();
    if (!REDUCED) {
      try {
        els.champFrame.animate([
          { opacity: 0, transform: 'rotate(-8deg) scale(.82)' },
          { opacity: 1, transform: 'rotate(-3deg) scale(1)' },
        ], { duration: 450, easing: 'cubic-bezier(.2,1.25,.3,1)' });
      } catch { /* noop */ }
    }
    const focusBtn = sec.querySelector('#wc-poster-btn');
    if (focusBtn) try { focusBtn.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function startConfetti(force) {
    const canvas = els.confetti;
    if (!canvas || REDUCED) return;
    if (state.confetti && !force) return;
    stopConfetti();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = canvas.clientWidth || root.clientWidth;
      const h = canvas.clientHeight || root.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();

    const colors = ['#C8FF3D', '#FFC53D', '#19C8FF', '#FF2D7A', '#FF8A00', '#FFFFFF'];
    const count = Math.min(120, Math.max(54, Math.round(canvas.clientWidth / 16)));
    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push({
        x: Math.random() * W(),
        y: -Math.random() * H() * 0.8,
        w: 5 + Math.random() * 9,
        h: 8 + Math.random() * 12,
        vy: 90 + Math.random() * 170,
        vx: -40 + Math.random() * 80,
        rot: Math.random() * Math.PI * 2,
        vr: -5 + Math.random() * 10,
        color: colors[i % colors.length],
      });
    }

    let last = 0;
    const tick = (ts) => {
      if (!state.open || state.screen !== 'champion' || document.hidden) {
        state.confettiRaf = 0;
        return;
      }
      state.confettiRaf = requestAnimationFrame(tick);
      if (!last) last = ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      const w = W();
      const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.vy += 36 * dt;
        if (p.y > h + 30) { p.y = -30; p.x = Math.random() * w; p.vy = 90 + Math.random() * 150; }
        if (p.x < -30) p.x = w + 20;
        if (p.x > w + 30) p.x = -20;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
    };
    state.confetti = { parts };
    state.confettiRaf = requestAnimationFrame(tick);
  }

  function stopConfetti() {
    if (state.confettiRaf) {
      cancelAnimationFrame(state.confettiRaf);
      state.confettiRaf = 0;
    }
    state.confetti = null;
  }

  /* ------------------------------------------------------------------ *
   * 海报
   * ------------------------------------------------------------------ */
  function loadImage(url, timeout) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const timer = setTimeout(() => finish(null), timeout || 7000);
      img.addEventListener('load', () => {
        clearTimeout(timer);
        finish(img.naturalWidth ? img : null);
      }, { once: true });
      img.addEventListener('error', () => {
        clearTimeout(timer);
        finish(null);
      }, { once: true });
      img.src = url;
    });
  }

  function dotPattern(ctx) {
    const c = document.createElement('canvas');
    c.width = 18;
    c.height = 18;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(18,18,26,0.13)';
    g.beginPath();
    g.arc(4, 4, 1.7, 0, Math.PI * 2);
    g.fill();
    return ctx.createPattern(c, 'repeat');
  }

  function wrapCanvasText(ctx, text, maxWidth, maxLines) {
    const chars = Array.from(String(text || ''));
    const lines = [];
    let line = '';
    let i = 0;
    while (i < chars.length && lines.length < maxLines) {
      const next = line + chars[i];
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = '';
        continue;
      }
      line = next;
      i++;
    }
    if (line) lines.push(line);
    if (i < chars.length && lines.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }

  /** 单行放不下就截断加省略号（调用前先设好 ctx.font） */
  function fitCanvasText(ctx, text, maxWidth) {
    const s = String(text == null ? '' : text);
    if (!s) return '';
    if (ctx.measureText(s).width <= maxWidth) return s;
    const chars = Array.from(s);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const trial = chars.slice(0, mid).join('') + '…';
      if (ctx.measureText(trial).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? chars.slice(0, lo).join('') + '…' : '…';
  }

  /** 手写圆角矩形：安卓 WebView 83 没有 ctx.roundRect */
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCoverInRect(ctx, img, x, y, w, h) {
    if (!img) return false;
    const iw = img.naturalWidth || img.width || 0;
    const ih = img.naturalHeight || img.height || 0;
    if (!iw || !ih) return false;
    const s = Math.min(iw, ih);
    ctx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, x, y, w, h);
    return true;
  }

  function drawCoverCircle(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (!drawCoverInRect(ctx, img, cx - r, cy - r, r * 2, r * 2)) {
      ctx.fillStyle = '#FFF6E8';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#12121A';
      ctx.font = '900 ' + Math.round(r * 0.9) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx, cy);
    }
    ctx.restore();
  }

  function drawPosterPaper(ctx, W, H) {
    ctx.fillStyle = '#FFF6E8';
    ctx.fillRect(0, 0, W, H);
    const pat = dotPattern(ctx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPosterRays(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 20; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 1500, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255,197,61,0.20)' : 'rgba(25,200,255,0.08)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSideBands(ctx, W, h) {
    ctx.fillStyle = '#19C8FF';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(150, 0); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FF2D7A';
    ctx.beginPath();
    ctx.moveTo(W, 0); ctx.lineTo(W - 150, 0); ctx.lineTo(W, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(150, 0); ctx.lineTo(0, h);
    ctx.moveTo(W - 150, 0); ctx.lineTo(W, h);
    ctx.stroke();
  }

  function drawCornerBands(ctx, W, H) {
    const bw = 120;
    const bh = 200;
    ctx.fillStyle = '#19C8FF';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(bw, 0); ctx.lineTo(0, bh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FF2D7A';
    ctx.beginPath();
    ctx.moveTo(W, 0); ctx.lineTo(W - bw, 0); ctx.lineTo(W, bh); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bw, 0); ctx.lineTo(0, bh);
    ctx.moveTo(W - bw, 0); ctx.lineTo(W, bh);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,197,61,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(130, H); ctx.lineTo(0, H - 150); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(11,92,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(W, H); ctx.lineTo(W - 130, H); ctx.lineTo(W, H - 150); ctx.closePath(); ctx.fill();
  }

  function drawClassicPoster(champ, path) {
    const W = 1080;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    /* 纸底 + 网点 */
    ctx.fillStyle = '#FFF6E8';
    ctx.fillRect(0, 0, W, H);
    const pat = dotPattern(ctx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }

    /* 放射线 */
    ctx.save();
    ctx.translate(W / 2, 410);
    for (let i = 0; i < 20; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 1500, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255,197,61,0.20)' : 'rgba(25,200,255,0.08)';
      ctx.fill();
    }
    ctx.restore();

    /* 左右斜切色带 */
    ctx.fillStyle = '#19C8FF';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(150, 0); ctx.lineTo(0, 470); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FF2D7A';
    ctx.beginPath();
    ctx.moveTo(W, 0); ctx.lineTo(W - 150, 0); ctx.lineTo(W, 470); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(150, 0); ctx.lineTo(0, 470);
    ctx.moveTo(W - 150, 0); ctx.lineTo(W, 470);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* 顶部小字 */
    ctx.fillStyle = '#12121A';
    ctx.font = '700 30px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillText('LIZI · 歌单世界杯', W / 2, 92);

    /* 冠军 */
    ctx.save();
    ctx.translate(W / 2, 182);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.font = '900 142px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = 'rgba(18,18,26,0.9)';
    ctx.fillText('冠军', 12, 14);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#12121A';
    ctx.strokeText('冠军', 0, 0);
    ctx.fillStyle = '#FFC53D';
    ctx.fillText('冠军', 0, 0);
    ctx.restore();

    ctx.font = '900 38px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = '#12121A';
    ctx.fillText('C H A M P I O N', W / 2, 280);

    /* 金色斜框 + 封面（540 见方，中心 585；给下方歌名和晋级之路留出空间） */
    const box = { w: 540, h: 540, rot: -0.055 };
    ctx.save();
    ctx.translate(W / 2, 585);
    ctx.rotate(box.rot);
    ctx.fillStyle = '#12121A';
    ctx.fillRect(-box.w / 2 + 18, -box.h / 2 + 18, box.w, box.h);
    ctx.fillStyle = '#FFC53D';
    ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#12121A';
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    const inner = box.w - 50;
    if (champImg) {
      ctx.drawImage(champImg, -inner / 2, -inner / 2, inner, inner);
    } else {
      ctx.fillStyle = '#FFF6E8';
      ctx.fillRect(-inner / 2, -inner / 2, inner, inner);
      ctx.strokeStyle = '#12121A';
      ctx.lineWidth = 6;
      ctx.strokeRect(-inner / 2, -inner / 2, inner, inner);
      ctx.fillStyle = '#12121A';
      ctx.font = '900 86px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('♪', 0, -20);
      ctx.font = '700 24px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('封面未加载', 0, 82);
    }
    ctx.restore();

    /* 歌名（最多两行，固定行高，下面的信息不会因歌名长短跳动） */
    ctx.fillStyle = '#12121A';
    ctx.font = '900 54px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    const nameLines = wrapCanvasText(ctx, trackName(champ), 860, 2);
    nameLines.forEach((line, i) => ctx.fillText(line, W / 2, 928 + i * 60));

    /* 歌手 */
    ctx.font = '600 34px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#4A4A57';
    ctx.fillText(trackArtist(champ), W / 2, 1042);

    /* 歌单名 */
    ctx.font = '700 26px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#12121A';
    const plName = planNameForPoster();
    ctx.fillText(plName.length > 26 ? plName.slice(0, 26) + '…' : plName, W / 2, 1084);

    /* 统计 */
    const stat = `击败 ${path.bestOf || 0} 首 · ${fmtDate()}`;
    ctx.font = '800 28px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#0B5CFF';
    ctx.fillText(stat, W / 2, 1128);

    /* 晋级之路：两列最多 6 格，保证 3 行之内放得下 */
    const rows = path.rows.slice(0, 6);
    ctx.textAlign = 'left';
    ctx.font = '800 21px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#FF2D7A';
    ctx.fillText('晋级之路', 126, 1180);
    const colW = (W - 252 - 24) / 2;
    rows.forEach((row, i) => {
      const col = i % 2;
      const line = Math.floor(i / 2);
      const x = 126 + col * (colW + 24);
      const y = 1212 + line * 54;
      ctx.fillStyle = line % 2 === 0 ? 'rgba(18,18,26,0.06)' : 'rgba(18,18,26,0.025)';
      ctx.fillRect(x, y - 22, colW, 46);
      ctx.fillStyle = '#12121A';
      ctx.font = '800 17px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} ${row.label}`, x + 12, y - 6);
      ctx.fillStyle = '#4A4A57';
      ctx.font = '600 16px "PingFang SC","Microsoft YaHei",sans-serif';
      const enemy = `${trackName(row.loser)} — ${trackArtist(row.loser)}`;
      ctx.fillText(enemy.length > 22 ? enemy.slice(0, 22) + '…' : enemy, x + 12, y + 14);
    });
    if (path.rows.length > rows.length) {
      ctx.fillStyle = '#7A7A88';
      ctx.font = '600 18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(`…还有 ${path.rows.length - rows.length} 场`, 126, 1212 + 3 * 54 - 6);
    }

    /* 底部 */
    ctx.textAlign = 'center';
    ctx.fillStyle = '#12121A';
    ctx.font = '900 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('LIZI', W / 2, 1388);
    ctx.font = '700 17px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = '#6B6B78';
    ctx.fillText('PLAYLIST WORLD CUP · 歌单世界杯', W / 2, 1420);

    return canvas;
  }

  /* ------------------------------------------------------------------ *
   * 样式 2：冠军晋级树（1080×1440）
   * ------------------------------------------------------------------ */
  function drawPathPoster(champ, pathInfo) {
    const W = 1080;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    drawPosterPaper(ctx, W, H);
    drawPosterRays(ctx, W / 2, 330);
    drawSideBands(ctx, W, 360);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* 顶部小字 */
    ctx.fillStyle = '#12121A';
    ctx.font = '700 28px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillText('LIZI · 歌单世界杯', W / 2, 72);

    /* 冠军 */
    ctx.save();
    ctx.translate(W / 2, 152);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.font = '900 116px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = 'rgba(18,18,26,0.9)';
    ctx.fillText('冠军', 10, 12);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#12121A';
    ctx.strokeText('冠军', 0, 0);
    ctx.fillStyle = '#FFC53D';
    ctx.fillText('冠军', 0, 0);
    ctx.restore();

    ctx.font = '900 32px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = '#12121A';
    ctx.fillText('C H A M P I O N', W / 2, 232);

    /* 金色斜框封面：540 → 464，整体上移，给下方腾出约 300px */
    const box = { w: 464, h: 464, rot: -0.055 };
    ctx.save();
    ctx.translate(W / 2, 500);
    ctx.rotate(box.rot);
    ctx.fillStyle = '#12121A';
    ctx.fillRect(-box.w / 2 + 16, -box.h / 2 + 16, box.w, box.h);
    ctx.fillStyle = '#FFC53D';
    ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#12121A';
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    const inner = box.w - 44;
    if (!drawCoverInRect(ctx, champImg, -inner / 2, -inner / 2, inner, inner)) {
      ctx.fillStyle = '#FFF6E8';
      ctx.fillRect(-inner / 2, -inner / 2, inner, inner);
      ctx.strokeStyle = '#12121A';
      ctx.lineWidth = 6;
      ctx.strokeRect(-inner / 2, -inner / 2, inner, inner);
      ctx.fillStyle = '#12121A';
      ctx.font = '900 76px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('♪', 0, -18);
      ctx.font = '700 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('封面未加载', 0, 72);
    }
    ctx.restore();

    /* 歌名 / 歌手 / 歌单名 / 统计：位置固定，树不会因歌名长短跳动 */
    ctx.fillStyle = '#12121A';
    ctx.font = '900 46px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    const nameLines = wrapCanvasText(ctx, trackName(champ), 860, 2);
    nameLines.forEach((line, i) => ctx.fillText(line, W / 2, 786 + i * 52));

    ctx.font = '600 28px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#4A4A57';
    ctx.fillText(fitCanvasText(ctx, trackArtist(champ), 820), W / 2, 890);

    ctx.font = '700 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#12121A';
    ctx.fillText(fitCanvasText(ctx, planNameForPoster(), 820), W / 2, 926);

    ctx.font = '800 24px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#0B5CFF';
    ctx.fillText(`击败 ${pathInfo.bestOf || 0} 首 · ${fmtDate()}`, W / 2, 962);

    ctx.textAlign = 'left';
    ctx.font = '900 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#FF2D7A';
    ctx.fillText('晋级之路 · ROAD TO CHAMPION', 84, 1004);

    /* 扇形树：左侧每个对手一条，右侧汇聚到冠军圆盘 */
    const rows = pathInfo.rows || [];
    const treeTop = 1032;
    const treeBottom = 1330;
    const barX = 84;
    const barW = 476;
    const disc = { x: 900, y: 1178, r: 88 };
    const areaH = treeBottom - treeTop;

    if (!rows.length) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4A4A57';
      ctx.font = '800 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('一路轮空，直接夺冠', barX + 10, treeTop + areaH / 2);
    } else {
      const gap = 6;
      const barH = clamp((areaH - gap * (rows.length - 1)) / rows.length, 32, 46);
      const totalH = rows.length * barH + (rows.length - 1) * gap;
      let by = treeTop + (areaH - totalH) / 2;
      const nameFont = clamp(barH * 0.4, 12, 18);
      const artistFont = clamp(barH * 0.27, 9, 12);
      const labelFont = clamp(barH * 0.26, 8, 11);
      const colors = ['#12121A', '#19C8FF', '#FF2D7A'];
      const centers = [];

      rows.forEach((row) => {
        centers.push(by + barH / 2);
        drawPathBar(ctx, row, barX, by, barW, barH, labelFont, nameFont, artistFont);
        by += barH + gap;
      });

      /* 连线 + 小圆点，像一张网 */
      rows.forEach((row, i) => {
        const sy = centers[i];
        const sx = barX + barW;
        const ang = Math.atan2(disc.y - sy, disc.x - sx);
        const ex = disc.x - Math.cos(ang) * (disc.r + 8);
        const ey = disc.y - Math.sin(ang) * (disc.r + 8);
        const color = colors[i % colors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx + 130, sy, disc.x - 150, ey, ex, ey);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    /* 冠军圆盘 */
    ctx.fillStyle = 'rgba(18,18,26,0.35)';
    ctx.beginPath();
    ctx.arc(disc.x + 6, disc.y + 6, disc.r, 0, Math.PI * 2);
    ctx.fill();
    drawCoverCircle(ctx, champImg, disc.x, disc.y, disc.r);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#12121A';
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FFC53D';
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.r - 6, 0, Math.PI * 2);
    ctx.stroke();

    /* 圆盘上方「冠军」标签 */
    const tagW = 96;
    const tagH = 32;
    const tagX = disc.x - tagW / 2;
    const tagY = disc.y - disc.r - 46;
    ctx.fillStyle = '#12121A';
    roundRectPath(ctx, tagX, tagY, tagW, tagH, 8);
    ctx.fill();
    ctx.fillStyle = '#FFC53D';
    ctx.font = '900 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('冠军', disc.x, tagY + tagH / 2 + 1);

    /* 圆盘下方歌名 */
    ctx.fillStyle = '#12121A';
    ctx.font = '900 20px "PingFang SC","Microsoft YaHei",sans-serif';
    const discName = wrapCanvasText(ctx, trackName(champ), 250, 2);
    discName.forEach((line, i) => ctx.fillText(line, disc.x, disc.y + disc.r + 30 + i * 26));

    /* 底部 */
    ctx.fillStyle = '#12121A';
    ctx.font = '900 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('LIZI', W / 2, 1388);
    ctx.font = '700 17px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = '#6B6B78';
    ctx.fillText('PLAYLIST WORLD CUP · 歌单世界杯', W / 2, 1420);

    return canvas;
  }

  function drawPathBar(ctx, row, x, y, w, h, labelFont, nameFont, artistFont) {
    ctx.save();
    ctx.fillStyle = 'rgba(18,18,26,0.20)';
    roundRectPath(ctx, x + 4, y + 4, w, h, 7);
    ctx.fill();
    ctx.fillStyle = '#FFFDF5';
    roundRectPath(ctx, x, y, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 3;
    roundRectPath(ctx, x, y, w, h, 7);
    ctx.stroke();

    /* round 标签药丸 */
    ctx.font = '800 ' + labelFont + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    const label = fitCanvasText(ctx, row.label || '', 92);
    const pillW = Math.min(102, Math.max(38, ctx.measureText(label).width + 14));
    const pillH = Math.min(20, h - 8);
    const pillX = x + 8;
    const pillY = y + (h - pillH) / 2;
    ctx.fillStyle = '#12121A';
    roundRectPath(ctx, pillX, pillY, pillW, pillH, 6);
    ctx.fill();
    ctx.fillStyle = '#FFF6E8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + pillW / 2, pillY + pillH / 2 + 0.5);

    /* 输掉的歌名 + 歌手 */
    const textX = pillX + pillW + 10;
    const textW = x + w - 12 - textX;
    ctx.textAlign = 'left';
    ctx.font = '800 ' + nameFont + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#12121A';
    ctx.fillText(fitCanvasText(ctx, trackName(row.loser), textW), textX, y + h * 0.36);
    ctx.font = '600 ' + artistFont + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#5A5A67';
    ctx.fillText(fitCanvasText(ctx, trackArtist(row.loser), textW), textX, y + h * 0.73);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * 样式 3：整张对阵树（2160×1440）
   * ------------------------------------------------------------------ */

  /** 小组内按「离组决赛的距离」分轮：列 0 是第一轮 */
  function groupRoundsOf(plan, group) {
    const ms = plan.matches.filter((m) => m.group === group);
    if (!ms.length) return [];
    const depth = new Map();
    let max = 0;
    ms.forEach((m) => {
      let d = 0;
      let cur = m;
      let guard = 0;
      while (cur.next && cur.next.match && cur.next.match.group === group && guard < 16) {
        d++;
        cur = cur.next.match;
        guard++;
      }
      depth.set(m, d);
      if (d > max) max = d;
    });
    const rounds = [];
    for (let i = 0; i <= max; i++) rounds.push([]);
    ms.forEach((m) => rounds[max - depth.get(m)].push(m));
    rounds.forEach((arr) => arr.sort((a, b) => a.matchIndex - b.matchIndex));
    return rounds;
  }

  function koRoundsOf(plan) {
    const rounds = [];
    for (let i = 0; i < plan.koStages.length; i++) {
      const arr = plan.matches
        .filter((m) => m.stageIndex === i)
        .sort((a, b) => a.matchIndex - b.matchIndex);
      if (arr.length) rounds.push(arr);
    }
    return rounds;
  }

  /* 无小组赛的淘汰签表：从 stage.slots 还原完整槽位，轮空也占一个节点，
     这样 16 强阵列不会因为轮空少几场而塌掉。 */
  function displayKoRounds(plan) {
    const stages = plan.koStages || [];
    const byStage = new Map();
    plan.matches.forEach((m) => {
      if (m.group || m.stageIndex < 0) return;
      byStage.set(m.stageIndex + ':' + m.matchIndex, m);
    });
    const rounds = [];
    stages.forEach((stage, si) => {
      const pairCount = Math.max(1, Math.floor(stage.size / 2));
      const arr = [];
      for (let i = 0; i < pairCount; i++) {
        const a = stage.slots[i * 2] || null;
        const b = stage.slots[i * 2 + 1] || null;
        if (!a && !b) continue;
        const real = byStage.get(si + ':' + i) || null;
        const winner = (real && real.winner) || (!b ? a : (!a ? b : null));
        arr.push({
          a, b, winner,
          label: stage.matchLabel,
          stageIndex: si,
          matchIndex: i,
          bye: !real,
        });
      }
      if (arr.length) rounds.push(arr);
    });
    return rounds;
  }

  /** 第一列均匀铺开，后面每列对齐到两条来线中间；同列防重叠 */
  function layoutTree(rounds, top, height, nodeH) {
    const pos = new Map();
    if (!rounds.length) return pos;
    rounds.forEach((arr, r) => {
      if (!arr.length) return;
      arr.forEach((m, i) => {
        let y;
        const feeders = r > 0 ? rounds[r - 1].filter((f) => f.next && f.next.match === m) : [];
        if (feeders.length) {
          let sum = 0;
          feeders.forEach((f) => {
            const fp = pos.get(f);
            sum += fp ? fp.y : top + height / 2;
          });
          y = sum / feeders.length;
        } else {
          y = top + (height / arr.length) * (i + 0.5);
        }
        pos.set(m, { y });
      });

      const list = arr.map((m) => ({ m, y: pos.get(m).y })).sort((a, b) => a.y - b.y);
      const minGap = nodeH + 6;
      for (let i = 1; i < list.length; i++) {
        if (list[i].y - list[i - 1].y < minGap) list[i].y = list[i - 1].y + minGap;
      }
      if (list.length) {
        const over = list[list.length - 1].y + nodeH / 2 - (top + height);
        if (over > 0) list.forEach((n) => { n.y -= over; });
        const under = top - (list[0].y - nodeH / 2);
        if (under > 0) list.forEach((n) => { n.y += under; });
      }
      list.forEach((n) => pos.set(n.m, { y: n.y }));
    });
    return pos;
  }

  function drawTreeConnector(ctx, x1, y1, x2, y2, color, width) {
    const mid = (x1 + x2) / 2;
    ctx.save();
    ctx.strokeStyle = color || 'rgba(18,18,26,0.6)';
    ctx.lineWidth = width || 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(mid, y1);
    ctx.lineTo(mid, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = color || '#12121A';
    ctx.beginPath();
    ctx.arc(x1, y1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 一场比赛一个节点：上下两行选手，胜者加粗墨色 + 金色左边条，败者灰色。
   * 胜者名字优先完整显示（败者更早截断）。
   */
  function drawMatchNode(ctx, m, x, y, w, h, opt) {
    const o = opt || {};
    const radius = o.radius == null ? 5 : o.radius;
    const border = o.border == null ? 2 : o.border;
    const nameFont = o.nameFont || 12;
    ctx.save();
    if (o.shadow !== false) {
      ctx.fillStyle = 'rgba(18,18,26,0.16)';
      roundRectPath(ctx, x + 2.5, y + 2.5, w, h, radius);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFDF5';
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = border;
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.stroke();

    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();

    const rowH = h / 2;
    const winKey = m.winner ? trackKey(m.winner) : '';
    const align = o.align || 'left';
    const rows = [
      { t: m.a, win: !!winKey && trackKey(m.a) === winKey },
      { t: m.b, win: !!winKey && trackKey(m.b) === winKey },
    ];
    rows.forEach((row, i) => {
      const ry = y + rowH * i;
      if (row.win) {
        ctx.fillStyle = 'rgba(255,197,61,0.34)';
        ctx.fillRect(x + 1, ry + 1, w - 2, rowH - 2);
        ctx.fillStyle = '#FFC53D';
        const barW = Math.max(3, border + 1);
        ctx.fillRect(align === 'right' ? x + w - barW - 1 : x + 1, ry + 2, barW, rowH - 4);
        if (align === 'center') ctx.fillRect(x + w - barW - 1, ry + 2, barW, rowH - 4);
      }
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = (row.win ? '800 ' : '600 ') + nameFont + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      const maxW = (w - 16) * (row.win ? 1 : (o.loserScale || 0.92));
      const label = row.t
        ? fitCanvasText(ctx, trackName(row.t), maxW)
        : (o.byeLabel && (m.a || m.b) ? o.byeLabel : '—');
      ctx.fillStyle = row.win ? '#12121A' : '#8B8B98';
      const tx = align === 'right' ? x + w - 9 : (align === 'center' ? x + w / 2 : x + 9);
      ctx.fillText(label, tx, ry + rowH / 2 + 0.5);
    });

    ctx.strokeStyle = 'rgba(18,18,26,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + rowH);
    ctx.lineTo(x + w - 6, y + rowH);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function groupRoundLabel(ci, total) {
    const remain = total - ci;
    if (remain === 1) return '组决赛';
    if (remain === 2) return '半决赛';
    return '第' + (ci + 1) + '轮';
  }

  function drawGroupCard(ctx, plan, group, x, y, w, h) {
    ctx.fillStyle = 'rgba(18,18,26,0.16)';
    roundRectPath(ctx, x + 6, y + 6, w, h, 10);
    ctx.fill();
    ctx.fillStyle = '#FFFDF5';
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 3;
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.stroke();

    /* 标题条 */
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = '#FFEED2';
    ctx.fillRect(x, y, w, 42);
    ctx.restore();
    ctx.strokeStyle = '#12121A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 42);
    ctx.lineTo(x + w - 2, y + 42);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#12121A';
    ctx.font = '900 italic ' + Math.min(21, Math.max(17, w * 0.07)) +
      'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(group.letter + '组', x + 14, y + 23);

    if (group.winner) {
      ctx.textAlign = 'right';
      ctx.font = '700 12px "PingFang SC","Microsoft YaHei",sans-serif';
      const winLabel = fitCanvasText(ctx, trackName(group.winner), w - 110);
      const winW = ctx.measureText(winLabel).width;
      ctx.fillStyle = '#4A4A57';
      ctx.fillText(winLabel, x + w - 14, y + 23);
      ctx.fillStyle = '#FFC53D';
      ctx.fillRect(x + w - 18 - winW - 8, y + 18, 5, 9);
    }

    const rounds = groupRoundsOf(plan, group);
    const treeX = x + 10;
    const treeW = w - 20;
    if (!rounds.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7A7A88';
      ctx.font = '700 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('轮空 · 直接出线', x + w / 2, y + 42 + (h - 42) / 2);
      return;
    }

    const labelY = y + 56;
    const treeY = y + 70;
    const treeH = h - 82;
    const maxRows = Math.max.apply(null, rounds.map((r) => r.length));
    const nodeH = clamp(((treeH - (maxRows - 1) * 6) / maxRows) * 0.72, 28, 42);
    const colGap = clamp(treeW * 0.065, 10, 22);
    const nodeW = (treeW - colGap * (rounds.length - 1)) / rounds.length;
    const nameFont = nodeW >= 105 ? 12 : 11;
    const pos = layoutTree(rounds, treeY, treeH, nodeH);

    /* 轮次小标题 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(18,18,26,0.5)';
    rounds.forEach((arr, i) => {
      const cx = treeX + i * (nodeW + colGap) + nodeW / 2;
      ctx.fillText(groupRoundLabel(i, rounds.length), cx, labelY);
    });

    /* 折线 */
    for (let r = 1; r < rounds.length; r++) {
      rounds[r].forEach((m) => {
        const t = pos.get(m);
        const tx = treeX + r * (nodeW + colGap);
        rounds[r - 1].forEach((f) => {
          if (!f.next || f.next.match !== m) return;
          const fp = pos.get(f);
          drawTreeConnector(ctx, treeX + (r - 1) * (nodeW + colGap) + nodeW, fp.y,
            tx, t.y, 'rgba(18,18,26,0.55)', 1.4);
        });
      });
    }

    /* 节点 */
    rounds.forEach((arr, r) => {
      arr.forEach((m) => {
        const p = pos.get(m);
        drawMatchNode(ctx, m, treeX + r * (nodeW + colGap), p.y - nodeH / 2,
          nodeW, nodeH, { nameFont, border: 2, radius: 5, shadow: false, loserScale: 0.9 });
      });
    });
  }

  function drawBracketTree(ctx, plan, rounds, box, opt) {
    if (!rounds.length) return;
    const o = opt || {};
    const cols = rounds.length;
    const gapX = o.gapX || 40;
    const champW = o.champW || 150;
    const maxRows = Math.max.apply(null, rounds.map((r) => r.length));
    const nodeH = clamp(((box.h - (maxRows - 1) * 8) / maxRows) * 0.8,
      o.minNodeH || 52, o.maxNodeH || 68);
    const avail = box.w - champW - gapX * cols;
    const nodeW = Math.max(o.minNodeW || 110,
      Math.min(o.maxNodeW || 260, avail / cols));
    const totalW = nodeW * cols + gapX * cols + champW;
    const startX = box.x + (box.w - totalW) / 2;
    const nameFont = clamp(nodeW / 9.5, 15, o.maxFont || 17);
    const pos = layoutTree(rounds, box.y, box.h, nodeH);

    /* 列标题 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 14px "PingFang SC","Microsoft YaHei",sans-serif';
    rounds.forEach((arr, i) => {
      const cx = startX + i * (nodeW + gapX) + nodeW / 2;
      const label = (arr[0] && arr[0].label) || '';
      ctx.fillStyle = 'rgba(18,18,26,0.55)';
      ctx.fillText(fitCanvasText(ctx, label, nodeW - 8), cx, box.y - 20);
    });

    /* 先连线，节点盖住线头 */
    for (let r = 1; r < rounds.length; r++) {
      rounds[r].forEach((m) => {
        const t = pos.get(m);
        const tx = startX + r * (nodeW + gapX);
        rounds[r - 1].forEach((f) => {
          if (!f.next || f.next.match !== m) return;
          const fp = pos.get(f);
          drawTreeConnector(ctx, startX + (r - 1) * (nodeW + gapX) + nodeW, fp.y,
            tx, t.y, 'rgba(18,18,26,0.62)', 2);
        });
      });
    }

    /* 节点 */
    rounds.forEach((arr, r) => {
      arr.forEach((m) => {
        const p = pos.get(m);
        drawMatchNode(ctx, m, startX + r * (nodeW + gapX), p.y - nodeH / 2,
          nodeW, nodeH, { nameFont, border: 2, radius: 7 });
      });
    });

    /* 冠军圆盘 */
    const finalMatch = rounds[cols - 1][0];
    const finalPos = finalMatch ? pos.get(finalMatch) : null;
    const cy = finalPos ? finalPos.y : box.y + box.h / 2;
    const cx = startX + cols * nodeW + (cols - 1) * gapX + gapX + champW / 2;
    const cr = o.champR || Math.min(58, champW * 0.4);
    if (finalPos) {
      drawTreeConnector(ctx, startX + (cols - 1) * (nodeW + gapX) + nodeW + 2, finalPos.y,
        cx - cr, cy, 'rgba(18,18,26,0.75)', 2.4);
    }
    ctx.fillStyle = 'rgba(18,18,26,0.22)';
    ctx.beginPath();
    ctx.arc(cx + 5, cy + 5, cr, 0, Math.PI * 2);
    ctx.fill();
    drawCoverCircle(ctx, champImg, cx, cy, cr);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#12121A';
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFC53D';
    ctx.beginPath();
    ctx.arc(cx, cy, cr - 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + (cr > 60 ? 18 : 14) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#FF2D7A';
    ctx.fillText('冠军', cx, cy - cr - (cr > 60 ? 34 : 24));

    ctx.font = '900 ' + (cr > 60 ? 17 : 13) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#12121A';
    const champ = plan && plan.champion;
    if (champ) {
      const champName = wrapCanvasText(ctx, trackName(champ), champW + 40, 2);
      champName.forEach((line, i) => ctx.fillText(line, cx,
        cy + cr + (cr > 60 ? 26 : 18) + i * (cr > 60 ? 22 : 17)));
    }
  }

  /* 淘汰赛对称阵列：左右各半区向中间收拢，决赛居中。
     只用于无小组赛的签表（2–16 首）；节点、连线、纸底全部沿用旧海报，
     参考图只提供「怎么排」，不引入它的洋红 UI。 */
  function drawSymmetricKoTree(ctx, plan, rounds, box, opt) {
    if (!rounds.length) return;
    const o = opt || {};
    const gap = o.gap || 34;
    const finalW = o.finalW || 300;
    const minNodeW = o.minNodeW || 220;
    const maxNodeW = o.maxNodeW || 330;
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;

    /* 只有决赛（2 首）：一张居中节点，不画连线 */
    if (rounds.length === 1) {
      const m = rounds[0][0];
      const w = Math.min(finalW + 140, box.w);
      const h = 88;
      drawMatchNode(ctx, m, centerX - w / 2, centerY - h / 2, w, h,
        { nameFont: 20, border: 2, radius: 7, align: 'center' });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(18,18,26,0.55)';
      ctx.fillText(fitCanvasText(ctx, m.label || '决赛', w - 8), centerX, box.y - 20);
      drawSymmetricChampionDisc(ctx, plan, centerX, centerY + h / 2, box.y + box.h + 20);
      return;
    }

    const sideRounds = rounds.length - 1;
    const cols = sideRounds * 2 + 1;
    const nodeW = clamp((box.w - finalW - gap * (cols - 1)) / (cols - 1),
      minNodeW, maxNodeW);
    const finalLeft = centerX - finalW / 2;
    const finalRight = centerX + finalW / 2;

    /* 每轮按 matchIndex 一分为二：上半区进左半边，下半区进右半边 */
    const left = [];
    const right = [];
    for (let r = 0; r < sideRounds; r++) {
      const arr = rounds[r];
      const half = Math.ceil(arr.length / 2);
      left[r] = arr.slice(0, half);
      right[r] = arr.slice(half);
    }

    const firstCount = Math.max(1, left[0].length);
    const maxPerSide = Math.max.apply(null, left.map((a) => a.length));
    const nodeH = clamp((box.h / maxPerSide) * 0.46,
      o.minNodeH || 54, o.maxNodeH || 78);

    const yLeft = [];
    const yRight = [];
    yLeft[0] = left[0].map((m, i) => box.y + (box.h / firstCount) * (i + 0.5));
    yRight[0] = right[0].map((m, i) => box.y + (box.h / firstCount) * (i + 0.5));
    for (let r = 1; r < sideRounds; r++) {
      yLeft[r] = left[r].map((m, j) => {
        const a = yLeft[r - 1][j * 2];
        const b = yLeft[r - 1][j * 2 + 1];
        return a != null && b != null ? (a + b) / 2 : (a != null ? a : (b != null ? b : centerY));
      });
      yRight[r] = right[r].map((m, j) => {
        const a = yRight[r - 1][j * 2];
        const b = yRight[r - 1][j * 2 + 1];
        return a != null && b != null ? (a + b) / 2 : (a != null ? a : (b != null ? b : centerY));
      });
    }

    const leftX = [];
    const rightX = [];
    let edge = finalLeft - gap;
    for (let r = sideRounds - 1; r >= 0; r--) {
      leftX[r] = edge - nodeW;
      edge = leftX[r] - gap;
    }
    edge = finalRight + gap;
    for (let r = sideRounds - 1; r >= 0; r--) {
      rightX[r] = edge;
      edge = rightX[r] + nodeW + gap;
    }

    /* 列标题：左右各一份，决赛居中 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(18,18,26,0.55)';
    for (let r = 0; r < sideRounds; r++) {
      const label = (rounds[r][0] && rounds[r][0].label) || '';
      ctx.fillText(fitCanvasText(ctx, label, nodeW - 8), leftX[r] + nodeW / 2, box.y - 20);
      ctx.fillText(fitCanvasText(ctx, label, nodeW - 8), rightX[r] + nodeW / 2, box.y - 20);
    }
    const finalLabel = (rounds[rounds.length - 1][0] && rounds[rounds.length - 1][0].label) || '决赛';
    ctx.fillText(fitCanvasText(ctx, finalLabel, finalW - 8), centerX, box.y - 20);

    /* 先连线，节点盖住线头 */
    const line = 'rgba(18,18,26,0.62)';
    for (let r = 1; r < sideRounds; r++) {
      left[r].forEach((m, j) => {
        [j * 2, j * 2 + 1].forEach((fi) => {
          if (!left[r - 1][fi]) return;
          drawTreeConnector(ctx, leftX[r - 1] + nodeW, yLeft[r - 1][fi],
            leftX[r], yLeft[r][j], line, 2);
        });
      });
      right[r].forEach((m, j) => {
        [j * 2, j * 2 + 1].forEach((fi) => {
          if (!right[r - 1][fi]) return;
          drawTreeConnector(ctx, rightX[r - 1], yRight[r - 1][fi],
            rightX[r] + nodeW, yRight[r][j], line, 2);
        });
      });
    }
    const last = sideRounds - 1;
    if (left[last] && left[last][0]) {
      drawTreeConnector(ctx, leftX[last] + nodeW, yLeft[last][0], finalLeft, centerY, line, 2.4);
    }
    if (right[last] && right[last][0]) {
      drawTreeConnector(ctx, rightX[last], yRight[last][0], finalRight, centerY, line, 2.4);
    }

    /* 节点 */
    const nameFont = clamp(nodeW / 9.5, 15, o.maxFont || 20);
    for (let r = 0; r < sideRounds; r++) {
      left[r].forEach((m, j) => {
        drawMatchNode(ctx, m, leftX[r], yLeft[r][j] - nodeH / 2, nodeW, nodeH,
          { nameFont, border: 2, radius: 7, align: 'left', byeLabel: '轮空' });
      });
      right[r].forEach((m, j) => {
        drawMatchNode(ctx, m, rightX[r], yRight[r][j] - nodeH / 2, nodeW, nodeH,
          { nameFont, border: 2, radius: 7, align: 'right', byeLabel: '轮空' });
      });
    }
    const finalMatch = rounds[rounds.length - 1][0];
    if (finalMatch) {
      const finalH = clamp(nodeH * 1.15, nodeH, o.maxFinalH || 96);
      drawMatchNode(ctx, finalMatch, finalLeft, centerY - finalH / 2, finalW, finalH,
        { nameFont: clamp(finalW / 9.5, 18, 24), border: 2, radius: 7, align: 'center', byeLabel: '轮空' });
      drawSymmetricChampionDisc(ctx, plan, centerX, centerY + finalH / 2, box.y + box.h + 20);
    }
  }

  /* 对称阵列中间的冠军圆盘：旧对阵树同款，只是从「决赛右侧」挪到「决赛下方」 */
  function drawSymmetricChampionDisc(ctx, plan, cx, finalBottom, barTop) {
    const champ = plan && plan.champion;
    if (!champ) return;
    const cr = 64;
    const cy = finalBottom + Math.max(80, (barTop - finalBottom - 60) / 2);
    /* 线停在「冠军」标签上方，别从字上穿过去 */
    const lineEnd = cy - cr - 42;

    ctx.save();
    ctx.strokeStyle = 'rgba(18,18,26,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, finalBottom);
    ctx.lineTo(cx, lineEnd);
    ctx.stroke();
    ctx.fillStyle = 'rgba(18,18,26,0.55)';
    ctx.beginPath();
    ctx.arc(cx, finalBottom, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(18,18,26,0.22)';
    ctx.beginPath();
    ctx.arc(cx + 5, cy + 5, cr, 0, Math.PI * 2);
    ctx.fill();
    drawCoverCircle(ctx, champImg, cx, cy, cr);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#12121A';
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFC53D';
    ctx.beginPath();
    ctx.arc(cx, cy, cr - 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#FF2D7A';
    ctx.fillText('冠军', cx, cy - cr - 26);

    ctx.font = '900 17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#12121A';
    wrapCanvasText(ctx, trackName(champ), 360, 2)
      .forEach((line, i) => ctx.fillText(line, cx, cy + cr + 26 + i * 22));
    ctx.restore();
  }

  function drawBracketChampionBar(ctx, x, y, w, h, champ, pathInfo) {
    ctx.fillStyle = '#12121A';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#FFC53D';
    ctx.fillRect(x, y, w, 6);

    const cover = Math.min(h - 24, 88);
    const cx = x + 18;
    const cy = y + (h - cover) / 2;
    ctx.save();
    roundRectPath(ctx, cx, cy, cover, cover, 8);
    ctx.clip();
    if (!drawCoverInRect(ctx, champImg, cx, cy, cover, cover)) {
      ctx.fillStyle = '#FFF6E8';
      ctx.fillRect(cx, cy, cover, cover);
      ctx.fillStyle = '#12121A';
      ctx.font = '900 32px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx + cover / 2, cy + cover / 2);
    }
    ctx.restore();
    ctx.strokeStyle = '#FFC53D';
    ctx.lineWidth = 3;
    roundRectPath(ctx, cx, cy, cover, cover, 8);
    ctx.stroke();

    const textX = cx + cover + 18;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFF6E8';
    ctx.font = '900 32px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillText(fitCanvasText(ctx, trackName(champ), w - 620), textX, y + h / 2 - 17);
    ctx.font = '600 19px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = 'rgba(255,246,232,0.72)';
    ctx.fillText(fitCanvasText(ctx, trackArtist(champ), w - 620), textX, y + h / 2 + 19);

    ctx.textAlign = 'right';
    ctx.font = '800 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#FFC53D';
    ctx.fillText(`击败 ${pathInfo.bestOf || 0} 首 · ${fmtDate()}`, x + w - 210, y + h / 2 + 2);

    ctx.font = '900 italic 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#FFC53D';
    ctx.fillText('LIZI', x + w - 26, y + h / 2 - 4);
    ctx.font = '700 11px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = 'rgba(255,246,232,0.55)';
    ctx.fillText('PLAYLIST WORLD CUP', x + w - 26, y + h / 2 + 27);
  }

  function drawBracketPoster(champ, pathInfo) {
    const plan = state.plan;
    if (!plan) return null;
    const W = 2160;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    drawPosterPaper(ctx, W, H);
    drawCornerBands(ctx, W, H);

    const hasGroups = plan.groupCount > 0 && plan.groups.length > 0;
    const firstKo = plan.koStages && plan.koStages[0];
    const title = !hasGroups && firstKo && firstKo.size === 16 ? '16强对阵图' : '完整对阵图';

    /* 标题区 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#12121A';
    ctx.font = '800 24px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillText('LIZI · 歌单世界杯', 96, 66);

    ctx.font = '900 italic 70px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#FFC53D';
    ctx.fillText(title, 102, 158);
    ctx.fillStyle = '#12121A';
    ctx.fillText(title, 94, 150);

    ctx.font = '700 24px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#4A4A57';
    ctx.fillText(fitCanvasText(ctx, planNameForPoster(), 980), 96, 214);

    ctx.textAlign = 'right';
    ctx.font = '800 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = '#4A4A57';
    ctx.fillText(`${plan.n} 首 · ${plan.total} 场`, W - 96, 148);
    ctx.font = '700 20px "Geist Mono","Microsoft YaHei",monospace';
    ctx.fillStyle = '#7A7A88';
    ctx.fillText(fmtDate(), W - 96, 214);

    const top = 288;
    const bottom = 1252;
    const margins = 90;

    if (hasGroups) {
      const G = plan.groups.length;
      const gap = 42;
      const contentW = W - margins * 2;
      const groupW = Math.round(contentW * 0.63);
      const rightX = margins + groupW + gap;
      const rightW = W - margins - rightX;
      const cols = G >= 8 ? 4 : 2;
      const rows = Math.ceil(G / cols);
      const gridGap = 16;
      const cardW = (groupW - gridGap * (cols - 1)) / cols;
      const cardH = (bottom - top - gridGap * (rows - 1)) / rows;

      plan.groups.forEach((g, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        drawGroupCard(ctx, plan, g, margins + c * (cardW + gridGap),
          top + r * (cardH + gridGap), cardW, cardH);
      });

      drawBracketTree(ctx, plan, koRoundsOf(plan),
        { x: rightX, y: top + 18, w: rightW, h: bottom - top - 18 }, {
          gapX: 34, champW: 120, minNodeW: 100, maxNodeW: 260,
          minNodeH: 52, maxNodeH: 66, maxFont: 17, champR: 48,
        });
    } else {
      drawSymmetricKoTree(ctx, plan, displayKoRounds(plan),
        { x: 90, y: top + 22, w: W - 180, h: bottom - top - 22 }, {
          gap: 34, finalW: 300, minNodeW: 220, maxNodeW: 330,
          minNodeH: 54, maxNodeH: 78, maxFont: 20,
        });
    }

    drawBracketChampionBar(ctx, margins, 1272, W - margins * 2, 112, champ, pathInfo);

    return canvas;
  }

  function planNameForPoster() {
    const plan = state.plan;
    return (plan && plan.playerName) || state.sessionName || '歌单';
  }

  let champImg = null;

  const POSTER_STYLES = [
    { id: 'classic', title: '冠军海报', btn: '样式 · 冠军', file: '歌单世界杯-冠军.jpg' },
    { id: 'path', title: '冠军晋级树', btn: '样式 · 晋级树', file: '歌单世界杯-晋级树.jpg' },
    { id: 'bracket', title: '整张对阵树', btn: '样式 · 对阵树', file: '歌单世界杯-对阵树.jpg' },
  ];
  const POSTER_STYLE_KEY = 'lizi.worldcup.posterStyle';

  function posterStyleById(id) {
    /* 旧的 r16 洋红对阵图已撤掉；存过这个值的浏览器直接落到对阵树 */
    const key = id === 'r16' ? 'bracket' : id;
    return POSTER_STYLES.find((s) => s.id === key) || POSTER_STYLES[0];
  }

  function currentPosterStyle() {
    return posterStyleById(state.posterStyle);
  }

  function loadPosterStyle() {
    try {
      const v = localStorage.getItem(POSTER_STYLE_KEY);
      if (v === 'r16') return 'bracket';
      if (POSTER_STYLES.some((s) => s.id === v)) return v;
    } catch { /* 隐私模式 / 存储被禁用 */ }
    return POSTER_STYLES[0].id;
  }

  /* 16 强签表第一次进冠军页时默认亮出对阵树（旧纸底/金墨 UI，左右对称阵列）。
     只翻一次；用户自己选过冠军/晋级树就尊重，不再覆盖。 */
  const BRACKET_DEFAULT_MIG = 'lizi.migrate.worldcup.bracketDefault.v1';
  function maybeAutoBracketStyle() {
    let migrated = false;
    try { migrated = localStorage.getItem(BRACKET_DEFAULT_MIG) === '1'; } catch { /* noop */ }
    if (migrated) return;
    let stored = null;
    try { stored = localStorage.getItem(POSTER_STYLE_KEY); } catch { /* noop */ }
    /* 存过 r16 的继续翻成对阵树；存过冠军/晋级树的说明用户自己选过，别覆盖 */
    if (stored && stored !== 'r16') {
      try { localStorage.setItem(BRACKET_DEFAULT_MIG, '1'); } catch { /* noop */ }
      return;
    }
    const stage = state.plan && state.plan.koStages && state.plan.koStages[0];
    if (!stage || stage.size !== 16) return;
    state.posterStyle = 'bracket';
    savePosterStyle('bracket');
    syncPosterStyleUI();
    try { localStorage.setItem(BRACKET_DEFAULT_MIG, '1'); } catch { /* noop */ }
  }

  function savePosterStyle(id) {
    try { localStorage.setItem(POSTER_STYLE_KEY, id); } catch { /* noop */ }
  }

  function syncPosterStyleUI() {
    const style = currentPosterStyle();
    if (els.posterTitle) els.posterTitle.textContent = style.title;
    if (els.posterStyle) {
      els.posterStyle.textContent = style.btn;
      els.posterStyle.setAttribute('aria-label', '切换海报样式，当前：' + style.title);
    }
    if (els.posterImg) els.posterImg.alt = '歌单世界杯' + style.title;
  }

  function applyPosterStyle(id) {
    state.posterStyle = posterStyleById(id).id;
    savePosterStyle(state.posterStyle);
    syncPosterStyleUI();
  }

  function drawPoster(styleId, champ, pathInfo) {
    const style = posterStyleById(styleId);
    if (style.id === 'path') return drawPathPoster(champ, pathInfo);
    if (style.id === 'bracket') return drawBracketPoster(champ, pathInfo);
    return drawClassicPoster(champ, pathInfo);
  }

  async function renderPosterBlob(styleId) {
    const plan = state.plan;
    if (!plan || !plan.champion) throw new Error('还没有决出冠军');
    if (!champImg) champImg = await loadImage(coverOf(plan.champion, 640));
    const pathInfo = { rows: championPath(plan), bestOf: plan.total };
    const canvas = drawPoster(styleId, plan.champion, pathInfo);
    if (!canvas) throw new Error('画布不可用');
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
    });
    if (!blob) throw new Error('图片生成失败（toBlob 返回空）');
    return blob;
  }

  async function generatePoster(ev) {
    if (state.posterBusy) return;
    const plan = state.plan;
    if (!plan || !plan.champion) { toast('还没有决出冠军'); return; }
    /* 按钮 click 事件对象也会进到这里，只有字符串才当作样式 id */
    const style = typeof ev === 'string' ? posterStyleById(ev) : currentPosterStyle();
    state.posterBusy = true;
    const seq = ++state.posterSeq;
    const btn = els.main.querySelector('#wc-poster-btn');
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    showBusy('正在画' + style.title + '…');
    try {
      const blob = await renderPosterBlob(style.id);
      if (seq !== state.posterSeq) return;
      openPoster(blob, style.id);
    } catch (e) {
      toast('生成海报失败：' + ((e && e.message) || e));
    } finally {
      state.posterBusy = false;
      hideBusy();
      if (btn) { btn.disabled = false; btn.textContent = '生成海报'; }
    }
  }

  async function cyclePosterStyle() {
    if (state.posterBusy || !state.posterOpen) return;
    const plan = state.plan;
    if (!plan || !plan.champion) return;
    const cur = currentPosterStyle();
    const idx = POSTER_STYLES.findIndex((s) => s.id === cur.id);
    const next = POSTER_STYLES[(idx + 1) % POSTER_STYLES.length];
    state.posterBusy = true;
    const seq = ++state.posterSeq;
    if (els.posterStyle) {
      els.posterStyle.disabled = true;
      els.posterStyle.setAttribute('aria-busy', 'true');
    }
    try {
      const blob = await renderPosterBlob(next.id);
      if (seq !== state.posterSeq) return;
      openPoster(blob, next.id);
    } catch (e) {
      toast('切换海报样式失败：' + ((e && e.message) || e));
    } finally {
      state.posterBusy = false;
      if (els.posterStyle) {
        els.posterStyle.disabled = false;
        els.posterStyle.removeAttribute('aria-busy');
      }
    }
  }

  function releasePosterUrl() {
    if (state.poster && state.poster.url) {
      try { URL.revokeObjectURL(state.poster.url); } catch { /* noop */ }
    }
    state.poster = null;
  }

  /* ------------------------------------------------------------------ *
   * 海报预览：双指缩放 + 拖动（安卓 WebView 关了原生缩放）
   * ------------------------------------------------------------------ */
  const POSTER_MIN_Z = 1;
  const POSTER_MAX_Z = 5;
  let posterGesture = null;   // { mode:'pan'|'pinch', ... }
  let posterClearPts = null;  // 关掉预览时清掉没抬起来的手指

  function posterWrapEl() {
    return els.posterImg && els.posterImg.parentElement;
  }

  function paintPosterView() {
    const img = els.posterImg;
    if (!img) return;
    const v = state.posterView;
    img.style.transform = `translate3d(${v.x.toFixed(2)}px,${v.y.toFixed(2)}px,0)`
      + ` scale(${v.z.toFixed(4)})`;
    const wrap = posterWrapEl();
    if (wrap) {
      wrap.classList.toggle('is-zoomed', v.z > 1.001);
      wrap.classList.toggle('is-panning', !!(posterGesture && posterGesture.mode === 'pan'));
    }
  }

  function clampPosterPan() {
    const img = els.posterImg;
    const wrap = posterWrapEl();
    const v = state.posterView;
    if (!img || !wrap) { v.x = 0; v.y = 0; return; }
    /* clientWidth/Height 是未缩放的布局尺寸；放大后允许拖到图片边缘为止 */
    const maxX = Math.max(0, (img.clientWidth * v.z - wrap.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * v.z - wrap.clientHeight) / 2);
    v.x = clamp(v.x, -maxX, maxX);
    v.y = clamp(v.y, -maxY, maxY);
  }

  function setPosterZoom(z, cx, cy) {
    const v = state.posterView;
    const next = clamp(z, POSTER_MIN_Z, POSTER_MAX_Z);
    if (!posterWrapEl()) { v.z = next; return; }
    /* cx/cy 是相对预览框中心的坐标；让这个点在缩放前后保持不动 */
    const px = (cx - v.x) / v.z;
    const py = (cy - v.y) / v.z;
    v.z = next;
    v.x = cx - px * next;
    v.y = cy - py * next;
    if (next <= 1.001) { v.z = 1; v.x = 0; v.y = 0; }
    clampPosterPan();
    paintPosterView();
  }

  function resetPosterView() {
    posterGesture = null;
    if (posterClearPts) posterClearPts();
    state.posterView.z = 1;
    state.posterView.x = 0;
    state.posterView.y = 0;
    paintPosterView();
  }

  function bindPosterGestures() {
    const wrap = posterWrapEl();
    if (!wrap || wrap.dataset.gesture === '1') return;
    wrap.dataset.gesture = '1';
    const pts = new Map();
    let pinch = null;
    posterClearPts = () => { pts.clear(); pinch = null; };

    const local = (e) => {
      const r = wrap.getBoundingClientRect();
      return {
        x: e.clientX - r.left - r.width / 2,
        y: e.clientY - r.top - r.height / 2,
      };
    };

    const startPinch = () => {
      const list = [...pts.values()];
      if (list.length < 2) { pinch = null; return; }
      const [a, b] = list;
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        z: state.posterView.z,
        x: state.posterView.x,
        y: state.posterView.y,
      };
    };

    wrap.addEventListener('pointerdown', (e) => {
      if (!state.posterOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { wrap.setPointerCapture(e.pointerId); } catch { /* noop */ }
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        posterGesture = {
          mode: 'pan', sx: e.clientX, sy: e.clientY,
          x: state.posterView.x, y: state.posterView.y,
        };
      } else if (pts.size === 2) {
        posterGesture = { mode: 'pinch' };
        startPinch();
      }
      paintPosterView();
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const v = state.posterView;

      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const z = clamp(pinch.z * (dist / pinch.dist), POSTER_MIN_Z, POSTER_MAX_Z);
        /* 双指中心既是缩放锚点，也跟着手指平移 */
        const px = (pinch.mx - pinch.x) / pinch.z;
        const py = (pinch.my - pinch.y) / pinch.z;
        v.z = z;
        v.x = mx - px * z;
        v.y = my - py * z;
        if (z <= 1.001) { v.z = 1; v.x = 0; v.y = 0; }
        clampPosterPan();
        paintPosterView();
        e.preventDefault();
        return;
      }

      if (posterGesture && posterGesture.mode === 'pan' && v.z > 1.001) {
        v.x = posterGesture.x + (e.clientX - posterGesture.sx);
        v.y = posterGesture.y + (e.clientY - posterGesture.sy);
        clampPosterPan();
        paintPosterView();
        e.preventDefault();
      }
    });

    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 1) {
        /* 从双指松开一根：剩下那根继续拖，锚点重新记一次 */
        const p = [...pts.values()][0];
        const r = wrap.getBoundingClientRect();
        posterGesture = {
          mode: 'pan',
          sx: p.x + r.left + r.width / 2,
          sy: p.y + r.top + r.height / 2,
          x: state.posterView.x, y: state.posterView.y,
        };
        pinch = null;
      } else if (!pts.size) {
        posterGesture = null;
        pinch = null;
      } else {
        startPinch();
      }
      paintPosterView();
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('lostpointercapture', end);

    wrap.addEventListener('wheel', (e) => {
      if (!state.posterOpen) return;
      e.preventDefault();
      const p = local(e);
      setPosterZoom(state.posterView.z * Math.exp(-e.deltaY * 0.0016), p.x, p.y);
    }, { passive: false });

    wrap.addEventListener('dblclick', (e) => {
      if (!state.posterOpen) return;
      e.preventDefault();
      if (state.posterView.z > 1.001) { resetPosterView(); return; }
      const p = local(e);
      setPosterZoom(2.6, p.x, p.y);
    });
  }

  function openPoster(blob, styleId) {
    const wasOpen = state.posterOpen;
    releasePosterUrl();
    const style = posterStyleById(styleId);
    applyPosterStyle(style.id);
    const url = URL.createObjectURL(blob);
    state.poster = { blob, url, style: style.id };
    resetPosterView();
    els.posterImg.src = url;
    els.posterHint.textContent = window.__liziAndroid
      ? '双指缩放、放大后拖动查看 · 没弹出保存就截图'
      : '滚轮缩放、放大后拖动 · 双击复位 · 保存走系统分享或下载';
    state.posterOpen = true;
    els.posterLayer.hidden = false;
    if (!wasOpen) {
      try { els.posterSave.focus({ preventScroll: true }); } catch { /* noop */ }
    }
  }

  function closePoster() {
    state.posterSeq++;   // 让还在渲染的请求失效，避免关掉后又自己弹回来
    if (state.posterOpen) {
      state.posterOpen = false;
      els.posterLayer.hidden = true;
      els.posterImg.removeAttribute('src');
    }
    resetPosterView();
    releasePosterUrl();
    champImg = null;   // 预览关掉才释放，切换样式期间复用
  }

  async function savePoster() {
    if (!state.poster || !state.poster.blob) { toast('海报还没生成'); return; }
    const blob = state.poster.blob;
    const style = posterStyleById(state.poster.style);
    const filename = style.file;
    let file = null;
    try {
      if (typeof File === 'function') file = new File([blob], filename, { type: 'image/jpeg' });
    } catch { file = null; }

    if (file && navigator.canShare) {
      let can = false;
      try { can = !!navigator.canShare({ files: [file] }); } catch { can = false; }
      if (can && navigator.share) {
        try {
          await navigator.share({ files: [file], title: '歌单世界杯 · ' + style.title, text: '我的歌单冠军' });
          toast('已打开系统分享面板');
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;   // 用户自己取消，不算失败
          /* 其他错误：退回下载 */
        }
      }
    }

    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch { /* noop */ } }, 8000);
      toast(window.__liziAndroid ? '已开始下载；没反应就用截图保存海报' : '已开始下载');
    } catch (e) {
      toast('保存失败：' + ((e && e.message) || e) + '，可以截图保存海报');
    }
  }

  /* ------------------------------------------------------------------ *
   * 关闭确认 / 提示
   * ------------------------------------------------------------------ */
  function requestClose() {
    if (!state.open) return;
    if (state.screen === 'battle' && state.matchesPlayed > 0 && !(state.plan && state.plan.champion)) {
      state.confirmOpen = true;
      els.confirm.hidden = false;
      try { els.confirmContinue.focus({ preventScroll: true }); } catch { /* noop */ }
      return;
    }
    close();
  }

  function cancelConfirm() {
    state.confirmOpen = false;
    if (els.confirm) els.confirm.hidden = true;
    try { els.close.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (els.toast) els.toast.hidden = true;
      toastTimer = 0;
    }, ms || 3600);
  }

  /* ------------------------------------------------------------------ *
   * 点击 / 键盘
   * ------------------------------------------------------------------ */
  function onMainClick(e) {
    const t = e.target;
    const tab = t.closest('[data-wc-tab]');
    if (tab) { paintTab(tab.dataset.wcTab, false); return; }

    const retry = t.closest('[data-wc-retry]');
    if (retry) { loadTab(retry.dataset.wcRetry, true); return; }

    const q = t.closest('[data-wc-queue]');
    if (q) {
      const P = mainPlayer();
      const queue = P && Array.isArray(P.state.queue) ? P.state.queue : [];
      if (queue.length < MIN_QUEUE) {
        toast(`当前队列只有 ${queue.length} 首，至少 ${MIN_QUEUE} 首才能开赛`);
        return;
      }
      startSession('当前播放队列', queue.slice(), '');
      return;
    }

    const pl = t.closest('[data-wc-pl]');
    if (pl) {
      const hit = state.plMap.get(pl.dataset.wcPl);
      if (hit) choosePlaylist(hit.p, hit.pid);
      return;
    }

    const trackBtn = t.closest('.wc-track');
    if (trackBtn) {
      const m = state.currentMatch;
      const side = Number(trackBtn.dataset.side);
      const track = m ? (side === 0 ? m.a : m.b) : null;
      if (track) auditionTrack(track);
      return;
    }

    const pick = t.closest('.wc-pick');
    if (pick) { pickWinner(Number(pick.dataset.side)); return; }
  }

  function onDocKey(e) {
    if (!state.open) return;
    const key = e.key;

    if (state.posterOpen) {
      if (key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        closePoster();
      }
      return;
    }
    if (state.confirmOpen) {
      if (key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        cancelConfirm();
      }
      return;
    }

    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }

    if (state.screen !== 'battle' || !state.currentMatch || state.locked) return;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const m = state.currentMatch;
      const track = key === 'ArrowLeft' ? m.a : m.b;
      if (track) auditionTrack(track);
      return;
    }
    if (key === '1' || key === '2') {
      e.preventDefault();
      e.stopPropagation();
      pickWinner(key === '1' ? 0 : 1);
    }
  }

  function onVisibility() {
    if (!state.open || state.screen !== 'champion') return;
    if (document.hidden) stopConfetti();
    else startConfetti();
  }

  /* ------------------------------------------------------------------ *
   * 打开 / 关闭
   * ------------------------------------------------------------------ */
  function open(opts) {
    if (!built) build();
    if (state.open) {
      if (opts && Array.isArray(opts.tracks)) {
        startSession(opts.name || '临时歌单', opts.tracks, opts.source || '');
      } else {
        try { els.close.focus({ preventScroll: true }); } catch { /* noop */ }
      }
      return;
    }

    state.open = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    root.classList.remove('is-champion');
    document.body.classList.add('is-worldcup-open');
    document.addEventListener('keydown', onDocKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    subscribePlayer();

    if (opts && Array.isArray(opts.tracks)) {
      startSession(opts.name || '临时歌单', opts.tracks, opts.source || '');
    } else {
      showPicker();
    }
    try { els.close.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    clearTimers();
    stopConfetti();
    cancelConfirm();
    closePoster();
    hideBusy();
    state.currentMatch = null;
    state.locked = false;
    state.busy = false;
    state.pickSeq++;
    document.removeEventListener('keydown', onDocKey, true);
    document.removeEventListener('visibilitychange', onVisibility);
    document.body.classList.remove('is-worldcup-open');
    root.classList.remove('is-champion');
    if (root) root.hidden = true;

    const back = lastFocus && lastFocus.isConnected && !lastFocus.closest('[hidden]')
      ? lastFocus
      : document.querySelector('[data-tool="worldcup"]') || document.querySelector('[data-tool="box"]');
    if (back) try { back.focus({ preventScroll: true }); } catch { /* noop */ }
    lastFocus = null;
  }

  /* 独立预览页用：不打开工具，直接把一份假 plan 画成对阵树海报。
     只有页面显式设置 window.__LIZI_WC_PREVIEW 时才挂出去，正常入口不暴露。 */
  function previewBracketPoster(plan, cover) {
    state.plan = plan;
    state.sessionName = plan.playerName || '我喜欢的音乐';
    champImg = cover || null;
    return drawBracketPoster(plan.champion, {
      rows: championPath(plan),
      bestOf: plan.total,
    });
  }

  const api = { open, close };
  if (window.__LIZI_WC_PREVIEW) api.__previewBracket = previewBracketPoster;
  return api;
})();
