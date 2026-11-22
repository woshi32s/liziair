/* ==========================================================================
   手机版播放页 · 右下角「队列」小窗（/m 专用）
   --------------------------------------------------------------------------
   只做手机层闭环：
     · 入口是 /m/index.html 里的 #ntr-queue（.ntr 同款圆钮）
     · 数据只读 Player.state.queue / Player.state.index（app.js 现成的队列）
     · 点一行调用 Player.playQueue(q, i)，和桌面队列 / 设置页队列同一条切歌入口
     · 不复制播放逻辑、不碰 audio，不修改桌面 DOM / CSS
   打开方式：点按钮；关闭：点遮罩、右上角 X、Esc、安卓返回键。
   列表 = 整条队列（已播的也在），当前曲目用 ▶ + 高亮行标出；
   标题计数 = 队列总首数 —— 和桌面抽屉里的「播放队列 · N 首」同一个口径，
   不能按「当前之后还剩几首」算（100 首听到第 22 首会写成 78 首）。
   ========================================================================== */
(function () {
  'use strict';

  var btn = document.getElementById('ntr-queue');
  if (!btn) return;

  var sheet = null;
  var panel = null;
  var list = null;
  var countEl = null;
  var nowEl = null;
  var closeBtn = null;
  var lastFocus = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function playerState() {
    try {
      if (typeof Player !== 'undefined' && Player && Player.state) return Player.state;
    } catch (e) { /* 播放器还没加载：按空队列处理 */ }
    return null;
  }

  function artistsOf(t) {
    if (!t || !t.artists) return '未知歌手';
    return String(t.artists).split('/').map(function (s) { return s.trim(); })
      .filter(Boolean).join(' / ');
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ *
   * DOM：抽屉挂在 body 上，避开 #view-now 内部的点击 / 手势规则
   * ------------------------------------------------------------------ */
  function build() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.id = 'queue-sheet';
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML =
      '<div class="qs__mask" data-qs-close></div>' +
      '<section class="qs__panel" role="dialog" aria-modal="true" aria-labelledby="qs-title">' +
        '<header class="qs__head">' +
          '<div class="qs__head-txt">' +
            '<div class="qs__title-row">' +
              '<h2 class="qs__title" id="qs-title">播放队列</h2>' +
              '<span class="qs__count" id="qs-count">0 首</span>' +
            '</div>' +
            '<p class="qs__now"><span class="qs__now-dot" aria-hidden="true"></span>' +
              '<span class="qs__now-text" id="qs-now-text">—</span></p>' +
          '</div>' +
          '<button class="qs__x" type="button" data-qs-close aria-label="关闭队列" title="关闭">' +
            '<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg>' +
          '</button>' +
        '</header>' +
        '<div class="qs__list" id="qs-list"></div>' +
      '</section>';
    document.body.appendChild(sheet);

    panel = sheet.querySelector('.qs__panel');
    list = sheet.querySelector('#qs-list');
    countEl = sheet.querySelector('#qs-count');
    nowEl = sheet.querySelector('#qs-now-text');
    closeBtn = sheet.querySelector('.qs__x');

    sheet.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-qs-close]')) closeSheet();
    });

    list.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('.qrow');
      if (row) playRow(row);
    });

    list.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var row = e.target.closest && e.target.closest('.qrow');
      if (!row || e.target !== row) return;
      e.preventDefault();
      e.stopPropagation();
      playRow(row);
    });
  }

  /* ------------------------------------------------------------------ *
   * 渲染：只读 Player.state，不写回
   * ------------------------------------------------------------------ */
  function paint() {
    build();
    var st = playerState();
    var q = (st && st.queue) || [];
    var idx = st ? st.index : -1;
    var cur = (idx >= 0 && idx < q.length) ? q[idx] : null;

    nowEl.textContent = cur
      ? '正在播放 · ' + (cur.name || '未知曲目') + ' — ' + artistsOf(cur)
      : '还没有播放中的歌';

    /* 计数 = 整条队列的长度（歌单 100 首就写 100 首，不随当前播放位置缩水） */
    countEl.textContent = q.length ? q.length + ' 首' : '0 首';

    if (!q.length) {
      list.innerHTML = '<p class="qs__empty">队列里还没有歌</p>';
      return;
    }

    /* 整条队列都列出来（已播的也在），当前曲目 ▶ + 高亮行 —— 和桌面 #queue
       的渲染一致，也顺带让用户能点回前面听过的歌。 */
    list.innerHTML = q.map(function (t, i) {
      var on = i === idx;
      var dur = (t && typeof t.duration === 'number' && isFinite(t.duration) && t.duration > 0)
        ? fmtTime(t.duration / 1000) : '';
      return '<div class="qrow' + (on ? ' is-on' : '') + '" role="button" tabindex="0" data-i="' + i + '"' +
          (on ? ' aria-current="true"' : '') + '>' +
        '<span class="qrow__i">' + (on ? '▶' : String(i + 1).padStart(2, '0')) + '</span>' +
        '<span class="qrow__t">' +
          '<span class="qrow__n">' + esc(t && t.name) + '</span>' +
          '<span class="qrow__a">' + esc(artistsOf(t)) + '</span>' +
        '</span>' +
        '<span class="qrow__d">' + dur + '</span>' +
      '</div>';
    }).join('');

    /* 抽屉开着时换歌：列表重排完把当前行留在视口中间 */
    if (!sheet.hidden) centerOnCurrent();
  }

  /* 小窗只有 55vh：100 首的队列打开时必须先落在当前曲目附近，
     不能每次都从第 1 首开始滚。 */
  function centerOnCurrent() {
    if (!list) return;
    var on = list.querySelector('.qrow.is-on');
    if (!on || !list.clientHeight) return;
    var want = on.offsetTop - list.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
    list.scrollTop = Math.max(0, want);
  }

  /* ------------------------------------------------------------------ *
   * 切歌：复用 app.js / 设置页队列同一条入口 Player.playQueue
   * ------------------------------------------------------------------ */
  function playRow(row) {
    var st = playerState();
    if (!st) return;
    var i = Number(row.dataset.i);
    var q = st.queue || [];
    if (!Number.isInteger(i) || i < 0 || i >= q.length) return;
    if (Player.state.queue === q && Player.state.index === i) return;
    Player.playQueue(q, i);
    /* 点完就收回，让用户直接看到播放页；拖动进度条那套逻辑完全不受影响 */
    closeSheet();
  }

  /* ------------------------------------------------------------------ *
   * 开合
   * ------------------------------------------------------------------ */
  function isOpen() {
    return !!sheet && !sheet.hidden && sheet.classList.contains('is-open');
  }

  function openSheet() {
    build();
    paint();
    lastFocus = document.activeElement;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('qs-open');
    void panel.offsetHeight;            /* 先把起点钉住，再上 .is-open */
    sheet.classList.add('is-open');
    centerOnCurrent();                  /* 布局已就位：列表先滚到当前曲目 */
    setTimeout(function () {
      if (!isOpen()) return;
      try { closeBtn.focus({ preventScroll: true }); } catch (e) { closeBtn.focus(); }
    }, 0);
  }

  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('qs-open');
    /* 状态即时落地：WebView 里淡出过渡不可靠，收起直接 hidden，
       下次打开仍走 .is-open 的 140ms 进场。 */
    sheet.hidden = true;
    if (lastFocus && lastFocus.focus && !lastFocus.closest('#queue-sheet')) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
    lastFocus = null;
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();          /* 别让播放页的其它轻点处理再走一遍 */
    if (isOpen()) closeSheet();
    else openSheet();
  });

  /* Esc：捕获阶段先关小窗，避免全局 Esc 直接退回浏览页 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
  }, true);

  /* 安卓返回键：phone.js 已经包了一层，这里再包在外层，优先收小窗 */
  var baseBack = window.__liziPhoneBack;
  if (typeof baseBack === 'function') {
    window.__liziPhoneBack = function () {
      if (isOpen()) { closeSheet(); return true; }
      return baseBack.apply(this, arguments);
    };
  }

  /* 自动切歌 / 顺序播到下一首时，抽屉开着就同步重排（当前行跟着挪） */
  try {
    if (typeof Player !== 'undefined' && Player && typeof Player.on === 'function') {
      Player.on('trackchange', function () { if (isOpen()) paint(); });
    }
  } catch (e) { /* 老环境没有事件：打开时反正会重画 */ }

  /* 离开播放页 / 换视图：抽屉跟着收，不需要额外定时器 */
  document.addEventListener('lizi:show', function () { if (isOpen()) closeSheet(); });
})();
