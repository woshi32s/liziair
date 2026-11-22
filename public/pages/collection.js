/**
 * pages/collection.js —— 「我的专辑」收藏数据层（ESM）
 *
 * 播放器自有的收藏系统，不依赖任何平台接口：
 *   · 存储只有一处：localStorage['lizi.myAlbums.v1']，值是数组
 *   · 每项 { id, name, artists, cover, publishTime, trackCount, source, addedAt }
 *       id         = `${source}:${albumId}` —— 唯一键，跨音源不撞车（netease:123 / qq:abc）
 *       artists    存成 "A / B" 一个字符串（页面上本来就是这么显示的）
 *       source     记 netease / qq / kugou… 缺省 netease（老数据没有这个字段）
 *       addedAt    收藏时间戳，列表按它倒序（最新收的在最前）
 *   · 去重按 id：同一张只能收一次
 *   · 不做缓存：每次 list() 直接读 localStorage。一次 ≤40 项的 JSON.parse 可以忽略，
 *     换来的是「另一个标签页 / 验收脚本直接改了 localStorage」也能立刻看见。
 */

const KEY = 'lizi.myAlbums.v1';

const listeners = new Set();
let memory = null;          // localStorage 不可用（隐私模式/写满）时的兜底

/** 原始数组（已经是数组形状的才认，坏数据一律当空） */
function read() {
  try {
    const s = localStorage.getItem(KEY);
    if (s === null) return memory ? memory.slice() : [];
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => x && x.id) : [];
  } catch (e) {
    return memory ? memory.slice() : [];
  }
}

function write(arr) {
  memory = arr.slice();
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) { /* 写不进去就只留内存 */ }
  for (const cb of [...listeners]) {
    try { cb(arr.slice()); } catch (e) { console.warn('[collection] onChange 回调出错', e); }
  }
}

/** 把外面传进来的专辑收拾成存储形状；认不出 id 就返回 null */
function normalize(a) {
  if (!a) return null;
  let source = String(a.source || 'netease').trim().toLowerCase() || 'netease';
  const rawId = a.albumId !== undefined && a.albumId !== null ? a.albumId : a.id;
  if (rawId === undefined || rawId === null || rawId === '') return null;

  let albumId = String(rawId);
  /* 传进来就是 "netease:123" 的话拆成两截，别存成 netease:netease:123 */
  const m = /^([a-z0-9_-]+):(.+)$/i.exec(albumId);
  if (m) { source = m[1].toLowerCase(); albumId = m[2]; }

  const artists = Array.isArray(a.artists)
    ? a.artists.map((x) => (x && x.name) || x || '').filter(Boolean).join(' / ')
    : String(a.artists || '');

  return {
    id: `${source}:${albumId}`,
    name: String(a.name || '未知专辑'),
    artists,
    cover: String(a.cover || ''),
    publishTime: Number(a.publishTime) || 0,
    trackCount: Number(a.trackCount) || 0,
    source,
    addedAt: Number(a.addedAt) || Date.now(),
  };
}

