/* ==========================================================================
   desktop/main.js —— Electron 主进程

   架构（参照 Mineradio 的 resources/app 结构，但服务复用现有 server.mjs）：

     Folia式.exe 启动
        └─ main.js
             ├─ 已有服务在跑？（.port 指向的 http://127.0.0.1:x 健康检查）
             │    ├─ 是 → 直接用（浏览器工作流和桌面版共用同一个服务）
             │    └─ 否 → 用 ELECTRON_RUN_AS_NODE 起子进程跑 server.mjs
             ├─ 轮询 .port 直到服务就绪 → BrowserWindow.loadURL
             ├─ 托盘（打开 / 开机自启 / 退出）
             ├─ 关窗口 = 最小化到托盘（真正退出走托盘菜单）
             ├─ 全局媒体键 → 转发给页面里的 Player
             └─ 自动更新（仅打包版）：GitHub Releases + electron-updater

   没有打包成 asar：保持散装，改 public/ 里的文件刷新窗口就生效
   （和浏览器工作流一致，这是这个项目的开发方式）。
   ========================================================================== */
const { app, BrowserWindow, Tray, Menu, globalShortcut, shell, nativeImage, dialog, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

/* 防一枪：如果整个进程被 ELECTRON_RUN_AS_NODE=1 污染（比如从 Electron 系
   agent/终端里启动），electron.exe 会退化成纯 Node，app 就是 undefined。
   必须在 require('electron') 生效的进程里把这个变量摘掉。
   注意时机：这行要在本文件最顶部生效 —— 但 require 已在上面，
   所以更稳的是在 package.json 的 start 脚本里清（见 DESKTOP.md）。 */
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.join(__dirname, '..');
const PORT_FILE = path.join(ROOT, '.port');
const IS_PACKAGED = app.isPackaged;

/* ---- 自动更新 / 下载页 ------------------------------------------------
   两个网盘链接都是「固定分享目录」：链接本身永久不变，以后每次发版
   只把新安装包拖进这个文件夹，代码不用再改。弹窗文案统一叫「网盘」，
   不写具体平台名，这样以后换渠道也不用改代码。 */
const PAN_QUARK_URL = 'https://pan.quark.cn/s/6c6e65f3ee4c';
const PAN_BAIDU_URL = 'https://pan.baidu.com/s/1crtOz-RxF6YyKLn9uxykWQ?pwd=lizi'; // 备用；「网盘备用」目前打开夸克

/* 和 package.json 的 build.publish 保持一致；换仓库时两处一起改。 */
const GITHUB_OWNER = 'woshi32s';
const GITHUB_REPO = 'liziair';
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

let win = null;
let serverPort = 0;

/* 开发者版启动参数 --edition=dev|release。只影响页面 URL 的 ?edition=，
   app.js 会把它当成形态版本写进 localStorage（dev = 形态长廊列全部）。 */
function editionFromArgv(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--edition='));
  const v = hit ? hit.slice('--edition='.length) : '';
  return (v === 'dev' || v === 'release') ? v : '';
}
function pageUrl(port, edition, previewUpd) {
  const qs = [];
  if (previewUpd) qs.push(`upd=${encodeURIComponent(previewUpd)}`);
  if (edition) qs.push(`edition=${edition}`);
  return `http://127.0.0.1:${port}/${qs.length ? `?${qs.join('&')}` : ''}`;
}
let tray = null;
let serverChild = null;
let quitting = false;

/* 自动更新状态：同一时间只弹一个窗，下载中也只认一次。
   checkingUpdates 复用同一次网络检查：启动 6 秒后的自动检查与设置页
   手动「检查更新」撞在一起时，electron-updater 会拒绝第二次检查。 */
let updater = null;
let updateDialogOpen = false;
let downloading = false;
let checkingUpdates = null;

const log = (...a) => console.log('[desktop]', ...a);

/* ---------------------------------------------------------------- 服务 ---- */

function readPortFile() {
  try {
    const v = fs.readFileSync(PORT_FILE, 'utf8').trim();
    return /^\d+$/.test(v) ? Number(v) : null;
  } catch { return null; }
}

/** GET / 带 2 秒超时：活着才算"已有服务" */
function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** 用 Electron 自带的 Node 跑 server.mjs（ELECTRON_RUN_AS_NODE=1），
 *  不需要额外打包一个 node.exe。 */
function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log('[server]', String(d).trim()));
  child.stderr.on('data', (d) => log('[server!]', String(d).trim()));
  child.on('exit', (code) => { log('[server] 退出', code); serverChild = null; });
  serverChild = child;
  return child;
}

