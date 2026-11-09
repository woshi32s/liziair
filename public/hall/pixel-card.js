/**
 * PixelCard（ReactBits 组件）→ 原生 JS 版（2026-11-06）
 * 来源：https://www.reactbits.dev/components/pixel-card
 *
 * 悬停时从指针位置散开一片会呼吸的像素；移开按原路收回。
 * 和原版一样用 canvas 画网格，只是去掉了「always / click」两种触发和
 * 圆形 / 菱形像素（六格方块只用到 hover + 方形），并把这套逻辑挂到
 * 现有的 .plat 卡片上，不额外包一层 DOM。
 *
 * 用法：LiziPixelCard.mountAll(root)  —— 每次「我的」六格重画后调一次。
 */
(() => {
  const VARIANTS = {
    default: {
      gap: 6,
      speed: 35,
      glow: '#cbd5e1',
      dark: ['#ffffff', '#e4e4e7', '#a1a1aa'],
      light: ['#18181b', '#52525b', '#a1a1aa'],
    },
  };
  const APPEAR = 0.26;
  const EXIT = 0.22;

  /* 每块方块的粒子配色（2026-11-07 用户指定）：
     QQ 绿 · 网易云 / 波点 白 · 酷我橙（#FD6000）· 汽水用它音符符号的绿黄。
     没列到的平台（酷狗 / Spotify）继续按底色走 VARIANTS.default。 */
  const PLATFORM_COLORS = {
    netease: ['#ffffff', '#f2f2f2', '#d6d6dc'],
    qq: ['#31c27c', '#22a464', '#9be8c4'],
    kuwo: ['#FD6000', '#FF7A1A', '#FFB15C'],
    qishui: ['#41FE42', '#BDFD45', '#FCFC47'],
    bodian: ['#ffffff', '#f0f0f0', '#d8d8d8'],
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOutBack = (t) => {
    const c = 1.9;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };
  const toRgb = (() => {
    let ctx = null;
    return (color) => {
      if (!ctx) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) return [255, 255, 255];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#fff';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
  })();

  function mount(card, options) {
    if (!card || card.__liziPixel) return null;
    const front = card.querySelector('.plat__front') || card;
    const canvas = document.createElement('canvas');
    canvas.className = 'pixel-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const logo = front.querySelector('.plat__logo');
    front.insertBefore(canvas, logo || null);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return null; }

    card.__liziPixel = true;
    const tone = card.dataset.tone === 'light' ? 'light' : 'dark';
    const preset = VARIANTS.default;
    const opts = Object.assign({
      gap: preset.gap,
      speed: preset.speed,
      pixelSize: 2,
      revealDuration: 620,
      spotlight: 0.55,
      glow: 0.34,
      glowColor: '',
      opacity: 0.95,
      fade: 0.12,
      intro: false,
    }, options || {});
    const colors = (options && options.colors)
      || PLATFORM_COLORS[card.dataset.plat || '']
      || preset[tone];
    /* 光晕跟着粒子主色走，不然绿/黄粒子上叠一层蓝灰 */
    const glowRgb = toRgb(opts.glowColor || colors[0]);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const state = {
      alive: true,
      raf: 0,
      last: 0,
      time: 0,
      visible: true,
      width: 0,
      height: 0,
      ratio: 1,
      key: '',
      count: 0,
      x: new Float32Array(0),
      y: new Float32Array(0),
      tint: new Uint8Array(0),
      size: new Float32Array(0),
      phase: new Float32Array(0),
      rate: new Float32Array(0),
      jitter: new Float32Array(0),
      presence: new Float32Array(0),
      delay: new Float32Array(0),
      mask: new Float32Array(0),
      maskKey: '',
      active: false,
      changedAt: 0,
      originX: 0,
      originY: 0,
      maxDistance: 1,
      pointerX: 0,
      pointerY: 0,
      spotX: 0,
      spotY: 0,
      spotVX: 0,
      spotVY: 0,
      spotPower: 0,
      hovering: false,
      pulses: [],
      dt: 1 / 60,
    };

    const build = () => {
      const rect = card.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const key = [width, height, ratio, opts.gap, opts.pixelSize, colors.join(',')].join('|');
      if (key === state.key) return;
      state.key = key;
      state.width = width;
      state.height = height;
      state.ratio = ratio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      const columns = Math.floor((width - 1) / opts.gap) + 1;
      const rows = Math.floor((height - 1) / opts.gap) + 1;
      const offsetX = (width - (columns - 1) * opts.gap) / 2;
      const offsetY = (height - (rows - 1) * opts.gap) / 2;
      const count = columns * rows;
      const previous = state.presence;
      state.count = count;
      state.x = new Float32Array(count);
      state.y = new Float32Array(count);
      state.tint = new Uint8Array(count);
      state.size = new Float32Array(count);
      state.phase = new Float32Array(count);
      state.rate = new Float32Array(count);
      state.jitter = new Float32Array(count);
      state.presence = new Float32Array(count);
      state.delay = new Float32Array(count);
      let i = 0;
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          state.x[i] = offsetX + column * opts.gap;
          state.y[i] = offsetY + row * opts.gap;
          state.tint[i] = Math.floor(Math.random() * colors.length);
          state.size[i] = opts.pixelSize * (0.25 + Math.random() * 0.75);
          state.phase[i] = Math.random() * Math.PI * 2;
          state.rate[i] = 0.55 + Math.random() * 0.9;
          state.jitter[i] = Math.random();
          if (previous.length) state.presence[i] = previous[Math.min(i, previous.length - 1)];
          i++;
        }
      }
      schedule();
      wake();
    };

    const schedule = () => {
      const span = opts.revealDuration / 1000;
      let far = 1;
      for (let i = 0; i < state.count; i++) {
        far = Math.max(far, Math.hypot(state.x[i] - state.originX, state.y[i] - state.originY));
      }
      state.maxDistance = far;
      for (let i = 0; i < state.count; i++) {
        const distance = Math.hypot(state.x[i] - state.originX, state.y[i] - state.originY) / far;
        state.delay[i] = state.active
          ? distance * span * 0.82 + state.jitter[i] * span * 0.18
          : (1 - distance) * span * 0.45 + state.jitter[i] * span * 0.1;
      }
    };

    const setActive = (value, x, y) => {
      if (state.active === value) return;
      state.active = value;
      state.changedAt = state.time;
      if (value) {
        state.originX = x !== undefined ? x : state.width / 2;
        state.originY = y !== undefined ? y : state.height / 2;
      }
      schedule();
      wake();
    };

    const draw = () => {
      const { width, height, ratio } = state;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const maskKey = `${state.count}|${width}|${height}|${opts.fade}`;
      if (state.maskKey !== maskKey) {
        state.maskKey = maskKey;
        state.mask = new Float32Array(state.count);
        const near = Math.min(width, height) * 0.05;
        const far = Math.min(width, height) * 0.42;
        for (let i = 0; i < state.count; i++) {
          const edge = Math.min(state.x[i], width - state.x[i], state.y[i], height - state.y[i]);
          const t = clamp((edge - near) / (far - near), 0, 1);
          state.mask[i] = 1 - opts.fade * t * t * t * (t * (t * 6 - 15) + 10);
        }
      }

      let presenceSum = 0;
      const elapsed = state.time - state.changedAt;
      const appearStep = state.dt / APPEAR;
      const exitStep = state.dt / EXIT;
      for (let i = 0; i < state.count; i++) {
        const current = state.presence[i];
        const ready = elapsed >= state.delay[i] || reduce;
        const target = state.active ? (ready ? 1 : 0) : (ready ? 0 : current);
        if (reduce) state.presence[i] = target;
        else if (target > current) state.presence[i] = Math.min(1, current + appearStep);
        else if (target < current) state.presence[i] = Math.max(0, current - exitStep);
        presenceSum += state.presence[i];
      }
      const presenceAvg = state.count ? presenceSum / state.count : 0;

      if (opts.glow > 0 && presenceAvg > 0.001) {
        const [r, g, b] = glowRgb;
        const cx = state.spotPower > 0.01 ? state.spotX : state.originX;
        const cy = state.spotPower > 0.01 ? state.spotY : state.originY;
        const reach = Math.max(width, height) * 0.85;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        const strength = opts.glow * opts.opacity * 0.32 * Math.min(1, presenceAvg * 1.4);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${strength})`);
        gradient.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${strength * 0.35})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      const spotRadius = Math.min(width, height) * 0.38 + 30;
      const spotStrength = opts.spotlight * state.spotPower;
      /* 粒子只长在指针周围一圈，不再铺满整张卡（2026-11-07 用户要求改回来）。
         near 以内全亮，到 far 渐隐为 0。 */
      const localNear = Math.min(width, height) * 0.24;
      const localFar = Math.min(width, height) * 0.46 + 14;
      const pulses = state.pulses;
      const twinkle = reduce ? 0 : 1;
      const frequency = (opts.speed / 35) * 1.35;

      for (let color = 0; color < colors.length; color++) {
        ctx.fillStyle = colors[color];
        for (let i = 0; i < state.count; i++) {
          if (state.tint[i] !== color) continue;
          const presence = state.presence[i];
          if (presence <= 0.002) continue;
          const x = state.x[i];
          const y = state.y[i];
          let size = state.size[i];
          let alpha = 0.5 + presence * 0.38;
          if (twinkle) {
            const wave = Math.sin(state.phase[i] + state.time * frequency * state.rate[i]);
            size *= 0.62 + 0.38 * wave;
            alpha += 0.12 * wave + (state.jitter[i] > 0.92 ? 0.35 * Math.max(0, wave) : 0);
          }
          size *= easeOutBack(presence);
          const flash = presence < 1 && state.active ? Math.sin(presence * Math.PI) : 0;
          size *= 1 + flash * 0.9;
          alpha += flash * 0.6;
          const spotDist = Math.hypot(x - state.spotX, y - state.spotY);
          if (spotStrength > 0.001) {
            const near = smoothstep(spotRadius, 0, spotDist);
            size *= 1 + spotStrength * near * near * 2.4;
            alpha += spotStrength * near * 0.45;
          }
          alpha = Math.min(1, alpha) * state.mask[i] * opts.opacity;
          alpha *= 1 - smoothstep(localNear, localFar, spotDist);
          if (alpha <= 0.004) continue;
          for (let p = 0; p < pulses.length; p++) {
            const pulse = pulses[p];
            const band = (Math.hypot(x - pulse.x, y - pulse.y) - pulse.radius) / 26;
            const wave = Math.exp(-band * band) * pulse.power;
            size *= 1 + wave * 1.4;
            alpha = Math.min(1, alpha + wave * 0.5);
          }
          if (size <= 0.05) continue;
          ctx.globalAlpha = alpha;
          ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now) => {
      state.raf = 0;
      if (!state.alive) return;
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      state.dt = dt;
      state.time += dt;
      build();

      const want = state.hovering && !reduce ? 1 : 0;
      state.spotPower += (want - state.spotPower) * (1 - Math.exp(-(want ? 6 : 3) * dt));
      const stiffness = 120;
      const damping = 2 * Math.sqrt(stiffness) * 0.9;
      state.spotVX += (stiffness * (state.pointerX - state.spotX) - damping * state.spotVX) * dt;
      state.spotVY += (stiffness * (state.pointerY - state.spotY) - damping * state.spotVY) * dt;
      state.spotX += state.spotVX * dt;
      state.spotY += state.spotVY * dt;

      const pulseSpeed = state.maxDistance / Math.max(0.35, (opts.revealDuration / 1000) * 0.9);
      state.pulses = state.pulses.filter((pulse) => {
        pulse.radius += pulseSpeed * dt;
        pulse.power = Math.max(0, 1 - pulse.radius / (state.maxDistance + 40));
        return pulse.power > 0;
      });

      draw();
      let presence = 0;
      for (let i = 0; i < state.count; i++) presence += state.presence[i];
      const settling = state.active || presence > 0 || state.pulses.length > 0
        || state.spotPower > 0.002 || Math.abs(state.spotVX) + Math.abs(state.spotVY) > 0.5;
      if (settling && state.visible) state.raf = requestAnimationFrame(frame);
      else state.last = 0;
    };

    function wake() {
      if (state.raf || !state.alive || !state.visible) return;
      state.raf = requestAnimationFrame(frame);
    }

    const local = (event) => {
      const rect = card.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const onEnter = (event) => {
      const [x, y] = local(event);
      state.hovering = event.pointerType !== 'touch';
      state.pointerX = x;
      state.pointerY = y;
      if (state.spotPower < 0.01) {
        state.spotX = x;
        state.spotY = y;
        state.spotVX = 0;
        state.spotVY = 0;
      }
      setActive(true, x, y);
      wake();
    };
    const onMove = (event) => {
      const [x, y] = local(event);
      state.pointerX = x;
      state.pointerY = y;
      wake();
    };
    const onLeave = () => {
      state.hovering = false;
      setActive(false);
      wake();
    };
    const onDown = () => {
      if (!reduce && state.active) {
        state.pulses.push({ x: state.pointerX, y: state.pointerY, radius: 0, power: 1 });
      }
      wake();
    };

    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('pointerdown', onDown);

    const resizeObserver = new ResizeObserver(() => { build(); wake(); });
    resizeObserver.observe(card);
    const intersection = new IntersectionObserver((entries) => {
      state.visible = entries.some((entry) => entry.isIntersecting);
      if (state.visible) wake();
    });
    intersection.observe(card);

    build();
    state.pointerX = state.width / 2;
    state.pointerY = state.height / 2;
    state.spotX = state.pointerX;
    state.spotY = state.pointerY;
    state.originX = state.width / 2;
    state.originY = state.height / 2;

    const engine = {
      destroy() {
        state.alive = false;
        cancelAnimationFrame(state.raf);
        resizeObserver.disconnect();
        intersection.disconnect();
        card.removeEventListener('pointerenter', onEnter);
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerleave', onLeave);
        card.removeEventListener('pointerdown', onDown);
        canvas.remove();
        delete card.__liziPixel;
      },
    };
    card.__liziPixelEngine = engine;
    return engine;
  }

  const mounted = new Set();

  /** 「我的」六格每次重画后调用：给新卡片挂上，已离开 DOM 的引擎收掉 */
  function mountAll(root) {
    if (!root) return;
    mounted.forEach((engine) => {
      if (!engine.card || !engine.card.isConnected) {
        engine.destroy();
        mounted.delete(engine);
      }
    });
    root.querySelectorAll('.plat').forEach((card) => {
      if (card.__liziPixel) return;
      const engine = mount(card);
      if (engine) { engine.card = card; mounted.add(engine); }
    });
  }

  window.LiziPixelCard = { mount, mountAll };
})();
