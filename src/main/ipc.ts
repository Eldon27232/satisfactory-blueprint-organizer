import { app, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listBackups } from '../core/backup';
import { scanBlueprintStructure } from '../core/blueprintCategoryDiscovery';
import { buildDraftFromExternalMapping, buildDraftFromSave } from '../core/buildDraft';
import { executeDraftImport, planDraftApply } from '../core/applyDraft';
import { autoLocateSaveGames, listAccountDirsInRoot, listSaveGameLocations, listSavesInAccountDir, locateSaveCandidatesInAccountDir, resolveBlueprintDirForSave } from '../core/locateSaves';
import { buildAppMenu, type MenuLanguage } from './menu';
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
  ipcMain.handle('menu:setLanguage', async (_event, language: MenuLanguage) => buildAppMenu(language));
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

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    return shell.openPath(path.resolve(targetPath));
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
