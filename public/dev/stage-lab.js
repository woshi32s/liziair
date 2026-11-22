/* ==========================================================================
   形态检测台（2026-11-17）
   --------------------------------------------------------------------------
   只在开发时打开 /dev/stage-lab.html，不加入口。

   它做三件事：
   1) 和宿主一模一样的沙箱：iframe sandbox="allow-scripts"，
      内容直接走 LIZI_STUDIO.srcdoc()（CSP / 错误转发 / three 注入只有那份实现）。
   2) 模拟宿主消息：init（示例歌词）/ tick 66ms / beat / live 100ms；
      支持暂停、拖进度、改时长、改 BPM、手动打拍、live 手动或正弦。
   3) 自检：4 秒没 ready 报接入失败；收 error / CSP 违规 / canvas 首帧探测；
      「复制自检报告」给出一段可直接粘给网页 AI 的中文。

   批量模式：最多 50 个文件，串行跑，每个 7 秒，结果表 + Markdown / JSON 导出。
   无头入口：?stage=<同源URL>&auto=1&badge=1，跑完挂 window.__labReport，
             并 console.log('__LIZI_LAB_REPORT__' + JSON.stringify(report))。
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const now = () => ((window.performance && performance.now) ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_BATCH = 50;
  const RUN_MS = 7000;
  const READY_MS = 4000;
  const LAB_KEY = 'lizi.stage.lab';
  const FALLBACK_LINES = [
    '月亮爬上山坡', '风把云一点点吹开', '我们站在这里', '听一首很慢很慢的歌',
    '灯一盏一盏亮起来', '远处的车流像不睡的河', '把影子拉长又收回去',
    '这一句比别的都长一些，用来看看你的形态会不会把字挤出屏幕',
    '快听完了', '最后一句唱完就结束',
  ];

  const el = {
    code: $('code'), linemsg: $('linemsg'), statsline: $('statsline'),
    status: $('status'), viewport: $('viewport'), stagewrap: $('stagewrap'),
    seek: $('seek'), time: $('time'), duration: $('duration'), bpm: $('bpm'),
    play: $('btn-play'), songname: $('songname'), lyrics: $('lyrics'),
    autoLive: $('auto-live'),
    lvLevel: $('lv-level'), lvBass: $('lv-bass'), lvMid: $('lv-mid'), lvTreble: $('lv-treble'),
    fps: $('fps'), rx: $('rx'), tx: $('tx'), monitor: $('monitor'),
    errs: $('errs'), errlist: $('errlist'), log: $('log'), loglist: $('loglist'),
    fileOne: $('file-one'), fileMany: $('file-many'),
    badge: $('badge'),
    batch: $('batch'), batchBody: $('batch-body'), batchSummary: $('batch-summary'),
    batchStop: $('batch-stop'),
  };

  let frame = null;
  let runSeq = 0;
  let stats = null;
  let lastReport = null;
  let currentFile = '粘贴的代码';
  let initSent = false;
  let tickTimer = 0;
  let liveTimer = 0;
  let readyTimer = 0;
  let initTimer = 0;
  let finishTimer = 0;
  let fpsRaf = 0;
  let fpsFrames = 0;
  let fpsStart = 0;
  let autoMode = /[?&]auto=1(?:&|$)/.test(location.search);
  let badgeMode = /[?&]badge=1(?:&|$)/.test(location.search);
  let batchRunning = false;
  let batchStop = false;
  let batchResults = [];
  let batchMeta = [];
  let logOpen = false;

  const play = {
    time: 0, playing: true, duration: 40, bpm: 120,
    lastNow: 0, lastBeat: -1, manualBeat: 0,
  };

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  function byteLen(s) {
    const str = String(s || '');
    try {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    } catch { /* 老内核 */ }
    try { return new Blob([str]).size; } catch { return str.length; }
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number(n) || 0)); }

  function fmtCounts(o) {
    const ks = Object.keys(o || {});
    return ks.length ? ks.map((k) => k + '×' + o[k]).join('，') : '（没有）';
  }

  function lineMsg(text, tone) {
    el.linemsg.textContent = text || '';
    if (tone) el.linemsg.dataset.tone = tone;
    else delete el.linemsg.dataset.tone;
  }

  function setStatus(text, tone) {
    el.status.textContent = text || '';
    el.status.classList.toggle('is-ready', tone === 'ok');
    el.status.classList.toggle('is-bad', tone === 'bad');
  }

  function copyText(text) {
    const s = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(() => true).catch(() => copyFallback(s));
    }
    return Promise.resolve(copyFallback(s));
  }

  function copyFallback(s) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch { return false; }
  }

  function download(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* 忽略 */ } }, 1500);
      return true;
    } catch { return false; }
  }

  function stamp() {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-'
      + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function mmss(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r + '.00';
  }

  function defaultLyrics() {
    const lines = (window.LIZI_STUDIO && Array.isArray(LIZI_STUDIO._mockLines) && LIZI_STUDIO._mockLines.length)
      ? LIZI_STUDIO._mockLines : FALLBACK_LINES;
    return lines.map((text, i) => '[' + mmss(i * 4) + ']' + text).join('\n');
  }

  function parseLrc(text) {
    const raw = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
      if (!m) return;
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      const t = (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0) + frac;
      const txt = String(m[4] || '').trim();
      if (!txt) return;
      raw.push({ t: Math.round(t * 1000) / 1000, text: txt });
    });
    raw.sort((a, b) => a.t - b.t);
    return raw.map((l, i) => ({
      t: l.t,
      dur: Math.max(0.4, Math.round(((raw[i + 1] ? raw[i + 1].t : l.t + 4) - l.t) * 1000) / 1000),
      text: l.text,
      chars: null,
    }));
  }

  function initPayload() {
    return {
      song: {
        id: 'lab', name: el.songname.value.trim() || '示例歌曲',
        artists: '示例歌手', album: '示例专辑', cover: '',
      },
      accent: [150, 165, 255],
      duration: Math.max(1, Number(play.duration) || 40),
      lines: parseLrc(el.lyrics.value),
    };
  }

  /* ------------------------------------------------------------------ *
   * 沙箱运行
   * ------------------------------------------------------------------ */
  function newStats(file, html) {
    return {
      file: file || '粘贴的代码',
      bytes: byteLen(html),
      startAt: now(), loadedAt: 0,
      ready: false, readyMs: null,
      errors: [], cspViolations: [],
      messages: {}, sent: {},
      fps: 0, probe: null, started: false,
      srcdoc: '',
    };
  }

  async function buildSrcdoc(html) {
    let out = LIZI_STUDIO.srcdoc(html);
    /* three 由宿主预热；如果用户代码要用 THREE 但缓存还没到，稍等一下再拼。
       这里只是等宿主页面的同源 fetch，不是沙箱里的网络。 */
    if (/\bTHREE(?:Addons)?\b/.test(html) && out.indexOf('lizi:studio-libs:begin') < 0) {
      const t0 = now();
      while (out.indexOf('lizi:studio-libs:begin') < 0 && now() - t0 < 5000) {
        await sleep(250);
        out = LIZI_STUDIO.srcdoc(html);
      }
    }
    return out;
  }

  function stopDrivers() {
    if (tickTimer) clearInterval(tickTimer);
    if (liveTimer) clearInterval(liveTimer);
    tickTimer = 0;
    liveTimer = 0;
    if (readyTimer) clearTimeout(readyTimer);
    if (initTimer) clearTimeout(initTimer);
    if (finishTimer) clearTimeout(finishTimer);
    readyTimer = 0;
    initTimer = 0;
    finishTimer = 0;
  }

  function stopFps() {
    if (fpsRaf) cancelAnimationFrame(fpsRaf);
    fpsRaf = 0;
    if (stats && fpsFrames && fpsStart) {
      const dt = Math.max(1, now() - fpsStart);
      stats.fps = Math.round(fpsFrames * 1000 / dt);
    }
  }

  function startFps() {
    stopFps();
    fpsFrames = 0;
    fpsStart = now();
    const loop = () => {
      fpsRaf = requestAnimationFrame(() => {
        fpsFrames++;
        const dt = now() - fpsStart;
        if (dt >= 500) {
          if (stats) stats.fps = Math.round(fpsFrames * 1000 / dt);
          fpsFrames = 0;
          fpsStart = now();
          paintCounters();
        }
        loop();
      });
    };
    loop();
  }

  function post(type, payload) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ __c100: 1, type, payload }, '*');
      if (stats) stats.sent[type] = (stats.sent[type] || 0) + 1;
      pushLog('发出', type, payload);
      paintCounters();
    } catch { /* 忽略 */ }
  }

  function tickLoop() {
    const t = now();
    if (play.playing) {
      play.time += Math.max(0, t - play.lastNow) / 1000;
      if (play.time > play.duration) {
        play.time = play.time % Math.max(1, play.duration);
        play.lastBeat = -1;
      }
      const beatLen = 60 / Math.max(30, play.bpm);
      const bi = Math.floor(play.time / beatLen);
      if (bi !== play.lastBeat) {
        play.lastBeat = bi;
        post('beat', { index: bi, level: 0.55 + 0.4 * Math.abs(Math.sin(bi * 1.7)) });
      }
    }
    play.lastNow = t;
    post('tick', { time: Math.round(play.time * 1000) / 1000, playing: play.playing });
    paintTime();
  }

  function liveLoop() {
    let lv;
    if (el.autoLive.checked) {
      const t = play.time;
      lv = {
        level: 0.5 + 0.5 * Math.sin(t * 1.7),
        bass: 0.5 + 0.5 * Math.sin(t * 1.1 + 1.2),
        mid: 0.5 + 0.5 * Math.sin(t * 2.3 + 2.4),
        treble: 0.5 + 0.5 * Math.sin(t * 3.1 + 3.6),
      };
    } else {
      lv = {
        level: Number(el.lvLevel.value) || 0,
        bass: Number(el.lvBass.value) || 0,
        mid: Number(el.lvMid.value) || 0,
        treble: Number(el.lvTreble.value) || 0,
      };
    }
    post('live', {
      bpm: play.bpm, playing: play.playing,
      level: Math.max(0, Math.min(1, lv.level)),
      bass: Math.max(0, Math.min(1, lv.bass)),
      mid: Math.max(0, Math.min(1, lv.mid)),
      treble: Math.max(0, Math.min(1, lv.treble)),
    });
  }

  function beginPlayback() {
    if (!stats || stats.started) return;
    stats.started = true;
    if (initTimer) { clearTimeout(initTimer); initTimer = 0; }
    initSent = true;
    post('init', initPayload());
    play.lastNow = now();
    play.lastBeat = Math.floor(play.time / (60 / Math.max(30, play.bpm)));
    tickTimer = setInterval(tickLoop, 66);
    liveTimer = setInterval(liveLoop, 100);
    tickLoop();
    liveLoop();
    setStatus('已注入 init / tick / beat / live', 'ok');
  }

  function armReady() {
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (!stats || stats.ready) return;
      setStatus('4 秒内没有收到 ready：接入失败', 'bad');
      renderErrors();
    }, READY_MS);
  }

  /** 挂一个新沙箱。ms>0 时到点自动收尾并 resolve 报告；ms=0 一直跑。 */
  async function runOne(html, file, ms) {
    const seq = ++runSeq;
    stopDrivers();
    stopFps();
    frame = null;
    el.viewport.innerHTML = '';
    if (el.loglist) el.loglist.innerHTML = '';
    const srcdoc = await buildSrcdoc(html);
    if (seq !== runSeq) return null;

    stats = newStats(file, html);
    stats.srcdoc = srcdoc;
    initSent = false;
    lastReport = null;
    play.time = 0;
    play.lastBeat = -1;
    play.playing = true;
    el.play.textContent = '暂停';
    el.seek.value = '0';
    paintTime();

    const f = document.createElement('iframe');
    /* 和宿主完全一样的沙箱边界：只有 allow-scripts，绝不加 allow-same-origin */
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('allow', 'autoplay');
    f.setAttribute('title', '形态预览');
    f.srcdoc = srcdoc;

    el.viewport.innerHTML = '';
    el.viewport.appendChild(f);
    frame = f;
    startFps();
    armReady();
    paintCounters();
    paintStatsLine();
    clearErrorsUI();

    return new Promise((resolve) => {
      f.addEventListener('load', () => {
        if (seq !== runSeq) return;
        stats.loadedAt = now();
        /* 宿主是收到 ready 才发 init；这里给没发 ready 的形态留 600ms 兜底，
           超时也发一份，方便在画面上看出它到底有没有跑。 */
        initTimer = setTimeout(() => { if (seq === runSeq) beginPlayback(); }, 600);
        if (ms > 0) {
          finishTimer = setTimeout(() => {
            if (seq !== runSeq) return;
            const rep = finishRun();
            resolve(rep);
          }, ms);
        }
      }, { once: true });
    });
  }

  function finishRun() {
    stopDrivers();
    stopFps();
    if (stats && stats.fps == null) stats.fps = 0;
    const rep = makeReport(stats);
    lastReport = rep;
    paintCounters();
    paintStatsLine();
    return rep;
  }

  function makeReport(st) {
    const s = st || newStats('未知', '');
    const vs = frameSize();
    const verdict = (!s.ready || s.errors.length) ? 'fail'
      : ((s.cspViolations.length || s.fps < 30) ? 'warn' : 'pass');
    const note = [];
    note.push(probeNote(s.probe));
    if (vs.w) note.push('视口 ' + vs.w + '×' + vs.h);
    if (s.srcdoc && s.srcdoc.indexOf('lizi:studio-libs:begin') >= 0) note.push('已注入 THREE');
    return {
      file: s.file,
      bytes: s.bytes,
      ready: !!s.ready,
      readyMs: s.ready ? s.readyMs : null,
      errors: s.errors.map((e) => ({ message: String(e.message || ''), stack: String(e.stack || '') })),
      cspViolations: s.cspViolations.map((e) => ({
        directive: String(e.directive || ''), blockedURI: String(e.blockedURI || ''),
      })),
      messages: Object.assign({}, s.messages),
      fps: Number(s.fps) || 0,
      verdict,
      note: note.join('；'),
    };
  }

  function probeNote(p) {
    if (!p) return '没有收到首帧探测';
    const cs = Array.isArray(p.canvases) ? p.canvases : [];
    if (!cs.length) return '首帧：页面里没有 canvas（可能是 DOM / CSS 形态）';
    const drawn = cs.filter((c) => Number(c.w) > 0 && Number(c.h) > 0);
    if (!drawn.length) return '首帧：有 canvas，但尺寸是 0（可能没绘制）';
    return '首帧：canvas ' + drawn.map((c) => c.w + '×' + c.h).join(' / ');
  }

  function frameSize() {
    if (!frame) return { w: 0, h: 0 };
    return { w: frame.clientWidth || 0, h: frame.clientHeight || 0 };
  }

  /* ------------------------------------------------------------------ *
   * 消息与统计
   * ------------------------------------------------------------------ */
  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow) return;   // 只认自己这个沙箱
    const d = e.data;
    if (!d || d.__c100 !== 1) return;
    const type = String(d.type || '?');
    if (stats) stats.messages[type] = (stats.messages[type] || 0) + 1;
    pushLog('收到', type, d.payload);

    if (type === 'ready') {
      if (stats && !stats.ready) {
        stats.ready = true;
        stats.readyMs = Math.round(now() - stats.startAt);
      }
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = 0; }
      if (stats) beginPlayback();
      paintStatsLine();
      paintCounters();
      return;
    }
    if (type === 'probe') {
      if (stats) stats.probe = d.payload || null;
      return;
    }
    if (type !== 'error') return;
    const p = d.payload || {};
    const isCsp = p.kind === 'csp' || !!p.directive || !!p.blockedURI;
    if (stats) {
      const list = isCsp ? stats.cspViolations : stats.errors;
      if (list.length < 30) {
        list.push({
          message: String(p.message || '未知错误'),
          stack: String(p.stack || ''),
          directive: String(p.directive || ''),
          blockedURI: String(p.blockedURI || ''),
        });
      }
    }
    renderErrors();
  });

  function paintCounters() {
    if (!stats) return;
    let rx = 0;
    Object.keys(stats.messages).forEach((k) => { rx += stats.messages[k] || 0; });
    let tx = 0;
    Object.keys(stats.sent).forEach((k) => { tx += stats.sent[k] || 0; });
    el.fps.textContent = String(stats.fps || '—');
    el.rx.textContent = String(rx);
    el.tx.textContent = String(tx);
  }

  function paintStatsLine() {
    if (!stats) { el.statsline.textContent = '未运行'; return; }
    const ready = stats.ready ? 'ready ' + stats.readyMs + 'ms' : '未 ready';
    el.statsline.textContent = stats.file + ' · ' + (stats.bytes / 1024).toFixed(1) + ' KB · '
      + ready + ' · 收到 ' + fmtCounts(stats.messages) + ' · 发出 ' + fmtCounts(stats.sent);
  }

  function paintTime() {
    el.seek.max = String(Math.max(1, play.duration));
    el.seek.value = String(Math.min(play.time, play.duration));
    el.time.textContent = play.time.toFixed(1) + ' / ' + Number(play.duration).toFixed(1)
      + (play.playing ? '' : '（暂停）');
  }

  /* ------------------------------------------------------------------ *
   * 错误 / 消息日志
   * ------------------------------------------------------------------ */
  function renderErrors() {
    const list = [];
    if (stats) {
      stats.errors.forEach((e) => list.push('[脚本] ' + e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : '')));
      stats.cspViolations.forEach((e) => list.push('[CSP] ' + (e.directive || '') + (e.blockedURI ? ' → ' + e.blockedURI : '')));
    }
    el.errlist.innerHTML = '';
    list.slice(0, 20).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      el.errlist.appendChild(li);
    });
    el.errs.hidden = list.length === 0;
  }

  function clearErrorsUI() {
    el.errlist.innerHTML = '';
    el.errs.hidden = true;
  }

  /* 最近 20 条消息（收到 + 发出）。不管面板开没开都记，只是不画。 */
  function pushLog(dir, type, payload) {
    if (!el.loglist) return;
    const li = document.createElement('li');
    let brief = '';
    try { brief = payload ? JSON.stringify(payload).slice(0, 220) : ''; } catch { brief = '[无法序列化]'; }
    li.textContent = dir + ' ' + type + (brief ? ' ' + brief : '');
    el.loglist.appendChild(li);
    while (el.loglist.children.length > 20) el.loglist.removeChild(el.loglist.firstChild);
  }

  function toggleLog() {
    logOpen = !logOpen;
    el.log.hidden = !logOpen;
    if (logOpen && !el.loglist.children.length) {
      const li = document.createElement('li');
      li.textContent = '还没有消息';
      el.loglist.appendChild(li);
    }
  }

  /* ------------------------------------------------------------------ *
   * 自检报告
   * ------------------------------------------------------------------ */
  function aiTextFromReport(rep) {
    const out = [];
    out.push('我在给 LIZI 音乐播放器做一个自定义播放形态。下面是我的检测结果，请帮我修好它。');
    out.push('');
    out.push('【文件】' + rep.file);
    out.push('【代码大小】' + (rep.bytes / 1024).toFixed(1) + ' KB');
    out.push('【是否 ready】' + (rep.ready
      ? '是，用时 ' + rep.readyMs + ' ms'
      : '否（等了 4 秒没有收到 ready）'));
    out.push('【收到的消息】' + fmtCounts(rep.messages));
    out.push('【首帧 / 视口】' + (rep.note || '（无）'));
    if (rep.errors && rep.errors.length) {
      out.push('【脚本错误】');
      rep.errors.slice(0, 5).forEach((e, i) => {
        out.push((i + 1) + '. ' + e.message
          + (e.stack ? '\n   ' + String(e.stack).split('\n').slice(0, 4).join('\n   ') : ''));
      });
    } else {
      out.push('【脚本错误】（没有）');
    }
    if (rep.cspViolations && rep.cspViolations.length) {
      out.push('【CSP 违规】');
      rep.cspViolations.slice(0, 5).forEach((e, i) => {
        out.push((i + 1) + '. 指令 ' + (e.directive || '未知')
          + (e.blockedURI ? '，被拦 URL：' + e.blockedURI : ''));
      });
    } else {
      out.push('【CSP 违规】（没有）');
    }
    if (!rep.ready) {
      out.push('');
      out.push('【最常见原因】');
      out.push('1. 没在页面加载完成后发送 parent.postMessage({ __c100:1, type:"ready" }, "*")');
      out.push('2. 代码有语法错误，脚本没有跑起来');
      out.push('3. 用了被沙箱拦掉的 API（外链脚本 / 样式 / 字体、fetch、WebSocket 等）');
    }
    out.push('');
    out.push('请只输出修好的完整 HTML，从 <!DOCTYPE html> 开始，到 </html> 结束。不要写解释。');
    return out.join('\n');
  }

  function copyReport(rep) {
    const text = aiTextFromReport(rep);
    copyText(text).then((ok) => {
      lineMsg(ok ? '自检报告已复制，粘回给 AI 就行' : '复制失败：请手动复制', ok ? 'ok' : 'bad');
    });
  }

  /* ------------------------------------------------------------------ *
   * 运行 / 校验
   * ------------------------------------------------------------------ */
  function checkHtml(html) {
    const problems = (window.LIZI_STUDIO && LIZI_STUDIO.check) ? LIZI_STUDIO.check(html) : [];
    const warns = (window.LIZI_STUDIO && typeof LIZI_STUDIO.warn === 'function')
      ? LIZI_STUDIO.warn(html) : [];
    return { problems, warns };
  }

  function bareReport(file, html, problems, warns) {
    const st = newStats(file, html);
    problems.forEach((p) => st.errors.push({ message: p, stack: '', directive: '', blockedURI: '' }));
    const rep = makeReport(st);
    rep.verdict = 'fail';
    rep.note = '未运行：校验未通过' + (warns && warns.length ? '；' + warns[0] : '');
    return rep;
  }

  function publishReport(rep) {
    window.__labReport = rep;
    try {
      console.log('__LIZI_LAB_REPORT__' + JSON.stringify(rep));
    } catch { /* 忽略 */ }
    showBadge(rep);
  }

  function showBadge(rep) {
    if (!rep) return;
    const label = rep.verdict === 'pass' ? '通过' : rep.verdict === 'warn' ? '有警告' : '失败';
    el.badge.hidden = false;
    el.badge.className = 'lab__badge is-' + rep.verdict;
    const first = rep.errors && rep.errors.length ? ' · ' + String(rep.errors[0].message).slice(0, 80) : '';
    el.badge.textContent = rep.file + ' · ' + label + first;
  }

  async function startSingle(opts) {
    const o = opts || {};
    const html = String(el.code.value || '').trim();
    if (!html) { lineMsg('编辑器里还没有代码', 'bad'); return; }
    if (o.file) currentFile = o.file;
    const { problems, warns } = checkHtml(html);
    if (problems.length) {
      lineMsg(problems[0], 'bad');
      if (o.auto) publishReport(bareReport(currentFile, html, problems, warns));
      return;
    }
    lineMsg(warns.length ? warns[0] : '运行中…', warns.length ? '' : 'ok');
    setStatus('等待 ready…');
    if (o.auto) {
      const rep = await runOne(html, currentFile, RUN_MS);
      if (rep) publishReport(rep);
    } else {
      runOne(html, currentFile, 0);
    }
  }

  function validateOnly() {
    const html = String(el.code.value || '').trim();
    if (!html) { lineMsg('编辑器里还没有代码', 'bad'); return; }
    const { problems, warns } = checkHtml(html);
    if (problems.length) lineMsg('校验没通过：' + problems.join('；'), 'bad');
    else if (warns.length) lineMsg('能保存，但要注意：' + warns.join('；'));
    else lineMsg('校验通过：' + (byteLen(html) / 1024).toFixed(1) + ' KB', 'ok');
  }

  /* ------------------------------------------------------------------ *
   * 批量
   * ------------------------------------------------------------------ */
  function readText(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result || '').replace(/^﻿/, ''));
      rd.onerror = () => reject(new Error('读取失败'));
      rd.readAsText(file, 'utf-8');
    });
  }

  function loadEditorFile(file) {
    if (!file) return;
    readText(file).then((text) => {
      el.code.value = text.trim();
      currentFile = file.name;
      lineMsg('已载入 ' + file.name + '（' + (file.size / 1024).toFixed(1) + 'KB）', 'ok');
      paintStatsLine();
    }).catch((e) => lineMsg('读不了：' + e.message, 'bad'));
  }

  function verdictLabel(v) {
    return v === 'pass' ? '通过' : v === 'warn' ? '有警告' : '失败';
  }

  function renderBatchTable(runningIndex) {
    el.batchBody.innerHTML = '';
    batchResults.forEach((rep, i) => {
      const tr = document.createElement('tr');
      if (runningIndex === i) tr.className = 'is-running';
      const cells = [
        ['', rep.file],
        ['', Math.max(1, Math.round(rep.bytes / 1024)) + ' KB'],
        [rep.ready ? 'is-good' : 'is-bad', rep.ready ? '✓' : '✗'],
        ['', rep.ready ? (rep.readyMs + ' ms') : '—'],
        ['err', rep.errors && rep.errors.length ? rep.errors[0].message : '—'],
        [rep.cspViolations && rep.cspViolations.length ? 'is-warn' : '', String((rep.cspViolations || []).length)],
        [(rep.fps < 30) ? 'is-warn' : '', String(rep.fps || '—')],
        ['is-' + rep.verdict, verdictLabel(rep.verdict)],
      ];
      cells.forEach(([cls, text]) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = String(text);
        td.title = String(text);
        tr.appendChild(td);
      });
      const act = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lab__mini';
      btn.textContent = '复制自检';
      btn.dataset.copy = String(i);
      act.appendChild(btn);
      tr.appendChild(act);
      el.batchBody.appendChild(tr);
    });
  }

  function summaryText() {
    const n = batchResults.length;
    const p = batchResults.filter((r) => r.verdict === 'pass').length;
    const w = batchResults.filter((r) => r.verdict === 'warn').length;
    const f = batchResults.filter((r) => r.verdict === 'fail').length;
    return n ? ('共 ' + n + ' 个：通过 ' + p + '，警告 ' + w + '，失败 ' + f) : '还没开始';
  }

  async function startBatch(files) {
    if (batchRunning) return;
    let list = Array.from(files || []).filter((f) => f && /\.html?$/i.test(f.name));
    if (!list.length) { lineMsg('没选到 .html / .htm 文件', 'bad'); return; }
    if (list.length > MAX_BATCH) {
      lineMsg('一次最多 50 个，后面的 ' + (list.length - MAX_BATCH) + ' 个忽略了', 'bad');
      list = list.slice(0, MAX_BATCH);
    }
    batchRunning = true;
    batchStop = false;
    batchResults = [];
    batchMeta = [];
    el.batch.hidden = false;
    el.batchStop.hidden = false;
    renderBatchTable(-1);
    el.batchSummary.textContent = '准备中…';

    for (let i = 0; i < list.length; i++) {
      if (batchStop) break;
      const file = list[i];
      el.batchSummary.textContent = '正在检测 ' + (i + 1) + '/' + list.length + '：' + file.name;
      renderBatchTable(i);
      let rep;
      try {
        const text = await readText(file);
        const max = (window.LIZI_STUDIO && LIZI_STUDIO._maxBytes) || (6 * 1024 * 1024);
        if (text.length > max) throw new Error('文件超过大小上限（' + (max / 1024) + 'KB）');
        const { problems, warns } = checkHtml(text);
        if (problems.length) {
          rep = bareReport(file.name, text, problems, warns);
        } else {
          rep = await runOne(text, file.name, RUN_MS);
          if (!rep) break;                     // 被取消
          if (warns.length) rep.note = (rep.note ? rep.note + '；' : '') + warns[0];
        }
        batchMeta.push({ warns: warns || [] });
      } catch (e) {
        const st = newStats(file.name, '');
        st.errors.push({ message: String((e && e.message) || e), stack: '', directive: '', blockedURI: '' });
        rep = makeReport(st);
        rep.verdict = 'fail';
        rep.note = '读取 / 检测失败';
        batchMeta.push({ warns: [] });
      }
      batchResults.push(rep);
      renderBatchTable(i + 1 < list.length ? i + 1 : -1);
      el.batchSummary.textContent = summaryText();
    }

    const stopped = batchStop;
    batchRunning = false;
    batchStop = false;
    el.batchStop.hidden = true;
    el.batchStop.textContent = '停止';
    el.batchSummary.textContent = summaryText() + (stopped ? '（已停止）' : '');
    renderBatchTable(-1);
  }

  function exportMarkdown() {
    if (!batchResults.length) { lineMsg('还没有批量结果可导出', 'bad'); return; }
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300);
    const out = [];
    out.push('# LIZI 形态批量检测报告');
    out.push('');
    out.push('- 生成时间：' + new Date().toLocaleString());
    out.push('- ' + summaryText());
    out.push('');
    out.push('| 文件 | 大小 | ready | ready 用时 | 错误（第一条） | CSP | FPS | 结论 |');
    out.push('|---|---|---|---|---|---|---|---|');
    batchResults.forEach((r) => {
      out.push('| ' + esc(r.file) + ' | ' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB | '
        + (r.ready ? '✓' : '✗') + ' | ' + (r.ready ? r.readyMs + ' ms' : '—') + ' | '
        + esc(r.errors && r.errors.length ? r.errors[0].message : '—') + ' | '
        + (r.cspViolations || []).length + ' | ' + (r.fps || '—') + ' | ' + verdictLabel(r.verdict) + ' |');
    });
    const bad = batchResults.filter((r) => r.verdict !== 'pass');
    if (bad.length) {
      out.push('');
      out.push('## 需要处理的项目');
      bad.forEach((r) => {
        out.push('');
        out.push('### ' + r.file + ' — ' + verdictLabel(r.verdict));
        out.push('');
        out.push('- ready：' + (r.ready ? '是（' + r.readyMs + ' ms）' : '否'));
        out.push('- 大小：' + (r.bytes / 1024).toFixed(1) + ' KB；FPS：' + (r.fps || 0));
        out.push('- 说明：' + (r.note || '—'));
        if (r.errors && r.errors.length) {
          out.push('- 错误：');
          r.errors.slice(0, 5).forEach((e) => {
            out.push('  - ' + esc(e.message));
            if (e.stack) out.push('    ```\n    ' + String(e.stack).split('\n').slice(0, 5).join('\n    ') + '\n    ```');
          });
        }
        if (r.cspViolations && r.cspViolations.length) {
          out.push('- CSP 违规：');
          r.cspViolations.slice(0, 5).forEach((e) => out.push('  - ' + esc(e.directive) + ' → ' + esc(e.blockedURI)));
        }
      });
    }
    download('stages-' + stamp() + '.md', out.join('\n'), 'text/markdown;charset=utf-8');
    lineMsg('报告已导出（Markdown）', 'ok');
  }

  function exportJson() {
    if (!batchResults.length) { lineMsg('还没有批量结果可导出', 'bad'); return; }
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: {
        total: batchResults.length,
        pass: batchResults.filter((r) => r.verdict === 'pass').length,
        warn: batchResults.filter((r) => r.verdict === 'warn').length,
        fail: batchResults.filter((r) => r.verdict === 'fail').length,
      },
      results: batchResults,
    };
    download('stages-' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    lineMsg('报告已导出（JSON）', 'ok');
  }

  /* ------------------------------------------------------------------ *
   * 视口 / 控制
   * ------------------------------------------------------------------ */
  function setView(name) {
    const v = ['desktop', 'phone', 'square'].includes(name) ? name : 'desktop';
    el.viewport.dataset.view = v;
    document.body.dataset.view = v;
    document.querySelectorAll('[data-view]').forEach((b) => {
      if (b.tagName === 'BUTTON') b.classList.toggle('is-on', b.dataset.view === v);
    });
  }

  function togglePlay() {
    play.playing = !play.playing;
    play.lastNow = now();
    el.play.textContent = play.playing ? '暂停' : '播放';
    paintTime();
  }

  function seekTo(v) {
    play.time = clamp(v, 0, play.duration);
    play.lastBeat = Math.floor(play.time / (60 / Math.max(30, play.bpm)));
    paintTime();
    post('tick', { time: play.time, playing: play.playing });
  }

  function applyDuration() {
    play.duration = Math.max(1, Number(el.duration.value) || 40);
    if (play.time > play.duration) play.time = 0;
    paintTime();
  }

  function applyBpm() {
    play.bpm = clamp(el.bpm.value, 30, 300);
    el.bpm.value = String(play.bpm);
  }

  function resendInit() {
    if (!frame) { lineMsg('先运行一次再发 init', 'bad'); return; }
    if (!stats || !stats.started) beginPlayback();
    else post('init', initPayload());
    lineMsg('已重发 init（换歌 / 换歌词后点这里）', 'ok');
  }

  /* ------------------------------------------------------------------ *
   * 示例
   * ------------------------------------------------------------------ */
  function sampleHtml() {
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>',
      'html,body{margin:0;height:100%;overflow:hidden;background:#080a12}',
      'canvas{position:fixed;inset:0;width:100%;height:100%;display:block}',
      '#lyric{position:fixed;left:7%;right:7%;bottom:16%;text-align:center;pointer-events:none;',
      '  color:#fff;font:700 clamp(24px,5.4vw,64px)/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;',
      '  letter-spacing:-.01em;text-shadow:0 2px 26px rgba(0,0,0,.75);',
      '  transition:opacity .32s ease,transform .32s ease}',
      '#lyric.fade{opacity:0;transform:translateY(12px)}',
      '#hint{position:fixed;left:0;right:0;top:12%;text-align:center;color:rgba(255,255,255,.32);',
      '  font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.22em}',
      '</style></head><body>',
      '<canvas id="c"></canvas>',
      '<div id="hint">LIZI · STAGE LAB SAMPLE</div>',
      '<div id="lyric"></div>',
      '<script>',
      'var cv=document.getElementById("c"),ctx=cv.getContext("2d");',
      'var lyric=document.getElementById("lyric");',
      'var lines=[],idx=-1,time=0,playing=false,accent=[150,165,255];',
      'var bass=0,mid=0,treble=0,pulse=0;',
      'function lerp(a,b,k){return a+(b-a)*k}',
      'function resize(){var d=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round(innerWidth*d);cv.height=Math.round(innerHeight*d);ctx.setTransform(d,0,0,d,0,0)}',
      'addEventListener("resize",resize);',
      'function lineAt(t){for(var i=lines.length-1;i>=0;i--)if(t>=lines[i].t)return i;return -1}',
      'function setLyric(txt){lyric.classList.add("fade");setTimeout(function(){lyric.textContent=txt;lyric.classList.remove("fade")},160)}',
      'addEventListener("message",function(e){',
      '  var d=e.data;if(!d||d.__c100!==1)return;var p=d.payload||{};',
      '  if(d.type==="init"){lines=(p.lines||[]).slice().sort(function(a,b){return a.t-b.t});if(p.accent)accent=p.accent;idx=-1}',
      '  else if(d.type==="tick"){time=p.time||0;playing=!!p.playing}',
      '  else if(d.type==="beat"){pulse=Math.max(pulse,0.35+0.65*(p.level||0.5))}',
      '  else if(d.type==="live"){bass=lerp(bass,p.bass||0,.1);mid=lerp(mid,p.mid||0,.1);treble=lerp(treble,p.treble||0,.1)}',
      '});',
      'parent.postMessage({__c100:1,type:"ready"},"*");',
      'function frame(){',
      '  var i=lineAt(time);',
      '  if(i!==idx){idx=i;setLyric(i>=0&&lines[i]?lines[i].text:"")}',
      '  pulse*=0.9;',
      '  var w=innerWidth,h=innerHeight;',
      '  var r=8+Math.round(accent[0]*0.03+bass*26),g=9+Math.round(accent[1]*0.03+bass*24),b=15+Math.round(accent[2]*0.04+bass*30);',
      '  ctx.fillStyle="rgb("+r+","+g+","+b+")";ctx.fillRect(0,0,w,h);',
      '  var grd=ctx.createRadialGradient(w*.5,h*.58,0,w*.5,h*.58,Math.max(w,h)*.7);',
      '  grd.addColorStop(0,"rgba("+accent.join(",")+","+(0.12+bass*.22+mid*.12)+")");',
      '  grd.addColorStop(1,"rgba("+accent.join(",")+",0)");',
      '  ctx.fillStyle=grd;ctx.fillRect(0,0,w,h);',
      '  for(var j=0;j<24;j++){var x=w*(j+.5)/24;var len=8+treble*46+pulse*10;',
      '    ctx.globalAlpha=.06+treble*.18;ctx.fillStyle="#fff";ctx.fillRect(x,h*.62,h*0.0016,len)}',
      '  ctx.globalAlpha=1;',
      '  ctx.beginPath();ctx.arc(w*.5,h*.4,Math.min(w,h)*(.045+.012*Math.sin(time*.7)+pulse*.01),0,7);',
      '  ctx.fillStyle="rgba("+accent.join(",")+",.16)";ctx.fill();',
      '  requestAnimationFrame(frame);',
      '}',
      'resize();requestAnimationFrame(frame);',
      '<\/script></body></html>',
    ].join('\n');
  }

  /* ------------------------------------------------------------------ *
   * ?stage= / 无头入口
   * ------------------------------------------------------------------ */
  async function loadFromUrl(raw, auto) {
    let name = 'stage.html';
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) throw new Error('stage 必须是同源 URL');
      name = decodeURIComponent((url.pathname.split('/').pop() || 'stage.html'));
      const res = await fetch(url.href, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      el.code.value = text;
      currentFile = name;
      lineMsg('已载入 ' + name, 'ok');
      paintStatsLine();
      if (auto) await startSingle({ auto: true, file: name });
    } catch (e) {
      const st = newStats(name, '');
      st.errors.push({ message: String((e && e.message) || e), stack: '', directive: '', blockedURI: '' });
      const rep = makeReport(st);
      rep.verdict = 'fail';
      rep.note = '载入失败：' + String((e && e.message) || e);
      lastReport = rep;
      publishReport(rep);
    }
  }

  /* ------------------------------------------------------------------ *
   * 绑定
   * ------------------------------------------------------------------ */
  function bind() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) {
        const view = e.target.closest('button[data-view]');
        if (view) setView(view.dataset.view);
        const cp = e.target.closest('[data-copy]');
        if (cp) {
          const i = Number(cp.dataset.copy);
          if (batchResults[i]) copyReport(batchResults[i]);
        }
        return;
      }
      const act = btn.dataset.act;
      if (act === 'sample') {
        el.code.value = sampleHtml();
        currentFile = '示例形态';
        lineMsg('已载入示例。点「运行 / 重跑」', 'ok');
      } else if (act === 'prompt') {
        const p = (window.LIZI_STUDIO && LIZI_STUDIO._prompt) || '';
        copyText(p).then((ok) => lineMsg(ok ? '工坊提示词已复制' : '复制失败：请手动复制', ok ? 'ok' : 'bad'));
      } else if (act === 'check') {
        validateOnly();
      } else if (act === 'run') {
        startSingle({});
      } else if (act === 'batch') {
        el.fileMany.value = '';
        el.fileMany.click();
      } else if (act === 'open') {
        el.fileOne.value = '';
        el.fileOne.click();
      } else if (act === 'play') {
        togglePlay();
      } else if (act === 'beat') {
        play.manualBeat++;
        post('beat', { index: play.manualBeat, level: 0.8 });
        lineMsg('已手动打一拍', 'ok');
      } else if (act === 'init') {
        resendInit();
      } else if (act === 'selfcheck') {
        const rep = lastReport || (stats ? makeReport(stats) : null);
        if (rep) { lastReport = rep; copyReport(rep); }
        else lineMsg('还没有可自检的运行结果', 'bad');
      } else if (act === 'toggle-log') {
        toggleLog();
      } else if (act === 'clear-err') {
        if (stats) { stats.errors = []; stats.cspViolations = []; }
        clearErrorsUI();
      } else if (act === 'copy-err') {
        if (!stats) return;
        const txt = stats.errors.map((x) => x.message + (x.stack ? '\n' + x.stack : '')).join('\n\n')
          + (stats.cspViolations.length ? '\n\nCSP：' + stats.cspViolations.map((x) => x.directive + ' ' + x.blockedURI).join('\n') : '');
        copyText(txt).then((ok) => lineMsg(ok ? '错误已复制' : '复制失败', ok ? 'ok' : 'bad'));
      } else if (act === 'batch-stop') {
        batchStop = true;
        btn.textContent = '正在停止…';
      } else if (act === 'export-md') {
        exportMarkdown();
      } else if (act === 'export-json') {
        exportJson();
      } else if (act === 'batch-close') {
        el.batch.hidden = true;
      }
    });

    el.fileOne.addEventListener('change', () => {
      const f = el.fileOne.files && el.fileOne.files[0];
      if (f) loadEditorFile(f);
    });
    el.fileMany.addEventListener('change', () => {
      const fs = el.fileMany.files;
      if (fs && fs.length) startBatch(fs);
    });

    el.play.addEventListener('click', togglePlay);
    el.seek.addEventListener('input', () => seekTo(el.seek.value));
    el.duration.addEventListener('change', applyDuration);
    el.duration.addEventListener('input', applyDuration);
    el.bpm.addEventListener('change', applyBpm);
    el.bpm.addEventListener('input', applyBpm);
    el.autoLive.addEventListener('change', () => {
      [el.lvLevel, el.lvBass, el.lvMid, el.lvTreble].forEach((x) => { x.disabled = el.autoLive.checked; });
    });

    /* 拖入一个 = 载入编辑器；拖入多个 = 批量 */
    document.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      el.code.classList.add('is-drop');
    });
    document.addEventListener('dragleave', (e) => {
      if (e.target === document.documentElement) el.code.classList.remove('is-drop');
    });
    document.addEventListener('drop', (e) => {
      el.code.classList.remove('is-drop');
      const fs = e.dataTransfer && e.dataTransfer.files;
      if (!fs || !fs.length) return;
      e.preventDefault();
      if (fs.length > 1) startBatch(fs);
      else loadEditorFile(fs[0]);
    });

    el.autoLive.dispatchEvent(new Event('change'));
    paintTime();
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function start() {
    if (!window.LIZI_STUDIO) {
      lineMsg('studio.js 没加载：先确认本地服务在跑', 'bad');
      return;
    }
    el.lyrics.value = defaultLyrics();
    play.duration = 40;
    el.duration.value = '40';
    bind();
    if (badgeMode) document.body.classList.add('is-badge');

    const q = new URLSearchParams(location.search);
    if (q.get('view')) setView(q.get('view'));

    let saved = '';
    try { saved = sessionStorage.getItem(LAB_KEY) || ''; } catch { /* 忽略 */ }
    if (saved) {
      el.code.value = saved;
      currentFile = '从工坊带入的草稿';
      try { sessionStorage.removeItem(LAB_KEY); } catch { /* 忽略 */ }
      lineMsg('已从工坊带入当前代码', 'ok');
    }

    if (q.get('stage')) {
      loadFromUrl(q.get('stage'), q.get('auto') === '1');
    } else if (autoMode && el.code.value.trim()) {
      startSingle({ auto: true });
    } else if (!el.code.value.trim()) {
      setStatus('等待运行');
    }
  }

  start();
})();
