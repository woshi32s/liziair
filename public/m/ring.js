/**
 * LIZI · 手机大厅 · 平面跑马带 + 按住展开大环
 * --------------------------------------------------------------------------
 * 运动手感照电脑版 hall/circular-carousel.js（ReactBits CircularCarousel，
 * cylinder 预设），数学原样搬过来：
 *   step        = min(360/n, 2·asin(pitch/(2R)))
 *   pitch       = cardW × 1.14
 *   RView       = (vw/2 - edgePad - cardW/2) / 0.762
 *   R           = max(RView, cardW*0.8)
 *   P(透视)     = 3.2R
 *   camera      = translateZ(-R) rotateX(-5°) scale(...)
 *   ring        = rotateY(angle)
 *   slot        = rotateY(i*step) translateZ(R)
 *   拖动        = 每像素 180/(πR) × 1.45 度
 *   角速度      = 最近 110ms 采样，松手限幅 ±1400°/s
 *   惯性        = τ = 1.08s，target = 离 (angle + v·τ·0.55) 最近的槽位居中角
 *   弹簧        = 118，阻尼 2√118，1/240s 步长
 *   只露正面    = facing ≤.06 藏掉，.06–.30 用 smoothstep 淡出
 *   松手保持    = 1s 后再收
 *
 * 手机这边的交互：跑马带本身可以正常横拖着看，展开环形是一个明确的上滑动作：
 *   平面跑马带：自动向左走 · 点卡片播放
 *               · 横向拖动 → 正常滚动跑马带（不再一拖就弹环）
 *               · 向上滑（竖向位移压过横向）→ 在手指下展开环绕层，接着拖就是转环
 *   环：拖动旋转（松手有惯性并吸附）· 点卡片播放 · 点空白/松手 1s 后收回
 *   · 安卓返回键由 m.js 的 history 层调用 close({ silent:true }) 收回
 *
 * DOM：跑马带卡池只建 6–8 张，滚出视口就换到另一头换内容；环只有 n 个槽
 * （n = min(卡数, 环容量)），槽位转到背面时才换卡（和电脑版同款虚拟化），
 * 所以 60 张歌单也不会建 60 个 3D 层。全程只写 transform / opacity /
 * visibility，没有 filter / backdrop-filter，静止时没有 rAF。
 *
 * 对外：
 *   window.MobileRing = { create }
 *   create({ strip, track, getItems, reduced, onPlay, onOpenChange })
 *   → { setItems(items), refresh(), open(index), close({silent}), isOpen(),
 *        setPlaying(pred), destroy() }
 *
 * item: { key, cover, title, sub, raw }
 */
