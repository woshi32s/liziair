/* ==========================================================================
   LIZI · 桌面版开屏：纯白底 + 居中字标，淡入 / 停留 / 淡出
   --------------------------------------------------------------------------
   2026-11-10：用户否掉了粒子聚字那版，要最朴素的做法 ——
   「预览页闪一个 logo，纯白背景，中间是个 logo，做一个渐变的就行」。
   所以这里没有 canvas、没有粒子、没有飞行，只有一层白底和一枚 SVG 字标。

   只在桌面壳里跑（window.__desktop.isDesktop）。浏览器 / 安卓 WebView 里
   第一行就 return —— 不建 DOM、不挂监听，零开销。

   时间轴（毫秒）：
     0    白底 + 字标（opacity 0）同步淡入 160ms
     160  停留 560ms
     720  整层淡出 300ms
     1020 remove()
   任意点击 / 触摸 / 按键：立刻跳到淡出（300ms 后 remove）。

   字标几何直接取自 public/index.html 的 .brand__mark 四个 polygon，
   不是近似画的；颜色跟主界面正文一致（近黑）。
   ========================================================================== */
(function () {
  'use strict';

  var desktop = window.__desktop;
  if (!desktop || !desktop.isDesktop) return;

  /* 脚本被重复引入时只跑一次 */
  if (window.__liziSplash) return;

  var reduced = false;
  try {
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* 老环境没有 matchMedia：按不减弱处理 */ }

  var FADE_IN = 160;
  var HOLD = 560;
  var FADE_OUT = 300;

  var style = document.createElement('style');
  style.id = 'lizi-splash-style';
  style.textContent = [
    '#lizi-splash{position:fixed;inset:0;z-index:899;display:grid;place-items:center;',
    'background:#fff;opacity:0;transition:opacity ' + FADE_IN + 'ms cubic-bezier(.22,.61,.36,1);',
    'pointer-events:auto;user-select:none;-webkit-user-select:none;',
    '-webkit-tap-highlight-color:transparent;contain:strict}',
    '#lizi-splash.is-out{opacity:0!important;transition:opacity ' + FADE_OUT + 'ms ease-out}',
    '#lizi-splash svg{width:92px;height:92px;display:block;fill:#0b0b0f;',
    'transform:scale(.97);transition:transform ' + FADE_IN + 'ms cubic-bezier(.22,.61,.36,1)}',
    '#lizi-splash.is-in svg{transform:scale(1)}',
    '@media (prefers-reduced-motion: reduce){#lizi-splash,#lizi-splash svg{transition:none}}',
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  var layer = document.createElement('div');
  layer.id = 'lizi-splash';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<svg viewBox="328 329 368 366" aria-hidden="true">'
    + '<polygon points="328.94,329.76 396.71,329.76 396.71,569.57 458.02,519.41 458.02,545.48 328.94,649.91"/>'
    + '<polygon points="328.94,672.81 396.71,617.97 396.71,630.67 554.47,630.67 587.80,694.32 328.94,694.32"/>'
    + '<polygon points="627.86,329.76 695.15,329.76 695.15,372.74 627.86,428.80"/>'
    + '<polygon points="490.18,566.83 695.15,395.57 695.15,694.32 627.86,694.32 627.86,479.80 490.18,595.37"/>'
    + '</svg>';

  var timers = [];
  var done = false;

  function cleanup() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers.length = 0;
    window.removeEventListener('pointerdown', skip, true);
    window.removeEventListener('touchstart', skip, true);
    window.removeEventListener('keydown', skip, true);
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    if (style.parentNode) style.parentNode.removeChild(style);
    window.__liziSplash = null;
  }

  function fadeOut() {
    if (done) return;
    done = true;
    layer.classList.add('is-out');
    timers.push(setTimeout(cleanup, FADE_OUT + 20));
  }

  function skip() {
    if (done) return;
    fadeOut();
  }

  /* 透明窗口里白底要真盖上：先插入再下一帧加类，transition 才会跑 */
  function start() {
    (document.body || document.documentElement).appendChild(layer);
    /* 强制一次样式计算，确保首帧 opacity:0 被应用 */
    void layer.offsetWidth;
    layer.classList.add('is-in');
    layer.style.opacity = '1';

    if (reduced) {
      /* 减弱动态：不做淡入，短暂停留后直接移除 */
      timers.push(setTimeout(fadeOut, 420));
    } else {
      timers.push(setTimeout(fadeOut, FADE_IN + HOLD));
    }

    window.addEventListener('pointerdown', skip, true);
    window.addEventListener('touchstart', skip, true);
    window.addEventListener('keydown', skip, true);
  }

  window.__liziSplash = { skip: skip };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
