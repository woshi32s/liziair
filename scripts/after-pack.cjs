/* ==========================================================================
   after-pack.cjs —— electron-builder 打完包后硬校验 Node 24 真的在包里
   --------------------------------------------------------------------------
   predist 只保证源目录 runtime/node/node.exe 存在；这一步检查**打包产物**
   （win-unpacked/resources/node/node.exe）。缺失或主版本 <24 就直接让构建
   失败，避免用户装完点汽水 / 波点才看到「本机 node 版本不足（需 ≥24）」。
   ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, 'resources', 'node', 'node.exe');
  if (!fs.existsSync(exe)) {
    throw new Error(`[node24] 打包产物缺少 ${exe}；检查 package.json 的 extraResources 是否还包含 runtime/node`);
  }
  let version = '';
  try {
    version = execFileSync(exe, ['--version'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    }).trim();
  } catch (e) {
    throw new Error(`[node24] 打包产物里的 node.exe 跑不起来：${e.message}`);
  }
  const major = Number(String(version).replace(/^v/, '').split('.')[0]) || 0;
  if (major < 24) {
    throw new Error(`[node24] 打包产物里的 node.exe 是 ${version}，要求 ≥24`);
  }
  console.log(`[node24] 打包产物已内置 ${version}`);
};