(function () {
  'use strict';

  const DRAG_THRESHOLD = 10;       // 跑马带上：超过 10px 才判定手势方向
  const RING_THRESHOLD = 5;        // 环里：超过 5px 才算拖动
  const HOLD_MS = 1000;            // 松手后环保持多久再收
  const ENTER_MS = 520;            // 环展开（半径 0.42R→R）
  const CLOSE_MS = 430;            // 自动收回
  const QUICK_CLOSE_MS = 220;      // 点空白
  const MOMENTUM = 0.6;
  const TAU = 0.18 + MOMENTUM * 1.5; // 1.08s
  const SPRING = 118;
  const MAX_V = 1400;
  const SAMPLE_MS = 110;
  const DRAG_GAIN = 1.45;
  const MARQUEE_SPEED = 24;        // px/s
  const RESUME_MS = 1200;          // 松手后多久恢复自动走
  const TO_RAD = Math.PI / 180;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const modIndex = (v, m) => ((v % m) + m) % m;
  const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  const easeInCubic = (t) => t * t * t;
  const now = () => performance.now();

  function signedSlotOffset(k, f, n) {
    let off = k - f;
    off = ((off % n) + n) % n;
    if (off > n / 2) off -= n;
    return off;
  }

  function create(opts) {
    opts = opts || {};
    const strip = opts.strip;
    const track = opts.track;
    if (!strip || !track) return null;

    const getItems = typeof opts.getItems === 'function' ? opts.getItems : () => [];
    const reduced = () => !!(opts.reduced && opts.reduced()) ||
      (window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false);

    let items = [];
    let playing = null;          // predicate(item) => bool
    let ring = null;             // 展开中的环；null = 没展开
    let press = null;            // 当前手势
    let destroyed = false;

    /* ================================================================
     * 平面跑马带
     * ================================================================ */
    const flat = {
      cards: [],   // { el, img, name, j, idx, src }
      n: 0,
      W: 0,
      H: 0,
      pitch: 60,
      scroll: 0,
      raf: 0,
      last: 0,
      pressed: false,
      resumeAt: 0,
      suppress: false,
      suppressTimer: 0,
    };

    function makeFlatCard() {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'mcard';
      el.innerHTML =
        '<span class="mcard__art"><img class="mcard__img" alt="" decoding="async"></span>' +
        '<b class="mcard__name"></b>';
      const img = el.querySelector('.mcard__img');
      const name = el.querySelector('.mcard__name');
      img.addEventListener('load', () => img.classList.add('is-on'));
      img.addEventListener('error', () => {
        img.classList.remove('is-on');
        el.classList.add('is-empty');
      });
      track.appendChild(el);
      const slot = { el, img, name, j: 0, idx: -1, src: '' };
      flat.cards.push(slot);
      return slot;
    }

    function setFlatCard(slot, idx) {
      const item = items[idx];
      if (!item) {
        slot.el.style.visibility = 'hidden';
        slot.idx = -1;
        return;
      }
      slot.el.style.visibility = '';
      if (slot.idx !== idx) {
        slot.idx = idx;
        const src = item.cover || '';
        if (src !== slot.src) {
          slot.src = src;
          if (src) {
            slot.el.classList.remove('is-empty');
            slot.img.classList.remove('is-on');
            slot.img.src = src;
          } else {
            slot.img.removeAttribute('src');
            slot.el.classList.add('is-empty');
          }
        }
        slot.name.textContent = item.title || '';
        slot.el.dataset.idx = String(idx);
        slot.el.dataset.key = item.key || '';
      }
      slot.el.classList.toggle('is-playing', !!(playing && playing(item)));
    }

    function measureFlat() {
      if (!flat.cards.length) makeFlatCard();
      const probe = flat.cards[0].el;
      const gap = (() => {
        const raw = getComputedStyle(track).getPropertyValue('--m-card-gap');
        const v = parseFloat(raw);
        return Number.isFinite(v) ? v : 10;
      })();
      flat.W = Math.max(1, strip.clientWidth);
      flat.H = Math.max(1, strip.clientHeight);
      flat.pitch = Math.max(1, (probe.offsetWidth || 60) + Math.max(0, gap));
      const need = Math.ceil(flat.W / flat.pitch) + 3;
      while (flat.cards.length < need) makeFlatCard();
      flat.n = flat.cards.length;
    }

    function resetFlat() {
      measureFlat();
      flat.scroll = 0;
      for (let k = 0; k < flat.cards.length; k++) {
        const slot = flat.cards[k];
        slot.j = k;
        slot.idx = -1;
      }
      layoutFlat(true);
    }

    function layoutFlat(force) {
      if (!items.length) {
        for (const slot of flat.cards) slot.el.style.visibility = 'hidden';
        return;
      }
      const W = flat.W;
      const pitch = flat.pitch;
      const n = flat.n || flat.cards.length;
      if (!n) return;
      for (let k = 0; k < flat.cards.length; k++) {
        const slot = flat.cards[k];
        let x = slot.j * pitch - flat.scroll;
        let guard = 0;
        while (x < -pitch && guard++ < 6) {
          slot.j += n;
          x += n * pitch;
        }
        guard = 0;
        while (x > W + 1 && guard++ < 6) {
          slot.j -= n;
          x -= n * pitch;
        }
        const idx = modIndex(slot.j, items.length);
        if (force || slot.idx !== idx) setFlatCard(slot, idx);
        slot.el.style.transform = 'translate3d(' + (Math.round(x * 10) / 10) + 'px, -50%, 0)';
      }
    }

    function wakeFlat() {
      if (flat.raf || destroyed || !items.length || ring || document.hidden) return;
      flat.raf = requestAnimationFrame(flatFrame);
    }

    function stopFlat() {
      if (flat.raf) {
        cancelAnimationFrame(flat.raf);
        flat.raf = 0;
      }
      flat.last = 0;
    }

    function flatFrame(t) {
      flat.raf = 0;
      if (destroyed || !items.length || ring || document.hidden) return;
      const dt = flat.last ? Math.min((t - flat.last) / 1000, 0.05) : 1 / 60;
      flat.last = t;
      if (!flat.pressed && t >= flat.resumeAt) flat.scroll += MARQUEE_SPEED * dt;
      layoutFlat(false);
      flat.raf = requestAnimationFrame(flatFrame);
    }

    function suppressFlatClick(ms) {
      flat.suppress = true;
      clearTimeout(flat.suppressTimer);
      flat.suppressTimer = setTimeout(() => {
        flat.suppressTimer = 0;
        flat.suppress = false;
      }, ms);
    }

    /* 手指落在卡片缝里时，取横向离它最近的那张 —— 长按 / 拖动都要有锚点 */
    function nearestFlatIdx(x) {
      let best = -1;
      let bestD = Infinity;
      for (const slot of flat.cards) {
        if (slot.idx < 0 || slot.el.style.visibility === 'hidden') continue;
        const r = slot.el.getBoundingClientRect();
        if (r.width <= 0) continue;
        const d = Math.abs(r.left + r.width / 2 - x);
        if (d < bestD) { bestD = d; best = slot.idx; }
      }
      return best;
    }

    function playItem(idx) {
      const item = items[idx];
      if (!item) return;
      try {
        if (typeof opts.onPlay === 'function') opts.onPlay(item, idx);
      } catch { /* 回调异常不能拖垮手势 */ }
    }

    /* 跑马带上的点击：只认真正的点按（拖动 / 长按已被 suppress 吞掉） */
    function onFlatClick(e) {
      if (flat.suppress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const card = e.target && e.target.closest ? e.target.closest('.mcard') : null;
      if (!card || !track.contains(card)) return;
      const idx = Number(card.dataset.idx);
      if (Number.isInteger(idx) && idx >= 0) {
        e.preventDefault();
        playItem(idx);
      }
    }

    /* ================================================================
     * 环
     * ================================================================ */
    function frontSlot(s, angle) {
      let best = null;
      let bestAbs = Infinity;
      for (const slot of s.slots) {
        const w = Math.abs(wrap(slot.base + angle));
        if (w < bestAbs) {
          bestAbs = w;
          best = slot;
        }
      }
      return best;
    }

    function cardCenterNear(s, angle) {
      const slot = frontSlot(s, angle);
      if (!slot) return angle;
      let target = -slot.base;
      target += 360 * Math.round((angle - target) / 360);
      return target;
    }

    function makeRingCard() {
      const card = document.createElement('div');
      card.className = 'mring__card';
      card.innerHTML =
        '<span class="mring__art"><img class="mring__img" alt="" decoding="async"></span>' +
        '<b class="mring__name"></b>' +
        '<i class="mring__shade" aria-hidden="true"></i>';
      const img = card.querySelector('.mring__img');
      const name = card.querySelector('.mring__name');
      img.addEventListener('load', () => img.classList.add('is-on'));
      img.addEventListener('error', () => {
        img.classList.remove('is-on');
        card.classList.add('is-empty');
      });
      return { el: card, img, name, src: '', idx: -1 };
    }

    function setRingCard(slot, idx) {
      const item = items[idx];
      if (!slot || !slot.card || !item) return;
      slot.idx = idx;
      const card = slot.card;
      card.el.dataset.idx = String(idx);
      card.el.dataset.key = item.key || '';
      card.name.textContent = item.title || '';
      card.el.classList.toggle('is-playing', !!(playing && playing(item)));
      if (card.src !== (item.cover || '')) {
        card.src = item.cover || '';
        if (card.src) {
          card.el.classList.remove('is-empty');
          card.img.classList.remove('is-on');
          card.img.src = card.src;
        } else {
          card.img.removeAttribute('src');
          card.el.classList.add('is-empty');
        }
      }
    }

    function syncSlotContent(s) {
      if (s.len <= s.n) return;
      const front = frontSlot(s, s.angle);
      if (!front) return;
      const f = s.slots.indexOf(front);
      const baseIdx = front.idx;
      for (let k = 0; k < s.slots.length; k++) {
        const slot = s.slots[k];
        if (Math.abs(wrap(slot.base + s.angle)) < 90) continue;
        const want = modIndex(baseIdx + signedSlotOffset(k, f, s.n), s.len);
        if (want !== slot.idx) setRingCard(slot, want);
      }
    }

    function openRing(anchorIdx) {
      if (ring || destroyed) return false;
      if (!items.length) return false;
      const len = items.length;
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const cardW = clamp(vw * 0.24, 84, 112);
      const cardH = cardW + 28;
      const pitch = cardW * 1.14;
      const edgePad = 14;
      const Rview = (vw / 2 - edgePad - cardW / 2) / 0.762;
      const R = Math.max(Rview, cardW * 0.8);
      const P = Math.max(R * 3.2, 520);
      const cap = clamp(Math.round((2 * Math.PI * R) / pitch), 7, 64);
      const n = Math.min(len, cap);
      const step = Math.min(
        360 / n,
        2 * Math.asin(clamp(pitch / (2 * R), -1, 1)) / TO_RAD,
      );
      const perPixel = (180 / (Math.PI * R)) * DRAG_GAIN;

      const rect = strip.getBoundingClientRect();
      const topbar = document.querySelector('.topbar');
      const topEdge = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
      const tiltDrop = R * Math.sin(5 * TO_RAD);
      let cx = clamp(rect.left + rect.width / 2, 0, vw);
      let cy = rect.top + rect.height / 2;
      cy = Math.max(cy, topEdge + cardH * 0.55 + 12);
      cy = Math.min(cy, vh - cardH * 0.55 - 52 - tiltDrop);
      if (cy < topEdge + cardH * 0.5) cy = topEdge + cardH * 0.5;

      const overlay = document.createElement('div');
      overlay.className = 'mring';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '推荐 · 环形浏览');
      overlay.tabIndex = -1;
      overlay.style.setProperty('--mx', cx + 'px');
      overlay.style.setProperty('--my', cy + 'px');
      overlay.style.setProperty('--mp', P + 'px');
      overlay.style.setProperty('--mring-w', cardW + 'px');
      overlay.style.setProperty('--mring-h', cardH + 'px');
      overlay.innerHTML =
        '<div class="mring__view"><div class="mring__camera"><div class="mring__ring"></div></div></div>' +
        '<p class="mring__hint">拖动旋转 · 点卡片播放</p>';

      const view = overlay.querySelector('.mring__view');
      const camera = overlay.querySelector('.mring__camera');
      const ringEl = overlay.querySelector('.mring__ring');

      const slots = [];
      for (let k = 0; k < n; k++) {
        const idx = modIndex(anchorIdx + signedSlotOffset(k, 0, n), len);
        const slotEl = document.createElement('div');
        slotEl.className = 'mring__slot';
        const card = makeRingCard();
        slotEl.appendChild(card.el);
        ringEl.appendChild(slotEl);
        const slot = {
          el: slotEl,
          card,
          shadeEl: card.el.querySelector('.mring__shade'),
          base: k * step,
          idx: -1,
          key: '',
        };
        setRingCard(slot, idx);
        slot.key = items[idx] ? items[idx].key : '';
        slots.push(slot);
      }

      document.body.appendChild(overlay);
      const rm = reduced();
      ring = {
        overlay, view, camera, ringEl, slots,
        n, len, R, P, step, cardW, cardH, perPixel,
        angle: 0,
        velocity: 0,
        target: null,
        dragging: false,
        closing: false,
        closeAt: 0,
        closeMs: 0,
        introAt: rm ? now() - ENTER_MS : now(),
        holdTimer: 0,
        raf: 0,
        last: 0,
        notified: false,
        suppressClick: false,
        reduced: rm,
      };

      stopFlat();
      document.body.classList.add('is-ring');
      overlay.addEventListener('pointerdown', onOverlayDown);
      overlay.addEventListener('click', onOverlayClick, true);
      overlay.addEventListener('contextmenu', preventCtx, true);
      overlay.addEventListener('dragstart', preventCtx, true);
      try { overlay.focus({ preventScroll: true }); } catch { /* 忽略 */ }

      requestAnimationFrame(() => {
        if (ring && ring.overlay === overlay) overlay.classList.add('is-open');
      });

      if (typeof opts.onOpenChange === 'function') {
        try { opts.onOpenChange(true, 'ui'); } catch { /* 忽略 */ }
      }

      renderRing(now());
      wakeRing();
      return true;
    }

    function renderRing(t) {
      const s = ring;
      if (!s) return;
      const entryRaw = clamp((t - s.introAt) / ENTER_MS, 0, 1);
      const entry = s.dragging || s.reduced ? 1 : easeOutQuint(entryRaw);
      let closeT = 0;
      if (s.closing) {
        closeT = clamp((t - s.closeAt) / Math.max(1, s.closeMs), 0, 1);
        s.overlay.style.opacity = String(1 - easeInCubic(closeT));
      }

      const R = s.R * (0.42 + 0.58 * entry) * (1 - 0.66 * easeInCubic(closeT));
      const camScale = (0.74 + 0.26 * entry) * (1 - 0.55 * easeInCubic(closeT));
      const angle = s.angle;

      s.frameNo = (s.frameNo || 0) + 1;
      const stride = s.target !== null ? 10 : 6;
      if (s.frameNo % stride === 1) syncSlotContent(s);

      const camTf =
        'translate3d(0,0,' + (-R).toFixed(2) + 'px) scale(' + camScale.toFixed(3) + ') ' +
        'rotateX(-5deg)';
      if (camTf !== s.camTf) {
        s.camera.style.transform = camTf;
        s.camTf = camTf;
      }
      const ringTf = 'rotateY(' + angle.toFixed(3) + 'deg)';
      if (ringTf !== s.ringTf) {
        s.ringEl.style.transform = ringTf;
        s.ringTf = ringTf;
      }

      for (let i = 0; i < s.slots.length; i++) {
        const slot = s.slots[i];
        const tf = 'rotateY(' + slot.base.toFixed(3) + 'deg) translateZ(' + R.toFixed(2) + 'px)';
        if (tf !== slot.tf) {
          slot.el.style.transform = tf;
          slot.tf = tf;
        }
        const world = wrap(slot.base + angle);
        const facing = Math.cos(world * TO_RAD);
        const hidden = facing <= 0.06;
        const vis = hidden ? 'hidden' : '';
        if (vis !== slot.vis) {
          slot.el.style.visibility = vis;
          slot.vis = vis;
        }
        const wc = hidden ? '' : 'transform';
        if (wc !== slot.wc) {
          slot.el.style.willChange = wc;
          slot.wc = wc;
        }
        let op = '1';
        if (hidden) op = '0';
        else if (facing < 0.30) {
          const q = clamp((facing - 0.06) / 0.24, 0, 1);
          op = (q * q * (3 - 2 * q)).toFixed(3);
        }
        if (op !== slot.op) {
          slot.el.style.opacity = op;
          slot.op = op;
        }
        if (!hidden) {
          const shadeOp = (0.55 * Math.pow((1 - facing) / 2, 1.25)).toFixed(3);
          if (shadeOp !== slot.shadeOp) {
            if (slot.shadeEl) slot.shadeEl.style.opacity = shadeOp;
            slot.shadeOp = shadeOp;
          }
        }
      }
    }

    function advanceRing(dt) {
      const s = ring;
      if (!s || s.closing || s.dragging) return;
      if (s.target === null) return;
      const target = s.target;
      const prev = s.angle;
      const damping = 2 * Math.sqrt(SPRING);
      let remaining = dt;
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 240);
        const accel = SPRING * (target - s.angle) - damping * s.velocity;
        s.velocity += accel * h;
        s.angle += s.velocity * h;
        remaining -= h;
      }
      if ((prev - target) * (s.angle - target) <= 0 ||
          (Math.abs(target - s.angle) < 0.004 && Math.abs(s.velocity) < 0.03)) {
        s.angle = target;
        s.velocity = 0;
        s.target = null;
      }
    }

    function busyRing(t) {
      const s = ring;
      if (!s) return false;
      if (s.closing) return true;
      if (t - s.introAt < ENTER_MS + 30) return true;
      if (s.target !== null) return true;
      return false;
    }

    function ringFrame(t) {
      const s = ring;
      if (!s) return;
      s.raf = 0;
      if (document.hidden) { s.last = 0; return; }
      const dt = s.last ? Math.min((t - s.last) / 1000, 0.05) : 1 / 60;
      s.last = t;
      advanceRing(dt);
      renderRing(t);
      if (s.closing && t - s.closeAt >= s.closeMs) { finishClose(s); return; }
      if (busyRing(t)) s.raf = requestAnimationFrame(ringFrame);
      else s.last = 0;
    }

    function wakeRing() {
      const s = ring;
      if (!s || s.raf || document.hidden) return;
      s.raf = requestAnimationFrame(ringFrame);
    }

    function clearHold() {
      if (!ring || !ring.holdTimer) return;
      clearTimeout(ring.holdTimer);
      ring.holdTimer = 0;
    }

    function scheduleClose(ms) {
      const s = ring;
      if (!s || s.closing) return;
      clearHold();
      s.holdTimer = setTimeout(() => {
        s.holdTimer = 0;
        if (ring === s && !s.closing) close('hold');
      }, ms);
    }

    function notifyClose(s, reason) {
      if (s.notified) return;
      s.notified = true;
      if (typeof opts.onOpenChange === 'function') {
        try { opts.onOpenChange(false, reason === 'silent' ? 'silent' : reason); } catch { /* 忽略 */ }
      }
    }

    function close(arg) {
      const s = ring;
      if (!s || s.closing) return;
      const silent = !!(arg && typeof arg === 'object' && arg.silent);
      const reason = silent ? 'silent' : (typeof arg === 'string' ? arg : 'ui');
      clearHold();
      s.closing = true;
      s.closeAt = now();
      s.closeMs = s.reduced ? 1 : (reason === 'blank' ? QUICK_CLOSE_MS : CLOSE_MS);
      s.dragging = false;
      s.target = null;
      s.velocity = 0;
      s.overlay.style.opacity = '1';
      s.overlay.classList.add('is-closing');
      notifyClose(s, reason);
      wakeRing();
      setTimeout(() => {
        if (ring === s && s.closing) finishClose(s);
      }, s.closeMs + 140);
    }

    function finishClose(s) {
      if (ring !== s) return;
      ring = null;
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
      if (s.holdTimer) { clearTimeout(s.holdTimer); s.holdTimer = 0; }
      s.overlay.removeEventListener('pointerdown', onOverlayDown);
      s.overlay.removeEventListener('click', onOverlayClick, true);
      s.overlay.removeEventListener('contextmenu', preventCtx, true);
      s.overlay.removeEventListener('dragstart', preventCtx, true);
      if (s.overlay.parentNode) s.overlay.parentNode.removeChild(s.overlay);
      document.body.classList.remove('is-ring');
      flat.last = 0;
      flat.resumeAt = now() + 220;
      wakeFlat();
    }

    function releaseRing(p) {
      const s = ring;
      if (!s) return;
      s.dragging = false;
      s.overlay.classList.remove('is-drag');
      if (s.n <= 1 || s.reduced) {
        if (s.n <= 1) { s.angle = 0; }
        else {
          s.angle = cardCenterNear(s, s.angle);
        }
        s.velocity = 0;
        s.target = null;
        scheduleClose(HOLD_MS);
        wakeRing();
        return;
      }

      const t = now();
      let v = 0;
      if (p && p.samples && p.samples.length > 1) {
        while (p.samples.length > 2 && t - p.samples[0].t > SAMPLE_MS) p.samples.shift();
        const first = p.samples[0];
        const last = p.samples[p.samples.length - 1];
        const span = (last.t - first.t) / 1000;
        const idle = t - last.t;
        v = (idle > 80 || span <= 0.008)
          ? 0
          : clamp((last.a - first.a) / span, -MAX_V, MAX_V);

        let projected = s.angle + v * TAU * 0.55;
        const moving = Math.abs(v) >= 1 && idle <= 80;
        if (!moving) {
          const moved = s.angle - p.startAngle;
          const stepDeg = s.step || (360 / Math.max(1, s.n));
          if (Math.abs(moved) >= stepDeg * 0.22) {
            projected += Math.sign(moved) * stepDeg * 0.28;
          }
        }
        const target = cardCenterNear(s, projected);
        const dist = target - s.angle;
        s.velocity = (dist !== 0 && Math.sign(v) !== Math.sign(dist)) ? 0 : v;
        s.target = target;
        if (Math.abs(dist) < 1e-6 && Math.abs(s.velocity) < 1) {
          s.angle = target;
          s.velocity = 0;
          s.target = null;
        }
      } else {
        s.velocity = 0;
        s.target = cardCenterNear(s, s.angle);
      }
      scheduleClose(HOLD_MS);
      wakeRing();
    }

    function selectItem(idx) {
      const item = items[idx];
      if (!item || !ring) return;
      ring.suppressClick = true;
      playItem(idx);
      close('play');
    }

    /* ================================================================
     * 手势：跑马带 / 环共用一套 window 监听
     * ================================================================ */
    function beginPress(e, mode, idx) {
      if (press) detachPress();
      clearHold();
      const p = {
        id: e.pointerId,
        mode,
        idx: idx,
        x0: e.clientX,
        y0: e.clientY,
        prevX: e.clientX,
        lastX: e.clientX,
        lastY: e.clientY,
        startAngle: ring ? ring.angle : 0,
        samples: [{ t: now(), a: ring ? ring.angle : 0 }],
        moved: false,
        opened: false,
        longTimer: 0,
      };
      press = p;
      if (mode === 'strip') {
        flat.pressed = true;
        stopFlat();
      } else if (ring && !ring.closing) {
        ring.target = null;
        ring.velocity = 0;
      }
      window.addEventListener('pointermove', onPressMove, true);
      window.addEventListener('pointerup', onPressUp, true);
      window.addEventListener('pointercancel', onPressCancel, true);
    }

    function detachPress() {
      window.removeEventListener('pointermove', onPressMove, true);
      window.removeEventListener('pointerup', onPressUp, true);
      window.removeEventListener('pointercancel', onPressCancel, true);
      if (press && press.longTimer) {
        clearTimeout(press.longTimer);
        press.longTimer = 0;
      }
      press = null;
    }

    /* 手势中途展开环：手指不用抬起，展开后继续拖就是转环。
       x / y 是当前手指位置，用作新的拖动原点。 */
    function enterRing(p, idx, x, y) {
      const anchor = idx >= 0 ? idx : nearestFlatIdx(x);
      if (anchor < 0 || !items[anchor]) return false;
      p.opened = true;
      suppressFlatClick(500);
      if (!openRing(anchor)) {
        p.opened = false;
        return false;
      }
      p.mode = 'ring';
      p.idx = anchor;
      p.moved = false;
      p.x0 = x;
      p.y0 = y;
      p.startAngle = 0;
      p.samples = [{ t: now(), a: 0 }];
      flat.pressed = false;
      flat.resumeAt = now() + RESUME_MS;
      return true;
    }

    function onPressMove(e) {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      const dx = e.clientX - p.x0;
      const dy = e.clientY - p.y0;

      if (p.mode === 'strip') {
        if (!p.moved) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          /* 竖向手势单独处理：上滑 = 展开环；下滑 = 交还页面 */
          if (Math.abs(dy) > Math.abs(dx) * 1.25) {
            if (dy < 0 && enterRing(p, p.idx, e.clientX, e.clientY)) {
              e.stopImmediatePropagation();
              if (e.cancelable) e.preventDefault();
              return;
            }
            suppressFlatClick(300);
            detachPress();
            flat.pressed = false;
            flat.resumeAt = now() + RESUME_MS;
            wakeFlat();
            return;
          }
          /* 横向拖动只是滚跑马带，不再顺手弹环 */
          p.moved = true;
          suppressFlatClick(320);
          p.prevX = p.x0;      // 第一下把阈值内的位移也算进去，之后 1:1 跟手
          stopFlat();
        }
        const stepDx = e.clientX - p.prevX;
        p.prevX = e.clientX;
        flat.scroll -= stepDx;
        layoutFlat(false);
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
        return;
      }

      /* mode === 'ring' */
      const s = ring;
      if (!s || s.closing) return;
      /* 明显向下滑 = 退出环（和点空白同一条出口），不要拿它当旋转 */
      if (!p.moved && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
        detachPress();
        close('swipe');
        return;
      }
      if (!p.moved) {
        if (Math.hypot(dx, dy) < RING_THRESHOLD) return;
        p.moved = true;
        s.dragging = true;
        s.target = null;
        s.velocity = 0;
        clearHold();
        s.overlay.classList.add('is-drag');
        p.startAngle = s.angle;
        p.samples = [{ t: now(), a: s.angle }];
        p.x0 = e.clientX;
        p.y0 = e.clientY;
      }
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      if (s.n > 1) {
        s.angle = p.startAngle + (e.clientX - p.x0) * s.perPixel;
      }
      const tt = now();
      p.samples.push({ t: tt, a: s.angle });
      while (p.samples.length > 2 && tt - p.samples[0].t > SAMPLE_MS) p.samples.shift();
      wakeRing();
    }

    function onPressUp(e) {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      const moved = p.moved;
      const mode = p.mode;
      const opened = p.opened;
      const idx = p.idx;
      detachPress();

      if (mode === 'strip') {
        flat.pressed = false;
        flat.resumeAt = now() + RESUME_MS;
        if (moved) suppressFlatClick(350);
        wakeFlat();
        return;
      }

      /* 环里松手 */
      if (opened && !moved) {
        /* 这是长按打开的那根手指：不算点选，松手后照常保持 1s */
        if (ring && !ring.closing) {
          ring.dragging = false;
          ring.overlay.classList.remove('is-drag');
          scheduleClose(HOLD_MS);
          wakeRing();
        }
        return;
      }
      if (!ring || ring.closing) return;

      if (moved) {
        e.stopImmediatePropagation();
        releaseRing(p);
        return;
      }

      /* 纯点按：卡片 → 播放；空白 → 收回 */
      if (idx >= 0 && items[idx]) {
        e.stopImmediatePropagation();
        selectItem(idx);
      } else {
        e.stopImmediatePropagation();
        close('blank');
      }
    }

    function onPressCancel(e) {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      const moved = p.moved;
      detachPress();
      if (p.mode === 'strip') {
        flat.pressed = false;
        flat.resumeAt = now() + RESUME_MS;
        wakeFlat();
        return;
      }
      if (ring && !ring.closing) {
        if (moved) releaseRing(p);
        else scheduleClose(HOLD_MS);
        wakeRing();
      }
    }

    function onOverlayDown(e) {
      if (!ring || ring.closing) return;
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = e.target && e.target.closest ? e.target.closest('.mring__card') : null;
      const idx = card ? Number(card.dataset.idx) : -1;
      clearHold();
      beginPress(e, 'ring', Number.isInteger(idx) ? idx : -1);
    }

    function onOverlayClick(e) {
      /* 点按全部由 pointerup 处理，吞掉合成 click 防止误触下层 */
      e.preventDefault();
      e.stopPropagation();
    }

    function preventCtx(e) {
      e.preventDefault();
    }

    /* 跑马带的事件入口 */
    function onStripDown(e) {
      if (ring || destroyed) return;
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = e.target && e.target.closest ? e.target.closest('.mcard') : null;
      const idx = card ? Number(card.dataset.idx) : -1;
      beginPress(e, 'strip', Number.isInteger(idx) ? idx : -1);
    }

    /* ================================================================
     * 对外
     * ================================================================ */
    function setItems(next) {
      items = Array.isArray(next) ? next : [];
      if (ring && !ring.closing) close('items');
      if (!items.length) {
        stopFlat();
        flat.scroll = 0;
        for (const slot of flat.cards) slot.el.style.visibility = 'hidden';
        return;
      }
      resetFlat();
      wakeFlat();
    }

    function refresh() {
      if (ring && !ring.closing) close('resize');
      if (!items.length) return;
      resetFlat();
      wakeFlat();
    }

    function setPlaying(pred) {
      playing = typeof pred === 'function' ? pred : null;
      for (const slot of flat.cards) {
        const item = slot.idx >= 0 ? items[slot.idx] : null;
        slot.el.classList.toggle('is-playing', !!(item && playing && playing(item)));
      }
      if (ring) {
        for (const slot of ring.slots) {
          const item = slot.idx >= 0 ? items[slot.idx] : null;
          slot.card.el.classList.toggle('is-playing', !!(item && playing && playing(item)));
        }
      }
    }

    function open(index) {
      return openRing(Number.isInteger(index) ? index : 0);
    }

    function isOpen() {
      return !!ring;
    }

    function destroy() {
      destroyed = true;
      detachPress();
      if (ring) {
        if (ring.overlay.parentNode) ring.overlay.parentNode.removeChild(ring.overlay);
        ring = null;
        document.body.classList.remove('is-ring');
      }
      stopFlat();
      clearTimeout(flat.suppressTimer);
      strip.removeEventListener('pointerdown', onStripDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const slot of flat.cards) slot.el.remove();
      flat.cards = [];
    }

    let lastWidth = Math.max(1, window.innerWidth);
    function onResize() {
      const w = Math.max(1, window.innerWidth);
      /* 安卓 WebView 地址栏收起只改高度，别因此把环收掉 */
      if (Math.abs(w - lastWidth) < 2) return;
      lastWidth = w;
      if (!items.length) return;
      refresh();
    }

    function onVisibility() {
      if (document.hidden) {
        stopFlat();
        if (ring && ring.raf) { cancelAnimationFrame(ring.raf); ring.raf = 0; }
      } else {
        if (!ring) wakeFlat();
        else wakeRing();
      }
    }

    strip.addEventListener('pointerdown', onStripDown);
    strip.addEventListener('contextmenu', preventCtx, true);
    strip.addEventListener('dragstart', preventCtx, true);
    track.addEventListener('click', onFlatClick);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    /* 初次给一次布局（数据通常随后才来） */
    measureFlat();
    layoutFlat(true);

    return {
      setItems,
      refresh,
      open,
      close,
      isOpen,
      setPlaying,
      destroy,
    };
  }

  window.MobileRing = { create };
})();
