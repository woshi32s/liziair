/* ==========================================================================
   播放页排版 · player-layouts.js
   --------------------------------------------------------------------------
   只做四件事：
     1) 在设置页的 #now-layout-picker 里生成 4 张版式卡（默认 + 3 套）；
     2) 在播放页抽屉 #diy-wrap 顶部注入同一组版式 chip（不改抽屉 markup）；
     3) 点击任意一边，给 <body> 挂 .now-layout-NN，并同步两边的高亮；
     4) 记住选择：localStorage['lizi.now.layout']，值 '' / '02' / '04' / '06'。

   不改 app.js / app.css / player.js，不移动、不复制任何已有节点。
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'lizi.now.layout';

  var LAYOUTS = [
    { id: '',   key: 'default', name: '默认',     desc: '现在的两栏' },
    { id: '02', key: '02',      name: '左右对半', desc: '50/50 两列通高' },
    { id: '04', key: '04',      name: '上下分屏', desc: '上半封面 · 下半歌词' },
    { id: '06', key: '06',      name: '极小封面', desc: '96px 封面 · 大留白' }
  ];

  var root = document.getElementById('now-layout-picker');
  var diyWrap = document.getElementById('diy-wrap');
  var drawerBox = null;
  var body = document.body;

  function normalize(id) {
    for (var i = 0; i < LAYOUTS.length; i++) {
      if (LAYOUTS[i].id === id) return id;
    }
    return '';
  }

  function find(id) {
    for (var i = 0; i < LAYOUTS.length; i++) {
      if (LAYOUTS[i].id === id) return LAYOUTS[i];
    }
    return LAYOUTS[0];
  }

  function readSaved() {
    try {
      return normalize(localStorage.getItem(KEY) || '');
    } catch (e) {
      return '';
    }
  }

  function writeSaved(id) {
    try { localStorage.setItem(KEY, id); } catch (e) { /* 隐私模式忽略 */ }
  }

  function syncUI(next) {
    if (root) {
      var cards = root.querySelectorAll('.nl-card');
      for (var i = 0; i < cards.length; i++) {
        var on = cards[i].getAttribute('data-layout') === next;
        cards[i].classList.toggle('is-on', on);
        cards[i].setAttribute('aria-checked', String(on));
      }
      var label = document.getElementById('nl-now');
      if (label) label.textContent = '当前：' + find(next).name;
    }
    if (drawerBox) {
      var chips = drawerBox.querySelectorAll('.nld__b');
      for (var j = 0; j < chips.length; j++) {
        var hit = chips[j].getAttribute('data-layout') === next;
        chips[j].classList.toggle('is-on', hit);
        chips[j].setAttribute('aria-pressed', String(hit));
      }
    }
  }

  function apply(id, persist) {
    var next = normalize(id);

    /* 连已经不存在的旧版式类一起清掉（例如升级前存过 01/05） */
    var classes = Array.prototype.slice.call(body.classList);
    for (var i = 0; i < classes.length; i++) {
      if (/^now-layout-\d+$/.test(classes[i])) body.classList.remove(classes[i]);
    }
    if (next) body.classList.add('now-layout-' + next);

    syncUI(next);
    if (persist) writeSaved(next);
  }

  /* ---- 设置页：卡片 + 线框预览 ---- */
  if (root) {
    function previewMarkup() {
      return '<i class="nlw-art"></i><i class="nlw-meta"></i>' +
             '<i class="nlw-ctl"></i><i class="nlw-ly"></i><i class="nlw-dock"></i>';
    }

    var cardsHTML = LAYOUTS.map(function (l) {
      return '<button type="button" class="nl-card" role="radio" aria-checked="false"' +
        ' data-layout="' + l.id + '" title="' + l.name + '">' +
        '<span class="nlw" data-preview="' + l.key + '" aria-hidden="true">' + previewMarkup() + '</span>' +
        '<span class="nl-card__text"><b>' + l.name + '</b><em>' + l.desc + '</em></span>' +
        '</button>';
    }).join('');

    root.innerHTML =
      '<div class="nl-grid" role="radiogroup" aria-label="播放页排版">' + cardsHTML + '</div>' +
      '<div class="nl-foot">' +
        '<span class="nl-foot__now" id="nl-now">当前：默认</span>' +
        '<button type="button" class="nl-foot__go" id="nl-go">去播放页看看</button>' +
      '</div>';

    root.addEventListener('click', function (e) {
      var card = e.target.closest('.nl-card');
      if (card) {
        apply(card.getAttribute('data-layout') || '', true);
        return;
      }
      if (e.target.closest('#nl-go')) {
        /* 和 app.js 的其它入口走同一条路，不自己碰 show() */
        try {
          document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'now' } }));
        } catch (err) {
          location.hash = 'now';
        }
      }
    });
  }

  /* ---- 播放页抽屉：注到 #diy-wrap 最上方，不用 .diy 类 ---- */
  if (diyWrap && !diyWrap.querySelector('.nld')) {
    var chipsHTML = LAYOUTS.map(function (l) {
      return '<button type="button" class="nld__b" aria-pressed="false"' +
        ' data-layout="' + l.id + '">' + l.name + '</button>';
    }).join('');

    diyWrap.insertAdjacentHTML('afterbegin',
      '<div class="nld" role="group" aria-label="播放页版式">' +
        '<div class="nld__t">播放页版式</div>' +
        '<div class="nld__grid">' + chipsHTML + '</div>' +
      '</div>');

    drawerBox = diyWrap.querySelector('.nld');
    drawerBox.addEventListener('click', function (e) {
      var chip = e.target.closest('.nld__b');
      if (chip) apply(chip.getAttribute('data-layout') || '', true);
    });
  }

  /* 初始值：两边一起点亮；顺带把已被淘汰的旧值清成「默认」 */
  var initial = readSaved();
  apply(initial, false);
  writeSaved(initial);
})();
