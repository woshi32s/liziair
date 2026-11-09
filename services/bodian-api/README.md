# services/bodian-api —— 波点音乐边车

`bodian-music-api@0.1.2`（**AGPL-3.0**，Node ≥24，依赖 `qrcode`）也是**纯协议库**：

```js
const { createBodianApi, BODIAN_OPERATIONS } = require('bodian-music-api');
const api = createBodianApi({ deviceId, sessions });       // sessions 可选，默认只在内存里
await api.request('search', { query: '周杰伦', limit: 20 });
```

和汽水同一族（ByteDance guard 签名），所以 `start.mjs` 的结构和 `services/qishui-api/start.mjs` 一样：
薄 HTTP 壳 + 端口/.port + 只绑回环 + 会话落盘 + EPIPE + 盯父进程。

> **许可证注意**：酷狗和汽水是 MIT，这个包是 **AGPL-3.0**。本期只在**本机边车**里调用它、不修改它，
> 也不打进安装包（根 `package.json` 的 `build.files` 没有 `services/`）。要随包分发得先过许可这一关。

```
services/bodian-api/
  package.json           bodian-music-api 钉死 0.1.2，engines node >= 24
  start.mjs              薄 HTTP 壳
  .port .log            运行时（gitignore）
  .auth-device.json     32 位 hex 设备 ID（**别删**）
  .auth-session.json    登录态（token / uid，gitignore）
```

## 需要 Node ≥ 24

和汽水一样，`server.mjs` 会先探系统 `node --version`；不足 24 就回 `reason:'node-version'`，
界面显示「本机 node 版本不足（需 ≥24）」并隐藏登录键。`LIZI_NODE_BIN` 可以指定 node。

## 起 / 停

```powershell
node services/bodian-api/start.mjs       # 手动起（调试）
# 平时由 server.mjs 按需 spawn；父进程退出后 ≤5s 自己收工
```

端口优先级：`BODIAN_API_PORT` → `.port` → **3213**。

## 路由

`/health` · `/status` · `/logout` · `/login/qr/key` · `/login/qr/create` · `/login/qr/check`（801/802/803/800）
· `/search?q=` · `/audio?id=&quality=` · `/lyrics?id=` · `/playlist/tracks?id=`

## 哪些接口匿名可用（实测 2026-10-27）

| 接口 | 匿名 | 实测 |
|---|---|---|
| `/search` | ✅ | 「周杰伦」20 条，字段是 `name` / `artist` / `album` / `duration`(秒) / `albumPic` / `id` |
| `/audio` | ⚠️ **30 秒试听** | `preview:{startTime:0,endTime:29}`，直链落在 `*.kuwo.cn` CDN |
| `/lyrics` | ✅ | `mainText` 行级 LRC（实测 1463 字），另有逐字 `wordByWordText` |
| `/login/qr/key`+`create` | ✅ | 实测二维码 320×320、非空白像素 39.7% |
| `/status`、红心、歌单编辑 | ❌ | 需要扫码登录 |

## 已知限制

- **未登录只有 30 秒试听**：URL 本身就是片段（不是整首 + 偏移），LIZI 打「试听片段」角标。
- **播放只放行中国大陆网络**：上游业务码 `407` → `region-restricted`，`server.mjs` 转成
  `reason:'region'`，界面写「波点音乐 · 仅中国大陆网络」，**不自动跳歌**。
- 字段混着 PascalCase 和小写（`FSONGNAME` / `name` / `songName`），翻译在 `server.mjs` 里做。
- 封面在 `img*.kuwo.cn`（已加进 `/api/img` 后缀白名单 `*.kuwo.cn`）。
