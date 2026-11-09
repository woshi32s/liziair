# kuwo-api · 酷我音乐边车

LIZI 的第七个真实平台后端。零运行时依赖，只监听 `127.0.0.1`，平时由主服务 `server.mjs` 按需拉起。

## 端口

- 默认 **3216**（避开 kugou 3211、qishui 3212、bodian 3213、spotify 3214、netease 3215）。
- 优先级：环境变量 `KUWO_API_PORT` > 上次写下的 `.port` > 3216。
- 端口被占时改为系统分配，并把真实端口写进 `.port`；就绪时 stdout 打印 `KUWO_API_READY <port>`。

## 启动 / 停止

```bash
node services/kuwo-api/start.mjs
# 停止：Ctrl+C，或按端口找 PID 结束
```

主服务会带 `KUWO_PARENT_PID` 拉起它，父进程退出 5 秒内自杀。

## 能力与上游证据

所有结论都用 `curl` 实测过（2026-11-06，匿名态）。上游接口随时可能变，失败时边车返回 `code != 200` 和原因，不编数据。

| 能力 | 路由 | 上游 | 实测 |
| --- | --- | --- | --- |
| 搜索歌曲 | `GET /search?s=周杰伦&limit=20&page=1` | `www.kuwo.cn/search/searchMusicBykeyWord` | 200，TOTAL 3600 |
| 歌单详情 | `GET /playlist/tracks?id=2867496601&limit=100&page=1` | `/api/www/playlist/playListInfo` | 200，177 首 |
| 搜索歌单 | `GET /playlist/search?key=周杰伦` | `/api/www/search/searchPlayListBykeyWord` | 200，142 个 |
| 推荐歌单 | `GET /recommend/playlists?limit=12` | `/api/www/rcm/index/playlist?id=37` | 200 |
| 榜单目录 | `GET /rank/list` | `/api/www/bang/bang/bangMenu` | 200，含官方/特色/分类 |
| 榜单歌曲 | `GET /rank/tracks?id=16&limit=30` | `/api/www/bang/bang/musicList` | 200，热歌榜 300 首 |
| 电台目录 | `GET /radio/stations` | `/api/www/radio/index/radioList` | 200，只有 `albumList`，**没有可解析的单集曲目接口** |
| 专辑曲目 | `GET /album/tracks?id=29593612` | `/api/www/album/albumInfo` | 200，12 首 |
| 每日推荐 | `GET /daily` | 官方「每日最新单曲推荐」歌单 1082685104，失败退热歌榜 | 200 |
| 播放直链 | `GET /song/url?id=440614&quality=320` | `mobi.kuwo.cn/mobi.s?f=kuwo&q=<加密>` | 200，完整时长 mp3/flac |
| 歌词 | `GET /lyric?id=440614` | `newlyric.kuwo.cn/newlyric.lrc`（PC 逐字），H5 兜底 | 200，LRC |
| 登录 | `POST /login/cookie` | 粘贴浏览器 Cookie | 无扫码，见下 |

### 播放直链的两条上游

- `mobi.kuwo.cn` 的 `convert_url2`：客户端协议，`q` 参数是酷我自定义 DES 变体（key `ylzsxkwm`），本文件内自带实现。拿到的是**完整时长**直链，付费歌也能拿到试听/播放地址；匿名请求即可。
- `www.kuwo.cn/api/v1/www/music/playUrl`：网页协议，免费歌可用，付费歌返回错误；作为兜底。
- **没有使用** `anti.s`。它对付费歌固定返回 11.31 秒的试听片段（多个 rid 返回同一份 181521 字节文件），拿它当播放地址属于造假，故意不用。

### 登录：只有 Cookie，没有二维码

酷我 Web 端不提供二维码登录；登录接口需要图形验证码/短信。因此：

- `POST /login/cookie`，body `{ "cookie": "userid=...; sid=...; ..." }`，或 `?cookie=`，或直接粘整段 `Cookie:` 头。
- 必须同时有 `userid` 和 `sid`（或 `websid`），否则不落盘、返回 `loggedIn:false` 和原因。
- Cookie 只写 `.auth-cookies.json`（权限 0600），日志里只打印键名，不打印值。
- `GET /status` 返回登录态；`GET /logout` 清空；`/login/qr/*` 明确返回 `code:501`，**不画假二维码**。
- 没有用户歌单 / 我喜欢接口：www、wapi、mobile wapi 实测均 404，所以前端这两处保持空态，不造歌单。

## 返回形状

边车只做搬运，前端 `server.mjs` 负责归一化：

- `/search` → `{ code, total, list: [abslist 原样] }`
- `/playlist/tracks` → `{ code, id, name, cover, creator, total, list }`
- `/song/url` → `{ code, id, url, quality, format, source }`；拿不到时 `url:''` + `reason`
- `/lyric` → `{ code, lyric, format, source, error }`
- `/radio/stations` → `{ code, list: [albumList] }`（仅目录）
- `/daily` → `{ code, name, source, list }`

## 已知限制

1. 酷我 Web 没有扫码登录，只能粘 Cookie。
2. 用户歌单 / 我喜欢没有公开接口，空态。
3. 电台只有栏目目录，没有单集曲目接口，不能播放。
4. 匿名 `Hm_Iuvt_` token 会过期，边车自动刷新一次；仍失败会明确报错。
5. 直链带时效签名，边车不缓存；主服务代理时透传 Range。

## 手动验收

```bash
node services/kuwo-api/start.mjs
curl -s http://127.0.0.1:3216/health
curl -s "http://127.0.0.1:3216/search?s=周杰伦&limit=2"
curl -s "http://127.0.0.1:3216/song/url?id=440614&quality=320"
curl -s "http://127.0.0.1:3216/lyric?id=440614"
```

主服务需重启后 `/api/kuwo/*` 代理才生效；重启前前端会自动起边车，但代理路由仍走旧代码。
