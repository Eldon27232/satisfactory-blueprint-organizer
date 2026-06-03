import { ipcMain } from 'electron';
import { deleteBackup, listBackups } from '../../core/backup';
import { rollbackFromBackup } from '../../core/rollback';
import { IPC } from '../../shared/ipcChannels';

// 备份列表 / 回滚 / 删除。回滚与删除的路径边界校验在 core 层（rollback.ts / backup.ts）。
export function registerBackupIpc(): void {
  ipcMain.handle(IPC.backup.list, async () => listBackups());
  ipcMain.handle(IPC.backup.rollback, async (_event, backupDir: string) => rollbackFromBackup(backupDir));
  ipcMain.handle(IPC.backup.delete, async (_event, backupDir: string) => deleteBackup(backupDir));
}
