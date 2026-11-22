/* 界面主题 · 设计史时间轴
 * 读取 / 应用 / 持久化 html[data-ui-theme]，并在 #ui-theme-timeline 里生成滑杆。
 * 不依赖任何框架；存储键 lizi.ui.theme。
 *
 * 为什么交互用原生 <input type="range">、外观却自己画：
 * 原生 range 自带触摸拖动、左右方向键 / Home / End，以及屏幕阅读器需要的
 * role=slider 与值语义，这些用 div + pointer 事件很难在手机 WebView 里稳定复刻；
 * 但原生轨道和滑块的外观各浏览器差异太大、也不跟主题令牌走，所以把 input 铺成
 * 透明覆盖层，只借它的交互，轨道 / 刻度 / 滑块全部自绘。
 * 首屏主题由两个 index.html <head> 里的内联脚本先挂到 html 上，避免闪一下原生外观。
 */
(function () {
  'use strict';

  var STORE_KEY = 'lizi.ui.theme';

  /* 顺序即时间轴顺序（左旧右新，glass 2021 在最右 = 现在的 LIZI）。short 用于窄屏。 */
  var THEMES = [
    { id: 'constructivism', name: '构成主义', short: '构成', year: 1920 },
    { id: 'bauhaus', name: '包豪斯', short: '包豪斯', year: 1925 },
    { id: 'swiss', name: '瑞士国际主义', short: '瑞士', year: 1957 },
    { id: 'pop', name: '波普', short: '波普', year: 1962 },
    { id: 'memphis', name: '孟菲斯', short: '孟菲斯', year: 1981 },
    { id: 'web1', name: '早期网页', short: '网页', year: 1997 },
    { id: 'y2k', name: '千禧风', short: '千禧', year: 2000 },
    { id: 'skeuo', name: '拟物化', short: '拟物', year: 2010 },
    { id: 'flat', name: '扁平化', short: '扁平', year: 2014 },
    { id: 'glass', name: '玻璃拟态', short: '玻璃', year: 2021 }
  ];
  var N = THEMES.length;
  var LAST = N - 1;

  var root = null;        // .tm
  var range = null;
  var nameEls = [];
  var yearEls = [];
  var tickEls = [];

  function indexOf(id) {
    for (var i = 0; i < N; i++) {
      if (THEMES[i].id === id) return i;
    }
    return -1;
  }
  function normalize(id) {
    return indexOf(id) >= 0 ? id : 'glass';
  }
  function readStore() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function writeStore(id) {
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch (e) {
      /* 隐私模式 / 配额满：本趟仍然生效，只是不记住 */
    }
  }

  /* 把视觉和控件同步到当前 id；DOM 还没建时只动 html 属性（由 apply 负责）。 */
  function sync(id) {
    var i = indexOf(id);
    if (i < 0) i = LAST;
    var t = THEMES[i];
    if (root) {
      root.style.setProperty('--tm-p', String(i / LAST));
      for (var k = 0; k < N; k++) {
        var on = k === i;
        if (nameEls[k]) nameEls[k].classList.toggle('is-on', on);
        if (yearEls[k]) yearEls[k].classList.toggle('is-on', on);
        if (tickEls[k]) tickEls[k].classList.toggle('is-on', on);
      }
    }
    if (range) {
      range.value = String(i);
      range.setAttribute('aria-valuetext', t.name + ' ' + t.year);
    }
  }

  /**
   * 应用主题。
   * @param {string} id
   * @param {boolean} persist true 时写入 localStorage（拖动过程不写，松手才写）
   */
  function apply(id, persist) {
    id = normalize(id);
    document.documentElement.setAttribute('data-ui-theme', id);
    if (persist) writeStore(id);
    sync(id);
  }

  function makeStop(item, i, cls) {
    var s = document.createElement('span');
    s.className = cls;
    s.style.setProperty('--i', i);
    /* 比例预算在 JS 里算好：旧 WebView 的 calc() 对 var() 除法支持不稳。 */
    s.style.setProperty('--tm-p-i', String(i / LAST));
    s.setAttribute('data-theme', item.id);
    return s;
  }

  function bindRow(row) {
    /* 名称行 / 年份行整列可点：按点击点最近的停靠点换主题。
       逐个 span 绑 click 在窄屏会因为 64px 宽标签互相重叠而点错邻居，
       所以命中判定放在整行上；span 在 CSS 里 pointer-events:none。 */
    row.addEventListener('click', function (e) {
      var r = row.getBoundingClientRect();
      if (!r.width) return;
      var inset = 14;
      try {
        inset = parseFloat(getComputedStyle(root).getPropertyValue('--tm-inset')) || inset;
      } catch (err) { /* 老环境：用默认 14px */ }
      var usable = r.width - inset * 2;
      if (usable <= 0) return;
      var p = (e.clientX - r.left - inset) / usable;
      p = Math.max(0, Math.min(1, p));
      var i = Math.round(p * LAST);
      apply(THEMES[i].id, true);
    });
  }

  function build(host) {
    root = document.createElement('div');
    root.className = 'tm';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '界面主题时间轴');
    root.style.setProperty('--tm-n', String(N));

    var names = document.createElement('div');
    names.className = 'tm-names';
    names.setAttribute('aria-hidden', 'true');
    THEMES.forEach(function (t, i) {
      var s = makeStop(t, i, 'tm-stop tm-name');
      s.setAttribute('data-short', t.short);
      var full = document.createElement('span');
      full.className = 'tm-full';
      full.textContent = t.name;
      var short = document.createElement('span');
      short.className = 'tm-short';
      short.textContent = t.short;
      s.appendChild(full);
      s.appendChild(short);
      names.appendChild(s);
      nameEls.push(s);
    });

    var track = document.createElement('div');
    track.className = 'tm-track';

    var line = document.createElement('span');
    line.className = 'tm-line';
    line.setAttribute('aria-hidden', 'true');
    track.appendChild(line);

    var ticks = document.createElement('span');
    ticks.className = 'tm-ticks';
    ticks.setAttribute('aria-hidden', 'true');
    THEMES.forEach(function (t, i) {
      var tick = document.createElement('i');
      tick.className = 'tm-tick';
      tick.style.setProperty('--i', i);
      tick.style.setProperty('--tm-p-i', String(i / LAST));
      ticks.appendChild(tick);
      tickEls.push(tick);
    });
    track.appendChild(ticks);

    var thumb = document.createElement('span');
    thumb.className = 'tm-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    track.appendChild(thumb);

    range = document.createElement('input');
    range.className = 'tm-range';
    range.type = 'range';
    range.min = '0';
    range.max = String(LAST);
    range.step = '1';
    range.value = String(LAST);
    range.setAttribute('aria-label', '界面主题');
    range.setAttribute('aria-valuetext', THEMES[LAST].name + ' ' + THEMES[LAST].year);
    track.appendChild(range);

    var years = document.createElement('div');
    years.className = 'tm-years';
    years.setAttribute('aria-hidden', 'true');
    THEMES.forEach(function (t, i) {
      var s = makeStop(t, i, 'tm-stop tm-year');
      s.textContent = String(t.year);
      years.appendChild(s);
      yearEls.push(s);
    });

    root.appendChild(names);
    root.appendChild(track);
    root.appendChild(years);
    host.appendChild(root);

    /* input 即时预览；change（松手 / 键盘操作结束）才落盘。 */
    range.addEventListener('input', function () {
      apply(THEMES[Number(range.value)].id, false);
    });
    range.addEventListener('change', function () {
      apply(THEMES[Number(range.value)].id, true);
    });

    bindRow(names);
    bindRow(years);

    /* 初始化读 <head> 内联脚本已经写到 html 上的值；没有就退回本地存储 / glass。 */
    var initial = normalize(document.documentElement.getAttribute('data-ui-theme') || readStore());
    apply(initial, false);
  }

  function boot() {
    var host = document.getElementById('ui-theme-timeline');
    if (!host || host.querySelector('.tm')) return;  // 其它页面 / 重复执行：静默退出
    build(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
