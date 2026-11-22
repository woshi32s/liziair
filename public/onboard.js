/* ==========================================================================
   开场引导（v7 强实战版）
   --------------------------------------------------------------------------
   一条链路，出口只有两个：
     欢迎 LOGO —— 变形照播，页面停住做一次二选一：
       「我会用，直接进」→ 写 seen（step 9）收尾，回大厅正常用；
       「带我走一遍」→ 进选平台，此后只能靠点真实目标走完，没有跳过 /
         Esc / 点遮罩退出，也不再有 8 秒自动推进。
     1 欢迎 LOGO
     2 平台多选 —— 平台行从底部依次浮起，可勾多家；「登录」勾了才可用；
        「先不登录，继续」是登录分支，继续走后面的步骤，不是退出引导
     3 登录 —— 按勾选顺序复用 LIZI_LOGIN_GUIDE：切设置页 → 圈出那一行 →
        叫出二维码；旁边常驻「我已完成」，随时收尾（登录分支，不是退出）
     4 大厅跑马带（#hall-marq）  —— 真拖过 / 点任意卡片 / 换过曲目即过
     5 来源选择器（#hall-plat-bar）—— 铺色态左上角，点开滚轮换音源；
        没开铺色态（未登录 / 普通大厅）时整步自动跳过
     6 大厅海报（#hall-hero）    —— 点封面进播放页（body[data-view] = now）
     7 播放页「控制」（#btn-drawer）
     8 抽屉「进入形态」（#btn-stage）
     9 形态列表（点任意一项真的进舞台，停 1.2s 回大厅接最后一步）
    10 大厅左侧竖键（.hall-sidekeys，四枚键逐个标名字）

   第 4、5 步在铺色态和普通大厅都成立：普通大厅由 app.js 把公开流喂进
   同一个 #hall-marq（匿名 personalized），跑马带可见、可拖、可播。
   海报里没有可放的歌（#hall-hero-cover-img 无 src）时第 5 步跳过。
   每个聚光灯步骤目标拿不到都往后跳，不空指、不卡死。

   聚光灯是四块纯色面板拼出的镂空（rgba 黑，不用 backdrop-filter /
   blur，不用大面积 box-shadow 动画）：只过渡 opacity。整层
   pointer-events:none —— 遮罩 / 白圈 / 标签 / 卡片全是只读的，
   孔里直接拖跑马带、点真按钮；拖拽期间孔会跟随并多留 DRAG_PAD，
   卡片 / 光标仍不重排。

   状态存 localStorage['lizi.tour.v5']：{seen:true, step:0..10, flow:3}，
   step = 正在走的阶段（0 欢迎 … 9 侧键，10 = 完成）。重看时未完成的
   从该阶段接着走；已完成的从头再看。旧 v5 记录（四步聚光灯 / 9 步链路）
   没有 flow:3，按「已看过」处理，不把老用户丢到新链路的半路。
   读写的 try/catch：隐私模式 / 坏值都不能把 onboard.js 带崩。
   ========================================================================== */

