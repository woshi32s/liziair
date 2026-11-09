/**
 * 大厅「每日推荐」· 捏住卡片 → 整组展开成大环（2026-11-07）
 * 运动手感照 ReactBits CircularCarousel（cylinder 预设）：
 *   https://www.reactbits.dev/components/circular-carousel
 *
 * 原组件的关键数学（源码 src/content/Components/CircularCarousel/CircularCarousel.jsx）：
 *   step      = 360 / count
 *   radius    = 圆柱面弦长/弧长插值，cylinder 预设下 ≈ count*(cardW+gap)/(2π)
 *   perspective = 2500（cylinder）
 *   camera    = translateZ(-R) rotateX(tilt) rotateY(yaw)
 *   ring      = rotateY(angle)
 *   card      = rotateY(i*step) translateZ(R)
 *   拖动      = 每像素 180/(π*R) × 1.45 度；采样最近 110ms 求角速度，松手限幅 ±1400°/s
 *   2026-11-09：开环不再同步补满跑马带（hover / 按下时逐帧预填），入场动画
 *              开环即完成（不在手指底下外扩），松手加方向滞后，HOLD 拉到 1s
 *   惯性      = τ = 0.18 + momentum*1.5（默认 momentum .6 → 1.08s）
 *   吸附      = target = 离 (angle + v*τ*0.55) 最近的真实槽位居中角
 *   弹簧      = SPRING 118，阻尼 2*sqrt(118)
 *   点击命中  = 拖过阈值后置 suppressClick，下一次 click 只吞掉不选歌
 *
 * 松手只认 s.angle（也就是 render 每帧读的那个变量）：
 *   惯性目标 = 从「松手瞬间的 s.angle」加 v*τ*0.55 的行程，再取真实 slot 里
 *   离它最近的那张卡的居中角；绝不使用 p.startAngle / 固定的 0° / 初始 anchor。
 *   收起时把当时正前方的卡片 key（i/coll/malb）记到 lastFrontKey，下次重建/重开从这张卡开始排，
 *   所以不会又回到最初按下的 A。
 *
 * 本文件把它接到跑马带上，并按用户要求只保留「正前方一段」：
 *   卡片尺寸固定（宽屏 236、窄屏 156），不随屏幕宽度或圈上张数变化。
 *   宽屏按「两侧卡不越视口边缘」反解满圈半径：world≈±90° 时投影到屏幕
 *   中心约 0.762R（P≈3.2R），所以 Rview = (vw/2 - 18 - CARD_W/2) / 0.762。
 *   窄屏沿用 0.82vw。
 *   环容量 cap = clamp(round(2πRview/pitch), 7, 64)，槽数 n = min(卡数, cap)。
 *   步长：n<8 时封顶 36°，避免 3–7 张按 360/n 排到背面（3 张时 120° 一步，
 *   静止只看得到正前方一张）；n>=8 仍是 360/n 均分整圈。
 *   半径：卡少/未满容量时用弦长反推 R = pitch / (2·sin(step/2))，让相邻
 *   卡间距≈pitch，而不是把仅有的几张按大角度稀疏摊在整圈上；满圈仍用
 *   RView。半径下限 CARD_W*0.8，兜住 1–2 张时卡片在 3D 里互相穿插。
 *   透视 P ≈ 3.2R，夹在 [1500, 3600]；R 变小时 P 相对变大，侧卡不会被拉糊。
 *   只露前面的卡：facing≤0.06 完全藏掉，0.06–0.30 用 smoothstep 淡出，
 *   ≥0.30 完全不透明；不会再露出后面的半张卡。
 *   克隆卡面的 loading="lazy" 会改 eager，避免 3D 远端图永不加载。
 *
 * 槽位虚拟化（2026-11 修复「大歌单拖不到最后一张」）：
 *   环上永远只有 n 个槽，每个槽显示哪张卡不是固定的：内容 = 正前方那张卡
 *   在 unique 里的下标 + 该槽相对正前方的偏移。可见的那一段在歌单里始终
 *   连续；槽位转到环背面（|world|≈180°、肉眼不可见）时才换上新滚入的那张。
 *   所以 200 首的歌单也能一路拖到最后，而 DOM 槽位数仍然只有 n 个。
 *   换卡时必须重新补 .hcc__card、dataset.key 并调用 prepareCloneImages()，
 *   点击命中 / frontKey / 收起对齐都靠这些读取。
 *
 * 交互边界：
 *   · 只有按在 .marq__card 上、移动超过 8px 才接管；小于阈值原样放行 click。
 *   · 接管后 pointer 监听在 capture 阶段 stopImmediatePropagation + preventDefault，
 *     跑马带自己的拖动完全收不到 move（按下时也已经拦掉它的 pointerdown）。
 *   · 覆盖层是 position:fixed，脱离跑马带的 overflow:hidden；卡片只克隆一次。
 *   · 收起动画一起步就调用 app.js 的 window.__liziMarqueeSeek，把环最后正前方
 *     那张卡对齐到跑马带的同一屏幕 x；入口在跑马带自己的 rAF 里用 easeOutCubic
 *     缓动 marqX（无缝复制份取最近、再取模），和覆盖层淡出重叠，结束后按原速度
 *     继续自动滚动。用户重新移入/拖动跑马带或再次展开环时调用
 *     window.__liziMarqueeSeekCancel 立刻交还交互。
 */
