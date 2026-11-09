/**
 * LIZI · 网易云音乐边车启动器
 *
 * 为什么不再手写加密：我们手写的 weapi/eapi 扫码，手机确认后上游稳定回
 *   8821「请切换其他登录方式或升级新版本再试」，cookie 里永远只有 NMTID。
 * 换个思路：直接跑社区维护的那套 API 服务（Folia 用的同一个包），把登录交给它。
 *
 * 包 `@neteasecloudmusicapienhanced/api@4.41.1` 是一个完整的 express 服务，
 * 由 server.js 里的 serveNcmApi() 自己 app.listen()。所以这里做的是
 * 「进它之前把环境摆好，出来之后接管句柄」，和 services/qq-api / services/kugou-api 同一套做法。
 *
 * 这个文件做五件事：
 *   1. 端口：NETEASE_API_PORT > 上次的 .port > 3215（避开 QQ 3210 / 酷狗 3211 / 汽水 3212 / 波点 3213 / Spotify 3214）
 *   2. 只绑 127.0.0.1：显式传 host，再给 net.Server.prototype.listen 打一次性补丁（第二道保险）
 *   3. **IP 补丁**：不让它把 127.0.0.1 当客户端 IP 发出去（等价于 Folia 的 patch-music-api-client-ip.mjs）
 *      —— 包里 server.js 的原逻辑是：
 *           if (options.randomCNIP) ip = global.cnIp; else ip = req.ip;
 *      req.ip 在这个进程里就是 127.0.0.1，于是 X-Real-IP/X-Forwarded-For 会带一个私网地址上去。
 *      这里两条一起做：
 *        a) 环境变量 ENABLE_RANDOM_CN_IP=true（包里的 util/option.js 认这个默认值）
 *        b) 在 require 主包**之前**把 util/option.js 的导出换成强制 randomCNIP=true 的包装，
 *           连调用方显式写 randomCNIP=false 也不放行；global.cnIp 由我们自己种一个随机中国 IP
 *   4. 登录态：**不落盘**。MUSIC_U 由主服务 server.mjs 自己保管（.session.json），
 *      每次请求把 cookie 串通过 query 传进来（这个包认 `?cookie=a=b; c=d`）
 *   5. 起不来时把原因打到控制台和 .log，不静默死
 *
 * 启动：node services/netease-api/start.mjs        （通常由 server.mjs 按需 spawn）
 * 停止：关掉这个进程即可（Ctrl+C / taskkill），没有别的状态
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const PKG = '@neteasecloudmusicapienhanced/api';

/* 日志超过 2MB 就换一个（边车会跟着主服务长期跑，不能无限长） */
try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

