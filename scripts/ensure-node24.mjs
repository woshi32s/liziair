/* ==========================================================================
   ensure-node24.mjs —— 打包前确保 runtime/node/node.exe 是 Node ≥ 24
   --------------------------------------------------------------------------
   为什么需要：汽水 / 波点边车要 Node ≥ 24，桌面安装包靠 extraResources
   把 runtime/node 打进去（<安装目录>/resources/node/node.exe）。runtime/
   在 .gitignore 里，干净检出 / 换构建机时不会自带这个 90MB 的 node.exe；
   如果直接 electron-builder，包能打出来，但用户点汽水登录才会看到
   「本机 node 版本不足（需 ≥24）」—— 这次就是要把这个坑堵在打包前。

   行为：
     1. 已有 runtime/node/node.exe 且 --version 主版本 ≥ 24 → 直接跳过；
     2. 没有 / 版本太旧 → 从 nodejs.org 下 win-x64/node.exe，先按
        SHASUMS256.txt 校验 SHA256，再原子替换；
     3. 下载 / 校验 / 运行任一失败 → exit 1，让 npm run dist 停下来，
        绝不打出缺 Node 24 的包。

   版本默认钉在 v24.22.3（当前仓库里那份的版本），可用
   LIZI_NODE24_VERSION=v24.x.y 覆盖。只处理 Windows x64。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.LIZI_NODE24_VERSION || 'v24.22.3';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'runtime', 'node');
const EXE = path.join(DIR, process.platform === 'win32' ? 'node.exe' : 'node');
const TMP = EXE + '.download';

function log(msg) { console.log('[node24] ' + msg); }
function fail(msg) {
  console.error('[node24] ' + msg);
  try { fs.rmSync(TMP, { force: true }); } catch { /* 忽略 */ }
  process.exit(1);
}

/** 跑一次 --version，返回 'v24.x.y'；跑不起来返回 '' */
function versionOf(bin) {
  try {
    return execFileSync(bin, ['--version'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

function majorOf(v) {
  return Number(String(v).replace(/^v/, '').split('.')[0]) || 0;
}

/** 带重定向的下载（nodejs.org 会 302 到 CDN） */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多'));
    https.get(url, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, redirects + 1).then(resolve, reject);
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${code} ${url}`));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    log(`当前平台 ${process.platform}/${process.arch} 不需要 Windows 版 node.exe，跳过`);
    return;
  }

  const cur = fs.existsSync(EXE) ? versionOf(EXE) : '';
  if (majorOf(cur) >= 24) {
    log(`已就绪：${EXE}（${cur}）`);
    return;
  }

  fs.mkdirSync(DIR, { recursive: true });
  const base = `https://nodejs.org/dist/${VERSION}`;
  const url = `${base}/win-x64/node.exe`;
  log(`本地${cur ? `是 ${cur}` : '没有 node.exe'}，下载 ${VERSION} …`);

  await download(url, TMP);
  const actual = sha256(TMP);

  /* 校验：SHASUMS256.txt 每行形如 "<sha256>  win-x64/node.exe" */
  log('校验 SHA256 …');
  const sumsTmp = TMP + '.shasums';
  await download(`${base}/SHASUMS256.txt`, sumsTmp);
  const sums = fs.readFileSync(sumsTmp, 'utf8');
  fs.rmSync(sumsTmp, { force: true });
  const line = sums.split(/\r?\n/).find((l) => /\bwin-x64\/node\.exe$/.test(l.trim()));
  if (!line) fail('SHASUMS256.txt 里找不到 win-x64/node.exe，拒绝安装未校验的文件');
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  if (actual !== expected) fail(`SHA256 不匹配：期望 ${expected}，实际 ${actual}`);

  fs.renameSync(TMP, EXE);
  const got = versionOf(EXE);
  if (majorOf(got) < 24) fail(`下载后仍不是 Node ≥24：${got || '跑不起来'}`);
  log(`完成：${EXE}（${got}）`);
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
