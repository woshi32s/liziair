/**
 * Wallpaper Engine 壁纸接口（658 形态的 iframe 同源使用）
 *
 *   GET  /api/wallpaper            → 当前壁纸元数据 JSON
 *   GET  /api/wallpaper/media      → 当前壁纸视频字节流（支持 Range / 206）
 *   GET  /api/wallpaper/preview    → 当前壁纸预览图
 *
 *   GET  /api/wallpaper/list       → 壁纸库列表（30 秒缓存）
 *   GET  /api/wallpaper/preview?id → 指定壁纸的预览（mp4/webm 预览同样支持 Range）
 *   GET  /api/wallpaper/media?id   → 指定壁纸的视频（支持 Range / 206）
 *
 * 全部只读。不带 id 时每次重新解析「当前选中的壁纸」，结果只缓存 2 秒 ——
 * 用户随时会在 WE 里换壁纸，缓存久了就会一直放旧图。
 * 带 id 时 id 只用来查扫描时建好的表，绝不参与任何路径拼接。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const TTL = 2000;
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv'];
const IMAGE_EXTS = ['.jpg', '.png'];
const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  /* 壁纸库里不少老动画壁纸的预览就是 gif，浏览器要 image/gif 才会当图渲染 */
  '.gif': 'image/gif',
};

let weCache = null;      // { dir, libs }：WE 安装目录和 Steam 库根目录，找到后不再变
let procCache = null;    // { at, running }：进程检测也走 2 秒缓存
let resolveCache = null; // { at, record }：当前壁纸解析结果

/* --------------------------------------------------------------------------
   定位 Wallpaper Engine / Steam 库
   -------------------------------------------------------------------------- */

function readRegistrySteamPath() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
    });
    const line = out.split(/\r?\n/).find((l) => /REG_SZ/i.test(l));
    const m = line && /REG_SZ\s+(.+)$/i.exec(line);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function readLibraryRoots(steam) {
  const roots = [];
  const add = (p) => {
    if (!p) return;
    const norm = path.resolve(p);
    if (!roots.some((x) => x.toLowerCase() === norm.toLowerCase())) roots.push(norm);
  };
  if (!steam) return roots;
  add(steam);
  try {
    /* vdf 里路径是双反斜杠转义的；只认 "path" 行，库本身可能是任意盘符 */
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) add(m[1].replace(/\\\\/g, '\\'));
  } catch {
    /* 没有 libraryfolders.vdf 就只用主库 */
  }
  return roots;
}

function findWallpaperEngine() {
  if (weCache) return weCache;
  const steam = readRegistrySteamPath();
  const libs = readLibraryRoots(steam);
  const candidates = [];
  for (const lib of libs) candidates.push(path.join(lib, 'steamapps', 'common', 'wallpaper_engine'));
  /* 注册表读不到/库没登记时的兜底：常见盘符 × 常见安装位置 */
  for (const drive of ['C', 'D', 'E', 'F']) {
    for (const rel of [
      ['Program Files (x86)', 'Steam'],
      ['Program Files', 'Steam'],
      ['SteamLibrary'],
    ]) {
      candidates.push(path.join(`${drive}:`, ...rel, 'steamapps', 'common', 'wallpaper_engine'));
    }
  }
  for (const dir of candidates) {
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      /* 兜底命中的安装目录：它的 steamapps 上一级也要算进可读库，
         否则路径安全校验会把同库里的 workshop 壁纸挡掉。 */
      const libRoot = path.resolve(dir, '..', '..', '..');
      if (!libs.some((x) => x.toLowerCase() === libRoot.toLowerCase())) libs.push(libRoot);
      weCache = { dir, libs };
      return weCache;
    } catch {
      /* 这个候选不存在，试下一个 */
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
   进程 / 配置 / 工程解析
   -------------------------------------------------------------------------- */

function processRunning(image) {
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
    });
    return out.toLowerCase().includes(image.toLowerCase());
  } catch {
    /* tasklist 自身执行失败时按「在跑」处理：宁愿多解析一次，
       也不要把能用的壁纸误判成没有。 */
    return true;
  }
}