async function ensureServer() {
  /* ① .port 指向的服务还活着 → 复用（不抢端口、不搅动 .port） */
  const existing = readPortFile();
  if (existing && await ping(existing)) {
    log('复用已在运行的服务，端口', existing);
    return existing;
  }
  /* ② 起自己的 */
  startServer();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const p = readPortFile();
    if (p && await ping(p)) { log('服务已就绪，端口', p); return p; }
  }
  throw new Error('服务 20 秒内没就绪');
}

/* ---------------------------------------------------------------- 窗口 ---- */

/* 正常态尺寸：还原时以它为准。
   Windows 自己会记「最大化前的尺寸」，但透明无边框窗口在个别路径下会丢；
   而且 win.unmaximize() 不保证每次都精确回到原位。窗口每次处于正常态
   （显示 / 移动 / 拖边）就记一份，还原时用来核对和兜底。 */
let normalBounds = null;
/* 最大化 / 还原过程中 Windows 会连发几次 resize，中间态的尺寸不能当正常态记。
   进入切换后先静默一段时间，等窗口落定再恢复记录。 */
let boundsSettlingUntil = 0;

/** 窗口是不是铺满了当前显示器的工作区。
    系统级最大化时 Electron 的 isMaximized() 可能不认，几何上却能看出来。 */
function coversWorkArea() {
  if (!win || win.isDestroyed()) return false;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  return b.x <= wa.x + 2 && b.y <= wa.y + 2
    && b.width >= wa.width - 16 && b.height >= wa.height - 16;
}

function rememberNormalBounds() {
  if (!win || win.isDestroyed()) return;
  if (Date.now() < boundsSettlingUntil) return;   // 切换动画中间态
  if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
  if (coversWorkArea()) return;              // 最大化途中 / 系统级最大化，不能当正常态
  const b = win.getBounds();
  if (b.width < 200 || b.height < 150) return;
  normalBounds = b;
}

/** 真实的最大化状态：Electron 的标记 + 工作区几何兜底。图标状态跟它走。 */
function isMaximizedNow() {
  return !!win && !win.isDestroyed() && (win.isMaximized() || coversWorkArea());
}

/** 点一下放大键 = 最大化到工作区；再点 = 精确回到记下的正常尺寸和位置 */
function toggleMaximize() {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) { win.setFullScreen(false); return; }
  if (isMaximizedNow()) {
    boundsSettlingUntil = Date.now() + 900;
    const target = normalBounds;
    win.unmaximize();
    /* unmaximize 之后核对一次：没回到正常尺寸就自己摆回去。
       个别情况下（窗口被系统按最大化处理）Electron 的 unmaximize 会空转。 */
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (target && !win.isMaximized() && coversWorkArea()) win.setBounds(target);
      pushWinState();
    }, 180);
  } else {
    rememberNormalBounds();
    boundsSettlingUntil = Date.now() + 900;
    win.maximize();
  }
}

/** 双击顶栏 / 顶部拖动带 = 最大化 / 还原（Windows 习惯）。
    这两块是 -webkit-app-region: drag（非客户区），页面的 dblclick 收不到；
    Windows 会把双击翻译成 WM_SYSCOMMAND(SC_MAXIMIZE)，但无边框窗口自己不处理。
    在主进程接住这条命令，和右上角放大键走同一个 toggle。 */
