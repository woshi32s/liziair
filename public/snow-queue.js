/* snow-queue.js — 形态页右上角迷你播放器的队列下拉（2026-11-16）
 * ------------------------------------------------------------------
 * 入口是 #stage-d 后面的倒三角（两套 index.html 里都插了按钮 markup）。
 * 因为 .snow__body 是 overflow:hidden，浮层不能放进去：这里把
 * #stage-queue-pop 作为 .snow 的第二个子元素创建，和 .snow__pill 平级，
 * 向下展开，右边缘对齐按钮右边缘。
 *
 * 数据口径和手机版 public/m/queue-sheet.js 一致：
 *   · 队列只读 Player.state.queue / Player.state.index，不复制数据；
 *   · 点一行走 Player.playQueue(q, i)，和桌面列表 / 设置页同一条切歌入口；
 *   · 不碰 audio、不写播放核心逻辑；
 *   · 标题计数 = 队列总首数（100 首听到第 22 首仍写 100 首）。
 *
 * 排序（拖动 / 「下一首」）直接改 state.queue 数组并同步 state.index，
 * 不调用 playQueue —— playQueue 会重新 load 当前曲目，把正在播的进度打断。
 *
 * 搜索 / 换歌单：
 *   搜索走 API.search / API.qqSearch / LIZI_LOCAL.search；
 *   歌单走 API.session + userPlaylists / playlistDetail（网易云本地收藏）
 *   和 qqUserPlaylists / qqLikedSongs / qqPlaylistDetail。
 * 所有异步请求都带序号，旧请求回来不会覆盖新结果。
 *
 * 只在形态页可见：按钮本身在 #stage-song 里；浮层在离开形态页
 * （body 摘掉 .is-stage / data-view 不再是 stage）时立刻收起。
 * 2026-11-17：外观重做成和「形态」下拉 .smenu 同一套（纯深底、Rubber
 * Segment 页签、31px 列表行）；只改生成的 DOM 结构和类名，队列 / 搜索 /
 * 歌单的业务逻辑一行没动。
 * 动画只碰 transform / opacity；没有 backdrop-filter。
 * ------------------------------------------------------------------ */
