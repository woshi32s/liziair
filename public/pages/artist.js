/**
 * pages/artist.js —— 歌手页（ESM）
 *
 * 布局（别自由发挥）：
 *   顶部   左 120 头像 / 右 名字 + 「45 张专辑 · 582 首歌」+ briefDesc 两行截断
 *   热门   Top 10，一行一首（序号 / 标题 / 时长 / hover 播放），点一行即播
 *   专辑   4~6 列网格，12 张一批，「加载更多」或滚到底继续
 *   全部歌曲  # / 标题 / 时长；工具条 = 搜索框（只过滤已加载）+ 排序（热度/时间）+ 加载更多
 *
 * 入口：nav.js 负责访问栈和视图切换，这里只管把 #view-artist 画出来。
 */

import { ensureCss, esc, fmtDur, fmtDate, fmtYear, imgSrc, api, playList, currentId } from './util.js';

const ALBUM_PAGE = 12;
const SONG_PAGE = 100;
const HOT_N = 10;

/** 当前这一页的状态（换歌手才重建；回退复用同一份，不重拉接口） */
let S = null;

const elOf = (v) => v || document.getElementById('view-artist');

/* ================================================================== *
 * 骨架
 * ================================================================== */
function shell() {
  return `
  <div class="pg">
    <header class="pg-head" data-head>
      <div class="pg-ava pg-ava--ph"></div>
      <div class="pg-head__text">
        <h1 class="pg-name"></h1>
        <p class="pg-counts"></p>
      </div>
    </header>

    <section class="pg-sec">
      <div class="pg-sec__h"><b>热门</b><span>Top ${HOT_N}</span></div>
      <ol class="pg-hots" data-hots></ol>
      <p class="pg-hint" data-hots-hint hidden></p>
    </section>

    <section class="pg-sec">
      <div class="pg-sec__h"><b>专辑</b><span data-album-count></span></div>
      <div class="pg-albums" data-albums></div>
      <p class="pg-hint" data-albums-hint hidden></p>
      <div class="pg-foot"><button class="pg-more" data-more-albums hidden>加载更多</button></div>
    </section>

    <section class="pg-sec">
      <div class="pg-sec__h"><b>全部歌曲</b><span data-song-count></span></div>
      <div class="pg-tools">
        <input class="pg-search" type="search" placeholder="搜索他的歌" data-filter
               autocomplete="off" spellcheck="false" aria-label="在已加载的歌曲里搜索">
        <div class="pg-sort" data-sort role="group" aria-label="排序">
          <button type="button" data-order="hot" class="is-on">热度</button><button type="button" data-order="time">时间</button>
        </div>
        <button class="pg-more" data-more-songs hidden>加载更多</button>
      </div>
      <ol class="pg-songs" data-songs></ol>
      <p class="pg-hint" data-songs-hint hidden></p>
    </section>
  </div>`;
}

/* ================================================================== *
 * 行 / 卡片
 * ================================================================== */
const num = (i) => String(i + 1).padStart(2, '0');

function hotRow(t, i) {
  return `<li class="pg-row pg-row--hot" data-i="${i}" data-id="${t.id}" title="${esc(t.name)}">
    <span class="pg-row__i"><span class="pg-row__num">${num(i)}</span><span class="pg-row__pl" aria-hidden="true">▶</span></span>
    <span class="pg-row__n">${esc(t.name)}</span>
    <span class="pg-row__d">${fmtDur(t.duration)}</span>
  </li>`;
}

function songRow(t, i) {
  return `<li class="pg-row" data-i="${i}" data-id="${t.id}" title="${esc(t.name)}">
    <span class="pg-row__i"><span class="pg-row__num">${num(i)}</span></span>
    <span class="pg-row__n">${esc(t.name)}</span>
    <span class="pg-row__d">${fmtDur(t.duration)}</span>
  </li>`;
}

function albumCard(a) {
  return `<div class="pg-album" data-alb="${a.id}" role="link" tabindex="0"
       title="${esc(a.name)}" aria-label="专辑 ${esc(a.name)}">
    <div class="pg-album__cover"><img src="${imgSrc(a.cover, 400)}" alt="" decoding="async"></div>
    <div class="pg-album__name">${esc(a.name)}</div>
    <div class="pg-album__meta">${fmtYear(a.publishTime)}${a.size ? ` · ${a.size} 首` : ''}</div>
  </div>`;
}

/* ================================================================== *
 * 上屏
 * ================================================================== */