function hookCaptionDoubleClick() {
  if (process.platform !== 'win32' || typeof win.hookWindowMessage !== 'function') return;
  win.hookWindowMessage(0x0112 /* WM_SYSCOMMAND */, (wParam) => {
    let cmd = 0;
    try {
      cmd = Buffer.isBuffer(wParam) ? wParam.readUInt32LE(0) : Number(wParam) >>> 0;
    } catch { return; }
    if ((cmd & 0xfff0) !== 0xf030 /* SC_MAXIMIZE */) return;
    const before = isMaximizedNow();
    /* 等默认处理走完再核对：系统若已经自己翻了状态，就不要再翻一次 */
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (isMaximizedNow() !== before) { pushWinState(); return; }
      toggleMaximize();
    }, 0);
  });
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'LIZI',
    /* 无边框 + 透明：Win10 没有原生大圆角，只能靠页面 body 自己裁。
       hasShadow 必须关掉 —— Windows 会给透明窗口画一圈白边/阴影，圆角外就是它。 */
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  /* 预览更新提示条：LIZI_UPDATE_PREVIEW=1.0.1 启动时给页面带上 ?upd=，
     只为在桌面壳里看样式（app.js 里按 preview 分支直接亮出来）。
     不带这个环境变量时 URL 和原来完全一样。 */
  const previewUpd = String(process.env.LIZI_UPDATE_PREVIEW || '').trim();
  /* 不带 --edition 时按发行版加载（显式带 ?edition=release，
     避免开发者版写进 localStorage 后，普通启动也继续列全部形态）。 */
  win.loadURL(pageUrl(port, editionFromArgv(process.argv) || 'release', previewUpd));

  win.once('ready-to-show', () => { win.show(); rememberNormalBounds(); });

  /* 点歌、登录这类新窗口一律走系统浏览器（server 的登录流程在浏览器里更顺） */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  /* 关窗口 = 藏到托盘（音乐软件的惯例）；真退出在托盘菜单里 */
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  /* 窗口状态一变就推给页面：最大化 / 还原 / 进全屏 / 退全屏 / 缩放 / 显隐。
     resize 一定要接 —— 拖边改尺寸、最大化动画结束时都只有 resize。 */
  for (const evName of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'resize', 'show', 'hide']) {
    win.on(evName, pushWinState);
  }
  /* 最大化 / 还原切换期间先别记尺寸（Windows 会连发中间态 resize） */
  win.on('maximize', () => { boundsSettlingUntil = Date.now() + 900; });
  win.on('unmaximize', () => { boundsSettlingUntil = Date.now() + 900; });
  /* 正常态的尺寸随时记：移动 / 拖边 / 从托盘显示回来都要更新 */
  win.on('move', rememberNormalBounds);
  win.on('resize', rememberNormalBounds);
  win.on('show', rememberNormalBounds);

  /* 双击顶栏 / 拖动带（非客户区）：接住系统发的 SC_MAXIMIZE */
  hookCaptionDoubleClick();

  win.webContents.on('did-finish-load', () => log('页面加载完成'));
  /* 页面一加载好先给一次真实状态（页面启动时也会自己读一次 isMaximized） */
  win.webContents.on('did-finish-load', pushWinState);
}

/* ---------------------------------------------------------------- 托盘 ---- */

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('LIZI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: '播放 / 暂停', click: () => sendToPage('media:toggle') },
    { label: '下一首', click: () => sendToPage('media:next') },
    { label: '上一首', click: () => sendToPage('media:prev') },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: '退出（结束后台服务）',
      click: () => { quitting = true; app.quit(); },
    },
  ]));
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

function sendToPage(channel) {
  if (win) win.webContents.send(channel);
}

/* ---- 自绘窗口控制：最小化 / 最大化 / 关闭(到托盘) ---- */
const { ipcMain } = require('electron');
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', toggleMaximize);
ipcMain.on('win:close', () => win && win.hide());        // 关 = 到托盘
ipcMain.on('win:isMaximized', (e) => { e.returnValue = isMaximizedNow(); });

