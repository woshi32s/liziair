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
  var ring = null;
  var seek = null;
  var ringHideTimer = 0;

  function buildProgress() {
    if (fill || !art) return;
    var track = document.createElement('div');
    track.id = 'phone-progress';
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', '播放进度');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('tabindex', '0');
    var i = document.createElement('i');
    track.appendChild(i);
    /* 拖动中跟着手指走的环形把手；平时透明，松手 160ms 淡出 */
    var b = document.createElement('b');
    b.className = 'pp-ring';
    b.setAttribute('aria-hidden', 'true');
    track.appendChild(b);
    art.appendChild(track);
    fill = i;
    ring = b;
    bindSeek(track);
  }

  /* ---- 拖动定位（手机层） ----
     /m 里桌面那条 .dock 被 phone.css 藏掉，它的 seek 在 app.js 的
     bindBar(el.dockBar) 里，所以手机进度线没有接到任何指针事件（之前只能看）。
     这里补同一套 pointerdown / move / up：命中区由 CSS 的 ::before 扩到约 26px，
     拖动中只画 fill + 环形把手（rAF 合并，一帧最多一次），松手才 Player.seek。
     宽屏 enabled() 为假，全部放行给桌面逻辑。 */
  function ratioAt(clientX, width) {
    var w = width || (fill && fill.parentNode ? fill.parentNode.getBoundingClientRect().width : 0);
    var r = fill && fill.parentNode ? fill.parentNode.getBoundingClientRect() : null;
    if (!r || !(w > 0)) return 0;
    var p = (clientX - r.left) / w;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function paintSeekRatio(p) {
    if (!fill) return;
    var tr = fill.parentNode;
    var w = tr.clientWidth || tr.getBoundingClientRect().width;
    fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    tr.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (ring) {
      var hw = ring.offsetWidth ? ring.offsetWidth / 2 : 11;
      ring.style.transform = 'translate3d(' + (p * w - hw).toFixed(1) + 'px, -50%, 0)';
    }
  }

  function seekToRatio(p) {
    var dur = 0;
    try {
      if (typeof Player !== 'undefined' && Player && Player.audio) dur = Player.audio.duration;
    } catch (e) { dur = 0; }
    if (!isFinite(dur) || !(dur > 0)) return false;
    try { Player.seek(p * dur); } catch (e) { return false; /* 播放器还没就绪 */ }
    return true;
  }

  /* 老 WebView 偶尔 setPointerCapture 失败，手指一旦离开那 2px 细条就收不到
     move / up。拖动期间同时挂 window 兜底；有 capture 时事件也只多走一遍，
     onSeekMove 的 rAF 合并保证不会重复画。 */
  function attachSeekWindow() {
    window.addEventListener('pointermove', onSeekMove, { passive: false });
    window.addEventListener('pointerup', onSeekUp);
    window.addEventListener('pointercancel', onSeekCancel);
  }
  function detachSeekWindow() {
    window.removeEventListener('pointermove', onSeekMove);
    window.removeEventListener('pointerup', onSeekUp);
    window.removeEventListener('pointercancel', onSeekCancel);
  }

  function endSeek(cancelled) {
    var s = seek;
    if (!s) return;
    seek = null;
    detachSeekWindow();
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    var tr = fill && fill.parentNode;
    if (tr) {
      tr.classList.remove('is-seek');
      try {
        if (tr.hasPointerCapture && tr.hasPointerCapture(s.id)) tr.releasePointerCapture(s.id);
      } catch (e) { /* 老 WebView 没有 capture */ }
    }
    /* 环形把手淡出。安卓 WebView 偶尔把 opacity 过渡冻在起点，220ms 后
       兜底写一次 inline 0 —— 宁可没有淡出，也不能让环一直挂在进度线上。 */
    if (ring) {
      clearTimeout(ringHideTimer);
      ringHideTimer = setTimeout(function () {
        if (!seek && ring) {
          /* 连过渡一起关掉：真机上过渡若被冻在起点，只写 opacity 也停不下来 */
          ring.style.transition = 'none';
          ring.style.opacity = '0';
        }
      }, 220);
    }
    if (cancelled) paintProgress();        /* 取消：回到真实进度 */
    else {
      paintSeekRatio(s.ratio);
      /* 松手才 seek；duration 还未知（没载入歌）时把预览退回真实进度，
         免得看起来"跳过去了"其实没跳 */
      if (!seekToRatio(s.ratio)) paintProgress();
      if (s.moved && tr) tr.__phoneSeekSwallow = true;
    }
  }

  function onSeekDown(e) {
    if (!enabled() || !isNowActive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (seek) endSeek(true);               /* 多指重入：先把上一段收掉 */
    var tr = fill.parentNode;
    var w = tr.getBoundingClientRect().width;
    if (!(w > 0)) return;
    if (ring) {
      clearTimeout(ringHideTimer);
      ringHideTimer = 0;
      ring.style.transition = '';          /* 上一次兜底关掉的过渡 / inline 0 先撤掉 */
      ring.style.opacity = '';
    }
    seek = { id: e.pointerId, width: w, ratio: 0, raf: 0, startX: e.clientX, moved: false };
    seek.ratio = ratioAt(e.clientX, w);
    tr.classList.add('is-seek');
    try { tr.setPointerCapture(e.pointerId); } catch (err) { /* window 监听兜底 */ }
    attachSeekWindow();
    paintSeekRatio(seek.ratio);
    if (e.cancelable) e.preventDefault();
  }

  function onSeekMove(e) {
    if (!seek || e.pointerId !== seek.id) return;
    seek.ratio = ratioAt(e.clientX, seek.width);
    if (!seek.moved && Math.abs(e.clientX - seek.startX) > 3) seek.moved = true;
    if (!seek.raf) {
      seek.raf = requestAnimationFrame(function () {
        var s = seek;
        if (!s) return;
        s.raf = 0;
        paintSeekRatio(s.ratio);
      });
    }
    if (e.cancelable) e.preventDefault();
  }

  function onSeekUp(e) {
    if (!seek || e.pointerId !== seek.id) return;
    endSeek(false);
  }

  function onSeekCancel(e) {
    if (!seek || e.pointerId !== seek.id) return;
    endSeek(true);
  }

  /* 键盘：和桌面播放条同一档（Shift 大步 10%，普通 2%）。
     手机上很少用，但 role=slider 不带键盘不完整。 */
  function onSeekKey(e) {
    if (!enabled() || !isNowActive()) return;
    var a = null;
    try { a = Player.audio; } catch (err) { return; }
    var dur = a && a.duration ? a.duration : 0;
    if (!isFinite(dur) || !(dur > 0)) return;
    var p = a.currentTime / dur;
    var step = e.shiftKey ? 0.1 : 0.02;
    var np = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') np = Math.min(1, p + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') np = Math.max(0, p - step);
    else if (e.key === 'Home') np = 0;
    else if (e.key === 'End') np = 1;
    if (np === null) return;
    e.preventDefault();
    e.stopPropagation();
    paintSeekRatio(np);
    if (!seekToRatio(np)) paintProgress();
  }

  function bindSeek(track) {
    if (!track || track.__phoneSeek) return;
    track.__phoneSeek = true;
    track.addEventListener('pointerdown', onSeekDown);
    track.addEventListener('pointermove', onSeekMove);
    track.addEventListener('pointerup', onSeekUp);
    track.addEventListener('pointercancel', onSeekCancel);
    track.addEventListener('keydown', onSeekKey);
    /* 拖动结束浏览器会补一发 click；别让它落到播放页自己的点击处理上 */
    track.addEventListener('click', function (e) {
      if (!seek && track.__phoneSeekSwallow) {
        track.__phoneSeekSwallow = false;
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  function paintProgress() {
    if (!fill) return;
    if (seek) return;                       /* 拖动中由手指决定，别被 timeupdate 拉回去 */
    if (!enabled() || !isNowActive() || document.hidden) return;
    var a = null;
    try {
      if (typeof Player !== 'undefined' && Player) a = Player.audio;
    } catch (e) { a = null; }
    if (!a) {
      fill.style.transform = 'scaleX(0)';
      if (fill.parentNode) fill.parentNode.setAttribute('aria-valuenow', '0');
      return;
    }
    var dur = a.duration;
    var cur = a.currentTime;
    var p = 0;
    if (dur && isFinite(dur) && dur > 0) p = cur / dur;
    if (!isFinite(p) || p < 0) p = 0;
    if (p > 1) p = 1;
    fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    if (fill.parentNode) fill.parentNode.setAttribute('aria-valuenow', String(Math.round(p * 100)));
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

  /* 开合走两步：.phone-lyr-open 只负责显隐与几何，.phone-lyr-in 才是动画落点。
     先挂 open（缩在下方、透明），下一帧再加 in，面板才真的从下往上滑进来；
     收起时先摘 in、加 closing，等过渡走完（240ms）再整块拿掉。 */
  var lyrTimer = 0;
  var lyrTimerFallback = 0;
  /* 这台机器把过渡冻在起点（安卓 WebView 上见过）→ 之后只用类名切换，
     不再指望动画。第一次开面板时探测一次就够，中途不会变。 */
  var lyrNoFx = false;

  function openLyrics() {
    if (!viewNow || !enabled()) return;
    clearTimeout(lyrTimer);
    clearTimeout(lyrTimerFallback);
    viewNow.classList.remove('is-lyrics-open');   /* 桌面那套常开状态不要 */
    viewNow.classList.remove('phone-lyr-closing');
    viewNow.classList.add('phone-lyr-open');
    paintProgress();
    /* display:none → flex 的这次重排必须真的发生，否则下一帧加的 .phone-lyr-in
       会和 open 合并成一次样式计算，面板直接出现在终点（没有上滑）。
       读一次 offsetHeight 强制同步重排，把“缩在下方且透明”这个起点钉住。 */
    var panel = viewNow.querySelector('.now__lyrics');
    if (panel) void panel.offsetHeight;
    /* 落点用「rAF 或 40ms 定时器，谁先到算谁」补一发：页面被遮挡 / WebView 冻结时
       rAF 可能不跑，只靠它面板会永远停在透明的起点上（宁可没有过渡也不能不显示） */
    var landed = false;
    function land() {
      if (landed) return;
      landed = true;
      if (!viewNow.classList.contains('phone-lyr-open')) return;
      viewNow.classList.add('phone-lyr-in');
      requestAnimationFrame(centerActiveLyric);
    }
    if (lyrNoFx) {                       /* 已知冻过渡：直接落到终点 */
      land();
      return;
    }
    requestAnimationFrame(land);
    setTimeout(land, 40);
    /* 兜底：动画 200～260ms，420ms 时面板还基本透明 → 说明这台机器把过渡冻在起点，
       立刻切成“直接显示”，别让歌词永远打不开 */
    lyrTimerFallback = setTimeout(function () {
      if (!viewNow.classList.contains('phone-lyr-open') || !panel) return;
      var op = 0;
      try { op = parseFloat(getComputedStyle(panel).opacity) || 0; } catch (e) { op = 0; }
      if (op < 0.5) {
        lyrNoFx = true;
        viewNow.classList.add('phone-lyr-nofx');
      }
    }, 420);
  }

  function closeLyrics() {
    if (!viewNow || !viewNow.classList.contains('phone-lyr-open')) return;
    clearTimeout(lyrTimer);
    clearTimeout(lyrTimerFallback);
    if (lyrNoFx) {                       /* 冻过渡的机器：直接收起，不留 240ms 空等 */
      viewNow.classList.remove('phone-lyr-in');
      viewNow.classList.remove('phone-lyr-open');
      viewNow.classList.remove('phone-lyr-closing');
      return;
    }
    viewNow.classList.remove('phone-lyr-in');
    viewNow.classList.add('phone-lyr-closing');
    lyrTimer = setTimeout(function () {
      viewNow.classList.remove('phone-lyr-open');
      viewNow.classList.remove('phone-lyr-closing');
    }, 240);
  }

  function toggleLyrics() {
    if (!viewNow) return;
    if (viewNow.classList.contains('phone-lyr-open')) closeLyrics();
    else openLyrics();
  }

  function collapse() {
    if (!viewNow) return;
    clearTimeout(lyrTimer);
    clearTimeout(lyrTimerFallback);
    viewNow.classList.remove('phone-lyr-open');
    viewNow.classList.remove('phone-lyr-in');
    viewNow.classList.remove('phone-lyr-closing');
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
      'button, a, input, textarea, select, #lyrics-panel, .now__bar, .now__transport, #phone-progress, #drawer'));
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
      if (seek) endSeek(true);              /* 离开播放页：结束拖动，恢复真实进度 */
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

  /* ------------------------------------------------------------------ *
   * 屏幕方向：设置页的「屏幕方向」开关（默认竖屏），以及形态（舞台）自动横屏。
   *
   * 基准方向 = 用户在设置页选的方向，存 localStorage['lizi.m.orientation']。
   * 形态是横屏作品，所以规则的唯一优先级是：
   *   在形态里            → 横屏（不管基准是竖是横）
   *   不在形态里          → 基准方向（竖屏 / 横屏）
   * 于是：基准竖屏时进形态临时横屏、退出回竖屏；基准横屏时进形态横屏、
   * 退出仍横屏。方向由 Java 侧 NativeBridge.setOrientation 调
   * setRequestedOrientation 完成，Activity 的 configChanges 已含
   * orientation/screenSize，旋转不会重建页面。
   * 这段不受 enabled() 守卫：转到横屏后宽度 >560，手机层其余逻辑本来就让开，
   * 但进出形态仍要能继续切方向。
   * 浏览器没有 __liziNative：整行藏掉，不报错、不留半截状态。
   * ------------------------------------------------------------------ */
  var nativeBridge = null;
  try {
    if (window.__liziNative && typeof window.__liziNative.setOrientation === 'function') {
      nativeBridge = window.__liziNative;
    }
  } catch (e) { nativeBridge = null; }

  /* 2026-11-14：大屏平板（短边 ≥ 600dp）单独一条规则。
     清单里写死 portrait 时，Android 12L+ 会把这类窗口塞进竖屏信箱；壳里已经
     对大屏解开了方向锁，页面这边也必须跟着放手 —— 否则启动时又会把用户按回
     竖屏（默认基准方向就是竖屏），「进播放页变竖屏」就是这么来的。
     平板上：形态仍然锁横屏，其余时候 'auto'（交给设备自己转），设置里那行
     「屏幕方向」开关也藏掉，免得用户以为手动切得动。 */
  var isTablet = false;
  try {
    isTablet = !!(nativeBridge && typeof nativeBridge.isTablet === 'function' && nativeBridge.isTablet());
  } catch (e) { isTablet = false; }

  var ORIENT_KEY = 'lizi.m.orientation';
  var orientRow = document.getElementById('row-orientation');
  var orientSwitch = document.getElementById('set-orientation');

  function readPreferredOrientation() {
    try {
      return localStorage.getItem(ORIENT_KEY) === 'landscape' ? 'landscape' : 'portrait';
    } catch (e) { return 'portrait'; }
  }

  var preferredOrientation = readPreferredOrientation();

  function paintOrientationSwitch() {
    var landscape = preferredOrientation === 'landscape';
    if (orientSwitch) {
      orientSwitch.setAttribute('aria-checked', landscape ? 'true' : 'false');
      orientSwitch.setAttribute('aria-label', '屏幕方向：' + (landscape ? '横屏' : '竖屏'));
    }
    paintOrientationButton();
  }

  if (orientRow) orientRow.hidden = !nativeBridge || isTablet;
  paintOrientationSwitch();

  function desiredOrientation() {
    if (!document.body) return preferredOrientation;
    var view = document.body.dataset.view;
    /* 形态（舞台）是横屏作品；「我的专辑」那面 3D 书架在竖屏里显示很烂，
       点进去也强制横屏，退出来按用户自己的基准方向还原。
       body[data-view] 一变 bodyObs 就会调 syncOrientation，不用另外挂钩。 */
    var inStage = view === 'stage' || view === 'myalbums';
    /* 平板：形态照旧锁横屏，退出后交回设备（'auto' → UNSPECIFIED），
       不套用手机的「基准方向」——那会把平板永远按在竖屏。 */
    if (isTablet) return inStage ? 'landscape' : 'auto';
    return inStage ? 'landscape' : preferredOrientation;
  }

  var wantOrientation = '';

  function syncOrientation() {
    if (!nativeBridge || !document.body) return;
    var want = desiredOrientation();
    if (want === wantOrientation) return;
    wantOrientation = want;
    try { nativeBridge.setOrientation(want); } catch (e) { /* 旧壳没有这个桥 */ }
  }

  function toggleOrientation() {
    preferredOrientation = preferredOrientation === 'landscape' ? 'portrait' : 'landscape';
    try { localStorage.setItem(ORIENT_KEY, preferredOrientation); } catch (e) { /* 隐私模式 */ }
    paintOrientationSwitch();
    /* 形态里保持横屏；不在形态里立即按新方向转屏 */
    syncOrientation();
  }

  if (orientSwitch && nativeBridge) {
    orientSwitch.addEventListener('click', function () { toggleOrientation(); });
  }

  /* 顶栏右上角的转屏按钮：只出现在安卓壳里（浏览器没有 __liziNative）。
     绝对定位于 .topbar__inner 右侧，不参与 flex 排布，不会把中间品牌挤偏。
     点一下在竖屏/横屏之间切换，和设置页「屏幕方向」共享同一个 localStorage 值。 */
  var rotateBtn = null;

  function paintOrientationButton() {
    if (!rotateBtn) return;
    var want = preferredOrientation === 'landscape' ? '竖屏' : '横屏';
    rotateBtn.setAttribute('aria-label', '切换到' + want);
    rotateBtn.setAttribute('title', '切换到' + want);
  }

  function buildOrientationButton() {
    if (rotateBtn || !nativeBridge) return;
    var bar = document.querySelector('.topbar__inner');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.id = 'phone-rotate';
    btn.type = 'button';
    btn.className = 'tbtn tbtn--icon phone-rotate';
    btn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<rect x="7.2" y="2.6" width="9.6" height="18.8" rx="2.2" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M10 18.3h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M4.1 7.2a7.2 7.2 0 0 1 1.5-2.9M3.6 4.3l.5 2.9 2.9-.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleOrientation();
    });
    bar.appendChild(btn);
    rotateBtn = btn;
    paintOrientationButton();
    placeOrientationButton();
  }

  /* 转屏按钮不能盖住页面自己的右上角控件。
     播放页的「控制」在 .now__bar-right 里；此时把转屏按钮挪进同一个按钮簇、
     排在「控制」左边，它跟着播放页顶栏一起显隐，x 方向永远不会重叠。
     其余视图（顶栏可见）仍绝对定位在顶栏右上角 —— 那一块没有别的按钮。 */
  function placeOrientationButton() {
    if (!rotateBtn || !document.body) return;
    var inNow = document.body.dataset.view === 'now';
    var host = (inNow && viewNow)
      ? viewNow.querySelector('.now__bar-right')
      : document.querySelector('.topbar__inner');
    if (!host) return;
    if (rotateBtn.parentElement !== host) {
      host.insertBefore(rotateBtn, inNow ? host.firstChild : null);
    }
  }

  buildOrientationButton();

  /* 形态标记：只看 body[data-view]，不依赖屏幕方向 / 媒体查询。
     进形态时壳子会转横屏，宽度跨过 560，phone.css 里竖屏那一段整段失效；
     左上角「返回」被右侧歌曲胶囊的隐形热区盖住，必须在横屏继续修。
     这个类由 phone.js 自己维护（进 stage 加、离开摘），所以横屏也能命中，
     不必等 matchMedia 的 change 事件。规则见 phone.css 末尾。 */
  function syncStageMark() {
    if (!document.body) return;
    document.body.classList.toggle('phone-stage', document.body.dataset.view === 'stage');
    placeOrientationButton();
  }

  var bodyObs = new MutationObserver(function () {
    if (enabled() && hasLayoutClass()) stripLayouts();
    syncOrientation();
    syncStageMark();
    onStateChange();
  });
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['data-view', 'class'] });
  syncOrientation();
  syncStageMark();

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
        clearTimeout(lyrTimer);
        clearTimeout(lyrTimerFallback);
        viewNow.classList.remove('phone-lyr-open');
        viewNow.classList.remove('phone-lyr-in');
        viewNow.classList.remove('phone-lyr-closing');
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
    /* 拖到一半切到后台：pointercancel 不一定来，别让 seek 状态卡住 */
    if (document.hidden && seek) endSeek(true);
    else if (!document.hidden) paintProgress();
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

  /* ------------------------------------------------------------------ *
   * 搜索：触摸上 :hover 不保证按悬停计算，收起态点一下只会得到 hover 状态、
   * 输入框仍是 0 宽。手机层自己管一个 .phone-search-open：
   *   点收起的搜索钮 → 展开并聚焦输入框（一次点按就能打字）
   *   点别处 / Esc     → 收起并失焦
   * 桌面 app.js 在 wrap 上的 pointerleave → blur 会在触摸抬手后立刻把焦点打掉，
   * 那个监听挂在 wrap 上；在 window 捕获阶段先截住，指头离开 wrap 时不传递。
   * ------------------------------------------------------------------ */
  var searchWrap = document.getElementById('search-wrap');
  var searchInput = document.getElementById('search');

  function isSearchOpen() {
    return !!searchWrap && searchWrap.classList.contains('phone-search-open');
  }

  function openSearch() {
    if (!searchWrap || !enabled()) return;
    searchWrap.classList.add('phone-search-open');
    if (searchInput) {
      try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
    }
  }

  function closeSearch() {
    if (!searchWrap) return;
    searchWrap.classList.remove('phone-search-open');
    if (searchInput && document.activeElement === searchInput) searchInput.blur();
  }

  /* 品牌让位按实测宽度判断：收起的圆钮 38px，展开后 180px。
     hover / focus-within / .phone-search-open 任一路径撑开都能跟上。 */
  function syncBrandSpace() {
    if (!searchWrap) return;
    var wide = enabled() && searchWrap.getBoundingClientRect().width > 60;
    var cl = document.body.classList;
    if (wide) { cl.add('phone-search-wide'); cl.remove('phone-search-narrow'); }
    else { cl.add('phone-search-narrow'); cl.remove('phone-search-wide'); }
  }

  if (searchWrap) {
    searchWrap.addEventListener('touchend', function (e) {
      if (!enabled() || isSearchOpen()) return;
      e.preventDefault();              /* 收起的 38px 圆钮上，拦掉随之而来的合成点击 */
      openSearch();
    }, { passive: false });

    window.addEventListener('pointerleave', function (e) {
      if (!enabled() || !isSearchOpen() || !searchWrap.contains(e.target)) return;
      e.stopPropagation();
    }, true);

    document.addEventListener('pointerdown', function (e) {
      if (!enabled() || !isSearchOpen() || searchWrap.contains(e.target)) return;
      closeSearch();
    }, true);

    document.addEventListener('keydown', function (e) {
      if (enabled() && isSearchOpen() && e.key === 'Escape') closeSearch();
    }, true);

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(syncBrandSpace).observe(searchWrap);
    }
    searchWrap.addEventListener('focusin', syncBrandSpace);
    searchWrap.addEventListener('focusout', function () { setTimeout(syncBrandSpace, 0); });
  }

  if (mq && mq.addEventListener) mq.addEventListener('change', function () { closeSearch(); syncBrandSpace(); });
  else if (mq && mq.addListener) mq.addListener(function () { closeSearch(); syncBrandSpace(); });

  syncBrandSpace();

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