function weRunning() {
  const now = Date.now();
  if (procCache && now - procCache.at < TTL) return procCache.running;
  const running = processRunning('wallpaper64.exe') || processRunning('wallpaper32.exe');
  procCache = { at: now, running };
  return running;
}

function readConfig(weDir) {
  const file = path.join(weDir, 'config.json');
  for (let i = 0; i < 2; i++) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && typeof cfg === 'object') return cfg;
    } catch {
      /* WE 正在写 config.json 时可能读到半截 JSON，紧接重试一次 */
    }
  }
  throw new Error('config.json unreadable');
}

function pickUserConfig(cfg) {
  /* 顶层 key 是 Windows 用户名，另有 "?installdirectory" 这类元数据键要跳过 */
  const keys = Object.keys(cfg).filter((k) => !k.startsWith('?'));
  let user = '';
  try { user = os.userInfo().username; } catch { /* 拿不到用户名就走扫描 */ }
  if (user) {
    const hit = keys.find((k) => k.toLowerCase() === user.toLowerCase());
    if (hit) return cfg[hit];
  }
  return keys.map((k) => cfg[k]).find((v) => v && v.general && v.general.wallpaperconfig) || null;
}

function findVideo(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const ext of VIDEO_EXTS) {
    /* 扩展名大小写不敏感；按 mp4 → webm → mkv 的顺序取第一个 */
    const hit = entries.find((e) => e.isFile() && path.extname(e.name).toLowerCase() === ext);
    if (hit) return path.join(dir, hit.name);
  }
  return '';
}

/* JPEG 的 SOF 段 / PNG 的 IHDR 里都有真实像素，十几行就够，不必引依赖。 */
function imageSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG' && buf.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let pos = 2;
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xff) { pos++; continue; }
      let marker = buf[pos + 1];
      while (marker === 0xff && pos + 2 < buf.length) { pos++; marker = buf[pos + 1]; }
      pos += 2;
      /* 无长度的标记：填充、RST、SOI/EOI */
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
      if (pos + 2 > buf.length) break;
      const len = buf.readUInt16BE(pos);
      const isSOF = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        if (pos + 7 > buf.length) break;
        return { width: buf.readUInt16BE(pos + 5), height: buf.readUInt16BE(pos + 3) };
      }
      if (len < 2) break;
      pos += len;
    }
    return null;
  } catch {
    return null;
  }
}

function buildRecord() {
  const empty = { data: { ok: false }, kind: '', mediaFile: '', previewFile: '' };
  try {
    if (!weRunning()) return empty;
    const we = findWallpaperEngine();
    if (!we) return empty;

    const cfg = readConfig(we.dir);
    const userCfg = pickUserConfig(cfg);
    if (!userCfg) return empty;
    const wc = userCfg.general && userCfg.general.wallpaperconfig;
    if (!wc || !wc.selectedwallpapers || typeof wc.selectedwallpapers !== 'object') return empty;

    /* Monitor0 优先；没有就取 selectedwallpapers 里的第一个 */
    const sel = wc.selectedwallpapers.Monitor0 || Object.values(wc.selectedwallpapers)[0];
    const file = sel && typeof sel.file === 'string' ? sel.file.trim() : '';
    if (!file) return empty;

    const dir = path.dirname(file);
    if (!fs.statSync(dir).isDirectory()) return empty;

    let project = {};
    try {
      project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) || {};
    } catch {
      /* 没有 project.json 也能按目录名/扩展名继续解析 */
    }

    const type = String(project.type || '').toLowerCase();
    const fileExt = path.extname(file).toLowerCase();
    const isVideo = type === 'video' || VIDEO_EXTS.includes(fileExt);
    const title = typeof project.title === 'string' && project.title ? project.title : path.basename(dir);
    const previewName = typeof project.preview === 'string' && project.preview ? project.preview : 'preview.jpg';
    const previewFile = path.join(dir, previewName);
    const mediaFile = isVideo ? findVideo(dir) : '';
    if (isVideo && !mediaFile) return empty;

    const dims = imageSize(previewFile);
    const data = {
      ok: true,
      kind: isVideo ? 'video' : 'image',
      title,
      type,
      media: '/api/wallpaper/media',
      preview: '/api/wallpaper/preview',
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
    };
    return { data, kind: data.kind, mediaFile, previewFile };
  } catch {
    return empty;
  }
}

