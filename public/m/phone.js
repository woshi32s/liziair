/* ==========================================================================
   手机层脚本 · 只在 max-width:560px 接管，宽屏完全放行桌面逻辑
   --------------------------------------------------------------------------
   只做这几件事：
     1) 播放页歌词默认收起：进入播放页时摘掉桌面 app.js 加的 .is-lyrics-open，
        改用自己的 .phone-lyr-open；点 #pull 细条开合。
     2) 一条手机专用的细白进度线 #phone-progress，数据只来自 Player.audio。
     3) 歌词面板顶部插入一根关闭条 #phone-lyr-close（面板里原本没有任何按钮）。
     4) 播放页下滑手势：歌词开着先收面板，否则回大厅（只认 touch）。
     5) 安卓返回键：先收歌词面板，再走页面层级（__liziPhoneBack 由 head 里的
        触屏脚本定义，这里只在外面包一层）。
   不修改、不复制 app.js；桌面宽屏一行都不执行。
   ========================================================================== */
(function () {
  'use strict';

  var mq = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;
  var viewNow = document.getElementById('view-now');
  var art = viewNow ? viewNow.querySelector('.now__art') : null;

  function enabled() {
    return !!mq && mq.matches;
  }

  function isNowActive() {
    return !!viewNow && viewNow.classList.contains('is-active') &&
      document.body.dataset.view === 'now';
  }

  /* ------------------------------------------------------------------ *
   * 进度线
   * ------------------------------------------------------------------ */
  var fill = null;

  function buildProgress() {
    if (fill || !art) return;
    var track = document.createElement('div');
    track.id = 'phone-progress';
    track.setAttribute('aria-hidden', 'true');
    var i = document.createElement('i');
    track.appendChild(i);
    art.appendChild(track);
    fill = i;
  }

  function paintProgress() {
    if (!fill) return;
    if (!enabled() || !isNowActive() || document.hidden) return;
    var a = null;
    try {
      if (typeof Player !== 'undefined' && Player) a = Player.audio;
    } catch (e) { a = null; }
    if (!a) { fill.style.transform = 'scaleX(0)'; return; }
    var dur = a.duration;
    var cur = a.currentTime;
    var p = 0;
    if (dur && isFinite(dur) && dur > 0) p = cur / dur;
    if (!isFinite(p) || p < 0) p = 0;
    if (p > 1) p = 1;
    fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }

  /* time 由 player.js 在 timeupdate / seek / 载入时发出，不新开轮询 */
  try {
    if (typeof Player !== 'undefined' && Player && typeof Player.on === 'function') {
      Player.on('time', function () { paintProgress(); });
    }
  } catch (e) { /* 老环境没有 Player 就只留静态空轨道 */ }

  /* ------------------------------------------------------------------ *
   * 歌词开合（只在手机宽度接管）
   * ------------------------------------------------------------------ */
  /* 面板平时 display:none，app.js 的自动滚动量不到高度；展开后手动把
     当前句放到面板中线（只读 DOM，不碰 app.js 的状态） */
  function centerActiveLyric() {
    var box = document.getElementById('lyrics');
    if (!box) return;
    var ly = box.querySelector('.ly.is-active');
    if (!ly) return;
    var br = box.getBoundingClientRect();
    var lr = ly.getBoundingClientRect();
    var delta = (lr.top - br.top) - (br.height - lr.height) / 2;
    var next = box.scrollTop + delta;
    box.scrollTop = next > 0 ? next : 0;
  }

  function openLyrics() {
    if (!viewNow || !enabled()) return;
    viewNow.classList.remove('is-lyrics-open');   /* 桌面那套常开状态不要 */
    viewNow.classList.add('phone-lyr-open');
    paintProgress();
    requestAnimationFrame(centerActiveLyric);
  }

  function closeLyrics() {
    if (viewNow) viewNow.classList.remove('phone-lyr-open');
  }

  function toggleLyrics() {
    if (!viewNow) return;
    if (viewNow.classList.contains('phone-lyr-open')) closeLyrics();
    else openLyrics();
  }

  function collapse() {
    if (!viewNow) return;
    viewNow.classList.remove('phone-lyr-open');
    viewNow.classList.remove('is-lyrics-open');
  }

  /* ------------------------------------------------------------------ *
   * 歌词关闭条：插在 #lyrics-panel 里、#lyrics 之前
   * 桌面面板里 0 个 button，手机展开后也没有关闭入口（细条已被收掉）
   * ------------------------------------------------------------------ */
  var lyrClose = null;

  function buildLyricsClose() {
    if (lyrClose || !enabled()) return;
    var panel = document.getElementById('lyrics-panel');
    var box = document.getElementById('lyrics');
    if (!panel || !box) return;
    var btn = document.createElement('button');
    btn.id = 'phone-lyr-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', '关闭歌词');
    btn.appendChild(document.createElement('i'));
    btn.addEventListener('click', function (e) {
      /* 面板外点击那套已经排除 #lyrics-panel；这里再停一层，避免重复处理 */
      e.stopPropagation();
      closeLyrics();
    });
    panel.insertBefore(btn, box);
    lyrClose = btn;
  }

  /* 回到宽屏时把这个手机专用节点摘掉，桌面 DOM 恢复原样 */
  function removeLyricsClose() {
    if (lyrClose && lyrClose.parentNode) lyrClose.parentNode.removeChild(lyrClose);
    lyrClose = null;
  }

  function gripHit(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('#pull'));
  }

  /* 捕获阶段拦 #pull 的指针 / 点击 / 键盘：
     app.js 在元素上挂了 pointerdown / pointerup / click（它的 pointerup 会
     直接把歌词常开），在文档捕获阶段 stopPropagation 就能让那几层完全收不到。 */
  document.addEventListener('pointerdown', function (e) {
    if (!enabled() || !isNowActive() || !gripHit(e)) return;
    e.stopPropagation();
  }, true);

  document.addEventListener('pointerup', function (e) {
    if (!enabled() || !isNowActive() || !gripHit(e)) return;
    e.stopPropagation();
  }, true);

  document.addEventListener('click', function (e) {
    if (!enabled() || !isNowActive() || !gripHit(e)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleLyrics();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!enabled() || !isNowActive() || !gripHit(e)) return;
    var k = e.key;
    /* 回车 / 空格由这里统一处理，避免按钮默认行为再补一发 click */
    if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (k === 'ArrowDown') closeLyrics();
      else if (k === 'ArrowUp') openLyrics();
      else toggleLyrics();
    }
  }, true);

  /* 点歌词面板以外的区域收起（面板内部、细条本身都不算） */
  if (viewNow) {
    viewNow.addEventListener('click', function (e) {
      if (!enabled() || !viewNow.classList.contains('phone-lyr-open')) return;
      var t = e.target;
      if (t && t.closest && (t.closest('#lyrics-panel') || t.closest('#pull') ||
          t.closest('#drawer') || t.closest('#now-transport') || t.closest('.now__bar'))) return;
      closeLyrics();
    });
  }

  /* ------------------------------------------------------------------ *
   * 下滑手势：歌词开着 → 收面板；没开 → 回大厅。
   * 只认 touch；从按钮 / 链接 / 表单 / 歌词面板 / 顶栏 / 控制键 / 抽屉上
   * 起手的一律放行（那是点按或滚动，不是下滑）。不 preventDefault，
   * 也不加 touch-action，页面自己的滚动 / 点击保持原样。
   * ------------------------------------------------------------------ */
  var swipe = null;

  function swipeBlocked(t) {
    return !!(t && t.closest && t.closest(
      'button, a, input, textarea, select, #lyrics-panel, .now__bar, .now__transport, #drawer'));
  }

  if (viewNow) {
    viewNow.addEventListener('pointerdown', function (e) {
      if (!enabled() || !isNowActive() || e.pointerType !== 'touch') return;
      if (swipeBlocked(e.target)) { swipe = null; return; }
      swipe = { x: e.clientX, y: e.clientY };
    }, { passive: true });

    viewNow.addEventListener('pointerup', function (e) {
      if (!enabled() || !isNowActive() || e.pointerType !== 'touch' || !swipe) return;
      var dx = e.clientX - swipe.x;
      var dy = e.clientY - swipe.y;
      swipe = null;
      if (dy < 70 || Math.abs(dy) <= Math.abs(dx) * 1.2) return;
      if (viewNow.classList.contains('phone-lyr-open')) {
        closeLyrics();
      } else {
        var back = document.getElementById('btn-back');
        if (back) back.click();
      }
      /* 页面本身不滚动，浏览器不会把这次拖动当滚动 → 松手后通常还会补一发
         click；落在 .disc 上就是 Player.toggle()（回大厅顺手把歌暂停）。
         回大厅的 click 已在上面同步发完，这里只拦紧随其后的那一发。 */
      swallowUntil = performance.now() + 500;
    }, { passive: true });

    viewNow.addEventListener('pointercancel', function () { swipe = null; }, { passive: true });
  }

  var swallowUntil = 0;
  document.addEventListener('click', function (e) {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* ------------------------------------------------------------------ *
   * 进入播放页 → 收起歌词；桌面 app.js 的 setLyricsOpen(true) 随时被摘掉
   * ------------------------------------------------------------------ */
  var lastView = null;

  function onStateChange() {
    if (!viewNow) return;
    if (!enabled()) return;                 /* 宽屏：桌面逻辑自己管 */
    var v = document.body.dataset.view;
    if (v === 'now') {
      if (lastView !== 'now') {
        collapse();
        buildProgress();
        /* 等这一帧的布局落定再画一次（Player 可能在切歌） */
        requestAnimationFrame(paintProgress);
      } else if (viewNow.classList.contains('is-lyrics-open')) {
        viewNow.classList.remove('is-lyrics-open');
      }
    } else {
      closeLyrics();
    }
    lastView = v;
  }

  /* ------------------------------------------------------------------ *
   * 桌面版式类 now-layout-02/04/06：player-layouts.css 在 body 上后加载，
   * 手机宽度下那套 ≤900px 的 !important 规则会把单列播放页整个改写
   * （封面横排、按钮 30/38px）。手机层固定是单列，所以这里在两套状态里
   * 收起 / 还原这个类；选择本身仍存在 localStorage，宽屏缩回去就恢复。
   * ------------------------------------------------------------------ */
  var LAYOUT_KEY = 'lizi.now.layout';

  /* app.js 在触屏上会给 body 挂 .touch-ui，那套规则是为 1280 缩放的安卓壳写的
     （≤900px 段里有一批 !important 会把单列播放页改写）。手机层自己重排播放页，
     这里在手机宽度摘掉这个类；回到宽屏再按「安卓 / 粗指针」还原。
     只动类名，app.js 的 TOUCH_HUD 等 JS 行为不受影响。 */
  function syncTouchUi() {
    var coarse = false;
    try {
      coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { coarse = false; }
    if (enabled()) document.body.classList.remove('touch-ui');
    else if (window.__liziAndroid || coarse) document.body.classList.add('touch-ui');
  }

  function stripLayouts() {
    var cl = document.body.classList;
    for (var i = cl.length - 1; i >= 0; i--) {
      if (/^now-layout-\d+$/.test(cl[i])) cl.remove(cl[i]);
    }
  }

  function restoreLayout() {
    try {
      var v = localStorage.getItem(LAYOUT_KEY) || '';
      if (/^(02|04|06)$/.test(v)) document.body.classList.add('now-layout-' + v);
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function hasLayoutClass() {
    var cl = document.body.classList;
    for (var i = 0; i < cl.length; i++) {
      if (/^now-layout-\d+$/.test(cl[i])) return true;
    }
    return false;
  }

  var bodyObs = new MutationObserver(function () {
    if (enabled() && hasLayoutClass()) stripLayouts();
    onStateChange();
  });
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['data-view', 'class'] });

  if (viewNow) {
    var vecObs = new MutationObserver(function () {
      if (!enabled()) return;
      if (viewNow.classList.contains('is-lyrics-open')) {
        viewNow.classList.remove('is-lyrics-open');
      }
    });
    vecObs.observe(viewNow, { attributes: true, attributeFilter: ['class'] });
  }

  /* 媒体查询切换：从宽屏缩到手机宽度、或反过来，都回到收起态 */
  function onMediaChange() {
    syncTouchUi();
    if (!enabled()) {
      if (viewNow) {
        viewNow.classList.remove('phone-lyr-open');
        /* 桌面播放页的歌词本来就是常开的，缩回宽屏时还回去 */
        if (document.body.dataset.view === 'now') viewNow.classList.add('is-lyrics-open');
      }
      removeLyricsClose();                   /* 宽屏不需要手机关闭条，DOM 还原 */
      restoreLayout();                       /* 回到宽屏：把桌面版式类还回去 */
      lastView = document.body.dataset.view;
      return;
    }
    stripLayouts();
    collapse();
    buildLyricsClose();
    lastView = document.body.dataset.view;
    buildProgress();
    paintProgress();
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onMediaChange);
    else if (mq.addListener) mq.addListener(onMediaChange);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) paintProgress();
  });

  /* 安卓返回键：先收歌词，再交给 head 里那层页面层级逻辑 */
  var baseBack = window.__liziPhoneBack;
  if (typeof baseBack === 'function') {
    window.__liziPhoneBack = function () {
      if (enabled() && viewNow && viewNow.classList.contains('phone-lyr-open')) {
        closeLyrics();
        return true;
      }
      return baseBack.apply(this, arguments);
    };
  }

  /* 初始化 */
  buildProgress();
  syncTouchUi();
  lastView = document.body.dataset.view;
  if (enabled()) {
    stripLayouts();
    buildLyricsClose();
    if (viewNow) collapse();
  }
})();
