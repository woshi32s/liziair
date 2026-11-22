/* ==========================================================================
   LIZI 形态自定义背景 · 本地媒体仓（IndexedDB）
   --------------------------------------------------------------------------
   2026-11-16：形态设置面板从「只能传图片、dataURL 塞 localStorage」升级到
   「图片 / 视频 + 四角取景」。5MB 的 localStorage 配额连一个 10MB 的原图都
   放不下，视频更不可能，所以二进制一律进 IndexedDB；localStorage 里只留
   'idb:<id>' 这一个小字符串。

   为什么不迁移老数据：用户已经存好的 dataURL 背景必须原样继续显示，任何
   「升级即搬运」都可能因为配额 / 隐私模式把旧设置弄丢。老值由 app.js 原样
   读取、原样推送，这个模块只负责新值。

   DB: lizi-stage-media v1
     store 'media'（keyPath: 'id'）
     记录 { id, kind:'image'|'video', blob, w, h, at }
     w/h 是**原始像素尺寸**（视频取 videoWidth/videoHeight），供裁剪编辑器
     算 cover 矩形；拿不到就记 0，不阻塞存储。

   对外（window.LIZI_STAGE_MEDIA）：
     put(file)        -> Promise<{ id, kind, url, w, h }>
     resolve(ref)     -> Promise<{ url, kind, w, h } | null>
     remove(id)       -> Promise<boolean>
     refOf(id)        -> 'idb:' + id
     isRef(v)         -> boolean

   错误策略：一律 try/catch 兜住。隐私模式 IDB 打不开时 openDB() 返回 null，
   put 抛错、resolve 返回 null，UI 负责报错，页面不崩。
   ========================================================================== */
(function () {
  'use strict';

  const DB_NAME = 'lizi-stage-media';
  const DB_VER = 1;
  const STORE = 'media';

  let dbPromise = null;
  /* 同一个 ref 复用同一个 object URL：每次 resolve 都 createObjectURL 会一直
     得不到释放，长会话里等于内存泄漏。remove() 时才 revoke。 */
  const urlCache = new Map();     // id -> { url, kind, w, h }
  const inflight = new Map();     // id -> Promise（并发 resolve 只查一次库）

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        } catch { /* 升级失败交给 onerror/onsuccess 兜底 */ }
      };
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      /* onblocked 说明另一个标签页还占着旧版本：本次先按不可用处理，
         不要让调用方无限等。 */
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  /** 从文件本身量原始像素。图片用 Image，视频等 loadedmetadata；12s 超时保底。 */
  function measure(file, kind) {
    return new Promise((resolve) => {
      let url = '';
      let done = false;
      let timer = 0;
      const finish = (w, h) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try { if (url) URL.revokeObjectURL(url); } catch { /* 忽略 */ }
        resolve({
          w: Math.max(0, Math.round(Number(w) || 0)),
          h: Math.max(0, Math.round(Number(h) || 0)),
        });
      };
      try {
        url = URL.createObjectURL(file);
      } catch {
        resolve({ w: 0, h: 0 });
        return;
      }
      timer = setTimeout(() => finish(0, 0), 12000);
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.onloadedmetadata = () => finish(v.videoWidth || 0, v.videoHeight || 0);
        v.onerror = () => finish(0, 0);
        v.src = url;
      } else {
        const im = new Image();
        im.onload = () => finish(im.naturalWidth || im.width || 0, im.naturalHeight || im.height || 0);
        im.onerror = () => finish(0, 0);
        im.src = url;
      }
    });
  }

  function newId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function kindOf(file) {
    return /^video\//i.test((file && file.type) || '') ? 'video' : 'image';
  }

  /** 存一份媒体。成功返回可直接给 iframe 用的 object URL。 */
  async function put(file) {
    if (!file || !file.size) throw new Error('文件为空');
    const kind = kindOf(file);
    const dim = await measure(file, kind);
    const db = await openDB();
    if (!db) throw new Error('本地媒体存储不可用');
    const id = newId();
    const rec = {
      id,
      kind,
      blob: file,
      w: dim.w,
      h: dim.h,
      at: Date.now(),
    };
    await new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('写入失败'));
      tx.onabort = () => reject(tx.error || new Error('写入被中止'));
      try {
        tx.objectStore(STORE).put(rec);
      } catch (e) {
        reject(e);
      }
    });
    const url = URL.createObjectURL(file);
    urlCache.set(id, { url, kind, w: rec.w, h: rec.h });
    return { id, kind, url, w: rec.w, h: rec.h };
  }

  function isRef(v) {
    return typeof v === 'string' && v.indexOf('idb:') === 0 && v.length > 4;
  }

  function refOf(id) {
    return 'idb:' + String(id || '');
  }

  function readRecord(db, id) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (e) {
        reject(e);
        return;
      }
      const rq = tx.objectStore(STORE).get(id);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error || new Error('读取失败'));
    });
  }

  /** 'idb:<id>' -> 可用的 object URL（同一个 ref 缓存复用）。 */
  async function resolve(ref) {
    if (!isRef(ref)) return null;
    const id = ref.slice(4);
    const hit = urlCache.get(id);
    if (hit) return hit;
    if (inflight.has(id)) return inflight.get(id);

    const task = (async () => {
      const db = await openDB();
      if (!db) return null;
      let rec = null;
      try {
        rec = await readRecord(db, id);
      } catch {
        return null;
      }
      if (!rec || !rec.blob) return null;
      let url = '';
      try {
        url = URL.createObjectURL(rec.blob);
      } catch {
        return null;
      }
      const out = {
        url,
        kind: rec.kind === 'video' ? 'video' : 'image',
        w: Math.max(0, Number(rec.w) || 0),
        h: Math.max(0, Number(rec.h) || 0),
      };
      urlCache.set(id, out);
      return out;
    })();

    inflight.set(id, task);
    try {
      return await task;
    } finally {
      inflight.delete(id);
    }
  }

  /** 删除记录并释放缓存里的 object URL。 */
  async function remove(id) {
    const key = String(id || '');
    if (!key) return false;
    const hit = urlCache.get(key);
    if (hit) {
      try { URL.revokeObjectURL(hit.url); } catch { /* 忽略 */ }
      urlCache.delete(key);
    }
    const db = await openDB();
    if (!db) return false;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('删除失败'));
        tx.onabort = () => reject(tx.error || new Error('删除被中止'));
        try {
          tx.objectStore(STORE).delete(key);
        } catch (e) {
          reject(e);
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  window.LIZI_STAGE_MEDIA = { put, resolve, remove, refOf, isRef };
})();
