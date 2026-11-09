/* LIZI Air · 设置页方案实验室
   静态预览：不接任何真实逻辑，不改真实设置页。
   内容按现有设置页的分区做成 mock，四套方案共用一份内容模型。 */
(function () {
  'use strict';

  /* ---------- 分区 ---------- */
  var SECTIONS = [
    { key: 'account', idx: '01', label: '账号', title: '账号', icon: 'user', sub: '身份、登录与主页外观' },
    { key: 'sources', idx: '02', label: '音源', title: '音源', icon: 'layers', sub: '平台管理与登录状态' },
    { key: 'audio', idx: '03', label: '音效', title: '音效', icon: 'sliders', sub: '音质与均衡器' },
    { key: 'layout', idx: '04', label: '播放页', title: '播放页排版', icon: 'layout', sub: '四种版式，即时切换' },
    { key: 'look', idx: '05', label: '外观', title: '外观', icon: 'sun', sub: '专辑展示、跑马带与引导' },
    { key: 'player', idx: '06', label: '播放条', title: '播放条', icon: 'bar', sub: '主页面播放条与皮肤' },
    { key: 'about', idx: '07', label: '关于', title: '关于', icon: 'info', sub: '版本与说明' }
  ];
  var SEC = {};
  SECTIONS.forEach(function (s) { SEC[s.key] = s; });

  /* ---------- 图标（内联，无外部资源） ---------- */
  var ICON_PATHS = {
    user: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5 19.4c.9-3.2 3.5-4.9 7-4.9s6.1 1.7 7 4.9"/>',
    layers: '<path d="M4 8 12 4.5 20 8 12 11.5 4 8Z"/><path d="m4 12 8 3.5 8-3.5"/><path d="m4 16 8 3.5 8-3.5"/>',
    sliders: '<path d="M4 7h6M16 7h4M4 12h10M18 12h2M4 17h4M14 17h6"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="17" r="2"/>',
    layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M10 9.5v10"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8 16.8 7.2M7.2 16.8 5.8 18.2"/>',
    bar: '<rect x="3" y="8.5" width="18" height="7" rx="2.4"/><path d="M7 12h5M15.5 12h1.5"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11.2v4.8"/><circle cx="12" cy="8.2" r=".75" fill="currentColor" stroke="none"/>'
  };

  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  var CARET = '<svg class="ico row__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  /* ---------- 二维码占位（确定性生成的假码，不联网） ---------- */
  var QR = (function () {
    var n = 25;
    var quiet = 2;
    var total = n + quiet * 2;
    var seed = 20261108;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    var cells = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var finder = false;
        var dark = false;
        var corners = [[0, 0], [n - 7, 0], [0, n - 7]];
        for (var k = 0; k < corners.length; k++) {
          var rr = r - corners[k][0];
          var cc = c - corners[k][1];
          if (rr >= 0 && rr < 7 && cc >= 0 && cc < 7) {
            finder = true;
            var edge = rr === 0 || rr === 6 || cc === 0 || cc === 6;
            var core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;
            dark = edge || core;
          }
        }
        if (!finder) {
          if (r === 6 || c === 6) dark = (r + c) % 2 === 0;
          else dark = rnd() > 0.48;
        }
        if (dark) {
          cells += '<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1" height="1"/>';
        }
      }
    }
    return '<svg class="qr-svg" viewBox="0 0 ' + total + ' ' + total + '" role="img" aria-label="二维码占位">' +
      '<rect width="100%" height="100%" fill="#ffffff"/>' +
      '<g fill="#161616">' + cells + '</g></svg>';
  })();

  /* ---------- 行与小组件 ---------- */
  function btn(text, kind) {
    return '<button type="button" class="btn ' + (kind || '') + '">' + text + '</button>';
  }

  function rowLink(label, value) {
    return '<button type="button" class="row row--link">' +
      '<span class="row__label">' + label + '</span>' +
      '<span class="row__val">' + value + '</span>' + CARET + '</button>';
  }

  function rowFlat(label, value, hint) {
    return '<div class="row">' +
      '<span class="row__label">' + label + '</span>' +
      (hint ? '<span class="row__hint">' + hint + '</span>' : '') +
      '<span class="row__val">' + value + '</span></div>';
  }

  function srcRow(name, state, limit, action) {
    var on = state === '已连接';
    return '<div class="row row--src">' +
      '<span class="row__main"><span class="row__label">' + name + '</span>' +
      (limit ? '<span class="row__hint">' + limit + '</span>' : '') + '</span>' +
      '<span class="row__val' + (on ? ' is-on' : '') + '">' + state + '</span>' +
      '<div class="row__acts">' + btn(action, 'btn--sm ' + (on ? 'btn--ghost' : 'btn--ink')) + '</div>' +
      '</div>';
  }

  function switchRow() {
    return '<div class="row row--switch">' +
      '<span class="row__main"><span class="row__label">主页面播放条</span>' +
      '<span class="row__hint">关闭后大厅 / 搜索等页面不再显示底部播放条</span></span>' +
      '<button type="button" class="switch" role="switch" aria-checked="false" aria-label="主页面播放条">' +
      '<span class="switch__knob" aria-hidden="true"></span></button></div>';
  }

  function rangeRow() {
    return '<div class="row row--range">' +
      '<span class="row__label">推荐跑马带速度</span>' +
      '<input class="range" type="range" min="0" max="100" step="1" value="24" aria-label="推荐跑马带速度">' +
      '<span class="row__val range-val"><b>24</b><em>慢</em></span></div>';
  }

  function qrPanel() {
    return '<div class="qr">' +
      '<div class="qr__box">' + QR + '</div>' +
      '<div class="qr__side">' +
      '<p class="qr__status">用手机扫码</p>' +
      '<div class="qr__ch" role="group" aria-label="扫码方式">' +
      '<button type="button" class="is-on">QQ 音乐</button>' +
      '<button type="button">手机 QQ</button>' +
      '<button type="button">微信</button>' +
      '</div>' +
      '<p class="qr__note">二维码为静态占位 · 第三方协议，用你自己的账号登录，风险自担。</p>' +
      '</div></div>';
  }

  /* ---------- 各分区内容 ---------- */
  function accountBody() {
    return '<div class="acct">' +
      '<span class="acct__avatar" aria-hidden="true">' + icon('user') + '</span>' +
      '<div class="acct__who"><strong>荔子</strong>' +
      '<span class="acct__status"><i class="dot" aria-hidden="true"></i>已登录 · 网易云音乐</span></div>' +
      '<div class="acct__acts">' + btn('退出', 'btn--ink') + btn('登录', 'btn--ghost') + '</div>' +
      '</div>' +
      '<div class="rows">' +
      rowLink('账号管理', '网易云音乐') +
      rowLink('或粘贴 Cookie', 'MUSIC_U') +
      rowLink('主页背景', '默认渐变') +
      '</div>';
  }

  function sourcesBody() {
    return '<div class="rows">' +
      rowLink('平台管理', '全部 7 个') +
      srcRow('QQ 音乐', '未连接', '扫码后可播放完整曲目', '登录') +
      '</div>' +
      qrPanel() +
      '<div class="rows qr-follow">' +
      srcRow('酷狗音乐', '未连接', '播放需登录', '登录') +
      srcRow('汽水音乐', '未连接', '未登录只有 30 秒试听 · 要 Node 24', '登录') +
      srcRow('波点音乐', '未连接', '未登录只有 30 秒试听 · 仅大陆网络', '登录') +
      srcRow('Spotify', '未配置', '仅元数据 · 需自备 Client ID · 音频要 Premium', '登录') +
      '</div>';
  }

  function audioBody() {
    return '<div class="rows">' + rowLink('音效 / 均衡器', '极高 · 平直') + '</div>' +
      '<div class="tagrow" aria-hidden="true"><span class="tag">音质 · 极高</span>' +
      '<span class="tag">预设 · 平直</span><span class="tag">空间音频 · 关</span></div>' +
      '<p class="note">音质和预设都在整页里调；播放页抽屉里也能开同一个面板。</p>';
  }

  var LAYOUTS = [
    { id: 'default', name: '默认', desc: '现在的两栏', thumb: 'default' },
    { id: '02', name: '左右对半', desc: '50/50 两列通高', thumb: '02' },
    { id: '04', name: '上下分屏', desc: '上半封面 · 下半歌词', thumb: '04' },
    { id: '06', name: '极小封面', desc: '96px 封面 · 大留白', thumb: '06' }
  ];

  function layoutBody() {
    var cards = LAYOUTS.map(function (l, i) {
      return '<button type="button" class="lay-card' + (i === 0 ? ' is-on' : '') + '" role="radio" aria-checked="' +
        (i === 0 ? 'true' : 'false') + '">' +
        '<span class="lay-thumb t-' + l.thumb + '"><span></span><span></span></span>' +
        '<span class="lay-meta"><b>' + l.name + '</b><em>' + l.desc + '</em></span></button>';
    }).join('');
    return '<div class="lay-grid" role="radiogroup" aria-label="播放页排版">' + cards + '</div>' +
      '<p class="note">选一种立刻生效，只改播放页；不喜欢就点「默认」。</p>';
  }

  function lookBody() {
    return '<div class="rows">' +
      rowLink('我的专辑展示', '侧立 3D') +
      rangeRow() +
      rowFlat('字体选择', 'Geist', '待开放') +
      rowFlat('快捷键', '默认', '待开放') +
      rowLink('开场引导', '还没看过') +
      '</div>' +
      '<p class="note">跑马带速度只影响大厅「每日推荐」的横向滚动；拖动即时生效。</p>';
  }

  var SKINS = [
    { id: 'default', name: '默认播放条', desc: '无动画 · 纯色' },
    { id: '01', name: '星轨粒子', desc: 'React Bits · Particles' },
    { id: '03', name: '流星跑道', desc: 'Magic UI · Meteors' },
    { id: '08', name: '棱镜玻璃', desc: 'React Bits · StarBorder' }
  ];

  function playerBody() {
    var cards = SKINS.map(function (s, i) {
      return '<button type="button" class="pick-card skin-card' + (i === 0 ? ' is-on' : '') + '" role="radio" aria-checked="' +
        (i === 0 ? 'true' : 'false') + '">' +
        '<span class="skin-swatch s-' + s.id + '" aria-hidden="true"></span>' +
        '<span class="pick-meta"><b>' + s.name + '</b><em>' + s.desc + '</em></span></button>';
    }).join('');
    return '<div class="rows">' + switchRow() + '</div>' +
      '<div class="subhead"><span>播放条皮肤</span><span class="mono">静态占位</span></div>' +
      '<div class="skin-grid" role="radiogroup" aria-label="播放条皮肤">' + cards + '</div>' +
      '<p class="note">皮肤只在主页面播放条开启时生效。</p>';
  }

  function aboutBody() {
    return '<div class="rows">' +
      rowFlat('关于 LIZI', 'LIZI Air') +
      rowFlat('版本', '1.0.0') +
      '</div>' +
      '<p class="note">折射和形态渲染已固定为默认值；形态切换在播放页右侧抽屉里。</p>';
  }

  var BODIES = {
    account: accountBody,
    sources: sourcesBody,
    audio: audioBody,
    layout: layoutBody,
    look: lookBody,
    player: playerBody,
    about: aboutBody
  };

  /* ---------- 通用外壳 ---------- */
  function sec(v, key, cls) {
    var s = SEC[key];
    var id = v + '-sec-' + key;
    return '<section class="sec ' + (cls || '') + '" id="' + id + '" aria-labelledby="' + id + '-h">' +
      '<header class="sec__head"><span class="sec__idx" aria-hidden="true">' + s.idx + '</span>' +
      '<h2 id="' + id + '-h">' + s.title + '</h2>' +
      '<p class="sec__sub">' + s.sub + '</p></header>' +
      '<div class="sec__body">' + BODIES[key]() + '</div></section>';
  }

  function vhead(letter, name, note, meta) {
    return '<header class="vhead">' +
      '<span class="vbadge" aria-hidden="true">' + letter + '</span>' +
      '<span class="vname">' + name + '</span>' +
      '<span class="vnote">' + note + '</span>' +
      (meta ? '<span class="vmeta">' + meta + '</span>' : '') +
      '</header>';
  }

  function navA() {
    return SECTIONS.map(function (s, i) {
      return '<button type="button" class="a-nav__item' + (i === 0 ? ' is-on' : '') + '" data-target="a-sec-' + s.key + '">' +
        '<span class="a-nav__idx">' + s.idx + '</span>' + icon(s.icon) +
        '<span class="a-nav__label">' + s.label + '</span></button>';
    }).join('');
  }

  function navB() {
    return SECTIONS.map(function (s, i) {
      return '<button type="button" class="b-nav__item' + (i === 0 ? ' is-on' : '') + '" data-target="b-sec-' + s.key + '">' +
        '<span class="b-nav__idx">' + s.idx + '</span><span>' + s.label + '</span></button>';
    }).join('');
  }

  function tabsD() {
    return SECTIONS.map(function (s, i) {
      return '<button type="button" class="d-tab' + (i === 0 ? ' is-on' : '') + '" data-target="d-sec-' + s.key + '">' +
        '<b>' + s.idx + '</b><span>' + s.label + '</span></button>';
    }).join('');
  }

  /* ---------- 四套方案 ---------- */
  function renderA() {
    return '<section class="variant variant--a" id="view-a" data-view="a">' +
      vhead('A', '全宽控制台', '桌面应用式全宽控制台', '推荐方向') +
      '<div class="a-hero">' +
      '<div><span class="eyebrow">PREFERENCES · LIZI AIR</span>' +
      '<h1>设置</h1>' +
      '<p>账号、音源、音效与外观。改完即时生效，不用刷新。</p></div>' +
      '<div class="a-hero__meta"><span>本机保存</span><i></i><span>无需重启</span><i></i><span>7 个分区</span></div>' +
      '</div>' +
      '<div class="a-shell">' +
      '<aside class="a-nav" data-nav-group aria-label="设置分区">' + navA() +
      '<div class="a-nav__foot"><span>LIZI Air</span><span>1.0.0</span></div></aside>' +
      '<div class="a-grid">' +
      sec('a', 'account', 'a-card a-span2') +
      sec('a', 'sources', 'a-card a-span2') +
      sec('a', 'audio', 'a-card') +
      sec('a', 'layout', 'a-card') +
      sec('a', 'look', 'a-card') +
      sec('a', 'player', 'a-card') +
      sec('a', 'about', 'a-card a-span2') +
      '</div></div></section>';
  }

  function renderB() {
    return '<section class="variant variant--b" id="view-b" data-view="b">' +
      '<div class="b-top">' + vhead('B', '单页白纸', '一张白纸的系统设置', '克制') + '</div>' +
      '<div class="b-paper">' +
      '<aside class="b-nav" data-nav-group aria-label="设置分区"><div class="b-nav__inner">' + navB() + '</div></aside>' +
      '<div class="b-main">' +
      '<header class="b-hero"><span class="eyebrow">PREFERENCES</span><h1>设置</h1>' +
      '<p>账号、音源、音效与外观。改完即时生效，不用刷新。</p></header>' +
      SECTIONS.map(function (s) { return sec('b', s.key, 'b-sec'); }).join('') +
      '</div></div></section>';
  }

  function renderC() {
    return '<section class="variant variant--c" id="view-c" data-view="c">' +
      vhead('C', '杂志留白', '杂志式留白，少而精', '设计感') +
      '<div class="c-hero">' +
      '<div class="c-hero__left"><span class="eyebrow">PREFERENCES · 01—07</span>' +
      '<h1 class="c-title"><span class="c-shine">设置</span></h1></div>' +
      '<div class="c-hero__right"><p>账号、音源、音效与外观。<br>改完即时生效，不用刷新。</p>' +
      '<span class="mono">LIZI AIR / 1.0.0</span></div>' +
      '</div>' +
      '<div class="c-flow">' +
      sec('c', 'account', 'c-sec c-w66') +
      sec('c', 'sources', 'c-sec c-w82 c-right') +
      sec('c', 'audio', 'c-sec c-w44 c-plain') +
      sec('c', 'layout', 'c-sec c-w62 c-right') +
      sec('c', 'look', 'c-sec c-w70') +
      sec('c', 'player', 'c-sec c-w48 c-plain c-right') +
      sec('c', 'about', 'c-sec c-w38 c-plain') +
      '</div></section>';
  }

  function renderD() {
    return '<section class="variant variant--d" id="view-d" data-view="d">' +
      '<div class="d-top">' + vhead('D', '横向分区', '横向分区，宽屏铺满', '宽屏') + '</div>' +
      '<div class="d-tabs" data-nav-group aria-label="设置分区">' + tabsD() + '</div>' +
      '<div class="d-main">' +
      '<header class="d-hero"><span class="eyebrow">PREFERENCES · LIZI AIR</span><h1>设置</h1>' +
      '<p>账号、音源、音效与外观。改完即时生效，不用刷新。</p></header>' +
      '<div class="d-grid">' +
      sec('d', 'account', 'd-card d-span3') +
      sec('d', 'sources', 'd-card d-span3') +
      sec('d', 'audio', 'd-card d-span2') +
      sec('d', 'layout', 'd-card d-span2') +
      sec('d', 'look', 'd-card d-span2 d-look') +
      sec('d', 'player', 'd-card d-span3') +
      sec('d', 'about', 'd-card d-span3') +
      '</div></div></section>';
  }

  /* ---------- 渲染 ---------- */
  var lab = document.getElementById('lab');
  var bar = document.querySelector('.labbar__views');
  lab.innerHTML = renderA() + renderB() + renderC() + renderD();

  var variants = Array.prototype.slice.call(lab.querySelectorAll('.variant'));
  var viewBtns = Array.prototype.slice.call(bar.querySelectorAll('[data-view]'));
  var VIEWS = ['a', 'b', 'c', 'd', 'all'];
  var current = 'a';

  function motion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function setView(v, scroll) {
    if (VIEWS.indexOf(v) === -1) v = 'a';
    current = v;
    var all = v === 'all';
    lab.classList.toggle('is-all', all);
    variants.forEach(function (el) { el.classList.toggle('is-active', el.getAttribute('data-view') === v); });
    viewBtns.forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    try { history.replaceState(null, '', '#' + v); } catch (err) { /* file:// 等环境忽略 */ }
    if (scroll) {
      var dest = all ? variants[0] : document.getElementById('view-' + v);
      if (dest) {
        requestAnimationFrame(function () {
          dest.scrollIntoView({ behavior: motion(), block: 'start' });
        });
      }
    }
  }

  /* 顶部方案切换 */
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    setView(b.getAttribute('data-view'), true);
  });

  /* 分区导航 / 开关 / 选择 / 扫码方式 */
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-target]');
    if (target) {
      var dest = document.getElementById(target.getAttribute('data-target'));
      if (dest) {
        dest.scrollIntoView({ behavior: motion(), block: 'start' });
        var group = target.closest('[data-nav-group]');
        if (group) {
          Array.prototype.forEach.call(group.querySelectorAll('[data-target]'), function (b) {
            b.classList.toggle('is-on', b === target);
          });
        }
      }
      return;
    }

    var sw = e.target.closest('.switch');
    if (sw) {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      return;
    }

    var pick = e.target.closest('.lay-card, .skin-card');
    if (pick) {
      var group = pick.closest('[role="radiogroup"]');
      if (group) {
        Array.prototype.forEach.call(group.querySelectorAll('.lay-card, .skin-card'), function (card) {
          var on = card === pick;
          card.classList.toggle('is-on', on);
          card.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
      return;
    }

    var ch = e.target.closest('.qr__ch button');
    if (ch) {
      var chGroup = ch.parentElement;
      Array.prototype.forEach.call(chGroup.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === ch);
      });
    }
  });

  /* 滑杆：纯前端演示 */
  document.addEventListener('input', function (e) {
    var range = e.target.closest('.range');
    if (!range) return;
    var row = range.closest('.row');
    var out = row && row.querySelector('.range-val b');
    var tag = row && row.querySelector('.range-val em');
    var v = Number(range.value);
    if (out) out.textContent = v;
    if (tag) tag.textContent = v <= 25 ? '慢' : v <= 70 ? '适中' : '快';
  });

  /* 键盘 1–4；0 = 全部 */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var map = { '1': 'a', '2': 'b', '3': 'c', '4': 'd' };
    var v = map[e.key];
    if (v) {
      e.preventDefault();
      setView(v, true);
    } else if (e.key === '0') {
      e.preventDefault();
      setView('all', true);
    }
  });

  /* 初始视图：支持 #a / #b / #c / #d / #all */
  var initial = (location.hash || '').replace('#', '').toLowerCase();
  setView(VIEWS.indexOf(initial) >= 0 ? initial : 'a', false);
})();
