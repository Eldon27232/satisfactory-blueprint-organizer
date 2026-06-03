import { registerBackupIpc } from './backup';
import { registerBlueprintImportIpc } from './blueprintImport';
import { registerDiagnosticsIpc } from './diagnostics';
import { registerDialogIpc } from './dialog';
import { registerDraftIpc } from './draft';
import { registerSaveIpc } from './saves';
import { registerShellIpc } from './shell';
import { registerWindowIpc } from './window';

// 把各领域的 IPC 注册聚合到一处。新增 channel 时加进对应领域文件并在 ipcChannels.ts 登记 channel 名，
// 不要再回到单一巨型注册表。
export function registerIpc(): void {
  registerDialogIpc();
  registerWindowIpc();
  registerShellIpc();
  registerSaveIpc();
  registerDraftIpc();
  registerBackupIpc();
  registerBlueprintImportIpc();
  registerDiagnosticsIpc();
}