/* ---- 窗口状态（新增）：页面点完三键不能靠猜，真实状态只有主进程知道 ---- */

/** 一次性读全：最大化 / 最小化 / 全屏 / 可见 */
function winState() {
  return {
    maximized: isMaximizedNow(),
    minimized: !!win && win.isMinimized(),
    fullscreen: !!win && win.isFullScreen(),
    visible: !!win && win.isVisible(),
  };
}

/** 主进程主动推给页面（事件形状固定为这三项，别往里面塞别的） */
function pushWinState() {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  const s = winState();
  win.webContents.send('win:state', { maximized: s.maximized, fullscreen: s.fullscreen, visible: s.visible });
}

/* getState()：一次拿全部（测试/页面兜底用；异步，不卡渲染进程） */
ipcMain.handle('win:getState', () => winState());

/* ------------------------------------------------------------ 媒体键 ---- */

function bindMediaKeys() {
  const map = [
    ['MediaPlayPause', 'media:toggle'],
    ['MediaNextTrack', 'media:next'],
    ['MediaPreviousTrack', 'media:prev'],
    ['MediaStop', 'media:stop'],
  ];
  for (const [key, ch] of map) {
    const ok = globalShortcut.register(key, () => sendToPage(ch));
    if (!ok) log('媒体键被占用：', key);
  }
}

/* ---------------------------------------------------------- 自动更新 ---- */

function openUrl(url) {
  try {
    shell.openExternal(url).catch((err) => log('[update] 打开链接失败', err));
  } catch (err) {
    log('[update] 打开链接失败', err);
  }
}

/* 窗口可见时用它做父级（模态）；藏在托盘/最小化时退回无父级弹窗，否则可能不显示。 */
function showBox(options) {
  const usable = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  if (usable) return dialog.showMessageBox(win, options);
  return dialog.showMessageBox(options);
}

/* 进度同时走任务栏进度条、窗口标题和托盘提示，页面里不加任何 UI。 */
function setDownloadProgress(percent) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (win && !win.isDestroyed()) {
    win.setProgressBar(pct / 100);
    win.setTitle(`正在下载 ${pct}%`);
  }
  if (tray) tray.setToolTip(`正在下载 ${pct}%`);
}

function clearDownloadProgress() {
  if (win && !win.isDestroyed()) {
    win.setProgressBar(-1);
    win.setTitle('LIZI');
  }
  if (tray) tray.setToolTip('LIZI');
}

/** 窗口是否真的看得见（最小化 / 收进托盘都算不可见） */
function windowVisible() {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

/** 把新版本推给页面；页面还在加载就等 did-finish-load，
 *  否则这时页面里的监听器还没挂上，消息会丢。 */
function sendUpdateAvailable(version) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  const send = () => {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('update:available', { version });
    }
  };
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send);
  else send();
}

/** 有新版时：窗口可见 → 页面右下角小提示条；不可见 → 原生对话框兜底，
 *  否则用户把窗口收进托盘后完全看不到提示。 */
function notifyUpdate(info) {
  if (quitting) return;
  const version = info && info.version ? String(info.version) : '';
  if (!version) return;
  if (windowVisible()) {
    sendUpdateAvailable(version);
    return;
  }
  askUpdate(info).catch((err) => log('[update] 弹窗失败', err));
}

/** 自动检查和设置页手动检查共用同一次请求：并发时 electron-updater 会拒绝。 */
function checkForUpdatesOnce() {
  if (!updater) return Promise.resolve(null);
  if (!checkingUpdates) {
    try {
      checkingUpdates = Promise.resolve(updater.checkForUpdates())
        .finally(() => { checkingUpdates = null; });
    } catch (err) {
      checkingUpdates = null;
      return Promise.reject(err);
    }
  }
  return checkingUpdates;
}