/* ------------------------------------------------------------------ *
   手机播放页 3D 悬浮 / 陀螺仪视差（2026-11-21 用户要求）
   --------------------------------------------------------------------------
   只改合成层，不动布局：
     · 封面 .disc 在 CSS 里带 translateZ(46px) + 陀螺仪旋转，看起来是浮在
       页面上的一张卡；歌名 / 控制键 / 进度线按不同深度轻微错动；
     · 背景 .now-bg 反向平移，形成"在一个空间里"的视差；
     · 读数归一化成 -1..1 写进 --gyro-x / --gyro-y，CSS 自己算角度。
   默认关（设置里「播放页悬浮」打开才生效，body 带 .now-float）：
   关着时一次事件都不处理，主播放页和原来完全一样。
   只在手机宽度 + 播放页 + 没有 prefers-reduced-motion 时启用。
   第一次事件当作基准姿态（用户怎么拿手机，哪里就是中位），
   离开播放页 / 切后台 / 开关切换都归零并重新标定。
   -------------------------------------------------------------------------- */
(function initNowParallax() {
  var mq = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var root = document.documentElement;
  var body = document.body;
  var base = null;          // 基准姿态：第一次事件的 beta / gamma
  var tx = 0, ty = 0;       // 目标（-1..1）
  var cx = 0, cy = 0;       // 阻尼后的当前值
  var raf = 0;

  function onNow() {
    return !!mq && mq.matches
      && body && body.dataset.view === 'now'
      && body.classList.contains('now-float')
      && !(reduce && reduce.matches);
  }

  function reset() {
    base = null;
    tx = ty = cx = cy = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    root.style.setProperty('--gyro-x', '0');
    root.style.setProperty('--gyro-y', '0');
  }

  function tick() {
    cx += (tx - cx) * 0.14;
    cy += (ty - cy) * 0.14;
    root.style.setProperty('--gyro-x', cx.toFixed(4));
    root.style.setProperty('--gyro-y', cy.toFixed(4));
    if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  }

  function onOrient(e) {
    if (!onNow()) return;
    if (typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;
    if (!base) { base = { b: e.beta, g: e.gamma }; return; }
    var nx = Math.max(-1, Math.min(1, (e.beta - base.b) / 26));
    var ny = Math.max(-1, Math.min(1, (e.gamma - base.g) / 26));
    /* 小抖动直接归零：手不可能完全静止，留一点死区更像"悬浮"而不是"抖" */
    if (Math.abs(nx) < 0.02) nx = 0;
    if (Math.abs(ny) < 0.02) ny = 0;
    tx = nx;
    ty = ny;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', onOrient, true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) reset();
  });
  /* 设置里开关「播放页悬浮」：关掉立刻归零，打开后下一次事件重新标定 */
  document.addEventListener('lizi:now-float', reset);
  if (window.MutationObserver && body) {
    new MutationObserver(function () {
      if (!onNow()) reset();
    }).observe(body, { attributes: true, attributeFilter: ['data-view'] });
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', reset);
})();

/* ------------------------------------------------------------------ *
   横屏视口：沿用 1.0.5 安卓壳的做法（构建时把 index.html 固定成 width=1280），
   792×354 的横屏整页因此缩到约 0.62，观感和 1.0.5 一致；
   竖屏仍然是 device-width，手机布局不受影响。
   ------------------------------------------------------------------ */
(function () {
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  var PORTRAIT = 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no';
  var LANDSCAPE = 'width=1280, user-scalable=no, maximum-scale=1';
  function apply() {
    var wide = window.matchMedia
      ? window.matchMedia('(orientation: landscape)').matches
      : (window.innerWidth > window.innerHeight);
    var want = wide ? LANDSCAPE : PORTRAIT;
    if (meta.getAttribute('content') !== want) meta.setAttribute('content', want);
  }
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', function () { setTimeout(apply, 80); });
})();

/* ------------------------------------------------------------------ *
   旋转过渡标记：横竖互换时给 body 加 .is-rotating（420ms），
   phone.css 在期间关掉最贵的背景模糊 / 顶栏 backdrop-filter，
   缩短重排时那块"黑色的面板"。普通 resize（键盘、地址栏）不触发。
   ------------------------------------------------------------------ */
(function () {
  var timer = 0;
  var wide = window.innerWidth > window.innerHeight;
  function mark() {
    if (!document.body) return;
    document.body.classList.add('is-rotating');
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.body) document.body.classList.remove('is-rotating');
    }, 420);
  }
  window.addEventListener('orientationchange', function () {
    wide = window.innerWidth > window.innerHeight;
    mark();
  });
  window.addEventListener('resize', function () {
    var nowWide = window.innerWidth > window.innerHeight;
    if (nowWide === wide) return;
    wide = nowWide;
    mark();
  });
})();
