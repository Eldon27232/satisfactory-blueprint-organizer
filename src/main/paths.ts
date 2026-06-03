import { app } from 'electron';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// 决定数据根目录（Backups / Reports / diagnostics / 存档旁文件以外的应用数据都落在这里）。
// 优先放在安装目录（exe 同级），符合「放在安装后的文件夹里」；若该目录只读（例如装在
// Program Files），回退到用户数据目录，保证可写。开发模式下集中到项目内 .data-dev/。
export function resolveDataRoot(): string {
  if (!app.isPackaged) {
    // dev：把运行态产物（Backups/Reports/diagnostics/暂存/脏标记）集中到项目内 .data-dev/，
    // 不再散落项目根，降低开发时的视觉噪声。打包后行为完全不变。
    const devRoot = path.join(process.cwd(), '.data-dev');
    mkdirSync(devRoot, { recursive: true });
    return devRoot;
  }
  const exeDir = path.dirname(app.getPath('exe'));
  if (isWritable(exeDir)) return exeDir;
  return app.getPath('userData');
}

function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
