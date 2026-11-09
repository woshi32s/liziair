# services/netease-api —— 网易云音乐边车

扫码登录换通道了。我们手写的那套 weapi/eapi 扫码，手机确认之后上游稳定回
`8821「请切换其他登录方式或升级新版本再试」`，`.session.json` 里永远只有 `NMTID`。
所以和 Folia 一样：**别再自己跟加密和风控较劲，直接跑同一个 API 服务，把登录交给它。**

**故意不放进根 `package.json`**：项目是零运行时依赖，这套服务自带 express/axios/jsdom，
体积和风险都该隔离。这里自带 `package.json` 和 `node_modules`，只跟本机主服务说话。

```
services/netease-api/
  package.json        @neteasecloudmusicapienhanced/api 钉死 4.41.1
  start.mjs           启动器：端口 / 只绑回环 / IP 补丁 / EPIPE / 盯父进程 / 失败要说原因
  node_modules/       自己的依赖树（gitignore）
  .port               实际监听端口（运行时写，gitignore）
  .log                边车日志（运行时写，gitignore）
```

## 起 / 停

```powershell
# 平时不用手动起：主服务收到第一个 /api/netease/* 请求时会自己 spawn，死了下次请求会重起
node services/netease-api/start.mjs        # 手动起（调试用）

# 停：关掉进程即可（Ctrl+C / 按端口找 PID 再 Stop-Process）。
# 它是主服务的子进程，主服务退出后 ≤5s 自己收工（盯 NETEASE_PARENT_PID）。
```

## 端口怎么定

优先级：`NETEASE_API_PORT` 环境变量 → 上次的 `.port`（读完即删）→ **3215**。

- 3210/3211/3212/3213/3214 已经被 QQ / 酷狗 / 汽水 / 波点 / Spotify 占了，网易云用 3215。
- 端口不可用（EACCES / EADDRINUSE / Windows 保留段）时退回系统分配，把**真实端口**写进 `.port`。
- 主服务只认 `.port`，不猜。

## 只绑 127.0.0.1

包的 `server.js` 里是 `app.listen(port, host, cb)`，host 来自 `options.host || process.env.HOST || ''`，
两者都没有时是 `''`（= 全网卡）。这里两条一起上：显式传 `host: '127.0.0.1'`，
并且在 `require()` 之前给 `net.Server.prototype.listen` 打一次性补丁（host 缺省时补回环）。

## IP 补丁（关键，等价于 Folia 的 patch-music-api-client-ip.mjs）

包里的 `server.js` 原文是这样的（4.41.1）：

```js
if (options.randomCNIP) {
  ip = global.cnIp
} else {
  ip = req.ip
  if (ip.substring(0, 7) == '::ffff:') ip = ip.substring(7)
  if (ip == '::1') ip = global.cnIp
}
```

`req.ip` 在这个进程里就是 `127.0.0.1`（express 还开了 `trust proxy`），
于是 `util/request.js` 会把 `X-Real-IP / X-Forwarded-For: 127.0.0.1` 发给网易云 ——
上游一眼就能看出请求来自本机代理，正是风控要抓的东西。

Folia 的做法是改源码加 `FOLIA_FORWARD_CLIENT_IP` 开关；这里**不动源码**，用两条等效措施：

```js
// a) 包里 util/option.js 的默认值认这个环境变量
process.env.ENABLE_RANDOM_CN_IP = 'true'

// b) require 主包之前，把 util/option.js 的模块导出换成强制 true 的包装
//    （各 module/*.js 是在 require 期才把 createOption 拿走的，所以每个请求都会走到这里）
const optionPath = require.resolve(`${PKG}/util/option`)
const originalOption = require(optionPath)
require.cache[optionPath].exports = function liziOption(query, crypto, checkToken) {
  const opts = originalOption(query, crypto, checkToken)
  opts.randomCNIP = true     // 调用方写 randomCNIP=false 也不放行
  return opts
}
// c) 自己种一个随机中国 IP 到 global.cnIp（原来这活是 generateConfig() 干的）
global.cnIp = require(`${PKG}/util/index`).generateRandomChineseIP()
```

效果：**每个请求都带一个随机中国 IP，客户端真实/私网 IP 永远不出这个进程**。
`/lizi/health` 会自报 `ipMode: "randomCNIP"`，验收脚本据此断言。
主服务的代理层还会把客户端传上来的 `randomCNIP` / `realIP` / `cookie` 参数全部丢掉。

## 登录态放哪

**不落盘在边车**。`MUSIC_U` 由主服务 `server.mjs` 自己保管（根目录 `.session.json`），
每次请求用 **JSON body** 把 cookie 串传进来（`{ "cookie": "a=b; c=d" }`，这个包会把 `req.body`
并进 query）。

⚠️ 不要改成 `?cookie=`：这个包的 `server.js` 会 `logger.info(req.originalUrl)`，query 里的
cookie 会被原样写进 `.log`。body 不进日志 —— 凭证不落盘是硬约束。

## 主服务用到的接口

| 主服务 | 边车 | 说明 |
|---|---|---|
| `GET /api/netease/login/qr/key` | `POST /login/qr/key` | 回 `{ code, key, qrimg }`，`qrimg` 是 base64 PNG |
| `GET /api/netease/login/qr/check?key=` | `POST /login/qr/check` | 回 `{ code, message, hasMusicU, cookieKeys }`，**不含 cookie 值** |
| `POST /api/login/harvest` | `POST /login/qr/check` | 803 后取上游 `cookie`，只留 MUSIC_U / __csrf |
| `GET /api/netease/health` | `GET /lizi/health` | 活跃探针 + `ipMode` |
| `* /api/netease/<其余>` | `* /<其余>` | 透明转发（cookie 由主服务补） |

⚠️ 这个包挂了 2 分钟的 `apicache`，扫码 `check` 每 2 秒问一次会被缓存住。主服务所有转发都带
`x-apicache-bypass: 1` 头穿透它 —— **别去掉**，去掉了登录会永远停在 801。