const LIZI_TOUR = (() => {
  const KEY = 'lizi.tour.v5';
  /* 2026-11-22：这一版引导还没完善，首次启动 / 打开应用不自动弹。
     设置页「引导」入口照旧可以手动打开；以后要恢复自动弹，把这里改回 true。 */
  const AUTO_START = false;
  const HOLE_PAD = 8;       // 高亮孔比目标大一圈
  const DRAG_PAD = 12;      // 拖动跑马带时孔再多留一圈，盖住容器起步位移
  const STAGE_COUNT = 10;

  const STAGE = {
    WELCOME: 0, PICK: 1, LOGIN: 2,
    MARQ: 3, SOURCE: 4, HERO: 5, CTRL: 6, BTN: 7, LIST: 8, SIDE: 9,
  };
  const STAGE_NAMES = ['欢迎', '选平台', '登录', '跑马带', '来源',
    '海报', '控制', '进形态', '形态列表', '侧键'];

  let state = readState();

  /* 全屏层：欢迎页和选平台页共用 #tour 外壳 */
  let root, pageWelcome, pagePick, walkBtn, directBtn, pickList, loginBtn, skipPlatsBtn;
  let deviceBox, deviceLine, deviceApply;
  let overlay = false, phase = 0;       // 0 欢迎 / 1 选平台
  let fadeTimer = 0, pageTimer = 0, handoffTimer = 0;
  let chosen = [];                      // 勾选的平台 id，按点击顺序
  let awaitingLogin = false;            // 已交棒给 LIZI_LOGIN_GUIDE
  let loginSucceeded = false;           // 登录队列里至少有一家扫码成功过

  /* 聚光灯层 */
  let coach, shadeEls = [], ring, cursorEl, card;
  let ckStep, ckTitle, ckDesc, tagsBox;
  let coaching = false;
  let step = 0;
  let entryView = 'hall';
  let drawerTouched = false, listTouched = false, barTouched = false;
  let bypass = false;       // 程序替用户点的那一下不算用户动手
  let cursorSnapped = false;
  let keepTimer = 0;
  let laters = [];
  let rafQueued = false;
  let marqBase = '';        // 跑马带开始时的队列签名
  let marqPt = null;        // 跑马带拖动起点（只用横向位移做判定）
  let marqDragged = false;  // 这次手势是否真的横向拖过 40px
  let marqDone = false;
  let lastHoleAt = 0;       // 拖动期间孔重画的节流时间戳

  /* 完成页：第 9 步走完后停一拍再浮现 */
  let doneEl, doneBtn, doneTimer = 0;

  /* --------------------------------------------------------------------------
     进度读写
     -------------------------------------------------------------------------- */
  function readState() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const n = raw ? Number(raw.step) : NaN;
      /* flow 2 = 这条「欢迎 → 多选登录 → 跑马带/海报 → 控制/形态/侧键」新链路。
         旧 v5 记录（四步聚光灯，step 4 = 已走完）语义不同：按「已看过」处理，
         重看从头开始，不把老用户丢到半路。 */
      const seen = !!(raw && raw.seen);
      if (seen && raw.flow !== 3) return { seen, step: STAGE_COUNT };
      return {
        seen,
        step: n >= 0 && n <= STAGE_COUNT ? Math.floor(n) : 0,
      };
    } catch {
      /* 值坏掉 / 隐私模式读不到：当成全新用户。
         一段开场不能因为存储异常把整个 onboard.js 带崩。 */
      return { seen: false, step: 0 };
    }
  }

  function writeState() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        seen: !!state.seen, step: state.step, flow: 3,
      }));
    } catch { /* 隐私模式：本次只走内存 */ }
  }

  function markSeen() {
    state.seen = true;
    writeState();
    paintSettingsRow();
  }

  function saveStep(n) {
    state.step = Math.max(0, Math.min(STAGE_COUNT, n));
    writeState();
    paintSettingsRow();
  }

  /* --------------------------------------------------------------------------
     小工具：视图切换 / 真实元素定位 / 延时（可统一清掉）
     -------------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const viewNow = () => document.body.dataset.view || 'hall';

  function showView(v) {
    if (!v || viewNow() === v) return;
    /* nav.js 的 go() 也是这么切的：派事件，app.js 里统一走 show() */
    try {
      document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: v } }));
    } catch { /* 老内核 */ }
  }

  /* 目标必须真实可见：display:none / 移出视口（抽屉收起时整块滑出屏外）
     都算拿不到，调用方按缺失处理，绝不空指。 */
  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const b = el.getBoundingClientRect();
    if (!b || b.width < 2 || b.height < 2) return null;
    if (b.right <= 0 || b.left >= window.innerWidth
      || b.bottom <= 0 || b.top >= window.innerHeight) return null;
    return b;
  }

  function later(ms, fn) {
    const t = setTimeout(() => {
      const i = laters.indexOf(t);
      if (i >= 0) laters.splice(i, 1);
      fn();
    }, ms);
    laters.push(t);
    return t;
  }

  function clearLaters() {
    for (const t of laters) clearTimeout(t);
    laters = [];
  }

  function drawerOpen() {
    const d = $('drawer');
    return !!(d && d.classList.contains('is-open'));
  }

  function listOpen() {
    const l = $('drawer-stage-list');
    return !!(l && !l.hidden);
  }

  /* 程序替用户点的那一下：bypass 让捕获监听忽略它，避免叠成两次推进 */
  function bypassClick(el) {
    if (!el) return;
    bypass = true;
    try { el.click(); } catch { /* noop */ }
    bypass = false;
  }

  function visibleKeys() {
    const out = [];
    const nav = document.querySelector('.hall-sidekeys');
    if (!nav) return out;
    for (const el of nav.querySelectorAll('.srail__i')) {
      if (rectOf(el)) out.push(el);
    }
    return out;
  }

  /* 顶栏平时是藏着的：加上 nowbar-on 让「控制」浮出来。
     app.js 里有个 2.6s 无操作收起的计时，keepTimer 每秒会补一次。 */
  function keepBar() {
    if (!coaching || viewNow() !== 'now') return;
    if (!document.body.classList.contains('nowbar-on')) {
      document.body.classList.add('nowbar-on');
      barTouched = true;
    }
  }

  /* 铺色态到底开没开：三个类名/显隐一起看，账号刷新到一半的「半切」不算。 */
  function platModeOn() {
    const plat = $('hall-plat'), hall = $('view-hall'), rail = $('hall-rail');
    if (!plat || plat.hidden) return false;
    if (hall && !hall.classList.contains('is-plat-mode')) return false;
    if (rail && !rail.classList.contains('is-plat')) return false;
    return true;
  }

  /* 当前在放什么歌：用来兜底判定「跑马带里挑过歌」。Player 是 player.js
     的顶层 const，裸标识符能直接引；没加载时返回空串。 */
  function queueSig() {
    try {
      if (typeof Player === 'undefined' || !Player || !Player.state) return '';
      const q = Player.state.queue || [];
      const cur = q[Player.state.index];
      return cur && cur.id ? String(cur.id) : '';
    } catch { return ''; }
  }

  /* --------------------------------------------------------------------------
     欢迎页 / 选平台页
     -------------------------------------------------------------------------- */
  function resetWelcomeAnim() {
    if (!pageWelcome) return;
    pageWelcome.classList.add('is-reset');
    void pageWelcome.offsetWidth;
    pageWelcome.classList.remove('is-reset');
  }

  function showWelcome() {
    if (!overlay) return;
    phase = 0;
    root.classList.remove('is-pick');
    clearTimeout(pageTimer);
    if (pagePick) {
      pagePick.hidden = true;
      pagePick.classList.remove('is-live');
      pagePick.setAttribute('aria-hidden', 'true');
    }
    if (!pageWelcome) return;
    pageWelcome.hidden = false;
    pageWelcome.setAttribute('aria-hidden', 'false');
    pageWelcome.classList.remove('is-live');
    resetWelcomeAnim();
    requestAnimationFrame(() => {
      if (!overlay || phase !== 0) return;
      pageWelcome.classList.add('is-live');
    });
    /* 变形照播，但不再自动交棒：停在这里等「带我走一遍 / 直接进」 */
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function plateRows() {
    const accounts = Array.isArray(window.LIZI_ACCOUNTS) ? window.LIZI_ACCOUNTS : [];
    const G = window.LIZI_LOGIN_GUIDE;
    const plats = (G && G.PLATFORMS) ? G.PLATFORMS : [];
    const fromGuide = accounts.length ? accounts : plats;
    return fromGuide.map((a) => {
      const p = plats.find((x) => x.id === a.id) || {};
      const on = G && typeof G.loggedIn === 'function' ? G.loggedIn(a.id) : false;
      return {
        id: a.id,
        name: a.name || p.name || a.id,
        logo: p.logo || '',
        how: on ? '已登录 · 这家可以跳过' : (p.how || '登录后同步歌单与收藏'),
        on: !!on,
      };
    });
  }

  function buildPlateList() {
    if (!pickList) return;
    chosen = [];
    const rows = plateRows();
    if (!rows.length) {
      pickList.innerHTML = '<p class="tour__pickempty">没有可选的平台，先逛逛也行。</p>';
      syncLoginBtn();
      return;
    }
    pickList.innerHTML = rows.map((p, i) => `
      <button class="tour__plat" type="button" data-id="${esc(p.id)}"
              aria-pressed="false" style="--i:${i}">
        <span class="tour__platlogo">${p.logo
          ? `<img src="${esc(p.logo)}" alt="">`
          : `<b>${esc(String(p.name).slice(0, 1))}</b>`}</span>
        <span class="tour__plattxt"><b>${esc(p.name)}</b><i>${esc(p.how)}</i></span>
        <span class="tour__platcheck" aria-hidden="true">✓</span>
      </button>`).join('');
    syncLoginBtn();
  }

  function syncLoginBtn() {
    if (!loginBtn) return;
    loginBtn.disabled = chosen.length === 0;
    loginBtn.textContent = chosen.length ? '登录 · ' + chosen.length + ' 家' : '登录';
  }

  function showPickPage() {
    if (!overlay || phase === 1) return;
    phase = 1;
    markSeen();
    saveStep(STAGE.PICK);
    buildPlateList();
    root.classList.add('is-pick');
    if (pageWelcome) {
      pageWelcome.classList.remove('is-live');
      pageWelcome.setAttribute('aria-hidden', 'true');
      pageTimer = setTimeout(() => {
        if (overlay && phase === 1 && pageWelcome) pageWelcome.hidden = true;
      }, 280);
    }
    if (!pagePick) return;
    pagePick.hidden = false;
    pagePick.setAttribute('aria-hidden', 'false');
    pagePick.classList.remove('is-live');
    void pagePick.offsetWidth;
    requestAnimationFrame(() => {
      if (!overlay || phase !== 1) return;
      pagePick.classList.add('is-live');
      const first = pickList && pickList.querySelector('.tour__plat');
      if (first) {
        try { first.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    });
  }

  /* 欢迎页二选一：
     · 带我走一遍 → 进选平台；从此不能退出，只能靠真实目标走完第 9 步
     · 我会用，直接进 → 写 seen（step 9）收尾，回大厅正常用 */
  function enterDirect() {
    if (!overlay) return;
    markSeen();
    saveStep(STAGE_COUNT);
    closeOverlay(false);
    showView('hall');
  }

  function closeOverlay(restore) {
    if (!overlay) return;
    overlay = false;
    phase = 0;
    clearTimeout(pageTimer);
    clearTimeout(handoffTimer);
    clearTimeout(fadeTimer);
    if (root) root.classList.remove('is-on', 'is-pick');
    fadeTimer = setTimeout(() => {
      if (overlay || !root) return;
      root.hidden = true;
      if (pageWelcome) {
        pageWelcome.hidden = false;
        pageWelcome.classList.remove('is-live');
        pageWelcome.setAttribute('aria-hidden', 'false');
      }
      if (pagePick) {
        pagePick.hidden = true;
        pagePick.classList.remove('is-live');
        pagePick.setAttribute('aria-hidden', 'true');
      }
    }, 320);
    if (restore && viewNow() !== entryView) showView(entryView);
  }

  function skipPlatforms() {
    if (!overlay) return;
    markSeen();
    saveStep(STAGE.MARQ);
    loginSucceeded = false;
    closeOverlay(false);
    enterHall();
  }

  function beginLogin(ids) {
    if (!ids || !ids.length) { skipPlatforms(); return; }
    markSeen();
    saveStep(STAGE.LOGIN);
    loginSucceeded = false;
    awaitingLogin = true;
    closeOverlay(false);
    const launch = (tries) => {
      if (!awaitingLogin) return;
      const G = window.LIZI_LOGIN_GUIDE;
      if (!G || typeof G.open !== 'function') {
        if (tries < 12) { setTimeout(() => launch(tries + 1), 100); return; }
        awaitingLogin = false;
        enterHall();
        return;
      }
      if (G.active) {
        try { G.close(); } catch { /* noop */ }
      }
      const started = G.open(true, ids, { fromTour: true, onDone: onLoginDone });
      /* 登录引导没接住（DOM 缺失 / 另一层正占着）：别在这里干等，
         退回大厅接着走后面几步。 */
      if (started === false && awaitingLogin) {
        awaitingLogin = false;
        enterHall();
      }
    };
    setTimeout(() => launch(0), 260);
  }

  function onLoginDone(did) {
    if (!awaitingLogin) return;
    loginSucceeded = !!did;
    awaitingLogin = false;
    enterHall();
  }

  function enterHall() {
    if (coaching || overlay) return;
    clearTimeout(handoffTimer);
    showView('hall');
    handoffTimer = setTimeout(() => {
      if (coaching || overlay || awaitingLogin) return;
      beginCoach(0);
    }, 340);
  }

  /* --------------------------------------------------------------------------
     六步定义：ensure 只做前置动作（都查 DOM 状态再动手，幂等），target 取
     真实元素。没有 onNext —— 每一步只能由用户点/拖真实目标来推进。
     -------------------------------------------------------------------------- */
  const STEPS = [
    {
      kicker: '第 4 / 10 步 · 点这里',
      title: '整条跑马带都能拖',
      desc: '按住往左右拖，挑一首；点任意一首卡片也会直接播。',
      ensure(done) {
        showView('hall');
        const t0 = performance.now();
        const tick = () => {
          if (!coaching) return;
          const m = $('hall-marq');
          const pub = $('hall-public');
          const live = platModeOn() || !!(pub && !pub.hidden && m && pub.contains(m));
          if (live && rectOf(m) && m.querySelector('.marq__card')) {
            marqBase = queueSig();
            marqPt = null;
            marqDragged = false;
            marqDone = false;
            return done(true);
          }
          /* 普通大厅的公开流要等 app.js 挪 DOM / 取匿名数据（首屏网络可能慢）；
             刚登录过也一并多给时间。等不到就跳过第 4、5 步。 */
          if (performance.now() - t0 > 6000) return done(false);
          later(280, tick);
        };
        tick();
      },
      target: () => $('hall-marq'),
    },
    {
      kicker: '第 5 / 10 步 · 点这里',
      title: '左上角这里，能换音源',
      desc: '铺色态左上角的平台名就是来源选择器，点一下展开滚轮：换平台、换歌单、每日推荐都在这里。',
      /* 没开铺色态（未登录 / 普通大厅）时这一步没有目标：optional 让 goStep
         直接跳到下一步，不空指、不把用户卡在这里。 */
      optional: true,
      ensure(done) {
        showView('hall');
        later(320, () => {
          if (!coaching) return;
          if (!platModeOn()) return done(false);
          const bar = $('hall-plat-bar');
          done(!!bar && !!rectOf(bar));
        });
      },
      target: () => $('hall-plat-bar'),
    },
    {
      kicker: '第 6 / 10 步 · 点这里',
      title: '点这张封面，进传统播放器',
      desc: '海报就是刚挑的那首歌，点一下会飞进播放页。',
      ensure(done) {
        showView('hall');
        const t0 = performance.now();
        const tick = () => {
          if (!coaching) return;
          const pub = $('hall-public');
          if (!platModeOn() && !(pub && !pub.hidden)) return done(false);
          const img = $('hall-hero-cover-img');
          /* 只认真的写进 src 的图：没有 src 时 img.src 会回落到页面地址，
             拿它判断会把「海报里没歌」误判成有封面。
             刚点完跑马带时封面可能还在路上，最多等 4s。 */
          if (img && img.getAttribute('src')) {
            const hero = $('hall-hero');
            return done(!!hero && !!rectOf(hero));
          }
          if (performance.now() - t0 > 4000) return done(false);
          later(280, tick);
        };
        tick();
      },
      target: () => $('hall-hero'),
    },
    {
      kicker: '第 7 / 10 步 · 点这里',
      title: '右上角这个「控制」',
      desc: '顶栏平时藏着，现在是亮着的，直接点它。',
      ensure(done) {
        showView('now');
        later(350, () => {
          if (!coaching) return;
          /* 抽屉若开着，先收起来：用户这一下点的是「打开」 */
          if (drawerOpen()) {
            drawerTouched = true;
            bypassClick($('btn-drawer'));
          }
          keepBar();
          if (rectOf($('btn-drawer'))) return done(true);
          /* 视图还没切过来：再等一拍，还没有就放弃 */
          later(500, () => {
            if (!coaching) return;
            keepBar();
            done(!!rectOf($('btn-drawer')));
          });
        });
      },
      target: () => $('btn-drawer'),
    },
    {
      kicker: '第 8 / 10 步 · 点这里',
      title: '点这里进形态',
      desc: '抽屉里「工具」那一行，点「进入形态」就会展开真正的形态列表。',
      ensure(done) {
        /* 重看从这一步接上时可能还停在大厅/设置：先把播放页切过来，
           等视图落定再开抽屉，避免点一个还没露面的按钮。 */
        showView('now');
        later(350, () => {
          if (!coaching) return;
          if (!drawerOpen()) {
            drawerTouched = true;
            bypassClick($('btn-drawer'));
          }
          later(450, () => {
            if (!coaching) return;
            if (!drawerOpen()) return done(false);
            /* 列表若已经开着，先收起来：用户这一下点的是「展开」 */
            if (listOpen()) {
              listTouched = true;
              bypassClick($('btn-stage'));
            }
            later(320, () => {
              if (!coaching) return;
              done(!!rectOf($('btn-stage')));
            });
          });
        });
      },
      target: () => $('btn-stage'),
    },
    {
      kicker: '第 9 / 10 步 · 点这里',
      title: '随便点一个名字，舞台就换上了',
      desc: '列表是真的，点任意一项就直接进舞台；看一眼后回大厅收尾。',
      ensure(done) {
        showView('now');
        later(350, () => {
          if (!coaching) return;
          if (!drawerOpen()) {
            drawerTouched = true;
            bypassClick($('btn-drawer'));
          }
          later(400, () => {
            if (!coaching) return;
            if (!drawerOpen()) return done(false);
            if (!listOpen()) {
              listTouched = true;
              bypassClick($('btn-stage'));
            }
            later(400, () => {
              if (!coaching) return;
              const l = $('drawer-stage-list');
              const items = l ? l.querySelectorAll('.stage-item') : [];
              done(listOpen() && items.length > 0 && !!rectOf(l));
            });
          });
        });
      },
      target: () => $('drawer-stage-list'),
    },
    {
      kicker: '第 10 / 10 步 · 点这里',
      title: '大厅左边这排竖键',
      desc: '四个入口：我的喜欢 · 形态长廊 · 我的专辑 · 工具箱，点任意一枚试试。',
      ensure(done) {
        showView('hall');
        later(450, () => done(visibleKeys().length >= 2));
      },
      target: () => document.querySelector('.hall-sidekeys'),
    },
  ];

  /* 离开播放页去大厅：抽屉是 app.js 在 show() 里顺手收的，
     这里只处理列表展开态，保证下次打开抽屉是收好的。 */
  function leaveNow() {
    if (listTouched && listOpen()) bypassClick($('btn-stage'));
    if (drawerOpen()) bypassClick($('btn-drawer'));
    showView('hall');
  }

  /* --------------------------------------------------------------------------
     聚光灯：四块面板拼出镂空，只过渡 opacity；位置直接写 style
     -------------------------------------------------------------------------- */
  function setBox(el, x, y, w, h) {
    if (!el) return;
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    el.style.width = Math.max(0, Math.round(w)) + 'px';
    el.style.height = Math.max(0, Math.round(h)) + 'px';
  }

  function paintCard() {
    const s = STEPS[step];
    ckStep.textContent = s.kicker;
    ckTitle.textContent = s.title;
    ckDesc.textContent = s.desc;
    tagsBox.innerHTML = '';
    /* 换步先藏卡片和光标，等 locate 定好位再露：不闪在左上角 */
    card.classList.remove('is-placed');
    if (cursorEl) cursorEl.classList.remove('is-placed');
    /* 光标先悄悄落到卡片上（无过渡），再滑向目标：第一下不横穿全屏 */
    cursorSnapped = false;
  }

  function placeCard(hole, W, H) {
    const cw = Math.min(300, W - 24);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight || 170;
    let top = hole.bottom + 14;
    if (top + ch > H - 12) top = hole.top - ch - 14;
    if (top < 12) top = 12;
    let left = hole.left;
    if (left + cw > W - 12) left = W - cw - 12;
    if (left < 12) left = 12;
    card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    if (!cursorSnapped && cursorEl) {
      /* 卡片刚定好位：光标先跳到卡片上沿中间，再过渡滑向目标 */
      cursorEl.classList.add('is-jump');
      cursorEl.style.transform =
        `translate3d(${Math.round(left + cw / 2)}px, ${Math.round(top)}px, 0)`;
      void cursorEl.offsetWidth;
      cursorEl.classList.remove('is-jump');
      cursorSnapped = true;
    }
  }

  function placeCursor(hole) {
    if (!cursorEl) return;
    cursorEl.style.transform =
      `translate3d(${Math.round(hole.right + 10)}px, ${Math.round(hole.bottom + 2)}px, 0)`;
  }

  /* 最后一步：四枚键的名字逐个标在轨道右边，位置都从真实 rect 量 */
  function paintTags() {
    tagsBox.innerHTML = '';
    const keys = visibleKeys();
    if (!keys.length) return;
    const W = window.innerWidth;
    for (const el of keys) {
      const b = el.getBoundingClientRect();
      const tag = document.createElement('span');
      tag.className = 'coach__tag';
      tag.textContent = el.getAttribute('aria-label') || el.title || el.dataset.side || '';
      tagsBox.appendChild(tag);
      const tw = tag.offsetWidth || 60, th = tag.offsetHeight || 20;
      let x = Math.round(b.right) + 8;
      /* 右边没地方就挪到键的左边，不盖住键本身 */
      if (x + tw > W - 8) x = Math.max(8, Math.round(b.left) - tw - 6);
      tag.style.transform =
        `translate3d(${x}px, ${Math.round(b.top + b.height / 2 - th / 2)}px, 0)`;
    }
  }

  /* 按目标 rect 和留白算孔（clamp 到视口），写四块遮罩和细白圈。
     只碰遮罩/圈，卡片和光标由 locate 另行摆位。 */
  function paintHole(r, pad) {
    const W = window.innerWidth, H = window.innerHeight;
    const hole = {
      left: Math.max(0, Math.round(r.left) - pad),
      top: Math.max(0, Math.round(r.top) - pad),
      right: Math.min(W, Math.round(r.right) + pad),
      bottom: Math.min(H, Math.round(r.bottom) + pad),
    };
    setBox(shadeEls[0], 0, 0, W, hole.top);
    setBox(shadeEls[1], 0, hole.top, hole.left, hole.bottom - hole.top);
    setBox(shadeEls[2], hole.right, hole.top, W - hole.right, hole.bottom - hole.top);
    setBox(shadeEls[3], 0, hole.bottom, W, H - hole.bottom);
    setBox(ring, hole.left, hole.top, hole.right - hole.left, hole.bottom - hole.top);
    return hole;
  }

  function locate() {
    if (!coaching) return;
    /* 拖跑马带期间：卡片 / 光标仍不重排，但孔要跟住容器并多留 DRAG_PAD。
       拖动开始那一下跑马带容器布局约有 16px 位移，冻结的孔会落到卡片上。
       这里只更新孔，避免拖动时卡片和光标抖。 */
    if (step === 0 && marqPt) {
      const r = rectOf(STEPS[0].target());
      if (r) paintHole(r, HOLE_PAD + DRAG_PAD);
      return;
    }
    /* 用户离开了本步的视图：不退出引导，重新把本步需要的视图叫回来；
       跑马带/海报两步里如果已经进了播放页，直接接第 6 步。 */
    const want = (step <= 2 || step === 6) ? 'hall' : 'now';
    if (viewNow() !== want) {
      if (step <= 2 && viewNow() === 'now') { goStep(3); return; }
      goStep(step);
      return;
    }
    /* 跑马带兜底：队列换过歌（点卡片播了）也算挑过 */
    if (step === 0 && marqBase && !marqDone) {
      const sig = queueSig();
      if (sig && sig !== marqBase) { marqDoneNow(); return; }
    }
    const el = STEPS[step].target();
    const r = rectOf(el);
    if (!r) {
      /* 目标丢了（比如抽屉被 Esc 收了）：重跑本步 ensure 拿回来，
         拿不回就按缺失那条路走，不空指。 */
      goStep(step);
      return;
    }
    const W = window.innerWidth, H = window.innerHeight;
    const hole = paintHole(r, HOLE_PAD);
    placeCard(hole, W, H);
    placeCursor(hole);
    card.classList.add('is-placed');
    if (cursorEl) cursorEl.classList.add('is-placed');
    if (step === 6) paintTags();
    else tagsBox.innerHTML = '';
  }

  function queueLocate() {
    if (!coaching || rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      locate();
    });
  }

  /* --------------------------------------------------------------------------
     状态机：只由用户点/拖真实目标推进，没有自动计时，也没有人为中止入口
     -------------------------------------------------------------------------- */
  function goStep(n) {
    if (!coaching) return;
    if (n >= STEPS.length) { complete(true, true); return; }
    step = n;
    saveStep(STAGE.MARQ + n);
    paintCard();
    STEPS[n].ensure((ok) => {
      if (!coaching || step !== n) return;
      if (!ok) {
        /* 可跳过的步骤（来源选择器只在铺色态里存在）直接接下一步 */
        if (STEPS[n].optional) { goStep(n + 1); return; }
        /* 目标不存在：往后跳。跑马带/来源/海报没有 → 直接去播放页；
           播放页的控制/抽屉/列表任一缺失 → 去大厅侧键；侧键也没有 → 收尾。 */
        if (n <= 2) { goStep(3); return; }
        if (n <= 5) { goStep(6); return; }
        complete(true);
        return;
      }
      const t = STEPS[n].target();
      if (t) {
        try { t.scrollIntoView({ block: 'nearest' }); } catch { /* 老内核 */ }
      }
      later(250, () => {
        if (!coaching || step !== n) return;
        locate();
      });
    });
  }

  /* 走完第 9 步：留在用户点到的目的地，干净收尾。
     celebrate 时晚 260ms 再浮出完成页，让聚光灯先收完。
     teardown 的 clearLaters 清不到这个 setTimeout，所以单独存在 doneTimer。
     abort() 只给外部 close() 做兜底清理，界面上没有任何入口会走到它。 */
  function complete(keep, celebrate) {
    if (!coaching) return;
    saveStep(STAGE_COUNT);
    teardown(keep ? null : entryView);
    if (celebrate) {
      clearTimeout(doneTimer);
      doneTimer = setTimeout(showDone, 260);
    }
  }

  /* 完成页：只在引导确实收完之后出现；这期间又开了引导 / 登录层就不叠层。 */
  function showDone() {
    if (!doneEl) return;
    if (overlay || awaitingLogin || coaching) return;
    doneEl.hidden = false;
    void doneEl.offsetWidth;
    requestAnimationFrame(() => {
      if (!doneEl) return;
      if (overlay || awaitingLogin || coaching) { doneEl.hidden = true; return; }
      doneEl.classList.add('is-on');
      if (doneBtn) {
        try { doneBtn.focus({ preventScroll: true }); } catch { /* 老内核 */ }
      }
    });
  }

  function closeDone() {
    if (!doneEl || doneEl.hidden || !doneEl.classList.contains('is-on')) return;
    doneEl.classList.remove('is-on');
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      doneTimer = 0;
      if (doneEl) doneEl.hidden = true;
    }, 280);
  }

  function abort() {
    if (!coaching) return;
    saveStep(STAGE.MARQ + step);
    teardown(entryView);
  }

  function teardown(restoreView) {
    coaching = false;
    clearInterval(keepTimer);
    clearLaters();
    coach.classList.remove('is-on');
    const c = coach;
    setTimeout(() => { if (!coaching) c.hidden = true; }, 240);
    /* 还原我们动过的界面：列表 → 抽屉 → 顶栏类，按实际状态收 */
    if (listTouched && listOpen()) bypassClick($('btn-stage'));
    if (drawerTouched && drawerOpen()) bypassClick($('btn-drawer'));
    if (barTouched) document.body.classList.remove('nowbar-on');
    drawerTouched = listTouched = barTouched = false;
    marqPt = null;
    marqDragged = false;
    marqDone = false;
    tagsBox.innerHTML = '';
    if (restoreView && viewNow() !== restoreView) showView(restoreView);
  }

  function beginCoach(n) {
    if (!entryView) entryView = viewNow();
    drawerTouched = listTouched = barTouched = false;
    bypass = false;
    coaching = true;
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    coach.hidden = false;
    coach.classList.remove('is-on');
    void coach.offsetWidth;
    requestAnimationFrame(() => {
      if (!coaching) return;
      coach.classList.add('is-on');
      /* 每秒补一次：顶栏类的 2.6s 收起计时 + 窗口/滚动后的位置 */
      clearInterval(keepTimer);
      keepTimer = setInterval(() => {
        if (!coaching) return;
        keepBar();
        locate();
      }, 1000);
      goStep(step);
    });
    paintSettingsRow();
  }

  /* 用户点了真实按钮：不拦（真实逻辑照走），只推进状态机。
     捕获跑在 app 的 toggle 监听之前，所以不等 click 本体，
     等一拍看 DOM 是不是真变了再推进，避免和程序代点叠成两次。 */
  function onDocClick(e) {
    if (!coaching || bypass) return;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (step === 0) {
      if (t.closest('#hall-marq .marq__card')) {
        later(200, () => { if (coaching && step === 0) { marqDone = true; goStep(1); } });
        return;
      }
      return;
    }
    if (step === 1) {
      /* 来源选择器：点左上角平台长条就展开滚轮，点到即算学会入口 */
      if (t.closest('#hall-plat-bar')) {
        later(300, () => {
          if (coaching && step === 1) goStep(2);
        });
      }
      return;
    }
    if (step === 2) {
      /* 点海报（不含里面自带的按钮/链接）→ 等 FLIP 切到播放页再推进 */
      if (t.closest('#hall-hero') && !t.closest('a,button')) {
        later(450, () => {
          if (coaching && step === 2 && viewNow() === 'now') goStep(3);
        });
      }
      return;
    }
    if (step === 3 && t.closest('#btn-drawer')) {
      /* 用户自己点开的也算我们动过：中途退出时要负责收回去 */
      drawerTouched = true;
      later(120, () => {
        if (!coaching || step !== 3) return;
        if (drawerOpen()) goStep(4);
      });
      return;
    }
    if (step === 4 && t.closest('#btn-stage')) {
      listTouched = true;
      later(400, () => {
        if (!coaching || step !== 4) return;
        if (listOpen()) goStep(5);
        else goStep(4);
      });
      return;
    }
    /* 形态列表：点任意一项/随机都真的进舞台。让舞台先露个面（1.2s），
       再回大厅接最后一步「侧键」—— 不打完就走，也不把用户一直留在舞台里。 */
    if (step === 5 && (t.closest('#drawer-stage-list .stage-item')
      || t.closest('#drawer-stage-list .dstages__random'))) {
      later(1200, () => {
        if (!coaching || step !== 5) return;
        leaveNow();
        goStep(6);
      });
      return;
    }
    if (step === 6 && t.closest('.hall-sidekeys .srail__i')) { complete(true, true); return; }
  }

  /* 跑马带：用户真的横向拖过 40px，就算「挑过」。不用 is-drag 的
     起停时序（类名松手就摘掉，来不及在轮询里看到）；自己记起点。 */
  function marqDoneNow() {
    if (!coaching || step !== 0 || marqDone) return;
    marqDone = true;
    goStep(1);
  }

  function onMarqDown(e) {
    if (!coaching || step !== 0) return;
    if (!e.target || !e.target.closest || !e.target.closest('#hall-marq')) return;
    marqPt = { x: e.clientX };
    marqDragged = false;
    /* 立刻按拖动态（多留 DRAG_PAD）重画一次，并从这一下重新计时 */
    lastHoleAt = 0;
    queueLocate();
  }

  function onMarqMove(e) {
    if (!marqPt || !coaching || step !== 0) return;
    if (Math.abs(e.clientX - marqPt.x) > 40) marqDragged = true;
    /* 孔要跟住容器：节流到最多每 120ms 重画一次，不跟每个 pointermove 跑 */
    const now = performance.now();
    if (now - lastHoleAt > 120) { lastHoleAt = now; queueLocate(); }
  }

  /* 松手才换步：拖动过程中就把聚光灯挪走会很跳。真正横向拖过 40px
     的这一次手势按「挑过」处理（点卡片则走 click 分支）。
     没形成拖动的手势（轻点）松手后把孔收回正常留白。 */
  function onMarqUp() {
    const dragged = marqDragged;
    marqPt = null;
    marqDragged = false;
    if (dragged) marqDoneNow();
    else if (coaching && step === 0) queueLocate();
  }

  /* --------------------------------------------------------------------------
     设置页那行 / 打开
     -------------------------------------------------------------------------- */
  function paintSettingsRow() {
    const val = document.getElementById('set-tour');
    if (!val) return;
    if (!state.seen) val.textContent = '还没看过';
    else if (state.step >= STAGE_COUNT) val.textContent = '已看过';
    else {
      const name = STAGE_NAMES[state.step] || '';
      val.textContent = '上次走到「' + name + '」 · 第 ' + (state.step + 1) + ' / ' + STAGE_COUNT + ' 步';
    }
  }

  function open() {
    if (!root || overlay || coaching || awaitingLogin) return;

    /* 完成页还留着（刚走完就点「重看」）：立即收掉，别和欢迎层叠着 */
    clearTimeout(doneTimer);
    doneTimer = 0;
    if (doneEl) {
      doneEl.classList.remove('is-on');
      doneEl.hidden = true;
    }

    /* 登录引导正开着时又点「重看」：先收掉登录层，别叠两层 */
    if (window.LIZI_LOGIN_GUIDE && window.LIZI_LOGIN_GUIDE.active) {
      try { window.LIZI_LOGIN_GUIDE.close(); } catch { /* noop */ }
    }

    /* 重新读一次：另一个窗口 / 标签页可能刚改过 */
    state = readState();
    entryView = viewNow();
    chosen = [];
    loginSucceeded = false;

    /* 已经走到聚光灯阶段：直接从那一阶段接上，不再重放欢迎/选平台 */
    const resume = state.seen && state.step > 0 && state.step < STAGE_COUNT
      ? state.step : 0;
    if (resume >= STAGE.MARQ) {
      markSeen();
      beginCoach(resume - STAGE.MARQ);
      return;
    }

    overlay = true;
    phase = 0;
    root.hidden = false;
    root.classList.remove('is-on', 'is-pick');
    if (pageWelcome) {
      pageWelcome.hidden = false;
      pageWelcome.classList.remove('is-live');
    }
    if (pagePick) {
      pagePick.hidden = true;
      pagePick.classList.remove('is-live');
    }
    void root.offsetWidth;
    requestAnimationFrame(() => {
      if (!overlay) return;
      root.classList.add('is-on');
      /* 上次停在选平台/登录：直接进选平台页；否则从头播欢迎动画 */
      if (resume >= STAGE.PICK) showPickPage();
      else showWelcome();
    });
    paintSettingsRow();
  }

  /* 首次启动自动弹一次：等大厅进入第一屏再开，避免和 WebGL 首帧抢时间。
     10 秒还没等到（非大厅启动）也照开，不能因为视图不对就永远不弹。 */
  function maybeAutoStart() {
    if (state.seen) return;
    let ticks = 0;
    const timer = setInterval(() => {
      /* 登录引导正开着（手动重看 / 开场引导的登录段）：等它收尾再弹开场，
         别用全屏层把人家正在扫的码盖掉。 */
      const G = window.LIZI_LOGIN_GUIDE;
      if (G && G.active) { ticks = 0; return; }
      ticks++;
      const ready = document.body.dataset.view === 'hall';
      if (!ready && ticks <= 40) return;
      clearInterval(timer);
      setTimeout(() => {
        if (!state.seen && !overlay && !coaching && !awaitingLogin
          && !(window.LIZI_LOGIN_GUIDE && window.LIZI_LOGIN_GUIDE.active)) open();
      }, 700);
    }, 250);
  }

  /* --------------------------------------------------------------------------
     设备配置推荐（2026-11-21）
     只在手机 / 触屏的欢迎页出现：读核心数 / 内存 / DPR / 屏幕分辨率给一条
     渲染比例 + 帧率建议。点了「用推荐设置」才写全局画质（lizi.picture.v1），
     不点完全不动，之后都能在 设置 → 画质 里改。
     -------------------------------------------------------------------------- */
  function paintDeviceCard() {
    deviceBox = document.getElementById('tour-device');
    deviceLine = document.getElementById('tour-device-line');
    deviceApply = document.getElementById('tour-device-apply');
    if (!deviceBox || !deviceLine || !deviceApply) return;
    let coarse = false;
    try { coarse = matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
    if (!coarse && !window.__liziAndroid) return;   // 桌面不显示
    /* 已经动过全局画质（设置里改过或点过推荐）就不再打扰 */
    try { if (localStorage.getItem('lizi.picture.v1')) return; } catch { /* 隐私模式照常显示 */ }
    const P = window.LIZI_PICTURE;
    if (!P || typeof P.deviceProfile !== 'function') return;
    let prof = null;
    try { prof = P.deviceProfile(); } catch { prof = null; }
    if (!prof || !prof.rec) return;

    const tierName = prof.tier === 'low' ? '入门' : prof.tier === 'high' ? '旗舰' : '中端';
    const bits = [];
    if (prof.cores) bits.push(prof.cores + ' 核');
    if (prof.mem) bits.push(prof.mem + 'GB 内存');
    if (prof.longSide) bits.push(prof.longSide + 'px');
    deviceLine.textContent = '检测到' + tierName + '机型'
      + (bits.length ? '（' + bits.join(' · ') + '）' : '')
      + '，建议形态渲染 ' + Math.round(prof.rec.scale * 100) + '% · 帧率 '
      + (prof.rec.fps ? prof.rec.fps : '不限')
      + '。只在形态画面生效，之后可在设置 → 画质 里改。';
    deviceBox.hidden = false;
    deviceApply.addEventListener('click', () => {
      try { P.applyGlobal({ scale: prof.rec.scale, fps: prof.rec.fps }); } catch { /* 忽略 */ }
      deviceApply.textContent = '已应用';
      deviceApply.disabled = true;
    }, { once: true });
  }

  /* --------------------------------------------------------------------------
     初始化
     -------------------------------------------------------------------------- */
  function init() {
    root = document.getElementById('tour');
    if (!root) return;
    pageWelcome = root.querySelector('[data-page="0"]');
    pagePick = root.querySelector('[data-page="1"]');
    walkBtn = document.getElementById('tour-walk');
    directBtn = document.getElementById('tour-direct');
    pickList = document.getElementById('tour-plats');
    loginBtn = document.getElementById('tour-login');
    skipPlatsBtn = document.getElementById('tour-skip-plats');
    coach = document.getElementById('coach');
    if (!pageWelcome || !pagePick || !walkBtn || !directBtn || !pickList
      || !loginBtn || !skipPlatsBtn || !coach) return;
    shadeEls = Array.from(coach.querySelectorAll('.coach__shade'));
    ring = document.getElementById('coach-ring');
    cursorEl = document.getElementById('coach-cursor');
    card = document.getElementById('coach-card');
    ckStep = document.getElementById('coach-step');
    ckTitle = document.getElementById('coach-title');
    ckDesc = document.getElementById('coach-desc');
    tagsBox = document.getElementById('coach-tags');
    if (shadeEls.length !== 4 || !ring || !card || !ckStep || !tagsBox) return;

    /* 完成页：独立层，不在 #coach 里（teardown 会把 #coach 藏掉） */
    doneEl = document.getElementById('tour-done');
    doneBtn = document.getElementById('tour-done-go');
    if (doneBtn) doneBtn.addEventListener('click', closeDone);

    /* 欢迎页二选一：一个继续强制引导，一个直接收尾。没有第三个出口 */
    walkBtn.addEventListener('click', showPickPage);
    directBtn.addEventListener('click', enterDirect);
    loginBtn.addEventListener('click', () => {
      if (!loginBtn.disabled) beginLogin(chosen.slice());
    });
    /* 「先不登录，继续」：跳过登录分支，继续走后面的聚光灯 */
    skipPlatsBtn.addEventListener('click', skipPlatforms);
    pickList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b || !pickList.contains(b)) return;
      const id = b.dataset.id;
      const i = chosen.indexOf(id);
      if (i >= 0) chosen.splice(i, 1);
      else chosen.push(id);
      b.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
      syncLoginBtn();
    });

    document.addEventListener('click', onDocClick, true);
    window.addEventListener('resize', queueLocate);
    document.addEventListener('scroll', queueLocate, true);

    /* 跑马带拖动判定：起点 / 横向位移 / 松手，全在捕获阶段，不干扰 app.js */
    document.addEventListener('pointerdown', onMarqDown, true);
    document.addEventListener('pointermove', onMarqMove, true);
    document.addEventListener('pointerup', onMarqUp, true);
    document.addEventListener('pointercancel', onMarqUp, true);

    /* 点跑马带卡片、或播放器换了源，都算「挑过」 */
    try {
      if (typeof Player !== 'undefined' && Player && typeof Player.on === 'function') {
        Player.on('source', () => {
          if (coaching && step === 0) {
            later(120, () => {
              if (coaching && step === 0) { marqDone = true; goStep(1); }
            });
          }
        });
      }
    } catch { /* Player 还没就绪：还有点击 / 拖动 / 队列兜底 */ }

    const row = document.getElementById('row-tour');
    if (row) row.addEventListener('click', () => open());

    paintSettingsRow();
    paintDeviceCard();
    if (AUTO_START) maybeAutoStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  return {
    open,
    /* 给登录引导用的关闭：聚光灯就中止并还原视图；全屏层就退出；
       正等登录引导时由登录层自己收尾，这里不抢。 */
    close() {
      if (coaching) { abort(); return; }
      if (awaitingLogin) {
        awaitingLogin = false;
        if (window.LIZI_LOGIN_GUIDE && window.LIZI_LOGIN_GUIDE.active) {
          try { window.LIZI_LOGIN_GUIDE.close(); } catch { /* noop */ }
        }
        if (viewNow() !== entryView) showView(entryView);
        return;
      }
      if (!overlay) return;
      markSeen();
      closeOverlay(true);
    },
    get running() { return overlay || awaitingLogin || coaching; },
    get step() { return state.step; },
  };
})();