function paintHead(el) {
  const a = S.artist || {};
  const box = el.querySelector('[data-head]');
  if (!box) return;
  const ava = box.querySelector('.pg-ava');
  const url = imgSrc(a.avatar, 320);
  ava.classList.toggle('pg-ava--ph', !url);
  ava.innerHTML = url ? `<img src="${url}" alt="">` : '';
  box.querySelector('.pg-name').textContent = a.name || '未知歌手';
  /* 这行是验收基准：周杰伦 → 「45 张专辑 · 582 首歌」 */
  box.querySelector('.pg-counts').textContent = `${a.albumSize || 0} 张专辑 · ${a.musicSize || 0} 首歌`;
  const old = box.querySelector('.pg-brief');
  if (old) old.remove();
  if (a.briefDesc) {
    const p = document.createElement('p');
    p.className = 'pg-brief';
    p.textContent = a.briefDesc;
    box.querySelector('.pg-head__text').appendChild(p);
  }
}

function paintHot(el) {
  const box = el.querySelector('[data-hots]');
  const hint = el.querySelector('[data-hots-hint]');
  if (!box) return;
  box.innerHTML = S.hot.map(hotRow).join('');
  if (hint) {
    hint.hidden = S.hot.length > 0;
    hint.textContent = '没有热门曲目';
  }
  paintCurrent(el);
}

function paintAlbums(el) {
  const box = el.querySelector('[data-albums]');
  if (!box) return;
  box.innerHTML = S.albums.map(albumCard).join('');
  const cnt = el.querySelector('[data-album-count]');
  if (cnt) cnt.textContent = S.artist && S.artist.albumSize
    ? `${S.albums.length} / ${S.artist.albumSize}` : `${S.albums.length} 张`;
  const hint = el.querySelector('[data-albums-hint]');
  if (hint) { hint.hidden = S.albums.length > 0; hint.textContent = '这个歌手还没有专辑'; }
  const btn = el.querySelector('[data-more-albums]');
  if (btn) { btn.hidden = !S.albumMore; btn.disabled = false; }
}

function paintSongs(el) {
  const box = el.querySelector('[data-songs]');
  if (!box) return;
  const f = S.filter.trim().toLowerCase();
  // 「搜索他的歌」= 在**已加载**的集合里过滤，不再发请求（用户拍板）
  S.shown = f
    ? S.songs.filter((t) => [t.name, t.artists, t.album].some((x) => String(x || '').toLowerCase().includes(f)))
    : S.songs;
  box.innerHTML = S.shown.map(songRow).join('');
  const cnt = el.querySelector('[data-song-count]');
  if (cnt) {
    cnt.textContent = f
      ? `${S.shown.length} / 已加载 ${S.songs.length} 首`
      : `${S.songs.length}${S.songTotal ? ` / ${S.songTotal}` : ''} 首`;
  }
  const hint = el.querySelector('[data-songs-hint]');
  if (hint) {
    hint.hidden = S.shown.length > 0;
    hint.textContent = f ? `已加载的 ${S.songs.length} 首里没有匹配「${S.filter}」` : '还没有歌';
  }
  const btn = el.querySelector('[data-more-songs]');
  if (btn) { btn.hidden = !S.songMore; btn.disabled = false; }
  paintCurrent(el);
}

/** 给正在播的那行标红（只认 Player 的状态，不另存一份） */
function paintCurrent(el) {
  const id = currentId();
  el.querySelectorAll('.pg-row.is-on').forEach((r) => r.classList.remove('is-on'));
  if (!id || !S) return;
  const mark = (sel, list) => {
    const i = (list || []).findIndex((t) => t.id === id);
    if (i < 0) return;
    const row = el.querySelector(`${sel} .pg-row[data-i="${i}"]`);
    if (row) row.classList.add('is-on');
  };
  mark('[data-hots]', S.hot);
  mark('[data-songs]', S.shown);
}

/* ================================================================== *
 * 取数
 * ================================================================== */
async function loadAlbums(el, reset) {
  if (!S || S.albumBusy) return;
  S.albumBusy = true;
  const offset = reset ? 0 : S.albums.length;
  const btn = el.querySelector('[data-more-albums]');
  if (btn) btn.disabled = true;
  try {
    const d = await api.artistAlbums(S.id, ALBUM_PAGE, offset);
    if (!S) return;
    const list = d.albums || [];
    S.albums = reset ? list : S.albums.concat(list);
    S.albumMore = !!d.more && list.length > 0;
    paintAlbums(el);
  } catch (e) {
    const hint = el.querySelector('[data-albums-hint]');
    if (hint) { hint.hidden = false; hint.textContent = `专辑载入失败：${e.message}`; }
  } finally {
    S.albumBusy = false;
    const b = el.querySelector('[data-more-albums]');
    if (b) b.disabled = false;
  }
}

