#!/usr/bin/env node
/**
 * release.mjs —— LIZI 一键发版
 *
 *   node release.mjs v1.0.0
 *   npm run release -- v1.0.0
 *
 * 顺序：校验版本 → 打 Windows 安装包 → 同步 Android 资源并出 debug APK
 *       → gh release 上传 → 打开网盘上传页并复制产物路径 → 打印清单。
 * 任何一步失败立即退出，不会带着半成品继续发。
 *
 * 只用 Node 内置模块，不引第三方依赖。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_DIR = process.env.LIZI_ANDROID_DIR || path.resolve(ROOT, '..', 'lizi-android');
const GRADLE_FILE = path.join(ANDROID_DIR, 'app', 'build.gradle');
const DIST = path.join(ROOT, 'dist');

/* 网盘上传页：只是打开网页，不上传、不调 API。 */
const PAN_QUARK_UPLOAD_URL = 'https://pan.quark.cn/list';
const PAN_BAIDU_UPLOAD_URL = 'https://pan.baidu.com/disk/main';

const TOTAL_STEPS = 6;

/* ------------------------------------------------------------------ 工具 -- */

function log(...a) { console.log('[release]', ...a); }
function warn(...a) { console.warn('[release] !', ...a); }

function fail(message) {
  console.error(`\n[release] 失败：${message}\n`);
  process.exit(1);
}

function step(n, title) {
  console.log(`\n${'='.repeat(64)}\n[release] ${n}/${TOTAL_STEPS} ${title}\n${'='.repeat(64)}`);
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) fail(`无法执行 ${command}：${result.error.message}`);
  if (result.status !== 0) fail(`命令退出码 ${result.status}：${command} ${args.join(' ')}`);
  return result;
}

/** Windows 上 .cmd/.bat 必须经过 cmd.exe；其他平台直接跑。 */
function runWindowsBatch(batch, args, options = {}) {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/c', batch, ...args], options);
  }
  return run(batch, args, options);
}

function openUrl(url) {
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.unref();
    return true;
  } catch (err) {
    warn(`打开 ${url} 失败：${err.message}`);
    return false;
  }
}

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      let r = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Set-Clipboard -Value ([Console]::In.ReadToEnd())',
      ], { input: text, encoding: 'utf8' });
      if (r.status === 0) return true;
      r = spawnSync('clip.exe', [], { input: text });
      return r.status === 0;
    }
    if (process.platform === 'darwin') {
      return spawnSync('pbcopy', [], { input: text }).status === 0;
    }
    return spawnSync('xclip', ['-selection', 'clipboard'], { input: text }).status === 0;
  } catch (err) {
    warn(`复制到剪贴板失败：${err.message}`);
    return false;
  }
}

/* -------------------------------------------------------------- 版本解析 -- */

/** "1.0" / "1.0.0" / "v1.0.0" → [1,0,0]；非法返回 null。 */
function parseVersion(input) {
  const s = String(input || '').trim().replace(/^v/i, '');
  const parts = s.split('.');
  if (parts.length < 1 || parts.length > 3) return null;
  const nums = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  while (nums.length < 3) nums.push(0);
  return nums;
}

function versionString(nums) {
  return nums.join('.');
}

/** versionCode 常见的几种编码方式，命中任意一种就算和 versionName 对应。 */
function matchVersionCode(code, [major, minor, patch]) {
  const schemes = [
    [major * 10000 + minor * 100 + patch, 'major*10000+minor*100+patch'],
    [major * 1000000 + minor * 1000 + patch, 'major*1000000+minor*1000+patch'],
    [major * 100 + minor, 'major*100+minor'],
  ];
  /* 1.0.0 这种 x.0.0 允许直接用 major（当前工程就是 versionCode 1）。 */
  if (minor === 0 && patch === 0) schemes.push([major, 'major（x.0.0 简写）']);
  return schemes.find(([value]) => value === code) || null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`读不了 ${file}：${err.message}`);
  }
}

/* ---------------------------------------------------------------- 参数 -- */

function usage() {
  console.log(`用法：node release.mjs <tag>

  <tag>  稳定版：v1.0.0（必须和 package.json 的 version 一致）
         每夜版：limo（固定 tag，反复覆盖同一个 Release）
         金丝雀：cielo-<分支>-<commit>

  可选环境变量：
    LIZI_ANDROID_DIR   Android 工程目录（默认 ../lizi-android）
`);
}

