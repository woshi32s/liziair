/* ==========================================================================
   LIZI · 窗口动画（最大化 / 还原 / 最小化 / 从托盘回来）
   --------------------------------------------------------------------------
   Windows 上窗口尺寸是系统瞬时改的，没有 macOS 绿色按钮那种 zoom 过渡。
   这里用「窗口已经跳变 + 内容弹性归位」把它补成一段动画：

     最大化   内容从 k<1 放大到 1  → 看起来是从右上角那颗按钮展开的
     还原     内容从 k>1 收回 1    → 看起来是从大窗收缩回小窗
     最小化   内容缩到 0.9 + 淡出，160ms 后才真的 minimize
     托盘唤醒 内容从 0.94 弹出来

   k 不是写死的，是「变化前后的视口宽度比」，所以大屏小屏、拖边改尺寸都自然。
   全部只动 transform / opacity，不碰布局；prefers-reduced-motion 直接跳过。
   ========================================================================== */

window.WIN_ANIM = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lastW = window.innerWidth;
  let timer = 0;
  let wasHidden = false;
  let mounted = false;

  function restart(cls, ms) {
    const b = document.body;
    if (!b) return;
    b.classList.remove('win-zoom', 'win-shrink', 'win-pop');
    void b.offsetWidth;                 // 强制重排，动画才能重播
    b.classList.add(cls);
    clearTimeout(timer);
    timer = setTimeout(() => b.classList.remove(cls), ms);
  }

  /* 窗口尺寸变了：只有「进/出最大化」才播，拖边改尺寸不能播（否则每个像素都在抖）。
     判据：宽度是否贴齐屏幕工作区宽度 —— 最大化必然是 availWidth，手拖几乎不可能正好撞上。 */
  function onResize() {
    const w = window.innerWidth;
    if (w === lastW) return;
    const avail = (window.screen && screen.availWidth) || 0;
    const nowMax = avail > 0 && Math.abs(w - avail) <= 2;
    const wasMax = avail > 0 && Math.abs(lastW - avail) <= 2;
    if (nowMax !== wasMax && !reduced.matches) {
      const k = Math.min(1.55, Math.max(0.66, lastW / w));
      document.body.style.setProperty('--win-k', k.toFixed(3));
      restart('win-zoom', 300);
    }
    lastW = w;
  }

  /** 最小化：先让内容缩出去，再真的最小化（不然窗口先消失，动画看不到） */
  function minimize(doIt) {
    if (reduced.matches || !document.body) { doIt(); return; }
    restart('win-shrink', 300);
    setTimeout(() => doIt(), 160);
  }

  /** 从托盘 / 任务栏回来时弹一下 */
  function popIn() {
    if (reduced.matches || !document.body) return;
    restart('win-pop', 320);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    lastW = window.innerWidth;
    window.addEventListener('resize', onResize, { passive: true });
    if (window.__desktop && typeof window.__desktop.onWinState === 'function') {
      window.__desktop.onWinState((s) => {
        const visible = !!(s && s.visible);
        if (visible && wasHidden) popIn();
        wasHidden = !visible;
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  return { minimize, popIn };
})();