async function loadSongs(el, reset) {
  if (!S || S.songBusy) return;
  S.songBusy = true;
  const offset = reset ? 0 : S.songs.length;
  if (reset) { S.songs = []; S.shown = []; }
  try {
    const d = await api.artistSongs(S.id, { limit: SONG_PAGE, offset, order: S.order });
    if (!S) return;
    const list = d.songs || [];
    S.songs = reset ? list : S.songs.concat(list);
    if (d.total) S.songTotal = d.total;
    else if (reset) S.songTotal = S.songs.length;
    // total 会比实际能给的少（版权/下架），两边都要看，不然「加载更多」永远不消失
    S.songMore = list.length > 0 && S.songs.length < S.songTotal;
    paintSongs(el);
  } catch (e) {
    const hint = el.querySelector('[data-songs-hint]');
    if (hint) { hint.hidden = false; hint.textContent = `歌曲载入失败：${e.message}`; }
  } finally {
    S.songBusy = false;
  }
}

/* ================================================================== *
 * 交互
 * ================================================================== */
function bind(el) {
  el.onclick = (e) => {
    if (!S) return;
    if (e.target.closest('[data-more-albums]')) { loadAlbums(el, false); return; }
    if (e.target.closest('[data-more-songs]')) { loadSongs(el, false); return; }
    const sort = e.target.closest('[data-sort] button');
    if (sort) {
      const order = sort.dataset.order === 'time' ? 'time' : 'hot';
      if (order === S.order) return;
      S.order = order;
      el.querySelectorAll('[data-sort] button').forEach((b) =>
        b.classList.toggle('is-on', b.dataset.order === order));
      loadSongs(el, true);
      return;
    }
    const hot = e.target.closest('[data-hots] .pg-row');
    if (hot) { playList(S.hot, +hot.dataset.i); paintCurrent(el); return; }
    const song = e.target.closest('[data-songs] .pg-row');
    if (song) { playList(S.shown, +song.dataset.i); paintCurrent(el); }
  };

  el.oninput = (e) => {
    if (!S || !e.target.matches('[data-filter]')) return;
    S.filter = e.target.value;
    paintSongs(el);
  };

  /* 滚到底继续拉专辑（12 张一批）。第一次渲染不自动触发，
     免得一进页面就把 45 张全拉完 —— 用户要的是「滚到底或点按钮」。 */
  el.onscroll = () => {
    if (!S || S.albumBusy || !S.albumMore) return;
    const nearBottom = el.scrollTop + el.clientHeight > el.scrollHeight - 320;
    if (nearBottom) loadAlbums(el, false);
  };
}

/* ================================================================== *
 * 对外
 * ================================================================== */
export async function mount(viewEl, params = {}) {
  ensureCss();
  const el = elOf(viewEl);
  const id = Number(params.id);
  if (!el || !id) return;

  /* 同一歌手再次进来（从专辑页按返回）：复用已有 DOM，滚动位置也不丢 */
  if (S && S.id === id) {
    bind(el);
    paintCurrent(el);
    return;
  }

  S = {
    id, artist: null, hot: [],
    albums: [], albumMore: true, albumBusy: false,
    songs: [], shown: [], songTotal: 0, songMore: true, songBusy: false,
    order: 'hot', filter: '',
  };
  el.innerHTML = shell();
  el.scrollTop = 0;
  bind(el);

  try {
    const d = await api.artist(id);
    if (!S || S.id !== id) return;
    S.artist = d.artist || {};
    S.hot = (d.hotSongs || []).slice(0, HOT_N);
    paintHead(el);
    paintHot(el);
  } catch (e) {
    const head = el.querySelector('[data-head]');
    if (head) head.innerHTML = `<p class="pg-hint">歌手载入失败：${esc(e.message)}</p>`;
  }

  // 专辑墙和全部歌曲并行；谁先回来谁先画
  await Promise.all([loadAlbums(el, true), loadSongs(el, true)]);
}

/** 独立入口（调试/深链用）：nav.js 才是带访问栈的正路 */
export function open(id) {
  ensureCss();
  return mount(document.getElementById('view-artist'), { id });
}

/** 用歌曲 id 反查歌手 id（DJ 台曲库那格用） */
export async function artistIdOfSong(songId) {
  const d = await api.song(songId);
  const t = (d.tracks || [])[0];
  return t && t.artistIds && t.artistIds[0] ? t.artistIds[0] : null;
}
