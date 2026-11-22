#!/usr/bin/env node
/* ==========================================================================
   LIZI 形态批量验收（2026-11-17）
   --------------------------------------------------------------------------
   用法：
     node tools/check-stages.mjs public/dev/inbox
     node tools/check-stages.mjs public/dev/inbox --shots public/dev/reports/shots
     node tools/check-stages.mjs <目录> --base http://127.0.0.1:14674

   做什么：
   1) 起一个 headless Chrome（CDP，原生 WebSocket，不引依赖）；
   2) 逐个打开 /dev/stage-lab.html?stage=<同源URL>&auto=1&badge=1；
   3) 等页面挂出 window.__labReport（检测页跑 7 秒后写入）；
   4) 汇总成 <目录>/../reports/stages-<时间>.md（表格 + 每个失败项的详情）；
   5) --shots <目录> 时给每个形态截一张运行截图（iframe 挂上后约 0.8 秒，接近首帧）。

   约定：
   - 目录里的 *.html / *.htm 就是待检形态，最多 50 个；
   - 播放器（server.mjs）要先跑起来；脚本从仓库根目录的 .port 读端口，
     或用 LIZI_BASE / --base 指定；
   - 目录不在 public/ 下时，会临时复制到 public/dev/.check-<时间>/ 再检测；
   - 退出码：0 = 全部 pass / warn；1 = 有 fail；2 = 环境 / 参数问题。
   ========================================================================== */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RUN_MS = 7000;
const PER_FILE_TIMEOUT = 35000;
const MAX_FILES = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-'
    + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function parseArgs(argv) {
  const out = { dir: '', shots: '', base: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shots') out.shots = argv[++i] || '';
    else if (a === '--base') out.base = argv[++i] || '';
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.dir = a;
  }
  return out;
}

function usage() {
  console.log('用法: node tools/check-stages.mjs <目录> [--shots <截图目录>] [--base <URL>]');
  console.log('目录约定: public/dev/inbox（用户把 AI 产出的 .html 丢进去）');
  console.log('报告写到: <目录>/../reports/stages-<时间>.md');
}

function readPort() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

function findChrome() {
  const candidates = [
    process.env.LIZI_CHROME,
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* 忽略 */ }
  }
  return '';
}

function normalizeReport(rep, file) {
  const r = rep && typeof rep === 'object' ? rep : {};
  const errs = Array.isArray(r.errors) ? r.errors.map((e) => ({
    message: String((e && e.message) || e || ''),
    stack: String((e && e.stack) || ''),
  })) : [];
  const csp = Array.isArray(r.cspViolations) ? r.cspViolations.map((e) => ({
    directive: String((e && e.directive) || ''),
    blockedURI: String((e && e.blockedURI) || ''),
  })) : [];
  const verdictRaw = String(r.verdict || '');
  return {
    file: String(r.file || file || ''),
    bytes: Number(r.bytes) || 0,
    ready: !!r.ready,
    readyMs: (r.readyMs == null ? null : Number(r.readyMs)),
    errors: errs,
    cspViolations: csp,
    messages: (r.messages && typeof r.messages === 'object') ? r.messages : {},
    fps: Number(r.fps) || 0,
    verdict: ['pass', 'warn', 'fail'].includes(verdictRaw) ? verdictRaw : 'fail',
    note: String(r.note || ''),
  };
}

/* ------------------------------------------------------------------ CDP */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  });
  ws.addEventListener('close', () => {
    pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('CDP 连接已关闭')); });
    pending.clear();
  });
  return {
    ws,
    opened,
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(mid);
          reject(new Error('CDP 超时: ' + method));
        }, 20000);
        pending.set(mid, { resolve, reject, timer });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); reject(e); }
      });
    },
    close() { try { ws.close(); } catch { /* 忽略 */ } },
  };
}

async function waitForPort(profileDir, child, stderrRef) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
      const port = Number(raw[0]);
      if (port > 0) return port;
    } catch { /* 还没写 */ }
    if (child.exitCode != null) {
      throw new Error('Chrome 提前退出：' + stderrRef.text().split('\n').slice(-4).join(' '));
    }
    await sleep(200);
  }
  throw new Error('等不到 Chrome 的 DevToolsActivePort');
}

async function pickPageTarget(port) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 端口刚起，等一会 */ }
    await sleep(200);
  }
  throw new Error('找不到可用的 Chrome page target');
}

/* 等检测台把 stage iframe 挂出来；截图要比等 7 秒报告早得多，
   否则截到的是演出了 7 秒之后的画面，不是首帧。 */
