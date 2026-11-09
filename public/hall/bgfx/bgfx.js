/* 铺色块后景效果调度器。
   六个 ReactBits 移植：Grainient（原有）+ LineWaves / PlasmaWave / GradientBlinds / Beams / Dither。
   每个移植模块各自暴露 window.LiziXxx.mount(el, opts) → { setColors, setPaused, destroy } 或 null。

   这一层只干三件事：
   1. 把「一条从深到浅的平台调色板」翻译成各家不同的颜色参数名（color1/2/3、colors[]、backgroundColor…）；
   2. 统一速度倍率（各家 speed 的尺度不一样，默认值差好几倍，直接用同一个数会一个飞快一个不动）；
   3. 找不到对应模块时退回 Grainient，都不行就返回 null（HTML 里 --plat-bg 的纯色兜底）。

   用法：
     const fx = window.LiziBgFx.mount(host, { effect: 'plasma-wave', colors: ['#170406', …], speed: 1 });
     fx.setColors([...]); fx.setPaused(true); fx.setEffect('beams'); fx.destroy();
*/
(function () {
  'use strict';

  /* id 存 localStorage，别改；新增只能往后加。speed 是「倍率 1」时给各家的基准值，
     取的是各家自己的默认速度，这样用户在设置里拖速度条，六种效果的观感变化幅度一致。 */
  const EFFECTS = [
    {
      id: 'grainient',
      name: '流色',
      hint: 'Grainient · 丝绸流色',
      global: 'LiziGrainient',
      speed: 0.55,
      opts: { angle: 38, flow: 0.9, scale: 1.05, silk: 0.3, softness: 1, grainAmount: 0.045, contrast: 1, saturation: 1, stir: 1.2 },
    },
    {
      id: 'line-waves',
      name: '波浪线',
      hint: 'Line Waves · 线条涌动',
      global: 'LiziLineWaves',
      speed: 0.3,
      opts: { lineCount: 72, lineWidth: 1.3, glow: 0.6, brightness: 1, highlight: 1, warpIntensity: 1, warpScale: 1, rotation: -33, opacity: 1 },
    },
    {
      id: 'plasma-wave',
      name: '等离子',
      hint: 'Plasma Wave · 光带缠绕',
      global: 'LiziPlasmaWave',
      speed: 1,
      opts: { thickness: 0.3, glow: 1, focalLength: 1.25, brightness: 1, core: 0.6, grain: 0.03, opacity: 1 },
    },
    {
      id: 'gradient-blinds',
      name: '渐变百叶',
      hint: 'Gradient Blinds · 光栅渐变',
      global: 'LiziGradientBlinds',
      speed: 1,
      opts: { angle: 20, noise: 0.3, blindCount: 16, blindMinWidth: 60, shine: 0.4, relief: 0.5, glow: 0.4, sway: 0.35 },
    },
    {
      id: 'beams',
      name: '光束',
      hint: 'Beams · 斜射光束',
      global: 'LiziBeams',
      speed: 1,
      opts: { beamWidth: 140, rotation: 30, waveLength: 233, depth: 1, sharpness: 0.6, glow: 0.6, brightness: 1.6, grain: 0.35, quality: 0.75 },
    },
    {
      id: 'dither',
      name: '抖色',
      hint: 'Dither · 像素抖动',
      global: 'LiziDither',
      speed: 1,
      opts: { pixelSize: 2, colorNum: 4, waveSpeed: 0.05, waveFrequency: 3, waveAmplitude: 0.3, contrast: 1, brightness: 0 },
    },
  ];

  const FALLBACK_PALETTE = ['#111114', '#2A2A31', '#45454F', '#6E6E7A', '#B9B9C4'];
  const DPR_CAP = 1.5;
  /* 各移植模块挂在容器上的防重入标记（mount 的 if (container.__liziX)）。 */
  const MOUNT_FLAGS = [
    '__liziGrainient', '__liziLineWaves', '__liziPlasmaWave',
    '__liziGradientBlinds', '__liziBeams', '__liziDither',
  ];

  const byId = (id) => EFFECTS.find((e) => e.id === id) || null;
  const moduleOf = (e) => (e && window[e.global]) || null;

  /** 调色板归一：至少 5 档（深→浅），缺的用最后一档补齐。用户只给两个色也能跑。 */
  function normPalette(colors) {
    const list = (Array.isArray(colors) ? colors : [])
      .filter((c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()))
      .map((c) => c.trim());
    if (!list.length) return FALLBACK_PALETTE.slice();
    if (list.length === 1) return [list[0], list[0], list[0], list[0], list[0]];
    if (list.length === 2) return [list[0], list[0], list[1], list[1], list[1]];
    if (list.length === 3) return [list[0], list[0], list[1], list[2], list[2]];
    if (list.length === 4) return [list[0], list[1], list[2], list[3], list[3]];
    return list.slice(0, 6);
  }

  /** 调色板 → 各家 mount 的颜色参数。各家吃颜色的姿势不一样，统一在这里翻译。 */
  function colorOpts(id, palette) {
    const p = palette;
    switch (id) {
      /* 三色：深、中、亮。三档都同色的话线条会糊成一片，所以中档取第 3 档拉开对比。 */
      case 'line-waves':
        return { color1: p[0], color2: p[2] || p[1], color3: p[4] || p[3] };
      /* 两色光带，用中亮段和最高亮段，暗底由 shader 自己的黑打出来。 */
      case 'plasma-wave':
        return { colors: [p[2] || p[1], p[4] || p[3]] };
      /* 光束本身要亮，直接用最高亮那段；第一档做背景的补光。 */
      case 'beams':
        return { colors: [p[4] || p[3] || p[2]] };
      /* 抖色：背景暗、波动色亮，调色板的中间档做抖动色阶。 */
      case 'dither':
        return { colors: p.slice(1), backgroundColor: p[0], waveColor: p[4] || p[3] || p[2] };
      case 'gradient-blinds':
      case 'grainient':
      default:
        return { colors: p };
    }
  }

  /** 建一个效果实例。host 变了或效果变了就整个重建（各家 WebGL 上下文不能复用）。 */
  function mount(host, options) {
    if (!host) return null;
    const opts = options || {};
    let id = byId(opts.effect) ? opts.effect : 'grainient';
    let palette = normPalette(opts.colors);
    let speedMul = Number(opts.speed);
    if (!isFinite(speedMul) || speedMul <= 0) speedMul = 1;
    let paused = !!opts.paused;
    let handle = null;
    let alive = true;

    function spawn() {
      const def = byId(id);
      let mod = moduleOf(def);
      /* 某个移植文件没加载（比如老缓存只拿到了旧 HTML）→ 退回流色，别让背景空掉。 */
      if (!mod && def && def.id !== 'grainient') {
        id = 'grainient';
        mod = moduleOf(byId('grainient'));
      }
      if (!def || !mod || !mod.mount) return null;
      const d = byId(id);
      return mod.mount(host, Object.assign({}, d.opts, colorOpts(id, palette), {
        speed: d.speed * speedMul,
        paused,
        /* 背景要跟海报抢注意力，鼠标交互一律关掉；点 / 拖留给跑马带和卡片。 */
        interactive: false,
        mouseInteraction: false,
        intro: false,
        lightMode: false,
        dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
      }));
    }

    function sweep() {
      /* 兜底：如果某家的 destroy 半路抛错，容器上会留下「已挂载」标记和一块
         没删的 canvas —— 下次 mount 被标记挡住，背景就永久空了。这里统一清场。 */
      Array.prototype.slice.call(host.querySelectorAll('canvas')).forEach((c) => c.remove());
      MOUNT_FLAGS.forEach((k) => { delete host[k]; });
      host.classList.remove('has-grain');
    }

    function teardown() {
      if (handle) {
        try { handle.destroy && handle.destroy(); } catch { /* WebGL 上下文可能已经没了 */ }
        handle = null;
      }
      sweep();
    }

    /* 单个移植模块初始化时抛错（驱动怪癖 / 内存不够）不该把 Hall 的 bind 带崩 */
    function safeSpawn() {
      try { return spawn(); }
      catch (e) {
        console.warn('[LiziBgFx] 效果挂载失败，退回流色兜底：', id, e);
        sweep();
        return null;
      }
    }

    function rebuild() {
      if (!alive) return;
      teardown();
      handle = safeSpawn();
    }

    handle = safeSpawn();

    return {
      get effect() { return id; },
      /** 换效果：整个重建（不同模块的 canvas 不能就地改）。 */
      setEffect(next) {
        const d = byId(next);
        if (!d || d.id === id) return false;
        id = d.id;
        rebuild();
        return !!handle;
      },
      /** 换色：优先走模块自己的 setColors，能不重建就不重建（重建会闪一下）。 */
      setColors(next) {
        palette = normPalette(next);
        /* 调用模块的 setColors 时也要走一遍 colorOpts：各家的「调色板」长度和含义
           跟 mount 时收到的必须一致，否则换平台后同一个效果会悄悄换一套取色规则
           （例如抖色的 palette 本来就去掉最暗那档，背景 / 波色另走两个参数）。 */
        const co = colorOpts(id, palette);
        const list = Array.isArray(co.colors)
          ? co.colors
          : [co.color1, co.color2, co.color3].filter(Boolean);
        if (handle && handle.setColors) {
          try { handle.setColors(list, co); return; } catch { /* 落到重建 */ }
        }
        rebuild();
      },
      setSpeed(mult) {
        const n = Number(mult);
        if (!isFinite(n) || n <= 0) return;
        if (Math.abs(n - speedMul) < 0.001) return;
        speedMul = n;
        /* 速度在 shader uniform 里，没有统一接口 → 重建。只在设置里改，频率极低。 */
        rebuild();
      },
      setPaused(next) {
        paused = !!next;
        if (handle && handle.setPaused) {
          try { handle.setPaused(paused); return; } catch { /* noop */ }
        }
      },
      destroy() {
        alive = false;
        teardown();
      },
      get ok() { return !!handle; },
    };
  }

  window.LiziBgFx = {
    EFFECTS: EFFECTS.map((e) => ({ id: e.id, name: e.name, hint: e.hint })),
    mount,
    ready: (id) => !!moduleOf(byId(id)),
    normPalette,
    FALLBACK_PALETTE,
    DEFAULT_EFFECT: 'grainient',
  };
})();