/* 下载失败要有反馈：以前只写日志，用户点了「立即下载」后什么也看不到，
   还以为在后台下。GitHub 直连在国内经常断，必须给一条能走的路。 */
let downloadErrorOpen = false;
async function downloadFailed(err) {
  downloading = false;
  clearDownloadProgress();
  const detail = err && err.message ? String(err.message) : '';
  log('[update] 下载失败', detail);
  if (downloadErrorOpen || quitting) return;
  downloadErrorOpen = true;
  try {
    const panReady = !/PLACEHOLDER/i.test(PAN_QUARK_URL);
    const buttons = panReady ? ['改用网盘下载', '重试', '关闭'] : ['重试', '关闭'];
    const { response } = await showBox({
      type: 'warning',
      title: 'LIZI 更新',
      message: '下载失败',
      detail: '可能是网络连不上 GitHub。'
        + (panReady ? '网盘里有同一个安装包，可以直接下。' : ''),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    if (panReady && response === 0) openUrl(PAN_QUARK_URL);
    else if (response === (panReady ? 1 : 0)) startDownload();
  } catch (e) {
    log('[update] 下载失败提示没弹出来', e && e.message ? e.message : e);
  } finally {
    downloadErrorOpen = false;
  }
}

/* 用户选了「立即下载」：只走应用内下载，不打开浏览器；下完再问要不要重启。 */
function startDownload() {
  if (!updater || downloading) return;
  downloading = true;
  setDownloadProgress(0);
  try {
    const p = updater.downloadUpdate();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => downloadFailed(err));
    }
  } catch (err) {
    downloadFailed(err);
  }
}

async function askUpdate(info) {
  if (updateDialogOpen || quitting) return;
  updateDialogOpen = true;
  try {
    const version = info && info.version ? info.version : '';
    /* 链接若被换回占位符（还没填），别给用户一个点了没用的按钮：
       直接少一个「网盘备用」，文案里那句「网盘里有同一个安装包」也一起去掉。 */
    const panReady = !/PLACEHOLDER/i.test(PAN_QUARK_URL);
    const buttons = panReady
      ? ['立即下载', '打开下载页', '夸克网盘', '百度网盘', '以后再说']
      : ['立即下载', '打开下载页', '以后再说'];
    const { response } = await showBox({
      type: 'info',
      title: 'LIZI 更新',
      message: `有新版本 v${version}`,
      detail: panReady ? 'GitHub 直连不稳的话，可以从夸克或百度网盘下载同一个安装包。' : '',
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });

    if (response === 0) {
      startDownload();
      return;
    }
    if (response === 1) {
      openUrl(RELEASES_URL);
      return;
    }
    if (panReady && response === 2) {
      openUrl(PAN_QUARK_URL);
      return;
    }
    if (panReady && response === 3) {
      openUrl(PAN_BAIDU_URL);
      return;
    }
    log('[update] 用户选择以后再说');
  } finally {
    updateDialogOpen = false;
  }
}

