/* ==========================================================================
   LIZI Air · Option Wheel（原生 JS）
   --------------------------------------------------------------------------
   移植自 ReactBits「Option Wheel」（David HDev），保留它的排布数学：
     每项绝对定位在容器垂直中心，transform-origin: left center；
     rowH    = fontSize * spacing
     tiltRad = tilt * PI / 180
     R       = rowH / tiltRad
     ang     = clamp(d * tiltRad, ±PI/2)
     y       = R * sin(ang)
     x       = -R * (1 - cos(ang)) * curve
     rot     = ang * 180 / PI
     transform: translate(x, calc(y - 50%)) rotate(rot)
     opacity = max(minOpacity, 1 - |d| * fade)
     blur    = |d| * blur
     缓动    = 帧率无关指数平滑，k = 1 - exp(-dt / tau)，tau = smoothing / 1000
   交互：非 passive 滚轮（每次最多一格，停 140ms 吸附）、按住拖拽（4px 才判定）、
   点选（跳到该项）、方向键 ±1。

   只负责表现 + 物理，不碰业务：选中项变化通过 onChange(index, item) 回调。
   用法：
     const wheel = window.LiZiOptionWheel.create(rootEl, {
       items: [{ id, name }, ...], selected, onChange, reduceMotion
     });
     wheel.select(i, animate) / wheel.step(dir) / wheel.destroy()
   ========================================================================== */
