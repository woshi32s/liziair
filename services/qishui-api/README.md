# services/qishui-api —— 汽水音乐边车

`qishui-music-api@0.2.2`（MIT，**零依赖**）是**纯协议库**，不是 HTTP 服务：

```js
const { createQishuiApi, createQishuiDeviceId, isQishuiDeviceId } = require('qishui-music-api');
const api = createQishuiApi({ deviceId, sessions, fetch });
await api.request('search', { query: '周杰伦', limit: 20, offset: 0 });   // → { ok, data } / { ok:false, error }
```

报文带 ByteDance 的 guard 签名（`deviceId` / `ticket` / `guardKey` / `guardCert` / `guardTsSign` / `accessCode`），
所以这里写了个**很薄的 HTTP 壳**（`start.mjs`），把 `request(op, params)` 摊成 `/search` `/audio` `/login/qr/*`
这些路由，形状照 `services/qq-api` 那套（`{ code, ... }`）。

```
services/qishui-api/
  package.json           qishui-music-api 钉死 0.2.2，engines node >= 24
  start.mjs              薄 HTTP 壳：端口 / 只绑回环 / 会话落盘 / EPIPE / 盯父进程
  .port .log            运行时（gitignore）
  .auth-device.json     设备 ID（19 位数字，**别删**，换 ID = 换一台车机）
  .auth-session.json    登录态（ticket / guardKey / guardCert…，含凭据，gitignore）
```

## ⚠️ 需要 Node ≥ 24

上游 `engines` 写的是 `>=24`（BigInt + crypto 的 P-256 / PKCS#8）。而 `server.mjs` 可能跑在
**Electron 的 Node 20.18.3** 下（`ELECTRON_RUN_AS_NODE`）。所以：

1. `server.mjs` 起这个边车前会先 **`node --version` 探一遍系统 node**；
2. 版本 < 24 或找不到 node，**不 spawn**，直接回
   `{ code:502, ok:false, reason:'node-version', error:'本机 node 版本不足：这个音源要求 ≥ 24，当前是 v20.18.3' }`；
3. 界面把这个音源标成「本机 node 版本不足（需 ≥24）」并**隐藏登录键**（点了也没用）。

`start.mjs` 自己也有一道闸：版本不够就 `console.log('QISHUI_API_UNSUPPORTED_NODE <ver>')` 并 `exit(2)`。
可以用 `LIZI_NODE_BIN` 指定用哪个 node。

## 起 / 停

```powershell
node services/qishui-api/start.mjs       # 手动起（调试）
# 平时由 server.mjs 按需 spawn；父进程退出后 ≤5s 自己收工（盯 QISHUI_PARENT_PID）
```

端口优先级：`QISHUI_API_PORT` → `.port` → **3212**；不可用就退回系统分配并写回 `.port`。

## 路由（自建的，不是上游的）

| 路由 | 干什么 |
|---|---|
| `/health` | `{ ok, node, deviceId, loggedIn }`（主服务用它做活跃探针） |
| `/status`、`/logout` | 登录态 |
| `/login/qr/key` → `/login/qr/create?key=` → `/login/qr/check?key=` | 抖音扫码；状态码映射成 801/802/803/800 |
| `/search?q=&limit=&offset=` | 搜索（匿名可用） |
| `/audio?id=&quality=` | 播放直链（`standard`/`high`/`lossless`/`hires`，低档优先明文） |
| `/lyrics?id=` | KRC 逐字 → 服务端转成行级 LRC |
| `/feed/modes`、`/feed`、`/playlist/tracks` | 推荐 / 歌单（本期没接进 UI） |

## 哪些接口匿名可用（实测 2026-10-27）

| 接口 | 匿名 | 实测 |
|---|---|---|
| `/search` | ✅ | 「周杰伦」20 条，`base_info.name` / `duration_ms` / `artist_links[].name` / `cover_url` 都在 |
| `/audio` | ⚠️ **只有 30 秒试听** | 返回 `preview:true` + `clipStartMs`（片段在原曲的起点，例如 145344ms） |
| `/lyrics` | ✅ | KRC 逐字，实测 36 行 |
| `/status`、`/feed`、`/liked_songs`、编辑歌单 | ❌ | 需要扫码登录 |

## 已知限制

- 登录二维码：上游给的是 356 字节的 `aweme://authorizedy?...` 深链（77×77、ECC M、3px/模块的 256px PNG）。
  边车在 `qr.mjs` 里只删掉空值参数（356→268 字节），再用 ECC L 重画成 57×57、8px/模块、4 模块留白的 520px PNG；
  `token` / `scopes` / `client_key` 原样保留，`/login/qr/check` 轮询完全不变。设 `QISHUI_QR_SIMPLIFY=0` 可退回上游原图。
- **未登录只有试听片段**（`preview:true`），LIZI 打「试听片段」角标，不假装整首。
- 只发**未加密**资源；`higher`/`highest`/`lossless` 档位在车机接口里是加密的，包里直接不支持，
  所以最高只能拿到 `standard`/`high`。
- **CDN 认 Referer 反而 403**（实测 `Referer: https://www.qishui.com/` → 403，不带 → 206），
  所以 `/api/qishui/audio` 代理**不加 Referer**。改之前先看这条。
- 音频容器是 `ftypM4A`（AAC），Chrome 能播；代理必须转发 Range，否则拖进度条会整段重下。
