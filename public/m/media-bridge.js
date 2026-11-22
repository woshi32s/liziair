/* ==========================================================================
   手机壳 · 锁屏 / 控制中心的播放条
   --------------------------------------------------------------------------
   只给安卓壳（app.lizi.air）用：window.__liziNative.updateMedia 存在才工作，
   纯网页 / 桌面端一行都不会跑。

   推：标题 / 歌手 / 封面地址 / 播放态 / 进度（切歌、播放暂停时立刻推，
       播放中每秒推一次，只推整秒，避免把 JS 桥刷爆）
   收：window.__liziMediaCommand("play" | "pause" | "next" | "prev" | "seek:<ms>")
       —— 由 MainActivity 在锁屏 / 通知按钮被点时通过 evaluateJavascript 打进来。

   不复制、不修改 player.js 的任何状态，只读 Player.audio 和播放页那两行文字。
   ========================================================================== */
(function () {
  'use strict';

  var nat = null;
  try {
    if (window.__liziNative && typeof window.__liziNative.updateMedia === 'function') {
      nat = window.__liziNative;
    }
  } catch (e) { nat = null; }
  if (!nat) return;                       /* 桌面 / 浏览器里到此为止 */

  var lastKey = '';
  var lastSec = -1;
  var hooked = false;

  function text(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function snapshot() {
    var art = document.getElementById('now-art');
    var audio = null;
    try { audio = (typeof Player !== 'undefined' && Player) ? Player.audio : null; } catch (e) { audio = null; }
    var dur = audio && isFinite(audio.duration) ? audio.duration : 0;
    return {
      title: text(document.querySelector('#view-now .now__title')),
      artist: text(document.querySelector('#view-now .now__sub')),
      album: '',
      /* 封面走本地代理，安卓那边直接 GET 这个地址取图 */
      art: (art && art.src && art.src.indexOf('data:') !== 0) ? art.src : '',
      playing: !!(audio && audio.src && !audio.paused),
      position: audio && isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0,
      duration: Math.round(dur * 1000)
    };
  }

  function push(force) {
    var s = snapshot();
    var key = [s.title, s.artist, s.art, s.playing, s.duration].join('|');
    var sec = Math.floor(s.position / 1000);
    if (!force && key === lastKey && sec === lastSec) return;
    lastKey = key;
    lastSec = sec;
    try {
      nat.updateMedia(JSON.stringify(s));
    } catch (e) { /* 壳已经走了就安静退出 */ }
  }

  function hook() {
    if (hooked || typeof Player === 'undefined' || !Player || typeof Player.on !== 'function') return false;
    hooked = true;
    Player.on('trackchange', function () { push(true); });
    Player.on('source', function () { push(true); });
    Player.on('playstate', function () { push(true); });
    Player.on('time', function () { push(false); });
    push(true);
    return true;
  }

  if (!hook()) {
    /* app.js / player.js 在页面后段才就绪：轮询到挂上为止（最多 20 秒） */
    var tries = 0;
    var t = setInterval(function () {
      if (hook() || ++tries > 100) clearInterval(t);
    }, 200);
  }

  /* 切前台 / 回后台各补推一次：后台可能被系统掐过一轮事件 */
  document.addEventListener('visibilitychange', function () { push(true); });
  window.addEventListener('pagehide', function () { push(true); });

  /* 锁屏 / 控制中心 / 蓝牙按键打回来的命令 */
  window.__liziMediaCommand = function (cmd) {
    if (typeof cmd !== 'string') return;
    try {
      if (typeof Player === 'undefined' || !Player) return;
      var audio = Player.audio;
      if (cmd === 'play') {
        if (audio && audio.src && audio.paused) Player.toggle();
        else if (!audio || !audio.src) Player.toggle();      /* 没歌时让 Player 自己决定 */
      } else if (cmd === 'pause') {
        if (audio && !audio.paused) Player.toggle();
      } else if (cmd === 'next') {
        Player.next();
      } else if (cmd === 'prev') {
        Player.prev();
      } else if (cmd.indexOf('seek:') === 0) {
        var ms = parseInt(cmd.slice(5), 10);
        if (isFinite(ms) && ms >= 0) Player.seek(ms / 1000);
      }
    } catch (e) { /* 命令失败不影响播放 */ }
    setTimeout(function () { push(true); }, 150);
  };
})();