(() => {
  'use strict';

  if (window.__liziHallRing) return;
  window.__liziHallRing = true;

  const SCRIPT = document.currentScript;
  const CSS_HREF = (() => {
    try {
      return SCRIPT && SCRIPT.src
        ? new URL('circular-carousel.css', SCRIPT.src).href
        : 'hall/circular-carousel.css';
    } catch {
      return 'hall/circular-carousel.css';
    }
  })();

  const MARQ_SEL = '#hall-marq';
  const DRAG_THRESHOLD = 8;        // 跑马带上：超过 8px 才展开
  const OVERLAY_THRESHOLD = 5;     // 环里再拖：5px（和原组件一致）
  /* 2026-11-09：600 → 1000。用户反馈「刚松手环就收回，像被拽回去」；
     留久一点，看清楚停在哪张，再自己决定点选还是等它收。 */
  const HOLD_MS = 1000;            // 松手后环保持多久再收回
  const ENTER_MS = 560;            // 半径从 0.42R 展开到 R（只在非拖动路径使用）
  /* 拖动灵敏度：物理弧长 180/(πR) 是 1:1 跟手的，但 R≈780 时一张卡要拖
     约 270px，手指会觉得「拖了它没怎么动」。乘 1.45 后约 186px 一张，
     快而不飘；吸附仍按真实槽位算，不会错位。 */
  const DRAG_GAIN = 1.45;
  const CLOSE_MS = 430;            // 自动收回
  const QUICK_CLOSE_MS = 220;      // Esc / 点空白
  const MOMENTUM = 0.6;            // ReactBits cylinder 默认 momentum
  const TAU = 0.18 + MOMENTUM * 1.5; // 1.08s
  const SPRING = 118;              // ReactBits 弹簧刚度
  const MAX_V = 1400;              // 松手角速度上限（°/s）
  const SAMPLE_MS = 110;           // 角速度采样窗口
  const TO_RAD = Math.PI / 180;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const modIndex = (v, m) => ((v % m) + m) % m;
  const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  const easeInCubic = (t) => t * t * t;
  const now = () => performance.now();

  let active = null;               // 当前展开的环（null = 没展开，零 rAF）
  let press = null;                // 当前这一次按下/拖动
  let marq = null;
  let reduceMotion = false;
  let cssDone = false;
  let blockMarqLeave = false;      // 展开期间挡住 app.js 的 pointerleave，保持暂停
  let docSuppressClick = false;
  let docSuppressTimer = 0;
  let marqObserver = null;         // 模块级持有，避免被回收后不再观察
  let lastFrontKey = null;         // 上次收起时正前方的卡片 key（i/coll/malb）；重开时用它做 anchor
  const lastPointer = { x: 0, y: 0, type: 'mouse', has: false };

  /* ---------------- 样式注入 / 减少动态 ---------------- */
  function ensureCss() {
    if (cssDone) return;
    cssDone = true;
    if (document.querySelector('link[data-hcc-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    link.setAttribute('data-hcc-css', '');
    document.head.appendChild(link);
  }

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const readReduce = () => { reduceMotion = !!(mq && mq.matches); };
  readReduce();
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', readReduce);
    else if (mq.addListener) mq.addListener(readReduce);
  }

  function getMarq() {
    if (!marq || !marq.isConnected) marq = document.querySelector(MARQ_SEL);
    return marq;
  }

  function trackPointer(e) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    lastPointer.type = e.pointerType || 'mouse';
    lastPointer.has = true;
  }

  /* ---------------- 跑马带的暂停 / 恢复（不碰 app.js，只派发它自己监听的指针事件） ---------------- */
  function pauseMarquee(root) {
    if (!root) return;
    blockMarqLeave = true;
    try { root.dispatchEvent(new Event('pointerenter')); } catch { /* 老浏览器忽略 */ }
  }

  function resumeMarquee(root) {
    blockMarqLeave = false;
    if (!root) return;
    try { root.dispatchEvent(new Event('pointerleave')); } catch { /* 老浏览器忽略 */ }
  }

  /* 卡片 key：曲目 data-i / 歌单 data-coll / 专辑 data-malb，统一成
     "i:5" / "coll:3" / "malb:2"；「更多 / 我的专辑」这类入口卡没有 key，返回 null。 */
  function cardKey(el) {
    if (!el || !el.dataset) return null;
    const ds = el.dataset;
    if (ds.i != null) return `i:${ds.i}`;
    if (ds.coll != null) return `coll:${ds.coll}`;
    if (ds.malb != null) return `malb:${ds.malb}`;
    return null;
  }

  /* ---------------- 取卡片：按卡片 key 去重（DOM 里有无缝循环复制的那一份） ---------------- */
  function uniqueCards(root, kind) {
    const seen = new Set();
    const out = [];
    root.querySelectorAll('.marq__card').forEach((el) => {
      const key = cardKey(el);
      if (!key) return;
      if (kind && key.slice(0, key.indexOf(':')) !== kind) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(el);
    });
    /* 冒号后的数字就是全量数组下标，按它升序。 */
    out.sort((a, b) => Number(cardKey(a).split(':')[1]) - Number(cardKey(b).split(':')[1]));
    return out;
  }

  /* 不再按视口裁卡：跑马带里当前已经渲染出来的、同一 kind（i/coll/malb）的
     唯一卡按顺序取用。一圈槽位数 n 由环容量决定（≤ unique.length）；
     超出的卡通过「槽位虚拟化」在转到背面时轮换进来。
     （旧的窄屏 MIN_SLOT_ARC=280 已删：当时半径只由视口决定、需要靠放大弧长
       保住间距；现在半径会随容量反解，弧长恒为 pitch 就够，156px 卡仍留 14% 余量。） */

  /* 克隆会把原卡 <img loading="lazy"> 原样带过来。覆盖层里的卡会被 3D 变换到
     环的侧面/背面，浏览器可能一直判定它“不在视口”，转到正面就是空白。
     克隆体是独立节点，这里改 eager 不会影响跑马带上的原卡。 */
  function prepareCloneImages(card) {
    const arts = card.querySelectorAll('.marq__art');
    arts.forEach((art) => {
      if (!art.querySelector('img')) art.classList.add('hcc__art--empty');
    });
    card.querySelectorAll('img').forEach((img) => {
      /* 去掉 lazy：默认就是 eager，decode() 会立刻开始解码/取图 */
      img.removeAttribute('loading');
      try { img.loading = 'eager'; } catch { /* 旧浏览器忽略 */ }
      img.setAttribute('decoding', 'async');

      const art = img.closest('.marq__art');
      const setState = (ok) => {
        if (art) art.classList.toggle('hcc__art--empty', !ok);
        img.classList.toggle('hcc__img--fail', !ok);
      };
      img.addEventListener('load', () => setState(true));
      img.addEventListener('error', () => setState(false));
      if (img.complete) {
        if (img.naturalWidth > 0) setState(true);
        else if (img.src) setState(false);
      }
      if (typeof img.decode === 'function') {
        img.decode().then(() => setState(true), () => setState(false));
      }
    });
  }

  function findOriginal(key) {
    const root = getMarq();
    if (!root || key == null) return null;
    const str = String(key);
    const cut = str.indexOf(':');
    const kind = cut >= 0 ? str.slice(0, cut) : 'i';
    const val = cut >= 0 ? str.slice(cut + 1) : str;
    const attr = kind === 'i' ? 'data-i' : kind === 'coll' ? 'data-coll' : kind === 'malb' ? 'data-malb' : null;
    if (!attr) return null;
    const all = root.querySelectorAll(`.marq__card[${attr}="${val}"]`);
    if (!all.length) return null;
    /* 优先拿跑马带可视区里的那一张：原组件的封面飞入动画要用它的位置 */
    const box = root.getBoundingClientRect();
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right > box.left && r.left < box.right) return el;
    }
    return all[0];
  }

  /* ---------------- 跑马带分批预填（2026-11-09） ----------------
     开环首帧不再一次补满：指针进入 / 按下跑马带时每帧补一批（app.js 的
     marqAppendBatch，30 张），环开着时也继续补。每补一批就把新卡并进
     active.unique，槽位虚拟化会在背面槽位自动换上新卡 —— 用户从第一下
     拖动起就是 60fps，大歌单也仍然能一路拖到最后一张。 */
  let fillRaf = 0;
  function fillState() {
    return (typeof window.__liziMarqueeFillState === 'function')
      ? window.__liziMarqueeFillState() : null;
  }
  function appendRingCards() {
    const s = active;
    if (!s || s.closing) return;
    const all = uniqueCards(getMarq(), s.kind);
    if (all.length > s.unique.length) {
      s.unique = all;          // 下标稳定（按 data-i/coll/malb 升序），只追加尾部
      s.len = all.length;
    }
  }
  function pumpMarqueeFill() {
    if (fillRaf) return;
    const step = window.__liziMarqueeFillStep;
    if (typeof step !== 'function') return;
    const st0 = fillState();
    if (!st0 || st0.shown >= st0.total) return;
    fillRaf = requestAnimationFrame(() => {
      fillRaf = 0;
      if (!getMarq()) return;
      const prev = fillState();
      if (!prev || prev.shown >= prev.total) return;
      step();
      appendRingCards();
      const next = fillState();
      if (next && next.shown > prev.shown && next.shown < next.total) pumpMarqueeFill();
    });
  }

  /* ---------------- 展开大环 ---------------- */
  function openRing(pressedCard) {
    const root = getMarq();
    if (!root) return false;
    /* 只把和按下卡同类的卡放进环（i / coll / malb）：歌单、专辑卡也能展开。 */
    const pressedKey = cardKey(pressedCard);
    const kind = pressedKey ? pressedKey.slice(0, pressedKey.indexOf(':')) : null;
    /* 2026-11-09：不再在拖动首帧同步 __liziMarqueeFillAll（398 首要建 398 张
       DOM，全压在一个 pointermove 里，按下第一下必卡）。改成：
         ① 指针进入 / 按下跑马带时，pumpMarqueeFill() 每帧补一批（30 张）；
         ② 这里只用当前已经渲染的卡开环；
         ③ 环开着时继续后台补，appendRingCards() 把新卡并进 s.unique，
            虚拟化会在背面槽位自动换上新卡，所以大歌单仍然能拖到最后。
       新增卡保持 lazy；只有进环的克隆由 prepareCloneImages() 接管。 */
    const unique = uniqueCards(root, kind);
    if (!unique.length) return false;

    /* 上次收起的对齐缓动可能还在跑（尤其 Esc/点空白 220ms 先收完）：
       展开环就立刻取消，别让底下的跑马带还在自己滑。 */
    if (typeof window.__liziMarqueeSeekCancel === 'function') {
      window.__liziMarqueeSeekCancel();
    }

    /* 重开时优先从「上次收起时正前方」那张开始排，避免又回到最初按下的 A；
       只有第一次打开（lastFrontKey 为空）才从手指下面那张开始。
       slot[0] 始终是 anchor，angle 0 表示 anchor 在正前方。 */
    let start = lastFrontKey != null
      ? unique.findIndex((el) => cardKey(el) === lastFrontKey)
      : -1;
    if (start < 0) start = unique.findIndex((el) => cardKey(el) === pressedKey);
    if (start < 0) start = 0;

    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);

    /* 卡片尺寸固定：宽屏 236、窄屏 156，不随屏幕宽度或圈上张数变化。
       间距 pitch = 卡宽 × 1.14（1460 宽下约 269px，窄屏 156 → 178px）。 */
    const CARD_W = vw >= 760 ? 236 : 156;
    const edgePad = 18;
    const pitch = CARD_W * 1.14;

    /* 视口给的「满圈半径」：宽屏按两侧卡不越视口边缘反解
       （world≈±90° 投影到屏幕中心约 0.762R，P≈3.2R），窄屏沿用 0.82vw。 */
    const RView = vw >= 760
      ? (vw / 2 - edgePad - CARD_W / 2) / 0.762
      : vw * 0.82;

    /* 环容量：满圈半径能排下几张卡；下限 7、上限 64（DOM 槽位数封顶）。
       槽数再取一次 min(卡数, cap)：卡片少时槽位跟着少。 */
    const cap = clamp(Math.round((2 * Math.PI * RView) / pitch), 7, 64);
    const n = Math.min(unique.length, cap);

    /* 步长：n<8 时封顶 36°，别让 3–7 张卡按 360/n 排到背面
       （3 张时 120° 一步，静止只看得见正前方一张）。n>=8 仍均分整圈。 */
    const step = Math.min(360 / n, 36);

    /* 半径：卡片少（n<8，或还没填满容量）时用弦长反推，让相邻卡间距恒为 pitch。
       旧写法 n*pitch/(2π) 是按弧长算的；弦长公式
       R = pitch / (2·sin(step/2)) 在 n=2–7 时约 1.618·pitch，比旧值大，
       但步长封顶后卡片仍落在正前方，不会挤到背面。
       满圈（n=cap 且 n>=8）继续用视口反解的 RView，侧卡不会越出屏幕。
       下限 CARD_W*0.8 保留，兜住 1–2 张时卡片在 3D 里互相穿插。 */
    const chordR = pitch / (2 * Math.sin((step / 2) * TO_RAD));
    const R = Math.max(
      (n < 8 || unique.length < cap) ? chordR : RView,
      CARD_W * 0.8,
    );
    /* 透视 ≈ 3.2R：前方 scale=1，侧方 P/(P+R)≈0.76，后方≈0.61。 */
    const P = clamp(R * 3.2, 1500, 3600);
    /* 卡片宽度固定，不再按弧长比例算；cardH 仍是封面 + 歌名两行 + 间距。 */
    const cardW = CARD_W;
    const cardH = cardW + 40;         // 封面(宽) + 歌名两行 + 间距
    /* 每像素多少度：2πR 对应 360°；再乘 DRAG_GAIN 提灵敏度（见文件顶部）。 */
    const perPixel = (180 / (Math.PI * R)) * DRAG_GAIN;

    /* 环心放在跑马带中心；再往下让一点，保证最上面的卡片不压顶栏。 */
    const rect = root.getBoundingClientRect();
    const topbar = document.getElementById('topbar');
    const topEdge = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
    const cx = clamp(rect.left + rect.width / 2, 0, vw);
    /* 环心就放在跑马带原来的位置（用户要的就是「在它本来待的地方拖」，
       别把整圈搬到屏幕中间）。只做一个防切边的兜底：正前方那排卡的下沿
       离视口底部至少留 32px，快速斜拖时那点上下浮动也不会把卡切掉。
       （-5° 的 tilt 会把正前方的卡往下带 R*sin5°，半径越大带得越多。） */
    const tiltDrop = R * Math.sin(5 * TO_RAD);
    let cy = rect.top + rect.height / 2;
    cy = Math.max(cy, topEdge + cardH * 0.66 + 18);
    cy = Math.min(cy, vh - cardH * 0.5 - 32 - tiltDrop);
    if (cy < topEdge + cardH * 0.5) cy = topEdge + cardH * 0.5;

    const overlay = document.createElement('div');
    overlay.className = 'hcc';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '每日推荐 · 环形浏览');
    overlay.tabIndex = -1;
    overlay.style.color = getComputedStyle(root).color; // 沿用平台墨色
    overlay.style.setProperty('--hcc-cx', cx + 'px');
    overlay.style.setProperty('--hcc-cy', cy + 'px');
    overlay.style.setProperty('--hcc-persp', P + 'px');
    overlay.style.setProperty('--hcc-card-w', cardW + 'px');
    overlay.style.setProperty('--hcc-card-h', cardH + 'px');
    overlay.innerHTML =
      '<div class="hcc__view"><div class="hcc__camera"><div class="hcc__ring"></div></div></div>' +
      '<p class="hcc__hint">拖动旋转 · 点击播放 · Esc 收回</p>';

    const view = overlay.querySelector('.hcc__view');
    const camera = overlay.querySelector('.hcc__camera');
    const ring = overlay.querySelector('.hcc__ring');

    /* 每个槽位先克隆一张卡；封面仍是原卡片里的真实 <img>（同 src 走缓存）。
       克隆后把 lazy 去掉并接管加载失败，环里不会出现空白卡面。
       初始内容以 anchor（start）为「正前方」向两侧铺开：
       slot k = unique[start + signedSlotOffset(k, 0, n)]，这样一打开时
       左右两张就是 anchor 的前一首/后一首，而不是绕到歌单末尾。 */
    const slots = [];
    for (let k = 0; k < n; k++) {
      const idx = modIndex(start + signedSlotOffset(k, 0, n), unique.length);
      const orig = unique[idx];
      const slot = document.createElement('div');
      slot.className = 'hcc__slot';
      const card = orig.cloneNode(true);
      const key = cardKey(orig);
      card.classList.add('hcc__card');
      card.dataset.key = key;
      prepareCloneImages(card);
      const shade = document.createElement('i');
      shade.className = 'hcc__shade';
      shade.setAttribute('aria-hidden', 'true');
      slot.appendChild(card);
      slot.appendChild(shade);
      ring.appendChild(slot);
      slots.push({ el: slot, card, shade, base: k * step, idx, key });
    }

    document.body.appendChild(overlay);

    active = {
      overlay, view, camera, ring, slots,
      n, R, P, step, cardW, cardH, perPixel,
      kind: kind || 'i',           // 后台补卡时按同一类（i/coll/malb）合并
      unique, len: unique.length,   // 虚拟化换卡时从这份原始卡里克隆
      angle: 0, pitch: 0,       // angle 是 render 每帧读的唯一旋转量
      velocity: 0, target: null, // 松手后的惯性 / 吸附目标（目标由 s.angle 算出）
      tilt: -5,                 // 原组件 cylinder 的 tilt
      /* 俯仰角度按半径缩：R 越大，同样的角度在屏幕上位移越大。
         1500/R 让前排卡的上下浮动恒定在 ~26px 左右（随半径变化不再变夸张），
         只留「微微浮动」的手感；快速斜拖也不会把整排卡甩到屏幕下面。 */
      pitchLimit: clamp(1500 / R, 0.9, 2.6),
      depthFade: 0.55,          // 原组件 depthFade 默认值
      /* 2026-11-09：环只由拖动打开，入场动画（0.42R→R）会和手指同时抢
         几何，形成「卡片在指尖下持续外扩」的飘感。直接把入场标成已完成，
         开环即满半径；淡入仍由 CSS 的 .is-open 负责。 */
      introAt: now() - ENTER_MS,
      dragging: false,
      wheelTimer: 0,
      closeTimer: 0,
      closing: false,
      closeAt: 0,
      closeMs: 0,
      after: null,
      selectedKey: null,
      seekKey: null,            // 收起动画启动时就定下的对齐卡（finishClose 只做持久化）
      stale: false,             // 跑马带重绘导致卡片集不可信
      raf: 0,
      last: 0,
      suppressClick: false,
      prevFocus: document.activeElement,
    };

    root.classList.add('is-hcc-faded');
    pauseMarquee(root);
    ensureCss();

    overlay.addEventListener('pointerdown', onOverlayDown);
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('wheel', onWheel, { passive: false });

    requestAnimationFrame(() => {
      if (active && active.overlay === overlay) overlay.classList.add('is-open');
    });
    try { overlay.focus({ preventScroll: true }); } catch { /* 忽略 */ }

    wake();
    /* 环开着时继续在后台补卡（指针已在按下时开始泵，这里只是兜底续上）。 */
    pumpMarqueeFill();
    return true;
  }

  /* 当前/指定角度下，world 最接近 0 的真实槽位。 */
  function frontSlot(s, angle) {
    let best = null;
    let bestAbs = Infinity;
    for (let i = 0; i < s.slots.length; i++) {
      const slot = s.slots[i];
      const w = Math.abs(wrap(slot.base + angle));
      if (w < bestAbs) {
        bestAbs = w;
        best = slot;
      }
    }
    return best;
  }

  /* 让「离 angle 最近的那张卡」精确落在 world=0 的 ring 角度。
     取 -base 的等价角里离 angle 最近的一个，不会为了同一张卡绕整圈。 */
  function cardCenterNear(s, angle) {
    const slot = frontSlot(s, angle);
    if (!slot) return angle;
    let target = -slot.base;
    target += 360 * Math.round((angle - target) / 360);
    return target;
  }

  function frontKey(s) {
    const slot = frontSlot(s, s.angle);
    return slot ? slot.key : null;
  }

  /* 槽位相对「正前方槽位」的有符号偏移（单位 = 槽）。n=7 时依次是
     0, 1, 2, 3, -3, -2, -1：以正前方为 0 向两侧展开，±n/2 附近就是
     虚拟化窗口的接缝，固定落在环背面。 */
  function signedSlotOffset(k, f, n) {
    let off = k - f;
    off = ((off % n) + n) % n;
    if (off > n / 2) off -= n;
    return off;
  }

  /* 槽位虚拟化的换卡动作：只能在槽位不可见（环背面）时调用。
     必须重新补上 .hcc__card / dataset.key，并调用 prepareCloneImages()
     （去 lazy + 加载失败兜底）——点击命中（card.dataset.key）、
     frontKey/frontScreenX、收起时按 key 对齐跑马带，全都读这些。 */
  function replaceSlotCard(s, slot, idx) {
    const orig = s.unique[idx];
    if (!orig) return false;
    const card = orig.cloneNode(true);
    card.classList.add('hcc__card');
    card.dataset.key = cardKey(orig);
    prepareCloneImages(card);
    slot.el.replaceChild(card, slot.card);   // shade 是兄弟节点，保持不动
    slot.card = card;
    slot.idx = idx;
    slot.key = card.dataset.key;
    return true;
  }

  /* 让每个槽位显示「正前方那张卡 + 相对偏移」，也就是一段在歌单里连续的
     窗口。旋转时窗口跟着正前方卡一起滚动：当正前方从槽 f 走到 f+1，
     各槽的期望下标正好 ±1 抵消，只有跨过背面接缝的那一个槽需要换卡；
     换卡时它已经在环背面（|world|≈180°），用户看不到跳变。
     卡片总数 ≤ n 时没有可滚入的新卡，直接跳过。 */
  function syncSlotContent(s) {
    if (s.len <= s.n) return;
    const front = frontSlot(s, s.angle);
    if (!front) return;
    const f = s.slots.indexOf(front);
    const baseIdx = front.idx;
    for (let k = 0; k < s.slots.length; k++) {
      const slot = s.slots[k];
      /* 只在完全转到背面时换内容（正面可见区是 |world|<86.6°）。 */
      if (Math.abs(wrap(slot.base + s.angle)) < 90) continue;
      const want = modIndex(baseIdx + signedSlotOffset(k, f, s.n), s.len);
      if (want === slot.idx) continue;
      replaceSlotCard(s, slot, want);
    }
  }

  /* 收起前取「world=0 那张卡」的屏幕中心 x，作为跑马带对齐目标。
     拿不到就返回 null，由 app.js 的入口退回跑马带视口中心。 */
  function frontScreenX(s) {
    const slot = frontSlot(s, s.angle);
    if (!slot || !slot.card) return null;
    const r = slot.card.getBoundingClientRect();
    if (!r || !r.width) return null;
    return r.left + r.width / 2;
  }

  /* ---------------- 逐帧：展开 / 惯性 / 吸附 / 收回 ---------------- */
  function render(t) {
    const s = active;
    if (!s) return;

    const entryRaw = clamp((t - s.introAt) / ENTER_MS, 0, 1);
    /* 拖动期间半径不允许再变：入场和手指抢几何就是「发飘」的来源。 */
    const entry = s.dragging ? 1 : easeOutQuint(entryRaw);
    let closeT = 0;
    if (s.closing) {
      closeT = clamp((t - s.closeAt) / Math.max(1, s.closeMs), 0, 1);
      s.overlay.style.opacity = String(1 - easeInCubic(closeT));
    }

    /* 展开：半径从 0.42R 长到 R；收回：缩到 0.34R。
       camera 再乘一个 0.74→1 / 1→0.45 的 scale，正面那张卡也会跟着长大/缩回，
       而不是只有两侧在动（半径变化对正前方的卡是看不出来的）。
       注意：这里**不**再加展开时的装饰旋转 —— 那等于给 ring 叠一个最多 9° 的
       视觉 yaw，松手瞬间"最靠近中心的卡"会和按 s.angle 算出的槽位差半格。 */
    const R = s.R * (0.42 + 0.58 * entry) * (1 - 0.66 * easeInCubic(closeT));
    const camScale = (0.74 + 0.26 * entry) * (1 - 0.55 * easeInCubic(closeT));
    const angle = s.angle;

    /* 背面换卡对用户不可见，不必每帧扫一遍：第 1 帧对齐一次，之后每 6 帧
       （60fps 约 100ms）检查一次即可。 */
    s.frameNo = (s.frameNo || 0) + 1;
    /* 松手吸附期间少扫一点（每 10 帧一次）：换卡本来就发生在背面，
       用户看不见；把帧预算留给弹簧和 3D 合成，减轻松手后的顿挫。 */
    const syncStride = s.target !== null ? 10 : 6;
    if (s.frameNo % syncStride === 1) syncSlotContent(s);

    /* 逐帧样式写入先去重：值没变就不碰 style，减少样式重算 / 合成提交。 */
    const camTf =
      `translate3d(0,0,${(-R).toFixed(2)}px) scale(${camScale.toFixed(3)}) ` +
      `rotateX(${(s.tilt + s.pitch).toFixed(2)}deg)`;
    if (camTf !== s.camTf) {
      s.camera.style.transform = camTf;
      s.camTf = camTf;
    }
    const ringTf = `rotateY(${angle.toFixed(3)}deg)`;
    if (ringTf !== s.ringTf) {
      s.ring.style.transform = ringTf;
      s.ringTf = ringTf;
    }

    for (let i = 0; i < s.slots.length; i++) {
      const slot = s.slots[i];
      const tf = `rotateY(${slot.base}deg) translateZ(${R.toFixed(2)}px)`;
      if (tf !== slot.tf) {
        slot.el.style.transform = tf;
        slot.tf = tf;
      }

      /* 卡片正对镜头时 world≈0；越往侧面 cos 越小。
         用户只要看见正前方那一段：facing≤0.06 整张藏掉；0.06–0.30 用
         smoothstep 淡出，±85° 附近自然消失，不会在边缘突然冒出半张卡；
         ≥0.30 完全不透明。正面剩下的卡仍按 depthFade 轻微压暗。 */
      const world = wrap(slot.base + angle);
      const facing = Math.cos(world * TO_RAD);
      const hidden = facing <= 0.06;
      const vis = hidden ? 'hidden' : '';
      if (vis !== slot.vis) {
        slot.el.style.visibility = vis;
        slot.vis = vis;
      }
      /* will-change 只跟着可见性走：背面槽位立即摘掉合成层。 */
      const wantWC = !hidden;
      if (wantWC !== slot.wc) {
        slot.el.style.willChange = wantWC ? 'transform' : '';
        slot.wc = wantWC;
      }
      let op = '1';
      if (hidden) op = '0';
      else if (facing < 0.30) {
        const t = clamp((facing - 0.06) / 0.24, 0, 1);
        op = (t * t * (3 - 2 * t)).toFixed(3);
      }
      if (op !== slot.op) {
        slot.el.style.opacity = op;
        slot.op = op;
      }
      if (!hidden) {
        const shadeOp = (s.depthFade * Math.pow((1 - facing) / 2, 1.25)).toFixed(3);
        if (shadeOp !== slot.shadeOp) {
          slot.shade.style.opacity = shadeOp;
          slot.shadeOp = shadeOp;
        }
      }
    }
  }

  /* 松手后的角度只由这里的弹簧改，而且只在 target != null 时改。
     target 在 releaseRing() 里由「松手瞬间的 s.angle + 惯性行程」算到真实槽位，
     不使用 0 / p.startAngle / 初始 anchor。 */
  function advance(dt) {
    const s = active;
    if (!s || s.closing || s.dragging) return;

    if (s.target !== null) {
      const target = s.target;
      const prev = s.angle;
      /* 原组件的半隐式弹簧积分：SPRING=118，阻尼=2√SPRING，步长 1/240s。 */
      const damping = 2 * Math.sqrt(SPRING);
      let remaining = dt;
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 240);
        const accel = SPRING * (target - s.angle) - damping * s.velocity;
        s.velocity += accel * h;
        s.angle += s.velocity * h;
        remaining -= h;
      }
      /* 越位截断：不让弹簧冲过目标，最终 angle === target。 */
      if ((prev - target) * (s.angle - target) <= 0 ||
          (Math.abs(target - s.angle) < 0.004 && Math.abs(s.velocity) < 0.03)) {
        s.angle = target;
        s.velocity = 0;
        s.target = null;
      }
    }

    /* 纵向俯仰只做非角度回正，不参与横向惯性，也不改变正前方卡的身份。 */
    s.pitch += (0 - s.pitch) * (1 - Math.exp(-dt / 0.30));
  }

  function busy(t) {
    const s = active;
    if (!s) return false;
    if (s.closing) return true;
    if (t - s.introAt < ENTER_MS + 30) return true;
    /* 拖动本身不再常驻 rAF：每次 pointermove 都会 wake() 一帧，
       手指按住不动时就让循环停掉，别空转重排。 */
    if (s.target !== null) return true;
    if (Math.abs(s.pitch) > 0.02) return true;
    return false;
  }

  function frame(t) {
    const s = active;
    if (!s) return;
    s.raf = 0;
    if (document.hidden) { s.last = 0; return; }

    const dt = s.last ? Math.min((t - s.last) / 1000, 0.05) : 1 / 60;
    s.last = t;

    advance(dt);
    render(t);

    if (s.closing && t - s.closeAt >= s.closeMs) { finishClose(s); return; }
    if (busy(t)) s.raf = requestAnimationFrame(frame);
    else s.last = 0;
  }

  function wake() {
    const s = active;
    if (!s || s.raf || document.hidden) return;
    s.raf = requestAnimationFrame(frame);
  }

  /* ---------------- 收回 ---------------- */
  function clearCloseTimer() {
    if (!active || !active.closeTimer) return;
    clearTimeout(active.closeTimer);
    active.closeTimer = 0;
  }

  function clearWheelTimer() {
    if (!active || !active.wheelTimer) return;
    clearTimeout(active.wheelTimer);
    active.wheelTimer = 0;
  }

  function scheduleClose(ms) {
    const s = active;
    if (!s || s.closing) return;
    clearTimeout(s.closeTimer);
    s.closeTimer = setTimeout(() => {
      s.closeTimer = 0;
      closeRing(false);
    }, ms);
  }

  function closeRing(immediate, after) {
    const s = active;
    if (!s || s.closing) return;
    clearTimeout(s.closeTimer);
    s.closeTimer = 0;
    clearWheelTimer();

    s.closing = true;
    s.closeAt = now();
    s.closeMs = reduceMotion ? 1 : (immediate ? QUICK_CLOSE_MS : CLOSE_MS);
    s.after = typeof after === 'function' ? after : null;
    s.dragging = false;

    /* 收起动画一起步就定对齐目标：此时 overlay 还在、卡片的 rect 有效。
       app.js 会在跑马带自己的 rAF 里缓动过去；覆盖层同时在 render() 里淡出，
       两条动画重叠，视觉上是「环退、条子从底下接到正前方」，而不是先消失再瞬移。 */
    s.seekKey = s.stale ? null : (s.selectedKey || frontKey(s));
    lastFrontKey = s.seekKey;
    const seekX = s.seekKey != null ? frontScreenX(s) : null;

    s.overlay.classList.add('is-closing');
    s.overlay.classList.remove('is-drag');

    /* 跑马带淡回来（但仍暂停），等覆盖层彻底移除后再恢复自动走。 */
    const root = getMarq();
    if (root) root.classList.remove('is-hcc-faded');

    if (s.seekKey != null && typeof window.__liziMarqueeSeek === 'function') {
      /* 自动收回 430ms 配 460ms 滑行：overlay 先到 0，条子最后一点在明面上停稳；
         Esc/点空白 220ms 用 380ms，仍在 380–480 区间内。 */
      window.__liziMarqueeSeek(s.seekKey, seekX, {
        dur: s.closeMs >= 380 ? 460 : 380,
      });
    }

    wake();
    /* rAF 在后台标签页会被挂起，定时器兜底收尾 */
    setTimeout(() => { if (active === s && s.closing) finishClose(s); }, s.closeMs + 140);
  }

  function finishClose(s) {
    if (active !== s) return;
    active = null;

    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    clearTimeout(s.closeTimer);
    clearTimeout(s.wheelTimer);
    s.wheelTimer = 0;

    /* 对齐在 closeRing() 启动收起时就已开始（那时卡片 rect 还量得到），
       这里只把最终 anchor 持久化；期间跑马带若被重绘（stale）就不沿用旧 index。 */
    lastFrontKey = s.stale ? null : s.seekKey;

    s.overlay.removeEventListener('pointerdown', onOverlayDown);
    s.overlay.removeEventListener('click', onOverlayClick);
    s.overlay.removeEventListener('wheel', onWheel);
    if (s.overlay.parentNode) s.overlay.parentNode.removeChild(s.overlay);

    const root = getMarq();
    if (root) root.classList.remove('is-hcc-faded');
    blockMarqLeave = false;
    /* 从对齐后的新位置恢复自动滚动（seek 若还没滑完，会继续到目标再接着走）；
       鼠标仍停在带上时，等下一次真实移入再重新触发 hover 暂停。 */
    resumeMarquee(root);

    try {
      if (s.prevFocus && s.prevFocus.isConnected && s.prevFocus.focus) {
        s.prevFocus.focus({ preventScroll: true });
      }
    } catch { /* 忽略 */ }

    if (s.after) setTimeout(s.after, 0);
  }

  /* ---------------- 按下 / 拖动 ---------------- */
  function beginPress(e, card, mode) {
    if (press) detachPress();
    /* 手指/鼠标一落下就停掉还在跑的弹簧和滚轮吸附，避免在手指下面继续转。 */
    if (active) {
      active.target = null;
      active.velocity = 0;
      clearWheelTimer();
    }
    press = {
      id: e.pointerId,
      mode,                                  // 'marquee' | 'overlay'
      card: card || null,
      startX: e.clientX,
      startY: e.clientY,
      originX: e.clientX,
      originY: e.clientY,
      startAngle: active ? active.angle : 0,
      startPitch: active ? active.pitch : 0,
      samples: [{ t: now(), a: active ? active.angle : 0 }],
      moved: false,
      tookOver: false,
    };
    window.addEventListener('pointermove', onPressMove, true);
    window.addEventListener('pointerup', onPressUp, true);
    window.addEventListener('pointercancel', onPressCancel, true);
  }

  function detachPress() {
    window.removeEventListener('pointermove', onPressMove, true);
    window.removeEventListener('pointerup', onPressUp, true);
    window.removeEventListener('pointercancel', onPressCancel, true);
    press = null;
  }

  function onPressMove(e) {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    trackPointer(e);

    const dxTotal = e.clientX - p.startX;
    const dyTotal = e.clientY - p.startY;
    const dist = Math.hypot(dxTotal, dyTotal);
    const threshold = p.mode === 'marquee' ? DRAG_THRESHOLD : OVERLAY_THRESHOLD;

    if (!p.moved) {
      if (dist < threshold) return;         // 没到阈值：什么都不做，click 原样放行

      if (p.mode === 'marquee') {
        /* 触屏竖向手势优先让页面滚动，不抢（跑马带本来就是 touch-action: pan-y）。 */
        if (e.pointerType !== 'mouse' && Math.abs(dyTotal) > Math.abs(dxTotal) * 1.25) {
          detachPress();
          return;
        }
        if (!openRing(p.card)) { detachPress(); return; }
        p.tookOver = true;
        p.moved = true;
        p.originX = e.clientX;              // 丢掉阈值内的几像素（和原组件一致）
        p.originY = e.clientY;
        p.startAngle = active.angle;
        p.startPitch = active.pitch;
        p.samples = [{ t: now(), a: active.angle }];
        active.dragging = true;
        active.target = null;
        active.velocity = 0;
        clearWheelTimer();
        active.overlay.classList.add('is-drag');
        clearCloseTimer();
      } else {
        p.moved = true;
        p.originX = e.clientX;
        p.originY = e.clientY;
        p.startAngle = active ? active.angle : 0;
        p.startPitch = active ? active.pitch : 0;
        p.samples = active ? [{ t: now(), a: active.angle }] : [];
        if (active) {
          active.dragging = true;
          active.target = null;
          active.velocity = 0;
          clearWheelTimer();
          active.overlay.classList.add('is-drag');
          clearCloseTimer();
        }
      }
    }

    /* capture 阶段截断：跑马带自己的 move 不会再响应 */
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();

    if (!active || active.closing) return;
    const hx = e.clientX - p.originX;
    const hy = e.clientY - p.originY;
    /* 只有 1 张卡时不转环：否则拖一下那张卡就绕到背面消失了。 */
    if (active.n > 1) active.angle = p.startAngle + hx * active.perPixel;
    const limit = active.pitchLimit;
    /* 0.03°/px：拖 30px 左右就到限位，跟手但不甩；松手后 0.3s 回正。
       2026-11-09：只有纵向主动移动才给俯仰。横向拖动时把 pitch 钉在起始值
       （通常 0），不然斜拖会带出整环上下漂 + 松手回正，用户会读成「发飘」。 */
    const vertical = Math.abs(hy) > Math.abs(hx) * 1.2;
    active.pitch = vertical
      ? clamp(p.startPitch + hy * 0.03, -limit, limit)
      : p.startPitch;

    /* 采样记录的就是 render 用的 active.angle，不是另一个 offset。 */
    const t = now();
    p.samples.push({ t, a: active.angle });
    while (p.samples.length > 2 && t - p.samples[0].t > SAMPLE_MS) p.samples.shift();

    wake();
  }

  function onPressUp(e) {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    trackPointer(e);
    const moved = p.moved;
    const mode = p.mode;
    detachPress();
    if (!moved) {
      /* 纯点击：不拦，交给原 click；环内如果 click 被吞掉，600ms 后仍按原逻辑收回。 */
      if (mode === 'overlay' && active && !active.closing) scheduleClose(HOLD_MS);
      return;
    }

    e.stopImmediatePropagation();
    /* 这里不 preventDefault：click 还要照常派发，由 suppressClick 决定吞不吞。 */
    if (mode === 'marquee') suppressDocClick();
    if (active && !active.closing) {
      /* 拖完松手时浏览器仍会补一个 click；多吞一会儿，防止触屏延迟 click
         落回跑马带最初按下的 A 卡上。 */
      const ring = active;
      ring.suppressClick = true;
      setTimeout(() => {
        if (active === ring) ring.suppressClick = false;
      }, mode === 'marquee' ? 400 : 80);
      releaseRing(p);
    }
  }

  function onPressCancel(e) {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    const moved = p.moved;
    detachPress();
    if (!moved || !active || active.closing) return;
    releaseRing(p);
  }

  /**
   * 松手：以「松手瞬间的 s.angle」为唯一基准做惯性 + 吸附。
   *   v        = 最近 110ms 拖动采样算出的角速度（°/s，限幅 ±1400）
   *   projected= s.angle + v * TAU * 0.55        （ReactBits momentum 估法）
   *   target   = 真实 slot 里离 projected 最近那张卡的居中角
   * 绝不使用 p.startAngle / 固定的 0° / 初始 anchor；A→B 松手时 projected
   * 在 B 附近，目标就只会是 B（或用户甩到的后续卡），不会回到 A。
   */
  function releaseRing(p) {
    const s = active;
    if (!s) return;
    s.dragging = false;
    s.overlay.classList.remove('is-drag');
    clearWheelTimer();

    if (s.n <= 1) {
      s.angle = 0;
      s.velocity = 0;
      s.target = null;
      scheduleClose(HOLD_MS);
      wake();
      return;
    }

    const t = now();
    if (p && p.samples && p.samples.length > 1) {
      while (p.samples.length > 2 && t - p.samples[0].t > SAMPLE_MS) p.samples.shift();
      const first = p.samples[0];
      const last = p.samples[p.samples.length - 1];
      const span = (last.t - first.t) / 1000;
      /* 拖到目标后停住再松手，最后一条采样可能已经很旧：此时速度必须归零，
         否则会把「停住前甩的那一下」当成惯性，松手后又转走。 */
      const idle = t - last.t;
      const v = (idle > 80 || span <= 0.008)
        ? 0
        : clamp((last.a - first.a) / span, -MAX_V, MAX_V);

      /* 2026-11-09：慢拖不足半格松手时，纯「最近槽位」必然把卡拉回起点
         （一张卡约 186px，拖 100px 就白拖）。这里加方向滞后：只要拖动
         超过 0.22 格，就朝拖动方向预推 0.28 格，让最近的槽位变成下一张。
         快速甩动仍走原来的惯性，不叠加。 */
      let projected = s.angle + v * TAU * 0.55;
      const moving = Math.abs(v) >= 1 && idle <= 80;
      if (!moving && p) {
        const moved = s.angle - p.startAngle;
        const stepDeg = s.step || (360 / Math.max(1, s.n));
        if (Math.abs(moved) >= stepDeg * 0.22) {
          projected += Math.sign(moved) * stepDeg * 0.28;
        }
      }
      const target = cardCenterNear(s, projected);
      const dist = target - s.angle;

      /* 速度背着目标时先清零，交给弹簧；朝目标时保留原速度（这才是惯性手感）。 */
      s.velocity = (dist !== 0 && Math.sign(v) !== Math.sign(dist)) ? 0 : v;
      s.target = target;

      /* 已经精确居中且几乎没速度：不动，避免无意义地进 rAF。 */
      if (Math.abs(dist) < 1e-6 && Math.abs(s.velocity) < 1) {
        s.angle = target;
        s.velocity = 0;
        s.target = null;
      }
    } else {
      /* 没有采样（极少见）：只吸到当前正前方那张卡的居中角。 */
      s.velocity = 0;
      s.target = cardCenterNear(s, s.angle);
    }

    scheduleClose(HOLD_MS);
    wake();
  }

  /* ---------------- 覆盖层自己的事件 ---------------- */
  function onOverlayDown(e) {
    if (!active || active.closing) return;
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    trackPointer(e);
    const t = e.target;
    const card = t && t.closest ? t.closest('.hcc__card') : null;
    clearCloseTimer();
    beginPress(e, card, 'overlay');
  }

  function onOverlayClick(e) {
    const s = active;
    if (!s || s.closing) return;
    /* 命中说明（中心牌）：world=0 的卡 z 最大（离镜头最近），两侧/背面卡都在负 z；
       3D 排序里近处卡片盖在远处卡片上，点到的就是眼睛看到的那张。
       卡片宽固定（236/156），按 pitch 排开，中心附近投影框不重叠；.hcc__shade 是 pointer-events:none。 */

    if (s.suppressClick) {
      s.suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    const t = e.target;
    const card = t && t.closest ? t.closest('.hcc__card') : null;
    if (card) selectCard(card.dataset.key);
    else closeRing(true);                    // 点空白：立即收回
  }

  function onWheel(e) {
    const s = active;
    if (!s || s.closing) return;
    e.preventDefault();

    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;

    clearCloseTimer();
    if (s.n <= 1 || (press && press.moved)) { scheduleClose(HOLD_MS); return; }
    /* 滚轮是用户主动输入：直接改 angle，滚轮停下 160ms 后再按真实槽位吸附。 */
    s.dragging = false;
    s.target = null;
    s.velocity = clamp(d * s.perPixel * 30, -MAX_V, MAX_V);
    s.angle += d * s.perPixel;

    clearTimeout(s.wheelTimer);
    s.wheelTimer = setTimeout(() => {
      if (!active || active !== s || s.closing) return;
      s.wheelTimer = 0;
      s.target = cardCenterNear(s, s.angle + s.velocity * TAU * 0.55);
      const dist = s.target - s.angle;
      if (dist !== 0 && Math.sign(s.velocity) !== Math.sign(dist)) s.velocity = 0;
      if (Math.abs(dist) < 0.004) {
        s.angle = s.target;
        s.target = null;
        s.velocity = 0;
      }
      wake();
    }, 160);

    scheduleClose(HOLD_MS);
    wake();
  }

  function selectCard(key) {
    if (active) active.selectedKey = key;
    lastFrontKey = key;                      // 下次打开从用户选中的这张开始
    const orig = findOriginal(key);
    closeRing(true, () => {
      /* 直接触发原卡片的 click：复用 app.js 里的跑马带点歌逻辑
         （Player.playQueue + 封面飞入转场 / paintWash）。 */
      if (orig && orig.isConnected) orig.click();
    });
  }

  /* ---------------- 全局拦截 ---------------- */
  function suppressDocClick() {
    docSuppressClick = true;
    clearTimeout(docSuppressTimer);
    /* 覆盖触屏浏览器 300ms 左右的延迟 click；环内点击不受影响
       （onDocClickCapture 对 .hcc 内的 target 直接放行）。 */
    docSuppressTimer = setTimeout(() => { docSuppressClick = false; }, 400);
  }

  function onDocPointerDown(e) {
    if (active || press) return;
    if (reduceMotion) return;                // 减少动态：完全不展开，保留原拖拽/点击
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const t = e.target;
    if (!t || !t.closest) return;
    const card = t.closest('.marq__card');
    if (!card) return;
    const root = card.closest(MARQ_SEL);
    if (!root || root.classList.contains('is-empty')) return;
    if (root.classList.contains('is-hcc-faded')) return;

    trackPointer(e);
    /* 拦住 app.js 挂在 .hall-marq 冒泡阶段的 pointerdown：
       跑马带不会进入自己的拖动状态；click 仍由浏览器正常合成。 */
    e.stopImmediatePropagation();
    ensureCss();
    /* 按下就开始逐帧补卡（不阻塞这一帧）：拖过 8px 时环里已有足够卡片，
       不会像以前那样在第一个 pointermove 里同步建几百张 DOM。 */
    pumpMarqueeFill();
    beginPress(e, card, 'marquee');
  }

  function onDocClickCapture(e) {
    if (!docSuppressClick) return;
    const t = e.target;
    if (t && t.closest && t.closest('.hcc')) return;   // 环里的点击归覆盖层
    docSuppressClick = false;
    clearTimeout(docSuppressTimer);
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function onKeyDown(e) {
    if (!active || active.closing) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRing(true);
    }
  }

  function onVisibility() {
    if (!document.hidden) wake();
  }

  function onResize() {
    if (active && !active.closing) closeRing(true);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    ensureCss();
    const root = getMarq();
    if (root) {
      /* 悬停就跑马带预填：用户在看卡、还没按下去的那几百毫秒里，
         后台已经把大部分卡补进 DOM，按下时首帧不用再建。 */
      root.addEventListener('pointerenter', pumpMarqueeFill, { passive: true });
      /* 平台切换 / 跑马带重绘：立刻让旧环失效，下一次拖重新取卡片。 */
      marqObserver = new MutationObserver(() => {
        /* 卡片集可能整体换了：旧的卡片 key 不再是同一首歌，别拿它当重开 anchor。 */
        lastFrontKey = null;
        if (active) active.stale = true;
        if (press) detachPress();
        if (active && !active.closing) closeRing(true);
      });
      marqObserver.observe(root, { childList: true, subtree: true });
    }

    /* 展开期间 app.js 的真实 pointerleave 会被吞掉，保证 marqPaused 不被它重置
       （覆盖层出现在指针下面时浏览器会补一个 leave）。放在 document 的捕获阶段，
       无论 app.js 何时 bind，都一定先于它挂在 #hall-marq 上的监听执行。 */
    document.addEventListener('pointerleave', (e) => {
      if (!blockMarqLeave || !marq) return;
      if (e.target === marq || marq.contains(e.target)) e.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('pointermove', trackPointer, { passive: true });
    document.addEventListener('click', onDocClickCapture, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
