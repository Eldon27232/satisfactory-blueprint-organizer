// electron-builder afterPack 钩子：在 win-unpacked 生成后、打 NSIS 之前，
// 用 rcedit 把应用图标写进 exe。这样无需 electron-builder 的 signAndEditExecutable
// （那会触发 winCodeSign 下载，其解压在无符号链接权限的账户上会失败）。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 应用界面是中英双语，只需 Chromium 自带的这两个语言包；其余 50+ 个语言的 .pak 删掉，
// 与应用自身的 i18n（在 asar 里）无关，纯减体积。
const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak']);

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const rcedit = path.resolve('node_modules/rcedit/bin/rcedit-x64.exe');
  const icon = path.resolve('build/icon.ico');
  execFileSync(rcedit, [exe, '--set-icon', icon], { stdio: 'inherit' });
  console.log(`[afterPack] 已将图标写入 ${exe}`);

  // 裁剪 Chromium 多余语言包。
  const localesDir = path.join(context.appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    let removed = 0;
    let freed = 0;
    for (const name of fs.readdirSync(localesDir)) {
      if (name.endsWith('.pak') && !KEEP_LOCALES.has(name)) {
        const target = path.join(localesDir, name);
        freed += fs.statSync(target).size;
        fs.rmSync(target);
        removed += 1;
      }
    }
    console.log(`[afterPack] 已删除 ${removed} 个多余语言包，省 ${(freed / 1048576).toFixed(1)}MB`);
  }
};
