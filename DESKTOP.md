# 桌面版（Electron）

> 双击即用的独立窗口版。和浏览器工作流**共用同一份 `public/` 源码**：
> 改文件 → 窗口里 Ctrl+R 刷新即生效，不用重新打包。

---

## 三种用法

| 命令 | 干什么 | 什么时候用 |
|---|---|---|
| `npm start` | 开发模式：Electron 窗口直接跑当前源码 | 日常开发/精修 |
| `npm run dist` | 打 NSIS 安装包到 `dist\` | 要发给别人时 |
| 直接双击 `dist\...-setup.exe` | 安装 | 装好后桌面有「液态玻璃播放器」 |

服务端**不需要单独启动**：桌面壳会自己拉起 `server.mjs`（用 Electron 内置的 Node）；
如果检测到服务已经在跑（浏览器工作流那个），就直接复用，不会抢端口。

## 窗口行为

- **点 ✕ 不是退出**，是最小化到托盘（音乐软件惯例）
- 托盘图标：显示主窗口 / 播放控制 / **开机自启**开关 / 退出（真退出，会连后台服务一起停）
- **全局媒体键**：键盘的播放/暂停/上一首/下一首直接控制（页面里 `window.__desktop` 桥到 `Player`）
- 单实例：重复双击只会把已有窗口唤到前台

## 打包细节（改之前先看）

| 项 | 值 | 为什么 |
|---|---|---|
| `asar: false` | 散装（学 Mineradio） | 装到用户机器上也是散的 `public/`，随时能改 |
| 安装范围 | **per-user**（装到 `%LOCALAPPDATA%\Programs`） | `server.mjs` 要往应用目录写 `.port`，装进 Program Files 会没权限 |
| `files` | desktop/** + public/** + server.mjs | 零依赖，`node_modules` 只含开发用的 electron 本体（build 时自动排除 devDependencies） |
| 图标 | `build/icon.ico`（由 `build/icon-src.html` 用无头 Chrome 渲染而来） | 改图标：改 HTML → `node _icon.mjs` → 重跑 python 转 ico |

## 体系约束

- `desktop/main.js` 用 `ELECTRON_RUN_AS_NODE=1` 起服务子进程，**不需要**额外打包 node.exe
- 页面通过 `window.__desktop`（preload 窄口子）感知桌面壳，浏览器里为 undefined，互不干扰
- 版本升级：`package.json` 的 `version` 决定 NSIS 是否覆盖安装