/** 归一化：去掉括号内容、标点、空白，转小写 —— 只用来跨音源比对「是不是同一张」 */
function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（(【\[《<][^）)】\]》>]*[）)】\]》>]/g, '')
    .replace(/[\s\-_·・.,，。!！?？'"“”‘’:：;；/\\|+&]/g, '')
    .trim();
}

/** 去重指纹 = 标题 + 首位艺人。同一张专辑在不同音源上 id 不同，但指纹应该一样。
    标题只比第一个艺人，避免「A / B」和「A, B」这种写法差异导致漏判。 */
export function fingerprint(album) {
  if (!album) return '';
  const name = normText(album.name);
  if (!name) return '';
  const first = normText(String(album.artists || '').split(/\s*[/,、&]\s*/)[0]);
  return first ? `${name}|${first}` : name;
}

/** 找「同一张专辑」但 key 不同的已有条目（跨音源重复用） */
export function findDuplicate(album) {
  const o = normalize(album);
  if (!o) return null;
  const fp = fingerprint(o);
  if (!fp) return null;
  return read().find((x) => x.id !== o.id && fingerprint(x) === fp) || null;
}

/** 唯一键：传专辑对象或已经拼好的 key 都行 */
export function keyOf(album) {
  if (album === undefined || album === null) return '';
  if (typeof album === 'string') return album;
  const n = normalize(album);
  return n ? n.id : '';
}

/** 整份收藏（新→旧） */
export function list() {
  return read();
}

/** 收了没有 */
export function has(key) {
  const k = keyOf(key);
  if (!k) return false;
  return read().some((x) => x.id === k);
}

/** 收一张。已经收过就只刷新它的元信息（不改变 addedAt，也不挪位置）。
 *  opts.crossSource === false 时才允许同一张专辑以不同音源各存一份；
 *  默认会按 fingerprint 拦掉跨音源重复，返回 { duplicate: true, dupOf: 已有条目的 id }。 */
export function add(album, opts) {
  const item = normalize(album);
  if (!item) return { ok: false, added: false, key: '', list: read() };
  const arr = read();
  const at = arr.findIndex((x) => x.id === item.id);
  if (at >= 0) {
    const old = arr[at];
    arr[at] = { ...old, ...item, addedAt: old.addedAt || item.addedAt };
    write(arr);
    return { ok: true, added: false, key: item.id, list: arr };
  }
  /* 同一张专辑换了个音源再来一次：不再入架，把先收的那张的 key 告诉调用方 */
  const allowDup = opts && opts.crossSource === false;
  if (!allowDup) {
    const dup = findDuplicate(item);
    if (dup) {
      return { ok: true, added: false, duplicate: true, key: item.id, dupOf: dup.id, list: arr };
    }
  }
  arr.unshift(item);
  write(arr);
  return { ok: true, added: true, key: item.id, list: arr };
}

/** 撤一张。key 可以是 `${source}:${id}` 也可以是专辑对象 */
export function remove(key) {
  const k = keyOf(key);
  const arr = read();
  const next = arr.filter((x) => x.id !== k);
  if (next.length === arr.length) return { ok: false, removed: false, key: k, list: arr };
  write(next);
  return { ok: true, removed: true, key: k, list: next };
}

/** 收纳 / 取消，一步到位。返回 true = 现在是「已收藏」 */
export function toggle(album) {
  const k = keyOf(album);
  if (!k) return false;
  if (has(k)) { remove(k); return false; }
  add(album);
  return true;
}

/** 清空（验收 / 设置里「清空我的专辑」用） */
export function clear() {
  write([]);
  return [];
}

/** 维护用：把已经存进去的跨音源重复合并掉（同一指纹只留最早收的那张）。
 *  返回 { removed: 去掉了多少张, list }。启动时调一次即可，无重复时不会写盘。 */
export function dedupe() {
  const arr = read();
  const seen = new Map();          // fingerprint -> 已保留的条目
  const kept = [];
  const dropped = [];
  for (const item of arr) {
    const fp = fingerprint(item);
    const hit = fp ? seen.get(fp) : null;
    if (hit) {
      /* 留 addedAt 更早的（先收的那张），另一张丢弃 */
      if ((Number(item.addedAt) || 0) < (Number(hit.addedAt) || 0)) {
        const i = kept.indexOf(hit);
        if (i >= 0) kept.splice(i, 1, item);
        seen.set(fp, item);
        dropped.push(hit);
      } else {
        dropped.push(item);
      }
      continue;
    }
    if (fp) seen.set(fp, item);
    kept.push(item);
  }
  if (dropped.length) write(kept);
  return { removed: dropped.length, list: kept };
}

/** 订阅变化，返回退订函数 */
export function onChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 另一个标签页动了 localStorage → 也通知一声（同标签页不会触发 storage） */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    for (const cb of [...listeners]) {
      try { cb(read()); } catch (err) { /* 忽略 */ }
    }
  });
}

export const STORAGE_KEY = KEY;
