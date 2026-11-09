'use strict';

/*
 * Stage AR 配对层（播放器用）
 * F8 或 Ctrl+Shift+8 打开：向 stage-ar 服务要配置，显示手机地址与二维码。
 * 零外部资源；遮罩用内联 CSS，不依赖播放器样式。
 */
(function () {
  var PORTS = [8450, 8460, 8470, 8480];
  var SERVER_CMD = 'node E:\\Claude code\\stage-ar\\server.js';
  var state = {
    open: false,
    busy: false,
    token: 0,
    base: null,
    config: null,
    overlay: null,
    qr: null,
    url: null,
    note: null,
    error: null,
    loading: null,
    qrWrap: null
  };

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function injectStyle() {
    if (document.getElementById('ar-pair-style')) return;
    var style = document.createElement('style');
    style.id = 'ar-pair-style';
    style.textContent = [
      '#ar-pair-veil{position:fixed; inset:0; z-index:2147483000; display:none;',
      '  align-items:center; justify-content:center; padding:20px; box-sizing:border-box;',
      '  background:rgba(3,3,8,.82); -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px);',
      '  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;',
      '  -webkit-font-smoothing:antialiased;}',
      '#ar-pair-veil.show{display:flex;}',
      '#ar-pair-card{width:min(440px, 100%); max-height:calc(100vh - 40px); overflow:auto;',
      '  box-sizing:border-box; padding:24px 24px 18px; border-radius:20px;',
      '  background:linear-gradient(180deg, rgba(22,21,38,.98), rgba(12,11,22,.98));',
      '  border:1px solid rgba(158,136,255,.30);',
      '  box-shadow:0 30px 90px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);',
      '  color:#eef0ff; text-align:center;}',
      '#ar-pair-card .ar-eyebrow{font:400 9.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
      '  letter-spacing:.32em; color:rgba(190,186,240,.48);}',
      '#ar-pair-card h2{margin:8px 0 18px; font-size:22px; font-weight:800; letter-spacing:.10em;',
      '  text-shadow:0 0 26px rgba(140,110,255,.45);}',
      '#ar-pair-qr{width:236px; height:236px; margin:0 auto; box-sizing:border-box;',
      '  display:flex; align-items:center; justify-content:center; overflow:hidden;',
      '  border-radius:14px; background:#f2f1fa; border:1px solid rgba(255,255,255,.12);}',
      '#ar-pair-qr img{width:220px; height:220px; display:block; image-rendering:pixelated;}',
      '#ar-pair-qr.loading img{display:none;}',
      '#ar-pair-qr .ar-loading{font:500 11px/1.6 "PingFang SC","Microsoft YaHei",sans-serif;',
      '  color:rgba(20,19,32,.64); letter-spacing:.10em; padding:0 18px;}',
      '#ar-pair-qr:not(.loading) .ar-loading{display:none;}',
      '#ar-pair-url{margin:18px 0 4px; font:500 14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
      '  letter-spacing:.01em; color:rgba(226,224,255,.92); word-break:break-all;',
      '  -webkit-user-select:all; user-select:all; cursor:text;}',
      '#ar-pair-note{margin:12px 0 0; font-size:11.5px; line-height:1.85;',
      '  color:rgba(198,200,232,.62);}',
      '#ar-pair-note b{color:rgba(214,196,255,.86); font-weight:600;}',
      '#ar-pair-err{display:none; margin:16px 0 0; padding:13px 14px; border-radius:12px;',
      '  text-align:left; font-size:12px; line-height:1.8;',
      '  border:1px solid rgba(255,170,120,.28); background:rgba(255,150,90,.07);',
      '  color:rgba(255,214,184,.86);}',
      '#ar-pair-err.show{display:block;}',
      '#ar-pair-err code{display:block; margin-top:6px; padding:8px 10px; border-radius:8px;',
      '  background:rgba(0,0,0,.34); color:rgba(255,238,214,.95);',
      '  font:500 11.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
      '  word-break:break-all; -webkit-user-select:all; user-select:all;}',
      '#ar-pair-close{margin-top:16px; font:400 9.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
      '  letter-spacing:.18em; color:rgba(178,182,214,.38);}',
      '@media (max-width:420px){ #ar-pair-card{padding:20px 16px 14px;} }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (state.overlay) return;
    injectStyle();

    var veil = make('div');
    veil.id = 'ar-pair-veil';

    var card = make('div');
    card.id = 'ar-pair-card';

    card.appendChild(make('div', 'ar-eyebrow', 'STAGE AR / 542'));
    card.appendChild(make('h2', null, '手机扫码进入'));

    var qrWrap = make('div', 'loading');
    qrWrap.id = 'ar-pair-qr';
    var loading = make('div', 'ar-loading', '正在查找本地服务…');
    var img = document.createElement('img');
    img.alt = '手机打开地址的二维码';
    img.decoding = 'async';
    qrWrap.appendChild(loading);
    qrWrap.appendChild(img);
    card.appendChild(qrWrap);

    var url = make('div', null, '—');
    url.id = 'ar-pair-url';
    card.appendChild(url);

    var note = make('div');
    note.id = 'ar-pair-note';
    card.appendChild(note);

    var err = make('div');
    err.id = 'ar-pair-err';
    card.appendChild(err);

    card.appendChild(make('div', null, 'F8 / Esc 关闭 · 也可点击遮罩')).id = 'ar-pair-close';

    veil.appendChild(card);
    document.body.appendChild(veil);

    veil.addEventListener('click', function (e) {
      if (e.target === veil) close();
    });

    state.overlay = veil;
    state.qrWrap = qrWrap;
    state.qr = img;
    state.url = url;
    state.note = note;
    state.error = err;
    state.loading = loading;
  }

  function setLoading(on, text) {
    if (!state.qrWrap) return;
    state.qrWrap.classList.toggle('loading', !!on);
    if (text && state.loading) state.loading.textContent = text;
  }

  function showError(text, detail) {
    if (!state.error) return;
    state.error.innerHTML = '';
    var p = make('div', null, text);
    state.error.appendChild(p);
    if (detail) {
      var c = document.createElement('code');
      c.textContent = detail;
      state.error.appendChild(c);
    }
    state.error.classList.add('show');
  }

  function clearError() {
    if (!state.error) return;
    state.error.classList.remove('show');
    state.error.textContent = '';
  }

  function fetchJson(url, timeout) {
    return new Promise(function (resolve, reject) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        reject(new Error('timeout'));
      }, timeout);
      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.json();
        })
        .then(function (body) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(body);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function probeConfig() {
    var i = 0;
    function next() {
      if (i >= PORTS.length) {
        return Promise.reject(new Error('已尝试端口 ' + PORTS.join(' / ') + '，均未响应'));
      }
      var port = PORTS[i++];
      var base = 'http://127.0.0.1:' + port;
      return fetchJson(base + '/api/config', 1000).then(function (cfg) {
        if (!cfg || typeof cfg.url !== 'string' || !/^https?:\/\//.test(cfg.url)) {
          throw new Error('配置格式异常');
        }
        cfg._base = base;
        return cfg;
      }).catch(function () {
        return next();
      });
    }
    return next();
  }

  function renderConfig(cfg) {
    state.base = cfg._base;
    state.config = cfg;

    clearError();
    setLoading(false);
    state.url.textContent = cfg.url;

    state.qr.onerror = function () {
      setLoading(true, '二维码生成失败');
      showError('服务已连上，但 /qr.png 没有返回图片。',
        'curl ' + cfg._base + '/qr.png --output qr.png');
    };
    state.qr.src = cfg._base + '/qr.png?t=' + Date.now();

    var https = cfg.httpsPort ? ('HTTPS ' + cfg.httpsPort) : 'HTTPS 未启动';
    state.note.innerHTML = '';
    state.note.appendChild(make('div', null,
      '手机与电脑需同一 Wi-Fi · ' + https));
    var line2 = make('div');
    line2.innerHTML = '首次打开会提示证书不安全：选择 <b>高级 → 继续访问</b>；<br>然后轻触画面，允许摄像头与方向权限。';
    state.note.appendChild(line2);

    if (cfg.secure === false) {
      showError('服务没有启用 HTTPS，手机浏览器会拒绝摄像头。请检查证书生成与 8443/8543/8643 端口。');
    }
  }

  function renderError(err) {
    setLoading(true, '没有找到本地服务');
    state.url.textContent = '—';
    state.note.textContent = '';
    showError(
      '请先运行 stage-ar 服务，然后重新按 F8。',
      SERVER_CMD
    );
    var extra = make('div', null,
      '已尝试端口 ' + PORTS.join(' / ') + '。若都无响应，说明服务没在运行（或被安全软件拦截）；' +
      '服务启动后会自动避开被占用的端口，所以请以它打印的地址为准。');
    extra.style.marginTop = '10px';
    state.error.appendChild(extra);
    if (err && err.message) {
      var e2 = make('div', null, '探测结果：' + err.message);
      e2.style.marginTop = '6px';
      e2.style.opacity = '.72';
      state.error.appendChild(e2);
    }
  }

  function load() {
    var token = ++state.token;
    state.busy = true;
    clearError();
    setLoading(true, '正在查找本地服务（8450 → 8480）…');
    state.url.textContent = '—';
    state.note.textContent = '';

    probeConfig().then(function (cfg) {
      if (token !== state.token || !state.open) return;
      state.busy = false;
      renderConfig(cfg);
    }).catch(function (err) {
      if (token !== state.token || !state.open) return;
      state.busy = false;
      renderError(err);
    });
  }

  function open() {
    ensureOverlay();
    state.open = true;
    state.overlay.classList.add('show');
    load();
  }

  function close() {
    state.open = false;
    state.token++;
    if (state.overlay) state.overlay.classList.remove('show');
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function onKey(e) {
    var isF8 = (e.key === 'F8' || e.keyCode === 119);
    var isCtrlShift8 = e.ctrlKey && e.shiftKey && (e.key === '8' || e.code === 'Digit8' || e.keyCode === 56);
    if (isF8 || isCtrlShift8) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      toggle();
      return;
    }
    if (state.open && (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27)) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  document.addEventListener('keydown', onKey, true);

  /* 舞台在 iframe 里：焦点落在 iframe 时按键不会冒泡到父页，同源时补挂一份。 */
  function bindStageFrame() {
    var frame = document.getElementById('stage-frame');
    if (!frame) return;
    function attach() {
      try {
        var doc = frame.contentDocument;
        if (!doc || doc.__arPairBound) return;
        doc.__arPairBound = true;
        doc.addEventListener('keydown', onKey, true);
      } catch (e) {}
    }
    attach();
    frame.addEventListener('load', attach);
  }
  bindStageFrame();

  /* 也暴露一个入口，便于 Electron 菜单/控制台触发 */
  try {
    window.__stageARPair = { open: open, close: close, toggle: toggle };
  } catch (e) {}

  /* ================================================================== *
   * 歌词同步：嗅探播放器 → 舞台的 postMessage（同源 iframe），
   * 只把「状态变化」推给 stage-ar，再由它广播给手机。
   * 不改 app.js，也不影响播放：所有网络调用都静默失败。
   * ================================================================== */
  var LS_PORTS = [8450, 8460, 8470, 8480];
  var LS_MAX_BODY = 256 * 1024;

  var LS = {
    win: null,
    recoverTimer: 0,
    hasInit: false,
    needInit: false,
    lyrics: [],
    song: null,
    duration: 0,
    lastTickT: 0,
    lastTickPlaying: false,
    lastTickAt: 0,
    stallT: null,
    stallSince: 0,
    sent: { t: null, idx: -1, playing: null, at: 0 },
    lastPushAt: 0,
    base: null,
    portIdx: 0,
    inFlight: false,
    queue: null,
    retryAt: 0,
    lastLiveAt: 0,
    lastBeatAt: 0,
    beatTimer: 0,
    camTimer: 0,
    camBusy: false,
    lastCamKey: '',
    lastCamAt: 0,
    lastInitTryAt: 0,
    lastInitOkAt: 0
  };

  function lsNum(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function lsClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function lsIdxAt(t) {
    var a = LS.lyrics, n = a.length;
    var lo = 0, hi = n - 1, best = -1;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (a[m].t <= t + 0.02) { best = m; lo = m + 1; }
      else hi = m - 1;
    }
    return best;
  }

  /* 上次推给服务器的时刻 + 本地流逝时间；用来判断播放器是否 seek。 */
  function lsPredictedT() {
    var s = LS.sent;
    if (s.t == null) return LS.lastTickT;
    if (!s.playing) return s.t;
    return s.t + (Date.now() - s.at) / 1000;
  }

  /* 播放器音频时钟（同源全局，只读）。舞台 tick 停掉时靠它给出正确的
     t / playing；读不到就返回 null，退回外推。 */
  function lsAudioClock() {
    try {
      if (typeof Player === 'undefined' || !Player || !Player.audio) return null;
      var a = Player.audio;
      var t = Number(a.currentTime);
      if (!isFinite(t) || t < 0) return null;
      return { t: t, playing: !a.paused };
    } catch (e) {
      return null;
    }
  }

  /* 时间既不动、又在报 playing（缓冲卡住）：按暂停上报，冻结在卡住点。
     不这么做，手机每收到一条状态就会倒退到卡住时刻，歌词反复往回跳。 */
  function lsStallGate(t, playing, now) {
    if (!playing) {
      LS.stallT = t;
      LS.stallSince = 0;
      return { t: t, playing: false };
    }
    if (LS.stallT == null || Math.abs(t - LS.stallT) > 0.002) {
      LS.stallT = t;
      LS.stallSince = 0;
      return { t: t, playing: true };
    }
    if (!LS.stallSince) LS.stallSince = now;
    if (now - LS.stallSince > 1500) {
      return { t: LS.stallT, playing: false };
    }
    return { t: t, playing: true };
  }

  function lsCleanLines(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (!l || typeof l !== 'object') continue;
      var text = (l.text == null) ? '' : String(l.text);
      if (!text) continue;
      var chars = null;
      if (Array.isArray(l.chars) && l.chars.length) {
        chars = [];
        for (var j = 0; j < l.chars.length; j++) {
          var c = l.chars[j];
          if (!c || typeof c !== 'object') continue;
          chars.push({
            c: String(c.c == null ? '' : c.c),
            t: lsNum(c.t, 0)
          });
        }
        if (!chars.length) chars = null;
      }
      out.push({
        t: lsNum(l.t, 0),
        dur: Math.max(0, lsNum(l.dur, 0)),
        text: text,
        chars: chars
      });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /* 单条消息硬上限 256KB：优先保留整句，必要时丢掉逐字时间。 */
  function lsBody(payload) {
    var body = JSON.stringify(payload);
    if (body.length <= LS_MAX_BODY) return body;
    if (payload.type !== 'init' || !Array.isArray(payload.lines)) return body;

    var slim = [];
    for (var i = 0; i < payload.lines.length; i++) {
      var l = payload.lines[i];
      if (!l) continue;
      slim.push({ t: l.t, dur: l.dur, text: l.text, chars: null });
    }
    var copy = {
      type: 'init', lines: slim, song: payload.song, duration: payload.duration,
      idx: payload.idx, t: payload.t, playing: payload.playing
    };
    body = JSON.stringify(copy);
    while (body.length > LS_MAX_BODY && copy.lines.length > 1) {
      copy.lines = copy.lines.slice(0, Math.max(1, Math.floor(copy.lines.length * 0.8)));
      body = JSON.stringify(copy);
    }
    return body;
  }

  function lsInitPayload(t, playing) {
    return {
      type: 'init',
      lines: LS.lyrics,
      song: LS.song,
      duration: LS.duration,
      idx: lsIdxAt(t),
      t: t,
      playing: playing
    };
  }

  /* 同一时刻只发一条；排队时保留最新状态（init 优先级最高）。 */
  function lsQueue(payload) {
    if (!LS.hasInit && payload.type !== 'init') return;
    var q = LS.queue;
    if (q && q.type === 'init' && payload.type !== 'init') return;
    if (q && (q.type === 'init' || q.type === 'state')
        && (payload.type === 'beat' || payload.type === 'live')) return;
    LS.queue = payload;
    lsFlush(false);
  }

  function lsFlush(force) {
    if (LS.inFlight || !LS.queue) return;
    if (!force && Date.now() < LS.retryAt) return;
    var payload = LS.queue;
    LS.queue = null;
    LS.inFlight = true;

    lsSend(payload).then(function (ok) {
      LS.inFlight = false;
      if (ok) {
        LS.retryAt = 0;
        if (payload.type === 'init') {
          LS.needInit = false;
          LS.lastInitOkAt = Date.now();
        }
        if (payload.type === 'init' || payload.type === 'state') {
          LS.sent = {
            t: payload.t,
            idx: payload.idx,
            playing: !!payload.playing,
            at: Date.now()
          };
          LS.lastPushAt = LS.sent.at;
        }
      } else {
        LS.retryAt = Date.now() + 3000;
        if (payload.type === 'init') {
          LS.needInit = true;
          LS.queue = payload;
          setTimeout(function () {
            if (LS.needInit) lsFlush(true);
          }, 3000);
        }
      }
      if (LS.queue) lsFlush(false);
    }).catch(function () {
      /* 理论上到不了这里；任何异常都只能静默退避。 */
      LS.inFlight = false;
      LS.retryAt = Date.now() + 3000;
      if (payload.type === 'init') LS.needInit = true;
    });
  }

  /* 依次尝试 8450/8460/8470/8480；成功后记住端口。失败完全静默。 */
  function lsSend(payload) {
    return new Promise(function (resolve) {
      var body;
      try { body = lsBody(payload); } catch (e) { resolve(false); return; }
      var finished = false;
      function done(ok) {
        if (finished) return;
        finished = true;
        resolve(ok);
      }

      function attempt(base, cached, portIdx) {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = setTimeout(function () {
          if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        }, 1200);
        var opts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        };
        if (body.length < 60000) opts.keepalive = true;

        try {
          fetch(base + '/api/lyric', opts).then(function (res) {
            clearTimeout(timer);
            if (res && res.status === 204) {
              if (!cached && portIdx != null) {
                LS.base = base;
                LS.portIdx = portIdx;
              }
              done(true);
            } else {
              if (cached) LS.base = null;
              next();
            }
          }).catch(function () {
            clearTimeout(timer);
            if (cached) LS.base = null;
            next();
          });
        } catch (e) {
          clearTimeout(timer);
          if (cached) LS.base = null;
          next();
        }
      }

      var i = 0;
      function next() {
        if (i >= LS_PORTS.length) { LS.base = null; done(false); return; }
        var idx = (LS.portIdx + i) % LS_PORTS.length;
        i++;
        attempt('http://127.0.0.1:' + LS_PORTS[idx], false, idx);
      }

      if (LS.base) attempt(LS.base, true, null);
      else next();
    });
  }

  function lsOnMessage(ev) {
    var d = ev && ev.data;
    if (!d || d.__c100 !== 1) return;
    try {
      if (d.type === 'init') {
        var p = d.payload || {};
        LS.lyrics = lsCleanLines(p.lines);
        LS.song = (p.song && typeof p.song === 'object') ? p.song : null;
        LS.duration = lsNum(p.duration, 0);
        LS.hasInit = true;
        LS.needInit = true;
        var t0 = (LS.sent.t == null) ? LS.lastTickT : lsPredictedT();
        var playing = (typeof p.playing === 'boolean') ? p.playing : LS.lastTickPlaying;
        lsQueue(lsInitPayload(t0, playing));
        return;
      }

      if (!LS.hasInit) return;
      var p2 = d.payload || {};

      if (d.type === 'tick') {
        var tRaw = Number(p2.time);
        if (!isFinite(tRaw)) return;
        var now = Date.now();
        LS.lastTickAt = now;
        var gate = lsStallGate(tRaw, !!p2.playing, now);
        var t = gate.t;
        var playing = gate.playing;
        LS.lastTickT = t;
        LS.lastTickPlaying = playing;

        if (LS.needInit) {
          lsQueue(lsInitPayload(t, playing));
          return;
        }

        var idx = lsIdxAt(t);
        var s = LS.sent;
        var seek = (s.t == null) || Math.abs(t - lsPredictedT()) > 0.35;
        if (seek && now - LS.lastPushAt < 300) seek = false;   /* 卡顿时别 15Hz 刷屏 */
        var changed = idx !== s.idx || playing !== s.playing;
        if (changed || seek || now - LS.lastPushAt >= 2000) {
          lsQueue({ type: 'state', idx: idx, t: t, playing: playing });
        }
        return;
      }

      if (d.type === 'beat') {
        var nowB = Date.now();
        if (nowB - LS.lastBeatAt < 90) return;
        LS.lastBeatAt = nowB;
        lsQueue({
          type: 'beat',
          index: Math.max(0, Math.round(lsNum(p2.index, 0))),
          level: lsClamp(lsNum(p2.level, 0), 0, 1)
        });
        return;
      }

      if (d.type === 'live') {
        var nowL = Date.now();
        if (nowL - LS.lastLiveAt < 500) return;   /* 最多 2Hz */
        LS.lastLiveAt = nowL;
        lsQueue({
          type: 'live',
          bass: lsClamp(lsNum(p2.bass, 0), 0, 1),
          mid: lsClamp(lsNum(p2.mid, 0), 0, 1),
          treble: lsClamp(lsNum(p2.treble, 0), 0, 1),
          bpm: lsClamp(lsNum(p2.bpm, 0), 0, 400)
        });
      }
    } catch (e) {
      /* 同步逻辑不允许影响播放 */
    }
  }

  /* 兜底：万一面板挂载晚于舞台第一次 init，直接从同源舞台的全局变量补一份。 */
  function lsRecover() {
    if (LS.hasInit) return;
    try {
      var win = LS.win || (document.getElementById('stage-frame') || {}).contentWindow;
      if (!win || !win.S || !win.hasInit) return;
      var lines = win.S.lines;
      if (!Array.isArray(lines) || !lines.length) return;
      var meta = win.songMeta || {};
      LS.lyrics = lsCleanLines(lines);
      if (!LS.lyrics.length) return;
      LS.song = meta.name ? {
        id: '',
        name: String(meta.name),
        album: '',
        artists: meta.artist ? String(meta.artist).split(' / ') : [],
        cover: ''
      } : null;
      LS.duration = lsNum(win.duration, 0);
      LS.hasInit = true;
      LS.needInit = true;
      var t = lsNum(win.S.t, 0);
      lsQueue(lsInitPayload(t, !!win.S.playing));
    } catch (e) { /* ignore */ }
  }

  /* 独立心跳：舞台 tick 停了（离开形态页 / 后台节流 / 音频卡住）时，
     仍然每 2 秒给手机一个新锚点，否则手机端 5 秒就判一次断流。
     优先读播放器音频时钟（同源全局，只读），读不到按上次状态外推。 */
  function lsHeartbeat() {
    if (!LS.hasInit) return;
    if (Date.now() - LS.lastTickAt < 2500) return;   /* tick 在跑，主路径负责 */

    var now = Date.now();
    var clock = lsAudioClock();
    var s = LS.sent;
    var t, playing;
    if (clock) {
      t = clock.t;
      playing = clock.playing;
    } else {
      playing = !!s.playing;
      t = playing ? lsPredictedT() : (s.t == null ? LS.lastTickT : s.t);
    }
    var gate = lsStallGate(t, playing, now);
    lsQueue({ type: 'state', idx: lsIdxAt(gate.t), t: gate.t, playing: gate.playing });
  }

  /* ---- 机位镜像：读舞台最终相机位姿（渲染用的那一份），15Hz 推给 stage-ar。
     手机端据此本地重渲染同一机位，所以字的位置、云的状态都能对上。
     这是独立通道：不排队、不占歌词的 in-flight，读不到就静默跳过。 ---- */
  function lsPose() {
    var win = LS.win;
    if (!win) return null;
    try {
      var u = win.gfx && win.gfx.marchMat && win.gfx.marchMat.uniforms;
      var cu = u && u.uCam && u.uCam.value;
      var ru = u && u.uRot && u.uRot.value;
      if (!cu || !ru) return null;
      var t = Number(win.ambT);
      var aspect = (win.W > 0 && win.H > 0)
        ? win.W / win.H
        : (win.innerWidth / win.innerHeight);
      var T = win.TXT || {};
      var pa = win.flashPosA || {}, pb = win.flashPosB || {};
      var pose = {
        type: 'cam',
        x: Number(cu.x), y: Number(cu.y), z: Number(cu.z),
        pitch: Number(ru.x), yaw: Number(ru.y), roll: Number(ru.z),
        t: t, aspect: aspect,
        /* 文字开凿球（「从云里钻出来」的那个洞） */
        chx: lsNum(T.chamberX, 0), chy: lsNum(T.chamberY, 0),
        chz: lsNum(T.chamberZ, 0), chw: lsNum(T.chamberW, 0),
        /* 闪电：强度 + 两个落点 + 屏幕白闪 */
        fa: lsNum(win.flashA, 0), fb: lsNum(win.flashB, 0),
        ax: lsNum(pa.x, 0), ay: lsNum(pa.y, 0), az: lsNum(pa.z, 0),
        bx: lsNum(pb.x, 0), by: lsNum(pb.y, 0), bz: lsNum(pb.z, 0),
        fs: lsNum(win.flashScreen, 0)
      };
      for (var k in pose) {
        if (k !== 'type' && !isFinite(pose[k])) return null;
      }
      if (!(pose.aspect > 0.1)) return null;
      return pose;
    } catch (e) { return null; }
  }

  function lsPushCam() {
    if (!LS.win) return;
    var now = Date.now();

    /* 服务器重启会丢歌词，播放器这边定时重发 init 兜底。 */
    if (LS.hasInit && now - LS.lastInitTryAt > 12000) {
      LS.lastInitTryAt = now;
      /* 用外推的当前时间重发，避免服务器重启后从旧锚点倒退 */
      lsQueue(lsInitPayload(lsPredictedT(), !!LS.sent.playing));
    }

    if (LS.camBusy || LS.inFlight) return;
    var pose = lsPose();
    if (!pose) return;
    var key = pose.x.toFixed(2) + ',' + pose.y.toFixed(2) + ',' + pose.z.toFixed(2) + ','
      + pose.pitch.toFixed(3) + ',' + pose.yaw.toFixed(3) + ',' + pose.roll.toFixed(3);
    if (key === LS.lastCamKey && now - LS.lastCamAt < 400) return;
    LS.lastCamKey = key;
    LS.lastCamAt = now;
    LS.camBusy = true;
    lsSend(pose).then(function () { LS.camBusy = false; }, function () { LS.camBusy = false; });
  }

  function lsAttach() {
    var frame = document.getElementById('stage-frame');
    if (!frame) return;
    function attach() {
      try {
        var win = frame.contentWindow;
        if (!win) return;
        LS.win = win;
        if (win.__arLyricSyncHooked) return;
        win.__arLyricSyncHooked = true;
        win.addEventListener('message', lsOnMessage);
      } catch (e) { /* 不同源时静默放弃 */ }
    }
    attach();
    frame.addEventListener('load', function () {
      attach();
      /* 新文档的全局对象换了，给 init 一次补漏机会 */
      setTimeout(lsRecover, 400);
      setTimeout(lsRecover, 1600);
    });
    if (!LS.recoverTimer) {
      LS.recoverTimer = setInterval(lsRecover, 4000);
    }
    if (!LS.beatTimer) {
      LS.beatTimer = setInterval(lsHeartbeat, 2000);
    }
    if (!LS.camTimer) {
      LS.camTimer = setInterval(lsPushCam, 66);
    }
  }

  try { lsAttach(); } catch (e) {}

  /* 调试口（也可用于验证推送时序） */
  try {
    window.__stageARSync = {
      state: LS,
      pushNow: function () {
        if (!LS.hasInit) return;
        lsQueue(lsInitPayload(LS.lastTickT, LS.lastTickPlaying));
      }
    };
  } catch (e) {}

  /* ================================================================== *
   * 投屏：把舞台画布用 WebRTC 点对点送到手机。
   * · 手机打开 /cast.html → POST join → 这里抓 iframe 里的 #gl/#bolt，
   *   合成到一张画布，captureStream(60) 推流；信令走 stage-ar 的 /events。
   * · 只在手机请求时工作；不抓画布时对播放器零开销。
   * · 画面和电脑逐像素一致，代价是约 100ms 的编解码+网络延迟。
   * ================================================================== */
  var CAST = {
    es: null,
    pc: null,
    stream: null,
    canvas: null,
    ctx: null,
    win: null,
    hooked: false,
    busy: false,
    startedAt: 0,
    lastViewAt: 0,
    viewTimer: 0
  };

  var CAST_SIGNAL = 'http://127.0.0.1:8450';

  function castPost(payload) {
    try { lsSend(payload); } catch (e) {}
  }

  function castStageFrame() {
    var frame = document.getElementById('stage-frame');
    if (!frame) return null;
    try {
      if (!frame.contentDocument || !frame.contentWindow) return null;
      return frame;
    } catch (e) { return null; }
  }

  function castFindCanvas(doc) {
    try {
      return doc.getElementById('gl');
    } catch (e) { return null; }
  }

  /* 尺寸对齐舞台 CSS 尺寸，长边最多 1600，保持偶数像素（编码器友好） */
  function castFit(w, h) {
    w = Math.max(2, Math.round(w || 1280));
    h = Math.max(2, Math.round(h || 720));
    var long = Math.max(w, h);
    if (long > 1600) {
      var k = 1600 / long;
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    w -= w % 2; h -= h % 2;
    return { w: w, h: h };
  }

  /* 在舞台自己的 renderGL 之后同步抓帧：WebGL 画布不在 rAF 里读会拿到空缓冲。 */
  function castHook(frame) {
    var win = frame.contentWindow;
    if (!win || typeof win.renderGL !== 'function') return false;
    CAST.win = win;
    if (!win.__castRenderOrig) {
      win.__castRenderOrig = win.renderGL;
      win.renderGL = function (dt) {
        win.__castRenderOrig.call(win, dt);
        try { castDraw(); } catch (e) {}
      };
    }
    CAST.hooked = true;
    return true;
  }

  function castUnhook() {
    var win = CAST.win;
    if (win && win.__castRenderOrig) {
      try { win.renderGL = win.__castRenderOrig; } catch (e) {}
      try { delete win.__castRenderOrig; } catch (e) {}
    }
    CAST.win = null;
    CAST.hooked = false;
  }

  function castDraw() {
    if (!CAST.ctx || !CAST.win) return;
    var doc;
    try { doc = CAST.win.document; } catch (e) { return; }
    var gl = castFindCanvas(doc);
    if (!gl) return;
    var c = CAST.canvas;
    var ctx = CAST.ctx;
    try {
      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(gl, 0, 0, c.width, c.height);
      var bolt = doc.getElementById('bolt');
      if (bolt) ctx.drawImage(bolt, 0, 0, c.width, c.height);
    } catch (e) {}
  }

  /* 手机陀螺仪的视角增量：写进舞台的 window.__stageViewQuat，
     舞台下一帧就会把这段旋转叠加到机位上（投屏画面跟着手机转）。 */
  function castApplyView(m) {
    if (!m || !m.view) return;
    var frame = document.getElementById('stage-frame');
    if (!frame) return;
    try {
      var w = frame.contentWindow;
      if (!w) return;
      w.__stageViewQuat = { x: m.view.x, y: m.view.y, z: m.view.z, w: m.view.w };
      CAST.lastViewAt = Date.now();
    } catch (e) {}
  }

  function castClearView() {
    var frame = document.getElementById('stage-frame');
    if (!frame) return;
    try {
      var w = frame.contentWindow;
      if (w && w.__stageViewQuat) w.__stageViewQuat = null;
    } catch (e) {}
  }

  function castStop() {
    castUnhook();
    castClearView();
    CAST.lastViewAt = 0;
    if (CAST.pc) {
      try { CAST.pc.close(); } catch (e) {}
      CAST.pc = null;
    }
    if (CAST.stream) {
      try { CAST.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      CAST.stream = null;
    }
    CAST.canvas = null;
    CAST.ctx = null;
    CAST.startedAt = 0;
  }

  function castPreferH264(pc, track, stream) {
    var tx = null;
    try {
      tx = pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
        sendEncodings: [{ maxBitrate: 14000000, maxFramerate: 60 }]
      });
    } catch (e) {
      try { pc.addTrack(track, stream); } catch (e2) { return; }
    }
    /* 两端都有硬件 H.264：优先它，编码延迟通常比软件 VP8 低一半 */
    try {
      var caps = RTCRtpSender.getCapabilities('video');
      if (caps && caps.codecs && tx && tx.setCodecPreferences) {
        var h264 = caps.codecs.filter(function (c) { return /H264/i.test(c.mimeType); });
        var rest = caps.codecs.filter(function (c) { return !/H264/i.test(c.mimeType); });
        if (h264.length) tx.setCodecPreferences(h264.concat(rest));
      }
    } catch (e) {}
  }

  /* 连上之后才能改编码参数：保帧率优先、码率给足，局域网别被拥塞控制压成糊 */
  function castTuneSender(pc) {
    try {
      var sender = (pc.getSenders() || [])[0];
      if (!sender || !sender.getParameters) return;
      var p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 14000000;
      p.encodings[0].maxFramerate = 60;
      p.degradationPreference = 'maintain-framerate';
      var r = sender.setParameters(p);
      if (r && r.catch) r.catch(function () {});
    } catch (e) {}
  }

  function castStart() {
    if (CAST.busy) return;
    var frame = castStageFrame();
    if (!frame) return;
    if (CAST.pc) castStop();

    var doc;
    try { doc = frame.contentDocument; } catch (e) { return; }
    var gl = castFindCanvas(doc);
    if (!gl) return;
    if (!castHook(frame)) return;

    var size = castFit(gl.clientWidth || gl.width, gl.clientHeight || gl.height);
    var canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    CAST.canvas = canvas;
    CAST.ctx = canvas.getContext('2d');
    if (!CAST.ctx) { castStop(); return; }

    var stream;
    try {
      stream = canvas.captureStream(60);
    } catch (e) {
      castStop();
      return;
    }
    var track = stream.getVideoTracks()[0];
    if (!track) { castStop(); return; }
    try { track.contentHint = 'motion'; } catch (e) {}

    var pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch (e) {
      castStop();
      return;
    }
    CAST.pc = pc;
    CAST.stream = stream;
    castPreferH264(pc, track, stream);

    pc.onconnectionstatechange = function () {
      if (pc !== CAST.pc) return;
      var s = pc.connectionState;
      if (s === 'connected') castTuneSender(pc);
      if (s === 'failed' || s === 'closed') CAST.pc = null;
    };

    CAST.busy = true;
    pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false })
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () {
        /* 局域网不需要 trickle：等候选收齐再发一次，流程更简单 */
        return new Promise(function (resolve) {
          if (pc.iceGatheringState === 'complete') { resolve(); return; }
          var done = false;
          function finish() {
            if (done) return;
            done = true;
            try { pc.removeEventListener('icegatheringstatechange', check); } catch (e) {}
            resolve();
          }
          function check() {
            if (pc.iceGatheringState === 'complete') finish();
          }
          try { pc.addEventListener('icegatheringstatechange', check); } catch (e) {}
          setTimeout(finish, 2000);
        });
      })
      .then(function () {
        if (pc !== CAST.pc) return;
        castPost({
          type: 'rtc', from: 'player', kind: 'offer',
          sdp: pc.localDescription ? pc.localDescription.sdp : '',
          sdpType: 'offer'
        });
        CAST.startedAt = Date.now();
      })
      .catch(function () { if (pc === CAST.pc) castStop(); })
      .then(function () { CAST.busy = false; });
  }

  function castAnswer(m) {
    var pc = CAST.pc;
    if (!pc || !m || !m.sdp) return;
    var desc = { type: 'answer', sdp: String(m.sdp) };
    var apply = function () {
      pc.setRemoteDescription(desc).catch(function () { castStop(); });
    };
    if (!pc.remoteDescription && pc.signalingState === 'have-local-offer') {
      apply();
    } else {
      /* 重复的 answer（手机重连）直接忽略 */
    }
  }

  function castListen() {
    if (CAST.es) return;
    var es;
    try {
      es = new EventSource(CAST_SIGNAL + '/events?role=player');
    } catch (e) { return; }
    CAST.es = es;
    es.addEventListener('rtc', function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m || m.from !== 'phone') return;
      if (m.kind === 'join') {
        /* 手机每次打开/刷新都会 join：重建一路 */
        try { castStop(); } catch (x) {}
        castStart();
      } else if (m.kind === 'answer') {
        castAnswer(m);
      } else if (m.kind === 'view') {
        castApplyView(m);
      } else if (m.kind === 'bye') {
        castStop();
      }
    });
    es.onerror = function () { /* EventSource 自己会重连，静默 */ };

    /* 手机端崩溃/切后台没发 bye：2.5 秒收不到视角就归零，免得电脑一直歪着 */
    if (!CAST.viewTimer) {
      CAST.viewTimer = setInterval(function () {
        if (!CAST.lastViewAt || Date.now() - CAST.lastViewAt < 2500) return;
        CAST.lastViewAt = 0;
        castClearView();
      }, 1000);
    }

    /* 换形态/重载 iframe：旧画布已经作废，重新抓一份并给手机发新 offer */
    var frame = document.getElementById('stage-frame');
    if (frame && !frame.__castLoadBound) {
      frame.__castLoadBound = true;
      frame.addEventListener('load', function () {
        if (!CAST.pc) return;
        setTimeout(function () { if (CAST.pc) castStart(); }, 900);
      });
    }
  }

  try { castListen(); } catch (e) {}

  try {
    window.__stageCast = {
      state: CAST,
      start: castStart,
      stop: castStop
    };
  } catch (e) {}
})();
