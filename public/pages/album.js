/**
 * pages/album.js —— 专辑页（ESM）
 *
 * 布局（用户拍板，别改）：
 *   左：380×380 大封面 —— **整页唯一一张图**（曲目行一律不带小封面）
 *   右：专辑名 / 艺人（可点 → 歌手页）/ 发行日期 / 公司 / 曲目数 + 总时长 /
 *       [播放全部] / 简介（3 行折叠，可展开）
 *   下：曲目表 # / 标题 / 艺人 / 时长，双击或点行播放
 */

import { ensureCss, esc, fmtDur, fmtLong, fmtDate, imgSrc, api, playList, currentId } from './util.js';
import * as collection from './collection.js';

let A = null;   // { id, album, songs }

const elOf = (v) => v || document.getElementById('view-album');

/* 曲目行：**没有 img**，一行一首 */
function row(t, i) {
  const arts = String(t.artists || '').split(/\s*\/\s*/);
  const ids = t.artistIds || [];
  const artistHtml = arts.map((n, k) => (ids[k]
    ? `<a class="entry-a" data-aid="${ids[k]}" role="link" tabindex="0">${esc(n)}</a>`
    : esc(n))).join(' / ');
  return `<li class="pg-row" data-i="${i}" data-id="${t.id}" title="${esc(t.name)}">
    <span class="pg-row__i"><span class="pg-row__num">${String(i + 1).padStart(2, '0')}</span></span>
    <span class="pg-row__n">${esc(t.name)}</span>
    <span class="pg-row__a">${artistHtml}</span>
    <span class="pg-row__d">${fmtDur(t.duration)}</span>
  </li>`;
}

function render(el) {
  const a = A.album || {};
  const songs = A.songs || [];
  const total = songs.reduce((s, t) => s + (Number(t.duration) || 0), 0);
  const arts = a.artists && a.artists.length ? a.artists : [{ id: 0, name: t0(songs) }];
  const artistHtml = arts.map((x) => (x.id
    ? `<a class="entry-a" data-aid="${x.id}" role="link" tabindex="0">${esc(x.name)}</a>`
    : esc(x.name))).join(' / ');

  el.innerHTML = `
  <div class="pg">
    <section class="pg-album-hero">
      <div class="pg-album-art">
        ${a.cover ? `<img src="${imgSrc(a.cover, 800)}" alt="${esc(a.name)}">` : ''}
      </div>
      <div class="pg-album-info">
        <p class="pg-kicker">专辑</p>
        <h1 class="pg-album-name">${esc(a.name || '未知专辑')}</h1>
        <p class="pg-album-artist">${artistHtml}</p>
        <dl class="pg-meta">
          <div><dt>发行日期</dt><dd data-meta="date">${fmtDate(a.publishTime)}</dd></div>
          <div><dt>公司</dt><dd data-meta="company">${esc(a.company || '—')}</dd></div>
          <div><dt>曲目</dt><dd data-meta="count">${songs.length || a.size || 0} 首 · ${fmtLong(total)}</dd></div>
        </dl>
        <div class="pg-acts">
          <button class="pg-play" data-playall>播放全部</button>
          <!-- 收纳到我的专辑：1px 细线、方角、无阴影（跟「播放全部」并列但不抢它） -->
          <button class="pg-collect" id="btn-collect" type="button" data-collect aria-pressed="false">
            <svg class="pg-collect__i" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path class="pg-collect__plus" d="M8 3.1v9.8M3.1 8h9.8" fill="none"
                    stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              <path class="pg-collect__check" d="M3.3 8.5l3.1 3.2 6.3-7.1" fill="none"
                    stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span data-collect-text>收纳到我的专辑</span>
          </button>
        </div>
        ${a.description ? `
          <p class="pg-desc" data-desc>${esc(a.description)}</p>
          <button class="pg-desc__more" data-desc-toggle>展开</button>` : ''}
      </div>
    </section>

    <section class="pg-sec">
      <div class="pg-sec__h"><b>曲目</b><span data-track-count>${songs.length} 首 · ${fmtLong(total)}</span></div>
      <div class="pg-tbl">
        <div class="pg-row pg-row--head">
          <span>#</span><span>标题</span><span>艺人</span><span>时长</span>
        </div>
        <ol class="pg-album-tracks" data-tracks>${songs.map(row).join('')}</ol>
      </div>
      <p class="pg-hint" data-tracks-hint ${songs.length ? 'hidden' : ''}>这张专辑没有可播的曲目</p>
    </section>
  </div>`;
  paintCurrent(el);
  paintCollect(el);
}

