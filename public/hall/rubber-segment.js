/* ==========================================================================
   LIZI Air · Rubber Segment（原生 JS，横向 / 竖向通用）
   --------------------------------------------------------------------------
   移植自 ReactBits「Rubber Segment」（David HDev）。原版用 motion 的
   spring / tween 和 clip-path 揭示文字；本项目没有构建步骤、不许加依赖，
   所以把 public/app.js 里铺色态左侧 srail（约 10200-10535 行）已经跑通的
   物理抽出来，做成不碰大厅逻辑的独立模块（2026-11-16）。

   物理（和 srail 完全一致）：
     ζ = max(0.1, 1 - bounce)，ω = 4πζ / duration
     a = -ω²(x - target) - 2ζω·v，rAF 里按 1/240s 子步积分
     指针速度取最近 100ms 采样；超过 110px/s 视为甩动，用 project(v, glide)
     投射落点。travel 的拉伸段用 EASE_OUT 贝塞尔补间。

   高亮块：绝对定位 div + clip-path: inset(... round r)。里面盖一份和真实
   按钮逐像素同布局的文字副本：真实按钮的文字是暗色，副本在滑块范围内
   变成深色，于是白底经过时文字自然翻色（和原组件一致）。

   横向滚动（2026-11-16）：
     root 本身是滚动容器，滑块和按钮放在同一个内容层里。槽位用按钮的
     offsetLeft / offsetTop 取内容坐标：它本身不受 scrollLeft 影响，效果
     等价于「rect 差值 + scrollLeft」，但不会被父级 scale 过渡（下拉打开
     时的 0.98）带偏。选中项变化后只用 scrollLeft / scrollTop 把它推回
     可见区，不做平滑滚动（避免和抽屉动画抢帧）。

   用法：
     const seg = window.LIZI_RUBBER.create(rootEl, {
       items: [{ value, label }, ...],
       value, defaultValue, onChange(value, index),
       orientation: 'horizontal' | 'vertical',
       size: 'sm' | 'md' | 'lg',
       trackColor, thumbColor, textColor, activeTextColor,
       radius, inset, equalSlots, stretch, squash, speed, glide,
       draggable, disabled, ariaLabel
     });
     seg.setValue(value)   // 外部同步，不触发 onChange
     seg.refresh()         // 重新量槽位（字体加载完 / 容器显隐后）
     seg.destroy()
   ========================================================================== */