async function waitForStageFrame(client, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await client.send('Runtime.evaluate', {
        expression: "!!document.querySelector('.lab__viewport iframe')",
        returnByValue: true,
      });
      if (r && r.result && r.result.value) return true;
    } catch { /* 导航中拿不到上下文 */ }
    await sleep(120);
  }
  return false;
}

/* --------------------------------------------------------------- staging */
async function stageIfNeeded(dir) {
  let rel = path.relative(PUBLIC_DIR, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { serveRel: rel.split(path.sep).join('/'), staged: '' };
  }
  const tag = '.check-' + process.pid + '-' + Date.now();
  const stagedDir = path.join(PUBLIC_DIR, 'dev', tag);
  await fsp.mkdir(stagedDir, { recursive: true });
  const names = (await fsp.readdir(dir)).filter((n) => /\.html?$/i.test(n));
  for (const n of names) await fsp.copyFile(path.join(dir, n), path.join(stagedDir, n));
  return { serveRel: 'dev/' + tag, staged: stagedDir };
}

/* ---------------------------------------------------------------- report */
function cell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300);
}

function verdictLabel(v) {
  return v === 'pass' ? '通过' : v === 'warn' ? '有警告' : '失败';
}

function buildMarkdown(results, dir) {
  const pass = results.filter((r) => r.verdict === 'pass').length;
  const warn = results.filter((r) => r.verdict === 'warn').length;
  const fail = results.filter((r) => r.verdict === 'fail').length;
  const out = [];
  out.push('# LIZI 形态批量检测报告');
  out.push('');
  out.push('- 生成时间：' + new Date().toLocaleString());
  out.push('- 检测目录：`' + dir + '`');
  out.push('- 总数：' + results.length + '；通过 ' + pass + '；有警告 ' + warn + '；失败 ' + fail);
  out.push('');
  out.push('| 文件 | 大小 | ready | ready 用时 | 错误（第一条） | CSP | FPS | 结论 |');
  out.push('|---|---|---|---|---|---|---|---|');
  results.forEach((r) => {
    out.push('| ' + cell(r.file) + ' | ' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB | '
      + (r.ready ? '✓' : '✗') + ' | ' + (r.ready ? r.readyMs + ' ms' : '—') + ' | '
      + cell(r.errors.length ? r.errors[0].message : '—') + ' | ' + r.cspViolations.length + ' | '
      + (r.fps || '—') + ' | ' + verdictLabel(r.verdict) + ' |');
  });
  const bad = results.filter((r) => r.verdict === 'fail');
  if (bad.length) {
    out.push('');
    out.push('## 失败详情');
    bad.forEach((r) => {
      out.push('');
      out.push('### ' + r.file + ' — 失败');
      out.push('');
      out.push('- ready：' + (r.ready ? '是（' + r.readyMs + ' ms）' : '否'));
      out.push('- 大小：' + (r.bytes / 1024).toFixed(1) + ' KB；FPS：' + (r.fps || 0));
      out.push('- 说明：' + (r.note || '—'));
      if (r.errors.length) {
        out.push('- 错误：');
        r.errors.slice(0, 5).forEach((e) => {
          out.push('  - ' + cell(e.message));
          if (e.stack) out.push('    ```\n    ' + String(e.stack).split('\n').slice(0, 6).join('\n    ') + '\n    ```');
        });
      }
      if (r.cspViolations.length) {
        out.push('- CSP 违规：');
        r.cspViolations.slice(0, 5).forEach((e) => {
          out.push('  - ' + cell(e.directive) + ' → ' + cell(e.blockedURI));
        });
      }
    });
  }
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------ main */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  if (typeof WebSocket === 'undefined') {
    console.error('需要 Node 22+（内置 WebSocket）。当前版本：' + process.version);
    process.exit(2);
  }

  const dir = path.resolve(args.dir || path.join(PUBLIC_DIR, 'dev', 'inbox'));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('目录不存在：' + dir);
    usage();
    process.exit(2);
  }
  let files = (await fsp.readdir(dir)).filter((n) => /\.html?$/i.test(n)).sort();
  if (!files.length) {
    console.error('目录里没有 .html / .htm：' + dir);
    process.exit(2);
  }
  if (files.length > MAX_FILES) {
    console.warn('文件超过 ' + MAX_FILES + ' 个，只检测前 ' + MAX_FILES + ' 个');
    files = files.slice(0, MAX_FILES);
  }

  let base = (args.base || process.env.LIZI_BASE || '').replace(/\/+$/, '');
  if (!base) {
    const port = readPort();
    if (!port) {
      console.error('读不到 .port。先启动播放器（start.cmd / node server.mjs），或用 --base 指定');
      process.exit(2);
    }
    base = 'http://127.0.0.1:' + port;
  }
  try {
    const probe = await fetch(base + '/dev/stage-lab.html', { method: 'GET' });
    if (!probe.ok) throw new Error('HTTP ' + probe.status);
  } catch (e) {
    console.error('连不上 ' + base + '：' + (e && e.message));
    console.error('先启动播放器，或检查 --base / LIZI_BASE');
    process.exit(2);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('找不到 Chrome / Edge。用 LIZI_CHROME 或 CHROME_PATH 指定可执行文件');
    process.exit(2);
  }

  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lizi-stage-check-'));
  const staged = await stageIfNeeded(dir);
  const stdoutRef = { text: '' };
  const stderrRef = { text: () => stdoutRef.text };
  const child = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1280,800',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (buf) => { stdoutRef.text += buf.toString(); });

  let client = null;
  let results = [];
  try {
    const port = await waitForPort(profileDir, child, { text: () => stdoutRef.text });
    const wsUrl = await pickPageTarget(port);
    client = connect(wsUrl);
    await client.opened;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });

    if (args.shots) {
      await fsp.mkdir(path.resolve(args.shots), { recursive: true });
    }

    for (let i = 0; i < files.length; i++) {
      const name = files[i];
      const stageUrl = '/' + staged.serveRel + (staged.serveRel ? '/' : '') + name;
      const qs = new URLSearchParams({ stage: stageUrl, auto: '1', badge: '1' });
      const url = base + '/dev/stage-lab.html?' + qs.toString();
      process.stdout.write('[' + (i + 1) + '/' + files.length + '] ' + name + ' … ');
      let rep = null;
      try {
        await client.send('Page.navigate', { url });
        if (args.shots) {
          const mounted = await waitForStageFrame(client);
          if (mounted) await sleep(800);
          try {
            const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            const shotName = name.replace(/\.html?$/i, '') + '.png';
            await fsp.writeFile(path.join(path.resolve(args.shots), shotName), Buffer.from(shot.data, 'base64'));
          } catch (e) {
            console.warn('  截图失败：' + (e && e.message));
          }
        }
        const t0 = Date.now();
        while (Date.now() - t0 < PER_FILE_TIMEOUT) {
          await sleep(300);
          try {
            const r = await client.send('Runtime.evaluate', {
              expression: 'window.__labReport || null',
              returnByValue: true,
              awaitPromise: false,
            });
            if (r && r.result && r.result.value) { rep = r.result.value; break; }
          } catch { /* 导航中拿不到上下文，继续等 */ }
        }
      } catch (e) {
        rep = {
          file: name, bytes: 0, ready: false, readyMs: null,
          errors: [{ message: '检测页导航失败：' + (e && e.message), stack: '' }],
          cspViolations: [], messages: {}, fps: 0, verdict: 'fail',
          note: '导航失败',
        };
      }
      if (!rep) {
        rep = {
          file: name, bytes: 0, ready: false, readyMs: null,
          errors: [{ message: '检测页超时：' + Math.round(PER_FILE_TIMEOUT / 1000) + ' 秒内没有产出 __labReport', stack: '' }],
          cspViolations: [], messages: {}, fps: 0, verdict: 'fail',
          note: '超时',
        };
      }
      const norm = normalizeReport(rep, name);
      results.push(norm);
      console.log(norm.verdict + (norm.ready ? ' (ready ' + norm.readyMs + 'ms)' : ' (no ready)')
        + (norm.errors.length ? ' · ' + norm.errors[0].message.slice(0, 80) : ''));

    }
  } finally {
    try { if (client) client.close(); } catch { /* 忽略 */ }
    try { child.kill(); } catch { /* 忽略 */ }
    await sleep(800);
    try { await fsp.rm(profileDir, { recursive: true, force: true }); } catch { /* 被锁就留着 */ }
    if (staged.staged) {
      try { await fsp.rm(staged.staged, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
  }

  if (!results.length) {
    console.error('没有产出任何结果');
    process.exit(2);
  }

  const reportDir = path.resolve(dir, '..', 'reports');
  await fsp.mkdir(reportDir, { recursive: true });
  const mdPath = path.join(reportDir, 'stages-' + stamp() + '.md');
  await fsp.writeFile(mdPath, buildMarkdown(results, dir) + '\n', 'utf8');

  const fail = results.filter((r) => r.verdict === 'fail').length;
  const warn = results.filter((r) => r.verdict === 'warn').length;
  console.log('\n报告：' + mdPath);
  console.log('结果：' + results.length + ' 个，警告 ' + warn + '，失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error('检测失败：' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
