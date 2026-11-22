/* ==========================================================================
   /m 手机大厅 · Glide Select（下拉版）
   --------------------------------------------------------------------------
   结构 / 交互照 ReactBits micro/glide-select：
     · 一个 44px 高的触发 chip，显示当前来源，右侧 ▾
     · pointerdown 打开，菜单从 chip 左下角向下弹出（scale .95 → 1 + 淡入）
     · 竖排 5 行，每行 44px；高亮 pill 以 translateY 在行间滑动（200ms）
     · 在列表上按下可拖动换行（跟手），松手即选中；鼠标悬停也会滑动高亮
     · 点行 → 切来源 + 收起；点外部 → 只收起；再点 chip → 收起
     · 下方放不下时翻到 chip 上方（和参考的 placement 翻转一致）

   数据 / 切换完全复用 app.js，不新造数据流：
     · 选项直接读 #hall-src-menu 里由 SRC_ITEMS 生成的 .ow__item
     · 点一行 = 先 pointerover 现有面包屑根段（让 Option Wheel 的选中项同步到
       当前来源），再点一次对应 .ow__item；option-wheel 的 onChange → srcPick(i)
       → railGoSource(kind) 或 railReset()（app.js:10560 / 11457 / 11146）
     · 当前来源只从面包屑根段 .pstrip__crumb-seg.is-src 的文字反读；
       app.js 每次 paintPlatBar 都会重画，MutationObserver 跟上

   触发 chip 放在 .plat-face--song 里（bar 旁边），不放 bar 里面：
   paintPlatBar 会用 innerHTML 重写 bar，放里面会被清掉；
   菜单挂在 body 上（position:fixed），逃出 #hall-plat 的 overflow:hidden。
   只在 ≤560px（/m 的竖屏手机布局）构建 / 显示；>560px 的横屏桌面布局
   继续用 app.js 原来的来源滚轮，一个节点都不多。
   ========================================================================== */
