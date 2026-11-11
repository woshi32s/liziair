/**
 * LIZI · 手机大厅 · 极简导航
 * --------------------------------------------------------------------------
 * 两行固位：上面平台，下面推荐来源。选中项只做两件事——墨色变深，
 * 底下一道短墨线浮出来。没有连线、没有光环、没有逐帧动画。
 * 位置和字重都不变，切换时不会挤动旁边的字，长时间看着也安静。
 *
 * 对外：
 *   const nav = HallNav.create({ platRow, srcRow, plats, srcs,
 *                                plat, src, onPick })
 *   nav.setActive(row, id)   // row: 'plat' | 'src'
 *   nav.destroy()
 */
(function () {
  'use strict';

  /* ==========================================================================
     Dock 放大（和桌面 hall/dock.js 同一套数学，基准按手机 30px 等比）
     BASE 30 / PEAK 46 / GAP 6 / DISTANCE 118 / STIFFNESS 150 / DAMPING 12 / MASS .1
     · 放大改的是布局宽高，邻居真的被挤开
     · 触屏走 pointerdown / pointermove / pointerup，手指沿一行滑过就生效
     · 只在交互期间 rAF，静止就停；不在每帧 getComputedStyle
     ========================================================================== */
  const DOCK_BASE = 30;
  const DOCK_PEAK = 46;
  const DOCK_GAP = 6;
  const DOCK_DISTANCE = 118;
  const DOCK_STIFFNESS = 150;
  const DOCK_DAMPING = 12;
  const DOCK_MASS = 0.1;

  const dockMotion = new WeakMap();   // button -> { size, velocity }
  const dockClamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function attachDock(container) {
    if (!container || container.__dock) return;   // 幂等：重画 DOM 不用重新 attach
    container.__dock = true;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = { pointer: null, raf: 0, last: 0 };
    const items = () => Array.from(container.querySelectorAll('.gnode--tile'));
    const entry = (node) => {
      let s = dockMotion.get(node);
      if (!s) { s = { size: DOCK_BASE, velocity: 0 }; dockMotion.set(node, s); }
      return s;
    };

    const tick = (t) => {
      state.raf = 0;
      const list = items();
      if (!list.length) { state.last = 0; return; }
      const dt = state.last ? dockClamp((t - state.last) / 1000, 0.001, 1 / 30) : 1 / 60;
      state.last = t;
      const rect = container.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const focus = state.pointer == null ? null : state.pointer - center;

      const step = DOCK_BASE + DOCK_GAP;
      const total = (list.length - 1) * step;
      const k = DOCK_STIFFNESS / DOCK_MASS;
      const c = DOCK_DAMPING / DOCK_MASS;
      const substeps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / substeps;
      let moving = false;

      list.forEach((node, i) => {
        const s = entry(node);
        const rest = -total / 2 + i * step;
        const reach = focus == null ? 1 : Math.abs(focus - rest) / DOCK_DISTANCE;
        const target = reduce || focus == null
          ? DOCK_BASE
          : DOCK_BASE + (DOCK_PEAK - DOCK_BASE) * (reach < 1 ? Math.cos((reach * Math.PI) / 2) ** 2 : 0);
        for (let j = 0; j < substeps; j++) {
          s.velocity = (s.velocity + h * k * (target - s.size)) / (1 + h * c + h * h * k);
          s.size += s.velocity * h;
        }
        if (Math.abs(s.velocity) < 0.02 && Math.abs(target - s.size) < 0.02) {
          s.size = target;
          s.velocity = 0;
        } else {
          moving = true;
        }
        const size = Math.max(1, s.size);
        const grow = size - DOCK_BASE;
        node.style.width = size.toFixed(2) + 'px';
        node.style.height = size.toFixed(2) + 'px';
        node.style.transform = 'translateY(' + (-grow * 0.42).toFixed(2) + 'px)';
        node.style.zIndex = grow > 1 ? '2' : '';
        /* logo 跟着放大但留边；静止时交还给 CSS 的 19px */
        const img = node.querySelector('.gnode__logo');
        if (img) {
          if (grow > 0.5) {
            const pct = Math.min(76, 64 + grow * 0.7).toFixed(1) + '%';
            img.style.width = pct;
            img.style.height = pct;
          } else {
            img.style.width = '';
            img.style.height = '';
          }
        }
      });

      /* 只在真的还在动时续帧：弹簧收敛后立刻停，下一次 pointermove 再唤醒 */
      if (moving) state.raf = requestAnimationFrame(tick);
      else state.last = 0;
    };

    const wake = () => {
      if (state.raf) return;
      state.last = 0;
      state.raf = requestAnimationFrame(tick);
    };
    const blur = () => {
      state.pointer = null;
      wake();
    };

    container.addEventListener('pointermove', (e) => {
      state.pointer = e.clientX;
      wake();
    }, { passive: true });
    container.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      state.pointer = e.clientX;
      wake();
    }, { passive: true });
    container.addEventListener('pointerup', blur, { passive: true });
    container.addEventListener('pointercancel', blur, { passive: true });
    container.addEventListener('pointerleave', blur);
  }

  function create(opts) {
    if (!opts || !opts.platRow || !opts.srcRow) return null;

    const rows = { plat: opts.platRow, src: opts.srcRow };
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    const items = [];
    const byKey = new Map();
    const active = { plat: null, src: null };
    let destroyed = false;

    function makeNode(row, data) {
      const el = document.createElement('button');
      const isPlat = row === 'plat';
      el.type = 'button';
      el.className = 'gnode' + (isPlat ? ' gnode--tile' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', 'false');
      el.dataset.key = row + ':' + data.id;

      const label = document.createElement('span');
      label.className = 'gnode__label';
      label.textContent = data.label || data.id;

      if (isPlat) {
        /* 平台行只留图标：底色用各家 App 图标本身的品牌色（酷狗是蓝底白 K） */
        el.setAttribute('aria-label', data.label || data.id);
        el.title = data.label || data.id;
        el.style.setProperty('--tile-bg', data.bg || '#8A8A8A');
        el.style.setProperty('--tile-ink', data.ink || '#FFFFFF');
      }

      const mark = document.createElement('i');
      mark.className = 'gnode__mark';
      mark.setAttribute('aria-hidden', 'true');

      if (isPlat) {
        if (data.logo) {
          const img = new Image();
          img.className = 'gnode__logo';
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          img.src = data.logo;
          img.addEventListener('error', () => {
            img.remove();
            el.classList.add('is-nologo');
            const dot = document.createElement('i');
            dot.className = 'gnode__dot';
            el.insertBefore(dot, mark);
          }, { once: true });
          el.appendChild(img);
        } else {
          const dot = document.createElement('i');
          dot.className = 'gnode__dot';
          el.appendChild(dot);
          el.classList.add('is-nologo');
        }
      }

      if (!isPlat) el.appendChild(label);
      el.appendChild(mark);

      el.addEventListener('click', () => {
        setActive(row, data.id);
        if (onPick) {
          try { onPick(row, data.id); } catch (err) { /* 业务异常不影响选中态 */ }
        }
      });

      rows[row].appendChild(el);
      const rec = { row, id: data.id, el, data };
      byKey.set(row + ':' + data.id, rec);
      items.push(rec);
      return rec;
    }

    function setActive(row, id) {
      if (destroyed) return false;
      const rec = byKey.get(row + ':' + id);
      if (!rec || active[row] === rec) return false;

      const prev = active[row];
      active[row] = rec;
      if (prev) {
        prev.el.classList.remove('is-on');
        prev.el.setAttribute('aria-selected', 'false');
      }
      rec.el.classList.add('is-on');
      rec.el.setAttribute('aria-selected', 'true');
      return true;
    }

    (Array.isArray(opts.plats) ? opts.plats : []).forEach((p) => makeNode('plat', p));
    (Array.isArray(opts.srcs) ? opts.srcs : []).forEach((s) => makeNode('src', s));

    const fallbackPlat = opts.plats && opts.plats[0] ? opts.plats[0].id : null;
    const fallbackSrc = opts.srcs && opts.srcs[0] ? opts.srcs[0].id : null;
    const initialPlat = (opts.plat && byKey.has('plat:' + opts.plat)) ? opts.plat : fallbackPlat;
    const initialSrc = (opts.src && byKey.has('src:' + opts.src)) ? opts.src : fallbackSrc;
    if (initialPlat) setActive('plat', initialPlat);
    if (initialSrc) setActive('src', initialSrc);

    /* 平台行挂 Dock（幂等；每次交互都重新读 DOM，innerHTML 重画也不怕） */
    attachDock(opts.platRow);

    return {
      setActive,
      destroy() {
        destroyed = true;
        items.forEach((rec) => rec.el.remove());
        byKey.clear();
        items.length = 0;
      },
    };
  }

  window.HallNav = { create };
})();