window.LIZI_TOUR = LIZI_TOUR;

/* ==========================================================================
   首次登录引导 —— 选平台 → 切设置页 → 圈出登录行 → 叫出二维码 → 等扫码
   --------------------------------------------------------------------------
   只模拟点击现有按钮（#set-account-login / #qq-login / …），不复制登录逻辑；
   也不改 app.js。只在开场引导、以及设置里的「重看登录引导」主动调用时出现。
   2026-11-22 修：删掉「第一次点登录就拦去选择层」的捕获监听 —— 设置页点
   登录必须直接叫出该平台自己的二维码，不能先弹引导界面。

   open(force, platformId, opts)：开场引导的「选平台 → 登录」会把勾选的平台
   排成队列传进来（platformId 可以是数组）。这时跳过多余的选择层，按顺序
   一家一家走同一个「切设置页 → 圈行 → 二维码」流程；一家完成/跳过就接
   下一家。登录层旁边常驻「我已完成」（#lguide-all），随时能收尾。
   opts.onDone 在队列结束（走完 / 我已完成 / Esc / 离开设置页）时回调一次，
   开场引导据此回大厅继续后面的聚光灯步骤；普通用法不传 opts，行为照旧。
   ========================================================================== */
const LIZI_LOGIN_GUIDE = (() => {
  const KEY = 'lizi.loginGuide.v1';

  const PLATFORMS = [
    { id: 'netease', name: '网易云音乐', logo: 'assets/platforms/netease.svg',
      how: '扫码登录，或粘贴 MUSIC_U Cookie',
      btn: 'set-account-login', state: 'set-account', row: '[data-src-row="netease"]' },
    { id: 'qq', name: 'QQ 音乐', logo: 'assets/platforms/qq.svg',
      how: '扫码登录（QQ 音乐 / QQ / 微信）',
      btn: 'qq-login', state: 'qq-state', row: '[data-src-row="qq"]' },
    { id: 'kugou', name: '酷狗音乐', logo: 'assets/platforms/kugou-mark.svg',
      how: '扫码登录 · 会弹出二维码面板',
      btn: 'kugou-login', state: 'kugou-state', row: '[data-src-row="kugou"]' },
    { id: 'qishui', name: '汽水音乐', logo: 'assets/platforms/qishui.svg',
      how: '扫码登录（抖音授权）· 需本机 Node 24',
      btn: 'qishui-login', state: 'qishui-state', row: '[data-src-row="qishui"]' },
    { id: 'bodian', name: '波点音乐', logo: 'assets/platforms/bodian.svg',
      how: '扫码登录 · 仅大陆网络',
      btn: 'bodian-login', state: 'bodian-state', row: '[data-src-row="bodian"]' },
  ];

  let root, panel, list, ring, tip, tipStep, tipTitle, tipDesc, tipDone, tipSkip, laterBtn, allBtn;
  let active = false, step = 0, chosen = null;
  let queue = [], qi = 0, queueOn = false, onDone = null, didLogin = false;
  let timers = [], poll = 0;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const after = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };
  const isShown = (el) => {
    if (!el || el.hidden || !el.getBoundingClientRect) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0.5 && b.height > 0.5;
  };

  const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
  const stateText = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.textContent || '').trim() : '';
  };
  /* 只有「确实登录着」才算。等待扫码（登录已在进行）也按已登录跳过引导；
     登录已失效 / 未登录 / 未连接 / 空文本一律算没登录。 */
  const loggedIn = (p) => {
    /* 也可以直接传平台 id（onboard 的选平台行只拿得到 id） */
    if (typeof p === 'string') p = PLATFORMS.find((x) => x.id === p);
    if (!p) return false;
    const t = stateText(p.state);
    if (!t) return false;
    if (t === '未登录' || t === '未连接' || t === '登录已失效') return false;
    return true;
  };
  /* 对外：至少有一家登录着（或大厅已在铺色态）。给开场引导判断
     「第 4、5 步有没有必要走」用。 */
  const signedIn = () => anyLoggedIn() || hallPlatActive();
  const anyLoggedIn = () => PLATFORMS.some(loggedIn);
  /* 状态文字在冷启动时可能还没刷出来（先显示「未连接」）。大厅进入铺色态
     本身就是「至少有一家登录过」的可靠信号，补这一条避免给已登录用户弹引导。 */
  const hallPlatActive = () => {
    const rail = document.getElementById('hall-rail');
    return !!(rail && rail.classList.contains('is-plat'));
  };
  const hasSession = () => anyLoggedIn() || hallPlatActive();

  /* 扫码成功要更严格：QQ / 酷狗 / 汽水 / 波点会先显示「等待扫码」，
     不能把等待当成已登录；网易云登录后直接显示昵称，只排掉「未登录」。 */
  const loggedInStrict = (p) => {
    const t = stateText(p.state);
    if (!t) return false;
    return p.id === 'netease' ? t !== '未登录' : t.startsWith('已登录');
  };

  function paintRows() {
    const el = document.getElementById('set-login-guide');
    if (el) el.textContent = seen() ? '已看过 · 可重看' : '还没看过';
  }

  function markSeen() {
    try { localStorage.setItem(KEY, '1'); } catch { /* 隐私模式 */ }
    paintRows();
  }

  function renderList() {
    if (!list) return;
    list.innerHTML = PLATFORMS.map((p) => `
      <button class="lguide__plat" type="button" data-plat="${p.id}">
        <span class="lguide__logo"><img src="${p.logo}" alt=""></span>
        <span class="lguide__txt"><b>${p.name}</b><i>${p.how}</i></span>
        <span class="lguide__go" aria-hidden="true">→</span>
      </button>`).join('');
  }

  function paintTip(n, title, desc, doneText, skipText) {
    if (!tip) return;
    tipStep.textContent = n;
    tipTitle.textContent = title;
    tipDesc.textContent = desc;
    tipDone.hidden = !doneText;
    if (doneText) tipDone.textContent = doneText;
    tipSkip.hidden = !skipText;
    if (skipText) tipSkip.textContent = skipText;
  }

  function placeTip(rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    /* 先露出来再量：hidden 时 offsetHeight 是 0，会落到一个不准的兜底值 */
    tip.hidden = false;
    const tw = tip.offsetWidth || 340;
    const th = tip.offsetHeight || 170;
    const m = 16, gap = 16;
    let left, top;
    if (rect) {
      left = clamp(rect.left, m, vw - tw - m);
      const below = rect.bottom + gap, above = rect.top - th - gap;
      if (below + th <= vh - m) top = below;
      else if (above >= m) top = above;
      else top = clamp(rect.bottom - th, m, vh - th - m);
      const overlapY = top < rect.bottom && top + th > rect.top;
      if (overlapY && left < rect.right && left + tw > rect.left) {
        const right = rect.right + gap, leftSide = rect.left - tw - gap;
        if (right + tw <= vw - m) left = right;
        else if (leftSide >= m) left = leftSide;
      }
    } else {
      left = vw - tw - 24;
      top = vh - th - 24;
    }
    /* 右上角常驻「我已完成」：提示卡别压到它身上，往下让出 130px */
    if (top < 130 && left + tw > vw - 200) top = 130;
    tip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    tip.hidden = false;
    tip.classList.add('is-on');
  }

  function locate(el) {
    if (!el || !isShown(el)) {
      ring.hidden = true;
      ring.classList.remove('is-on');
      placeTip(null);
      return;
    }
    const b = el.getBoundingClientRect();
    const pad = 6;
    ring.hidden = false;
    ring.style.width = Math.round(b.width + pad * 2) + 'px';
    ring.style.height = Math.round(b.height + pad * 2) + 'px';
    ring.style.transform = `translate3d(${Math.round(b.left - pad)}px, ${Math.round(b.top - pad)}px, 0)`;
    ring.classList.add('is-on');
    placeTip(b);
  }

  function qrAnchor(p) {
    if (!p) return null;
    let el;
    if (p.id === 'netease') el = document.querySelector('#modal:not(.is-closed)');
    else if (p.id === 'qq') el = document.getElementById('qq-qr');
    else el = document.getElementById('src-qr');
    if (!isShown(el)) return null;
    return p.id === 'netease' ? (el.querySelector('.modal__card') || el) : el;
  }

  function currentAnchor() {
    if (!chosen) return null;
    if (step === 2) return document.querySelector(chosen.row);
    if (step === 3) return qrAnchor(chosen);
    return null;
  }

  function stopPoll() {
    clearInterval(poll);
    poll = 0;
  }

  function close() {
    if (!active) return;
    /* 用户可能在 1.5s 轮询之前就点了「我已完成 / 完成」：状态若已经变成
       已登录，照样要告诉开场引导「这家登录成功了」，别把跑马带/海报两步误跳过。 */
    if (chosen && loggedInStrict(chosen)) didLogin = true;
    active = false;
    step = 0;
    chosen = null;
    stopPoll();
    clearTimers();
    markSeen();
    root.classList.remove('is-on', 'is-coach');
    ring.classList.remove('is-on');
    tip.classList.remove('is-on');
    hideAll();
    after(220, () => {
      if (active) return;
      root.hidden = true;
      panel.hidden = false;
      ring.hidden = true;
      tip.hidden = true;
      if (allBtn) allBtn.hidden = true;
    });
    finishQueue();
  }

  /* 队列收尾：只回调一次。子流程被外层（开场引导 / 另一层）关掉时也走到这里，
     让「我已完成 → 回大厅」不会因为用户没点完成就断在半路。 */
  function finishQueue() {
    const cb = onDone;
    const hadQueue = queueOn;
    onDone = null;
    queueOn = false;
    queue = [];
    qi = 0;
    /* 队列收尾要回大厅：网易云的扫码弹窗是固定层，留在屏幕上会盖住
       后面的跑马带聚光灯，这里顺手点掉它（只点现成的关闭按钮）。 */
    if (hadQueue) {
      const modal = document.querySelector('#modal:not(.is-closed)');
      const closeBtn = document.getElementById('modal-close');
      if (modal && closeBtn) {
        try { closeBtn.click(); } catch { /* noop */ }
      }
    }
    if (typeof cb === 'function') {
      try { cb(didLogin); } catch { /* 回调异常不回头吃掉登录层 */ }
    }
  }

  /* 走下一家：已登录的直接跳（不白圈一家已经「已登录」的行），
     队列空了就收层。 */
  function advance(i) {
    if (!active || !queueOn) return;
    /* 手动点「下一家 / 完成」时可能刚扫完、轮询还没跑到：补记一次成功 */
    if (chosen && loggedInStrict(chosen)) didLogin = true;
    if (!i) i = qi + 1;
    stopPoll();
    clearTimers();
    for (; i < queue.length; i++) {
      const p = PLATFORMS.find((x) => x.id === queue[i]);
      if (!p) continue;
      if (loggedIn(p)) continue;
      qi = i;
      select(p.id, true);
      return;
    }
    qi = queue.length;
    close();
  }

  function rowStep(p) {
    if (!active || chosen !== p || step !== 2) return;
    if (document.body.dataset.view !== 'settings') return close();
    const row = document.querySelector(p.row);
    if (!row) return close();
    const b = row.getBoundingClientRect();
    if (b.top < 84 || b.bottom > window.innerHeight - 64) {
      try {
        row.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
      } catch { /* 老内核 */ }
    }
    locate(row);
    after(480, () => {
      if (!active || step !== 2 || chosen !== p) return;
      locate(row);
      after(420, () => {
        if (!active || step !== 2 || chosen !== p) return;
        const btn = document.getElementById(p.btn);
        /* 用户自己先点了、二维码面板已经出来 → 不再补点一次（会重置换码） */
        if (!btn || btn.hidden || qrAnchor(p)) return scanStep(p);
        try { btn.click(); } catch { /* noop */ }
        after(900, () => scanStep(p));
      });
    });
  }

  function scanStep(p) {
    if (!active || chosen !== p) return;
    step = 3;
    const tipText = '打开 ' + p.name + ' App，扫屏幕上的二维码。登录成功后，这一行的状态会自动变成「已登录」。'
      + (p.id === 'netease' ? '扫码不方便也可以粘贴 MUSIC_U Cookie。' : '');
    paintTip(posText('03 / 03'), '用手机 App 扫码', tipText,
      queueOn ? '下一家' : '完成', '跳过');
    locate(qrAnchor(p));
    after(900, () => { if (active && step === 3) locate(qrAnchor(p)); });
    stopPoll();
    poll = setInterval(() => {
      if (!active || step !== 3) return;
      /* 用户离开设置页（且网易云弹窗也没开着）→ 引导自动收尾，不硬留在屏幕上 */
      if (document.body.dataset.view !== 'settings'
        && !isShown(document.querySelector('#modal:not(.is-closed)'))) {
        return close();
      }
      if (loggedInStrict(p)) {
        stopPoll();
        didLogin = true;
        const more = queueOn && queue.slice(qi + 1).some((id) => {
          const q = PLATFORMS.find((x) => x.id === id);
          return !!q && !loggedIn(q);
        });
        paintTip(posText('03 / 03'), '登录成功',
          '这一行的状态已经变成「已登录」，可以开始听歌了。',
          queueOn ? (more ? '下一家' : '完成') : '完成', '');
        locate(qrAnchor(p));
        /* 队列模式自动接下一家：扫码成功本身就是「这一家完成」，
           停 2.2 秒让用户看见结果，再走下一家（或收层回大厅）。 */
        if (queueOn) {
          after(2200, () => {
            if (!active || chosen !== p || step !== 3) return;
            advance(0);
          });
        }
        return;
      }
      const a = qrAnchor(p);
      if (a) locate(a);
    }, 1500);
  }

  function posText(n) {
    if (!queueOn || queue.length < 1) return n;
    return n + ' · 第 ' + Math.min(qi + 1, queue.length) + ' / ' + queue.length + ' 家';
  }

  function showAll() {
    if (!allBtn) return;
    allBtn.hidden = false;
    requestAnimationFrame(() => {
      if (active && step >= 2) allBtn.classList.add('is-on');
    });
  }

  function hideAll() {
    if (!allBtn) return;
    allBtn.classList.remove('is-on');
  }

  function select(id, keepQueue) {
    if (!active) return;
    const p = PLATFORMS.find((x) => x.id === id);
    if (!p) return;
    if (!keepQueue) {
      queueOn = false;
      queue = [];
      qi = 0;
    }
    chosen = p;
    step = 2;
    markSeen();
    panel.hidden = true;
    root.classList.add('is-coach');
    ring.hidden = false;
    tip.hidden = false;
    paintTip(posText('02 / 03'), '登录 ' + p.name,
      '接下来会切到「设置 → 平台账号」并圈出这一行。点这一行的「登录」，二维码面板这就打开。', '', '跳过');
    /* 「我已完成」从登录界面出现的第一刻就常驻，随时能点 */
    showAll();
    const view = document.body.dataset.view;
    if (view === 'settings') {
      after(60, () => rowStep(p));
    } else if (view === 'hall' && document.getElementById('btn-settings')) {
      /* 大厅里顶栏左键就是「设置」，点它走 openSettings（会顺带刷新登录态） */
      document.getElementById('btn-settings').click();
      after(720, () => rowStep(p));
    } else {
      /* 从形态长廊 / 播放页等处进来：齿轮在这时是「返回大厅」，只能派发视图切换 */
      document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'settings' } }));
      after(720, () => rowStep(p));
    }
  }

  function open(force, platformId, opts) {
    if (active || !root) return false;
    if (!force && (seen() || hasSession())) return false;
    const fromTour = !!(opts && opts.fromTour);
    /* 强制引导正在跑时不要再叠一层独立登录引导，更不能把引导关掉
       （关掉就是「中途退出」了）；要登录由引导自己的队列负责。 */
    if (!fromTour && window.LIZI_TOUR && window.LIZI_TOUR.running) return false;
    active = true;
    step = 1;
    chosen = null;
    queueOn = false;
    queue = [];
    qi = 0;
    didLogin = false;
    onDone = (opts && typeof opts.onDone === 'function') ? opts.onDone : null;
    clearTimers();
    root.hidden = false;
    root.classList.remove('is-coach');
    root.classList.add('is-on');
    panel.hidden = false;
    ring.hidden = true;
    tip.hidden = true;
    ring.classList.remove('is-on');
    tip.classList.remove('is-on');
    if (allBtn) {
      allBtn.classList.remove('is-on');
      allBtn.hidden = true;
    }
    renderList();

    /* 开场引导带着勾选的平台进来（可以是数组）：跳过多余的选择层，
       直接排成队列，按顺序「切设置页 → 圈登录行 → 叫二维码」。
       已经登录的直接过滤掉；全过滤空了就立刻收层回调，不空跑。
       平台 id 不在白名单就退回普通选择层，不因坏参数把整段引导卡住。 */
    const ids = Array.isArray(platformId)
      ? platformId
      : (platformId ? [platformId] : null);
    const wanted = ids
      ? ids.map((id) => PLATFORMS.find((p) => p.id === id)).filter(Boolean)
      : [];
    if (wanted.length) {
      queueOn = true;
      queue = wanted.map((p) => p.id);
      qi = 0;
      const start = queue.findIndex((id) => {
        const q = PLATFORMS.find((x) => x.id === id);
        return !!q && !loggedIn(q);
      });
      if (start < 0) {
        /* 勾的平台全都已登录：没有要扫的码，直接收尾 */
        close();
        return true;
      }
      qi = start;
      select(queue[start], true);
      return true;
    }

    const first = list && list.querySelector('.lguide__plat');
    if (first) {
      setTimeout(() => {
        if (!active || step !== 1) return;
        try { first.focus({ preventScroll: true }); } catch { /* noop */ }
      }, 80);
    }
    return true;
  }

  /* 大厅「我的」还在查询登录态时（登录引导没有按钮），先等一会儿再下结论 */
  function settled() {
    const me = document.getElementById('hall-me');
    if (!me || !me.children.length) return false;
    const cta = me.querySelector('.hall-cta');
    if (!cta) return true;
    return !!cta.querySelector('[data-hall-account]');
  }

  function afterTour() {
    paintRows();
    if (active || seen() || hasSession()) return;
    let tries = 0;
    const tick = () => {
      if (active || seen() || hasSession()) return;
      /* 开场引导又被重开了：等它结束再弹，别两层一起压着 */
      if (window.LIZI_TOUR && window.LIZI_TOUR.running) { after(650, tick); return; }
      if (settled() || tries++ > 8) { open(); return; }
      after(650, tick);
    };
    after(850, tick);
  }

  function init() {
    root = document.getElementById('login-guide');
    if (!root) return;
    panel = root.querySelector('.lguide__panel');
    list = document.getElementById('lguide-list');
    ring = document.getElementById('lguide-ring');
    tip = document.getElementById('lguide-tip');
    tipStep = document.getElementById('lguide-step');
    tipTitle = document.getElementById('lguide-tip-title');
    tipDesc = document.getElementById('lguide-tip-desc');
    tipDone = document.getElementById('lguide-done');
    tipSkip = document.getElementById('lguide-skip');
    laterBtn = document.getElementById('lguide-later');
    allBtn = document.getElementById('lguide-all');
    if (!panel || !list || !ring || !tip || !tipDone || !tipSkip) return;

    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plat]');
      if (b) select(b.dataset.plat);
    });
    if (laterBtn) laterBtn.addEventListener('click', close);
    /* 队列模式：完成/跳过 = 这一家结束，接下一家；普通模式照旧收层 */
    tipDone.addEventListener('click', () => {
      if (active && queueOn) advance(0);
      else close();
    });
    tipSkip.addEventListener('click', () => {
      if (active && queueOn) advance(0);
      else close();
    });
    /* 「我已完成」= 整段登录到此为止，立刻收层回大厅 */
    if (allBtn) allBtn.addEventListener('click', close);

    const row = document.getElementById('row-login-guide');
    if (row) row.addEventListener('click', () => open(true));

    window.addEventListener('keydown', (e) => {
      if (!active) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }, true);

    const pin = () => {
      if (!active || step < 2) return;
      const a = currentAnchor();
      if (a && isShown(a)) locate(a);
      /* 第二步的目标行没了，或已经离开设置页 → 收尾（队列模式下这也会
         把剩下的平台一并跳过，让开场引导回大厅继续走）；第三步二维码
         还没出来时保留右下角提示卡，等它出来再圈。 */
      else if (step === 2 || document.body.dataset.view !== 'settings') close();
    };
    window.addEventListener('resize', pin);
    document.addEventListener('scroll', pin, true);

    paintRows();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  return {
    open, close, afterTour, loggedIn, signedIn,
    get active() { return active; },
    get step() { return step; },
    get queued() { return queueOn ? queue.slice(qi) : []; },
    PLATFORMS,
  };
})();

window.LIZI_LOGIN_GUIDE = LIZI_LOGIN_GUIDE;