function resolveRecord() {
  const now = Date.now();
  if (resolveCache && now - resolveCache.at < TTL) return resolveCache.record;
  const record = buildRecord();
  resolveCache = { at: now, record };
  return record;
}

/** 给调试/样例用：返回当前壁纸的公开元数据。 */
export function resolveWallpaper() {
  return resolveRecord().data;
}

/* --------------------------------------------------------------------------
   壁纸库扫描（list / 按 id 取预览与视频）
   -------------------------------------------------------------------------- */

const LIST_TTL = 30000;
const PREVIEW_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif'];
/* 兜底顺序固定，保证同一个目录每次扫出来的预览不会来回变 */
const FALLBACK_PREVIEWS = [
  'preview.jpg', 'preview.jpeg', 'preview.png', 'preview.gif', 'preview.mp4', 'preview.webm',
  'thumb.jpg', 'thumb.png',
];
const KIND_ORDER = { video: 0, image: 1, none: 2 };

/* 建库动辄上千个目录，前端每切一次页面就全量扫一遍会把磁盘刷爆；
   30 秒足够新订阅/新导入的壁纸出现在列表里，又不会重复扫。 */
let listCache = null; // { at, items, map }

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function previewTypeOf(file) {
  const ext = path.extname(file || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
  if (ext === '.png') return 'png';
  if (ext === '.gif') return 'gif';
  /* 前端只关心「能不能当视频播」，mkv/webm 统一归到 mp4 这一档 */
  if (VIDEO_EXTS.includes(ext)) return 'mp4';
  return 'none';
}

/* project.preview 是 WE 自己写的文件名，可能带子目录，也可能大小写和磁盘上不一致；
   都对不上时再按固定顺序找目录里的 preview.* / thumb.*。
   名字里带 .. 的（恶意 project.json）不认：预览只能来自壁纸目录自身。 */
function resolvePreview(dir, project, entries) {
  const named = typeof project.preview === 'string' ? project.preview.trim() : '';
  if (named) {
    const direct = path.join(dir, named);
    const dirLower = path.resolve(dir).toLowerCase() + path.sep;
    if (path.resolve(direct).toLowerCase().startsWith(dirLower) && isFile(direct)) return direct;
    const base = path.basename(named).toLowerCase();
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === base);
    if (hit) return path.join(dir, hit.name);
  }
  for (const want of FALLBACK_PREVIEWS) {
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === want);
    if (hit) return path.join(dir, hit.name);
  }
  return '';
}

/* WE 的 project.json 里 `file` 才是正片；视频壁纸目录里常常还躺着低清预览
   preview.mp4，findVideo 只是「按 mp4→webm→mkv 取第一个」，readdir 顺序靠前时
   就会把预览当成正片。所以先认 project.file，它不可用时才退回目录扫描。
   名字不在壁纸目录内的一律不认（恶意 project.json 不能把正片指到库外）。 */
function projectMediaFile(dir, project) {
  const named = typeof project.file === 'string' ? project.file.trim() : '';
  if (!named) return '';
  const ext = path.extname(named).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return '';
  const direct = path.join(dir, named);
  const dirLower = path.resolve(dir).toLowerCase() + path.sep;
  if (!path.resolve(direct).toLowerCase().startsWith(dirLower)) return '';
  return isFile(direct) ? direct : '';
}