(function () {
  'use strict';

  var DEFAULTS = {
    orientation: 'horizontal',
    size: 'md',
    trackColor: '#27272a',
    thumbColor: '#fafafa',
    textColor: '#fafafa',
    activeTextColor: '#18181b',
    radius: 10,
    inset: 3,
    equalSlots: true,
    stretch: 100,
    squash: 3,
    speed: 1,
    glide: 75,
    draggable: true,
    disabled: false,
    ariaLabel: 'Segment'
  };

  /* 尺寸表：高 / 字号 / 左右内边距 / 最小宽（和 ReactBits 默认一致） */
  var SIZES = {
    sm: { h: 28, font: 12, pad: 10, minW: 36 },
    md: { h: 36, font: 13, pad: 14, minW: 44 },
    lg: { h: 44, font: 14, pad: 18, minW: 48 }
  };

  var DILATE = 0.19;      /* travel 拉伸段时长（秒） */
  var HANDOFF = 0.15;     /* 拉伸段结束、交给弹簧落位的时刻（秒） */
  var FLICK = 110;        /* 甩动阈值 px/s */
  var MAX_V = 2000;       /* 速度上限 px/s */
  var DEADZONE = 4;       /* 拖拽起判距离 px */
  var SLOP = 10;          /* 点击容差 px */
  var RUBBER = 0.55;      /* 越界阻尼系数 */

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rubber(over, dim) {
    return (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
  }
  function project(v, glide) {
    var d = 1 - 0.1 * Math.pow(0.05, glide / 100);
    return ((v / 1000) * d) / (1 - d);
  }
  function px(v) {
    var n = Math.round(v * 100) / 100;
    return n + 'px';
  }

  /** cubic-bezier(x1,y1,x2,y2) → 按 x 求 y（travel 拉伸段用 EASE_OUT） */
  function bezier(x1, y1, x2, y2) {
    var ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
    var ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (!(x > 0)) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 6; i++) {
        var e = sx(t) - x;
        if (Math.abs(e) < 1e-5) return sy(t);
        var d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1;
      t = x;
      for (var j = 0; j < 14; j++) {
        var sxv = sx(t);
        if (Math.abs(sxv - x) < 1e-5) break;
        if (sxv < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  var easeOut = bezier(0.23, 1, 0.32, 1);

  function normalizeItems(list) {
    var out = [];
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it && typeof it === 'object') {
        var v = it.value === undefined ? String(i) : it.value;
        out.push({ value: v, label: it.label === undefined ? String(v) : String(it.label) });
      } else {
        out.push({ value: it, label: String(it) });
      }
    }
    return out;
  }
  function indexOfValue(items, v) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].value === v) return i;
    }
    return -1;
  }
  function newEdge() {
    return {
      x: 0, v: 0, mode: null, target: 0, from: 0,
      t0: 0, dur: 0, ease: null, w: 0, zeta: 1, done: null
    };
  }

  var registry = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function getPrev(root) { return registry ? registry.get(root) : root.__liziRubber; }
  function setPrev(root, api) {
    if (registry) registry.set(root, api);
    else root.__liziRubber = api;
  }
  function clearPrev(root, api) {
    if (registry) {
      if (registry.get(root) === api) registry.delete(root);
    } else if (root.__liziRubber === api) {
      root.__liziRubber = null;
    }
  }

  var VAR_NAMES = [
    '--rs-h', '--rs-font', '--rs-pad', '--rs-minw',
    '--rs-radius', '--rs-thumb-radius', '--rs-inset',
    '--rs-track', '--rs-thumb', '--rs-text', '--rs-active-text'
  ];

  function noopApi() {
    return {
      setValue: function () { return false; },
      refresh: function () {},
      destroy: function () {}
    };
  }

  function create(opts) {
    if (!opts || !opts.root || !opts.root.nodeType) {
      if (window.console) console.warn('[LIZI_RUBBER] create() 需要一个 root 元素');
      return noopApi();
    }
    var root = opts.root;

    /* 同一个 root 重复 create 要幂等：paint() 每次都会重建 nav，先把旧的拆干净 */
    var prev = getPrev(root);
    if (prev) {
      try { prev.destroy(); } catch (err) { /* 旧实例可能已经脱离文档 */ }
    }

    var items = normalizeItems(opts.items);
    var orientation = opts.orientation === 'vertical' ? 'vertical' : DEFAULTS.orientation;
    var horizontal = orientation === 'horizontal';
    var sizeKey = opts.size === 'sm' || opts.size === 'lg' ? opts.size : DEFAULTS.size;
    var sz = SIZES[sizeKey];
    var equalSlots = opts.equalSlots !== undefined ? !!opts.equalSlots : DEFAULTS.equalSlots;
    var draggable = opts.draggable !== undefined ? !!opts.draggable : DEFAULTS.draggable;
    var disabled = opts.disabled !== undefined ? !!opts.disabled : DEFAULTS.disabled;
    var radius = opts.radius !== undefined ? Number(opts.radius) : DEFAULTS.radius;
    var inset = opts.inset !== undefined ? Number(opts.inset) : DEFAULTS.inset;
    if (!(radius >= 0)) radius = DEFAULTS.radius;
    if (!(inset >= 0)) inset = DEFAULTS.inset;
    /* inset 再大也不能把滑块挤成负数高度 */
    if (inset * 2 >= sz.h) inset = Math.max(0, (sz.h - 4) / 2);
    var thumbRadius = Math.max(0, radius - inset);
    var stretch = opts.stretch !== undefined ? Number(opts.stretch) : DEFAULTS.stretch;
    var squash = opts.squash !== undefined ? Number(opts.squash) : DEFAULTS.squash;
    if (!(stretch >= 0)) stretch = DEFAULTS.stretch;
    if (!(squash >= 0)) squash = DEFAULTS.squash;
    var speed = opts.speed !== undefined ? Number(opts.speed) : DEFAULTS.speed;
    if (!(speed > 0)) speed = DEFAULTS.speed;
    var glide = opts.glide !== undefined ? Number(opts.glide) : DEFAULTS.glide;
    if (!(glide >= 0)) glide = DEFAULTS.glide;
    var trackColor = opts.trackColor !== undefined ? String(opts.trackColor) : DEFAULTS.trackColor;
    var thumbColor = opts.thumbColor !== undefined ? String(opts.thumbColor) : DEFAULTS.thumbColor;
    var textColor = opts.textColor !== undefined ? String(opts.textColor) : DEFAULTS.textColor;
    var activeTextColor = opts.activeTextColor !== undefined ? String(opts.activeTextColor) : DEFAULTS.activeTextColor;
    var ariaLabel = opts.ariaLabel !== undefined ? String(opts.ariaLabel) : DEFAULTS.ariaLabel;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    var index = items.length ? indexOfValue(items, opts.value) : -1;
    if (index < 0 && opts.defaultValue !== undefined) index = indexOfValue(items, opts.defaultValue);
    if (index < 0) index = 0;
    var currentValue = items.length ? items[index].value : undefined;

    /* ---------- DOM：内容层（滚动）+ 高亮块 + 文字副本 + 真实按钮 ---------- */
    var inner = document.createElement('div');
    inner.className = 'rubber-segment__inner';

    var thumb = document.createElement('div');
    thumb.className = 'rubber-segment__thumb';
    thumb.setAttribute('aria-hidden', 'true');

    var ghosts = document.createElement('div');
    ghosts.className = 'rubber-segment__ghosts';
    ghosts.setAttribute('aria-hidden', 'true');

    var buttons = [];
    for (var i = 0; i < items.length; i++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rubber-segment__item';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(i === index));
      btn.tabIndex = i === index ? 0 : -1;
      btn.setAttribute('data-rs-index', String(i));

      var lab = document.createElement('span');
      lab.className = 'rubber-segment__label';
      lab.textContent = items[i].label;
      btn.appendChild(lab);
      buttons.push(btn);

      /* 副本复用同一个 item/label 类，字体、内边距、min-width、flex 全部相同，
         这样揭示层和真实文字才能逐像素对齐。 */
      var ghost = document.createElement('span');
      ghost.className = 'rubber-segment__item rubber-segment__ghost';
      var glab = document.createElement('span');
      glab.className = 'rubber-segment__label';
      glab.textContent = items[i].label;
      ghost.appendChild(glab);
      ghosts.appendChild(ghost);
    }

    thumb.appendChild(ghosts);
    inner.appendChild(thumb);
    for (var j = 0; j < buttons.length; j++) inner.appendChild(buttons[j]);

    root.innerHTML = '';
    root.appendChild(inner);

    root.classList.add('rubber-segment');
    root.classList.add(horizontal ? 'rubber-segment--horizontal' : 'rubber-segment--vertical');
    if (equalSlots) root.classList.add('rubber-segment--equal');
    if (!draggable) root.classList.add('rubber-segment--static');
    if (disabled) root.classList.add('rubber-segment--disabled');
    root.setAttribute('role', 'tablist');
    root.setAttribute('aria-label', ariaLabel);
    if (!horizontal) root.setAttribute('aria-orientation', 'vertical');
    if (disabled) root.setAttribute('aria-disabled', 'true');

    root.style.setProperty('--rs-h', sz.h + 'px');
    root.style.setProperty('--rs-font', sz.font + 'px');
    root.style.setProperty('--rs-pad', sz.pad + 'px');
    root.style.setProperty('--rs-minw', sz.minW + 'px');
    root.style.setProperty('--rs-radius', radius + 'px');
    root.style.setProperty('--rs-thumb-radius', thumbRadius + 'px');
    root.style.setProperty('--rs-inset', inset + 'px');
    root.style.setProperty('--rs-track', trackColor);
    root.style.setProperty('--rs-thumb', thumbColor);
    root.style.setProperty('--rs-text', textColor);
    root.style.setProperty('--rs-active-text', activeTextColor);

    /* ---------- 状态 ---------- */
    var destroyed = false;
    var edgeA = newEdge();
    var edgeB = newEdge();
    var state = {
      index: index,
      value: currentValue,
      slots: [],
      innerSize: 0,
      measured: false,
      drag: null,
      gen: 0,
      handoff: 0,
      raf: 0,
      last: 0,
      measureRaf: 0
    };
    var pendingJump = true;

    var motionQuery = null;
    try { motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (err) { /* 老内核 */ }
    var reduceMotion = !!(motionQuery && motionQuery.matches);

    /* ---------- 弹簧 / 补间 ---------- */
    function jumpEdge(e, to) {
      e.mode = null;
      e.done = null;
      e.x = to;
      e.v = 0;
      e.target = to;
    }

    function paint() {
      if (!thumb) return;
      /* 还没量到槽位时把滑块裁成 0 宽/高，避免首帧闪一整条浅色 */
      if (!state.measured) {
        thumb.style.clipPath = horizontal
          ? 'inset(0 100% 0 0 round ' + px(thumbRadius) + ')'
          : 'inset(0 0 100% 0 round ' + px(thumbRadius) + ')';
        return;
      }
      var W = Math.max(1, state.innerSize - inset * 2);
      var a = clamp(edgeA.x, 0, W);
      var b = clamp(edgeB.x, 0, W);
      if (b < a) b = a;
      var clip = horizontal
        ? 'inset(0 ' + px(W - b) + ' 0 ' + px(a) + ' round ' + px(thumbRadius) + ')'
        : 'inset(' + px(a) + ' 0 ' + px(W - b) + ' 0 round ' + px(thumbRadius) + ')';
      thumb.style.clipPath = clip;
    }

    function spring(e, to, dur, bounce, velocity, done) {
      if (reduceMotion) {
        jumpEdge(e, to);
        paint();
        if (done) done();
        return;
      }
      var zeta = Math.max(0.1, 1 - bounce);
      e.mode = 'spring';
      e.target = to;
      e.zeta = zeta;
      e.w = (4 * Math.PI * zeta) / Math.max(0.01, dur / speed);
      if (velocity != null) e.v = clamp(velocity, -MAX_V, MAX_V);
      e.done = done || null;
      wake();
    }

    function tween(e, to, durMs, ease, now) {
      if (reduceMotion) {
        jumpEdge(e, to);
        paint();
        return;
      }
      e.mode = 'tween';
      e.from = e.x;
      e.target = to;
      e.t0 = now;
      e.dur = Math.max(0, durMs / speed);
      e.ease = ease;
      e.done = null;
      wake();
    }

    function finish(e) {
      e.x = e.target;
      e.v = 0;
      var done = e.done;
      e.mode = null;
      e.done = null;
      if (done) done();
    }

    function stepEdge(e, now, dt) {
      if (e.mode === 'tween') {
        var p = e.dur > 0 ? Math.min(1, (now - e.t0) / e.dur) : 1;
        e.x = e.from + (e.target - e.from) * e.ease(p);
        e.v = 0;
        if (p >= 1) finish(e);
        return;
      }
      if (e.mode !== 'spring') return;
      var remain = dt;
      while (remain > 0) {
        var h = Math.min(1 / 240, remain);
        var acc = -(e.w * e.w) * (e.x - e.target) - 2 * e.zeta * e.w * e.v;
        e.v += acc * h;
        e.x += e.v * h;
        remain -= h;
      }
      if (Math.abs(e.x - e.target) < 0.25 && Math.abs(e.v) < 5) finish(e);
    }

    function frame(now) {
      state.raf = 0;
      if (destroyed) return;
      var dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      stepEdge(edgeA, now, dt);
      stepEdge(edgeB, now, dt);
      paint();
      if (edgeA.mode || edgeB.mode) state.raf = requestAnimationFrame(frame);
      else state.last = 0;
    }

    function wake() {
      if (state.raf || reduceMotion || destroyed) return;
      state.last = 0;
      state.raf = requestAnimationFrame(frame);
    }

    function jumpTo(i) {
      clearTimeout(state.handoff);
      state.gen++;
      var s = state.slots[i];
      if (!s) return;
      jumpEdge(edgeA, s.a);
      jumpEdge(edgeB, s.b);
      paint();
    }

    /** 松手落位：前缘弹到目标，拖尾越过 squash 像素再回弹（原版 land） */
    function land(to, v, flick, withSquash) {
      var s = state.slots[to];
      if (!s) return;
      var g = ++state.gen;
      var dir = Math.sign((s.a + s.b) / 2 - (edgeA.x + edgeB.x) / 2) || 1;
      var lead = dir > 0 ? edgeB : edgeA;
      var leadTo = dir > 0 ? s.b : s.a;
      var trail = dir > 0 ? edgeA : edgeB;
      var trailTo = dir > 0 ? s.a : s.b;
      function velOf(e) { return clamp(v == null ? e.v : v, -MAX_V, MAX_V); }
      spring(lead, leadTo, flick ? 0.4 : 0.3, flick ? 0.2 : 0, velOf(lead));
      var tv = velOf(trail);
      if (!withSquash || !(squash > 0)) {
        spring(trail, trailTo, 0.3, 0, tv);
        return;
      }
      spring(trail, trailTo + dir * squash, 0.3, 0, tv, function () {
        if (!destroyed && state.gen === g) spring(trail, trailTo, 0.16, 0, null);
      });
    }

    /** 点选换槽：先用 stretch 把滑块拉到新旧并集，HANDOFF 后落位 */
    function travel(from, to) {
      var a = state.slots[from];
      var b = state.slots[to];
      if (!a || !b) { jumpTo(to); return; }
      clearTimeout(state.handoff);
      state.gen++;
      if (reduceMotion) { jumpTo(to); return; }
      var u = clamp(stretch, 0, 100) / 100;
      var now = performance.now();
      var dur = DILATE * 1000;
      tween(edgeA, b.a + (Math.min(a.a, b.a) - b.a) * u, dur, easeOut, now);
      tween(edgeB, b.b + (Math.max(a.b, b.b) - b.b) * u, dur, easeOut, now);
      state.handoff = setTimeout(function () {
        if (!destroyed) land(to, null, false, true);
      }, HANDOFF * 1000);
    }

    function velocity(hist, now) {
      var t1 = 0, x1 = 0, t0 = 0, x0 = 0, n = 0;
      for (var i = 0; i < hist.length; i++) {
        if (now - hist[i][0] <= 100) {
          if (!n) { t0 = hist[i][0]; x0 = hist[i][1]; }
          t1 = hist[i][0];
          x1 = hist[i][1];
          n++;
        }
      }
      if (n < 2 || t1 - t0 < 8) return 0;
      return ((x1 - x0) / (t1 - t0)) * 1000;
    }

    function nearest(pos) {
      if (!state.slots.length) return state.index;
      var best = 0;
      var bd = Math.abs((state.slots[0].a + state.slots[0].b) / 2 - pos);
      for (var i = 1; i < state.slots.length; i++) {
        var d = Math.abs((state.slots[i].a + state.slots[i].b) / 2 - pos);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function syncA11y() {
      for (var i = 0; i < buttons.length; i++) {
        var on = i === state.index;
        buttons[i].setAttribute('aria-selected', String(on));
        buttons[i].tabIndex = disabled ? -1 : (on ? 0 : -1);
      }
    }

    /** 选中项推回可见区：只用 scrollLeft / scrollTop 的布局坐标，不做平滑滚动 */
    function scrollSelectedIntoView() {
      var el = buttons[state.index];
      if (!el || !root.isConnected) return;
      var pad = 6;
      if (horizontal) {
        var l = el.offsetLeft;
        var r = l + el.offsetWidth;
        var viewW = root.clientWidth;
        if (l - pad < root.scrollLeft) root.scrollLeft = l - pad;
        else if (r + pad > root.scrollLeft + viewW) root.scrollLeft = r + pad - viewW;
      } else {
        var t = el.offsetTop;
        var b = t + el.offsetHeight;
        var viewH = root.clientHeight;
        if (t - pad < root.scrollTop) root.scrollTop = t - pad;
        else if (b + pad > root.scrollTop + viewH) root.scrollTop = b + pad - viewH;
      }
    }

    function emitChange() {
      if (!onChange) return;
      try { onChange(state.value, state.index); }
      catch (err) {
        if (window.console) console.error('[LIZI_RUBBER] onChange 抛错', err);
      }
    }

    function select(i, conf) {
      conf = conf || {};
      if (!items.length) return;
      i = clamp(Math.round(i), 0, items.length - 1);
      var changed = i !== state.index;
      var from = state.index;
      state.index = i;
      state.value = items[i].value;
      syncA11y();
      scrollSelectedIntoView();
      /* 同值点击也要通知：旧分类页签点当前项会顺带清搜索 / 回收列表滚动 */
      if ((changed || conf.forceNotify) && conf.notify !== false) emitChange();
      if (destroyed) return;
      if (conf.focus && buttons[i] && buttons[i].isConnected) {
        try { buttons[i].focus({ preventScroll: true }); } catch (err) { buttons[i].focus(); }
      }
      if (conf.animate === false || from === i) return;
      if (!state.measured || state.slots.length !== items.length) {
        pendingJump = true;
        scheduleMeasure(true);
        return;
      }
      if (reduceMotion) jumpTo(i);
      else travel(from, i);
    }

    /* ---------- 测量 ---------- */
    function measure() {
      if (destroyed || !root.isConnected) return false;
      /* 用 offset*（布局坐标）而不是 getBoundingClientRect：
         形态下拉打开时有 scale(0.98) 的过渡，rect 会跟着缩放，
         而 clip-path 吃的是布局像素；混用会让滑块在动画期间偏移几像素。
         offsetLeft/Top 正好也是滚动内容坐标，scrollLeft 已经在里面了。 */
      var size = horizontal ? inner.offsetWidth : inner.offsetHeight;
      if (!(size > 0)) return false;
      var slots = [];
      var ok = true;
      for (var i = 0; i < buttons.length; i++) {
        var el = buttons[i];
        var a = (horizontal ? el.offsetLeft : el.offsetTop) - inset;
        var b = a + (horizontal ? el.offsetWidth : el.offsetHeight);
        if (horizontal ? !(el.offsetWidth > 0) : !(el.offsetHeight > 0)) ok = false;
        slots.push({ a: a, b: b });
      }
      if (!ok) return false;
      state.slots = slots;
      state.innerSize = size;
      var first = !state.measured || pendingJump;
      state.measured = true;
      pendingJump = false;
      if (first) {
        /* 手指正按着滑块时不要抢它的位置，松手会用自己的落位逻辑 */
        if (!state.drag) jumpTo(state.index);
      } else if (!state.drag && !edgeA.mode && !edgeB.mode) {
        /* 容器尺寸变化后静止状态重新对齐；动画中不打断 */
        jumpTo(state.index);
      }
      return true;
    }

    function scheduleMeasure(jump) {
      if (destroyed) return;
      if (jump) pendingJump = true;
      if (state.measureRaf) return;
      state.measureRaf = requestAnimationFrame(function () {
        state.measureRaf = 0;
        measure();
      });
    }

    function onResize() {
      scheduleMeasure(false);
    }

    /* ---------- 指针 ---------- */
    function localPos(e) {
      var ir = inner.getBoundingClientRect();
      var layout = horizontal ? inner.offsetWidth : inner.offsetHeight;
      var rendered = horizontal ? ir.width : ir.height;
      /* 祖先如果有 scale（下拉打开动画就是 0.98），clientX 的差值也是缩放过的；
         槽位用的是布局坐标，这里除回去，拖拽距离和 paint 才在同一个坐标系。 */
      var scale = (layout > 0 && rendered > 0) ? rendered / layout : 1;
      return ((horizontal ? e.clientX - ir.left : e.clientY - ir.top) / scale) - inset;
    }

    function pickItem(target) {
      if (!target || !target.closest) return null;
      var el = target.closest('.rubber-segment__item');
      if (!el || el.dataset.rsIndex === undefined) return null; /* 排除文字副本 */
      return el;
    }

    function releaseDrag() {
      var d = state.drag;
      state.drag = null;
      delete root.dataset.held;
      if (d && d.pressEl) {
        delete d.pressEl.dataset.pressed;
        d.pressEl = null;
      }
      return d;
    }

    function onDown(e) {
      if (destroyed || disabled || state.drag || !items.length) return;
      if (e.button !== undefined && e.button !== 0) return;
      var pos = localPos(e);
      var itemEl = pickItem(e.target);
      /* 滑块可见区域才允许拖拽；空白处点击按最近槽位处理。
         按在滑块上时默认就是当前已提交的槽位：换类动画会把滑块拉长盖住
         两个页签，这时点它不应该按几何中心又切回中间那一项。 */
      var onThumb = pos >= edgeA.x - 0.5 && pos <= edgeB.x + 0.5;
      var slot = itemEl
        ? Number(itemEl.dataset.rsIndex)
        : (onThumb ? state.index : nearest(pos));
      if (!(slot >= 0 && slot < items.length)) slot = 0;
      state.drag = {
        id: e.pointerId,
        start: pos,
        slot: slot,
        onThumb: onThumb,
        live: false,
        offset: 0,
        w: 0,
        hist: [[e.timeStamp || performance.now(), pos]],
        pressEl: null
      };
      if (onThumb) {
        /* 按住滑块就接管动画，避免旧的 travel / land 和手指打架 */
        clearTimeout(state.handoff);
        state.gen++;
        edgeA.mode = null;
        edgeA.done = null;
        edgeB.mode = null;
        edgeB.done = null;
      } else if (!reduceMotion && itemEl) {
        itemEl.dataset.pressed = '';
        state.drag.pressEl = itemEl;
      }
      /* 触屏非滑块区域不捕获，保留原生的横向 / 纵向滚动 */
      if (onThumb || e.pointerType === 'mouse' || e.pointerType === 'pen') {
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* 某些环境不支持 */ }
      }
    }

    function onMove(e) {
      var d = state.drag;
      if (!d || e.pointerId !== d.id) return;
      var pos = localPos(e);
      d.hist.push([e.timeStamp || performance.now(), pos]);
      if (d.hist.length > 8) d.hist.shift();
      if (!d.onThumb || !draggable || disabled) {
        if (d.pressEl && Math.abs(pos - d.start) > SLOP) {
          delete d.pressEl.dataset.pressed;
          d.pressEl = null;
        }
        return;
      }
      if (!d.live) {
        if (Math.abs(pos - d.start) < DEADZONE) return;
        d.live = true;
        d.offset = pos - edgeA.x;
        d.w = edgeB.x - edgeA.x;
        if (!(d.w > 0)) {
          var s = state.slots[state.index];
          d.w = s ? (s.b - s.a) : Math.max(1, state.innerSize - inset * 2);
        }
        root.dataset.held = '';
        if (d.pressEl) {
          delete d.pressEl.dataset.pressed;
          d.pressEl = null;
        }
      }
      if (e.cancelable) e.preventDefault();
      var W = Math.max(1, state.innerSize - inset * 2);
      var maxL = Math.max(0, W - d.w);
      var l = pos - d.offset;
      if (reduceMotion) {
        var c = clamp(l, 0, maxL);
        edgeA.x = c;
        edgeB.x = c + d.w;
      } else if (l < 0) {
        edgeA.x = 0;
        edgeB.x = d.w - rubber(-l, d.w);
      } else if (l > maxL) {
        edgeB.x = W;
        edgeA.x = maxL + rubber(l - maxL, d.w);
      } else {
        edgeA.x = l;
        edgeB.x = l + d.w;
      }
      paint();
    }

    function onUp(e) {
      var d = state.drag;
      if (!d || e.pointerId !== d.id) return;
      releaseDrag();
      try { root.releasePointerCapture(e.pointerId); } catch (err) { /* 未捕获 */ }
      var pos = localPos(e);
      if (!d.live) {
        if (Math.abs(pos - d.start) <= SLOP && d.slot >= 0 && d.slot < items.length) {
          if (d.slot === state.index) {
            /* 点当前项：保留旧行为（清搜索、列表回到顶部）。
               按下滑块时已经把进行中的 spring/tween 清掉了，这里要负责落回槽位，
               否则在换类动画中途点一下会停在拉伸一半的位置。 */
            select(d.slot, { animate: false, notify: true, forceNotify: true, focus: true });
            if (!destroyed) jumpTo(state.index);
          } else {
            select(d.slot, { animate: true, notify: true, focus: true });
          }
        }
        return;
      }
      if (destroyed) return;
      var v = velocity(d.hist, e.timeStamp || performance.now());
      var flick = Math.abs(v) > FLICK;
      var to = nearest((edgeA.x + edgeB.x) / 2 + project(v, glide));
      if (flick && to === state.index) {
        to = clamp(to + (v > 0 ? 1 : -1), 0, items.length - 1);
      }
      select(to, { animate: false, notify: true, focus: false });
      if (destroyed) return;
      if (reduceMotion) jumpTo(to);
      else land(to, v, flick, flick);
    }

    function onCancel(e) {
      var d = state.drag;
      if (!d || e.pointerId !== d.id) return;
      releaseDrag();
      try { root.releasePointerCapture(e.pointerId); } catch (err) { /* 未捕获 */ }
      if (!d.live) {
        /* 按下滑块时清掉了进行中的动画；这里被 pointercancel（例如纵向滚动）
           接管，没有可以落位的拖拽，直接回到当前槽位，别停在拉伸一半。 */
        if (d.onThumb && !destroyed) jumpTo(state.index);
        return;
      }
      if (reduceMotion) jumpTo(state.index);
      else land(state.index, null, false, false);
    }

    function onKey(e) {
      if (destroyed || disabled || !items.length) return;
      /* 原生 tab 的 Enter / Space：等同于点当前项（旧的纯文字页签也这样） */
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        select(state.index, { animate: false, notify: true, forceNotify: true, focus: true });
        return;
      }
      var last = items.length - 1;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(last, state.index + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, state.index - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      if (next === state.index) return;
      select(next, { animate: true, notify: true, focus: true });
    }

    function onMotionChange() {
      reduceMotion = !!(motionQuery && motionQuery.matches);
      if (reduceMotion && !destroyed) {
        clearTimeout(state.handoff);
        jumpTo(state.index);
      }
    }

    /* ---------- 公开 API ---------- */
    function setValue(v, conf) {
      if (destroyed) return false;
      var i = indexOfValue(items, v);
      if (i < 0) return false;
      /* 隐藏期间容器尺寸可能变了（例如旋转屏幕后再打开下拉）：
         尺寸对不上就重新量，别拿旧槽位去投动画。 */
      var now = horizontal ? inner.offsetWidth : inner.offsetHeight;
      if (!state.measured || (now > 0 && now !== state.innerSize)) measure();
      select(i, {
        animate: !(conf && conf.animate === false),
        notify: false,
        focus: false
      });
      return true;
    }

    function refresh() {
      if (destroyed) return;
      if (!measure()) scheduleMeasure(true);
      else scheduleMeasure(false);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (state.measureRaf) cancelAnimationFrame(state.measureRaf);
      if (state.raf) cancelAnimationFrame(state.raf);
      clearTimeout(state.handoff);
      state.measureRaf = 0;
      state.raf = 0;
      state.handoff = 0;
      state.drag = null;

      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (ro) {
        try { ro.disconnect(); } catch (err) { /* 已断开 */ }
        ro = null;
      }
      if (motionQuery) {
        if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
        else if (motionQuery.removeListener) motionQuery.removeListener(onMotionChange);
      }

      root.classList.remove(
        'rubber-segment', 'rubber-segment--horizontal', 'rubber-segment--vertical',
        'rubber-segment--equal', 'rubber-segment--static', 'rubber-segment--disabled'
      );
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
      root.removeAttribute('aria-orientation');
      root.removeAttribute('aria-disabled');
      root.removeAttribute('data-held');
      for (var i = 0; i < VAR_NAMES.length; i++) root.style.removeProperty(VAR_NAMES[i]);
      if (inner.parentNode === root) {
        try { root.removeChild(inner); } catch (err) { /* 已脱离 */ }
      }
      clearPrev(root, api);
    }

    var api = { setValue: setValue, refresh: refresh, destroy: destroy };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { scheduleMeasure(false); });
      try { ro.observe(root); ro.observe(inner); } catch (err) { /* 老内核 */ }
    }
    if (motionQuery) {
      if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
      else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
    }
    /* 字体换进换出会改变文字宽度，ready 之后再量一次（懒加载字体在首帧后才到） */
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(function () {
        if (!destroyed) scheduleMeasure(true);
      }).catch(function () { /* 字体加载失败用兜底字体，尺寸已经量过 */ });
    }

    setPrev(root, api);
    syncA11y();
    paint();
    /* 首次测量放到 rAF：create 时可能还在 hidden 抽屉里，立刻量只会拿到 0 */
    scheduleMeasure(true);

    return api;
  }

  window.LIZI_RUBBER = {
    create: create,
    sizes: SIZES,
    version: '1.0.0'
  };
})();