/* ==================================================================
 * 收藏：「收纳到我的专辑」按钮
 *   数据在 pages/collection.js（localStorage），这里只负责把 A 摊成收藏项、
 *   以及把按钮文案/图标跟着状态切。点击后不刷新、不跳页，就地反馈。
 * ================================================================== */

/** 专辑页的数据 → 收藏项；专辑对象里没有 source 的一律当 netease */
function collectPayload() {
  const a = (A && A.album) || {};
  const arts = (a.artists && a.artists.length)
    ? a.artists.map((x) => x.name).filter(Boolean)
    : [t0((A && A.songs) || [])];
  return {
    id: A.id,
    source: a.source || 'netease',
    name: a.name || '未知专辑',
    artists: arts.join(' / '),
    cover: a.cover || '',
    publishTime: a.publishTime || 0,
    trackCount: (A.songs || []).length || a.size || 0,
  };
}

/** 按钮两种状态：未收藏「收纳到我的专辑」/ 已收藏「已在我的专辑」 */
function paintCollect(el) {
  const btn = el && el.querySelector('#btn-collect');
  if (!btn || !A || !A.album) return;
  const on = collection.has(collection.keyOf(collectPayload()));
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '再点一次就取消收藏' : '收进「我的专辑」的陈列架';
  const t = btn.querySelector('[data-collect-text]');
  if (t) t.textContent = on ? '已在我的专辑' : '收纳到我的专辑';
}

/* 别处（我的专辑视图里移除、另一个标签页）改了收藏 → 这边跟着变 */
collection.onChange(() => paintCollect(elOf()));

/** 专辑没给 artists[] 时，退回收目里的第一个艺人名 */
function t0(songs) {
  const t = songs.find((x) => x.artists);
  return t ? String(t.artists).split(' / ')[0] : '未知歌手';
}

function paintCurrent(el) {
  const id = currentId();
  el.querySelectorAll('[data-tracks] .pg-row.is-on').forEach((r) => r.classList.remove('is-on'));
  if (!id) return;
  const i = (A.songs || []).findIndex((t) => t.id === id);
  if (i < 0) return;
  const r = el.querySelector(`[data-tracks] .pg-row[data-i="${i}"]`);
  if (r) r.classList.add('is-on');
}

function bind(el) {
  el.onclick = (e) => {
    if (e.target.closest('[data-playall]')) { playList(A.songs, 0); paintCurrent(el); return; }
    const cb = e.target.closest('[data-collect]');
    if (cb) {
      /* 一步切换：没收 → 收；已收 → 取消。文案/图标就地跟着变，不刷新不跳页 */
      collection.toggle(collectPayload());
      paintCollect(el);
      return;
    }
    const dt = e.target.closest('[data-desc-toggle]');
    if (dt) {
      const d = el.querySelector('[data-desc]');
      if (!d) return;
      const open = d.classList.toggle('is-open');
      dt.textContent = open ? '收起' : '展开';
      return;
    }
    const tr = e.target.closest('[data-tracks] .pg-row');
    if (tr) { playList(A.songs, +tr.dataset.i); paintCurrent(el); }
  };
}

export async function mount(viewEl, params = {}) {
  ensureCss();
  const el = elOf(viewEl);
  const id = Number(params.id);
  if (!el || !id) return;

  if (A && A.id === id) { bind(el); paintCurrent(el); paintCollect(el); return; }

  A = { id, album: null, songs: [] };
  el.innerHTML = '<div class="pg"><p class="pg-hint">专辑载入中…</p></div>';
  el.scrollTop = 0;

  try {
    const d = await api.album(id);
    if (!A || A.id !== id) return;
    A.album = d.album || {};
    A.songs = d.songs || [];
    render(el);
    bind(el);
  } catch (e) {
    el.innerHTML = `<div class="pg"><p class="pg-hint">专辑载入失败：${esc(e.message)}</p></div>`;
  }
}

/** 独立入口（调试/深链用）：nav.js 才是带访问栈的正路 */
export function open(id) {
  ensureCss();
  return mount(document.getElementById('view-album'), { id });
}