/* 只读 project.json 和目录自身的一层 listing，不递归、不碰视频文件。
   返回列表项（对外）和查表项（含磁盘路径，只留在内存里）两份。 */
function scanProjectDir(dir, id, source) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  let project = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') project = parsed;
  } catch {
    /* 没有 project.json，或 WE 正在写半截 JSON：按目录名/扩展名兜底 */
  }

  const previewFile = resolvePreview(dir, project, entries);
  const previewType = previewTypeOf(previewFile);
  /* 正片优先取 project.json 的 file；只有它缺失/不是视频/不在目录内时才退回扫描 */
  const mediaFile = projectMediaFile(dir, project) || findVideo(dir);
  const hasVideo = Boolean(mediaFile);

  let type = typeof project.type === 'string' ? project.type.trim().toLowerCase() : '';
  /* project.type 缺失时只能靠文件猜：有视频就是 video，gif 预览多半是 gif 壁纸 */
  if (!type) type = hasVideo ? 'video' : (previewType === 'gif' ? 'gif' : '');
  const title = (typeof project.title === 'string' && project.title.trim()) || path.basename(dir);
  const kind = hasVideo ? 'video' : (previewType === 'none' ? 'none' : 'image');
  /* gif/mp4 的预览不解析尺寸：imageSize 只认 JPEG/PNG，硬解没有意义 */
  const dims = (previewType === 'jpeg' || previewType === 'png') ? imageSize(previewFile) : null;

  return {
    item: {
      id,
      title,
      type,
      kind,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      hasVideo,
      previewType,
      source,
    },
    entry: { id, title, source, kind, previewType, previewFile, mediaFile },
  };
}

function buildLibrary() {
  const items = [];
  const map = new Map();
  const we = findWallpaperEngine();
  /* WE 没装（或从没运行过）不是错误：前端只是显示空库 */
  if (!we) return { items, map };

  const add = (dir, id, source) => {
    /* 同 id 只留一条：多个 Steam 库可能登记同一份 workshop 内容，
       defaultprojects 里也常有和 myprojects 同名的官方样例 */
    if (map.has(id)) return;
    const hit = scanProjectDir(dir, id, source);
    if (!hit) return;
    map.set(id, hit.entry);
    items.push(hit.item);
  };

  for (const lib of we.libs) {
    const content = path.join(lib, 'steamapps', 'workshop', 'content', '431960');
    let dirs;
    try {
      dirs = fs.readdirSync(content, { withFileTypes: true });
    } catch {
      continue; /* 这个库没装 workshop 内容，正常 */
    }
    for (const e of dirs) {
      /* workshop 的壁纸 id 一定是纯数字目录名，其它形态不当作壁纸 */
      if (!e.isDirectory() || !/^\d+$/.test(e.name)) continue;
      add(path.join(content, e.name), e.name, 'workshop');
    }
  }

  /* myprojects 先于 defaultprojects：撞名时保留用户自己的工程。
     id 统一是 local:<目录名>，不采用「子目录前缀/目录名」是因为 id 校验禁止 /，
     那样生成的 id 自己都取不回来。 */
  for (const [sub, source] of [['myprojects', 'myproject'], ['defaultprojects', 'defaultproject']]) {
    const root = path.join(we.dir, 'projects', sub);
    let dirs;
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of dirs) {
      if (!e.isDirectory()) continue;
      add(path.join(root, e.name), `local:${e.name}`, source);
    }
  }

  items.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    || a.title.localeCompare(b.title, 'zh'));
  return { items, map };
}

function getLibrary() {
  const now = Date.now();
  if (listCache && now - listCache.at < LIST_TTL) return listCache;
  const { items, map } = buildLibrary();
  listCache = { at: now, items, map };
  return listCache;
}

