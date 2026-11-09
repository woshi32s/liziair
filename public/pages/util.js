/**
 * pages/util.js —— 歌手页 / 专辑页共用的小工具（ESM，由 app.js 按需 import）
 *
 * 这里只有三件事：注入自己的 CSS、格式化（时长/日期）、以及四个接口的薄封装。
 * 接口路径都实测过（见 server.mjs 的 ROUTES）：/api/artist/:id、/api/artist/albums/:id、
 * /api/artist/songs、/api/album/:id —— 不存在的路径别再试。
 */

let cssDone = false;
export function ensureCss() {
  if (cssDone || document.querySelector('link[data-pages]')) { cssDone = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./pages.css', import.meta.url).href;
  l.setAttribute('data-pages', '1');
  document.head.appendChild(l);
  cssDone = true;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const pad2 = (n) => String(n).padStart(2, '0');

/** 毫秒 → m:ss（列表里的时长） */
export const fmtDur = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};

/** 毫秒总和 → 「48 分 12 秒」/「1 小时 3 分」（专辑总时长） */
export const fmtLong = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} 小时 ${m} 分` : `${m} 分 ${pad2(sec)} 秒`;
};

/** 毫秒时间戳 → 2025-06-05（发行日期） */
export const fmtDate = (ms) => {
  const t = Number(ms) || 0;
  if (!t) return '—';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** 年份（专辑墙上的小字） */
export const fmtYear = (ms) => (Number(ms) ? String(new Date(Number(ms)).getFullYear()) : '—');

/** 封面一律走 /api/img 代理：网易云有防盗链，直连会被 403 */
export const imgSrc = (u, size = 400) => (u && typeof API !== 'undefined' ? API.img(u, size) : '');

async function call(path, params = {}, method = 'POST') {
  const url = new URL('/api/' + path, location.origin);
  let body;
  if (method === 'POST') body = JSON.stringify(params || {});
  else for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  /** 歌手信息 + 热门 50 首 */
  artist: (id) => call(`artist/${id}`, {}, 'GET'),
  /** 歌手专辑：一次 12 张，offset 翻页 */
  artistAlbums: (id, limit = 12, offset = 0) => call(`artist/albums/${id}`, { limit, offset }, 'GET'),
  /** 歌手全部歌曲：order = hot | time */
  artistSongs: (id, { limit = 100, offset = 0, order = 'hot' } = {}) =>
    call('artist/songs', { id, limit, offset, order }, 'POST'),
  /** 专辑详情 + 曲目 */
  album: (id) => call(`album/${id}`, {}, 'GET'),
  /** 歌曲详情：只用来从歌曲 id 反查艺人 id（DJ 台曲库那格） */
  song: (id) => call('song/detail', { ids: id }, 'POST'),
};

/** 播放器单例（页面模块里不直接抓 DOM，状态永远只有 Player 那一份） */
export const player = () => (typeof Player !== 'undefined' ? Player : null);

/** 当前在播的那首的 id（用来给行标 is-on） */
export const currentId = () => {
  const p = player();
  const st = p && p.state;
  if (!st || !st.queue || st.index < 0) return null;
  const t = st.queue[st.index];
  return t ? t.id : null;
};

/** 点一行就播：队列直接换成这页的列表，别把大厅/歌单的队列污染了 */
export function playList(list, i) {
  const p = player();
  if (!p || !list || !list.length) return;
  const idx = Math.max(0, Math.min(list.length - 1, Number(i) || 0));
  p.playQueue(list, idx);
}
