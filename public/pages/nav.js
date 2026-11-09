/**
 * pages/nav.js —— 歌手页 / 专辑页的「访问栈 + 入口代理」（ESM）
 *
 * 由 app.js 在需要时 `await import('./pages/nav.js')`，app.js 那边只留：
 *   · 视图映射（show() 里 is-active + 顶栏滚动态）
 *   · 返回键 → Pages.back()
 *   · 全站 data-aid / data-alb 的一次捕获点击
 *
 * 栈的规则（用户拍板）：专辑 → 歌手 → 来源页（搜索/大厅…）→ 大厅。
 *   · 从专辑页点艺人名回到**已在栈里的**那位歌手 → 截断回退，不重复入栈
 *   · 打开新页面时如果栈是空的，记下当时所在的视图当「来源页」
 *   · 从别处切走（搜索、大厅、播放页…）→ 栈作废，避免返回键把人送到上次的歌手页
 */

import { ensureCss, api, esc } from './util.js';
import * as artist from './artist.js';
import * as album from './album.js';
import * as myalbums from './myalbums.js';

const els = () => ({
  artist: document.getElementById('view-artist'),
  album: document.getElementById('view-album'),
  myalbums: document.getElementById('view-myalbums'),
});

let stack = [];                 // [{ view: 'artist'|'album'|'myalbums', id }]
let source = 'hall';            // 第一个页面是从哪个视图点进来的
const songMeta = new Map();     // songId → track（DJ 台曲库那格的缓存）

const currentView = () => (document.body.dataset.view || 'hall');

/** 让 app.js 切视图（它监听 lizi:show；不在这里直接碰 show()） */
function go(view) {
  document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view } }));
}

export async function openArtist(id) {
  const n = Number(id);
  if (!n) return;
  ensureCss();
  const at = stack.findIndex((s) => s.view === 'artist' && s.id === n);
  if (at >= 0) stack.length = at + 1;          // 栈里已有 → 回到它
  else {
    if (!stack.length) source = currentView();
    stack.push({ view: 'artist', id: n });
  }
  go('artist');
  await artist.mount(els().artist, { id: n });
}

export async function openAlbum(id) {
  const n = Number(id);
  if (!n) return;
  ensureCss();
  const top = stack[stack.length - 1];
  if (!(top && top.view === 'album' && top.id === n)) {
    if (!stack.length) source = currentView();
    stack.push({ view: 'album', id: n });
  }
  go('album');
  await album.mount(els().album, { id: n });
}

/** 顶栏返回键：true = 已经处理（还在页面栈里），false = 交给 app.js 回大厅 */
/** 我的专辑（3D 陈列架）：独立视图，但和歌手/专辑页共用这一份栈，
 *  这样「我的专辑 → 点开一张专辑 → 返回」能回到架子上。 */
export async function openMyAlbums() {
  ensureCss();
  const at = stack.findIndex((s) => s.view === 'myalbums');
  if (at >= 0) stack.length = at + 1;          // 栈里已有 → 回到它
  else {
    if (!stack.length) source = currentView();
    stack.push({ view: 'myalbums' });
  }
  go('myalbums');
  await myalbums.mount(els().myalbums);
}

export function back() {
  if (!stack.length) return false;
  stack.pop();
  if (stack.length) {
    const top = stack[stack.length - 1];
    go(top.view);
    if (top.view === 'myalbums') myalbums.mount(els().myalbums);
    else (top.view === 'artist' ? artist : album).mount(els()[top.view], { id: top.id });
  } else {
    go(source || 'hall');
  }
  return true;
}

/** app.js 每次切视图都会叫一声：只有还停在页面上时才保留栈 */
export function onShow(view) {
  /* 我的专辑是从大厅工具箱进来的独立视图：不管谁切的视图，切到它就把它叫醒 */
  if (view === 'myalbums') { ensureCss(); myalbums.mount(els().myalbums); }
  if (!stack.length) return;
  if (view === 'artist' || view === 'album' || view === 'myalbums') return;
  stack.length = 0;
}

/** DJ 台曲库里点艺人名：曲库行有 data-key="nc:<songId>"，拿 id 反查艺人 */
export async function openArtistFromSong(songId) {
  const sid = Number(songId);
  if (!sid) return;
  let meta = songMeta.get(sid);
  if (!meta) {
    const d = await api.song(sid);
    meta = (d.tracks || [])[0] || null;
    if (meta) songMeta.set(sid, meta);
  }
  const aid = meta && meta.artistIds && meta.artistIds[0];
  if (!aid) {
    const sub = document.getElementById('lab-sub');
    if (sub) sub.textContent = '这首在网易云那边没有艺人信息';
    return;
  }
  await openArtist(aid);
}

/* 调试/验收用：栈只有这一份，不许在别处再存一个 */
window.__LIZI_PAGES = {
  stack: () => stack.map((s) => ({ ...s })),
  source: () => source,
  openArtist,
  openAlbum,
  openMyAlbums,
  back,
  openArtistFromSong,
  artist,
  album,
  myalbums,
  // 给测试看的：专辑页里那张唯一的大封面
  albumCoverWidth: () => {
    const img = document.querySelector('#view-album .pg-album-art img');
    return img ? img.getBoundingClientRect().width : 0;
  },
};

export { artist, album, myalbums, esc };