const argv = process.argv.slice(2);
let tag = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tag') {
    tag = argv[++i];
  } else if (a === '-h' || a === '--help') {
    usage();
    process.exit(0);
  } else if (a.startsWith('-')) {
    fail(`未知参数：${a}（用 --help 看用法）`);
  } else {
    tag = a;
  }
}
if (!tag) {
  usage();
  fail('缺少 tag');
}

/* ============================================================== 1. 校验 == */

step(1, '校验版本号');

const pkg = readJson(path.join(ROOT, 'package.json'));
const versionNums = parseVersion(pkg.version);
if (!versionNums) fail(`package.json 的 version 不是 x.y.z：${pkg.version}`);
const version = versionString(versionNums);

/* 稳定版 tag 必须带 v 且和 version 完全一致；limo / cielo-* 是通道 tag。 */
const stableTag = `v${version}`;
const isChannelTag = tag === 'limo' || /^cielo-[A-Za-z0-9._-]+$/.test(tag);
if (!isChannelTag && tag !== stableTag) {
  fail(`tag 和版本不一致：传入 ${tag}，package.json 是 ${pkg.version}，稳定版应打 ${stableTag}`);
}

if (!fs.existsSync(GRADLE_FILE)) fail(`找不到 Android 工程：${GRADLE_FILE}`);
const gradle = fs.readFileSync(GRADLE_FILE, 'utf8');
const versionNameMatch = gradle.match(/versionName\s+['"]([^'"]+)['"]/);
const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!versionNameMatch) fail('app/build.gradle 里没有 versionName');
if (!versionCodeMatch) fail('app/build.gradle 里没有整数 versionCode');

const gradleNums = parseVersion(versionNameMatch[1]);
if (!gradleNums) fail(`app/build.gradle 的 versionName 不是 x.y.z：${versionNameMatch[1]}`);
if (versionString(gradleNums) !== version) {
  fail(`Android versionName 和 package.json 不一致：${versionNameMatch[1]} ≠ ${version}`);
}

const versionCode = Number(versionCodeMatch[1]);
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  fail(`versionCode 必须是正整数，当前是：${versionCodeMatch[1]}`);
}
const codeScheme = matchVersionCode(versionCode, gradleNums);
if (!codeScheme) {
  fail(`versionCode ${versionCode} 和 versionName ${versionNameMatch[1]} 对不上；` +
    '常用写法是 major*10000+minor*100+patch');
}

/* 占位符没换就发版，只会把 app-update.yml 写成错误仓库，提前拦住。 */
const publish = Array.isArray(pkg.build && pkg.build.publish) ? pkg.build.publish[0] : null;
if (!publish || publish.provider !== 'github' || !publish.owner || !publish.repo) {
  fail('package.json 缺少 build.publish（provider: github / owner / repo）');
}
if (/^YOUR_|PLACEHOLDER/i.test(publish.owner) || /PLACEHOLDER/i.test(publish.repo)) {
  fail('build.publish.owner / repo 还是占位符，先把 YOUR_GITHUB_NAME 换成真实 GitHub 用户名');
}
const repoSlug = `${publish.owner}/${publish.repo}`;

log(`版本 ${version}，tag ${tag}，仓库 ${repoSlug}`);
log(`Android versionName ${versionNameMatch[1]}，versionCode ${versionCode}（${codeScheme[1]}）`);
if (isChannelTag) warn(`通道 tag（${tag}）：不要求与 package.json 版本相等，将按预发布发布`);

/* ============================================================ 2. Windows == */

step(2, '打包 Windows 安装包（npm run dist）');

runWindowsBatch('npm', ['run', 'dist'], { cwd: ROOT });

const setupExe = path.join(DIST, `LIZI Setup ${version}.exe`);
const blockmap = `${setupExe}.blockmap`;
const latestYml = path.join(DIST, 'latest.yml');
for (const file of [setupExe, blockmap, latestYml]) {
  if (!fs.existsSync(file)) fail(`打包产物缺失：${file}`);
}
log('Windows 产物：');
log(`  ${setupExe}`);
log(`  ${blockmap}`);
log(`  ${latestYml}`);

/* ============================================================= 3. Android == */

step(3, '同步 Android 资源并打 debug APK');

/* TODO(签名)：现在只出 debug 包。配置好 keystore / signingConfigs 后，
   把 assembleDebug 换成 assembleRelease，并把下面的 apk 目录改成
   app/build/outputs/apk/release，再补上签名校验。 */
const syncScript = path.join(ANDROID_DIR, 'sync.js');
if (!fs.existsSync(syncScript)) fail(`找不到同步脚本：${syncScript}`);
run(process.execPath, [syncScript], { cwd: ANDROID_DIR });

