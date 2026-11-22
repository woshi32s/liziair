/* 形态页鼓点波形条（2026-11-17）—— F3 开关，底鼓响一下整条闪一下。
 *
 * 数据只从已有的音频图里拿：createMediaElementSource 对同一个 <audio> 只能调
 * 一次，beat.js → kick.js → EQ 那张图早就建好了。这里绝不新建 AudioContext，
 * 也绝不碰 <audio>，只消费 Beat.onGraph 给的主 analyser（EQ 之后的那个）。
 *
 * 图画在 canvas 上而不是几十个 DOM 柱子上：形态页本身可能就是重 WebGL，
 * 每帧改一堆元素的高度比重画一张 220×44 的小画布贵得多。rAF 压到 ~30fps。
 *
 * F3 有两条路：
 *   1) 焦点在父页面：window 捕获阶段直接收；
 *   2) 焦点在 #stage-frame：父文档收不到键盘事件（同源也不会跨文档冒泡），
 *      往 iframe 的 window 里补挂一份 —— 和 lyric-delay.js 的 hookFrame 同一招。
 *      跨域沙箱挂不上时，等舞台自己 postMessage 转发
 *      {__c100:1, type:'key', payload:{key:'F3'}}。
 *
 * 接线：index.html 里紧跟 kick.js 之后加载本文件（要先有 window.LIZI_KICK）。
 * 对外只暴露 window.LIZI_STAGEVIZ（控制台可调）。
 */