/* id 只做查表：先挡掉明显非法的形态，再 map.get；绝不把 id 拼进路径。 */
function findById(wanted) {
  const id = typeof wanted === 'string' ? wanted.trim() : '';
  if (!id || id.length > 128) return null;
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) return null;
  return getLibrary().map.get(id) || null;
}

function sendList(res, headOnly) {
  let lib;
  try {
    lib = getLibrary();
  } catch {
    /* 扫描本身已经按目录吞了异常；能走到这里说明是别的意外，别把栈/路径透给前端 */
    return sendJson(res, 500, { ok: false }, headOnly);
  }
  return sendJson(res, 200, { ok: true, items: lib.items, count: lib.items.length }, headOnly);
}

/* --------------------------------------------------------------------------
   文件发送
   -------------------------------------------------------------------------- */

function sendJson(res, code, data, headOnly) {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(headOnly ? undefined : buf);
}

/* 配置里的路径来自 WE，但这个接口不该能读任意文件：
   realpath 之后确认它确实落在 WE 安装目录或某个 Steam 库之下，扩展名也在白名单里。 */
function safePath(file, exts, we) {
  if (!file || !exts.includes(path.extname(file).toLowerCase())) return '';
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    return '';
  }
  /* 注册表里的 SteamPath 可能全是小写，而 realpath 返回真实大小写，
     Windows 下必须自己按小写前缀比较，不能用区分大小写的 path.relative。 */
  const roots = [we.dir, ...we.libs].map((r) => path.resolve(r).toLowerCase() + path.sep);
  const realLower = path.resolve(real).toLowerCase();
  const inside = roots.some((root) => realLower.startsWith(root));
  return inside ? real : '';
}

/* 图片预览整文件流式发送（200），不带 Range —— 预览图最大也就几 MB。 */
function sendImageFile(res, file, headOnly) {
  let size;
  try { size = fs.statSync(file).size; } catch { return sendJson(res, 404, { ok: false }, headOnly); }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': 'no-store',
  });
  if (headOnly) return res.end();
  const stream = fs.createReadStream(file);
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendPreview(res, record, headOnly) {
  if (!record.data.ok || record.kind !== 'image') {
    return sendJson(res, 404, { ok: false, error: 'no preview' }, headOnly);
  }
  const we = findWallpaperEngine();
  const file = we ? safePath(record.previewFile, IMAGE_EXTS, we) : '';
  if (!file) return sendJson(res, 404, { ok: false, error: 'preview not found' }, headOnly);
  return sendImageFile(res, file, headOnly);
}

/* 单段 Range。多段/格式不对时按 RFC 允许忽略，回 200 全量；越界回 416。 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (!startRaw && !endRaw) return null;
  if (size <= 0) return { bad: true };

  let start;
  let end;
  if (!startRaw) {
    /* bytes=-N：最后 N 字节 */
    const n = Number(endRaw);
    if (!n) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end > size - 1) end = size - 1;
  }
  if (start >= size || start > end) return { bad: true };
  return { start, end };
}

/* 视频下发：Range / 206 / 416 / HEAD 全在这里。media 和 mp4 预览共用，
   保证两条路径的头部行为完全一致。 */