/* ---------------- 日志：控制台 + 文件（server.mjs 把子进程输出也指到这里） ---------------- */
/* Node 20 的 console 在 stdout 管被关掉时会**直接抛 EPIPE**（Node 24 才吞掉）。
   实测：用管道起边车、父进程一收工，一条日志就把整个服务打死。 */
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* 输出管道断了不影响服务 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[netease-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[netease-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ---------------- 端口：和主服务同一套规矩 ---------------- */
function preferredPort() {
  if (process.env.NETEASE_API_PORT) return Number(process.env.NETEASE_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    // 读完删掉：server.mjs 靠「文件出现」判断子进程是否就绪
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3215;
}

/* ---------------- 强制回环绑定 ----------------
   包的 server.js 是 app.listen(port, host, cb)，host 来自 options.host / HOST 环境变量，
   两者都没有时是 ''（= 0.0.0.0）。我们显式传 host；这个补丁是第二道保险。 */
const originalListen = net.Server.prototype.listen;
let patched = false;
net.Server.prototype.listen = function liziListen(...args) {
  if (!patched) {
    patched = true;
    const portOnly =
      (typeof args[0] === 'number') ||
      (typeof args[0] === 'string' && /^\d+$/.test(args[0]));
    if (portOnly && (args.length === 1 || typeof args[1] === 'function')) {
      args = [Number(args[0]), '127.0.0.1', ...args.slice(1)];
    }
  }
  return originalListen.apply(this, args);
};

/* ---------------- 环境：包在 require / 请求期就会读这些 ---------------- */
const wantPort = preferredPort();
process.env.PORT = String(wantPort);
process.env.HOST = '127.0.0.1';
/* a) 让包里默认走随机中国 IP（见 util/option.js 的 randomCNIP 表达式） */
process.env.ENABLE_RANDOM_CN_IP = 'true';

const require = createRequire(import.meta.url);

/* 包的 util/request.js 在**模块加载时**就读 os.tmpdir()/anonymous_token，
   文件不存在会直接 ENOENT 崩掉（app.js 也会先建一个空文件）。 */
try {
  const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');
} catch (e) { log('匿名 token 占位文件写不进去（不致命）：', e && e.message); }

/* ---------------- IP 补丁（关键） ----------------
   server.js 里那段是：
     if (options.randomCNIP) { ip = global.cnIp } else { ip = req.ip; … }
   所以只要让每个请求的 options.randomCNIP 都是 true，就永远不会把 127.0.0.1 发出去。
   Folia 的补丁是在源码里加一个 FOLIA_FORWARD_CLIENT_IP 开关；这里用等价但不动源码的做法：
   在 require 主包之前替换 util/option.js 的模块导出 —— 各 module/*.js 是在 require 期
   才把这个函数拿走的，替换发生在它们加载之前，所以每个请求都会走到我们的包装。

   ⚠️ 10-31 改：**优先上报这台机器的真实公网 IP**，拿不到才退回随机。
   原因：补丁原本每启动一次就随机一个中国 IP（10-30 是 183.188.x.x，10-31 变成 106.61.x.x），
   而这台机器真实出口是 116.147.250.227（南京联通）。同一账号在几分钟内从不同城市 IP
   反复登录 = 网易云风控眼里最典型的「操作异常」，会直接回「本次操作异常已经拦截」。
   补丁要解决的只是「别把 127.0.0.1 发出去」，用真实公网 IP 一样满足，而且没有矛盾点。
   可用 NETEASE_CN_IP=1.2.3.4 手动指定。 */
async function detectPublicIP() {
  const probes = [
    'https://myip.ipip.net',
    'https://api.ipify.org?format=json',
    'https://ifconfig.me/ip',
  ];
  for (const u of probes) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(3500), headers: { 'User-Agent': 'curl/8.0' } });
      const t = (await r.text()).trim();
      const m = t.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (!m) continue;
      const ip = m[1];
      const a = Number(ip.split('.')[0]);
      if (!a || a === 10 || a === 127 || ip.startsWith('192.168.')) continue;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) continue;
      return ip;
    } catch { /* 换下一个探测点 */ }
  }
  return '';
}

/* 10-31 改：不再冒充 X-Real-IP / X-Forwarded-For。
   包里 request.js 是这么写的：`const ip = options.realIP || options.ip || ''; if (ip) { headers['X-Real-IP']=ip; headers['X-Forwarded-For']=ip }`
   —— 也就是说，只要 cnIp 是空字符串，这两个头**一个都不会发**，网易云就按真实 TCP 源地址算。
   为什么要这样：真机客户端绝不会带 X-Forwarded-For。我们一边自称 iPhone 版网易云（包内 eapi 分支固定这个 UA），
   一边又递上自报 IP，等于自己承认是伪造客户端 —— 取码能拿到 unikey（200），但手机扫码确认时被风控拦掉。
   仍然保留 randomCNIP 的强制：那个分支只是决定「用哪个 IP 填 options.ip」，填空就不会写头。
   想恢复旧行为：设 NETEASE_CN_IP=1.2.3.4（会重新带上这两个头）。 */
let cnIp = String(process.env.NETEASE_CN_IP || '').trim();
let ipSource = cnIp ? 'env' : 'off';
try {
  if (!cnIp) {
    global.cnIp = '';
    log('IP 头已关闭：global.cnIp = ""（不再发送 X-Real-IP / X-Forwarded-For，网易云按真实 TCP 源地址判定）');
  } else {
    global.cnIp = cnIp;
    log(`IP 头开启：global.cnIp = ${cnIp}（来源 ${ipSource}）`);
  }

  const optionPath = require.resolve(`${PKG}/util/option`);
  const originalOption = require(optionPath);
  require.cache[optionPath].exports = function liziOption(query, crypto, checkToken) {
    const opts = originalOption(query, crypto, checkToken);
    opts.randomCNIP = true;     // 调用方写 randomCNIP=false 也不放行
    return opts;
  };
} catch (e) {
  fail('IP 补丁没打上:', (e && e.stack) || e);
  process.exit(1);
}

