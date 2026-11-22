/**
 * local/scan.js —— 安卓壳「从手机导入」的原生扫描桥（ESM）
 *
 * 只包一件事：把 MainActivity.NativeBridge.scanAudio() 的两种返回方式
 * （同步 JSON / 授权后回调 window.__liziScanAudio(json)）抹成一个 Promise。
 *
 *   supported() → 当前环境是不是安卓壳（window.__liziNative.scanAudio 存在）
 *   scan()      → { status, items, error }
 *                 status: ok | permission | denied | busy | error
 *
 * 桌面浏览器没有 __liziNative，supported() 恒为 false，页面据此完全不渲染
 * 入口；本模块被 import 也不会产生任何副作用。
 *
 * 权限流程：scanAudio() 在没授权时先回 {"status":"permission"}，同时主线程
 * 弹系统权限框；页面把 resolve 挂到 window.__liziScanAudio，原生扫完（或
 * 被拒）再经 evaluateJavascript 调回来。60 秒没回按 denied 处理。
 */

const WAIT_MS = 60 * 1000;

let inflight = null;

function native() {
  try { return window.__liziNative || null; } catch (e) { return null; }
}

export function supported() {
  const n = native();
  return !!(n && typeof n.scanAudio === 'function');
}

function parsePayload(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) {
    return { status: 'error', error: 'empty response' };
  }
  try { return JSON.parse(raw); }
  catch (e) { return { status: 'error', error: 'bad json' }; }
}

function normalize(data) {
  const d = data && typeof data === 'object' ? data : {};
  const status = d.status ? String(d.status) : 'error';
  const items = Array.isArray(d.items)
    ? d.items.filter((it) => it && typeof it === 'object' && it.path)
    : [];
  return {
    status: status,
    items: items,
    error: d.error ? String(d.error) : '',
  };
}

function runScan() {
  return new Promise((resolve) => {
    const nat = native();
    if (!nat || typeof nat.scanAudio !== 'function') {
      resolve({ status: 'unsupported', items: [], error: '' });
      return;
    }

    let raw;
    try {
      raw = nat.scanAudio();
    } catch (e) {
      resolve({ status: 'error', items: [], error: String((e && e.message) || e) });
      return;
    }

    const first = normalize(parsePayload(raw));
    if (first.status !== 'permission') {
      resolve(first);
      return;
    }

    /* 等原生扫完：结果只会来一次，超时就当拒绝（别让页面永远转圈） */
    let done = false;
    let timer = 0;
    function finish(res) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        if (window.__liziScanAudio === onNative) delete window.__liziScanAudio;
      } catch (e) { /* 忽略 */ }
      resolve(res);
    }
    function onNative(json) {
      finish(normalize(parsePayload(json)));
    }

    timer = setTimeout(function () {
      finish({ status: 'denied', items: [], error: 'timeout' });
    }, WAIT_MS);

    try {
      window.__liziScanAudio = onNative;
    } catch (e) {
      finish({ status: 'error', items: [], error: String((e && e.message) || e) });
    }
  });
}

/** 同一次会话里并发调用共享同一个扫描；结果不会自动缓存（页面自己决定） */
export function scan() {
  if (inflight) return inflight;
  inflight = runScan().then(
    (r) => { inflight = null; return r; },
    (e) => {
      inflight = null;
      return { status: 'error', items: [], error: String((e && e.message) || e) };
    },
  );
  return inflight;
}