function sendVideoFile(req, res, file, headOnly) {
  let size;
  try { size = fs.statSync(file).size; } catch { return sendJson(res, 404, { ok: false }, headOnly); }

  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (range && range.bad) {
    const buf = Buffer.from(JSON.stringify({ ok: false, error: 'range not satisfiable' }));
    res.writeHead(416, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buf.length,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${size}`,
      'Cache-Control': 'no-store',
    });
    return res.end(headOnly ? undefined : buf);
  }

  let start = 0;
  let end = size - 1;
  if (range) { start = range.start; end = range.end; }
  if (size === 0) {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': 0, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    return res.end();
  }

  const headers = {
    'Content-Type': mime,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (headOnly) return res.end();

  /* 流式发送，不 readFile：4K 视频有几百 MB，整读会把内存和首帧延迟都拖死。
     客户端中途断开时销毁读流，别让句柄悬着。 */
  const stream = fs.createReadStream(file, { start, end });
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendMedia(req, res, record, headOnly) {
  if (!record.data.ok || record.kind !== 'video') {
    return sendJson(res, 404, { ok: false, error: 'no video' }, headOnly);
  }
  const we = findWallpaperEngine();
  const file = we ? safePath(record.mediaFile, VIDEO_EXTS, we) : '';
  if (!file) return sendJson(res, 404, { ok: false, error: 'video not found' }, headOnly);
  return sendVideoFile(req, res, file, headOnly);
}

/* ---- 按 id 发送 ----
   id 只用于查表，路径全部来自扫描结果；命中后仍过 safePath 的 realpath 白名单，
   所以即便目录被换成指向库外的软链接也读不出去。所有失败体只有 { ok:false }。 */

function sendPreviewById(req, res, entry, headOnly) {
  const file = entry && entry.previewFile ? entry.previewFile : '';
  const we = file ? findWallpaperEngine() : null;
  if (!we) return sendJson(res, 404, { ok: false }, headOnly);

  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXTS.includes(ext)) {
    /* 视频预览（previewType === "mp4"）：前端用 <video> 播，必须支持 Range/206 */
    const safe = safePath(file, VIDEO_EXTS, we);
    if (!safe) return sendJson(res, 404, { ok: false }, headOnly);
    return sendVideoFile(req, res, safe, headOnly);
  }
  /* 图片预览：jpg/jpeg/png/gif，整文件 200 */
  const safe = safePath(file, PREVIEW_IMAGE_EXTS, we);
  if (!safe) return sendJson(res, 404, { ok: false }, headOnly);
  return sendImageFile(res, safe, headOnly);
}

function sendMediaById(req, res, entry, headOnly) {
  const file = entry && entry.mediaFile ? entry.mediaFile : '';
  const we = file ? findWallpaperEngine() : null;
  const safe = we ? safePath(file, VIDEO_EXTS, we) : '';
  if (!safe) return sendJson(res, 404, { ok: false }, headOnly);
  return sendVideoFile(req, res, safe, headOnly);
}

/* --------------------------------------------------------------------------
   路由入口（由 server.mjs 在通用 /api/ 分发之前调用）
   -------------------------------------------------------------------------- */

export function handleWallpaper(req, res, url) {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    const buf = Buffer.from(JSON.stringify({ ok: false, error: 'method not allowed' }));
    res.writeHead(405, {
      'Allow': 'GET, HEAD',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return;
  }

  /* list 跟「当前壁纸」无关，先处理，省掉一次 WE 进程/配置解析 */
  if (url.pathname === '/api/wallpaper/list') return sendList(res, headOnly);

  /* 只有显式带 id 才走查表分支；没带 id 时（包括没有这个参数）
     完全沿用旧逻辑，老调用方的行为一个字节都不变。 */
  const idParam = url.searchParams.get('id');
  if (idParam !== null
    && (url.pathname === '/api/wallpaper/preview' || url.pathname === '/api/wallpaper/media')) {
    const entry = findById(idParam);
    if (!entry) return sendJson(res, 404, { ok: false }, headOnly);
    return url.pathname === '/api/wallpaper/preview'
      ? sendPreviewById(req, res, entry, headOnly)
      : sendMediaById(req, res, entry, headOnly);
  }

  const record = resolveRecord();
  if (url.pathname === '/api/wallpaper') return sendJson(res, 200, record.data, headOnly);
  if (url.pathname === '/api/wallpaper/preview') return sendPreview(res, record, headOnly);
  if (url.pathname === '/api/wallpaper/media') return sendMedia(req, res, record, headOnly);
  return sendJson(res, 404, { ok: false, error: 'unknown wallpaper api' }, headOnly);
}
