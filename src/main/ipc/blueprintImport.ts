import { ipcMain } from 'electron';
import { importDroppedBlueprintFiles } from '../../core/droppedBlueprints';
import { importZipBlueprints } from '../../core/zipImport';
import { IPC } from '../../shared/ipcChannels';

// 蓝图导入：拖入的散文件、压缩包。导入即复制到暂存区，草稿引用暂存副本（apply 前不碰存档夹）。
export function registerBlueprintImportIpc(): void {
  ipcMain.handle(IPC.blueprints.importDropped, async (_event, paths: string[]) => importDroppedBlueprintFiles(paths));
  ipcMain.handle(IPC.blueprints.importZip, async (_event, zipPaths: string[]) => importZipBlueprints(zipPaths));
}
