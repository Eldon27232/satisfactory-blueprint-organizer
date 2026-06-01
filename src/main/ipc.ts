import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { deleteBackup, listBackups } from '../core/backup';
import { scanBlueprintStructure } from '../core/blueprintCategoryDiscovery';
import { buildDraftFromExternalMapping, buildDraftFromSave } from '../core/buildDraft';
import { executeDraftImport, planDraftApply } from '../core/applyDraft';
import { autoLocateSaveGames, listAccountDirsInRoot, listSaveGameLocations, listSavesInAccountDir, locateSaveCandidatesInAccountDir, resolveBlueprintDirForSave } from '../core/locateSaves';
import { resolveSteamPersonaName } from '../core/steam';
import { dumpSaveToDiagnostics } from '../core/parseSave';
import { rollbackFromBackup } from '../core/rollback';
import { diffBlueprintCategorySaves } from '../core/saveDiff';
import { createDryRun, executeImport, repairPlayerStates } from '../core/workflow';
import type { DraftApplyOptions, DraftTree } from '../shared/draftModel';
import type { ExecuteOptions } from '../shared/types';

type DialogCacheKey = 'gameBlueprintDir' | 'mappingDir' | 'saveFile';

export function registerIpc(): void {
  ipcMain.handle('dialog:directory', async (_event, cacheKey?: DialogCacheKey) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: await readDialogDefaultPath(cacheKey)
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    await writeDialogDefaultPath(cacheKey, selected);
    return selected;
  });

  ipcMain.handle('dialog:file', async (_event, filters?: Electron.FileFilter[], cacheKey?: DialogCacheKey) => {
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

  ipcMain.handle('workflow:dryRun', async (_event, gameBlueprintDir: string, mappingDir: string, selectedSavePath?: string | null, selectedAccountDir?: string | null, recursiveSaveScan?: boolean) => {
    return createDryRun(gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, Boolean(recursiveSaveScan));
  });

  ipcMain.handle('workflow:execute', async (_event, options: ExecuteOptions) => {
    return executeImport(options);
  });
  ipcMain.handle('workflow:repairPlayerStates', async (_event, savePath: string, blueprintDir: string) => {
    return repairPlayerStates(savePath, blueprintDir);
  });

  // --- Visual blueprint manager (draft) flow ---
  // mac-style window controls (custom traffic-light buttons in the renderer).
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

  // Titlebar menu actions (webContents edit / view operations).
  ipcMain.handle('web:undo', (event) => event.sender.undo());
  ipcMain.handle('web:redo', (event) => event.sender.redo());
  ipcMain.handle('web:cut', (event) => event.sender.cut());
  ipcMain.handle('web:copy', (event) => event.sender.copy());
  ipcMain.handle('web:paste', (event) => event.sender.paste());
  ipcMain.handle('web:delete', (event) => event.sender.delete());
  ipcMain.handle('web:selectAll', (event) => event.sender.selectAll());
  ipcMain.handle('web:reload', (event) => event.sender.reload());
  ipcMain.handle('web:forceReload', (event) => event.sender.reloadIgnoringCache());
  ipcMain.handle('web:toggleDevtools', (event) => event.sender.toggleDevTools());
  ipcMain.handle('web:actualSize', (event) => event.sender.setZoomLevel(0));
  ipcMain.handle('web:zoomIn', (event) => event.sender.setZoomLevel(event.sender.getZoomLevel() + 0.5));
  ipcMain.handle('web:zoomOut', (event) => event.sender.setZoomLevel(event.sender.getZoomLevel() - 0.5));
  ipcMain.handle('web:toggleFullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url));

  ipcMain.handle('saves:autoLocate', async () => autoLocateSaveGames());
  ipcMain.handle('saves:locations', async () => listSaveGameLocations());
  ipcMain.handle('saves:accountsInRoot', async (_event, saveGamesRoot: string) => listAccountDirsInRoot(saveGamesRoot));
  ipcMain.handle('saves:listInAccount', async (_event, accountDir: string) => listSavesInAccountDir(accountDir));
  ipcMain.handle('saves:resolveBlueprintDir', async (_event, saveGamesRoot: string, savePath: string) => resolveBlueprintDirForSave(saveGamesRoot, savePath));
  ipcMain.handle('saves:discover', async (_event, gameBlueprintDir: string, selectedAccountDir?: string | null, recursive?: boolean) => {
    return locateSaveCandidatesInAccountDir(gameBlueprintDir, selectedAccountDir ?? null, Boolean(recursive));
  });
  ipcMain.handle('account:steamName', async (_event, steamId: string) => resolveSteamPersonaName(steamId));
  ipcMain.handle('draft:fromSave', async (_event, gameBlueprintDir: string, savePath: string) => {
    return buildDraftFromSave(gameBlueprintDir, savePath);
  });
  ipcMain.handle('draft:fromExternal', async (_event, gameBlueprintDir: string, mappingDir: string, savePath?: string | null) => {
    return buildDraftFromExternalMapping(gameBlueprintDir, mappingDir, savePath ?? null);
  });
  ipcMain.handle('draft:plan', async (_event, draft: DraftTree) => {
    return planDraftApply(draft);
  });
  ipcMain.handle('draft:apply', async (_event, options: DraftApplyOptions) => {
    return executeDraftImport(options);
  });

  ipcMain.handle('backup:list', async () => listBackups());

  ipcMain.handle('backup:rollback', async (_event, backupDir: string) => rollbackFromBackup(backupDir));
  ipcMain.handle('backup:delete', async (_event, backupDir: string) => deleteBackup(backupDir));

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    const resolved = path.resolve(targetPath);
    // 目录类路径（无扩展名）若尚未创建则先建好，避免「找不到文件」报错。
    if (!existsSync(resolved) && !path.extname(resolved)) {
      await fs.mkdir(resolved, { recursive: true });
    }
    return shell.openPath(resolved);
  });

  ipcMain.handle('diagnostics:dumpSave', async (_event, savePath: string) => dumpSaveToDiagnostics(savePath));
  ipcMain.handle('diagnostics:scanBlueprintStructure', async (_event, savePath: string) => scanBlueprintStructure(savePath));
  ipcMain.handle('diagnostics:diffSaveBlueprintCategory', async (_event, beforePath: string, afterPath: string) => diffBlueprintCategorySaves(beforePath, afterPath));
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
