/**
 * Liquid Glass —— 折射型「液态玻璃」表面（纯净重实现）
 *
 * 复刻自 open-design.ai 导航栏的实现（其源头为 Inspira UI LiquidGlass.vue）。
 * 原理：
 *   1) 运行时按元素实际像素尺寸生成一张「位移贴图」(displacement map)：
 *        黑底 + 红色横向渐变(圆角矩形内) + 蓝色纵向渐变(mix-blend-mode: difference)
 *        + 内缩一圈的模糊灰矩形（让内部中性、只有边缘发生折射）
 *   2) 把贴图塞进 <feImage>，用三个 feDisplacementMap 分别按 R/G/B 三通道做位移，
 *      三档 scale 略有差异（-50 / -47 / -44）→ 边缘出现色散（chromatic aberration）。
 *   3) 三通道用 feColorMatrix 拆开、feBlend(screen) 合并、feGaussianBlur 收边，
 *      最后整条 filter 交给 backdrop-filter: url(#id) 作用在「背景」上。
 *
 * 为什么必须以「像素尺寸」重建贴图：贴图坐标就是元素坐标，尺寸一变（比如导航栏
 * 滚动后收缩），折射边缘就会跑位。重建有成本（会重新光栅化滤镜），所以用
 * ResizeObserver + 140ms 防抖，只在尺寸稳定后重建一次。
 *
 * 用法：
 *   <div class="lg-surface" data-liquid-glass="{&quot;chromatic&quot;:[-60,-56,-52]}">…</div>
 *   或 JS：const s = LiquidGlass.mount(el, { chromatic: [-50,-47,-44] });
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  var DEFAULTS = {
    chromatic: [-50, -47, -44], // R / G / B 三通道位移强度，差值越大色散越明显
    border: 0.07,               // 边缘折射带宽度（相对 min(w,h)），inset = min(w,h) * border / 2
    lightness: 50,              // 贴图内部灰的亮度，50% 即中性（位移为 0）
    alpha: 0.93,                // 贴图内部灰的透明度
    mapBlur: 11,                // 贴图内部矩形自身的模糊，控制边缘过渡的柔和度
    blend: 'difference',        // 红/蓝渐变层的混合模式
    smooth: 0.7,                // 整条滤镜最后的 feGaussianBlur stdDeviation
    radius: null,               // 圆角：null = 胶囊（min(w,h)/2），数字 = 固定半径
    surfaceBlur: 7,             // backdrop-filter 里叠在高斯模糊（玻璃的「厚度」）
    saturation: 1.4,            // 饱和度提升
    rebuildDelay: 140,          // 贴图重建防抖
    bare: false,                // true = 不加 .lg-surface 类（表面样式自己写，例如导航栏）
    autoScale: false,           // true = 位移量随元素尺寸等比缩放（小元素上更自然）
    scaleRef: 54,               // autoScale 的参考尺寸：等于导航栏那种「薄条」时保持原值
    refraction: true            // false = 只保留高斯模糊（省电模式 / 不想让背景被弯折时）
  };

  var chrome = {
    defs: null,
    seq: 0
  };

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /**
   * 位移量是否随元素尺寸缩放。
   * 原站把 ±50px 的位移用在 1440×54 的长条上，比例上非常克制；
   * 同样数值搬到 320×120 的卡片上就会「糊成一团」。autoScale 打开后按
   * min(w,h)/scaleRef 等比缩放，让小尺寸表面也有同样的观感。
   */
  function effectiveChromatic(o, w, h) {
    if (!o.autoScale) return o.chromatic.slice();
    var f = clamp(Math.min(w, h) / (o.scaleRef || 54), 0.18, 2.5);
    return o.chromatic.map(function (v) { return Math.round(v * f * 100) / 100; });
  }

  function sameScales(a, b) {
    return !!a && !!b && a.length === b.length && a.every(function (v, i) { return v === b[i]; });
  }

  function ensureDefs() {
    if (chrome.defs && chrome.defs.isConnected) return chrome.defs;
    var defs = document.querySelector('svg.lg-defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'svg');
      defs.setAttribute('class', 'lg-defs');
      defs.setAttribute('aria-hidden', 'true');
      defs.setAttribute('focusable', 'false');
      defs.setAttribute('width', '0');
      defs.setAttribute('height', '0');
      document.body.appendChild(defs);
    }
    chrome.defs = defs;
    return defs;
  }

  /* ------------------------------------------------------------------ *
   * 位移贴图：一张 SVG，RGB 两个通道分别编码横向 / 纵向位移量
   * ------------------------------------------------------------------ */
  function buildMap(w, h, o) {
    var radius = o.radius == null ? Math.round(Math.min(w, h) / 2) : Math.round(o.radius);
    var inset = Math.min(w, h) * (o.border * 0.5);
    var innerW = Math.max(1, w - inset * 2);
    var innerH = Math.max(1, h - inset * 2);

    // 注意：渐变的 stop 必须是不透明黑(#000)而不是透明(#0000)。
    // 透明→红的插值按直通 alpha 计算，叠在黑底上 R 通道会变成 255*t^2（二次曲线），
    // 中性点(0.5)会跑到 ~29% 而不是 50%，折射就整体偏到一侧。
    var svg =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<linearGradient id="lg-red" x1="100%" y1="0%" x2="0%" y2="0%">' +
            '<stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="red"/>' +
          '</linearGradient>' +
          '<linearGradient id="lg-blue" x1="0%" y1="0%" x2="0%" y2="100%">' +
            '<stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="blue"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="black"/>' +
        '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + radius + '" fill="url(#lg-red)"/>' +
        '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + radius + '" fill="url(#lg-blue)" style="mix-blend-mode:' + o.blend + '"/>' +
        '<rect x="' + inset + '" y="' + inset + '" width="' + innerW + '" height="' + innerH + '" rx="' + radius +
          '" fill="hsl(0 0% ' + o.lightness + '% / ' + o.alpha + ')" style="filter:blur(' + o.mapBlur + 'px)"/>' +
      '</svg>';

    return {
      uri: 'data:image/svg+xml,' + encodeURIComponent(svg),
      svg: svg,
      size: { w: w, h: h, radius: radius, inset: inset }
    };
  }

  /* ------------------------------------------------------------------ *
   * 滤镜链：feImage(map) → 3× feDisplacementMap(R/B 通道) → 通道拆分 → screen 混合 → 收边
   * ------------------------------------------------------------------ */
  function buildFilter(id, o) {
    var r = o.chromatic[0], g = o.chromatic[1], b = o.chromatic[2];
    var markup =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<filter id="' + id + '" color-interpolation-filters="sRGB">' +
            '<feImage x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" data-lg-map="true"/>' +
            '<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" scale="' + r + '" result="dispRed"/>' +
            '<feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red"/>' +
            '<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" scale="' + g + '" result="dispGreen"/>' +
            '<feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green"/>' +
            '<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" scale="' + b + '" result="dispBlue"/>' +
            '<feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue"/>' +
            '<feBlend in="red" in2="green" mode="screen" result="rg"/>' +
            '<feBlend in="rg" in2="blue" mode="screen" result="output"/>' +
            '<feGaussianBlur in="output" stdDeviation="' + o.smooth + '"/>' +
          '</filter>' +
        '</defs>' +
      '</svg>';
    // 用 HTML 解析器吃这段字符串，<svg> 下的子节点才会落在 SVG 命名空间里
    var holder = document.createElement('div');
    holder.innerHTML = markup;
    return holder.querySelector('filter');
  }

  var nextId = (function () {
    var n = 0;
    return function (prefix) { return (prefix || 'liquid-glass') + '-' + (++n); };
  })();

  /* ------------------------------------------------------------------ *
   * GlassSurface：一个玻璃表面
   * ------------------------------------------------------------------ */
  function GlassSurface(el, options) {
    this.el = el;
    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.id = this.opts.filterId || nextId();
    this.timer = 0;
    this.destroyed = false;
    this._onResize = this.schedule.bind(this);
    this._build();
  }

  GlassSurface.prototype._mountFilter = function (scales) {
    var defs = ensureDefs();
    var filter = buildFilter(this.id, { chromatic: scales, smooth: this.opts.smooth });
    var old = this.filter;
    defs.appendChild(filter);
    this.filter = filter;
    this.map = filter.querySelector('[data-lg-map]');
    this._scales = scales.slice();
    this._hasMap = false;
    if (old) old.remove();
    return filter;
  };

  GlassSurface.prototype._build = function () {
    this.defs = ensureDefs();
    this._mountFilter(this.opts.chromatic);

    if (!this.opts.bare) this.el.classList.add('lg-surface');
    if (this.opts.radius != null) this.el.style.setProperty('--lg-radius', this.opts.radius + 'px');
    this.apply();
    this.sync();

    if (global.ResizeObserver) {
      this.ro = new ResizeObserver(this._onResize);
      // 必须显式指定 border-box：默认盯的是 content-box，
      // 而「滚动收缩」这类变化常常只改 padding/边框（border-box 变了、content-box 没变），
      // 那样贴图就不会重建，边缘折射会在收缩后错位。
      this.ro.observe(this.el, { box: 'border-box' });
    }
    global.addEventListener('resize', this._onResize, { passive: true });
  };

  /** 把参数写回 CSS 变量（模糊 / 饱和度 / 是否启用折射 —— 纯声明级，不重建贴图） */
  GlassSurface.prototype.apply = function () {
    var o = this.opts;
    var plain = 'blur(' + o.surfaceBlur + 'px) saturate(' + o.saturation + ')';
    var full = 'url("#' + this.id + '") ' + plain;

    // .lg-surface 用的整条链（把 var 当「整条声明」用，而不是把它拼在中间）：
    // 一旦替换后语法不合法，CSS 会把该声明判为 unset，而不是回退到上一条 —— 必须给合法值。
    this.el.style.setProperty('--lg-backdrop', o.refraction ? full : plain);
    // 导航等自己写 backdrop-filter 的地方用这个变量拼装
    this.el.style.setProperty('--lg-filter', o.refraction ? 'url("#' + this.id + '")' : 'blur(12px)');
    this.el.style.setProperty('--lg-surface-blur', o.surfaceBlur + 'px');
    this.el.style.setProperty('--lg-saturation', String(o.saturation));
  };

  /** 按当前像素尺寸重建贴图（必要时先按新尺寸换算位移量、重建滤镜） */
  GlassSurface.prototype.sync = function () {
    if (this.destroyed) return;
    var rect = this.el.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));

    var scales = effectiveChromatic(this.opts, w, h);
    if (!sameScales(scales, this._scales)) this._mountFilter(scales);

    var map = buildMap(w, h, this.opts);
    this.lastMap = map;
    this.map.setAttribute('href', map.uri);
    this.map.setAttributeNS(XLINK_NS, 'xlink:href', map.uri);
  };

  GlassSurface.prototype.schedule = function () {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.sync(); }, this.opts.rebuildDelay);
  };

  /** 运行时改参数：涉及滤镜/贴图的会重建，其余只改 CSS 变量 */
  GlassSurface.prototype.set = function (patch) {
    var structural = ['chromatic', 'smooth', 'border', 'lightness', 'alpha', 'mapBlur', 'blend', 'radius', 'autoScale', 'scaleRef'];
    var needsFilter = false, needsMap = false;
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      this.opts[k] = patch[k];
      if (k === 'chromatic' || k === 'smooth') needsFilter = true;
      else if (structural.indexOf(k) !== -1) needsMap = true;
    }
    if (needsFilter) {
      var scales = effectiveChromatic(this.opts, this.el.getBoundingClientRect().width, this.el.getBoundingClientRect().height);
      this._mountFilter(scales);
      needsMap = true;
    }
    this.apply();
    if (needsMap) this.sync();
    return this;
  };

  GlassSurface.prototype.destroy = function () {
    this.destroyed = true;
    clearTimeout(this.timer);
    if (this.ro) this.ro.disconnect();
    global.removeEventListener('resize', this._onResize);
    this.filter.remove();
    if (!this.opts.bare) this.el.classList.remove('lg-surface');
    this.el.style.removeProperty('--lg-filter');
  };

  /* ------------------------------------------------------------------ *
   * 公开 API
   * ------------------------------------------------------------------ */
  var LiquidGlass = {
    defaults: DEFAULTS,
    map: buildMap,
    surfaces: [],

    mount: function (el, options) {
      if (typeof el === 'string') el = document.querySelector(el);
      if (!el) return null;
      if (el.__liquidGlass) return el.__liquidGlass;   // 同一个元素只挂一次
      var surface = new GlassSurface(el, options);
      el.__liquidGlass = surface;
      this.surfaces.push(surface);
      return surface;
    },

    /** 元素上的 data-liquid-glass='{"chromatic":[-60,-60,-54]}' 自动挂载 */
    init: function (root) {
      var scope = root || document;
      var nodes = scope.querySelectorAll('[data-liquid-glass]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.__liquidGlass) continue;
        var raw = el.getAttribute('data-liquid-glass') || '';
        var opts = null;
        if (raw.trim()) {
          try { opts = JSON.parse(raw); } catch (e) { console.warn('[liquid-glass] 解析 data 属性失败：', raw, e); }
        }
        el.__liquidGlass = this.mount(el, opts);
      }
      return this;
    },

    refresh: function () { this.surfaces.forEach(function (s) { s.sync(); }); }
  };

  global.LiquidGlass = LiquidGlass;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { LiquidGlass.init(); });
  } else {
    LiquidGlass.init();
  }
})(window);
