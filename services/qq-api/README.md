# services/qq-api —— QQ 音乐边车

LIZI 的第二个音源。**故意不放进根 `package.json`**：项目是零运行时依赖，QQ 这套要 koa + MQTT，
体积和风险都该隔离。这里自带 `package.json` 和 `node_modules`，只跟本机主服务说话。

```
services/qq-api/
  package.json        @yakult-green-tea/qq-music-api 钉死 3.3.5（MIT，Node ≥20）
  start.mjs           启动器：端口 / 只绑回环 / 登录态落盘 / 失败要说原因
  node_modules/       自己的依赖树（约 1.7MB + 依赖，gitignore）
  .port               实际监听端口（运行时写，gitignore）
  .log                边车日志（运行时写，gitignore）
  .auth-secret        登录态加密密钥（首次启动生成，删了 = 要重新扫码）
  .auth-session.json  加密后的登录态（第一次登录后才有）
  .auth-state/qq-device.json  设备身份（**别删**，删了 QQ 当新设备，容易撞 20279 上限）
```

## 起 / 停

```powershell
# 平时不用手动起：主服务收到第一个 /api/qq/* 请求时会自己 spawn，死了下次请求会重起
node services/qq-api/start.mjs        # 手动起（调试用）

# 停：关掉进程即可（Ctrl+C / 按端口找 PID 再 Stop-Process）。
# 它是主服务的子进程，主服务退出后 ≤5s 自己收工（盯 QQ_PARENT_PID）。
```

## 端口怎么定

优先级：`QQ_API_PORT` 环境变量 → 上次的 `.port` → **3210**。

- 为什么不是默认的 3200：这台机器上 3200 落在 Windows 保留段里，`listen` 直接 `EACCES`。
- 端口不可用（EACCES / EADDRINUSE）时自动退回系统分配，并把**真实端口**写进 `.port`。
- 主服务只认 `.port`，不猜。

## 只绑 127.0.0.1

包里的 `app.js` 是 `app.listen(port, cb)`，没给 host，默认 `0.0.0.0`（局域网能访问）。
`start.mjs` 在 `require()` 之前给 `net.Server.prototype.listen` 打了个一次性补丁：第一次 listen 补上
`127.0.0.1`。所以**不要绕过 start.mjs 直接 `node node_modules/.../app.js`**，那样会绑全网卡。

## 登录态

用包自己的机制（Node 是 `stored` 会话，cookie 名 `qqmusic_session`）：

| 环境变量 | 值 |
|---|---|
| `QQ_AUTH_SESSION_PATH` | `services/qq-api/.auth-session.json` |
| `QQ_SESSION_SECRET` | `.auth-secret` 里的 32 字节 hex（首次生成后固定） |

两个都设了才会落盘；密钥换了文件就解不开。凭证本身没过期前会自己续期，但**浏览器那个 cookie 有 1 天
Max-Age**，过期后要重新扫码。

## 扫码通道（`?channel=`）

| channel | 用哪个 App 扫 | 实现 |
|---|---|---|
| `qqmusic`（默认） | QQ 音乐 App | MQTT 长连接 |
| `qq` | 手机 QQ | MQTT（网页登录兜底） |
| `wechat` | 微信 | HTTP 轮询 |

状态码和网易云那套一样：`801` 等待 / `802` 待确认 / `803` 成功 / `800` 过期。

**二维码有 15 秒冷却**（包里的 `QR_COOLDOWN_MS`）：15 秒内再要一张，key 拿得到但图是空的。
主服务会把上游的 `retryAfterMs` 带回去，界面显示「约 N 秒后再试」。
`qqmusic` 这条通道偶尔会在 `mqtt-listener` 阶段超时（`mqtt-packet-timeout`），重试即可。

## 哪些接口匿名可用（实测 2026-10-27）

| 接口 | 匿名 | 说明 |
|---|---|---|
| `/search` | ✅ | 不带会话时用精简版客户端，单次最多 20 条 |
| `/getLyric` | ✅ | 标准 LRC |
| `/getSongInfo`、`/singer/*`、`/recommend/*` | ✅ | |
| `/getMusicPlay/:songmid` | ⚠️ 只有**试听片段** | 匿名给 30~60s 的 mp3（`preview=1`），正片返回 `104003` |
| `/login/status`、`/user/*`、`/logout` | ❌ 需要会话 | 401 / 空 profile |

## 已知限制

- **没会员只能听试听片段**：`getMusicPlay` 匿名只给 preview，正片要登录 + 会员。LIZI 会如实打「试听片段」角标。
- **地区/版权**：部分歌（尤其海外版权）连试听都没有，返回 `104003 / url_unavailable`。
- **风控**：搜索偶发 `2001`（连打太快），主服务重试一次；二维码 15s 冷却；设备数有上限（`20279`）。
- **不要 `node smoke-all.mjs`**（那是形态验收，和这里无关）。

## 主服务怎么接的（改这里之前先看）

`server.mjs` 里的 `/api/qq/*` 不是透明转发，是**翻译层**：QQ 的字段名、分页、播放地址形状和网易云完全不同，
那边统一成前端只认的 `{ code, ... }`。音频直链再走 `/api/qq/audio` 代理（转发 Range，只放行 `*.qq.com`），
这样 `<audio>` 能拖进度条，vkey 也不出现在 DOM 里。

## 两个必须知道的坑

1. **打包（`npm run dist`）暂时不会带上这个目录。** 根 `package.json` 的 `build.files` 只写了
   `desktop/** public/** server.mjs package.json`。装出来的 LIZI 里 `/api/qq/health` 会回
   「QQ 边车没安装」——这是预期行为，不是坏掉。要带上就加 `"services/**"`（或用 `extraResources`），
   但那一行属于根 `package.json`，本期按红线没动。
2. **Node 20 也能跑**（Electron 33 内置 20.18.3）。已实测：用 `ELECTRON_RUN_AS_NODE=1` 让
   `electron.exe` 跑 `server.mjs`，它会用同样的方式拉起本边车；`/api/qq/health`、`/search`、
   `/api/qq/song/url` 全部正常。注意 Node 20 的 `console.log` 在 stdout 被关时会抛 EPIPE，
   `start.mjs` 已经吞掉了（早期版本会被一条日志打死）。