/* ---------------- 起服务 ---------------- */
let serveNcmApi;
try {
  ({ serveNcmApi } = require(PKG));
} catch (e) {
  fail(`加载 ${PKG} 失败:`, (e && e.stack) || e);
  fail('依赖装了吗？在 services/netease-api 里跑 npm install');
  process.exit(1);
}
if (typeof serveNcmApi !== 'function') {
  fail(`包里没有导出 serveNcmApi（版本不匹配？本启动器按 4.41.1 写的）`);
  process.exit(1);
}

let retried = false;
let readyDone = false;

function ready(server) {
  if (readyDone) return;
  readyDone = true;
  const addr = server && server.address ? server.address() : null;
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  const host = addr && typeof addr === 'object' ? addr.address : '127.0.0.1';
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://${host}:${port}  （只绑回环；上报 IP = ${cnIp}（${ipSource}），客户端私网 IP 不外发）`);
  // 给父进程（server.mjs）一个明确的、可抓的信号
  console.log(`NETEASE_API_READY ${port}`);
}

function wire(server) {
  server.on('error', (e) => {
    const code = e && e.code;
    if ((code === 'EADDRINUSE' || code === 'EACCES') && !retried) {
      retried = true;
      log(`端口 ${wantPort} 不可用（${code}，Windows 保留段/被占用），改用系统分配…`);
      try { server.close(); } catch { /* 可能根本没开 */ }
      setTimeout(() => {
        try { server.listen(0, '127.0.0.1', () => ready(server)); }
        catch (err) { fail('重试监听失败:', err && err.message); process.exit(1); }
      }, 80);
      return;
    }
    fail(`监听失败（${code || 'unknown'}）: ${e && e.message}`);
    fail('排查：netsh int ipv4 show excludedportrange protocol=tcp  看端口是否在保留段；或换 NETEASE_API_PORT');
    process.exit(1);
  });
  if (server.listening) ready(server);
  else server.once('listening', () => ready(server));
}

try {
  /* checkVersion:false —— 不要让它去 spawn `npm info`（慢，而且离线会卡） */
  const app = await serveNcmApi({ port: wantPort, host: '127.0.0.1', checkVersion: false });
  if (!app || !app.server) {
    fail('serveNcmApi() 没返回底层 http server（版本不匹配？）');
    process.exit(1);
  }
  /* ⚠️ 必须在 serveNcmApi 之后清一次：包里的 generateConfig() 会在启动时
     `global.cnIp = generateRandomChineseIP()`，把我们前面设的空值覆盖掉。
     清成空字符串 = request.js 不会再写 X-Real-IP / X-Forwarded-For。 */
  if (!String(process.env.NETEASE_CN_IP || '').trim()) {
    global.cnIp = '';
    log('启动后复核：global.cnIp 已清空（generateConfig 曾把它改回随机 IP）');
  }
  /* 主服务要一个「本地、不碰网易云」的活跃探针。
     顺带把 IP 补丁的状态说清楚（只报模式，不报具体 IP）：
     randomCNIP = 每个请求都带一个随机中国 IP，客户端真实/私网 IP 一律不外发。 */
  app.get('/lizi/health', (req, res) => res.json({
    code: 200,
    ok: true,
    node: process.versions.node,
    ipMode: 'randomCNIP',
    cnIpSeeded: !!global.cnIp,
  }));
  wire(app.server);
} catch (e) {
  fail('启动失败:', (e && e.stack) || e);
  process.exit(1);
}

process.on('uncaughtException', (e) => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未捕获异常:', (e && e.stack) || e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未处理的 Promise 拒绝:', (e && e.stack) || e);
  process.exit(1);
});

/* 父进程（server.mjs）掉了就把自己也收掉，别留孤儿进程占端口。 */
const parentPid = Number(process.env.NETEASE_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
}
