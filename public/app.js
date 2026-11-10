/**
 * 页面装配：视图切换、图标状态、登录、渲染、封面背景取色。
 */
(() => {
  /* 主大厅改版删掉了一些元素（歌单侧栏、歌单头、品牌），但渲染逻辑里还有调用。
     找不到就返回一个"哑元素"：读属性给空值，写属性/调方法都不报错 ——
     这样就不用满文件加 if，也不会因为少一个元素整页崩掉。 */
  const stub = () => new Proxy(
    { hidden: true, textContent: '', innerHTML: '', style: {} },
    {
      get: (t, k) => (k in t ? t[k] : () => stub()),
      set: (t, k, v) => { t[k] = v; return true; },
    }
  );
  const $ = (id) => document.getElementById(id) || stub();
  const el = {
    topbar: $('topbar'), search: $('search'), searchWrap: $('search-wrap'),
    viewBrowse: $('view-browse'), viewNow: $('view-now'), viewHall: $('view-hall'), viewLab: $('view-lab'),
    viewArtist: $('view-artist'), viewAlbum: $('view-album'), viewAudio: $('view-audio'),
    viewSettings: $('view-settings'),
    viewMyAlbums: $('view-myalbums'),
    viewTools: $('view-tools'),
    viewForms: $('view-forms'), formsFrame: $('forms-frame'),
    brand: $('brand'), btnBack: $('btn-back'),
    playlists: $('playlists'), tracks: $('tracks'), lyrics: $('lyrics'), lyFormat: $('ly-format'),
    peek: [$('peek-0'), $('peek-1'), $('peek-2')], peekWrap: $('peek'), peekHint: $('peek-hint'),
    pull: $('pull'), btnLyricsToggle: $('btn-lyrics-toggle'), btnLyricsClose: $('btn-lyrics-close'),
    lyricsToggleText: $('lyrics-toggle-text'), lyricsPanel: $('lyrics-panel'),
    beats: $('beats'), beatBpm: $('beat-bpm'), beatDots: $('beat-dots'), beatSpec: $('beat-spec'),
    beatState: $('beat-state'), beatConf: $('beat-conf-bar'), btnBeat: $('btn-beat'),
    viewStage: $('view-stage'),
    disc: document.querySelector('.disc'),
    plName: $('pl-name'), plSub: $('pl-sub'), plCover: $('pl-cover'),
    npCover: $('np-cover'), npName: $('np-name'), npArtist: $('np-artist'),
    nowArt: $('now-art'), nowTitle: $('now-title'), nowSub: $('now-sub'),
    coverBg: $('cover-bg'), scrim: $('scrim'), nowBg: $('now-bg'),
    bar: $('bar'), barFill: $('bar-fill'), barBuf: $('bar-buf'), tCur: $('t-cur'), tTotal: $('t-total'),
    dock: $('dock'), dockArt: $('dock-art'), dockCover: $('dock-cover'), dockBar: $('dock-bar'), dockPaint: $('dock-paint'),
    queue: $('queue'), ntrPlay: $('ntr-play'),
    vol: $('vol'), volFill: $('vol-fill'), badge: $('badge'),
    btnPlay: $('btn-play'), btnPrev: $('btn-prev'), btnNext: $('btn-next'), btnMode: $('btn-mode'),
    btnMute: $('btn-mute'), btnLite: $('btn-lite'), btnPlayAll: $('btn-play-all'),
    btnOpenNow: $('btn-open-now'),
    modal: $('modal'), modalClose: $('modal-close'), qrBox: $('qr-box'), qrStatus: $('qr-status'), qrDiag: $('qr-diag'),
    cookieInput: $('cookie-input'), cookieImport: $('cookie-import'), cookieMsg: $('cookie-msg'),
  };

  /* ================================================================== *
   * 歌手页 / 专辑页
   *
   * 页面本体整体在 public/pages/（ESM，按需 import），这里只留四件事：
   *   1) 视图映射：show() 里 is-active + 顶栏滚动态 + body[data-view]
   *   2) 返回键：Pages.back() 先走访问栈，回到底才回大厅
   *   3) 全站的「艺人名 / 专辑名」入口：data-aid / data-alb
   *   4) 一次**捕获阶段**的点击代理：行本身的播放点击在冒泡里，
   *      这里先截住 —— 点名字只开页面，不会顺手把那首歌播了
   * ================================================================== */
  const Pages = (() => {
    let mod = null, loading = null;
    const load = () => (mod ? Promise.resolve(mod)
      : (loading || (loading = import('./pages/nav.js')
          .then((m) => (mod = m))
          .catch((e) => { loading = null; console.warn('[pages] 加载失败', e); return null; }))));
    return {
      openArtist(id) { if (id) load().then((m) => m && m.openArtist(+id)); },
      openAlbum(id) { if (id) load().then((m) => m && m.openAlbum(+id)); },
      openMyAlbums() { load().then((m) => m && m.openMyAlbums()); },
      openArtistFromSong(sid) { if (sid) load().then((m) => m && m.openArtistFromSong(+sid)); },
      back() { return mod ? mod.back() : false; },
      onShow(v) { if (mod) mod.onShow(v); },
    };
  })();
  /* pages/nav.js 只管栈，切视图还是走这里（避免两套 show） */
  document.addEventListener('lizi:show', (e) => {
    const v = e.detail && e.detail.view;
    if (v && v !== view) show(v);
  });

  /* 艺人名 / 专辑名 → 可点入口。没有 id 就退回纯文字，绝不编一个 id。
     QQ 那边 artistIds 是 songmid 字符串（不是数字），给了也做不出歌手页 —— 这类不接。 */
  const isNeteaseId = (v) => /^\d+$/.test(String(v || ''));
  const artistLinks = (names, ids) => String(names || '未知歌手')
    .split(/\s*\/\s*/)
    .map((n, i) => (ids && isNeteaseId(ids[i])
      ? `<a class="entry-a" data-aid="${ids[i]}" role="link" tabindex="0">${escapeHtml(n)}</a>`
      : escapeHtml(n)))
    .join(' / ');
  const albumLink = (name, id) => (id && isNeteaseId(id)
    ? `<a class="entry-a" data-alb="${id}" role="link" tabindex="0">${escapeHtml(name)}</a>`
    : escapeHtml(name || ''));

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-aid],[data-alb]');
    if (a) {
      e.preventDefault(); e.stopPropagation();
      if (a.dataset.aid) Pages.openArtist(a.dataset.aid);
      else Pages.openAlbum(a.dataset.alb);
      return;
    }
    /* DJ 台曲库（public/lab/** 不归这边改，只借它的 DOM）：行上有 data-key="nc:<songId>" */
    const td = e.target.closest('#djx-lib tbody td.c-a');
    if (!td) return;
    const key = (td.closest('tr') || { dataset: {} }).dataset.key || '';
    if (!key.startsWith('nc:')) return;          // 本地文件没有网易云 id
    e.preventDefault(); e.stopPropagation();
    Pages.openArtistFromSong(+key.slice(3));
  }, true);
  /* 入口是 <a> 但没有 href，回车/空格要手动给条路 */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = e.target.closest && e.target.closest('[data-aid],[data-alb]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.aid) Pages.openArtist(a.dataset.aid);
    else Pages.openAlbum(a.dataset.alb);
  });

  const ICONS = {
    play: '#i-play', pause: '#i-pause',
    order: '#i-list', loop: '#i-order', single: '#i-single', shuffle: '#i-shuffle',
    volume: '#i-volume', mute: '#i-mute',
  };
  const MODE_LABEL = { order: '顺序播放', loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };

  /** 换掉按钮里的图标（SVG <use>），不再用 emoji */
  const setIcon = (btn, icon, selector = '.ico use') => {
    const u = btn.querySelector(selector);
    if (u) u.setAttribute('href', icon);
  };

  let profile = null;
  let currentList = [];
  let view = 'hall';        // 大厅是入口视图（browse 现在只放搜索结果/歌单曲目）
  /* Lab 模块把「停自动过渡演示音源」注册到这里：离开实验室 / 切走分页时要立刻掐掉。
     那几个是一次性 BufferSource，挂在共享 master 上，不主动停会自己响完（≤8s）。 */
  let labStopXfade = null;

  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  const fmtCount = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n || 0));
  /* RGB -> CSS oklch()。**纯转换，不夹明度/彩度。**
     旧版把 L 夹在 58–84%、C 夹在 0.085–0.24，是为了遮住旧色相桶算法
     "深色封面算成黑、彩度估得太低"的问题。现在 Player 的 C 算法已经
     自己产出深/浅场和 5 档层次，再夹一遍会把它的深主色洗成灰白，
     播放页和行渐变反而失去封面本来的对比。 */
  const rgbToOklch = ([r, g, b]) => {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const B2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const C = Math.sqrt(A * A + B2 * B2);
    const H = C > 1e-7 ? ((Math.atan2(B2, A) * 180 / Math.PI) % 360 + 360) % 360 : 0;
    return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
  };

  /* ================================================================== *
   * 工具箱（整页视图 #view-tools）
   *
   * 以前是入口行第四张卡片下面的下拉浮层 —— 现在是独立整页。
   * 卡片由 TOOLBOX 数组驱动：加一项只改数组，渲染和绑定都不用动。
   * 「自动过渡」已从这里移除 —— 那是音乐实验室内部的 tab，不属于工具箱。
   *
   * 重绘策略：每次 show('tools') 都 innerHTML 重画（条目就那么几条，成本可忽略）；
   * 点击只挂**一次**委托在容器上。浮层时期的「点空白 / Esc」document 监听一并删了 ——
   * 整页没有"点外面关掉"这回事，Esc 归各工具自己的浮层处理。
   * ================================================================== */
  const TOOLBOX = [
    { id: 'migrate', name: '歌单搬运', desc: '跨平台迁移', act: () => window.MIGRATE && window.MIGRATE.open() },
    { id: 'spatial', name: '空间音频', desc: '360° 声场', act: () => window.LIZI_SPATIAL && window.LIZI_SPATIAL.open() },
    // 小卡先隐藏（文件保留，入口和图标一起注释，恢复时取消注释即可）
    // { id: 'holocard', name: '小卡', desc: '专辑 · 导入', act: () => window.LIZI_HOLOCARD && window.LIZI_HOLOCARD.open() },
  ];

  /* 24×24 描边、继承 currentColor。画法和大厅入口 ICONS 一致（1.6 / round cap），
     在 46px 图标砖里缩到 22px 才不糊。 */
  const TOOL_ICONS = {
    migrate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="8.5" width="7.5" height="8" rx="1.5"/><path d="M7 4.5h12.5"/><path d="m17.5 2 2.5 2.5-2.5 2.5"/><path d="M17 19.5H4.5"/><path d="m6.5 17-2.5 2.5 2.5 2.5"/></svg>`,
    spatial: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><ellipse cx="12" cy="12" rx="3.2" ry="7.5"/><path d="M4.5 12h15"/><path d="M6.2 7.8h11.6"/><path d="M6.2 16.2h11.6"/></svg>`,
    /* 小卡入口先隐藏：图标一起注释掉，恢复时整块取消注释。
       小卡：前后错开的两张卡片（前面一张画出山形照片，后面只露上边与右边）
    // holocard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    //   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="13" height="13" rx="2.2"/><path d="M8.5 4.5h9A3.5 3.5 0 0 1 21 8v9"/><path d="m3 16.5 3.6-3.4 2.9 2.6 2.3-2.2 4.2 4.1"/></svg>`,
    */
  };

  const toolsEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toolsGridBound = false;

  /** 把 TOOLBOX 画成整页卡片。可重复调用：容器清了重画，委托只挂一次 */
  function paintToolsPage() {
    const grid = $('tools-grid');
    grid.innerHTML = TOOLBOX.map((t, i) => `
      <button class="tools-page__card" type="button" data-tool="${toolsEsc(t.id)}">
        <span class="tools-page__top">
          <span class="tools-page__ico">${TOOL_ICONS[t.id] || ''}</span>
          <span class="tools-page__idx" aria-hidden="true">0${i + 1}</span>
        </span>
        <span class="tools-page__n">${toolsEsc(t.name)}</span>
        <span class="tools-page__c">${toolsEsc(t.desc)}</span>
        <span class="tools-page__go" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
        </span>
      </button>`).join('');

    if (toolsGridBound) return;
    toolsGridBound = true;
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      const t = TOOLBOX.find((v) => v.id === b.dataset.tool);
      if (t) t.act();
    });
  }

  /* ================================================================== *
   * 视图切换
   * ================================================================== */
  /* 大厅海报的 FLIP 飞行还没落地就被切走时要能回收（Hall 在 mount 时挂上来） */
  let heroFlightCleanup = null;

  function show(next) {
    view = next;
    if (next !== 'now') {
      document.body.classList.remove('from-track', 'is-cover-flying', 'is-hero-flying');
      el.viewNow.classList.remove('from-hero');
      if (heroFlightCleanup) heroFlightCleanup();
    }
    /* 播放页走"海报式"布局：整条播放栏退场，只剩左下角大封面 + 渐变进度 */
    document.body.classList.toggle('is-now', next === 'now');
    /* 离开播放页时把「点一下顶栏」的常驻态收掉，下次进来先是隐藏的 */
    if (next !== 'now') document.body.classList.remove('nowbar-on');
    /* 离开播放页时把队列面板收回歌词（否则下次进来第一眼是队列）。
       复用 setQueuePane：它内部用 $() 现查 DOM，初始化早期调过来也不会踩 TDZ。 */
    if (next !== 'now') setQueuePane(false);
    /* 离开播放页必须收起抽屉，否则下次进来会带着整页左移的位移态。
       只在真的开着时才调 setDrawer：抽屉的 DOM 常量在初始化后段才建好，
       启动早期的 show() 不能碰到它们（TDZ）。 */
    if (next !== 'now' && el.viewNow.classList.contains('is-drawer-open')) setDrawer(false);
    /* 离开大厅时，如果「我的专辑」3D 架子正被铺色面板借用，先搬回原位置，
       保证 show('myalbums') 那条老路径拿到的仍是原来的静态视图节点。 */
    if (next !== 'hall') {
      try { document.dispatchEvent(new CustomEvent('lizi:hall-release-albums')); } catch { /* 老环境 */ }
    }
    el.viewBrowse.classList.toggle('is-active', next === 'browse');
    el.viewNow.classList.toggle('is-active', next === 'now');
    el.viewHall.classList.toggle('is-active', next === 'hall');
    el.viewLab.classList.toggle('is-active', next === 'lab');
    el.viewStage.classList.toggle('is-active', next === 'stage');
    el.viewArtist.classList.toggle('is-active', next === 'artist');
    el.viewAlbum.classList.toggle('is-active', next === 'album');
    el.viewAudio.classList.toggle('is-active', next === 'audio');
    el.viewSettings.classList.toggle('is-active', next === 'settings');   // 设置（整页）
    el.viewMyAlbums.classList.toggle('is-active', next === 'myalbums');   // 我的专辑（3D 陈列架）
    el.viewTools.classList.toggle('is-active', next === 'tools');         // 工具箱（整页）
    el.viewForms.classList.toggle('is-active', next === 'forms');         // 形态长廊（整页 iframe）
    document.body.dataset.view = next;      // pages/nav.js 靠它记「来源页」
    /* 离开设置页：扫码轮询立刻停（面板时代是 closePanel 顺手做的，现在没有面板了） */
    if (next !== 'settings') pauseSettingsPolls();
    Pages.onShow(next);                     // 离开歌手/专辑页 → 访问栈作废
    /* 离开实验室（大厅 / 搜索 / 播放页 / 形态页）时，自动过渡的演示音源要立刻停，
       不能让它自己响完 —— 用户要的是「我走了就不该还有声音」。 */
    if (next !== 'lab' && labStopXfade) labStopXfade();
    if (next === 'hall') Hall.mount();
    /* 离开大厅：吸底卡的 scroll 监听要立刻摘掉（见 Hall.leave） */
    else Hall.leave();
    /* 工具箱整页：每次进来重画一次（数组驱动，条目少，innerHTML 最省心）；
       事件委托在 paintToolsPage 里只挂一次，来回切换不会叠监听。 */
    if (next === 'tools') paintToolsPage();
    /* 形态长廊整页：第一次进入才把 iframe 指向 /forms-labs/；
       离开时立刻卸成 about:blank，画廊的 rAF / WebGL 不会在后台继续跑。
       下次再进来重新加载，所以不会带着上一次的滚动/相机状态。 */
    if (el.formsFrame) {
      if (next === 'forms') {
        if (el.formsFrame.getAttribute('src') !== '/forms-labs/') {
          el.formsFrame.setAttribute('src', '/forms-labs/');
        }
      } else if (el.formsFrame.getAttribute('src') !== 'about:blank') {
        try { el.formsFrame.setAttribute('src', 'about:blank'); } catch { /* 忽略 */ }
      }
    }
    /* 顶栏左键跟着视图换身份：大厅 = 设置，其余 = 返回大厅 */
    setTopLeftMode(next === 'hall' ? 'settings' : 'back');
    /* 换了视图，顶栏的「已滚过」状态要在新视图上重新判定，否则会带着上一个视图的收缩态 */
    {
      const sv = next === 'browse' ? el.viewBrowse : next === 'hall' ? el.viewHall
        : next === 'artist' ? el.viewArtist : next === 'album' ? el.viewAlbum
          : next === 'audio' ? el.viewAudio : next === 'settings' ? el.viewSettings
            : next === 'tools' ? el.viewTools
              : next === 'myalbums' ? el.viewMyAlbums : null;
      onScroll(sv ? sv.scrollTop : 0);
    }
    location.hash = next === 'now' ? 'now' : '';
    if (next === 'stage') {
      StageHost.enter();
    } else {
      StageHost.leave();
      if (next === 'now') {
        /* 播放页没有"拉起歌词"按钮了，直接常开 */
        setLyricsOpen(true);
        /* 布局落定后把封面列下移到"封面中心 = 歌词列中线"。
           再补一次 700ms 后的复算：进播放页时 grid/歌词列还在做 560ms 过渡，
           第一次量到的中线是过渡途中的，会差十几像素。 */
        requestAnimationFrame(() => {
          alignArtToLyrics();
          LiquidGlass.refresh();
          setTimeout(alignArtToLyrics, 700);
        });
      } else setLyricsOpen(false);
    }
    syncDock();
    if (next === 'now') startNowLoop(); else stopNowLoop();
  }

  /* ================================================================== *
   * 歌词面板的拉起 / 收起
   *
   * 面板收起时宽度是 0，玻璃引擎在 0×0 上挂载会生成 1×1 位移贴图，
   * 展开后折射边缘会整体跑位。所以玻璃**延迟到第一次拉起时**才挂载，
   * 每次展开动画结束再 refresh 一次，保证贴图和最终尺寸一致。
   * ================================================================== */
  let lyricsOpen = false;
  let panelGlassMounted = false;

  function setLyricsOpen(open) {
    if (open === lyricsOpen) return;
    lyricsOpen = open;
    el.viewNow.classList.toggle('is-lyrics-open', open);

    if (open && !panelGlassMounted) {
      panelGlassMounted = true;
      // 等轨道动画把宽度让出来再挂，否则量到的还是 0
      requestAnimationFrame(() => {
        LiquidGlass.mount(el.lyricsPanel, { autoScale: true, scaleRef: 220, border: 0.07 });
        LiquidGlass.refresh();
      });
    }

    // 动画结束后再对齐一次贴图（引擎自己有防抖，这里兜个底）
    clearTimeout(setLyricsOpen._t);
    setLyricsOpen._t = setTimeout(() => LiquidGlass.refresh(), 620);
  }

  const toggleLyrics = () => setLyricsOpen(true);   // 收起功能已删，保留空壳给旧调用

  /* ================================================================== *
   * 渲染
   * ================================================================== */
  function renderPlaylists(lists) {
    el.playlists.innerHTML = '';
    if (!lists.length) {
      el.playlists.innerHTML = '<p class="hint">登录后显示你的歌单</p>';
      return;
    }
    for (const p of lists) {
      const b = document.createElement('button');
      b.className = 'pl';
      b.dataset.id = p.id;
      b.innerHTML = `<img src="${API.img(p.cover, 80)}" alt="" loading="lazy">
        <span class="pl__text"><span class="pl__name"></span><span class="pl__count">${p.trackCount} 首</span></span>`;
      b.querySelector('.pl__name').textContent = p.name;
      b.addEventListener('click', () => openPlaylist(p));
      el.playlists.appendChild(b);
    }
  }

  /** headings：可选，{ 索引: 标题 }。只在「全部音源」那种分组列表里用，
      在对应行之前插一条分组标题（它是 <li>，但不带 data-index，不会被点播）。 */
  function renderTracks(tracks, headings) {
    currentList = tracks;
    el.tracks.innerHTML = '';
    if (!tracks.length) {
      el.tracks.innerHTML = '<p class="hint">这里还没有歌</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    tracks.forEach((t, i) => {
      if (headings && headings[i]) {
        const h = document.createElement('li');
        h.className = 'track-group';
        h.textContent = headings[i];
        frag.appendChild(h);
      }
      const li = document.createElement('li');
      li.className = 'track';
      li.dataset.index = i;
      // VIP 曲目标一个「VIP」小签，让用户预期到会走演示音轨
      const flag = t.fee === 1 || t.fee === 4 ? '<span class="track__flag">VIP</span>' : '';
      /* 封面在列表里显示 164px；Retina（DPR 2）需要 328 设备像素，
         所以按 400 取。之前写死 80 —— 被放大 4 倍，糊得没法看。 */
      const thumb = t.cover
        ? `<img class="track__cover" src="${API.img(t.cover, 400)}" alt="" loading="lazy" decoding="async">`
        : '<span class="track__cover track__cover--ph"></span>';
      li.innerHTML = `
        ${thumb}
        <span class="track__body">
          <span class="track__name"></span>
          <span class="track__sub"></span>
        </span>
        ${flag}
        <span class="track__dur">${fmtTime((t.duration || 0) / 1000)}</span>`;
      li.querySelector('.track__name').textContent = t.name;
      /* 歌手名 / 专辑名都做成入口（点击由 document 上那次捕获代理接走） */
      li.querySelector('.track__sub').innerHTML = t.album
        ? `${artistLinks(t.artists, t.artistIds)} · ${albumLink(t.album, t.albumId)}`
        : artistLinks(t.artists, t.artistIds);

      /* 取封面的颜色，给行右侧那团模糊渐变用。
         图片本来就加载了，而且走的是同源 /api/img 代理，
         所以可以直接 drawImage + getImageData，不用再发一次请求。 */
      const img = li.querySelector('.track__cover');
      if (img && img.tagName === 'IMG') {
        const paint = () => paintWash(li, img);
        if (img.complete && img.naturalWidth) paint();
        else img.addEventListener('load', paint, { once: true });
      }

      // 只绑 click。不能再绑 dblclick：双击会先后触发 click 和 dblclick，
      // 两次 playQueue 并发会被播放器的竞态令牌判定为过期，结果双击反而没声音。
      li.addEventListener('click', () => {
        const start = () => {
          if (Player.state.index === i && Player.state.queue === currentList) Player.toggle();
          else Player.playQueue(currentList, i);
        };
        runTrackTransition(li, start);
      });
      frag.appendChild(li);
    });
    el.tracks.appendChild(frag);
    el.tracks.scrollTop = 0;
  }

  /* --------------------------------------------------------------------------
     点击歌曲 → 进播放页 的转场
     分三段，每段用不同的非线性缓动，拼起来才像"流光"而不是匀速平移：

       ① 0 → 400ms   色条在**行内**往左扫，把整条铺满
                     缓动 cubic-bezier(.5,0,.2,1)：慢起、中段快、慢收
       ② 400 → 880ms 从"整行"这个矩形**扩大**到全屏
                     缓动 cubic-bezier(.16,1,.3,1)：一冲而出再长尾收住
       ③ 380 → 940ms 封面飞向播放页封面的真实位置（和②重叠，不是排队）
                     缓动带一点回弹 cubic-bezier(.34,1.28,.5,1)

     最后交接：铺满的瞬间切页，转场层淡出，露出播放页。
     -------------------------------------------------------------------------- */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------------------
     点击歌曲 → 进播放页 的转场（本轮重做）

     以前：色条在行内扫满 → 整行扩大铺满全屏 → 封面飞向居中大图。
     现在整页重新设计过，转场也跟着改成一个更直接的隐喻：
     **行右侧那团颜色直接脱下来，飞到底部，变成播放页的进度带。**

       ① 立刻切到播放页（歌词和封面先就位），底部进度带暂时藏起来
       ② 克隆行右侧那条色带，从它在行里的位置出发，
          用 transform 飞到进度带的矩形（非等比缩放，渐变跟着拉长）
       ③ 落地：撤掉克隆，露出真正的进度带，从当前位置继续长

     全程只动 transform / opacity，一个布局属性都不碰。
     -------------------------------------------------------------------------- */
  /* --------------------------------------------------------------------------
     行的封面 → 播放页大封面
     和色带同一套 transform 手法：从行封面的矩形出发，落到 #now-art 的矩形上，
     落地淡出，露出真正的大封面。中间不碰任何布局属性。
     -------------------------------------------------------------------------- */
  function flyCoverToNow(li, a0) {
    const img = li.querySelector('img');
    const art = el.nowArt;
    const disc = art && (art.closest('.disc') || art);
    const unhide = () => document.body.classList.remove('is-cover-flying');
    if (!img || !art || !disc || !a0 || a0.width < 8) { unhide(); return; }
    /* 终点量 **disc**（圆角容器）—— 它才是带圆角和阴影的那个视觉封面。
       调用方在切页那一帧关掉了布局过渡，所以现在量到的就是最终位置。 */
    const a1 = disc.getBoundingClientRect();
    if (a1.width < 8) { unhide(); return; }
    const src = img.currentSrc || img.src;
    if (!src) return;

    const node = document.createElement('div');
    node.className = 'cover-fly';
    node.style.left = a0.left + 'px';
    node.style.top = a0.top + 'px';
    node.style.width = a0.width + 'px';
    node.style.height = a0.height + 'px';
    node.style.backgroundImage = 'url("' + src + '")';
    document.body.appendChild(node);

    const s = a1.width / a0.width;
    /* 起飞时封面还是"行里的直角裸图"，落地才该是 16px 圆角 + 重投影；
       让圆角和投影跟着飞一并长出来，而不是一出发就变了样 */
    const anim = node.animate([
      {
        transform: 'translate(0px, 0px) scale(1)',
        borderRadius: '0px',
        boxShadow: '0 0 0 rgba(0,0,0,0)',
      },
      {
        transform: 'translate(' + (a1.left - a0.left) + 'px, ' + (a1.top - a0.top) + 'px) scale(' + s + ')',
        borderRadius: '16px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      },
    ], { duration: 640, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' });

    /* 撤的时机不是"飞到位"，而是"真封面画出来了"：
       now-art 的 src 是切页时才赋值的，大图没加载完就撤层会露出黑底。
       所以到位后先钉住，load（或已 complete）再撤；1.2 秒兜底必撤。 */
    let out = false;
    const gone = () => {
      if (out) return;
      out = true;
      /* 真封面和飞行层是同一张图、同一个矩形：先让真封面在下面露出来，
         再淡出飞行层 —— 交换无感（以前是封面先自己淡入，飞行层再飞一遍） */
      unhide();
      node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
      setTimeout(() => node.remove(), 100);
    };
    /* 两个条件都满足才撤：① 飞行已到位 ② 真封面已画出来 */
    let landedOk = false, artOk = false;
    const maybe = () => { if (landedOk && artOk) gone(); };
    anim.onfinish = () => { landedOk = true; maybe(); };
    /* 兜底：动画被取消/后台标签页 onfinish 不来，也不能让封面一直藏着 */
    setTimeout(() => { landedOk = true; unhide(); maybe(); }, 1400);
    const markArt = () => { artOk = true; maybe(); };
    if (art.complete && art.naturalWidth > 0) markArt();
    else {
      art.addEventListener('load', markArt, { once: true });
      art.addEventListener('error', markArt, { once: true });
      setTimeout(markArt, 1200);        // 兜底：图一直不加载也不能永远盖着
    }
  }

  function runTrackTransition(li, start) {
    const tones = li.__tones;
    const cs = getComputedStyle(li);
    const c1 = tones ? tones[0] : cs.getPropertyValue('--c1').trim();
    const c2 = tones ? tones[1] : cs.getPropertyValue('--c2').trim();
    const rs = document.documentElement.style;
    if (c1) rs.setProperty('--bar-a', c1);
    if (c2) rs.setProperty('--bar-b', c2);
    if (tones) {
      rs.setProperty('--tone-a', tones[0]);
      rs.setProperty('--tone-b', tones[1]);
      rs.setProperty('--tone-c', tones[2]);
    }

    const lr = li.getBoundingClientRect();
    const rowImg = li.querySelector('img');
    const a0 = rowImg ? rowImg.getBoundingClientRect() : null;

    /* 先把页面切过去：这样进度带的真实位置量得到，音乐也开始播 */
    start();

    /* 关键：切页这一帧先关掉播放页的布局过渡 —— .now__stage 的
       grid-template-columns 过渡会让封面终点在 ~150ms 内从错误位置滑到
       正确位置（实测差 310px）。以前只能等 700ms 再量终点，结果"真封面"
       先淡入、飞行副本后到，看着像重影。关掉过渡后终点立刻就是最终值：
       封面和色带同时起飞，真封面先藏着，等飞行层落地再露。 */
    const vn = el.viewNow;
    /* 旧视图淡出比飞行慢：起飞头 100ms 会同时看到"行里的封面"和飞行副本。
       转场时让旧视图更快退场，只留飞行层这一份封面。 */
    document.body.classList.add('from-track');
    vn.classList.add('no-layout-anim');
    show('now');
    void vn.offsetWidth;                     // 强制重排，让上面的类先生效
    if (!reduceMotion && a0 && a0.width > 8) {
      /* 先把封面列下移到位，再量飞行终点 —— 否则飞行层落点会差一个下移量 */
      alignArtToLyrics();
      document.body.classList.add('is-cover-flying');
      flyCoverToNow(li, a0);
    }
    vn.classList.remove('no-layout-anim');

    if (reduceMotion) return;

    const band = el.dockBar;
    const paint = el.dockPaint;
    if (!band || !paint) return;
    const br = band.getBoundingClientRect();
    if (br.width < 20 || br.height < 4) return;

    /* 起点 = 行右侧那 36% 的色带（和 .track::after 的范围对齐） */
    const w0 = lr.width * 0.36, h0 = lr.height;
    const x0 = lr.right - w0, y0 = lr.top;

    const fly = document.createElement('div');
    fly.className = 'strip-fly';
    if (c1) fly.style.setProperty('--c1', c1);
    if (c2) fly.style.setProperty('--c2', c2);
    fly.style.left = br.left + 'px';
    fly.style.top = br.top + 'px';
    fly.style.width = br.width + 'px';
    fly.style.height = br.height + 'px';
    document.body.appendChild(fly);

    /* 真正的进度带先藏起来，等飞机落地再露出来 */
    paint.style.opacity = '0';

    const dx = x0 - br.left, dy = y0 - br.top;
    const sx = Math.max(0.001, w0 / br.width), sy = Math.max(0.001, h0 / br.height);

    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      /* 不要"啪"地消失：让飞行的那条从整条**抽回**到当前进度那一点点，
         抽完才撤，真进度带同时浮现 —— 看起来是一条色带被抽细，而不是被掐断。 */
      const dur = Player.audio.duration;
      const p = Number.isFinite(dur) && dur > 0
        ? Math.max(0.012, Math.min(1, (Player.audio.currentTime || 0) / dur))
        : 0.012;
      paint.style.opacity = '';
      const retract = fly.animate(
        [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 ' + (100 - p * 100).toFixed(2) + '% 0 0)' }],
        { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
      );
      let out = false;
      const gone = () => {
        if (out) return;
        out = true;
        fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
        setTimeout(() => fly.remove(), 200);
      };
      retract.onfinish = gone;
      setTimeout(gone, 700);            // 兜底
    };
    const anim = fly.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      { duration: 640, easing: 'cubic-bezier(.42,0,.08,1)', fill: 'both' }
    );
    anim.onfinish = land;
    setTimeout(land, 900);              // 兜底：后台标签页里 onfinish 可能不来
  }
  /* --------------------------------------------------------------------------
     顶栏 / 播放条的进场
     顺序是：渐变铺满 → 切页 → 顶栏从上沉下来、播放条从下浮上来（同时淡入）。
     做法：先加 .bars-out.bars-snap 把它们"瞬间"摆到画面外（这一帧关掉过渡），
     强制一次重排，再移除 .bars-out —— 过渡就会从场外平滑跑回原位。
     -------------------------------------------------------------------------- */
  function enterBars() {
    if (reduceMotion) return;
    const b = document.body;
    b.classList.add('bars-out', 'bars-snap');
    void b.offsetHeight;                 // 强制重排，让"场外"这一帧先生效
    b.classList.remove('bars-snap');
    const go = () => {
      b.classList.remove('bars-out');
      // 两条栏开始下沉/上浮之后，里面的按钮再逐个"长出来"
      b.classList.add('now-enter');
      setTimeout(() => b.classList.remove('now-enter'), 1600);
    };
    requestAnimationFrame(go);
    // rAF 在标签页隐藏时不会跑 —— 补一个定时器，
    // 否则切走再切回来顶栏和播放条会一直停在场外。
    setTimeout(go, 120);
  }

  /* --------------------------------------------------------------------------
     从封面取色，写到 --c1 / --c2 / --c3，给行右侧的模糊渐变当色源。
     三个"必须一致"的点：
       ① 算法要和播放页背景一样（Player 的 OKLCH 聚类 k=4）
       ② 缓存键要和播放页一样（同一张 400px 图的 URL），命中同一次聚类
       ③ **变换也要一样** —— 必须过一遍纯转换的 rgbToOklch（不再夹明度/彩度），
          否则行渐变和播放页会把同一套色板显示成两种颜色。
     -------------------------------------------------------------------------- */
  function paintWash(li, img) {
    const palette = Player.paletteFromCover(img);
    if (!palette) return;
    // 按图片 URL 存进 Player 的取色缓存：播放页会用同一个 URL 来取，
    // 命中同一次聚类算出的完整色板
    Player.rememberColors(img.currentSrc || img.src, palette);

    const tones = palette.colors.map(rgbToOklch);
    li.style.setProperty('--c1', tones[0]);
    li.style.setProperty('--c2', tones[1]);
    li.style.setProperty('--c3', tones[2]);
    li.__tones = tones;                // 转场直接用，不再重算
    li.classList.add('has-wash');
  }

  /* --------------------------------------------------------------------------
     歌词滚动：缓动，而不是一次 scrollTop 硬跳
     以前换行是"啪"地瞬移；这里用 cubic ease-out 在 ~560ms 内滑过去，
     并且如果用户刚自己滚过（2.5s 内），就不抢他的位置。
     目标位置用 getBoundingClientRect 算 —— 不能用 offsetTop，
     因为 offsetParent 会随版式变化（现在 .shell.now 是 position:relative）。
     -------------------------------------------------------------------------- */
  let lyRaf = 0, lyFrom = 0, lyTo = 0, lyT0 = 0, lyUserAt = 0;
  const LY_MS = 560;
  const lyEase = (t) => 1 - Math.pow(1 - t, 3);

  function scrollLyricToEl(node) {
    const box = el.lyrics;
    if (!box || !node) return;
    if (performance.now() - lyUserAt < 2500) return;
    /* 视图还没切过来（或列还没高度）时 rect 全是 0，算出来的目标是垃圾值 —— 直接不滚 */
    if (view !== 'now' || box.clientHeight < 80) return;
    const boxR = box.getBoundingClientRect();
    const curR = node.getBoundingClientRect();
    /* 锚点 = 歌词列正中的高度：当前行永远停在视觉中线（用户定的规则：
       歌词是主体，封面去服从它 —— 见 alignArtToLyrics） */
    const anchorY = boxR.top + boxR.height / 2;
    const target = box.scrollTop + (curR.top - boxR.top) + curR.height / 2 - (anchorY - boxR.top);
    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    lyTo = Math.max(0, Math.min(max, target));
    lyFrom = box.scrollTop;
    if (Math.abs(lyTo - lyFrom) < 1) { box.scrollTop = lyTo; return; }
    /* 目标离得太远（换歌/跳转）：直接落位，不要一路滑过十几行 */
    if (Math.abs(lyTo - lyFrom) > box.clientHeight * 1.5) {
      box.scrollTop = lyTo;
      return;
    }
    if (lyRaf) cancelAnimationFrame(lyRaf);
    lyT0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - lyT0) / LY_MS);
      box.scrollTop = lyFrom + (lyTo - lyFrom) * lyEase(t);
      lyRaf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    lyRaf = requestAnimationFrame(step);
  }
  /* --------------------------------------------------------------------------
     封面服从歌词：把左列（封面 + 信息 + 传输 + 音量）整体下移，
     让**封面中心**落在歌词列中线上（当前行所在的那条线）。
     下移量还要受舞台底部约束（不能钻到 dock 底下），放不下就尽量往下。
     锚点由 scrollLyricToEl 保证是"歌词列正中"。
     -------------------------------------------------------------------------- */
  function alignArtToLyrics() {
    if (view !== 'now') return;
    const art = document.querySelector('.now__art');
    const disc = document.querySelector('.disc');
    const box = el.lyrics;
    const stage = document.querySelector('.now__stage');
    if (!art || !disc || !box || !stage) return;
    /* 量之前先把过渡关掉、偏移清零：
       否则 .now__art 上的 transform 过渡会让 getBoundingClientRect 量到动画中途的位置，
       每次调用都会少算一点，偏移越算越小（实测会直接归零）。 */
    art.style.transition = 'none';
    art.style.transform = '';
    if (!el.viewNow.classList.contains('is-lyrics-open')) { art.style.transition = ''; return; }
    const ar = art.getBoundingClientRect();
    const dr = disc.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const want = (br.top + br.height / 2) - (dr.top + dr.height / 2);
    const room = sr.bottom - 2 - (ar.top + ar.height);   // 还能往下挪多少
    const shift = Math.max(0, Math.min(want, room));
    if (shift > 0.5) art.style.transform = `translateY(${shift.toFixed(1)}px)`;
    void art.offsetWidth;                                // 让这次赋值先落地
    art.style.transition = '';
  }

  /* 字号/字体/封面加载完，左列高度会变（歌名换行、字体替换），
     每次变都重新对齐一次 —— 否则封面会差个十几像素对不上歌词中线。 */
  try {
    const artEl = document.querySelector('.now__art');
    if (artEl && window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (view !== 'now') return;
        requestAnimationFrame(alignArtToLyrics);
      });
      ro.observe(artEl);
    }
  } catch { /* 老浏览器没有 ResizeObserver 就算了 */ }

  /* 界面比例：默认窗口 1192×910 = 1.0；最小 0.8，最大 2.2（4K 下不至于离谱） */
  function updateUiScale() {
    const s = Math.max(0.8, Math.min(2.2, Math.min(innerWidth / 1192, innerHeight / 910)));
    document.documentElement.style.setProperty('--ui-scale', s.toFixed(3));
  }

  if (el.lyrics) {
    const markUser = () => { lyUserAt = performance.now(); };
    el.lyrics.addEventListener('wheel', markUser, { passive: true });
    el.lyrics.addEventListener('pointerdown', markUser, { passive: true });
    el.lyrics.addEventListener('touchstart', markUser, { passive: true });

    /* 点歌词 → 跳到那句（dataset.t 是这句的起始秒） */
    el.lyrics.addEventListener('click', (e) => {
      const line = e.target.closest('.ly');
      if (!line || line.dataset.t == null) return;
      const t = Number(line.dataset.t);
      if (!Number.isFinite(t)) return;
      lyUserAt = 0;                 // 清掉"用户刚滚过"的抑制，让自动滚动跟到这一句
      try { Player.seek(t); } catch { /* 播放器还没准备好就忽略 */ }
      scrollLyricToEl(line);
    });
  }
  function renderLyric({ lines, active, charIndex, format }) {
    // 播放页下方的 3 行预览跟着一起更新
    renderPeek(lines, active);

    if (!lines.length) {
      if (el.lyrics.dataset.count !== '0') {
        el.lyrics.innerHTML = '<p class="hint">这首没有歌词</p>';
        el.lyrics.dataset.count = '0';
      }
      el.lyFormat.hidden = true;
      el.peekHint.textContent = '这首歌没有歌词';
      return;
    }
    el.peekHint.textContent = lyricsOpen ? '' : '上拉查看完整歌词';

    if (el.lyrics.dataset.count !== String(lines.length)) {
      el.lyrics.dataset.count = String(lines.length);
      el.lyrics.innerHTML = '';
      /* 换歌时清掉上一首的滚动位置和正在跑的滚动动画：
         不清的话，新歌第一句会从上一首的 scrollTop 一路滑上来，
         看起来就是"进歌一下滑了好多行"。 */
      if (lyRaf) { cancelAnimationFrame(lyRaf); lyRaf = 0; }
      el.lyrics.scrollTop = 0;
      const frag = document.createDocumentFragment();
      lines.forEach((l, i) => {
        const p = document.createElement('p');
        p.className = 'ly';
        p.dataset.i = i;
        p.dataset.t = l.t;              // 点这一行 → 跳到这句

        /* 正文包一层 .ly__main：非当前行用 transform 缩小它，
           字号不参与布局 —— 折行位置永远不变（不会"当前行变大就折两行"） */
        const main = document.createElement('span');
        main.className = 'ly__main';
        if (l.chars) {
          // 逐字：每个字一个 span，高亮时按 charIndex 逐个点亮
          l.chars.forEach((ch, ci) => {
            const s = document.createElement('span');
            s.className = 'ly__c';
            s.dataset.ci = ci;
            s.textContent = ch.c;
            main.appendChild(s);
          });
        } else {
          main.textContent = l.text;
        }
        p.appendChild(main);

        if (l.tr) {
          const s = document.createElement('span');
          s.className = 'ly__tr';
          s.textContent = l.tr;
          p.appendChild(s);
        }
        frag.appendChild(p);
      });
      el.lyrics.appendChild(frag);
    }

    // 逐字模式给个角标，让用户知道现在是逐字歌词
    el.lyFormat.hidden = format !== 'yrc';
    if (format === 'yrc') el.lyFormat.textContent = '逐字';

    const prev = el.lyrics.querySelector('.ly.is-active');
    if (prev && +prev.dataset.i !== active) {
      prev.classList.remove('is-active');
      prev.querySelectorAll('.ly__c.is-sung').forEach((s) => s.classList.remove('is-sung'));
    }

    if (active >= 0) {
      const cur = el.lyrics.querySelector(`.ly[data-i="${active}"]`);
      if (cur) {
        const wasActive = cur.classList.contains('is-active');
        cur.classList.add('is-active');
        // 逐字点亮：给已经唱过的字加 .is-sung
        if (charIndex >= 0) {
          const chars = cur.querySelectorAll('.ly__c');
          for (let i = 0; i < chars.length; i++) {
            chars[i].classList.toggle('is-sung', i <= charIndex);
          }
        }
        // 「上浮」模式要知道哪些句子已经唱过，才能把它们压暗留在上方
        if (!wasActive) {
          el.lyrics.querySelectorAll('.ly.is-sung-line').forEach((n) => n.classList.remove('is-sung-line'));
          el.lyrics.querySelectorAll('.ly').forEach((n) => {
            if (+n.dataset.i < active) n.classList.add('is-sung-line');
          });
        }
        // 只在换行时滚动（逐字刷新时不滚，否则歌词会一直抖）；滚动本身走缓动
        if (!wasActive) scrollLyricToEl(cur);
      }
    }
  }

  function markCurrent(index) {
    el.tracks.querySelectorAll('.track').forEach((li, i) => li.classList.toggle('is-current', i === index));
  }

  /* ------------------------------------------------------------------ *
   * 封面下方的 3 行歌词预览
   * 显示 [上一句, 当前句, 下一句]，当前句在中间并高亮。
   * 只在「换行」或「换歌」时重绘（逐字刷新不重绘），否则每 100ms 重排会很抖。
   * ------------------------------------------------------------------ */
  let peekIndex = -2;
  let peekLines = null;

  /* ================================================================== *
   * 节拍检测器的界面
   *
   * 频率：每帧只做最便宜的 transform 写（封面脉动），
   * 频谱画在 canvas 上（不产生 DOM），BPM 数字只在变化超过 1 时才改，
   * 避免每帧写文本导致的排版抖动。
   * ================================================================== */
  const beatUI = (() => {
    const spec = el.beatSpec;
    const ctx = spec ? spec.getContext('2d') : null;
    const dots = el.beatDots ? [...el.beatDots.children] : [];
    let shownBpm = 0;
    let lastDot = -1;
    let lastLabel = '';
    let off = false;

    // canvas 按设备像素比放大，避免糊
    function fitCanvas() {
      if (!spec || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = spec.clientWidth || 168, h = spec.clientHeight || 40;
      spec.width = Math.round(w * dpr);
      spec.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fitCanvas();
    window.addEventListener('resize', fitCanvas, { passive: true });
    /* 播放页等比例缩放：以默认窗口 1192×910 为基准。窗口放大（尤其最大化到
       2560×1400）时，封面/歌词/按钮一起按同一比例放大，不然就是"一小撮东西
       漂在大屏幕上"。--ui-scale 在 app.css 里乘到各个尺寸上。 */
    window.addEventListener('resize', () => {
      updateUiScale();
      alignArtToLyrics();
      const act = el.lyrics.querySelector('.ly.is-active');
      if (act && view === 'now') { lyUserAt = 0; scrollLyricToEl(act); }
    }, { passive: true });
    updateUiScale();

    const BARS = 32;

    function drawSpectrum() {
      if (!ctx || off || !Beat.spectrum) return;
      const w = spec.clientWidth || 168, h = spec.clientHeight || 40;
      ctx.clearRect(0, 0, w, h);

      const data = Beat.spectrum;
      const n = data.length;
      const bw = w / BARS;
      for (let i = 0; i < BARS; i++) {
        // 对数分桶：低频给更多格子，视觉上更接近听感
        const lo = Math.floor(Math.pow(i / BARS, 1.7) * n * 0.6);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * n * 0.6));
        let peak = 0;
        for (let k = lo; k < hi && k < n; k++) if (data[k] > peak) peak = data[k];

        const v = (peak / 255) ** 1.25;
        const bh = Math.max(1.5, v * h);
        // 低频偏红、高频偏青，和整体色板一致
        const hue = 12 + (i / BARS) * 190;
        ctx.fillStyle = `oklch(${58 + v * 22}% ${0.14 + v * 0.1} ${hue} / ${0.35 + v * 0.6})`;
        ctx.fillRect(i * bw + 0.6, h - bh, bw - 1.2, bh);
      }
    }

    function setDots(index) {
      if (index === lastDot) return;
      dots.forEach((d, i) => {
        d.classList.toggle('is-on', i === index);
        d.classList.toggle('is-downbeat', i === 0);
      });
      lastDot = index;
    }

    return {
      get off() { return off; },
      toggle() {
        off = !off;
        el.beats.classList.toggle('is-off', off);
        // 用类告诉布局"节拍条占着位置"，窄屏据此给整列留出底部空间
        el.viewNow.classList.toggle('has-beats', !off);
        el.btnBeat.setAttribute('aria-pressed', String(!off));
        // 抽屉里那行要跟着显示"开/关"
        const v = $('beat-toggle-val');
        if (v) v.textContent = off ? '关' : '开';
        if (!off) fitCanvas();
      },
      fit: fitCanvas,
      /** 手动校正后同步内部记录，避免下一帧又把它改回去 */
      syncShown(bpm) { if (bpm) shownBpm = bpm; },

      onFrame(st) {
        if (off) return;
        /* 形态页里节拍面板是不可见的：不画频谱、不写 DOM。
           这里每帧一张 480×120 的 canvas + 几次文字改写，省下来是白赚的。 */
        if (!document.body.classList.contains('is-now')) return;
        drawSpectrum();
        const bpm = Math.round(st.bpm);
        if (bpm && Math.abs(bpm - shownBpm) >= 1) {
          shownBpm = bpm;
          el.beatBpm.textContent = String(bpm);
          el.beats.classList.add('is-locked');
        }
        // 状态文案要独立于 BPM 变化去刷新：
        // 之前把它塞在"BPM 变了才更新"的分支里，结果 BPM 一稳定，
        // 文案就永远停在第一次写下的"估计中"
        const src = st.tempoSource;
        let label;
        if (!st.bpm) label = st.tempoSource === 'metadata' ? '读取中…' : '分析中…';
        else if (src === 'metadata') label = '元数据';
        else if (src === 'manual') label = '手动校正';
        else if (st.lowRate) label = '节拍不稳';
        else label = st.confidence > 0.45 ? '实时检测' : '估计中';
        if (label !== lastLabel) {
          lastLabel = label;
          el.beatState.textContent = label;
          el.beats.classList.toggle('is-meta', src === 'metadata');
        }
        el.beatConf.style.width = Math.round(Math.min(1, st.confidence) * 100) + '%';
      },

      onBeat({ index, offset }) {
        if (off) return;
        if (!document.body.classList.contains('is-now')) return;
        setDots(offset);
        el.disc?.classList.remove('is-beat');
        void el.disc?.offsetWidth;              // 重播动画
        el.disc?.classList.add('is-beat');
      },

      reset() {
        shownBpm = 0;
        lastDot = -1;
        lastLabel = '';
        el.beatBpm.textContent = '--';
        el.beats.classList.remove('is-locked');
        el.beatState.textContent = '等待播放';
        el.beatConf.style.width = '0%';
        dots.forEach((d) => d.classList.remove('is-on'));
      },
    };
  })();

  Beat.on('frame', (st) => { beatUI.onFrame(st); StageHost.onLive(st); });
  Beat.on('beat', (b) => { beatUI.onBeat(b); StageHost.onBeat(b); });
  // 元数据到了立刻显示，不用等下一帧（体感上"秒出"）
  Player.on('bpmsource', ({ bpm, source }) => {
    if (source === 'metadata' && bpm) {
      el.beatBpm.textContent = String(Math.round(bpm));
      el.beats.classList.add('is-locked', 'is-meta');
      el.beatState.textContent = '元数据';
      el.beatConf.style.width = '100%';
      beatUI.syncShown(Math.round(bpm));
    } else {
      el.beats.classList.remove('is-meta');
      el.beatState.textContent = '实时检测中…';
    }
  });
  el.btnBeat.addEventListener('click', () => beatUI.toggle());   // 抽屉里的行已删，按钮不存在时是 no-op
  // 倍速修正：立刻改数字，不然要等下一次估计（最多 0.7s）才刷新
  const bumpTempo = (f) => {
    Beat.scaleTempo(f);
    const bpm = Math.round(Beat.state.bpm);
    if (bpm) {
      el.beatBpm.textContent = String(bpm);
      el.beats.classList.add('is-locked');
      el.beatState.textContent = '已手动校正';
    }
    beatUI.syncShown(bpm);
  };
  $('beat-half')?.addEventListener('click', () => bumpTempo(0.5));
  $('beat-double')?.addEventListener('click', () => bumpTempo(2));
  el.disc?.addEventListener('animationend', () => el.disc.classList.remove('is-beat'));

  /* ================================================================== *
   * 歌词动画模式（参考 folia 的多套全屏歌词动画）
   * ================================================================== */
  const LYRIC_MODES = ['classic', 'focus', 'rise'];
  // 抽屉里的模式入口已撤掉，模式固定回经典（不再读 localStorage，
  // 免得以前选过「上浮」的用户被锁在改不回去的模式上）。
  let lyricMode = 'classic';

  function setLyricMode(mode) {
    lyricMode = mode;
    localStorage.setItem('lyricMode', mode);
    el.lyrics.classList.remove(...LYRIC_MODES.map((m) => `lyrics--${m}`));
    el.lyrics.classList.add(`lyrics--${mode}`);
    // 换模式后重排一次，让当前句立刻归位
    const active = el.lyrics.querySelector('.ly.is-active');
    if (active) { lyUserAt = 0; scrollLyricToEl(active); }
  }

  /* ================================================================== *
   * 舞台：把作品当整页，播放器收成自动隐藏的细条
   *
   * 和作品的约定（都是 postMessage，作品不理会也照常跑）：
   *   父 → 作品  init  整首歌的歌词时间轴 + 主色 + 曲目信息（换歌时发一次）
   *              tick  当前播放秒数，约 15Hz（作品自己插值，不用 60Hz 刷消息）
   *              beat  每一次节拍
   *              live  BPM / 能量 / 频段，约 8Hz
   *   作品 → 父  ready / error
   * ================================================================== */
  const STAGES = [
    { id: 'classic', name: '传统播放器', desc: '大封面 + 歌词面板', url: null },
    { id: '001', name: '粒子歌词', desc: '粒子在不同地方聚成词，镜头移过去', url: 'stages/001-particle-lyrics.html' },
    { id: '002', name: '星际歌词', desc: '一路飞过去，一句一句穿过', url: 'stages/002-starfield-lyrics.html' },
    { id: '003', name: '萤火虫歌词', desc: '光绘：字是长曝光显影出来的', url: 'stages/003-firefly-lyrics.html' },
    { id: '004', name: '沙粒歌词', desc: '重力：沙从上落下堆成字，唱完塌掉', url: 'stages/004-sand-lyrics.html' },
    { id: '005', name: '粒子文字', desc: '原地重构：不散开，直接变成下一句', url: 'stages/005-particle-morph.html' },
    { id: '006', name: '风之图', desc: '字形轮廓当轨道，粒子沿链跑；背景风绕开文字', url: 'stages/006-wind-lyrics.html' },
    { id: '007', name: '铁屑磁场', desc: '靠朝向显形：铁屑转向对齐笔画', url: 'stages/007-magnetic-lyrics.html' },
    { id: '008', name: '静雪', desc: '雪碰到笔画就粘住，唱完被横风吹散', url: 'stages/008-snow-lyrics.html' },
    { id: '009', name: '形态演化', desc: '粒子沿对数螺线盘旋进去成字', url: 'stages/009-vortex-lyrics.html' },
    { id: '010', name: '余烬', desc: '字是上升气流里的驻波，一直在被重建', url: 'stages/010-embers-lyrics.html' },
    { id: '011', name: '等离子体', desc: '字是干涉场里的一条等值线', url: 'stages/011-plasma-lyrics.html' },
    { id: '012', name: '光行洞穴', desc: '每句词是一条在洞里向你飞来的弧面字带', url: 'stages/012-cave-lyrics.html' },
    { id: '013', name: '水波涟漪', desc: '封面沉在水下慢慢流，字钉在正中一动不动 —— 前后景分开，读得清', url: 'stages/013-ripple-lyrics.html' },
    { id: '014', name: '万花筒', desc: '一句词被折成一圈镜像花瓣，唱的进度绕着圈点亮', url: 'stages/014-kaleidoscope-lyrics.html' },
    { id: '015', name: '液态金属', desc: '字形的有符号距离场就是这块金属的浮雕高度场', url: 'stages/015-liquid-metal-lyrics.html' },
    { id: '016', name: '极光', desc: '字是一排垂落的光幕，不是一颗粒子', url: 'stages/016-aurora-lyrics.html' },
    { id: '017', name: '特鲁谢光轨', desc: '字是光轨扫过的"照明区"', url: 'stages/017-truchet-glow-lyrics.html' },
    { id: '018', name: '无限缩放', desc: '字在幂律递归里，越缩越小，永远缩不完', url: 'stages/018-infinite-zoom-lyrics.html' },
    { id: '019', name: '墨云', desc: '字是墨的"沉积区"，不是墨画出来的形状', url: 'stages/019-ink-clouds-lyrics.html' },
    { id: '020', name: '网格地平线', desc: '字是一叠立在网格上的灯柱，被一道扫描前沿逐个点亮', url: 'stages/020-grid-horizon-lyrics.html' },
    { id: '021', name: '动态字体', desc: '每个字是一台老虎机滚轮', url: 'stages/021-tumbler-lyrics.html' },
    { id: '022', name: '乱码解码', desc: '一条从左向右推进的锁定前沿', url: 'stages/022-decode-lyrics.html' },
    { id: '023', name: '轮廓脉冲', desc: '字形是空心的，脉冲在描边上跑', url: 'stages/023-outline-lyrics.html' },
    { id: '024', name: '字幕墙', desc: '正在唱的那句就是墙上跑得最快的那条跑马灯', url: 'stages/024-marquee-lyrics.html' },
    { id: '025', name: '字符相机', desc: '整屏是一台字符显像管', url: 'stages/025-ascii-lyrics.html' },
    { id: '026', name: '翻页牌', desc: '歌词是一块机场翻页牌', url: 'stages/026-split-flap-lyrics.html' },
    { id: '027', name: '代码雨', desc: '雨不是背景，雨是光栅写入器', url: 'stages/027-code-rain-lyrics.html' },
    { id: '028', name: '波形文字', desc: '一句词是几根两端夹紧的弦，字是弦上的珠子', url: 'stages/028-wave-text-lyrics.html' },
    { id: '029', name: '渐变遮罩', desc: '这句话是被一道滑动的光缝读出来的，读到哪儿亮到哪儿', url: 'stages/029-gradient-mask-lyrics.html' },
    { id: '030', name: '故障标题', desc: '屏幕是一台丢了行同步的显像管，而同步是从"正在唱的那个字"丢的', url: 'stages/030-glitch-title-lyrics.html' },
    { id: '031', name: 'CSS 立方体', desc: '字被"贴"在自转立方体的面上', url: 'stages/031-css-cube-lyrics.html' },
    { id: '032', name: '新拟态面板', desc: '歌词是一块从面板上"凸"出来的浮雕', url: 'stages/032-neumorph-lyrics.html' },
    { id: '033', name: '加载动画', desc: '每个采样点都是一枚小小的加载动画', url: 'stages/033-loader-lyrics.html' },
    { id: '034', name: 'CSS 日落', desc: '整首歌就是一次日落，字落在水面上', url: 'stages/034-css-sunset-lyrics.html' },
    { id: '035', name: '黏稠按钮', desc: '歌词是一滩会自己合拢的黏稠液体', url: 'stages/035-gooey-lyrics.html' },
    { id: '036', name: '倾斜卡片', desc: '一句词就是墙上一张卡，开唱即翻面', url: 'stages/036-tilt-cards-lyrics.html' },
    { id: '037', name: '漂浮画廊', desc: '一句词是一幅挂在墙上的画，画框自己在缓缓漂', url: 'stages/037-drift-gallery-lyrics.html' },
    { id: '038', name: 'CSS 沙漏', desc: '沙漏走沙显示句进度，词按 YRC 逐字点亮成金色', url: 'stages/038-css-hourglass-lyrics.html' },
    { id: '039', name: '形变团块', desc: '笔画外面裹着一层会自己形变的膜', url: 'stages/039-morph-blob-lyrics.html' },
    { id: '040', name: '等距房间', desc: '词是墙上被顶出来的一片浮雕', url: 'stages/040-iso-room-lyrics.html' },
    { id: '041', name: '万花尺', desc: '笔不离纸，一段一段把字「描」出来', url: 'stages/041-spirograph-lyrics.html' },
    { id: '042', name: '叶序', desc: '字是花盘上被种子让出来的那块空洞', url: 'stages/042-phyllotaxis-lyrics.html' },
    { id: '043', name: '利萨如曲线', desc: '字的亮度来自束流的驻留与 z 轴调制', url: 'stages/043-lissajous-lyrics.html' },
    { id: '044', name: '摩尔纹', desc: '字是两片栅格错位之后放大出来的干涉条纹', url: 'stages/044-moire-lyrics.html' },
    { id: '045', name: '泰森多边形', desc: '字是一片会分裂的细胞组织', url: 'stages/045-voronoi-lyrics.html' },
    { id: '046', name: '双曲空间', desc: '这句话写在一个负曲率的宇宙里', url: 'stages/046-hyperbolic-lyrics.html' },
    { id: '047', name: '傅里叶绘图', desc: '字就是它自己的傅里叶级数', url: 'stages/047-fourier-lyrics.html' },
    { id: '048', name: '谢尔宾斯基', desc: '镜头一直在往空洞里掉', url: 'stages/048-sierpinski-lyrics.html' },
    { id: '049', name: '双摆', desc: '这句话是被混沌一笔一笔画出来的', url: 'stages/049-double-pendulum-lyrics.html' },
    { id: '050', name: '超公式', desc: '一句话换一个"物种"的轮廓', url: 'stages/050-superformula-lyrics.html' },
    { id: '051', name: 'L 系统树', desc: 'L 系统从每个字的根部长出来，把这句话读成一片树林', url: 'stages/051-lsystem-tree-lyrics.html' },
    { id: '052', name: '元胞自动机', desc: '一个字就是一次初值，时空图从字下面落下去', url: 'stages/052-elementary-ca-lyrics.html' },
    { id: '053', name: '生命轨迹', desc: '康威生命游戏在每个字的字形里播种，留下磷光余晖', url: 'stages/053-life-trails-lyrics.html' },
    { id: '054', name: '噪声山脉', desc: '每个字的高度剖面被抬成一维山脊上的一座峰', url: 'stages/054-noise-mountains-lyrics.html' },
    { id: '055', name: '递归方块', desc: '一次自适应细分把整句话切成方块，再逐字点亮', url: 'stages/055-recursive-squares-lyrics.html' },
    { id: '056', name: '行进地形', desc: '字是地形上被抬起来的一道山脊', url: 'stages/056-marching-terrain-lyrics.html' },
    { id: '057', name: '特鲁谢圆点', desc: '字是一张"把光点关起来"的网', url: 'stages/057-truchet-dots-lyrics.html' },
    { id: '058', name: '闪电', desc: '字本身就是那道放电通道', url: 'stages/058-lightning-lyrics.html' },
    { id: '059', name: '珊瑚生长', desc: '字是一丛把笔画吃掉的枝晶', url: 'stages/059-coral-growth-lyrics.html' },
    { id: '060', name: '星系', desc: '字是一道驻波（密度波），不是一堆物质', url: 'stages/060-galaxy-lyrics.html' },
    { id: '061', name: '布料', desc: '布被一针针缝在笔画上，唱到哪字哪块绷紧', url: 'stages/061-verlet-cloth-lyrics.html' },
    { id: '062', name: '弹簧链', desc: '钢丝弹簧一段段被甩进笔画里绷直', url: 'stages/062-spring-chain-lyrics.html' },
    { id: '063', name: '丝带', desc: '笔尖在笔画里写字，丝带是它留下的长曝光', url: 'stages/063-ribbon-trail-lyrics.html' },
    { id: '064', name: '球池', desc: '小球从池底弹进字形凹槽，唱完被搅动浮起再落下', url: 'stages/064-ball-pit-lyrics.html' },
    { id: '065', name: '多米诺', desc: '每个字是一排立着的骨牌，逐字按 YRC 推倒成笔画', url: 'stages/065-domino-lyrics.html' },
    /* --- lizi 系列（自研粒子特效） --- */
    { id: '066', name: '泼墨黏墙', desc: '词团从画外沿弧线砸上墙，黏住、墨点累积、逐字烧亮、换句被风扫走', url: 'stages/066-thrown-splat.html' },
    { id: '067', name: '电蚀刻痕', desc: '电极头沿笔画行进，电弧烧出熔坑，熔渣火花甩出；字是烧出来的槽，不是画上去的', url: 'stages/067-arc-etch.html' },
    { id: '068', name: '弹幕编队', desc: '粒子是带尾迹的飞行体，先在空中飞编队，队形一收变成字', url: 'stages/068-formation-fly.html' },
    { id: '069', name: '克拉尼图形', desc: '沙粒在振动板上被抖散、聚到**波节线**上；字是波节线，换句 = 换共振频率', url: 'stages/069-chladni-sand.html' },
    { id: '070', name: '铁磁尖刺', desc: '磁铁靠近，流体表面长出尖刺阵列；字是**尖刺顶端的包络**', url: 'stages/070-ferrofluid.html' },
    { id: '071', name: '蚁群信息素', desc: '蚁沿信息素跑，路径自我强化成字；唱到哪字哪段路被踩亮', url: 'stages/071-ant-pheromone.html' },
    { id: '072', name: '鸟群掠空', desc: 'Boids 集群从画面掠过，穿过字的形状时才对齐；字是集群的密度投影', url: 'stages/072-boids-sweep.html' },
    { id: '073', name: '火山灰柱', desc: '灰柱从底部喷涌上升，到顶散开成字；每句一次喷发', url: 'stages/073-ash-plume.html' },
    { id: '074', name: '焦散水纹', desc: '字是**水底焦散光斑**排出来的亮区，水波在字外面流', url: 'stages/074-caustics.html' },
    { id: '075', name: '电子束扫描', desc: '电子束逐行扫，荧光点余辉拼字；字是**余辉衰减后剩下的**', url: 'stages/075-crt-beam.html' },
    { id: '076', name: '全息干涉', desc: '参考光 + 物光干涉出条纹，字是**干涉图里的重建像**', url: 'stages/076-hologram.html' },
    { id: '077', name: '引力透镜', desc: '背景星场被引力井扭曲，字是爱因斯坦环内侧的**透镜亮弧**', url: 'stages/077-lensing.html' },
    { id: '078', name: '吸积盘', desc: '粒子在吸积盘里被潮汐拉成丝，字是盘的**亮区驻波**', url: 'stages/078-accretion.html' },
    { id: '079', name: '超新星', desc: '中心爆开，激波前沿扫过处留下字；字是**激波写的**不是生成的', url: 'stages/079-supernova.html' },
    { id: '080', name: '星云坍缩', desc: '分子云在引力下坍缩，密度峰连成字', url: 'stages/080-nebula-collapse.html' },
    { id: '081', name: '潮汐水痕', desc: '退潮后沙滩上留下的水痕排成字，沙粒是**被水推过的**', url: 'stages/081-tide-mark.html' },
    { id: '082', name: '熔岩冷凝', desc: '熔岩流过地面，冷却成黑壳，字是**还没冷却的裂缝**', url: 'stages/082-lava-flow.html' },
    { id: '083', name: '霜花结晶', desc: '窗玻璃上的霜从字心向外结晶，字先出现再被霜盖住', url: 'stages/083-frost.html' },
    { id: '084', name: '露珠挂丝', desc: '露珠挂在蛛丝节点上，按字的位置排布；风一吹整串晃', url: 'stages/084-silk-dew.html' },
    { id: '085', name: '磁悬浮', desc: '小球被磁场托起，一颗颗浮到位；字是**悬浮体的停驻层**', url: 'stages/085-levitate.html' },
    { id: '086', name: '陀螺进动', desc: '陀螺进动的锥面被粒子描出来，字是**进动轨迹的包络面**', url: 'stages/086-gyro.html' },
    { id: '087', name: '棱镜色散', desc: '白光过棱镜分成光谱，不同波长的粒子落在字的同一处叠成白', url: 'stages/087-prism.html' },
    { id: '088', name: '偏振显影', desc: '检偏器转动，粒子按偏振角显隐，字是**同相位的那批**', url: 'stages/088-polarize.html' },
    { id: '089', name: '电子云', desc: '原子的电子云概率云，字是**高概率轨道面**的截面', url: 'stages/089-orbital.html' },
    { id: '090', name: '晶格位错', desc: '完美晶格里插入位错线，字是**位错线走过的路径**', url: 'stages/090-lattice.html' },
    { id: '091', name: '磁畴壁', desc: '磁畴一块块翻转，字是**翻转边界**那一圈', url: 'stages/091-domain-wall.html' },
    { id: '092', name: '沙丘风蚀', desc: '风把沙吹成沙丘脊，脊线连成字；字一直在被吹变形', url: 'stages/092-dune.html' },
    { id: '093', name: '冰川裂隙', desc: '冰盖受应力开裂，裂纹网络连成字；裂开时冰屑飞溅', url: 'stages/093-crevasse.html' },
    { id: '094', name: '电弧焊', desc: '焊枪沿字走，火花四溅；字是焊缝上还在发红的熔池', url: 'stages/094-weld-spark.html' },
    { id: '095', name: '纸屑爆破', desc: '一张写满字的纸被炸成碎片，碎片在空中翻转到字的位置', url: 'stages/095-confetti.html' },
    { id: '096', name: '灰烬复燃', desc: '烧焦的纸上，余烬按字的位置重新亮起来', url: 'stages/096-ember-reignite.html' },
    { id: '097', name: '蒸汽凝结', desc: '水汽在冷面上凝结成露，露珠连成字，然后被擦掉', url: 'stages/097-condense.html' },
    { id: '098', name: '毛细上升', desc: '液体在多孔材料里毛细上升，湿痕排成字', url: 'stages/098-capillary.html' },
    { id: '099', name: '生物荧光', desc: '荧光素在液体里扩散，字是一圈**正在扩散的荧光前沿**', url: 'stages/099-bioluma.html' },
    { id: '100', name: '静电植绒', desc: '绒毛在静电场里立起来，字是**立起来的那些**', url: 'stages/100-flocking.html' },
    { id: '101', name: '磁粉检漏', desc: '磁粉被缺陷吸附，字是**缺陷位置的磁粉堆**', url: 'stages/101-magnaflux.html' },
    { id: '102', name: '沙画灯箱', desc: '灯箱上的沙被抹开，字是**透光的那块薄沙**', url: 'stages/102-sand-art.html' },
    { id: '103', name: '烟圈涡环', desc: '一个个烟圈穿过字的位置，被字形的孔洞切出形状', url: 'stages/103-vortex-ring.html' },
    { id: '104', name: '气泡上浮', desc: '气泡从水底升起，密集成字；字一直在往上冒', url: 'stages/104-bubble.html' },
    { id: '105', name: '液滴飞溅', desc: '一滴水砸在水面，皇冠状溅起的水珠排成字', url: 'stages/105-splash.html' },
    { id: '106', name: '声呐回波', desc: '声呐脉冲扫过，回波把字的位置点亮；字只在被扫到时可见', url: 'stages/106-sonar.html' },
    { id: '107', name: '激光烧蚀', desc: '激光烧蚀材料，等离子羽流喷出，字是烧穿的孔', url: 'stages/107-ablation.html' },
    { id: '108', name: '喷砂雕刻', desc: '喷砂把字雕出来，砂粒在字上弹开', url: 'stages/108-sandblast.html' },
    { id: '109', name: '离心分离', desc: '离心机把粒子按密度分层，字是**分层后的界面**', url: 'stages/109-centrifuge.html' },
    { id: '110', name: '磁轨弹射', desc: '粒子沿磁轨被加速射出，出膛即到字位', url: 'stages/110-railgun.html' },
    { id: '111', name: '弹簧网格', desc: '弹性网格的驻波模态，字是**波腹连成的线**', url: 'stages/111-spring-lattice.html' },
    { id: '112', name: '湍流静区', desc: '满屏 curl noise 湍流，字是湍流里的**静止岛**', url: 'stages/112-curl-calm.html' },
    { id: '113', name: '定格悬浮', desc: '粒子被"定格"在半空，镜头绕着这团静止粒子飞', url: 'stages/113-bullet-time.html' },
    { id: '114', name: '像素量化', desc: '粒子被量化到像素栅格上，字是**量化之后的块状像**', url: 'stages/114-quantize.html' },
    { id: '115', name: '引力波涟漪', desc: '时空被一下一下地压出涟漪，字是两道涟漪的干涉稳定点', url: 'stages/115-gravity-wave.html' },
    { id: '116', name: '立体浮雕', desc: '字形被抬成有厚度的浮雕，镜头绕着它转，一道光扫过表面', url: 'stages/116-relief.html' },
    { id: '117', name: '极光帷幕', desc: '高能粒子沿磁力线落下，帷幕状的极光折叠出字', url: 'stages/117-aurora.html' },
    { id: '118', name: '六重镜', desc: '字被六重镜像到整个画面，镜片缓慢旋转、每瓣相位不同', url: 'stages/118-kaleidoscope.html' },
    { id: '119', name: '粒子隧道', desc: '镜头在粒子管道里穿行，管壁上的字被一层层甩到身后', url: 'stages/119-tunnel.html' },
    { id: '120', name: '陨石雨', desc: '陨石从右上砸下，砸中的位置留下发光的坑，坑连成字', url: 'stages/120-meteor.html' },
    { id: '121', name: '沙漏', desc: '沙从颈口漏下，在底部堆成字，上仓的沙面同步下沉', url: 'stages/121-hourglass.html' },
    { id: '122', name: '汞滴凝形', desc: '金属液滴融合又分裂，融合后的轮廓就是字', url: 'stages/122-liquid-metal.html' },
    { id: '123', name: '极地风暴', desc: '暴风雪绕着一个风眼旋转，风眼里是安静的字', url: 'stages/123-polar-storm.html' },
    { id: '124', name: '龙卷风', desc: '碎片被卷成漏斗，漏斗壁上贴着字，越靠近地面越快', url: 'stages/124-tornado.html' },
    { id: '125', name: '日冕环', desc: '等离子沿磁环拱起落下，环的落脚点排成字', url: 'stages/125-coronal-loop.html' },
    { id: '126', name: '星云丝', desc: '卷曲噪波把气体拉成丝，丝上打结的地方组成字', url: 'stages/126-filaments.html' },
    { id: '127', name: '蜂巢', desc: '六边形巢格一块块亮起，亮的那片组成字', url: 'stages/127-honeycomb.html' },
    { id: '128', name: '珊瑚潮退', desc: '枝状珊瑚从字心向外长，长满后又被水流带走', url: 'stages/128-coral.html' },
    { id: '129', name: '粒子印刷', desc: '墨辊压过纸面，油墨只留在字的位置上', url: 'stages/129-print.html' },
    { id: '130', name: '粒子折纸', desc: '一张纸被折成无数三角面，展开时正好拼出字', url: 'stages/130-origami.html' },
    { id: '131', name: '磁轨列车', desc: '列车拖着光轨飞驰，光轨在字的位置减速停住', url: 'stages/131-maglev.html' },
    { id: '132', name: '光栅扫描', desc: 'CRT 光栅带着透视倾斜，扫描线逐行把字刷出来', url: 'stages/132-raster.html' },
    { id: '133', name: '全息地形', desc: '三维地形被等高线切出字，镜头贴着地表飞', url: 'stages/133-terrain.html' },
    { id: '134', name: '深海热泉', desc: '黑烟囱喷出矿物羽流，堆积的高地组成字', url: 'stages/134-hydrothermal.html' },
    { id: '135', name: '玻璃破碎', desc: '玻璃被击碎，碎片在空中翻面重组成字', url: 'stages/135-shatter.html' },
    { id: '136', name: '行星环', desc: '尘埃在行星环里公转，环的密度波聚成字', url: 'stages/136-ringed.html' },
    { id: '137', name: '引力弹弓', desc: '粒子掠过行星被加速甩出，落点拼成字', url: 'stages/137-slingshot.html' },
    { id: '138', name: '粒子日食', desc: '月亮挡住太阳，日冕流束被磁场弯到字位并停住，字是流束末端', url: 'stages/138-eclipse.html' },
    { id: '139', name: '雨幕折射', desc: '雨滴挂在玻璃上，透过水珠折射出的像就是字', url: 'stages/139-rain-glass.html' },
    { id: '140', name: '拉花曲线', desc: '粒子沿内摆线画花，曲线的包络收成字', url: 'stages/140-spirograph.html' },
    { id: '141', name: '萤火虫群', desc: '萤火虫在三维空间群聚，唱到拍点一起闪成字', url: 'stages/141-fireflies.html' },
    { id: '142', name: '光纤束', desc: '光脉冲沿光纤跑到末端，端面亮点组成字', url: 'stages/142-fiber.html' },
    { id: '143', name: '等离子球', desc: '电弧从中心爬向玻璃壁，触壁点连成字', url: 'stages/143-plasma-globe.html' },
    { id: '144', name: '粒子织机', desc: '经纬线被穿梭的子弹出线，织出的图案是字', url: 'stages/144-loom.html' },
    { id: '145', name: '云海', desc: '体积云被风撕开一道口子，口子的形状是字', url: 'stages/145-cloud-sea.html' },
    { id: '146', name: '粒子书法', desc: '一支看不见的笔在空中写字，墨迹在空中悬停不落', url: 'stages/146-brush.html' },
    { id: '147', name: '脉冲星', desc: '中子星的自转光束扫过，被扫到的尘埃亮成字', url: 'stages/147-pulsar.html' },
    { id: '148', name: '风铃', desc: '金属管在风里摆动，管口的光点排成字', url: 'stages/148-wind-chime.html' },
    { id: '149', name: '熔炉', desc: '炉膛里火星翻滚，炉栅的缝隙透出字', url: 'stages/149-furnace.html' },
    { id: '150', name: '粒子潮汐', desc: '三维水面被月亮拉起潮汐，浪脊连成字', url: 'stages/150-tidal.html' },
    { id: '151', name: '沙暴', desc: '沙墙横扫过来，墙上的缺口是字', url: 'stages/151-sandstorm.html' },
    { id: '152', name: '电流体', desc: '高压击穿液体，放电通道连成字', url: 'stages/152-electrofluid.html' },
    { id: '153', name: '冰晶悬浮', desc: '六角冰晶在空中自转，晶面的反光拼成字', url: 'stages/153-ice-float.html' },
    { id: '154', name: '全息立方', desc: '字被投射在一个旋转的立方体表面，转到正面才读得清', url: 'stages/154-holo-cube.html' },
    { id: '155', name: '折扇', desc: '一把扇子展开，扇骨上的光点组成字', url: 'stages/155-fan.html' },
    { id: '156', name: '星系碰撞', desc: '两个旋涡星系对撞，激波前沿扫出字', url: 'stages/156-galaxy-collision.html' },
    { id: '157', name: '粒子喷泉', desc: '水柱从池底喷起，在空中被字的位置截住', url: 'stages/157-fountain.html' },
    { id: '158', name: '回声', desc: '声波一圈圈扩散，被墙反射回来的波前组成字', url: 'stages/158-echo.html' },
    { id: '159', name: '星座', desc: '星点在三维里连线，连出来的星座就是字', url: 'stages/159-constellation.html' },
    { id: '160', name: '气泡柱', desc: '海底裂口冒出的气泡柱，被字的位置切开', url: 'stages/160-bubble-column.html' },
    { id: '161', name: '雪崩', desc: '雪檐断裂，雪流冲下来堆积成字', url: 'stages/161-avalanche.html' },
    { id: '162', name: '瀑布', desc: '水帘落下，在字的位置被撕开一道缝', url: 'stages/162-waterfall.html' },
    { id: '163', name: '线框', desc: '一张线框曲面起伏，等值线收成字', url: 'stages/163-wireframe.html' },
    { id: '164', name: '羽毛', desc: '羽毛在空中飘落，落点排成字', url: 'stages/164-feather.html' },
    { id: '165', name: '终章·星环', desc: '整颗恒星被星环包住，环的缺口连成字', url: 'stages/165-finale.html' },
    { id: '166', name: '距离场等高线', desc: '距离场等高线', url: 'stages/166-sdf-contour.html' },
    { id: '167', name: '字阵波', desc: '字阵波', url: 'stages/167-type-wave.html' },
    { id: '168', name: '字重演化', desc: '字重演化', url: 'stages/168-weight-axis.html' },
    { id: '169', name: '半调套印', desc: '半调套印', url: 'stages/169-halftone-press.html' },
    { id: '170', name: '纸浆压凸', desc: '纸浆压凸', url: 'stages/170-paper-deboss.html' },
    { id: '171', name: '亚麻提花', desc: '亚麻提花', url: 'stages/171-linen-jacquard.html' },
    { id: '172', name: '锤纹黄铜', desc: '锤纹黄铜', url: 'stages/172-hammered-brass.html' },
    { id: '173', name: '厚玻璃', desc: '厚玻璃', url: 'stages/173-thick-glass.html' },
    { id: '174', name: '池底的字', desc: '池底的字', url: 'stages/174-pool-floor.html' },
    { id: '175', name: '雾幕投影', desc: '雾幕投影', url: 'stages/175-mist-shadow.html' },
    { id: '176', name: '熔岩裂隙', desc: '熔岩裂隙', url: 'stages/176-lava-crack.html' },
    { id: '177', name: '薄膜干涉', desc: '薄膜干涉', url: 'stages/177-thin-film.html' },
    { id: '178', name: '霜花成字', desc: '霜花成字', url: 'stages/178-frost-bloom.html' },
    { id: '179', name: '纱幕投影', desc: '纱幕投影', url: 'stages/179-gauze-shadow.html' },
    { id: '180', name: '纵深切片歌词', desc: '纵深切片歌词', url: 'stages/180-depth-slice-lyrics.html' },
    { id: '181', name: '体积迷雾歌词', desc: '体积迷雾歌词', url: 'stages/181-volumetric-fog-lyrics.html' },
    { id: '182', name: '场线歌词', desc: '场线歌词', url: 'stages/182-flow-field-lyrics.html' },
    { id: '183', name: '点阵截面歌词', desc: '点阵截面歌词', url: 'stages/183-dot-lattice-lyrics.html' },
    { id: '184', name: '体积绕飞歌词', desc: '体积绕飞歌词', url: 'stages/184-extruded-orbit-lyrics.html' },
    { id: '185', name: '绕流歌词', desc: '绕流歌词', url: 'stages/185-obstacle-flow-lyrics.html' },
    { id: '186', name: '排版坍缩', desc: '排版坍缩', url: 'stages/186-type-collapse.html' },
    { id: '187', name: '字形工程图', desc: '字形工程图', url: 'stages/187-blueprint-glyph.html' },
    { id: '188', name: '字距张力', desc: '字距张力', url: 'stages/188-kerning-spring.html' },
    { id: '189', name: '铅字块堆叠', desc: '铅字块堆叠', url: 'stages/189-letterpress.html' },
    { id: '190', name: '竖排行气', desc: '竖排行气', url: 'stages/190-vertical-typeset.html' },
    { id: '191', name: '拓印', desc: '拓印', url: 'stages/191-rubbing.html' },
    { id: '192', name: '引力透镜歌词', desc: '引力透镜歌词', url: 'stages/192-gravity-lens.html' },
    { id: '193', name: '涡管歌词', desc: '涡管歌词', url: 'stages/193-vortex-tube.html' },
    { id: '194', name: '等距体素歌词', desc: '等距体素歌词', url: 'stages/194-iso-voxel.html' },
    { id: '195', name: '投影室歌词', desc: '投影室歌词', url: 'stages/195-shadow-room.html' },
    { id: '196', name: '瓷釉开片', desc: '瓷釉开片', url: 'stages/196-celadon-crackle.html' },
    { id: '197', name: '锡箔褶皱', desc: '锡箔褶皱', url: 'stages/197-foil-crumple.html' },
    { id: '198', name: '湿沥青', desc: '湿沥青', url: 'stages/198-wet-asphalt.html' },
    { id: '199', name: '毛毡针戳', desc: '毛毡针戳', url: 'stages/199-felt-needle.html' },
    { id: '200', name: '锈蚀钢', desc: '锈蚀钢', url: 'stages/200-rust-steel.html' },
    { id: '201', name: '热敏变色膜', desc: '热敏变色膜', url: 'stages/201-thermochromic.html' },
    { id: '202', name: '沙画台', desc: '沙画台', url: 'stages/202-sand-lightbox.html' },
    { id: '203', name: '烛烟熏黑', desc: '烛烟熏黑', url: 'stages/203-soot-glass.html' },
    { id: '204', name: '羽毛虹彩', desc: '羽毛虹彩', url: 'stages/204-feather-iridescence.html' },
    { id: '205', name: '字怀漫灌', desc: '字怀漫灌', url: 'stages/205-counter-flood.html' },
    { id: '206', name: '活字盘取字', desc: '活字盘取字', url: 'stages/206-type-case.html' },
    { id: '207', name: '字形软体', desc: '字形软体', url: 'stages/207-glyph-jelly.html' },
    { id: '208', name: '网格坍缩', desc: '网格坍缩', url: 'stages/208-grid-collapse.html' },
    { id: '209', name: '斜切 · 反白 · 错版', desc: '斜切 · 反白 · 错版', url: 'stages/209-knife-register.html' },
    { id: '210', name: '活字过秤', desc: '活字过秤', url: 'stages/210-ink-sort.html' },
    { id: '211', name: '按版心配字', desc: '按版心配字', url: 'stages/211-fit-measure.html' },
    { id: '212', name: '弧线排字', desc: '弧线排字', url: 'stages/212-arc-typeset.html' },
    { id: '213', name: '绕排避让', desc: '绕排避让', url: 'stages/213-wrap-flow.html' },
    { id: '214', name: '书页版心', desc: '书页版心', url: 'stages/214-page-turn.html' },
    { id: '215', name: '液态汞', desc: '液态汞', url: 'stages/215-liquid-mercury.html' },
    { id: '216', name: '薄透镜光路', desc: '薄透镜光路', url: 'stages/216-lens-bench.html' },
    { id: '217', name: '体积光线步进', desc: '体积光线步进', url: 'stages/217-ray-march-vol.html' },
    { id: '218', name: '柱面卷绕', desc: '柱面卷绕', url: 'stages/218-cyl-wrap.html' },
    { id: '219', name: '欧拉网格流体', desc: '欧拉网格流体', url: 'stages/219-grid-fluid.html' },
    { id: '220', name: '釉下彩', desc: '釉下彩', url: 'stages/220-underglaze-cobalt.html' },
    { id: '221', name: '枯山水砂纹', desc: '枯山水砂纹', url: 'stages/221-raked-gravel.html' },
    { id: '222', name: '火烧纸边', desc: '火烧纸边', url: 'stages/222-burned-paper.html' },
    { id: '223', name: '蜂蜡巢房', desc: '蜂蜡巢房', url: 'stages/223-beeswax-comb.html' },
    { id: '224', name: '焦糖拉丝', desc: '焦糖拉丝', url: 'stages/224-spun-caramel.html' },
    { id: '225', name: '水拓大理石', desc: '水拓大理石', url: 'stages/225-water-marbling.html' },
    { id: '226', name: '压花皮革', desc: '压花皮革', url: 'stages/226-blind-deboss-leather.html' },
    { id: '227', name: '丝绒绒面', desc: '丝绒绒面', url: 'stages/227-velvet-nap.html' },
    { id: '228', name: '莳绘黑漆', desc: '莳绘黑漆', url: 'stages/228-maki-e-lacquer.html' },
    { id: '229', name: '水磨石补块', desc: '水磨石补块', url: 'stages/229-terrazzo-patch.html' },
    { id: '230', name: '断层重建', desc: '断层重建', url: 'stages/230-tomograph.html' },
    { id: '231', name: '结构光扫描', desc: '结构光扫描', url: 'stages/231-structured-scan.html' },
    { id: '232', name: '长曝光光绘', desc: '长曝光光绘', url: 'stages/232-light-paint.html' },
    { id: '233', name: '百叶窗视差', desc: '百叶窗视差', url: 'stages/233-louver-parallax.html' },
    { id: '234', name: '散景调焦', desc: '散景调焦', url: 'stages/234-bokeh-focus.html' },
    { id: '235', name: '帷幕投影', desc: '帷幕投影', url: 'stages/235-curved-project.html' },
    { id: '236', name: '磁粉带', desc: '磁粉带', url: 'stages/236-tape-domain.html' },
    { id: '237', name: '热羽', desc: '热羽', url: 'stages/237-thermal-plume.html' },
    { id: '238', name: '透照片', desc: '透照片', url: 'stages/238-xray-sheet.html' },
    { id: '239', name: '等高', desc: '等高', url: 'stages/239-contour-terrain.html' },
    { id: '240', name: '菌丝', desc: '菌丝', url: 'stages/240-mycelium-net.html' },
    { id: '241', name: '焦散玻璃', desc: '焦散玻璃', url: 'stages/241-caustic-lens.html' },
    { id: '242', name: '水位', desc: '水位', url: 'stages/242-water-line.html' },
    { id: '243', name: '沙漏星河', desc: '十万颗沙粒在 GPU 上漏成星河，扫到哪儿字才亮', url: 'stages/243-sand-hour.html' },
    { id: '244', name: '烟影', desc: '烟影', url: 'stages/244-smoke-wake.html' },
    { id: '245', name: '回火', desc: '回火', url: 'stages/245-backdraft.html' },
    { id: '246', name: '锈斑', desc: '锈斑', url: 'stages/246-rust-flake.html' },
    { id: '247', name: '静电', desc: '静电', url: 'stages/247-static-figure.html' },
    { id: '248', name: '汞珠', desc: '汞珠', url: 'stages/248-mercury-meniscus.html' },
    { id: '249', name: '刻槽', desc: '刻槽', url: 'stages/249-carved-groove.html' },
    { id: '250', name: '铸字', desc: '铸字', url: 'stages/250-cast-type.html' },
    { id: '251', name: '网点', desc: '网点', url: 'stages/251-halftone-plate.html' },
    { id: '252', name: '抄纸', desc: '抄纸', url: 'stages/252-pulp-sheet.html' },
    { id: '253', name: '管腔', desc: '管腔', url: 'stages/253-tube-lumen.html' },
    { id: '254', name: '挤糖', desc: '挤糖', url: 'stages/254-icing-line.html' },
    { id: '255', name: '热像', desc: '热像', url: 'stages/255-thermal-field.html' },
    { id: '256', name: '冻泡', desc: '冻泡', url: 'stages/256-frozen-bubbles.html' },
    { id: '257', name: '盐晶', desc: '盐晶', url: 'stages/257-salt-nucleation.html' },
    { id: '258', name: '网眼', desc: '网眼', url: 'stages/258-mesh-light.html' },
    { id: '259', name: '干裂', desc: '干裂', url: 'stages/259-mud-crack.html' },
    { id: '260', name: '吹泡', desc: '吹泡', url: 'stages/260-blown-glass.html' },
    { id: '261', name: '拉坯', desc: '拉坯', url: 'stages/261-wheel-throw.html' },
    { id: '262', name: '席纹', desc: '席纹', url: 'stages/262-mat-weave.html' },
    { id: '263', name: '浮雕', desc: '浮雕', url: 'stages/263-plaster-relief.html' },
    { id: '264', name: '丝印', desc: '丝印', url: 'stages/264-silkscreen.html' },
    { id: '265', name: '内雕', desc: '内雕', url: 'stages/265-subsurface-etch.html' },
    { id: '266', name: '蜡泪', desc: '蜡泪', url: 'stages/266-wax-tears.html' },
    { id: '267', name: '磨白', desc: '磨白', url: 'stages/267-denim-abrade.html' },
    { id: '268', name: '压印', desc: '压印', url: 'stages/268-concrete-stamp.html' },
    { id: '269', name: '泡沫痕', desc: '泡沫痕', url: 'stages/269-foam-ghost.html' },
    { id: '270', name: '划痕', desc: '划痕', url: 'stages/270-scratch-plate.html' },
    { id: '271', name: '粉笔', desc: '粉笔', url: 'stages/271-chalk-ghost.html' },
    { id: '272', name: '树皮', desc: '树皮', url: 'stages/272-bark-ridge.html' },
    { id: '273', name: '拉链', desc: '拉链', url: 'stages/273-zipper-gap.html' },
    { id: '274', name: '齿孔', desc: '齿孔', url: 'stages/274-perforation.html' },
    { id: '275', name: '雨刷', desc: '雨刷', url: 'stages/275-wiper-sweep.html' },
    { id: '276', name: '砖缝', desc: '砖缝', url: 'stages/276-brick-joint.html' },
    { id: '277', name: '橡皮章', desc: '橡皮章', url: 'stages/277-rubber-stamp.html' },
    { id: '278', name: '贴金', desc: '贴金', url: 'stages/278-gold-leaf.html' },
    { id: '279', name: '复写', desc: '复写', url: 'stages/279-carbon-copy.html' },
    { id: '280', name: '显影', desc: '显影', url: 'stages/280-developer.html' },
    { id: '283', name: '烤色', desc: '烤色', url: 'stages/283-temper-color.html' },
    { id: '284', name: '铆钉', desc: '铆钉', url: 'stages/284-riveted-plate.html' },
    { id: '285', name: '剥落', desc: '剥落', url: 'stages/285-lime-spall.html' },
    { id: '286', name: '棉絮', desc: '棉絮', url: 'stages/286-cotton-wad.html' },
    { id: '287', name: '薄片重合', desc: '薄片重合', url: 'stages/287-parallax-panes.html' },
    { id: '288', name: '十万根手指指的地方', desc: '十万根手指指的地方', url: 'stages/288-pointing-hands.html' },
    { id: '289', name: '走廊里的回声', desc: '走廊里的回声', url: 'stages/289-corridor-echo.html' },
    { id: '290', name: '墨还没散', desc: '墨还没散', url: 'stages/290-ink-water.html' },
    { id: '291', name: '一群鸟此刻的队形', desc: '一群鸟此刻的队形', url: 'stages/291-flock-formation.html' },
    { id: '292', name: '矢量招贴', desc: '矢量招贴', url: 'stages/292-vector-poster.html' },
    { id: '293', name: '废墟手稿', desc: '蚀刻拼贴：巨大汉字压成背景，字从废墟里挖出来', url: 'stages/293-grunge-classic.html' },
    { id: '294', name: '暗码街区', desc: '地下混音带界面：歌词被当成信号接收下来', url: 'stages/294-mixtape.html' },
    { id: '295', name: 'Y2K 极限', desc: '千禧极限运动海报：鱼眼蓝天、怼脸鞋底', url: 'stages/295-y2k-extreme.html' },
    { id: '296', name: '剥皮冷帽', desc: '陷阱金属：纯黑场里一颗被豁开的头', url: 'stages/296b-trapmetal.html' },
    { id: '297', name: '功夫占位', desc: '占位：确认 297 能不能出现在播放器里', url: 'stages/297-kungfu-placeholder.html' },
    { id: '300', name: '群鸟字墙', desc: '瑞士网格 + 黑鸟冲破灰色字墙，歌词是最大那行', url: 'stages/300-swiss.html' },
    { id: '302', name: '水墨', desc: '宣纸、淡墨、飞白；毛笔字对撞极细西文', url: 'stages/302-ink.html' },
    { id: '304', name: '童核', desc: '练习本内页：蜡笔小屋、笑脸太阳、背书包走远的人', url: 'stages/304-kidcore.html' },
    { id: '303', name: '动漫核', desc: '扫描件分屏拼贴：撕纸两页、蛛形印章、无字封面校样', url: 'stages/303-anime-core.html' },
    { id: '305', name: '钴蓝网格', desc: '瑞士网格与钴蓝单色纪实：封面做成印版，歌词排成账本', url: 'stages/305-cobalt-grid.html' },
    { id: '306', name: '靶心构成', desc: '包豪斯靶心出血：同心环带被声波撕开一道缺口', url: 'stages/306-bauhaus-target.html' },
    { id: '307', name: '三棱镜', desc: '纯黑里的棱镜：真算的斯涅尔折射，光谱把字写出来', url: 'stages/307-prism-black.html' },
    { id: '308', name: '人机橱窗', desc: '新客观主义假人：Art Deco 拱窗与宋体歌词', url: 'stages/308-mannequin-deco.html' },
    { id: '309', name: '声音蓝图', desc: '测绘图：BSP 田块与等高线，歌词是预留的绘图区', url: 'stages/309-sonic-blueprint.html' },
    { id: '311', name: '甲壳微距', desc: '高倍微距复眼甲壳：纯白无影档案台，歌词是标本说明牌', url: 'stages/311-bio-macro.html' },
    { id: '312', name: '单点橙斑', desc: '半调印刷的黑白假面，右上角一小块荧光色标', url: 'stages/312-single-accent-dot.html' },
    { id: '310', name: '脉冲星线', desc: '黑底白线的脉冲星剖面图：歌词是仪器的读数', url: 'stages/310-pulsar-line.html' },
    { id: '313', name: '蜜桃反色', desc: '闭眼透光的蜜桃暖色，居中镂空几何字', url: 'stages/313-peach-subversion.html' },
    { id: '314', name: '琥珀重影', desc: '琥珀剧场的多重曝光：舞者剪影与侧脸重影', url: 'stages/314-amber-double.html' },
    { id: '315', name: '白底果实', desc: '白纸上的丝网印柑橘：果皮是能撕的贴纸', url: 'stages/315-pop-fruit.html' },
    { id: '318', name: '石膏接线', desc: '画室里的石膏胸像接进合成器机柜，跳线上跑着信号光', url: 'stages/318-plaster-wiring.html' },
    { id: '319', name: '朋克边框', desc: '砸琴现场压进经典流行年代的粉绿撞色排版', url: 'stages/319-punk-border.html' },
    { id: '317', name: '热带客厅', desc: '剪纸剧场版中产全家福：热带主义与杜尚式道具', url: 'stages/317-tropical-salon.html' },
    { id: '320', name: '色盘密码', desc: '古典静物油画上盖一张包豪斯色盘密码表', url: 'stages/320-color-wheel-code.html' },
    { id: '321', name: '标本手稿', desc: '鹿首铜版版画 + 配送光环：霉斑、网点、套准线的标本册页', url: 'stages/321-taxidermy-manuscript.html' },
    { id: '322', name: '涂改过载', desc: '涂改液层积的信息过载：乱码与剪贴只压在歌词之下', url: 'stages/322-glitch-palimpsest.html' },
    { id: '323', name: '千禧粉像', desc: '荧光粉底上手撕的半调黑白肖像，歌词坐在黑色纸板上', url: 'stages/323-millennial-pink.html' },
    { id: '316', name: '群像剧场', desc: '红丝绒台口里的纸板立牌群像，歌词是前景题词牌', url: 'stages/316-maximal-tableau.html' },
    { id: '324', name: '尖叫出血', desc: '满幅油画的扭曲面孔被颜料浇透，字坐在擦干净的暗血斑上', url: 'stages/324-scream-bleed.html' },
    { id: '327', name: '洋红失焦', desc: '整屏失焦的洋红光雾，唯一的焦点是歌词', url: 'stages/327-magenta-blur.html' },
    { id: '326', name: '白棋阵列', desc: '无数白色十字架列向血色地平线，歌词刻在大理石碑上', url: 'stages/326-white-chess.html' },
    { id: '329', name: '解剖曼陀罗', desc: '多层醋酸胶片叠着脊椎与曼陀罗，翻一层剥开一层肉体', url: 'stages/329-anatomy-mandala.html' },
    { id: '330', name: '涡街铬球', desc: '卡门涡街把黑白条纹扭弯，液态铬球从里面浮出来', url: 'stages/330-vortex-chrome.html' },
    { id: '331', name: '怪诞礼帽', desc: '黑白棚拍剪影戴着巨型雕塑礼帽，脸上一对超大亮面红唇', url: 'stages/331-camp-mask.html' },
    { id: '332', name: '泛非怒吼', desc: '泛非三色招贴：机械行进的队列与举拳的黑剪影', url: 'stages/332-panafrican-poster.html' },
    { id: '325', name: '星际花火', desc: '两张不同肤色的对望侧脸，缝里长出花并烧成火舌', url: 'stages/325-cosmic-floral.html' },
    { id: '328', name: '明信片鼓', desc: '维多利亚海滨明信片上，无头泳客的颈口是一面大鼓', url: 'stages/328-postcard-drum.html' },
    { id: '333', name: '泡沫盛夏', desc: '赛璐璐平涂的泳池盛夏，歌词落在池底深色招牌上', url: 'stages/333-bubble-summer.html' },
    { id: '335', name: '霓虹图腾', desc: '纯黑底上的荧光条纹人体彩绘与盾形部落面具', url: 'stages/335-neon-tribal.html' },
    { id: '334', name: '圣像留白', desc: '象牙白纸上微缩的圣像与岩画残片，四周九成留白', url: 'stages/334-icon-ivory.html' },
    { id: '337', name: '棋盘忍者', desc: '漫画墨线：悬浮棋盘上忍者与武士隔盘对峙，歌词是对白框', url: 'stages/337-chess-ninja.html' },
    { id: '338', name: '再生版画', desc: '牛皮纸双色丝网：举拳的无头躯干与扇形电波', url: 'stages/338-folk-print.html' },
    { id: '339', name: '超扁平糖果', desc: '糖果粉柠檬黄的平面色块，糖果兽拖着条纹尾迹', url: 'stages/339-superflat-candy.html' },
    { id: '336', name: '狂草金印', desc: '玄黑暗金碑面上，歌词被一笔一笔「写」出来，朱砂印随句砸下', url: 'stages/336-calligraphy-seal.html' },
    { id: '340', name: '木刻跃浪', desc: '瓦楞纸上的黑白木刻：人被巨浪吞下，工业岸线只剩一截', url: 'stages/340-woodcut-wave.html' },
    { id: '341', name: '胶片孩童', desc: '满幅银盐纪实照片，歌词写在底片片边的手写注记', url: 'stages/341-film-kids.html' },
    { id: '343', name: '冷艳彩绘', desc: '苍白瓷质半身像上的红蓝裂痕彩绘，锁骨窝蓄着一滴水', url: 'stages/343-body-art.html' },
    { id: '344', name: '水下钞票', desc: '泳池水下的铬钩刺穿钞票，婴儿的手伸向它', url: 'stages/344-underwater-hook.html' },
    { id: '346', name: '掩面明黄', desc: '明黄两色丝网人像，双手掩住口鼻，歌词落在左下留白', url: 'stages/346-covered-face.html' },
    { id: '342', name: '分裂残影', desc: '暗房多重曝光：黑帽女子的三重残影叠进雾林', url: 'stages/342-split-ghost.html' },
    { id: '347', name: '红中之红', desc: '整屏中国红里压低帽檐的侧影，歌词靠在暗红暗角上', url: 'stages/347-red-on-red.html' },
    { id: '348', name: '昭和线缆', desc: '绯红日轮上的昭和印刷海报，合成器线缆缠向耳际', url: 'stages/348-showa-wire.html' },
    { id: '349', name: '像素面具', desc: '1-bit 抖动肖像被猩红战纹盖住脸，右侧是严谨的排印', url: 'stages/349-pixel-mask.html' },
    { id: '350', name: '机械神女', desc: '赛博高定的机械神女：冰晶、金属颈环与数码铭牌', url: 'stages/350-cyber-geisha.html' },
    { id: '351', name: '液态铬字', desc: '纯黑宇宙里一组液态水银镀铬字，反射出霓虹色散', url: 'stages/351-liquid-chrome.html' },
    { id: '345', name: '青蓝沉睡', desc: '几乎全黑的画幅里，只有一张闭眼沉睡的脸被幽蓝照到', url: 'stages/345-indigo-sleep.html' },
    { id: '355', name: '发霉的夏天', desc: '一卷正在褪色发霉的家庭录像带，字幕烧死在磁带上', url: 'stages/355-mold-summer.html' },
    { id: '353', name: '酸柠反设计', desc: '满屏酸柠绿与系统默认字体：丑得诚实，字绝对清楚', url: 'stages/353-acid-lime.html' },
    { id: '354', name: '塑料卫城', desc: '落日网格的空商场里立着霓虹石膏像，歌词印在价签上', url: 'stages/354-plastic-acropolis.html' },
    { id: '356', name: '换乘层', desc: '凌晨三点的无人走廊，歌词是吊在门口的背光灯箱', url: 'stages/356-transfer-level.html' },
    { id: '357', name: '皂泡晴天', desc: '正午草坡上逆光上浮的肥皂泡，字落在深青玻璃板上', url: 'stages/357-soap-sky.html' },
    { id: '358', name: '眼睛向日葵', desc: '过曝草地上长着眼睛的向日葵，还有长翅膀的电视机', url: 'stages/358-eye-sunflower.html' },
    { id: '352', name: '赛博舞池', desc: '黑场舞池里液态银的骏马与迪斯科球，字压在地面下层', url: 'stages/352-cyber-ballroom.html' },
    { id: '360', name: '午夜闪回', desc: '落地窗前回眸的剪影，身后是迪斯科球与频谱墙', url: 'stages/360-midnight-flashback.html' },
    { id: '359', name: '午夜访客', desc: '1999 年凌晨还亮着灯的个人主页，旋转铬骷髅与星空平铺', url: 'stages/359-midnight-visitor.html' },
    { id: '361', name: '载波残影', desc: '停播后的载波：SMPTE 测试卡隔着弧面玻璃，字幕仍在等一句回应', url: 'stages/361-dead-air-carrier.html' },
    { id: '362', name: '夜视残像', desc: '夜视行车记录仪里的黑白残影，字幕带着三色差边', url: 'stages/362-night-vision-drift.html' },
    { id: '363', name: '临床圣像', desc: '无菌灯下被编号的瓷白仿生头颅，绕着一圈银色神经接口', url: 'stages/363-porcelain-relic.html' },
    { id: '364', name: '过曝的我们', desc: '闪光灯下的贴纸相片日记：一张被贴纸盖满的低像素快照', url: 'stages/364-flash-purikura.html' },
    { id: '365', name: '失焦圣像', desc: '被数据啃噬的点云石像仍在唱，破口边缘烧成发光网格', url: 'stages/365-fading-idol.html' },
    { id: '366', name: '霓虹卡匣', desc: '低分辨率等距像素城，套在 16-bit 卡匣包装里', url: 'stages/366-neon-cartridge.html' },
    { id: '367', name: '终端驱魔', desc: '磷绿终端字符里烧着一枚呼吸的咒环，歌词是控制台', url: 'stages/367-terminal-exorcism.html' },
    { id: '368', name: '图库事故', desc: '带水印的握手图库照压着银河脑，一起失控', url: 'stages/368-stock-meltdown.html' },
    { id: '369', name: '墨噪枯林', desc: '枯枝字标在复印机里烧成噪点，白字压在撕裂的黑里', url: 'stages/369-briar-xerox.html' },
    { id: '370', name: '剪刀暴动', desc: '复印纸上的绑架信：愤怒被一个字一个字剪下来', url: 'stages/370-scissor-riot.html' },
    { id: '371', name: '腐骸祭坛', desc: '血与菌丝在骨座上呼吸，歌词是逐字融下的蜡', url: 'stages/371-necropsy-altar.html' },
    { id: '372', name: '女巫之锤', desc: '1486 年印本的一页：木刻黑线里燃着低音圣咏', url: 'stages/372-malleus-woodcut.html' },
    { id: '373', name: '黑豹誓约', desc: '旧派刺青墙上的闪图纸：怒吼黑豹与巨型校队字', url: 'stages/373-ink-oath.html' },
    { id: '375', name: '裂面嘶鸣', desc: '炭笔切碎的脸在 7/8 拍里痉挛，碎片沿径向弹开', url: 'stages/375-fractured-face.html' },
    { id: '374', name: '绝密批号', desc: '冷战军工档案袋：噪音被归档成生物危害卷宗', url: 'stages/374-sealed-dossier.html' },
    { id: '376', name: '雨冢', desc: '雾里那尊石天使一直在哭，湿版照片的柔焦与雨痕', url: 'stages/376-weeping-marble.html' },
    { id: '377', name: '锈水布道', desc: '沼泽深处的一场八毫米布道，胶片本体压在最上层', url: 'stages/377-rustwater-sermon.html' },
    { id: '378', name: '墨窟残卷', desc: '钢笔点画刻出的雾中地牢，印在一页羊皮纸手册上', url: 'stages/378-stipple-crypt.html' },
    { id: '379', name: '天幕低垂', desc: '巨浪之下，一线冷光劈开压顶的灰黑天幕', url: 'stages/379-sublime-tempest.html' },
    { id: '380', name: '归档肉体', desc: '整页器官切片拼成的病理图谱，压着一句荧光标语', url: 'stages/380-atlas-cadaver.html' },
    { id: '381', name: '窗还亮着', desc: '深秋黄昏的中西部街口，整条街只有一扇窗亮着', url: 'stages/381-dusk-clapboard.html' },
    { id: '383', name: '裂肉矩阵', desc: '被拉扯变形的人体网格在 300 拍下撕开，带建模手柄', url: 'stages/383-flesh-matrix.html' },
    { id: '385', name: '银河放克号', desc: '镀铬母舰降落，光柱里走出三个剪影乐手', url: 'stages/385-funk-mothership.html' },
    { id: '384', name: '盐味阳光', desc: '加州正午的泳池边，歌词被过曝的眩光托起', url: 'stages/384-pacifica-noon.html' },
    { id: '382', name: '霜林刻痕', desc: '雾林里的卢恩太阳轮：24 个自绘符文随进度亮起', url: 'stages/382-frost-rune.html' },
    { id: '388', name: '冷纸残响', desc: '白纸上断断续续的无调铅笔痕，时间被当成横轴', url: 'stages/388-graphite-atonal.html' },
    { id: '386', name: '鎏金门廊', desc: '黄昏门廊前五个剪影一起微笑，护墙上跑着灯泡', url: 'stages/386-gilded-portico.html' },
    { id: '387', name: '街头弥撒', desc: '70 年代水粉海报：爆炸头硬汉与四格哈莱姆分镜', url: 'stages/387-street-mass.html' },
    { id: '389', name: '铜管夜行', desc: '第二线铜管游行穿过铁艺阳台，顶部一条双头蛇横楣', url: 'stages/389-congo-brass.html' },
    { id: '390', name: '月球客厅', desc: '50 年代高保真客厅：舷窗外浮着合成月球，唱臂扫过唱片', url: 'stages/390-moon-lounge.html' },
    { id: '391', name: '金轮祷文', desc: '黑紫底上绝对镜像对称的金箔图腾，荷鲁斯之眼在星轨上', url: 'stages/391-aten-foil.html' },
    { id: '392', name: '海风半拍', desc: '柠檬黄与海蓝的三块色，黑线随歌轻晃', url: 'stages/392-copa-bossa-line.html' },
    { id: '393', name: '流金狂想', desc: '萨克斯熔成流金，悬在星海与透视棋盘沙海上空', url: 'stages/393-molten-sax.html' },
    { id: '394', name: '霓虹推弦', desc: '湿玻璃上的红霓虹管与超粗压缩字，指尖把夜推成电', url: 'stages/394-neon-bend.html' },
    { id: '395', name: '贝雷帽夜行', desc: '小号与康加鼓穿过橙蓝斜纹，纯色扁平剪影', url: 'stages/395-beret-brass.html' },
    { id: '396', name: '七寸留声', desc: '旧唱片店灯下的 45 转纸袖套与慢转黑胶', url: 'stages/396-crate-label.html' },
    { id: '397', name: '琥珀织歌', desc: '暖焦糖光里，歌词像手织印花布，珠链按进度点亮', url: 'stages/397-amber-weave.html' },
    { id: '398', name: '银球夜', desc: '镜球撒下满室十字星芒，歌词银白带霓虹辉光', url: 'stages/398-mirrorball-glitz.html' },
    { id: '399', name: '振捣', desc: '混凝土立面随四拍被反复压实，歌词压在浇筑石板上', url: 'stages/399-beton-schacht.html' },
    { id: '400', name: '机械灵歌', desc: '同一地平线上的工业机器与青色线框，暖金灵魂核随鼓点', url: 'stages/400-machine-soul-grid.html' },
    { id: '401', name: '荧光笑面', desc: '印歪了的 1988 仓库派对传单，酸笑脸与超粗黑字', url: 'stages/401-acid-smiley.html' },
    { id: '402', name: '矢量残响', desc: '90s 平面血统的斜角网格与警示贴纸，碎拍里的工业霓虹', url: 'stages/402-vector-afterglow.html' },
    { id: '403', name: '密纹', desc: '一张白纸六千颗点，7 条带点距各差 0.42%，莫尔条纹自己浮出来', url: 'stages/403-raster-seam.html' },
    { id: '404', name: '糖釉过载', desc: '充气塑料糖果在反重力里炸开，糖霜日落与铬色史莱姆', url: 'stages/404-sugar-glaze.html' },
    { id: '405', name: '落日疾驰', desc: '尾灯拖出最后一道余晖：楔形超跑压在霓虹透视网格上', url: 'stages/405-sunset-dash.html' },
    { id: '406', name: '冰隙微光', desc: '万年蓝冰的裂缝里，暖光随低频缓缓流过', url: 'stages/406-glacial-fissure.html' },
    { id: '407', name: '冰镇金标', desc: '金箔烫在皮面上的夜：未唱是冷银压印，唱过是香槟金', url: 'stages/407-champagne-emboss.html' },
    { id: '408', name: '音生晶簇', desc: '低音撑开晶格，鼓点催开光丝：三层自相似的分形晶体', url: 'stages/408-audio-crystal-bloom.html' },
    { id: '409', name: '黑光莲瞳', desc: '第三只眼在黑光里缓缓开花，五层曼陀罗向内递归', url: 'stages/409-plasma-third-eye.html' },
    { id: '410', name: '次声裂核', desc: '低音炮把液态金属震成海啸，18 块装甲在真 3D 里转', url: 'stages/410-subsonic-core.html' },
    { id: '411', name: '余晖靠岸', desc: '赤脚踩住最后一缕暖光：摩尔拱花窗外的水彩落日', url: 'stages/411-sunset-arch.html' },
    { id: '412', name: '锤与肺', desc: '仰拍赤膊铁躯的三色丝网版画，标语随鼓点砸下', url: 'stages/412-motor-stencil.html' },
    { id: '413', name: '熔心棘冠', desc: '玻璃心脏在暗处融化，30 根钛棘围成冠', url: 'stages/413-thorn-glass-heart.html' },
    { id: '414', name: '金钻王座', desc: '金链、票子和碎钻围着念词：Pen & Pixel 式厚重挤出字', url: 'stages/414-bling-pen-pixel.html' },
    { id: '415', name: '喷漆未干', desc: '红砖墙上的狂野派字标，歌词跟着鼓点一喷一个', url: 'stages/415-bronx-wall.html' },
    { id: '416', name: '镀铬黄昏', desc: '棕榈影里 1964 Impala 随鼓点抬起，逆光纪实照片感', url: 'stages/416-chrome-dusk.html' },
    { id: '417', name: 'A面手稿', desc: '磁带 A 面被马克笔涂满的手写手稿', url: 'stages/417-a-side-scrawl.html' },
    { id: '418', name: '空白九十', desc: '一支马克笔把 C90 磁带标签涂成整片色块', url: 'stages/417-sharpie-c90.html' },
    { id: '419', name: '天台冷线', desc: '混凝土天台上一排连帽剪影，手持夜拍的取证式画面', url: 'stages/419-council-noir.html' },
    { id: '420', name: '斜阳采样簿', desc: '斜阳下的黑胶堆与 MPC 静物，歌词印在采样手记上', url: 'stages/420-crate-light.html' },
    { id: '421', name: '葬夜圣咏', desc: '雾里那场没有神的弥撒：12 跨尖拱收束成一扇尖窗', url: 'stages/421-crimson-requiem.html' },
    { id: '422', name: '馆藏证词', desc: '档案卷宗里一行行被红笔勘定的证词', url: 'stages/422-archive-testimony.html' },
    { id: '423', name: '镀金狂欢', desc: '金色笑脸悬在游乐园上空，车厢载着剪影爬坡', url: 'stages/423-gilded-coaster.html' },
    { id: '424', name: '铁网零下', desc: '零下铁丝网后的探照视野，字幕压在冰霜上', url: 'stages/424-fence-below-zero.html' },
    { id: '425', name: '喷漆心跳', desc: '日落海滩的涂鸦情书', url: 'stages/425-spray-heart.html' },
    { id: '426', name: '夜雨自习室', desc: '台灯下一句一句把歌词写进雨夜', url: 'stages/426-rainy-study.html' },
    { id: '427', name: '留案存照', desc: '正面与侧脸两张存档照，编号压在灰墙上', url: 'stages/427-mugshot-booking.html' },
    { id: '428', name: '热像监控', desc: '红外人形在监控噪点里逐字升温', url: 'stages/428-thermal-cctv.html' },
    { id: '429', name: '晴日手记', desc: '斜阳晒着衣柜门上的拍立得与手写字', url: 'stages/429-sunlit-diary.html' },
    { id: '430', name: '压花帖', desc: '蕨叶与孢子在旧纸上随歌轻颤', url: 'stages/430-herbarium-plate.html' },
    { id: '431', name: '灼光午后', desc: '过期胶卷里的逆光白日梦', url: 'stages/431-sunbleached-halo.html' },
    { id: '432', name: '静默碑', desc: '宇航员在混凝土巨碑下仰望残夜', url: 'stages/432-cosmonaut-monolith.html' },
    { id: '433', name: '鹿角绣林', desc: '深红十字绣布上铺满图腾，鹿与犬立在花丛', url: 'stages/433-millefleurs-antler.html' },
    { id: '434', name: '晨光旅馆', desc: '百叶窗切开晨光，一室空椅待你落座', url: 'stages/434-quiet-window.html' },
    { id: '435', name: '灯标字房', desc: '灯塔火柴盒贴画上的逐字套印', url: 'stages/435-press-lighthouse.html' },
    { id: '436', name: '柠檬斜塔', desc: '孟菲斯色块撞在一起，圆点与波浪横穿画面', url: 'stages/436-memphis-tilt.html' },
    { id: '437', name: '毡锤与晨雾', desc: '晨雾里钢琴毡锤的浅景深', url: 'stages/437-felt-mist.html' },
    { id: '438', name: '浪管明信', desc: '珊瑚冰蓝套印的冲浪黄金年代邮差片', url: 'stages/438-aloha-tube.html' },
    { id: '439', name: '蓝闪蝶匣', desc: '维多利亚奇珍柜里，标本随歌声发亮', url: 'stages/439-glass-cabinet.html' },
    { id: '440', name: '泡泡幻灯机', desc: '油彩在负片人像上炸开成液泡', url: 'stages/440-acid-bubble.html' },
    { id: '441', name: '绒线黄昏', desc: '暮色山丘缝进毛线拼布', url: 'stages/441-tufted-dusk.html' },
    { id: '442', name: '对折旅馆', desc: '粉彩对称的旅馆前台，冷面等你把歌唱完', url: 'stages/442-symmetry-hotel.html' },
    { id: '443', name: '沉纱', desc: '水中真丝裹住闭目浮游的身体', url: 'stages/443-silk-cavern.html' },
    { id: '444', name: '晨光回廊', desc: '红砖拱廊，晨光逐字点亮旧歌词', url: 'stages/444-morning-brick.html' },
    { id: '445', name: '旺角夜雨', desc: '霓虹招牌在雨里化成一道道光痕', url: 'stages/445-neon-rain-scratch.html' },
    { id: '446', name: '纸下群山', desc: '盲凸等高线在棉纸上起伏', url: 'stages/446-paper-relief.html' },
    { id: '447', name: '铁皮画报', desc: '发条一转，回到1986年的画报', url: 'stages/447-tin-toy-pictorial.html' },
    { id: '448', name: '空山一痕', desc: '宣纸留白，墨落一句', url: 'stages/448-xuan-paper-void.html' },
    { id: '449', name: '黄土谣', desc: '赭石木刻上的黄土沟壑，逐字烫亮', url: 'stages/449-loess-cut.html' },
    { id: '450', name: '墨龙街头', desc: '水墨飞白里长出街头涂鸦', url: 'stages/450-ink-mic.html' },
    { id: '451', name: '铁西纪年', desc: '冷灰锈带高炉下的铅字红标', url: 'stages/451-rust-belt-documentary.html' },
    { id: '452', name: '鹹風霓虹', desc: '港邊廟口字在霓虹裡亮起', url: 'stages/452-harbor-temple-neon.html' },
    { id: '453', name: '九尾鎏金', desc: '青铜神树下的鎏金瑞兽巡游', url: 'stages/453-gilded-qilin.html' },
    { id: '454', name: '雨港備忘', desc: '台北天橋上停駐的逆光人影', url: 'stages/454-rainport-copy.html' },
    { id: '455', name: '银褶', desc: '山雾里的黑红黄织锦', url: 'stages/455-lacquer-brocade.html' },
    { id: '456', name: '芭蕉夜航', desc: '南方夏夜的芭蕉影里漂着一句歌词', url: 'stages/456-bajiao-night.html' },
    { id: '457', name: '墨翎', desc: '水袖甩出墨滴的那一秒，脸谱只剩线', url: 'stages/457-ink-sleeve.html' },
    { id: '458', name: '果冻写真', desc: '亮片柔光下逐字点亮的果冻字', url: 'stages/458-jelly-idol.html' },
    { id: '459', name: '昭和大判', desc: '浮世绘拼贴撞上昭和波普', url: 'stages/459-rising-sun-montage.html' },
    { id: '460', name: '涩谷剪报', desc: '拼贴台上的法语歌，逐字点亮', url: 'stages/460-shibuya-clipping.html' },
    { id: '461', name: '绯色圣咏', desc: '帷幕与花窗下，逐字燃亮', url: 'stages/461-crimson-chant.html' },
    { id: '462', name: '放课后过曝', desc: '过曝胶片里的放学后铁道口', url: 'stages/462-overexposed-crossing.html' },
    { id: '463', name: 'DV 少女信号', desc: '千禧录像带里的少女与蓝兔子', url: 'stages/463-yearbook-signal.html' },
    { id: '464', name: '曜铠图腾', desc: '铂金机甲徽章在极光里呼吸发光', url: 'stages/464-chrome-emblem.html' },
    { id: '465', name: '银盐缚影', desc: '闪光灯下的粗粒黑房，一字一戳', url: 'stages/465-hard-flash-noir.html' },
    { id: '466', name: '青山留白', desc: '柔光箱下，一句一句亮起的肖像', url: 'stages/466-aoyama-portrait.html' },
    { id: '467', name: '彩窗镇魂诗', desc: '彩玻璃与弹幕里的一句歌词', url: 'stages/467-stained-glass-requiem.html' },
    { id: '468', name: '石与水纹', desc: '纸上卵石静卧，一句一句漫上来', url: 'stages/468-washi-air.html' },
    { id: '469', name: '汉江夜雨', desc: '车窗上的雨与钨丝灯里的失焦侧影', url: 'stages/469-han-river-tungsten.html' },
    { id: '470', name: '银座残灯', desc: '昭和夜店外的霓虹光斑与和服背影', url: 'stages/470-neon-ginza.html' },
    { id: '471', name: '藍摺', desc: '一杯冰酒配一张转着的旧唱片', url: 'stages/471-indigo-swing.html' },
    { id: '472', name: '豹纹心跳', desc: '野性花纹里随鼓点起伏的歌词', url: 'stages/472-neon-leopard.html' },
    { id: '473', name: '折光筑', desc: '斜光劈开折纸的墙与影', url: 'stages/473-folded-light.html' },
    { id: '474', name: '花布影棚', desc: '西非高life花布背景前的半身肖像', url: 'stages/474-highlife-frame.html' },
    { id: '475', name: '墙皮与烟', desc: '老墙掉粉彩，乐手在门里笑', url: 'stages/475-havana-peel.html' },
    { id: '476', name: '热带火漆', desc: '萨尔萨黑胶海报上的字牌歌词', url: 'stages/476-elbarrio-heat.html' },
    { id: '477', name: '阿迪斯金痕', desc: '夜总会萨克斯手与吉兹字母的泛黄胶片', url: 'stages/477-addis-ink.html' },
    { id: '478', name: '狮喉回声', desc: '金斯敦水泥墙上的红黄绿壁画', url: 'stages/478-lion-dub-wall.html' },
    { id: '479', name: '青金回旋', desc: '飞毯在伊斯兰花窗里旋成星轨', url: 'stages/479-simurgh-mandala.html' },
    { id: '480', name: '铜簧夜巷', desc: '班多钮在湿石板上拉长成影', url: 'stages/480-tango-noir.html' },
    { id: '481', name: '骷髅不眠', desc: '万寿菊下，骷髅抱着吉他唱到天亮', url: 'stages/481-marigold-calavera.html' },
    { id: '482', name: '靛蓝长路', desc: '靛蓝头巾的乐手独行落日沙海', url: 'stages/482-indigo-veil.html' },
    { id: '483', name: '胎藏千臂', desc: '印度彩印神像在拉格中呼吸', url: 'stages/483-garbha-vyuha.html' },
    { id: '484', name: '雷在砖里', desc: '一整面墙的音箱在震', url: 'stages/484-favela-wall.html' },
    { id: '485', name: '皮科热带', desc: '荧光手绘音响卡车在加勒比夜色里跳动', url: 'stages/485-pico-florescente.html' },
    { id: '486', name: '雾结翡翠', desc: '海雾苔原上，金线结字成歌', url: 'stages/486-emerald-interlace.html' },
    { id: '487', name: '铜管泥筏', desc: '泥河木筏上的吉普赛铜管婚礼', url: 'stages/487-brass-mud-barge.html' },
    { id: '488', name: '黑曜鎏金', desc: '拉各斯黑金肖像，字随鼓点点亮', url: 'stages/488-onyx-gilt.html' },
    { id: '489', name: '黄标指挥台', desc: '金色铭牌压住挥棒的瞬间', url: 'stages/489-maestro-cartouche.html' },
    { id: '490', name: '静默之境', desc: '灰白弥漫的地平线上，字浮在雾里', url: 'stages/490-silent-expanse.html' },
    { id: '491', name: '纸上赫兹', desc: '奶白纸面上一张手绘的频率与时间地图', url: 'stages/491-frequenz-platte.html' },
    { id: '492', name: '剃刀之夜', desc: '血红的意大利式悬疑，黑手套与剃刀', url: 'stages/492-giallo-razor.html' },
    { id: '493', name: '暗巷灯影', desc: '烟与光在风衣上割出条纹', url: 'stages/493-noir-blind-fugue.html' },
    { id: '494', name: '相位格', desc: '二十行方格在静默里缓缓错相', url: 'stages/494-phase-field.html' },
    { id: '495', name: '经纬标本', desc: '一句歌词是一份考察记录', url: 'stages/495-field-plate.html' },
    { id: '496', name: '石碑偏移', desc: '黑碑立在星海边，字在光里逐字亮起', url: 'stages/496-monolith-drift.html' },
    { id: '497', name: '塞纳维', desc: '塞纳河黑边黄字的存在主义剧照', url: 'stages/497-seine-veil.html' },
    { id: '498', name: '共振白室', desc: '白墙上一块铜板，沙随歌声跳成图形', url: 'stages/498-sand-node.html' },
    { id: '499', name: '巨兽焚城', desc: '怪兽踏火焚塔，红光泼满全城', url: 'stages/499-kaiju-inferno.html' },
    { id: '500', name: '余烬存档', desc: '篝火醒着，勇者在存档点睡去', url: 'stages/500-embers-rest.html' },
    { id: '501', name: '唇齿铅印', desc: '声起时，散字归位压成铅字', url: 'stages/501-dada-letterpress.html' },
    { id: '502', name: '漂白循环', desc: '磁带一圈圈磨掉相纸上的字', url: 'stages/502-bleach-loop.html' },
    { id: '503', name: '潜生纪', desc: '似是而非的形变体，从潜空间缓慢长出来', url: 'stages/503-latent-morph.html' },
    { id: '504', name: '已发送', desc: '歌词是一条条正在打出来的消息', url: 'stages/504-imessage-lyric.html' },
    { id: '505', name: '棱镜阈限', desc: '刚体棱镜切面，正反蒙版镂空歌词', url: 'stages/505-metalheart-prism.html' },
    { id: '506', name: '偏色过境', desc: '歌词从左边滑过，红蓝错位拖出景深', url: 'stages/506-chroma-pass.html?v=2' },
    { id: '507', name: '赤金显影', desc: '鼓点一到，黑字标闪成赤金', url: 'stages/507-crimson-chrome.html' },
    { id: '508', name: '未来已来', desc: '克莱因蓝与铬字硬切，镜头跟着拍子走', url: 'stages/508-future-is-here.html' },
    { id: '509', name: '活字蒙太奇', desc: '每个字都是一次镜头切换', url: 'stages/509-kinetic-montage.html?v=1' },
    { id: '510', name: '积木字墙', desc: '歌词化作积木在三维空间砌成墙', url: 'stages/510-block-wall.html' },
    { id: '511', name: '雷达锁词', desc: '狙击镜沿折线甩过每一个词', url: 'stages/511-radar-lock.html' },
    { id: '512', name: '折页', desc: '横线本上的歌词，换句时把纸捏成团扔出画面', url: 'stages/512-paper-fold-lyric.html' },
    { id: '513', name: '狙击歌词', desc: '准星在三维房间里，一句一句咬住歌词', url: 'stages/513-sniper-scope.html' },
    { id: '514', name: '重字', desc: '唱完一句就碎，碎块落地堆成山', url: 'stages/514-weight-of-words.html' },
    { id: '515', name: '一字一羊', desc: '跳过一只羊，点亮一个字', url: 'stages/515-yi-zi-yi-yang.html' },
    { id: '516', name: '一点落款', desc: '一个点推成整张专辑名', url: 'stages/516-one-point-signature.html' },
    { id: '517', name: '失焦记忆', desc: '3D纵深穿梭与RGB色差景深的情绪独白', url: 'stages/517-chromatic-pulse.html' },
    { id: '518', name: '瞬态撕裂', desc: '高速甩镜畸变与强拍色相爆闪的卡点舞台', url: 'stages/518-kinetic-whip.html' },
    { id: '519', name: '琉璃幻境', desc: '极光流体着色器与水晶折射消散的梦境', url: 'stages/519-prism-euphoria.html' },
    { id: '520', name: '胶片慢门', desc: '王家卫式抽帧慢门残影与琥珀漏光胶片', url: 'stages/520-amber-shutter.html' },
    { id: '521', name: '赛博挽歌', desc: '信号撕裂错位与3D网格俯冲的故障美学', url: 'stages/521-glitch-requiem.html' },
    { id: '522', name: '深海回响', desc: '深海失重漂浮与水波折射光斑的沉浸舞台', url: 'stages/522-abyssal-echo.html' },
    { id: '523', name: '绯红灼烧', desc: '胶片灼烧转场与热浪扭曲的炽烈情绪冲击', url: 'stages/523-velvet-burn.html' },
    { id: '524', name: '引力坍缩', desc: '黑洞引力透镜畸变与巨物空间运镜的史诗舞台', url: 'stages/524-monolith-void.html' },
    { id: '525', name: '雨夜霓虹', desc: '车窗雨滴物理折射与都市霓虹散景的夜行舞台', url: 'stages/525-neon-raindrop.html' },
    { id: '526', name: '镜面破碎', desc: '多棱镜面裂纹折射与折角甩镜的视觉冲击舞台', url: 'stages/526-shattered-mirror.html' },
    { id: '527', name: '超维莫比乌斯', desc: '四维超立方体折叠与扭曲空间走廊运镜', url: 'stages/527-mobius-tesseract.html' },
    { id: '528', name: '磁流皇冠', desc: '3D铁磁流体尖刺律动与液态金属反射舞台', url: 'stages/528-ferrofluid-crown.html' },
    { id: '529', name: '机甲神经舱', desc: '第一人称机甲座舱HUD锁定与高速空战运镜', url: 'stages/529-mecha-hud-cockpit.html' },
    { id: '530', name: '粗野主义光殿', desc: '3D巨型混凝土几何圣殿与戏剧性丁达尔光束', url: 'stages/530-brutalist-concrete-light.html' },
    { id: '531', name: '激光点云都市', desc: '百万级LiDAR激光雷达扫描点云与穿透运镜', url: 'stages/531-particle-lidar-city.html' },
    { id: '532', name: '全息黑胶解构', desc: '3D悬浮解构黑胶唱机与声波纹路微距运镜', url: 'stages/532-hologram-vinyl-turntable.html' },
    { id: '533', name: '折纸机械群', desc: '千枚3D金属折纸飞鸟集群拓扑变形与穿梭', url: 'stages/533-cyber-origami-swarm.html' },
    { id: '534', name: '星盘时计', desc: '巨型3D神圣几何星盘齿轮咬合与时间倒流卡点', url: 'stages/534-chrono-clockwork-astral.html' },
    { id: '535', name: '聚变反应堆', desc: '3D磁约束托卡马克等离子体环与高能电弧冲击', url: 'stages/535-plasma-reactor-core.html' },
    { id: '536', name: '埃舍尔迷宫', desc: '无限循环悖论阶梯与反重力90度翻转运镜', url: 'stages/536-infinite-brutalist-stair.html' },
    { id: '537', name: '超新星创世', desc: '3D体积星云尘埃柱与超新星冲击波膨胀运镜', url: 'stages/537-supernova-nebula-birth.html' },
    { id: '538', name: '荧光潘多拉', desc: '3D微距发光菌丝森林与孢子流体光海', url: 'stages/538-bioluminescent-forest.html' },
    { id: '539', name: '曜石熔岩', desc: '3D龟裂黑曜石地壳与裂缝岩浆喷涌冲击', url: 'stages/539-volcanic-obsidian-magma.html' },
    { id: '540', name: '极地冰洞', desc: '3D万年蓝冰晶洞穴内壁折射与极光穿透', url: 'stages/540-aurora-ice-cavern.html' },
    { id: '541', name: '沙海蜃楼', desc: '黄金流体沙丘风蚀粒子与烈日海市蜃楼折射', url: 'stages/541-desert-mirage-dune.html' },
    { id: '542', name: '雷暴云砧', desc: '穿梭万米高空积雨云峡谷与云内紫电闪击', url: 'stages/542-thunderhead-cumulonimbus.html' },
    { id: '543', name: '水银日食', desc: '液态水银风暴海面与黑日食冕环高反差舞台', url: 'stages/543-mercury-ocean-eclipse.html' },
    { id: '544', name: '紫晶洞天', desc: '3D巨型矿物晶簇生长与内部多重全反射光路', url: 'stages/544-crystal-geode-cave.html' },
    { id: '545', name: '恒星日珥', desc: '近距离直视太阳表面沸腾米粒组织与巨型日珥喷发', url: 'stages/545-solar-prominence-flare.html' },
    { id: '546', name: '爱因斯坦罗森桥', desc: '穿越高维时空虫洞扭曲喉部与异星宇宙出口', url: 'stages/546-deep-space-wormhole.html' },
    { id: '547', name: '赛博千里江山', desc: '3D青绿山水矿物水墨晕染与鎏金粒子飞白', url: 'stages/547-cyber-ink-landscape.html' },
    { id: '548', name: '敦煌流光飞天', desc: '3D丝绸飘带物理流体力学与藻井几何曼陀罗', url: 'stages/548-dunhuang-flying-ribbon.html' },
    { id: '549', name: '竹林剑意', desc: '3D风雨翠竹林穿梭与寒芒剑气空间切割', url: 'stages/549-wuxia-bamboo-blade.html' },
    { id: '550', name: '青花金缮', desc: '3D汝窑/青花瓷器开片裂纹与液态纯金修补流淌', url: 'stages/550-porcelain-kintsugi-gold.html' },
    { id: '551', name: '走马皮影', desc: '3D多层镂空宣纸灯笼光影投射与民俗幻彩', url: 'stages/551-shadow-puppet-lantern.html' },
    /* camera:true 只是给宿主的提前提示（避免第一次进形态时先弹一下展开的
       迷你播放器）；真正的协议声明在形态 ready payload 里，见 onReady。 */
    { id: '552', name: '烟雨江南', desc: '乌篷船摇进无尽烟雨，词句落在前方水上', camera: true, url: 'stages/552-ink-wash-rain-pavilion.html' },
    { id: '553', name: '九龙霓虹', desc: '3D密集港风复古霓虹灯牌森林穿梭与故障闪烁', url: 'stages/553-neon-kowloon-signboard.html' },
    { id: '554', name: '万字碑林', desc: '3D悬浮碑林文字矩阵穿梭与金石拓片剥落', url: 'stages/554-calligraphy-sword-matrix.html' },
    { id: '555', name: '太虚琉璃宫', desc: '3D悬浮白玉云宫仙境与月华流光丝带', url: 'stages/555-celestial-jade-palace.html' },
    { id: '556', name: '枯山水禅境', desc: '3D极简白砂纹路声波律动与黑石静谧光影', url: 'stages/556-zen-sand-garden-ripple.html' },
    { id: '557', name: '千禧液态气球', desc: 'Y2K充气镀铬金属泡泡字与酸性镭射贴纸空间', url: 'stages/557-y2k-chrome-inflatable.html' },
    { id: '558', name: '98磁带记忆', desc: '家用VHS录像机寻像器、磁带雪花噪点与光学变焦', url: 'stages/558-vhs-camcorder-1998.html' },
    { id: '559', name: '落日合成器公路', desc: '80年代复古未来主义网格山脉、烈日切线与超跑狂飙', url: 'stages/559-synthwave-outrun-highway.html' },
    { id: '560', name: '矢量示波器', desc: '模拟荧光绿/琥珀色阴极射线管XY矢量声波绘图', url: 'stages/560-crt-oscilloscope-vector.html' },
    { id: '561', name: '波普网点分镜', desc: '蜘蛛侠平行宇宙式3D美漫分镜框、CMYK半调网点与拟声词炸裂', url: 'stages/561-halftone-comic-popart.html' },
    { id: '562', name: '磁带迷宫', desc: '3D无限缠绕的褐色磁带条带与复古卡座齿轮运转', url: 'stages/562-cassette-tape-ribbon.html' },
    { id: '563', name: '体素街机厅', desc: '3D发光体素方块世界崩塌重组与16-Bit粒子爆炸', url: 'stages/563-pixel-arcade-voxel.html' },
    { id: '564', name: '暗房显影', desc: '漂浮在红光暗房显影液中的相纸画框与化学显影', url: 'stages/564-polaroid-darkroom-develop.html' },
    { id: '565', name: '蒸汽波神殿', desc: '3D古典大卫石膏雕像、棋盘格泳池与落日棕榈故障', url: 'stages/565-vaporwave-marble-plaza.html' },
    { id: '566', name: '辉光管世界', desc: '3D复古苏联玻璃辉光管阵列与炽热钨丝橘光点亮', url: 'stages/566-nixie-tube-chronometer.html' },
    { id: '567', name: '哥特彩窗圣堂', desc: '3D高耸哥特肋架拱顶与玫瑰花窗破碎神圣光束', url: 'stages/567-gothic-stained-cathedral.html' },
    { id: '568', name: '重工电锯火花', desc: '3D高速旋转重金属齿轮锯片与万千切割火花飞溅', url: 'stages/568-chainsaw-industrial-sparks.html' },
    { id: '569', name: 'X光骨骼盛放', desc: '医学X光半透明透视材质与发光机械花朵破骨生长', url: 'stages/569-x-ray-skeletal-bloom.html' },
    { id: '570', name: '血月鸦群', desc: '巨型猩红血月剪影、枯枝荒原与3D惊飞黑鸦风暴', url: 'stages/570-blood-moon-crow.html' },
    { id: '571', name: '酸性液态镀铬', desc: '90年代Rave酸性流光纹理与扭曲液态银异形雕塑', url: 'stages/571-acid-techno-liquid-metal.html' },
    { id: '572', name: '雷霆荆棘', desc: '3D带刺金属荆棘藤蔓缠绕与高压紫电击穿舞台', url: 'stages/572-barbed-wire-lightning.html' },
    { id: '573', name: '阈限空间', desc: '超现实无限黄色走廊/泳池房3D穿梭与模拟信号失真', url: 'stages/573-vhs-horror-analog-liminal.html' },
    { id: '574', name: '碎裂王座', desc: '3D悬浮黑曜石尖刺阶梯与暗金流体粒子风暴', url: 'stages/574-shattered-obsidian-throne.html' },
    { id: '575', name: '精密激光雕刻', desc: '工业级高能光纤激光束在暗黑钛金属板上实时烧蚀刻字', url: 'stages/575-cyber-surgeon-laser.html' },
    { id: '576', name: '像素坍塌', desc: 'AE级Datamoshing帧间运动矢量涂抹与3D流体人脸/几何雕塑', url: 'stages/576-glitch-datamosh-void.html' },
    { id: '577', name: '包豪斯动力雕塑', desc: '3D原色几何球体/圆环/长方体精密机械平衡与正交透视切换', url: 'stages/577-bauhaus-kinetic-sculpture.html' },
    { id: '578', name: '无限镜屋', desc: '草间弥生式六面全反射镜面房间与万千悬浮呼吸光球', url: 'stages/578-mirror-infinity-cube.html' },
    { id: '579', name: '瑞士网格风暴', desc: '顶级动态图形设计(Motion Graphics)动态分栏网格与巨型无衬线排版', url: 'stages/579-minimal-swiss-brutal-grid.html' },
    { id: '580', name: '丝绒歌剧院', desc: '3D暗红丝绒舞台帷幕开合、追光灯柱与漫天金箔礼花', url: 'stages/580-red-velvet-theater-curtain.html' },
    { id: '581', name: '空间玻璃视窗', desc: 'Apple Vision Pro式3D悬浮磨砂毛玻璃多层空间面板与流光折射', url: 'stages/581-glassmorphism-os-spatial.html' },
    { id: '582', name: '隧道远光灯', desc: '深夜无限混凝土公路隧道狂飙、顶部钠灯掠过与远光灯眩光', url: 'stages/582-concrete-tunnel-headlight.html' },
    { id: '583', name: '多层剪纸剧场', desc: '3D十层立体纸雕景深盒子、边缘柔影与折扇展开转场', url: 'stages/583-kinetic-paper-cut-diorama.html' },
    { id: '584', name: '建筑工程蓝图', desc: '3D动态生长的精密建筑CAD线框、尺寸标注线与剖面扫描', url: 'stages/584-architectural-blueprint-cad.html' },
    { id: '585', name: '天国琉璃阶', desc: '3D悬浮在纯白圣光云海中的半透明彩虹折射阶梯', url: 'stages/585-prism-staircase-heaven.html' },
    { id: '586', name: '魔方矩阵重构', desc: '由数百个3D黑金立方体组成的动态墙面随低音凹凸推移与旋转', url: 'stages/586-tectonic-cube-shift.html' },
    { id: '587', name: '黄昏彗星', desc: '新海诚式极致绚烂逢魔之时晚霞云海、划破天际的双尾彗星与铁道镜头', url: 'stages/587-makoto-twilight-comet.html' },
    { id: '588', name: '扳机社闪光帧', desc: 'Trigger扳机社夸张广角透视、十字星爆发与黑白手绘冲击帧（Impact Frames）', url: 'stages/588-trigger-impact-frames.html' },
    { id: '589', name: '使徒警报', desc: '新世纪福音战士极粗明朝体满屏高密度排版、六边形蜂窝AT力场与红黑警报', url: 'stages/589-eva-nerv-tactical-type.html' },
    { id: '590', name: '狂乱漫剪', desc: '顶级日漫MMV动态分镜拼贴、半调网点纸张撕裂与高速残影摇晃', url: 'stages/590-chainsaw-manga-collage.html' },
    { id: '591', name: '物语几何', desc: '新房昭之物语系列高饱和纯色闪帧、几何矢量剪纸与45度歪头构图', url: 'stages/591-monogatari-avant-garde.html' },
    { id: '592', name: '魔法蔷薇阵', desc: '3D多层旋转发光魔法阵、飘落荆棘蔷薇花瓣与彩绘玻璃光柱', url: 'stages/592-magical-stained-clock.html' },
    { id: '593', name: '怪盗红黑斜切', desc: '女神异闻录P5式极致红黑五角星斜切UI、撕裂绑架信字体与动感转场', url: 'stages/593-persona-phantom-thief.html' },
    { id: '594', name: '蔚蓝澄空光环', desc: '通透清澈的蔚蓝天空、悬浮几何发光光环（Halo）与清爽流线型科技UI', url: 'stages/594-blue-archive-halo-sky.html' },
    { id: '595', name: '次元樱吹雪', desc: '3D唯美落樱庭院、逆光丁达尔斜阳与高速花瓣风暴转场', url: 'stages/595-maplestory-pixel-sakura.html' },
    { id: '596', name: '次元斩裂', desc: '宿傩/维吉尔式空间次元斩裂、玻璃空间碎片错位与红蓝残影冲击', url: 'stages/596-cyber-katana-dimension-cut.html' },
    { id: '597', name: '流金丝绸', desc: '3D高定丝绸流体波浪、24K金箔微粒与Vogue时尚大片级衬线排版', url: 'stages/597-haute-couture-silk-gold.html' },
    { id: '598', name: '琥珀浮香', desc: '香奈儿琥珀瓶身内金色液体凝成字的3D厚度歌词、玻璃折射与涡流消散', url: 'stages/598-chanel-perfume-amber-bottle.html' },
    { id: '599', name: '极简钟摆', desc: '巨型黄铜极简钟摆左右横扫切割画面与正负空间反转', url: 'stages/599-kinetic-clock-pendulum.html' },
    { id: '600', name: '美术馆光影', desc: '3D极简现代美术馆纯白展厅、古典雕塑剪影与戏剧性移动天窗光斑', url: 'stages/600-gallery-marble-spotlight.html' },
    { id: '601', name: '流瓷金墨', desc: '3D纯白流体奶油/白瓷波浪与黑金水墨滴落冲击交融', url: 'stages/601-porcelain-fluid-milk-gold.html' },
    { id: '602', name: '黑珍珠星轨', desc: '3D悬浮幻彩黑珍珠球体与精密银丝星轨环绕', url: 'stages/602-velvet-eclipse-pearl.html' },
    { id: '603', name: '折曲红绸', desc: '3D超现实雕塑感红色烤漆金属长带在极简暗黑空间中无限穿插', url: 'stages/603-folded-metal-ribbon-red.html' },
    { id: '604', name: '百叶窗黑色电影', desc: '经典好莱坞黑色电影(Film Noir)百叶窗条纹阴影切割、烟雾缭绕与一抹惊艳主色', url: 'stages/604-monochrome-noir-rain-blind.html' },
    { id: '605', name: '偏振液晶', desc: '显微镜下偏振光液晶/矿物结晶的流光幻彩与几何分界线生长', url: 'stages/605-liquid-crystal-polarization.html' },
    { id: '606', name: '牛顿摆动量', desc: '3D巨型镀铬牛顿摆球体碰撞传导、能量冲击波与精准卡点甩镜', url: 'stages/606-kinetic-sphere-pendulum-cradle.html' },
    { id: '607', name: '克拉尼声波沙盘', desc: '真实二维波动方程克拉尼图形（Chladni Plate）成千上万沙粒随频谱自组织聚散', url: 'stages/607-cymatics-chladni-plate.html' },
    { id: '608', name: '三维分形神殿', desc: '3D Mandelbulb分形几何无限递归生长与深入微观分形峡谷运镜', url: 'stages/608-mandelbulb-fractal-temple.html' },
    { id: '609', name: '神经突触风暴', desc: '3D大脑神经元树突网络与动作电位生物电信号跨突触高速传导', url: 'stages/609-neural-synapse-network.html' },
    { id: '610', name: '图灵斑图生长', desc: '实时Gray-Scott反应扩散方程有机珊瑚斑纹从每个汉字边缘蔓延生长', url: 'stages/610-reaction-diffusion-coral.html' },
    { id: '611', name: '磁力线铁粉', desc: '偶极/多极强磁场3D磁感线流光与十万铁粉颗粒随音乐极性翻转排列', url: 'stages/611-magnetic-field-iron-filings.html' },
    { id: '612', name: '纹影超声速', desc: '空气动力学纹影摄影(Schlieren Optics)可视化声波气浪与马赫锥冲击波', url: 'stages/612-schlieren-shockwave-optics.html' },
    { id: '613', name: '生命双螺旋', desc: '3D发光DNA双螺旋分子链高速解旋复制与碱基对音乐频谱律动', url: 'stages/613-dna-double-helix-evolution.html' },
    { id: '614', name: '非欧传送门', desc: '穿过悬浮3D画框直接看到并冲入完全不同色调与几何形态的平行空间', url: 'stages/614-non-euclidean-portal-rooms.html' },
    { id: '615', name: '量子电子云', desc: '氢原子薛定谔波函数球谐函数3D概率云（s/p/d/f轨道）跃迁与坍缩', url: 'stages/615-quantum-cloud-orbital.html' },
    { id: '616', name: '超流烟环碰撞', desc: '两团相向高速喷射的彩色流体涡环（Vortex Rings）在屏幕中心正面相撞绽放', url: 'stages/616-superfluid-vortex-smoke.html' },
    { id: '617', name: '水底教室', desc: '沉没在清澈深水中的青春教室课桌椅、丁达尔水波阳光与漂浮气泡', url: 'stages/617-underwater-classroom-sunbeam.html' },
    { id: '618', name: '末班地铁', desc: '深夜疾驰地铁车厢内景、窗外飞速掠过的隧道流光与车窗玻璃重影倒影', url: 'stages/618-midnight-subway-window-blur.html' },
    { id: '619', name: '星海巨鲸', desc: '3D半透明发光蓝鲸在璀璨星河云海上方优雅巡游与摆尾星尘风暴', url: 'stages/619-whale-starry-aurora-sky.html' },
    { id: '620', name: '花火摩天轮', desc: '夏日祭夜空3D发光摩天轮剪影与万千物理轨迹烟花在镜头前连环绽放', url: 'stages/620-ferris-wheel-fireworks-night.html' },
    { id: '621', name: '末日高架桥', desc: '废土斜阳下断裂的3D城市跨海高架桥、漫天蒲公英/辐射光尘与孤独剪影', url: 'stages/621-apocalyptic-sunset-overpass.html' },
    { id: '622', name: '街角唱片店', desc: '雨夜温暖的复古黑胶唱片店玻璃橱窗、旋转封面墙与街道霓虹倒影', url: 'stages/622-record-store-neon-window.html' },
    { id: '623', name: '幻彩蝶翼', desc: '3D千只发光琉璃蝴蝶风暴盘旋与微观蝶翼鳞片结构色折射', url: 'stages/623-kaleidoscope-stained-butterfly.html' },
    { id: '624', name: '耳机线星河', desc: '3D无限延伸的发光耳机线在深空中随音频波形跳动并缠绕成歌词轨迹', url: 'stages/624-cassette-walkman-earphone-cord.html' },
    { id: '625', name: '万灯升空', desc: '3D千盏孔明灯/天灯从暗夜水面冉冉升入星海与温暖烛光辉光', url: 'stages/625-paper-lantern-sky-festival.html' },
    { id: '626', name: '时光胶片螺旋', desc: '3D发光35mm电影胶片长带在虚空中盘旋成DNA双螺旋画廊并逐帧闪回', url: 'stages/626-infinite-film-strip-spiral.html' },
    { id: '627', name: '墨线暴走', desc: '红底白环剪纸，黑墨字每句换机位', url: 'stages/627-ink-line-rush.html' },
    { id: '628', name: '纸页快闪', desc: '一个词一页，整页纸跟着快切', url: 'stages/628-paper-flash.html' },
    { id: '629', name: '运动路径', desc: '黑字沿轨迹飞行，彩色线条乱穿', url: 'stages/629-motion-path.html' },
    { id: '630', name: '远近对焦', desc: '近处一句远处一句，对焦来回', url: 'stages/630-rack-focus.html' },
    { id: '631', name: '星轨跟拍', desc: '镜头追着歌词，星空真实视差', url: 'stages/631-stellar-tracking.html' },
    { id: '632', name: '方块蒙太奇', desc: '歌词由数千立方体拼成实体，换句炸成方块坠落，镜头硬切换机位、踩拍冻结帧', url: 'stages/632-block-montage.html' },
    { id: '633', name: 'S01A · 丝线刺绣', desc: '歌词逐字绣进深靛亚麻，鼓点绷紧布面，未唱到的字只留针孔草图', url: 'stages/633-s01a-silk-stitch.html' },
    { id: '634', name: 'S01B · 双色套印', desc: 'Risograph 双色印刷校样，铅字逐字压印，鼓点让套版错位、纸面起网点', url: 'stages/634-s01b-riso-proof.html' },
    { id: '635', name: 'S02A · 雾窗抹字', desc: '夜车窗结雾，歌词藏在玻璃后，随唱句被指尖一行行抹开、又慢慢凝回', url: 'stages/635-s02a-condensation-glass.html' },
    { id: '636', name: 'S02B · 地震纸带', desc: '三通道地震仪纸带，朱红笔尖逐字落墨，贝斯让纸面起伏、鼓点让笔尖惊跳', url: 'stages/636-s02b-seismic-paper-trace.html' },
    { id: '637', name: 'S03A · 鼓轮计数器', desc: '机械鼓轮计数器，每句是一次进位，字随演唱逐字落位，节拍让指针轻颤', url: 'stages/637-s03a-drum-register.html' },
    { id: '638', name: 'S03B · 等高线测绘', desc: '把封面测绘成深色等高线地形，每句歌词沿一条测线排布，鼓点推一圈环', url: 'stages/638-s03b-contour-survey.html' },
    { id: '639', name: 'S04A · 沉积岩芯', desc: '每句新词沉积成一层岩层，旧句被压实变暗下沉，鼓点是地层错动', url: 'stages/639-s04a-sedimentary-section.html' },
    { id: '640', name: 'S04B · 光弹应力', desc: '偏振光弹下的亚克力歌词板，刻字内应力显出彩虹条纹，鼓点打出应力环', url: 'stages/640-s04b-photoelastic.html' },
    { id: '641', name: 'S05A · 磁性画板', desc: '铁粉被笔尖吸成字，换行时红色梳齿刮板抹成灰痕，鼓点让板身震动', url: 'stages/641-s05a-magnadoodle.html' },
    { id: '642', name: 'S05B · 进近雷达', desc: '歌词是进近雷达上的航班，每句沿方位滑向中心落地显影，旧句沉入飞行条', url: 'stages/642-s05b-approach-radar-lyrics.html' },
    { id: '643', name: 'S06A · X光安检', desc: '每句歌词是一件过 X 光安检的行李，扫描束扫过线框才变成琥珀色实体字', url: 'stages/643-s06a-xray-baggage-scan.html' },
    { id: '644', name: 'S06B · 黑胶刻纹', desc: '极微距黑胶漆面，歌词被刻针逐字刻进纹槽，刻针走过的路径就是播放时间', url: 'stages/644-s06b-macro-lacquer-groove.html' },
    { id: '645', name: 'S07A · 主板维修', desc: '歌词丝印在被送修的主板上，镜头沿板面巡检，探针把字逐颗焊亮，每四句换机位', url: 'stages/645-s07a-mainboard-repair.html' },
    { id: '646', name: 'S07B · 后台飞塔', desc: '歌词是吊在钢杆上的布景片，镜头在吊杆与绳索之间穿行，追光轮流打亮', url: 'stages/646-s07b-fly-tower.html' },
    { id: '647', name: 'S08A · 皮影灯棚', desc: '歌词是被油灯投在绢幕上的影子，逐字挑杆入场，灯一晃字影就跟着荡', url: 'stages/647-s08a-shadow-play.html' },
    { id: '648', name: 'S08B · 水银镜厅', desc: '歌词被拉成穹顶上的竖向残影，只有脚下水银池能读回人形，鼓点是涟漪', url: 'stages/648-s08b-mercury-mirror-hall.html' },
    { id: '649', name: 'S09A · 砂型铸造', desc: '每句歌词是一道砂模沟槽，铁水按逐字时间涌进字形，新字白热、旧字冷却成暗红', url: 'stages/649-s09a-foundry-pour.html' },
    { id: '650', name: 'S09B · 红外热成像', desc: '零下旷野的红外热成像，歌词是逐词升温、又被寒风慢慢冷却的热源', url: 'stages/650-s09b-thermal-field.html' },
    { id: '651', name: 'S10A · 探空气球', desc: '探空气球穿过暮色云层，歌词写在随测风绳上升的绢带上，镜头一路跟拍爬升', url: 'stages/651-s10a-weather-balloon.html' },
    { id: '652', name: 'S10B · 暗房显影', desc: '歌词像银盐相纸在药水里不规则显影浮出，节拍让药水起涟漪、相纸轻晃', url: 'stages/652-s10b-darkroom-developing.html' },
    { id: '653', name: 'S11A · 计算尺', desc: '竹木计算尺横贯画面，游标发丝线就是播放头，歌词沿对数刻度一行行量出来', url: 'stages/653-s11a-slide-rule-lyric.html' },
    { id: '654', name: 'S11B · 日晷', desc: '日晷铜面上晷针影子就是播放头，歌词随日影扫过被逐字镀亮，只记录有阳光的时辰', url: 'stages/654-s11b-solar-gnomon.html' },
    { id: '655', name: 'S12A · 自动钢琴纸卷', desc: '歌词被凿成钢琴纸卷上的孔，走纸距离就是时间，读孔条把唱到的字逐个点亮', url: 'stages/655-s12a-player-piano-roll.html' },
    { id: '656', name: 'S12B · 无响室', desc: '无响室里声音被吸走，歌词是唯一没被吸收的光落在吸音楔上，鼓点顶起楔尖', url: 'stages/656-s12b-anechoic-chamber.html' },
    { id: '657', name: '壁纸接入实验', desc: '四层降级背景：WE 接口探测 / 屏幕捕获 / 本地视频图片 / 封面模糊，前景歌词三档暗化可读', url: 'stages/657-wallpaper-probe.html' },
    { id: '658', name: '壁纸融合', desc: '把 Wallpaper Engine 当前壁纸铺满整屏当背景，视频直接播放、场景图缓慢推拉，歌词按机位换位压在上面', url: 'stages/658-wallpaper-fusion.html' },
    { id: '659', name: '余烬潮汐', desc: '沙脊线上压着一轮巨型落日，三层沙丘视差叠出纵深；歌词逐字从沙中升起，落定瞬间燃起余烬', url: 'stages/659-wanderer.html' },
    { id: '660', name: '镜潮', desc: '盐原尽头悬着一枚暗环，半环沉入水面靠倒影补全；歌词从水下逐字立起，倒影在潮线之下随波轻晃', url: 'stages/660-mirage.html' },
    { id: '661', name: '流光帷幕', desc: '透明画布的流光形态：极光幕、21 条光丝与漂移光斑叠在壁纸之上，字按壁纸亮度自动在暖白与墨色间切换', url: 'stages/661-lumen-veil.html' },
    { id: '662', name: '光在页边', desc: '不对称的光边诗页：歌词在左侧阅读栏逐字从光里浮起，极光与光丝只活在右侧页边，光从字背后经过', url: 'stages/662-lumen-margin.html' },
    { id: '663', name: '弹簧诗行', desc: '每字一条独立弹簧，逐字错帧破土回弹，五组空间构图随句轮换，字缘微光与液态高光条贴在壁纸引擎背景上运行', url: 'stages/663-spring-verse.html' },
  ];

  /* ================= 形态版本 / 用户版保留清单（2026-11-08） =================
     来源：用户 2026-11-08 给的第一版「用户版」保留清单，共 68 个；
     数组顺序就是展示顺序（之后用户会再给「排名」，届时只改这个数组）。
     发行版（默认）只列这些；开发者版列全部，保留清单仍排在最前。
     切换：localStorage['lizi.stage.edition'] = 'dev' | 'release'，
       或地址栏 ?edition=dev / ?edition=release（有效值写回 localStorage 并优先），
       控制台也可 window.__liziSetEdition('dev' | 'release')。
     只过滤「列形态」的界面；StageHost / applyStage 仍按 id 加载，
     已保存但不在清单里的形态不会被弄坏。classic（传统播放器）任何版本都保留。 */
  const STAGE_RELEASE_ORDER = [
    /* 用户 2026-11-08 指定的前二排名：504、519 排在最前；这份是基准顺序，
       实际展示时由 stageDisplayOrder 把其余形态整体倒序（2026-11-09 新要求） */
    '504', '519',
    '001', '002', '008', '010', '012', '020', '027', '031', '048', '066', '067', '083', '099',
    '304', '305', '306', '339', '353', '359', '361', '366', '368', '370', '383', '396', '398',
    '406', '408', '413', '428', '429', '443',
    '505', '506', '508', '509', '510', '517', '518', '520', '521', '522', '524',
    '525', '540', '542', '552', '557', '559', '561', '563', '571', '572', '580', '582', '588',
    '590', '603', '604', '614', '617', '621', '627', '628', '629', '631',
  ];
  const STAGE_RELEASE_IDS = new Set(STAGE_RELEASE_ORDER);
  const STAGE_RELEASE_RANK = new Map(STAGE_RELEASE_ORDER.map((id, i) => [id, i]));
  const STAGE_ORIGINAL_RANK = new Map(STAGES.map((s, i) => [s.id, i]));
  const STAGE_EDITION_KEY = 'lizi.stage.edition';
  let stageEdition = 'release';
  try {
    const q = new URLSearchParams(location.search).get('edition');
    if (q === 'dev' || q === 'release') {
      stageEdition = q;
      localStorage.setItem(STAGE_EDITION_KEY, q);
    } else {
      const saved = localStorage.getItem(STAGE_EDITION_KEY);
      if (saved === 'dev' || saved === 'release') stageEdition = saved;
    }
  } catch { /* 隐私模式 / 无 location：用默认发行版 */ }
  const stageAllows = (id) => (stageEdition === 'dev' ? true : STAGE_RELEASE_IDS.has(id));
  const stageListed = (s) => !!s && (s.id === 'classic' || stageAllows(s.id));
  /** 保留清单全集 → 原 STAGES 下标；未进清单的排后面，开发者版才看得到 */
  const stageRankOf = (s) => {
    const r = STAGE_RELEASE_RANK.get(s.id);
    return r === undefined ? 10000 + (STAGE_ORIGINAL_RANK.get(s.id) || 0) : r;
  };
  /** 2026-11-09 用户要求：504、519 固定最前（504 在前），其余整体倒序（越新的越靠前）。
      只重排“展示列表”，不改 STAGES 本身 —— StageHost 默认下标和深链 find 都依赖原数组。
      classic 不是形态（传统播放器），原来就固定排第一，倒序时不能把它卷到末尾。 */
  function stageDisplayOrder(list) {
    const head = [];
    const classic = list.find((s) => s.id === 'classic');
    if (classic) head.push(classic);
    ['504', '519'].forEach((id) => {
      const s = list.find((x) => x.id === id);
      if (s) head.push(s);
    });
    const rest = list.filter((s) => s.id !== 'classic' && s.id !== '504' && s.id !== '519').reverse();
    return head.concat(rest);
  }
  /** includeClassic=true 时 classic 永远排第一；其余按保留清单顺序，再按原顺序 */
  function stageMenuList(includeClassic) {
    const list = STAGES.filter((s) => (s.url ? stageAllows(s.id) : (includeClassic && s.id === 'classic')));
    return stageDisplayOrder(list.sort((a, b) => {
      if (!a.url !== !b.url) return a.url ? 1 : -1;
      return stageRankOf(a) - stageRankOf(b);
    }));
  }
  function applyStageEditionDom() {
    try { document.body.dataset.stageEdition = stageEdition; } catch { /* 文档未就绪 */ }
  }
  applyStageEditionDom();
  window.__liziSetEdition = (v) => {
    if (v !== 'dev' && v !== 'release') {
      console.warn('[stage] edition 只支持 "dev" 或 "release"');
      return stageEdition;
    }
    stageEdition = v;
    try { localStorage.setItem(STAGE_EDITION_KEY, v); } catch { /* 隐私模式 */ }
    applyStageEditionDom();
    try { document.dispatchEvent(new CustomEvent('lizi:stage-edition', { detail: v })); } catch { /* 老环境 */ }
    return stageEdition;
  };

  /* 触屏宿主（安卓壳标记 / 粗指针）：没有 hover，形态页迷你播放器没法靠
     pointerenter 保持展开。TOUCH_HUD 为真时改由 wake() 默认带 is-near；
     桌面端恒为 false，下面所有触屏分支都不执行。 */
  const TOUCH_HUD = !!window.__liziAndroid
    || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  /* 触屏专用样式的开关：app.css 里所有手机播放条 / 歌词窗口的覆盖都挂在
     body.touch-ui 下，桌面端永远不会带这个类。 */
  if (TOUCH_HUD) {
    try { document.body.classList.add('touch-ui'); } catch { /* 文档未就绪 */ }
  }

  const StageHost = (() => {
    const frame = $('stage-frame');
    const hud = $('stage-hud');
    const stageView = $('view-stage');
    const tapLayer = $('stage-tap');
    /* 桌面鼠标 hover 时才保持浮层常驻；触屏的 :hover 会“粘住”，
       不区分的话手机上浮层永远等不到自动消失。 */
    const hoverCapable = typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover)').matches : true;
    // 默认是传统播放器；null 会让 openMenu 读 current.id 时炸掉
    let current = STAGES[0];
    let ready = false;
    let tickTimer = 0;
    let idleTimer = 0;
    let lastLive = 0;
    /* 相机 / 风景形态：形态在 ready payload 里声明 camera:true。
       这类形态的画面本身要拖动转头，宿主不再盖点击层，浮层也切成极简版
       （见 app.css 的 .is-cinema）。记在 Set 里，切回同一个形态时不用等
       ready 就能用对样式；老形态不发这个字段，一切照旧。 */
    let cameraStage = false;
    const cameraStageIds = new Set();
    const CINEMA_IDLE_MS = 2000;
    /* 桌面「看片模式」：指针静止后连窗口三键和光标一起退场。
       hudHeld = 真的按着浮层上的控件（拖进度条 / 长按按钮），只有这时
       才允许 armIdle 续命；单纯把鼠标停在浮层上不再无限续命。 */
    let hudHeld = false;
    let hudHeldTimer = 0;
    let stageCursorStyle = null;

    const post = (type, payload) => {
      if (!frame || !frame.contentWindow) return;
      try { frame.contentWindow.postMessage({ __c100: 1, type, payload }, '*'); } catch { /* 忽略 */ }
    };

    /* 「震动」总闸（宿主侧，一处管全部形态）：
       形态设置里的 shake 关掉后，beat 消息照发（index 不变，逐句推进不受影响），
       但 level 恒为 0。绝大多数形态的抖动/脉冲都是 beat.level 乘出来的，
       归零等于从根上停震，不用逐个形态去接线。
       值存在 lizi.stageSettings.<id>，面板一改就写盘；每拍读一次 localStorage，
       2~3 次/秒，开销可以忽略。 */
    function shakeOff() {
      try {
        if (!current || !current.id) return false;
        const raw = localStorage.getItem('lizi.stageSettings.' + current.id);
        if (!raw) return false;
        const d = JSON.parse(raw);
        return !!d && d.shake === false;
      } catch { return false; }
    }

    /** 歌词时间轴：LRC 只有起点，这里补上每句的时长（下一句起点 = 本句结束）。
     *  chars 是 YRC 的逐字时间（登录后才有）；没有就让舞台按句长自己均分。 */
    function lyricSchedule() {
      const ls = Player.state.lyric || [];
      return ls.map((l, i) => ({
        t: l.t,
        dur: l.dur || (ls[i + 1] ? Math.max(0.4, ls[i + 1].t - l.t) : 6),
        text: l.text,
        chars: l.chars ? l.chars.map((c) => ({ c: c.c, t: c.t })) : null,
      }));
    }

    /* init 去重。歌词到位、封面取色完成、切歌三处都会触发 pushInit，
       而每次 init 都会重置舞台（清粒子、active=-1）——
       于是字组好一次又被推倒重来，表现就是"组成完了还要再组一下"。
       用签名挡掉重复下发。 */
    let lastInitSig = '';

    function pushInit(force) {
      const tr = Player.state.queue[Player.state.index];
      const ls = Player.state.lyric || [];
      const sig = [
        tr ? tr.id : 0, ls.length,
        ls.length ? ls[0].t : 0,
        ls.length ? ls[ls.length - 1].t : 0,
        ls.length && ls[0].chars ? ls[0].chars.length : 0,
        accentRgb ? accentRgb.join(',') : '',
      ].join('|');
      if (!force && sig === lastInitSig) return;
      lastInitSig = sig;
      post('init', {
        song: tr ? { id: tr.id, name: tr.name, album: tr.album || '', artists: tr.artists, cover: tr.cover } : null,
        accent: accentRgb || [150, 165, 255],
        lines: lyricSchedule(),
        duration: Player.audio.duration || 0,
      });
    }

    function startTick() {
      stopTick();
      tickTimer = setInterval(() => {
        /* 歌声延迟（F5 面板，lyric-delay.js）：正数把歌词时间轴整体往后压 */
        post('tick', {
          time: (Player.audio.currentTime || 0) - (window.__lyricDelayMs || 0) / 1000,
          playing: !Player.audio.paused,
        });
      }, 66);
    }
    function stopTick() { if (tickTimer) clearInterval(tickTimer); tickTimer = 0; }

    /* 形态页「看片模式」：桌面端指针静止后，窗口三键和光标跟浮层一起退场。
       光标必须写进 iframe 自己的 document —— 指针落在 iframe 上时，
       宿主 body 的 cursor:none 管不到里面的内容。 */
    function setStageCursorHidden(hidden) {
      let doc = null;
      try { doc = frame && frame.contentDocument; } catch (_) { doc = null; }
      if (!doc) return;
      if (hidden) {
        if (stageCursorStyle && stageCursorStyle.ownerDocument === doc
          && stageCursorStyle.parentNode) return;
        stageCursorStyle = doc.createElement('style');
        stageCursorStyle.setAttribute('data-lizi-cursor', 'none');
        stageCursorStyle.textContent = 'html, body, * { cursor: none !important; }';
        (doc.head || doc.documentElement).appendChild(stageCursorStyle);
      } else if (stageCursorStyle) {
        try { stageCursorStyle.remove(); } catch (_) {}
        stageCursorStyle = null;
      }
    }
    /** on=true：进看片模式（只在非触屏 + 形态页里生效）。
        on=false：任何 pointermove / 点击 / 按键走 wake() 时恢复。 */
    function setChromeIdle(on) {
      /* 手机端不进入看片模式（没有光标、也没有三键），但 off 永远要能清干净 */
      if (on && TOUCH_HUD) return;
      const body = document.body;
      if (!body) return;
      if (on && !body.classList.contains('is-stage')) return;
      const was = body.classList.contains('is-chrome-idle');
      if (was === !!on) {
        if (on) setStageCursorHidden(true);   // 换文档后补一次
        return;
      }
      body.classList.toggle('is-chrome-idle', !!on);
      setStageCursorHidden(!!on);
    }

    /** 鼠标静止 2~2.6 秒后把浮层淡出（影院模式 2.0s，普通 2.6s），只留作品；
     *  桌面端连三键和光标一起收。只有真的按着浮层上的控件（hudHeld）才续命
     *  —— 指针只是停在那儿不该让浮层永远不消失（像看视频一样，动一下才回来）。 */
    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (hoverCapable && hudHeld) { armIdle(); return; }
        /* 面板 / 形态下拉还开着时先不收：它们挂在浮层里，收起来就没法继续操作。
           用 getElementById 而不是 $() —— $() 取不到元素会返回 truthy 的 Proxy。 */
        const panel = document.getElementById('stage-settings');
        const pop = document.getElementById('stage-menu-pop');
        if ((panel && panel.classList.contains('is-open')) || (pop && !pop.hidden)) {
          armIdle(); return;
        }
        /* 触屏：展开态跟着整条一起淡出，但不摘 is-near —— 下次 wake 时
           胶囊已经是展开的，不会每弹一次都从 0 宽重新长一遍。
           相机形态例外：收起时把迷你播放器也收回，下次只露一排图标。 */
        if (!TOUCH_HUD || cameraStage) hud.classList.remove('is-near');
        hud.classList.add('is-idle');
        /* 浮层已经看不见了：在 iframe 上盖一层点击层，手机点屏幕先弹浮层。
           相机形态不盖 —— 点击层会把拖动的第一下吃掉；唤出浮层改由
           iframe 内的 pointerdown/up 判定（见 hookStageTap）。 */
        if (stageView && !cameraStage) stageView.classList.add('is-hud-armed');
        /* 桌面：窗口三键和光标也一起退场；触屏函数内部直接 return */
        setChromeIdle(true);
      }, cameraStage ? CINEMA_IDLE_MS : 2600);
    }
    function wake() {
      /* 任何移动 / 点击 / 按键都会走到这里：先把三键和光标叫回来 */
      setChromeIdle(false);
      hud.classList.remove('is-idle');
      /* 触屏没有 hover：普通形态浮层一露脸，迷你播放器就保持展开。
         相机形态保持收起（只留封面），点封面才展开，避免大块胶囊挡风景。 */
      if (TOUCH_HUD && !cameraStage) hud.classList.add('is-near');
      /* 浮层一出来就撤掉点击层，形态恢复正常接收所有点击 */
      if (stageView) stageView.classList.remove('is-hud-armed');
      armIdle();
      /* 指针一动就顺带测一次底色：形态可能刚把背景换成白色，而 1200ms 的
         轮询还没到；probe 内部有 200ms 节流，不会因为 pointermove 变重。 */
      probeStageLight();
    }
    /* 点击层只在浮层隐藏时存在：这一下只叫醒浮层，不往形态里传 */
    if (tapLayer) {
      tapLayer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        wake();
      });
      /* 触屏上手指轻微滑动不该算“点击”，否则点击层会被 pointermove 提前叫醒、
         这一下又漏进形态里。桌面仍放行，保留原来的鼠标一动就浮出。 */
      tapLayer.addEventListener('pointermove', (e) => {
        if (!hoverCapable) e.stopPropagation();
      }, { passive: true });
    }

    /* 形态页双击（触屏就是双击）= 暂停 / 继续。
       形态是 iframe，事件不会冒泡到宿主，所以得挂在 iframe 自己的 document 上
       —— 同源（都从 127.0.0.1 的同一个服务出来），contentDocument 拿得到。
       点击层也要挂一份：浮层收起时它盖在形态上面，第一下只会叫醒浮层、
       第二下才落进形态，两边共用同一份计时才算得上"双击"。
       用 pointerup 而不是 dblclick：安卓 WebView 的双击不一定派发 dblclick，
       自己按 340ms + 48px 判定，鼠标和手指都能用。

       相机形态（ready 里声明 camera:true）多一份「点按 vs 拖动」判定：
       位移 < 28px 且按住 < 400ms 才算点按，点按才唤出浮层；拖动完全不碰
       浮层，镜头怎么转画面都不弹东西。
       28 是按 1280 固定视口算的：手机上整个 1280 布局被缩到屏幕宽，
       手指正常的抖动换算到 iframe 坐标里就有十几到二十几 px，
       用桌面鼠标的 8~12px 会把点按误判成拖动。 */
    let tapAt = 0;
    let tapX = 0;
    let tapY = 0;
    const CAM_TAP_PX = 28;
    const CAM_TAP_MS = 400;
    let camAt = 0;
    let camX = 0;
    let camY = 0;
    let camMoved = false;
    function onStageDown(e) {
      if (!cameraStage) return;
      if (!e || (typeof e.button === 'number' && e.button > 0)) return;
      camAt = performance.now();
      camX = e.clientX;
      camY = e.clientY;
      camMoved = false;
    }
    function onStageMove(e) {
      if (!cameraStage || !e) return;
      if (!camAt) {
        /* 没按键，只是鼠标移过画面：桌面端把浮层 / 三键 / 光标叫回来。
           相机形态没有点击层，iframe 里的 pointermove 不会冒泡到宿主。 */
        if (!TOUCH_HUD) wake();
        return;
      }
      if (!camMoved
        && (Math.abs(e.clientX - camX) > CAM_TAP_PX || Math.abs(e.clientY - camY) > CAM_TAP_PX)) {
        camMoved = true;
        /* 真的在转镜头：浮层立刻退场，别挡景（桌面三键 / 光标一起收） */
        clearTimeout(idleTimer);
        hud.classList.remove('is-near');
        hud.classList.add('is-idle');
        setChromeIdle(true);
      }
    }
    function onStageCancel() {
      camAt = 0;
      camMoved = false;
    }
    function onStageTap(e) {
      if (!e || (typeof e.button === 'number' && e.button > 0)) return;
      if (cameraStage) {
        const moved = camMoved
          || Math.abs(e.clientX - camX) > CAM_TAP_PX
          || Math.abs(e.clientY - camY) > CAM_TAP_PX;
        const held = camAt ? performance.now() - camAt : 0;
        camAt = 0;
        camMoved = false;
        /* 拖动 / 长按：不叫醒浮层，也不参与下面的双击计时 */
        if (moved || held > CAM_TAP_MS) { tapAt = 0; return; }
        wake();
      }
      const t = performance.now();
      const near = Math.abs(e.clientX - tapX) < 48 && Math.abs(e.clientY - tapY) < 48;
      if (tapAt && t - tapAt < 340 && near) {
        tapAt = 0;
        try { Player.toggle(); } catch (_) { /* 还没开始播放 */ }
        return;
      }
      tapAt = t;
      tapX = e.clientX;
      tapY = e.clientY;
    }
    if (tapLayer) tapLayer.addEventListener('pointerup', onStageTap, { passive: true });

    /* iframe 每次换文档（首次进入 / 换形态）都要重新挂：src 一清空就是新 document。
       load 事件 + 进入时各调一次，__liziDbl 标记防重复挂。
       pointerdown/move/cancel 只服务相机形态的点按判定，普通形态里直接 return。 */
    function hookStageTap() {
      let doc = null;
      try { doc = frame && frame.contentDocument; } catch (_) { doc = null; }
      if (!doc || doc.__liziDbl) return;
      doc.__liziDbl = true;
      doc.addEventListener('pointerdown', onStageDown, true);
      doc.addEventListener('pointermove', onStageMove, true);
      doc.addEventListener('pointerup', onStageTap, true);
      doc.addEventListener('pointercancel', onStageCancel, true);
      /* 换文档时如果宿主还在看片模式，把 cursor:none 补回新文档 */
      if (document.body.classList.contains('is-chrome-idle')) setStageCursorHidden(true);
    }
    if (frame) {
      frame.addEventListener('load', hookStageTap);
      hookStageTap();
    }
    /* 点浮层上的按钮也算“有操作”，把倒计时重新起算。
       hudHeld 让 armIdle 知道用户正按着控件（拖进度条 / 长按按钮），
       单纯把鼠标停在浮层上不再续命 —— 要像看视频一样静止就退场。 */
    function clearHudHeld() {
      hudHeld = false;
      clearTimeout(hudHeldTimer);
      hudHeldTimer = 0;
    }
    hud.addEventListener('pointerdown', () => {
      hudHeld = true;
      clearTimeout(hudHeldTimer);
      /* 兜底：pointerup 丢在窗口外时，8 秒后也要能重新开始 idle */
      hudHeldTimer = setTimeout(clearHudHeld, 8000);
      wake();
    }, { passive: true });
    addEventListener('pointerup', clearHudHeld, { passive: true });
    addEventListener('pointercancel', clearHudHeld, { passive: true });
    addEventListener('blur', clearHudHeld);

    /* 相机形态（触屏）默认只露封面；点一下封面才展开迷你播放器。
       这里只负责「展开」：有的 WebView 在触摸时会先派发 stageRight 的
       pointerenter 把 is-near 加上，再用 toggle 反而会把它关掉。
       收起交给 2 秒的 idle（armIdle 会摘 is-near）。
       播放键 / 进度条上的点击不触发展开，只正常操作播放。 */
    const stageSongEl = document.getElementById('stage-song');
    if (stageSongEl) {
      stageSongEl.addEventListener('click', (e) => {
        if (!cameraStage || !TOUCH_HUD) return;
        if (e.target && e.target.closest && e.target.closest('.snow__body')) return;
        hud.classList.add('is-near');
        wake();
      });
    }

    /* ---------- 形态页操作条自动反色（2026-11-08） ----------
       白底作品上，操作条那套浅色玻璃 / 白字几乎看不见，需要换成黑字 / 黑进度。
       为什么不采样 WebGL 像素：舞台背景基本都是 canvas，多数作品用
       preserveDrawingBuffer:false，getImageData / readPixels 拿到的是空帧；
       真要逐帧读 GPU 还会拖慢作品本身。iframe 是同源的，所以退一步读 DOM：
       在操作条所在的横带（y≈44px，x = 25% / 50% / 75%）用 elementsFromPoint
       取最上面的元素，沿祖先链找第一个不透明背景色（或渐变里的颜色），
       按 sRGB 线性化算相对亮度；三点平均 > .62 就判为浅色底。
       注意这是近似：canvas 里画了什么读不到，会回落到 canvas 祖先 / body 的
       CSS 背景色；拿不到 iframe 文档（跨域 / 还没加载）时按深色处理（不加类）。 */
    const SRGB_LIN = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const relLum = (r, g, b) => 0.2126 * SRGB_LIN(r) + 0.7152 * SRGB_LIN(g) + 0.0722 * SRGB_LIN(b);
    /** 从 computedStyle 的背景值里抠颜色：只认 rgb()/rgba()/#hex
        （Chromium 会把渐变 stop 的 computed 值序列化成 rgb()）。
        透明度太低的不算「不透明背景」，交给祖先继续找。 */
    function cssColors(str) {
      const out = [];
      if (!str || str === 'none') return out;
      const re = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)|#([0-9a-f]{3,8})\b/gi;
      let m;
      while ((m = re.exec(str))) {
        if (m[5]) {
          let h = m[5];
          if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
          if (h.length !== 6 && h.length !== 8) continue;
          const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
          if (a < 0.5) continue;
          out.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
        } else {
          const a = m[4] == null ? 1
            : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
          if (!(a >= 0.5)) continue;
          out.push([+m[1], +m[2], +m[3]]);
        }
      }
      return out;
    }
    /** 某点背后的近似底色：最上面的元素 → 背景图/背景色 → 祖先 → body */
    function backdropColorsAt(doc, x, y) {
      let els = [];
      try { els = doc.elementsFromPoint(x, y) || []; } catch { /* 文档正在换 */ }
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el || el.nodeType !== 1 || el === doc.documentElement) continue;
        let cs = null;
        try { cs = doc.defaultView.getComputedStyle(el); } catch { /* 忽略 */ }
        if (!cs) continue;
        const grad = cssColors(cs.backgroundImage);
        if (grad.length) return grad;
        const bg = cssColors(cs.backgroundColor);
        if (bg.length) return bg;
        /* canvas 自己没写 CSS 背景 → 继续往父级找（像素内容读不到） */
        if (el.tagName === 'CANVAS') continue;
      }
      try {
        const body = doc.body;
        if (body) {
          const cs = doc.defaultView.getComputedStyle(body);
          const grad = cssColors(cs.backgroundImage);
          if (grad.length) return grad;
          const bg = cssColors(cs.backgroundColor);
          if (bg.length) return bg;
        }
      } catch { /* 忽略 */ }
      return [];
    }
    let lightTimer = 0;
    let lightLast = 0;
    /** 父页坐标 → iframe 内坐标。iframe 可能不铺满，也可能被 --stage-scale 缩放，
        必须按 iframe 的视口宽高 / 实际矩形宽高换算，不能直接拿 clientX 当采样点。 */
    function framePoint(x, y, W, H) {
      let fr = null;
      try { fr = frame.getBoundingClientRect(); } catch { /* 忽略 */ }
      if (!fr || !fr.width || !fr.height) return null;
      return [
        Math.round((x - fr.left) * (W / fr.width)),
        Math.round((y - fr.top) * (H / fr.height)),
      ];
    }
    /** HUD 实际覆盖的区域（父页坐标）：歌曲胶囊优先，取不到再用右侧那一簇 */
    function hudSampleRect() {
      for (const id of ['stage-song', 'stage-right']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return r;
      }
      return null;
    }
    function probeStageLight() {
      if (!hud || !hud.classList) return;
      /* 只在形态视图里判断：别的视图里条是隐藏的，测了也没意义 */
      if (!document.body || document.body.dataset.view !== 'stage') {
        hud.classList.remove('is-on-light');
        return;
      }
      /* pointermove 会频繁走到 wake()：200ms 内只真的采样一次 */
      const now = performance.now();
      if (now - lightLast < 200) return;
      lightLast = now;
      let doc = null, win = null;
      try { doc = frame.contentDocument; win = frame.contentWindow; } catch { /* 跨域 */ }
      if (!doc || !doc.body || !win) { hud.classList.remove('is-on-light'); return; }
      let W = 0, H = 0;
      try {
        W = win.innerWidth || doc.documentElement.clientWidth || 0;
        H = win.innerHeight || doc.documentElement.clientHeight || 0;
      } catch { /* 忽略 */ }
      if (!W || !H) { hud.classList.remove('is-on-light'); return; }

      /* 只采 HUD 自己盖住的那块：胶囊矩形内横向 10/25/50/75/90%，纵向取中心。
         胶囊收起时只有 64px 宽，展开后覆盖到迷你播放器，采样范围会跟着变 ——
         不再全页取三点平均，避免右侧高亮被两侧深色背景稀释。 */
      const rect = hudSampleRect();
      if (rect) {
        let sum = 0, n = 0;
        const y = rect.top + rect.height / 2;
        [0.10, 0.25, 0.50, 0.75, 0.90].forEach((p) => {
          const pt = framePoint(rect.left + rect.width * p, y, W, H);
          if (!pt) return;
          const x = Math.min(W - 1, Math.max(0, pt[0]));
          const yy = Math.min(H - 1, Math.max(0, pt[1]));
          const cols = backdropColorsAt(doc, x, yy);
          if (!cols.length) return;
          let r = 0, g = 0, b = 0;
          cols.forEach((c) => { r += c[0]; g += c[1]; b += c[2]; });
          const m = cols.length;
          sum += relLum(r / m, g / m, b / m);
          n++;
        });
        if (n > 0) {
          hud.classList.toggle('is-on-light', sum / n > 0.60);
          return;
        }
      }

      /* 兜底：HUD 矩形取不到 / 五个点全部落空时，仍按旧的全页三点采样 */
      const y = 44;               // 操作条垂直居中的那一带（padding 16 + 按钮 ~56/2）
      let sum = 0, n = 0;
      [0.25, 0.5, 0.75].forEach((p) => {
        const cols = backdropColorsAt(doc, Math.round(W * p), y);
        if (!cols.length) return;
        let r = 0, g = 0, b = 0;
        cols.forEach((c) => { r += c[0]; g += c[1]; b += c[2]; });
        const m = cols.length;
        sum += relLum(r / m, g / m, b / m);
        n++;
      });
      hud.classList.toggle('is-on-light', n > 0 && sum / n > 0.62);
    }
    function startLightWatch() {
      if (!lightTimer) lightTimer = setInterval(probeStageLight, 1200);
    }
    function stopLightWatch() {
      if (lightTimer) clearInterval(lightTimer);
      lightTimer = 0;
      lightLast = 0;
    }
    /* 指针压到操作条上时立刻重测（有些作品在指针靠近时才换背景） */
    if (hud && hud.addEventListener) hud.addEventListener('pointerenter', () => probeStageLight());

    return {
      get current() { return current; },
      list: STAGES,

      load(id) {
        const s = STAGES.find((x) => x.id === id) || STAGES[1];
        current = s;
        ready = false;
        /* 换形态：先按静态提示 / 上次 ready 的声明切样式（普通形态两者都没有）。
           新文档的 ready 到了会再确认一次。 */
        cameraStage = !!(s.camera || cameraStageIds.has(s.id));
        if (stageView) stageView.classList.toggle('is-cinema', cameraStage);
        /* 从普通形态切过来时 is-near 可能还挂着：相机形态先收回迷你播放器 */
        if (cameraStage) hud.classList.remove('is-near');
        // 换形态时整块重载：同一时刻只能有一个作品在跑
        if (s.url) frame.src = s.url;
        else frame.removeAttribute('src');
        /* 新文档 = 旧的反色结论立刻作废；ready 事件 / 下面的补测会重新判断 */
        if (hud && hud.classList) hud.classList.remove('is-on-light');
        if (document.body.dataset.view === 'stage') {
          setTimeout(probeStageLight, 300);
          setTimeout(probeStageLight, 900);
        }
        return s;
      },

      /** 进入形态视图 */
      enter() {
        if (!current || !current.url) current = STAGES[1];
        /* 离开再进来时 leave() 已经把 cameraStage 清掉了，这里按静态提示 /
           上次的声明恢复，避免重新进 552 时又先弹一下展开的迷你播放器。 */
        cameraStage = !!(current.camera || cameraStageIds.has(current.id));
        if (stageView) stageView.classList.toggle('is-cinema', cameraStage);
        if (cameraStage) hud.classList.remove('is-near');
        /* 换/重装 iframe 就是新文档：ready 要重新等，否则新文档永远收不到 init */
        if (!frame.getAttribute('src')) { ready = false; frame.src = current.url; }
        startTick();
        wake();
        /* 形态背景可能晚于第一帧才画出来：进入后补测一次，之后每 1200ms 轮询 */
        startLightWatch();
        setTimeout(probeStageLight, 300);
        // 形态占满屏幕，播放器那一层要收起来
        document.body.classList.add('is-stage');
      },
      leave() {
        stopTick();
        clearTimeout(idleTimer);
        clearHudHeld();
        /* 非形态页不隐藏三键 / 光标：离开时立刻恢复（含 iframe 里的 cursor） */
        setChromeIdle(false);
        hud.classList.remove('is-near');
        /* 离开时把点击层也撤掉，避免下次进来带着上一次的隐藏态 */
        if (stageView) stageView.classList.remove('is-hud-armed');
        /* 影院模式同理；Set 里记着的形态 id 留着，下次进来不用等 ready */
        cameraStage = false;
        if (stageView) stageView.classList.remove('is-cinema');
        /* 离开形态：反色轮询停掉，类也摘掉（下次进来按新背景重新判断） */
        stopLightWatch();
        hud.classList.remove('is-on-light');
        /* 离开形态时把 iframe 卸掉：隐藏的形态照样在跑 rAF，白烧 CPU。
           src 清空后下次 enter 会按 current 重新装回来。 */
        if (frame.getAttribute('src')) frame.removeAttribute('src');
        document.body.classList.remove('is-stage');
      },

      /** 换歌 / 歌词到位后重新下发时间轴 */
      refresh() {
        if (!tickTimer) return;
        if (!ready) return;             // 还没 ready，等 ready 回调再发
        pushInit();
      },

      onReady(payload) {
        /* 形态可以在 ready 里声明 camera:true：画面本身要拖动转头。
           宿主对这类形态不盖点击层，浮层切成极简版（见 app.css .is-cinema），
           触屏上只认「点按」唤出。老形态不发这个字段，行为一字不变。
           只有 payload 里真的带了布尔 camera 才改状态 —— 有的形态会在 init
           之后补发一次不带 payload 的 ready，不能把相机模式冲掉。 */
        if (payload && typeof payload.camera === 'boolean') {
          cameraStage = payload.camera;
          if (current && current.id) {
            if (cameraStage) cameraStageIds.add(current.id);
            else cameraStageIds.delete(current.id);
          }
          if (stageView) {
            stageView.classList.toggle('is-cinema', cameraStage);
            if (cameraStage) stageView.classList.remove('is-hud-armed');
          }
          if (cameraStage) {
            /* enter() 的 wake() 已经按普通形态展开过迷你播放器，这里收回；
               idle 计时器也换成影院节奏（2s）。 */
            if (TOUCH_HUD) hud.classList.remove('is-near');
            armIdle();
          }
        }
        /* 只认第一次 ready：有的舞台每次收到 init 都回一次 ready，
           这里再 pushInit(true) 就会 ping-pong —— 一秒几千次 init，
           而且每次都 startTick() 把 66ms 定时器重置掉，tick 一次都发不出去。
           症状就是「形态里的歌词永远停在第一句」。 */
        if (ready) return;
        ready = true;
        pushInit(true);
        startTick();
        /* 通知外面：新形态已经画上第一帧了（圆形蒙版就等这一下才撤） */
        try { dispatchEvent(new Event('stage:ready')); } catch (_) {}
      },
      onBeat(b) { post('beat', { index: b.index, level: shakeOff() ? 0 : b.level }); },
      onLive(st) {
        const t = performance.now();
        if (t - lastLive < 120) return;  // 约 8Hz，省点消息开销
        lastLive = t;
        post('live', { bpm: st.bpm, level: st.level, bass: st.bass, mid: st.mid, treble: st.treble, playing: st.playing });
      },
      /* 迷你播放器（只在形态页有 DOM 更新，切页后它照样安全） */
      onPlaying(playing) {
        const b = $('stage-play');
        if (b) setIcon(b, playing ? ICONS.pause : ICONS.play);
      },
      onTime({ cur, total }) {
        $('stage-t').textContent = fmtTime(cur);
        $('stage-d').textContent = fmtTime(total);
        if (total > 0) $('stage-fill').style.width = (cur / total * 100) + '%';
      },
      wake,
      /** 形态内部转发的鼠标活动（mousemove / pointerdown）。
          相机形态在触屏上只认「点按」：拖动时形态会一直发 activity，
          不能让它把浮层叫出来。桌面端保留原来的「一动就浮出」。 */
      onActivity() {
        if (cameraStage && TOUCH_HUD) return;
        wake();
      },
      /* 给 stage:ready / 换形态补测用 */
      probeLight: probeStageLight,
    };
  })();

  /* ======================= 形态设置面板 =======================
     只服务「用户可见的形态设置」，和 F5 那个开发者调参面板是两回事。

     形态侧只需要在脚本里声明一次：
       window.__stagePanel = {
         title: '粒子歌词',                        // 可选，默认用形态名
         items: [
           { key:'density', label:'粒子密度', type:'range', min:0.2, max:2, step:0.1, def:1 },
           { key:'showSub', label:'显示副歌', type:'switch', def:true },
           { key:'mode',    label:'排布',     type:'select', def:'arc',
             options:[{v:'arc',t:'弧形'},{v:'line',t:'直线'}] },
           { key:'size',    label:'字号',     type:'segment', def:'m',
             options:[{v:'s',t:'小'},{v:'m',t:'中'},{v:'l',t:'大'}] }
         ]
       };

     宿主负责：玻璃按钮的显隐、面板渲染、localStorage 持久化（按形态编号）、
     变化时 postMessage({__c100:1, type:'setting', payload:{key, value}}) 给形态。
     ============================================================ */
  const StagePanel = (() => {
    /* ⚠️ 必须用 document.getElementById 而不是 $()：
       $() 拿不到元素时会返回一个 Proxy 假元素（所有属性都是函数），
       永远 truthy —— 用它做 null 判断会全部失效，表面上"有元素"实际什么都没绑上。 */
    const btn = document.getElementById('stage-settings-btn');
    const box = document.getElementById('stage-settings');
    const bodyEl = document.getElementById('spnl-body');
    const titleEl = document.getElementById('spnl-title');
    const resetBtn = document.getElementById('spnl-reset');
    const closeBtn = document.getElementById('spnl-close');
    /* 拿不到元素就退化成一个空壳，但接口一个都不能少 ——
       少一个 toggle 会让外面的点击处理器抛 TypeError，而且很难看出是这里的问题 */
    if (!btn || !box || !bodyEl) {
      console.warn('[panel] 元素缺失，设置面板不可用');
      const noop = () => {};
      return { sync: noop, close: noop, toggle: noop, reset: noop, pushAll: noop, isOpen: false };
    }
    const body = bodyEl;

    let spec = null;          // 当前形态的声明
    let stageId = '';         // 当前形态编号（localStorage 的 key 用它）
    let open = false;
    let data = {};            // 当前生效的值（applyDefaults 会整个换掉它，必须是 let）

    const storeKey = (id) => 'lizi.stageSettings.' + id;

    function load(id) {
      try {
        const raw = localStorage.getItem(storeKey(id));
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    }
    function save() {
      try { localStorage.setItem(storeKey(stageId), JSON.stringify(data)); } catch { /* 忽略 */ }
    }

    /** 通知形态：某个设置变了 */
    function push(key, value) {
      const f = $('stage-frame');
      if (!f || !f.contentWindow) return;
      try {
        f.contentWindow.postMessage({ __c100: 1, type: 'setting', payload: { key, value } }, '*');
      } catch { /* 忽略 */ }
    }
    /** 把当前全部设置推一遍（形态 ready 时调用） */
    function pushAll() {
      Object.keys(data).forEach((k) => push(k, data[k]));
    }

    function fmtNum(v, step) {
      const dec = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
      return Number(v).toFixed(dec);
    }

    /* ---------- 渲染 ---------- */
    function render() {
      body.innerHTML = '';
      const items = (spec && Array.isArray(spec.items)) ? spec.items : [];
      titleEl.textContent = (spec && spec.title) || (StageHost.current && StageHost.current.name) || '设置';

      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'spnl__row';

        const lab = document.createElement('div');
        lab.className = 'spnl__lab';
        const name = document.createElement('span');
        name.textContent = it.label || it.key;
        lab.appendChild(name);

        const cur = data[it.key];

        if (it.type === 'range') {
          const valEl = document.createElement('span');
          valEl.className = 'spnl__val';
          valEl.textContent = fmtNum(cur, it.step || 0.01);
          lab.appendChild(valEl);

          const inp = document.createElement('input');
          inp.type = 'range';
          inp.className = 'spnl__range';
          inp.min = it.min; inp.max = it.max; inp.step = it.step || 0.01;
          inp.value = cur;
          inp.addEventListener('input', () => {
            data[it.key] = parseFloat(inp.value);
            valEl.textContent = fmtNum(data[it.key], it.step || 0.01);
            push(it.key, data[it.key]);
            save();
          });
          row.appendChild(lab);
          row.appendChild(inp);

        } else if (it.type === 'switch') {
          const sw = document.createElement('button');
          sw.type = 'button';
          sw.className = 'spnl__sw';
          sw.setAttribute('role', 'switch');
          sw.setAttribute('aria-checked', String(!!cur));
          sw.addEventListener('click', () => {
            data[it.key] = !data[it.key];
            sw.setAttribute('aria-checked', String(data[it.key]));
            push(it.key, data[it.key]);
            save();
          });
          row.appendChild(lab);
          row.appendChild(sw);

        } else if (it.type === 'select') {
          const sel = document.createElement('select');
          sel.className = 'spnl__sel';
          (it.options || []).forEach((o) => {
            const op = document.createElement('option');
            op.value = o.v; op.textContent = o.t;
            if (o.v === cur) op.selected = true;
            sel.appendChild(op);
          });
          sel.addEventListener('change', () => {
            data[it.key] = sel.value;
            push(it.key, data[it.key]);
            save();
          });
          row.appendChild(lab);
          row.appendChild(sel);

        } else if (it.type === 'segment') {
          const seg = document.createElement('div');
          seg.className = 'spnl__seg';
          (it.options || []).forEach((o) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = o.t;
            b.classList.toggle('is-on', o.v === cur);
            b.addEventListener('click', () => {
              data[it.key] = o.v;
              [...seg.children].forEach((c) => c.classList.toggle('is-on', c === b));
              push(it.key, data[it.key]);
              save();
            });
            seg.appendChild(b);
          });
          row.appendChild(lab);
          row.appendChild(seg);

        } else if (it.type === 'gallery') {
          /* 图集选择：形态侧异步拿到的缩略图列表（壁纸背景）直接铺成两列网格。
             每张卡就是按钮，选中态只用 is-on，和 segment 一致；值原样走 setting。 */
          const gal = document.createElement('div');
          gal.className = 'spnl__gal';
          (it.items || []).forEach((o) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'spnl__galcard';
            card.classList.toggle('is-on', o.v === cur);
            const im = document.createElement('img');
            im.loading = 'lazy';
            im.decoding = 'async';
            im.alt = '';
            if (o.thumb) im.src = o.thumb;
            const cap = document.createElement('span');
            cap.textContent = o.t || o.v;
            card.appendChild(im);
            card.appendChild(cap);
            card.addEventListener('click', () => {
              data[it.key] = o.v;
              [...gal.children].forEach((c) => c.classList.toggle('is-on', c === card));
              push(it.key, data[it.key]);
              save();
            });
            gal.appendChild(card);
          });
          row.appendChild(lab);
          row.appendChild(gal);

        } else {
          return;   // 不认识的类型直接跳过，不污染界面
        }

        body.appendChild(row);
      });

      if (spec && spec.hint) {
        const hint = document.createElement('div');
        hint.className = 'spnl__hint';
        hint.textContent = spec.hint;
        body.appendChild(hint);
      }
    }

    function applyDefaults() {
      data = {};
      ((spec && spec.items) || []).forEach((it) => {
        if (it && it.key) data[it.key] = it.def;
      });
    }

    /* ---------- 开合 ---------- */
    function setOpen(v) {
      open = !!v;
      if (open) {
        /* 面板是 HUD 的子元素：HUD 处于 is-idle 时整条 opacity:0，面板会跟着透明。
           打开面板说明用户在交互，把 HUD 唤醒（顺带刷新 idle 计时器）。 */
        const hud = document.getElementById('stage-hud');
        if (hud) { hud.classList.remove('is-idle'); hud.classList.add('is-near'); }
        try { StageHost.wake(); } catch { /* 忽略 */ }

        box.hidden = false;
        void box.offsetWidth;      // 强制一次布局，让 transition 有起点
        box.classList.add('is-open');
      } else {
        box.classList.remove('is-open');
        clearTimeout(box._hideT);
        box._hideT = setTimeout(() => { if (!open) box.hidden = true; }, 220);
      }
      btn.setAttribute('aria-expanded', String(open));
    }

    /* ---------- 对外 ---------- */
    /* 宿主兜底项：形态没声明震动开关时补上，形态侧负责响应 setting。
       已经声明 key==='shake' 的形态原样用自己的（label / def 都不覆盖）。 */
    const SHAKE_ITEM = { key: 'shake', label: '震动', type: 'switch', def: true };
    function normalizeSpec(sp) {
      const base = sp
        ? { title: sp.title || '', hint: sp.hint || '', items: sp.items }
        : { title: '', hint: '', items: [] };
      if (!base.items.some((it) => it && it.key === 'shake')) {
        base.items = base.items.concat([Object.assign({}, SHAKE_ITEM)]);
      }
      return base;
    }

    /** 同源 iframe，可以直接读它的 window。读不到返回 null（按钮照旧隐藏）；
        形态没声明 / 声明里缺震动项时返回补好兜底项的声明。 */
    function readSpec() {
      const f = $('stage-frame');
      if (!f || !f.contentWindow) return null;
      let sp = null;
      try { sp = f.contentWindow.__stagePanel; } catch { return null; }
      if (sp && Array.isArray(sp.items) && sp.items.length) {
        try {
          // 深拷贝一次，避免读到形态后来改动的对象
          return normalizeSpec(JSON.parse(JSON.stringify({
            title: sp.title || '',
            hint: sp.hint || '',
            items: sp.items,
          })));
        } catch { return null; }
      }
      return normalizeSpec(null);
    }

    /** 打开面板前重读一次形态声明：壁纸列表是异步 push 进去的，
       只在 ready 时读一次会让后出现的 gallery 项永远看不到。 */
    function refreshSpec() {
      const spec2 = readSpec();
      if (!spec2) return;
      if (JSON.stringify(spec2.items) === JSON.stringify(spec && spec.items)) return;
      const keep = Object.assign({}, data);   // 先快照当前生效值
      spec = spec2;
      applyDefaults();                        // 以新声明为准，新加的 key 拿 def
      Object.keys(keep).forEach((k) => { if (k in data) data[k] = keep[k]; });
      render();
    }

    return {
      /** 形态 ready 时调用：读它的 __stagePanel；没声明 / 缺震动项时
          宿主补一项 shake，然后照常渲染并 pushAll 给形态 */
      sync() {
        const cur = StageHost.current;
        stageId = cur ? cur.id : '';
        const spec2 = readSpec();

        if (!spec2) {
          spec = null;
          btn.hidden = true;
          setOpen(false);
          return;
        }

        spec = spec2;
        /* 先按声明铺默认值（含宿主补的 shake:true），再把 localStorage 里
           存过的值盖回去：补默认项不会冲掉用户之前存的值。 */
        const saved = load(stageId);
        const keep = Object.assign({}, saved);   // 和 refreshSpec 用同一套回填规则
        applyDefaults();
        Object.keys(keep).forEach((k) => { if (k in data) data[k] = keep[k]; });
        render();
        btn.hidden = false;
        setOpen(false);
        // 把恢复的值推给形态（它可能刚启动，需要拿到用户上次的设置）
        setTimeout(pushAll, 60);
      },
      close() { setOpen(false); },
      toggle() {
        /* 打开前重读一次声明：形态的壁纸列表是异步声明的，ready 之后才出现。
           只在打开时读，不在 render/push 里读，避免自激。 */
        if (!btn.hidden && !open) refreshSpec();
        if (!btn.hidden) setOpen(!open);
      },
      reset() {
        applyDefaults();
        render();
        save();
        pushAll();
      },
      pushAll,
      get isOpen() { return open; },
    };
  })();

  /* 按钮与面板交互（同样用 getElementById，理由见 StagePanel 顶部注释） */
  {
    const btn = document.getElementById('stage-settings-btn');
    const box = document.getElementById('stage-settings');
    const xBtn = document.getElementById('spnl-close');
    const rst = document.getElementById('spnl-reset');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); StagePanel.toggle(); });
    if (xBtn) xBtn.addEventListener('click', () => StagePanel.close());
    if (rst) rst.addEventListener('click', () => StagePanel.reset());
    document.addEventListener('click', (e) => {
      if (!StagePanel.isOpen) return;
      if (e.target.closest('#stage-settings') || e.target.closest('#stage-settings-btn')) return;
      StagePanel.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && StagePanel.isOpen) { e.preventDefault(); StagePanel.close(); }
    });
    /* 形态 ready 时问它有没有设置声明。
       挂在 stage:ready 事件上，而不是改 StageHost.onReady —— 那个函数在本次 def 之前，
       直接引用会撞 TDZ。事件是现成的钩子，各改各的。
       切形态必然重发 ready，所以这里同时起到"关掉上一个形态的面板"的作用。 */
    addEventListener('stage:ready', () => {
      try { StagePanel.sync(); } catch (err) { console.warn('[panel] sync failed', err); }
      /* 新形态画上第一帧：这时候 DOM 背景才是最终的，重新判断操作条反色 */
      try { StageHost.probeLight(); } catch { /* 忽略 */ }
    });
  }

  // 作品回话
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__c100 !== 1) return;
    /* 形态画廊里的预览 iframe 也遵循同一套协议、也会发 ready。
       它们不是真正的舞台：只认 #stage-frame 这个源，否则一个格子的 ready
       会把 StageHost 标记成就绪、抢走本该发给舞台的 init/tick。 */
    const stageFrame = $('stage-frame');
    if (!stageFrame || e.source !== stageFrame.contentWindow) return;
    if (d.type === 'ready') StageHost.onReady(d.payload || null);
    // 作品内部的鼠标活动也要转发过来。
    // pointermove 挂在父文档上，但鼠标移到 iframe 上时事件不会冒泡到父文档 ——
    // 细条淡出之后就再也唤不醒，人就卡在舞台里出不来了（这是之前最要命的 bug）。
    // 相机形态在触屏上例外：拖动镜头会一直发 activity，不能让它叫醒浮层。
    else if (d.type === 'activity') StageHost.onActivity();
    // 舞台里按的空格（焦点在 iframe 内，父页面收不到，只能由舞台转发过来）
    // 按键也算「有操作」：先 wake() 把浮层 / 三键 / 光标叫回来，再执行动作。
    else if (d.type === 'key' && d.payload && d.payload.key === 'Space') {
      StageHost.wake();
      Player.toggle();
    }
    else if (d.type === 'error') console.warn('[stage] 作品报错：', d.payload);
  });

  /* 这个形态是不是从「形态长廊」面点进来的（applyStage 的第二个参数写）。
     人站在大厅里挑形态，看完返回不该被丢回经典播放页 —— 原路回大厅那张海报。 */
  let stageFromHall = false;

  // 舞台操作条：返回
  $('stage-back').addEventListener('click', () => {
    if (stageFromHall) { stageFromHall = false; show('hall'); return; }
    show('now');
  });

  /* ---- 形态下拉（「形态」按钮）----
     以前点它跳整屏画廊，现在就地展开一个两列的列表，点哪个当场换（圆形蒙版转场） */
  {
    const pop = $('stage-menu-pop');
    const list = $('stage-menu-pop-list');
    const btn = $('stage-pick-btn');
    let popOpen = false;

    function paintStageMenuPop() {
      list.innerHTML = stageMenuList(true).map((s) => `
        <button class="smenu__i" data-id="${s.id}" role="option" aria-selected="false">
          ${stageEdition === 'dev' ? `<span class="smenu__id">${s.id === 'classic' ? '—' : s.id}</span>` : ''}
          <span class="smenu__name">${s.name}</span>
        </button>`).join('');
    }
    paintStageMenuPop();
    document.addEventListener('lizi:stage-edition', () => {
      paintStageMenuPop();
      if (popOpen) markMenu();
    });

    function markMenu() {
      const curId = StageHost.current ? StageHost.current.id : 'classic';
      list.querySelectorAll('.smenu__i').forEach((b) => {
        const on = b.dataset.id === curId;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      const cur = list.querySelector('.smenu__i.is-on');
      if (cur) cur.scrollIntoView({ block: 'center' });
    }
    function setPop(open) {
      if (open === popOpen) return;
      popOpen = open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) {
        markMenu();
        pop.hidden = false;
        requestAnimationFrame(() => pop.classList.add('is-open'));
      } else {
        pop.classList.remove('is-open');
        setTimeout(() => { if (!popOpen) pop.hidden = true; }, 220);
      }
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); setPop(!popOpen); });
    list.addEventListener('click', (e) => {
      const it = e.target.closest('.smenu__i');
      if (!it) return;
      const id = it.dataset.id;
      setPop(false);
      irisSwitch(it, () => applyStage(id));
    });
    document.addEventListener('click', (e) => {
      if (!popOpen) return;
      if (e.target.closest('#stage-menu-pop') || e.target.closest('#stage-pick-btn')) return;
      setPop(false);
    });
    document.addEventListener('keydown', (e) => {
      if (popOpen && e.key === 'Escape') { e.preventDefault(); setPop(false); }
    });
  }

  /* ---- 迷你播放器：切歌 + 拖时间轴（和播放页共用一份 Player 状态） ---- */
  $('stage-play').addEventListener('click', () => Player.toggle());
  $('stage-prev').addEventListener('click', () => Player.prev());
  $('stage-next').addEventListener('click', () => Player.next());
  {
    const tr = $('stage-track');
    let dragging = false;
    const seekTo = (clientX) => {
      const r = tr.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const total = Player.audio.duration || 0;
      Player.seek(p * total);
      $('stage-fill').style.width = (p * 100) + '%';
      $('stage-t').textContent = fmtTime(p * total);
      tr.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    };
    tr.addEventListener('pointerdown', (e) => {
      dragging = true;
      tr.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    });
    tr.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
    tr.addEventListener('pointerup', () => { dragging = false; });
    tr.addEventListener('pointercancel', () => { dragging = false; });
  }

  /* 指针靠近右侧那一簇（歌曲 + 形态）→ 展开迷你播放器；离开 → 收起。
     收的时候留 260ms 缓冲，免得在两个按钮之间挪一下就闪一下。 */
  {
    const stageRight = $('stage-right');
    let nearTimer = 0;
    let pillGlass = false;
    let pillSurface = null;
    let glassSyncTimer = 0;
    /* 封面砖的折射贴图延迟到第一次展开才挂（收起时正文是 0 宽） */
    function mountSongGlass() {
      if (pillGlass) return;
      const pill = document.querySelector('#stage-song .snow__pill');
      if (!pill) return;
      pillGlass = true;
      requestAnimationFrame(() => {
        try {
          pillSurface = LiquidGlass.mount(pill, { autoScale: true, scaleRef: 64, radius: 18 });
        } catch { /* 忽略 */ }
        LiquidGlass.refresh();
      });
    }
    /* 展开/收起动画结束后贴图尺寸才真正稳定。560ms ≈ body 宽度 520ms 的收尾，
       留一点余量给 cubic-bezier 的尾巴；只重建一次，避免每帧生成贴图。 */
    function syncSongGlassSoon() {
      clearTimeout(glassSyncTimer);
      glassSyncTimer = setTimeout(() => {
        if (pillSurface) pillSurface.sync();
      }, 560);
    }
    /* transitionend 是精确的收尾点：展开/收起、自动淡出（armIdle 摘 is-near）
       都会触发，不必在每个改 class 的地方各挂一份监听。 */
    const songBody = document.querySelector('#stage-song .snow__body');
    if (songBody) {
      songBody.addEventListener('transitionend', (e) => {
        if (e.propertyName !== 'width') return;
        if (pillSurface) pillSurface.sync();
      });
    }
    stageRight.addEventListener('pointerenter', () => {
      clearTimeout(nearTimer);
      mountSongGlass();
      $('stage-hud').classList.add('is-near');
      syncSongGlassSoon();
      StageHost.probeLight();
      StageHost.wake();
    });
    /* 触屏兜底：有些 WebView 在 pointerdown 之前不派发 pointerenter */
    stageRight.addEventListener('pointerdown', () => {
      mountSongGlass();
    }, { passive: true });
    stageRight.addEventListener('pointerleave', () => {
      /* 触屏抬手也会派发 pointerleave：那不是「离开」，收起交给 idle。 */
      if (TOUCH_HUD) return;
      clearTimeout(nearTimer);
      nearTimer = setTimeout(() => {
        $('stage-hud').classList.remove('is-near');
        syncSongGlassSoon();
      }, 260);
    });
    /* 触屏的胶囊一进舞台就是展开态，没有 hover 去触发首次挂载；
       等形态 ready（浮层已经展开）再挂，避免拿到收起时的 1×1 尺寸。 */
    if (TOUCH_HUD) {
      addEventListener('stage:ready', () => {
        mountSongGlass();
        syncSongGlassSoon();
      });
    }
  }
  $('view-stage').addEventListener('pointermove', () => StageHost.wake(), { passive: true });
  /* 桌面形态页：拖动带 / 窗口三键这些不在 #view-stage 里的元素，鼠标一动
     也要把看片模式叫回来。手机端不挂，保持原来的节奏。 */
  if (!TOUCH_HUD) {
    window.addEventListener('pointermove', () => {
      if (document.body.classList.contains('is-stage')) StageHost.wake();
    }, { passive: true });
  }
  window.addEventListener('keydown', () => StageHost.wake());

  /* 播放页顶栏和形态浮层同一套节奏：点屏幕弹出，2.6 秒不操作收起。
     桌面 hover 仍由 CSS :hover 负责，这里只补触屏点击；
     不拦点击本体 —— 播放页的封面 / 歌词照常响应。 */
  {
    const vn = $('view-now');
    const bar = vn ? vn.querySelector('.now__bar') : null;
    const hoverCapable = typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover)').matches : true;
    let barIdle = 0;
    function armBarIdle() {
      clearTimeout(barIdle);
      barIdle = setTimeout(() => {
        /* 指针还压在顶栏上 / 焦点还在按钮里时先不收，避免指尖下消失 */
        if (hoverCapable && bar && (bar.matches(':hover') || bar.contains(document.activeElement))) {
          armBarIdle(); return;
        }
        document.body.classList.remove('nowbar-on');
      }, 2600);
    }
    function wakeBar() {
      document.body.classList.add('nowbar-on');
      armBarIdle();
    }
    if (vn && bar) {
      vn.addEventListener('pointerdown', wakeBar, { passive: true });
      bar.addEventListener('pointerdown', wakeBar, { passive: true });
    }
  }

  /* ================================================================== *
   * QQ 音乐（独立边车音源）
   *
   *   第一期就三件事：扫码登录 / 搜索 / 播一首。
   *   边车由服务端按需拉起（第一次请求才 spawn），所以这边不用管进程和端口，
   *   只跟 /api/qq/* 说话 —— 形状和网易云那套一样，都是 { code, ... }。
   *
   *   真实扫码要用户本人拿手机扫。我们只负责：
   *     二维码能显示（data:image/png 直接塞 <img>）、状态在轮询、
   *     800 过期自动换一张、803 之后把昵称显示出来。
   * ================================================================== */
  const QQ = (() => {
    const box = $('qq-qr-box');
    const status = $('qq-qr-status');
    const wrap = $('qq-qr');
    const stateEl = $('qq-state');
    const loginBtn = $('qq-login');
    const logoutBtn = $('qq-logout');
    const chBox = $('qq-qr-ch');
    /* 账号行头像：登录态失效后也能显示上次账号的真实头像（不伪造「已登录」） */
    const avatarEl = document.createElement('img');
    avatarEl.id = 'qq-avatar';
    avatarEl.alt = '';
    avatarEl.hidden = true;
    avatarEl.style.cssText = 'width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:-5px;margin-right:6px;margin-left:auto;';
    avatarEl.onerror = () => { avatarUrl = ''; paint(); };   // 加载失败回退成无头像，不留破图
    stateEl.parentNode.insertBefore(avatarEl, stateEl);

    let logged = false;
    let nickname = '';
    let avatarUrl = '';
    let key = '';
    let timer = 0;
    let checking = false;      // 上一轮还没回来就跳过这一轮，避免并发轮询
    let refreshing = 0;        // 连续过期次数：连换 3 次就停手，别把上游惹毛
    let autoTries = 0;         // 过期自动换码时撞上 15s 冷却，最多再等 3 轮
    let channel = 'qqmusic';
    try { channel = localStorage.getItem('lizi.qq.channel') || 'qqmusic'; } catch { /* ignore */ }

    const CH_LABEL = {
      qqmusic: '用 QQ 音乐 App 扫码',
      qq: '用手机 QQ 扫码',
      wechat: '用微信扫码',
    };

    function paint() {
      avatarEl.hidden = !avatarUrl;
      if (avatarUrl) avatarEl.src = API.img(avatarUrl, 64);
      /* 有头像时让它吃掉 auto margin，状态文字紧贴头像；没头像时把 auto 还给状态文字 */
      stateEl.style.marginLeft = avatarEl.hidden ? '' : '0';
      stateEl.textContent = logged
        ? '已登录 ' + (nickname || 'QQ 音乐')
        : (timer ? '等待扫码' : (avatarUrl ? '登录已失效' : '未连接'));
      loginBtn.hidden = logged;
      loginBtn.textContent = timer ? '换一张' : '登录';
      logoutBtn.hidden = !logged;
      chBox.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.ch === channel));
    }

    function stop() {
      clearInterval(timer);
      timer = 0;
      checking = false;
    }

    /** 关掉设置面板就收二维码、停轮询（不然收起来之后还在后台打接口） */
    function pause() {
      stop();
      wrap.hidden = true;
      paint();
    }

    async function refresh() {
      try {
        const d = await API.qqStatus();
        logged = !!d.loggedIn;
        nickname = d.nickname || '';
        avatarUrl = d.avatar || '';
        /* 老主服务没有 stale 头像字段时才单独问一次；失败不影响登录态判断 */
        if (!logged && !avatarUrl) {
          try {
            const c = await API.qqCachedProfile();
            if (c && c.avatar) {
              avatarUrl = c.avatar;
              nickname = c.nickname || nickname;
            }
          } catch { /* 没有就没有 */ }
        }
      } catch {
        logged = false;
        nickname = '';
        avatarUrl = '';
      }
      paint();
      return logged;
    }

    async function startQr(auto = false) {
      stop();
      refreshing = 0;
      wrap.hidden = false;
      box.innerHTML = '<span>正在获取二维码…</span>';
      status.textContent = '正在连 QQ 音乐…';
      status.className = 'qq-qr__status';
      paint();

      let d = null;
      try {
        d = await API.qqQrKey(channel);
      } catch (e) {
        box.innerHTML = '<span>边车没起来</span>';
        status.textContent = '启动失败：' + e.message;
        status.className = 'qq-qr__status is-error';
        return;
      }
      if (!d || !d.key || !d.qrimg) {
        box.innerHTML = '<span>拿不到二维码</span>';
        /* 二维码不是随时能刷：上游对同一设备有 15s 冷却（服务端会把 retryAfterMs 带回来）。
           自动换码（过期触发）撞上冷却时不要停死 —— 等冷却过去自己再试一次。 */
        if (auto && d && d.retryAfterMs && autoTries < 3) {
          autoTries++;
          const wait = Math.ceil(d.retryAfterMs / 1000);
          status.textContent = `二维码过期，${wait} 秒后自动重试…`;
          status.className = 'qq-qr__status';
          paint();
          setTimeout(() => { if (!logged) startQr(true); }, (d.retryAfterMs || 15000) + 500);
          return;
        }
        /* 失败时要说清「多久之后再试」，不然用户只看到一句「拿不到」。 */
        const wait = d && d.retryAfterMs ? `（约 ${Math.ceil(d.retryAfterMs / 1000)} 秒后再试）` : '';
        status.textContent = ((d && (d.error || d.message)) || 'QQ 返回了空二维码') + wait;
        status.className = 'qq-qr__status is-error';
        return;
      }

      autoTries = 0;
      key = d.key;
      const img = new Image();
      img.alt = 'QQ 音乐登录二维码';
      img.onload = () => { box.innerHTML = ''; box.appendChild(img); };
      img.onerror = () => { box.innerHTML = '<span>二维码图片加载失败</span>'; };
      img.src = d.qrimg;                         // data:image/png;base64,...
      status.textContent = CH_LABEL[channel] || CH_LABEL.qqmusic;
      timer = setInterval(check, 2000);
      paint();
    }

    async function check() {
      if (!key || checking) return;
      checking = true;
      try {
        const d = await API.qqQrCheck(key);
        if (d.code === 803) {
          stop();
          logged = true;
          nickname = d.nickname || '';
          if (d.avatar) avatarUrl = d.avatar;
          box.innerHTML = '<span>已登录</span>';
          status.textContent = '登录成功' + (nickname ? '：' + nickname : '');
          status.className = 'qq-qr__status is-ok';
          paint();
          setTimeout(() => { if (logged) wrap.hidden = true; }, 1200);
          return;
        }
        if (d.code === 800) {
          if (++refreshing > 3) {
            stop();
            status.textContent = '二维码反复过期，稍后再点「登录」';
            status.className = 'qq-qr__status is-error';
            paint();
            return;
          }
          status.textContent = '二维码过期，换一张…';
          status.className = 'qq-qr__status is-error';
          stop();
          setTimeout(() => startQr(true), 600);
          return;
        }
        if (d.code === 802) {
          status.textContent = '已扫码，请在手机上确认';
          status.className = 'qq-qr__status is-ok';
          return;
        }
        // 801 等待（以及不认识的状态）：保持等待文案
        status.textContent = CH_LABEL[channel] || CH_LABEL.qqmusic;
        status.className = 'qq-qr__status';
        refreshing = 0;
      } catch { /* 网络抖一下，下一轮再试 */ }
      finally { checking = false; }
    }

    async function logout() {
      try { await API.qqLogout(); } catch { /* 服务端没清掉也要把界面收回来 */ }
      logged = false;
      nickname = '';
      avatarUrl = '';
      key = '';
      pause();
    }

    loginBtn.addEventListener('click', () => startQr(false));
    logoutBtn.addEventListener('click', logout);
    chBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch]');
      if (!b || b.dataset.ch === channel) return;
      channel = b.dataset.ch;
      try { localStorage.setItem('lizi.qq.channel', channel); } catch { /* ignore */ }
      paint();
      if (!wrap.hidden) startQr();      // 二维码开着就直接换成新通道的
    });

    return { refresh, pause, startQr, logout, get logged() { return logged; } };
  })();

  /* ================================================================== *
   * 酷我 Cookie 登录浮层（设置页那一行 + 大厅卡片共用）
   *
   *   酷我网页端没有扫码接口，只能粘贴 Cookie。输入框必须放在 body 上的浮层里：
   *   大厅那张卡本身是 <button>，textarea 不能塞进 button；设置页那一行是 div，
   *   塞得下但会把这行撑成一坨，所以两边都走同一个浮层。
   *   返回 Promise<boolean>：true = 服务端确认登录成功；调用方自己收尾（重画状态）。
   * ================================================================== */
  /* 浮层挂在 body 上，视图切走不会自己消失。留一个「外部收掉」的句柄：
     Sources.pause / closeQr、离开大厅时调它，Promise 以 false 收尾，别留一层遮罩。 */
  let kuwoDialogAbort = null;
  function openKuwoCookieDialog() {
    return new Promise((resolve) => {
      /* 上一份还没关就再来一份：先按取消收掉旧的，别叠两层遮罩、也别让旧 Promise 悬着 */
      if (kuwoDialogAbort) kuwoDialogAbort();
      const old = document.getElementById('kw-cookie-dlg');
      if (old) old.remove();

      const wrap = document.createElement('div');
      wrap.id = 'kw-cookie-dlg';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,10,14,.55);padding:20px';
      const box = document.createElement('div');
      box.style.cssText = 'width:min(560px,100%);background:#fff;color:#1b1b1f;border-radius:16px;padding:18px 18px 14px;box-shadow:0 18px 60px rgba(0,0,0,.35);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif';
      const title = document.createElement('div');
      title.textContent = '酷我音乐 · Cookie 登录';
      title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px';
      const note = document.createElement('p');
      note.textContent = '酷我网页端不提供二维码。请先在浏览器登录 www.kuwo.cn，从开发者工具 → Application → Cookies 复制 userid 和 sid（或 websid），整段 Cookie 直接粘贴也行。';
      note.style.cssText = 'margin:0 0 10px;color:#555;font-size:13px';
      const ta = document.createElement('textarea');
      ta.placeholder = 'userid=...; sid=...;  （或整段 Cookie）';
      ta.rows = 5;
      ta.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical;padding:10px 12px;border:1px solid #d8d8de;border-radius:10px;font:13px/1.5 ui-monospace,Consolas,monospace;outline:none';
      const msg = document.createElement('div');
      msg.style.cssText = 'min-height:20px;margin:6px 0 8px;color:#c0392b;font-size:13px';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.style.cssText = 'padding:8px 16px;border:1px solid #d8d8de;border-radius:999px;background:#fff;color:#333;cursor:pointer';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = '保存 Cookie';
      save.style.cssText = 'padding:8px 16px;border:0;border-radius:999px;background:#fd6000;color:#fff;font-weight:600;cursor:pointer';
      row.append(cancel, save);
      box.append(title, note, ta, msg, row);
      wrap.append(box);
      document.body.append(wrap);

      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        if (kuwoDialogAbort === abort) kuwoDialogAbort = null;
        wrap.remove();
        resolve(ok);
      };
      const abort = () => done(false);
      kuwoDialogAbort = abort;
      cancel.addEventListener('click', abort);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) abort(); });

      save.addEventListener('click', async () => {
        const cookie = ta.value.trim();
        if (!cookie) { msg.textContent = '先把 Cookie 粘进来'; ta.focus(); return; }
        save.disabled = true;
        cancel.disabled = true;
        save.textContent = '保存中…';
        msg.textContent = '';
        try {
          const d = await API.kuwoCookieLogin(cookie);
          if (!d || !d.loggedIn) {
            msg.textContent = (d && d.error) || 'Cookie 无效（要同时有 userid 和 sid / websid）';
            save.disabled = false;
            cancel.disabled = false;
            save.textContent = '保存 Cookie';
            return;
          }
          done(true);
        } catch (e) {
          msg.textContent = '保存失败：' + ((e && e.message) || e);
          save.disabled = false;
          cancel.disabled = false;
          save.textContent = '保存 Cookie';
        }
      });
      setTimeout(() => ta.focus(), 50);
    });
  }

  /* ================================================================== *
   * 其它音源（酷狗 / 汽水 / 波点 / 酷我 / Spotify）
   *
   *   架构和上面 QQ 那块一样：只跟 /api/<name>/* 说话，边车由服务端按需拉起。
   *   区别只有三点：
   *     1) 五家的行是一张表生成的（SOURCES），加一家只改这张表 + 服务端路由；
   *     2) 二维码面板共用同一个（#src-qr），哪家点了登录就显示哪家的码；
   *     3) 酷我没有扫码接口（cookie: true），点「登录」出的是 Cookie 浮层。
   *
   *   每家都必须把限制写在行里（.src-limit）和状态里 —— 试听片段 / 需会员 /
   *   仅大陆网络 / Node 版本不足 / 只有元数据，一条都不能藏。
   * ================================================================== */
  const SOURCES = [
    { id: 'kugou', label: '酷狗音乐', note: '第三方协议，用你自己的账号登录，风险自担。未登录能搜，但播放被酷狗风控拦（20028 需要验证）。' },
    { id: 'qishui', label: '汽水音乐', note: '抖音扫码授权。未登录只有 30 秒试听片段；边车需要本机 Node ≥ 24。' },
    { id: 'bodian', label: '波点音乐', note: '扫码登录。未登录只有 30 秒试听；播放只放行中国大陆网络。' },
    /* 酷我 / Spotify 已整块下线（2026-11-09）：桌面和安卓都不再露出。
       酷我只有粘贴 Cookie 的登录方式，Spotify 的 OAuth 回调在本机也回不来，
       这一版先不带给用户。边车服务和 /api 路由保留，只是不再有入口。 */
  ];

  const Sources = (() => {
    const rows = {};
    const qr = { wrap: $('src-qr'), box: $('src-qr-box'), status: $('src-qr-status'), note: $('src-qr-note') };

    let active = '';        // 当前在扫码/授权的是哪一家
    let key = '';
    let timer = 0;
    let checking = false;
    let expired = 0;        // 连续过期次数，连换 3 次就停手
    let spotifyTries = 0;
    let loginSeq = 0;       // 登录流程代次：stop() 一次就作废所有在飞的 await 收尾

    for (const s of SOURCES) {
      rows[s.id] = {
        state: $(s.id + '-state'),
        login: $(s.id + '-login'),
        logout: $(s.id + '-logout'),
        logged: false, nickname: '', avatar: '', reason: '',
      };
      /* 账号行头像：只有真实头像才显示（汽水 /status 现在会带 medium_avatar_url）；
         加载失败就收回占位，绝不留破图。 */
      const r = rows[s.id];
      if (r.state && r.state.parentNode) {
        const av = document.createElement('img');
        av.alt = '';
        av.hidden = true;
        av.style.cssText = 'width:20px;height:20px;border-radius:50%;object-fit:cover;flex:none;margin-left:auto;';
        av.onerror = () => { av.hidden = true; av.removeAttribute('src'); r.avatar = ''; };
        r.state.parentNode.insertBefore(av, r.state);
        r.avatarEl = av;
      }
    }

    const meta = (id) => SOURCES.find((s) => s.id === id) || { id, label: id, note: '' };

    function paint(id) {
      const r = rows[id];
      if (!r) return;
      const waiting = active === id && timer;
      let text;
      if (r.reason) text = r.reason;                       // 不可用及原因，明着写
      else if (r.logged) text = '已登录' + (r.nickname ? ' ' + r.nickname : '');
      else if (waiting) text = '等待扫码';
      else text = id === 'spotify' ? '未授权' : '未连接';
      r.state.textContent = text;
      r.state.title = text;
      const ava = r.logged && r.avatar ? API.img(r.avatar, 64) : '';
      if (r.avatarEl) {
        r.avatarEl.hidden = !ava;
        if (ava) r.avatarEl.src = ava;
        else r.avatarEl.removeAttribute('src');
      }
      /* 有头像时让它吃掉 auto margin，状态文字紧贴头像；没头像时把 auto 还给状态文字 */
      r.state.style.marginLeft = ava ? '0' : '';
      /* 登录键的显示规则：已登录就藏；「node 版本不足」这种硬失败也藏（点了也没用）；
         其它情况（包括缺 Client ID）**要留着**，让用户点一下能看到到底缺什么、怎么补。 */
      const hardFail = r.reason === '本机 node 版本不足（需 ≥24）';
      r.login.hidden = r.logged || hardFail;
      r.login.textContent = waiting ? '换一张' : (id === 'spotify' ? '去授权' : '登录');
      r.logout.hidden = !r.logged;
    }

    function stop() {
      clearInterval(timer);
      timer = 0;
      checking = false;
      spotifyTries = 0;
      /* 任何「换一家登录 / 关闭 / 离开」都会先 stop()：酷我的 Cookie 浮层不归
         二维码轮询管，但它也是登录流程的一部分，停轮询时一起收掉，免得切到
         别家二维码后还压着一层遮罩。 */
      if (kuwoDialogAbort) kuwoDialogAbort();
      loginSeq++;                 // 让还在 await 的登录流程知道「这轮已经作废」
    }

    function pause() {
      stop();
      if (qr.wrap) qr.wrap.hidden = true;
      active = '';
      Object.keys(rows).forEach(paint);
    }

    /** 读一家状态。后端 502 时（比如 node 版本不足）要把原因显示出来，不是「未连接」 */
    async function refresh(id) {
      const r = rows[id];
      try {
        const h = await API.srcHealth(id);
        if (h && h.ok === false) {
          if (h.reason === 'node-version') r.reason = '本机 node 版本不足（需 ≥24）';
          else if (id === 'spotify' && !h.hasClientId) r.reason = '未配置 Client ID';
          else r.reason = '边车不可用';
          paint(id);
          return;
        }
        if (id === 'spotify' && h && h.ok === true && !h.hasClientId) {
          r.reason = '未配置 Client ID';
          paint(id);
          return;
        }
        const d = await API.srcStatus(id);
        r.logged = !!(d && d.loggedIn);
        r.nickname = (d && d.nickname) || '';
        r.avatar = (d && d.avatar) || '';
        /* Spotify 没登录但配了 Client Secret 也能搜（客户端凭证），别显示成「不可用」 */
        r.reason = (d && d.error && id === 'spotify' && !d.mode) ? '未配置 Client ID' : '';
        if (id === 'spotify' && r.logged && /客户端凭证/.test(r.nickname)) { r.logged = true; r.nickname = ''; }
      } catch (e) {
        r.reason = /node/i.test(e.message) ? '本机 node 版本不足（需 ≥24）' : '边车不可用';
      }
      paint(id);
    }

    function refreshAll() { for (const s of SOURCES) refresh(s.id); }

    function closeQr() {
      stop();                                    // 里面会连酷我的 Cookie 浮层一起收
      if (qr.wrap) qr.wrap.hidden = true;
      active = '';
      Object.keys(rows).forEach(paint);
    }

    async function startQr(id) {
      stop();
      active = id;
      expired = 0;
      key = '';
      qr.wrap.hidden = false;
      qr.box.innerHTML = '<span>正在获取二维码…</span>';
      qr.status.className = 'qq-qr__status';
      qr.status.textContent = `正在连 ${meta(id).label}…`;
      qr.note.textContent = meta(id).note;
      paint(id);

      let k = null;
      let c = null;
      try {
        k = await API.srcQrKey(id);
        if (!k || !k.key) throw new Error((k && (k.error || k.message)) || '拿不到二维码 key');
        c = await API.srcQrCreate(id, k.key);
        if (!c || !c.qrimg) throw new Error((c && (c.error || c.message)) || '二维码生成失败');
      } catch (e) {
        qr.box.innerHTML = '<span>拿不到二维码</span>';
        qr.status.textContent = String(e.message || e);
        qr.status.className = 'qq-qr__status is-error';
        return;
      }

      key = k.key;
      const img = new Image();
      img.alt = `${meta(id).label}登录二维码`;
      img.onload = () => { qr.box.innerHTML = ''; qr.box.appendChild(img); };
      img.onerror = () => { qr.box.innerHTML = '<span>二维码图片加载失败</span>'; };
      img.src = c.qrimg;                          // data:image/png;base64,...
      qr.status.textContent = `用 ${meta(id).label} App 扫码`;
      timer = setInterval(() => check(id), 2200);
      paint(id);
    }

    async function check(id) {
      if (!key || checking || active !== id) return;
      checking = true;
      try {
        const d = await API.srcQrCheck(id, key);
        const code = Number(d && d.code);
        if (code === 803) {
          stop();
          rows[id].logged = true;
          rows[id].nickname = (d && d.nickname) || '';
          rows[id].avatar = (d && d.avatar) || '';
          qr.box.innerHTML = '<span>已登录</span>';
          qr.status.textContent = '登录成功' + (rows[id].nickname ? '：' + rows[id].nickname : '');
          qr.status.className = 'qq-qr__status is-ok';
          paint(id);
          setTimeout(() => {
            if (!rows[id].logged) return;
            qr.wrap.hidden = true;
            refresh(id);          // 老边车不带头像时，登录后再问一次 /status
          }, 1200);
          return;
        }
        if (code === 800) {
          if (++expired > 3) {
            stop();
            qr.status.textContent = '二维码反复过期，稍后再点「登录」';
            qr.status.className = 'qq-qr__status is-error';
            paint(id);
            return;
          }
          qr.status.textContent = '二维码过期，换一张…';
          qr.status.className = 'qq-qr__status is-error';
          stop();
          setTimeout(() => { if (!rows[id].logged) startQr(id); }, 600);
          return;
        }
        if (code === 802) {
          qr.status.textContent = '已扫码，请在手机上确认';
          qr.status.className = 'qq-qr__status is-ok';
          return;
        }
        if (code !== 801 && d && d.error) {
          qr.status.textContent = d.error;
          qr.status.className = 'qq-qr__status is-error';
          return;
        }
        qr.status.textContent = `用 ${meta(id).label} App 扫码`;
        qr.status.className = 'qq-qr__status';
        expired = 0;
      } catch { /* 网络抖一下，下一轮再试 */ }
      finally { checking = false; }
    }

    /** Spotify：官方 OAuth 走浏览器，回调在 127.0.0.1:5588，这边只轮询状态 */
    async function spotifyLogin() {
      stop();
      active = 'spotify';
      qr.wrap.hidden = false;
      qr.note.textContent = meta('spotify').note;
      let d = null;
      try { d = await API.srcLoginUrl('spotify'); } catch (e) { d = { error: e.message }; }
      if (!d || !d.url) {
        qr.box.innerHTML = '<span>没有 Client ID</span>';
        qr.status.textContent = (d && d.error) || '缺少 SPOTIFY_CLIENT_ID';
        qr.status.className = 'qq-qr__status is-error';
        qr.note.textContent = '配法：在 services/spotify-api/.client.json 里写 '
          + '{ "clientId": "…", "clientSecret": "…" }（或设 SPOTIFY_CLIENT_ID），然后重开边车。'
          + '回调地址要登记成 http://127.0.0.1:5588/callback。本期只读元数据，不接音频。';
        paint('spotify');
        return;
      }
      // 用独立小窗，别把主界面顶掉
      window.open(d.url, 'lizi-spotify-auth', 'width=520,height=760');
      qr.box.innerHTML = '<span>已在浏览器打开授权页</span>';
      qr.status.textContent = '在浏览器里点「同意」后，这里会自动变成已登录';
      qr.status.className = 'qq-qr__status';
      spotifyTries = 0;
      timer = setInterval(async () => {
        spotifyTries++;
        await refresh('spotify');
        if (rows.spotify.logged) {
          stop();
          qr.status.textContent = '登录成功' + (rows.spotify.nickname ? '：' + rows.spotify.nickname : '');
          qr.status.className = 'qq-qr__status is-ok';
        } else if (spotifyTries > 60) {
          stop();
          qr.status.textContent = '等太久没等到授权，稍后再试';
          qr.status.className = 'qq-qr__status is-error';
        }
      }, 3000);
    }

    async function logout(id) {
      try { await API.srcLogout(id); } catch { /* 服务端没清掉也要把界面收回来 */ }
      rows[id].logged = false;
      rows[id].nickname = '';
      if (active === id) closeQr();
      else paint(id);
    }

    /** 酷我：只有 Cookie 登录。浮层关掉就收手，成功后重读 /status 再收面板 */
    async function cookieLogin(id) {
      stop();
      const seq = ++loginSeq;   // 双击「登录」时别让上一轮的 await 回来改面板
      active = id;
      qr.wrap.hidden = false;
      qr.box.innerHTML = '<span>酷我没有扫码登录</span>';
      qr.status.className = 'qq-qr__status';
      qr.status.textContent = '在弹窗里粘贴 Cookie';
      qr.note.textContent = meta(id).note;
      paint(id);
      const ok = await openKuwoCookieDialog();
      if (seq !== loginSeq || active !== id) return;   // 期间被别的平台 / 新的一轮顶掉了
      if (!ok) {
        qr.status.textContent = '已取消';
        return;
      }
      qr.box.innerHTML = '<span>已保存</span>';
      qr.status.textContent = '已保存 Cookie';
      qr.status.className = 'qq-qr__status is-ok';
      await refresh(id);
      setTimeout(() => { if (seq === loginSeq && active === id) closeQr(); }, 1200);
    }

    for (const s of SOURCES) {
      rows[s.id].login.addEventListener('click', () => {
        if (s.cookie) cookieLogin(s.id);
        else if (s.id === 'spotify') spotifyLogin();
        else if (key && active === s.id && timer) startQr(s.id);   // 「换一张」
        else startQr(s.id);
      });
      rows[s.id].logout.addEventListener('click', () => logout(s.id));
      paint(s.id);
    }

    return { refreshAll, refresh, pause, closeQr, get active() { return active; } };
  })();

  /* ==================================================================
     设置（整页视图 #view-settings）
     ------------------------------------------------------------------
     以前是顶栏下面那个 268px 的玻璃下拉面板（#settings-panel，已整块删掉）。
     现在齿轮点开 = show('settings')，页内按分区排版（账号 / 音源 / 音效 / 外观 / 关于）。
     原来面板里的行**整块搬进 index.html 的新视图**，id 一个没改 ——
     所以下面这些接线（音效跳转、我的专辑展示、音源登录）照旧能跑。
     ================================================================== */
  const panelBtn = $('btn-settings');

  /* 离开设置页要把扫码轮询停掉（原来是 closePanel 顺手做的两件事）。
     初始化早期 QQ / Sources 还没求值，try/catch 挡住 TDZ 就行。 */
  function pauseSettingsPolls() {
    try { QQ.pause(); } catch { /* 还没定义 */ }
    try { Sources.pause(); } catch { /* 还没定义 */ }
  }

  /* 账号块（头像 / 昵称 / 登录态）——不碰登录逻辑：
     直接读 profile 绘制；登录 / 退出入口都在设置页本块里。 */
  const setAvatar = $('set-account-avatar');
  const setAvatarPh = $('set-account-ph');
  /* 网易云那行下面「粘贴 MUSIC_U Cookie」备选入口：登录后点了也没反应
     （openLoginModal 会直接 return），跟着行尾的「登录」一起收起。 */
  const setLinks = document.querySelector('.setpage__links');
  function paintAccount() {
    const on = !!profile;
    /* 头像直接读 profile.avatar，不从 DOM 里取 */
    const av = on && profile && profile.avatar ? API.img(profile.avatar, 96) : '';
    const name = $('set-account');
    const sub = $('set-account-sub');
    if (name) name.textContent = on && profile.nickname ? profile.nickname : '未登录';
    if (sub) sub.textContent = on ? '已登录 · 歌单与收藏已同步' : '登录后可同步歌单与收藏';
    if (setAvatar) {
      if (av) { setAvatar.setAttribute('src', av); setAvatar.hidden = false; }
      else { setAvatar.hidden = true; setAvatar.removeAttribute('src'); }
    }
    if (setAvatarPh) setAvatarPh.hidden = !!av;
    const l = $('set-account-login');
    const o = $('set-account-logout');
    if (l) l.hidden = on;
    if (o) o.hidden = !on;
    if (setLinks) setLinks.hidden = on;
    /* 平台行左侧的品牌色块：颜色统一从大厅那套 PLAT_BG 取（Hall.platColor），
       这里只把颜色写进行的 --src-chip，CSS 负责画 30×30 圆角色块。
       先在 DOM 里静默按 id 铺一遍，登录态刷新 / 重进设置页都会重新对齐。 */
    try {
      document.querySelectorAll('[data-src-row]').forEach((row) => {
        const c = Hall.platColor(row.dataset.srcRow);
        if (c) row.style.setProperty('--src-chip', c);
      });
    } catch { /* Hall 还没初始化：下次进设置页再补 */ }
  }
  /* ------------------------------------------------------------------
     设置页「控制台」外观层（2026-11 改版）
       DOM 结构在 index.html（#setnav + .setcard），这里只做三件纯表现的事：
       1) IntersectionObserver 高亮左侧当前分区；点击导航平滑滚到对应卡片
       2) 卡片上的 SpotlightCard 光斑：pointermove 写 --mx / --my
       3) 窄屏横向 chips 自动把当前项滚进可视区
     不碰任何既有行的接线；登录 / 音源 / 背景 / 音效逻辑一条没动。
     ------------------------------------------------------------------ */
  const setNav = document.getElementById('setnav');
  const settingsView = document.getElementById('view-settings');
  const setCards = settingsView
    ? Array.prototype.slice.call(settingsView.querySelectorAll('.setcard'))
    : [];
  const setNavBtns = setNav ? Array.prototype.slice.call(setNav.querySelectorAll('[data-sec]')) : [];
  let setActiveId = '';
  let setObserver = null;

  /** 当前分区：换 is-on / aria-current；chips 模式下把按钮横向滚进可视区 */
  function setActiveSection(id, revealChip) {
    if (!id || id === setActiveId) return;
    setActiveId = id;
    let activeBtn = null;
    setNavBtns.forEach((b) => {
      const on = b.dataset.sec === id;
      b.classList.toggle('is-on', on);
      if (on) {
        b.setAttribute('aria-current', 'true');
        activeBtn = b;
      } else {
        b.removeAttribute('aria-current');
      }
    });
    if (revealChip && activeBtn && setNav && setNav.scrollWidth > setNav.clientWidth + 2) {
      const nr = setNav.getBoundingClientRect();
      const br = activeBtn.getBoundingClientRect();
      const want = br.left - nr.left - (nr.width - br.width) / 2;
      setNav.scrollTo({ left: setNav.scrollLeft + want, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  /** 点击导航：在 #view-settings 这个滚动容器里滚到卡片顶部（顶栏下留一点空气） */
  function scrollToSection(id) {
    const sec = id ? document.getElementById(id) : null;
    if (!sec || !settingsView) return;
    const vr = settingsView.getBoundingClientRect();
    const sr = sec.getBoundingClientRect();
    const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64;
    /* 窄屏 chips 是横向吸顶的，再多让出它的高度，否则卡片标题会被压在 chips 下面 */
    const navRow = setNav && getComputedStyle(setNav).flexDirection === 'row';
    const navH = navRow ? setNav.getBoundingClientRect().height + 8 : 0;
    const y = settingsView.scrollTop + (sr.top - vr.top) - topbar - navH - 12;
    settingsView.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'auto' : 'smooth' });
    setActiveSection(id, true);
  }

  function setupSettingsConsole() {
    if (!setNav || !settingsView) return;
    if (!setObserver && window.IntersectionObserver) {
      /* 只认视口中间偏上的一条「活动带」；一次只亮一个分区。 */
      const ratios = new Map();
      setObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) ratios.set(e.target.id, e.intersectionRatio);
          else ratios.delete(e.target.id);
        });
        let best = '', bestRatio = 0;
        setCards.forEach((c) => {
          const r = ratios.get(c.id) || 0;
          if (r > bestRatio) { bestRatio = r; best = c.id; }
        });
        if (best) setActiveSection(best, true);
      }, {
        root: settingsView,
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0, 0.01, 0.2, 0.5, 0.75],
      });
      setCards.forEach((c) => setObserver.observe(c));
    }
    if (!setNav.dataset.bound) {
      setNav.dataset.bound = '1';
      setNav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sec]');
        if (!b) return;
        scrollToSection(b.dataset.sec);
      });
    }
  }

  /* SpotlightCard：只在 hover:hover + fine 指针下写坐标；触摸 / 减少动态不挂。 */
  if (settingsView && !reduceMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let spotCard = null;
    const clearSpot = () => {
      if (!spotCard) return;
      spotCard.style.removeProperty('--mx');
      spotCard.style.removeProperty('--my');
      spotCard = null;
    };
    settingsView.addEventListener('pointermove', (e) => {
      const card = e.target && e.target.closest ? e.target.closest('.setcard') : null;
      if (!card) { clearSpot(); return; }
      spotCard = card;
      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(2) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(2) + '%');
    }, { passive: true });
    settingsView.addEventListener('pointerleave', clearSpot);
    if (document.addEventListener) {
      document.addEventListener('pointermove', (e) => {
        if (spotCard && !settingsView.contains(e.target)) clearSpot();
      }, { passive: true });
    }
  }
  setupSettingsConsole();

  /* ---- 主页面播放条已整体撤掉 ----
     播放条皮肤和 player-bar-next 都不再加载，index.html 的 body.pbn-off 永久生效
     （--player-h = 0，旧 footer 隐藏，视图铺到底）。设置页也不再出现播放条分区；
     以后要加新底栏，再在这套 pbn-off 机制上接管。 */

  /* ---- 平台头像（lizi.hall.platAvatar）----
     默认关：值不是 '1' 就不铺头像。关着时大厅的平台方块仍是登录态（点击照样进平台），
     但只显示平台色块 + 图标，不显示账号头像；头像地址也不进 DOM。
     切换后让大厅自己重查一遍（Hall.refreshMe 会 paintMe(true) 重画那六个方块）。 */
  const PLAT_AVATAR_KEY = 'lizi.hall.platAvatar';
  function platAvatarOn() {
    try { return localStorage.getItem(PLAT_AVATAR_KEY) === '1'; } catch { return false; }
  }
  function paintPlatAvatarSwitch() {
    const sw = $('set-plat-avatar');
    if (sw && sw.setAttribute) sw.setAttribute('aria-checked', String(platAvatarOn()));
  }
  function setPlatAvatar(on) {
    on = !!on;
    try { localStorage.setItem(PLAT_AVATAR_KEY, on ? '1' : '0'); } catch { /* 隐私模式：本次仍生效 */ }
    paintPlatAvatarSwitch();
    try { Hall.refreshMe(); } catch { /* 大厅还没挂载：下次进大厅本来就会按新值画 */ }
  }
  $('set-plat-avatar').addEventListener('click', () => setPlatAvatar(!platAvatarOn()));
  paintPlatAvatarSwitch();

  /* ---- 大厅铺色来源（lizi.hall.platColor）----
     默认关：铺色态取**当前专辑封面**经 C 算法算出的 5 档（找不到封面才退回平台色）；
     打开后回到旧的平台品牌色。设置页的自定义色优先级仍在这两者之上。
     切换后让大厅只重刷颜色，不重放铺色块展开动画。 */
  const PLAT_COLOR_KEY = 'lizi.hall.platColor';
  function platColorOn() {
    try { return localStorage.getItem(PLAT_COLOR_KEY) === '1'; } catch { return false; }
  }
  function paintPlatColorSwitch() {
    const sw = $('set-plat-color');
    if (sw && sw.setAttribute) sw.setAttribute('aria-checked', String(platColorOn()));
  }
  function setPlatColor(on) {
    on = !!on;
    try { localStorage.setItem(PLAT_COLOR_KEY, on ? '1' : '0'); } catch { /* 隐私模式：本次仍生效 */ }
    paintPlatColorSwitch();
    try { Hall.refreshThemeColors(); } catch { /* 大厅还没挂载：下次进铺色态自然按新值画 */ }
    document.dispatchEvent(new CustomEvent('lizi:bgfx-change'));
  }
  const platColorSwitch = $('set-plat-color');
  if (platColorSwitch) platColorSwitch.addEventListener('click', () => setPlatColor(!platColorOn()));
  paintPlatColorSwitch();

  /* ---- 大厅内容轨（lizi.hall.rail）----
     默认开。'0' 才是旧交互（四张卡跳浏览页）；缺省 / '1' = 精选/喜欢/收藏/电台
     直接在跑马带里切换。切换时让大厅立刻重画，不等重进大厅。 */
  const HALL_RAIL_KEY = 'lizi.hall.rail';
  function hallRailOn() {
    try { return localStorage.getItem(HALL_RAIL_KEY) !== '0'; } catch { return true; }
  }
  function paintHallRailSwitch() {
    const sw = $('set-hall-rail');
    if (sw && sw.setAttribute) sw.setAttribute('aria-checked', String(hallRailOn()));
  }
  function setHallRail(on) {
    on = !!on;
    try { localStorage.setItem(HALL_RAIL_KEY, on ? '1' : '0'); } catch { /* 隐私模式：本次仍生效 */ }
    paintHallRailSwitch();
    try { Hall.refreshRailMode(); } catch { /* 大厅还没挂载：下次进大厅本来就会按新值画 */ }
  }
  $('set-hall-rail').addEventListener('click', () => setHallRail(!hallRailOn()));
  paintHallRailSwitch();

  function openSettings() {
    show('settings');
    audioSummary();          // 「音质 · 预设」每次进来刷一次
    paintAccount();
    paintMebg();             // 「主页背景」的来源（自定义 / 网易云 / 默认渐变）同理
    QQ.refresh();            // 进页面问一次 QQ 的登录态（未连接 / 已登录 <昵称>）
    Sources.refreshAll();    // 酷狗 / 汽水 / 波点 / 酷我 / Spotify 同理（含「node 版本不足」）
    paintPlatAvatarSwitch(); // 「平台头像」同理：默认关，别的标签页改过也能对上
    paintPlatColorSwitch();  // 「用平台颜色铺色」默认关，别的标签页改过也能对上
    paintHallRailSwitch();   // 「大厅内容轨」默认开，别的标签页改过也能对上
    setupSettingsConsole();  // 控制台导航 / 观察器（幂等）
    setActiveSection('set-sec-account', false);
    /* 「跟随平台」的色盘初值取决于**当前大厅平台**，而平台可能在设置页关着的
       时候被换掉（大厅里点方块）。重新走一遍 paintBgFx，别拿上次打开时的旧色。 */
    document.dispatchEvent(new CustomEvent('lizi:bgfx-change'));
    const v = el.viewSettings;
    if (v && v.scrollTo) v.scrollTo({ top: 0 });
  }
  /* ---------------------------------------------------------------
     顶栏左键「一个按钮两种身份」
       大厅：齿轮 → 进设置页（设置只从大厅进）
       设置/搜索/歌单：液化成返回箭头 → 回大厅（顺手清掉搜索词）
     --------------------------------------------------------------- */
  let topLeftMode = 'settings';
  function setTopLeftMode(mode) {
    if (topLeftMode === mode) return;
    topLeftMode = mode;
    const box = document.querySelector('.topbar__left');
    if (box) box.classList.toggle('is-back', mode === 'back');
    panelBtn.setAttribute('aria-label', mode === 'back' ? '返回大厅' : '设置');
  }
  function backToHall() {
    if (el.search && el.search.value) el.search.value = '';
    /* 歌手页/专辑页有自己的访问栈：专辑 → 歌手 → 来源页，逐级退；回到底才回大厅 */
    if (Pages.back()) return;
    show('hall');
    /* 回大厅直接落回顶部，不做平滑滚动：返回那一段本来就是视图入场过渡，
       再加一条整页平滑滚动，铺色底的背景模糊每帧都要跟着重采样，
       桌面壳里很容易在这一下卡死。视觉上「回来就是顶部」，没有损失。 */
    if (el.viewHall) el.viewHall.scrollTo(0, 0);
  }
  panelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (topLeftMode === 'back') { backToHall(); return; }   // 设置页里左键就是「返回」
    openSettings();
  });

  /* 账号管理 / 或粘贴 Cookie / 登录：都开同一个登录弹窗（扫码 · Cookie 都在里面），
     直接调 openModal()，不复制登录逻辑。 */
  function openLoginModal(focusCookie) {
    if (profile) return;               // 已登录就不再弹登录框（要退出请用「退出」）
    openModal();
    if (!focusCookie) return;
    requestAnimationFrame(() => {
      const t = document.getElementById('cookie-input');
      if (t && t.focus) t.focus();
    });
  }
  $('row-cookie').addEventListener('click', () => openLoginModal(true));
  $('set-account-login').addEventListener('click', () => openLoginModal(false));
  /* 「退出」必须显式调 logout() */
  $('set-account-logout').addEventListener('click', () => { if (profile) logout(); });

  /* 同一时间只留一块二维码：QQ 和「其它音源」是两套独立轮询，各自不会关对方。
     这两个监听注册在模块自己的监听**之后**，所以刚点开的那块不会被自己关掉。 */
  ['qq-login', 'kugou-login', 'qishui-login', 'bodian-login'].forEach((id) => {
    $(id).addEventListener('click', () => {
      if (id === 'qq-login') { try { Sources.closeQr(); } catch { /* 还没定义 */ } }
      else { try { QQ.pause(); } catch { /* 还没定义 */ } }
    });
  });

  /* ------------------------------------------------------------------
     音效（两个入口，一套内容）
       设置页「音效」→ 整页 #view-audio（沿用 hall/lab 的视图约定）
       播放页抽屉「音效 / 均衡器」→ 半页覆盖（eq-ui.js 自己建，从底部滑出）
     DOM 和画布都在 public/audio/eq-ui.js / eq-engine.js 里，这里只做接线。
     ------------------------------------------------------------------ */
  function openAudioPage() {
    show('audio');
    if (typeof EqUI !== 'undefined') EqUI.openPage();
    const v = el.viewAudio;
    if (v && v.scrollTo) v.scrollTo({ top: 0 });
  }
  function audioSummary() {
    if (typeof EqEngine === 'undefined') return;
    const q = EqEngine.QUALITIES.find((x) => x.id === EqEngine.quality);
    const p = EqEngine.PRESETS.find((x) => x.id === EqEngine.state.simple.preset);
    const t = $('set-audio');
    if (t && t.textContent !== undefined) t.textContent = `${q ? q.label : EqEngine.quality} · ${p ? p.name : '自定义'}`;
  }
  $('row-audio').addEventListener('click', openAudioPage);

  /* ---- 我的专辑展示形态（侧立 3D 架 / 正面 Cover Flow）----
     渲染全在 pages/myalbums.js 里，这里只做这一行的读写：
     值存 localStorage['lizi.myAlbums.form']（'spine' | 'flow'，缺省 spine），
     点一下写库 + 刷字，再发 lizi:ma-form 让架子那边就地重排（不刷新、不跳页）。 */
  const MA_FORM_KEY = 'lizi.myAlbums.form';
  const MA_FORM_LABEL = { spine: '侧立 3D', flow: '正面 Cover Flow' };
  function maForm() {
    try { return localStorage.getItem(MA_FORM_KEY) === 'flow' ? 'flow' : 'spine'; } catch { return 'spine'; }
  }
  function paintMaForm() {
    const t = $('set-maform');
    if (t && t.textContent !== undefined) t.textContent = MA_FORM_LABEL[maForm()];
  }
  $('row-maform').addEventListener('click', () => {
    const next = maForm() === 'spine' ? 'flow' : 'spine';
    try { localStorage.setItem(MA_FORM_KEY, next); } catch { /* 写不进去也只影响下次启动 */ }
    paintMaForm();
    document.dispatchEvent(new CustomEvent('lizi:ma-form', { detail: { form: next } }));
  });
  paintMaForm();

  /* ---- 大厅铺色态「每日推荐」跑马带速度 ----
     0–100 的滑杆，存 localStorage['lizi.hall.marq.speed']，默认 24（≈0.36 px/帧）。
     真正跑的是 Hall 里的 marqSpeedPx；这里只管写值 + 通知 Hall 立刻换速度
     （设置页和大厅是两个视图，不重载）。 */
  const MARQ_SPEED_KEY = 'lizi.hall.marq.speed';
  const MARQ_SPEED_DEFAULT = 24;
  function marqSpeedStored() {
    try {
      const raw = localStorage.getItem(MARQ_SPEED_KEY);
      /* 没存过时 getItem 是 null，Number(null) === 0 —— 不先挡住会当成「拖到最慢」 */
      if (raw === null || raw === '') return MARQ_SPEED_DEFAULT;
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v);
    } catch { /* 隐私模式：用默认值 */ }
    return MARQ_SPEED_DEFAULT;
  }
  const marqSpeedLabel = (v) => (v < 34 ? '慢' : v < 68 ? '标准' : '快');
  function paintMarqSpeed() {
    const v = marqSpeedStored();
    const i = $('set-marq-speed');
    const t = $('set-marq-speed-val');
    if (i && i.value !== undefined) i.value = String(v);
    if (t && t.textContent !== undefined) t.textContent = marqSpeedLabel(v);
  }
  $('set-marq-speed').addEventListener('input', (e) => {
    const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
    try { localStorage.setItem(MARQ_SPEED_KEY, String(v)); } catch { /* 只影响下次启动 */ }
    const t = $('set-marq-speed-val');
    if (t && t.textContent !== undefined) t.textContent = marqSpeedLabel(v);
    Hall.setMarqSpeed(v);              // 大厅那边下一帧就按新速度走
  });
  paintMarqSpeed();

  /* ---- 铺色面板外观（lizi.hall.look）----
     设置页「外观」里的可视化层级编辑器：左边 5 层合成栈，右边选中层参数，
     下面 220×140 假面板实时预览。所有参数只写 CSS 自定义属性（--look-*），
     写到 :root 后 #hall-plat / .hall-marq / 预览块一起继承，改一个数字立刻生效。
     存档是 JSON；眼睛开关只活在本页，不写 localStorage（「临时隐藏看对比」）。 */
  const LOOK_KEY = 'lizi.hall.look';
  const LOOK_DEFAULTS = {
    bgfxPreset: 'grainient',
    /* 同源 = 沿用封面原本的色相；撞色 = OKLCH 色相 +180°。默认同源，现有观感不变。 */
    paletteMode: 'same',
    l1: { top: 6, bottom: 16, angle: 158 },
    l2: { on: 1, op: 72, sat: 100 },
    l3: { blur: 22, sat: 106, veil: 5.5 },
    l4: { top: 12, corner: 16, ring: 16 },
    l5: { on: 1, bg: 7, ring: 13, radius: 16 },
  };
  /* 预设清单的本地兜底：registry.js 还没注入完时，L2 也能先画出 8 个选项 */
  const BGFX_PRESET_FALLBACK = [
    { id: 'grainient', cn: '流色' },
    { id: 'aurora', cn: '极光' },
    { id: 'beams', cn: '光带' },
    { id: 'darkveil', cn: '暗纱' },
    { id: 'gradient-waves', cn: '浪潮' },
    { id: 'iridescence', cn: '虹彩' },
    { id: 'liquid-chrome', cn: '液态铬' },
    { id: 'silk', cn: '丝绸' },
  ];
  const BGFX_PRESET_IDS = new Set(BGFX_PRESET_FALLBACK.map((p) => p.id));
  let bgfxRegPromise = null;

  /** registry.js 没在 index.html 里静态引入（只允许改 app.js/css），这里按需注入一次。 */
  function ensureBgfxRegistry() {
    if (window.LIZI_BGFX) return Promise.resolve(window.LIZI_BGFX);
    if (bgfxRegPromise) return bgfxRegPromise;
    bgfxRegPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'hall/bgfx/registry.js';
      s.async = true;
      s.setAttribute('data-lizi-bgfx-registry', '1');
      s.onload = () => resolve(window.LIZI_BGFX || null);
      s.onerror = () => {
        bgfxRegPromise = null;
        try { s.remove(); } catch { /* 忽略 */ }
        reject(new Error('LIZI_BGFX registry failed to load'));
      };
      document.head.appendChild(s);
    });
    return bgfxRegPromise;
  }
  function bgfxPresetList() {
    const api = window.LIZI_BGFX;
    if (api && typeof api.list === 'function') {
      try {
        return api.list().map((p) => ({ id: p.id, cn: p.cn || p.name || p.id }));
      } catch { /* 落到本地清单 */ }
    }
    return BGFX_PRESET_FALLBACK;
  }
  const LOOK_LAYERS = [
    { id: 'l1', name: '底色渐变', params: [
      { k: 'top', label: '亮部强度', min: 0, max: 30, step: 1, unit: '%' },
      { k: 'bottom', label: '暗部强度', min: 0, max: 30, step: 1, unit: '%' },
      { k: 'angle', label: '角度', min: 90, max: 180, step: 1, unit: 'deg' },
    ] },
    { id: 'l2', name: '流色', sw: { k: 'on', label: '启用流色' }, params: [
      { k: 'op', label: '不透明度', min: 0, max: 100, step: 1, unit: '%' },
      { k: 'sat', label: '饱和度', min: 0, max: 200, step: 1, unit: '%' },
    ] },
    { id: 'l3', name: '模糊层', params: [
      { k: 'blur', label: '模糊半径', min: 0, max: 40, step: 1, unit: 'px' },
      { k: 'sat', label: '饱和度', min: 0, max: 150, step: 1, unit: '%' },
      { k: 'veil', label: '上下灰蒙', min: 0, max: 10, step: 0.5, unit: '%' },
    ] },
    { id: 'l4', name: '高光 / 边缘光', params: [
      { k: 'top', label: '顶部高光', min: 0, max: 25, step: 1, unit: '%' },
      { k: 'corner', label: '暗角强度', min: 0, max: 35, step: 1, unit: '%' },
      { k: 'ring', label: '内描边', min: 0, max: 30, step: 1, unit: '%' },
    ] },
    { id: 'l5', name: '跑马带玻璃框', sw: { k: 'on', label: '开启玻璃框' }, params: [
      { k: 'bg', label: '底色不透明度', min: 0, max: 20, step: 1, unit: '%' },
      { k: 'ring', label: '内描边', min: 0, max: 25, step: 1, unit: '%' },
      { k: 'radius', label: '圆角', min: 0, max: 24, step: 1, unit: 'px' },
    ] },
  ];
  const lookClone = (v) => JSON.parse(JSON.stringify(v));
  let lookState = lookClone(LOOK_DEFAULTS);
  const lookEyes = { l1: true, l2: true, l3: true, l4: true, l5: true };
  let lookSel = 'l1';
  let lookMounted = false;
  /* lookMount 挂载后填上：每次 lookApply 写完 CSS 变量，顺手刷新层列表右侧的摘要 */
  let lookSumUpdater = null;

  function lookParamDef(id, k) {
    const layer = LOOK_LAYERS.find((l) => l.id === id);
    return layer && layer.params.find((p) => p.k === k);
  }
  function lookRead() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object') return;
    /* bgfxPreset 是顶层字段；旧数据没有就保持 grainient。
       显式空串 = 用户后来在旧「背景效果」选择器里切过，L2 不点亮任何预设。 */
    if (typeof raw.bgfxPreset === 'string') {
      lookState.bgfxPreset = (raw.bgfxPreset === '' || BGFX_PRESET_IDS.has(raw.bgfxPreset))
        ? raw.bgfxPreset : 'grainient';
    }
    if (raw.paletteMode === 'cross' || raw.paletteMode === 'same') {
      lookState.paletteMode = raw.paletteMode;
    }
    LOOK_LAYERS.forEach((layer) => {
      const src = raw[layer.id];
      if (!src || typeof src !== 'object') return;
      layer.params.forEach((p) => {
        const n = Number(src[p.k]);
        if (Number.isFinite(n)) lookState[layer.id][p.k] = Math.min(p.max, Math.max(p.min, n));
      });
      if (layer.sw) {
        const n = Number(src[layer.sw.k]);
        if (Number.isFinite(n)) lookState[layer.id][layer.sw.k] = n ? 1 : 0;
      }
    });
  }
  function lookSave() {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(lookState)); } catch { /* 隐私模式：本次仍生效 */ }
  }
  /* human 单位 → CSS 变量；根节点继承给 #hall-plat / .hall-marq / 预览块 */
  function lookApply() {
    const s = document.documentElement.style;
    const L = lookState;
    s.setProperty('--look-l1-on', lookEyes.l1 ? '1' : '0');
    s.setProperty('--look-l1-top', L.l1.top + '%');
    s.setProperty('--look-l1-bottom', L.l1.bottom + '%');
    s.setProperty('--look-l1-angle', L.l1.angle + 'deg');
    s.setProperty('--look-l2-on', L.l2.on ? '1' : '0');
    s.setProperty('--look-l2-eye', lookEyes.l2 ? '1' : '0');
    s.setProperty('--look-l2-op', String(L.l2.op / 100));
    s.setProperty('--look-l2-sat', String(L.l2.sat / 100));
    s.setProperty('--look-l3-on', lookEyes.l3 ? '1' : '0');
    s.setProperty('--look-l3-blur', L.l3.blur + 'px');
    s.setProperty('--look-l3-sat', String(L.l3.sat / 100));
    s.setProperty('--look-l3-veil-top', L.l3.veil + '%');
    s.setProperty('--look-l3-veil-bottom', (L.l3.veil * 1.2727).toFixed(2) + '%');
    s.setProperty('--look-l4-on', lookEyes.l4 ? '1' : '0');
    s.setProperty('--look-l4-top', L.l4.top + '%');
    s.setProperty('--look-l4-corner', L.l4.corner + '%');
    s.setProperty('--look-l4-ring', L.l4.ring + '%');
    s.setProperty('--look-frame-on', L.l5.on ? '1' : '0');
    s.setProperty('--look-frame-eye', lookEyes.l5 ? '1' : '0');
    s.setProperty('--look-frame-bg', L.l5.bg + '%');
    s.setProperty('--look-frame-ring', L.l5.ring + '%');
    s.setProperty('--look-frame-radius', L.l5.radius + 'px');
    /* 层列表上的摘要跟着当前值走（挂载前是 null，启动时那次 lookApply 不会报错） */
    if (lookSumUpdater) lookSumUpdater();
  }
  function lookLayer(id) { return LOOK_LAYERS.find((l) => l.id === id) || LOOK_LAYERS[0]; }

  function lookMount() {
    if (lookMounted) return;
    const sec = document.getElementById('set-sec-look');
    if (!sec) return;
    const wrap = document.createElement('div');
    wrap.className = 'lookedit';
    wrap.id = 'set-hall-look';
    wrap.innerHTML = `<div class="lookedit__viz">
        <div class="lookstack" role="listbox" aria-label="铺色面板合成层">
          ${LOOK_LAYERS.map((l, i) => `
            <div class="lookstack__row" role="option" tabindex="0" data-layer="${l.id}" aria-selected="false">
              <span class="lookstack__tag">L${i + 1}</span>
              <span class="lookstack__name">${l.name}</span>
              <span class="lookstack__sum" data-sum="${l.id}">${lookSumText(l)}</span>
              <button class="lookstack__eye" type="button" data-eye="${l.id}"
                      aria-pressed="true" aria-label="临时隐藏 ${l.name}" title="临时隐藏 / 显示">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12s3.6-6.2 9.8-6.2S21.8 12 21.8 12s-3.6 6.2-9.8 6.2S2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>
              </button>
            </div>`).join('')}
        </div>
        <div class="lookprev" aria-label="铺色面板实时预览">
          <div class="lookprev__panel">
            <div class="lookprev__grain" aria-hidden="true"></div>
            <div class="lookprev__blur" aria-hidden="true"></div>
            <div class="lookprev__bar" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="lookprev__marq" aria-hidden="true"><div class="lookprev__track">
              <span class="lookprev__card"></span><span class="lookprev__card"></span><span class="lookprev__card"></span>
              <span class="lookprev__card"></span><span class="lookprev__card"></span><span class="lookprev__card"></span>
            </div></div>
          </div>
        </div>
      </div>
      <div class="lookedit__side">
        <div class="lookedit__head">
          <b id="look-title">L1 底色渐变</b>
          <button class="lookedit__reset" id="look-reset" type="button">恢复默认</button>
        </div>
        <div class="lookmode">
          <span class="lookmode__l">配色</span>
          <div class="lookmode__seg" role="group" aria-label="铺色配色">
            <button class="lookmode__b" type="button" data-palette-mode="same">同源</button>
            <button class="lookmode__b" type="button" data-palette-mode="cross">撞色</button>
          </div>
        </div>
        <div id="look-params"></div>
        <p class="lookedit__note">眼睛只临时隐藏这一层，方便对比；滑块与开关会保存到本机。</p>
      </div>`;
    /* 单独成「铺色面板外观」一节（设置页现有卡片体系），放在「外观」后面、「关于」前面；
       导航按钮同步加一项，观察器 / 点击滚动都复用 setconsole 那一套。 */
    let panelSec = document.getElementById('set-sec-lookpanel');
    if (!panelSec) {
      panelSec = document.createElement('section');
      panelSec.className = 'setpage__sec setcard setcard--wide';
      panelSec.id = 'set-sec-lookpanel';
      panelSec.setAttribute('aria-labelledby', 'setpage-h-lookpanel');
      panelSec.innerHTML = `<h2 class="setpage__h" id="setpage-h-lookpanel">铺色面板外观</h2>
        <p class="setpage__note">按合成层调铺色面板：左边点一层，右边改参数，下面实时预览。眼睛只临时隐藏，滑块会保存。</p>`;
      const about = document.getElementById('set-sec-about');
      const grid = about && about.parentNode;
      if (grid) grid.insertBefore(panelSec, about);
      else sec.parentNode.appendChild(panelSec);
      if (setNav) {
        const aboutBtn = setNav.querySelector('[data-sec="set-sec-about"]');
        const btn = document.createElement('button');
        btn.className = 'setnav__item';
        btn.type = 'button';
        btn.dataset.sec = 'set-sec-lookpanel';
        btn.innerHTML = `<svg class="setnav__ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8.5 12 4l8 4.5-8 4.5Z"/><path d="M4 12.5 12 17l8-4.5"/><path d="M4 16.5 12 21l8-4.5"/></svg>
          <span class="setnav__label">铺色面板</span>`;
        if (aboutBtn && aboutBtn.parentNode === setNav) setNav.insertBefore(btn, aboutBtn);
        else setNav.appendChild(btn);
        setNavBtns.push(btn);
      }
      setCards.push(panelSec);
      setupSettingsConsole();
      if (setObserver) {
        try { setObserver.observe(panelSec); } catch { /* 老环境 */ }
      }
    }
    panelSec.appendChild(wrap);
    lookMounted = true;

    const stack = wrap.querySelector('.lookstack');
    const params = wrap.querySelector('#look-params');
    const title = wrap.querySelector('#look-title');

    /** 层列表右侧的摘要：开关层先写「开/关」，再按参数顺序列当前值，
        例：L1 → 6% · 16% · 158°，L2 → 开 · 72% · 100%。
        数据只来自 lookState，避免和滑杆显示的两套数字打架。 */
    function lookSumText(layer) {
      const st = lookState[layer.id] || {};
      const parts = [];
      if (layer.sw) parts.push(st[layer.sw.k] ? '开' : '关');
      layer.params.forEach((p) => parts.push(lookFmt(st[p.k], p.unit)));
      return parts.join(' · ');
    }
    /* lookApply 在每次滑块 / 开关 / 恢复默认后都跑，这里把摘要一次全刷。
       放在 lookMount 里赋值：设置页没打开时不需要这层 DOM 开销。 */
    lookSumUpdater = () => {
      stack.querySelectorAll('[data-sum]').forEach((el) => {
        const layer = LOOK_LAYERS.find((l) => l.id === el.dataset.sum);
        if (layer) el.textContent = lookSumText(layer);
      });
    };

    function syncEyes() {
      stack.querySelectorAll('[data-eye]').forEach((b) => {
        const on = lookEyes[b.dataset.eye] !== false;
        b.setAttribute('aria-pressed', String(on));
        const card = b.closest('.lookstack__row');
        if (card) card.dataset.hidden = on ? '0' : '1';
      });
    }
    function syncPaletteMode() {
      const mode = lookState.paletteMode === 'cross' ? 'cross' : 'same';
      wrap.querySelectorAll('[data-palette-mode]').forEach((b) => {
        const on = b.dataset.paletteMode === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    wrap.querySelector('.lookmode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-palette-mode]');
      if (!b) return;
      const mode = b.dataset.paletteMode === 'cross' ? 'cross' : 'same';
      if (lookState.paletteMode === mode) return;
      lookState.paletteMode = mode;
      lookSave();
      syncPaletteMode();
      document.dispatchEvent(new CustomEvent('lizi:palette-mode', { detail: { mode } }));
    });
    function selectLayer(id) {
      lookSel = id;
      const layer = lookLayer(id);
      stack.querySelectorAll('.lookstack__row').forEach((el) => {
        const on = el.dataset.layer === id;
        el.classList.toggle('is-sel', on);
        el.setAttribute('aria-selected', String(on));
      });
      title.textContent = `L${LOOK_LAYERS.indexOf(layer) + 1} ${layer.name}`;
      /* 预览块按当前预设换 CSS 渐变示意（不跑 WebGL） */
      const prev = wrap.querySelector('.lookprev');
      if (prev) prev.dataset.preset = lookState.bgfxPreset || 'grainient';
      const rows = [];
      if (layer.id === 'l2') {
        const cur = lookState.bgfxPreset || '';
        const list = bgfxPresetList();
        rows.push(`<div class="lookpreset">
          <div class="lookpreset__top">
            <span class="lookpreset__l">流色预设</span>
            <span class="lookpreset__cur">${cur ? (list.find((p) => p.id === cur) || {}).cn || cur : '旧背景效果'}</span>
          </div>
          <div class="lookpreset__grid" role="radiogroup" aria-label="流色预设">
            ${list.map((p) => `<button class="lookpreset__i" type="button" role="radio"
              data-preset="${p.id}" aria-checked="${p.id === cur}" title="${p.cn} ${p.id}">
              <i class="lookpreset__sw" data-p="${p.id}" aria-hidden="true"></i><span>${p.cn}</span>
            </button>`).join('')}
          </div>
        </div>`);
      }
      if (layer.sw) {
        rows.push(`<div class="lookparam">
          <div class="lookparam__top">
            <span class="lookparam__l">${layer.sw.label}</span>
            <button class="lookparam__switch" type="button" role="switch"
              data-look-switch="${layer.sw.k}" aria-checked="${lookState[layer.id][layer.sw.k] ? 'true' : 'false'}"
              aria-label="${layer.sw.label}"></button>
          </div>
        </div>`);
      }
      layer.params.forEach((p) => {
        const v = lookState[layer.id][p.k];
        rows.push(`<div class="lookparam">
          <div class="lookparam__top">
            <span class="lookparam__l">${p.label}</span>
            <span class="lookparam__v">${lookFmt(v, p.unit)}</span>
          </div>
          <input class="lookparam__r" type="range" min="${p.min}" max="${p.max}" step="${p.step}"
            value="${v}" data-look-k="${p.k}" aria-label="${p.label}">
        </div>`);
      });
      params.innerHTML = rows.join('');
    }
    function lookFmt(v, unit) {
      if (unit === 'deg') return v + '°';
      if (unit === 'px') return v + 'px';
      return v + '%';
    }
    params.addEventListener('input', (e) => {
      const r = e.target.closest('[data-look-k]');
      if (!r) return;
      const p = lookParamDef(lookSel, r.dataset.lookK);
      if (!p) return;
      const n = Math.min(p.max, Math.max(p.min, Number(r.value)));
      lookState[lookSel][p.k] = n;
      const out = r.closest('.lookparam').querySelector('.lookparam__v');
      if (out) out.textContent = lookFmt(n, p.unit);
      lookApply();
      lookSave();
    });
    params.addEventListener('click', (e) => {
      const pb = e.target.closest('[data-preset]');
      if (pb) {
        const id = pb.dataset.preset;
        if (!BGFX_PRESET_IDS.has(id)) return;
        /* 先落库再广播：Hall 收到后销毁旧实例、挂新预设；失败会回退 grainient */
        document.dispatchEvent(new CustomEvent('lizi:bgfx-preset', { detail: { id } }));
        return;
      }
      const sw = e.target.closest('[data-look-switch]');
      if (!sw) return;
      const k = sw.dataset.lookSwitch;
      lookState[lookSel][k] = lookState[lookSel][k] ? 0 : 1;
      sw.setAttribute('aria-checked', lookState[lookSel][k] ? 'true' : 'false');
      lookApply();
      lookSave();
    });
    /* Hall 的预设实例回退 / 旧「背景效果」选择器切走时，同步 L2 的高亮与存档 */
    document.addEventListener('lizi:bgfx-preset', (e) => {
      const d = e.detail || {};
      if (typeof d.id !== 'string') return;
      lookState.bgfxPreset = d.id;
      lookSave();
      const pv = wrap.querySelector('.lookprev');
      if (pv) pv.dataset.preset = d.id || 'grainient';
      if (lookSel === 'l2') selectLayer('l2');
    });
    stack.addEventListener('click', (e) => {
      const eye = e.target.closest('[data-eye]');
      if (eye) {
        e.stopPropagation();
        const id = eye.dataset.eye;
        lookEyes[id] = !lookEyes[id];
        syncEyes();
        lookApply();
        return;
      }
      const card = e.target.closest('[data-layer]');
      if (card) selectLayer(card.dataset.layer);
    });
    stack.addEventListener('keydown', (e) => {
      const card = e.target.closest('[data-layer]');
      if (!card || e.target.closest('[data-eye]')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectLayer(card.dataset.layer);
    });
    wrap.querySelector('#look-reset').addEventListener('click', () => {
      lookState = lookClone(LOOK_DEFAULTS);
      Object.keys(lookEyes).forEach((k) => { lookEyes[k] = true; });
      lookApply();
      lookSave();
      syncEyes();
      syncPaletteMode();
      selectLayer(lookSel);
      document.dispatchEvent(new CustomEvent('lizi:bgfx-preset', { detail: { id: lookState.bgfxPreset } }));
      document.dispatchEvent(new CustomEvent('lizi:palette-mode', { detail: { mode: lookState.paletteMode } }));
    });

    lookRead();
    lookApply();
    syncEyes();
    syncPaletteMode();
    selectLayer(lookSel);
  }
  /* 启动时先应用存档（还没进设置页也要让大厅铺色面板按用户调好的样子显示） */
  lookRead();
  lookApply();
  lookMount();

  /* ---- 主页背景（大厅「我的」卡上那块横幅）----
     这里只管「来源」：localStorage['lizi.hall.me.bg'] = { kind:'image'|'video', url }。
     真正往 DOM 上画的是大厅那边的 meApplyBanner（渐变 / 图片 / 视频 + 3s 超时兜底），
     所以这里改完只发 lizi:mebg 让它就地重铺 —— 不重拉接口、不跳页（同 lizi:ma-form）。
     优先级：自定义 > 网易云自己的背景 > 默认渐变（网易云的公用星空图不算"自己的"）。
     本地文件走 URL.createObjectURL：blob: 只活在这次会话，不上传、不同步、刷新要重选。 */
  const ME_BG_KEY = 'lizi.hall.me.bg';
  const ME_BG_LABEL = { 'custom-image': '自定义', 'custom-video': '自定义', netease: '网易云', gradient: '默认渐变' };
  /* 兼容清理：曾经有过「从我的视频里挑」的入口，存的是
     { kind:'video', source:'netease-video', vid }（没有 url）。
     那个入口已经拆掉（上游 video/timeline/all 是推荐时间线，不是用户自己的视频），
     启动时把这种残留清掉、让大厅回落到网易云背景 / 渐变，免得还停在一帧陌生视频上。
     只认 source 标记，正常的 { kind, url } 一根手指都不碰。 */
  try {
    const stale = JSON.parse(localStorage.getItem(ME_BG_KEY) || 'null');
    if (stale && stale.source === 'netease-video') localStorage.removeItem(ME_BG_KEY);
  } catch { /* 坏 JSON 本来就会被 mebgRead 当成没设置 */ }
  function mebgRead() {
    try {
      const v = JSON.parse(localStorage.getItem(ME_BG_KEY) || 'null');
      if (v && (v.kind === 'image' || v.kind === 'video') && typeof v.url === 'string' && v.url) return v;
    } catch { /* 坏 JSON / 隐私模式 → 当没设置 */ }
    return null;
  }
  /** 当前来源：自定义 > 大厅卡实际画出来的那种 > 默认渐变 */
  function mebgLabel() {
    if (mebgRead()) return '自定义';
    const b = document.querySelector('#hall-me .me__slide.is-on .me__banner')
      || document.querySelector('#hall-me .me__banner');
    return (b && ME_BG_LABEL[b.getAttribute('data-bgkind')]) || '默认渐变';
  }
  function paintMebg() {
    const t = $('set-mebg');
    if (t && t.textContent !== undefined) t.textContent = mebgLabel();
  }
  function mebgSay(msg) {
    const s = $('mebg-state');
    if (!s || s.textContent === undefined) return;
    s.textContent = msg || '';
    s.hidden = !msg;
  }
  function mebgSet(kind, url) {
    try {
      if (url) localStorage.setItem(ME_BG_KEY, JSON.stringify({ kind, url }));
      else localStorage.removeItem(ME_BG_KEY);
    } catch { /* 写不进去只影响下次启动 */ }
    /* 先让大厅重铺（它会改 banner 的 data-bgkind），再读回来刷新这一行的值 ——
       反过来的话读到的是上一次的 kind，清除后还显示「自定义」 */
    document.dispatchEvent(new CustomEvent('lizi:mebg', { detail: { kind: kind || '', url: url || '' } }));
    paintMebg();
  }
  const mebgPanel = $('mebg-panel');
  const mebgRow = $('row-mebg');
  function mebgOpen(on) {
    mebgPanel.hidden = !on;
    mebgRow.setAttribute('aria-expanded', String(!!on));
    if (!on) return;
    const i = $('mebg-url');
    if (i && i.focus) i.focus();
  }
  mebgRow.addEventListener('click', () => mebgOpen(!!mebgPanel.hidden));
  /** 地址 / 文件二选一：视频前缀或视频扩展名 → video，其它都当图片 */
  function mebgKindOf(u) {
    return /^data:video\//i.test(u) || /\.(mp4|webm|ogv|m4v|mov)(?:[?#]|$)/i.test(u) ? 'video' : 'image';
  }
  function mebgApplyUrl() {
    const i = $('mebg-url');
    const url = String((i && i.value) || '').trim();
    if (!url) { mebgSay('先粘一个图片或视频地址'); return; }
    if (!/^(https?:|data:|blob:)/i.test(url)) { mebgSay('地址要以 http(s):// 或 data: 开头'); return; }
    const kind = mebgKindOf(url);
    mebgSet(kind, url);
    mebgSay('已设为自定义' + (kind === 'video' ? '视频' : '图片') + ' · 大厅「我的」卡立即生效');
  }
  $('mebg-apply').addEventListener('click', mebgApplyUrl);
  $('mebg-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); mebgApplyUrl(); }
  });
  $('mebg-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const kind = /^video\//i.test(f.type) ? 'video' : 'image';
    let url = '';
    try { url = URL.createObjectURL(f); } catch { url = ''; }   /* 只在本机、只活这次会话 */
    if (!url) { mebgSay('这个文件读不了，换一个试试'); return; }
    mebgSet(kind, url);
    mebgSay('已用本地' + (kind === 'video' ? '视频' : '图片') + '「' + (f.name || '未命名')
      + '」· 不上传、不同步，刷新后要重新选');
    e.target.value = '';                    /* 同一个文件再选一次也要能触发 */
  });
  $('mebg-clear').addEventListener('click', () => {
    mebgSet('', '');
    const i = $('mebg-url');
    if (i) i.value = '';
    mebgSay('已清除，回到自动（网易云自定义背景 / 默认渐变）');
  });

  paintMebg();

  $('btn-eq-sheet').addEventListener('click', () => {
    if (typeof EqUI === 'undefined') return;
    setDrawer(false);                 // 抽屉先收回去，别让两层浮层叠着
    EqUI.openSheet();
  });

  /* 播放队列：在歌词面板里就地切换（歌词 ↔ 队列），不是新开一层
     —— 旧版 #now-tabs 被删后 #queue 一直没有入口，renderQueue 成了死代码。
     这里用 $() 现查，不抓后文才初始化的 const：show() 早期也可能调 setQueuePane(false)。 */
  const btnQueue = $('btn-queue');
  function updateQueueCount() {
    const n = (Player.state.queue || []).length;
    const c = $('queue-count');
    if (c && c.textContent !== undefined) c.textContent = n ? `${n} 首` : '—';
  }
  function setQueuePane(on) {
    on = !!on;
    const qb = $('queue');
    const lb = $('lyrics');
    const bq = $('btn-queue');
    qb.hidden = !on;
    lb.hidden = on;
    bq.setAttribute('aria-pressed', String(on));
    if (on) renderQueue();          // 队列会随播放变化，每次打开都重排
    updateQueueCount();
  }
  if (btnQueue && btnQueue.addEventListener) {
    btnQueue.addEventListener('click', () => {
      const open = $('queue').hidden;       // 当前收起 → 这次是打开
      setDrawer(false);                     // 抽屉先收回去，别和面板叠着
      setQueuePane(open);
    });
  }
  updateQueueCount();
  /* 「音质 · 预设」那一行：启动时先填一次，之后每次进设置页由 openSettings() 刷（见上） */
  audioSummary();

  /* ---- 形态渲染分辨率：iframe 缩小再放大，像素数按 s² 掉 ----
     形态都按视口建 canvas，改不了它们内部，这是唯一通用的降负载开关。 */
  {
    const box = $('stage-quality');
    const KEY = 'lizi.stageQuality';
    const apply = (q) => {
      const v = Math.min(1, Math.max(0.45, Number(q) || 1));
      document.documentElement.style.setProperty('--stage-scale', String(v));
      try { localStorage.setItem(KEY, String(v)); } catch { /* 忽略 */ }
      box.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('is-on', Math.abs(Number(b.dataset.q) - v) < 0.01));
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) apply(b.dataset.q);
    });
    /* 画质固定 100%（用户要求：默认就是原生分辨率，不再给选） */
    apply(1);
  }

  /* ---- DIY：播放页四个滑杆，值写进 :root 的自定义属性并存 localStorage ---- */
  document.querySelectorAll('.diy').forEach((box) => {
    const inp = box.querySelector('.sl');
    const out = box.querySelector('.diy__val');
    const varName = box.dataset.var;
    const unit = box.dataset.unit || '';
    const key = 'lizi.diy.v2.' + varName;
    const apply = (v) => {
      document.documentElement.style.setProperty(varName, unit === '%' ? String(+v / 100) : v + 'px');
      out.textContent = unit === '%' ? v + '%' : v + 'px';
    };
    const saved = localStorage.getItem(key);
    if (saved != null) inp.value = saved;
    apply(inp.value);
    inp.addEventListener('input', () => {
      apply(inp.value);
      localStorage.setItem(key, inp.value);
      /* 播放页正开着时，改封面大小/间距会移动"封面中心"这个锚点，
         当前歌词行要重新对齐一次，不然会错位 */
      const act = el.lyrics.querySelector('.ly.is-active');
      alignArtToLyrics();
      if (act && view === 'now') { lyUserAt = 0; scrollLyricToEl(act); }
    });
  });

  /* ---- 形态长廊：球面画廊 ----
     626 个形态铺在一颗球面上，不是平面墙：
       · 经度 33 列（11 组 × 3 格，组内 2:1 + 1:1 + 1:1 / 1:1 + 1:1 + 2:1 交替，
         组间留白），纬度 19 行，共 627 个槽位
       · (lon, lat) → 单位球坐标 → yaw/pitch → 透视投影 → 屏幕上的
         translate3d(...) scale(...) rotateY(...)
       · 横向无限转（经度取模），纵向夹在 ±80°
       · 每格一个实时 iframe，只给朝前、在视口内、靠近镜头的一小撮挂载
     切换形态仍然藏在圆形蒙版后面。 */
  const pick = $('stage-pick');
  const pickGrid = $('stage-pick-grid');
  const pickScroll = $('stage-pick-scroll');
  const pickSub = $('stage-pick-sub');
  const pickTabs = $('stage-pick-tabs');
  const pickEmpty = $('stage-pick-empty');
  const pickEmptyT = $('stage-pick-empty-t');
  const pickEmptyD = $('stage-pick-empty-d');
  const pickSearch = $('stage-pick-search');
  const pickSearchBtn = $('stage-pick-search-btn');
  const pickQ = $('stage-pick-q');
  const pickClear = $('stage-pick-clear');
  const pickPreview = $('stage-pick-preview');
  const pickPreviewStage = $('stage-pick-preview-stage');
  const pickPreviewFrame = $('stage-pick-preview-frame');
  const pickPreviewNum = $('stage-pick-preview-num');
  const pickPreviewId = $('stage-pick-preview-id');
  const pickPreviewName = $('stage-pick-preview-name');
  const pickPreviewDesc = $('stage-pick-preview-desc');
  const pickPreviewSong = $('stage-pick-preview-song');
  const pickPreviewFail = $('stage-pick-preview-fail');
  const menuBtn = $('btn-stage-menu');
  const menuVal = $('stage-current');
  const iris = $('stage-iris');

  /* 传统播放器没有 canvas，不是「形态」，不放进球面；
     它仍然留在播放页抽屉的「进入形态」下拉里。 */
  /* 发行版白名单 / 开发者版全集，顺序按 STAGE_RELEASE_ORDER（见文件上方）。
     切换 edition 时重建球面；已保存的形态仍由 StageHost 按 id 加载。 */
  let PICK_STAGES = stageMenuList(false);
  let pickedStage = new Map(PICK_STAGES.map((s) => [s.id, s]));
  document.addEventListener('lizi:stage-edition', () => {
    PICK_STAGES = stageMenuList(false);
    pickedStage = new Map(PICK_STAGES.map((s) => [s.id, s]));
    if (typeof updatePickSub === 'function') updatePickSub(PICK_STAGES.length);
    if (pickOpen) applyPickFilter();
  });

  /* 球面参数：33 × 19 = 627 槽位（当前 626 个形态，留一个空位）。
     每组 3 格的经度总宽 = 4A，组间再留 0.55A。 */
  const PICK_ROWS = 19;
  const PICK_GROUPS = 11;
  const PICK_COLS = PICK_GROUPS * 3;
  const PICK_A = (Math.PI * 2) / (PICK_GROUPS * 4.55);
  const PICK_LAT_STEP = Math.PI / PICK_ROWS;
  const PICK_ROW_PATTERNS = [[2, 1, 1], [1, 1, 2]];
  const PICK_GROUP_GAP = PICK_A * 0.55;
  const PICK_H_RATIO = 0.84;
  const PICK_TAU = Math.PI * 2;
  const PICK_PITCH_MAX = (80 * Math.PI) / 180;
  const PICK_MAX_ANGLE = 0.34;          // 只给 cos(离镜头角) > 0.34 的格子挂载（约 70°）
  const PICK_RECONCILE_MS = 120;
  const PICK_VIRTUAL_W = 1280;
  const PICK_VIRTUAL_H = 800;
  const PICK_BASE_SQ_W = 160;
  const PICK_BASE_H = 176;
  const PICK_BASE_WIDE = 320;
  const PICK_TIMEOUT = 9000;
  /* DOM 由浏览器按设备像素渲染；保留 2 的上限，避免以后接 canvas 兜底时忘记 */
  const PICK_DPR = Math.min(2, window.devicePixelRatio || 1);
  const PICK_REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let pickCards = new Map();             // id -> cell
  let pickCells = [];                    // 按槽位顺序
  let pickYaw = 0;
  let pickPitch = 0;
  let pickVelYaw = 0;
  let pickVelPitch = 0;
  let pickDragging = false;
  let pickDragged = false;
  let pickCaptured = false;
  let pickDragId = 0;
  let pickDragStartX = 0;
  let pickDragStartY = 0;
  let pickDragLastX = 0;
  let pickDragLastY = 0;
  let pickLastMoveT = 0;
  let pickRaf = 0;
  let pickLastT = 0;
  let pickNeedsRender = true;
  let pickLastVisAt = 0;
  let pickSuppressClick = 0;
  let pickViewportW = 0;
  let pickViewportH = 0;
  let pickSphereR = 0;
  let pickSphereCx = 0;
  let pickSphereCy = 0;

  pickGrid.style.setProperty('--pick-dpr', String(PICK_DPR));

  /* 建球：list 已经过 tab / 搜索过滤。从赤道、正面开始向两极 / 两侧铺，
     这样搜索只剩几个结果时它们也在镜头正前方，而不是缩在极点的细缝里。
     全量 626 个时所有槽位都会填满，视觉上仍是完整的球。
     奇数行和偶数行的 2:1 位置左右交替，保持参考站 2:1 + 1:1 的混排。 */
  const PICK_ROW_ORDER = (() => {
    const mid = (PICK_ROWS - 1) / 2;
    const out = [mid];
    for (let d = 1; d < PICK_ROWS; d++) {
      if (mid + d < PICK_ROWS) out.push(mid + d);
      if (mid - d >= 0) out.push(mid - d);
    }
    return out;
  })();
  const PICK_GROUP_ORDER = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10, 0];

  function buildSphere(list) {
    pickGrid.innerHTML = '';
    pickCards = new Map();
    pickCells = [];
    let idx = 0;
    for (let r = 0; r < PICK_ROW_ORDER.length && idx < list.length; r++) {
      const row = PICK_ROW_ORDER[r];
      const lat = Math.PI / 2 - (row + 0.5) * PICK_LAT_STEP;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const pattern = PICK_ROW_PATTERNS[row % 2];
      for (let gi = 0; gi < PICK_GROUP_ORDER.length && idx < list.length; gi++) {
        const g = PICK_GROUP_ORDER[gi];
        let cellStart = -Math.PI + g * (4 * PICK_A + PICK_GROUP_GAP);
        for (let k = 0; k < 3 && idx < list.length; k++) {
          const wide = pattern[k] === 2;
          const widthAng = (wide ? 2 : 1) * PICK_A;
          const lon = cellStart + widthAng / 2;
          cellStart += widthAng;
          const s = list[idx++];
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'pickcell' + (wide ? ' pickcell--wide' : '');
          el.dataset.id = s.id;
          el.setAttribute('aria-label', s.id + ' · ' + s.name);
          el.innerHTML =
            '<span class="pickcell__art">' +
              '<span class="pickcell__on">' + '</span>' +
              '<span class="pickcell__fail">' + s.id + '</span>' +
              '<span class="pickcell__meta"><b>' + s.name + '</b><i>' + s.id + '</i></span>' +
            '</span>';
          pickGrid.appendChild(el);
          const cell = {
            id: s.id, stage: s, el, art: el.querySelector('.pickcell__art'),
            wide, widthAng, lon, lat,
            x: cosLat * Math.sin(lon), y: sinLat, z: cosLat * Math.cos(lon),
            cosLat, z2: -1, sx: 0, sy: 0, w: 0, h: 0,
            onScreen: false, failed: false,
          };
          pickCards.set(s.id, cell);
          pickCells.push(cell);
        }
      }
    }
  }

  function markCurrent(id) {
    for (const [cid, cell] of pickCards) {
      const on = cid === id;
      cell.el.classList.toggle('is-on', on);
      if (on) cell.el.setAttribute('aria-current', 'true');
      else cell.el.removeAttribute('aria-current');
    }
  }

  /* ---- 筛选 / 搜索 ----
     以后接元数据：在 STAGES 项上补 meta.featured / meta.category / meta.tags，
     这里就是唯一的筛选入口；球面、计数、空态都不用再改。
     搜索 / 切 tab 后重建整颗球并卸载全部预览。 */
  const TAB_FILTER = {
    all: () => true,
    featured: (s) => !!(s.meta && s.meta.featured),
    category: (s) => !!(s.meta && (s.meta.category || (s.meta.tags && s.meta.tags.length))),
  };

  let pickOpen = false;
  let pickTab = 'all';
  let pickQuery = '';
  let pickSearchOpen = false;
  let pickSearchTimer = 0;
  let pickReturnFocus = null;

  function stageMatches(s) {
    if (!s || !TAB_FILTER[pickTab](s)) return false;
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return (s.id + ' ' + s.name + ' ' + s.desc).toLowerCase().includes(q);
  }

  function emptyCopy() {
    if (pickTab === 'featured') return ['精选还在整理，先留空', '以后会按编辑推荐和形态元数据筛选。'];
    if (pickTab === 'category') return ['分类还在整理，先留空', '以后会按构图、配色、节奏等形态元数据分组。'];
    return ['没有匹配的形态', '换个关键词试试，或者切回「全部」。'];
  }

  function updatePickSub(n) {
    if (pickTab === 'all' && !pickQuery.trim()) pickSub.textContent = PICK_STAGES.length + ' 个形态 · 拖动旋转';
    else pickSub.textContent = '共 ' + PICK_STAGES.length + ' 个 · 匹配 ' + n + ' 个';
  }

  function centerOnCell(cell) {
    if (!cell) return;
    pickYaw = cell.lon;
    pickPitch = Math.max(-PICK_PITCH_MAX, Math.min(PICK_PITCH_MAX, cell.lat));
    pickVelYaw = 0;
    pickVelPitch = 0;
  }

  function applyPickFilter(opts) {
    const o = opts || {};
    const list = PICK_STAGES.filter(stageMatches);
    buildSphere(list);
    unmountAllGrid();
    const empty = list.length === 0;
    pickEmpty.hidden = !empty;
    if (empty) {
      const copy = emptyCopy();
      pickEmptyT.textContent = copy[0];
      pickEmptyD.textContent = copy[1];
    }
    updatePickSub(list.length);
    if (!empty && o.center !== false) {
      const curId = StageHost.current ? StageHost.current.id : '';
      centerOnCell(pickCards.get(curId) || pickCards.get(list[0].id));
    }
    markCurrent(StageHost.current ? StageHost.current.id : 'classic');
    pickNeedsRender = true;
    kickPick();
    requestAnimationFrame(() => {
      if (!pickOpen || previewing) return;
      renderSphere();
      updateVisibleSet();
    });
  }

  function setPickTab(tab) {
    if (!TAB_FILTER[tab]) tab = 'all';
    pickTab = tab;
    pickTabs.querySelectorAll('.stagepick__tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    applyPickFilter({ center: true });
  }

  function setPickSearchOpen(open) {
    pickSearchOpen = open;
    pickSearch.hidden = !open;
    pickSearchBtn.classList.toggle('is-on', open);
    pickSearchBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      requestAnimationFrame(() => {
        pickQ.focus({ preventScroll: true });
        pickQ.select();
      });
      return;
    }
    clearTimeout(pickSearchTimer);
    if (pickQ.value) {
      pickQ.value = '';
      pickQuery = '';
      applyPickFilter({ center: true });
    }
    pickSearchBtn.focus({ preventScroll: true });
  }

  function resetPickUI() {
    pickTab = 'all';
    pickTabs.querySelectorAll('.stagepick__tab').forEach((b) => {
      const on = b.dataset.tab === 'all';
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pickQuery = '';
    pickQ.value = '';
    pickSearchOpen = false;
    pickSearch.hidden = true;
    pickSearchBtn.classList.remove('is-on');
    pickSearchBtn.setAttribute('aria-expanded', 'false');
  }

  function openPick() {
    if (pickOpen) return;
    pickOpen = true;
    pickReturnFocus = document.activeElement && document.activeElement.focus ? document.activeElement : null;
    resetPickUI();
    pick.hidden = false;
    pickPreview.hidden = true;
    pickPreview.classList.remove('is-open');
    pickPreview.setAttribute('aria-hidden', 'true');
    /* 锁住底下的滚动，否则滚轮穿过面板把歌单滚走了 */
    document.documentElement.classList.add('is-picking');
    pickYaw = 0;
    pickPitch = 0;
    pickVelYaw = 0;
    pickVelPitch = 0;
    applyPickFilter({ center: true });
    startPreviewTicker();
    requestAnimationFrame(() => {
      pick.classList.add('is-open');
      renderSphere();
      updateVisibleSet();
      const x = $('stage-pick-x');
      if (x && x.focus) x.focus({ preventScroll: true });
    });
  }

  function closePick() {
    if (!pickOpen) return;
    if (previewing) closePreview({ silent: true });
    pickOpen = false;
    clearTimeout(pickSearchTimer);
    stopPreviewTicker();
    stopPickLoop();
    pickDragging = false;
    pickDragId = 0;
    pickScroll.classList.remove('is-dragging');
    unmountAllGrid();
    unmountHero();
    pick.classList.remove('is-open');
    document.documentElement.classList.remove('is-picking');
    clearTimeout(pick.__hideT);
    pick.__hideT = setTimeout(() => { if (!pickOpen) pick.hidden = true; }, 280);
    const back = pickReturnFocus;
    pickReturnFocus = null;
    if (back && document.contains(back) && back.focus) {
      try { back.focus({ preventScroll: true }); } catch { /* 忽略 */ }
    } else if (menuBtn) {
      menuBtn.focus({ preventScroll: true });
    }
  }

  /* ======================= 球面预览管理器 =======================
     每格 = 一个 iframe：固定 1280×800 虚拟视口，外层固定基座 + overflow:hidden，
     JS 用 max(基座宽/1280, 基座高/800) 的 scale 做 cover 居中裁切，2:1 / 1:1 都不拉伸。
     iframe pointer-events:none，点击一律由外层格子接。
     协议与真正舞台一致：只认自己 iframe 的 ready；ready 后发 init，共享 100ms 定时器发 tick。
     预览从不发音频 / beat / live，也不碰 #stage-frame。 */
  const previewSources = new WeakMap();
  const mounted = new Map();            // 已挂载的球面预览：id -> entry
  let previewing = null;                // 当前整屏预览的形态
  let heroEntry = null;
  let previewHideT = 0;
  let previewTick = 0;
  let lastPreviewSig = '';

  /** 和 StageHost.pushInit 完全同构：当前歌曲 / 主色 / 带时长的歌词行 */
  function initPayload() {
    const tr = Player.state.queue[Player.state.index];
    const ls = Player.state.lyric || [];
    return {
      song: tr ? { id: tr.id, name: tr.name, album: tr.album || '', artists: tr.artists, cover: tr.cover } : null,
      accent: accentRgb || [150, 165, 255],
      lines: ls.map((l, i) => ({
        t: l.t,
        dur: l.dur || (ls[i + 1] ? Math.max(0.4, ls[i + 1].t - l.t) : 6),
        text: l.text,
        chars: l.chars ? l.chars.map((c) => ({ c: c.c, t: c.t })) : null,
      })),
      duration: Player.audio.duration || 0,
    };
  }

  /** 轻量签名：tick 每秒 10 次，不能每次都把整份歌词 + 逐字时间建一遍。
      和 StageHost.pushInit 用的是同一组判据，只在真正需要时再建完整 payload。 */
  function currentInitSig() {
    const tr = Player.state.queue[Player.state.index];
    const ls = Player.state.lyric || [];
    return [
      tr ? tr.id : 0,
      ls.length,
      ls.length ? ls[0].t : 0,
      ls.length ? ls[ls.length - 1].t : 0,
      ls.length && ls[0].chars ? ls[0].chars.length : 0,
      accentRgb ? accentRgb.join(',') : '',
    ].join('|');
  }

  function send(entry, type, payload) {
    if (!entry || !entry.iframe || !entry.iframe.contentWindow) return;
    try { entry.iframe.contentWindow.postMessage({ __c100: 1, type, payload }, '*'); } catch { /* 忽略 */ }
  }

  /** 固定虚拟视口 → 基座的 cover 变换（居中裁切，绝不拉伸） */
  function fitEntry(entry) {
    if (!entry || !entry.wrap) return;
    const w = entry.wrap.offsetWidth || 1;
    const h = entry.wrap.offsetHeight || 1;
    const s = Math.max(w / PICK_VIRTUAL_W, h / PICK_VIRTUAL_H);
    entry.iframe.style.transform =
      'translate(' + ((w - PICK_VIRTUAL_W * s) / 2).toFixed(2) + 'px,' +
      ((h - PICK_VIRTUAL_H * s) / 2).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
  }

  function previewMax() {
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    return innerWidth <= 760 || coarse ? 5 : 10;
  }

  function mountGrid(id) {
    if (!pickOpen || previewing || document.hidden) return;
    const cell = pickCards.get(id);
    if (!cell || cell.failed || mounted.has(id) || mounted.size >= previewMax()) return;
    const s = cell.stage;
    if (!s || !s.url) return;

    const art = cell.art;
    const iframe = document.createElement('iframe');
    iframe.className = 'pickcell__frame';
    iframe.title = s.name;
    iframe.tabIndex = -1;
    iframe.setAttribute('aria-hidden', 'true');
    art.classList.remove('is-live', 'is-failed');
    art.classList.add('is-loading');
    art.appendChild(iframe);

    const entry = { key: id, id, iframe, wrap: art, cell, ready: false, failed: false, hero: false, timeout: 0 };
    mounted.set(id, entry);
    const win = iframe.contentWindow;
    if (win) previewSources.set(win, entry);
    iframe.src = s.url;                  // 每次挂载只加载一次；卸载重进会重新加载
    fitEntry(entry);
    entry.timeout = setTimeout(() => {
      if (entry.ready || mounted.get(id) !== entry) return;
      /* 单个 iframe 失败只留编号空壳，不占并发位、不阻塞整颗球 */
      entry.failed = true;
      cell.failed = true;
      clearTimeout(entry.timeout);
      try { previewSources.delete(iframe.contentWindow); } catch { /* 忽略 */ }
      try { iframe.removeAttribute('src'); } catch { /* 忽略 */ }
      iframe.remove();
      if (mounted.get(id) === entry) mounted.delete(id);
      art.classList.remove('is-loading', 'is-live');
      art.classList.add('is-failed');
    }, PICK_TIMEOUT);
  }

  function unmountEntry(entry) {
    if (!entry) return;
    if (mounted.get(entry.key) === entry) mounted.delete(entry.key);
    clearTimeout(entry.timeout);
    entry.ready = false;
    try { previewSources.delete(entry.iframe.contentWindow); } catch { /* 忽略 */ }
    try { entry.iframe.removeAttribute('src'); } catch { /* 忽略 */ }
    entry.iframe.remove();
    entry.wrap.classList.remove('is-live', 'is-loading');
  }

  function unmountAllGrid() {
    for (const entry of Array.from(mounted.values())) unmountEntry(entry);
  }

  function onPreviewReady(entry) {
    if (!entry || entry.ready) return;
    if (entry.hero) {
      if (!previewing || previewing.id !== entry.id) return;
    } else if (!pickOpen || previewing || mounted.get(entry.id) !== entry) {
      return;
    }
    entry.ready = true;
    clearTimeout(entry.timeout);
    entry.wrap.classList.remove('is-loading', 'is-failed');
    entry.wrap.classList.add('is-live');
    if (entry.hero) pickPreviewFail.hidden = true;

    lastPreviewSig = currentInitSig();
    send(entry, 'init', initPayload());
    send(entry, 'tick', { time: Player.audio.currentTime || 0, playing: !Player.audio.paused });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__c100 !== 1 || d.type !== 'ready') return;
    const entry = previewSources.get(e.source);
    if (entry) onPreviewReady(entry);
  });

  function previewFrameTick() {
    if (!pickOpen || document.hidden) return;
    const sig = currentInitSig();
    if (sig !== lastPreviewSig) {
      lastPreviewSig = sig;
      const p = initPayload();
      mounted.forEach((entry) => { if (entry.ready) send(entry, 'init', p); });
      if (heroEntry && heroEntry.ready) send(heroEntry, 'init', p);
      if (previewing) fillPreviewSong();
    }
    const time = Player.audio.currentTime || 0;
    const playing = !Player.audio.paused;
    mounted.forEach((entry) => { if (entry.ready) send(entry, 'tick', { time, playing }); });
    if (heroEntry && heroEntry.ready) send(heroEntry, 'tick', { time, playing });
  }

  function startPreviewTicker() {
    if (previewTick) return;
    lastPreviewSig = '';
    previewTick = setInterval(previewFrameTick, 100);
  }

  function stopPreviewTicker() {
    if (previewTick) clearInterval(previewTick);
    previewTick = 0;
    lastPreviewSig = '';
  }

  /* ---- 球面投影 ----
     相机在 z = 2.4R，焦距 1.4R，正面格子的透视比例正好是 1，越靠边越小。
     赤道最宽、两极变窄；水平方向再随朝向收窄一次。 */
  function pickViewport() {
    const vw = innerWidth;
    const vh = innerHeight;
    const mobile = vw <= 760;
    const R = mobile ? Math.max(vw * 0.95, vh * 0.62) : Math.max(vw * 0.62, vh * 0.86);
    /* 球心放在 header 以下的剩余区域中间，不让顶部 180 / 90px 的细线 header 白占 */
    const headerH = mobile ? 90 : 180;
    return { vw, vh, mobile, R, cx: vw / 2, cy: headerH + (vh - headerH) * 0.5 };
  }

  function renderSphere() {
    const vp = pickViewport();
    pickViewportW = vp.vw;
    pickViewportH = vp.vh;
    pickSphereR = vp.R;
    pickSphereCx = vp.cx;
    pickSphereCy = vp.cy;
    const D = vp.R * 2.4;
    const F = vp.R * 1.4;
    const cyaw = Math.cos(pickYaw);
    const syaw = Math.sin(pickYaw);
    const cp = Math.cos(pickPitch);
    const sp = Math.sin(pickPitch);
    const rowH = vp.R * PICK_LAT_STEP * PICK_H_RATIO;

    for (let i = 0; i < pickCells.length; i++) {
      const c = pickCells[i];
      const x1 = c.x * cyaw - c.z * syaw;
      const z1 = c.x * syaw + c.z * cyaw;
      const y2 = c.y * cp - z1 * sp;
      const z2 = c.y * sp + z1 * cp;
      c.z2 = z2;

      if (z2 <= 0.02) {
        if (c.onScreen) { c.onScreen = false; c.el.style.display = 'none'; }
        continue;
      }

      const p = F / (D - z2 * vp.R);
      const sx = vp.cx + x1 * vp.R * p;
      const sy = vp.cy - y2 * vp.R * p;
      /* 经度切向在屏幕上的长度 ∝ cos(lat)·cos(dLon)：
         赤道最宽、两极变窄、转到侧面再收窄一次。 */
      const dLon = ((c.lon - pickYaw + Math.PI) % PICK_TAU + PICK_TAU) % PICK_TAU - Math.PI;
      const cosDLon = Math.max(0.04, Math.cos(dLon));
      const w = (c.wide ? 2 : 1) * vp.R * PICK_A * Math.max(0.1, c.cosLat) * cosDLon * p;
      /* 纬向切向 ∝ |cos(lat - pitch)|，所以从赤道看两极会压扁，转到两极附近又恢复 */
      const h = rowH * Math.max(0.12, Math.abs(Math.cos(c.lat - pickPitch))) * p;
      const halfW = w * 0.5;
      const halfH = h * 0.5;
      c.sx = sx; c.sy = sy; c.w = w; c.h = h;

      if (sx < -halfW || sx > vp.vw + halfW || sy < -halfH || sy > vp.vh + halfH) {
        if (c.onScreen) { c.onScreen = false; c.el.style.display = 'none'; }
        continue;
      }

      if (!c.onScreen) { c.onScreen = true; c.el.style.display = 'block'; }

      /* 经度差决定绕 Y 的倾角，像球面上的格子侧过去 */
      const ry = Math.max(-48, Math.min(48, dLon * (180 / Math.PI) * 0.5));
      const baseW = c.wide ? PICK_BASE_WIDE : PICK_BASE_SQ_W;
      const scaleX = w / baseW;
      const scaleY = h / PICK_BASE_H;
      const tx = sx - baseW / 2;
      const ty = sy - PICK_BASE_H / 2;
      c.el.style.opacity = String(Math.min(1, Math.max(0.1, (z2 - 0.02) / 0.22)));
      c.el.style.zIndex = String(1000 + Math.round(z2 * 1000));
      c.el.style.transform =
        'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) ' +
        'scale(' + scaleX.toFixed(4) + ',' + scaleY.toFixed(4) + ') ' +
        'rotateY(' + ry.toFixed(2) + 'deg)';
    }
  }

  /* ---- 可见集合：只给正面、在视口内、离球心不远的一小撮挂 iframe ----
     旋转时每 120ms 重算一次，不每帧重建；背面 / 远处只留空壳。 */
  function updateVisibleSet() {
    if (!pickOpen || previewing || document.hidden) return;
    const max = previewMax();
    const vw = pickViewportW || innerWidth;
    const vh = pickViewportH || innerHeight;
    const cand = [];
    for (let i = 0; i < pickCells.length; i++) {
      const c = pickCells[i];
      if (!c.onScreen || c.z2 < PICK_MAX_ANGLE) continue;
      if (c.sx < -c.w * 0.25 || c.sx > vw + c.w * 0.25) continue;
      if (c.sy < -c.h * 0.25 || c.sy > vh + c.h * 0.25) continue;
      if (Math.hypot(c.sx - pickSphereCx, c.sy - pickSphereCy) > pickSphereR * 1.05) continue;
      cand.push(c);
    }
    cand.sort((a, b) => b.z2 - a.z2);

    /* 多留 3 个缓冲，避免拖动时轻微换序导致反复卸载 / 重挂 */
    const keep = new Set();
    for (let i = 0; i < cand.length && i < max + 3; i++) keep.add(cand[i].id);
    for (const entry of Array.from(mounted.values())) {
      if (!keep.has(entry.id)) unmountEntry(entry);
    }
    for (let i = 0; i < cand.length && mounted.size < max; i++) {
      const id = cand[i].id;
      if (!mounted.has(id)) mountGrid(id);
    }
  }

  /* ---- 拖动 / 惯性 ----
     yaw 无限取模，pitch 夹在 ±80°；松手后按最后速度缓慢衰减。
     pointer 事件同时覆盖鼠标 / 触屏 / 笔。 */
  function pickYawSens() {
    return PICK_TAU / Math.max(420, Math.min(innerWidth, 1600) * 1.7);
  }
  function pickPitchSens() {
    return Math.PI / Math.max(520, innerHeight * 1.6);
  }
  function normalizeYaw() {
    pickYaw = ((pickYaw + Math.PI) % PICK_TAU + PICK_TAU) % PICK_TAU - Math.PI;
  }
  function clampPitch() {
    if (pickPitch > PICK_PITCH_MAX) { pickPitch = PICK_PITCH_MAX; if (pickVelPitch > 0) pickVelPitch = 0; }
    else if (pickPitch < -PICK_PITCH_MAX) { pickPitch = -PICK_PITCH_MAX; if (pickVelPitch < 0) pickVelPitch = 0; }
  }

  function kickPick() {
    if (!pickOpen) return;
    pickNeedsRender = true;
    if (pickRaf) return;
    pickLastT = performance.now();
    pickRaf = requestAnimationFrame(pickStep);
  }

  function pickStep(t) {
    pickRaf = 0;
    if (!pickOpen) return;
    const dt = Math.min(48, Math.max(0, t - pickLastT)) || 16.7;
    pickLastT = t;
    let moved = false;

    if (!pickDragging && (Math.abs(pickVelYaw) > 0.00002 || Math.abs(pickVelPitch) > 0.00002)) {
      pickYaw += pickVelYaw * dt;
      pickPitch += pickVelPitch * dt;
      const decay = Math.pow(0.9, dt / 16.7);
      pickVelYaw *= decay;
      pickVelPitch *= decay;
      if (Math.abs(pickVelYaw) < 0.00002) pickVelYaw = 0;
      if (Math.abs(pickVelPitch) < 0.00002) pickVelPitch = 0;
      normalizeYaw();
      clampPitch();
      moved = true;
    }

    if (pickDragging || moved || pickNeedsRender) {
      pickNeedsRender = false;
      renderSphere();
      const now = performance.now();
      if (now - pickLastVisAt >= PICK_RECONCILE_MS) {
        pickLastVisAt = now;
        updateVisibleSet();
      }
    }

    if (pickDragging || moved) {
      pickRaf = requestAnimationFrame(pickStep);
    } else {
      pickVelYaw = 0;
      pickVelPitch = 0;
      updateVisibleSet();
    }
  }

  function stopPickLoop() {
    if (pickRaf) cancelAnimationFrame(pickRaf);
    pickRaf = 0;
    pickVelYaw = 0;
    pickVelPitch = 0;
  }

  function onPickPointerDown(e) {
    if (!pickOpen || previewing || (e.button != null && e.button !== 0)) return;
    pickDragId = e.pointerId;
    pickDragging = true;
    pickDragged = false;
    pickCaptured = false;
    pickDragStartX = e.clientX;
    pickDragStartY = e.clientY;
    pickDragLastX = e.clientX;
    pickDragLastY = e.clientY;
    pickLastMoveT = performance.now();
    pickVelYaw = 0;
    pickVelPitch = 0;
    pickScroll.classList.add('is-dragging');
    /* 先不 capture：普通点击必须在格子上正常派发 click；超过阈值再 capture */
    kickPick();
  }

  function onPickPointerMove(e) {
    if (!pickDragging || e.pointerId !== pickDragId) return;
    const now = performance.now();
    const dx = e.clientX - pickDragLastX;
    const dy = e.clientY - pickDragLastY;
    if (!pickDragged && Math.hypot(e.clientX - pickDragStartX, e.clientY - pickDragStartY) > 6) {
      pickDragged = true;
      pickCaptured = true;
      try { pickScroll.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
    if (!dx && !dy) return;
    pickDragLastX = e.clientX;
    pickDragLastY = e.clientY;
    const ys = pickYawSens();
    const ps = pickPitchSens();
    pickYaw += dx * ys;
    pickPitch += dy * ps;
    normalizeYaw();
    clampPitch();
    const dt = Math.max(8, now - pickLastMoveT) || 16.7;
    pickLastMoveT = now;
    const vy = (dx * ys) / dt;
    const vp = (dy * ps) / dt;
    pickVelYaw = Math.max(-0.008, Math.min(0.008, pickVelYaw * 0.6 + vy * 0.4));
    pickVelPitch = Math.max(-0.008, Math.min(0.008, pickVelPitch * 0.6 + vp * 0.4));
    kickPick();
  }

  function onPickPointerUp(e) {
    if (!pickDragging) return;
    if (e && e.pointerId != null && e.pointerId !== pickDragId) return;
    pickDragging = false;
    pickDragId = 0;
    pickScroll.classList.remove('is-dragging');
    if (pickDragged) pickSuppressClick = performance.now() + 360;
    if (PICK_REDUCED) { pickVelYaw = 0; pickVelPitch = 0; }
    if (pickCaptured) {
      pickCaptured = false;
      try { if (e && e.pointerId != null) pickScroll.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
    kickPick();
  }

  function fillPreviewSong() {
    const tr = Player.state.queue[Player.state.index];
    pickPreviewSong.textContent = tr
      ? '正在播放：' + tr.name + (tr.artists ? ' · ' + tr.artists : '')
      : '还没有歌曲，预览使用默认配色';
  }

  function fillPreviewMeta(s) {
    pickPreviewNum.textContent = s.id;
    pickPreviewId.textContent = s.id;
    pickPreviewName.textContent = s.name;
    pickPreviewDesc.textContent = s.desc;
    fillPreviewSong();
  }

  function mountHero(s) {
    if (!previewing || !s || !s.url) return;
    unmountHero();
    pickPreviewStage.classList.remove('is-live', 'is-failed');
    pickPreviewFail.hidden = true;
    pickPreviewFrame.title = s.name;

    const entry = {
      key: '__hero__', id: s.id, iframe: pickPreviewFrame, wrap: pickPreviewStage,
      cell: null, ready: false, failed: false, hero: true, timeout: 0,
    };
    heroEntry = entry;
    const win = pickPreviewFrame.contentWindow;
    if (win) previewSources.set(win, entry);
    pickPreviewFrame.src = s.url;
    fitEntry(entry);
    entry.timeout = setTimeout(() => {
      if (!heroEntry || heroEntry !== entry || entry.ready) return;
      entry.failed = true;
      pickPreviewStage.classList.add('is-failed');
      pickPreviewFail.hidden = false;
    }, PICK_TIMEOUT);
  }

  function unmountHero() {
    const entry = heroEntry;
    if (!entry) return;
    heroEntry = null;
    clearTimeout(entry.timeout);
    entry.ready = false;
    try { previewSources.delete(entry.iframe.contentWindow); } catch { /* 忽略 */ }
    try { entry.iframe.removeAttribute('src'); } catch { /* 忽略 */ }
    pickPreviewStage.classList.remove('is-live', 'is-failed', 'is-loading');
    pickPreviewFail.hidden = true;
  }

  function openPreview(s) {
    if (!pickOpen || !s || !s.url) return;
    if (previewing && previewing.id === s.id) { enterPreviewed(); return; }
    previewing = s;
    /* 大预览盖住球面时把格子里的预览全部卸掉：省 CPU，也让 hero 独占并发 */
    unmountAllGrid();
    fillPreviewMeta(s);
    pickPreview.hidden = false;
    pickPreview.setAttribute('aria-hidden', 'false');
    pickPreview.classList.remove('is-open');
    pickPreviewStage.classList.remove('is-live', 'is-failed');
    pickPreviewFail.hidden = true;
    startPreviewTicker();
    mountHero(s);
    requestAnimationFrame(() => pickPreview.classList.add('is-open'));
    const enter = $('stage-pick-preview-enter');
    if (enter && enter.focus) enter.focus({ preventScroll: true });
  }

  function closePreview(opts) {
    const o = opts || {};
    if (!previewing) return;
    const lastId = previewing.id;
    previewing = null;
    unmountHero();
    pickPreview.classList.remove('is-open');
    pickPreview.setAttribute('aria-hidden', 'true');
    clearTimeout(previewHideT);
    previewHideT = setTimeout(() => { if (!previewing) pickPreview.hidden = true; }, 240);
    if (!o.silent) {
      pickNeedsRender = true;
      kickPick();
      updateVisibleSet();
      const cell = pickCards.get(lastId);
      if (cell) cell.el.focus({ preventScroll: true });
    }
  }

  /** 第二次确认：走原来的圆形蒙版转场 + applyStage，带上当前歌曲 */
  function enterPreviewed() {
    const s = previewing;
    if (!s) return;
    if (irisBusy) return;             // 上一段圆形转场还在跑，别把画廊提前关掉
    const origin = pickPreviewStage;
    irisSwitch(origin, () => applyStage(s.id));
    closePreview({ silent: true });
    closePick();
  }

  /* 画廊关闭、标签页隐藏时停表 / 停 rAF 并卸载；回来再按当前朝向重新加载 */
  document.addEventListener('visibilitychange', () => {
    if (!pickOpen) return;
    if (document.hidden) {
      stopPreviewTicker();
      stopPickLoop();
      pickDragging = false;
      pickDragId = 0;
      pickScroll.classList.remove('is-dragging');
      unmountAllGrid();
      unmountHero();
      return;
    }
    startPreviewTicker();
    if (previewing) mountHero(previewing);
    pickNeedsRender = true;
    kickPick();
  });

  addEventListener('resize', () => {
    if (!pickOpen) return;
    pickNeedsRender = true;
    kickPick();
    /* 大预览的 16:9 舞台尺寸随窗口变，虚拟视口的 cover 也要重算 */
    requestAnimationFrame(() => {
      if (heroEntry) fitEntry(heroEntry);
    });
  });

  /* ---- 圆形蒙版转场：把"换形态"藏在圆后面 ----
     时序（三步，每一步都有兜底超时，任何一步被后台标签页打断都不会卡死）：
       ① 圆从卡片圆心 scale(0) → scale(1)，盖满屏幕        ≈420ms
       ② 圆盖住后才换形态，然后**等 iframe 真的 ready**     ≤1400ms
       ③ 圆淡出，露出已经画好的作品                        ≈260ms
     关键是 ② 要等 ready：不等的话，圆一撤 iframe 还在白屏加载，
     用户会看到一帧白闪 —— 那比没有转场更难看。 */
  let irisBusy = false;

  function waitStageReady(ms) {
    return new Promise((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        removeEventListener('stage:ready', fin);
        res();
      };
      addEventListener('stage:ready', fin);
      setTimeout(fin, ms);
    });
  }

  function irisSwitch(originEl, onCovered) {
    if (irisBusy) return;
    irisBusy = true;
    const r = originEl ? originEl.getBoundingClientRect() : null;
    const cx = r ? r.left + r.width / 2 : innerWidth / 2;
    const cy = r ? r.top + r.height / 2 : innerHeight / 2;
    /* 圆的直径要够到最远的那个角 */
    const far = Math.max(
      Math.hypot(cx, cy), Math.hypot(innerWidth - cx, cy),
      Math.hypot(cx, innerHeight - cy), Math.hypot(innerWidth - cx, innerHeight - cy));
    const d = far * 2 + 8;

    const resetIris = () => {
      iris.classList.remove('is-cover', 'is-fade');
      iris.style.transition = 'none';
      iris.style.width = iris.style.height = '0px';
      void iris.offsetWidth;
      iris.style.transition = '';
    };

    resetIris();
    iris.style.width = d + 'px';
    iris.style.height = d + 'px';
    iris.style.left = (cx - d / 2) + 'px';
    iris.style.top = (cy - d / 2) + 'px';
    void iris.offsetWidth;
    requestAnimationFrame(() => iris.classList.add('is-cover'));

    /* ① 等圆铺满 */
    new Promise((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        iris.removeEventListener('transitionend', fin);
        res();
      };
      iris.addEventListener('transitionend', fin, { once: true });
      setTimeout(fin, 640);
    })
      /* ② 换形态 + 等 ready */
      .then(async () => {
        try { onCovered(); } catch (err) { console.warn('[pick] switch failed', err); }
        await waitStageReady(1400);
      })
      /* ③ 撤蒙版 */
      .then(() => new Promise((res) => {
        iris.classList.add('is-fade');
        setTimeout(() => {
          resetIris();
          irisBusy = false;
          res();
        }, 300);
      }));
  }

  function applyStage(id, fromHall) {
    /* 记来源：形态长廊面传 true，舞台操作条的返回键据此决定回大厅还是回播放器；
       其余入口（播放器里的形态菜单 / 整页画廊）不传，保持原路回播放器。 */
    stageFromHall = !!fromHall;
    const s = StageHost.load(id);
    if (menuVal) menuVal.textContent = s.name;
    markCurrent(s.id);
    if (s.id !== 'classic') show('stage');
    else if (view === 'stage') show('now');
  }

  /* 搜索 / 标签栏 */
  pickTabs.addEventListener('click', (e) => {
    const b = e.target.closest('.stagepick__tab');
    if (b) setPickTab(b.dataset.tab);
  });
  pickSearchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPickSearchOpen(!pickSearchOpen);
  });
  pickClear.addEventListener('click', () => {
    pickQ.value = '';
    pickQuery = '';
    clearTimeout(pickSearchTimer);
    applyPickFilter();
    pickQ.focus({ preventScroll: true });
  });
  pickQ.addEventListener('input', () => {
    clearTimeout(pickSearchTimer);
    pickSearchTimer = setTimeout(() => {
      const q = pickQ.value;
      if (q === pickQuery) return;
      pickQuery = q;
      applyPickFilter();
    }, 140);
  });
  pickQ.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setPickSearchOpen(false); }
  });

  /* 拖动：整颗球面都是拖动面，pointer 事件统一鼠标 / 触屏 / 笔 */
  pickScroll.addEventListener('pointerdown', onPickPointerDown);
  pickScroll.addEventListener('pointermove', onPickPointerMove);
  pickScroll.addEventListener('pointerup', onPickPointerUp);
  pickScroll.addEventListener('pointercancel', onPickPointerUp);
  pickScroll.addEventListener('lostpointercapture', (e) => { if (pickDragging) onPickPointerUp(e); });

  /* 第一次点格子：整屏大预览（不是直接换形态）；拖动超过阈值不算点击 */
  pickGrid.addEventListener('click', (e) => {
    if (performance.now() < pickSuppressClick) {
      pickDragged = false;
      e.preventDefault();
      return;
    }
    const el = e.target.closest('.pickcell');
    if (!el) return;
    const s = pickedStage.get(el.dataset.id);
    if (s) openPreview(s);
  });

  $('stage-pick-x').addEventListener('click', closePick);

  /* 第二次点（大预览上任意处 / 「进入」按钮）：才真正换形态 */
  pickPreview.addEventListener('click', (e) => {
    if (e.target.closest('[data-no-enter]')) return;
    enterPreviewed();
  });
  $('stage-pick-preview-back').addEventListener('click', (e) => {
    e.stopPropagation();
    closePreview();
  });

  /* ---- DIY 下拉：点「调整参数」展开/收起滑杆 ---- */
  {
    const diyBtn = $('btn-diy');
    const diyWrap = $('diy-wrap');
    if (diyBtn && diyWrap) {
      diyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        diyWrap.hidden = !diyWrap.hidden;
        diyBtn.setAttribute('aria-expanded', String(!diyWrap.hidden));
      });
    }
  }

  /* ---- 形态下拉：直接在设置面板里选，点中哪项就从哪项长圆过渡 ---- */
  const stageMenu = $('stage-menu');
  const stageList = $('stage-menu-list');
  function paintStageMenuList() {
    stageList.innerHTML = stageMenuList(true).map((s) => `
      <button class="stage-item" data-id="${s.id}" role="option" aria-selected="false">
        ${stageEdition === 'dev' ? `<span class="stage-item__id">${s.id === 'classic' ? '—' : s.id}</span>` : ''}
        <span class="stage-item__name">${s.name}</span>
      </button>`).join('');
  }
  paintStageMenuList();
  document.addEventListener('lizi:stage-edition', () => {
    paintStageMenuList();
    if (!stageMenu.hidden) setStageMenu(true);
  });
  /* 初始标签跟 StageHost 的实际当前形态对齐（HTML 里写死的文案可能过时） */
  if (StageHost.current) menuVal.textContent = StageHost.current.name;

  function setStageMenu(open) {
    stageMenu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const curId = StageHost.current ? StageHost.current.id : 'classic';
    stageList.querySelectorAll('.stage-item').forEach((b) => {
      const on = b.dataset.id === curId;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    const cur = stageList.querySelector('.stage-item.is-on');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setStageMenu(stageMenu.hidden);
  });
  stageList.addEventListener('click', (e) => {
    const item = e.target.closest('.stage-item');
    if (!item) return;
    const id = item.dataset.id;
    setStageMenu(false);
    irisSwitch(item, () => applyStage(id));
  });
  document.addEventListener('click', (e) => {
    if (!stageMenu.hidden && !e.target.closest('#stage-menu') && !e.target.closest('#btn-stage-menu')) setStageMenu(false);
  });

  /* Esc：先退出整屏预览 → 再收搜索 → 最后关画廊；方向键也可以转球 */
  document.addEventListener('keydown', (e) => {
    if (!pickOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (previewing) { closePreview(); return; }
      if (pickSearchOpen) { setPickSearchOpen(false); return; }
      closePick();
      return;
    }
    if (previewing || pickSearchOpen) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const step = ((e.shiftKey ? 12 : 4) * Math.PI) / 180;
    if (e.key === 'ArrowLeft') pickYaw -= step;
    else if (e.key === 'ArrowRight') pickYaw += step;
    else if (e.key === 'ArrowUp') pickPitch -= step;
    else if (e.key === 'ArrowDown') pickPitch += step;
    else return;
    e.preventDefault();
    normalizeYaw();
    clampPitch();
    kickPick();
  });

  /* ---- 顶栏滚动态统一由下面那个带滞回的处理器管 ---- */

  /* ---- 右侧抽屉：原来顶栏上那一排（歌词模式 / 节拍 / 进入形态）都收在这里 ---- */
  const drawer = $('drawer');
  const drawerBtn = $('btn-drawer');
  const drawerScrim = $('drawer-scrim');
  const drawerX = $('drawer-x');
  const beatToggleVal = $('beat-toggle-val');

  function setDrawer(open) {
    /* 关抽屉前先把焦点挪回「控制」：抽屉只是用 transform 滑出去，焦点若还留在里面，
       #view-now（overflow 的滚动容器）会为了"看见焦点"横向滚一段 —— 整页被推走、
       右边留一条白。focus({preventScroll}) 不产生任何滚动。 */
    if (!open && drawer.contains(document.activeElement)) {
      try { drawerBtn.focus({ preventScroll: true }); } catch { drawerBtn.focus(); }
    }
    drawer.classList.toggle('is-open', open);
    /* 这个类现在只当「抽屉开着」的状态标记（切视图时要靠它收起抽屉），
       整页让位的位移规则已经移除 —— 抽屉是整屏覆盖。 */
    el.viewNow.classList.toggle('is-drawer-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    drawerBtn.setAttribute('aria-expanded', String(open));
    drawerScrim.hidden = !open;
    /* 收起时整块 inert：抽屉只是 translate 出视口，里面的行仍然 Tab 得到、
       读屏也会读到 aria-hidden 里的内容。打开时顺手刷新队列计数（N 首）。 */
    drawer.inert = !open;
    if (open) updateQueueCount();
  }
  drawerBtn.addEventListener('click', () => setDrawer(!drawer.classList.contains('is-open')));
  drawerScrim.addEventListener('click', () => setDrawer(false));
  /* 整屏抽屉盖住了外面的「控制」按钮，所以抽屉里自带收起键 */
  drawerX.addEventListener('click', () => setDrawer(false));
  /* Esc 收起抽屉。用捕获阶段 + stopImmediatePropagation：
     队列面板的 Esc 和全局「Esc 离开播放页」都挂在 document 上，
     不抢在它们前面的话按一下会直接退回浏览页。
     文本输入框 / 搜索框的 Esc 留给它们自己（range 滑杆不算输入）。 */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (view !== 'now' || !drawer.classList.contains('is-open')) return;
    /* 有模态框时先让全局处理器关模态（它优先），别把抽屉一起关掉 */
    if (el.modal && !el.modal.classList.contains('is-closed')) return;
    const t = e.target;
    const tag = t && t.tagName;
    const typing = t && (t.isContentEditable || tag === 'TEXTAREA' ||
      (tag === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset)$/i.test(t.type)));
    if (typing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setDrawer(false);
    /* 关闭后焦点回「控制」；preventScroll 避免 #view-now 为看见焦点横向滚一段 */
    try { drawerBtn.focus({ preventScroll: true }); } catch { drawerBtn.focus(); }
  }, true);
  setDrawer(false);

  /* ---- 播放页抽屉里的「进入形态」：点开就是下拉，直接选 ----
     原来点一下只是进当前形态，选不了 —— 现在复用设置面板那份列表（暗场配色）。 */
  const drawerStageList = $('drawer-stage-list');
  /* 抽屉里的形态列表：用户 2026-11-08 要求与形态页「形态」下拉保持同步，
     所以这里不再画 forms-labs/previews/<id>.jpg 缩略图墙，改成同一份纯文字行
     （classic 的 id 用 —，开发者版才显示 id），样式复用 .stage-item。
     每项仍保留 data-id / data-name / data-search，搜索、隐藏 / 空态、
     is-on 同步和点击委托（applyStage）全部沿用原逻辑。 */
  let drawerStageQ = null;
  let drawerStageItems = [];
  function paintDrawerStageList() {
    const drawStageItems = stageMenuList(true).map((s) => `
      <button class="stage-item" data-id="${toolsEsc(s.id)}" data-name="${toolsEsc(s.name)}" data-search="${toolsEsc(s.name.toLowerCase())}" role="option" aria-selected="false">
        ${stageEdition === 'dev' ? `<span class="stage-item__id">${s.id === 'classic' ? '—' : toolsEsc(s.id)}</span>` : ''}
        <span class="stage-item__name">${toolsEsc(s.name)}</span>
      </button>`).join('');
    drawerStageList.innerHTML = `
      <div class="dstages__search">
        <svg class="ico" aria-hidden="true"><use href="#i-search"/></svg>
        <input id="drawer-stage-q" type="search" placeholder="搜索形态" aria-label="搜索形态" autocomplete="off" spellcheck="false">
      </div>
      <div class="dstages__grid dstages__grid--text" role="listbox" aria-label="选择形态">${drawStageItems}</div>
      <p class="dstages__empty" hidden>没有匹配的形态</p>`;
    drawerStageQ = $('drawer-stage-q');
    drawerStageItems = Array.from(drawerStageList.querySelectorAll('.stage-item'));
    if (drawerStageQ) {
      drawerStageQ.addEventListener('input', () => filterDrawerStages(drawerStageQ.value));
      drawerStageQ.value = '';
    }
    filterDrawerStages('');
  }
  paintDrawerStageList();
  document.addEventListener('lizi:stage-edition', () => {
    paintDrawerStageList();
    if (!drawerStageList.hidden) setDrawerStages(true);
  });
  function filterDrawerStages(q) {
    const needle = String(q || '').trim().toLowerCase();
    let shown = 0;
    drawerStageItems.forEach((b) => {
      const hit = !needle || (b.dataset.search || '').includes(needle);
      b.hidden = !hit;
      if (hit) shown++;
    });
    const grid = drawerStageList.querySelector('.dstages__grid');
    const empty = drawerStageList.querySelector('.dstages__empty');
    if (grid) grid.hidden = shown === 0;
    if (empty) empty.hidden = shown > 0;
  }
  drawerStageQ?.addEventListener('input', () => filterDrawerStages(drawerStageQ.value));
  function setDrawerStages(open) {
    drawerStageList.hidden = !open;
    $('btn-stage').setAttribute('aria-expanded', String(open));
    if (!open) return;
    /* 每次展开先清过滤：当前项一定在，不会被上一次的搜索词藏起来 */
    if (drawerStageQ) drawerStageQ.value = '';
    filterDrawerStages('');
    const curId = StageHost.current ? StageHost.current.id : 'classic';
    drawerStageList.querySelectorAll('.stage-item').forEach((b) => {
      const on = b.dataset.id === curId;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }
  $('btn-stage').addEventListener('click', (e) => {
    e.stopPropagation();
    setDrawerStages(drawerStageList.hidden);
  });
  drawerStageList.addEventListener('click', (e) => {
    const item = e.target.closest('.stage-item');
    if (!item) return;
    const id = item.dataset.id;
    setDrawerStages(false);
    setDrawer(false);
    irisSwitch(item, () => applyStage(id));
  });

  function renderPeek(lines, active) {
    // 必须同时比较 lines 引用：切歌时 load() 会先发一次 {lines:[], active:-1}，
    // 真实歌词随后到达时 active 同样是 -1。只比 active 的话第二次会被判定成
    // "没变化"而直接返回，3 行预览就永远是空的。
    if (active === peekIndex && lines === peekLines) return;
    peekIndex = active;
    peekLines = lines;

    // active = -1 时（还没唱到第一句）就用 0/1/2 顶上，别显示空白
    const base = active < 0 ? 0 : active;
    const texts = [base - 1, base, base + 1].map((i) => (lines[i] ? lines[i].text : ''));

    el.peek.forEach((node, k) => {
      const next = texts[k] || '';
      const changed = node.textContent !== next;
      node.textContent = next;
      if (changed) {
        // 重放一次上浮动画，读起来像歌词在滚
        node.classList.remove('is-swap');
        void node.offsetWidth;          // 强制回流，动画才会重播
        node.classList.add('is-swap');
      }
    });
  }

  /* ================================================================== *
   * 封面背景取色
   * ================================================================== */
  let lastArtUrl = null;           // 上一次取过色的封面 URL
  let accentRgb = null;            // 作品的主色取自封面取色结果

  async function applyArtwork(track) {
    /* 背景是**取色渐变**（见 app.css 的 .cover-bg），不再铺封面大图了。
       但去重的判据必须是**封面 URL**，不能是"有没有封面"这个布尔值 ——
       用布尔值的话第一首之后永远相等，整个函数直接早退，
       色调就永远停在第一首上（曾经因此所有歌都是同一个颜色）。 */
    const art = track?.cover || null;
    if (art === lastArtUrl) return;
    lastArtUrl = art;

    if (!art) {
      el.coverBg?.classList.remove('is-on');
      el.scrim?.classList.remove('is-on');
      return;
    }
    el.coverBg.classList.add('is-on');
    el.scrim?.classList.add('is-on');

    // 取三个色调，既给渐变当色源，也给玻璃面板和舞台当主色。
    // 3 色来自 C 算法 5 档里的 stops[2]/[3]/[4]（中间到亮端），
    // 避开深端两档在深色封面上接近纯黑、铺出来看不见。
    const colors = await Player.extractColors(API.img(track.cover, 400));
    if (!colors || art !== lastArtUrl) return;   // 快速切歌：过期结果别盖新歌
    const [a, b, c] = colors.map(rgbToOklch);
    const rs = document.documentElement.style;
    rs.setProperty('--tone-a', a);
    rs.setProperty('--tone-b', b);
    rs.setProperty('--tone-c', c);
    /* 背景由"色条颜色"驱动。走转场进来时 runTrackTransition 已经设过 --bar-a/b 了；
       但直接从播放条进播放页、或刷新后恢复时没有转场，这里补上，
       否则背景会一直停在默认色。 */
    rs.setProperty('--bar-a', a);
    rs.setProperty('--bar-b', b);
    // 舞台要用的是原始 RGB（作品里直接拼 rgba 字符串，比再转一次快）
    accentRgb = colors[0];
    /* 抽屉顶部那层 3~4% 的极淡主色光（复用这里的封面取色，不另写取色） */
    drawer.style.setProperty('--drawer-tint', a);
    StageHost.refresh();
    /* 大厅此刻如果正开着铺色态，封面刚换 → 专辑底色也要跟着换。
       这里只重写 CSS 变量 / WebGL 调色板，不重放展开动画。 */
    try { Hall.refreshThemeColors(); } catch { /* 大厅还没初始化：随后的 mount 会自己画 */ }
  }

  /* ================================================================== *
   * 歌单
   * ================================================================== */
  async function openPlaylist(p) {
    el.playlists.querySelectorAll('.pl').forEach((b) => b.classList.toggle('is-active', +b.dataset.id === p.id));
    el.plName.textContent = p.name;
    el.plSub.textContent = '正在载入…';
    el.tracks.innerHTML = '<p class="hint">正在载入曲目…</p>';
    if (p.cover) { el.plCover.src = API.img(p.cover, 160); el.plCover.hidden = false; }
    else el.plCover.hidden = true;

    try {
      const d = await API.playlistDetail(p.id);
      el.plName.textContent = d.playlist.name || p.name;
      el.plSub.textContent = `${d.playlist.trackCount || d.tracks.length} 首 · 播放 ${fmtCount(d.playlist.playCount)}` +
        (d.playlist.creator ? ` · ${d.playlist.creator.nickname}` : '');
      renderTracks(d.tracks);
    } catch (e) {
      el.plSub.textContent = '载入失败：' + e.message;
      el.tracks.innerHTML = '<p class="hint">载入失败，请确认服务端在运行</p>';
    }
  }

  /* ================================================================== *
   * 大厅（V4 巨幅封面）
   *   上半：巨幅封面 = **上一首播放的歌**（存 localStorage，重启还在）
   *   中：四张入口卡（形态长廊 / 我的专辑 / 音乐实验室 / 工具箱）+ 六平台方块
   *   铺色：点已登录平台 → 这一整块换成平台色：顶部平台图标长条 +
   *         每日推荐跑马带 + 精选/我的喜欢/我收藏的歌单/电台四张卡
   *   2026-11-06：本日推荐和下滑的推荐歌单已删，大厅不再做下滑页。
   * ================================================================== */
  const Hall = (() => {
    const KEY = 'lizi.hall.lastTrack';
    let mounted = false;
    let last = null;                 // 上一首播放的曲目
    let dailyTracks = [];            // 每日推荐（铺色态跑马带，点一首就播）
    let platRows = [];               // 最近一次「我的」查询结果（铺色长条要看登录态）
    let platMode = '';               // 当前铺色的平台 id（'' = 普通态）
    /* 「收起面板 / 只留海报」：左侧竖排页签最下面的下三角切换（2026-11-09）。
       收起时 #hall-plat 整块 display:none，海报吃掉全部高度；退出铺色 / 换平台自动复位。 */
    let platFolded = false;
    /* 手机上的折叠反着来（2026-11-09）：同一个下三角折的是「海报」——
       海报收成 0 高，铺色面板 / 左轨吃满剩余高度，跑马带和流色继续跑。
       只走 @media (max-width:1280px) and (pointer:coarse) 与 is-hero-folded；
       桌面（pointer:fine）完全不到这里，仍然用 platFolded / is-plat-folded。 */
    let heroFolded = false;
    let heroDrag = null;             // 正在拖分隔抓手：见 heroGripDown
    let heroDragRaf = 0, heroSnapRaf = 0, heroRelayoutRaf = 0;
    let heroGripEl = null;           // 面板顶部的分屏抓手（只在手机铺色态创建）
    const HERO_SNAP_RATIO = 0.35;    // 松手：海报露出 ≥ 35% 展开高度就吸附到分屏
    const HERO_FLICK_V = 140;        // px/s：快速下甩直接展开、上甩直接收起
    /* 用户主动退出铺色后的本会话静默：不再自动拉回铺色态（否则点当前平台图标等于没用）。
       刷新页面会重置 —— 下次进来照样按「上次平台 / 网易云」直接铺色。 */
    let platOptOut = false;
    let platExitSeq = 0;             // 退场动画的序号：期间又进来一次，旧的收尾就别再动 DOM
    let marqRaf = 0, marqX = 0, marqHalf = 0;
    let marqPaused = false, marqDrag = null, marqMoved = false;
    /* 铺色态上一次写进 #hall-plat 的卡宽（0 = 还没量过）：高度没变就不重排、不重量 */
    let platCardW = 0;
    /* ---------- 铺色态左侧页签（2026-11-08） ----------
       竖向 Rubber Segment 的选中项：song / stage / myalbums / box，持久化在
       localStorage。进入铺色态按它恢复面板内容；box / stage 会盖一层页签面板。 */
    const SIDE_KEY_STORE = 'lizi.hall.sidekey';
    const SIDE_TABS = ['song', 'stage', 'myalbums', 'box'];
    let sideTab = (() => {
      try {
        const v = localStorage.getItem(SIDE_KEY_STORE);
        return SIDE_TABS.includes(v) ? v : 'song';
      } catch { return 'song'; }
    })();
    /* ---------- 铺色面板：整块翻面的四棱柱（2026-11-08 终版） ----------
       翻转的是**整块铺色面板**：每个 face 都是完整面板（22px 圆角、10px 内边距、
       顶部条 + 内容），四块尺寸都等于 #hall-plat 的矩形，切换只绕 X 轴翻滚：
         song     平台铺色底 + 顶部平台条 + 每日推荐跑马带
         stage    中性玻璃底 + 精简顶部条 + 搜索/收藏/齿轮 + 形态方块网格
         myalbums 中性玻璃底 + 精简顶部条 + 借用 #view-myalbums 的 3D 陈列架
         box      中性玻璃底 + 精简顶部条 + 工具箱入口卡
       #hall-plat 只当舞台 / 尺寸容器（perspective + 静态投影 + 裁切）；
       背景、内边距、圆角、顶部条都由各个 face 自己承担。 */
    let prism = null, prismBox = null;
    const faces = Object.create(null);
    let faceIndex = Math.max(0, SIDE_TABS.indexOf(sideTab));
    let faceAngle = -faceIndex * 90;   // 面 i 的静态 transform 是 rotateX(i*90)，盒子反向转
    let prismRollT = 0;
    let stageFaceIO = null;            // 形态网格图 IntersectionObserver
    let stageQuery = '';
    let stageFavOnly = false;
    let stageSearchT = 0;
    const STAGE_FAVS_KEY = 'lizi.forms.favs';
    let stageFavs = (() => {
      try {
        const a = JSON.parse(localStorage.getItem(STAGE_FAVS_KEY) || '[]');
        return new Set(Array.isArray(a) ? a.map(String) : []);
      } catch { return new Set(); }
    })();
    let myAlbumsHome = null;           // #view-myalbums 原位置占位注释
    let myAlbumsRestoreT = 0;
    /* 我的专辑全屏态（2026-11-08）：按钮在面的抬头上，点了把 #view-myalbums
       搬进 body 末尾的 .ma-fs 容器。maFsOpen 是防重入标志，maFsEl 只建一次。 */
    let maFsOpen = false;
    let maFsEl = null;
    /* 环收起时的对齐缓动：{ from, to, t0, dur }，在跑马带自己的 rAF 里逐帧写 marqX。
       seek 期间不叠加自动滚动；结束/被取消后照常从当前位置走。 */
    let marqSeek = null;
    /* 跑马带速度：0–100 → 0.10–1.20 px/帧（设置页「外观 → 推荐跑马带速度」）。
       默认 24 ≈ 0.36，比最初写死的 0.6 慢四成。读库/写在设置页那一段（marqSpeedStored）。 */
    const marqSpeedOf = (v) => {
      v = Number(v);
      if (!Number.isFinite(v)) v = 24;
      return 0.10 + Math.max(0, Math.min(100, v)) * 0.011;
    };
    let marqSpeedPx = marqSpeedOf(marqSpeedStored());

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const H = {
      hero: $('hall-hero'), art: $('hall-hero-art'), when: $('hall-hero-when'),
      title: $('hall-hero-title'), sub: $('hall-hero-sub'),
      play: $('hall-hero-play'), open: $('hall-hero-open'),
      cover: $('hall-hero-cover'), coverImg: $('hall-hero-cover-img'),
      lyrics: $('hall-hero-lyrics'), rows: $('hall-hero-rows'), note: $('hall-hero-note'),
      lock: $('hall-hero-lock'),
      tools: $('hall-tools'), me: $('hall-me'),
      rail: $('hall-rail'), plat: $('hall-plat'),
      platBar: $('hall-plat-bar'),
      srcMenu: $('hall-src-menu'),          // 左上角「每日推荐」的悬停来源浮层
      marq: $('hall-marq'),
    };

    /* ---------- 上一首播放：存 / 读 ---------- */
    function readSaved() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
    }

    function ago(ts) {
      if (!ts) return '还没播过';
      const m = Math.floor((Date.now() - ts) / 60000);
      if (m < 1) return '刚刚';
      if (m < 60) return m + ' 分钟前';
      const h = Math.floor(m / 60);
      if (h < 24) return h + ' 小时前';
      const d = Math.floor(h / 24);
      return d < 30 ? d + ' 天前' : new Date(ts).toLocaleDateString('zh-CN');
    }

    /** 锁定键：有海报才出现；aria-pressed / is-on 每次重画都跟 heroLocked 对齐 */
    function paintHeroLock(has) {
      const b = H.lock;
      if (!b || !b.classList || typeof b.setAttribute !== 'function') return;
      const on = !!has && heroLocked;
      b.hidden = !has;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
    }

    /* 海报播放键：只有队列里当前曲目就是海报这首、且正在播时才显示暂停态。
       暂停态用 CSS 的均衡条动画，其余情况保持静态三角。 */
    function heroPlaySame() {
      const s = Player.state;
      const cur = s.queue[s.index];
      return !!(last && last.id && cur && String(cur.id) === String(last.id));
    }
    function syncHeroPlay() {
      const b = H.play;
      if (!b) return;
      const playing = heroPlaySame() && !!Player.state.playing;
      b.classList.toggle('is-playing', playing);
      b.setAttribute('aria-label', playing ? '暂停' : '播放');
      b.title = playing ? '暂停' : '继续播放';
    }

    function paintHero() {
      const has = !!(last && last.id);
      if (!has) heroLocked = false;      // 没歌就没得锁，别留一个锁着的空海报
      paintHeroLock(has);
      H.hero.classList.toggle('has-art', has && !!last.cover);
      if (!has) {
        H.art.classList.remove('is-on');
        H.art.style.backgroundImage = '';
        H.coverImg.removeAttribute('src');
        H.title.textContent = '从下面挑一个平台开始';
        H.sub.textContent = '点已登录的平台方块，进入它的专属首页';
        H.when.textContent = '还没播过';
        H.play.hidden = true;
        H.open.hidden = true;
        hLyric = { id: '', lines: [], active: 0, state: 'none' };
        paintHeroLyrics();
        heroGeom();
        return;
      }
      if (last.cover) {
        const src = API.img(last.cover, 1200);
        H.art.style.backgroundImage = 'url("' + src + '")';
        H.art.classList.add('is-on');
        /* 方形封面和满幅底图同一个 URL（同一张解码图，不额外占内存） */
        if (H.coverImg.getAttribute('src') !== src) H.coverImg.src = src;
      } else {
        H.art.classList.remove('is-on');
        H.coverImg.removeAttribute('src');
      }
      /* 铺色态开着时，海报封面换了 = 专辑底色也要换（不动展开动画） */
      refreshThemeColors();
      H.title.textContent = last.name || '未知曲目';
      /* 大厅 hero：歌手名 → 歌手页，封面/专辑名 → 专辑页（都是可点入口） */
      H.sub.innerHTML = last.album
        ? `${artistLinks(last.artists, last.artistIds)} · ${albumLink(last.album, last.albumId)}`
        : artistLinks(last.artists, last.artistIds);
      if (last.albumId) H.art.dataset.alb = last.albumId;
      else delete H.art.dataset.alb;
      H.when.textContent = ago(last.at);
      H.play.hidden = false;
      H.open.hidden = true;
      paintHeroLyrics();
      heroGeom();
      syncHeroPlay();
    }

    /** 曲目变了就记一笔（Player 那边 trackchange 会调） */
    function saveTrack(track) {
      if (!track || !track.id) return;
      last = {
        id: track.id,
        /* 平台标记：海报取歌词 / 冷启动重建队列都靠它选接口。
           老版本存进 localStorage 的条目没有这个字段，读回来一律按 netease 处理。 */
        source: track.source || 'netease',
        /* QQ 认 songmid、酷狗认 hash；id 里通常已经是它们，单独存一份更稳 */
        mid: track.mid || '',
        hash: track.hash || '',
        /* 酷狗取直链要用这两个数字 id（见 api.js srcSongUrl） */
        albumIdNum: track.albumIdNum || 0,
        albumAudioId: track.albumAudioId || 0,
        name: track.name || '',
        artists: track.artists || '',
        artistIds: track.artistIds || [],
        album: track.album || '',
        albumId: track.albumId || null,
        cover: track.cover || '',
        duration: track.duration || 0,
        at: Date.now(),
      };
      try { localStorage.setItem(KEY, JSON.stringify(last)); } catch {}
      /* 换歌了：海报上的歌词是上一首的，作废重取（悬停着的话立刻补上）。
         平台也算进"是不是同一首"：同 id 换平台（撞号）时不能留旧词。 */
      if (String(hLyric.id) !== String(last.id)
          || (hLyric.src || 'netease') !== (last.source || 'netease')) {
        hLyric = { id: '', lines: [], active: 0, state: 'idle' };
        if (hovering) loadHeroLyrics();
      }
      paintHero();
      /* 正在放的就是这首（比如刚点了海报上的播放键）→ 跟随要立刻接上 */
      syncHeroLive();
      syncHeroPlay();
    }

    /* ==================================================================
     * 海报：悬停展开歌词 → 点一下飞进播放页
     *
     * 几何（尺寸变了才写一次，动画帧里一个样式都不写）：
     *   --hero-ck   静止尺度 = 海报宽 / 海报高（方形封面放大到正好铺满整幅）
     *   --hero-cy   静止竖向偏移 = (宽 - 高) / 2（取中间那条，和满幅底图同构图）
     *   --hero-cs   悬停尺度 ≈ .86（左下角，左/下边界贴死海报）
     *   --hero-side 悬停封面宽度，歌词从它右边开始
     * 悬停过程只动 transform / opacity（封面缩放 + 底图压暗 + 歌词淡入）。
     * ================================================================== */
    const HOVER_S = 0.86;
    /* heroLocked：右上角小锁钉住的展开态（会话内有效，不持久化）。
       锁着时鼠标移开 / 焦点移走也继续展开；解锁后回到纯悬停语义。 */
    let hovering = false, hoverPtr = false, hoverFocus = false, heroLocked = false;
    let hLyric = { id: '', lines: [], active: 0, state: 'idle' };
    let hLyricReq = 0;
    let hPrefetch = null;                 // 播放页 500px 封面预热
    let flying = false, flyToken = 0;

    /* 实时歌词的两个开关（别搞混）：
         lv.armed   悬停 + 海报在视口里 + 这首有词 + 播放器就是这首 → 挂 play/pause/seeked
         lv.active  armed 且正在播                                  → 再挂 timeupdate（+ 缓动时的 rAF）
       暂停只摘 active：字停在高亮不动；armed 留着才知道用户什么时候又按播放。
       移开鼠标 / 切视图 / 换歌 / 滚出视口 → armed 一起摘，rAF 立刻 cancel。
       缓动用自己的一只 rAF（只在换行后那 560ms 里跑），不做常驻帧循环。 */
    const lv = { armed: false, active: false, raf: 0, target: null, done: null };

    /* 自查钩子（验收脚本读它，不参与任何逻辑） */
    window.__heroLive = {
      get active() { return lv.active; },
      get armed() { return lv.armed; },
      get easing() { return !!lv.raf; },
      get index() { return hLyric.active; },
      get id() { return hLyric.id; },
      get state() { return hLyric.state; },
      get lines() { return hLyric.lines.length; },
      get shift() { return heroShift(); },
      get from() { const f = H.rows.firstElementChild; return f ? +f.dataset.i : -1; },
      get to() { const l = H.rows.lastElementChild; return l ? +l.dataset.i : -1; },
      get times() { return hLyric.lines.map((l) => l.t); },
    };

    function heroGeom() {
      const r = H.hero.getBoundingClientRect();
      const w = r.width, h = r.height;
      if (w < 40 || h < 40) return;
      const s = H.hero.style;
      s.setProperty('--hero-ck', Math.max(1, w / h).toFixed(4));
      s.setProperty('--hero-cy', ((w - h) / 2).toFixed(2) + 'px');
      s.setProperty('--hero-cs', HOVER_S.toFixed(4));
      s.setProperty('--hero-side', (h * HOVER_S).toFixed(1) + 'px');
      applyHeroLyricShift();
    }

    function syncHover() {
      const on = hoverPtr || hoverFocus || heroLocked;
      if (on === hovering) return;
      hovering = on;
      H.hero.classList.toggle('is-hover', on);
      if (on) {
        heroGeom();
        loadHeroLyrics();                // 已缓存时同步返回
        /* 正在放这首歌：每次悬停都按播放头对齐到"现在这句"，别停在上次悬停时那句 */
        if (hLyric.state === 'ok') heroSnap();
      } else {
        if (lv.raf) heroSettle();        // 缓动到一半移开：先落位，别定在两行之间
        heroArm(false);                  // 监听 + rAF 一次摘干净
      }
      syncHeroLive();
    }

    /** 回到大厅时，指针/键盘如果还在海报上，悬停态要立刻接上 */
    function resyncHover() {
      if (!mounted) return;
      hoverPtr = H.hero.matches(':hover');
      hoverFocus = H.hero.contains(document.activeElement);
      hovering = false;
      syncHover();
      requestAnimationFrame(heroGeom);
    }

    /* ---------------- 歌词：悬停时才取，取到后跟着播放头实时走 ----------------
       观感 = 播放页那套的缩小版：当前行压在窗口中线、逐句往上流。
       DOM 里只放当前行前后各 2 行（共 5 行，几百行的歌也不整首渲染），窗口随播放头滑动。
       换行时整块往上缓动一整行，缓动结束的同一帧里换掉窗口内容并把位移归位 ——
       两者在同一帧完成，且都发生在上下遮罩里，看不出接缝。
       时长 / 缓动曲线照抄播放页的 scrollLyricToEl（560ms / cubic ease-out）。 */
    const LYR_MS = 560;
    const lyrEase = (t) => 1 - Math.pow(1 - t, 3);

    function heroNoteText() {
      if (!last || !last.id) return '从下面挑一张歌单，先听一首';
      if (hLyric.state === 'loading') return '正在取歌词…';
      if (hLyric.state === 'none') return `${last.name || '这首'} · 没有歌词`;
      return '点开听';
    }

    /** 当前位移（px）：直接读 inline transform —— 缓存和实际写歪一点就再也对不齐 */
    function heroShift() {
      const m = /translateY\((-?[\d.]+)px\)/.exec(H.rows.style.transform || '');
      return m ? +m[1] : 0;
    }

    function setHeroShift(v) {
      H.rows.style.transform = (v == null || !isFinite(v)) ? '' : `translateY(${v.toFixed(2)}px)`;
    }

    /** 第 active 行压在锚点上时该有的 translateY（null = 还量不出来）。
     *  量之前先把位移清零（同步做完、同一帧恢复，不会闪）：transform 不影响布局，
     *  但会影响 getBoundingClientRect —— 不清零就把上一次的位移算两遍。
     *  用实测矩形而不是 offsetTop：长句会折行、带翻译的行更高，行高并不相等。 */
    function heroShiftFor(active) {
      const box = H.lyrics.getBoundingClientRect();
      if (box.height < 40) return null;                 // 还没布局出来，等悬停时再算
      const row = H.rows.querySelector(`.ly[data-i="${active}"]`);
      if (!row) return null;
      const prev = H.rows.style.transform;
      H.rows.style.transform = '';
      const r = row.getBoundingClientRect();
      H.rows.style.transform = prev;
      if (!r.height) return null;
      /* 中线；开头两句往上收到 1/3，别把第一句切掉（和改版前一致） */
      const frac = active >= 2 ? 0.5 : 0.33;
      return box.height * frac - (r.top + r.height / 2 - box.top);
    }

    /** 立即落位（不缓动）：换歌 / seek / 尺寸变化 / 刚悬停 */
    function applyHeroLyricShift() {
      cancelHeroEase();
      setHeroShift(null);
      if (!H.rows.children.length) return;
      setHeroShift(heroShiftFor(hLyric.active));
    }

    /** 当前行换高亮（不动 DOM，只换类 —— 位置交给缓动） */
    function markHeroActive(a) {
      H.rows.querySelectorAll('.ly').forEach((p) => {
        p.classList.toggle('is-active', +p.dataset.i === a);
      });
    }

    function paintHeroLyrics() {
      H.rows.innerHTML = '';
      const lines = hLyric.lines;
      if (!lines.length) {
        /* 拿不到歌词 / 没有历史曲目：给一句提示，不留一块空框，也不造假歌词 */
        H.note.hidden = false;
        H.note.textContent = heroNoteText();
        return;
      }
      H.note.hidden = true;
      const a = Math.max(0, Math.min(hLyric.active, lines.length - 1));
      hLyric.active = a;
      /* 当前行前后各 2 行 = 5 行；不够 5 行就从第 1 行起铺满 */
      const from = Math.max(0, Math.min(a - 2, lines.length - 5));
      const to = Math.min(lines.length, from + 5);
      const frag = document.createDocumentFragment();
      for (let i = from; i < to; i++) {
        const l = lines[i];
        const p = document.createElement('p');
        p.className = 'ly' + (i === a ? ' is-active' : '');
        p.dataset.i = String(i);
        const main = document.createElement('span');
        main.className = 'ly__main';
        if (l.chars && l.chars.length) {
          l.chars.forEach((ch, ci) => {
            const s = document.createElement('span');
            s.className = 'ly__c';
            s.dataset.ci = String(ci);
            s.textContent = ch.c;
            main.appendChild(s);
          });
        } else {
          main.textContent = l.text;
        }
        p.appendChild(main);
        if (l.tr) {
          const tr = document.createElement('span');
          tr.className = 'ly__tr';
          tr.textContent = l.tr;
          p.appendChild(tr);
        }
        frag.appendChild(p);
      }
      H.rows.appendChild(frag);
      applyHeroLyricShift();
    }

    /** 播放头在第几行。二分和容差都照 Player.lyricAt 抄，保证和播放页指着同一句 */
    function lineAt(lines, t) {
      let lo = 0, hi = lines.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return found;
    }
    const heroLineAt = (t) => lineAt(hLyric.lines, t);

    /** 播放头如果正停在海报这首上，就从那一句展开；否则从第 1 行起 */
    function heroActiveIndex(id, n) {
      const s = Player.state;
      const cur = s.queue[s.index];
      if (!cur || String(cur.id) !== String(id)) return 0;
      const i = lineAt(hLyric.lines, Player.audio.currentTime || 0);
      return i < 0 ? 0 : Math.min(n - 1, i);
    }

    /* ---- 缓动：一只 rAF，只在换行后那 560ms 里跑 ---- */
    function cancelHeroEase() {
      if (lv.raf) cancelAnimationFrame(lv.raf);
      lv.raf = 0;
      lv.target = null;
      lv.done = null;
    }

    function heroEaseTo(target, done) {
      cancelHeroEase();
      const from = heroShift();
      const d = target - from;
      if (Math.abs(d) < 0.5) { setHeroShift(target); if (done) done(); return; }
      const t0 = performance.now();
      lv.target = target;
      lv.done = done;
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / LYR_MS);
        setHeroShift(from + d * lyrEase(t));
        if (t < 1) { lv.raf = requestAnimationFrame(step); return; }
        const fin = lv.done;
        lv.raf = 0; lv.target = null; lv.done = null;
        setHeroShift(target);
        if (fin) fin();
      };
      lv.raf = requestAnimationFrame(step);
    }

    /** 正在缓动的那一行立刻落位（暂停 / 移开鼠标 / 切视图时用） */
    function heroSettle() {
      if (!lv.raf) return;
      const target = lv.target, fin = lv.done;
      cancelHeroEase();
      setHeroShift(target);
      if (fin) fin();
    }

    /** 直接跳到当前行（seek / 换歌 / 刚悬停）：绝不从上一行一路滑过去 */
    function heroSnap() {
      cancelHeroEase();
      const i = heroLineAt(Player.audio.currentTime || 0);
      hLyric.active = i < 0 ? 0 : i;
      paintHeroLyrics();                    // 重建 5 行窗口 + 立即落位
    }

    /** 播放头动了：逐句跟随。只有 +1 行才缓动，跳得远就直接落位 */
    function heroFollow(t) {
      const lines = hLyric.lines;
      if (!lines.length) return;
      const idx = heroLineAt(t);
      if (idx < 0 || idx === hLyric.active) return;      // 同一句：一个节点都不动
      if (idx === hLyric.active + 1) {
        /* 下一句本来就在窗口里（±2 行）：先换高亮，再把整块往上滚一行 ——
           和播放页"先加 is-active 再 scroll"是同一个顺序 */
        const target = heroShiftFor(idx);
        hLyric.active = idx;
        markHeroActive(idx);
        if (target == null) { paintHeroLyrics(); return; }   // 窗口里没有下一行（结尾）：直接落位
        heroEaseTo(target, () => { if (hLyric.active === idx) paintHeroLyrics(); });
        return;
      }
      heroSnap();                                          // 跳行（拖进度条 / seek）
    }

    /* ---- 开关：什么时候才挂监听 / 起 rAF ---- */
    /** 海报在视口里吗（悬停中把页面滚走就别再算） */
    function heroInView() {
      const r = H.hero.getBoundingClientRect();
      return r.bottom > 24 && r.top < innerHeight - 24;
    }

    /** 海报上的歌词是不是"这首歌、真的有词" */
    function heroLyricLive() {
      if (hLyric.state !== 'ok' || !hLyric.lines.length) return false;
      const s = Player.state, cur = s.queue[s.index];
      /* 平台也要对上：只比 id 的话，酷我的数字 rid 和网易云撞号时会把别家的词当成这首歌 */
      return !!cur
        && String(cur.id) === String(hLyric.id)
        && (cur.source || 'netease') === (hLyric.src || 'netease');
    }

    /** 跟随档：timeupdate 监听 + 缓动 rAF */
    function heroRun(on) {
      on = !!on;
      if (on === lv.active) return;
      lv.active = on;
      const a = Player.audio;
      const m = on ? 'addEventListener' : 'removeEventListener';
      a[m]('timeupdate', heroTick);
      if (on) heroFollow(a.currentTime);          // 立刻对齐，不等下一个 timeupdate
      else heroSettle();                          // 缓动到一半要停：先落位，别定在两行之间
    }

    /** 这次悬停的资源档：play / pause / seeked */
    function heroArm(on) {
      on = !!on;
      if (on === lv.armed) return;
      lv.armed = on;
      const a = Player.audio;
      const m = on ? 'addEventListener' : 'removeEventListener';
      a[m]('playing', heroPlaying);
      a[m]('pause', heroPaused);
      a[m]('seeked', heroSeeked);
      heroRun(on && !!Player.state.playing);
    }

    /** 唯一的总开关：悬停 / 视口 / 视图 / 换歌 / 播停 / 歌词到位 都走这里 */
    function syncHeroLive() {
      const armed = !!mounted && hovering && !flying && heroLyricLive() && heroInView();
      heroArm(armed);
      heroRun(armed && !!Player.state.playing);
    }

    function heroTick() { if (lv.active) heroFollow(Player.audio.currentTime); }
    /* 拖进度条 / 点歌词跳转：不缓冲，直接跳行 */
    function heroSeeked() { if (lv.armed) heroSnap(); }
    function heroPlaying() { if (lv.armed) heroRun(true); }
    function heroPaused() {
      if (!lv.armed) return;
      heroSettle();                 // 正在缓动的那一行先收尾，暂停后字不能再动
      heroRun(false);               // 摘掉 timeupdate
    }

    async function loadHeroLyrics() {
      const t = last;
      const id = t && t.id ? String(t.id) : '';
      if (!id) {
        hLyric = { id: '', lines: [], active: 0, state: 'none' };
        paintHeroLyrics();
        syncHeroLive();
        return;
      }
      /* 平台：老版本存进 localStorage 的 last 没有 source（那时只有网易云），
         一律按 netease 走 —— 行为和改之前完全一致，不回归。 */
      const src = t.source || 'netease';
      /* 缓存键带平台：酷我 / 网易云都是数字 id，只比 id 会撞号复用错歌的歌词 */
      const key = `${src}:${id}`;
      if (hLyric.key === key && (hLyric.state === 'ok' || hLyric.state === 'none')) return;
      const token = ++hLyricReq;
      hLyric = { id, src, key, lines: [], active: 0, state: 'loading' };
      paintHeroLyrics();
      /* 顺手把播放页那张 500px 封面预热 —— 替身落地时真封面不能还是空的 */
      if (t.cover) { hPrefetch = new Image(); hPrefetch.src = API.img(t.cover, 500); }
      try {
        /* 取词按平台分流，和 player.js startTrackMeta 同构：
           QQ 认 songmid，酷狗 srcLyric 内部用 hash + 歌名，其余边车认自己的 id。
           各平台返回形状已由 server.mjs 归一成 { lyric, tlyric, format }，这里不另写解析。 */
        const d = src === 'qq'
          ? await API.qqLyric(t.mid || t.id)
          : src === 'netease'
            ? await API.lyric(t.id)
            : await API.srcLyric(t);
        if (token !== hLyricReq) return;
        const lines = (Player.parseLyrics(d || {}) || {}).lines || [];
        const bogus = !lines.length
          || /^(暂无歌词|纯音乐)/.test((lines[0].text || '').trim());
        hLyric = { id, src, key, lines: bogus ? [] : lines, active: 0, state: bogus ? 'none' : 'ok' };
      } catch {
        if (token !== hLyricReq) return;
        hLyric = { id, src, key, lines: [], active: 0, state: 'none' };
      }
      if (hLyric.state === 'ok') {
        /* 换歌 / 冷启动：按此刻的播放头挑当前行，不要从第 1 行慢慢滑过去 */
        hLyric.active = heroActiveIndex(id, hLyric.lines.length);
      }
      paintHeroLyrics();
      syncHeroLive();
    }

    /* ---------------- 点击 → 播放页（FLIP） ---------------- */
    /** 播放页要显示的就是海报这首。冷启动没队列时把它装进 Player，但**不自动播** */
    function ensureHeroTrack() {
      const s = Player.state;
      const cur = s.queue[s.index];
      if (cur && String(cur.id) === String(last.id)) return;
      Player.playQueue([last], 0, false);
    }

    function heroCoverRect() {
      if (!H.coverImg.getAttribute('src')) return null;
      const r = H.coverImg.getBoundingClientRect();
      return r.width > 8 && r.height > 8 ? r : null;
    }

    /** 手里已经有歌词：先铺进播放页，落地后不用等 Player 那一趟请求 */
    function seedNowLyric() {
      if (!hLyric.lines.length || !el.lyrics) return;
      const s = Player.state;
      const cur = s.queue[s.index];
      if (!cur || String(cur.id) !== String(hLyric.id)) return;
      el.lyrics.dataset.count = '';       // 强制重建，避免行数相同被缓存挡住
      renderLyric({ lines: hLyric.lines, active: hLyric.active, charIndex: -1, format: '' });
    }

    function openHero() {
      if (flying || !last || !last.id) return;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const a0 = heroCoverRect();
      const l0 = H.lyrics.getBoundingClientRect();
      const act0 = H.rows.querySelector('.ly.is-active');
      const ar0 = act0 ? act0.getBoundingClientRect() : null;
      const anchorY = ar0 ? ar0.top + ar0.height / 2 : l0.top + l0.height / 2;
      const img = H.coverImg.getAttribute('src') || '';

      ensureHeroTrack();

      /* 减少动态 / 没有封面：直接切，不做飞行（但歌词照样先铺好） */
      if (reduce || !a0) {
        el.viewNow.classList.add('from-hero');
        show('now');
        seedNowLyric();
        return;
      }

      flying = true;
      const token = ++flyToken;

      /* 1) 替身层：按**悬停态实测**的封面矩形和歌词矩形摆好 */
      const fly = document.createElement('div');
      fly.className = 'hero-fly';
      fly.setAttribute('aria-hidden', 'true');
      const fArt = document.createElement('div');
      fArt.className = 'hero-fly__art';
      fArt.style.left = a0.left + 'px';
      fArt.style.top = a0.top + 'px';
      fArt.style.width = a0.width + 'px';
      fArt.style.height = a0.height + 'px';
      fArt.style.backgroundImage = 'url("' + img + '")';
      fly.appendChild(fArt);

      let fLyr = null;
      /* 只有"此刻真的亮着歌词"才带上它飞；在静止态直接点（指针已经移开）就只飞封面 */
      if (hovering && H.rows.children.length) {
        fLyr = document.createElement('div');
        fLyr.className = 'hero-fly__lyrics';
        fLyr.style.left = l0.left + 'px';
        fLyr.style.top = l0.top + 'px';
        fLyr.style.width = l0.width + 'px';
        fLyr.style.height = l0.height + 'px';
        /* 替身盒必须和海报里那扇歌词盒同一种版式（flex 竖向居中）：
           5 行比盒子高时，原盒里的歌词块是**上下各溢出一截**的居中态，
           而 .hero-fly__lyrics 只是个普通块盒 —— 不补这三行，clone 会贴着盒顶，
           起飞第一帧就比屏幕上低半行（实测 83.5px）。 */
        fLyr.style.display = 'flex';
        fLyr.style.flexDirection = 'column';
        fLyr.style.justifyContent = 'center';
        const rows = H.rows.cloneNode(true);
        rows.removeAttribute('id');
        fLyr.appendChild(rows);
        fly.appendChild(fLyr);
      }
      document.body.appendChild(fly);

      /* 2) 切页面。先关掉播放页的布局过渡和进场动画，终点才是最终值 */
      H.hero.classList.add('is-flying');
      document.body.classList.add('is-hero-flying');
      el.viewNow.classList.add('from-hero', 'no-layout-anim');
      show('now');
      void el.viewNow.offsetWidth;               // 强制重排，让上面的类先生效
      alignArtToLyrics();                        // 封面列下移到歌词中线，再量终点
      const disc = el.viewNow.querySelector('.disc');
      const a1 = disc ? disc.getBoundingClientRect() : null;
      const l1 = el.lyrics ? el.lyrics.getBoundingClientRect() : null;
      el.viewNow.classList.remove('no-layout-anim');
      /* 歌词先欠着：这会儿铺 41 行 52px 大字会让切页的第一帧多背一次文字排版。
         飞行层已经在合成器上跑，等它起飞后再铺，落地前一定到齐。 */
      setTimeout(() => { if (el.lyrics && !el.lyrics.querySelector('.ly')) seedNowLyric(); }, 200);

      /* 3) 飞行：封面 translate + 等比 scale（正方形 → 正方形，图不变形）；
            歌词只 translate —— 两边字号本来就一模一样，缩放文字反而会糊/会抖。
            关键帧里只有 transform（圆角/投影不参与）→ 能整条丢给合成器，掉不了帧。 */
      const DUR = 420;
      const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';   /* --ease-inout：起飞和落位都柔和 */
      const anims = [];
      if (a1 && a1.width > 8) {
        const sx = a1.width / a0.width;
        anims.push(fArt.animate([
          { transform: 'translate(0px, 0px) scale(1)' },
          { transform: `translate(${(a1.left - a0.left).toFixed(2)}px, ${(a1.top - a0.top).toFixed(2)}px) scale(${sx.toFixed(4)})` },
        ], { duration: DUR, easing: ease, fill: 'both', composite: 'replace' }));
      } else {
        fArt.style.display = 'none';
      }
      if (fLyr && l1) {
        anims.push(fLyr.animate([
          { transform: 'translate(0px, 0px)' },
          { transform: `translate(${(l1.left - l0.left).toFixed(2)}px, ${((l1.top + l1.height / 2) - anchorY).toFixed(2)}px)` },
        ], { duration: DUR, easing: ease, fill: 'both' }));
      }

      /* 4) 落位：露真元素，替身淡出 100ms 后从 DOM 里删掉 */
      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        /* 落地前歌词一定先到齐，免得替身淡出后露出一块空面板 */
        if (el.lyrics && !el.lyrics.querySelector('.ly')) seedNowLyric();
        document.body.classList.remove('is-hero-flying');
        const fade = fly.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: 100, easing: 'linear', fill: 'forwards' });
        fade.onfinish = () => fly.remove();
        setTimeout(() => fly.remove(), 150);     // 兜底：后台标签页 onfinish 可能不来
        setTimeout(() => {
          if (token === flyToken) flying = false;
          H.hero.classList.remove('is-flying');
        }, 90);
        heroFlightCleanup = null;
      };
      Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(land);
      setTimeout(land, 560);                     // 兜底：被取消/卡住也要收场

      /* 还没落地就被切走：立刻回收，不留残骸 */
      heroFlightCleanup = () => {
        if (done) return;
        done = true;
        fly.remove();
        document.body.classList.remove('is-hero-flying');
        H.hero.classList.remove('is-flying');
        if (token === flyToken) flying = false;
      };
    }

    /* ---------- 每日推荐（铺色态跑马带的数据） ----------
       登录账号的「每日推荐」（recommend/songs：30+ 首，带推荐理由）。
       拿不到（没登录 / 边车没起）就退回匿名 personalized 那 3 条，不至于空着。
       只存数据，渲染交给 renderMarq()——跑马带只在铺色态出现。 */
    async function paintDaily() {
      let tracks = [];
      try {
        const s = await fetch('/api/netease/recommend/songs').then((r) => r.json());
        const arr = (s && s.data && s.data.dailySongs) || [];
        const why = Object.create(null);
        for (const r of ((s && s.data && s.data.recommendReasons) || [])) why[r.songId] = r.reason;
        tracks = arr.map((t) => ({
          id: t.id,
          name: t.name,
          artists: (t.ar || []).map((a) => a.name).join(' / '),
          artistIds: (t.ar || []).map((a) => a.id),
          cover: (t.al && t.al.picUrl) || '',
          album: (t.al && t.al.name) || '',
          albumId: (t.al && t.al.id) || 0,
          duration: t.dt || 0,
          fee: t.fee,
          reason: why[t.id] || '',
        }));
      } catch { /* 走下面的兜底 */ }

      if (!tracks.length) {
        try {
          const d = await API.personalized();
          tracks = (d.tracks || []).slice(0, 3);
        } catch { tracks = []; }
      }

      dailyTracks = tracks.slice(0, 40);
      /* 这份数据只服务网易云；已经下钻到别的层级也不重画（避免打断/重复请求）。
         回到每日推荐时 renderDailyMarq 会直接用这份数据。 */
      if (platMode === 'netease' && railNode().kind === 'daily') renderMarq();
    }

    /** 卡片带横向拖动：按住拖、松手带一点惯性。
        ⚠️ 不用 setPointerCapture —— 指针捕获会把随后的 click 重定向到捕获元素，
        真实鼠标点击就"点不进去"了。改成按下时给 window 挂 move/up。 */
    function bindStrip(el) {
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      let down = false, dragging = false, startX = 0, startScroll = 0, moved = 0, lastX = 0, lastT = 0, vel = 0, raf = 0;
      const glide = () => {
        if (Math.abs(vel) < 0.02) return;
        el.scrollLeft -= vel * 16;
        vel *= 0.93;
        raf = requestAnimationFrame(glide);
      };
      const onMove = (e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        moved = Math.max(moved, Math.abs(dx));
        /* 超过 4px 才算拖动：单纯点一下永远不会进入拖动态 */
        if (!dragging && moved > 4) { dragging = true; el.classList.add('is-drag'); }
        if (dragging) el.scrollLeft = startScroll - dx;
        const now = performance.now();
        const dt = now - lastT;
        if (dt > 0) vel = (e.clientX - lastX) / dt;
        lastX = e.clientX; lastT = now;
      };
      const up = (e) => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        if (!down) return;
        down = false;
        const wasDrag = dragging;
        dragging = false;
        el.classList.remove('is-drag');
        if (wasDrag && e && e.type === 'pointerup') glide();
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.button) return;
        down = true; dragging = false; moved = 0;
        startX = e.clientX; startScroll = el.scrollLeft;
        lastX = e.clientX; lastT = performance.now(); vel = 0;
        cancelAnimationFrame(raf);
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
      });
      /* 拖过就不算点击 */
      el.addEventListener('click', (e) => {
        if (moved > 6) { e.stopPropagation(); e.preventDefault(); }
      }, true);
    }

    /* ---------- 大厅入口行：四个平级按钮 ----------
       原来是「一个 cell 里塞四行」，现在四项同级排一行：
         形态长廊 / 我的专辑 / 音乐实验室 / 工具箱
       「工具箱」不再是这一块的标题，而是第四项：点开**独立整页** #view-tools
       （以前这里挂一个白底下拉浮层，已彻底删掉）。
       整页卡片和这里共用文件上方同一份 TOOLBOX 数组 —— 加一项只改数组。 */
    /* ---------- 大厅四个入口：形态长廊 / 我的专辑 / 音乐实验室 / 工具箱 ----------
       2026-11-08：普通态不再摆入口卡（那块 DOM 已隐藏）。入口定义和点击动作
       只留这一份 —— paintTools（旧入口行，已隐藏）从这里取，加一项只改 hallEntries()。
       2026-11-08 晚：铺色态底部那条工具带整条删掉，四个入口改到面板左侧留白里的
       竖向 Rubber Segment 页签（见 paintSideRail）；顺序是 歌曲 / 形态长廊 / 我的专辑 / 工具箱。 */
    const HALL_ICONS = {
      /* 2026-11-08：铺色态左侧「歌曲」键的音符图标（动作接「我的喜欢」来源） */
      song: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`,
      stage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="12" height="12" rx="1.6"/><path d="M7.5 3.5h11A1.5 1.5 0 0 1 20 5v11"/></svg>`,
      myalbums: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M14.2 3.8a8.5 8.5 0 0 1 5.8 5.3"/></svg>`,
      lab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v6.5L4.9 18.2A1.9 1.9 0 0 0 6.5 21h11a1.9 1.9 0 0 0 1.6-2.8L14 9.5V3"/><path d="M7.3 14.5h9.4"/></svg>`,
      box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/><path d="M10 12.5v2.5h4v-2.5"/></svg>`,
    };

    function hallEntries() {
      const viewEl = (id) => document.getElementById(id);

      /* 「我的专辑」的视图由另一支在加（#view-myalbums）。视图不在 = 这一项置灰、点了什么都不做，
         不抛错也不跳空白页（这里不碰 show() 的映射，只在自己这层兜住）。 */
      const openMyAlbums = () => {
        const v = viewEl('view-myalbums');
        if (!v) return;
        /* 铺色态里直接从长方体翻到「我的专辑」面；不在铺色态才走整页老路径 */
        if (platMode) { applySideTab('myalbums', true); return; }
        show('myalbums');
        /* 视图可能还没注册进 show() 的映射：补一次 is-active。注册过就是幂等的 */
        v.classList.add('is-active');
      };

      /* 形态长廊：铺色态里翻到长方体的人形长廊面；外面的入口仍走旧整页承载视图 */
      const openStages = () => {
        if (platMode) applySideTab('stage', true);
        else show('forms');
      };

      return [
        { id: 'stage', name: '形态长廊', desc: PICK_STAGES.length + ' 种', act: openStages },
        { id: 'myalbums', name: '我的专辑', desc: '收藏', need: 'view-myalbums', act: openMyAlbums },
        { id: 'lab', name: '音乐实验室', desc: '双 deck · 混音台', act: () => Lab.open('dj') },
        { id: 'box', name: '工具箱', desc: TOOLBOX.length + ' 项', act: () => show('tools') },
      ];
    }

    /** 视图还没上 = 这张卡置灰（paintTools 用；铺色态已换成左侧竖向页签） */
    const hallEntryOff = (x) => !!(x && x.need && !document.getElementById(x.need));

    /** 入口卡的动作：视图还没上就静默；万一它是后来才挂上的，现场解锁再开门。
        普通态入口行用（铺色态已换成左侧竖向页签，不再走这里）。 */
    function hallEntryGo(b, x) {
      if (!b || !x) return;
      if (b.classList.contains('is-off')) {
        if (!(x.need && document.getElementById(x.need))) return;
        b.classList.remove('is-off');
        b.removeAttribute('aria-disabled');
      }
      x.act();
    }

    function paintTools() {
      const items = hallEntries();

      /* 卡片：图标砖（左上）+ 序号（右上）在上，名字 / 说明沉到底部。
         仍是 <button>，data-tool 和 is-off 的判定逻辑不变，只换皮。
         「工具箱」和别的入口一样是普通按钮 —— 没有 aria-haspopup，也没有浮层可展开。 */
      H.tools.innerHTML = items.map((x, i) => {
        const off = hallEntryOff(x);
        return `<button class="hall-tools__i${off ? ' is-off' : ''}" data-tool="${x.id}"
            ${off ? 'aria-disabled="true"' : ''}>
          <span class="tool-card__top">
            <span class="tool-card__ico">${HALL_ICONS[x.id] || ''}</span>
            <span class="tool-card__idx" aria-hidden="true">0${i + 1}</span>
          </span>
          <span class="tool-card__n">${esc(x.name)}</span>
          <span class="tool-card__c">${esc(x.desc)}</span>
        </button>`;
      }).join('');

      H.tools.querySelectorAll('.hall-tools__i').forEach((b) => {
        b.addEventListener('click', () => {
          hallEntryGo(b, items.find((t) => t.id === b.dataset.tool));
        });
      });
    }

    /* ---------- 我的：多平台个人主页 + Sticky Scroll 吸底（信息行钉底，封面往上长）---------
       平台清单在 public/hall/accounts.js（注册表，加平台不用改这里）。
       每张卡：封面横幅 + 圆形头像压在下沿 + 昵称/平台标/等级 + 统计 + 签名。
       吸底结构（细节见 app.css 那段注释）：
         .me-wrap      容器（.me__runway 行程锚点 → .me）
           .me         position: sticky; bottom: 播放条 + 16
             .me__track 横向轮播（translateX）
       方向：信息行（头像/昵称/统计/签名）钉在视口底部，封面在它上面，
       往下滚 = 封面往上长；长到 330 之后整张卡才跟着页面往上滚走。
       滚动只写 --me-cover-h 一个变量：150 + 进度 × 180（封顶 330）。
       未登录时拿官方号（uid 1）当**示例**，卡片上标「示例」。 */
    const ME_KEY = 'lizi.hall.me.platform';
    const ME_CACHE = 'lizi.hall.me.cache.v1';
    const ME_TIMEOUT = 8000;                // 单个音源状态检查的上限（边车冷启动 1~3s）
    const ME_MIN = 150, ME_MAX = 330;   /* 封面 150 → 330，行程 180px = 卡片自己长出来的量 */
    let meCards = [];                 // [{ id, name, accent, model }]
    let meIdx = 0, meToken = 0, meLastH = -1;
    let meScrollOn = false, meRaf = 0, mePin = 0;   // mePin = 吸底线（视口坐标），卡片底边钉在这

    /* ---------- 主页背景：自定义（图片 / 视频） → 网易云自己的背景 → 默认渐变 ----------
       · 自定义存 localStorage['lizi.hall.me.bg'] = { kind: 'image'|'video', url }
         设置页写；本地文件走 URL.createObjectURL（blob: 只活在这次会话，不上传、不同步）
       · 渐变层（.me__glow 里三个色团）**永远先铺在底下**：图/视频慢、404、
         prefers-reduced-motion 时都还有东西，不会留一块黑
       · 色相从头像取：24×24 canvas → sRGB→OKLCH → 12 个 30° 色相桶按彩度加权，
         取最大桶的加权色相（思路同 pages/myalbums.js 的 coverHueHist，那边是给专辑脊取色）
       · 网易云没把「动态视频背景」暴露给 web 接口（两个 detail 接口都只有 background），
         所以视频只能用户自己在设置页贴地址 —— 见设置页那一行下面那句说明 */
    const ME_BG_KEY = 'lizi.hall.me.bg';
    const ME_HUE = new Map();          // 头像 URL → 色相（同一张头像只算一次）
    /* 兜底：模型没带 bannerKind（旧缓存 / 外部注入）时也不能把公用默认图当背景。
       和 hall/accounts.js 的 DEFAULT_BG 是同一份判定，这里只留 hash 与图片 id 两个特征。 */
    const ME_DEFAULT_BG = [
      '2zSNIqTcpHL2jIvU6hG0EA', '109951162868128395',   // 星空（3 个账号同图）
      '_f8R60U9mZ42sSNvdPn2sQ', '109951162868126486',   // 另一张默认（同批素材）
    ];
    const meLooksDefault = (u) => {
      const s = String(u || '');
      let dec = s;
      try { dec = decodeURIComponent(s); } catch { /* 编码坏了按原样比 */ }
      return ME_DEFAULT_BG.some((k) => dec.indexOf(k) >= 0 || s.indexOf(k) >= 0);
    };
    const meMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const meReduce = () => !!(meMotion && meMotion.matches);

    /** 读自定义背景：坏 JSON / 私隐模式 / 形状不对 一律当成没设置 */
    function meBgGet() {
      try {
        const v = JSON.parse(localStorage.getItem(ME_BG_KEY) || 'null');
        if (v && (v.kind === 'image' || v.kind === 'video')
          && typeof v.url === 'string' && v.url) return v;
      } catch { /* 解析失败 → 没设置 */ }
      return null;
    }
    function meBgSet(v) {
      try {
        if (v) localStorage.setItem(ME_BG_KEY, JSON.stringify({ kind: v.kind, url: v.url }));
        else localStorage.removeItem(ME_BG_KEY);
      } catch { /* 写不进去只影响下次启动 */ }
    }
    /** 地址像不像视频（设置页贴 URL 时用；扩展名 / data: / 常见视频 CDN 后缀都认） */
    const meIsVideoUrl = (u) => /^data:video\//i.test(String(u))
      || /\.(mp4|webm|ogv|m4v|mov)(?:[?#]|$)/i.test(String(u));

    /** sRGB(0-255) → OKLCH（只取亮度 / 彩度 / 色相，和 pages/myalbums.js 同一套算法） */
    function meOklch(r, g, b) {
      const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const R = lin(r), G = lin(g), B = lin(b);
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      const C = Math.hypot(A, Bb);
      let h = (Math.atan2(Bb, A) * 180) / Math.PI;
      if (h < 0) h += 360;
      return { L, C, h };
    }

    /** 头像 → 主色相（24×24 canvas 的色相直方图；跨域污染 / 超时 / 近灰 → null） */
    function meHueOfAvatar(src) {
      return new Promise((resolve) => {
        if (!src) return resolve(null);
        if (ME_HUE.has(src)) return resolve(ME_HUE.get(src));
        const im = new Image();
        let done = false;
        const fin = (v) => {
          if (done) return;
          done = true;
          if (v != null && Number.isFinite(v)) ME_HUE.set(src, v);
          resolve(v);
        };
        const timer = setTimeout(() => fin(null), 4000);
        im.onload = () => {
          clearTimeout(timer);
          try {
            const N = 24;
            const cv = document.createElement('canvas');
            cv.width = cv.height = N;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            if (!ctx) return fin(null);
            ctx.drawImage(im, 0, 0, N, N);
            const d = ctx.getImageData(0, 0, N, N).data;    /* 跨域污染会在这里抛 SecurityError */
            const BINS = 12;                                /* 每桶 30° */
            const wts = new Array(BINS).fill(0);            /* Σ C */
            const sx = new Array(BINS).fill(0);             /* Σ C·sin(h) */
            const sy = new Array(BINS).fill(0);             /* Σ C·cos(h) */
            const cnt = new Array(BINS).fill(0);
            let total = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 24) continue;
              const { L, C, h } = meOklch(d[i], d[i + 1], d[i + 2]);
              /* 太灰的（C < 0.03）、过暗过亮的（相当于阴影与高光）都不参与投票 */
              if (!(C > 0.03) || !(L > 0.15) || !(L < 0.90)) continue;
              const b = Math.floor(h / 30) % BINS;
              const rad = (h * Math.PI) / 180;
              wts[b] += C;
              sx[b] += C * Math.sin(rad);
              sy[b] += C * Math.cos(rad);
              cnt[b]++;
              total += C;
            }
            if (!(total > 0)) return fin(null);
            let win = -1, best = 0;
            for (let b = 0; b < BINS; b++) if (wts[b] > best) { best = wts[b]; win = b; }
            if (win < 0) return fin(null);
            let hAvg = (Math.atan2(sx[win], sy[win]) * 180) / Math.PI;
            if (hAvg < 0) hAvg += 360;
            fin(hAvg);
          } catch { fin(null); }
        };
        im.onerror = () => { clearTimeout(timer); fin(null); };
        im.src = src;
      });
    }

    /** 取不到色相时的稳定兜底色相：FNV-1a(头像地址)，同一个头像永远同一个色 */
    function meHueFallback(seed) {
      let h = 2166136261 >>> 0;
      const s = String(seed || 'lizi');
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h % 360;
    }

    /** 给渐变层写色相：先写兜底色相（立刻有色），取色回来再校正 */
    function mePaintGlow(banner) {
      const ava = banner.getAttribute('data-ava') || '';
      const key = ava || 'empty';
      const cached = ME_HUE.get(key);
      banner.style.setProperty('--me-hue', String(Math.round(cached != null ? cached : meHueFallback(key))));
      if (cached != null) return;
      meHueOfAvatar(ava).then((h) => {
        if (h == null || !banner.isConnected) return;
        if (banner.getAttribute('data-bgkind') !== 'gradient'
          && banner.getAttribute('data-bgkind') !== 'custom-video') return;
        banner.style.setProperty('--me-hue', String(Math.round(h)));
      });
    }

    /** 自定义图片：先按底色渐变显示，解码失败（比如上次会话的 blob: 已失效）退回渐变 */
    function meVerifyImage(banner, url) {
      const im = new Image();
      let done = false;
      const bad = () => {
        if (done) return;
        done = true;
        if (!banner.isConnected) return;
        banner.style.backgroundImage = '';
        banner.classList.remove('is-on');
        banner.setAttribute('data-bgkind', 'gradient');
        mePaintGlow(banner);
      };
      im.onload = () => { done = true; };
      im.onerror = bad;
      im.src = url;
      setTimeout(() => { if (!done) { done = true; } }, 4000);
    }

    /** 视频：铺满 banner。3s 没有 loadeddata / 触发 error → 摘掉 <video>，退回底下那层渐变 */
    function meMountVideo(banner, url) {
      const old = banner.querySelector('video.me__bgvid');
      if (old) old.remove();
      const v = document.createElement('video');
      v.className = 'me__bgvid';
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'metadata';            /* 背景不预取整段视频 */
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.setAttribute('tabindex', '-1');
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.remove();
        if (!banner.isConnected) return;
        banner.setAttribute('data-bgkind', 'gradient');   /* 渐变层一直在下面，不黑屏 */
        banner.classList.remove('has-video');
        mePaintGlow(banner);
      };
      const timer = setTimeout(fail, 3000);                /* 3s 还不给画面就当它不会来 */
      v.addEventListener('loadeddata', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        banner.setAttribute('data-bgkind', 'custom-video');
        banner.classList.add('has-video');
        if (meReduce()) { try { v.pause(); } catch { /* 已暂停/未就绪 */ } }   /* 减少动效：停首帧 */
      }, { once: true });
      v.addEventListener('error', fail, { once: true });
      v.src = url;
      banner.appendChild(v);
      const p = v.play();
      if (p && p.catch) p.catch(() => { /* 自动播放被拒：muted+autoplay 一般不会；失败也还有渐变 */ });
    }

    /** 按当前来源（自定义 > 网易云自定义 > 渐变）把一块 banner 重铺一遍（可重复调用） */
    function meApplyBanner(banner) {
      if (!banner) return;
      const custom = meBgGet();
      const netease = banner.getAttribute('data-netease') || '';
      banner.querySelectorAll('video.me__bgvid').forEach((v) => v.remove());
      banner.classList.remove('has-video', 'is-on');
      banner.style.removeProperty('background-image');
      if (custom && custom.kind === 'video') {
        banner.setAttribute('data-bgkind', 'custom-video');
        meMountVideo(banner, custom.url);
      } else if (custom) {
        banner.setAttribute('data-bgkind', 'custom-image');
        banner.style.backgroundImage = `url("${String(custom.url).replace(/"/g, '%22')}")`;
        banner.classList.add('is-on');
        meVerifyImage(banner, custom.url);
      } else if (netease) {
        banner.setAttribute('data-bgkind', 'netease');
        banner.style.backgroundImage = `url("${netease.replace(/"/g, '%22')}")`;
        banner.classList.add('is-on');
      } else {
        banner.setAttribute('data-bgkind', 'gradient');
      }
      mePaintGlow(banner);
    }

    /** 所有卡的 banner 都铺一遍（轮播切到哪张都已经是铺好的） */
    function meApplyBanners() {
      H.me.querySelectorAll('.me__banner').forEach(meApplyBanner);
    }

    /* 设置页改了「主页背景」→ 就地重铺，不重拉接口、不跳页（同 lizi:ma-form 那套） */
    document.addEventListener('lizi:mebg', () => { meApplyBanners(); });
    /* 系统「减少动效」当场切换：视频跟着暂停 / 继续（改成 reduce 时停在当前帧，不回到黑） */
    if (meMotion && meMotion.addEventListener) {
      meMotion.addEventListener('change', () => {
        H.me.querySelectorAll('video.me__bgvid').forEach((v) => {
          if (meReduce()) { try { v.pause(); } catch { /* 未就绪 */ } }
          else {
            const p = v.play();
            if (p && p.catch) p.catch(() => { /* 被拒就保持暂停 */ });
          }
        });
      });
    }

    const fmtBig = (n) => {
      const v = Number(n) || 0;
      return v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(v);
    };

    const meNavHtml = () => `
      <button class="me__nav me__nav--prev" data-me-nav="-1" aria-label="上一个平台" hidden>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="me__nav me__nav--next" data-me-nav="1" aria-label="下一个平台" hidden>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;

    /** 吸底外壳：行程锚点（上方）+ sticky 主体 + 轮播窗口 */
    function meShell(inner, o) {
      const opt = o || {};
      return `<div class="me-wrap">
        <i class="me__runway" aria-hidden="true"></i>
        <div class="me${opt.nav ? ' me--nav' : ''}${opt.loading ? ' me--loading' : ''}${opt.demo ? ' me--demo' : ''}">
          ${meNavHtml()}
          <div class="me__view"><div class="me__track" data-me-track>${inner}</div></div>
        </div>
      </div>`;
    }

    /** 一张平台卡（模型来自 accounts.js 的 detail()，这里不认平台，只认形状） */
    function meCardHtml(m, o) {
      const opt = o || {};
      /* 网易云的自定义背景：模型说「这是自己的图」才用（bannerKind === 'netease'）；
         老形状（没 bannerKind）再按 hash 兜一层判定 —— 公用星空图绝不画出来，
         交给 meApplyBanner 铺默认渐变。*/
      const bg = m.banner
        && (m.bannerKind ? m.bannerKind === 'netease' : true)
        && !meLooksDefault(m.banner)
        ? API.img(m.banner, 1200) : '';
      const ava = m.avatar ? API.img(m.avatar, 160) : '';
      const sign = (m.sign || '').trim();
      const stats = (m.stats || []).filter((s) => s && s.n != null);
      const meta = (m.meta || []).filter(Boolean);
      return `<article class="me__slide me-card"${opt.id ? ` data-pl="${esc(opt.id)}"` : ''}>
        <div class="me__banner" data-bgkind="${bg ? 'netease' : 'gradient'}"
             data-netease="${esc(bg)}" data-ava="${esc(ava)}"><span class="me__glow" aria-hidden="true"><i></i><i></i><i></i></span></div>
        <div class="me__body">
          <div class="me__ava${ava ? ' is-on' : ''}"${ava ? ` style="background-image:url('${esc(ava)}')"` : ''}></div>
          <div class="me__info">
            <div class="me__line1">
              <h3 class="me__name" title="${esc(m.nickname)}">${esc(m.nickname || '未登录')}</h3>
              ${opt.name ? `<span class="me__pl" style="--me-accent:${esc(opt.accent || '')}">${esc(opt.name)}</span>` : ''}
              ${m.level ? `<span class="me__lv" title="等级 ${m.level}">Lv.${m.level}</span>` : ''}
              ${m.vip ? '<span class="me__vip">黑胶 VIP</span>' : ''}
              ${opt.demo ? '<span class="me__demo-tag">示例</span>' : ''}
              ${opt.demo ? '<button class="me__act" data-me="login">登录</button>' : ''}
            </div>
            ${stats.length ? `<div class="me__stats">${stats.map((s) =>
              `<span><b>${fmtBig(s.n)}</b>${esc(s.label)}</span>`).join('')}</div>` : ''}
            <p class="me__sign${sign ? '' : ' is-empty'}">${esc(sign || (opt.demo ? '登录后显示你自己的主页' : '还没写个性签名'))}</p>
            ${meta.length ? `<div class="me__meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      </article>`;
    }

    /* ---------- 登录态：先出卡，再在空闲时并发查 6 家 ----------
       边车第一次调用要拉起进程（1~3s，最坏 25s 就绪超时），所以：
         · 有上次的卡 → 直接画（0 请求）；没有 → 先画示例卡（网易云快，不靠边车）
         · 状态检查丢到 requestIdleCallback（兜底 setTimeout 0）
         · 每家单独 8s 上限（accounts.js 里还有 AbortSignal.timeout），失败只摘自己 */
    const meIdle = (fn) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 700 });
      else setTimeout(fn, 0);
    };

    /** 包一层 8s 上限，返回 { v } / { e } / { timeout }，永远不抛 */
    const meSettle = (p) => Promise.race([
      Promise.resolve(p).then((v) => ({ v }), (e) => ({ e })),
      new Promise((res) => setTimeout(() => res({ timeout: true }), ME_TIMEOUT)),
    ]);

    /* 上一轮的卡片缓存：刷新/重进大厅先秒出，再在空闲时校正登录态 */
    const meCache = {
      read() {
        try {
          const c = JSON.parse(localStorage.getItem(ME_CACHE) || 'null');
          if (!c || !c.at) return null;
          if (Array.isArray(c.rows) && c.rows.length) return c;   // 新版六格缓存的形状
          if (Array.isArray(c.cards) && c.cards.length) return c; // 旧版轮播缓存：认，但没有 rows 就走未登录态
          if (c.demo && c.demo.nickname) return c;
        } catch { /* 隐私模式 */ }
        return null;
      },
      write(obj) {
        try { localStorage.setItem(ME_CACHE, JSON.stringify({ ...obj, at: Date.now() })); } catch {}
      },
    };

    /** 只有登录态、没有详情时的兜底卡（不编等级/统计） */
    const meMinimal = (st) => ({
      nickname: st.nickname || '', avatar: st.avatar || '', banner: '',
      level: 0, vip: !!st.vip, stats: [], sign: '', meta: [],
    });

    /** 按「记住的 id」落位；id 不在了就退到 fallback（默认第 1 张） */
    function mePaintCards(cards, fallback) {
      let at = -1;
      try { at = cards.findIndex((c) => c.id === localStorage.getItem(ME_KEY)); } catch { /* 隐私模式 */ }
      if (at < 0) at = Math.max(0, Math.min(fallback | 0, cards.length - 1));
      meCards = cards;
      meIdx = at;
      H.me.innerHTML = meShell(cards.map((c) => meCardHtml(c.model, c)).join(''), { nav: cards.length > 1 });
      meAfterPaint(true);
    }

    /** 一平台都没有（或全部失效）：官方号当示例，保持原来那张卡 */
    async function paintMeDemo(token, force) {
      if (!force && meCards.length) return;
      const netease = (window.LIZI_ACCOUNTS || []).find((a) => a.id === 'netease');
      let model = null;
      try { model = netease ? await netease.detail(1) : null; } catch { model = null; }
      if (token !== meToken || meCards.length) return;   // 期间已经有平台卡了，别盖掉
      if (!model) {
        if (!H.me.querySelector('.me-card')) H.me.innerHTML = '<p class="hint">个人主页载入失败</p>';
        return;
      }
      meCards = [];
      meIdx = 0;                       // 单张示例卡不能沿用上一张平台的下标，否则会滑出窗口
      H.me.innerHTML = meShell(meCardHtml(model, { demo: true }), { demo: true });
      meAfterPaint();
      meCache.write({ demo: model });
    }

    /* ================== 「我的」六平台方块（2026-11-04 新版） ==================
       一块平台一个方块，固定 6 块，不轮播、不滚动长高。
       未登录 → 方块中间是平台 logo；已登录 → 铺头像，logo 缩到左上角当徽章。
       ========================================================================== */

    /** 六个平台的 logo（放在 public/assets/platforms/，ASCII 文件名） */
    const PLAT_LOGO = {
      netease: 'assets/platforms/netease.svg',
      qq: 'assets/platforms/qq.svg',
      kugou: 'assets/platforms/kugou-mark.svg',
      qishui: 'assets/platforms/qishui.svg',
      bodian: 'assets/platforms/bodian.svg',
    };
    /* 酷我 / Spotify 已下线（见 SOURCES 那处注释），logo 也不再登记。 */

    /* 每块方块的底色 = 该 APP 图标的底色（用户 2026-11-04 要求「吸取边缘颜色铺满」）。
       字号色跟着底色走：亮底用深字，深底用白字。
       这些 logo 本身都是「底色 + 对比色图形」，铺同色之后图形仍然可见，
       整块看上去就是一枚被放大的应用图标。 */
    const PLAT_BG = {
      netease: { bg: '#EA3E3C', ink: '#FFFFFF', hint: 'rgba(255,255,255,.74)', plus: 'rgba(255,255,255,.92)', tone: 'dark' },
      qq:      { bg: '#F8C913', ink: '#1A1A1A', hint: 'rgba(26,26,26,.62)',    plus: 'rgba(26,26,26,.86)', tone: 'light' },
      /* 酷狗：底色是白（图标本身是蓝字白圆），K 保持原来的蓝，不再改 SVG */
      kugou:   { bg: '#3D8BFA', ink: '#FFFFFF', hint: 'rgba(255,255,255,.74)', plus: 'rgba(255,255,255,.92)', tone: 'dark' },
      qishui:  { bg: '#111111', ink: '#FFFFFF', hint: 'rgba(255,255,255,.62)', plus: 'rgba(255,255,255,.86)', tone: 'dark' },
      /* 波点：用它自己的渐变（#D4FC79 → #45E3FF），logo 里的渐变底会融进去，白色 b 浮出来 */
      /* 波点：新图标自带 #04E3B4 圆角绿底，方块就用同一个绿，logo 会「融」进去 */
      bodian:  { bg: '#04E3B4', ink: '#062A24', hint: 'rgba(6,42,36,.62)', plus: 'rgba(6,42,36,.86)', tone: 'light' },
      spotify: { bg: '#1ED75F', ink: '#0D0D0D', hint: 'rgba(13,13,13,.60)',    plus: 'rgba(13,13,13,.86)', tone: 'light' },
      /* 酷我：底色用图标自带的黄 #F4D329，K 的橙色留给粒子 */
      kuwo:    { bg: '#F4D329', ink: '#1A1A1A', hint: 'rgba(26,26,26,.62)', plus: 'rgba(26,26,26,.86)', tone: 'light' },
    };
    const platBg = (id) => PLAT_BG[id] || { bg: '#8A8A8A', ink: '#FFFFFF', hint: 'rgba(255,255,255,.7)', plus: 'rgba(255,255,255,.9)', tone: 'dark' };

    /* 铺色块后景的 Grainient 调色板：每家用自己那一色做一条由深到浅的带，
       最后一段往暖/冷偏一点，流动起来才有层次，而不是一整块纯红。
       实在没有的（未知平台）退回灰阶。 */
    const PLAT_GRAIN = {
      netease: ['#170406', '#4D0B10', '#8E1A1F', '#D2343A', '#FFB39B'],
      qq:      ['#241A00', '#5C4503', '#A87E07', '#E7B90F', '#FFF0B0'],
      kugou:   ['#05132A', '#0F3160', '#1F57A6', '#3D8BFA', '#AED6FF'],
      qishui:  ['#050506', '#17171A', '#303036', '#57575F', '#A7A7B2'],
      bodian:  ['#02211B', '#045545', '#039E82', '#04E3B4', '#D6FFF7'],
      spotify: ['#031F0E', '#084220', '#0F7F37', '#1ED75F', '#C9FFD9'],
      kuwo:    ['#2B2403', '#5C4D05', '#A38A07', '#F4D329', '#FFF6B8'],
    };
    const platGrainColors = (id) => PLAT_GRAIN[id] || ['#111114', '#2A2A31', '#45454F', '#6E6E7A', '#B9B9C4'];

    /* ---------------- 同源 / 撞色：OKLCH 色相旋转 ----------------
       只做色相 +180°，L 原样保留、C 小幅放大并做色域夹取；
       撞色后重新按对比度挑墨色，避免 --plat-bg / --plat-ink 掉对比。
       近灰白黑的封面没有色相信息：改用平台品牌色的色相再转 180°。 */
    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    const normHue = (h) => { let v = h % 360; if (v < 0) v += 360; return v; };
    function hexRgb(hex) {
      let h = String(hex || '').trim().replace(/^#/, '');
      if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
      if (h.length === 8) h = h.slice(0, 6);
      if (!/^[0-9a-f]{6}$/i.test(h)) return [138, 138, 138];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const srgbToLin = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    function oklchFromHex(hex) {
      const [ri, gi, bi] = hexRgb(hex);
      const r = srgbToLin(ri), g = srgbToLin(gi), b = srgbToLin(bi);
      const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
      const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
      const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
      const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
      const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
      const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
      const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
      return { L, C: Math.hypot(a, bb), H: normHue((Math.atan2(bb, a) * 180) / Math.PI) };
    }
    function hexFromOklch(L, C, H) {
      L = clamp01(L);
      let c = Math.max(0, C);
      const rad = (H * Math.PI) / 180;
      const enc = (v) => {
        v = clamp01(v);
        v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        return Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
      };
      for (let i = 0; i < 24; i++) {
        const a = c * Math.cos(rad), b = c * Math.sin(rad);
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.291485548 * b;
        const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
        const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
        if (r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && bl >= -0.0005 && bl <= 1.0005) {
          return '#' + enc(r) + enc(g) + enc(bl);
        }
        c *= 0.9;                        /* 超出 sRGB 就逐步收彩度，L / H 不动 */
      }
      const v = enc(L * L * L);
      return '#' + v + v + v;
    }
    function relLumHex(hex) {
      const [r, g, b] = hexRgb(hex);
      return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
    }
    function inkForHex(hex) {
      const y = relLumHex(hex);
      const white = 1.05 / (y + 0.05);
      const black = (y + 0.05) / 0.05;
      return white >= black ? '#F7F7FA' : '#08080A';
    }
    /** 一整条调色板统一转 180°；低彩度（近灰）改用平台品牌色相，再保证 C 不至于还是灰 */
    function crossStops(stops, id) {
      if (!Array.isArray(stops) || !stops.length) return stops;
      const oks = stops.map(oklchFromHex);
      const mid = oks.slice(1, 4).length ? oks.slice(1, 4) : oks;
      const chroma = Math.max(0, ...mid.map((o) => o.C));
      const low = chroma < 0.055;
      const p = oklchFromHex(platBg(id || platMode || 'netease').bg);
      /* 平台自己也是黑灰（如汽水）时，固定用一个暖色相，别转出一块脏灰 */
      const baseH = (low && p.C < 0.02) ? 32 : p.H;
      return oks.map((o) => {
        const H = normHue((low ? baseH : o.H) + 180);
        const C = low ? Math.max(o.C, 0.11) : Math.min(0.37, o.C * 1.04);
        return hexFromOklch(o.L, C, H);
      });
    }
    function crossBase(bg, id) {
      const o = oklchFromHex(bg.bg);
      let H = normHue(o.H + 180);
      let C = Math.min(0.37, o.C * 1.04);
      if (o.C < 0.02) { H = 32; C = Math.max(C, 0.07); }
      const hex = hexFromOklch(o.L, C, H);
      const ink = inkForHex(hex);
      return {
        bg: hex,
        ink,
        hint: `color-mix(in oklab, ${ink} 74%, transparent)`,
        plus: `color-mix(in oklab, ${ink} 92%, transparent)`,
      };
    }
    function crossAlbum(pal, id) {
      if (!pal || !pal.stops || !pal.stops[2]) return pal;
      const stops = crossStops(pal.stops, id);
      const bg = stops[2];
      const lum = relLumHex(bg);
      return Object.assign({}, pal, {
        stops,
        ink: inkForHex(bg),
        inkFixed: true,
        field: lum < 0.30 ? 'dark' : 'light',
        fieldLum: lum,
      });
    }
    const paletteCrossOn = () => !!(lookState && lookState.paletteMode === 'cross');

    /* 铺色块后景效果的持久化（设置页「大厅背景效果」那一块写，这里读）。
       效果 id 存 'lizi.hall.bgfx'；自定义颜色存 'lizi.hall.bgfx.colors' = [暗色, 亮色]。
       **没存颜色 = 跟随平台**，这是默认行为，别用平台色去填这个 key。
       两色怎么摊成各家要的 3 档 / 5 档调色板，交给 hall/bgfx/bgfx.js 的 normPalette。 */
    const BGFX_KEY = 'lizi.hall.bgfx';
    const BGFX_COLOR_KEY = 'lizi.hall.bgfx.colors';
    const BGFX_DEFAULT = 'grainient';
    function bgfxEffect() {
      let v = '';
      try { v = localStorage.getItem(BGFX_KEY) || ''; } catch { /* 隐私模式 */ }
      if (!v) return BGFX_DEFAULT;
      const ok = window.LiziBgFx ? window.LiziBgFx.EFFECTS.some((e) => e.id === v) : true;
      return ok ? v : BGFX_DEFAULT;
    }
    /** 自定义色：[暗, 亮]，没设过返回 null（= 跟随平台） */
    function bgfxCustom() {
      let raw = null;
      try { raw = localStorage.getItem(BGFX_COLOR_KEY); } catch { /* 同上 */ }
      if (!raw) return null;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length >= 2 && arr[0] && arr[1]) return [String(arr[0]), String(arr[1])];
      } catch { /* 坏数据当没设过 */ }
      return null;
    }
    /** 当前该用的调色板：设了自定义色就用它，否则跟当前平台 */
    function bgfxPalette(id) {
      const c = bgfxCustom();
      if (c) return window.LiziBgFx ? window.LiziBgFx.normPalette(c) : c;
      return platGrainColors(id || platMode || 'netease');
    }

    /** 一块方块。r = { id, name, accent, loggedIn, nickname, avatar }
        正反两面：正面是平台色块/头像，背面是这家平台的登录二维码（见 cardQrOpen）。 */
    function platCellHtml(r) {
      const on = !!r.loggedIn;
      /* 登录态已失效、但本地还留着真实头像：用 is-in 的铺图样式，另加 is-stale
         让点击仍然走二维码（见 #me 的 click 处理），文案也明说「登录已失效」。 */
      const stale = !on && !!r.staleAvatar && !!r.avatar;
      const logo = PLAT_LOGO[r.id] || '';
      /* 设置页「平台头像」默认关：关着时头像地址根本不进 DOM，只留平台色块 + 图标。
         登录态不受影响（仍然 is-in，点击照样进平台）；失效态也不铺残留头像。 */
      const faceOn = platAvatarOn();
      const noAva = !faceOn && (on || stale);
      const ava = faceOn && (on || stale) && r.avatar ? API.img(r.avatar, 320) : '';
      /* 头像关掉时标题回平台名（昵称进下面那行提示），别让方块顶着一个大头像名却没有头像 */
      const title = faceOn && on ? (r.nickname || r.name) : r.name;
      const hint = on
        ? ('已登录' + (!faceOn && r.nickname ? ' · ' + r.nickname : ''))
        : (stale ? '登录已失效 · 点击重新登录' : '点击登录');
      const bg = platBg(r.id);
      return `<button class="plat ${on ? 'is-in' : (stale ? 'is-in is-stale' : 'is-out')}${noAva ? ' is-noava' : ''}"
        data-plat="${esc(r.id)}"
        data-tone="${esc(bg.tone || 'dark')}"
        style="--plbg:${esc(bg.bg)};--plink:${esc(bg.ink)};--plhint:${esc(bg.hint)};--plplus:${esc(bg.plus)}"
        title="${esc(on ? title + ' · 已登录' : (stale ? r.name + (r.nickname ? ' · ' + r.nickname : '') + ' · 登录已失效，点击重新登录' : r.name + ' · 点击扫码登录'))}"
        aria-label="${esc(on ? title + ' 已登录' : (stale ? r.name + ' 登录已失效，点击扫码重新登录' : r.name + ' 未登录，点击扫码登录'))}">
        <span class="plat__front">
          ${ava ? `<img class="plat__face" src="${esc(ava)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <span class="plat__scrim" aria-hidden="true"></span>
          <span class="plat__logo">${logo ? `<img src="${esc(logo)}" alt="">` : ''}</span>
          <span class="plat__foot">
            <b class="plat__name">${esc(title)}</b>
            <i class="plat__hint">${esc(hint)}</i>
          </span>
        </span>
        <span class="plat__back" aria-hidden="true">
          <span class="plat__qr">
            <img class="plat__qrimg" alt="" draggable="false" hidden>
            <span class="plat__qrph"></span>
          </span>
          <span class="plat__qrmsg"></span>
        </span>
      </button>`;
    }

    /* ================== 卡片内扫码登录（2026-11-06） ==================
       点未登录的方块 → 卡片沿 Y 轴翻面，背面直接就是这家的二维码。
       同一时间只开一张；再点同一张收起；点别的自动收起上一张。
       六家取码方式不同，收在同一套 start / poll 里：
         网易云   API.qrKey() → qrCheck() → harvest() / afterLogin()
         QQ       API.qqQrKey() → qqQrCheck()
         其它四家 API.srcQrKey() + srcQrCreate() → srcQrCheck()
         Spotify  没有二维码（OAuth）：背面给平台 logo + 轮询 /status，
                  点卡片时直接开授权小窗
       ========================================================================== */
    const QR_LABEL = {
      netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗',
      qishui: '汽水', bodian: '波点', spotify: 'Spotify', kuwo: '酷我音乐',
    };

    let cardQrId = '';            // 正在扫码的平台 id
    let cardQrEl = null;          // 那张卡（大厅重画后会被换掉）
    let cardQrSrc = '';           // 当前二维码（data:image/png;base64,…）
    let cardQrSeq = 0;            // 关卡片 / 换码时自增，晚到的响应一律作废
    let cardQrTimer = 0;
    let cardQrKey = '';
    let cardQrExpired = 0;
    let cardQrBusy = false;

    /** 只画背面的二维码小块。o = { src, logo, ph, msg, kind } */
    function cardQrPaint(cell, o) {
      o = o || {};
      /* 大厅被重画过（比如刚登录成功），这张卡已经不在 DOM 里了：收摊 */
      if (!cell || !cell.isConnected) { cardQrStop(); cardQrId = ''; cardQrEl = null; cardQrSrc = ''; return; }
      const box = cell.querySelector('.plat__qr');
      const img = cell.querySelector('.plat__qrimg');
      const ph = cell.querySelector('.plat__qrph');
      const msg = cell.querySelector('.plat__qrmsg');
      if (!box || !img || !ph || !msg) return;
      if (o.src) {
        cardQrSrc = o.src;
        if (img.getAttribute('src') !== o.src) img.src = o.src;
      }
      img.hidden = !o.src;
      img.classList.toggle('is-logo', !!o.logo);
      box.classList.toggle('is-empty', !o.src);
      ph.hidden = !!o.src;
      if (o.ph != null) ph.textContent = o.ph;
      msg.textContent = o.msg || '';
      msg.className = 'plat__qrmsg' + (o.kind ? ' is-' + o.kind : '');
    }

    function cardQrStop() {
      cardQrSeq++;
      if (cardQrTimer) { clearInterval(cardQrTimer); cardQrTimer = 0; }
      cardQrBusy = false;
      cardQrExpired = 0;
      cardQrKey = '';
    }

    function cardQrClose() {
      /* 酷我的 Cookie 浮层是 body 上的遮罩，不属于卡片；离开大厅 / 换视图时一起收掉 */
      if (kuwoDialogAbort) kuwoDialogAbort();
      const cell = cardQrEl;
      cardQrStop();
      cardQrId = '';
      cardQrEl = null;
      cardQrSrc = '';
      if (cell && cell.isConnected) cell.classList.remove('is-qr');
    }

    function cardQrOpen(id, cell) {
      if (cardQrId === id && cell.classList.contains('is-qr')) { cardQrClose(); return; }
      cardQrClose();
      cardQrId = id;
      cardQrEl = cell;
      cell.classList.add('is-qr');
      cardQrPaint(cell, { ph: '⋯', msg: '正在获取二维码…' });
      cardQrStart(id);
    }

    /* 酷我：网页端没有扫码接口，只能粘 Cookie。
       卡片本身是 <button>，textarea 不能塞进去，所以输入走 body 上那个共用浮层
       （openKuwoCookieDialog，设置页那一行用的也是它）。
       保存成功走和扫码成功同一套收尾（关卡片 → paintMe(true) 重画大厅）。 */
    async function cardQrKuwo(seq, cell) {
      cardQrPaint(cell, { ph: 'Cookie', msg: '酷我没有扫码登录，在弹窗里粘贴 Cookie' });
      const ok = await openKuwoCookieDialog();
      if (seq !== cardQrSeq) return;
      if (!ok) {
        cardQrPaint(cell, { ph: '·', msg: '酷我没有扫码登录；点一下卡片重新粘贴 Cookie' });
        return;
      }
      cardQrPaint(cell, { ph: '✓', msg: '已保存 Cookie', kind: 'ok' });
      setTimeout(() => {
        if (seq !== cardQrSeq) return;
        cardQrClose();
        paintMe(true);
      }, 700);
    }

    async function cardQrStart(id) {
      const seq = ++cardQrSeq;
      const cell = cardQrEl;
      cardQrExpired = 0;
      cardQrKey = '';
      cardQrSrc = '';
      cardQrBusy = false;
      cardQrPaint(cell, { ph: '⋯', msg: '正在获取二维码…' });

      if (id === 'spotify') { cardQrSpotify(seq, cell); return; }
      /* 酷我：上游没有扫码接口，走 Cookie 浮层（不请求 /api/kuwo/login/qr/*） */
      if (id === 'kuwo') {
        cardQrKuwo(seq, cell);
        return;
      }

      let src = '';
      try {
        if (id === 'netease') {
          const d = await API.qrKey();
          if (seq !== cardQrSeq) return;
          if (!d || !d.key) throw new Error((d && (d.message || d.error)) || '拿不到二维码');
          cardQrKey = d.key;
          /* 边车没给 qrimg 时退回把登录链接画成二维码（和弹窗同一条兜底） */
          src = d.qrimg || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent('https://music.163.com/login?codekey=' + d.key)}`;
        } else if (id === 'qq') {
          const d = await API.qqQrKey();
          if (seq !== cardQrSeq) return;
          if (!d || !d.key || !d.qrimg) {
            const wait = d && d.retryAfterMs ? Math.max(1, Math.ceil(d.retryAfterMs / 1000)) : 0;
            throw new Error((d && (d.error || d.message))
              || (wait ? `上游冷却中，${wait} 秒后再点一次` : '拿不到二维码'));
          }
          cardQrKey = d.key;
          src = d.qrimg;
        } else {
          const k = await API.srcQrKey(id);
          if (seq !== cardQrSeq) return;
          if (!k || !k.key) throw new Error((k && (k.error || k.message)) || '拿不到二维码');
          const c = await API.srcQrCreate(id, k.key);
          if (seq !== cardQrSeq) return;
          if (!c || !c.qrimg) throw new Error((c && (c.error || c.message)) || '二维码生成失败');
          cardQrKey = k.key;
          src = c.qrimg;
        }
      } catch (e) {
        if (seq !== cardQrSeq) return;
        cardQrPaint(cell, { ph: '×', msg: String((e && e.message) || e), kind: 'err' });
        return;
      }

      if (seq !== cardQrSeq) return;
      cardQrPaint(cell, { src, msg: `用 ${QR_LABEL[id] || id} App 扫码` });
      cardQrTimer = setInterval(() => cardQrPoll(id, seq), 2200);
    }

    async function cardQrPoll(id, seq) {
      if (seq !== cardQrSeq || cardQrBusy || !cardQrKey) return;
      cardQrBusy = true;
      let d = null;
      try {
        d = id === 'netease' ? await API.qrCheck(cardQrKey)
          : id === 'qq' ? await API.qqQrCheck(cardQrKey)
            : await API.srcQrCheck(id, cardQrKey);
      } catch { cardQrBusy = false; return; }     // 网络抖一下，下一轮再试
      cardQrBusy = false;
      if (seq !== cardQrSeq) return;

      const cell = cardQrEl;
      const code = Number(d && d.code);
      if (code === 803) { cardQrSuccess(id, seq, d); return; }

      if (code === 800) {
        if (++cardQrExpired > 3) {
          if (cardQrTimer) { clearInterval(cardQrTimer); cardQrTimer = 0; }
          cardQrPaint(cell, { ph: '×', msg: '二维码反复过期，点一下卡片重试', kind: 'err' });
          return;
        }
        cardQrPaint(cell, { src: cardQrSrc, msg: '二维码过期，换一张…', kind: 'err' });
        if (cardQrTimer) { clearInterval(cardQrTimer); cardQrTimer = 0; }
        setTimeout(() => { if (seq === cardQrSeq) cardQrStart(id); }, 600);
        return;
      }

      if (code === 802) {
        cardQrPaint(cell, { src: cardQrSrc, msg: '已扫码，请在手机上确认', kind: 'ok' });
        return;
      }
      if (code === 801) {
        cardQrExpired = 0;
        cardQrPaint(cell, { src: cardQrSrc, msg: `用 ${QR_LABEL[id] || id} App 扫码` });
        return;
      }

      /* 其它（500 / 风控 / 空响应）如实说，别装还在等确认 */
      if (cardQrTimer) { clearInterval(cardQrTimer); cardQrTimer = 0; }
      cardQrPaint(cell, {
        src: cardQrSrc, kind: 'err',
        msg: (d && (d.error || d.message)) || `登录接口返回 ${code || '空响应'}，点一下卡片重试`,
      });
    }

    async function cardQrSuccess(id, seq, d) {
      if (cardQrTimer) { clearInterval(cardQrTimer); cardQrTimer = 0; }
      const cell = cardQrEl;
      cardQrPaint(cell, {
        src: cardQrSrc, kind: 'ok',
        msg: id === 'spotify' ? '正在确认授权…' : '已扫码，正在确认登录…',
      });

      if (id === 'netease') {
        try {
          /* 803 只代表手机点了授权。服务端在 803 那一拍可能已把 cookie 收好；
             没带就再走一次 harvest（和登录弹窗同一条路）。 */
          if (!(d && d.loggedIn === true && d.profile)) {
            const h = await API.harvest(cardQrKey);
            if (!h || h.ok !== true) throw new Error((h && h.message) || '没拿到登录态');
          }
        } catch (e) {
          if (seq !== cardQrSeq) return;
          cardQrPaint(cell, {
            ph: '×', kind: 'err',
            msg: '登录确认失败：' + ((e && e.message) || e) + '，点一下卡片重试',
          });
          return;
        }
        if (seq !== cardQrSeq) return;
        /* 顶栏 / 设置页 / 大厅个人卡一起换成登录态 */
        try { await afterLogin(); } catch { /* 登录态已经到手，资料刷不出来不该挡着 */ }
      }

      if (seq !== cardQrSeq) return;
      cardQrPaint(cell, { src: cardQrSrc, kind: 'ok', msg: '登录成功' });
      setTimeout(() => {
        if (seq !== cardQrSeq) return;
        const alive = !!(cardQrEl && cardQrEl.isConnected);
        cardQrId = '';
        cardQrEl = null;
        cardQrSrc = '';
        /* 不翻回正面再刷新：直接重画，这张方块当场变成已登录的样子。
           网易云的 afterLogin 已经 refreshMe 过一次了，那张卡早就不在 DOM 里。 */
        if (alive) paintMe(true);
      }, 900);
    }

    /** Spotify 没有二维码：开授权小窗，轮询 /status 等它变登录态 */
    async function cardQrSpotify(seq, cell) {
      const logo = PLAT_LOGO.spotify || '';
      cardQrPaint(cell, { src: logo, logo: true, msg: '正在打开授权页…' });
      let d = null;
      try { d = await API.srcLoginUrl('spotify'); } catch (e) { d = { error: String((e && e.message) || e) }; }
      if (seq !== cardQrSeq) return;
      if (!d || !d.url) {
        cardQrPaint(cell, {
          src: logo, logo: true, kind: 'err',
          msg: (d && d.error) || '没配 SPOTIFY_CLIENT_ID，去设置里看说明',
        });
        return;
      }
      try { window.open(d.url, 'lizi-spotify-auth', 'width=520,height=760'); } catch { /* 弹窗被拦 */ }
      cardQrPaint(cell, {
        src: logo, logo: true,
        msg: '在浏览器里点「同意」，这里会自动变成已登录',
      });
      cardQrTimer = setInterval(async () => {
        if (seq !== cardQrSeq) return;
        const s = await API.srcStatus('spotify').catch(() => null);
        if (seq !== cardQrSeq || !s || !s.loggedIn) return;
        cardQrSuccess('spotify', seq, s);
      }, 2500);
    }

    /* ================== 平台筛选（lizi.platforms.v1） ==================
       开场多选 / 设置「平台管理」写入数组；没存过 = 全部 7 个（老用户不丢卡片）。
       只影响「我的」方块和铺色态顶部平台条，不碰登录、播放、音频。 */
    const PLATS_KEY = 'lizi.platforms.v1';

    function platIdsSelected() {
      try {
        const raw = localStorage.getItem(PLATS_KEY);
        if (!raw) return null;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return null;
        const ids = [...new Set(arr)].filter((id) => !!PLAT_LOGO[id]);
        return ids.length ? ids : null;
      } catch { return null; }
    }

    /* 极端兜底：账号列表还没到、或当前 rows 里一个都匹配不上时，不能让大厅
       变成空网格。这里用平台 logo 表补出 7 个未登录行。 */
    function platFallbackRows() {
      const acc = Array.isArray(window.LIZI_ACCOUNTS) ? window.LIZI_ACCOUNTS : [];
      return Object.keys(PLAT_LOGO).map((id) => {
        const a = acc.find((x) => x && x.id === id);
        return {
          id,
          name: a ? a.name : id,
          accent: a ? a.accent : '',
          loggedIn: false,
        };
      });
    }

    function platRowsVisible(rows) {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return list;
      const ids = platIdsSelected();
      if (!ids) return list;
      const vis = list.filter((r) => ids.includes(r.id));
      /* 保存的 id 和当前账号行完全不匹配（账号还没加载/平台改名）：回退全部，
         绝不把「我的」渲染成空网格。 */
      return vis.length ? vis : list;
    }

    /* 2026-11-08：大厅不再展示这排平台大色块（登录后直接进铺色态），
       下面 meGridHtml / platCellHtml 和旧 meCards 一套暂时留着，厅内已无调用点。 */
    function meGridHtml(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const vis = platRowsVisible(list);
      const shown = vis.length ? vis : (list.length ? list : platFallbackRows());
      const cls = shown.length < list.length ? 'me-grid is-filtered' : 'me-grid';
      return `<div class="${cls}">${shown.map(platCellHtml).join('')}</div>`;
    }

    /* ================== 大厅登录引导（2026-11-08） ==================
       大厅不再承担登录入口：未登录时不再摆七个平台方块让人逐个扫码，
       只留一行字 + 一个按钮，点它去设置页「平台账号」。
       原来的卡片扫码（cardQrStart / cardQrKuwo / cardQrOpen …）代码都留着，
       只是大厅里不再有入口调用它们。 */
    function hallLoginHtml(checking) {
      return `<div class="hall-cta">
        <div class="hall-cta__text">
          <b>${checking ? '正在确认登录状态…' : '还没有登录任何平台'}</b>
          <span>${checking
            ? '稍等一下，登录过的平台会直接打开它的专属首页。'
            : '登录后大厅会直接打开它的专属首页；每日推荐、我的喜欢、收藏都在那里。'}</span>
        </div>
        ${checking ? '' : '<button class="hall-cta__btn" type="button" data-hall-account>去设置里绑定平台账号</button>'}
      </div>`;
    }

    /** 「我的」：只画已登录的平台；一个都没有就给引导，绝不画一排未登录方块。 */
    function meHallHtml(rows, checking) {
      const list = Array.isArray(rows) ? rows : [];
      const vis = platRowsVisible(list);
      const shown = (vis.length ? vis : list).filter((r) => r && r.loggedIn);
      if (!shown.length) return hallLoginHtml(checking);
      /* 2026-11-08：有已登录平台就直接进铺色态，普通态不再画平台大色块。
         旧网格（meGridHtml）留着但厅内不再调用。 */
      return '';
    }

    /* 「我的」容器跟着内容显隐：登录后内容为空时别在普通态留一条空内边距/分割线。 */
    function syncHallMeCell() {
      const cell = H.me && H.me.closest ? H.me.closest('.hall-cell--me') : null;
      if (!cell) return;
      const empty = !(H.me.textContent || '').trim();
      cell.style.display = empty ? 'none' : '';
    }

    /** 统一登录入口：设置页「平台账号」分区（大厅里所有「去登录」都走这里） */
    function openAccountSettings() {
      srcCloseMenu();
      openSettings();
      /* 等 show() 的类切换落定再滚；openSettings 自己会把滚动位置归零 */
      requestAnimationFrame(() => scrollToSection('set-sec-account'));
    }

    /** 把 6 个平台摊成 rows；没缓存就全是「未登录」态 */
    function meGridRows(accounts, cachedRows) {
      return accounts.map((a) => {
        const c = cachedRows && cachedRows.find((x) => x && x.id === a.id);
        return c
          ? { ...c, name: a.name, accent: a.accent }
          : { id: a.id, name: a.name, accent: a.accent, loggedIn: false };
      });
    }

    /* ================== 大厅铺色态 ==================
       点「我的」里已登录的方块 → 整块大厅主体（入口行 + 六平台方块那一整片）
       铺上该平台的颜色，换成平台专属首页（#hall-plat）：
         顶部  → 六个平台图标挤成的小长条（点图标换台 / 点当前台退出）
         中间  → 每日推荐跑马带（自己动，也能拖，点一首直接播）
         下面  → 精选 / 我的喜欢 / 我收藏的歌单 / 电台 四张卡片（SVG 图标，不用封面）
       再点同一个方块取消；点另一个就换色。记在 localStorage，回来还在。
       歌词海报（.hall-hero）、顶栏、侧栏、播放条都不参与铺色。 */
    const HALL_THEME_KEY = 'lizi.hall.theme';
    let themeSeq = 0;              // 异步取色令牌：快速换歌时旧结果不能覆盖新色
    let themeAlbum = null;         // 当前直接铺在 #hall-plat 上的专辑色板
    let recolorT = 0;              // 换歌过渡类 is-recolor 的移除定时器（连点换歌要清上一个）

    /* 大厅铺色态现在有三层来源，优先级从高到低：
         1. 设置页自定义色（lizi.hall.bgfx.colors）—— 老行为，不动；
         2. 设置页「用平台颜色铺色」打开 —— 平台品牌色；
         3. 默认 —— 当前专辑封面经 Player 的 OKLCH 聚类算出的 5 档。
       专辑来源：先看大厅巨幅方封面（已解码才算），没有再退到队列当前曲目。
       找不到封面就静默退回平台色，不给大厅留一块空底。 */
    function hallAlbumSource() {
      if (H.coverImg && H.coverImg.complete && H.coverImg.naturalWidth) {
        const src = H.coverImg.currentSrc || H.coverImg.src;
        /* 刚换 src、旧图还是 complete 的一瞬，方封面其实属于上一首。
           用 last.cover 对应的 1200px URL 对一下，对不上就退到队列封面。 */
        let belongs = !!src;
        const want = last && last.cover ? API.img(last.cover, 1200) : '';
        if (belongs && want) {
          try { belongs = new URL(src, location.href).href === new URL(want, location.href).href; }
          catch { /* URL 比较失败就信 currentSrc */ }
        }
        if (belongs) return { img: H.coverImg, url: src, cover: last && last.cover };
      }
      const s = Player.state;
      const cur = s.queue[s.index];
      if (cur && cur.cover) return { url: API.img(cur.cover, 400), cover: cur.cover };
      return null;
    }

    function paintThemeBase(id, bg) {
      themeAlbum = null;
      const cross = paletteCrossOn();
      const base = cross ? crossBase(bg, id) : bg;
      H.plat.style.setProperty('--plat-bg', base.bg);
      H.plat.style.setProperty('--plat-ink', base.ink);
      H.plat.style.setProperty('--plat-hint', base.hint);
      H.plat.style.setProperty('--plat-plus', base.plus);
      const fx = bgfxPalette(id);
      if (H.platFx) H.platFx.setColors(cross ? crossStops(fx, id) : fx);
    }

    function paintAlbumPalette(id, pal, token) {
      if (token !== themeSeq || platMode !== id || !pal || !pal.stops || !pal.stops[2]) return;
      const shown = paletteCrossOn() ? crossAlbum(pal, id) : pal;
      themeAlbum = shown;
      const bg = shown.stops[2];
      /* 2026-11-08：中亮底（0.30–0.62）按用户要求走白字，真正很亮的底（>0.62）仍用深色。
         pal.field === 'dark' 时 ink 本来就是浅色，保持原样。
         撞色色板已按对比度重算过 ink（inkFixed），不再套这条经验规则。 */
      const ink = shown.inkFixed ? shown.ink
        : (shown.field === 'light' && typeof shown.fieldLum === 'number' && shown.fieldLum < 0.62) ? '#F7F7FA' : shown.ink;
      H.plat.style.setProperty('--plat-bg', bg);
      H.plat.style.setProperty('--plat-ink', ink);
      /* 面板玻璃、来源滚轮等都从 ink 派生；这里给两档透明度的同色 */
      H.plat.style.setProperty('--plat-hint', `color-mix(in oklab, ${ink} 74%, transparent)`);
      H.plat.style.setProperty('--plat-plus', `color-mix(in oklab, ${ink} 92%, transparent)`);
      if (H.platFx) H.platFx.setColors(shown.stops);
    }

    function useAlbumPalette(id, bg, token, src) {
      src = src || hallAlbumSource();
      if (!src) { paintThemeBase(id, bg); return; }
      if (src.img) {
        /* 海报方封面已解码：同步算，进场动画第一帧就是对的颜色。
           别名 URL = 播放页那张 400px；它已经有缓存就直接复用同一次聚类，
           大厅和播放页才不会因为 1200/400 两档各算一遍而出现色差。 */
        const alias = src.cover ? API.img(src.cover, 400) : '';
        const pal = Player.paletteFromCover(src.img, alias);
        if (pal) paintAlbumPalette(id, pal, token);
        else paintThemeBase(id, bg);
        return;
      }
      Promise.resolve(Player.paletteFromCover(src.url))
        .then((pal) => {
          if (token !== themeSeq || platMode !== id) return;
          if (pal) paintAlbumPalette(id, pal, token);
          else paintThemeBase(id, bg);
        })
        .catch(() => {
          if (token === themeSeq && platMode === id) paintThemeBase(id, bg);
        });
    }

    /** 降级用：进入铺色态时按三层优先级铺第一版色。 */
    function beginHallPalette(id, bg) {
      const token = ++themeSeq;
      if (bgfxCustom() || platColorOn()) { paintThemeBase(id, bg); return; }
      const src = hallAlbumSource();
      if (!src) { paintThemeBase(id, bg); return; }
      /* URL 取色是异步的，先铺平台色兜底，拿到结果再换；海报图同步则直接上 */
      if (!src.img) paintThemeBase(id, bg);
      useAlbumPalette(id, bg, token, src);
    }

    /** 只重刷颜色，不重放 clip-path 进场动画；未进入铺色态时 no-op。
        force = 设置页里切「同源 / 撞色」时即使大厅不在前台也先铺好，回来即生效。 */
    function refreshThemeColors(force) {
      if (!platMode) return;
      if (!force && !el.viewHall.classList.contains('is-active')) return;
      const id = platMode;
      const bg = platBg(id);
      const token = ++themeSeq;
      if (bgfxCustom() || platColorOn()) { paintThemeBase(id, bg); return; }
      const src = hallAlbumSource();
      if (!src) { paintThemeBase(id, bg); return; }
      if (src.img) { useAlbumPalette(id, bg, token, src); return; }
      /* 已经铺着专辑色的情况下先别闪回平台色，等异步结果 */
      Promise.resolve(Player.paletteFromCover(src.url))
        .then((pal) => {
          if (token !== themeSeq || platMode !== id) return;
          if (pal) paintAlbumPalette(id, pal, token);
          else paintThemeBase(id, bg);
        })
        .catch(() => {
          if (token === themeSeq && platMode === id) paintThemeBase(id, bg);
        });
    }

    /** 换歌时重算铺色（2026-11-08）：只换底色，不重放展开动画。
        只在铺色态、大厅可见、且底色来源是专辑封面时生效；自定义色 / 平台色
        两种模式由 beginHallPalette 优先接管，这里直接 return，别把画面闪一下。
        token 仍是 themeSeq：连续换歌时旧封面晚到的结果直接丢弃。 */
    function recolor(track) {
      if (!platMode) return;
      const panel = H.plat;
      if (!panel || panel.hidden || !el.viewHall.classList.contains('is-active')) return;
      if (bgfxCustom() || platColorOn()) return;
      if (!track || !track.cover) return;
      const id = platMode;
      const token = ++themeSeq;
      /* 和播放页同一档：400 是主图，500 那张当别名，共用同一次聚类缓存 */
      let job = null;
      try { job = Player.paletteFromCover(API.img(track.cover, 400), API.img(track.cover, 500)); }
      catch { return; }
      if (!job) return;
      Promise.resolve(job)
        .then((pal) => {
          if (token !== themeSeq || platMode !== id) return;
          if (!pal || !pal.stops || !pal.stops[2]) return;   // 算不出来就保持原色，别退回平台色
          /* 写入前才挂过渡类：取色是异步的，挂早了会在等待期间白过渡一次；
             连点换歌时清掉上一个移除定时器，类不会提前掉 */
          panel.classList.add('is-recolor');
          clearTimeout(recolorT);
          recolorT = setTimeout(() => panel.classList.remove('is-recolor'), 260);
          paintAlbumPalette(id, pal, token);
        })
        .catch(() => { /* 封面取色失败：保持当前底色，不闪平台色 */ });
    }

    function hallThemeStored() {
      try { return localStorage.getItem(HALL_THEME_KEY) || ''; } catch { return ''; }
    }

    /* 换台扫色覆盖层：JS 建一次，旧平台底色从右边缘收走，新色从左露出来（2026-11-08）。 */
    let platWipe = null, platWipeAnim = null;

    function ensurePlatWipe() {
      if (!H.plat) return null;
      /* 扫色只发生在歌曲面：覆盖层挂在 face 里，翻到中性面时不会跟着露出来 */
      const host = (faces.song && faces.song.isConnected) ? faces.song : H.plat;
      if (platWipe && platWipe.parentNode === host) return platWipe;
      platWipe = host.querySelector('.hall-plat__wipe');
      if (!platWipe) {
        platWipe = document.createElement('div');
        platWipe.className = 'hall-plat__wipe';
        platWipe.setAttribute('aria-hidden', 'true');
        host.appendChild(platWipe);
      }
      return platWipe;
    }

    function sweepPlatColor(prevPlat) {
      const wipe = ensurePlatWipe();
      if (!wipe || !prevPlat) return;
      /* 快速连续换台：先撤上一段，别让旧色残留在新一段上 */
      if (platWipeAnim) {
        try { platWipeAnim.cancel(); } catch { /* noop */ }
        platWipeAnim = null;
      }
      wipe.style.background = platBg(prevPlat).bg;
      wipe.style.clipPath = 'inset(0 0 0 0%)';
      wipe.style.opacity = '1';
      const anim = wipe.animate(
        [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }],
        { duration: 340, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' }
      );
      platWipeAnim = anim;
      anim.finished.then(() => {
        if (platWipeAnim !== anim) return;   // 已经被下一段换台接管
        platWipeAnim = null;
        wipe.style.opacity = '0';
        wipe.style.clipPath = '';
        try { anim.cancel(); } catch { /* noop */ }
      }).catch(() => { /* cancel 会拒绝 finished，忽略 */ });
    }

    /** 传 id 进入铺色态，传 '' / null 退出。
        fromEl 给了就做「方块长成整块」的 clip-path 展开动画（恢复时没有起点，直接出现）。 */
    function applyHallTheme(id, fromEl) {
      /* 进/出铺色或换平台才清搜索；同平台账号刷新（applyHallTheme 重入同 id）
         不能把正在看的结果吞回来源。 */
      if (!id || platMode !== id) clearMarqSearch(false);
      if (!id) {
        /* 退场也做动效：整块沿 clip-path 收回那张平台方块里，底下普通态同时露出来。
           量目标方块得先把 is-plat 摘掉（普通态才会把工具箱/我的放回布局）。
           期间又点进来就靠 platExitSeq 作废旧动画，别把新块藏掉。 */
        const leaving = platMode;
        const seq = ++platExitSeq;
        const live = !!leaving && !H.plat.hidden && H.plat.offsetWidth > 0;
        let r1 = null, tile = null;
        if (live && !reduceMotion) {
          r1 = H.plat.getBoundingClientRect();
          if (r1.width > 10) {
            H.rail.classList.remove('is-plat');
            const cell = H.me.querySelector(`.plat[data-plat="${leaving}"]`);
            const b = cell ? cell.getBoundingClientRect() : null;
            if (b && b.width > 4) tile = b;
          }
        }
        const shrink = !!(r1 && tile);

        platMode = '';
        themeSeq++;                   // 作废还没回来的封面取色
        themeAlbum = null;
        delete H.plat.dataset.plat;
        /* 退出铺色：来源浮层跟着收回（它的触发点在铺色长条里） */
        srcCloseMenu();
        /* 退回普通态 = 「跟随平台」的色盘要回到网易云那套（设置页可能正开着） */
        document.dispatchEvent(new CustomEvent('lizi:bgfx-change'));
        marqSeq++;
        railReset();               // 退出后下次进来从每日推荐开始
        marqStop();
        /* 长方体跟着收掉：隔离观察器、把借走的专辑陈列架还回去，下次进来按持久化页签恢复 */
        deactivateStageFace();
        releaseAlbumsFace();
        marqPaused = false;
        /* 退出铺色态：流色没人看了，停掉（别在隐藏块里 60fps 空转） */
        if (H.platFx) {
          try { H.platFx.setPaused(true); } catch { /* WebGL 没起来就算了 */ }
        }
        H.rail.classList.remove('is-plat');
        el.viewHall.classList.remove('is-plat-mode');
        /* 收起态只属于这一次铺色：退回普通大厅就复位，下次进来是完整的海报 + 面板 */
        el.viewHall.classList.remove('is-plat-folded');
        platFolded = false;
        resetHeroFold();             // 手机的海报折叠同理：退出铺色就恢复完整分屏
        try { localStorage.removeItem(HALL_THEME_KEY); } catch {}

        if (shrink) {
          const rail = H.rail.getBoundingClientRect();
          const t = Math.max(0, tile.top - r1.top);
          const l = Math.max(0, tile.left - r1.left);
          const rr = Math.max(0, r1.right - tile.right);
          const bb = Math.max(0, r1.bottom - tile.bottom);
          H.plat.style.position = 'absolute';
          H.plat.style.left = (r1.left - rail.left) + 'px';
          H.plat.style.top = (r1.top - rail.top) + 'px';
          H.plat.style.width = r1.width + 'px';
          H.plat.style.height = r1.height + 'px';
          H.plat.style.margin = '0';
          H.plat.style.zIndex = '6';
          H.plat.style.pointerEvents = 'none';
          H.plat.style.transition = 'none';
          H.plat.style.clipPath = 'inset(0px round 22px)';
          void H.plat.offsetWidth;
          requestAnimationFrame(() => {
            if (seq !== platExitSeq) return;
            H.plat.style.transition = 'clip-path 420ms cubic-bezier(.4,0,.2,1), opacity 360ms ease-out';
            H.plat.style.clipPath = `inset(${t}px ${rr}px ${bb}px ${l}px round 18px)`;
            H.plat.style.opacity = '0';
          });
          setTimeout(() => {
            if (seq !== platExitSeq) return;
            H.plat.hidden = true;
            H.plat.style.cssText = '';
          }, 450);
          return;
        }

        H.plat.hidden = true;
        H.plat.style.cssText = '';
        return;
      }

      platExitSeq++;                     // 退场没走完又点回来：作废旧收尾
      H.plat.style.cssText = '';         // 清掉退场留在块上的浮层样式（含 --plat-*），再按新台重设
      platCardW = 0;                     // 上面把 --marq-card-w 也清了：下次进入必须重新算
      const wasOn = platMode === id && !H.plat.hidden;
      const bg = platBg(id);
      const r0 = fromEl && fromEl.getBoundingClientRect ? fromEl.getBoundingClientRect() : null;

      const prevPlat = platMode;
      platMode = id;
      platOptOut = false;                // 进铺色 = 清掉上次「主动退出」的静默
      /* 真的换台才收来源浮层：同台账号刷新重画长条时别把它关掉 */
      if (prevPlat !== id) srcCloseMenu();
      H.plat.dataset.plat = id;
      /* 切平台 / 从普通态重新进入 / 刷新恢复铺色：内容轨一律回每日推荐。
         只是账号刷新后重复套同一层主题时保留当前层级，别把用户正在看的歌单踢回去。 */
      if (prevPlat !== id) {
        marqSeq++;
        railReset();
      }
      H.plat.hidden = false;
      H.rail.classList.add('is-plat');
      el.viewHall.classList.add('is-plat-mode');
      /* 换台 / 从普通态进来：收起态作废（面板藏起来时换不了台，只有程序重入会走到）；
         同台账号刷新（prevPlat === id）保留用户收回面板的选择。 */
      if (platFolded && prevPlat !== id) {
        platFolded = false;
        el.viewHall.classList.remove('is-plat-folded');
      }
      /* 手机「折叠海报」同理：同台账号刷新保留用户的选择，真的换台就复位成完整分屏
         （顺带清掉可能还在吸附中的 inline 高度，别把旧高度带到新台） */
      if (prevPlat !== id) resetHeroFold();
      /* 手机铺色态：建一次面板顶部的分屏抓手（桌面 pointer:fine 直接 no-op）；
         三角的 aria/title 也要按手机语义重写一次，别沿用桌面的「面板」说法。
         桌面不调 syncFoldBtn，保持原有「只在下三角 / 重画页签时更新」的行为。 */
      ensureHeroGrip();
      if (mobileHeroFoldOn()) syncFoldBtn();

      paintPlatBar();
      fitPlatScale();                    // 面板已铺开：先按可用高度定卡宽，renderMarq 直接用它
      renderMarq();
      /* 三层优先级：自定义色 > 「用平台颜色铺色」> 专辑封面。 */
      beginHallPalette(id, bg);
      /* 铺色态里换台：旧台底色向右收走、新色从左露出来；进入/退出/减弱动效不扫。 */
      if (prevPlat && prevPlat !== id && !reduceMotion) sweepPlatColor(prevPlat);
      if (H.platFx) {
        /* 调色板已由 beginHallPalette 设好；这里只负责把 leave() 暂停的流色续上 */
        if (document.body.dataset.view === 'hall') {
          try { H.platFx.setPaused(false); } catch { /* noop */ }
        }
      }
      /* 平台换了 = 「跟随平台」的色盘两端也换了：让设置页（若已初始化）自己重画 */
      document.dispatchEvent(new CustomEvent('lizi:bgfx-change'));

      /* 从方块（或长条里的小图标）长成整块：测量必须在隐藏普通方块之前做，
         这里 r0 已经量好了；r1 是切换后的目标块。 */
      if (r0 && r0.width > 4 && !reduceMotion) {
        const r1 = H.plat.getBoundingClientRect();
        if (r1.width > 10 && r1.height > 10) {
          const t = Math.max(0, r0.top - r1.top);
          const l = Math.max(0, r0.left - r1.left);
          const rr = Math.max(0, r1.right - r0.right);
          const b = Math.max(0, r1.bottom - r0.bottom);
          H.plat.style.transition = 'none';
          H.plat.style.clipPath = `inset(${t}px ${rr}px ${b}px ${l}px round 18px)`;
          void H.plat.offsetWidth;
          requestAnimationFrame(() => {
            H.plat.style.transition = 'clip-path 520ms cubic-bezier(.22,1,.36,1)';
            H.plat.style.clipPath = 'inset(0px round 22px)';
            setTimeout(() => {
              if (platMode === id) { H.plat.style.transition = ''; H.plat.style.clipPath = ''; }
            }, 580);
          });
        }
      } else if (!wasOn) {
        /* 没有起点（刷新后恢复）：轻轻浮起来一下就够 */
        H.plat.style.transition = '';
        H.plat.style.clipPath = '';
      }

      if (!platFolded) marqStart();   // 收起态（同台刷新重入）面板不可见，别开跑马带
      /* 进入铺色态 / 换平台：按持久化的侧键页签恢复内容；同台账号刷新保留当前层级 */
      /* 进入铺色态 / 换平台：按持久化的侧键页签恢复对应的面；直接落位不翻滚 */
      applySideTab(sideTab, false);
      try { localStorage.setItem(HALL_THEME_KEY, id); } catch {}

      /* 铺色态必须真的铺出来：600ms 后 #hall-plat 仍被藏/零高（账号刷新或开场收尾
         把 hidden 又写回来），就退回普通大厅，别让中间整块空白。 */
      const guardSeq = platExitSeq;
      setTimeout(() => {
        if (platMode !== id || platExitSeq !== guardSeq) return;
        if (!document.querySelector('#view-hall.is-active')) return;
        if (platFolded) return;          // 收起态面板本来就 display:none，别当「没铺开」
        if (!H.plat.hidden && H.plat.offsetHeight > 8) return;
        console.warn('[Hall] 铺色态没有铺开，退回普通大厅。');
        applyHallTheme('');
      }, 620);
    }

    /** 画完「我的」后决定要不要进铺色态。
        2026-11-08：普通态不再是常规形态 —— 有已登录平台就直接铺色：
        上次的平台还在登录着就用它，否则用网易云，再不行挑第一个已登录的。
        用户主动退出（platOptOut）后的本次会话不再自动拉回去。 */
    function restoreHallTheme(rows) {
      /* 账号/平台行还没到：不要因为“查不到”就退出当前铺色态 */
      if (!Array.isArray(rows) || !rows.length) return;
      const vis = platRowsVisible(rows);
      const logged = vis.filter((r) => r && r.loggedIn);
      const stored = hallThemeStored();
      const want = (stored && vis.some((r) => r.id === stored && r.loggedIn)) ? stored
        : (platOptOut ? '' : ((logged.find((r) => r.id === 'netease') || logged[0] || {}).id || ''));
      if (want) { applyHallTheme(want); return; }
      /* 主题平台被筛掉 / 掉线：正在铺色就先退回普通态；没在铺色则保留记忆不打扰 */
      if (platMode) applyHallTheme('');
    }

    /* ---------- 兜底：大厅中间那块永远不能是空白 ----------
       开场引导（onboard-intro）会先把入口卡「预隐藏」再逐步揭示；铺色态也可能在
       账号数据没回来时只切了一半（rail 已是 is-plat，但 #hall-plat 被藏起来）。
       两种残局都会让中间整块空着。这里做一次幂等自检，只在开场没在跑时动手：
         · 摘掉 oi-pre / oi-pre-rise / oi-rise / oi-reveal 这几个短命揭示类；
         · rail 是 is-plat 但 #hall-plat 不可见/没高度 → 退回普通大厅；
         · 入口卡没画出来 → 补画。
       调用点：大厅每次挂载后 0.9s / 2.6s 各查一次（等 app 自己画完再兜）。 */
    function healHallBlank() {
      if (!mounted) return;
      if (!document.querySelector('#view-hall.is-active')) return;
      /* 开场正在跑：它自己会收尾，别在动画中途抢 DOM */
      if (document.body.classList.contains('oi-lock')
        || document.querySelector('#view-hall[inert]')
        || document.querySelector('.oi-root')) return;

      for (const el of H.rail.querySelectorAll('.oi-pre, .oi-pre-rise, .oi-rise, .oi-reveal')) {
        el.classList.remove('oi-pre', 'oi-pre-rise', 'oi-rise', 'oi-reveal');
      }
      if (!H.tools.children.length) paintTools();

      /* 收起态面板本来就是零高：这是用户主动收的，不是半切，别把它救回来 */
      if (!platFolded && H.rail.classList.contains('is-plat') && (H.plat.hidden || H.plat.offsetHeight < 8)) {
        console.warn('[Hall] 检测到半切的铺色态，退回普通大厅。');
        applyHallTheme('');
      }
    }

    /* ---------- 顶部：六个平台图标挤成的小长条 ---------- */
    /* 搜索控件是持久节点：paintPlatBar 每次用 innerHTML 重画长条，
       不能把正在输入 / 聚焦的输入框一起重建。ensurePlatSearch() 只建一次，
       重画后 append 回来；聚焦位置和 selection 在 paintPlatBar 里恢复。 */
    let platSearch = null;

    function clearMarqSearch(repaint) {
      clearTimeout(searchTimer);
      marqSearch = null;
      searchSeq++;
      if (platSearch) platSearch.input.value = '';
      if (repaint) {
        paintPlatBar();
        renderMarq();
      }
    }

    function ensurePlatSearch() {
      if (platSearch) return platSearch;
      const root = document.createElement('div');
      root.className = 'pstrip__search';
      root.setAttribute('role', 'search');
      root.innerHTML = `<svg class="ico pstrip__search-ico" aria-hidden="true"><use href="#i-search"/></svg>
        <input class="pstrip__search-input" id="hall-plat-search" type="search"
          autocomplete="off" spellcheck="false" aria-label="搜索当前平台"
          placeholder="搜索当前平台">`;
      const input = root.querySelector('.pstrip__search-input');

      const schedule = () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) {
          if (marqSearch) clearMarqSearch(true);
          return;
        }
        searchTimer = setTimeout(() => {
          if (input.value.trim() !== q) return;
          runMarqSearch(q);
        }, 450);
      };

      /* 触屏没有 hover：点放大镜也把输入框聚焦，靠 :focus-within 展开 */
      root.addEventListener('click', (ev) => {
        if (!ev.target.closest || ev.target.closest('.pstrip__search-input')) return;
        input.focus({ preventScroll: true });
      });

      input.addEventListener('input', schedule);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          clearTimeout(searchTimer);
          const q = input.value.trim();
          if (q) runMarqSearch(q);
          else if (marqSearch) clearMarqSearch(true);
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          clearTimeout(searchTimer);
          input.value = '';
          input.blur();
          if (marqSearch) clearMarqSearch(true);
        }
      });

      platSearch = { root, input };
      return platSearch;
    }

    /** 回车 / 去抖 450ms 进入。搜索源固定是当前铺色平台，直接复用 searchOne。 */
    function runMarqSearch(q) {
      const pid = platMode;
      if (!pid || !q) return;
      clearTimeout(searchTimer);
      srcCloseMenu();                     // 搜索激活时来源滚轮让位
      const seq = ++searchSeq;
      marqSearch = { pid, q, items: [], loading: true, error: '' };
      H.marq.setAttribute('aria-label', `搜索「${q}」`);
      renderMarq();                       // 先画「正在搜索…」
      paintPlatBar();                     // 左上角切到「搜索「q」」+ ×
      searchOne(pid, q).then((r) => {
        if (seq !== searchSeq || platMode !== pid || !marqSearch || marqSearch.q !== q) return;
        marqSearch.loading = false;
        marqSearch.items = (r && r.tracks) || [];
        marqSearch.error = (r && r.error) ? String(r.error) : '';
        renderMarq();
      }).catch((e) => {
        if (seq !== searchSeq || platMode !== pid || !marqSearch || marqSearch.q !== q) return;
        marqSearch.loading = false;
        marqSearch.items = [];
        marqSearch.error = (e && e.message) ? String(e.message) : '搜索失败';
        renderMarq();
      });
    }

    function paintPlatBar() {
      const base = platRows.length ? platRows
        : (window.LIZI_ACCOUNTS || []).map((a) => ({ id: a.id, name: a.name, loggedIn: false }));
      const all = base.length ? base : platFallbackRows();
      const rows = platRowsVisible(all);
      const cur = rows.find((r) => r.id === platMode);
      /* 内容轨模式下左上角是面包屑（不是平台名）。只有根段（i=0）是滚轮换来源的
         宿主：data-src-root 挂在它上面，is-src / is-open 由 syncSrcMenu 维护。
         根段外面包一层 .pstrip__src，用来挂绝对定位的「下一项」模糊提示；
         后面的段只做文字展示，不再支持点回上一层。
         退出铺色走「点当前平台图标」或「点当前「我的」卡」（见 bind）。 */
      const rail = !!(platMode && railOn());
      if (rail && !railPath.length) railReset();
      const rootKind = rail ? (railPath[0] && railPath[0].kind) : 'daily';
      const rootIdx = srcIndexOf(rootKind);
      const nextName = SRC_ITEMS.length
        ? SRC_ITEMS[((rootIdx < 0 ? 0 : rootIdx) + 1) % SRC_ITEMS.length].name : '';
      const hintHtml = `<span class="pstrip__src-hint" aria-hidden="true">${esc(nextName)}</span>`;
      const searching = !!(marqSearch && marqSearch.pid === platMode && marqSearch.q);
      const nameHtml = searching
        ? `<span class="pstrip__search-label" role="status">
             <span class="pstrip__search-q">搜索「${esc(marqSearch.q)}」</span>
             <button class="pstrip__search-clear" type="button" data-search-clear
               aria-label="清空搜索" title="清空搜索">×</button>
           </span>`
        : rail
        ? `<nav class="pstrip__crumb" aria-label="大厅内容轨">${railPath.map((n, i) => {
          const last = i === railPath.length - 1;
          const root = i === 0;
          const curAttr = last ? ' aria-current="page"' : '';
          const name = esc(n.name || '');
          return (i ? '<span class="pstrip__crumb-sep" aria-hidden="true">/</span>' : '')
            + (root
              ? `<span class="pstrip__src"><button class="pstrip__crumb-seg is-src${last ? ' is-cur' : ''}" type="button"
                   data-src-root="1" aria-haspopup="listbox" aria-expanded="false"${curAttr}
                   title="${name}">${name}</button>${hintHtml}</span>`
              : `<span class="pstrip__crumb-seg${last ? ' is-cur' : ''}"${curAttr}
                   title="${name}">${name}</span>`);
        }).join('')}</nav>`
        : `<span class="pstrip__src"><span class="pstrip__name is-src" data-src-root="1"
             aria-haspopup="listbox" aria-expanded="false">${esc(cur ? cur.name : '')}</span>${hintHtml}</span>`;
      /* 输入框是持久节点：先记焦点/选区，innerHTML 换完再 append 回去 */
      const s = ensurePlatSearch();
      const focused = document.activeElement === s.input;
      const selStart = focused ? s.input.selectionStart : null;
      const selEnd = focused ? s.input.selectionEnd : null;
      H.platBar.innerHTML = `
        ${nameHtml}
        <span class="pstrip__icons">${rows.map((r) => `
          <button class="pstrip__i${r.loggedIn ? '' : ' is-off'}${r.id === platMode ? ' is-on' : ''}"
            data-plat="${esc(r.id)}"${r.loggedIn ? '' : ' aria-disabled="true"'}
            title="${esc(r.name)}${r.loggedIn ? '' : ' · 未登录，点它去设置里登录'}"
            style="--i-bg:${esc(platBg(r.id).bg)}">
            <img src="${esc(PLAT_LOGO[r.id] || '')}" alt="${esc(r.name)}">
          </button>`).join('')}</span>`;
      /* 第三列：搜索。持久节点 append 回来，聚焦中的输入不丢文字/光标 */
      s.input.placeholder = `搜索${cur ? cur.name : '当前平台'}`;
      H.platBar.appendChild(s.root);
      if (focused) {
        try {
          s.input.focus({ preventScroll: true });
          s.input.setSelectionRange(selStart, selEnd);
        } catch { /* 某些输入类型不支持 setSelectionRange，忽略 */ }
      }
      /* 重画后把「浮层开着 / 高亮哪一项」补回去（切来源时正是这条路径） */
      syncSrcMenu();
      if (window.LiziDock) window.LiziDock.reset(H.platBar);
    }

    /* ---------- 铺色态：跑马带卡片按可用高度等比放大（2026-11-08） ----------
       面板 .hall-plat 在铺色态 flex:1 吃满 .hall-rail 的剩余高度（见 app.css），
       腾出来的高度给跑马带；卡宽用闭式解，夹在 [156, 320]：
         卡宽 = (面板内高 − 28) × 0.578
       28 = 面板上下 padding(10×2) + 面板里 bar 与带的 gap(8)；因为长条和跑马带的
       上下内边距 / 最小高度都按 --plat-scale 放大（s = 卡宽 / 156），面板高
       H = 20 + 42s + 8 + 228s = 28 + 270s，联立得 s = (H − 28) / 270，
       卡宽 = 156s = (H − 28) / 1.7308 ≈ 0.578(H − 28)。
       这里**不再量** .hall-plat__bar 的 offsetHeight：长条本身也跟着 --plat-scale
       长高，量它再算卡宽会互相追尾。1080p 全屏时卡宽仍从 156 起步（下限），
       1440p / 4K 撑高后才等比放大。
       变量只写在 #hall-plat 上（--marq-card-w / --marq-gap / --plat-scale 是卡片的
       局部尺寸），不碰 :root，别的视图/普通态不受影响。卡宽没变就早退，resize
       不会每帧重排。 */
    /** 手机跑马带放得下的最大卡宽：由面板高度反解（2026-11-10）。
        安卓壳（sync.js 的触屏覆盖）里，条高固定 56、面内边距 20、gap 8、
        跑马带上下留白 10×scale×2，字号还有 14 / 12.5px 的下限。卡宽 w 时：
          卡高 = w + 4.49% + 1.3×max(14, 8.01%w) + 1.3×max(12.5, 6.73%w)
          w ≤ 185.7 → 面板高 H = 118.45 + 1.1859w
          w >  185.7 → 面板高 H = 84 + 1.3775w
        留 4px 余量，避免行高取整后正好贴住面板下沿。 */
    function phoneMarqMaxCardW(panelH) {
      const h = panelH - 4;
      const w = h <= 339 ? (h - 118.45) / 1.1859 : (h - 84) / 1.3775;
      return Math.max(96, Math.floor(w));
    }

    /** 是否命中安卓壳的触屏覆盖（sync.js 注入了固定条高 / 字号下限那一套） */
    function isPhoneMarq() {
      try {
        return !!window.__liziAndroid
          && matchMedia('(max-width: 1280px) and (pointer: coarse)').matches;
      } catch { return false; }
    }

    function fitPlatScale() {
      const panel = H.plat;
      if (!platMode || !panel || panel.hidden || panel.offsetHeight <= 0) return;
      const panelH = panel.clientHeight;
      let cardW = Math.round(Math.max(156, Math.min(320, (panelH - 28) * 0.578)));
      /* 手机字号有下限，桌面 1.29 的卡高比例不成立：同样的面板高推出来的卡
         会比带子高，底部歌手名被 #hall-plat 裁掉。这里按手机真实卡高再反解
         一个上限，只收不放；桌面（非安卓壳 / 细指针）数值一个像素不变。 */
      if (isPhoneMarq()) cardW = Math.min(cardW, phoneMarqMaxCardW(panelH));
      const gap = Math.round(Math.max(16, Math.min(32, cardW * 0.1026)));
      if (cardW === platCardW) return;         // 高度没变：别重复重量/重排
      platCardW = cardW;
      panel.style.setProperty('--marq-card-w', cardW + 'px');
      /* 长条 / 图标 / 面包屑统一按 156 卡宽为 1 等比放大，保留 4 位小数避免抖动 */
      panel.style.setProperty('--plat-scale', String(Number((cardW / 156).toFixed(4))));
      panel.style.setProperty('--marq-gap', gap + 'px');
      /* 比例变了：先清掉 dock.js 上一轮按旧 scale 写的内联宽高，
         让图标立刻回到 CSS 的新尺寸；弹簧状态会在下一次 tick 按比例迁移。 */
      if (window.LiziDock) window.LiziDock.reset(H.platBar);
      /* 卡宽变了，回卷周期也跟着变：立刻按新宽度重量（内部会 marqWrap 规整位移
         并重写 track 的 transform），否则拖动/自动走会用旧的 marqHalf。 */
      if (!H.marq.firstElementChild) return;
      marqMeasure();
    }

    /* ---------- 铺色态左侧留白：竖向 Rubber Segment（2026-11-08） ----------
       移植 ReactBits RubberSegment 的物理（.scratch/rubber/RubberSegment.tsx）：
       高亮块是一个绝对定位 div，clip-path: inset(T 0 B 0 round r)，竖向版本把
       原版的 edgeL / edgeR 换成 edgeT / edgeB，四条边只补间上/下两条。
       原版用 motion 的 duration/bounce；这里没有依赖，用 rAF 积分：
         ζ = max(0.1, 1 - bounce)，ω = 4πζ / duration（bounce=0 即临界阻尼），
         a = -ω²(x - target) - 2ζω·v，按 1/240s 子步积分；
         指针速度取最近 100ms 采样。travel 的拉伸段用 EASE_OUT 贝塞尔补间。
       轨道：28px 宽、四段 28×28、段距 8（内高 136），滑块 inset 2、圆角 7（9-2）。
       顺序：歌曲（我的喜欢）/ 形态长廊 / 我的专辑 / 工具箱。 */
    const SRAIL_INSET = 2;
    const SRAIL_DILATE = 0.19, SRAIL_HANDOFF = 0.15, SRAIL_FLICK = 110;
    const SRAIL_MAX_V = 2000, SRAIL_DEADZONE = 4, SRAIL_SLOP = 10, SRAIL_RUBBER = 0.55;
    const SRAIL_STRETCH = 100, SRAIL_SQUASH = 3, SRAIL_GLIDE = 75;

    const srailClamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const srailRubber = (over, dim) => (over * dim * SRAIL_RUBBER) / (dim + SRAIL_RUBBER * Math.abs(over));
    const srailProject = (v, glide) => {
      const d = 1 - 0.1 * Math.pow(0.05, glide / 100);
      return ((v / 1000) * d) / (1 - d);
    };

    /** cubic-bezier(x1,y1,x2,y2) → 按 x 求 y（travel 拉伸段用 EASE_OUT） */
    function srailBezier(x1, y1, x2, y2) {
      const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
      const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
      const sx = (t) => ((ax * t + bx) * t + cx) * t;
      const sy = (t) => ((ay * t + by) * t + cy) * t;
      const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
      return (x) => {
        if (!(x > 0)) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 6; i++) {
          const e = sx(t) - x;
          if (Math.abs(e) < 1e-5) return sy(t);
          const d = dx(t);
          if (Math.abs(d) < 1e-6) break;
          t -= e / d;
        }
        let lo = 0, hi = 1;
        t = x;
        for (let i = 0; i < 14; i++) {
          const e = sx(t);
          if (Math.abs(e - x) < 1e-5) break;
          if (e < x) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
        return sy(t);
      };
    }
    const srailEaseOut = srailBezier(0.23, 1, 0.32, 1);

    const srail = {
      track: null, thumb: null, items: [], slots: [], innerH: 0, box: null,
      index: 0, committed: 0,
      edgeT: { x: 0, v: 0, mode: null, target: 0, from: 0, t0: 0, dur: 0, ease: null, w: 0, zeta: 1, done: null },
      edgeB: { x: 0, v: 0, mode: null, target: 0, from: 0, t0: 0, dur: 0, ease: null, w: 0, zeta: 1, done: null },
      drag: null, gen: 0, handoff: 0, raf: 0, last: 0,
    };

    /* 非歌曲面都盖住了跑马带：rAF 停掉 */
    const srailSidePane = () => sideTab !== 'song';

    function srailJumpEdge(e, to) {
      e.mode = null; e.done = null; e.x = to; e.v = 0; e.target = to;
    }
    function srailPaint() {
      const th = srail.thumb;
      if (!th) return;
      const inner = Math.max(1, srail.innerH);
      const top = Math.max(0, srail.edgeT.x);
      const bottom = Math.max(0, inner - srail.edgeB.x);
      th.style.clipPath = `inset(${top}px 0 ${bottom}px 0 round 7px)`;
    }
    /** 弹簧补间：duration/bounce 按 motion 的 duration 弹簧换算成 ω 和阻尼比 */
    function srailSpring(e, to, dur, bounce, velocity, done) {
      const zeta = Math.max(0.1, 1 - bounce);
      e.mode = 'spring';
      e.target = to;
      e.zeta = zeta;
      e.w = (4 * Math.PI * zeta) / Math.max(0.01, dur);
      if (velocity != null) e.v = srailClamp(velocity, -SRAIL_MAX_V, SRAIL_MAX_V);
      e.done = done || null;
      srailWake();
    }
    function srailTween(e, to, durMs, ease, now) {
      e.mode = 'tween';
      e.from = e.x;
      e.target = to;
      e.t0 = now;
      e.dur = durMs;
      e.ease = ease;
      e.done = null;
      srailWake();
    }
    function srailFinish(e) {
      e.x = e.target;
      e.v = 0;
      const done = e.done;
      e.mode = null;
      e.done = null;
      if (done) done();
    }
    function srailStepEdge(e, now, dt) {
      if (e.mode === 'tween') {
        const p = e.dur > 0 ? Math.min(1, (now - e.t0) / e.dur) : 1;
        e.x = e.from + (e.target - e.from) * e.ease(p);
        e.v = 0;
        if (p >= 1) srailFinish(e);
        return;
      }
      if (e.mode !== 'spring') return;
      let remain = dt;
      while (remain > 0) {
        const h = Math.min(1 / 240, remain);
        const a = -(e.w * e.w) * (e.x - e.target) - 2 * e.zeta * e.w * e.v;
        e.v += a * h;
        e.x += e.v * h;
        remain -= h;
      }
      if (Math.abs(e.x - e.target) < 0.25 && Math.abs(e.v) < 5) srailFinish(e);
    }
    function srailFrame(now) {
      srail.raf = 0;
      const dt = srail.last ? Math.min(0.05, (now - srail.last) / 1000) : 1 / 60;
      srail.last = now;
      srailStepEdge(srail.edgeT, now, dt);
      srailStepEdge(srail.edgeB, now, dt);
      srailPaint();
      if (srail.edgeT.mode || srail.edgeB.mode) srail.raf = requestAnimationFrame(srailFrame);
      else srail.last = 0;
    }
    function srailWake() {
      if (srail.raf || reduceMotion) return;
      srail.last = 0;
      srail.raf = requestAnimationFrame(srailFrame);
    }
    function srailJumpTo(i) {
      clearTimeout(srail.handoff);
      srail.gen++;
      const s = srail.slots[i];
      if (!s) return;
      srailJumpEdge(srail.edgeT, s.t);
      srailJumpEdge(srail.edgeB, s.b);
      srailPaint();
    }
    function srailMeasure() {
      const track = srail.track;
      if (!track || !track.isConnected || srail.drag) return;
      const rect = track.getBoundingClientRect();
      srail.box = rect;
      srail.slots = srail.items.map((el) => {
        const r = el.getBoundingClientRect();
        return { t: r.top - rect.top - SRAIL_INSET, b: r.bottom - rect.top - SRAIL_INSET };
      });
      srail.innerH = rect.height - SRAIL_INSET * 2;
      srailJumpTo(srail.committed);
    }
    /** 松手落段：先让前缘弹到目标，拖尾过冲 squash 后退回（原版 land） */
    function srailLand(to, v, flick, withSquash) {
      const b = srail.slots[to];
      if (!b) return;
      const g = ++srail.gen;
      const et = srail.edgeT, eb = srail.edgeB;
      const dir = Math.sign((b.t + b.b) / 2 - (et.x + eb.x) / 2) || 1;
      const [lead, leadTo, trail, trailTo] = dir > 0
        ? [eb, b.b, et, b.t]
        : [et, b.t, eb, b.b];
      const velOf = (e) => srailClamp(v == null ? e.v : v, -SRAIL_MAX_V, SRAIL_MAX_V);
      srailSpring(lead, leadTo, flick ? 0.4 : 0.3, flick ? 0.2 : 0, velOf(lead));
      const tv = velOf(trail);
      if (!withSquash || SRAIL_SQUASH <= 0) {
        srailSpring(trail, trailTo, 0.3, 0, tv);
        return;
      }
      srailSpring(trail, trailTo + dir * SRAIL_SQUASH, 0.3, 0, tv, () => {
        if (srail.gen === g) srailSpring(trail, trailTo, 0.16, 0, null);
      });
    }
    /** 点选换段：先用 DILATE 把滑块拉长覆盖两段，HANDOFF 后再落到目标 */
    function srailTravel(from, to) {
      const a = srail.slots[from], b = srail.slots[to];
      if (!a || !b) return;
      clearTimeout(srail.handoff);
      srail.gen++;
      if (reduceMotion) { srailJumpTo(to); return; }
      const u = SRAIL_STRETCH / 100;
      const now = performance.now();
      srailTween(srail.edgeT, b.t + (Math.min(a.t, b.t) - b.t) * u, SRAIL_DILATE * 1000, srailEaseOut, now);
      srailTween(srail.edgeB, b.b + (Math.max(a.b, b.b) - b.b) * u, SRAIL_DILATE * 1000, srailEaseOut, now);
      srail.handoff = setTimeout(() => srailLand(to, null, false, true), SRAIL_HANDOFF * 1000);
    }
    function srailVelocity(hist, now) {
      const recent = hist.filter(([t]) => now - t <= 100);
      if (recent.length < 2) return 0;
      const [t0, x0] = recent[0];
      const [t1, x1] = recent[recent.length - 1];
      return t1 - t0 >= 8 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
    }
    function srailNearest(y) {
      let best = 0;
      for (let i = 1; i < srail.slots.length; i++) {
        const s = srail.slots[i], b = srail.slots[best];
        if (Math.abs((s.t + s.b) / 2 - y) < Math.abs((b.t + b.b) / 2 - y)) best = i;
      }
      return best;
    }
    function srailSyncUI() {
      const idx = Math.max(0, SIDE_TABS.indexOf(sideTab));
      srail.index = idx;
      srail.committed = idx;
      srail.items.forEach((b, i) => {
        b.setAttribute('aria-checked', String(i === idx));
        b.tabIndex = i === idx ? 0 : -1;
      });
    }
    function srailCommit(i) {
      srail.committed = i;
      if (i === srail.index) return;
      applySideTab(SIDE_TABS[i], true);
    }
    function srailLocalY(e) {
      return e.clientY - (srail.box ? srail.box.top : 0) - SRAIL_INSET;
    }
    function srailRelease() {
      const d = srail.drag;
      srail.drag = null;
      if (srail.track) delete srail.track.dataset.held;
      if (d) {
        const el = srail.items[d.slot];
        if (el) delete el.dataset.pressed;
      }
      return d;
    }
    function srailDown(e, el) {
      if (srail.drag || e.button !== 0) return;
      srail.box = srail.track ? srail.track.getBoundingClientRect() : null;
      try { el.setPointerCapture(e.pointerId); } catch { /* 某些环境不支持 */ }
      const y = srailLocalY(e);
      const onThumb = y >= srail.edgeT.x && y <= srail.edgeB.x;
      srail.drag = {
        id: e.pointerId, y0: y, slot: srail.items.indexOf(el), onThumb,
        live: false, offset: 0, w: 0, hist: [[e.timeStamp, y]],
      };
      if (onThumb) {
        clearTimeout(srail.handoff);
        srail.gen++;
        srail.edgeT.mode = null; srail.edgeT.done = null;
        srail.edgeB.mode = null; srail.edgeB.done = null;
      } else if (!reduceMotion) {
        el.dataset.pressed = '';
      }
    }
    function srailMove(e) {
      const d = srail.drag;
      if (!d || e.pointerId !== d.id || !d.onThumb) return;
      const y = srailLocalY(e);
      d.hist.push([e.timeStamp, y]);
      if (d.hist.length > 8) d.hist.shift();
      if (!d.live) {
        if (Math.abs(y - d.y0) < SRAIL_DEADZONE) return;
        d.live = true;
        d.offset = y - srail.edgeT.x;
        d.w = srail.edgeB.x - srail.edgeT.x;
        if (srail.track) srail.track.dataset.held = '';
      }
      const inner = srail.innerH;
      const l = y - d.offset;
      const maxL = inner - d.w;
      if (reduceMotion) {
        const c = srailClamp(l, 0, maxL);
        srail.edgeT.x = c;
        srail.edgeB.x = c + d.w;
      } else if (l < 0) {
        srail.edgeT.x = 0;
        srail.edgeB.x = d.w - srailRubber(-l, d.w);
      } else if (l > maxL) {
        srail.edgeB.x = inner;
        srail.edgeT.x = maxL + srailRubber(l - maxL, d.w);
      } else {
        srail.edgeT.x = l;
        srail.edgeB.x = l + d.w;
      }
      srailPaint();
    }
    function srailUp(e) {
      const d = srail.drag;
      if (!d || e.pointerId !== d.id) return;
      srailRelease();
      const y = srailLocalY(e);
      if (!d.live) {
        if (Math.abs(y - d.y0) <= SRAIL_SLOP && d.slot !== srail.committed) {
          const from = srail.committed;
          srailCommit(d.slot);
          if (reduceMotion) srailJumpTo(d.slot);
          else srailTravel(from, d.slot);
        }
        return;
      }
      const v = srailVelocity(d.hist, e.timeStamp);
      const flick = Math.abs(v) > SRAIL_FLICK;
      let to = srailNearest((srail.edgeT.x + srail.edgeB.x) / 2 + srailProject(v, SRAIL_GLIDE));
      if (flick && to === srail.committed) to = srailClamp(to + Math.sign(v), 0, srail.items.length - 1);
      srailCommit(to);
      if (reduceMotion) srailJumpTo(to);
      else srailLand(to, v, flick, flick);
    }
    function srailCancel(e) {
      const d = srail.drag;
      if (!d || e.pointerId !== d.id) return;
      srailRelease();
      if (!d.live) return;
      if (reduceMotion) srailJumpTo(srail.committed);
      else srailLand(srail.committed, null, false, false);
    }
    function srailKey(e) {
      const last = srail.items.length - 1;
      let next = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(last, srail.index + 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, srail.index - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      if (next === srail.index) return;
      srailCommit(next);
      srailJumpTo(next);
      if (srail.items[next]) srail.items[next].focus();
    }

    /** 侧键页签 → 长方体面。animate 只给用户主动切换用；首次进入 / 平台切换直接落位 */
    function applySideTab(key, animate) {
      if (!SIDE_TABS.includes(key)) key = 'song';
      const prev = sideTab;
      sideTab = key;
      try { localStorage.setItem(SIDE_KEY_STORE, key); } catch { /* 隐私模式 */ }
      srailSyncUI();
      if (!platMode || !H.plat) return;
      ensurePrism();
      /* 切页签 = 全屏先收：closeAlbumsFs 会把节点放回 myalbums 面。
         即使切到别的面也先收，下面 scheduleAlbumsRestore / releaseAlbumsFace
         再按原逻辑把它搬回 index.html 的位置。 */
      if (maFsOpen) closeAlbumsFs();
      const idx = Math.max(0, SIDE_TABS.indexOf(key));
      const moved = idx !== faceIndex;
      const rolling = !!animate && moved && !reduceMotion;

      if (prev === 'stage' && key !== 'stage') deactivateStageFace();
      if (prev === 'myalbums' && key !== 'myalbums') scheduleAlbumsRestore(rolling);

      if (key === 'song') {
        if (prev !== 'song') railGoSource('liked');
        marqPaused = false;
        if (moved) marqStart();
        /* 流色只在歌曲面跑：翻到中性面时连 WebGL 一起暂停，别让隐藏面空转 */
        if (H.platFx && document.body.dataset.view === 'hall') {
          try { H.platFx.setPaused(false); } catch { /* 忽略 */ }
        }
      } else {
        marqPaused = true;
        marqStop();
        if (H.platFx) {
          try { H.platFx.setPaused(true); } catch { /* 忽略 */ }
        }
        if (key === 'stage') activateStageFace();
        else if (key === 'myalbums') activateAlbumsFace();
        else if (key === 'box') activateToolsFace();
      }

      /* 底色由各自的 face 承担：song 用平台铺色，其余三面中性玻璃 */
      movePrismTo(idx, rolling);
      syncFaceState();
      layoutPrism();
      /* 轨道从 display:none 变回可见后要重量一次，否则滑块坐标还是隐藏态的 0 */
      requestAnimationFrame(srailMeasure);
    }

    /** 我的专辑页签：railEnterAlbums 只接受「我收藏的歌单」根层，不是就先切过去 */
    function sideShowAlbums() {
      if (railRootKind() !== 'playlists') {
        railPath = [{ kind: 'playlists', name: RAIL_SOURCE_NAME.playlists }];
      }
      railEnterAlbums();
    }

    /* ---------------- 长方体：DOM / 翻滚 ---------------- */

    function ensurePrism() {
      if (prism && prism.isConnected) return;
      if (!H.plat || !H.marq) return;
      prism = document.createElement('div');
      prism.className = 'plat-prism';
      prismBox = document.createElement('div');
      prismBox.className = 'plat-prism__box';
      prism.appendChild(prismBox);
      SIDE_TABS.forEach((key) => {
        const f = document.createElement('div');
        f.className = 'plat-face plat-face--' + (key === 'myalbums' ? 'albums' : key);
        f.dataset.face = key;
        f.setAttribute('role', 'group');
        f.setAttribute('aria-label', FACE_LABEL[key] || key);
        prismBox.appendChild(f);
        faces[key] = f;
      });
      H.plat.insertBefore(prism, H.plat.firstChild);
      /* 整块面板搬进 song 面：流色 / 模糊 / 平台条 / 来源浮层 / 跑马带一个不落。
         四个 face 都是完整的「铺色面板」，不是只包内容区。 */
      const song = faces.song;
      const grain = document.getElementById('hall-plat-grain');
      const blur = H.plat.querySelector('.hall-plat__blur');
      if (grain) song.appendChild(grain);
      if (blur) song.appendChild(blur);
      /* 换台扫色层可能先于棱柱创建（applyHallTheme 里 sweep 在 applySideTab 前），
         已经挂在 #hall-plat 上的也搬进 song 面，别留一层盖住中性面 */
      const earlyWipe = H.plat.querySelector('.hall-plat__wipe');
      if (earlyWipe) song.appendChild(earlyWipe);
      if (H.platBar) song.appendChild(H.platBar);
      /* #hall-src-menu 不搬进来：它要溢出面板边缘显示，留在 .hall-rail 上
         （bind 里已经移过去），否则会被 face 的 overflow:hidden 裁掉。 */
      if (H.marq) song.appendChild(H.marq);
      /* 非 song 面不再要平台条：形态长廊 / 我的专辑 / 工具箱各自只留
         一行等宽小字抬头（.face-index），平台切换只属于歌曲面的原长条。 */
      buildStageFace(faces.stage);
      buildToolsFace(faces.box);
      /* 我的专辑：一行抬头 + 借来的 view 的 flex 容器。
         抬头最右追加「全屏」按钮（CSS 由 app.css 的 .face-index__act 承担）。 */
      faces.myalbums.insertAdjacentHTML('beforeend',
        '<div class="face-index"><span class="face-index__k">我的专辑</span>'
        + '<button class="face-index__act" type="button" data-ma-fs aria-label="全屏查看我的专辑">全屏</button></div>');
      faces.myalbums.addEventListener('click', (e) => {
        if (!e.target.closest || !e.target.closest('[data-ma-fs]')) return;
        e.preventDefault();
        e.stopPropagation();
        openAlbumsFs();
      });
      const body = document.createElement('div');
      body.className = 'plat-face__body';
      faces.myalbums.appendChild(body);
      /* #view-myalbums 的原位置用注释节点记住，离开专辑面再搬回去 */
      const mv = document.getElementById('view-myalbums');
      if (mv && mv.parentNode && !myAlbumsHome) {
        myAlbumsHome = document.createComment('view-myalbums home');
        mv.parentNode.insertBefore(myAlbumsHome, mv);
      }
      if (typeof ResizeObserver !== 'undefined') {
        try { new ResizeObserver(() => layoutPrism()).observe(prism); } catch { /* 老环境 */ }
      }
      prismBox.style.transition = 'none';
      prismBox.style.transform = boxTransform();
      document.addEventListener('lizi:hall-release-albums', releaseAlbumsFace);
      document.addEventListener('lizi:stage-edition', onStageEditionChange);
      syncFaceState();
    }

    const FACE_LABEL = { song: '每日推荐', stage: '形态长廊', myalbums: '我的专辑', box: '工具箱' };

    /** 盒子反向转：face i 的静态 transform 是 rotateX(i*90deg)。
     *  再整体后移半个面板高，让当前面落在 z=0 —— 不加这半格，正面会被
     *  perspective 放大（H=400 时约 16%），贴边裁切，看起来像面板突然变大。 */
    function boxTransform() {
      return `translateZ(calc(var(--prism-h) * -0.5)) rotateX(${faceAngle}deg)`;
    }
    function movePrismTo(idx, rolling) {
      if (!prismBox) return;
      let delta = idx - faceIndex;
      /* 环形取最短方向：3→0 继续向前，0→3 反向；相邻页签方向永远跟上下顺序一致 */
      if (delta > 2) delta -= 4;
      else if (delta < -2) delta += 4;
      faceIndex = idx;
      clearTimeout(prismRollT);
      if (!delta || !rolling) {
        prism.classList.remove('is-rolling');
        prismBox.style.transition = 'none';
        faceAngle = -idx * 90;
        prismBox.style.transform = boxTransform();
        return;
      }
      prism.classList.add('is-rolling');
      prismBox.style.transition = 'transform 420ms cubic-bezier(.3, .7, .2, 1)';
      faceAngle -= delta * 90;
      prismBox.style.transform = boxTransform();
      prismRollT = setTimeout(() => {
        prism.classList.remove('is-rolling');
        prismBox.style.transition = '';
      }, 440);
    }

    function syncFaceState() {
      if (!prism) return;
      SIDE_TABS.forEach((key) => {
        const f = faces[key];
        if (!f) return;
        const on = key === sideTab;
        f.classList.toggle('is-active', on);
        f.setAttribute('aria-hidden', String(!on));
        try { f.inert = !on; } catch { /* 老环境 */ }
      });
    }

    /** 面板高度不变；每帧只按面板实际高度更新棱柱的 translateZ 半径 */
    function layoutPrism() {
      if (!prism) return;
      const h = Math.max(1, prism.clientHeight || 0);
      prism.style.setProperty('--prism-h', h + 'px');
      /* 我的专辑面：按「可用面高 / 舞台原生高」反推 --ma-fit。
         不改 pages.css / myalbums.js：布局盒放大到 1/fit、再整体 scale 回来，
         相当于把整排架子等比缩进面里，垂直居中，不再被面沿裁切。 */
      const af = faces.myalbums;
      /* 全屏时节点不在面里，量不到舞台高度；等 closeAlbumsFs / activate 再量 */
      if (af && sideTab === 'myalbums' && !maFsOpen) {
        const body = af.querySelector('.plat-face__body');
        const mv = document.getElementById('view-myalbums');
        const stage = mv && mv.querySelector('.ma-stage');
        const avail = Math.max(0, body ? body.clientHeight : 0);
        const natural = Math.max(0, stage ? stage.offsetHeight : 0);
        if (mv && avail > 1 && natural > 1) {
          const fit = Math.min(1, Math.max(.05, avail / natural));
          const fitTxt = fit.toFixed(3);
          const natTxt = Math.round(natural) + 'px';
          if (mv.style.getPropertyValue('--ma-fit') !== fitTxt) {
            mv.style.setProperty('--ma-fit', fitTxt);
          }
          if (mv.style.getPropertyValue('--ma-nat') !== natTxt) {
            mv.style.setProperty('--ma-nat', natTxt);
          }
        }
      }
      /* 面板高度一变，左侧轨道和四个按键的 rect 也跟着变；滑块
         （clip-path / 上下缘）必须按新 rect 重量，否则停在旧高度。 */
      requestAnimationFrame(srailMeasure);
    }

    function deactivateStageFace() {
      if (stageFaceIO) {
        stageFaceIO.disconnect();
        stageFaceIO = null;
      }
      clearStageStagger();
    }

    /** 退出铺色态 / 离开大厅时把借走的 3D 陈列架立刻还回去 */
    function releaseAlbumsFace() {
      clearTimeout(myAlbumsRestoreT);
      /* 全屏态开着时节点在 .ma-fs__body 里，先收回面里再搬回原位置；
         否则下面的 insert 会把它从全屏容器里直接拽走、body 上留着 is-ma-fs。 */
      if (maFsOpen) closeAlbumsFs();
      const mv = document.getElementById('view-myalbums');
      if (!mv || !myAlbumsHome || !myAlbumsHome.parentNode) return;
      if (mv.parentNode !== myAlbumsHome.parentNode) {
        myAlbumsHome.parentNode.insertBefore(mv, myAlbumsHome.nextSibling);
      }
      /* is-active 是给 myalbums.js 的 active() 借的（见 activateAlbumsFace）；
         还回原来的静态视图时必须摘掉，否则它会绕过 body[data-view] 继续跑 rAF。 */
      mv.classList.remove('is-active');
    }
    function scheduleAlbumsRestore(rolling) {
      clearTimeout(myAlbumsRestoreT);
      if (rolling) myAlbumsRestoreT = setTimeout(releaseAlbumsFace, 440);
      else releaseAlbumsFace();
    }

    /* ---------------- 形态长廊面 ---------------- */

    function activateStageFace() {
      const face = faces.stage;
      if (!face) return;
      buildStageFace(face);
      observeStageImages(face);
      syncStagePaneSelection(face);
      paintStageFilter();
      requestAnimationFrame(() => {
        if (sideTab !== 'stage' || !face.isConnected) return;
        const hit = face.querySelector('.hall-stage__i.is-on');
        if (hit) {
          try { hit.scrollIntoView({ block: 'nearest' }); }
          catch { /* 老环境没有 options */ }
        }
        staggerStagePane(face);
      });
    }

    function buildStageFace(face) {
      if (!face || face.dataset.built === '1') return;
      face.dataset.built = '1';
      /* 档案索引式排版：抬头（等宽小字 + 计数）→ 1px 细线 → 下划线搜索 / 文字筛选 */
      face.innerHTML = `<div class="hall-stage">
        <div class="face-index">
          <span class="face-index__k">形态长廊</span>
          <span class="hall-stage__count"></span>
        </div>
        <div class="hall-stage__tools">
          <label class="hall-stage__search">
            <svg class="hall-stage__qico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-search"/></svg>
            <input class="hall-stage__q" type="search" placeholder="搜索形态" aria-label="搜索形态" autocomplete="off" spellcheck="false">
            <button class="hall-stage__clear" type="button" aria-label="清空搜索">×</button>
          </label>
          <div class="hall-stage__filters" role="group" aria-label="筛选形态">
            <button class="hall-stage__f is-on" type="button" data-stage-filter="all">全部</button>
            <button class="hall-stage__f" type="button" data-stage-filter="fav">收藏</button>
            <span class="hall-stage__favn">0</span>
          </div>
          <button class="hall-stage__gear" type="button" data-stage-settings aria-label="总设置" title="总设置"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-settings"/></svg></button>
        </div>
        <div class="hall-stage__grid"></div>
        <p class="hall-stage__empty" hidden>没有匹配的形态</p>
      </div>`;
      const q = face.querySelector('.hall-stage__q');
      q.addEventListener('input', () => {
        clearTimeout(stageSearchT);
        stageSearchT = setTimeout(() => { stageQuery = q.value; paintStageFilter(); }, 120);
      });
      q.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        q.value = ''; stageQuery = ''; paintStageFilter();
      });
      face.querySelector('.hall-stage__clear').addEventListener('click', () => {
        q.value = ''; stageQuery = ''; paintStageFilter(); q.focus();
      });
      face.addEventListener('click', onStageFaceClick);
      face.addEventListener('error', onStageImgError, true);
      renderStageTiles();
    }

    function renderStageTiles() {
      const face = faces.stage;
      if (!face) return;
      const grid = face.querySelector('.hall-stage__grid');
      if (!grid) return;
      if (stageFaceIO) { stageFaceIO.disconnect(); stageFaceIO = null; }
      const list = stageMenuList(false);
      grid.innerHTML = list.map((s) => {
        const fav = stageFavs.has(s.id);
        const dev = stageEdition === 'dev';
        const title = dev ? `${s.id} · ${s.name}` : s.name;
        return `<div class="hall-stage__cell" data-stage-id="${esc(s.id)}" data-search="${esc((s.name + ' ' + (s.desc || '') + ' ' + s.id).toLowerCase())}">
          <button class="hall-stage__i" type="button" data-stage="${esc(s.id)}" title="${esc(title)}" aria-label="${esc(s.name)}">
            <span class="hall-stage__art">
              <img class="hall-stage__img" data-src="forms-labs/previews/${esc(s.id)}.jpg" alt="" loading="lazy" decoding="async" draggable="false">
            </span>
            <span class="hall-stage__cap">
              <i class="hall-stage__mark" aria-hidden="true"></i>
              <b class="hall-stage__n">${esc(s.name)}</b>
              ${dev ? `<span class="hall-stage__id">${esc(s.id)}</span>` : ''}
            </span>
          </button>
          <button class="hall-stage__star${fav ? ' is-fav' : ''}" type="button" data-fav="${esc(s.id)}"
            aria-pressed="${fav}" aria-label="${fav ? '取消收藏' : '收藏'} ${esc(s.name)}"
            title="${fav ? '取消收藏' : '收藏'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.65 5.7 6.15.8-4.55 4.25 1.2 6.05L12 17.3l-5.45 2.9 1.2-6.05L3.2 9.9l6.15-.8z"/></svg></button>
        </div>`;
      }).join('');
      face.dataset.staggered = '';
      observeStageImages(face);
      paintStageFilter();
      syncStagePaneSelection(face);
    }

    function paintStageFilter() {
      const face = faces.stage;
      if (!face) return;
      const q = stageQuery.trim().toLowerCase();
      let shown = 0, total = 0;
      face.querySelectorAll('.hall-stage__cell').forEach((cell) => {
        total++;
        let hit = !q || (cell.dataset.search || '').includes(q);
        if (hit && stageFavOnly && !stageFavs.has(cell.dataset.stageId)) hit = false;
        cell.hidden = !hit;
        if (hit) shown++;
      });
      const count = face.querySelector('.hall-stage__count');
      if (count) count.textContent = `${shown} / ${total}`;
      const empty = face.querySelector('.hall-stage__empty');
      if (empty) empty.hidden = shown > 0;
      face.querySelectorAll('[data-stage-filter]').forEach((b) => {
        const on = (b.dataset.stageFilter === 'fav') === stageFavOnly;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const cn = face.querySelector('.hall-stage__favn');
      if (cn) cn.textContent = String(stageMenuList(false).filter((s) => stageFavs.has(s.id)).length);
    }

    function saveStageFavs() {
      try { localStorage.setItem(STAGE_FAVS_KEY, JSON.stringify([...stageFavs])); } catch { /* 隐私模式 */ }
    }
    function toggleStageFav(id) {
      if (!id) return;
      if (stageFavs.has(id)) stageFavs.delete(id); else stageFavs.add(id);
      saveStageFavs();
      const face = faces.stage;
      const star = face && face.querySelector(`.hall-stage__star[data-fav="${id}"]`);
      if (star) {
        const on = stageFavs.has(id);
        star.classList.toggle('is-fav', on);
        star.setAttribute('aria-pressed', String(on));
        star.setAttribute('aria-label', (on ? '取消收藏 ' : '收藏 ') + (star.title || ''));
      }
      paintStageFilter();
    }

    function onStageFaceClick(e) {
      const star = e.target.closest('[data-fav]');
      if (star) { e.preventDefault(); e.stopPropagation(); toggleStageFav(star.dataset.fav); return; }
      const gear = e.target.closest('[data-stage-settings]');
      if (gear) { show('settings'); return; }
      const filter = e.target.closest('[data-stage-filter]');
      if (filter) { stageFavOnly = filter.dataset.stageFilter === 'fav'; paintStageFilter(); return; }
      const tile = e.target.closest('[data-stage]');
      if (!tile) return;
      syncStagePaneSelection(faces.stage, tile.dataset.stage);
      /* true = 从大厅的形态长廊进来的，返回键回大厅 */
      applyStage(tile.dataset.stage, true);
    }

    function onStageImgError(e) {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.classList.contains('hall-stage__img')) return;
      const art = img.closest('.hall-stage__art');
      if (art) art.classList.add('is-fail');
      img.removeAttribute('src');
      delete img.dataset.src;
    }

    function onStageEditionChange() {
      const face = faces.stage;
      if (!face || face.dataset.built !== '1') return;
      renderStageTiles();
    }

    /** 进入可视区前 200px 再赋值 src；离开面时断开 */
    function observeStageImages(face) {
      const imgs = Array.from(face.querySelectorAll('.hall-stage__img[data-src]'));
      if (!imgs.length) return;
      if (typeof IntersectionObserver === 'undefined') {
        imgs.forEach(loadStageImage);
        return;
      }
      if (stageFaceIO) stageFaceIO.disconnect();
      stageFaceIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          loadStageImage(en.target);
          if (stageFaceIO) stageFaceIO.unobserve(en.target);
        });
      }, { root: face, rootMargin: '200px 0px' });
      imgs.forEach((img) => stageFaceIO.observe(img));
    }
    function loadStageImage(img) {
      if (!img || !img.dataset.src || img.getAttribute('src')) return;
      img.src = img.dataset.src;
      delete img.dataset.src;
    }

    /** 当前已应用的形态（StageHost.current，默认 classic）→ 方块描边 + 小对勾 */
    function syncStagePaneSelection(face, idOverride) {
      if (!face) return;
      const cur = idOverride || (StageHost.current ? StageHost.current.id : 'classic');
      face.querySelectorAll('.hall-stage__i.is-on').forEach((b) => {
        b.classList.remove('is-on');
        b.removeAttribute('aria-current');
      });
      if (!cur) return;
      const hit = face.querySelector(`.hall-stage__i[data-stage="${cur}"]`);
      if (hit) {
        hit.classList.add('is-on');
        hit.setAttribute('aria-current', 'true');
      }
    }

    function clearStageStagger() {
      const face = faces.stage;
      if (!face) return;
      face.querySelectorAll('.hall-stage__cell.is-first').forEach((b) => {
        b.classList.remove('is-first');
        b.style.removeProperty('--stagger');
      });
    }

    /** 第一次打开：只给首屏那批加 12ms/个的错峰淡入，滚出来的不参与 */
    function staggerStagePane(face) {
      if (!face || face.dataset.staggered === '1') return;
      face.dataset.staggered = '1';
      if (reduceMotion) return;
      const grid = face.querySelector('.hall-stage__grid');
      if (!grid || !grid.firstElementChild) return;
      const cs = getComputedStyle(grid);
      const cols = Math.max(1, (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length);
      const tile = grid.firstElementChild.getBoundingClientRect();
      if (!tile.height) return;
      const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
      const rowH = tile.height + gap;
      const top = Math.max(0, face.getBoundingClientRect().top - grid.getBoundingClientRect().top);
      const firstRow = Math.floor(top / rowH);
      const lastRow = Math.ceil((top + face.clientHeight) / rowH) - 1;
      const from = firstRow * cols;
      const to = Math.min(grid.children.length, (lastRow + 1) * cols);
      for (let i = from; i < to; i++) {
        const b = grid.children[i];
        b.classList.add('is-first');
        b.style.setProperty('--stagger', String((i - from) * 12));
        b.addEventListener('animationend', () => {
          b.classList.remove('is-first');
          b.style.removeProperty('--stagger');
        }, { once: true });
      }
    }

    /* ---------------- 我的专辑面：借用 #view-myalbums ---------------- */

    /* ---------- 我的专辑：全屏 ----------
       DOM / 类名由这里出，外观由 app.css 的 .ma-fs / body.is-ma-fs 负责：
         .ma-fs 容器（body 末尾，只建一次） / .ma-fs__bar / .ma-fs__t / .ma-fs__x
         .ma-fs__body（#view-myalbums 临时住在这里）
       打开 / 关闭都要 mount + resize：myalbums.js 的尺寸按 window 视口和宿主高度算，
       节点换宿主后必须让它重新量一次，否则 --ma-size / --ma-fit 还是面里的旧值。 */
    function ensureAlbumsFs() {
      if (maFsEl && maFsEl.isConnected) return maFsEl;
      const fs = document.createElement('div');
      fs.className = 'ma-fs';
      fs.id = 'ma-fs';
      fs.hidden = true;
      fs.innerHTML = '<div class="ma-fs__bar"><span class="ma-fs__t">我的专辑</span>'
        + '<button class="ma-fs__x" type="button" aria-label="退出全屏">退出全屏</button></div>'
        + '<div class="ma-fs__body"></div>';
      document.body.appendChild(fs);
      fs.querySelector('.ma-fs__x').addEventListener('click', (e) => {
        e.preventDefault();
        closeAlbumsFs();
      });
      /* Esc 退出全屏。捕获阶段抢在其它 Esc 处理（抽屉 / 形态面板 / 返回大厅）之前，
         否则按一下会把整层大厅也退掉。 */
      document.addEventListener('keydown', (e) => {
        if (!maFsOpen || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        closeAlbumsFs();
      }, true);
      maFsEl = fs;
      return fs;
    }

    function openAlbumsFs() {
      if (maFsOpen || sideTab !== 'myalbums') return;
      const mv = document.getElementById('view-myalbums');
      if (!mv) return;
      const fs = ensureAlbumsFs();
      const body = fs.querySelector('.ma-fs__body');
      if (!body) return;
      maFsOpen = true;
      body.appendChild(mv);
      /* active() 的另一条判据是 #view-myalbums.is-active：全屏时 body[data-view]
         不是 myalbums，这里不补类，myalbums.js 的 rAF 会立刻 return
         （表现就是拖拽只改 S.pos、画面完全不动）。 */
      mv.classList.add('is-active');
      document.body.classList.add('is-ma-fs');
      fs.hidden = false;
      try { window.dispatchEvent(new Event('resize')); } catch { /* 忽略 */ }
      try {
        if (window.__LIZI_MYALBUMS && window.__LIZI_MYALBUMS.mount) window.__LIZI_MYALBUMS.mount(mv);
      } catch (e) { console.warn('[hall] myalbums fullscreen mount failed', e); }
      const x = fs.querySelector('.ma-fs__x');
      if (x) {
        try { x.focus({ preventScroll: true }); } catch { try { x.focus(); } catch { /* 忽略 */ } }
      }
    }

    function closeAlbumsFs() {
      if (!maFsOpen) return;
      maFsOpen = false;
      const mv = document.getElementById('view-myalbums');
      const face = faces.myalbums;
      const body = face && face.querySelector('.plat-face__body');
      /* 搬回面里、保持 is-active：从全屏退回面里还要能拖；如果这次是因为离开
         专辑面 / 退出铺色态，调用方（releaseAlbumsFace）随后会摘掉 is-active。 */
      if (mv && body) body.appendChild(mv);
      if (mv) mv.classList.add('is-active');
      document.body.classList.remove('is-ma-fs');
      if (maFsEl) maFsEl.hidden = true;
      try { window.dispatchEvent(new Event('resize')); } catch { /* 忽略 */ }
      /* 面在前台：按新尺寸重算棱柱与 --ma-fit；不在前台时等 activateAlbumsFace */
      if (platMode && sideTab === 'myalbums') layoutPrism();
    }

    function activateAlbumsFace() {
      clearTimeout(myAlbumsRestoreT);
      const face = faces.myalbums;
      const mv = document.getElementById('view-myalbums');
      if (!face || !mv) return;
      const body = face.querySelector('.plat-face__body') || face;
      /* 全屏开着时节点不在面里：先收全屏，它会把节点放回 body */
      if (maFsOpen) closeAlbumsFs();
      if (mv.parentNode !== body) body.appendChild(mv);
      /* 关键修复（2026-11-08）：myalbums.js 的 active() 只认
         body[data-view="myalbums"] 或 #view-myalbums.is-active。铺色态把节点搬进
         面里后两个条件都不成立，tick() 第一行就 return —— 拖拽改了 S.pos，
         但 rAF 不再写 transform，看起来就是「左右拖不动」。这里补 is-active。 */
      mv.classList.add('is-active');
      /* 先摆好、量好再翻滚：它自己的 mount 会按视口重算尺寸与排版 */
      try { if (window.__LIZI_MYALBUMS && window.__LIZI_MYALBUMS.mount) window.__LIZI_MYALBUMS.mount(mv); }
      catch (e) { console.warn('[hall] myalbums mount failed', e); }
      try { window.dispatchEvent(new Event('resize')); } catch { /* 忽略 */ }
      /* mount 里会按视口重写 --ma-size；等它排完再按面高反推一次 scale */
      setTimeout(() => { if (sideTab === 'myalbums') layoutPrism(); }, 80);
      setTimeout(() => { if (sideTab === 'myalbums') layoutPrism(); }, 180);
    }

    /* ---------------- 工具箱面 ---------------- */

    function buildToolsFace(face) {
      if (!face || face.dataset.built === '1') return;
      face.dataset.built = '1';
      face.innerHTML = '<div class="face-index"><span class="face-index__k">工具箱</span></div><div class="hall-tools"></div>';
      face.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pane-entry]');
        if (!b) return;
        const x = hallEntries().find((v) => v.id === b.dataset.paneEntry);
        if (!x) return;
        if (b.classList.contains('is-off')) {
          if (!(x.need && document.getElementById(x.need))) return;
          b.classList.remove('is-off');
          b.removeAttribute('aria-disabled');
        }
        x.act();
      });
      activateToolsFace();
    }

    function activateToolsFace() {
      const face = faces.box;
      const box = face && face.querySelector('.hall-tools');
      if (!box) return;
      const items = hallEntries().filter((x) => x.id !== 'box');
      box.innerHTML = items.map((x) => {
        const off = hallEntryOff(x);
        return `<button class="hall-tools__i${off ? ' is-off' : ''}" type="button"
            data-pane-entry="${esc(x.id)}"${off ? ' aria-disabled="true"' : ''}>
          <span class="hall-tools__ico">${HALL_ICONS[x.id] || ''}</span>
          <span class="hall-tools__n">${esc(x.name)}</span>
          <span class="hall-tools__c">${esc(x.desc || '')}</span>
        </button>`;
      }).join('');
    }

    function paintSideRail() {
      const railEl = H.rail || document.getElementById('hall-rail');
      if (!railEl) return;
      const items = [
        { key: 'song', name: '我的喜欢', icon: HALL_ICONS.song },
        { key: 'stage', name: '形态长廊', icon: HALL_ICONS.stage },
        { key: 'myalbums', name: '我的专辑', icon: HALL_ICONS.myalbums },
        { key: 'box', name: '工具箱', icon: HALL_ICONS.box },
      ];
      let nav = railEl.querySelector('.hall-sidekeys');
      if (!nav) {
        nav = document.createElement('div');
        nav.className = 'hall-sidekeys';
        nav.setAttribute('role', 'radiogroup');
        nav.setAttribute('aria-label', '大厅入口');
        railEl.appendChild(nav);
      }
      srail.track = nav;
      /* 按钮里只放图标，名字进 aria-label / title；滑块是空 div，靠 clip-path 露出。
         最后那个下三角不参与滑块：它是「收起面板、只留海报」的开关，单独 absolute
         钉在轨道最下面（CSS 里 .srail__fold）。 */
      nav.innerHTML = items.map((x) => `<button class="srail__i" type="button" role="radio"
          aria-checked="false" tabindex="-1" data-side="${x.key}"
          title="${esc(x.name)}" aria-label="${esc(x.name)}">${x.icon || ''}</button>`).join('')
        + '<div class="srail__thumb" aria-hidden="true"></div>'
        + '<button class="srail__fold" type="button" data-fold aria-expanded="true"'
        + ' title="收起面板" aria-label="收起面板"><svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
      srail.thumb = nav.querySelector('.srail__thumb');
      srail.items = Array.from(nav.querySelectorAll('.srail__i'));
      srailSyncUI();
      syncFoldBtn();
      if (!nav.dataset.bound) {
        nav.dataset.bound = '1';
        nav.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          const el = e.target.closest('.srail__i');
          if (!el || !nav.contains(el)) return;
          srailDown(e, el);
        });
        /* 下三角只吃 click：pointerdown 那条分支认 .srail__i，不会误触滑块。
           2026-11-09：手机铺色态折的是「海报」（留出完整面板），桌面仍收起面板。 */
        nav.addEventListener('click', (e) => {
          if (!e.target.closest('[data-fold]')) return;
          e.preventDefault();
          if (mobileHeroFoldOn()) setHeroFolded(!heroFolded);
          else setPlatFolded(!platFolded);
        });
        nav.addEventListener('pointermove', srailMove);
        nav.addEventListener('pointerup', srailUp);
        nav.addEventListener('pointercancel', srailCancel);
        nav.addEventListener('lostpointercapture', srailCancel);
        nav.addEventListener('keydown', (e) => {
          if (!e.target.closest('.srail__i')) return;
          srailKey(e);
        });
      }
      requestAnimationFrame(srailMeasure);
      if (typeof ResizeObserver !== 'undefined' && !nav._srailRO) {
        nav._srailRO = new ResizeObserver(() => srailMeasure());
        nav._srailRO.observe(nav);
      }
    }

    /** 手机铺色态才走「折叠海报」分支：viewport 1280 + 触屏，和 sync.js 注入
        480:520 的那条媒体查询完全同一条，桌面 pointer:fine 永远为 false。 */
    function mobileHeroFoldOn() {
      if (!platMode) return false;
      try {
        return !!(window.matchMedia && matchMedia('(max-width: 1280px) and (pointer: coarse)').matches);
      } catch { return false; }
    }

    /** 下三角的 aria / 图标方向跟着状态走（重画页签后也要补一次）。
        手机说的是「海报」，桌面说的是「面板」——两套状态互不串味。 */
    function syncFoldBtn() {
      const b = H.rail ? H.rail.querySelector('.srail__fold') : null;
      if (!b) return;
      if (mobileHeroFoldOn()) {
        /* 手机：海报可见 = expanded；折叠后按钮用于把海报拉回来 */
        b.setAttribute('aria-expanded', String(!heroFolded));
        b.title = heroFolded ? '展开海报' : '收起海报';
        b.setAttribute('aria-label', b.title);
        return;
      }
      b.setAttribute('aria-expanded', String(!platFolded));
      b.title = platFolded ? '展开面板' : '收起面板';
      b.setAttribute('aria-label', b.title);
    }

    /** 收起 / 展开铺色面板（2026-11-09）：收起后只留海报。
        布局靠 CSS 的 #view-hall.is-plat-folded（#hall-plat display:none，
        海报 flex 吃满、轨道塌成 0 高，下三角反转 180° 浮在海报左下角）。
        可见性一变，跑马带和流色都得停 —— 看不见的东西不该继续 60fps 空转。 */
    function setPlatFolded(on) {
      platFolded = !!on;
      el.viewHall.classList.toggle('is-plat-folded', platFolded);
      syncFoldBtn();
      if (platFolded) {
        marqStop();
        if (H.platFx) { try { H.platFx.setPaused(true); } catch { /* WebGL 没起来就算了 */ } }
        return;
      }
      if (!platMode || document.body.dataset.view !== 'hall') return;
      if (H.platFx) { try { H.platFx.setPaused(false); } catch { /* 同上 */ } }
      /* 面板藏起来期间尺寸全量成 0：展开后先按新高度重量，再开跑马带 */
      requestAnimationFrame(() => {
        if (!platMode || platFolded) return;
        fitPlatScale();
        layoutPrism();
        if (!marqHalf) marqMeasure();
        marqStart();
      });
    }

    /* ================= 手机铺色态：折叠「海报」+ 分屏拖拽（2026-11-09） =================
       和上面的 setPlatFolded 是两套互斥状态：
         · 桌面 pointer:fine → platFolded / is-plat-folded（面板 display:none，海报吃满）；
         · 手机 coarse     → heroFolded / is-hero-folded（海报 0 高，面板吃满）。
       手机上绝不调用 marqStop / platFx.setPaused：面板还看得见，跑马带和流色不该停。 */

    /** 面板高度变了只重算尺寸的那一套（与 setPlatFolded 展开时的收尾完全一致）。 */
    function relayoutPlatNow() {
      if (!platMode || document.body.dataset.view !== 'hall') return;
      fitPlatScale();
      layoutPrism();
      if (!marqHalf) marqMeasure();
    }

    /** 下一帧再量：折叠/展开落定后调用；drag 期间则在每个 rAF 里同步调 relayoutPlatNow。 */
    function relayoutPlatSoon(startMarquee) {
      cancelAnimationFrame(heroRelayoutRaf);
      heroRelayoutRaf = requestAnimationFrame(() => {
        heroRelayoutRaf = 0;
        if (!platMode || document.body.dataset.view !== 'hall') return;
        relayoutPlatNow();
        if (startMarquee) marqStart();   // 幂等：手机折叠期间跑马带本来就没停过
      });
    }

    /** 量「海报完全展开」时的高度。折叠态直接量会得到 0，就临时摘掉类 / 清内联
        让 CSS 自己算一次（手机 480:520 是 sync.js 注入的，这里不写死任何比例），
        读一次 offsetHeight 后原样还原 —— 同一帧内完成，不会触发绘制。 */
    function heroOpenH() {
      const hero = H.hero;
      if (!hero) return 0;
      const flex = hero.style.flex, height = hero.style.height, minH = hero.style.minHeight;
      const had = el.viewHall.classList.contains('is-hero-folded');
      hero.style.flex = '';
      hero.style.height = '';
      hero.style.minHeight = '';
      if (had) el.viewHall.classList.remove('is-hero-folded');
      const openH = hero.offsetHeight;
      if (had) el.viewHall.classList.add('is-hero-folded');
      hero.style.flex = flex;
      hero.style.height = height;
      hero.style.minHeight = minH;
      return Math.max(0, openH);
    }

    /** 面板顶部那条可拖的分隔抓手：只在手机铺色态创建。
        它绝对定位在 .hall-rail 的 20px 上边距里，不参与 flex，
        所以折叠 / 拖动都不会挤压左轨和面板本身。 */
    function ensureHeroGrip() {
      if (!mobileHeroFoldOn() || !H.rail) return null;
      if (heroGripEl && heroGripEl.parentNode === H.rail) return heroGripEl;
      heroGripEl = H.rail.querySelector('.hall-hero-grip');
      if (heroGripEl) return heroGripEl;
      const g = document.createElement('div');
      g.className = 'hall-hero-grip';
      g.setAttribute('role', 'separator');
      g.setAttribute('aria-orientation', 'horizontal');
      g.setAttribute('aria-label', '上下拖动调整海报高度');
      g.innerHTML = '<span class="hall-hero-grip__bar" aria-hidden="true"></span>';
      H.rail.appendChild(g);
      g.addEventListener('pointerdown', heroGripDown);
      g.addEventListener('pointercancel', heroGripCancel);
      g.addEventListener('lostpointercapture', heroGripCancel);
      heroGripEl = g;
      return g;
    }

    /** 拖动期间挂到 window：手指移出抓手 / 老 WebView 没拿到 pointer capture 也能收到。 */
    function attachHeroDragListeners() {
      window.addEventListener('pointermove', heroGripMove, { passive: false });
      window.addEventListener('pointerup', heroGripUp);
      window.addEventListener('pointercancel', heroGripCancel);
    }
    function detachHeroDragListeners() {
      window.removeEventListener('pointermove', heroGripMove, { passive: false });
      window.removeEventListener('pointerup', heroGripUp);
      window.removeEventListener('pointercancel', heroGripCancel);
    }

    /** 写本次拖动的高度：inline flex/height 压过 is-hero-folded 的 0 高，
        .hall-rail 用 flex:1 吃掉剩下的高度，面板跟着手指实时让位。 */
    function applyHeroH(h) {
      const hero = H.hero;
      if (!hero) return;
      const v = Math.max(0, Math.round(h));
      hero.style.flex = '0 0 ' + v + 'px';
      hero.style.height = v + 'px';
      hero.style.minHeight = '0';
    }
    function clearHeroInline() {
      if (!H.hero) return;
      H.hero.style.flex = '';
      H.hero.style.height = '';
      H.hero.style.minHeight = '';
    }

    function heroGripDown(e) {
      if (!mobileHeroFoldOn() || !H.hero || !H.rail) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;   // 触屏以外的左键兜底
      if (heroDrag) endHeroDrag(true, true);                    // 多指重入：先把上一段落定
      stopHeroSnap();                                           // 吸附动画中途再按住：停帧，从当前视觉高度接着拖
      const startH = Math.max(0, H.hero.offsetHeight);
      const openH = Math.max(startH, heroOpenH());              // 展开目标高度，复用当前 CSS 比例
      heroDrag = {
        id: e.pointerId, startY: e.clientY, startH, openH,
        lastY: e.clientY, lastT: performance.now(), vy: 0,
        pendingH: startH,
      };
      attachHeroDragListeners();
      if (heroGripEl) {
        heroGripEl.classList.add('is-drag');
        try { heroGripEl.setPointerCapture(e.pointerId); } catch { /* 老 WebView：window 监听兜底 */ }
      }
      if (e.cancelable) e.preventDefault();
    }

    function heroGripMove(e) {
      if (!heroDrag || e.pointerId !== heroDrag.id) return;
      const dy = e.clientY - heroDrag.startY;                   // 往下拖 = 海报露出来
      const h = Math.max(0, Math.min(heroDrag.openH, heroDrag.startH + dy));
      const now = performance.now();
      const dt = now - heroDrag.lastT;
      if (dt >= 8) {
        /* 轻量平滑，给松手判「甩」用；太小的时间片速度噪声大，跳过 */
        const v = ((e.clientY - heroDrag.lastY) / dt) * 1000;
        heroDrag.vy = heroDrag.vy * 0.7 + v * 0.3;
        heroDrag.lastY = e.clientY;
        heroDrag.lastT = now;
      }
      heroDrag.pendingH = h;
      /* 指针事件可能一帧来好几次：高度 + 布局都收进一个 rAF，别每个事件都强制排版 */
      if (!heroDragRaf) {
        heroDragRaf = requestAnimationFrame(() => {
          heroDragRaf = 0;
          if (!heroDrag) return;
          applyHeroH(heroDrag.pendingH);
          relayoutPlatNow();              // fitPlatScale / layoutPrism / 跑马带测量
        });
      }
      if (e.cancelable) e.preventDefault();
    }

    function heroGripUp(e) {
      if (!heroDrag || e.pointerId !== heroDrag.id) return;
      endHeroDrag(false);
    }
    function heroGripCancel(e) {
      if (!heroDrag || e.pointerId !== heroDrag.id) return;
      endHeroDrag(true);
    }

    /** 松手吸附 / pointercancel 兜底。cancelled 时不看甩速，只按露出比例判。
        instant = 立刻落定（换台 / 退出铺色 / 页面离开时用，不做动画）。 */
    function endHeroDrag(cancelled, instant) {
      const d = heroDrag;
      heroDrag = null;
      cancelAnimationFrame(heroDragRaf);
      heroDragRaf = 0;
      detachHeroDragListeners();
      if (heroGripEl) heroGripEl.classList.remove('is-drag');
      if (!d) return;
      const h = d.pendingH;
      let open;
      /* 松手前手指已经停住：旧速度不能拿来判甩，否则轻放也会弹到另一头 */
      if (performance.now() - d.lastT > 120) d.vy = 0;
      if (!cancelled && Math.abs(d.vy) >= HERO_FLICK_V) open = d.vy > 0;  // 下甩展开 / 上甩收起
      else open = h >= d.openH * HERO_SNAP_RATIO;
      if (instant) {
        stopHeroSnap();
        if (Math.abs((open ? d.openH : 0) - h) >= 1) applyHeroH(open ? d.openH : 0);
        finishHeroSnap(open);
      } else {
        snapHeroTo(open, h, d.openH);
      }
    }

    function stopHeroSnap() {
      if (heroSnapRaf) { cancelAnimationFrame(heroSnapRaf); heroSnapRaf = 0; }
    }

    /** 松手后的连续吸附；prefers-reduced-motion 下直接落位，不做动画。 */
    function snapHeroTo(open, fromH, openH) {
      const to = open ? openH : 0;
      stopHeroSnap();
      const from = Math.max(0, fromH);
      if (reduceMotion || Math.abs(to - from) < 1) {
        if (Math.abs(to - from) >= 1) applyHeroH(to);
        finishHeroSnap(open);
        return;
      }
      const t0 = performance.now();
      const dur = 200;
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);   // easeOutCubic，和跑马带 seek 同一手感
        applyHeroH(from + (to - from) * e);
        relayoutPlatNow();
        if (p < 1) { heroSnapRaf = requestAnimationFrame(step); return; }
        heroSnapRaf = 0;
        finishHeroSnap(open);
      };
      heroSnapRaf = requestAnimationFrame(step);
    }

    /** 吸附落定：类 + 内联高度一次性收口，再按新面板高度重量一次。 */
    function finishHeroSnap(open) {
      heroFolded = !open;
      el.viewHall.classList.toggle('is-hero-folded', heroFolded);
      clearHeroInline();
      syncFoldBtn();
      relayoutPlatSoon(true);
    }

    /** 下三角在手机上的动作：折叠 / 展开海报（不碰面板可见性）。 */
    function setHeroFolded(on) {
      if (heroDrag) endHeroDrag(true, true);
      stopHeroSnap();
      ensureHeroGrip();                 // 兜底：入口那次没建成就这里补上
      heroFolded = !!on;
      el.viewHall.classList.toggle('is-hero-folded', heroFolded);
      clearHeroInline();
      syncFoldBtn();
      /* 面板一直在：不 marqStop、不 setPaused；只把尺寸/棱柱/跑马带重量一次 */
      relayoutPlatSoon(true);
    }

    /** 退出铺色 / 换台时复位手机折叠（保留抓手指南，下次进铺色态直接可用）。 */
    function resetHeroFold() {
      if (heroDrag) endHeroDrag(true, true);
      stopHeroSnap();
      heroFolded = false;
      el.viewHall.classList.remove('is-hero-folded');
      clearHeroInline();
      if (heroGripEl) heroGripEl.classList.remove('is-drag');
      if (mobileHeroFoldOn()) syncFoldBtn();   // 桌面不额外碰按钮的 aria/title
    }

    /** 平台管理/开场多选后：就地重画「我的」和顶部平台条，不重新请求登录态。
        detail.flat = 开场融合前用，保持普通态，别提前进铺色。 */
    function refreshPlatformUI(ev) {
      cardQrStop();
      const base = platRows.length ? platRows
        : (window.LIZI_ACCOUNTS || []).map((a) => ({ id: a.id, name: a.name, accent: a.accent, loggedIn: false }));
      /* 账号数据还没到也不能把「我的」写成空；先用兜底行占位，
         有已登录平台才画卡，一个都没有就画登录引导（meHallHtml）。 */
      const all = base.length ? base : platFallbackRows();
      const vis = platRowsVisible(all);
      const flat = !!(ev && ev.detail && ev.detail.flat);
      if (platMode && (flat || !vis.some((r) => r.id === platMode))) applyHallTheme('');
      H.me.innerHTML = meHallHtml(all);
      syncHallMeCell();
      if (window.LiziPixelCard) window.LiziPixelCard.mountAll(H.me);
      if (!flat && base.length) restoreHallTheme(all);
      paintPlatBar();
      meLastH = -1;
      measureMePin();
      requestAnimationFrame(updateMe);
    }

    /* 2026-11-08 晚：铺色态底部那条四张卡的工具带（含 GlassSurface 玻璃）整条删了。
       四个入口改到面板左侧留白里的竖向页签（paintSideRail），面板只剩
       顶部平台长条 + 每日推荐跑马带两段。 */

    /* ---------- 左上角「每日推荐」标签 → 就地 Option Wheel 换来源（2026-11-08） ----------
       宿主就是面包屑根段那个标签本身：悬停后在原地展开成文字滚轮（ReactBits
       Option Wheel 的排布数学，实现在 hall/option-wheel.js），没有底板/卡片。
       滚轮 / 拖拽 / 点选只改「居中项」，一变就走 srcPick → railGoSource 切跑马带。
       滚轮 DOM 仍在 index.html 的 #hall-src-menu，但已移出 #hall-plat
       （见 bind 里的 appendChild），避免被它那层 overflow:hidden 裁掉。
       设置页把「大厅内容轨」关掉时（旧交互）退回 openPlatCard，不另造一套取数。 */
    const SRC_ITEMS = [
      { id: 'daily', name: '每日推荐' },
      { id: 'pick', name: '精选' },
      { id: 'like', name: '我的喜欢' },
      { id: 'coll', name: '我收藏的歌单' },
      { id: 'radio', name: '电台' },
    ];
    let srcOpen = false, srcHi = -1, srcCloseT = 0, srcHideT = 0, srcFadeT = 0;
    let srcWheel = null;
    /* 滚轮上次定位所依据的来源 kind。只有 railRootKind() 和它不一致（外部重置 /
       换平台）时才重新归位；重画长条造成的 transient close→reopen 不再覆盖滚轮
       当前位置，否则会把刚滚动到的项打回「每日推荐」。 */
    let srcWheelRoot = '';
    /* 滚轮表现层（2026-11-08，移植 ReactBits Option Wheel）：
       pos / target / 拖拽物理都收在 hall/option-wheel.js 里，只通过 onChange
       把「居中项」交回 srcPick；语义真值仍然只有 srcHi 一个。 */
    const SRC_WHEEL_H = 160;          // 容器高 160，五项在中间 ±2 行（约 5 行可见）

    const srcKindOf = (c) => RAIL_KIND[c.id] || c.id;
    const srcIndexOf = (kind) => SRC_ITEMS.findIndex((c) => srcKindOf(c) === kind);

    function ensureSrcWheel() {
      if (srcWheel || !H.srcMenu) return srcWheel;
      srcWheel = window.LiZiOptionWheel?.create(H.srcMenu, {
        items: SRC_ITEMS,
        fontSize: 13,
        spacing: 1.4,
        selected: 0,
        reduceMotion: () => reduceMotion,
        onChange: (i) => { srcPick(i); },
      });
      return srcWheel;
    }

    /** 高亮 + 根段「浮起」状态一起同步。paintPlatBar 重画长条后也要调一次。 */
    function syncSrcMenu() {
      if (!H.srcMenu) return;
      const id = srcHi >= 0 && SRC_ITEMS[srcHi] ? SRC_ITEMS[srcHi].id : '';
      H.srcMenu.querySelectorAll('[data-src]').forEach((b) => {
        const on = !!id && b.dataset.src === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      const t = H.platBar.querySelector('[data-src-root]');
      if (t) {
        t.classList.toggle('is-open', srcOpen);
        t.setAttribute('aria-expanded', String(srcOpen));
      }
      /* 展开时把标签文字让给滚轮（只改透明度，不占/不撑布局）；
         收起后由 is-src-fading 继续压住 150ms，让滚轮中间那行先淡出、标签再回来。 */
      H.platBar.classList.toggle('is-src-open', srcOpen);
    }

    /** 把滚轮宿主钉在当前标签上：左沿对齐标签文字，纵向以标签行为中心。 */
    function srcPlaceWheel() {
      if (!H.srcMenu || !H.rail || !H.platBar) return;
      const host = H.platBar.querySelector('.pstrip__src');
      if (!host) return;
      const hr = host.getBoundingClientRect();
      const rr = H.rail.getBoundingClientRect();
      H.srcMenu.style.left = (hr.left - rr.left) + 'px';
      H.srcMenu.style.top = (hr.top - rr.top + hr.height / 2 - SRC_WHEEL_H / 2) + 'px';
      H.srcMenu.style.width = '170px';
      H.srcMenu.style.height = SRC_WHEEL_H + 'px';
      /* #hall-plat 是 --plat-ink 的作用域；宿主搬到了它外面，手动补上 */
      const cs = getComputedStyle(H.plat);
      H.srcMenu.style.color = cs.getPropertyValue('--plat-ink').trim() || '';
    }

    function srcOpenMenu() {
      if (!platMode || !H.srcMenu) return;
      clearTimeout(srcCloseT);
      clearTimeout(srcFadeT);
      H.platBar.classList.remove('is-src-fading');
      if (!srcOpen) {
        ensureSrcWheel();
        /* 只有来源真的变了（外部 railReset / 换平台）才让滚轮重新居中；
           否则保留它当前的位置 —— 修「松手后被长条重画打回每日推荐」。 */
        const rootKind = railRootKind();
        const rootIdx = srcIndexOf(rootKind);
        if (rootKind !== srcWheelRoot || srcHi < 0) {
          srcWheelRoot = rootKind;
          srcHi = rootIdx >= 0 ? rootIdx : 0;
          srcWheel?.select(srcHi, false);
        }
        srcOpen = true;
        clearTimeout(srcHideT);
        srcPlaceWheel();
        H.srcMenu.hidden = false;
        H.srcMenu.classList.remove('is-open');
        void H.srcMenu.offsetWidth;       // 让 opacity 过渡从 0 起跑
        H.srcMenu.classList.add('is-open');
      }
      syncSrcMenu();
    }

    function srcCloseMenu() {
      clearTimeout(srcCloseT);
      if (!srcOpen) {
        if (H.srcMenu) H.srcMenu.hidden = true;
        return;
      }
      srcOpen = false;
      if (H.srcMenu) {
        H.srcMenu.classList.remove('is-open', 'is-dragging');
        clearTimeout(srcHideT);
        srcHideT = setTimeout(() => {
          if (!srcOpen && H.srcMenu) H.srcMenu.hidden = true;
        }, 150);
        /* 淡出这 150ms 里标签继续隐身：只留滚轮中间那一行，收完再让标签回来 */
        H.platBar.classList.add('is-src-fading');
        clearTimeout(srcFadeT);
        srcFadeT = setTimeout(() => H.platBar.classList.remove('is-src-fading'), 150);
      }
      syncSrcMenu();
    }

    function srcCloseSoon() {
      /* 指针还在滚轮里（或正按住拖）就别收：换来源会重画标签，可能误触发 pointerout */
      if (H.srcMenu && srcOpen
        && (H.srcMenu.matches(':hover') || H.srcMenu.classList.contains('is-dragging'))) return;
      clearTimeout(srcCloseT);
      srcCloseT = setTimeout(srcCloseMenu, 120);
    }

    /** 高亮换一项 = 立刻切跑马带（内容轨复用 railGoSource，不重写数据层）。 */
    function srcPick(i) {
      const n = SRC_ITEMS.length;
      if (!n || !platMode) return;
      i = ((i % n) + n) % n;
      if (i === srcHi) return;
      srcHi = i;
      const c = SRC_ITEMS[i];
      /* 先记下滚轮依据的 kind，再改 railPath：两者始终同步，
         重画长条后再展开也不会用旧路径把滚轮打回根。 */
      srcWheelRoot = srcKindOf(c);
      syncSrcMenu();
      /* 「每日推荐」是内容轨的根：不取来源，直接回到根层 */
      if (c.id === 'daily') {
        if (railOn()) {
          railReset();
          marqSeq++;
          paintPlatBar();
          renderMarq();
        }
        return;
      }
      if (railOn()) railGoSource(srcWheelRoot);
      else { openPlatCard(platMode, srcWheelRoot); srcCloseMenu(); }
    }

    /* ---------- 四个来源（2026-11-06：六个平台能接的都接了） ----------
       2026-11-08：不再画成卡片，改成左上角「每日推荐」的悬停浮层（见 SRC_ITEMS）。
       精选      网易云 → 推荐歌单（和每日推荐不是一回事）· QQ → 推荐歌单
                 酷狗 → 新歌速递 · 汽水 → 推荐流 · 波点/Spotify → 如实说没有
       我的喜欢  网易云 → 我喜欢的音乐 · QQ → 我喜欢（要登录）
                 酷狗/汽水/波点/Spotify → 没有开放这个接口，如实说
       我收藏的歌单 网易云 → 收藏歌单 · QQ/酷狗 → 我的歌单（要登录）
       电台      上游要么没开放、要么只给登录态，先如实说
       全部落在 #view-browse 的 .track 行，点行就播（Player 按 track.source 选音源）。 */
    const PLAT_NICE = {
      netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水', bodian: '波点', spotify: 'Spotify', kuwo: '酷我音乐',
    };
    const platNice = (id) => PLAT_NICE[id] || id;
    const fmtNum = (n) => {
      n = Number(n) || 0;
      return n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿'
        : n >= 1e4 ? Math.round(n / 1e4) + ' 万' : String(n);
    };

    /* 列表请求的序号：点得快 / 换台时，**慢的那条回来的结果不许再往页面上写**
       （实测：QQ「我的喜欢」要 20s 才回，期间点了酷狗的歌单，QQ 的提示会盖掉酷狗的） */
    let platSeq = 0;
    const platAlive = (seq) => seq === platSeq;
    /* 老主进程还没加载新路由时回的是 {code:404}，别把 "unknown xxx api" 当成上游错误 */
    const platFail = (d, fallback) => (d && Number(d.code) === 404
      ? '接口已接好，重启 LIZI 后生效'
      : ((d && d.error) || fallback));

    async function openPlatCard(pid, kind) {
      const name = platNice(pid);
      const label = { featured: '精选', liked: '我的喜欢', playlists: '我收藏的歌单', radio: '电台' }[kind] || kind;
      /* 列表内容是这家平台的，顶部音源条就亮这家（不然「网易云」高亮着 QQ 的内容） */
      searchSource = pid;
      try { localStorage.setItem('lizi.searchSource', searchSource); } catch { /* ignore */ }
      paintSource();
      show('browse');
      hint(`${name} · ${label}`);
      if (kind === 'radio') return openRadio(pid);
      if (kind === 'featured') return openFeatured(pid);
      if (kind === 'liked') return openLiked(pid);
      if (kind === 'playlists') return openMyPlaylists(pid);
    }

    /** 精选：每家给「最能代表这家」的内容，且不与跑马带的每日推荐重复 */
    async function openFeatured(pid) {
      const seq = ++platSeq;
      emptyList('正在载入…');
      try {
        if (pid === 'netease') {
          /* 推荐歌单（/personalized/playlist），不是每日推荐那批歌 */
          const d = await API.topPlaylists(12);
          if (!platAlive(seq)) return;
          const list = ((d && d.playlists) || []).map((p) => ({
            id: String(p.id), name: p.name, cover: p.cover,
            trackCount: p.tracks || 0, playCount: p.count || 0,
            creator: { nickname: p.creator || '' }, source: 'netease',
          })).filter((p) => p.id && p.name);
          if (!list.length) { emptyList('网易云没返回推荐歌单'); return; }
          hint(`网易云 · 精选 · 推荐歌单 ${list.length} 个`);
          renderPlaylistRows(list, 'netease', '精选');
          return;
        }
        if (pid === 'qq') {
          const d = await API.qqRecommendPlaylists(9);
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList((d && d.error) || 'QQ 音乐没返回推荐歌单'); return; }
          hint(`QQ 音乐 · 精选 · 推荐歌单 ${list.length} 个`);
          renderPlaylistRows(list, 'qq', '精选');
          return;
        }
        if (pid === 'kugou') {
          const d = await API.kugouTopSongs(1);
          if (!platAlive(seq)) return;
          const t = (d && d.tracks) || [];
          if (!t.length) { emptyList((d && d.error) || '酷狗没返回新歌'); return; }
          hint(`酷狗 · 精选 · 新歌速递 ${t.length} 首`);
          renderTracks(t);
          return;
        }
        if (pid === 'qishui') {
          const d = await API.qishuiFeed(20);
          if (!platAlive(seq)) return;
          const t = (d && d.tracks) || [];
          if (!t.length) { emptyList((d && d.error) || '汽水没返回推荐流'); return; }
          hint(`汽水 · 精选 · 为你推荐 ${t.length} 首`);
          renderTracks(t);
          return;
        }
        if (pid === 'bodian') {
          /* 波点库其实有 recommendations（发现页推荐歌单），匿名可用 */
          const d = await API.bodianRecommendations();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList(platFail(d, '波点没返回推荐歌单')); return; }
          hint(`波点 · 精选 · 推荐歌单 ${list.length} 个`);
          renderPlaylistRows(list, 'bodian', '精选');
          return;
        }
        if (pid === 'kuwo') {
          /* 酷我首页最招牌的是排行榜（bangMenu 匿名可读）；点一张走 rank/tracks */
          const d = await API.kuwoRanks();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList(platFail(d, '酷我没返回排行榜')); return; }
          hint(`酷我音乐 · 精选 · 排行榜 ${list.length} 个`);
          renderPlaylistRows(list, 'kuwo', '精选');
          return;
        }
        emptyList('Spotify 的推荐要你自己的 Client ID（还没配），本期只接了元数据搜索');
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /** 我的喜欢 */
    async function openLiked(pid) {
      const seq = ++platSeq;
      emptyList('正在载入…');
      try {
        if (pid === 'netease') {
          if (!profile || !profile.userId) { emptyList('先在设置里登录网易云，才能看「我的喜欢」'); return; }
          const d = await API.userPlaylists(profile.userId);
          if (!platAlive(seq)) return;
          const lists = (d && d.playlists) || [];
          const like = lists.find((p) => p.specialType === 5)
            || lists.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
          if (!like) { emptyList('没找到「我喜欢的音乐」歌单'); return; }
          await openPlatPlaylist(like, '我的喜欢', 'netease');
          return;
        }
        if (pid === 'qq') {
          const d = await API.qqLikedSongs(100);
          if (!platAlive(seq)) return;
          const t = (d && d.tracks) || [];
          if (!t.length) { emptyList((d && d.error) || 'QQ 音乐的「我喜欢」是空的'); return; }
          hint(`QQ 音乐 · 我的喜欢 · ${t.length} 首`);
          renderTracks(t);
          return;
        }
        if (pid === 'kugou') {
          emptyList('酷狗包里没有「我喜欢的音乐」列表接口（只有搜索、榜单、歌单）—— 不编内容');
          return;
        }
        if (pid === 'qishui') {
          /* 汽水的红心是账号歌单里 type=1 的那张，按歌单曲目取 */
          const d = await API.qishuiUserPlaylists();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          const like = list.find((p) => Number(p.type) === 1)
            || list.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
          if (!like) { emptyList(platFail(d, '没找到汽水的「我喜欢的音乐」歌单')); return; }
          await openPlatPlaylist(like, '我的喜欢', 'qishui');
          return;
        }
        if (pid === 'bodian') {
          const d = await API.bodianLikedSongs();
          if (!platAlive(seq)) return;
          const t = (d && d.tracks) || [];
          if (!t.length) { emptyList(platFail(d, '波点的「我喜欢」是空的')); return; }
          hint(`波点 · 我的喜欢 · ${t.length} 首`);
          renderTracks(t);
          return;
        }
        if (pid === 'kuwo') {
          /* www / wapi / mobile wapi 实测都没有用户曲库接口（404），不编内容 */
          emptyList('酷我 Web 没有「我喜欢的音乐」接口（搜索/歌单/榜单/直链是有的）—— 不编内容');
          return;
        }
        emptyList('Spotify 的「我喜欢的歌」要官方 OAuth 登录（且要追加 user-library-read 权限），本期不接');
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /** 网易云「我的歌单」分成两组：
         自己创建（subscribed !== true）和收藏（subscribed === true）。
         `/user/playlist` 两组是一起返回的，以前只取 subscribed，创建的歌单就全被丢了。
         「我喜欢的音乐」是系统歌单（specialType 5 / 同名），归「我的喜欢」入口，
         这里不再重复列；按 id 去重，防止上游把同一张歌单同时标进两组。 */
    function ncPlaylistGroups(lists) {
      const seen = new Set();
      const mine = [];
      const sub = [];
      for (const p of lists || []) {
        if (!p || !p.id) continue;
        const key = String(p.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (p.specialType === 5 || /我喜欢的音乐|喜欢的音乐/.test(p.name || '')) continue;
        (p.subscribed === true ? sub : mine).push(p);
      }
      return { mine, sub };
    }

    /** 收藏的歌单：网易云的自己创建 + 收藏都列出来，按组分段 */
    async function openMyPlaylists(pid) {
      const seq = ++platSeq;
      emptyList('正在载入…');
      try {
        if (pid === 'netease') {
          if (!profile || !profile.userId) { emptyList('先在设置里登录网易云，才能看「我收藏的歌单」'); return; }
          const d = await API.userPlaylists(profile.userId);
          if (!platAlive(seq)) return;
          const { mine, sub } = ncPlaylistGroups((d && d.playlists) || []);
          const use = mine.concat(sub);
          if (!use.length) { emptyList('你的网易云账号下还没有歌单'); return; }
          hint(`网易云 · 我创建的歌单 ${mine.length} 个 · 我收藏的歌单 ${sub.length} 个`);
          const headings = {};
          if (mine.length) headings[0] = '我创建的歌单';
          if (sub.length) headings[mine.length] = '我收藏的歌单';
          renderPlaylistRows(use, 'netease', '我收藏的歌单', (p) => openPlatPlaylist(
            p, p.subscribed === true ? '我收藏的歌单' : '我创建的歌单', 'netease'
          ), headings);
          return;
        }
        if (pid === 'qq') {
          const d = await API.qqUserPlaylists();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList((d && d.error) || 'QQ 音乐没有返回歌单'); return; }
          hint(`QQ 音乐 · 我的歌单 · ${list.length} 个`);
          renderPlaylistRows(list, 'qq', '我收藏的歌单');
          return;
        }
        if (pid === 'kugou') {
          const d = await API.kugouUserPlaylists();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList((d && d.error) || '酷狗没有返回歌单'); return; }
          hint(`酷狗 · 我的歌单 · ${list.length} 个`);
          renderPlaylistRows(list, 'kugou', '我收藏的歌单');
          return;
        }
        if (pid === 'qishui') {
          const d = await API.qishuiUserPlaylists();
          if (!platAlive(seq)) return;
          const list = ((d && d.playlists) || []).filter((p) => Number(p.type) !== 1);
          if (!list.length) { emptyList(platFail(d, '汽水没有返回歌单')); return; }
          hint(`汽水 · 我的歌单 · ${list.length} 个`);
          renderPlaylistRows(list, 'qishui', '我收藏的歌单');
          return;
        }
        if (pid === 'bodian') {
          const d = await API.bodianUserPlaylists();
          if (!platAlive(seq)) return;
          const list = (d && d.playlists) || [];
          if (!list.length) { emptyList(platFail(d, '波点没有返回歌单')); return; }
          hint(`波点 · 我的歌单 · ${list.length} 个`);
          renderPlaylistRows(list, 'bodian', '我收藏的歌单');
          return;
        }
        if (pid === 'kuwo') {
          /* 酷我 Web 没有用户歌单接口，粘贴 Cookie 也不解决；如实空态 */
          emptyList('酷我 Web 没有用户歌单接口（cookie 登录态只影响播放请求）—— 不编内容');
          return;
        }
        emptyList('Spotify 的歌单要官方 OAuth 登录（playlist-read-private 已在授权范围内），本期不接');
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /** 打开一张歌单：按平台取详情 → 用搜索列表那套行渲染 */
    async function openPlatPlaylist(p, label, pid) {
      const seq = ++platSeq;
      const src = pid || p.source || 'netease';
      const name = platNice(src);
      emptyList(`正在载入「${p.name || '歌单'}」…`);
      hint(`${name} · ${label} · ${p.name || ''}`);
      try {
        const d = src === 'kuwo'
          ? await (p.rank ? API.kuwoRankTracks(p.id, 50) : API.kuwoPlaylistTracks(p.id, 100))
          : src === 'qq' ? await API.qqPlaylistDetail(p.id)
            : src === 'kugou' ? await API.kugouPlaylistTracks(p.id)
              : src === 'qishui' ? await API.qishuiPlaylistTracks(p.id)
                : src === 'bodian' ? await API.bodianPlaylistTracks(p.id, 50, p.sourceType)
                  : await API.playlistDetail(p.id);
        if (!platAlive(seq)) return;
        const tr = (d && d.tracks) || [];
        if (!tr.length) { emptyList((d && d.error) || '这张歌单没有曲目'); return; }
        hint(`${name} · ${p.name || ''} · ${tr.length} 首`);
        renderTracks(tr);
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /** 歌单 / 电台列表（不是曲目）：复用 .track 那一套行，点一张展开它的曲目。
        onClick 可选：电台频道 / 场景不是歌单，点开走各自的取法。
        headings 可选：{ 索引: 标题 }，在对应行前插一条 .track-group 分组标题
        （和 renderTracks 用的是同一套样式）。 */
    function renderPlaylistRows(list, pid, label, onClick, headings) {
      el.tracks.innerHTML = '';
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => {
        if (headings && headings[i]) {
          const h = document.createElement('li');
          h.className = 'track-group';
          h.textContent = headings[i];
          frag.appendChild(h);
        }
        const li = document.createElement('li');
        li.className = 'track';
        li.style.cursor = 'pointer';
        li.innerHTML = `
          ${p.cover
            ? `<img class="track__cover" src="${API.img(p.cover, 400)}" alt="" loading="lazy" decoding="async">`
            : '<span class="track__cover track__cover--ph"></span>'}
          <span class="track__body">
            <span class="track__name"></span>
            <span class="track__sub"></span>
          </span>`;
        li.querySelector('.track__name').textContent = p.name || '未命名歌单';
        const sub = p.trackCount ? `${p.trackCount} 首`
          : p.playCount ? `${fmtNum(p.playCount)} 次播放` : '';
        li.querySelector('.track__sub').textContent = sub
          + (p.creator && p.creator.nickname ? (sub ? ' · ' : '') + p.creator.nickname : '');
        li.addEventListener('click', () => (
          onClick ? onClick(p) : openPlatPlaylist(p, label || '精选', pid || p.source || 'netease')
        ));
        frag.appendChild(li);
      });
      el.tracks.appendChild(frag);
    }

    /* ---------- 电台（2026-11-07）：每家能拿到什么就接什么 ----------
       网易云 /dj/recommend（频道）+ /dj/program（节目，匿名/登录都可）
       QQ     /radio/categories 匿名给频道目录；收听要登录
       酷狗   /fm/class 频道 + /fm/songs?fmid= 取歌，匿名可用
       汽水   /feed/modes 场景电台 + /feed?scene= 取歌，匿名可用
       波点   /personal/fm 私人 FM（曲目流），匿名可用
       Spotify 没有电台接口（本期只有元数据） */
    async function openRadio(pid) {
      const seq = ++platSeq;
      emptyList('正在载入…');
      try {
        if (pid === 'netease') {
          const d = await API.neteaseDjRecommend(8);
          if (!platAlive(seq)) return;
          const list = ((d && d.djRadios) || []).map((r) => ({
            id: String(r.id), name: r.name, cover: r.picUrl,
            trackCount: r.programCount || 0, playCount: r.playCount || 0,
            creator: { nickname: (r.dj && r.dj.nickname) || '' }, source: 'netease',
          })).filter((r) => r.id && r.name);
          if (!list.length) { emptyList('网易云没返回推荐电台'); return; }
          hint(`网易云 · 电台 · ${list.length} 个频道`);
          renderPlaylistRows(list, 'netease', '电台', openNeteaseRadio);
          return;
        }
        if (pid === 'qq') {
          const d = await API.qqRadioCategories();
          if (!platAlive(seq)) return;
          const list = (d && d.stations) || [];
          if (!list.length) { emptyList(platFail(d, 'QQ 音乐没返回电台频道')); return; }
          hint(`QQ 音乐 · 电台 · ${list.length} 个频道（收听要登录）`);
          renderPlaylistRows(list, 'qq', '电台', openQqRadio);
          return;
        }
        if (pid === 'kugou') {
          const d = await API.kugouRadioStations();
          if (!platAlive(seq)) return;
          const list = (d && d.stations) || [];
          if (!list.length) { emptyList(platFail(d, '酷狗没返回电台频道')); return; }
          hint(`酷狗 · 电台 · ${list.length} 个频道`);
          renderPlaylistRows(list, 'kugou', '电台', openKugouRadio);
          return;
        }
        if (pid === 'qishui') {
          const d = await API.qishuiFeedModes();
          if (!platAlive(seq)) return;
          const list = (d && d.stations) || [];
          if (!list.length) { emptyList(platFail(d, '汽水没返回场景电台')); return; }
          hint(`汽水 · 电台 · ${list.length} 个场景`);
          renderPlaylistRows(list, 'qishui', '电台', openQishuiScene);
          return;
        }
        if (pid === 'bodian') {
          const d = await API.bodianPersonalFm();
          if (!platAlive(seq)) return;
          const t = (d && d.tracks) || [];
          if (!t.length) { emptyList(platFail(d, '波点私人 FM 没返回歌曲')); return; }
          hint(`波点 · 电台 · 私人 FM ${t.length} 首`);
          renderTracks(t);
          return;
        }
        if (pid === 'kuwo') {
          /* radioList 只给栏目目录（albumList），没有「按栏目取单集曲目」的接口。
             宁可不列，也不拿目录冒充可播电台。 */
          emptyList('酷我只开放电台栏目目录，没有单集曲目接口，无法播放 —— 不拿目录冒充电台');
          return;
        }
        emptyList('Spotify 没有开放电台接口（本期只有元数据搜索）');
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /** 网易云电台节目：programs[].mainSong 才是可播放的曲目 */
    function ncProgramTrack(p) {
      const s = p.mainSong || {};
      const ar = s.artists || s.ar || [];
      const al = s.album || s.al || {};
      return {
        id: String(s.id || p.id || ''),
        source: 'netease',
        name: p.name || s.name || '',
        artists: ar.map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
        artistIds: ar.map((a) => String(a.id)).filter(Boolean),
        album: al.name || '',
        albumId: al.id ? String(al.id) : '',
        cover: p.coverUrl || al.picUrl || '',
        duration: Number(s.duration || s.dt) || 0,
        fee: Number(s.fee) || 0,
      };
    }

    async function openNeteaseRadio(p) {
      const seq = ++platSeq;
      emptyList(`正在载入「${p.name || '电台'}」…`);
      hint(`网易云 · 电台 · ${p.name || ''}`);
      try {
        const d = await API.neteaseDjPrograms(p.id, 50);
        if (!platAlive(seq)) return;
        const tr = ((d && d.programs) || []).map(ncProgramTrack).filter((t) => t.id && t.name);
        if (!tr.length) { emptyList('这个电台暂时没有节目'); return; }
        hint(`网易云 · ${p.name || '电台'} · ${tr.length} 期`);
        renderTracks(tr);
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    async function openQqRadio(p) {
      const seq = ++platSeq;
      emptyList(`正在载入「${p.name || '电台'}」…`);
      try {
        const d = await API.qqRadioTracks(p.id);
        if (!platAlive(seq)) return;
        const tr = (d && d.tracks) || [];
        if (!tr.length) { emptyList(platFail(d, '这个电台暂时没有曲目')); return; }
        hint(`QQ 音乐 · ${p.name || '电台'} · ${tr.length} 首`);
        renderTracks(tr);
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    async function openKugouRadio(p) {
      const seq = ++platSeq;
      emptyList(`正在载入「${p.name || '电台'}」…`);
      try {
        const d = await API.kugouRadioTracks(p.id, 30);
        if (!platAlive(seq)) return;
        const tr = (d && d.tracks) || [];
        if (!tr.length) { emptyList(platFail(d, '这个电台暂时没有曲目')); return; }
        hint(`酷狗 · ${p.name || '电台'} · ${tr.length} 首`);
        renderTracks(tr);
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    async function openQishuiScene(p) {
      const seq = ++platSeq;
      emptyList(`正在载入「${p.name || '场景'}」…`);
      try {
        const d = await API.qishuiFeed(50, p.id);
        if (!platAlive(seq)) return;
        const tr = (d && d.tracks) || [];
        if (!tr.length) { emptyList(platFail(d, '这个场景暂时没有曲目')); return; }
        hint(`汽水 · ${p.name || '场景'} · ${tr.length} 首`);
        renderTracks(tr);
      } catch (e) {
        if (!platAlive(seq)) return;
        emptyList('载入失败：' + ((e && e.message) || e));
      }
    }

    /* ---------- 中间：每日推荐跑马带（自己走 + 可拖 + 点一首就播） ----------
       2026-11-06：不再只接网易云 —— 每个平台取自己的「每日推荐 / 推荐流」：
         网易云 recommend/songs（登录后 30+ 首，匿名有兜底）
         酷狗   /everyday/recommend（匿名可用，30 首）
         汽水   /feed（匿名可用 20 首）
         QQ     /user/daily-songs（要登录；没登录就是空态）
         波点 / Spotify 没有这个接口 → 空态如实说
       拿到过就按平台缓存，换台回来秒出。 */
    let marqTracks = [];
    /* ---------- 大厅内容轨（2026-11-08）----------
       铺色态不再只有「每日推荐」：四张卡把跑马带切成层级内容。
       状态机：
         railPath  当前路径。根 = 每日推荐或某个来源（精选/我的喜欢/收藏夹/电台），
                   下钻一层 = 歌单 / 电台频道。路径就是面包屑。
         railShown 全量条目：曲目层是完整数组，歌单/频道/专辑层按 30 张截断。
         railCache key = `pid|kind|id`，存完整数组。
       歌单/频道/专辑层上限 30，超出时末尾加一张「还有更多」卡，点击走旧 browse 路径。
       曲目层 2026-11-08 起不再截断：先画首批，滚到接近末尾再把下一批追加进
       每一份 seg（见 marqAppendBatch），全部追加完就按全量无缝循环。
       2026-11-08：专辑层级已接（只做网易云）—— 「我收藏的歌单」这一层的跑马带
       末尾多一张「我的专辑」入口卡（data-albums），点进去 railPath 变成
       [收藏夹, 我的专辑]，跑马带换成收藏的专辑。点专辑卡直接开专辑详情页
       （Pages.openAlbum）：同一张专辑所有曲目共用一张封面，跑马带会变成一排
       重复图，用户明确不要。别再写成「大厅没有专辑入口」—— 这句是错的，
       2026-11-08 用户已纠正。 */
    let railShown = [];
    let railShownType = 'tracks';       // 'tracks' | 'collections' | 'albums'
    let railMore = false;
    let railNote = '';                  // 收藏夹为空时的说明（空态不整块顶掉「我的专辑」入口）
    let marqShownCount = 0;             // 曲目层每份 seg 已画到全量数组的哪个下标（分批追加用）
    let railPath = [];
    let marqSeq = 0;                    // 所有跑马带请求共用的序号：慢请求不许覆盖新层级
    /* 铺色态顶栏搜索（2026-11-08）：搜索激活期间跑马带画搜索结果，
       不再回到 railPath 的内容轨；清空后原样回到当前 railPath。 */
    let marqSearch = null;              // { pid, q, items, loading, error }
    let searchSeq = 0;                  // 旧关键词的请求不许覆盖新关键词
    let searchTimer = 0;                // 输入去抖 450ms
    const railCache = Object.create(null);
    const RAIL_MODE_KEY = 'lizi.hall.rail';   // '0' = 旧交互；缺省/'1' = 内容轨
    /* 'playlists' 的显示名和来源浮层里那项保持一致（面包屑根段会显示它） */
    const RAIL_SOURCE_NAME = { featured: '精选', liked: '我的喜欢', playlists: '我收藏的歌单', radio: '电台' };
    const RAIL_KIND = {
      pick: 'featured', like: 'liked', coll: 'playlists', radio: 'radio',
      /* railOpenMore 拿到的是路径根的 kind，不是卡片 id；两套键都放进来 */
      featured: 'featured', liked: 'liked', playlists: 'playlists',
    };
    const RAIL_STATION_MODE = {
      netease: 'neteaseRadio', qq: 'qqRadio', kugou: 'kugouRadio', qishui: 'qishuiScene',
    };
    const RAIL_COLL_CAP = 30;
    const MARQ_BATCH = 30;              // 曲目跑马带首批 / 每批追加的张数
    const MARQ_APPEND_AHEAD = 420;      // 视口右缘距第一份 seg 末尾还剩这么多像素时补下一批

    function railOn() {
      try { return localStorage.getItem(RAIL_MODE_KEY) !== '0'; } catch { return true; }
    }
    function railDailyNode() { return { kind: 'daily', name: '每日推荐' }; }
    function railReset() {
      railPath = [railDailyNode()];
      /* 换来源 / 退出内容轨 = 搜索作废，跑马带回到「每日推荐」 */
      clearMarqSearch(false);
    }
    if (!railPath.length) railReset();
    const railRootKind = () => (railPath[0] && railPath[0].kind) || 'daily';
    const railNode = () => railPath[railPath.length - 1] || railDailyNode();
    const railPlatName = () => (platRows.find((r) => r.id === platMode) || {}).name || platNice(platMode);

    const marqCache = Object.create(null);

    const MARQ_NOTE = {
      netease: '来自网易云「每日推荐」',
      qq: '登录后为 QQ 音乐「每日推荐」；现在显示匿名可用的「雷达推荐」',
      kugou: '来自酷狗「每日推荐」（匿名可用）',
      qishui: '来自汽水「推荐流」（匿名可用）',
      bodian: '来自波点「潮趣日推」（匿名可用）',
      spotify: 'Spotify 要 Client ID + 登录，本期不接',
      kuwo: '来自酷我「每日最新单曲推荐」（取不到时退热歌榜）',
    };

    function marqSource(pid) {
      if (pid === 'netease') return Promise.resolve(dailyTracks);
      if (pid === 'kugou') return API.kugouDaily().then((d) => (d && d.tracks) || []);
      if (pid === 'qishui') return API.qishuiFeed(20).then((d) => (d && d.tracks) || []);
      if (pid === 'qq') {
        /* 有登录态优先每日推荐；未登录（或每日推荐暂时取不到）退到匿名雷达推荐 */
        return API.qqDailySongs().then((d) => {
          const t = (d && d.tracks) || [];
          if (t.length) return t;
          return API.qqRecommendRadar(1).then((r) => (r && r.tracks) || []);
        });
      }
      if (pid === 'bodian') {
        return API.bodianDaily(0).then((d) => {
          if (!d) throw new Error('波点日推没有返回内容');
          if (Number(d.code) !== 200) {
            throw new Error(Number(d.code) === 404 ? '波点日推接口还没生效（重启 LIZI 后再试）' : (d.error || '波点日推失败'));
          }
          return (d.tracks) || [];
        });
      }
      if (pid === 'kuwo') {
        return API.kuwoDaily().then((d) => {
          if (!d) throw new Error('酷我每日推荐没有返回内容');
          if (Number(d.code) !== 200) {
            throw new Error(Number(d.code) === 404
              ? '酷我接口还没生效（重启 LIZI 后再试）'
              : (d.error || '酷我每日推荐失败'));
          }
          return (d.tracks) || [];
        });
      }
      return Promise.resolve([]);
    }

    /* ---------- 内容轨取数：只负责「请求 + 映射」，不碰 DOM ----------
       旧的四张卡（openFeatured 等）保持原样给 browse 用；这里按同样的接口和
       映射规则返回统一形状 { type:'tracks'|'collections', items, empty }。
       平台返回类型本来就不同，不能假设「精选一定是歌单」：
         网易云/QQ/波点 精选=歌单 · 酷狗/汽水 精选=曲目 · 酷我 精选=排行榜（歌单）
         我的喜欢/收藏：部分平台没有接口 → 返回空态文案，不编内容。
         电台：网易云/QQ/酷狗/汽水=频道列表，波点=曲目。 */
    function railTracks(pid, arr, emptyNote) {
      const items = (arr || []).filter((t) => t && t.id && t.name)
        .map((t) => (t.source ? t : { ...t, source: pid }));
      return { type: 'tracks', items, empty: items.length ? '' : (emptyNote || '这一层没有歌曲') };
    }
    function railColls(pid, arr, emptyNote) {
      const items = (arr || []).filter((p) => p && p.id && p.name)
        .map((p) => (p.source ? p : { ...p, source: pid }));
      return { type: 'collections', items, empty: items.length ? '' : (emptyNote || '这一层没有歌单') };
    }
    const railNone = (note) => ({ type: 'tracks', items: [], empty: note });

    async function railFeatured(pid) {
      if (pid === 'netease') {
        const d = await API.topPlaylists(12);
        const list = ((d && d.playlists) || []).map((p) => ({
          id: String(p.id), name: p.name, cover: p.cover,
          trackCount: p.tracks || 0, playCount: p.count || 0,
          creator: { nickname: p.creator || '' }, source: 'netease',
        }));
        return railColls('netease', list, '网易云没返回推荐歌单');
      }
      if (pid === 'qq') {
        const d = await API.qqRecommendPlaylists(9);
        return railColls('qq', (d && d.playlists) || [], (d && d.error) || 'QQ 音乐没返回推荐歌单');
      }
      if (pid === 'kugou') {
        const d = await API.kugouTopSongs(1);
        return railTracks('kugou', (d && d.tracks) || [], (d && d.error) || '酷狗没返回新歌');
      }
      if (pid === 'qishui') {
        const d = await API.qishuiFeed(20);
        return railTracks('qishui', (d && d.tracks) || [], (d && d.error) || '汽水没返回推荐流');
      }
      if (pid === 'bodian') {
        const d = await API.bodianRecommendations();
        return railColls('bodian', (d && d.playlists) || [], platFail(d, '波点没返回推荐歌单'));
      }
      if (pid === 'kuwo') {
        const d = await API.kuwoRanks();
        return railColls('kuwo', (d && d.playlists) || [], platFail(d, '酷我没返回排行榜'));
      }
      return railNone('Spotify 的推荐要你自己的 Client ID（还没配），本期只接了元数据搜索');
    }

    async function railLiked(pid) {
      if (pid === 'netease') {
        if (!profile || !profile.userId) return railNone('先在设置里登录网易云，才能看「我的喜欢」');
        const d = await API.userPlaylists(profile.userId);
        const lists = (d && d.playlists) || [];
        const like = lists.find((p) => p.specialType === 5)
          || lists.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
        if (!like) return railNone('没找到「我喜欢的音乐」歌单');
        const t = await API.playlistDetail(like.id);
        return railTracks('netease', (t && t.tracks) || [], (t && t.error) || '这张歌单没有曲目');
      }
      if (pid === 'qq') {
        const d = await API.qqLikedSongs(100);
        return railTracks('qq', (d && d.tracks) || [], (d && d.error) || 'QQ 音乐的「我喜欢」是空的');
      }
      if (pid === 'kugou') {
        return railNone('酷狗包里没有「我喜欢的音乐」列表接口（只有搜索、榜单、歌单）—— 不编内容');
      }
      if (pid === 'qishui') {
        const d = await API.qishuiUserPlaylists();
        const list = (d && d.playlists) || [];
        const like = list.find((p) => Number(p.type) === 1)
          || list.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
        if (!like) return railNone(platFail(d, '没找到汽水的「我喜欢的音乐」歌单'));
        const t = await API.qishuiPlaylistTracks(like.id, 50);
        return railTracks('qishui', (t && t.tracks) || [], (t && t.error) || '这张歌单没有曲目');
      }
      if (pid === 'bodian') {
        const d = await API.bodianLikedSongs();
        return railTracks('bodian', (d && d.tracks) || [], platFail(d, '波点的「我喜欢」是空的'));
      }
      if (pid === 'kuwo') {
        return railNone('酷我 Web 没有「我喜欢的音乐」接口（搜索/歌单/榜单/直链是有的）—— 不编内容');
      }
      return railNone('Spotify 的「我喜欢的歌」要官方 OAuth 登录（且要追加 user-library-read 权限），本期不接');
    }

    async function railMyPlaylists(pid) {
      if (pid === 'netease') {
        if (!profile || !profile.userId) return railNone('先在设置里登录网易云，才能看「我收藏的歌单」');
        const d = await API.userPlaylists(profile.userId);
        const { mine, sub } = ncPlaylistGroups((d && d.playlists) || []);
        if (!mine.length && !sub.length) return railNone('还没有收藏或创建任何歌单');
        /* 自己创建的歌单放前面，收藏的放后面；两组都有时各插一张分组卡
           （marqCardHtml 认 _group，不挂 data-coll，点了不响应）。
           「我创建的歌单」即使只有一组也插，免得它藏在一个叫「收藏的歌单」的层里。 */
        const items = [];
        const sep = (name, id) => ({ id, name, _group: true });
        if (mine.length) items.push(sep('我创建的歌单', 'group:mine'));
        items.push(...mine);
        if (mine.length && sub.length) items.push(sep('我收藏的歌单', 'group:sub'));
        items.push(...sub);
        return railColls('netease', items, '还没有收藏或创建任何歌单');
      }
      if (pid === 'qq') {
        const d = await API.qqUserPlaylists();
        return railColls('qq', (d && d.playlists) || [], (d && d.error) || 'QQ 音乐没有返回歌单');
      }
      if (pid === 'kugou') {
        const d = await API.kugouUserPlaylists();
        return railColls('kugou', (d && d.playlists) || [], (d && d.error) || '酷狗没有返回歌单');
      }
      if (pid === 'qishui') {
        const d = await API.qishuiUserPlaylists();
        const list = ((d && d.playlists) || []).filter((p) => Number(p.type) !== 1);
        return railColls('qishui', list, platFail(d, '汽水没有返回歌单'));
      }
      if (pid === 'bodian') {
        const d = await API.bodianUserPlaylists();
        return railColls('bodian', (d && d.playlists) || [], platFail(d, '波点没有返回歌单'));
      }
      if (pid === 'kuwo') {
        return railNone('酷我 Web 没有用户歌单接口（cookie 登录态只影响播放请求）—— 不编内容');
      }
      return railNone('Spotify 的歌单要官方 OAuth 登录（playlist-read-private 已在授权范围内），本期不接');
    }

    /** 收藏专辑（「我的专辑」层）：只做网易云；其他平台入口本身不画，这里也照实说 */
    async function railMyAlbums(pid) {
      if (pid !== 'netease') return railNone('「我的专辑」目前只接了网易云');
      if (!profile || !profile.userId) return railNone('先在设置里登录网易云，才能看「我的专辑」');
      const d = await API.neteaseAlbumSublist(100, 0);
      const list = ((d && d.data) || []).map((a) => ({
        id: String(a.id),
        name: a.name || '未知专辑',
        cover: a.picUrl || '',
        artists: Array.isArray(a.artists)
          ? a.artists.map((x) => x.name).filter(Boolean).join(' / ')
          : String(a.artists || ''),
        trackCount: Number(a.size) || 0,
        source: 'netease',
      })).filter((a) => a.id && a.name);
      return {
        type: 'albums',
        items: list,
        empty: list.length ? '' : ((d && (d.error || d.message)) || '还没有收藏任何专辑'),
      };
    }

    async function railRadio(pid) {
      if (pid === 'netease') {
        const d = await API.neteaseDjRecommend(8);
        const list = ((d && d.djRadios) || []).map((r) => ({
          id: String(r.id), name: r.name, cover: r.picUrl,
          trackCount: r.programCount || 0, playCount: r.playCount || 0,
          creator: { nickname: (r.dj && r.dj.nickname) || '' }, source: 'netease',
        }));
        return railColls('netease', list, '网易云没返回推荐电台');
      }
      if (pid === 'qq') {
        const d = await API.qqRadioCategories();
        return railColls('qq', (d && d.stations) || [], platFail(d, 'QQ 音乐没返回电台频道'));
      }
      if (pid === 'kugou') {
        const d = await API.kugouRadioStations();
        return railColls('kugou', (d && d.stations) || [], platFail(d, '酷狗没返回电台频道'));
      }
      if (pid === 'qishui') {
        const d = await API.qishuiFeedModes();
        return railColls('qishui', (d && d.stations) || [], platFail(d, '汽水没返回场景电台'));
      }
      if (pid === 'bodian') {
        const d = await API.bodianPersonalFm();
        return railTracks('bodian', (d && d.tracks) || [], platFail(d, '波点私人 FM 没返回歌曲'));
      }
      if (pid === 'kuwo') {
        return railNone('酷我只开放电台栏目目录，没有单集曲目接口，无法播放 —— 不拿目录冒充电台');
      }
      return railNone('Spotify 没有开放电台接口（本期只有元数据搜索）');
    }

    /** 歌单曲目：和 browse 的 openPlatPlaylist 同一套入参（酷我榜单看 p.rank） */
    function railPlaylistApi(pid, p) {
      const src = pid || p.source || 'netease';
      return src === 'kuwo'
        ? (p.rank ? API.kuwoRankTracks(p.id, 50) : API.kuwoPlaylistTracks(p.id, 100))
        : src === 'qq' ? API.qqPlaylistDetail(p.id)
          : src === 'kugou' ? API.kugouPlaylistTracks(p.id)
            : src === 'qishui' ? API.qishuiPlaylistTracks(p.id)
              : src === 'bodian' ? API.bodianPlaylistTracks(p.id, 50, p.sourceType)
                : API.playlistDetail(p.id);
    }

    async function railPlaylistTracks(pid, node) {
      const d = await railPlaylistApi(node.src || pid, node.p || {});
      return railTracks(pid, (d && d.tracks) || [], (d && d.error) || '这张歌单没有曲目');
    }

    async function railStationTracks(pid, node) {
      if (node.mode === 'neteaseRadio') {
        const d = await API.neteaseDjPrograms(node.id, 50);
        const tr = ((d && d.programs) || []).map(ncProgramTrack).filter((t) => t.id && t.name);
        return railTracks('netease', tr, '这个电台暂时没有节目');
      }
      if (node.mode === 'qqRadio') {
        const d = await API.qqRadioTracks(node.id);
        return railTracks('qq', (d && d.tracks) || [], platFail(d, '这个电台暂时没有曲目'));
      }
      if (node.mode === 'kugouRadio') {
        const d = await API.kugouRadioTracks(node.id, 30);
        return railTracks('kugou', (d && d.tracks) || [], platFail(d, '这个电台暂时没有曲目'));
      }
      if (node.mode === 'qishuiScene') {
        const d = await API.qishuiFeed(50, node.id);
        return railTracks('qishui', (d && d.tracks) || [], platFail(d, '这个场景暂时没有曲目'));
      }
      return railNone('这个频道暂时没有曲目');
    }

    function railFetch(pid, node) {
      if (node.kind === 'featured') return railFeatured(pid);
      if (node.kind === 'liked') return railLiked(pid);
      if (node.kind === 'playlists') return railMyPlaylists(pid);
      if (node.kind === 'albums') return railMyAlbums(pid);
      if (node.kind === 'radio') return railRadio(pid);
      if (node.kind === 'playlist') return railPlaylistTracks(pid, node);
      if (node.kind === 'station') return railStationTracks(pid, node);
      return Promise.resolve(railNone('未知的内容层级'));
    }

    /** 点歌单/频道卡：下钻，不动播放队列；等用户点歌曲才换队列 */
    function railDrill(i) {
      const p = railShown[i];
      if (!p || !platMode) return;
      const kind = railRootKind() === 'radio' ? 'station' : 'playlist';
      const node = {
        kind, name: p.name || (kind === 'station' ? '电台' : '歌单'),
        id: String(p.id), src: platMode, p,
      };
      if (kind === 'station') node.mode = RAIL_STATION_MODE[platMode] || 'neteaseRadio';
      railPath = [railPath[0], node];
      marqSeq++;
      paintPlatBar();
      renderMarq();
    }

    /** 点四张卡：在跑马带里切来源，不离开大厅 */
    function railGoSource(kind) {
      clearMarqSearch(false);           // 切来源 = 退出搜索，回到这一层
      railPath = [{ kind, name: RAIL_SOURCE_NAME[kind] || kind }];
      marqSeq++;
      paintPlatBar();
      renderMarq();
    }

    /** 收藏夹末尾的「我的专辑」入口：切到 albums 层（面包屑 = 收藏夹 / 我的专辑） */
    function railEnterAlbums() {
      if (!railPath.length) railReset();
      if ((railPath[0] && railPath[0].kind) !== 'playlists') return;
      railPath = [railPath[0], { kind: 'albums', name: '我的专辑' }];
      marqSeq++;
      paintPlatBar();
      renderMarq();
    }

    /** 超出上限的「还有更多」：回到旧 browse 路径（不改变旧模式本身） */
    function railOpenMore() {
      const pid = platMode;
      const node = railNode();
      const root = railPath[0];
      if (!pid || !root) return;
      /* 专辑层优先：直接打开「我的专辑」页，不能落到 RAIL_KIND 走旧 browse */
      if (node.kind === 'albums') { Pages.openMyAlbums(); return; }
      if (node.kind === 'playlist' || node.kind === 'station') {
        searchSource = pid;
        try { localStorage.setItem('lizi.searchSource', searchSource); } catch { /* ignore */ }
        paintSource();
        show('browse');
        hint(`${platNice(pid)} · ${node.name || ''}`);
        if (node.kind === 'playlist') {
          openPlatPlaylist(node.p, root.kind === 'playlists' ? '我收藏的歌单' : '精选', pid);
        } else if (node.mode === 'qqRadio') openQqRadio(node.p);
        else if (node.mode === 'kugouRadio') openKugouRadio(node.p);
        else if (node.mode === 'qishuiScene') openQishuiScene(node.p);
        else openNeteaseRadio(node.p);
        return;
      }
      if (RAIL_KIND[root.kind]) openPlatCard(pid, RAIL_KIND[root.kind]);
    }

    /** 单张卡 HTML（i = 全量数组下标）。首批和后续批次都走这里，
        data-i / data-malb / data-coll 始终指向 railShown 里的完整位置。 */
    function marqCardHtml(t, i) {
      /* 歌单分组卡：不是歌单，没有 data-coll，点了不响应，只做「我创建 / 我收藏」分隔 */
      if (t._group) {
        return `
          <div class="marq__card marq__card--group" role="separator" aria-label="${esc(t.name)}">
            <span class="marq__art marq__art--more"><span>${esc(t.name)}</span></span>
          </div>`;
      }
      /* 专辑卡：封面 + 专辑名 + 艺人；点击直接开专辑详情页，不下钻曲目 */
      if (railShownType === 'albums') {
        const sub = t.trackCount ? `${t.trackCount} 首` : '';
        return `
          <button class="marq__card marq__card--coll" data-malb="${i}"
            title="${esc(t.name)}${t.artists ? ' · ' + esc(t.artists) : ''}">
            <span class="marq__art">${t.cover
              ? `<img src="${API.img(t.cover, 320)}" alt="" loading="lazy" decoding="async" draggable="false">`
              : ''}<span class="marq__tag">专辑</span></span>
            <b>${esc(t.name)}</b>
            <em>${esc([t.artists, sub].filter(Boolean).join(' · '))}</em>
          </button>`;
      }
      if (railShownType === 'collections') {
        const tag = railRootKind() === 'radio' ? '电台' : '歌单';
        const sub = t.trackCount ? `${t.trackCount} 首`
          : t.playCount ? `${fmtNum(t.playCount)} 次` : '';
        const by = t.creator && t.creator.nickname ? t.creator.nickname : '';
        return `
          <button class="marq__card marq__card--coll" data-coll="${i}"
            title="${esc(t.name)}${by ? ' · ' + esc(by) : ''}">
            <span class="marq__art">${t.cover
              ? `<img src="${API.img(t.cover, 320)}" alt="" loading="lazy" decoding="async" draggable="false">`
              : ''}<span class="marq__tag">${tag}</span></span>
            <b>${esc(t.name)}</b>
            <em>${esc([sub, by].filter(Boolean).join(' · '))}</em>
          </button>`;
      }
      /* 曲目卡 = 原来「本日推荐」那张（封面 + 歌名 + 歌手），自己往左走。 */
      return `
        <button class="marq__card" data-i="${i}" title="${esc(t.name)}${t.artists ? ' · ' + esc(t.artists) : ''}">
          <span class="marq__art">${t.cover
            ? `<img src="${API.img(t.cover, 320)}" alt="" loading="lazy" decoding="async" draggable="false">`
            : ''}</span>
          <b>${esc(t.name)}</b>
          <em>${esc(t.artists || '')}</em>
        </button>`;
    }

    function marqItemsHtml() {
      /* 歌单/频道卡换了新卡型：多一个「歌单」「电台」小签，点进去是下钻不是播放。 */
      /* 收藏夹为空：用一张说明卡代替整块空态，末尾的「我的专辑」入口卡才不会被吞掉 */
      const emptyCard = (!railShown.length && railNote) ? `
        <div class="marq__card marq__card--more" title="${esc(railNote)}">
          <span class="marq__art marq__art--more"><span>暂无</span></span>
          <b>${esc(railNote)}</b>
        </div>` : '';
      /* 只画当前已分批渲染的前 marqShownCount 张；后面的批次由 marqAppendBatch 追加 */
      const cards = railShown.slice(0, marqShownCount).map(marqCardHtml).join('');
      /* 专辑层点「更多」是去「我的专辑」页，不是旧 browse */
      const albumsLayer = railNode().kind === 'albums';
      const moreTitle = albumsLayer ? '去我的专辑看全部' : '去浏览页看全部';
      const more = railMore ? `
        <button class="marq__card marq__card--more" data-more="1" title="${moreTitle}">
          <span class="marq__art marq__art--more"><span>还有更多</span></span>
          <b>${moreTitle}</b>
          <em>跑马带只放前 ${RAIL_COLL_CAP} 个</em>
        </button>` : '';
      /* 「我收藏的歌单」层末尾追加「我的专辑」入口卡（只网易云）。
         搜索结果是曲目列表，不挂这张层入口卡。
         属性用 data-albums，不会被全局捕获阶段的 [data-alb] 处理器抢走。 */
      const searchOn = !!(marqSearch && marqSearch.pid === platMode && marqSearch.q);
      const albumsEntry = (!searchOn && platMode === 'netease'
        && railRootKind() === 'playlists' && railNode().kind === 'playlists') ? `
        <button class="marq__card marq__card--more" data-albums="1" title="我的专辑">
          <span class="marq__art marq__art--more"><span>专辑</span></span>
          <b>我的专辑</b>
          <em>收藏的专辑</em>
        </button>` : '';
      return emptyCard + cards + more + albumsEntry;
    }

    function marqEmptyHtml(platName, note, title) {
      return `<div class="marq__seg"><span class="marq__empty">
        <b>${esc(title || (platName + ' · 暂无每日推荐'))}</b>
        <span class="marq__note">${esc(note)}</span>
      </span></div>`;
    }

    function renderMarq() {
      const pid = platMode;
      const platName = railPlatName();
      marqStop();
      marqDrag = null;
      /* 工具箱 / 形态长廊页签开着时，重画完也别把跑马带又开起来 */
      marqPaused = srailSidePane();
      marqX = 0;
      marqMoved = false;
      marqTracks = [];
      railShown = [];
      marqShownCount = 0;
      railMore = false;
      railShownType = 'tracks';
      railNote = '';
      const seq = ++marqSeq;
      if (!pid) return;

      /* 顶栏搜索激活中：跑马带只画搜索结果，账号刷新等重画也不能吞回来源 */
      if (marqSearch && marqSearch.pid === pid) {
        const q = marqSearch.q;
        H.marq.setAttribute('aria-label', `搜索「${q}」`);
        if (marqSearch.loading) {
          H.marq.classList.add('is-empty');
          H.marq.innerHTML = marqEmptyHtml(platName, '正在搜索…', `正在搜索「${q}」`);
          return;
        }
        if (marqSearch.error) {
          H.marq.classList.add('is-empty');
          H.marq.innerHTML = marqEmptyHtml(platName, '搜索失败：' + marqSearch.error, `搜索「${q}」`);
          return;
        }
        if (marqSearch.items && marqSearch.items.length) {
          paintMarq(marqSearch.items, 'tracks', false);
          return;
        }
        H.marq.classList.add('is-empty');
        H.marq.innerHTML = marqEmptyHtml(platName, '没有找到相关歌曲', `搜索「${q}」`);
        return;
      }

      /* 旧模式永远回到每日推荐；内容轨则按当前路径画 */
      if (!railOn()) railReset();
      if (!railPath.length) railReset();
      const node = railNode();
      H.marq.setAttribute('aria-label', node.name || '每日推荐');

      if (node.kind === 'daily') { renderDailyMarq(pid, platName, seq); return; }
      renderRailNode(pid, node, platName, seq);
    }

    /** 根层「每日推荐」：沿用 marqCache / dailyTracks / marqSource */
    function renderDailyMarq(pid, platName, seq) {
      const cached = marqCache[pid];
      if (cached && cached.length) { paintMarq(cached, 'tracks', false); return; }
      if (pid === 'netease' && dailyTracks.length) {
        marqCache.netease = dailyTracks;
        paintMarq(dailyTracks, 'tracks', false);
        return;
      }

      /* 没缓存：先给一句「正在取」，拿到再填（失败就退成空态，原因写在第二行） */
      H.marq.classList.add('is-empty');
      H.marq.innerHTML = `<div class="marq__seg"><span class="marq__empty">
        <b>${esc(platName)} · 正在取每日推荐…</b>
        <span class="marq__note">${esc(MARQ_NOTE[pid] || '')}</span>
      </span></div>`;
      marqHalf = 0;

      marqSource(pid).then((tracks) => {
        if (platMode !== pid || seq !== marqSeq) return;   // 期间换台/退出/下钻：不再动 DOM
        marqCache[pid] = tracks || [];
        if (!tracks || !tracks.length) {
          H.marq.classList.add('is-empty');
          H.marq.innerHTML = marqEmptyHtml(platName, MARQ_NOTE[pid] || '这个平台没有开放每日推荐');
          return;
        }
        paintMarq(tracks, 'tracks', false);
      }).catch((e) => {
        if (platMode !== pid || seq !== marqSeq) return;
        H.marq.classList.add('is-empty');
        const why = (e && e.message) ? String(e.message) : '';
        H.marq.innerHTML = marqEmptyHtml(platName, why ? '取推荐失败：' + why : '取推荐失败，稍后再试');
      });
    }

    function railCacheKey(pid, node) { return `${pid}|${node.kind}|${node.id || ''}`; }

    function renderRailNode(pid, node, platName, seq) {
      const key = railCacheKey(pid, node);
      const hit = railCache[key];
      if (hit) { paintRailResult(hit, node); return; }

      H.marq.classList.add('is-empty');
      H.marq.innerHTML = marqEmptyHtml(platName, '正在取这一层的内容…', `${node.name} · 正在载入…`);
      marqHalf = 0;

      railFetch(pid, node).then((res) => {
        if (platMode !== pid || seq !== marqSeq) return;
        railCache[key] = res;               // 缓存完整数组；歌单层渲染按上限截断，曲目层分批画
        paintRailResult(res, node);
      }).catch((e) => {
        if (platMode !== pid || seq !== marqSeq) return;
        H.marq.classList.add('is-empty');
        const why = (e && e.message) ? String(e.message) : '';
        H.marq.innerHTML = marqEmptyHtml(platName,
          why ? '载入失败：' + why : '载入失败，稍后再试', `${node.name} · 暂无内容`);
      });
    }

    function paintRailResult(res, node) {
      /* 曲目层不再按 60 截断：全量交给 marqTracks / railShown，跑马带先画首批，
         滚到接近末尾再分批追加。歌单/频道/专辑层仍保持 30 张 +「还有更多」。 */
      const isColl = (res.type === 'collections' || res.type === 'albums');
      const all = res.items || [];
      const shown = isColl ? all.slice(0, RAIL_COLL_CAP) : all;
      if (!shown.length) {
        /* 收藏夹为空（还没收藏 / 没登录）时保留说明 + 「我的专辑」入口卡，
           不能直接走空态 return 把入口吞掉。 */
        if (node.kind === 'playlists' && platMode === 'netease') {
          paintMarq([], 'collections', false, res.empty || '还没有收藏任何歌单');
          return;
        }
        H.marq.classList.add('is-empty');
        H.marq.innerHTML = marqEmptyHtml(railPlatName(), res.empty || '这一层没有内容',
          `${node.name} · 暂无内容`);
        marqHalf = 0;
        return;
      }
      /* 每日推荐没有对应的 browse 入口，不挂「更多」卡 */
      const more = isColl && (all.length > RAIL_COLL_CAP) && node.kind !== 'daily';
      paintMarq(shown, res.type, more);
    }

    function paintMarq(items, type, more, note) {
      marqTracks = type === 'tracks' ? items : [];
      railShown = items;
      railShownType = type || 'tracks';
      railMore = !!more;
      railNote = note || '';
      /* 曲目层分批：先只画 MARQ_BATCH 张，滚到接近末尾再追加（见 marqAppendBatch）。
         每日推荐保持原样一次画全量；歌单/专辑层本来最多 30 张，也一次画完。 */
      marqShownCount = (railShownType === 'tracks' && railNode().kind !== 'daily')
        ? Math.min(railShown.length, MARQ_BATCH)
        : railShown.length;
      marqSeek = null;                       // 卡片集重画，旧的对齐缓动作废
      marqX = 0;
      marqHalf = 0;                          // 新内容等 marqMeasure 重新量，别拿上一层的宽度回卷/补批
      H.marq.classList.remove('is-empty');
      const seg = `<div class="marq__seg">${marqItemsHtml()}</div>`;
      H.marq.innerHTML = `<div class="hall-marq__track">${seg}${seg}</div>`;
      requestAnimationFrame(marqMeasure);
    }

    function marqMeasure() {
      const track = H.marq.firstElementChild;
      /* 空态 / 载入态的外层不是 .hall-marq__track：不要去量，更不能往里补份 */
      if (!track || !track.classList.contains('hall-marq__track') || !track.firstElementChild) {
        marqHalf = 0;
        return;
      }
      const seg = track.firstElementChild;
      const segW = seg.offsetWidth;
      if (!segW) { marqHalf = 0; return; }
      /* 歌少（兜底的 3 首 / 收藏夹只有几个歌单）时补几份，至少铺满一屏，循环才不露白。
         旧写法量的是 seg.offsetWidth（不变），会一口气补满 guard；改成量整条 track 的
         实际宽度，补到「视口宽 + 一份回卷距离」即可，歌少时不要重复太多份。 */
      let guard = 0;
      while (track.offsetWidth < H.marq.clientWidth + segW && guard++ < 24) {
        track.insertAdjacentHTML('beforeend', seg.outerHTML);
      }
      marqHalf = segW;
      marqWrap();
      track.style.transform = `translate3d(${marqX}px,0,0)`;
      marqStart();
    }

    /** 第一份 seg 的实际宽度（回卷周期）；拿不到返回 0 */
    function marqSegWidth() {
      const track = H.marq.firstElementChild;
      const seg = track && track.firstElementChild;
      return (seg && seg.classList.contains('marq__seg')) ? seg.offsetWidth : 0;
    }

    /** 把 marqX 规整到 [-marqHalf, 0)，负到多少就回到另一份的同一位置 */
    function marqWrap() {
      if (!marqHalf) marqHalf = marqSegWidth();
      if (!marqHalf) return;               // 还没量到宽度：别把拖动清零，等测量完成后自然接上
      let m = -marqX % marqHalf;
      if (m < 0) m += marqHalf;
      marqX = -m;
    }

    /**
     * 曲目层分批追加：把下一批 MARQ_BATCH 张同时写进每一份 .marq__seg 的末尾。
     * 只在「视口右缘还没越过第一份 seg 末尾」时调用（见 marqMaybeAppend），
     * 这时 seg 变长、后面的复制份整体右移都发生在视口外，当前可见卡片不会跳。
     * 追加后 marqX 保持不动，只把 marqHalf 换成第一份 seg 的新宽度（回卷点随之后移）；
     * 全部追加完就停在原地，之后按全量内容无缝循环。
     * 注意：不做卡片回收，DOM 只增不减 —— 上千首滚完时轨道里会有全量卡片。
     */
    function marqAppendBatch() {
      if (railShownType !== 'tracks') return;
      if (marqShownCount >= railShown.length) return;
      if (!marqShownCount) return;         // 首批还没画（空态/未渲染），不插
      const track = H.marq.firstElementChild;
      if (!track) return;
      const segs = track.querySelectorAll('.marq__seg');
      if (!segs.length) return;
      const start = marqShownCount;
      const end = Math.min(start + MARQ_BATCH, railShown.length);
      let html = '';
      for (let i = start; i < end; i++) html += marqCardHtml(railShown[i], i);
      if (!html) return;
      /* 每一份 seg 都追加同一批：它们必须保持完全一致，回卷接缝才对得上 */
      for (let i = 0; i < segs.length; i++) segs[i].insertAdjacentHTML('beforeend', html);
      marqShownCount = end;
      const w = marqSegWidth();
      if (w) marqHalf = w;
    }

    /** 自动滚动 / 拖拽时检查：快走到已渲染末尾就补下一批。 */
    function marqMaybeAppend() {
      if (railShownType !== 'tracks') return;
      if (marqShownCount >= railShown.length) return;
      if (!marqHalf) return;
      const view = H.marq.clientWidth;
      const right = -marqX + view;         // 视口右缘在轨道里的位置
      /* 视口跨过接缝（right > marqHalf）时不能补：复制份整体右移会被看见。
         安全区在 [0, marqHalf]；至少提前一屏（且不小于 MARQ_APPEND_AHEAD）补，
         这样快速拖动 / 掉帧时也不容易错过这一窗口。 */
      if (right > marqHalf && marqHalf > view) return;
      if (marqHalf - right > Math.max(MARQ_APPEND_AHEAD, view)) return;
      marqAppendBatch();
    }

    /**
     * 开环前把当前来源的分批一次性补齐。
     * 环形组件的 uniqueCards() 只从 DOM 收集卡片：曲目层如果还停在首批
     * MARQ_BATCH 张，环里再虚拟化也只能在这 30 张里循环。这里复用
     * marqShownCount 游标，循环调用 marqAppendBatch() 直到全量；
     * 不另建状态，追加的卡片仍保持 loading="lazy"，只有进环的克隆由
     * prepareCloneImages() 接管。
     * 补的时候环还没展开，后面的跑马带变宽用户看不见；收起时
     * __liziMarqueeSeek 会按新的 marqHalf 对齐。
     * 循环次数由剩余张数算出，只多留 2 次防死循环；没有人为截断，
     * 398 首会补到 398 张，不会停在 30。
     */
    window.__liziMarqueeFillAll = () => {
      if (railShownType !== 'tracks') return marqShownCount;
      let guard = Math.ceil(Math.max(0, railShown.length - marqShownCount) / MARQ_BATCH) + 2;
      while (marqShownCount < railShown.length && guard-- > 0) {
        const before = marqShownCount;
        marqAppendBatch();
        if (marqShownCount === before) break;   // 空态 / 首批还没画：别死循环
      }
      const w = marqSegWidth();
      if (w) marqHalf = w;
      return marqShownCount;
    };

    /**
     * 2026-11-09：环形开环不再在拖动首帧同步补满（398 首会卡一下）。
     * 这两个入口给 hall/circular-carousel.js 做逐帧预填：
     *   __liziMarqueeFillStep()  → 只补一批（MARQ_BATCH 张），调用方放在 rAF 里；
     *   __liziMarqueeFillState() → { shown, total }，调用方据此决定还补不补。
     * 复用 marqShownCount 游标，没有新增状态；marqAppendBatch 自己会更新 marqHalf。
     */
    window.__liziMarqueeFillStep = () => {
      marqAppendBatch();
      return marqShownCount;
    };
    window.__liziMarqueeFillState = () => ({
      shown: marqShownCount,
      total: railShownType === 'tracks' ? railShown.length : marqShownCount,
    });

    /**
     * 大厅环形推荐收起时调用的对齐入口：在跑马带自己的 rAF 里缓动改 marqX。
     * dataI 要滚到目标位置的卡片 key（"i:5" / "coll:3" / "malb:2"，
     * 也兼容裸数字/数字字符串的老 data-i 行为）；viewportX 目标屏幕 x
     * （不传则用跑马带视口中心）；opts.dur 可选毫秒（按住 380–480，默认 460）。
     * 同一张卡每隔 marqHalf 复制一份，delta 取 ±marqHalf/2 内最近的一份，避免整圈跳。
     * 缓动期间不叠加自动滚动；结束后 marqX 已在 [-marqHalf, 0) 内，按原速度继续。
     */
    window.__liziMarqueeSeek = (dataI, viewportX, opts) => {
      if (!platMode || !marqHalf || !H.marq || H.marq.classList.contains('is-empty')) return false;
      const want = String(dataI);
      const cut = want.indexOf(':');
      const kind = cut >= 0 ? want.slice(0, cut) : 'i';
      const val = cut >= 0 ? want.slice(cut + 1) : want;
      const attr = kind === 'i' ? 'data-i' : kind === 'coll' ? 'data-coll' : kind === 'malb' ? 'data-malb' : null;
      if (!attr) return false;
      const all = H.marq.querySelectorAll(`.marq__card[${attr}]`);
      let card = null;
      for (let i = 0; i < all.length; i++) {
        if (all[i].dataset[kind] === val) { card = all[i]; break; }
      }
      if (!card) return false;

      const cr = card.getBoundingClientRect();
      if (!cr.width) return false;
      const mr = H.marq.getBoundingClientRect();
      const tx = Number.isFinite(viewportX) ? viewportX : (mr.left + mr.width / 2);

      /* 先把「当前这份卡」到目标的位移取到 [-half/2, half/2)：
         等价于选离当前最近的那份无缝复制，而不是绕一整圈。 */
      let delta = tx - (cr.left + cr.width / 2);
      delta = ((delta + marqHalf / 2) % marqHalf + marqHalf) % marqHalf - marqHalf / 2;

      /* 减少动态：不滑，直接落在目标位置（自动滚动本来也是关的）。 */
      if (reduceMotion) {
        marqSeek = null;
        marqX += delta;
        marqWrap();
        const track = H.marq.firstElementChild;
        if (track) track.style.transform = `translate3d(${marqX}px,0,0)`;
        return true;
      }

      let dur = opts && Number(opts.dur);
      dur = Number.isFinite(dur) ? Math.max(380, Math.min(480, dur)) : 460;
      /* from 用当前已规整的 marqX；to 允许短暂越出 [-half, 0)，
         逐帧再 marqWrap()，视觉上仍是同一份无缝轨道，不会出现断点。 */
      marqSeek = {
        from: marqX,
        to: marqX + delta,
        t0: performance.now(),
        dur,
      };
      if (!marqRaf) marqStart(true);         // 环展开时 marqPaused=true，仍要起帧跑缓动
      return true;
    };

    /** 取消正在跑的 seek，把当前位置交还给拖拽/自动滚动。返回是否真的取消过。 */
    window.__liziMarqueeSeekCancel = () => {
      if (!marqSeek) return false;
      marqSeek = null;
      return true;
    };

    function marqStart(force) {
      if (reduceMotion) return;             // 尊重「减少动态效果」：不自动走，仍可拖
      if (marqRaf || !platMode || H.marq.classList.contains('is-empty')) return;
      /* 工具箱 / 形态长廊页签面板开着：带子被盖住，任何路径都别再开帧 */
      if (srailSidePane()) return;
      if (marqPaused && !force) return;     // seek 需要压过 hover 暂停
      const tick = () => {
        marqRaf = 0;
        if (!platMode) return;

        /* 对齐缓动优先：跑在同一个 rAF 里，这段时间不扣 marqSpeedPx。 */
        if (marqSeek) {
          const s = marqSeek;
          let p = (performance.now() - s.t0) / s.dur;
          if (p < 0) p = 0;
          else if (p > 1) p = 1;
          const e = 1 - Math.pow(1 - p, 3);           // easeOutCubic
          marqX = s.from + (s.to - s.from) * e;
          marqWrap();
          const track = H.marq.firstElementChild;
          if (track) track.style.transform = `translate3d(${marqX}px,0,0)`;
          if (p >= 1) marqSeek = null;
          marqRaf = requestAnimationFrame(tick);
          return;
        }

        if (marqPaused) return;
        marqX -= marqSpeedPx;                 // 默认 ≈ 21px/s：一张 172px 的卡约 8 秒走完
        if (marqHalf && -marqX >= marqHalf) marqX += marqHalf;
        marqMaybeAppend();                    // 快滚到已渲染末尾：往两份 seg 末尾补下一批
        const track = H.marq.firstElementChild;
        if (track) track.style.transform = `translate3d(${marqX}px,0,0)`;
        marqRaf = requestAnimationFrame(tick);
      };
      marqRaf = requestAnimationFrame(tick);
    }

    function marqStop() {
      marqSeek = null;
      if (marqRaf) { cancelAnimationFrame(marqRaf); marqRaf = 0; }
    }

    function bindMarq() {
      /* 悬停只做一件事：暂停自动滚动，歌名不再一直走，点得中。
         卡片本身不做任何 hover 放大 / 替身 / 滤镜。 */
      H.marq.addEventListener('pointerenter', () => { marqPaused = true; });
      H.marq.addEventListener('pointerleave', () => { marqPaused = false; marqStart(); });
      /* 用户真的在带上移动（鼠标/笔进入、或触控拖动）时，立刻停掉对齐缓动，
         把当前 marqX 交还给拖拽/悬停。覆盖层被移除时浏览器可能补一个
         pointerenter，但不会补 pointermove，所以不会误杀 seek。 */
      H.marq.addEventListener('pointermove', () => { marqSeek = null; }, { passive: true });

      /* 拖动：不用 setPointerCapture —— 捕获会把 click 重定向到捕获元素，
         跑马带里的歌就点不进去了（旧的 bindStrip 踩过同一个坑）。
         改成按下时给 window 挂 move/up。 */
      H.marq.addEventListener('pointerdown', (e) => {
        /* 三种内容（曲目 / 歌单 / 专辑）走同一套拖动：
           不再只看 is-empty（空态没有 .marq__track 也拖不了），直接确认轨道里有 seg。 */
        if (!platMode || e.button !== 0) return;
        const track = H.marq.firstElementChild;
        if (!track || !track.querySelector('.marq__seg')) return;
        /* 兜底：rAF 测量可能在隐藏态被吞掉，marqHalf 为 0 时 marqWrap 会把 marqX
           每次都清零，表现就是「拖不动」。按下时补量一次，保证是圆环拖动。 */
        if (!marqHalf) marqMeasure();
        marqMoved = false;                    // 新手势开始：上一次拖动的点击守卫立即作废
        marqSeek = null;                      // 按下即接管，seek 不能再和拖动抢 marqX
        marqDrag = { x: e.clientX, sx: e.clientX, start: marqX, moved: 0 };
        marqPaused = true;
        marqStop();
        H.marq.classList.add('is-drag');

        const move = (ev) => {
          if (!marqDrag) return;
          marqDrag.moved = Math.max(marqDrag.moved, Math.abs(ev.clientX - marqDrag.sx));
          marqX = marqDrag.start + (ev.clientX - marqDrag.x);
          marqWrap();
          marqMaybeAppend();                  // 拖到已渲染末尾附近也照常补下一批
          const track = H.marq.firstElementChild;
          if (track) track.style.transform = `translate3d(${marqX}px,0,0)`;
        };
        const up = () => {
          if (!marqDrag) return;
          marqMoved = marqDrag.moved > 5;
          marqDrag = null;
          H.marq.classList.remove('is-drag');
          marqPaused = false;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          marqStart();
          /* 触屏 / 手势识别的 click 可能比 pointerup 晚一个任务，所以守卫保留一会儿；
             正常鼠标 click 紧跟在 pointerup 后，500ms 足够，又不会误吞下一次点击。 */
          setTimeout(() => { marqMoved = false; }, 500);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });

      H.marq.addEventListener('click', (e) => {
        /* 刚拖完的那一下 click 只吞掉，不触发下钻 / 开专辑 / 播放；清标记让下一次点击恢复 */
        if (marqMoved) { marqMoved = false; return; }
        /* 「更多」卡 → 旧 browse（专辑层是去「我的专辑」页）；歌单/频道卡 → 下钻；
           专辑入口 → 切到 albums 层；专辑卡 → 直接开专辑详情页；歌曲卡 → 播放 */
        if (e.target.closest('[data-more]')) { railOpenMore(); return; }
        if (e.target.closest('[data-albums]')) { railEnterAlbums(); return; }
        const malb = e.target.closest('[data-malb]');
        if (malb) {
          const a = railShown[+malb.dataset.malb];
          if (a && a.id) Pages.openAlbum(a.id);
          return;
        }
        const coll = e.target.closest('[data-coll]');
        if (coll) { railDrill(+coll.dataset.coll); return; }
        const b = e.target.closest('[data-i]');
        if (!b || !marqTracks.length) return;
        const i = +b.dataset.i;
        /* 大厅里直接播：不做封面飞行、不进播放页、不切视图。
           上面的巨幅海报由 Player 的 trackchange → Hall.saveTrack 自然更新（换歌就换图）。
           同一首已在播就暂停/继续，别从头重播。
           注意 playQueue 存的是 tracks.slice()，队列不是同一个数组引用，只能比当前曲目 id。 */
        const want = marqTracks[i];
        const cur = Player.state.queue[Player.state.index];
        if (want && cur && String(cur.id) === String(want.id)) Player.toggle();
        else Player.playQueue(marqTracks, i);
      });
    }

    /** 主入口：先拿缓存秒出，再并发查 6 家刷新 */
    async function paintMe(force) {
      const token = ++meToken;
      const accounts = (window.LIZI_ACCOUNTS || []).slice();
      if (!accounts.length) {
        H.me.innerHTML = '<p class="hint">没有可用的平台</p>';
        syncHallMeCell();
        return;
      }
      /* 登录事件触发的强制刷新：用户刚登录，理应重新进铺色态 */
      if (force) platOptOut = false;

      const cached = force ? null : meCache.read();
      const cachedRows = cached && Array.isArray(cached.rows) ? cached.rows : null;

      /* 有缓存就立刻画真状态；没有先给「正在确认登录状态」的引导
         （2026-11-08 起大厅不再摆七个未登录方块，登录统一去设置页） */
      const rows0 = meGridRows(accounts, cachedRows);
      platRows = rows0;                  // 铺色长条用：登录态先按缓存算
      H.me.innerHTML = meHallHtml(rows0, !cachedRows);
      syncHallMeCell();
      if (window.LiziPixelCard) window.LiziPixelCard.mountAll(H.me);
      restoreHallTheme(rows0);

      if (!force) meIdle(() => { if (token === meToken) meRefreshGrid(token, accounts); });
      else meRefreshGrid(token, accounts);
    }

    /** 并发查 6 家真实状态，回来后整体重画一次 */
    async function meRefreshGrid(token, accounts) {
      const rows = await Promise.all(accounts.map(async (a) => {
        const base = { id: a.id, name: a.name, accent: a.accent, loggedIn: false };
        const r = await meSettle(a.check());
        if (r.timeout || r.e || !r.v) return base;
        if (!r.v.loggedIn) {
          /* QQ 上游 401 时登录态是真失效（绝不画成已登录），但本地旧凭据还留着
             上次账号的真实头像；单独拿出来铺图，点击仍走扫码。 */
          if (a.id === 'qq') {
            const q = await meSettle(API.qqCachedProfile());
            if (q && !q.timeout && !q.e && q.v && q.v.avatar) {
              return { ...base, nickname: q.v.nickname || '', avatar: q.v.avatar, staleAvatar: true };
            }
          }
          return base;
        }

        let nickname = r.v.nickname || '';
        let avatar = r.v.avatar || '';
        /* detail 只是为了拿到更完整的头像/昵称；失败就用 check 那份，不算错 */
        const d = await meSettle(a.detail(r.v.key));
        if (d && d.v && !d.timeout && !d.e) {
          if (d.v.avatar) avatar = d.v.avatar;
          if (d.v.nickname) nickname = d.v.nickname;
        }
        return { ...base, loggedIn: true, nickname, avatar };
      }));

      if (token !== meToken) return;          // 期间又刷新过，丢弃这次结果
      platRows = rows;
      H.me.innerHTML = meHallHtml(rows);
      syncHallMeCell();
      if (window.LiziPixelCard) window.LiziPixelCard.mountAll(H.me);
      restoreHallTheme(rows);
      meCache.write({ rows });
    }

    /** 并发查 6 家：每家独立超时/失败，全部结束才重画一次（避免轮播一路跳） */
    async function meRunLoad(token, fallback) {
      const accounts = (window.LIZI_ACCOUNTS || []).slice();
      const checked = await Promise.all(accounts.map(async (a) => {
        const r = await meSettle(a.check());
        if (r.timeout || r.e || !r.v || !r.v.loggedIn) return null;
        return { a, st: r.v };
      }));
      if (token !== meToken) return;
      const live = checked.filter(Boolean);
      if (!live.length) { meCards = []; return paintMeDemo(token, true); }

      const got = await Promise.all(live.map(async ({ a, st }) => {
        const r = await meSettle(a.detail(st.key));
        if (r.e && /HTTP 40[13]/.test(String((r.e && r.e.message) || ''))) return null;  // 凭证失效 → 摘牌
        if (r.timeout || r.e || !r.v) {
          return { id: a.id, name: a.name, accent: a.accent, model: meMinimal(st) };     // 详情缺失 → 用登录态兜一张
        }
        return { id: a.id, name: a.name, accent: a.accent, model: r.v };
      }));
      if (token !== meToken) return;
      const cards = got.filter(Boolean);
      if (!cards.length) { meCards = []; return paintMeDemo(token, true); }

      const keep = meIdx;                       // 当前显示第几张：当前平台消失时退到这张
      mePaintCards(cards, keep);
      meCache.write({ cards, idx: meIdx });
    }

    /* ---------- 吸底 + 轮播（滚动回调只写 CSS 变量，不写 height） ---------- */
    function meApply(instant) {
      const track = H.me.querySelector('[data-me-track]');
      if (!track) return;
      const tf = `translateX(-${meIdx * 100}%)`;
      if (instant) {
        /* 首屏/重画要直接落在记忆的平台，不能从第 0 张滑过去 */
        track.style.transition = 'none';
        track.style.transform = tf;
        void track.offsetWidth;
        track.style.transition = '';
      } else {
        track.style.transform = tf;
      }
      track.dataset.i = String(meIdx);
      [...track.children].forEach((s, i) => s.classList.toggle('is-on', i === meIdx));
    }

    function meAfterPaint(instant) {
      const nav = H.me.querySelectorAll('[data-me-nav]');
      nav.forEach((b) => { b.hidden = meCards.length < 2; });
      const shell = H.me.querySelector('.me');
      if (shell) shell.dataset.platform = meCards[meIdx] ? meCards[meIdx].id : '';
      meApply(instant);
      meApplyBanners();                   // 背景按现在的来源（自定义/网易云/渐变）重铺一遍
      meLastH = -1;                       // 新 DOM，下次滚动重新写变量
      measureMePin();                     // 卡片高度可能变了（加载态/示例/平台数），吸底线重算
      requestAnimationFrame(updateMe);
    }

    /** 滚到哪个平台就记住哪个，下次进大厅直接翻到那张 */
    function meGo(dir) {
      const n = meCards.length;
      if (n < 2) return;
      meIdx = ((meIdx + dir) % n + n) % n;
      meApply(false);
      const cur = meCards[meIdx];
      if (cur) {
        try { localStorage.setItem(ME_KEY, cur.id); } catch {}
        const shell = H.me.querySelector('.me');
        if (shell) shell.dataset.platform = cur.id;
      }
    }

    /** 吸底线（视口坐标）= 滚动区底 − 16。滚动区底已经让掉了播放条，
        所以这条线就是「窗口底 − 播放条高 − 16」，和 CSS 的 .me { bottom } 同一条：
        bottom 直接读 .me 计算后的值，CSS 改了就跟着改，不会两边走偏。 */
    function measureMePin() {
      const r = el.viewHall.getBoundingClientRect();
      if (!r.height) return;                 // 大厅不在前台（尺寸为 0）：保留上一次的线
      const me = H.me.querySelector('.me');
      const gap = me ? parseFloat(getComputedStyle(me).bottom) : NaN;
      mePin = r.bottom - (Number.isFinite(gap) ? gap : 16);
    }

    /** 每帧最多一次：读 3 个几何量，写 1 个 CSS 变量（+ 进度）
        进度方向（和上一版相反）：卡片**底边**贴到吸底线之后才开始算，往下滚 = 封面往上长。
        d 不能直接用卡片的 rect.bottom —— 底边钉住之后它一直等于吸底线，永远算出 0；
        要用「封面恒为 150 时卡片底边会在哪」：
          restBottom = 行程锚点底边 + 150 + 信息块高（信息块 = 头像/昵称/统计/签名，封面长高它不变）
          d = clamp(0, 180, 吸底线 − restBottom) */
    function updateMe() {
      if (!mounted) return;
      const wrap = H.me.querySelector('.me-wrap');
      const me = H.me.querySelector('.me');
      const runway = H.me.querySelector('.me__runway');
      const banner = H.me.querySelector('.me__banner');
      if (!wrap || !me || !runway) return;
      const infoH = me.offsetHeight - (banner ? banner.offsetHeight : ME_MIN);
      const restBottom = runway.getBoundingClientRect().bottom + ME_MIN + infoH;
      const span = ME_MAX - ME_MIN;
      const d = Math.max(0, Math.min(span, mePin - restBottom));
      const h = ME_MIN + d;
      /* 值没变就别写样式（每帧写 CSS 变量会触发样式重算，白烧） */
      if (Math.abs(h - meLastH) < 0.5) return;
      meLastH = h;
      wrap.style.setProperty('--me-cover-h', h.toFixed(1) + 'px');
      /* 展开进度 0..1：CSS 用它画进度 */
      wrap.style.setProperty('--me-p', (d / span).toFixed(3));
    }

    function meOnScroll() {
      if (!meScrollOn || meRaf) return;
      meRaf = requestAnimationFrame(() => { meRaf = 0; updateMe(); });
    }

    function meAttach() {
      if (meScrollOn) return;
      meScrollOn = true;
      el.viewHall.addEventListener('scroll', meOnScroll, { passive: true });
    }

    /** 离开大厅必须摘掉监听（不然整页滚动的每一帧都在白算） */
    function meDetach() {
      if (!meScrollOn) return;
      meScrollOn = false;
      el.viewHall.removeEventListener('scroll', meOnScroll);
      if (meRaf) { cancelAnimationFrame(meRaf); meRaf = 0; }
    }

    /* 下滑的「推荐歌单」那一屏 2026-11-06 按用户要求删掉，
       onScroll 现在只负责「海报离开视口 → 收起悬停态」。 */
    function onScroll() {
      const r = el.viewHall;
      if (!r || !r.classList.contains('is-active')) return;
      /* 悬停中把页面滚走：海报离开视口就收起悬停态，别让指针"隔着屏"还亮着 */
      if (hovering) {
        const hr = H.hero.getBoundingClientRect();
        if (hr.bottom < 0 || hr.top > innerHeight) {
          hoverPtr = false;
          syncHover();
        }
        /* 海报还在悬停但已经滚出视口 → 跟随立刻停；滚回来再接着跑 */
        syncHeroLive();
      }
    }

    function bind() {
      H.play.addEventListener('click', () => {
        if (!last || !last.id) return;
        /* 队列里当前就是海报这首 → 只切播放/暂停，别从头重播。
           playQueue 存的是 slice，队列不是同一个数组引用，只能比当前曲目 id。 */
        const cur = Player.state.queue[Player.state.index];
        if (cur && String(cur.id) === String(last.id)) Player.toggle();
        else Player.playQueue([last], 0);
      });
      bindMarq();
      /* ---------------- 铺色底后景：预设注册表 + 旧调度器 ----------------
         L2 选了预设 → LIZI_BGFX.mount；预设加载失败 / mount 返回 null →
         回退 grainient；grainient 也起不来 → 回退旧 LiziBgFx 的 grainient。
         旧「背景效果」选择器把 bgfxPreset 清成空串后，继续走 LiziBgFx。
         调色板随平台 / 曲目变化（applyHallTheme / recolor 里 setColors），
         设了自定义色就不跟平台；WebGL2 不可用时保留 --plat-bg 的纯色。 */
      function hallPresetId() {
        const id = lookState && typeof lookState.bgfxPreset === 'string'
          ? lookState.bgfxPreset : 'grainient';
        return id === '' || BGFX_PRESET_IDS.has(id) ? id : 'grainient';
      }
      function hallPresetOpacity() {
        const op = Number(lookState && lookState.l2 && lookState.l2.op);
        return Number.isFinite(op) ? Math.max(0, Math.min(1, op / 100)) : .72;
      }
      function hallStorePreset(id) {
        if (!lookState) return;
        lookState.bgfxPreset = id;
        try { lookSave(); } catch { /* 隐私模式 / 存储满 */ }
      }
      function createPlatFx(host) {
        let inst = null;            // LIZI_BGFX 预设实例
        let old = null;             // 旧 LiziBgFx handle
        let preset = '';
        let colors = bgfxPalette(platMode || 'netease');
        let paused = false;
        let seq = 0;
        let dead = false;

        function clear() {
          if (inst) { try { inst.destroy(); } catch { /* 忽略 */ } inst = null; }
          if (old) { try { old.destroy(); } catch { /* 忽略 */ } old = null; }
        }
        function syncPaused() {
          if (inst) {
            try {
              if (paused) { if (inst.pause) inst.pause(); else if (inst.setPaused) inst.setPaused(true); }
              else { if (inst.resume) inst.resume(); else if (inst.setPaused) inst.setPaused(false); }
            } catch { /* 忽略 */ }
          } else if (old && old.setPaused) {
            try { old.setPaused(paused); } catch { /* 忽略 */ }
          }
        }
        function mountOld(effect) {
          clear();
          preset = '';
          if (!host || !window.LiziBgFx) return;
          try {
            old = window.LiziBgFx.mount(host, {
              effect: effect || 'grainient',
              colors,
              speed: 1,
              paused,
            });
          } catch { old = null; }
          syncPaused();
        }
        function fallback() {
          if (preset === 'grainient') { mountOld('grainient'); return; }
          mountPreset('grainient', false);
          hallStorePreset('grainient');
          document.dispatchEvent(new CustomEvent('lizi:bgfx-preset', {
            detail: { id: 'grainient', fromHall: true },
          }));
        }
        function mountPreset(id, allowFallback) {
          clear();
          preset = id;
          const my = ++seq;
          ensureBgfxRegistry().then((api) => {
            if (dead || my !== seq) return;
            if (!api || typeof api.mount !== 'function') {
              if (allowFallback) fallback(); else mountOld('grainient');
              return;
            }
            let p = null;
            try {
              p = api.mount(id, host, { colors, speed: 1, opacity: hallPresetOpacity() });
            } catch { p = null; }
            Promise.resolve(p).then((next) => {
              if (dead || my !== seq) {
                try { if (next && next.destroy) next.destroy(); } catch { /* 忽略 */ }
                return;
              }
              if (!next) {
                if (allowFallback) fallback(); else mountOld('grainient');
                return;
              }
              inst = next;
              syncPaused();
            }).catch(() => {
              if (!dead && my === seq) {
                if (allowFallback) fallback(); else mountOld('grainient');
              }
            });
          }).catch(() => {
            if (dead || my !== seq) return;
            if (allowFallback) fallback(); else mountOld('grainient');
          });
        }
        function setPreset(id) {
          const next = id === '' ? '' : (BGFX_PRESET_IDS.has(id) ? id : 'grainient');
          if (next === '') {
            hallStorePreset('');
            mountOld(bgfxEffect());
            return;
          }
          hallStorePreset(next);
          mountPreset(next, true);
        }
        setPreset(hallPresetId());
        return {
          get ok() { return !!(inst || old); },
          setPreset,
          setColors(next) {
            colors = Array.isArray(next) ? next.slice() : next;
            if (inst && inst.setColors) { try { inst.setColors(colors); } catch { /* 忽略 */ } }
            if (old && old.setColors) { try { old.setColors(colors); } catch { /* 忽略 */ } }
          },
          setPaused(next) { paused = !!next; syncPaused(); },
          setEffect(id) {
            /* 旧选择器显式切效果：清掉 L2 预设，避免它继续压着旧效果 */
            hallStorePreset('');
            document.dispatchEvent(new CustomEvent('lizi:bgfx-preset', {
              detail: { id: '', fromHall: true },
            }));
            mountOld(id);
          },
          resize() {
            if (inst && inst.resize) { try { inst.resize(); } catch { /* 忽略 */ } }
            if (old && old.resize) { try { old.resize(); } catch { /* 忽略 */ } }
          },
          destroy() { dead = true; ++seq; clear(); },
        };
      }
      const fxHost = document.getElementById('hall-plat-grain');
      if (fxHost) H.platFx = createPlatFx(fxHost);
      /* 设置页 L2 点预设：切实例；detail.fromHall 的是回退 / 旧选择器回声，不重复挂载 */
      document.addEventListener('lizi:bgfx-preset', (e) => {
        const d = e.detail || {};
        if (d.fromHall || !H.platFx || typeof d.id !== 'string') return;
        H.platFx.setPreset(d.id);
      });
      /* 同源 / 撞色切换：不刷新页面，用当前封面 / 平台色重铺一次 */
      document.addEventListener('lizi:palette-mode', () => {
        try { refreshThemeColors(true); } catch { /* 大厅还没挂载 */ }
      });
      /* 页面隐藏 / 回到前台：Raf 本身会停，但 WebGL 还占着上下文，显式暂停更省电 */
      document.addEventListener('visibilitychange', () => {
        if (!H.platFx) return;
        if (document.hidden) { H.platFx.setPaused(true); return; }
        const songFace = document.body.dataset.view === 'hall' && sideTab === 'song';
        H.platFx.setPaused(!songFace);
      });
      /* 长条里的平台图标：点别的台换色，点当前的退出铺色（和「我的」卡同一条路）。
         未登录的图标还是灰的；点了去设置页「平台账号」（大厅不弹扫码卡片）。 */
      if (window.LiziDock) window.LiziDock.attach(H.platBar);
      window.addEventListener('lizi:platforms', refreshPlatformUI);
      H.platBar.addEventListener('click', (e) => {
        if (e.target.closest('[data-search-clear]')) {
          clearMarqSearch(true);
          return;
        }
        /* 2026-11-08：只认图标按钮。长条本身带着 data-plat（当前平台），
           用裸 [data-plat] 会把点搜索键/右侧空白一路认成当前台并退出铺色。 */
        const b = e.target.closest('.pstrip__i[data-plat]');
        if (!b) return;
        const pid = b.dataset.plat;
        /* 大厅不再承担登录入口（2026-11-08）：长条上未登录的平台点了就去设置页
           「平台账号」，不再在这里弹扫码卡片（扫码那套代码还留着，只是没入口）。 */
        if (b.classList.contains('is-off')) { openAccountSettings(); return; }
        if (pid === platMode) {
          platOptOut = true;
          applyHallTheme('');
          return;
        }
        applyHallTheme(pid, b);
      });
      /* 工具箱每一项自己绑了动作（见 paintTools），这里不再统一处理。
         「我的」卡是重画的，所以箭头/登录按钮都走事件委托，不逐次绑。 */
      H.me.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-me-nav]');
        if (nav) { meGo(+nav.dataset.meNav); return; }
        /* 登录引导（未登录任何平台时大厅里唯一的入口）：去设置页「平台账号」 */
        if (e.target.closest('[data-hall-account]')) { openAccountSettings(); return; }
        /* 「我的」现在只画已登录的平台：
           · 已登录 → 整块大厅铺成这个平台的首页；再点同一个退出
           · 未登录 / 登录失效（理论上不会画出来）→ 也走设置页，不弹扫码卡片 */
        /* 2026-11-08：收紧到平台方块本身，避免误认到带 data-plat 的祖先块。 */
        const cell = e.target.closest('.plat[data-plat]');
        if (cell) {
          const pid = cell.dataset.plat;
          if (cell.classList.contains('is-in') && !cell.classList.contains('is-stale')) {
            if (platMode === pid) {
              platOptOut = true;
              applyHallTheme('');
            } else {
              applyHallTheme(pid, cell);
            }
            return;
          }
          openAccountSettings();
          return;
        }
        const b = e.target.closest('[data-me]');
        if (!b) return;
        if (b.dataset.me === 'login') openAccountSettings();
      });
      /* 左上角滚轮：悬停根段就地展开，滚轮 / 按住上下拖切换高亮，高亮立刻切跑马带。
         滚轮 DOM 不在 paintPlatBar 的 innerHTML 里（切来源重画长条时手感不断），
         并且必须移出 #hall-plat —— 它那层 overflow:hidden 会把上下两行裁掉。 */
      if (H.srcMenu && H.rail && H.srcMenu.parentNode !== H.rail) H.rail.appendChild(H.srcMenu);
      ensureSrcWheel();
      window.addEventListener('resize', () => { if (srcOpen) srcPlaceWheel(); });
      H.platBar.addEventListener('pointerover', (e) => {
        if (e.target.closest && e.target.closest('[data-src-root]')) srcOpenMenu();
      });
      /* 从根段移去长条别处（比如平台图标）就收起；移去滚轮的那一下由滚轮的
         pointerenter 取消掉这个延时 */
      H.platBar.addEventListener('pointerout', (e) => {
        if (!e.target.closest || !e.target.closest('[data-src-root]')) return;
        const to = e.relatedTarget;
        if (to && ((to.closest && to.closest('[data-src-root]'))
          || (H.srcMenu && H.srcMenu.contains(to)))) return;
        srcCloseSoon();
      });
      H.platBar.addEventListener('pointerleave', srcCloseSoon);
      /* 标题 / 来源这一行本身按住时放大到 26px，松手 / 取消才恢复。
         只认这一行，右侧平台图标和跑马带都不参与；来源滚轮的悬停/点击逻辑不动。

         2026-11-08 用户反馈「按住标题拖动时字变小了」。headless Chrome（CDP）复现：
         pointerdown 时 is-title-press 已加上（font-size 正在从 13px 过渡到 26px），
         一开始拖动，指针离开 .hall-plat__bar 进入 .hall-marq，bar 的 pointerleave
         立刻触发 → 原来挂在这里的 titlePressEnd 把类摘掉 → 字号缩回 13px。
         不是 srcOpenMenu / paintPlatBar 重画 DOM 的锅（事件日志里没有重画）。
         所以拖动期间**只认 pointerup / pointercancel**：指针移出标题或长条都不摘类；
         松手时指针在外面也没关系，document 上的 pointerup 照样收得到。
         窗口失焦（Alt-Tab）时收不到 pointerup，补 window blur 兜底，避免类永久粘住。 */
      const titlePressEnd = () => H.platBar.classList.remove('is-title-press');
      H.platBar.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const t = e.target;
        if (!t || !t.closest || !t.closest('.pstrip__name, .pstrip__src, .pstrip__crumb')) return;
        H.platBar.classList.add('is-title-press');
      });
      document.addEventListener('pointerup', titlePressEnd);
      document.addEventListener('pointercancel', titlePressEnd);
      addEventListener('blur', titlePressEnd);
      H.platBar.addEventListener('focusin', (e) => {
        if (e.target.closest && e.target.closest('[data-src-root]')) srcOpenMenu();
      });
      H.platBar.addEventListener('focusout', (e) => {
        if (!H.srcMenu || !H.srcMenu.contains(e.relatedTarget)) srcCloseSoon();
      });
      H.platBar.addEventListener('keydown', (e) => {
        const t = e.target.closest && e.target.closest('[data-src-root]');
        if (!t) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          srcOpenMenu();
          srcWheel?.step((e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1);
          /* 切来源会重画长条（当前按钮被替换），把焦点接回新的根段，方向键才能连按 */
          const t2 = H.platBar.querySelector('[data-src-root]');
          if (t2 && t2.focus) t2.focus({ preventScroll: true });
        } else if (e.key === 'Escape') {
          srcCloseMenu();
        }
      });
      if (H.srcMenu) {
        /* 滚轮 / 拖拽 / 点选 / 方向键的物理都在 hall/option-wheel.js 里，
           这里只维护「指针离开 120ms 收起」和 Esc。 */
        H.srcMenu.addEventListener('pointerenter', () => { clearTimeout(srcCloseT); });
        H.srcMenu.addEventListener('pointerleave', srcCloseSoon);
        H.srcMenu.addEventListener('focusout', (e) => {
          if (!H.srcMenu.contains(e.relatedTarget)) srcCloseSoon();
        });
        H.srcMenu.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            /* 先把焦点还给根段再收：反过来 focus() 会触发 focusin 把浮层又打开 */
            const t = H.platBar.querySelector('[data-src-root]');
            if (t && t.focus) t.focus();
            srcCloseMenu();
          }
        });
      }
      el.viewHall.addEventListener('scroll', onScroll, { passive: true });
      meAttach();
      measureMePin();
      requestAnimationFrame(updateMe);

      /* ---- 海报：悬停（指针或键盘焦点都算）+ 点击/回车进播放页 ---- */
      H.hero.addEventListener('pointerenter', () => { hoverPtr = true; syncHover(); });
      H.hero.addEventListener('pointerleave', () => { hoverPtr = false; syncHover(); });
      H.hero.addEventListener('focusin', () => { hoverFocus = true; syncHover(); });
      H.hero.addEventListener('focusout', (e) => {
        if (H.hero.contains(e.relatedTarget)) return;   // 焦点还在海报里（比如播放键）
        hoverFocus = false;
        syncHover();
      });
      H.hero.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target !== H.hero) return;
        e.preventDefault();
        openHero();
      });
      /* 右上角小锁：钉住/放开悬停展开的歌词页。它不是「打开」入口：
         preventDefault + stopPropagation，绝不落到下面 hero 的 openHero。 */
      H.lock.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        heroLocked = !heroLocked;
        paintHeroLock(!!(last && last.id));
        /* 解锁：点击时指针还在海报里（hoverPtr=true），锁按钮又拿着焦点
           （hoverFocus=true），两者都会让 syncHover 的 on 继续成立，
           海报就不会立刻收起。这里直接清掉这两个来源并主动 blur；
           之后指针离开再进入 / 键盘重新 focusin，仍会正常展开。 */
        if (!heroLocked) {
          hoverPtr = false;
          hoverFocus = false;
          H.lock.blur();
        }
        syncHover();
      });
      H.hero.addEventListener('click', (e) => {
        /* 歌手/专辑链接、播放键（以及将来任何按钮）不触发飞行 */
        if (e.target && e.target.closest && e.target.closest('a, button')) return;
        openHero();
      });
      /* 封面解码完再量一次：首帧可能还没拿到图片的最终尺寸。
         铺色态开着的话，此刻才算拿到可用的方封面 → 重新取一次专辑色。 */
      H.coverImg.addEventListener('load', () => {
        heroGeom();
        refreshThemeColors();
      });
      window.addEventListener('resize', () => {
        if (!mounted) return;
        requestAnimationFrame(heroGeom);
        /* 窗口缩放：吸底线可能随断点变（--player-h 在 900px 换值），封面高度重算 */
        measureMePin();
        requestAnimationFrame(updateMe);
        if (platMode) {
          fitPlatScale();              // 可用高度变了先定卡宽（卡宽变了内部已重量一次）
          marqMeasure();               // 跑马带按新宽度重算一份的宽度
          layoutPrism();               // 棱柱半径跟着面板高度重算
          if (H.platFx && H.platFx.resize) H.platFx.resize();
          /* 我的专辑自己的 resize 防抖是 80ms，等它改完 --ma-size 再算一次 */
          if (sideTab === 'myalbums') setTimeout(() => { if (sideTab === 'myalbums') layoutPrism(); }, 120);
        }
      }, { passive: true });
    }

    return {
      mount() {
        /* 从别的视图回大厅：先摘掉「离开时强制隐藏歌词」的类，再按真实指针恢复悬停 */
        if (H.hero) H.hero.classList.remove('is-away');
        if (mounted) {
          paintHero();
          resyncHover();
          meAttach();                    // 上次离开大厅时摘掉了，回来要接上
          measureMePin();
          requestAnimationFrame(updateMe);
          /* 手机铺色态的分屏抓手：上次在设置页登录时大厅不可见，没建成，这里补一次 */
          if (platMode) { ensureHeroGrip(); if (mobileHeroFoldOn()) syncFoldBtn(); }
          /* 铺色态回来：流色和跑马带都等视图过渡（opacity/transform）落定再开。
             以前这里同步 marqStart()，返回大厅那一帧要同时做「整页入场过渡 +
             40 张每日推荐开始平移 + 铺色底 22px 背景模糊重采样」，
             Electron 的透明窗口合成器扛不住，会整段卡住。延后 420ms 视觉上看不出。 */
          if (platMode) {
            clearTimeout(Hall._resumeT);
            Hall._resumeT = setTimeout(() => {
              if (!mounted || !platMode || document.body.dataset.view !== 'hall') return;
              /* 面板被收起来时回大厅：流色 / 跑马带都别开（看不见），
                 等用户点开下三角，setPlatFolded(false) 会重量并续上。 */
              if (platFolded) return;
              if (H.platFx) H.platFx.setPaused(false);
              /* 可能是在设置页登录后进的铺色态：那时大厅隐藏，paintMarq 里的
                 那次 requestAnimationFrame(marqMeasure) 量到宽度 0，回卷周期是 0。
                 回到大厅（视图已可见）再补量一次，跑马带才不是「一直往左跑、不回头」。
                 离开大厅期间窗口可能变过尺寸，卡宽先按当前可用高度重算一次。 */
              fitPlatScale();
              if (!marqHalf) marqMeasure();
              marqStart();               // 铺色态回来，跑马带接着走
              /* 去设置页 / 浏览页时 releaseAlbumsFace 会把陈列架还回原位置，
                 回大厅后要把当前面重新激活（尤其是 myalbums），再量一次棱柱 */
              if (sideTab !== 'song') applySideTab(sideTab, false);
              layoutPrism();             // 棱柱也按当前尺寸重算
              /* 设置页里切过「同源 / 撞色」：回来时按当前模式重铺一次 */
              refreshThemeColors();
            }, 420);
          }
          return;
        }
        mounted = true;
        last = readSaved();
        bind();
        paintHero();
        paintTools();
        paintSideRail();                 // 铺色态左侧竖向 Rubber Segment（幂等，只建一次）
        paintMe();                       // 里面会 restoreHallTheme 决定要不要直接进铺色态
        paintDaily();                    // 每日推荐数据 → 跑马带
        resyncHover();
        /* 等 app 自己画完、量完，再兜两次：开场残留的隐藏类 / 半切铺色态 */
        setTimeout(healHallBlank, 900);
        setTimeout(healHallBlank, 2600);
      },
      /** 离开大厅：滚动监听必须摘掉（回来时 mount 再接上）。
          海报的实时歌词也一样：监听 + rAF 一次摘干净，不然整页滚动的每一帧都在白算。
          跑马带同理，换视图就停，别在后台空转。 */
      leave() {
        /* 离开大厅立刻撤掉海报悬停歌词：视图淡出要 200ms+，而「悬停展开」
           只靠 .is-hover 控制；不撤的话，进播放页时海报歌词会跟着整页淡出，
           叠在新封面 / 全屏歌词上，看起来就是「歌词残影盖到封面」。 */
        if (H.hero) H.hero.classList.add('is-away');
        meDetach();
        marqStop();
        /* 分屏拖到一半切视图：立刻按露出比例落定，别把 inline 高度留到下次回来 */
        if (heroDrag) endHeroDrag(true, true);
        stopHeroSnap();
        srcCloseMenu();                // 来源浮层跟着大厅一起收（别在别的视图里悬着）
        clearTimeout(Hall._resumeT);
        cardQrClose();                 // 换视图就把扫码轮询停掉，别在后台空转
        /* 铺色底的 WebGL 流色在别的视图里也要 60fps 一直画 —— 反正是被挡住的，
           没有任何一帧能看见。这里停掉，回来时再续（见 mount）。
           它每帧都在给上面那层 22px 背景模糊换一张新底图，留着就是白烧合成器。 */
        if (H.platFx) {
          try { H.platFx.setPaused(true); } catch { /* WebGL 没起来就算了 */ }
        }
        if (lv.raf) heroSettle();      // 正在缓动的那一行先落位，回来时画面是整的
        heroArm(false);
      },
      saveTrack,
      /** 播放状态变了刷新海报播放键（playstate 订阅里调，只订阅一次） */
      syncPlayButton: syncHeroPlay,
      /** 登录状态变了要把「我的」重画一遍 */
      refreshMe() { if (mounted) paintMe(true); },   // 登录/退出：跳过缓存，立刻重查
      /** 设置页拖速度滑杆时调；下一帧 tick 就用新速度，不用切视图 */
      setMarqSpeed(v) { marqSpeedPx = marqSpeedOf(v); },
      /** 平台品牌底色：设置页平台行的小色块复用大厅这套 PLAT_BG，别另抄 hex */
      platColor(id) { const b = PLAT_BG[id]; return b ? b.bg : ''; },
      /** 设置页切换「大厅内容轨」：立刻重画左上角 + 跑马带，不重进大厅。
          新旧模式都回到每日推荐（旧模式左上角恢复平台名）。 */
      refreshRailMode() {
        railReset();
        srcHi = -1;                    // 回到每日推荐：浮层没有对应项
        marqSeq++;
        if (!mounted) return;
        paintPlatBar();
        if (platMode) renderMarq();
      },
      /** 封面换了 / 「用平台颜色铺色」切换后只重刷颜色：
         不重放铺色块展开动画；没进铺色态（platMode 为空）时完全 no-op。 */
      refreshThemeColors,
      /** 换歌时只重刷铺色底（Player 的 trackchange 调）：走专辑封面那一层，
          自定义色 / 平台色模式下 no-op，见 recolor。 */
      recolor,
      /* ---------------- 大厅背景效果（设置页唯一入口） ----------------
         效果 id 和自定义色都存在 localStorage，这里只负责「存 + 立刻生效」。
         铺色态没开着的时候 setEffect / setColors 也照存不误，下次进铺色态自然就是新的。 */
      bgfx() {
        return {
          effect: bgfxEffect(),
          colors: bgfxCustom(),                       // null = 跟随平台
          palette: bgfxPalette(platMode || 'netease'), // 现在实际在用的五档（给设置页的色块做初值）
        };
      },
      setBgfxEffect(id) {
        if (!window.LiziBgFx || !window.LiziBgFx.EFFECTS.some((e) => e.id === id)) return;
        try { localStorage.setItem(BGFX_KEY, id); } catch { /* 隐私模式 */ }
        if (H.platFx) H.platFx.setEffect(id);
      },
      /** pair = [暗色, 亮色] 自定义；传 null 表示跟随平台 */
      setBgfxColors(pair) {
        try {
          if (pair) localStorage.setItem(BGFX_COLOR_KEY, JSON.stringify(pair));
          else localStorage.removeItem(BGFX_COLOR_KEY);
        } catch { /* 同上 */ }
        if (H.platFx) H.platFx.setColors(bgfxPalette(platMode));
      },
    };
  })();

  /* ==================================================================
     设置页「大厅背景效果」：六选一 + 两个自定义色
     ------------------------------------------------------------------
     这段必须放在 Hall 之后 —— 它一求值就要问 Hall 要当前值和调色板，
     放到设置页那一块（Hall 之前）会撞 TDZ。DOM 还是 #view-settings 里的
     #set-bgfx / #set-bgfx-c1 / #set-bgfx-c2 / #set-bgfx-plat。
     真正的铺色层在 Hall 里，这里只发号施令（Hall.setBgfxEffect / setBgfxColors）。
     ================================================================== */
  (() => {
    const wrap = $('set-bgfx');
    const c1 = $('set-bgfx-c1');
    const c2 = $('set-bgfx-c2');
    const platBtn = $('set-bgfx-plat');
    const stateEl = $('set-bgfx-state');
    if (!wrap) return;

    function paintBgFx() {
      const { effect, colors, palette } = Hall.bgfx();
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-fx]'), (b) => {
        const on = b.dataset.fx === effect;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      /* 跟随平台时色块显示当前平台的暗/亮两端，看着就知道「现在用的是这套」 */
      if (c1) c1.value = colors ? colors[0] : palette[0];
      if (c2) c2.value = colors ? colors[1] : (palette[4] || palette[3]);
      if (stateEl) stateEl.textContent = colors ? '自定义配色' : '跟随平台配色';
    }

    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fx]');
      if (!b) return;
      Hall.setBgfxEffect(b.dataset.fx);
      paintBgFx();
    });

    /* 拖色盘时 input 事件一秒能来几十次，别每次都写 localStorage：
       先就地预览（Hall.setBgfxColors 内部会 setColors），松手再落库一次。 */
    let colorTimer = 0;
    const colorsNow = () => {
      const a = c1 ? c1.value : '';
      const b = c2 ? c2.value : '';
      return a && b ? [a, b] : null;
    };
    function onSwatch() {
      clearTimeout(colorTimer);
      colorTimer = setTimeout(() => {
        Hall.setBgfxColors(colorsNow());
        paintBgFx();
      }, 120);
    }
    if (c1) c1.addEventListener('input', onSwatch);
    if (c2) c2.addEventListener('input', onSwatch);
    if (platBtn) platBtn.addEventListener('click', () => {
      Hall.setBgfxColors(null);
      paintBgFx();
    });

    paintBgFx();
    /* 切平台 / 登录后调色板会变，设置页开着的话把色块跟上去 */
    window.addEventListener('lizi:platforms', paintBgFx);
    document.addEventListener('lizi:bgfx-change', paintBgFx);
  })();

  /* ================================================================== *
   * 音乐实验室：DJ 台 / 自动过渡 / 插件
   *
   * DJ 台本体整体搬到了 public/lab/dj.js（ESM，按需动态 import），
   * 音频引擎在 public/lab/dj-engine.js —— 一个 AudioContext 单例、
   * 每 deck 一条 trim→EQ→filter→推子→横推→master 的链，全部在那里。
   * 这里只剩：分页切换、自动过渡（等功率曲线）、插件结论页。
   * 自动过渡直接复用 DJ 台的 AudioContext 和 master 总线，不再自己造一个。
   * ================================================================== */
  const Lab = (() => {
    let mounted = false;
    let DJM = null;        // public/lab/dj.js 的模块对象
    let loading = null;    // import() 的 promise（并发去重）

    const E = {
      tabs: $('lab-tabs'), sub: $('lab-sub'),
      xa: $('xfade-a'), xb: $('xfade-b'), curve: $('xfade-curve'),
      len: $('xfade-len'), lenRange: $('xfade-len-range'),
      held: $('xfade-held'), heldRange: $('xfade-held-range'),
      run: $('xfade-run'), stop: $('xfade-stop'),
    };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /** 动态 import DJ 台；模块加载失败也不让整页崩 */
    function dj() {
      if (DJM) return Promise.resolve(DJM);
      if (!loading) {
        loading = import('./lab/dj.js').then((m) => {
          DJM = m.default || m;
          DJM.mount();
          return DJM;
        }).catch((e) => {
          console.warn('[lab] DJ 台加载失败', e);
          if (E.sub) E.sub.textContent = 'DJ 台加载失败：' + (e && e.message);
          loading = null;
          return null;
        });
      }
      return loading;
    }

    /* ---------- 等功率曲线（10-26 验证过的原式） ---------- */
    function buildCurves(crossover, together, points) {
      const pivot = clamp(crossover, 0.15, 0.85);
      const held = clamp(together, 0, 0.8);
      const lead = pivot * (1 - held);
      const trail = pivot + (1 - pivot) * held;
      const out = new Float32Array(points), inc = new Float32Array(points);
      for (let i = 0; i < points; i++) {
        const p = i / (points - 1);
        const warped = p <= lead ? (p / Math.max(1e-3, lead)) * 0.5
          : p >= trail ? 0.5 + ((p - trail) / Math.max(1e-3, 1 - trail)) * 0.5 : 0.5;
        const ang = warped * (Math.PI / 2);
        const head = Math.pow(10, (-1.5 * Math.sin(Math.PI * p)) / 20);
        out[i] = Math.cos(ang) * head;
        inc[i] = Math.sin(ang) * head;
      }
      return { out, inc };
    }

    function drawCurve() {
      const cv = E.curve;
      if (!cv) return;
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height, pad = 26;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#fdfcfa'; g.fillRect(0, 0, W, H);
      const heldN = Number(E.heldRange.value);
      const { out, inc } = buildCurves(0.45, heldN, 256);
      const X = (p) => pad + p * (W - pad * 2);
      const Y = (v) => H - pad - v * (H - pad * 2);
      g.strokeStyle = 'rgba(21,22,28,.07)'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = Y(i / 4);
        g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
      }
      const line = (arr, color) => {
        g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = X(i / (arr.length - 1)), y = Y(arr[i]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      line(out, '#d0453f');
      line(inc, '#1e9e63');
      g.font = '11px ui-monospace, monospace';
      g.fillStyle = '#8c8c96';
      g.fillText('cos² + sin² ≡ 1', W - pad - 96, pad + 4);
      g.fillStyle = '#c0392f'; g.fillText('— 出', pad + 4, H - 8);
      g.fillStyle = '#1e9e63'; g.fillText('— 进', pad + 58, H - 8);
      g.fillStyle = '#8c8c96';
      g.fillText('平台 ' + heldN.toFixed(2) + ' · 时长 ' + Number(E.lenRange.value).toFixed(1) + 's', W - pad - 130, H - 8);
    }

    /* ---------- 自动过渡 ---------- */
    let xfSrc = [];
    let xfGen = 0;          // 代次：每次 stopXfade 就 ++，下载回来的旧任务发现代次变了就直接放弃
    /** 停掉自动过渡的演示音源。按钮、自动结束、离开实验室/切分页都走这里（内部调用，不模拟点击）。
     *  label 传了才改副标题，免得把 DJ 台自己的提示盖掉。 */
    function stopXfade(label) {
      xfGen++;
      if (xfSrc.length) {
        xfSrc.forEach((s) => { try { s.stop(); } catch { /* 已停 */ } });
        xfSrc = [];
      }
      if (label !== undefined && E.sub) E.sub.textContent = label;
    }
    async function runXfade() {
      const st = Player.state;
      const qq = st.queue || [];
      if (qq.length < 2) { E.xa.textContent = '队列里至少要有两首歌'; return; }
      const T1 = qq[st.index], T2 = qq[(st.index + 1) % qq.length];
      E.xa.textContent = T1.name || '—';
      E.xb.textContent = T2.name || '—';
      E.run.disabled = true;
      if (DJM) DJM.stopDecks();
      const gen = xfGen;
      try {
        const m = await dj();
        if (!m) throw new Error('DJ 模块没起来');
        const { ctx, master } = m.audio();
        const one = async (tr) => {
          const r = await API.songUrl(tr.id);
          const it = (r.data || [])[0];
          if (!it || !it.url) throw new Error((tr.name || '') + ' 拿不到直链');
          const ab = await fetch(it.url, { mode: 'cors' }).then((res) => res.arrayBuffer());
          return ctx.decodeAudioData(ab);
        };
        const len = Number(E.lenRange.value), heldN = Number(E.heldRange.value);
        const [bA, bB] = await Promise.all([one(T1), one(T2)]);
        /* 期间用户切走了（stopXfade 已经把代次 +1）→ 别开声 */
        if (gen !== xfGen) return;
        const t0 = ctx.currentTime + 0.08;
        const { out, inc } = buildCurves(0.45, heldN, 128);
        const mk = (b, curve, delay) => {
          const s = ctx.createBufferSource(); s.buffer = b;
          const g = ctx.createGain(); g.gain.value = 0;
          s.connect(g).connect(master);
          s.start(t0);
          g.gain.setValueAtTime(0, t0);
          g.gain.setValueCurveAtTime(curve, t0 + delay, len);
          return s;
        };
        xfSrc = [mk(bA, out, 1.6), mk(bB, inc, 1.6)];
        if (E.sub) E.sub.textContent = '过渡中… ' + (T1.name || '') + ' → ' + (T2.name || '');
        setTimeout(() => stopXfade('过渡完成'), (1.6 + len + 0.6) * 1000);
      } catch (e) {
        E.xa.textContent = '失败：' + e.message;
      } finally {
        E.run.disabled = false;
      }
    }

    function select(tab) {
      const t = tab || 'dj';
      if (t !== 'xfade') stopXfade();
      if (E.tabs) E.tabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === t));
      document.querySelectorAll('.lab-pane').forEach((p) => p.classList.toggle('is-on', p.id === 'lab-pane-' + t));
      if (t === 'xfade') {
        drawCurve();
        const st = Player.state, qq = st.queue || [];
        const T1 = qq[st.index], T2 = qq[(st.index + 1) % qq.length];
        E.xa.textContent = T1 ? (T1.name || '—') : '—';
        E.xb.textContent = T2 ? (T2.name || '—') : '—';
      }
      /* DJ 台自己管 rAF 和音频；切到别的分页就让它下电 */
      dj().then((m) => { if (m) m.show(t); });
    }

    function bind() {
      if (E.tabs) E.tabs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (b) select(b.dataset.tab);
      });
      if (E.lenRange) E.lenRange.addEventListener('input', () => {
        E.len.textContent = Number(E.lenRange.value).toFixed(1) + 's';
        drawCurve();
      });
      if (E.heldRange) E.heldRange.addEventListener('input', () => {
        E.held.textContent = Number(E.heldRange.value).toFixed(2);
        drawCurve();
      });
      if (E.run) E.run.addEventListener('click', runXfade);
      if (E.stop) E.stop.addEventListener('click', () => stopXfade('已停'));
    }

    /* 把「停演示音源」登记到外层：show() 离开 lab、select() 切分页都要用 */
    labStopXfade = stopXfade;

    return {
      mount(tab) {
        if (!mounted) { mounted = true; bind(); }
        select(tab || 'dj');
      },
      open(tab) { show('lab'); this.mount(tab); },
      stopXfade,
      /** 离开实验室：停音频（不给用户留一个看不见的声源） */
      leave() {
        stopXfade();
        if (!DJM) return;
        try { DJM.deactivate(); DJM.stopDecks(); } catch { /* 忽略 */ }
      },
    };
  })();

  /* ================================================================== *
   * 登录
   * ================================================================== */
  let qrTimer = 0;
  /* 每轮扫码一个序号：关窗 / 重新生成 / 登录成功后自增，晚到的旧响应一律作废 */
  let qrSeq = 0;
  /* 防重入：一发 check 还在路上，这一拍就跳过（上游偶尔 >2s，不防会叠加请求） */
  let qrBusy = false;
  /* 连续失败（抛错或异常码）计数；到 3 次就停轮询，给「重新生成二维码」 */
  let qrFails = 0;
  const QR_FAIL_LIMIT = 3;
  let qrLast = { code: null, message: '' };   // 前端收到的最近一次 check
  let qrSessionSeen = null;                   // 803 之后 session() 到底看到了什么
  let qrDiagLink = null, qrRetryBtn = null, qrDiagOpen = false;
  /* Cookie 兜底入口：扫码被上游风控挑中时，粘 cookie 是用户唯一的出路，
     所以按钮常驻在二维码下面，失败时直接把输入框点亮并滚到眼前。 */
  let cookieJumpBtn = null, cookieStyleDone = false;
  /* 同一轮弹窗里二维码连续过期的次数：超过 3 次就不再自动换码空转 */
  let qrExpires = 0;

  const qrDiagEl = () => (el.qrDiag && el.qrDiag.nodeType === 1 ? el.qrDiag : null);

  /* 显隐必须同时切 hidden 和 display：`.btn { display:inline-flex }` 会盖掉 [hidden]，
     只改 hidden 的话按钮照样看得见（这个坑被截图抓过）。 */
  function setShown(node, on) {
    if (!node) return;
    node.hidden = !on;
    node.style.display = on ? '' : 'none';
  }

  /* 状态文案 + 配色都走这里，省得每个分支各写一遍 class */
  function setQrStatus(text, kind) {
    el.qrStatus.textContent = text;
    el.qrStatus.className = 'qr__status' + (kind ? ' ' + kind : '');
  }

  /* 「重新生成二维码」和「查看诊断」都只在出事时出现，所以按需创建一次、之后只切显隐 */
  function ensureQrBits() {
    if (qrRetryBtn || !el.qrStatus || el.qrStatus.nodeType !== 1) return;

    qrRetryBtn = document.createElement('button');
    qrRetryBtn.type = 'button';
    qrRetryBtn.id = 'qr-retry';
    qrRetryBtn.className = 'btn btn--primary';
    qrRetryBtn.textContent = '重新生成二维码';
    qrRetryBtn.style.cssText = 'height:32px;padding-inline:14px;font-size:12px;';
    qrRetryBtn.addEventListener('click', () => startQrLogin());
    el.qrStatus.after(qrRetryBtn);
    setShown(qrRetryBtn, false);

    qrDiagLink = document.createElement('button');
    qrDiagLink.type = 'button';
    qrDiagLink.id = 'qr-diag-link';
    qrDiagLink.textContent = '查看诊断';
    qrDiagLink.style.cssText = 'background:none;border:0;padding:0;font:inherit;font-size:12px;color:inherit;opacity:.72;text-decoration:underline;cursor:pointer;';
    qrDiagLink.addEventListener('click', () => (qrDiagOpen ? hideQrDiag() : showQrDiag()));
    qrRetryBtn.after(qrDiagLink);
    setShown(qrDiagLink, false);

    ensureCookieHelp();
  }

  function showQrRetry() { ensureQrBits(); setShown(qrRetryBtn, true); }

  /* 常驻的「粘贴 Cookie」入口。扫码这条路被上游风控挑中时（803 但没 cookie、
     或者 key 已被消费），这里是用户唯一的出路，所以不藏在下面，就贴在二维码底下。 */
  function ensureCookieHelp() {
    if (cookieJumpBtn || !el.qrStatus || el.qrStatus.nodeType !== 1) return;
    cookieJumpBtn = document.createElement('button');
    cookieJumpBtn.type = 'button';
    cookieJumpBtn.id = 'cookie-jump';
    cookieJumpBtn.className = 'btn btn--primary';
    cookieJumpBtn.textContent = '扫不上？粘贴 Cookie 登录';
    cookieJumpBtn.style.cssText =
      'height:32px;margin-top:8px;padding-inline:14px;font-size:12px;width:100%;';
    cookieJumpBtn.addEventListener('click', () => {
      highlightCookieBox();
      if (el.cookieInput) el.cookieInput.focus();
    });
    el.qrStatus.after(cookieJumpBtn);
  }

  /* 把 cookie 输入框点亮并滚到眼前。样式一次性注入（app.css 不在登录专项的改动范围）。 */
  function highlightCookieBox() {
    if (!el.cookieInput) return;
    if (!cookieStyleDone) {
      cookieStyleDone = true;
      const st = document.createElement('style');
      st.id = 'cookie-hot-style';
      st.textContent = [
        '.cookie-hot textarea{border-color:oklch(62% 0.20 25 / .85)!important;',
        'background:oklch(99% 0.02 25 / .62)!important;',
        'box-shadow:0 0 0 3px oklch(62% 0.20 25 / .20),0 0 26px oklch(62% 0.20 25 / .16)!important;}',
        '.cookie-hot #cookie-msg{opacity:1!important;color:oklch(48% 0.16 25)!important;}',
        '@keyframes cookiePulse{0%{box-shadow:0 0 0 2px oklch(62% .2 25 / .06)}',
        '55%{box-shadow:0 0 0 6px oklch(62% .2 25 / .28)}',
        '100%{box-shadow:0 0 0 3px oklch(62% .2 25 / .20)}}',
        '.cookie-hot textarea{animation:cookiePulse .85s ease-out 2;}',
      ].join('');
      document.head.appendChild(st);
    }
    const sec = el.cookieInput.closest('div');
    if (sec) sec.classList.add('cookie-hot');
    try { el.cookieInput.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch { el.cookieInput.scrollIntoView(); }
  }

  /* 803 之后 harvest 失败：文案必须说清到底缺哪一环，别再来一句含糊的「没拿到登录态」 */
  function explainHarvestFailure(h) {
    const r = (h && h.reason) || '';
    const tried = (h && h.harvest && h.harvest.tried) || [];
    const where = tried.length ? `（试过：${tried.join(' → ')}）` : '';
    if (r === 'no-music-u') {
      return {
        text: '已授权，但网易云这次压根没下发 MUSIC_U（cookie 是空的）' + where
          + ' —— 用下面「粘贴 Cookie」10 秒就能登上',
        highlightCookie: true, rekey: false,
      };
    }
    if (r === 'invalid') {
      return {
        text: 'MUSIC_U 拿到了，但用它校验登录失败（多半已过期或被风控作废）'
          + ' —— 重新扫一次，或直接粘 Cookie',
        highlightCookie: true, rekey: false,
      };
    }
    if (r === 'not-authorized') {
      const c = (h && h.code) != null ? h.code : '?';
      return {
        text: `二维码凭证已经废了（key 一次性，再查回 ${c}）—— 正在自动换一张新码`,
        highlightCookie: true, rekey: true,
      };
    }
    if (r === 'sidecar') {
      return { text: '网易云边车没响应：' + ((h && h.message) || '未知') + ' —— 先粘 Cookie 顶上', highlightCookie: true, rekey: false };
    }
    if (r === 'error') {
      return { text: '校验登录态时出错：' + ((h && h.message) || '未知') + ' —— 先粘 Cookie 顶上', highlightCookie: true, rekey: false };
    }
    return { text: '已授权但没拿到登录态：' + ((h && h.message) || '未知原因'), highlightCookie: true, rekey: false };
  }

  function hideQrDiag() {
    qrDiagOpen = false;
    const d = qrDiagEl();
    if (d) { d.hidden = true; d.textContent = ''; }
    if (qrDiagLink) { qrDiagLink.textContent = '查看诊断'; setShown(qrDiagLink, false); }
  }

  /* 诊断：服务端最近一次 check 的原始 code/message + 前端这一侧看到的东西。
     服务端只列 cookie 键名，这里也绝不会出现任何 cookie 值。 */
  async function loadQrDiag() {
    if (!qrDiagEl()) return;
    let server;
    try {
      const r = await fetch('/api/login/qr/last', { cache: 'no-store' });
      server = await r.json();
    } catch (e) {
      server = { error: String((e && e.message) || e) };
    }
    const box = qrDiagEl();
    if (!box || box.hidden) return;      // 期间被收起了，别再往里写
    box.textContent = JSON.stringify({
      channel: (server && server.channel) || null,   // 扫码走的通道：weapi / eapi（服务端 /api/login/qr/last 带回来）
      /* 收 cookie 这一环：试过哪几处（cache → check → status）、拿没拿到、来自哪个字段。
         只有键名和字段名，绝不含 cookie 值。 */
      harvest: (server && server.harvest) || null,
      server,
      client: {
        lastCode: qrLast.code,
        lastMessage: qrLast.message,
        consecutiveFails: qrFails,
        sessionAtVerify: qrSessionSeen,
      },
    }, null, 2);
  }

  async function showQrDiag() {
    ensureQrBits();
    const d = qrDiagEl();
    if (!d) return;
    d.hidden = false;
    qrDiagOpen = true;
    if (qrDiagLink) { qrDiagLink.textContent = '收起诊断'; setShown(qrDiagLink, true); }
    await loadQrDiag();
  }

  /* 一次失败：先如实显示原因；连挂 3 次才停轮询并给出重试入口 */
  function qrTrouble(reason) {
    qrFails++;
    if (qrFails >= QR_FAIL_LIMIT) {
      clearInterval(qrTimer);
      qrTimer = 0;
      setQrStatus('登录失败，请重试（' + reason + '）', 'is-error');
      showQrRetry();
    } else {
      setQrStatus(reason + '（第 ' + qrFails + '/' + QR_FAIL_LIMIT + ' 次，继续重试…）', 'is-error');
    }
    ensureQrBits();
    setShown(qrDiagLink, true);
  }

  /* 803 只代表「手机上授权了」，不代表 cookie 写进来了。
     现在扫码走网易云边车（services/netease-api/）：
       1) 803 那一拍**服务端当场**就把 cookie（body.cookie / Set-Cookie 头）收好并验过登录态，
          响应里带 loggedIn / profile —— 那条路最稳，前端直接用；
       2) 没拿到（比如边车只回了 803、cookie 为空）就再发 /api/login/harvest，
          由服务端走缓存 → 重查 → /login/status 三段落点，并如实说清缺哪一环。 */
  async function onQrAuthorized(seq, key, d) {
    clearInterval(qrTimer);
    qrTimer = 0;
    setQrStatus('已扫码，正在确认登录…');
    el.qrBox.classList.add('is-done');

    let h = null;
    if (d && d.loggedIn === true && d.profile) {
      h = { ok: true, profile: d.profile, harvest: d.harvest };   // 服务端在 803 那拍已经收好了
    } else {
      try {
        h = await API.harvest(key);
      } catch (e) {
        h = { ok: false, reason: 'request', message: (e && e.message) || String(e) };
      }
    }
    if (seq !== qrSeq) return;                     // 期间关窗 / 重新生成过
    qrSessionSeen = {
      harvest: !!(h && h.ok),
      reason: (h && h.reason) || null,
      message: (h && h.message) || null,           // 服务端的话，里面不会带 cookie 值
      detail: (h && h.harvest) || null,            // { tried, gotCookie, field } —— 只有键名和来源
    };

    if (!h || h.ok !== true) {
      const why = explainHarvestFailure(h);
      setQrStatus(why.text, 'is-error');
      showQrRetry();                                    // 顺带建好「查看诊断」入口
      setShown(qrDiagLink, true);                       // 诊断收着，点开才展开（不挤掉 cookie 框）
      if (why.highlightCookie) setTimeout(() => highlightCookieBox(), 60);
      if (why.rekey) setTimeout(() => { if (seq === qrSeq) startQrLogin(); }, 1400);
      return;
    }

    setQrStatus('登录成功', 'is-ok');
    setTimeout(closeModal, 700);                   // 文案亮 700ms 再关，不等资料刷新
    try { await afterLogin({ loggedIn: true, profile: h.profile }); } catch { /* 登录态已经到手，资料刷不出来不该挡住关窗 */ }
  }

  async function pollQr(key, seq) {
    if (seq !== qrSeq || qrBusy) return;           // 旧轮询 / 上一发还没回来
    qrBusy = true;
    let d;
    try {
      d = await API.qrCheck(key);
    } catch (e) {
      qrBusy = false;
      if (seq === qrSeq) qrTrouble('请求失败：' + ((e && e.message) || e));
      return;
    }
    qrBusy = false;
    if (seq !== qrSeq) return;                     // 请求期间被关窗/重置

    qrLast = { code: d && d.code, message: (d && (d.message || d.error)) || '' };
    const code = Number(d && d.code);              // 上游给字符串 "803" 也认
    if (code === 800) {
      /* 过期就换码，不能停在错误态。留 600ms 让用户看清发生了什么，再换新的。
         但连续换 3 次还是 800 就说明这条路今天走不通，别原地空转 —— 直接指到 cookie。 */
      qrExpires++;
      if (qrExpires > 3) {
        clearInterval(qrTimer);
        qrTimer = 0;
        setQrStatus('二维码连续 ' + qrExpires + ' 次都是过期（上游不放行）—— 直接粘 Cookie 最快', 'is-error');
        showQrRetry();
        highlightCookieBox();
        await showQrDiag();
        return;
      }
      setQrStatus('二维码过期了，正在自动换一张…', 'is-error');
      setTimeout(() => { if (seq === qrSeq) startQrLogin(); }, 600);
    } else if (code === 801) {
      qrExpires = 0;
      qrFails = 0;
      setQrStatus('请用网易云音乐 App 扫描二维码');
    } else if (code === 802) {
      qrExpires = 0;
      qrFails = 0;
      setQrStatus('已扫码，请在手机上确认', 'is-ok');
    } else if (code === 803) {
      qrExpires = 0;
      await onQrAuthorized(seq, key, d);
    } else {
      /* 其它一切（500 / 301 / 400 / 空 body / 上游风控…）都不能继续装作在等确认 */
      const shown = Number.isFinite(code) ? String(code) : String((d && d.code) ?? '无 code');
      qrTrouble('网易云返回了异常状态：' + shown + (qrLast.message ? ' ' + qrLast.message : ''));
    }
  }

  async function startQrLogin() {
    const seq = ++qrSeq;                           // 上一轮的轮询回调全体作废
    clearInterval(qrTimer);
    qrTimer = 0;
    qrBusy = false;
    qrFails = 0;
    qrLast = { code: null, message: '' };
    qrSessionSeen = null;
    setShown(qrRetryBtn, false);
    hideQrDiag();
    el.qrBox.innerHTML = '<span class="qr__ph">正在获取二维码…</span>';
    el.qrBox.classList.remove('is-done');
    setQrStatus('请用网易云音乐 App 扫描二维码');

    let key, qrimg = '';
    try {
      const d = await API.qrKey();
      key = d && d.key;
      qrimg = (d && d.qrimg) || '';
      if (!key) throw new Error((d && (d.message || d.error)) || '拿不到二维码 key');
    } catch (e) {
      if (seq !== qrSeq) return;
      el.qrBox.innerHTML = '<span class="qr__ph">二维码获取失败</span>';
      setQrStatus('无法连接网易云：' + ((e && e.message) || e), 'is-error');
      showQrRetry();
      ensureQrBits();
      setShown(qrDiagLink, true);
      return;
    }
    if (seq !== qrSeq) return;

    const img = new Image();
    img.alt = '登录二维码';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { el.qrBox.innerHTML = ''; el.qrBox.appendChild(img); };
    img.onerror = () => { el.qrBox.innerHTML = '<span class="qr__ph">二维码图片加载失败，请改用粘贴 Cookie</span>'; };
    /* 边车（@neteasecloudmusicapienhanced/api）的 /login/qr/create?qrimg=true 直接给
       base64 PNG，用它最省事，也不依赖外网图床；没有才退回把登录链接画成二维码。 */
    img.src = qrimg || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent('https://music.163.com/login?codekey=' + key)}`;

    qrTimer = setInterval(() => pollQr(key, seq), 2000);
  }

  async function afterLogin(s) {
    s = s || await API.session();
    if (!s || s.loggedIn !== true) return;
    profile = s.profile;
    /* 顶栏登录位删掉后，设置页账号块不再靠 MutationObserver 跟着刷新 */
    paintAccount();
    const lists = await API.userPlaylists(profile.userId);
    const mine = lists.playlists.filter((p) => !p.subscribed);
    const sub = lists.playlists.filter((p) => p.subscribed);
    renderPlaylists([...mine, ...sub]);
    Hall.refreshMe();          // 大厅那张个人主页卡要立刻换成你自己的
  }

  function openModal() {
    el.modal.classList.remove('is-closed');
    /* Cookie 那一块每次打开都回到初始文案，输入框里的残留凭证也清掉 */
    if (el.cookieMsg) {
      el.cookieMsg.textContent = 'F12 → Application → Cookies → music.163.com → 复制 MUSIC_U 的值';
      el.cookieMsg.style.color = '';
    }
    if (el.cookieInput) {
      el.cookieInput.value = '';
      const sec = el.cookieInput.closest('div');
      if (sec) sec.classList.remove('cookie-hot');     // 上次失败点亮的高亮收掉
    }
    ensureCookieHelp();                                 // 常驻的「扫不上？粘贴 Cookie」入口
    qrExpires = 0;
    startQrLogin();
    // 弹窗藏起来时玻璃尺寸是 0，显示后必须重建贴图
    requestAnimationFrame(() => setTimeout(() => LiquidGlass.refresh(), 120));
    /* 弹窗打开不再默认聚焦任何输入框；
       「粘贴 MUSIC_U Cookie」入口走 openLoginModal(true)，那里会显式聚焦 cookie-input。 */
  }
  function closeModal() {
    el.modal.classList.add('is-closed');
    clearInterval(qrTimer);
    qrTimer = 0;
    qrSeq++;                 // 在飞的 check 回来也不再写界面
    qrBusy = false;
  }

  async function logout() {
    await API.logout().catch(() => {});
    profile = null;
    paintAccount();            // 顶栏登录位已删，设置页账号块在这里显式刷新
    renderPlaylists([]);
    el.plName.textContent = '发现音乐';
    el.plSub.textContent = '已退出登录';
    Hall.refreshMe();          // 退出后退回示例卡
  }

  /* ================================================================== *
   * 事件
   * ================================================================== */
  /* 品牌锁形和播放页的「返回」都回大厅（大厅现在是入口） */
  el.brand.addEventListener('click', (e) => { e.preventDefault(); show('hall'); });
  el.btnBack.addEventListener('click', () => show('hall'));
  el.btnOpenNow.addEventListener('click', () => show(view === 'now' ? 'browse' : 'now'));

  // 歌词面板常开（"收起歌词"功能已按用户要求删除）
  el.peekWrap.addEventListener('click', (e) => {
    if (e.target.closest('#pull')) return;
    setLyricsOpen(true);
  });

  /* 「拉起」手势：在手柄上往上拖=展开，往下拖=收起，轻点=切换。
     拖拽距离不够就当成点击，避免误触。 */
  (() => {
    let startY = 0, dragging = false;
    el.pull.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY;
      el.pull.setPointerCapture(e.pointerId);
    });
    el.pull.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.clientY - startY;
      if (dy < -36) setLyricsOpen(true);
      else if (dy > 36) setLyricsOpen(true);   // 收起功能已删，往下拖也保持展开
      else setLyricsOpen(true);
    });
    el.pull.addEventListener('pointercancel', () => { dragging = false; });
    // 键盘可达：手柄上按上下键
    el.pull.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); setLyricsOpen(true); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setLyricsOpen(false); }
    });
  })();
  el.modalClose.addEventListener('click', closeModal);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    /* F5 现在归 lyric-delay.js 管（歌声延迟面板，它用捕获阶段，比这里更早）。
       这里只留一个兜底：那个脚本没加载时，仍旧转发舞台自带的调参面板。 */
    if (e.key === 'F5' || e.code === 'F5') {
      if (window.__lyricDelay) return;
      if (view === 'stage') {
        e.preventDefault();
        try { $('stage-frame').contentWindow.postMessage({ __c100: 1, type: 'panel' }, '*'); } catch { /* 忽略 */ }
      }
      return;
    }
    if (e.key === 'Escape') {
      if (!el.modal.classList.contains('is-closed')) return closeModal();
      if (view === 'now') return show('browse');
    }
    // 空格暂停/播放，但别抢输入框的键
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
      e.preventDefault(); Player.toggle();
    }
  });

  /* 粘贴 Cookie 导入（备用，也是最稳的一条）。
     值只发给本机服务端：这里不 console、不拼进诊断、成功后立刻清空输入框，
     页面上只会出现「登录成功 / cookie 无效或已过期」这类服务端给的文案。 */
  if (el.cookieImport) {
    el.cookieImport.addEventListener('click', async () => {
      const raw = ((el.cookieInput && el.cookieInput.value) || '').trim();
      const say = (text, kind) => {
        if (!el.cookieMsg) return;
        el.cookieMsg.textContent = text;
        el.cookieMsg.style.color = kind === 'error' ? 'oklch(58% 0.19 25)' : kind === 'ok' ? 'oklch(56% 0.14 150)' : '';
      };
      if (!raw) { say('先把 MUSIC_U 的值粘进来', 'error'); return; }

      el.cookieImport.disabled = true;
      const label = el.cookieImport.textContent;
      el.cookieImport.textContent = '导入中…';
      try {
        const d = await API.importCookie(raw);
        if (d && d.ok) {
          if (el.cookieInput) el.cookieInput.value = '';      // 不把凭证留在 DOM 里
          say('登录成功', 'ok');
          clearInterval(qrTimer); qrTimer = 0; qrSeq++;       // 停掉还在跑的扫码轮询
          setQrStatus('登录成功', 'is-ok');
          setTimeout(closeModal, 700);
          try { await afterLogin({ loggedIn: true, profile: d.profile }); } catch { /* 资料刷不出来不影响已登录 */ }
        } else {
          say((d && d.message) || '导入失败', 'error');
        }
      } catch (e) {
        say('请求失败：' + ((e && e.message) || e), 'error');
      } finally {
        el.cookieImport.disabled = false;
        el.cookieImport.textContent = label;
      }
    });
  }

  /* 搜索：N 个音源**分开列**。
     同一个关键词在每家平台的条数、排序都不一样，混在一起谁也分不清哪首属于哪个平台，
     所以用顶部那行切换，一次只显示一边；「全部」才会并行打五家、**按源分组**列出来。 */
  let searchTimer = 0;
  let searchSource = 'netease';
  try { searchSource = localStorage.getItem('lizi.searchSource') || 'netease'; } catch { /* ignore */ }
  let lastQuery = '';
  const srcSwitch = $('src-switch');
  const srcHint = $('src-hint');

  /* 音源表：加一家只改这里（按钮是从它生成的，别再往 index.html 写死按钮） */
  const SEARCH_SOURCES = [
    { id: 'netease', label: '网易云', hint: '网易云' },
    { id: 'qq', label: 'QQ 音乐', hint: 'QQ 音乐' },
    { id: 'kugou', label: '酷狗', hint: '酷狗音乐' },
    { id: 'qishui', label: '汽水', hint: '汽水音乐' },
    { id: 'bodian', label: '波点', hint: '波点音乐' },
    /* 2026-11-10：Spotify 整块下线（和设置页那边同一决定），搜索栏不再露出。
       OAuth 回调在本机回不来，留着只会让用户以为能搜。 */
  ];
  /* 老用户 localStorage 里可能还存着 'spotify'：表里没有就回落到网易云，
     否则搜索栏一个按钮都不高亮、hint 还会显示「Spotify」。 */
  if (!SEARCH_SOURCES.some((s) => s.id === searchSource)) searchSource = 'netease';
  const srcLabel = (id) => (SEARCH_SOURCES.find((s) => s.id === id) || {}).hint || id;
  const isAll = () => searchSource === 'all';

  function buildSourceButtons() {
    const frag = document.createDocumentFragment();
    for (const s of [{ id: 'all', label: '全部' }, ...SEARCH_SOURCES]) {
      const b = document.createElement('button');
      b.className = 'src-switch__b';
      b.dataset.src = s.id;
      b.textContent = s.label;
      frag.appendChild(b);
    }
    const first = srcSwitch.querySelector('.src-switch__hint');
    srcSwitch.insertBefore(frag, first);       // hint 永远在最后
  }

  function hint(text) { srcHint.textContent = text; }

  /** 列表区的占位文字（用 textContent，不拼 HTML —— 搜索词和错误信息都可能带引号） */
  function emptyList(text) {
    el.tracks.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = text;
    el.tracks.appendChild(p);
  }

  function paintSource() {
    srcSwitch.querySelectorAll('[data-src]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.src === searchSource));
    if (!lastQuery) hint(isAll() ? '全部音源 · 输入关键词' : `${srcLabel(searchSource)} · 输入关键词`);
  }

  /** 打一家，返回 { id, tracks, count, error, note } —— 一家挂了不能拖垮其它家 */
  async function searchOne(id, q) {
    if (id === 'netease') {
      const d = await API.search(q);
      return { id, tracks: d.tracks || [], count: d.songCount || (d.tracks || []).length, error: null };
    }
    if (id === 'qq') {
      const d = await API.qqSearch(q, 20);
      if (d.code !== 200) return { id, tracks: [], count: 0, error: d.error || 'QQ 音乐搜索失败' };
      return { id, tracks: d.tracks || [], count: d.songCount || (d.tracks || []).length, error: null };
    }
    const d = await API.srcSearch(id, q, 20);
    if (d && d.code !== 200) return { id, tracks: [], count: 0, error: (d && d.error) || `${srcLabel(id)} 搜索失败` };
    return { id, tracks: (d && d.tracks) || [], count: (d && d.songCount) || ((d && d.tracks) || []).length, error: null, note: d && d.note };
  }

  async function runSearch(q) {
    lastQuery = q;
    show('browse');
    el.plName.textContent = `搜索「${q}」`;     // 主视图头已删，这两行是给旧代码留的
    el.plCover.hidden = true;

    if (!isAll()) {
      emptyList(`正在 ${srcLabel(searchSource)} 里搜「${q}」…`);
      hint('正在搜索…');
      try {
        const r = await searchOne(searchSource, q);
        if (r.error) {
          hint(`${srcLabel(searchSource)} 搜索失败`);
          emptyList(r.error + (r.note ? '\n' + r.note : ''));
          return;
        }
        hint(`${srcLabel(searchSource)} · ${r.count} 首` + (r.note ? ` · ${r.note}` : ''));
        renderTracks(r.tracks);
      } catch (e) {
        hint('搜索失败');
        emptyList('搜索失败：' + e.message);
      }
      return;
    }

    /* 「全部」：五家并行，谁先回来不算数，等齐了按源分组渲染。
       某一家失败就在那一组的标题里写清楚原因，不吞掉。 */
    emptyList(`正在同时搜 ${SEARCH_SOURCES.length} 个音源…`);
    hint('正在搜索全部音源…');
    const results = await Promise.all(SEARCH_SOURCES.map((s) =>
      searchOne(s.id, q).catch((e) => ({ id: s.id, tracks: [], count: 0, error: e.message }))));

    const all = [];
    const headings = {};
    let okCount = 0;
    for (const r of results) {
      if (r.tracks.length) {
        okCount++;
        headings[all.length] = `${srcLabel(r.id)} · ${r.count} 首` + (r.note ? ` · ${r.note}` : '');
        all.push(...r.tracks);
      } else {
        headings[all.length] = `${srcLabel(r.id)} · ${r.error ? '失败：' + r.error : '没有结果'}`;
      }
    }
    hint(`全部 · ${okCount}/${SEARCH_SOURCES.length} 个音源有结果 · ${all.length} 首`);
    if (!all.length) { emptyList('全部音源都没有结果'); return; }
    renderTracks(all, headings);
  }

  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el.search.value.trim();
    if (!q) { paintSource(); return; }
    searchTimer = setTimeout(() => runSearch(q), 420);
  });

  /* 切音源：有搜索词就用新音源重搜一遍 */
  srcSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (!b || b.dataset.src === searchSource) return;
    searchSource = b.dataset.src;
    try { localStorage.setItem('lizi.searchSource', searchSource); } catch { /* ignore */ }
    paintSource();
    if (lastQuery) runSearch(lastQuery);
  });
  buildSourceButtons();
  paintSource();

  el.btnPlayAll.addEventListener('click', () => { if (currentList.length) Player.playQueue(currentList, 0); });

  /* 折叠搜索：展开只靠 :hover 的视觉过渡，不自动抢焦点 ——
     光标只在用户点击输入框时出现。移出搜索框、点到别处、按 Esc 都无条件
     blur 收回 38px 圆钮；输入内容保留，下次悬停/点击仍可继续编辑。 */
  el.searchWrap.addEventListener('pointerleave', () => el.search.blur());
  /* 兜底：不少拖拽区的 mousedown 会 preventDefault，焦点可能赖在输入框里
     导致 :focus-within 一直撑开；捕获阶段监听，确保点到搜索框外必定失焦。 */
  document.addEventListener('pointerdown', (e) => {
    if (!el.searchWrap.contains(e.target)) el.search.blur();
  }, true);
  el.search.addEventListener('keydown', (e) => {
    /* 输入法候选框里的 Esc 是「取消这次组词」，别顺手把搜索框也收了 */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') el.search.blur();
  });
  el.btnPlay.addEventListener('click', () => Player.toggle());
  el.btnPrev.addEventListener('click', () => Player.prev());
  el.btnNext.addEventListener('click', () => Player.next());

  /* 桌面壳（Electron）的全局媒体键 / 托盘 → 转给 Player。
     浏览器里没有 window.__desktop，这里自动跳过。 */
  if (window.__desktop && window.__desktop.isDesktop) {
    document.body.classList.add('is-desktop');
    window.__desktop.onMedia((action) => {
      if (action === 'toggle') Player.toggle();
      else if (action === 'next') Player.next();
      else if (action === 'prev') Player.prev();
      else if (action === 'stop') Player.pause();
    });

    /* 自绘窗口控制（LIZI）：最小化 / 最大化(还原) / 关闭到托盘。
       图标不能"点了就翻"猜状态 —— 以主进程推回来的真实状态为准。 */
    const wc = document.getElementById('win-controls');
    const winApi = window.__desktop.winControls;
    if (wc && winApi) {
      const btnMin = wc.querySelector('#win-min');
      const btnMax = wc.querySelector('#win-max');
      const btnClose = wc.querySelector('#win-close');

      /* #win-max 一个按钮两副面孔：方框 = 最大化，叠框 = 还原（图标在 index.html 里） */
      const paintMax = (maximized) => {
        if (!btnMax) return;
        const on = !!maximized;
        const label = on ? '还原' : '最大化';
        btnMax.classList.toggle('is-max', on);
        if (btnMax.title !== label) btnMax.title = label;
        if (btnMax.getAttribute('aria-label') !== label) btnMax.setAttribute('aria-label', label);
      };

      /* 最小化先播一段「缩出去」再真最小化（win-anim.js）；拿不到模块就退回原行为 */
      if (btnMin) btnMin.addEventListener('click', () => {
        if (window.WIN_ANIM) window.WIN_ANIM.minimize(() => winApi.minimize());
        else winApi.minimize();
      });
      if (btnMax) btnMax.addEventListener('click', () => winApi.toggleMaximize());
      if (btnClose) btnClose.addEventListener('click', () => winApi.close());

      /* 启动读一次真实值，之后跟着主进程推的 win:state 走
         （最大化 / 还原 / 进全屏 / 缩放 / 显隐都会推） */
      paintMax(winApi.isMaximized());
      /* onWinState 在 __desktop 顶层（和 onMedia 一个位置），不在 winControls 里 */
      const desktop = window.__desktop;
      if (typeof desktop.onWinState === 'function') desktop.onWinState((s) => paintMax(s && s.maximized));

      /* 双击顶部拖动带 / 标题栏 = 最大化 / 还原（Windows 习惯）。
         拖动带本身是 -webkit-app-region: drag：系统把它当标题栏接管时事件到不了页面，
         那一路由窗口自己处理；能收到就说明没被接走，两者不会同时翻转。 */
      const dblToggle = (e) => {
        const t = e.target;
        /* 顶栏里的按钮 / 输入 / 搜索有自己的双击语义，不抢 */
        if (t && t.closest && t.closest('button, a, input, textarea, select, .sw, .search')) return;
        winApi.toggleMaximize();
      };
      const strip = document.getElementById('drag-strip');
      if (strip) strip.addEventListener('dblclick', dblToggle);
      const topbarEl = document.getElementById('topbar');
      if (topbarEl) topbarEl.addEventListener('dblclick', dblToggle);
    }
  }
  /* 播放模式：顺序 → 列表循环 → 单曲循环 → 随机。
     两处按钮（播放条 / 播放页）必须同步 —— 以前只改了播放条那个，
     播放页的按钮永远停在"顺序"图标上，所以看起来像没做。 */
  function applyModeUI(m) {
    for (const btn of [el.btnMode, $('ntr-mode')]) {
      if (!btn || !btn.querySelector) continue;
      setIcon(btn, ICONS[m]);
      btn.title = MODE_LABEL[m];
      btn.setAttribute('aria-label', MODE_LABEL[m]);
      btn.classList.toggle('is-on', m !== 'order');
    }
  }
  el.btnMode.addEventListener('click', () => {
    const m = Player.cycleMode();
    localStorage.setItem('playMode', m);
    applyModeUI(m);
  });
  /* 恢复上次选的模式 */
  {
    const saved = localStorage.getItem('playMode');
    if (saved && MODE_LABEL[saved]) Player.setMode(saved);
    applyModeUI(Player.state.mode);
  }

  el.btnMute.addEventListener('click', () => {
    Player.audio.muted = !Player.audio.muted;
    setIcon(el.btnMute, Player.audio.muted ? ICONS.mute : ICONS.volume);
  });

  // 省电模式：关掉折射只留模糊（玻璃多了很有用）
  el.btnLite.addEventListener('click', () => {
    const off = el.btnLite.getAttribute('aria-checked') === 'true';
    el.btnLite.setAttribute('aria-checked', String(!off));
    el.btnLite.title = off ? '关闭折射以省电' : '折射已关闭（只保留模糊）';
    LiquidGlass.surfaces.forEach((s) => s.set({ refraction: off }));
  });

  /* 顶栏滚动态，用滞回避免阈值抖动。
     滚动容器现在是整个浏览视图（整页滚动），不再是列表内部。 */
  let stuck = false, ticking = false;
  const onScroll = (y) => {
    if (!stuck && y > 24) { stuck = true; el.topbar.classList.add('is-stuck'); }
    else if (stuck && y < 6) { stuck = false; el.topbar.classList.remove('is-stuck'); }
  };
  /* 大厅和浏览页都要接同一个滚动处理器：
     logo 收缩（.is-stuck）和玻璃下沿那条柔和暗部（.topbar::after）都挂在这个类上。
     之前只绑了 browse，新大厅滑了没反应 —— 这就是「灵魂没了」的原因。 */
  function bindTopbarScroll(viewEl) {
    viewEl.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; onScroll(viewEl.scrollTop); });
    }, { passive: true });
  }
  bindTopbarScroll(el.viewBrowse);
  bindTopbarScroll(el.viewHall);
  bindTopbarScroll(el.viewLab);
  /* 歌手页 / 专辑页也要接：不然滚过玻璃顶栏不折射（"灵魂没了"） */
  bindTopbarScroll(el.viewArtist);
  bindTopbarScroll(el.viewAlbum);
  /* 音效整页同理：漏了这一行，滚过顶栏时 logo 不收缩、玻璃没有下沿暗部 */
  bindTopbarScroll(el.viewAudio);
  /* 设置整页同理（以前是顶栏下的下拉面板，不存在「滚过顶栏」这回事） */
  bindTopbarScroll(el.viewSettings);
  /* 我的专辑（3D 陈列架）同理 */
  bindTopbarScroll(el.viewMyAlbums);
  /* 工具箱整页同理：滚动时 logo / 玻璃下沿暗部也要跟着变 */
  bindTopbarScroll(el.viewTools);

  /* ---- 进度条 / 音量条：指针拖拽 ---- */
  function bindBar(barEl, onRatio, opts = {}) {
    const vertical = !!opts.vertical;
    const ratioAt = (e) => {
      const r = barEl.getBoundingClientRect();
      /* 竖滑杆：上 = 100%，下 = 0 */
      const v = vertical
        ? (r.bottom - e.clientY) / r.height
        : (e.clientX - r.left) / r.width;
      return Math.max(0, Math.min(1, v));
    };
    barEl.addEventListener('pointerdown', (e) => {
      barEl.setPointerCapture(e.pointerId);
      onRatio(ratioAt(e));
      const move = (ev) => onRatio(ratioAt(ev));
      const up = () => {
        barEl.removeEventListener('pointermove', move);
        barEl.removeEventListener('pointerup', up);
      };
      barEl.addEventListener('pointermove', move);
      barEl.addEventListener('pointerup', up);
    });
    // 键盘可达：拖动条也要能用方向键（竖条用上下）
    barEl.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const cur = barEl === el.bar
        ? (Player.audio.duration ? Player.audio.currentTime / Player.audio.duration : 0)
        : Player.volume;
      const inc = vertical ? 'ArrowUp' : 'ArrowRight';
      const dec = vertical ? 'ArrowDown' : 'ArrowLeft';
      if (e.key === inc) { e.preventDefault(); onRatio(Math.min(1, cur + step)); }
      if (e.key === dec) { e.preventDefault(); onRatio(Math.max(0, cur - step)); }
    });
  }

  bindBar(el.bar, (r) => {
    Player.seek(r * (Player.audio.duration || 0));
    el.barFill.style.width = r * 100 + '%';
  });
  bindBar(el.vol, (r) => {
    Player.setVolume(r);
    el.volFill.style.width = r * 100 + '%';
  });

  /* ---- 播放页的传输排 ----
     传输排不自己实现一遍播放逻辑：直接代理到播放条里那几个按钮，
     这样"哪首在播 / 什么模式"永远只有一份状态。
     （旧版 #now-tabs 那套 pane 切换已随 UI 删除；队列入口见抽屉里的 btn-queue） */
  const queueBox = el.queue;

  const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  /* 队列列表：数据就是 Player.state.queue，点一行 playQueue。
     行用 div[role=button] 而不是 <button>：行里要放艺人/专辑的 <a>，
     交互元素嵌套在原生 button 里是非法 HTML，浏览器会把内层链接拆出去、
     点击区域也跟着错位。role=button 的 Enter / 空格由下面的 keydown 补齐。 */
  function renderQueue() {
    if (!queueBox) return;
    const q = Player.state.queue || [];
    updateQueueCount();
    if (!q.length) {
      queueBox.innerHTML = '<p class="hint">还没有队列</p>';
      return;
    }
    const cur = Player.state.index;
    queueBox.innerHTML = q.map((t, i) => `
      <div class="qrow${i === cur ? ' is-on' : ''}" data-i="${i}" role="button" tabindex="0"
           ${i === cur ? 'aria-current="true"' : ''}>
        <span class="qrow__i">${i === cur ? '▶' : String(i + 1).padStart(2, '0')}</span>
        <span class="qrow__t">
          <span class="qrow__n">${escapeHtml(t.name || '')}</span>
          <span class="qrow__a">${artistLinks(t.artists, t.artistIds)}</span>
        </span>
        <span class="qrow__d">${t.duration ? fmtTime(t.duration / 1000) : ''}</span>
      </div>`).join('');
  }

  /* 点一行 / 键盘回车 = 播这一首。playQueue 会 emit trackchange，
     面板开着时那边会自己重排，所以这里不重复 render。 */
  function playQueueRow(row) {
    const i = Number(row.dataset.i);
    const q = Player.state.queue || [];
    if (!Number.isInteger(i) || i < 0 || i >= q.length) return;
    Player.playQueue(q, i);
  }
  if (queueBox) {
    queueBox.addEventListener('click', (e) => {
      const row = e.target.closest('.qrow');
      if (!row) return;
      /* 行里的艺人名 / 专辑名是独立入口：点它只该开艺人页，不能顺带播这首。
         document 捕获阶段那个代理已经 stopPropagation 了，这是第二道闸。 */
      if (e.target.closest('a, [data-aid], [data-alb]')) return;
      playQueueRow(row);
    });
    queueBox.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const row = e.target.closest('.qrow');
      if (!row || e.target !== row) return;      // 焦点在行内艺人链上时归链接自己
      e.preventDefault();
      e.stopPropagation();                       // 别让全局「空格=播放/暂停」再处理一遍
      playQueueRow(row);
    });
  }
  /* Esc：队列开着就先收回歌词。用捕获阶段跑在全局那个「Esc 离开播放页」
     之前，否则整页会被切走。焦点回「控制」—— 抽屉已收起，别留在隐藏的行上。 */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (view !== 'now' || queueBox.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    setQueuePane(false);
    const back = $('btn-drawer');
    if (back && back.focus) back.focus();
  }, true);
  /* 点传输排 = 点隐藏的播放条按钮 */
  const ntrProxy = { 'ntr-mode': 'btn-mode', 'ntr-prev': 'btn-prev', 'ntr-play': 'btn-play', 'ntr-next': 'btn-next' };
  Object.keys(ntrProxy).forEach((id) => {
    const b = $(id);
    if (!b) return;
    b.addEventListener('click', () => { const t = $(ntrProxy[id]); if (t) t.click(); });
  });
  /* ---- 播放页底部那条渐变进度 ----
     没有槽、没有把手、没有时间数字：只有"走过的那一段"被 clip-path 揭开。
     拖拽/点击/键盘都还能用，只是看不见控件。 */
  function paintDock(r) {
    const p = Math.max(0, Math.min(1, Number(r) || 0));
    if (el.dockPaint) el.dockPaint.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
    if (el.dockBar) {
      el.dockBar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      el.dockBar.classList.toggle('is-on', p > 0.002);
      const head = el.dockBar.querySelector('.dock__head');
      if (head) head.style.transform = 'translateX(' + (p * el.dockBar.clientWidth - head.offsetWidth / 2).toFixed(1) + 'px)';
    }
  }
  function syncDock() {
    const d = Player.audio.duration || 0;
    paintDock(d > 0 ? (Player.audio.currentTime || 0) / d : 0);
  }
  bindBar(el.dockBar, (r) => {
    Player.seek(r * (Player.audio.duration || 0));
    dockShown = r;
    paintDock(r);
  });

  /* --------------------------------------------------------------------------
     逐帧推进 —— "丝滑"的关键
     time 事件是 250ms 一次，直接用它画进度就是"每 1/4 秒跳一格"。
     这里用 rAF 读 audio.currentTime（它本身连续），再叠一个很轻的阻尼，
     seek / 切歌的跳变也会被抹平；顺带每帧同步音量滑杆。
     -------------------------------------------------------------------------- */
  var dockRaf = 0, dockShown = 0, volShown = -1;
  function tickNow() {
    const dur = Player.audio.duration || 0;
    const target = dur > 0 ? Math.min(1, Math.max(0, (Player.audio.currentTime || 0) / dur)) : 0;
    if (Math.abs(target - dockShown) < 0.0005) dockShown = target;
    else dockShown += (target - dockShown) * 0.32;
    paintDock(dockShown);

    dockRaf = requestAnimationFrame(tickNow);
  }
  function startNowLoop() {
    if (dockRaf) return;
    dockShown = 0;
    syncDock();
    dockRaf = requestAnimationFrame(tickNow);
  }
  function stopNowLoop() {
    if (dockRaf) cancelAnimationFrame(dockRaf);
    dockRaf = 0;
  }

  /* 播放页的音量滑杆已按用户要求删除（音量仍可在播放条上调） */

  /* dock 左侧那个正方形封面：点一下 = 播放 / 暂停（dock 里没有别的按钮） */
  if (el.dockArt) el.dockArt.addEventListener('click', () => Player.toggle());

  /* 触屏：底部 dock 平时收成一条细线，手指按住才弹出，松手立刻收回。
     拖动进度时 dock 是展开的（pointerup 才收），桌面没有 touch-ui、不绑这组事件。 */
  if (TOUCH_HUD && el.dock) {
    const peekDock = () => el.dock.classList.add('is-peek');
    const restDock = () => el.dock.classList.remove('is-peek');
    el.dock.addEventListener('pointerdown', peekDock, { passive: true });
    addEventListener('pointerup', restDock, { passive: true });
    addEventListener('pointercancel', restDock, { passive: true });
    /* 键盘 / 读屏聚焦时也展开，不然焦点落在看不见的条上 */
    el.dock.addEventListener('focusin', peekDock);
    el.dock.addEventListener('focusout', restDock);
  }
  /* 封面点一下就是播放/暂停（整页没有别的地方可点） */
  if (el.disc) {
    el.disc.addEventListener('click', () => Player.toggle());
    el.disc.style.cursor = 'pointer';
    el.disc.setAttribute('role', 'button');
    el.disc.setAttribute('tabindex', '0');
    el.disc.setAttribute('aria-label', '播放 / 暂停');
    el.disc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Player.toggle(); }
    });
  }

  /* ================================================================== *
   * 播放器事件
   * ================================================================== */
  Player.on('trackchange', ({ track, index }) => {
    /* 大厅巨幅封面 = 上一首播放的歌，换歌就记一笔 */
    Hall.saveTrack(track);
    el.npName.textContent = track.name;
    el.npArtist.innerHTML = track.album
      ? `${artistLinks(track.artists, track.artistIds)} · ${albumLink(track.album, track.albumId)}`
      : artistLinks(track.artists, track.artistIds);
    el.nowTitle.textContent = track.name;
    el.nowSub.innerHTML = track.album
      ? `${artistLinks(track.artists, track.artistIds)} · ${albumLink(track.album, track.albumId)}`
      : artistLinks(track.artists, track.artistIds);

    const art = track.cover ? API.img(track.cover, 500) : null;
    if (art) {
      el.npCover.src = API.img(track.cover, 120);
      el.npCover.hidden = false;
      el.nowArt.src = art;
      if (el.dockCover) el.dockCover.src = API.img(track.cover, 200);
      /* 背景那层模糊封面：和播放页大图同源（500px），免得两处取色/裁切不一致 */
      if (el.nowBg) el.nowBg.style.backgroundImage = 'url("' + art + '")';
    } else {
      el.npCover.hidden = true;
      el.nowArt.removeAttribute('src');
      if (el.dockCover) el.dockCover.removeAttribute('src');
      if (el.nowBg) el.nowBg.style.backgroundImage = '';
    }
    markCurrent(index);
    updateQueueCount();                     // 队列长度 / 当前曲目变了，抽屉里的计数要跟上
    if (queueBox && !queueBox.hidden) renderQueue();
    applyArtwork(track);
    /* 铺色态开着时，底色跟着新封面渐变过去（自定义色 / 平台色模式下内部会 no-op） */
    Hall.recolor(track);
    beatUI.reset();          // 换歌后节拍要重新估
    // 形态页浮层里的当前歌曲：封面 / 歌名 / 歌手·专辑
    {
      const n = $('stage-name'), s = $('stage-sub');
      const img = $('stage-cover'), ph = $('stage-cover-ph');
      if (n) n.textContent = track.name;
      if (s) s.textContent = `${track.artists || ''}${track.album ? ' · ' + track.album : ''}`;
      if (img) {
        if (track.cover) {
          img.src = API.img(track.cover, 160);
          img.hidden = false;
          if (ph) ph.hidden = true;
        } else {
          img.removeAttribute('src');
          img.hidden = true;
          if (ph) ph.hidden = false;
        }
      }
    }
    StageHost.refresh();
    document.title = `${track.name} · ${track.artists}`;
  });

  Player.on('playstate', (playing) => {
    setIcon(el.btnPlay, playing ? ICONS.pause : ICONS.play);
    el.btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
    /* 大厅海报的播放键也跟着播放状态切三角 / 均衡条 */
    Hall.syncPlayButton();
    /* 播放页的大封面：悬停时的播放/暂停图标跟着状态换 */
    if (el.disc) el.disc.classList.toggle('is-playing', playing);
    document.body.classList.toggle('is-playing', playing);
    /* 播放键不再换图标：三角/双条由 CSS 的 d 形变完成（见 app.css） */
    StageHost.onPlaying(playing);
  });

  Player.on('time', ({ cur, total }) => {
    el.tCur.textContent = fmtTime(cur);
    el.tTotal.textContent = fmtTime(total);
    if (total > 0) el.barFill.style.width = (cur / total) * 100 + '%';
    paintDock(total > 0 ? cur / total : 0);
    Player.lyricAt(cur);
    StageHost.onTime({ cur, total });
  });

  Player.on('buffer', (end) => {
    const total = Player.audio.duration || 0;
    if (total > 0) el.barBuf.style.width = Math.min(100, (end / total) * 100) + '%';
  });

  Player.on('lyric', (payload) => {
    renderLyric(payload);
    StageHost.refresh();          // 歌词到位后把时间轴推给舞台
  });

  /* 各音源在角标/文案里的叫法（和搜索那行、设置里那行保持一致） */
  const SOURCE_LABEL = {
    netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗音乐', qishui: '汽水音乐', bodian: '波点音乐', spotify: 'Spotify',
  };

  Player.on('source', ({ demo, track, reason, preview }) => {
    const who = SOURCE_LABEL[track.source] || SOURCE_LABEL.netease;
    /* 试听片段：有声音，但只有 30~60 秒（QQ 匿名 / 汽水未登录 / 波点未登录都是这样）。
       必须说清楚 —— 不然用户只会觉得"这首歌怎么放到一半停了"。 */
    if (preview && !demo) {
      el.badge.hidden = false;
      el.badge.textContent = '试听片段';
      el.badge.title = `《${track.name}》是 ${who} 的试听片段：这个账号（未登录或没有会员）只能听一小段。`;
      el.badge.classList.remove('is-action');
      return;
    }
    if (!demo) {
      el.badge.hidden = true;
      el.badge.classList.remove('is-action');
      return;
    }
    el.badge.hidden = false;
    /* 说清楚"为什么放不了"。
       以前只写「演示音轨」，用户看到的是"音乐播不了"，却不知道为什么 ——
       绝大多数情况是 VIP 专属 / 要登录，登录就能解决，所以给一个可点的入口。 */
    if (reason === 'vip') {
      el.badge.textContent = 'VIP 专属 · 点此登录';
      el.badge.title = `《${track.name}》是 VIP 专属歌曲，登录后才能播放。现在放的是演示音轨。`;
      el.badge.classList.add('is-action');
    } else if (reason === 'network') {
      el.badge.textContent = '网络异常';
      el.badge.title = '取播放地址时网络失败，已用演示音轨代替。';
      el.badge.classList.remove('is-action');
    } else if (reason === 'login') {
      // 酷狗：匿名播放被风控挡（上游 20028「本次请求需要验证」），必须登录
      el.badge.textContent = `${who} · 需登录`;
      el.badge.title = `《${track.name}》在 ${who} 需要登录才能拿到播放地址（匿名会被风控拦），点设置里的音源去扫码。`;
      el.badge.classList.remove('is-action');
    } else if (reason === 'region') {
      el.badge.textContent = `${who} · 仅中国大陆网络`;
      el.badge.title = `《${track.name}》在 ${who} 受地区限制（上游 407），只有中国大陆网络能播。`;
      el.badge.classList.remove('is-action');
    } else if (reason === 'drm') {
      el.badge.textContent = `${who} · 本期不接音频`;
      el.badge.title = `${who} 的音频要 Premium + node-librespot 原生二进制，且属解密 DRM 的灰区；本期只做元数据。`;
      el.badge.classList.remove('is-action');
    } else if (track.source && track.source !== 'netease') {
      el.badge.textContent = `${who} · 没有可用地址`;
      el.badge.title = `《${track.name}》在 ${who} 既没有正片也没有试听链接（未登录 / 地区限制 / 版权）。`;
      el.badge.classList.remove('is-action');
    } else {
      el.badge.textContent = '无版权 · 演示音轨';
      el.badge.title = `《${track.name}》没有取到播放地址（无版权或已下架），已用演示音轨代替，歌词与进度正常。`;
      el.badge.classList.remove('is-action');
    }
  });

  // VIP 提示点一下就能登录
  el.badge.addEventListener('click', () => {
    if (el.badge.classList.contains('is-action')) openModal();
  });

  Player.on('sourceerror', () => {
    el.badge.hidden = false;
    el.badge.textContent = '播放失败';
    el.badge.title = '音频加载失败，可能是网络或版权限制。';
  });

  /* ================================================================== *
   * 启动
   * ================================================================== */
  (async function boot() {
    el.volFill.style.width = Player.volume * 100 + '%';
    setLyricMode(lyricMode);           // 初始化歌词动画模式（固定经典）
    el.viewNow.classList.add('has-beats');   // 节拍条默认是展开的
    // 窄屏默认收起节拍器：屏幕太窄，展开会压住歌词；顶栏「节拍」按钮随时可以调出来
    if (window.innerWidth <= 900 && !el.beats.classList.contains('is-off')) beatUI.toggle();

    /* 先把大厅挂出来，再去拉网络数据。以前这两个 await（登录态 / 歌单 / 搜索）
       放在 show('hall') 前面：只要其中一个接口迟迟不回（登录态下 userPlaylists
       卡住，或服务器连上了但不响应），整个大厅就停在空白——顶栏和播放条是静态的
       照样在，只有中间的入口卡和平台方块永远画不出来。视图切换跟网络无关，不能等它。 */
    if (location.hash === '#now') show('now');
    else show('hall');        // 大厅是入口；下面 ?stage= 的深链会覆盖它

    try {
      const s = await API.session();
      if (s.loggedIn) {
        profile = s.profile;
        paintAccount();        // 启动时同步设置页账号块（顶栏登录位已删）
        const lists = await API.userPlaylists(profile.userId);
        const mine = lists.playlists.filter((p) => !p.subscribed);
        const sub = lists.playlists.filter((p) => p.subscribed);
        renderPlaylists([...mine, ...sub]);
        Hall.refreshMe();
      }
    } catch { /* 匿名可用 */ }

    if (!profile) {
      // 主面板默认展示卡力老虎的歌（用户指定），拿不到再退回搜索热歌
      try {
        const d = await API.search('卡力老虎', 50);
        el.plName.textContent = '卡力老虎';
        el.plSub.textContent = `未登录 · 共 ${d.songCount || d.tracks.length} 首 · 登录后可见你的歌单`;
        el.plCover.hidden = true;
        renderTracks(d.tracks);
      } catch {
        el.plSub.textContent = '无法连接服务端，请确认 node server.mjs 正在运行';
        el.tracks.innerHTML = '<p class="hint">载入失败</p>';
      }
    }

    /* 深链：`?stage=005` 直接进那个形态。
       并行精修时一个标签页钉一个形态，刷新也不会跳回默认页；
       形态 id 就是 STAGES 里的 id（001…060 / classic）。 */
    const wantStage = new URLSearchParams(location.search).get('stage');
    if (wantStage) {
      const s = STAGES.find((x) => x.id === wantStage);
      if (s) applyStage(s.id);
    }

    // 布局稳定后重建贴图（挂载时若有元素尺寸未定，这一步纠正）
    requestAnimationFrame(() => setTimeout(() => LiquidGlass.refresh(), 300));
  })();

  /* ==========================================================================
     桌面壳：新版本小提示条 + 设置页「检查更新」
     - 浏览器版没有 window.__desktop：整块跳过，按钮保持 hidden
     - 主进程只在窗口可见时推 update:available；收进托盘时它自己弹原生对话框
     - 同一版本本次运行只提示一次（关掉 / 点过任意按钮后不再弹）
     ========================================================================== */
  (function initDesktopUpdate() {
    const desktop = window.__desktop;
    if (!desktop || !desktop.isDesktop || !desktop.update) return;

    const toast = document.getElementById('upd-toast');
    const verEl = document.getElementById('upd-ver');
    const closeBtn = document.getElementById('upd-close');
    const panBtn = document.getElementById('upd-pan');
    const panBdBtn = document.getElementById('upd-pan-bd');
    const ghBtn = document.getElementById('upd-gh');
    const nowBtn = document.getElementById('upd-now');
    const checkBtn = document.getElementById('set-check-update');
    const stateEl = document.getElementById('set-upd-state');
    const versionEl = document.getElementById('set-app-version');

    /* 本次运行只提示一次：sessionStorage 让页面重载后也不重复弹，
       关掉窗口 / 退出应用后清空。 */
    const SEEN_KEY = 'lizi.update.seen';
    let seenVersion = '';
    try { seenVersion = sessionStorage.getItem(SEEN_KEY) || ''; } catch { /* 隐私模式 */ }
    let checking = false;
    let stateTimer = 0;

    /* opts.preview：只看样式用，不记「已提示过」，
       所以预览完刷新页面还能再看一次，也不会影响真实的新版本提示。 */
    function showUpdate(version, opts) {
      const v = version ? String(version) : '';
      if (!v || !toast) return;
      if (!(opts && opts.preview)) {
        if (v === seenVersion) return;
        seenVersion = v;
        try { sessionStorage.setItem(SEEN_KEY, v); } catch { /* 隐私模式 */ }
      }
      if (verEl) verEl.textContent = 'v' + v;
      toast.hidden = false;
    }

    function closeToast() {
      if (toast) toast.hidden = true;
    }

    function setState(text, tone) {
      if (!stateEl) return;
      stateEl.textContent = text || '';
      if (tone) stateEl.dataset.tone = tone;
      else delete stateEl.dataset.tone;
      clearTimeout(stateTimer);
      if (text) stateTimer = setTimeout(() => {
        stateEl.textContent = '';
        delete stateEl.dataset.tone;
      }, 3200);
    }

    /* 主进程推来的新版本（窗口可见时才有） */
    if (typeof desktop.update.onAvailable === 'function') {
      desktop.update.onAvailable((info) => {
        if (info && info.version) showUpdate(info.version);
      });
    }

    /* 预览：地址栏带 ?upd=1.0.1 时直接亮出提示条。桌面壳里用
       LIZI_UPDATE_PREVIEW=1.0.1 启动会自动把这个参数带上（见 desktop/main.js），
       浏览器里也能直接开 http://127.0.0.1:<端口>/?upd=1.0.1 看样式。 */
    let previewVersion = '';
    try {
      previewVersion = new URLSearchParams(location.search).get('upd') || '';
    } catch { /* 老内核没有 URLSearchParams */ }
    if (previewVersion) showUpdate(previewVersion, { preview: true });

    if (closeBtn) closeBtn.addEventListener('click', closeToast);
    if (panBtn) panBtn.addEventListener('click', () => {
      desktop.update.open('pan');
      closeToast();
    });
    if (panBdBtn) panBdBtn.addEventListener('click', () => {
      desktop.update.open('pan-bd');
      closeToast();
    });
    if (ghBtn) ghBtn.addEventListener('click', () => {
      desktop.update.open('github');
      closeToast();
    });
    if (nowBtn) nowBtn.addEventListener('click', () => {
      desktop.update.download();
      closeToast();
    });

    /* 设置页：显示真实版本号 + 检查更新按钮（仅桌面壳） */
    if (versionEl) {
      desktop.update.version().then((v) => {
        if (v) versionEl.textContent = String(v);
      }).catch(() => { /* 读不到就保留 HTML 里的默认值 */ });
    }
    if (!checkBtn) return;
    checkBtn.hidden = false;

    checkBtn.addEventListener('click', async () => {
      if (checking) return;
      checking = true;
      checkBtn.disabled = true;
      checkBtn.textContent = '检查中…';
      setState('');
      try {
        const r = await desktop.update.check();
        const status = r && r.status;
        if (status === 'available') {
          showUpdate(r.version);
          /* 提示条已经关过（同一版本本次运行不再弹）时，至少在按钮旁给个结果 */
          if (!toast || toast.hidden) setState(`发现新版本 v${r.version}`, 'ok');
        } else if (status === 'latest') {
          setState('已是最新', 'ok');
        } else if (status === 'dev') {
          setState('开发环境不检查更新', 'muted');
        } else {
          setState('检查失败，稍后再试', 'err');
        }
      } catch {
        setState('检查失败，稍后再试', 'err');
      } finally {
        checking = false;
        checkBtn.disabled = false;
        checkBtn.textContent = '检查更新';
      }
    });
  })();

  /* ==========================================================================
     安卓壳：新版本居中弹窗 + 设置页「检查更新」
     - 只认 window.__liziAndroid && window.__liziNative（MainActivity 里
       addJavascriptInterface("__liziNative")）；桌面 / 浏览器整块跳过，
       桌面提示条仍由上面的 initDesktopUpdate 管，两者互不影响
     - 启动后延迟 6s 查一次 GitHub Release；localStorage 节流 12 小时
     - 同一版本关掉后不再弹（记 dismissed 版本）；网络失败 / 已是最新都静默
     - 设置页按钮复用同一条检查逻辑，结果写在 #set-upd-state
     ========================================================================== */
  (function initAndroidUpdate() {
    if (!window.__liziAndroid) return;
    const native = window.__liziNative;
    if (!native || typeof native.version !== 'function'
        || typeof native.openExternal !== 'function') return;

    const API_URL = 'https://api.github.com/repos/woshi32s/liziair/releases/latest';
    const PAN_URL = 'https://pan.quark.cn/s/6c6e65f3ee4c';
    const PAN_BAIDU_URL = 'https://pan.baidu.com/s/1crtOz-RxF6YyKLn9uxykWQ?pwd=lizi';
    const GH_URL = 'https://github.com/woshi32s/liziair/releases/latest';
    const LS_LAST = 'lizi.android.update.lastCheck';
    const LS_DISMISSED = 'lizi.android.update.dismissed';
    const CHECK_EVERY = 12 * 60 * 60 * 1000;   /* 12 小时 */
    const BOOT_DELAY = 6000;                   /* 启动后 6 秒再查，避开首屏 */

    const modal = document.getElementById('upd-modal');
    const modalVer = document.getElementById('upd-modal-ver');
    const modalClose = document.getElementById('upd-modal-close');
    const modalPan = document.getElementById('upd-modal-pan');
    const modalPanBd = document.getElementById('upd-modal-pan-bd');
    const modalGh = document.getElementById('upd-modal-gh');
    const checkBtn = document.getElementById('set-check-update');
    const stateEl = document.getElementById('set-upd-state');
    const versionEl = document.getElementById('set-app-version');

    let checking = false;
    let stateTimer = 0;
    let currentVersion = '';

    /* ---------- 版本号：按 x.y.z 的数字逐段比，不做字符串比 ---------- */
    function localVersion() {
      try {
        const v = native.version();
        return v ? String(v).trim().replace(/^v/i, '') : '';
      } catch { return ''; }
    }
    function parseVersion(v) {
      return String(v || '').trim().replace(/^v/i, '')
        .split(/[.+-]/).slice(0, 3)
        .map((n) => { const x = parseInt(n, 10); return Number.isFinite(x) ? x : 0; });
    }
    function compareVersions(a, b) {
      const A = parseVersion(a);
      const B = parseVersion(b);
      for (let i = 0; i < 3; i++) {
        const x = A[i] || 0;
        const y = B[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
      }
      return 0;
    }

    /* ---------- localStorage 节流 ---------- */
    function markChecked() {
      try { localStorage.setItem(LS_LAST, String(Date.now())); } catch { /* 隐私模式 */ }
    }
    function dismissedVersion() {
      try { return localStorage.getItem(LS_DISMISSED) || ''; } catch { return ''; }
    }
    function shouldAutoCheck() {
      let last = 0;
      try { last = Number(localStorage.getItem(LS_LAST) || 0) || 0; } catch { /* 隐私模式 */ }
      return !last || Date.now() - last >= CHECK_EVERY;
    }

    /* ---------- 检查 GitHub Release ---------- */
    async function checkLatest() {
      const local = localVersion();
      if (!local) return { status: 'error' };
      /* 先记时间再请求：失败也算「检查过」，保证 12 小时内不会反复重试；
         手动检查不受节流限制，仍然随时可用。 */
      markChecked();
      let resp;
      try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : 0;
        try {
          resp = await fetch(API_URL, {
            headers: { Accept: 'application/vnd.github+json' },
            cache: 'no-store',
            signal: ctrl ? ctrl.signal : undefined,
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch {
        return { status: 'error' };   /* 离线 / 被墙 / 超时：静默 */
      }
      if (!resp || !resp.ok) return { status: 'error' };
      let data;
      try { data = await resp.json(); } catch { return { status: 'error' }; }
      const tag = data && (data.tag_name || data.name);
      if (!tag) return { status: 'error' };
      const remote = String(tag).trim().replace(/^v/i, '');
      if (!remote) return { status: 'error' };
      return compareVersions(remote, local) > 0
        ? { status: 'available', version: remote, local }
        : { status: 'latest', local };
    }

    /* ---------- 居中弹窗 ---------- */
    function showModal(version) {
      const v = String(version || '');
      if (!v || !modal) return false;
      if (v === dismissedVersion()) return false;
      currentVersion = v;
      if (modalVer) modalVer.textContent = 'v' + v;
      modal.hidden = false;
      return true;
    }
    function closeModal() {
      if (modal) modal.hidden = true;
      if (currentVersion) {
        try { localStorage.setItem(LS_DISMISSED, currentVersion); } catch { /* 隐私模式 */ }
      }
    }
    function openExternal(url) {
      try { native.openExternal(url); } catch { /* 桥调用失败就当没点 */ }
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();   /* 点遮罩关闭 */
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modalPan) modalPan.addEventListener('click', () => {
      openExternal(PAN_URL);
      closeModal();
    });
    if (modalPanBd) modalPanBd.addEventListener('click', () => {
      openExternal(PAN_BAIDU_URL);
      closeModal();
    });
    if (modalGh) modalGh.addEventListener('click', () => {
      openExternal(GH_URL);
      closeModal();
    });

    /* ---------- 设置页：版本号 + 检查更新 ---------- */
    function setState(text, tone) {
      if (!stateEl) return;
      stateEl.textContent = text || '';
      if (tone) stateEl.dataset.tone = tone;
      else delete stateEl.dataset.tone;
      clearTimeout(stateTimer);
      if (text) stateTimer = setTimeout(() => {
        stateEl.textContent = '';
        delete stateEl.dataset.tone;
      }, 4000);
    }

    if (versionEl) {
      const v = localVersion();
      if (v) versionEl.textContent = v;
    }
    if (checkBtn) {
      checkBtn.hidden = false;
      checkBtn.addEventListener('click', async () => {
        if (checking) return;
        checking = true;
        checkBtn.disabled = true;
        checkBtn.textContent = '检查中…';
        setState('');
        try {
          const r = await checkLatest();
          if (r.status === 'available') {
            /* 同一版本已经关过：不再弹窗，只在按钮旁给结果（和桌面壳一致） */
            if (!showModal(r.version)) setState(`发现新版本 v${r.version}`, 'ok');
          } else if (r.status === 'latest') {
            setState('已是最新', 'ok');
          } else {
            setState('检查失败，稍后再试', 'err');
          }
        } catch {
          setState('检查失败，稍后再试', 'err');
        } finally {
          checking = false;
          checkBtn.disabled = false;
          checkBtn.textContent = '检查更新';
        }
      });
    }

    /* ---------- 自动检查：延迟启动，失败 / 已是最新都静默 ---------- */
    setTimeout(() => {
      if (checking || !shouldAutoCheck()) return;
      checkLatest().then((r) => {
        if (r && r.status === 'available') showModal(r.version);
      }).catch(() => { /* 静默 */ });
    }, BOOT_DELAY);
  })();

  /* 设置 → 关于：QQ 群一行（桌面 / 安卓 / 浏览器都用同一份设置页）。
     桌面壳没有通用 openExternal：window.open 会被主进程的
     setWindowOpenHandler 转给系统浏览器；安卓壳直接走 __liziNative。 */
  (function initQqGroupRow() {
    const row = document.getElementById('set-qq-group');
    if (!row) return;
    const QQ_GROUP_URL = 'https://qm.qq.com/q/nITZnfZadc';
    row.addEventListener('click', () => {
      const native = window.__liziNative;
      if (native && typeof native.openExternal === 'function') {
        try { native.openExternal(QQ_GROUP_URL); return; } catch { /* 桥调用失败退回 window.open */ }
      }
      window.open(QQ_GROUP_URL, '_blank', 'noopener');
    });
  })();
})();