(function () {
  'use strict';

  var DEFAULTS = {
    fontSize: 13,
    spacing: 1.4,
    curve: 1,
    tilt: 6,
    blur: 2,
    fade: 0.25,
    minOpacity: 0.05,
    smoothing: 200
  };

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function create(root, options) {
    if (!root) return null;
    options = options || {};

    var items = (options.items || []).slice();
    var count = items.length;
    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      cfg[k] = options[k] != null ? options[k] : DEFAULTS[k];
    });

    var rowH = Math.max(cfg.fontSize * cfg.spacing, 1);
    var tiltRad = (cfg.tilt * Math.PI) / 180;
    var R = tiltRad > 0.0005 ? rowH / tiltRad : 0;
    var tau = Math.max(cfg.smoothing, 1) / 1000;
    var instant = typeof options.reduceMotion === 'function'
      ? !!options.reduceMotion()
      : !!options.reduceMotion;
    var onChange = typeof options.onChange === 'function' ? options.onChange : null;

    var pos = 0;
    var target = 0;
    var selected = -1;
    var raf = 0;
    var lastT = 0;
    var wheelT = 0;
    var drag = null;
    var dragMoved = false;

    root.classList.add('ow');
    root.style.setProperty('--ow-font-size', cfg.fontSize + 'px');
    root.innerHTML = '';

    var els = items.map(function (item, i) {
      var el = document.createElement('div');
      el.className = 'ow__item';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      el.dataset.i = String(i);
      el.dataset.src = item && item.id != null ? item.id : '';
      el.textContent = item && item.name != null ? item.name : String(item);
      root.appendChild(el);
      return el;
    });

    function render() {
      for (var i = 0; i < count; i++) {
        var el = els[i];
        if (!el) continue;
        var d = i - pos;
        var dist = Math.abs(d);
        var x = 0;
        var y = d * rowH;
        var rot = 0;
        if (R > 0) {
          var ang = clamp(d * tiltRad, -Math.PI / 2, Math.PI / 2);
          y = R * Math.sin(ang);
          x = -R * (1 - Math.cos(ang)) * cfg.curve;
          rot = (ang * 180) / Math.PI;
        }
        el.style.transform =
          'translate(' + x.toFixed(2) + 'px, calc(' + y.toFixed(2) + 'px - 50%)) rotate(' + rot.toFixed(3) + 'deg)';
        el.style.opacity = String(Math.max(cfg.minOpacity, 1 - dist * cfg.fade));
        el.style.filter = cfg.blur > 0 ? 'blur(' + (dist * cfg.blur).toFixed(2) + 'px)' : 'none';
        el.style.setProperty('--ow-p', String(Math.max(0, 1 - Math.min(dist, 1))));
        el.classList.toggle('is-on', i === selected);
        el.setAttribute('aria-selected', String(i === selected));
      }
    }

    function tick(now) {
      if (!raf) return;
      if (!lastT) lastT = now;
      var dt = Math.min(Math.max((now - lastT) / 1000, 0.001), 0.05);
      lastT = now;
      var k = 1 - Math.exp(-dt / tau);
      var next = pos + (target - pos) * k;
      var settled = Math.abs(target - next) < 0.001;
      if (settled) next = target;
      pos = next;
      render();
      if (settled) {
        raf = 0;
        lastT = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function startLoop() {
      if (instant) {
        pos = target;
        render();
        return;
      }
      if (raf) return;
      lastT = 0;
      raf = requestAnimationFrame(tick);
    }

    function applyTarget(value, snap) {
      if (!count) return;
      var v = clamp(value, 0, Math.max(count - 1, 0));
      if (snap) v = Math.round(v);
      target = v;
      var idx = clamp(Math.round(v), 0, Math.max(count - 1, 0));
      if (idx !== selected) {
        selected = idx;
        if (onChange) onChange(idx, items[idx]);
      }
      startLoop();
    }

    function select(index, animate) {
      if (!count) return;
      var i = clamp(Math.round(index), 0, Math.max(count - 1, 0));
      selected = i;
      target = i;
      if (!animate) {
        pos = i;
        render();
        return;
      }
      startLoop();
    }

    function step(dir) {
      applyTarget(Math.round(target) + dir, true);
    }

    /* ---- 滚轮：每次事件最多一格，停手 140ms 吸附到整数 ---- */
    function onWheel(e) {
      if (!count || !e.deltaY) return;
      e.preventDefault();
      var mode = e.deltaMode;
      var delta = mode === 1 ? e.deltaY * 24 : mode === 2 ? e.deltaY * rowH : e.deltaY;
      var amount = clamp(delta / rowH, -1, 1);
      applyTarget(target + amount, false);
      clearTimeout(wheelT);
      wheelT = setTimeout(function () {
        applyTarget(target, true);
      }, 140);
    }

    /* ---- 拖拽：超过 4px 才 setPointerCapture，轻点仍然能点选 ---- */
    function onPointerDown(e) {
      if (!count || e.button !== 0) return;
      drag = { y: e.clientY, start: target, id: e.pointerId, captured: false };
      dragMoved = false;
      root.classList.add('is-dragging');
    }

    function onPointerMove(e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      if (!drag.captured && Math.abs(dy) > 4) {
        drag.captured = true;
        dragMoved = true;
        try {
          root.setPointerCapture(drag.id);
        } catch (err) {
          /* 拿不到捕获也能继续用 */
        }
      }
      if (drag.captured) applyTarget(drag.start - dy / rowH, false);
    }

    function onPointerEnd() {
      if (!drag) return;
      var wasDrag = drag.captured;
      drag = null;
      root.classList.remove('is-dragging');
      if (wasDrag) applyTarget(target, true);
    }

    function onClick(e) {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      var el = e.target && e.target.closest ? e.target.closest('.ow__item') : null;
      if (!el) return;
      var index = +el.dataset.i;
      var cur = target;
      applyTarget(cur + (index - cur), true);
    }

    function onKeyDown(e) {
      var delta = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
      if (delta == null) return;
      e.preventDefault();
      step(delta);
    }

    function destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(wheelT);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerEnd);
      root.removeEventListener('pointercancel', onPointerEnd);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      root.innerHTML = '';
      els = [];
    }

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerEnd);
    root.addEventListener('pointercancel', onPointerEnd);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);

    if (count) select(options.selected != null ? options.selected : 0, false);

    return {
      select: select,
      step: step,
      destroy: destroy,
      element: root,
      get index() { return selected; }
    };
  }

  window.LiZiOptionWheel = { create: create };
})();
