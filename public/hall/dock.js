/**
 * Dock（ReactBits 组件）→ 原生 JS 版（2026-11-06）
 * 来源：https://www.reactbits.dev/components/dock
 *
 * 只取了它的核心：指针附近的图标按距离放大（cos² 曲线 + 弹簧），
 * 并且放大是**改布局宽度**，不是单纯 scale —— 旁边的图标会真的被挤开，
 * 这才是 Dock 的手感。右键菜单 / 标签 / 徽标那套没搬，长条不需要。
 *
 * 用法：LiziDock.attach(container)，container 里放 .pstrip__icons > .pstrip__i 即可。
 * 重新渲染 innerHTML 不用重新 attach（每帧都读当前 DOM）。
 */
(() => {
  /* 基准值对应 --plat-scale:1。铺色面板放大后必须整套按比例走，
     否则 dock.js 会把内联宽高拉回 32px：圆角按放大后的值算 → 视觉变圆，
     静止间距也会比实际布局小，图标挤在一起。 */
  const BASE = 32;        // 和 .pstrip__i 的 CSS 尺寸一致
  const PEAK = 48;
  const GAP = 6;
  const DISTANCE = 118;
  const STIFFNESS = 150;
  const DAMPING = 12;
  const MASS = 0.1;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /** 当前铺色面板的等比系数；读不到（还没进铺色态 / 老环境）就按 1 兜底。 */
  function dockScale(el) {
    try {
      const v = parseFloat(getComputedStyle(el).getPropertyValue('--plat-scale'));
      return Number.isFinite(v) && v > 0 ? v : 1;
    } catch {
      return 1;
    }
  }

  function attach(container) {
    if (!container || container.__liziDock) return;
    container.__liziDock = true;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = { pointer: null, raf: 0, last: 0, scale: dockScale(container) };
    const motion = new WeakMap();   // button -> { size, velocity }

    const iconsRow = () => container.querySelector('.pstrip__icons');
    const items = () => {
      const row = iconsRow();
      return row ? Array.from(row.querySelectorAll('.pstrip__i')) : [];
    };
    const entry = (node, base, scale) => {
      let s = motion.get(node);
      if (!s) { s = { size: base, velocity: 0, scale }; motion.set(node, s); return s; }
      /* 面板 resize 后 scale 变了：按比例迁移弹簧状态，不要从 32px 重新弹一次 */
      if (Math.abs((s.scale || 1) - scale) > 0.001) {
        const k = scale / (s.scale || 1);
        s.size *= k;
        s.velocity *= k;
        s.scale = scale;
      }
      return s;
    };

    const tick = (now) => {
      state.raf = 0;
      const list = items();
      const row = iconsRow();
      if (!row || !list.length) return;
      const dt = state.last ? clamp((now - state.last) / 1000, 0.001, 1 / 30) : 1 / 60;
      state.last = now;
      const rect = row.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const focus = state.pointer == null ? null : state.pointer - center;

      /* 只在一次交互开始时读 computed style，不要每帧 getComputedStyle 触发重算 */
      const scale = state.scale || 1;
      const base = BASE * scale;
      const peak = PEAK * scale;
      const gap = GAP * scale;
      const distance = DISTANCE * scale;

      let moving = false;
      const step = base + gap;
      const total = (list.length - 1) * step;
      const k = STIFFNESS / MASS;
      const c = DAMPING / MASS;
      const substeps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / substeps;

      list.forEach((node, i) => {
        const s = entry(node, base, scale);
        const rest = -total / 2 + i * step;
        const reach = focus == null ? 1 : Math.abs(focus - rest) / distance;
        const target = reduce ? base : base + (peak - base) * (reach < 1 ? Math.cos((reach * Math.PI) / 2) ** 2 : 0);
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
        const grow = size - base;
        node.style.width = size.toFixed(2) + 'px';
        node.style.height = size.toFixed(2) + 'px';
        node.style.transform = `translateY(${(-grow * 0.42).toFixed(2)}px)`;
        node.style.zIndex = grow > 1 ? '2' : '';
        /* logo 跟着放大，但留一点边，别贴到圆角上 */
        const img = node.querySelector('img');
        if (img) img.style.width = Math.max(60, Math.min(78, 68 + grow * 0.18)).toFixed(1) + '%';
      });

      if (moving || state.pointer != null) state.raf = requestAnimationFrame(tick);
      else state.last = 0;
    };

    const wake = () => {
      /* 面板尺寸可能刚被 fitPlatScale 改过：每次交互起点同步一次比例 */
      state.scale = dockScale(container);
      if (state.raf) return;
      state.last = 0;
      state.raf = requestAnimationFrame(tick);
    };

    container.addEventListener('pointermove', (e) => {
      if (!iconsRow()) return;
      state.pointer = e.clientX;
      wake();
    }, { passive: true });
    container.addEventListener('pointerleave', () => {
      state.pointer = null;
      wake();
    });

    /* 键盘 / 程序化重画后也要能回到静止尺寸 */
    container.addEventListener('focusin', () => {
      const list = items();
      const active = document.activeElement;
      const i = list.indexOf(active);
      if (i < 0) return;
      const row = iconsRow();
      if (!row) return;
      const rect = row.getBoundingClientRect();
      state.scale = dockScale(container);
      const scale = state.scale || 1;
      const step = (BASE + GAP) * scale;
      const total = (list.length - 1) * step;
      state.pointer = rect.left + rect.width / 2 + (-total / 2 + i * step);
      wake();
    });
    container.addEventListener('focusout', () => {
      state.pointer = null;
      wake();
    });
  }

  /** 铺色长条重画后调一下：把新节点的内联样式清掉（旧节点的状态本来就在 WeakMap 里） */
  function reset(container) {
    if (!container) return;
    container.querySelectorAll('.pstrip__i').forEach((node) => {
      node.style.width = '';
      node.style.height = '';
      node.style.transform = '';
      node.style.zIndex = '';
      const img = node.querySelector('img');
      if (img) img.style.width = '';
    });
  }

  window.LiziDock = { attach, reset };
})();
