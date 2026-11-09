/* preload：只开一条窄口子 —— 主进程的媒体键/托盘事件 → 页面里的 Player。
   contextIsolation 开着，页面拿不到 Node。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__desktop', {
  /** 返回 true 表示跑在桌面壳里（页面用它决定要不要绑） */
  isDesktop: true,
  /** 自绘窗口控制：最小化 / 最大化 / 关闭(到托盘) / 是否已最大化 */
  winControls: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.sendSync('win:isMaximized'),
    /** 一次读全部真实状态（Promise）：{ maximized, minimized, fullscreen, visible } */
    getState: () => ipcRenderer.invoke('win:getState'),
  },
  /** 主进程推的窗口状态：{ maximized, fullscreen, visible }（最大化/还原/全屏/缩放/显隐时来） */
  onWinState(cb) {
    ipcRenderer.on('win:state', (_e, s) => cb(s));
  },
  onMedia(cb) {
    for (const ch of ['media:toggle', 'media:next', 'media:prev', 'media:stop']) {
      ipcRenderer.on(ch, () => cb(ch.replace('media:', '')));
    }
  },
});
