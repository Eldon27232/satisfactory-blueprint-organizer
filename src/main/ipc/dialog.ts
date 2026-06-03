import { app, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC } from '../../shared/ipcChannels';

type DialogCacheKey = 'gameBlueprintDir' | 'mappingDir' | 'saveFile';

// 选择目录 / 文件 / 压缩包的系统对话框，并按用途记住上次选择的起始目录。
export function registerDialogIpc(): void {
  ipcMain.handle(IPC.dialog.directory, async (_event, cacheKey?: DialogCacheKey) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: await readDialogDefaultPath(cacheKey)
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    await writeDialogDefaultPath(cacheKey, selected);
    return selected;
  });

  ipcMain.handle(IPC.dialog.file, async (_event, filters?: Electron.FileFilter[], cacheKey?: DialogCacheKey) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
      defaultPath: await readDialogDefaultPath(cacheKey)
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    await writeDialogDefaultPath(cacheKey, path.dirname(selected));
    return selected;
  });

  ipcMain.handle(IPC.dialog.zipFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
}

async function readDialogDefaultPath(cacheKey?: DialogCacheKey): Promise<string | undefined> {
  if (!cacheKey) return undefined;
  const cache = await readDialogCache();
  return cache[cacheKey];
}

async function writeDialogDefaultPath(cacheKey: DialogCacheKey | undefined, value: string): Promise<void> {
  if (!cacheKey) return;
  const cache = await readDialogCache();
  cache[cacheKey] = value;
  await fs.mkdir(path.dirname(dialogCachePath()), { recursive: true });
  await fs.writeFile(dialogCachePath(), JSON.stringify(cache, null, 2), 'utf8');
}

async function readDialogCache(): Promise<Partial<Record<DialogCacheKey, string>>> {
  try {
    return JSON.parse(await fs.readFile(dialogCachePath(), 'utf8')) as Partial<Record<DialogCacheKey, string>>;
  } catch {
    return {};
  }
}

function dialogCachePath(): string {
  return path.join(app.getPath('userData'), 'dialog-paths.json');
}