async function promptRestart(info) {
  downloading = false;
  clearDownloadProgress();
  if (quitting) return;
  try {
    const version = info && info.version ? info.version : '';
    const { response } = await showBox({
      type: 'info',
      title: 'LIZI 更新',
      message: `v${version} 已下载完成`,
      detail: '重启后完成安装，现在重启吗？',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      quitting = true;
      setImmediate(() => {
        try { updater.quitAndInstall(); } catch (err) { log('[update] 安装失败', err); }
      });
    }
  } catch (err) {
    log('[update] 重启提示失败', err);
  }
}

/* 只在打包版联网检查；开发环境、配置缺失、网络错误都不影响启动。 */
function initAutoUpdate() {
  if (!IS_PACKAGED) {
    log('[update] 开发环境，跳过更新检查');
    return;
  }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;

    updater.on('update-available', (info) => {
      log('[update] 发现新版本', info && info.version);
      notifyUpdate(info);
    });
    updater.on('update-not-available', () => log('[update] 已是最新版本'));
    updater.on('download-progress', (p) => {
      if (p && typeof p.percent === 'number') setDownloadProgress(p.percent);
    });
    updater.on('update-downloaded', (info) => {
      promptRestart(info).catch((err) => log('[update] 重启提示失败', err));
    });
    updater.on('error', (err) => {
      /* 只有正在下载时才算「用户可见的失败」——后台自动检查失败照旧静默，
         不影响启动，也不要半夜弹窗吓人。 */
      if (downloading) { downloadFailed(err); return; }
      downloading = false;
      clearDownloadProgress();
      log('[update] 更新失败（已忽略，不影响启动）', err && err.message ? err.message : err);
    });

    /* 延迟几秒再查，别和窗口/服务初始化抢资源。 */
    setTimeout(() => {
      if (quitting) return;
      checkForUpdatesOnce()
        .catch((err) => log('[update] 检查失败（已忽略）', err && err.message ? err.message : err));
    }, 6000);
  } catch (err) {
    log('[update] 初始化失败，跳过（不影响启动）', err && err.message ? err.message : err);
  }
}

/* ---- 更新 IPC：设置页「检查更新」/ 小提示条上的按钮 ---- */

/** 手动检查：开发环境返回明确状态，不抛错（页面据此显示「开发环境不检查更新」）。 */
ipcMain.handle('update:check', async () => {
  const currentVersion = app.getVersion();
  if (!IS_PACKAGED) return { status: 'dev', currentVersion };
  if (!updater) return { status: 'error', currentVersion, message: '更新组件未就绪' };
  try {
    const result = await checkForUpdatesOnce();
    const version = result && result.updateInfo && result.updateInfo.version;
    if (result && result.isUpdateAvailable && version) {
      /* 事件监听器通常已经推过一次；这里再推一次是兜底，页面按版本号去重。 */
      notifyUpdate(result.updateInfo);
      return { status: 'available', version, currentVersion };
    }
    return { status: 'latest', currentVersion };
  } catch (err) {
    log('[update] 手动检查失败', err && err.message ? err.message : err);
    return {
      status: 'error',
      currentVersion,
      message: err && err.message ? err.message : String(err),
    };
  }
});

/** 小提示条上的「立即下载」：复用现有 electron-updater 下载流程。 */
ipcMain.handle('update:download', () => {
  if (!IS_PACKAGED || !updater) return { ok: false, reason: 'dev' };
  if (downloading) return { ok: true, already: true };
  startDownload();
  return { ok: true };
});

/** 只允许打开两个固定地址，避免把任意 URL 开成系统浏览器。 */
ipcMain.handle('update:open', (_e, target) => {
  if (target === 'pan') { openUrl(PAN_QUARK_URL); return true; }
  if (target === 'pan-bd') { openUrl(PAN_BAIDU_URL); return true; }
  if (target === 'github') { openUrl(RELEASES_URL); return true; }
  return false;
});

/** 设置页「版本」一栏用真实应用版本（打包后升级会变）。 */
ipcMain.handle('app:version', () => app.getVersion());

/* ------------------------------------------------------------- 生命周期 -- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, commandLine) => {
    if (!win) return;
    win.show(); win.focus();
    /* 已经有一个窗口在跑时，再从开发者版快捷方式点一次：
       把窗口切到对应形态版本，而不是只把它抬到前面。 */
    const edition = editionFromArgv(commandLine);
    if (edition && serverPort) win.loadURL(pageUrl(serverPort, edition));
  });

  app.whenReady().then(async () => {
    serverPort = await ensureServer();
    createWindow(serverPort);
    createTray();
    bindMediaKeys();
    initAutoUpdate();

    /* 托盘/媒体键等主进程崩溃不应无声退出 —— 打到日志里 */
    process.on('uncaughtException', (err) => log('uncaught:', err));
  });

  app.on('window-all-closed', () => { /* 有托盘在，不退出 */ });

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    if (serverChild) { try { serverChild.kill(); } catch {} }
  });
}
