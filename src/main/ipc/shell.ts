import { ipcMain, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { isWithinRoot } from '../../core/fsUtils';
import { IPC } from '../../shared/ipcChannels';
import { resolveDataRoot } from '../paths';

export function registerShellIpc(): void {
  ipcMain.handle(IPC.shell.openExternal, (_event, url: string) => shell.openExternal(url));

  // 打开应用数据目录内的路径（Backups / Reports 等）。这是红线之外唯一「非 apply 点击触发写盘」的
  // 例外：目录类路径（无扩展名）若尚未创建则先建好，避免「找不到文件」。收紧到 dataRoot 内并拒绝
  // 越界路径，防止误把存档夹等外部路径传进来而被创建/打开。
  ipcMain.handle(IPC.shell.openPath, async (_event, targetPath: string) => {
    const dataRoot = resolveDataRoot();
    const resolved = path.resolve(dataRoot, targetPath);
    if (!isWithinRoot(dataRoot, resolved)) {
      throw new Error(`拒绝打开：不是数据目录内的路径：${targetPath}`);
    }
    if (!existsSync(resolved) && !path.extname(resolved)) {
      await fs.mkdir(resolved, { recursive: true });
    }
    return shell.openPath(resolved);
  });
}