(function () {
  'use strict';

  var MAX_W = 560;
  var ROW = 44;
  var GAP = 1;
  var STEP = ROW + GAP;          // 45
  var PAD = 4;                   // 菜单内边距
  var MENU_GAP = 6;              // chip 与菜单之间的缝
  var MENU_MIN_W = 176;
  var FALLBACK = [
    { id: 'daily', name: '每日推荐' },
    { id: 'pick', name: '精选' },
    { id: 'like', name: '我的喜欢' },
    { id: 'coll', name: '我收藏的歌单' },
    { id: 'radio', name: '电台' },
  ];
  /* 390 宽下左列只有 ~75px 可用（左边不能碰平台图标 dock），
     6 个字的来源在 chip 里放不下时显示 4 字简称；菜单行仍是全名。 */
  var TRIGGER_ALIAS = { '我收藏的歌单': '收藏歌单' };

  var mqMobile = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;

  /* 手机布局是否生效。横屏（>560px）是 1.0.5 的桌面式布局：下拉必须整个让位，
     由 app.js 原来的来源滚轮接管。 */
  function mobileOn() {
    return !!(mqMobile && mqMobile.matches);
  }

  var plat = null, face = null, bar = null, wheel = null;
  var root = null, trigger = null, label = null, chev = null;
  var menu = null, list = null, pill = null;
  var rows = [];
  var items = [];

  var selected = -1;
  var active = -1;
  var open = false;
  var scrub = null;
  var lastPick = 0;
  var bootTries = 0;
  var destroyed = false;

  var frame = 0, layoutT = 0, syncFrame = 0, syncT = 0;
  var pillT = 0, menuT = 0, bootT = 0;

  var onDocDown = null;
  var mqListener = null;
  var faceMo = null;
  var barMo = null;
  var bodyMo = null;
  var ro = null;
  var roIcons = null;
  var roSearch = null;

  function txt(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function make(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  /* ------------------------------------------------------------------ *
   * 定位：等 app.js 的 plat-prism / 平台条 / 面包屑都建好
   * ------------------------------------------------------------------ */
  function findEls() {
    plat = document.getElementById('hall-plat');
    if (!plat) return false;
    face = plat.querySelector('.plat-face--song');
    if (!face) return false;
    bar = face.querySelector('#hall-plat-bar');
    if (!bar) return false;
    wheel = document.getElementById('hall-src-menu');
    return !!(bar.querySelector('.pstrip__src') || bar.querySelector('.pstrip__crumb-seg.is-src'));
  }

  function readItems() {
    var dom = wheel ? wheel.querySelectorAll('.ow__item') : [];
    var out = [];
    for (var i = 0; i < dom.length; i++) {
      var id = dom[i].dataset ? dom[i].dataset.src : '';
      var name = txt(dom[i]);
      if (id) out.push({ id: id, name: name });
    }
    return out.length ? out : FALLBACK.slice();
  }

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */
  function build() {
    items = readItems();
    rows = [];

    root = make('div', 'gs-select');
    root.id = 'glide-select';
    root.hidden = true;

    trigger = make('button', 'gs-trigger');
    trigger.type = 'button';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'glide-select-menu');
    trigger.setAttribute('aria-label', '推荐来源');

    label = make('span', 'gs-label');
    trigger.appendChild(label);
    chev = make('span', 'gs-chev');
    chev.setAttribute('aria-hidden', 'true');
    trigger.appendChild(chev);
    root.appendChild(trigger);

    /* 菜单：body 上、fixed；位置每次打开 / 尺寸变化时按 chip rect 写 */
    menu = make('div', 'gs-menu');
    menu.id = 'glide-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '推荐来源');
    menu.setAttribute('aria-hidden', 'true');

    list = make('div', 'gs-list');
    pill = make('span', 'gs-pill');
    pill.setAttribute('aria-hidden', 'true');
    list.appendChild(pill);

    for (var i = 0; i < items.length; i++) {
      var row = make('div', 'gs-row');
      row.id = 'gs-row-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('data-i', String(i));
      row.dataset.i = String(i);
      row.setAttribute('aria-selected', 'false');

      var nameEl = make('span', 'gs-row__name');
      nameEl.textContent = items[i].name;
      row.appendChild(nameEl);

      var check = make('span', 'gs-check');
      check.setAttribute('aria-hidden', 'true');
      row.appendChild(check);

      list.appendChild(row);
      rows.push(row);
    }

    menu.appendChild(list);
    document.body.appendChild(menu);
    face.appendChild(root);

    bind();
    syncActive();
    schedule();
    watch();
  }

  /* ------------------------------------------------------------------ *
   * 当前来源
   * ------------------------------------------------------------------ */
  function setTriggerLabel(fullName) {
    if (!label) return;
    label.textContent = fullName;
    trigger.title = fullName;
    var alias = TRIGGER_ALIAS[fullName];
    if (alias && label.scrollWidth > label.clientWidth + 1) {
      label.textContent = alias;
    }
  }

  function currentIndex() {
    if (!bar) return -1;
    var seg = bar.querySelector('.pstrip__crumb-seg.is-src');
    if (!seg) return -1;
    var name = txt(seg);
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) return i;
    }
    return -1;
  }

  function updateRows() {
    for (var i = 0; i < rows.length; i++) {
      var on = i === selected;
      rows[i].classList.toggle('is-cur', on);
      rows[i].setAttribute('aria-selected', String(on));
    }
  }

  function syncActive() {
    if (!root || !bar || destroyed) return;
    /* 横屏 / 宽屏：下拉整个让位。必须把 gs-has-trigger 摘掉 —— 它是隐藏
       旧面包屑（visibility:hidden）的开关，留着会让横屏的老选择器看不见也点不到。 */
    if (!mobileOn()) {
      root.hidden = true;
      bar.classList.remove('gs-has-trigger');
      if (open) closeMenu();
      return;
    }
    var seg = bar.querySelector('.pstrip__crumb-seg.is-src');
    if (!seg) {
      root.hidden = true;
      bar.classList.remove('gs-has-trigger');
      if (open) closeMenu();
      return;
    }
    root.hidden = false;
    bar.classList.add('gs-has-trigger');
    observeMovable();

    var idx = currentIndex();
    var name = txt(seg);
    if (idx >= 0) selected = idx;
    placeTrigger();
    setTriggerLabel(idx >= 0 ? items[idx].name : name);
    updateRows();
    if (open) {
      if (active < 0) setActive(selected >= 0 ? selected : 0, true);
      if (menu) placeMenu();
    }
  }

  /* ------------------------------------------------------------------ *
   * 布局：chip 用 offset 几何定位（不受棱柱 3D 变换影响）；只收在图标 dock 左沿之前
   * ------------------------------------------------------------------ */
  /* offsetLeft / offsetTop 只在「offsetParent 恰好是 face」时才等于相对 face 的位移。
     app.js 重画面包屑 / 搜索框展开 / 棱柱换面时中间层可能变，这里逐级累加到 face，
     避免 chip 按错误的参照系落位（位置漂移）。 */
  function offsetIn(el, ancestor) {
    var x = 0, y = 0, n = el;
    while (n && n !== ancestor && n.offsetParent) {
      x += n.offsetLeft || 0;
      y += n.offsetTop || 0;
      n = n.offsetParent;
    }
    return { left: x, top: y };
  }

  function placeTrigger() {
    if (!root || !bar || !face) return;
    /* 锚在面包屑整列的左沿，而不是来源文字本身：桌面规则把 crumb 在左列里
       右对齐（max-width:52vw + justify-content:flex-end），按文字锚会把 chip
       推到列中间，390 下只剩 46px，既截字又碰到图标 dock。
       整列左沿 = bar 内容左沿，能拿满左列宽度。 */
    var src = bar.querySelector('.pstrip__crumb') || bar.querySelector('.pstrip__src') || bar.querySelector('.pstrip__crumb-seg.is-src');
    if (!src) return;
    var barPos = offsetIn(bar, face);
    var srcPos = offsetIn(src, bar);
    var left = barPos.left + srcPos.left;
    var top = barPos.top + (bar.offsetHeight - ROW) / 2;
    root.style.left = left + 'px';
    root.style.top = top + 'px';

    /* 图层右边留 12px 实缝：下拉 chip 与平台图标 dock 不能贴住。
       LiziDock 会按 --plat-scale 把图标临时放大（inline width），dock 左沿会左移；
       这里按 dock 的真实 layout 左沿算，宁可让 chip 收窄也不许压到图标上。 */
    var icons = bar.querySelector('.pstrip__icons');
    var safe = 200;
    if (icons) safe = Math.floor(icons.offsetLeft - src.offsetLeft - 12);
    safe = Math.max(38, Math.min(300, safe));
    root.style.setProperty('--gs-safe-w', safe + 'px');
  }

  function measureMenuHeight() {
    var h = menu ? menu.offsetHeight : 0;
    if (h > 0) return h;
    return items.length * ROW + Math.max(0, items.length - 1) * GAP + PAD * 2;
  }

  function placeMenu() {
    if (!menu || !trigger || !open) return;
    var tr = trigger.getBoundingClientRect();
    var bodyRect = document.body.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 390;
    var vh = window.innerHeight || document.documentElement.clientHeight || 844;

    var w = Math.max(Math.round(tr.width), MENU_MIN_W);
    w = Math.min(w, vw - 16);
    menu.style.width = w + 'px';
    var h = measureMenuHeight();

    var left = tr.left;
    if (left + w > vw - 8) left = vw - 8 - w;
    if (left < 8) left = 8;

    var top;
    var side;
    var below = tr.bottom + MENU_GAP;
    if (below + h <= vh - 8) {
      side = 'bottom';
      top = below;
    } else {
      side = 'top';
      top = tr.top - MENU_GAP - h;
      if (top < 8) top = 8;
    }

    menu.style.left = (left - bodyRect.left) + 'px';
    menu.style.top = (top - bodyRect.top) + 'px';
    menu.setAttribute('data-side', side);
    menu.style.setProperty('--gs-origin', side === 'bottom' ? 'top left' : 'bottom left');
  }

  /* ------------------------------------------------------------------ *
   * 高亮 pill
   * ------------------------------------------------------------------ */
  function translateYOf(el) {
    var tr = '';
    try { tr = getComputedStyle(el).transform; } catch (e) { return NaN; }
    if (!tr || tr === 'none') return 0;
    var m = tr.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (!m) return NaN;
    var p = m[1].split(',');
    return parseFloat(p.length >= 16 ? p[13] : p[5]);
  }

  function setActive(i, instant) {
    if (i == -1 || i === null || i === undefined) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    active = i;
    trigger.setAttribute('aria-activedescendant', rows[i] ? rows[i].id : '');
    var y = i * STEP;

    clearTimeout(pillT);
    if (instant) {
      pill.style.transition = 'none';
      pill.style.transform = 'translate3d(0,' + y + 'px,0)';
      void pill.offsetWidth;
      pill.style.transition = '';
      return;
    }
    pill.style.transform = 'translate3d(0,' + y + 'px,0)';
    /* 过渡被冻结（安卓 WebView / 被遮挡窗口）时 280ms 直接落位 */
    pillT = setTimeout(function () {
      if (destroyed || !open) return;
      var cur = translateYOf(pill);
      if (!isFinite(cur) || Math.abs(cur - y) > 2) {
        pill.style.transition = 'none';
        pill.style.transform = 'translate3d(0,' + y + 'px,0)';
        void pill.offsetWidth;
        pill.style.transition = '';
      }
    }, 280);
  }

  /* ------------------------------------------------------------------ *
   * 开 / 合
   * ------------------------------------------------------------------ */
  function openMenu() {
    if (open || !root || root.hidden || !items.length) return;
    open = true;

    var start = selected >= 0 ? selected : 0;
    active = start;
    trigger.setAttribute('aria-activedescendant', rows[start] ? rows[start].id : '');

    /* 参考实现：先无动画把高亮放到当前项、透明度 0，再淡入 */
    pill.style.transition = 'none';
    pill.style.transform = 'translate3d(0,' + (start * STEP) + 'px,0)';
    pill.style.opacity = '0';
    void pill.offsetWidth;
    pill.style.transition = '';
    pill.style.opacity = '1';

    paintMenuColors();
    placeTrigger();
    placeMenu();

    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    onDocDown = function (e) { handleDocDown(e); };
    document.addEventListener('pointerdown', onDocDown, true);

    clearTimeout(menuT);
    menuT = setTimeout(snapMenuOpen, 240);
  }

  function closeMenu(instant) {
    if (!open) return;
    open = false;
    clearTimeout(pillT);
    clearTimeout(menuT);

    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');

    if (onDocDown) {
      document.removeEventListener('pointerdown', onDocDown, true);
      onDocDown = null;
    }

    /* 清掉冻结兜底写下的内联值，让 120ms 的收合过渡正常跑 */
    if (menu) {
      menu.style.transition = '';
      menu.style.opacity = '';
      menu.style.transform = '';
    }
    if (pill) pill.style.opacity = '';

    if (instant && trigger && document.activeElement !== trigger) {
      try { trigger.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
  }

  function handleDocDown(e) {
    if (!open) return;
    var t = e.target;
    if ((trigger && trigger.contains(t)) || (menu && menu.contains(t))) return;
    closeMenu();
  }

  function snapMenuOpen() {
    if (!open || !menu) return;
    var op = 1;
    try { op = parseFloat(getComputedStyle(menu).opacity); } catch (e) { op = 1; }
    if (op >= 0.98) return;
    menu.style.transition = 'none';
    menu.style.opacity = '1';
    menu.style.transform = 'none';
    void menu.offsetWidth;
    setTimeout(function () {
      if (!open || !menu) return;
      menu.style.transition = '';
      menu.style.opacity = '';
      menu.style.transform = '';
    }, 40);
  }

  function paintMenuColors() {
    if (!menu) return;
    var ink = '';
    try {
      var cs = getComputedStyle(plat);
      ink = cs.getPropertyValue('--plat-ink').trim();
      var bg = cs.getPropertyValue('--plat-bg').trim();
      if (bg) menu.style.setProperty('--gs-surface', bg);
    } catch (e) { /* 忽略 */ }
    if (!ink && face) {
      try { ink = getComputedStyle(face).color; } catch (e2) { ink = ''; }
    }
    if (ink) menu.style.color = ink;
  }

  /* ------------------------------------------------------------------ *
   * 选行 → 复用 app.js 的 srcPick
   * ------------------------------------------------------------------ */
  function findMenuItem(id) {
    if (!wheel) wheel = document.getElementById('hall-src-menu');
    if (!wheel) return null;
    var all = wheel.querySelectorAll('.ow__item');
    for (var i = 0; i < all.length; i++) {
      if (all[i].dataset && all[i].dataset.src === id) return all[i];
    }
    return null;
  }

  function syncWheelRoot() {
    if (!bar || !wheel) return;
    if (wheel.classList.contains('is-open')) return;
    var rootBtn = bar.querySelector('[data-src-root]');
    if (!rootBtn) return;
    var ev;
    try {
      ev = typeof PointerEvent === 'function'
        ? new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })
        : new Event('pointerover', { bubbles: true });
    } catch (e) {
      ev = new Event('pointerover', { bubbles: true });
    }
    rootBtn.dispatchEvent(ev);
  }

  function clickItem(item) {
    try {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {
      try { item.click(); } catch (e2) { /* 老内核不认就放弃这一次 */ }
    }
  }

  function closeWheel() {
    if (!wheel || !wheel.classList.contains('is-open')) return;
    try {
      wheel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) { /* 忽略 */ }
  }

  function switchTo(id) {
    if (!id) return;
    var item = findMenuItem(id);
    if (!item) {
      /* 菜单项还没建出来（少见）：稍后再试一次 */
      setTimeout(function () {
        var again = findMenuItem(id);
        if (again) doSwitch(again);
      }, 60);
      return;
    }
    doSwitch(item);
  }

  function doSwitch(item) {
    syncWheelRoot();
    clickItem(item);
    closeWheel();
    /* app.js 会重画面包屑：下一帧按真实状态校正 */
    setTimeout(syncActive, 80);
  }

  /* 菜单每行正好压在跑马带上面（chip 在平台条左沿，菜单往下弹 220px，
     第一行就落在第一张卡片上）。选完一行收起菜单后，浏览器还会在同一个落点
     补发一次 click：此时菜单已经 pointer-events:none，这次 click 直接穿透到
     下面的卡片上 —— 点「每日推荐」就等于顺手把新列表第一首播了，海报跟着换歌。
     这里在 pointerup 选中的路径上吞掉紧随其后的那一次 click（capture 先于
     卡片自己的监听器），只吞一次，300ms 内没来就自己撤掉。 */
  var swallowT = 0;
  function swallowNextClick() {
    clearTimeout(swallowT);
    var off = function (e) {
      /* pick() 里 switchTo 会自己往来源滚轮的 .ow__item 上补发一次 click（坐标 0,0），
         那不是穿透，别把它吞了 —— 吞了就切不过去。只拦落在下拉 / 滚轮之外的那一下。 */
      var t = e.target;
      if (t && t.closest && t.closest('#hall-src-menu, #glide-select, #glide-select-menu')) return;
      e.stopPropagation();
      e.preventDefault();
      document.removeEventListener('click', off, true);
      clearTimeout(swallowT);
      swallowT = 0;
    };
    document.addEventListener('click', off, true);
    swallowT = setTimeout(function () {
      document.removeEventListener('click', off, true);
      swallowT = 0;
    }, 300);
  }

  function pick(i) {
    if (i === null || i < 0 || i >= items.length) {
      closeMenu();
      return;
    }
    lastPick = Date.now();
    var it = items[i];
    selected = i;
    active = i;
    updateRows();
    setTriggerLabel(it.name);
    closeMenu(true);
    switchTo(it.id);
  }

  /* ------------------------------------------------------------------ *
   * 交互：chip / 列表拖选 / 悬停 / 键盘 / 外部点击
   * ------------------------------------------------------------------ */
  function rowAt(clientY) {
    if (!list) return null;
    var r = list.getBoundingClientRect();
    var i = Math.floor((clientY - r.top) / STEP);
    if (i < 0 || i >= items.length) return null;
    return i;
  }

  function bind() {
    trigger.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      if (open) closeMenu();
      else openMenu();
    });

    trigger.addEventListener('click', function (e) {
      /* pointerdown 已经处理；这里只挡住触屏合成的 click 再触发一次 */
      e.preventDefault();
    });

    trigger.addEventListener('keydown', function (e) {
      var k = e.key;
      if (!open) {
        if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          openMenu();
        }
        return;
      }
      var n = items.length;
      var cur = active >= 0 ? active : (selected >= 0 ? selected : 0);
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        setActive(cur + (k === 'ArrowDown' ? 1 : -1), true);
      } else if (k === 'Home' || k === 'End') {
        e.preventDefault();
        setActive(k === 'Home' ? 0 : n - 1, true);
      } else if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        pick(cur);
      } else if (k === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    });

    list.addEventListener('pointerdown', function (e) {
      if (!open) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { list.setPointerCapture(e.pointerId); } catch (e2) { /* 忽略 */ }
      scrub = { id: e.pointerId };
      var i = rowAt(e.clientY);
      if (i !== null) setActive(i, true);
    });

    list.addEventListener('pointermove', function (e) {
      if (!scrub || scrub.id !== e.pointerId) return;
      var i = rowAt(e.clientY);
      if (i !== null && i !== active) setActive(i, false);
    });

    list.addEventListener('pointerup', function (e) {
      if (!scrub || scrub.id !== e.pointerId) return;
      scrub = null;
      var i = e.type === 'pointerup' ? rowAt(e.clientY) : null;
      if (i !== null) { swallowNextClick(); pick(i); }
    });

    list.addEventListener('pointercancel', function () { scrub = null; });

    /* 鼠标悬停换高亮（触屏不处理） */
    list.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch' || scrub) return;
      var row = e.target && e.target.closest ? e.target.closest('.gs-row') : null;
      if (!row) return;
      var i = parseInt(row.dataset.i, 10);
      if (i !== active && i >= 0) setActive(i, false);
    });

    /* 老内核 / 辅助点击兜底：pointerup 刚选过就忽略 */
    list.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('.gs-row') : null;
      if (!row) return;
      if (Date.now() - lastPick < 450) return;
      pick(parseInt(row.dataset.i, 10));
    });
  }

  /* ------------------------------------------------------------------ *
   * 调度：rAF + 定时器兜底（被遮挡窗口的 rAF 只有 1 帧/300ms）
   * ------------------------------------------------------------------ */
  function runLayout() {
    frame = 0;
    placeTrigger();
    if (open) placeMenu();
  }

  function schedule() {
    if (destroyed) return;
    if (!frame) {
      frame = requestAnimationFrame(function () { runLayout(); });
    }
    clearTimeout(layoutT);
    layoutT = setTimeout(function () { if (frame) { frame = 0; } runLayout(); }, 120);
  }

  function runSync() {
    syncFrame = 0;
    syncActive();
  }

  function scheduleSync() {
    if (destroyed) return;
    if (!syncFrame) {
      syncFrame = requestAnimationFrame(function () { runSync(); });
    }
    clearTimeout(syncT);
    syncT = setTimeout(function () { if (syncFrame) { syncFrame = 0; } runSync(); }, 80);
    schedule();
  }

  /* ------------------------------------------------------------------ *
   * 观察
   * ------------------------------------------------------------------ */
  /* 搜索框展开 / 图标 dock 伸缩不会改变 bar 自身尺寸（flex 宽度固定），
     ResizeObserver 盯 bar 收不到通知；单独盯这两个可动块，尺寸一变就重新量 chip。
     图标块每次 paintPlatBar 都会重建，所以 syncActive 里再挂一次新节点。 */
  function observeMovable() {
    if (!ro || !bar) return;
    var ic = bar.querySelector('.pstrip__icons');
    if (ic !== roIcons) {
      if (roIcons) { try { ro.unobserve(roIcons); } catch (e) { /* 忽略 */ } }
      roIcons = ic;
      if (ic) ro.observe(ic);
    }
    var se = bar.querySelector('.pstrip__search');
    if (se !== roSearch) {
      if (roSearch) { try { ro.unobserve(roSearch); } catch (e) { /* 忽略 */ } }
      roSearch = se;
      if (se) ro.observe(se);
    }
  }

  function watch() {
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function () { schedule(); });
      if (plat) ro.observe(plat);
      if (bar) ro.observe(bar);
      if (face) ro.observe(face);
      observeMovable();
    }
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    /* 搜索框宽度的展开 / 收合是 CSS 过渡，尺寸变化结束再量一次，防止 chip 停在旧位 */
    if (bar) bar.addEventListener('transitionend', schedule, true);

    if (typeof MutationObserver === 'function') {
      /* paintPlatBar 重写面包屑 / 搜索切换 → 同步当前来源与位置 */
      barMo = new MutationObserver(function () { scheduleSync(); });
      barMo.observe(bar, { childList: true, subtree: true, characterData: true });

      /* 棱柱翻面：song 面重新成为 active 后要按未旋转的几何再落一次位 */
      faceMo = new MutationObserver(function () { schedule(); });
      faceMo.observe(face, { attributes: true, attributeFilter: ['class'] });

      /* 极端情况下面板 / 面被重建 → 补回 */
      bodyMo = new MutationObserver(function () {
        if (!root || !root.isConnected) recreate();
      });
      bodyMo.observe(document.body, { childList: true, subtree: false });

      /* 离开大厅（播放页 / 长廊 / 我的专辑）时收起菜单 */
      var viewMo = new MutationObserver(function () {
        var viewHall = document.getElementById('view-hall');
        if (open && (!viewHall || !viewHall.classList.contains('is-active'))) closeMenu();
      });
      viewMo.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-view'],
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * boot / recreate
   * ------------------------------------------------------------------ */
  function boot() {
    if (destroyed) return;
    if (!mobileOn()) return;
    if (root && root.isConnected) return;
    if (!findEls()) {
      /* 冷启动时 #hall-plat / .plat-face--song 要等账号回来、restoreHallTheme
         自动进铺色态才建出来，可能远晚于 6.4s；以前到点就放弃，于是首屏没有
         下拉，只有转屏时 matchMedia 重新触发才补建。这里不设上限，前 40 次
         80ms，之后放慢到 500ms，等它出现。 */
      clearTimeout(bootT);
      bootT = setTimeout(boot, bootTries < 40 ? 80 : 500);
      bootTries++;
      return;
    }
    bootTries = 0;
    build();
  }

  function recreate() {
    if (destroyed) return;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    if (bar) bar.classList.remove('gs-has-trigger');
    root = null; trigger = null; label = null; chev = null;
    menu = null; list = null; pill = null;
    rows = []; items = [];
    selected = -1; active = -1; open = false; scrub = null;
    bootTries = 0;
    boot();
  }

  /* 横屏的老来源滚轮靠 hover / pointerout 收起，转回竖屏不会再来一次指针事件，
     它会一直悬在已经露出来的下拉 chip 上（实测压住 chip 右沿 3px）。进手机布局时
     替用户按一次 Esc：app.js 的滚轮自己监听 Esc 收起（app.js:12939）。 */
  function closeOldWheel() {
    var w = document.getElementById('hall-src-menu');
    if (!w || w.hidden || !w.classList.contains('is-open')) return;
    var e;
    try { e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); }
    catch (err) {
      e = document.createEvent('Event');
      e.initEvent('keydown', true, true);
      e.key = 'Escape';
    }
    w.dispatchEvent(e);
  }

  if (mqMobile) {
    mqListener = function () {
      bootTries = 0;
      if (!mobileOn()) {
        /* 转横屏：收起菜单、藏下拉、把旧面包屑还回去，老选择器立刻可点 */
        if (open) closeMenu();
        if (root) root.hidden = true;
        if (bar) bar.classList.remove('gs-has-trigger');
        return;
      }
      /* 转回竖屏：先收掉横屏开着的老滚轮，再复位/补建 */
      closeOldWheel();
      if (!root || !root.isConnected) boot();
      else { syncActive(); schedule(); }
    };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', mqListener);
    else if (mqMobile.addListener) mqMobile.addListener(mqListener);
  }

  /* 窗口 / 可视区回来时补一次：WebView 从后台恢复可能错过 matchMedia 变化。
     已有节点也要重走 syncActive —— 从宽屏回到窄屏时 mq 的 change 事件在个别
     WebView（或 CDP 改视口）下不派发，光 schedule 不会把 hidden 的 chip 重新显示。 */
  window.addEventListener('resize', function () {
    if (!mobileOn()) return;
    closeOldWheel();
    if (!root || !root.isConnected) boot();
    else { syncActive(); schedule(); }
  }, { passive: true });
  window.addEventListener('orientationchange', function () {
    if (!mobileOn()) return;
    closeOldWheel();
    if (!root || !root.isConnected) boot();
    else { syncActive(); schedule(); }
  }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && mobileOn() && (!root || !root.isConnected)) boot();
  });

  window.addEventListener('pagehide', function () { closeMenu(); }, { passive: true });

  boot();
})();
