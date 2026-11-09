# services/spotify-api —— Spotify 边车（**可行性骨架，本期不接音频**）

**只做三件事：PKCE 登录骨架、元数据读取、把限制如实说出来。** 不做音频，这是有意的决定，不是没做完。

## 为什么不接音频

| 硬门槛 | 具体 |
|---|---|
| 原生二进制 | 要 `node-librespot`（**59.4MB**原生模块），不是纯 JS 能解决的 |
| 账号 | 必须 **Premium**，免费账号拿不到播放密钥 |
| 灰区 | 播放要解 DRM（Widevine/PlayReady 系），属解密受保护内容 |
| 歌词 | 官方 Web API **不提供**歌词；Musixmatch 之类没有授权，所以这里也不做假的 |

LIZI 里这一行写的是「仅元数据 · 需自备 Client ID · 音频要 Premium」，`/audio` 永远回
`{ url:'', reason:'drm' }`，点歌只会在角标上写「Spotify · 本期不接音频」。

## 为什么没有内置 Client ID

Spotify 不给第三方预置凭证（也不允许把 secret 发给桌面客户端当公共凭证用）。
所以要么你自己注册一个免费 App，要么这个音源就只能停在「未配置」。

**配法（两种任选）**

1. 环境变量：`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`
2. 文件：`services/spotify-api/.client.json`
   ```json
   { "clientId": "xxxxxxxx", "clientSecret": "yyyyyyyy" }
   ```

然后在 Spotify 后台把 **Redirect URI** 登记成：`http://127.0.0.1:5588/callback`

| 配了什么 | 能干什么 |
|---|---|
| 什么都没有 | `/health` 回 `ok:false`，`/search` 明确报「缺少 SPOTIFY_CLIENT_ID」 |
| 只有 clientId | 点「去授权」走 **官方 OAuth PKCE**（浏览器，回调 127.0.0.1:5588），登录后能搜 |
| clientId + clientSecret | **不需要用户登录**，用 `client_credentials` 直接搜公开元数据（token 不落盘） |

## 文件

```
services/spotify-api/
  package.json        零依赖（只用 node 内置 http/crypto/fetch），Node ≥18
  start.mjs           API 服务（默认 3214）+ 独立的 OAuth 回调服务（固定 127.0.0.1:5588）
  .client.json        你自己的 App 凭证（gitignore）
  .auth-token.json    PKCE 换来的 access/refresh token（gitignore）
```

## 起 / 停

```powershell
node services/spotify-api/start.mjs
# 平时由 server.mjs 按需 spawn。注意它会同时占两个端口：3214（API）+ 5588（OAuth 回调）
```

端口优先级：`SPOTIFY_API_PORT` → `.port` → **3214**。回调端口可用 `SPOTIFY_CALLBACK_PORT` 改
（改了要同步改 Spotify 后台登记的 Redirect URI）。

## 路由

| 路由 | 说明 |
|---|---|
| `/health` | `{ ok, clientId(打码), hasSecret, loggedIn, callback, audio:false, reason }` |
| `/login/url` | 生成 PKCE 授权地址（含 `code_challenge`），没有 clientId 时回 `{ code:400, error }` |
| `/status` | `{ loggedIn, mode:'pkce'|'client-credentials', nickname, product }` |
| `/search?q=&limit=` | `GET /v1/search?type=track` |
| `/song/url` | 永远 `{ url:'', reason:'drm' }` —— 不是没实现，是不做 |
| `/lyrics` | 永远空 + `reason:'no-lyrics-api'` |