(() => {
  'use strict';
  if (window.__stageVizReady) return;
  window.__stageVizReady = true;

  const BeatRef = (typeof Beat !== 'undefined') ? Beat : (window.Beat || null);
  const KickRef = window.LIZI_KICK ||
    ((typeof LIZI_KICK !== 'undefined') ? LIZI_KICK : null);

  const FRAME_MS = 33;          // ~30fps：形态页可能是重 WebGL，别抢帧
  const META_MS = 150;          // 遥测文本节流间隔（零重排负担）
  const FLASH_MS = 130;         // 鼓点闪一下的时长（任务定 100–140ms）
  const FLASH_MIN = 0.12;       // 最轻的鼓点也要看得出来
  const FLASH_MAX = 0.46;       // 最重不过半透明，别把波形盖没了
  const BAR_GAP = 1.7;          // 波形柱之间的空隙（CSS 像素）
  const MIN_BAR = 1.4;          // 静音时留一条细线，别整条消失

  let el = null;                // #stage-viz
  let waveEl = null;            // 做 scaleY 弹跳的容器
  let flashEl = null;           // 独立的闪光层
  let bpmEl = null;             // 底部左侧 BPM 读数
  let posEl = null;             // 底部右侧小节/段落/状态读数
  let canvas = null;
  let g2d = null;
  let waveColor = 'rgba(255,255,255,.72)';

  let enabled = false;          // F3 开关（离开形态页也记着）
  let onStage = false;          // document.body.dataset.view === 'stage'
  let rafId = 0;
  let lastDrawAt = 0;
  let lastMetaAt = 0;
  let lastBpmText = '';
  let lastPosText = '';
  let lastToggleAt = 0;         // iframe hook 与 postMessage 转发去重

  let analyser = null;
  let timeData = null;

  let frameEnergy = 0;          // Beat frame 兜底能量（0..1）
  let frameAt = 0;

  let flashAnim = null;
  let waveAnim = null;

  let canvasW = 248, canvasH = 40;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));

  function isPlaying() {
    return !!(BeatRef && BeatRef.state && BeatRef.state.playing);
  }

  function isStageView() {
    return !!(document.body && document.body.dataset.view === 'stage');
  }

  /* ------------------------------------------------------------------ *
   * 音频：只订阅，不建图
   * ------------------------------------------------------------------ */
  function hookAudio() {
    if (BeatRef && typeof BeatRef.onGraph === 'function') {
      try {
        /* 图已建好会立刻回调一次；没建好就等它建。回调只会来一次，
           analyser 不会随 EQ 重接而换对象，所以拿到就存住。 */
        BeatRef.onGraph((graph) => {
          const a = graph && graph.analyser;
          if (!a || typeof a.getByteTimeDomainData !== 'function') return;
          analyser = a;
          try { timeData = new Uint8Array(a.fftSize); }
          catch (e) { timeData = new Uint8Array(2048); }
        });
      } catch (e) { /* 图还没建好：rAF 会退化成 frame 能量抖动 */ }
    }

    /* 兜底数据源：graph / analyser 还没好时，用 beat.js 算好的三频段能量
       假装一段波形。只读 state，不参与任何信号处理。 */
    if (BeatRef && typeof BeatRef.on === 'function') {
      try {
        BeatRef.on('frame', (s) => {
          const st = s || BeatRef.state;
          if (!st) return;
          frameEnergy = clamp01(num(st.bass) * 1.15 + num(st.mid) * 0.55 + num(st.treble) * 0.3);
          frameAt = performance.now();
        });
      } catch (e) { /* 忽略 */ }
    }

    if (KickRef && typeof KickRef.on === 'function') {
      try { KickRef.on(onKick); } catch (e) { /* 忽略 */ }
    }
  }

  function onKick(evt) {
    if (!enabled || !isStageView() || document.hidden) return;
    if (!isPlaying()) return;             // 暂停后残留的触发不闪
    pulse(clamp01(evt && evt.energy));
  }

  /* 只动 opacity / transform：这两样走合成层，不会让 WebGL 画布跟着重绘。
     WAAPI 而不是 CSS 类切换，是因为连击时可以 cancel 上一段重新起，
     不会出现"类名来不及重排、第二下不闪"的问题。 */
  function pulse(energy) {
    if (!flashEl || !waveEl || typeof flashEl.animate !== 'function') return;
    const alpha = FLASH_MIN + (FLASH_MAX - FLASH_MIN) * energy;
    const scale = 1.025 + energy * 0.055;
    try {
      if (flashAnim) flashAnim.cancel();
      flashAnim = flashEl.animate(
        [{ opacity: alpha }, { opacity: 0 }],
        { duration: FLASH_MS, easing: 'ease-out' }
      );
      if (waveAnim) waveAnim.cancel();
      waveAnim = waveEl.animate(
        [{ transform: 'scaleY(' + scale.toFixed(3) + ')' }, { transform: 'scaleY(1)' }],
        { duration: FLASH_MS + 30, easing: 'cubic-bezier(.2,.8,.3,1)' }
      );
    } catch (e) { /* 老 WebView 没有 WAAPI：不闪也不影响波形 */ }
  }

  /* ------------------------------------------------------------------ *
   * 绘制
   * ------------------------------------------------------------------ */
  function readTimeData() {
    if (!analyser || !timeData) return false;
    try {
      analyser.getByteTimeDomainData(timeData);
      return true;
    } catch (e) {
      analyser = null;                    // 图被拆掉 / 节点失效：退回能量抖动
      timeData = null;
      return false;
    }
  }

  function drawFlatLine(cy, padX, plotW) {
    g2d.fillStyle = 'rgba(255,255,255,.40)';
    g2d.fillRect(padX, cy - 0.5, plotW, 1);
  }

  /* 没拿到时间域数据时的假波形：中间高、两端收，再叠一点随时间的抖动。
     幅度只跟 frameEnergy 走，所以暂停时它会自己归零。 */
  function fallbackLevel(i, bars, now) {
    const e = frameEnergy;
    if (e < 0.02) return 0;
    const x = bars > 1 ? i / (bars - 1) : 0.5;
    const arch = Math.sin(x * Math.PI);
    const wobble = 0.55 + 0.45 * Math.sin(x * Math.PI * 7 + now / 120 + i * 0.9);
    return Math.min(1, (0.10 + e * 1.45) * arch * wobble);
  }

  function readStageTelemetry() {
    try {
      const f = document.getElementById('stage-frame');
      const win = f && f.contentWindow;
      const t = win && win.__stageTelemetry;
      if (t && typeof t === 'object' && Number.isFinite(Number(t.bpm)) && Number(t.bpm) > 0) {
        return t;
      }
    } catch (e) {
      /* 跨域 / 沙箱形态安全忽略，回退 BeatRef.state */
    }
    return null;
  }

  function updateMeta(now, force) {
    if (!bpmEl || !posEl) return;
    if (!force && now - lastMetaAt < META_MS) return;
    lastMetaAt = now;

    const tel = readStageTelemetry();
    let bpmText = '-- BPM';
    let posText = '';

    if (tel) {
      const bpm = num(tel.bpm);
      const lockMark = tel.bpmLocked ? '·L' : '·~';
      bpmText = (bpm >= 30 && bpm <= 260) ? (bpm.toFixed(1) + ' BPM' + lockMark) : '-- BPM';

      const parts = [];
      const bar = Math.floor(num(tel.bar));
      const beat = Math.floor(num(tel.beat));
      if (bar >= 1 && beat >= 1) parts.push('B' + bar + '.' + beat);
      if (tel.section) {
        parts.push(String(tel.section));
      } else if (tel.tempoMode === 'bar4' || tel.tempoMode === 'bar8') {
        parts.push('FLOW');
      }
      posText = parts.join(' · ');
    } else {
      const st = BeatRef && BeatRef.state;
      const bpm = st ? num(st.bpm) : 0;
      if (bpm >= 30 && bpm <= 260) bpmText = bpm.toFixed(1) + ' BPM';
      if (!isPlaying()) {
        posText = 'PAUSED';
      } else {
        const conf = st && Number.isFinite(Number(st.confidence)) ? clamp01(st.confidence) : 0;
        const pct = Math.round(clamp01(frameEnergy) * 100);
        posText = conf > 0 ? ('C' + Math.round(conf * 100) + '% · E' + pct + '%') : ('LIVE · E' + pct + '%');
      }
    }

    if (bpmText !== lastBpmText) {
      lastBpmText = bpmText;
      bpmEl.textContent = bpmText;
    }
    if (posText !== lastPosText) {
      lastPosText = posText;
      posEl.textContent = posText;
    }
  }

  function draw(now) {
    updateMeta(now, false);
    if (!g2d) return;
    const w = canvasW, h = canvasH;
    g2d.clearRect(0, 0, w, h);

    const cy = h / 2;
    const padX = Math.max(6, Math.round(w * 0.045));
    const padY = 5;
    const plotW = Math.max(6, w - padX * 2);
    const maxH = Math.max(2, h - padY * 2);

    /* 暂停 / 没音频：一条静止直线，绝不留着上一帧的波形 */
    if (!isPlaying()) {
      drawFlatLine(cy, padX, plotW);
      return;
    }

    const live = readTimeData();
    if (!live && now - frameAt > 600) {
      // 图还没建好，Beat 的 frame 也停了：没有可用的动态数据
      drawFlatLine(cy, padX, plotW);
      return;
    }

    const bars = Math.max(18, Math.round(plotW / 4.6));
    const slot = plotW / bars;
    const barW = Math.max(1, slot - BAR_GAP);
    g2d.fillStyle = waveColor;

    for (let i = 0; i < bars; i++) {
      let v;
      if (live) {
        /* 时间域：每根柱子吃掉一段样本，取这段里偏离中点（128）最多的值。
           取峰值而不是平均，波形才有"动态"的样子，不会糊成一条带。 */
        const len = timeData.length;
        const a = Math.floor((i * len) / bars);
        const b = Math.max(a + 1, Math.floor(((i + 1) * len) / bars));
        let peak = 0;
        for (let j = a; j < b && j < len; j++) {
          const s = Math.abs(timeData[j] - 128) / 128;
          if (s > peak) peak = s;
        }
        v = Math.min(1, Math.pow(peak, 0.72) * 1.2);
      } else {
        v = fallbackLevel(i, bars, now);
      }

      /* 上下对称：柱子以中线为中心，总高 = 峰值 × 可用高度 */
      const bh = Math.max(MIN_BAR, v * maxH);
      const x = padX + i * slot + (slot - barW) / 2;
      g2d.fillRect(x, cy - bh / 2, barW, bh);
    }
  }

  function loop(now) {
    rafId = 0;
    if (!enabled || !onStage || document.hidden) return;
    if (now - lastDrawAt >= FRAME_MS) {
      lastDrawAt = now;
      draw(now);
    }
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) return;
    lastDrawAt = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function syncCanvas() {
    if (!el || !canvas || !g2d) return;
    /* 只量波形上半区 waveEl 的尺寸，确保波形绝不压到底部遥测文字；
       display:none 时量到 0，直接跳过，等下次显示再量。 */
    const box = waveEl || el;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    canvasW = w;
    canvasH = h;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;                  // 会同时清空画布、重置变换
      canvas.height = bh;
    }
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2d.clearRect(0, 0, w, h);
  }

  /* ------------------------------------------------------------------ *
   * 显示 / 隐藏
   * ------------------------------------------------------------------ */
  function sync() {
    if (!el) return;
    onStage = isStageView();
    const visible = enabled && onStage;
    el.classList.toggle('is-on', visible);
    if (visible && !document.hidden) {
      syncCanvas();
      updateMeta(performance.now(), true);
      startLoop();
    } else {
      stopLoop();
    }
  }

  function setEnabled(next) {
    enabled = !!next;
    sync();
    return enabled;
  }

  function show() { return setEnabled(true); }
  function hide() { return setEnabled(false); }
  function toggle() { return setEnabled(!enabled); }

  /* ------------------------------------------------------------------ *
   * 键盘
   * ------------------------------------------------------------------ */
  function onKey(e) {
    if (e.key !== 'F3' && e.code !== 'F3') return;
    if (!isStageView()) return;           // 只在形态页接管，播放页的 F3 原样放行
    if (e.repeat) return;

    const t = e.target;
    const tag = (t && t.tagName) ? String(t.tagName) : '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;

    e.preventDefault();                   // 压住浏览器默认的「查找下一个」
    lastToggleAt = performance.now();
    toggle();
  }

  /* 沙箱形态自己转发 F3（协议和 app.js 里 Space 的转发一致）。
     和 iframe hook 可能同时到，300ms 内只认一次，免得来回切两下。 */
  function onMessage(e) {
    const d = e.data;
    if (!d || d.__c100 !== 1 || d.type !== 'key' || !d.payload) return;
    const key = d.payload.key;
    if (key !== 'F3' && key !== 'f3') return;
    if (!isStageView()) return;
    const now = performance.now();
    if (now - lastToggleAt < 300) return;
    lastToggleAt = now;
    toggle();
  }

  /* 焦点在舞台 iframe 里时父页面收不到 keydown。往 iframe 的 window 上挂
     捕获阶段监听，比舞台自己 document 上的监听更早。换形态会重建文档，
     所以和 lyric-delay.js 一样轮询补挂。 */
  function hookFrame() {
    try {
      const f = document.getElementById('stage-frame');
      const win = f && f.contentWindow;
      if (!win || win.__svizHooked) return;
      win.__svizHooked = true;
      win.addEventListener('keydown', onKey, true);
    } catch (e) {
      /* 跨域沙箱挂不上：只能等舞台自己 postMessage 转发 F3 */
    }
  }

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */
  function init() {
    const host = document.getElementById('view-stage');
    if (!host) return;                    // 没有形态页就静默放弃

    el = document.createElement('div');
    el.id = 'stage-viz';
    el.className = 'sviz';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="sviz__wave"><canvas class="sviz__canvas"></canvas></div>' +
      '<div class="sviz__meta"><span class="sviz__bpm">-- BPM</span><span class="sviz__pos"></span></div>' +
      '<div class="sviz__flash"></div>';
    host.appendChild(el);

    waveEl = el.querySelector('.sviz__wave');
    flashEl = el.querySelector('.sviz__flash');
    bpmEl = el.querySelector('.sviz__bpm');
    posEl = el.querySelector('.sviz__pos');
    canvas = el.querySelector('.sviz__canvas');
    try { g2d = canvas && canvas.getContext('2d'); } catch (e) { g2d = null; }

    /* 波形颜色放在 CSS 变量里，和样式表保持同一个来源 */
    try {
      const c = getComputedStyle(el).getPropertyValue('--sviz-wave').trim();
      if (c) waveColor = c;
    } catch (e) { /* 忽略 */ }

    hookAudio();

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', () => {
      if (el && el.classList.contains('is-on')) syncCanvas();
    });

    /* app.js 的 show() 会写 body[data-view]；盯住它比轮询便宜 */
    onStage = isStageView();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(sync).observe(document.body, {
        attributes: true,
        attributeFilter: ['data-view'],
      });
    }

    setInterval(hookFrame, 700);
    window.addEventListener('load', hookFrame);
    hookFrame();

    sync();
  }

  /* 对外入口（控制台调试 / 以后接设置项用） */
  window.LIZI_STAGEVIZ = {
    show,
    hide,
    toggle,
    get on() { return enabled; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
