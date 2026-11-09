/* 歌声延迟 / lyric delay —— 全局通用，对所有舞台生效。
 *
 * 现实中「听到的歌声」总比 audio.currentTime 晚一点（蓝牙、外接声卡、HDMI 回传
 * 都是几十到几百毫秒）。舞台按 currentTime 走歌词，于是总抢在歌声前面。
 * 这里给歌词时间轴加一个可正可负的偏移，把它压回去。
 *
 *   正数 = 歌声听起来更晚 → 歌词跟着往后压（最常用）
 *   负数 = 歌声比画面早   → 歌词往前抢
 *
 * 实现只有一条：postMessage 的 tick.time 统一减 offset（见 app.js 的 startTick）。
 * 舞台内部一行都不用改。
 *
 * F5 开关面板；Ctrl+F5 仍然转发舞台自带的调参面板（老舞台 001/026/359 在用）。
 */
(() => {
  'use strict';
  if (window.__lyricDelayReady) return;
  window.__lyricDelayReady = true;

  const KEY = 'lyriDelayMs';
  const MIN = -3000, MAX = 3000;

  const read = () => {
    let v = 0;
    try { v = Math.round(Number(localStorage.getItem(KEY)) || 0); } catch (e) { /* 隐私模式 */ }
    return Math.max(MIN, Math.min(MAX, v));
  };

  let ms = read();
  window.__lyricDelayMs = ms;

  const apply = (next) => {
    ms = Math.max(MIN, Math.min(MAX, Math.round(next)));
    window.__lyricDelayMs = ms;
    try { localStorage.setItem(KEY, String(ms)); } catch (e) { /* 忽略 */ }
    paint();
  };

  /* ---------------- 面板 ---------------- */

  const CSS = [
    '.ldp-mask{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;',
    'background:radial-gradient(circle at 50% 45%,rgba(0,0,0,.32),rgba(0,0,0,.62));',
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '.ldp-mask.on{display:flex}',
    '.ldp,.ldp *{box-sizing:border-box}',
    '.ldp{width:min(92vw,404px);padding:20px 20px 15px;border-radius:20px;color:#f4f6ff;',
    'background:linear-gradient(180deg,rgba(30,34,50,.93),rgba(15,17,26,.96));',
    'border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.10);',
    'font:500 13px/1.45 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none}',
    '.ldp-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px}',
    '.ldp-hd b{font-size:15px;font-weight:600;letter-spacing:.02em}',
    '.ldp-hd span{font-size:11px;opacity:.45}',
    '.ldp-val{display:flex;align-items:baseline;justify-content:center;gap:6px;margin:2px 0 6px}',
    '.ldp-num{font:600 44px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.02em;',
    'font-variant-numeric:tabular-nums;transition:color .18s}',
    '.ldp-unit{font-size:13px;opacity:.5}',
    '.ldp-say{text-align:center;font-size:12px;opacity:.55;min-height:17px;margin-bottom:14px}',
    '.ldp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.ldp-grid button{padding:11px 0;border-radius:12px;cursor:pointer;color:#eef1ff;font:600 14px/1 inherit;',
    'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);transition:background .12s,transform .08s}',
    '.ldp-grid button:hover{background:rgba(255,255,255,.14)}',
    '.ldp-grid button:active{transform:scale(.96)}',
    '.ldp-grid button.eq{color:#9fb0ff}',
    '.ldp-ft{margin-top:14px;font-size:11px;line-height:1.7;opacity:.42;text-align:center}',
    '.ldp-ft kbd{font:600 10px/1 ui-monospace,monospace;padding:2px 4px;border-radius:4px;',
    'background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.12)}'
  ].join('');

  const st = document.createElement('style');
  st.id = 'lyric-delay-style';
  st.textContent = CSS;
  document.head.appendChild(st);

  const mask = document.createElement('div');
  mask.className = 'ldp-mask';
  mask.innerHTML =
    '<div class="ldp" role="dialog" aria-label="歌声延迟">' +
      '<div class="ldp-hd"><b>歌声延迟</b><span>F5 关闭</span></div>' +
      '<div class="ldp-val"><span class="ldp-num">0</span><span class="ldp-unit">ms</span></div>' +
      '<div class="ldp-say"></div>' +
      '<div class="ldp-grid">' +
        '<button data-d="-100">−100</button><button data-d="-20">−20</button><button data-d="-5">−5</button>' +
        '<button data-d="5">+5</button><button data-d="20">+20</button><button data-d="100">+100</button>' +
      '</div>' +
      '<div class="ldp-ft">' +
        '<kbd>←</kbd><kbd>→</kbd> 5ms · <kbd>Shift</kbd> 20ms · <kbd>0</kbd> 归零 · 正数=歌词往后压<br>' +
        '对所有舞台生效，重启后保留' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  const elNum = mask.querySelector('.ldp-num');
  const elSay = mask.querySelector('.ldp-say');

  function paint() {
    const n = ms;
    elNum.textContent = n > 0 ? '+' + n : String(n);
    elNum.style.color = n === 0 ? '#f4f6ff' : (n > 0 ? '#8fd0ff' : '#ffb27a');
    elSay.textContent = n === 0
      ? '不偏移'
      : (n > 0 ? '歌词延后 ' + (n / 1000).toFixed(2) + ' 秒（歌声偏慢时加）'
               : '歌词提前 ' + (-n / 1000).toFixed(2) + ' 秒（歌声偏快时减）');
  }
  paint();

  let open = false;
  function show(on) {
    open = on !== false;
    mask.classList.toggle('on', open);
  }

  mask.addEventListener('click', (e) => {
    if (e.target === mask) return show(false);
    const b = e.target.closest('[data-d]');
    if (b) apply(ms + Number(b.dataset.d));
  });

  /* ---------------- 键盘 ---------------- */

  const isF5 = (e) => e.key === 'F5' || e.code === 'F5';
  const isAltHotkey = (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l');

  /* 一份键盘逻辑，父页面和舞台 iframe 共用。
     fromFrame = 事件来自舞台 iframe：那边没有面板，F5 只能转给父页面。 */
  function onKey(e, fromFrame) {
    const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
    if (isF5(e) || isAltHotkey(e)) {
      e.preventDefault();
      if (isF5(e) && (e.ctrlKey || e.metaKey)) {   // Ctrl+F5：老舞台自带的调参面板
        const f = document.getElementById('stage-frame');
        try { if (f && f.contentWindow) f.contentWindow.postMessage({ __c100: 1, type: 'panel' }, '*'); } catch (err) { /* 忽略 */ }
        return;
      }
      show(!open);
      if (fromFrame && open) { try { window.focus(); } catch (err) { /* 忽略 */ } }
      return;
    }
    if (!open || typing) return;
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(ms - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); apply(ms + step); }
    else if (e.key === '0' || e.key === 'r' || e.key === 'R') { e.preventDefault(); apply(0); }
    else if (e.key === 'Escape') { e.preventDefault(); show(false); }
  }

  window.addEventListener('keydown', (e) => onKey(e, false), true);

  /* 焦点在舞台 iframe 里时，父页面的 keydown 根本收不到（同源也不会跨文档冒泡）
     —— 这就是「F5 按不出来」。直接往 iframe 文档里塞一份同样的监听。
     舞台切换会重建文档，所以轮询补挂。 */
  function hookFrame() {
    try {
      const f = document.getElementById('stage-frame');
      const win = f && f.contentWindow;
      if (!win || win.__ldpHooked) return;
      win.__ldpHooked = true;
      /* 挂在 iframe 的 window 上（捕获阶段第一个点），比舞台自己 document 上的监听更早 */
      win.addEventListener('keydown', (e) => onKey(e, true), true);
    } catch (err) { /* 万一跨域就放着 */ }
  }
  setInterval(hookFrame, 700);
  window.addEventListener('load', hookFrame);
  hookFrame();

  /* 对外入口（控制台调试用） */
  window.__lyricDelayToggle = () => show(!open);
  window.__lyricDelay = {
    get ms() { return ms; },
    set: apply,
    reset: () => apply(0),
    open: (on) => show(on !== false)
  };
})();
