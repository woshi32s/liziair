/**
 * vip-notice.js —— 「当前 XX 平台账号未开通 VIP，仅支持试听」提示
 * ==========================================================================
 * 触发条件（两个都满足才弹）：
 *   1) 正在放的是 VIP 曲目：track.fee 为 1/4（网易云 VIP），
 *      或 Player 的 source 事件 reason === 'vip'（VIP 专属、已退化成演示音轨）。
 *   2) 当前平台账号**确定**没有 VIP：LIZI_ACCOUNTS 里该平台的 check() 回来了，
 *      并且不是「查询失败」。未登录也算没有 VIP（会弹）。
 *
 * 三条不能踩的线：
 *   · 超时 4 秒：accounts.check() 自己带 8 秒超时（给大厅卡片用的），提示等不了。
 *     4 秒没回来就当「未知」。
 *   · 未知不弹：超时 / 抛错 / error:true 一律不弹。绝不能把「没查到」说成
 *     「没开 VIP」——那是误报，比不提示更糟。
 *   · 切歌作废旧结果：连切歌曲时上一首的查询可能晚到，每次 notice 自增 seq，
 *     异步回来发现 seq 变了就丢弃，免得弹出上一首的提示。
 *
 * 缓存：同一平台 5 分钟内复用结果；同一平台的并发查询合并成同一个 Promise。
 * 登录 / 退出时 app.js 会发 document 的 'lizi:platforms' 事件，这里清缓存。
 *
 * 对外：window.LIZI_VIP = { notice, vipOf, state, clearCache }
 *   notice(track, extra)   source 事件里调用，extra 可带 reason
 *   vipOf(id)              Promise<true|false|null>，null = 未知
 *   state / clearCache()   调试用
 * ========================================================================== */
const LIZI_VIP = (() => {
  'use strict';

  /* 提示文案里的短名（和 hall/accounts.js 的 name 不同：那边是「QQ 音乐」，这里是「QQ音乐」） */
  const PLATFORMS = {
    netease: '网易云',
    qq: 'QQ音乐',
    kugou: '酷狗',
    qishui: '汽水',
    bodian: '波点',
  };

  const CHECK_TIMEOUT = 4000;              // 超过就当未知，不弹
  const CACHE_TTL = 5 * 60 * 1000;         // 5 分钟内复用账号 VIP 状态
  const DEDUPE_MS = 3000;                  // 同一首歌 3 秒内不重复弹
  const HIDE_MS = 6000;                    // toast 自动收起
  /* 设置里的「VIP 提示」总开关：'0' 才是关，缺省开。 */
  const ENABLED_KEY = 'lizi.playbackTip';
  const enabled = () => {
    try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
  };

  const cache = new Map();                 // id → { vip: true|false|null, at }
  const inflight = new Map();              // id → Promise（并发只查一次）
  const TIMEOUT = Symbol('timeout');

  let seq = 0;                             // 每次 notice 自增，用来作废过期结果
  let tipEl = null;
  let hideTimer = 0;
  let lastKey = '';
  let lastAt = 0;

  /** 竞速：超时或 reject 都返回 TIMEOUT，由调用方按「未知」处理 */
  function withTimeout(p, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(TIMEOUT), ms);
      p.then(
        (v) => { clearTimeout(timer); resolve(v); },
        () => { clearTimeout(timer); resolve(TIMEOUT); }
      );
    });
  }

  /**
   * 该平台账号有没有 VIP。
   * true = 有；false = 没有（含未登录）；null = 没查清（不弹）。
   */
  function vipOf(id) {
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_TTL) return Promise.resolve(hit.vip);

    const running = inflight.get(id);
    if (running) return running;           // 同一平台并发调用共用一个查询

    const p = (async () => {
      let vip = null;
      try {
        const list = (typeof window !== 'undefined' && Array.isArray(window.LIZI_ACCOUNTS))
          ? window.LIZI_ACCOUNTS
          : [];
        const acct = list.find((a) => a && a.id === id);
        if (!acct || typeof acct.check !== 'function') {
          vip = null;                      // 注册表里没有：未知
        } else {
          const r = await withTimeout(Promise.resolve().then(() => acct.check()), CHECK_TIMEOUT);
          if (r === TIMEOUT || !r || r.error === true) vip = null;
          else vip = r.vip === true;       // 未登录时没有 vip 字段 → false
        }
      } catch {
        vip = null;                        // check() 抛错：未知
      }
      /* 只缓存确定结果：未知（超时/边车没起）不能锁死 5 分钟，下一首再查一次 */
      if (vip !== null) cache.set(id, { vip, at: Date.now() });
      return vip;
    })();

    inflight.set(id, p);
    p.then(() => inflight.delete(id), () => inflight.delete(id));
    return p;
  }

  function hide() {
    clearTimeout(hideTimer);
    hideTimer = 0;
    if (tipEl) tipEl.classList.remove('is-on');
  }

  function show(pid, key) {
    if (!enabled()) return;                // 查询回来之前用户已经关掉：不再补弹
    if (typeof document === 'undefined') return;
    if (!document.body) {
      /* DOM 还没就绪就别先记去重时间，否则延后执行时会被自己挡掉 */
      document.addEventListener('DOMContentLoaded', () => show(pid, key), { once: true });
      return;
    }

    const now = Date.now();
    if (key === lastKey && now - lastAt < DEDUPE_MS) return;  // 同一首重进不重复
    lastKey = key;
    lastAt = now;

    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'vip-tip';
      tipEl.setAttribute('role', 'status');
      tipEl.setAttribute('aria-live', 'polite');
      tipEl.addEventListener('click', hide);
      document.body.appendChild(tipEl);
    }

    tipEl.textContent = `当前 ${PLATFORMS[pid]} 平台账号未开通 VIP，仅支持试听`;
    tipEl.classList.add('is-on');
    clearTimeout(hideTimer);               // 重新弹出时先清掉旧的收起计时
    hideTimer = setTimeout(hide, HIDE_MS);
  }

  /** Player 的 source 事件里调用；extra.reason === 'vip' 也算 VIP 曲目 */
  function notice(track, extra) {
    if (!enabled()) return;
    if (!track) return;
    /* 网易云曲目没有 source 字段（搜索 / 每日推荐 / 电台都是），app.js 那边一律按
       `track.source || 'netease'` 兜底。这里必须跟着兜，否则 pid 是 undefined，
       下面的白名单一挡，网易云的 VIP 曲目永远不提示。 */
    const pid = track.source || 'netease';
    if (!PLATFORMS[pid]) return;           // 本地音乐 / 未知来源不弹

    const isVip = track.fee === 1 || track.fee === 4
      || !!(extra && extra.reason === 'vip');
    if (!isVip) return;

    const my = ++seq;                      // 本次调用的序号：查询回来对不上就作废
    vipOf(pid).then((vip) => {
      if (my !== seq) return;              // 用户已经切歌，丢弃上一首的结果
      if (vip !== false) return;           // true = 有 VIP；null = 未知，都不弹
      show(pid, pid + ':' + (track.id || track.mid || track.name || ''));
    });
  }

  function clearCache() {
    cache.clear();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('lizi:platforms', clearCache);   // 登录 / 退出后重新查
  }

  const state = {
    get cached() { return cache.size; },
    get pending() { return inflight.size; },
    get seq() { return seq; },
  };

  return { notice, vipOf, state, clearCache };
})();

if (typeof window !== 'undefined') window.LIZI_VIP = LIZI_VIP;
