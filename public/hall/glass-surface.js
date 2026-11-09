/**
 * GlassSurface（ReactBits，JS/CSS 版）→ 无依赖 DOM 移植
 *
 * 只使用 **SVG 路径**（feImage + feDisplacementMap + 通道拆分），不上 WebGL：
 * 我们没有可采样的 backdrop 位图，`backdrop-filter: url(#filter)` 才是这里要的。
 *
 * 性能边界（很重要）：
 *   只允许给 .hall-pcards 这种 48px 高的小面积元素挂这个滤镜。
 *   **绝不**把 `backdrop-filter: url(...)` 加到 .hall-plat 整块 ——
 *   整块面积大、下面还有 WebGL 流色，会直接拖垮合成器。
 *   不支持 SVG backdrop-filter 时自动退回 `--fallback` 的 12px 磨砂 + 顶部高光，
 *   不会留一条完全透明的空条。
 *
 * 对外 API：window.LiziGlassSurface = { attach(el, opts), refresh(el), destroy(el) }
 * attach 幂等：paintPlatCards() 的 innerHTML 重画后可以再调一次恢复。
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_OPTS = {
    borderRadius: 14,
    borderWidth: 0.07,
    brightness: 50,
    opacity: 0.93,
    blur: 11,
    displace: 0,
    saturation: 1,
    distortionScale: -180,
    redOffset: 0,
    greenOffset: 10,
    blueOffset: 20,
    xChannel: 'R',
    yChannel: 'G',
    mixBlendMode: 'difference',
    backgroundOpacity: 0.06,
  };

  const states = new WeakMap();
  let uid = 0;

  function supportsSvgBackdrop() {
    try {
      if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
      const ua = navigator.userAgent || '';
      /* 2026-11-08：Chromium 的 backdrop-filter 不保证渲染 SVG url() 位移，
         48px 小条上位移本来也看不出来；直接走原版 frosted fallback 更接近参考。 */
      if (/Chrome|Chromium|Edg\//.test(ua)) return false;
      /* 原组件在 WebKit / Firefox 上直接不走 SVG 折射：两家的 url() backdrop-filter
         行为不稳，宁可一开始就用 fallback 磨砂。 */
      if (/Safari/.test(ua) && !/Chrome/.test(ua)) return false;
      if (/Firefox/.test(ua)) return false;
      const probe = 'url(#lizi-glass-probe)';
      return CSS.supports('backdrop-filter', probe) ||
        CSS.supports('-webkit-backdrop-filter', probe);
    } catch {
      return false;
    }
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
    }
    return node;
  }

  function displacementMapUrl(state) {
    const r = state.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const o = state.opts;
    const edge = Math.min(w, h) * (o.borderWidth * 0.5);
    const innerW = Math.max(1, w - edge * 2);
    const innerH = Math.max(1, h - edge * 2);
    const body = `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${state.redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${state.blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
          <filter id="${state.softId}" filterUnits="userSpaceOnUse"
            x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB">
            <feGaussianBlur stdDeviation="${o.blur}"/>
          </filter>
        </defs>
        <rect x="0" y="0" width="${w}" height="${h}" fill="black"></rect>
        <rect x="0" y="0" width="${w}" height="${h}" rx="${o.borderRadius}"
          fill="url(#${state.redGradId})"></rect>
        <rect x="0" y="0" width="${w}" height="${h}" rx="${o.borderRadius}"
          fill="url(#${state.blueGradId})" style="mix-blend-mode:${o.mixBlendMode}"></rect>
        <rect x="${edge}" y="${edge}" width="${innerW}" height="${innerH}" rx="${o.borderRadius}"
          fill="hsl(0 0% ${o.brightness}% / ${o.opacity})" filter="url(#${state.softId})"></rect>
      </svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(body);
  }

  function buildFilterSvg(state) {
    const svg = svgEl('svg', { class: 'glass-surface__filter', 'aria-hidden': 'true' });
    const defs = svgEl('defs');
    const filter = svgEl('filter', {
      id: state.filterId,
      x: '0%',
      y: '0%',
      width: '100%',
      height: '100%',
      'color-interpolation-filters': 'sRGB',
    });
    const image = svgEl('feImage', {
      x: 0,
      y: 0,
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'none',
      result: 'map',
    });
    filter.appendChild(image);

    const values = {
      red: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      green: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      blue: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    };
    const channels = [
      { suffix: 'red', matrix: values.red },
      { suffix: 'green', matrix: values.green },
      { suffix: 'blue', matrix: values.blue },
    ];
    const disp = {};
    for (const c of channels) {
      const d = svgEl('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'map',
        id: c.suffix + 'channel',
        result: 'disp' + c.suffix,
        scale: 0,
        xChannelSelector: 'R',
        yChannelSelector: 'G',
      });
      const m = svgEl('feColorMatrix', {
        in: 'disp' + c.suffix,
        type: 'matrix',
        values: c.matrix,
        result: c.suffix,
      });
      filter.appendChild(d);
      filter.appendChild(m);
      disp[c.suffix] = d;
    }
    const blendRG = svgEl('feBlend', { in: 'red', in2: 'green', mode: 'screen', result: 'rg' });
    const blendOut = svgEl('feBlend', { in: 'rg', in2: 'blue', mode: 'screen', result: 'output' });
    const blur = svgEl('feGaussianBlur', { in: 'output', stdDeviation: 0 });
    filter.appendChild(blendRG);
    filter.appendChild(blendOut);
    filter.appendChild(blur);
    defs.appendChild(filter);
    svg.appendChild(defs);
    state.el.insertBefore(svg, state.el.firstChild);

    state.filterSvg = svg;
    state.filter = filter;
    state.feImage = image;
    state.disp = disp;
    state.blurNode = blur;
    updateFilterParams(state);
  }

  function updateFilterParams(state) {
    if (!state.disp) return;
    const o = state.opts;
    state.disp.red.setAttribute('scale', String(o.distortionScale + o.redOffset));
    state.disp.green.setAttribute('scale', String(o.distortionScale + o.greenOffset));
    state.disp.blue.setAttribute('scale', String(o.distortionScale + o.blueOffset));
    for (const k of ['red', 'green', 'blue']) {
      state.disp[k].setAttribute('xChannelSelector', o.xChannel);
      state.disp[k].setAttribute('yChannelSelector', o.yChannel);
    }
    if (state.blurNode) state.blurNode.setAttribute('stdDeviation', String(o.displace));
  }

  function refresh(el) {
    const state = states.get(el);
    if (!state || state.mode !== 'svg') return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === state.mapW && h === state.mapH && state.feImage.getAttribute('href')) return;
    state.mapW = w;
    state.mapH = h;
    state.feImage.setAttribute('href', displacementMapUrl(state));
  }

  function makeObserver(state) {
    if (typeof ResizeObserver === 'function') {
      state.observer = new ResizeObserver(() => refresh(state.el));
      state.observer.observe(state.el);
    } else {
      state.onResize = () => refresh(state.el);
      window.addEventListener('resize', state.onResize);
    }
  }

  function applyFallback(state) {
    state.mode = 'fallback';
    state.el.classList.add('glass-surface--fallback', 'is-glass-fallback');
    state.el.classList.remove('glass-surface--svg', 'is-glass');
    state.el.style.removeProperty('--filter-id');
    state.el.style.setProperty('--glass-frost', String(state.opts.backgroundOpacity));
    state.el.style.setProperty('--glass-saturation', String(state.opts.saturation));
  }

  function attach(el, opts) {
    if (!el) return null;
    let state = states.get(el);
    if (state) {
      if (opts) Object.assign(state.opts, opts);
      updateFilterParams(state);
      /* paintPlatCards() 用 innerHTML 重画会把作为子节点的 filter SVG 一起删掉；
         attach 重新把同一个 SVG 插回第一个子节点，滤镜 id 和引用不变。 */
      if (state.mode === 'svg' && state.filterSvg && state.filterSvg.parentNode !== el) {
        el.insertBefore(state.filterSvg, el.firstChild);
      }
      state.mapW = 0;                  // 参数可能变了：强制下一次重算位移图
      state.mapH = 0;
      refresh(el);
      return state;
    }

    const id = ++uid;
    state = {
      el,
      opts: Object.assign({}, DEFAULT_OPTS, opts || {}),
      filterId: `lizi-glass-filter-${id}`,
      redGradId: `lizi-glass-red-${id}`,
      blueGradId: `lizi-glass-blue-${id}`,
      softId: `lizi-glass-soft-${id}`,
      mapW: 0,
      mapH: 0,
      mode: '',
    };
    states.set(el, state);

    el.classList.add('glass-surface');
    if (supportsSvgBackdrop()) {
      state.mode = 'svg';
      el.classList.remove('glass-surface--fallback', 'is-glass-fallback');
      el.classList.add('is-glass', 'glass-surface--svg');
      buildFilterSvg(state);
      el.style.setProperty('--filter-id', `url(#${state.filterId})`);
      el.style.setProperty('--glass-frost', String(state.opts.backgroundOpacity));
      el.style.setProperty('--glass-saturation', String(state.opts.saturation));
      refresh(el);
    } else {
      applyFallback(state);
    }
    makeObserver(state);
    return state;
  }

  function destroy(el) {
    const state = states.get(el);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.onResize) window.removeEventListener('resize', state.onResize);
    if (state.filterSvg && state.filterSvg.parentNode) state.filterSvg.parentNode.removeChild(state.filterSvg);
    el.classList.remove('glass-surface', 'glass-surface--svg', 'glass-surface--fallback', 'is-glass', 'is-glass-fallback');
    el.style.removeProperty('--filter-id');
    el.style.removeProperty('--glass-frost');
    el.style.removeProperty('--glass-saturation');
    states.delete(el);
  }

  window.LiziGlassSurface = { attach, refresh, destroy };
})();
