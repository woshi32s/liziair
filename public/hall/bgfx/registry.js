/**
 * LIZI BGFX —— 铺色块后景「流体背景」预设注册表（2026-11-08）
 *
 * 把 7 个 ReactBits 移植模块 + 原有 Grainient 做成按需加载的统一入口：
 *   window.LIZI_BGFX.list()              → [{ id, name, cn, desc }] × 8
 *   window.LIZI_BGFX.load(id)            → Promise<module|null>
 *   window.LIZI_BGFX.mount(id, el, opts) → Promise<instance|null>（未知 id 同步返回 null）
 *
 * 每个模块实例（Grainient 经适配后）都满足：
 *   { el, destroy(), setColors(colors), pause(), resume(), resize() }
 *
 * 加载方式：首次用到某个 id 时向 <head> 注入 public/hall/bgfx/<file>.js，
 * 同一个绝对 URL 只注入一次（并发调用复用同一个 Promise）；脚本里若已有对应
 * window.LiziBg* 则直接复用，不重复注入。Grainient 由 index.html 预先加载，
 * file 为 null，永不注入。
 *
 * 文件名说明：beams 模块实际文件是 bg-beams.js，不是 beams.js ——
 * 后者是线上旧调度器（hall/bgfx/bgfx.js）正在用的 LiziBeams，不能覆盖。
 *
 * 这一层只负责「找模块 / 加载 / 转发 mount」，不做调色板翻译，
 * 颜色由各模块自己把 opts.colors（暗→亮 5 色）映射到自己的 uniform。
 */
(() => {
  'use strict';

  /* 注册表脚本自身的绝对地址，用来拼模块 URL；
     兜底用相对 public/ 的路径（index.html 直接引用时也能work）。 */
  const HERE = document.currentScript && document.currentScript.src;
  const BASE = HERE ? HERE.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : 'hall/bgfx/';

  const ITEMS = [
    {
      id: 'grainient',
      name: 'Grainient',
      cn: '流色',
      desc: '沿色带流动的丝绸质感，大厅原有默认背景。',
      file: null,
      global: 'LiziGrainient',
      adapter: adaptGrainient
    },
    {
      id: 'aurora',
      name: 'Aurora',
      cn: '极光',
      desc: '极光沿地平线起伏，颜色随曲目调色板渐变。',
      file: 'aurora.js',
      global: 'LiziBgAurora'
    },
    {
      id: 'beams',
      name: 'Beams',
      cn: '光带',
      desc: '斜向光束层层叠加，带体积光晕与细颗粒。',
      file: 'bg-beams.js',
      global: 'LiziBgBeams'
    },
    {
      id: 'darkveil',
      name: 'DarkVeil',
      cn: '暗纱',
      desc: '暗色流体帘幕缓慢翻卷，适合压暗的封面底。',
      file: 'darkveil.js',
      global: 'LiziBgDarkVeil'
    },
    {
      id: 'gradient-waves',
      name: 'GradientWaves',
      cn: '浪潮',
      desc: '渐变海面起伏，带透视、浪尖高光与雾气。',
      file: 'gradient-waves.js',
      global: 'LiziBgGradientWaves'
    },
    {
      id: 'iridescence',
      name: 'Iridescence',
      cn: '虹彩',
      desc: '虹彩薄膜流动，指针划过会泛出金属光泽。',
      file: 'iridescence.js',
      global: 'LiziBgIridescence'
    },
    {
      id: 'liquid-chrome',
      name: 'LiquidChrome',
      cn: '液态铬',
      desc: '液态金属表面，指针划过会荡开波纹。',
      file: 'liquid-chrome.js',
      global: 'LiziBgLiquidChrome'
    },
    {
      id: 'silk',
      name: 'Silk',
      cn: '丝绸',
      desc: '丝绸褶皱缓慢舒展，柔和的布面高光与流光。',
      file: 'silk.js',
      global: 'LiziBgSilk'
    }
  ];

  const BY_ID = Object.create(null);
  for (let i = 0; i < ITEMS.length; i++) BY_ID[ITEMS[i].id] = ITEMS[i];

  /* 绝对 URL → 加载 Promise，同地址只注入一次。 */
  const PENDING = Object.create(null);

  /* Grainient 是旧接口：setPaused(v)、没有 pause/resume/resize。
     这里补成统一接口，同时保留 setPaused 透传，避免旧接线方失效。 */
  function adaptGrainient(instance, el) {
    if (!instance) return null;
    if (typeof instance.pause === 'function' && typeof instance.resume === 'function') return instance;
    return {
      el,
      destroy() {
        if (instance && typeof instance.destroy === 'function') instance.destroy();
      },
      setColors(colors) {
        if (instance && typeof instance.setColors === 'function') instance.setColors(colors);
      },
      pause() {
        if (instance && typeof instance.setPaused === 'function') instance.setPaused(true);
      },
      resume() {
        if (instance && typeof instance.setPaused === 'function') instance.setPaused(false);
      },
      setPaused(value) {
        if (instance && typeof instance.setPaused === 'function') instance.setPaused(!!value);
      },
      /* Grainient 内部自己 ResizeObserver，外部不需要触发重排。 */
      resize() {}
    };
  }

  function list() {
    return ITEMS.map(item => ({ id: item.id, name: item.name, cn: item.cn, desc: item.desc }));
  }

  function load(id) {
    const item = BY_ID[id];
    if (!item) return Promise.reject(new Error('LIZI_BGFX: unknown background id "' + id + '"'));

    const existing = window[item.global];
    if (existing) return Promise.resolve(existing);

    /* Grainient 由 index.html 预加载，这里只查不注入。 */
    if (!item.file) return Promise.resolve(null);

    /* currentScript 可用时按脚本自身绝对地址解析；否则退回相对 public/ 的路径，
       交给浏览器按文档地址解析（避免 new URL 在相对 base 下抛错）。 */
    const url = HERE ? new URL(item.file, BASE).href : BASE + item.file;
    if (PENDING[url]) return PENDING[url];

    PENDING[url] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.setAttribute('data-lizi-bgfx', id);
      script.onload = () => {
        resolve(window[item.global] || null);
      };
      script.onerror = () => {
        delete PENDING[url];
        script.remove();
        reject(new Error('LIZI_BGFX: failed to load "' + url + '"'));
      };
      document.head.appendChild(script);
    });
    return PENDING[url];
  }

  function mount(id, el, opts) {
    const item = BY_ID[id];
    if (!item) return null;
    return load(id).then(mod => {
      if (!mod || typeof mod.mount !== 'function') return null;
      const instance = mod.mount(el, opts || {});
      return item.adapter ? item.adapter(instance, el) : instance;
    });
  }

  window.LIZI_BGFX = { list, load, mount };
})();