if (process.platform === 'win32') {
  run('cmd.exe', ['/c', 'gradlew.bat', 'assembleDebug'], { cwd: ANDROID_DIR });
} else {
  run('./gradlew', ['assembleDebug'], { cwd: ANDROID_DIR });
}

const apkDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug');
if (!fs.existsSync(apkDir)) fail(`找不到 APK 输出目录：${apkDir}`);
const apkSources = fs.readdirSync(apkDir)
  .filter((name) => name.endsWith('.apk'))
  .map((name) => path.join(apkDir, name))
  .sort();
if (apkSources.length === 0) fail(`APK 输出目录里没有 .apk：${apkDir}`);

const apkCopies = apkSources.map((src) => {
  const base = path.basename(src);
  const arch = /arm64/i.test(base) ? 'arm64-v8a' : (/x86_64|x86-64/i.test(base) ? 'x86_64' : 'universal');
  const dest = path.join(DIST, `LIZI-Android-${version}-${arch}-debug.apk`);
  fs.copyFileSync(src, dest);
  return dest;
});
log('Android 产物：');
for (const file of apkCopies) log(`  ${file}`);

/* ================================================================= 4. gh == */

step(4, `上传 GitHub Release（${tag}）`);

const ghCheck = spawnSync('gh', ['auth', 'status'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
if (ghCheck.error) fail('找不到 gh CLI，先安装 GitHub CLI 并运行 gh auth login');
if (ghCheck.status !== 0) {
  fail(`gh 未登录或不可用。先运行：gh auth login\n${(ghCheck.stderr || '').trim()}`);
}

const artifacts = [setupExe, blockmap, latestYml, ...apkCopies];
const releaseNotes = [
  `LIZI ${version}`,
  '',
  'Windows 安装包（NSIS，含增量 .blockmap）与 Android debug APK。',
  '',
  `- Windows: ${path.basename(setupExe)}`,
  ...apkCopies.map((file) => `- Android: ${path.basename(file)}`),
  '',
  'Android 目前是 debug 包，签名配置完成后换成 release 包。',
].join('\n');
const notesFile = path.join(DIST, '.release-notes.txt');
fs.writeFileSync(notesFile, releaseNotes, 'utf8');

const exists = spawnSync('gh', ['release', 'view', tag, '--repo', repoSlug], {
  cwd: ROOT, stdio: 'ignore',
}).status === 0;

if (exists) {
  log(`Release ${tag} 已存在，覆盖上传资产`);
  run('gh', ['release', 'upload', tag, ...artifacts, '--clobber', '--repo', repoSlug], { cwd: ROOT });
} else {
  const args = [
    'release', 'create', tag, ...artifacts,
    '--repo', repoSlug,
    '--title', isChannelTag ? `LIZI ${version} (${tag})` : `LIZI ${version}`,
    '--notes-file', notesFile,
  ];
  if (isChannelTag) args.push('--prerelease');
  run('gh', args, { cwd: ROOT });
}

const releaseUrl = `https://github.com/${repoSlug}/releases/tag/${encodeURIComponent(tag)}`;
log(`Release：${releaseUrl}`);

/* ============================================================ 5. 网盘辅助 == */

step(5, '打开网盘上传页并复制产物路径');

const openedQuark = openUrl(PAN_QUARK_UPLOAD_URL);
const openedBaidu = openUrl(PAN_BAIDU_UPLOAD_URL);
if (!openedQuark && !openedBaidu) warn('两个网盘页面都没打开，手动访问即可');

/* 剪贴板里只放安装包和 APK（latest.yml / .blockmap 只给 GitHub 用）。 */
const clipboardFiles = [setupExe, ...apkCopies];
const copied = copyToClipboard(clipboardFiles.join('\r\n'));
if (copied) {
  log(`已复制 ${clipboardFiles.length} 个产物路径到剪贴板`);
} else {
  warn('复制剪贴板失败，路径见下面的清单');
}

/* ================================================================ 6. 清单 == */

step(6, '发版清单');

console.log(`
版本号      ${version}
tag         ${tag}
Release     ${releaseUrl}

Windows     ${setupExe}
Blockmap    ${blockmap}
latest.yml  ${latestYml}
Android     ${apkCopies.join('\n            ')}

还需要手动做：
  1. 把上面的 Windows 安装包和 APK 拖进夸克/百度网盘的同一个固定分享目录
     （分享链接写死在 desktop/main.js 顶部，不需要再改）
  2. 到 Release 页确认 latest.yml / .blockmap / .exe / .apk 都在
  3. Android 目前是 debug 包；签名配好后改成 release 包再发
  4. 如果需要，补一段这次版本的更新说明
`);
