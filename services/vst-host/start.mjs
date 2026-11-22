/**
 * LIZI · VST3 宿主启动器
 *
 * 只做四件事：
 *   1) 找 runtime/vst/venv 里的 python（没有就明确报「未安装」并退 1，不静默死）
 *   2) spawn host.py，python 的 stdout/stderr 追加写 services/vst-host/.log
 *   3) host.py 自己写 .port（随机回环端口）；server.mjs 只读文件，不猜端口
 *   4) 进程退出 / 父进程没了：清掉 .port，把 python 一起带走
 *
 * 为什么需要这一层：server.mjs 的边车惯例是 `spawn(node, [services/<name>/start.mjs])`，
 * Python 宿主也接进这套惯例，server 那边就不需要多一种 runtime 分支。
 *
 * 启动：node services/vst-host/start.mjs   （通常由 server.mjs 按需 spawn）
 * 停止：杀掉本进程；host.py 有父进程守护，2 秒内会自己退。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const HOST_PY = path.join(__dirname, 'host.py');
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const VENV_PY = process.env.LIZI_VST_PYTHON
  || path.join(ROOT, 'runtime', 'vst', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python');

/* 日志超过 2MB 换一个：宿主会跟着主服务长期跑，不能无限长 */
try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

function log(...parts) {
  const line = `[vst-start ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* 管道没了不影响服务 */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* 日志写不进去不能拖垮服务 */ }
}
function fail(...parts) {
  const line = `[vst-start ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

function cleanupPort() {
  try { fs.unlinkSync(PORT_FILE); } catch { /* 本来就没有 */ }
}
cleanupPort();   // 上一轮的死端口：主服务靠「文件出现」判断就绪，旧文件会骗它

/* 输出流被关掉时 Node 20 会直接抛 EPIPE（QQ 那边踩过），先挂上错误处理 */
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => {}); } catch { /* ignore */ }
}

/* ---------------- 依赖检查：缺失要说清楚，不要静默失败 ---------------- */
if (!fs.existsSync(HOST_PY)) {
  fail(`宿主脚本不存在：${HOST_PY}`);
  process.exit(1);
}
if (!fs.existsSync(VENV_PY)) {
  fail('VST 宿主未安装：找不到 Python 虚拟环境 ' + VENV_PY);
  fail('修复：在仓库根目录执行');
  fail('  py -3.13 -m venv runtime/vst/venv');
  fail('  runtime/vst/venv/Scripts/python.exe -m pip install -r services/vst-host/requirements.txt');
  fail('（也可以设 LIZI_VST_PYTHON 指向别的 python.exe）');
  process.exit(1);
}

log(`使用 python: ${VENV_PY}`);

/* ---------------- 起 python，输出直接追加到 .log ---------------- */
const fd = fs.openSync(LOG_FILE, 'a');
let child;
try {
  child = spawn(VENV_PY, [HOST_PY], {
    cwd: __dirname,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',                          // 不然 .log 里的就绪行会迟到
      /* Python 3.13 的 venv python.exe 是个 launcher，会再起一个真正的解释器：
         只盯 os.getppid() 会盯到 launcher，我们被强杀时它不会跟着死。
         把自己的 pid 一起传下去，host.py 两个都盯。2026-11-17 */
      LIZI_VST_LAUNCHER_PID: String(process.pid),
    },
  });
} finally {
  fs.closeSync(fd);
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanupPort();
  if (child && child.exitCode === null) {
    try { child.kill(); } catch { /* 已经没了 */ }
  }
  process.exit(code);
}

child.on('error', (e) => {
  fail('python 启动失败：' + e.message);
  shutdown(1);
});
child.on('exit', (code, signal) => {
  if (!shuttingDown) {
    log(`python 退出（code=${code}${signal ? ' signal=' + signal : ''}）`);
    shutdown(code == null ? 1 : code);
  }
});

/* ---------------- 父进程守护 ----------------
   server.mjs 被强杀时（任务管理器 / Electron 退出）不会给我们发信号，
   所以自己每 2 秒问一次父 pid 还在不在。host.py 那边还有一层同样的守护。 */
const parentPid = Number(process.env.VST_PARENT_PID || 0);
if (parentPid > 0) {
  const timer = setInterval(() => {
    let alive = true;
    try {
      process.kill(parentPid, 0);     // signal 0：只探测，不杀
    } catch (e) {
      alive = e.code === 'EPERM';     // 没权限 = 进程还在
    }
    if (!alive) {
      log(`父进程 ${parentPid} 已退出，关闭宿主`);
      clearInterval(timer);
      shutdown(0);
    }
  }, 2000);
  timer.unref?.();
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => shutdown(0));
}
process.on('exit', cleanupPort);