(() => {
  'use strict';

  const btn = document.getElementById('stage-queue-btn');
  const snow = document.getElementById('stage-song');
  const hud = document.getElementById('stage-hud');
  const stageView = document.getElementById('view-stage');
  if (!btn || !snow) return;

  const P = (typeof Player !== 'undefined' && Player) ? Player : null;
  if (!P) return;

  const reduce = !!(window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* 右端队列下拉的局部状态。
     只放 UI 自己的东西：开关 / 当前页签 / 搜索源 / 搜索结果 / 歌单缓存。
     队列数据不复制，渲染时直接读 P.state.queue / P.state.index。 */
  const Q = {
    open: false,
    tab: 'queue',
    src: 'netease',
    query: '',
    results: [],
    searchSeq: 0,
    searchTimer: 0,
    listsLoaded: false,
    listsLoading: false,
    playlists: [],
    listSeq: 0,
    pickSeq: 0,
    dragFrom: -1,
    dragTo: -1,
    suppressClickUntil: 0,
    closeTimer: 0,
    statusTimer: 0,
    wakeTimer: 0,
    placeTimer: 0,
    placeTimer2: 0,
  };

  const el = {};

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function artists(t) {
    if (!t) return '未知歌手';
    const a = t.artists;
    if (Array.isArray(a)) {
      const names = a.map((x) => (typeof x === 'string' ? x : (x && x.name) || '')).filter(Boolean);
      return names.length ? names.join(' / ') : '未知歌手';
    }
    const s = String(a == null ? '' : a).split('/').map((x) => x.trim()).filter(Boolean).join(' / ');
    return s || '未知歌手';
  }

  function fmtMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function coverOf(t, size) {
    if (!t || !t.cover) return '';
    try {
      if (typeof API !== 'undefined' && API && typeof API.img === 'function') {
        return API.img(t.cover, size || 120);
      }
    } catch { /* 封面失败不影响列表 */ }
    return '';
  }

  function msgOf(e) {
    return (e && (e.message || e.error)) || String(e || '未知错误');
  }

  function queueOf() {
    const st = P.state;
    return st && Array.isArray(st.queue) ? st.queue : [];
  }

  function indexOf() {
    const st = P.state;
    return st && Number.isInteger(st.index) ? st.index : -1;
  }

  /* StageHost 在 app.js 的 IIFE 里，外部拿不到；但 app.js 在 #view-stage 上
     挂了 pointermove → StageHost.wake()。这里发一个不冒泡的合成事件，只重置
     浮层的 2.6s idle 计时，不会走到 window 上的其它 pointermove 处理。 */
  function wakeHost() {
    try {
      if (stageView) stageView.dispatchEvent(new Event('pointermove'));
      else if (typeof StageHost !== 'undefined' && StageHost
        && typeof StageHost.wake === 'function') StageHost.wake();
    } catch { /* 宿主未就绪时忽略 */ }
  }

  function flashStatus(text) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.hidden = false;
    el.status.classList.add('is-on');
    clearTimeout(Q.statusTimer);
    Q.statusTimer = setTimeout(() => {
      el.status.classList.remove('is-on');
      el.status.hidden = true;
    }, 1800);
  }

  /* ---- 浮层结构 --------------------------------------------------------
     整个面板由脚本创建，两个 index.html 只加一个按钮和两个资源引用。
     放在 .snow 里、.snow__pill 之外，才能绕开 .snow__body 的 overflow:hidden。
     2026-11-17：外观换成「形态」下拉那套 —— 头部 .snowq__top 的 nav 留给
     Rubber Segment（打开面板时挂、收起后销毁），队列 / 搜索结果 / 歌单行
     都改成 .stage-item 的单行结构。 */
  function build() {
    if (el.pop) return;
    const pop = document.createElement('div');
    pop.className = 'snowq__pop';
    pop.id = 'stage-queue-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '播放队列');
    pop.setAttribute('aria-hidden', 'true');
    pop.hidden = true;
    pop.innerHTML = `
      <header class="snowq__top">
        <div class="snowq__tabbar">
          <nav class="snowq__cats" id="snowq-tabs" role="tablist" aria-label="队列面板"></nav>
          <span class="snowq__count" id="snowq-count">0 首</span>
          <button class="snowq__x" id="snowq-close" type="button" aria-label="关闭队列" title="关闭">
            <svg class="ico" aria-hidden="true"><use href="#i-close"/></svg>
          </button>
        </div>
      </header>

      <div class="snowq__body">
        <section class="snowq__pane" data-snowq-pane="queue">
          <p class="snowq__now" id="snowq-now">正在播放 · —</p>
          <div class="snowq__list" id="snowq-list"></div>
        </section>

        <section class="snowq__pane" data-snowq-pane="search" hidden>
          <div class="snowq__searchbar">
            <div class="snowq__search">
              <svg class="ico snowq__search-ico" aria-hidden="true"><use href="#i-search"/></svg>
              <input class="snowq__input" id="snowq-search" type="search"
                     placeholder="搜歌名 / 歌手 / 专辑" autocomplete="off" aria-label="搜索歌曲">
            </div>
            <button class="snowq__go" id="snowq-search-go" type="button">搜索</button>
          </div>
          <div class="snowq__srcs" id="snowq-srcs" role="group" aria-label="搜索音源">
            <button class="snowq__src is-on" type="button" data-snowq-src="netease">网易云</button>
            <button class="snowq__src" type="button" data-snowq-src="qq">QQ</button>
            <button class="snowq__src" type="button" data-snowq-src="local">本地</button>
          </div>
          <div class="snowq__list snowq__list--res" id="snowq-results"></div>
          <div class="snowq__foot" id="snowq-search-foot" hidden>
            <button class="snowq__foot-btn" type="button" data-snowq-act="addall">全部加入队列</button>
            <button class="snowq__foot-btn snowq__foot-btn--main" type="button" data-snowq-act="replaceall">用结果替换队列</button>
          </div>
        </section>

        <section class="snowq__pane" data-snowq-pane="lists" hidden>
          <p class="snowq__hint" id="snowq-lists-hint">选一张歌单，整条替换当前队列</p>
          <div class="snowq__list" id="snowq-lists"></div>
        </section>
      </div>

      <p class="snowq__status" id="snowq-status" role="status" hidden></p>
    `;
    snow.appendChild(pop);

    el.pop = pop;
    el.tabs = pop.querySelector('#snowq-tabs');
    el.count = pop.querySelector('#snowq-count');
    el.now = pop.querySelector('#snowq-now');
    el.list = pop.querySelector('#snowq-list');
    el.close = pop.querySelector('#snowq-close');
    el.search = pop.querySelector('#snowq-search');
    el.searchGo = pop.querySelector('#snowq-search-go');
    el.srcs = pop.querySelector('#snowq-srcs');
    el.results = pop.querySelector('#snowq-results');
    el.searchFoot = pop.querySelector('#snowq-search-foot');
    el.lists = pop.querySelector('#snowq-lists');
    el.listsHint = pop.querySelector('#snowq-lists-hint');
    el.status = pop.querySelector('#snowq-status');
    el.seg = null;              /* 页签的 Rubber Segment 实例，收面板时销毁 */

    bindPanelEvents();
    paintTabs();
  }

  /* ---- 页签：和「形态」下拉共用同一个 Rubber Segment --------------------
     2026-11-17：三个页签（队列 / 搜索 / 歌单）不再手拼胶囊按钮，改成
     window.LIZI_RUBBER.create 挂到 nav 上，尺寸 / 配色都和 .dstages__cats 一致。
     挂载放到第一次打开面板时做：snow-queue.js 在 index.html 里排在
     rubber-segment.js 前面，脚本解析阶段 window.LIZI_RUBBER 还不存在。
     收起（面板真正 hidden）后必须 destroy，否则组件里的 ResizeObserver
     会一直盯着隐藏节点，反复开关会持续累积。 */
  function mountTabs() {
    if (el.seg || !el.tabs) return;
    if (!window.LIZI_RUBBER || typeof window.LIZI_RUBBER.create !== 'function') {
      /* 兜底：组件没加载时给三个可点的文字页签（正式两页不会走到这里）。
         data-snowq-tab 交给 bindPanelEvents 里的点击委托处理。 */
      el.tabs.classList.add('snowq__cats--fallback');
      el.tabs.innerHTML = [
        ['queue', '队列'], ['search', '搜索'], ['lists', '歌单'],
      ].map(([v, label]) => `<button class="snowq__src" type="button"
          data-snowq-tab="${v}">${label}</button>`).join('');
      paintTabs();
      return;
    }
    el.seg = window.LIZI_RUBBER.create({
      root: el.tabs,
      items: [
        { value: 'queue', label: '队列' },
        { value: 'search', label: '搜索' },
        { value: 'lists', label: '歌单' },
      ],
      value: Q.tab,
      ariaLabel: '队列面板',
      orientation: 'horizontal',
      size: 'sm',
      equalSlots: false,     /* 三个词长短不一，等宽会挤 */
      radius: 8,
      inset: 2,
      stretch: 100,
      squash: 3,
      speed: 1,
      glide: 75,
      draggable: true,
      /* 深色形态取 .dstages__cats 同一组值；浅色形态只换变量，组件几何不动 */
      trackColor: 'var(--snowq-track)',
      thumbColor: 'var(--snowq-thumb)',
      textColor: 'var(--snowq-rs-text)',
      activeTextColor: 'var(--snowq-rs-active)',
      onChange: (v) => setTab(v),
    });
    paintTabs();
  }

  function unmountTabs() {
    if (el.seg) {
      try { el.seg.destroy(); } catch { /* 节点已脱离时组件自己会兜底 */ }
      el.seg = null;
    }
    /* 面板关着的时候 nav 留空，下次打开重新 create */
    if (el.tabs) {
      el.tabs.innerHTML = '';
      el.tabs.classList.remove('snowq__cats--fallback');
    }
  }

  /* ---- 队列渲染 -------------------------------------------------------- */
  function paintQueue(center) {
    if (!el.list) return;
    const q = queueOf();
    const idx = indexOf();
    const cur = idx >= 0 && idx < q.length ? q[idx] : null;

    if (el.count) el.count.textContent = `${q.length} 首`;
    if (el.now) {
      /* 刚把歌加进空队列时 index 已经是 0，但音频还没 load —— 别写成「正在播放」。 */
      el.now.textContent = cur
        ? `${P.state.playing ? '正在播放' : '当前'} · ${cur.name || '未知曲目'} — ${artists(cur)}`
        : '队列里还没有歌';
    }

    if (!q.length) {
      el.list.innerHTML = '<p class="snowq__empty">队列是空的。去「搜索」里找一首，或在「歌单」里换一整张。</p>';
      return;
    }

    el.list.innerHTML = q.map((t, i) => {
      const on = i === idx;
      const name = (t && t.name) || '未知曲目';
      /* 2026-11-17：单行结构，对齐 .stage-item 的 31px 行：
         左侧序号位 → 歌名 → 灰色歌手 → 时长 → 操作位。 */
      return `<div class="snowq__row${on ? ' is-on' : ''}" data-snowq-i="${i}" draggable="true"
          role="button" tabindex="0" aria-label="${esc(name)}${on ? '，正在播放' : ''}">
        <span class="snowq__idx">${on ? '▶' : String(i + 1).padStart(2, '0')}</span>
        <span class="snowq__name">${esc(name)}</span>
        <span class="snowq__sub">${esc(artists(t))}</span>
        <span class="snowq__dur">${fmtMs(t && t.duration)}</span>
        ${on
          ? '<span class="snowq__op snowq__op--now">播放中</span>'
          : `<button class="snowq__op" type="button" data-snowq-next="${i}"
               title="设为下一首" aria-label="把 ${esc(name)} 设为下一首">下一首</button>`}
      </div>`;
    }).join('');

    if (center) centerQueueRow();
  }

  /* 长队列打开时先落在当前曲目附近，不从第 1 首开始滚（手机版同款处理）。 */
  function centerQueueRow() {
    const list = el.list;
    if (!list || !list.clientHeight) return;
    const on = list.querySelector('.is-on');
    if (!on) return;
    const want = on.offsetTop - list.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
    list.scrollTop = Math.max(0, want);
  }

  /* ---- 排序 / 切歌 ------------------------------------------------------
     直接改 state.queue（不动播放核心）：
     当前曲目下标随移动一起修正；正在播的音频不会重载，进度不断。
  --------------------------------------------------------------------- */
  function moveTrack(from, to) {
    const st = P.state;
    const q = st && Array.isArray(st.queue) ? st.queue : null;
    if (!q || !q.length) return false;
    if (!Number.isInteger(from) || from < 0 || from >= q.length) return false;
    const cur = Number.isInteger(st.index) ? st.index : -1;
    if (from === to) return false;
    const [track] = q.splice(from, 1);
    to = Math.max(0, Math.min(Number.isInteger(to) ? to : from, q.length));
    if (to === from) { q.splice(from, 0, track); return false; }
    q.splice(to, 0, track);

    if (cur >= 0) {
      if (cur === from) st.index = to;
      else if (from < cur && to >= cur) st.index = cur - 1;
      else if (from > cur && to <= cur) st.index = cur + 1;
    }
    return true;
  }

  function playQueueRow(i) {
    const q = queueOf();
    if (!Number.isInteger(i) || i < 0 || i >= q.length) return;
    if (P.state.queue === q && P.state.index === i) {
      try { P.toggle(); } catch { /* ignore */ }
      return;
    }
    try { P.playQueue(q, i); } catch { /* ignore */ }
    paintQueue(false);
  }

  function setNext(i) {
    const q = queueOf();
    const cur = indexOf();
    if (!Number.isInteger(i) || i < 0 || i >= q.length || cur < 0) return;
    if (i === cur || i === cur + 1) {
      flashStatus(i === cur ? '这首正在播放' : '它已经在下一首了');
      return;
    }
    /* 目标行先被抽出：当前曲目在它后面时下标会左移一位。
       最终插入位置就是「当前曲目的下一个位置」。 */
    const to = i < cur ? cur : cur + 1;
    const name = (q[i] && q[i].name) || '这首歌';
    if (moveTrack(i, to)) {
      paintQueue(false);
      flashStatus(`已把「${name}」排到下一首`);
    }
  }

  function appendTracks(tracks) {
    const st = P.state;
    if (!st || !Array.isArray(st.queue) || !Array.isArray(tracks) || !tracks.length) return 0;
    for (const t of tracks) if (t) st.queue.push(t);
    if (st.index < 0 && st.queue.length) st.index = 0;
    return tracks.length;
  }

  function addToQueue(track) {
    if (!track) return;
    const n = appendTracks([track]);
    if (!n) return;
    paintQueue(false);
    flashStatus(`已加入队列 · ${track.name || '未知曲目'}`);
  }

  function replaceQueue(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return false;
    try { P.playQueue(tracks.slice(), 0); } catch { return false; }
    paintQueue(false);
    return true;
  }

  /* ---- 面板开合 / 页签 -------------------------------------------------- */
  function paintTabs() {
    if (!el.pop) return;
    /* 橡皮滑块自己管选中态和 aria；setValue 不触发 onChange，不会回环。
       兜底文字页签才需要手动切 is-on。 */
    if (el.seg) {
      el.seg.setValue(Q.tab);
    } else if (el.tabs) {
      el.tabs.querySelectorAll('[data-snowq-tab]').forEach((b) => {
        const on = b.dataset.snowqTab === Q.tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    el.pop.querySelectorAll('[data-snowq-pane]').forEach((p) => {
      p.hidden = p.dataset.snowqPane !== Q.tab;
    });
  }

  function setTab(tab) {
    if (tab !== 'queue' && tab !== 'search' && tab !== 'lists') tab = 'queue';
    Q.tab = tab;
    paintTabs();
    if (tab === 'queue') {
      paintQueue(false);
    } else if (tab === 'search') {
      paintSearchSources();
      setTimeout(() => {
        if (!Q.open || Q.tab !== 'search') return;
        try { el.search.focus({ preventScroll: true }); } catch { /* ignore */ }
      }, 40);
    } else {
      loadPlaylists(false);
    }
  }

  /* 浮层放在 .snow 里：right 对齐按钮右边缘，top 落在按钮下方。
     宽度同时受视口和「按钮右侧可用空间」约束，保证左边缘至少留 12px。 */
  function place() {
    if (!Q.open || !el.pop) return;
    const sr = snow.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const vw = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    if (!vw || !sr.width) return;
    const width = Math.max(220, Math.min(392, vw - 24, br.right - 12));
    el.pop.style.width = `${Math.round(width)}px`;
    el.pop.style.right = `${Math.max(0, Math.round(sr.right - br.right))}px`;
    el.pop.style.top = `${Math.round(br.bottom - sr.top + 8)}px`;
  }

  function startKeepAlive() {
    stopKeepAlive();
    Q.wakeTimer = setInterval(() => {
      if (!Q.open) { stopKeepAlive(); return; }
      /* .snow__body 被收起 / 离开形态页时，锚点没了：先把浮层收起来。 */
      if (hud && !hud.classList.contains('is-near')) { closePanel(false); return; }
      wakeHost();
      place();
    }, 1400);
  }

  function stopKeepAlive() {
    if (Q.wakeTimer) clearInterval(Q.wakeTimer);
    Q.wakeTimer = 0;
  }

  function openPanel(tab) {
    if (Q.open) {
      if (tab) setTab(tab);
      return;
    }
    build();
    /* 页签组件可能在收起时被销毁了：打开时重新挂。 */
    mountTabs();
    Q.open = true;
    clearTimeout(Q.closeTimer);
    el.pop.hidden = false;
    el.pop.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    paintQueue(true);
    setTab(tab || 'queue');
    /* 先把起点（opacity 0 / translateY）钉住，再上 is-open，进场才走过渡。 */
    place();
    void el.pop.offsetHeight;
    el.pop.classList.add('is-open');
    /* 面板刚显示 / 宽度刚写上内联值，滑块槽位还是 0：落位后重新量一次。 */
    if (el.seg) el.seg.refresh();
    /* 面板开着时宿主 2600ms 会自动收浮层，这里定时叫醒；不新增播放逻辑。 */
    wakeHost();
    startKeepAlive();
    /* 胶囊展开动画 520ms：落位后再校一次，避免按钮还在移动时锚偏。 */
    clearTimeout(Q.placeTimer);
    clearTimeout(Q.placeTimer2);
    Q.placeTimer = setTimeout(() => {
      place();
      if (el.seg) el.seg.refresh();
    }, 60);
    Q.placeTimer2 = setTimeout(place, 580);
    /* 顶栏浮层互斥（2026-11-17）：和形态下拉 / 本形态设置面板共用
       document 上的 'lizi:stagepanel' 事件（协议见 public/app.js 的
       fireStagePanel）。只在真正打开时广播；closePanel 里绝不广播，
       否则自己一关就会把刚打开的别人也带走。 */
    try {
      document.dispatchEvent(new CustomEvent('lizi:stagepanel', { detail: { id: 'queue' } }));
    } catch { /* 老环境没有 CustomEvent，忽略 */ }
  }

  function closePanel(restoreFocus) {
    if (!Q.open) return;
    Q.open = false;
    stopKeepAlive();
    clearTimeout(Q.placeTimer);
    clearTimeout(Q.placeTimer2);
    el.pop.classList.remove('is-open');
    el.pop.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    clearTimeout(Q.closeTimer);
    /* 搜索框还在焦点里时先 blur：否则安卓 WebView 的软键盘会跟着隐藏面板留在屏幕上。 */
    try {
      const ae = document.activeElement;
      if (ae && el.pop.contains(ae) && typeof ae.blur === 'function') ae.blur();
    } catch { /* ignore */ }
    /* 面板真正隐藏后才拆页签组件：淡出这 200ms 里页签要还在，
       收尾时再 destroy，连带断开组件的 ResizeObserver / rAF。 */
    const hide = () => {
      if (Q.open || !el.pop) return;
      el.pop.hidden = true;
      unmountTabs();
    };
    if (reduce) hide();
    else Q.closeTimer = setTimeout(hide, 200);
    if (restoreFocus) {
      try { btn.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }

  /* ---- 搜索 ------------------------------------------------------------- */
  function paintSearchSources() {
    if (!el.srcs) return;
    el.srcs.querySelectorAll('[data-snowq-src]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.snowqSrc === Q.src);
    });
  }

  function paintResults() {
    if (!el.results) return;
    const list = Q.results;
    if (!list.length) {
      el.results.innerHTML = Q.query
        ? `<p class="snowq__empty">没有搜到「${esc(Q.query)}」</p>`
        : '<p class="snowq__empty">输入关键词，回车搜索。</p>';
      if (el.searchFoot) el.searchFoot.hidden = true;
      return;
    }
    el.results.innerHTML = list.map((t, i) => {
      const name = (t && t.name) || '未知曲目';
      const cv = coverOf(t, 120);
      return `<div class="snowq__row snowq__row--res">
        <span class="snowq__cover">${cv
          ? `<img src="${esc(cv)}" alt="" loading="lazy" decoding="async">`
          : '<svg class="ico" aria-hidden="true"><use href="#i-note"/></svg>'}</span>
        <span class="snowq__name">${esc(name)}</span>
        <span class="snowq__sub">${esc(artists(t))}</span>
        <span class="snowq__dur">${fmtMs(t && t.duration)}</span>
        <span class="snowq__res-ops">
          <button class="snowq__mini" type="button" data-snowq-add="${i}"
                  title="加入队列" aria-label="把 ${esc(name)} 加入队列">＋</button>
          <button class="snowq__mini" type="button" data-snowq-play="${i}"
                  title="立即播放" aria-label="立即播放 ${esc(name)}">
            <svg class="ico" aria-hidden="true"><use href="#i-play"/></svg>
          </button>
        </span>
      </div>`;
    }).join('');
    if (el.searchFoot) el.searchFoot.hidden = false;
  }

  async function runSearch(raw) {
    const kw = String(raw == null ? '' : raw).trim();
    Q.query = kw;
    const seq = ++Q.searchSeq;
    if (!kw) {
      Q.results = [];
      paintResults();
      return;
    }
    el.results.innerHTML = '<p class="snowq__empty">正在搜索…</p>';
    if (el.searchFoot) el.searchFoot.hidden = true;

    try {
      let tracks = [];
      if (Q.src === 'local') {
        if (!window.LIZI_LOCAL || typeof window.LIZI_LOCAL.search !== 'function') {
          throw new Error('当前环境不支持本地音乐');
        }
        const rows = await window.LIZI_LOCAL.search(kw);
        tracks = (rows || []).map((t) => ({
          id: t.id, source: 'local', name: t.name, artists: t.artists,
          album: t.album, duration: t.duration, cover: t.cover,
        }));
      } else if (Q.src === 'qq') {
        if (typeof API === 'undefined' || !API || typeof API.qqSearch !== 'function') {
          throw new Error('QQ 音乐搜索不可用');
        }
        const d = await API.qqSearch(kw, 20);
        if (d && d.code !== undefined && Number(d.code) !== 200) {
          throw new Error(d.error || 'QQ 音乐搜索失败');
        }
        tracks = (d && d.tracks) || [];
      } else {
        if (typeof API === 'undefined' || !API || typeof API.search !== 'function') {
          throw new Error('搜索接口不可用');
        }
        const d = await API.search(kw, 30);
        tracks = (d && d.tracks) || [];
      }
      /* 面板关掉也不丢弃结果：重新打开搜索页签时 DOM 里还是上一次的列表。 */
      if (seq !== Q.searchSeq) return;
      Q.results = tracks;
      paintResults();
    } catch (e) {
      if (seq !== Q.searchSeq) return;
      Q.results = [];
      el.results.innerHTML = `<p class="snowq__empty">${esc(msgOf(e))}</p>`;
      if (el.searchFoot) el.searchFoot.hidden = true;
    }
  }

  /* ---- 换歌单 -----------------------------------------------------------
     只列真正拿得到的歌单：本地库 + 网易云（已登录时）+ QQ（已登录时）。
     没登录的平台给一行说明，不编造歌单；QQ 边车起不来时直接不占版面。
  --------------------------------------------------------------------- */
  async function localPlaylistRows() {
    if (!window.LIZI_LOCAL || typeof window.LIZI_LOCAL.list !== 'function') return [];
    try {
      const rows = await window.LIZI_LOCAL.list();
      return [{
        name: '本地音乐',
        sub: '本机导入',
        count: rows.length,
        cover: rows.length && rows[0] ? rows[0].cover : '',
        tone: '本地',
        load: async () => rows,
      }];
    } catch (e) {
      return [{ name: '本地音乐', sub: '读取失败：' + msgOf(e), disabled: true }];
    }
  }

  async function neteasePlaylistRows() {
    if (typeof API === 'undefined' || !API || typeof API.session !== 'function') return [];
    try {
      const s = await API.session();
      const uid = s && s.loggedIn && s.profile && s.profile.userId;
      if (!uid) {
        return [{ name: '网易云', sub: '未登录 · 到设置里扫码后可换你的歌单', disabled: true }];
      }
      const d = await API.userPlaylists(uid);
      const list = (d && d.playlists) || [];
      const liked = list.find((p) => p && p.specialType === 5)
        || list.find((p) => p && /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
      const out = [];
      const mk = (p, name, sub) => ({
        name,
        sub,
        count: Number.isFinite(p.trackCount) ? p.trackCount : p.count,
        cover: p.cover,
        tone: '网易云',
        load: async () => {
          const r = await API.playlistDetail(p.id);
          return (r && r.tracks) || [];
        },
      });
      if (liked) out.push(mk(liked, '我的喜欢', '网易云 · 收藏'));
      for (const p of list) {
        if (!p || p === liked) continue;
        out.push(mk(p, p.name || '未命名歌单', '网易云 · 我的歌单'));
      }
      if (!out.length) return [{ name: '网易云', sub: '账号下还没有歌单', disabled: true }];
      return out;
    } catch (e) {
      return [{ name: '网易云', sub: '歌单读取失败：' + msgOf(e), disabled: true }];
    }
  }

  async function qqPlaylistRows() {
    if (typeof API === 'undefined' || !API || typeof API.qqUserPlaylists !== 'function') return [];
    try {
      const d = await API.qqUserPlaylists();
      const list = (d && d.playlists) || [];
      if (!list.length) return [];
      const out = [{
        name: 'QQ 音乐 · 我喜欢',
        sub: 'QQ · 收藏',
        tone: 'QQ',
        load: async () => {
          const r = await API.qqLikedSongs(100);
          return (r && r.tracks) || [];
        },
      }];
      for (const p of list) {
        if (!p || !p.id) continue;
        out.push({
          name: p.name || '未命名歌单',
          sub: 'QQ · 我的歌单',
          count: Number.isFinite(p.trackCount) ? p.trackCount : p.count,
          cover: p.cover,
          tone: 'QQ',
          load: async () => {
            const r = await API.qqPlaylistDetail(p.id, p.dirId);
            return (r && r.tracks) || [];
          },
        });
      }
      return out;
    } catch {
      /* 未登录 / QQ 边车没起：不把失败行塞进面板，免得整页都是红字 */
      return [];
    }
  }

  async function loadPlaylists(force) {
    if (Q.listsLoading) return;
    if (Q.listsLoaded && !force) {
      paintPlaylists();
      return;
    }
    Q.listsLoading = true;
    const seq = ++Q.listSeq;
    el.lists.innerHTML = '<p class="snowq__empty">正在读取歌单…</p>';
    try {
      const [local, ne, qq] = await Promise.all([
        localPlaylistRows(),
        neteasePlaylistRows(),
        qqPlaylistRows(),
      ]);
      if (seq !== Q.listSeq) return;
      Q.playlists = local.concat(ne, qq);
      Q.listsLoaded = true;
    } finally {
      if (seq === Q.listSeq) {
        Q.listsLoading = false;
        paintPlaylists();
      }
    }
  }

  function paintPlaylists() {
    if (!el.lists) return;
    if (!Q.playlists.length) {
      if (el.listsHint) el.listsHint.textContent = '没有读到可用歌单。本地导入几首歌，或在设置里登录平台后再试。';
      el.lists.innerHTML = '';
      return;
    }
    if (el.listsHint) el.listsHint.textContent = '选一张歌单，整条替换当前队列';
    el.lists.innerHTML = Q.playlists.map((r, i) => {
      if (r.disabled) {
        return `<div class="snowq__row snowq__row--note">
          <span class="snowq__name">${esc(r.name)}</span>
          <span class="snowq__sub">${esc(r.sub)}</span>
        </div>`;
      }
      const cv = coverOf(r, 120);
      let sub = r.sub || '';
      if (Number.isFinite(r.count)) sub += (sub ? ' · ' : '') + r.count + ' 首';
      if (r.error) sub += (sub ? ' · ' : '') + r.error;
      return `<button class="snowq__row snowq__row--list${r.loading ? ' is-loading' : ''}"
          type="button" data-snowq-list="${i}" ${r.loading ? 'disabled' : ''}>
        <span class="snowq__cover">${cv
          ? `<img src="${esc(cv)}" alt="" loading="lazy" decoding="async">`
          : '<svg class="ico" aria-hidden="true"><use href="#i-note"/></svg>'}</span>
        <span class="snowq__name">${esc(r.name)}</span>
        <span class="snowq__sub">${esc(sub)}</span>
        <span class="snowq__list-go">${r.loading ? '载入中…' : '替换'}</span>
      </button>`;
    }).join('');
  }

  async function pickPlaylist(i) {
    const r = Q.playlists[i];
    if (!r || r.disabled || r.loading) return;
    r.loading = true;
    r.error = '';
    paintPlaylists();
    const seq = ++Q.pickSeq;
    try {
      const tracks = await r.load();
      r.loading = false;
      /* 期间又点了别的歌单：本次结果作废，但 loading 必须收掉。 */
      if (seq !== Q.pickSeq) return;
      if (!tracks || !tracks.length) throw new Error('这张歌单没有曲目');
      if (replaceQueue(tracks)) closePanel(false);
      else r.error = '替换失败';
    } catch (e) {
      r.loading = false;
      if (seq !== Q.pickSeq) return;
      r.error = msgOf(e);
    }
    paintPlaylists();
  }

  /* ---- 事件绑定 --------------------------------------------------------- */
  function bindPanelEvents() {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (Q.open) closePanel(true);
      else openPanel('queue');
    });
    el.close.addEventListener('click', () => closePanel(true));

    /* 页签点击委托：Rubber Segment 的按钮走组件自己的 onChange，
       这里只服务组件未加载时的兜底文字页签（data-snowq-tab）。 */
    el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-snowq-tab]');
      if (b) setTab(b.dataset.snowqTab);
    });

    /* 点面板外关闭。捕获阶段监听：宿主自己的 pointerdown 手势在冒泡阶段，
       不会因为这次点击被误判成 seek / 播放。 */
    document.addEventListener('pointerdown', (e) => {
      if (!Q.open) return;
      if (el.pop.contains(e.target) || btn.contains(e.target)) return;
      closePanel(false);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!Q.open || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closePanel(true);
    }, true);

    /* 面板内任何按下都重置宿主的 2600ms idle 计时，手指/鼠标停在列表上时
       浮层不会先淡掉。 */
    el.pop.addEventListener('pointerdown', wakeHost, { passive: true });

    /* 队列行：点行切歌；行内「下一首」只改排序，不重载当前音频。 */
    el.list.addEventListener('click', (e) => {
      /* 拖拽结束后浏览器偶尔还会补一个 click：短窗口内直接吞掉，免得误切歌。 */
      if (performance.now() < Q.suppressClickUntil) return;
      const nb = e.target.closest && e.target.closest('[data-snowq-next]');
      if (nb) {
        e.preventDefault();
        e.stopPropagation();
        setNext(Number(nb.dataset.snowqNext));
        return;
      }
      const row = e.target.closest && e.target.closest('[data-snowq-i]');
      if (row && el.list.contains(row)) playQueueRow(Number(row.dataset.snowqI));
    });

    el.list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.target.closest('button')) return;
      const row = e.target.closest && e.target.closest('[data-snowq-i]');
      if (!row || e.target !== row) return;
      e.preventDefault();
      e.stopPropagation();
      playQueueRow(Number(row.dataset.snowqI));
    });

    /* 原生拖拽排序（桌面鼠标）。只改 state.queue 顺序，不碰 audio。 */
    el.list.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('[data-snowq-i]');
      if (!row) return;
      Q.dragFrom = Number(row.dataset.snowqI);
      Q.dragTo = Q.dragFrom;
      Q.suppressClickUntil = performance.now() + 300;
      row.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(Q.dragFrom));
      } catch { /* 某些环境 dataTransfer 只读 */ }
    });
    el.list.addEventListener('dragover', (e) => {
      if (Q.dragFrom < 0) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
      const row = e.target.closest && e.target.closest('[data-snowq-i]');
      el.list.querySelectorAll('.is-drop').forEach((n) => n.classList.remove('is-drop'));
      if (row) {
        Q.dragTo = Number(row.dataset.snowqI);
        row.classList.add('is-drop');
      }
    });
    el.list.addEventListener('drop', (e) => {
      if (Q.dragFrom < 0) return;
      e.preventDefault();
      const from = Q.dragFrom;
      const to = Q.dragTo;
      clearDragMarks();
      if (Number.isInteger(to) && to >= 0 && from !== to && moveTrack(from, to)) {
        paintQueue(false);
        flashStatus('队列顺序已调整');
      }
    });
    el.list.addEventListener('dragend', clearDragMarks);

    function clearDragMarks() {
      Q.dragFrom = -1;
      Q.dragTo = -1;
      Q.suppressClickUntil = performance.now() + 300;
      el.list.querySelectorAll('.is-dragging, .is-drop').forEach((n) => {
        n.classList.remove('is-dragging', 'is-drop');
      });
    }

    /* 搜索 */
    el.search.addEventListener('input', () => {
      clearTimeout(Q.searchTimer);
      const kw = el.search.value.trim();
      Q.searchTimer = setTimeout(() => runSearch(kw), 320);
    });
    el.search.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(Q.searchTimer);
      runSearch(el.search.value);
    });
    el.searchGo.addEventListener('click', () => {
      clearTimeout(Q.searchTimer);
      runSearch(el.search.value);
    });
    el.srcs.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-snowq-src]');
      if (!b) return;
      Q.src = b.dataset.snowqSrc;
      paintSearchSources();
      if (Q.query) runSearch(Q.query);
    });

    el.results.addEventListener('click', (e) => {
      const add = e.target.closest && e.target.closest('[data-snowq-add]');
      if (add) {
        const t = Q.results[Number(add.dataset.snowqAdd)];
        if (t) addToQueue(t);
        return;
      }
      const play = e.target.closest && e.target.closest('[data-snowq-play]');
      if (play) {
        const i = Number(play.dataset.snowqPlay);
        if (Q.results.length && Number.isInteger(i) && i >= 0 && i < Q.results.length) {
          try { P.playQueue(Q.results.slice(), i); } catch { /* ignore */ }
          closePanel(false);
        }
      }
    });

    el.searchFoot.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-snowq-act]');
      if (!b || !Q.results.length) return;
      if (b.dataset.snowqAct === 'addall') {
        const n = appendTracks(Q.results);
        paintQueue(false);
        flashStatus(`已把 ${n} 首加入队列`);
      } else if (b.dataset.snowqAct === 'replaceall') {
        if (replaceQueue(Q.results)) closePanel(false);
      }
    });

    /* 歌单 */
    el.lists.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-snowq-list]');
      if (!b) return;
      pickPlaylist(Number(b.dataset.snowqList));
    });
  }

  /* 队列 / 登录变化时重画。只在面板开着时画，关着的时候下次打开会 paint。 */
  try {
    P.on('trackchange', () => { if (Q.open) paintQueue(false); });
    P.on('queuechange', () => { if (Q.open) paintQueue(false); });
  } catch { /* 老版本 Player 没有 on 时忽略 */ }

  /* 登录 / 退出后歌单缓存作废：否则先在未登录时开过「歌单」页签，
     扫码回来还一直看不到网易云的歌单。app.js 的登录通知走这个事件。 */
  document.addEventListener('lizi:platforms', (e) => {
    if (!e.detail || !e.detail.authChanged) return;
    Q.listsLoaded = false;
    Q.playlists = [];
    if (Q.open && Q.tab === 'lists') loadPlaylists(true);
  });

  /* 顶栏浮层互斥（2026-11-17）：形态下拉 / 本形态设置面板打开时会在
     document 上广播 'lizi:stagepanel'（事件协议见 public/app.js 的
     fireStagePanel）。收到不是 'queue' 的 id 就把自己收起来；收到自己的
     id 必须忽略，否则 openPanel 末尾的广播会把刚打开的面板立刻关掉。
     关闭统一走现有的 closePanel：200ms 淡出、淡出结束后 unmountTabs()、
     seg.destroy()，以及 1.4s 保活计时器的 clearInterval 全在里面，
     不能绕过——这里也不做焦点回填（restoreFocus=false），焦点被别的面板
     按钮拿走更自然。 */
  document.addEventListener('lizi:stagepanel', (e) => {
    const id = e.detail && e.detail.id;
    if (!id || id === 'queue') return;
    closePanel(false);
  });

  /* 离开形态页立刻收起：app.js 的 StageHost.leave() 会摘 .is-stage，
     pages/nav.js 的 lizi:show 会给出目标 view。两条都接。 */
  document.addEventListener('lizi:show', (e) => {
    const v = e.detail && e.detail.view;
    if (v && v !== 'stage') closePanel(false);
  });

  if (document.body) {
    new MutationObserver(() => {
      if (!Q.open) return;
      if (!document.body.classList.contains('is-stage')
        || document.body.dataset.view !== 'stage') closePanel(false);
    }).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-view'] });
  }

  /* 浮层归 .snow 管，胶囊一收起（is-near 摘掉）就跟着收。 */
  if (hud) {
    new MutationObserver(() => {
      if (Q.open && !hud.classList.contains('is-near')) closePanel(false);
    }).observe(hud, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('resize', () => { if (Q.open) place(); });
  window.addEventListener('orientationchange', () => { if (Q.open) setTimeout(place, 120); });

  build();
})();
