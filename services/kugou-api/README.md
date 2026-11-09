# services/kugou-api —— 酷狗音乐边车

LIZI 的第二个外部音源（QQ 之后）。**故意不放进根 `package.json`**：项目本身零运行时依赖，
酷狗这套要 express + axios + crypto-js（10 个直接依赖、121 个包），体积和风险都该隔离在这里。

```
services/kugou-api/
  package.json       kugoumusicapi 钉死 v1.6.0（GitHub tarball URL，MIT，Node ≥12）
  start.mjs          启动器：端口 / 只绑回环 / 设备身份落盘 / 失败要说原因
  node_modules/      自己的依赖树（gitignore）
  .port              实际监听端口（运行时写，gitignore）
  .log               边车日志（运行时写，gitignore）
  .auth-cookies.json token/userid/vip_type（登录后才有，gitignore）
  .auth-state/device.json  设备 GUID（**别删**，删了酷狗当新设备）
```

> 包名不在 npm registry 上：`npm i kugoumusicapi` 会 404。这里的依赖写成
> `https://codeload.github.com/MakcRe/KuGouMusicApi/tar.gz/refs/tags/v1.6.0`，
> `npm install` 会直接拉 tag 归档包（实测 7 秒装完，版本号仍是 1.6.0）。

## 起 / 停

```powershell
# 平时不用手动起：主服务收到第一个 /api/kugou/* 请求时会自己 spawn，死了下次请求会重起
node services/kugou-api/start.mjs        # 手动起（调试用）

# 停：关掉进程即可（Ctrl+C / 按端口找 PID 再 Stop-Process）。
# 它是主服务的子进程，主服务退出后 ≤5s 自己收工（盯 KUGOU_PARENT_PID）。
```

## 端口怎么定

优先级：`KUGOU_API_PORT` → 上次的 `.port` → **3211**。
不可用（EACCES / EADDRINUSE）时自动退回系统分配，并把**真实端口**写进 `.port`；主服务只认 `.port`。

## 只绑 127.0.0.1

包里是 `app.listen(port, host, cb)`，`host` 读 `HOST` 环境变量。`start.mjs` 显式设 `HOST=127.0.0.1`，
另外还给 `net.Server.prototype.listen` 打了一次性补丁（host 缺省时补回环），和 QQ 边车同一套。
**不要绕过 start.mjs 直接 `node node_modules/kugoumusicapi/app.js`**，那样会绑全网卡（默认 3000）。

## 登录态

包只认 Cookie（`token` / `userid` / `vip_type` / `vip_token`），不落盘。
所以**由主服务代劳**：`server.mjs` 的 `/api/kugou/login/qr/check` 在 state=4（成功）那一轮把
上游 `Set-Cookie` 里的 token/userid 收进 `.auth-cookies.json`，之后每次请求带上。

- 二维码 3 秒一张有效期内可用；状态码：`0` 过期 / `1` 等待 / `2` 待确认 / `4` 成功
- 设备 GUID 存在 `.auth-state/device.json`，删了等于换一台设备（酷狗有设备数限制）

## 哪些接口匿名可用（实测 2026-10-27）

| 接口 | 匿名 | 说明 |
|---|---|---|
| `/search` | ✅ | 实测「周杰伦」480 首，一次 20 条，带封面/时长/专辑 |
| `/playlist/detail`、`/top/song`、`/rank/*` | ✅ | 包里有，本期没接进 UI |
| `/login/qr/key` + `/login/qr/create` | ✅ | 实测二维码 196×196、非空白像素 36.8% |
| `/song/url` | ❌ | **返回 `errcode 20028`「本次请求需要验证」**（腾讯天御风控）。换 dfid / 设备注册 / 试听模式都一样 |
| 歌词 `/search/lyric` + `/lyric` | ⚠️ | 搜索能用，解码要 accesskey；未登录时部分歌拿不到 |

## 已知限制

- **播放必须登录**。匿名搜索通、二维码能出，但 `/song/url` 被风控拦（20028），LIZI 在歌曲上标
  「酷狗音乐 · 需登录」，不放演示音冒充。登录后（扫码）才可能拿到直链；会员曲目仍可能只给试听。
- 搜索结果字段是 PascalCase（`FileHash` / `SongName` / `Duration` 秒），`server.mjs` 里统一翻译成
  前端只认的 `{ id, source, name, artists, album, cover, duration(ms) }`。
- 封面走 `imge.kugou.com`（已加进 `/api/img` 后缀白名单）。
- **不要 `node smoke-all.mjs`**（那是形态验收，和这里无关）。

## 主服务怎么接的

`server.mjs` 的 `/api/kugou/*` 是**翻译层**，不是透明转发：字段名、分页、播放地址形状都不同，
那边统一成 `{ code, ... }`。音频再走 `/api/kugou/audio` 代理（转发 Range，只放行 `*.kugou.com`）。
