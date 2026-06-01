// electron-builder afterPack 钩子：在 win-unpacked 生成后、打 NSIS 之前，
// 用 rcedit 把应用图标写进 exe。这样无需 electron-builder 的 signAndEditExecutable
// （那会触发 winCodeSign 下载，其解压在无符号链接权限的账户上会失败）。
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const rcedit = path.resolve('node_modules/rcedit/bin/rcedit-x64.exe');
  const icon = path.resolve('build/icon.ico');
  execFileSync(rcedit, [exe, '--set-icon', icon], { stdio: 'inherit' });
  console.log(`[afterPack] 已将图标写入 ${exe}`);
};
