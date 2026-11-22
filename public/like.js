/**
 * 五平台红心（网易云 / QQ / 酷狗 / 汽水 / 波点）
 *
 * 两处入口共用这一份状态与请求逻辑：
 *   - 播放页底部传输排 #now-transport 的 .ntr-side--r（下一首之后）
 *   - 形态页迷你播放器 #stage-song 的 .snow__keys（#stage-next 之后）
 *
 * 不碰 app.js / player.js：
 *   - 只读 Player.state，监听 Player.on('trackchange')
 *   - 按 source:id 在 session 内缓存已赞状态
 *   - 换歌用递增 token 作废旧请求，旧响应不会改到新歌
 *
 * 接口：
 *   GET  /api/like/state?source=&id=&mid=&songId=&hash=
 *   POST /api/like  { source, track, liked }
 */
(() => {
  'use strict';

  const SOURCES = new Set(['netease', 'qq', 'kugou', 'qishui', 'bodian']);
  const LABELS = {
    netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水', bodian: '波点',
  };

  /* 24×24 心形轮廓；.ico 提供描边，.is-liked 时用 fill 填成实心 */
  const HEART = '<svg class="ico like-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3'
    + 'c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5'
    + 'c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

  /** key `source:id` -> { liked, limited } 或 { unsupported:true } */
  const cache = new Map();
  /** 当前歌曲：{ key, track, source, liked, limited, loginRequired, busy, unsupported, rev } */
  let current = null;
  /** 换歌代次：异步回调必须和它相等才有资格改界面 */
  let seq = 0;
  let stateCtl = null;
  let buttons = [];
  let toastEl = null;
  let toastTimer = 0;

  function getPlayer() {
    try {
      if (typeof Player !== 'undefined' && Player && typeof Player.on === 'function') return Player;
    } catch (_) { /* Player 还没定义 */ }
    return null;
  }

  function sourceOf(track) {
    return track && track.source ? String(track.source) : 'netease';
  }

  /** 曲目的稳定身份；和 player.js 的 trackIdentity 口径一致 */
  function trackKey(track) {
    if (!track) return '';
    let id = track.id;
    if (id == null || id === '') id = track.mid;
    if (id == null || id === '') id = track.hash;
    if (id == null || id === '') id = track.songId;
    if (id == null || id === '') return '';
    return sourceOf(track) + ':' + id;
  }

  function stateQuery(track) {
    const p = new URLSearchParams();
    p.set('source', sourceOf(track));
    if (track.id != null && track.id !== '') p.set('id', String(track.id));
    if (track.mid != null && track.mid !== '') p.set('mid', String(track.mid));
    const songId = Number(track.songId);
    if (Number.isFinite(songId) && songId > 0) p.set('songId', String(songId));
    if (track.hash != null && track.hash !== '') p.set('hash', String(track.hash));
    return p.toString();
  }

  async function readJson(res) {
    try { return await res.json(); } catch (_) { return null; }
  }

  function fail(message) {
    const err = new Error(message);
    err.userMessage = message;
    return err;
  }

  function toast(message) {
    if (!message) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'like-toast';
      toastEl.className = 'like-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
  }

  function paint(liked) {
    for (const b of buttons) {
      b.classList.toggle('is-liked', !!liked);
      b.setAttribute('aria-pressed', liked ? 'true' : 'false');
      b.title = liked ? '取消喜欢' : '喜欢';
    }
  }

  function setHidden(hidden) {
    for (const b of buttons) b.hidden = !!hidden;
  }

  function setBusy(busy) {
    for (const b of buttons) {
      b.classList.toggle('is-busy', !!busy);
      b.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function abortState() {
    if (!stateCtl) return;
    try { stateCtl.abort(); } catch (_) { /* 忽略 */ }
    stateCtl = null;
  }

  async function requestState(entry, token) {
    const ctl = new AbortController();
    const rev = entry.rev;
    stateCtl = ctl;
    try {
      const res = await fetch('/api/like/state?' + stateQuery(entry.track), {
        signal: ctl.signal,
        headers: { Accept: 'application/json' },
      });
      const data = await readJson(res);
      /* rev 也参与校验：点击后乐观状态先落地，迟到的 state 响应不能把它改回去 */
      const live = token === seq && current === entry && entry.rev === rev;

      if (data && data.ok === true) {
        /* 期间点过红心（rev 变了）就不能把旧状态写回缓存，否则下次切回来会画错 */
        if (entry.rev === rev) {
          cache.set(entry.key, { liked: !!data.liked, limited: !!data.limited });
        }
        if (!live) return;
        entry.liked = !!data.liked;
        entry.limited = !!data.limited;
        entry.loginRequired = false;
        paint(entry.liked);
        return;
      }
      if (!live) return;

      const error = (data && data.error)
        || (res.status === 401 ? 'LOGIN_REQUIRED' : '');
      if (error === 'LOGIN_REQUIRED') {
        /* 保持空心；点击时只提示登录，不发写请求 */
        entry.loginRequired = true;
        paint(false);
      } else if (error === 'UNSUPPORTED') {
        entry.unsupported = true;
        if (entry.rev === rev) cache.set(entry.key, { unsupported: true });
        setHidden(true);
      }
      /* FAILED / 网络错误：静默保持空心，不打扰正在听歌的人 */
    } catch (err) {
      if (!err || err.name !== 'AbortError') {
        /* 状态查询失败不弹提示；点击时服务端还会再校验一次 */
        try { console.warn('[like] state failed:', err && err.message ? err.message : err); } catch (_) {}
      }
    } finally {
      if (stateCtl === ctl) stateCtl = null;
    }
  }

  function syncTrack(track) {
    const source = sourceOf(track);
    if (!track || !SOURCES.has(source)) {
      seq++;
      abortState();
      current = null;
      setBusy(false);
      setHidden(true);
      return;
    }

    const key = trackKey(track);
    if (!key) {
      seq++;
      abortState();
      current = null;
      setBusy(false);
      setHidden(true);
      return;
    }

    /* 同一首重复 trackchange（例如重载队列）：只更新曲目引用，不重发请求 */
    if (current && current.key === key) {
      current.track = track;
      return;
    }

    seq++;
    abortState();
    current = {
      key,
      track,
      source,
      liked: false,
      limited: false,
      loginRequired: false,
      busy: false,
      unsupported: false,
      rev: 0,
    };
    setHidden(false);
    setBusy(false);

    const hit = cache.get(key);
    if (hit) {
      if (hit.unsupported) {
        current.unsupported = true;
        setHidden(true);
        return;
      }
      current.liked = !!hit.liked;
      current.limited = !!hit.limited;
      paint(current.liked);
      return;
    }

    paint(false);
    requestState(current, seq);
  }

  async function onLikeClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const entry = current;
    if (!entry || entry.unsupported || entry.busy) return;

    const sourceLabel = LABELS[entry.source] || entry.source;
    if (entry.loginRequired) {
      toast('先在设置里登录' + sourceLabel);
      return;
    }

    const token = seq;
    const prev = entry.liked;
    const next = !prev;

    /* 乐观更新：先画实心/空心，失败再回滚。
       rev 递增让还在路上的 state 响应作废（见 requestState 的 live 判断）。 */
    entry.rev++;
    entry.busy = true;
    entry.liked = next;
    abortState();
    paint(next);
    setBusy(true);

    try {
      const res = await fetch('/api/like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ source: entry.source, track: entry.track, liked: next }),
      });
      const data = await readJson(res);

      if (!data || data.ok !== true) {
        const error = (data && data.error)
          || (res.status === 401 ? 'LOGIN_REQUIRED' : 'FAILED');
        if (token === seq && current === entry && error === 'LOGIN_REQUIRED') {
          entry.loginRequired = true;
        }
        if (token === seq && current === entry && error === 'UNSUPPORTED') {
          entry.unsupported = true;
          setHidden(true);
        }

        if (error === 'LOGIN_REQUIRED') throw fail('先在设置里登录' + sourceLabel);
        if (error === 'UNSUPPORTED') throw fail('该平台暂不支持红心');
        throw fail((data && data.message) || '红心操作失败，请稍后再试');
      }

      cache.set(entry.key, { liked: !!data.liked, limited: entry.limited });
      if (token === seq && current === entry) {
        entry.liked = !!data.liked;
        paint(entry.liked);
      }
    } catch (err) {
      if (token === seq && current === entry) {
        entry.liked = prev;
        paint(prev);
      }
      toast((err && err.userMessage) || '红心操作失败，请稍后再试');
    } finally {
      entry.busy = false;
      /* 期间可能已经切歌：让按钮的忙碌态跟当前曲目走 */
      setBusy(!!(current && current.busy));
    }
  }

  function makeButton(id, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = className + ' like-btn';
    b.hidden = true;
    b.setAttribute('aria-label', '喜欢');
    b.setAttribute('aria-pressed', 'false');
    b.title = '喜欢';
    b.innerHTML = HEART;
    b.addEventListener('click', onLikeClick);
    return b;
  }

  function injectButtons() {
    const right = document.querySelector('#now-transport .ntr-side--r');
    if (right && !document.getElementById('ntr-like')) {
      /* 放在 .ntr-side--r 最后面（下一首之后）：下一首紧邻播放键，和左侧的上一首对称；
         红心在最外侧。放在最前面会把下一首挤到外面，左右位置就错位了。 */
      right.appendChild(makeButton('ntr-like', 'ntr ntr--like'));
    }

    const next = document.getElementById('stage-next');
    if (next && next.parentElement && !document.getElementById('stage-like')) {
      /* 紧跟在 #stage-next 后面 */
      next.insertAdjacentElement('afterend', makeButton('stage-like', 'snow__key snow__key--like'));
    }

    /* /m 播放页的右簇还多一个队列键：窄屏放不下三颗 56px 圆钮，
       标记出来让 like.css 把红心改成浮在右簇上方（只动位置，不动原按钮）。 */
    if (document.getElementById('ntr-queue')) {
      document.body.classList.add('like-has-queue');
    }

    buttons = Array.prototype.slice.call(document.querySelectorAll('.like-btn'));
  }

  function init() {
    const P = getPlayer();
    if (!P) return;                       // 没有 Player：静默退出

    injectButtons();
    if (!buttons.length) return;

    P.on('trackchange', (payload) => {
      if (payload && payload.track) syncTrack(payload.track);
    });

    /* app.js / player.js 可能在本文件之前已经恢复了队列，先按当前曲目画一次 */
    const st = P.state || {};
    const queue = Array.isArray(st.queue) ? st.queue : [];
    const track = queue[st.index];
    if (track) syncTrack(track);
    else {
      paint(false);
      setHidden(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
