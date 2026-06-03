import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipcChannels';
import type { DraftApplyOptions, DraftApplyPlan, DraftTree } from '../shared/draftModel';
import type { AutoLocateResult, BackupRecord, BlueprintDirResolution, DryRunResult, ExecuteOptions, ImportReport, PlayerStateRepairReport, RollbackReport, SaveCandidate, SaveDiscoveryResult, SaveGameLocation, ScanReport, DroppedBlueprintImport, ZipImportResult } from '../shared/types';

// 订阅 main -> renderer 的单向事件，返回取消订阅函数：调用方在组件卸载时调用即可移除监听器，
// 避免热更新 / 重复挂载时监听器堆积。
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const api = {
  chooseGameBlueprintDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialog.directory, 'gameBlueprintDir'),
  chooseMappingDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialog.directory, 'mappingDir'),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialog.directory),
  chooseSavFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialog.file, [{ name: 'Satisfactory Save', extensions: ['sav'] }], 'saveFile'),
  dryRun: (gameBlueprintDir: string, mappingDir: string, selectedSavePath?: string | null, selectedAccountDir?: string | null, recursiveSaveScan?: boolean): Promise<DryRunResult> =>
    ipcRenderer.invoke(IPC.workflow.dryRun, gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, recursiveSaveScan),
  executeImport: (options: ExecuteOptions): Promise<ImportReport> => ipcRenderer.invoke(IPC.workflow.execute, options),
  repairPlayerStates: (savePath: string, blueprintDir: string): Promise<PlayerStateRepairReport> => ipcRenderer.invoke(IPC.workflow.repairPlayerStates, savePath, blueprintDir),
  titlebar: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.window.minimize),
    toggle_maximize: (): Promise<void> => ipcRenderer.invoke(IPC.window.toggleMaximize),
    exit: (): Promise<void> => ipcRenderer.invoke(IPC.window.close),
    undo: (): Promise<void> => ipcRenderer.invoke(IPC.web.undo),
    redo: (): Promise<void> => ipcRenderer.invoke(IPC.web.redo),
    cut: (): Promise<void> => ipcRenderer.invoke(IPC.web.cut),
    copy: (): Promise<void> => ipcRenderer.invoke(IPC.web.copy),
    paste: (): Promise<void> => ipcRenderer.invoke(IPC.web.paste),
    delete: (): Promise<void> => ipcRenderer.invoke(IPC.web.delete),
    select_all: (): Promise<void> => ipcRenderer.invoke(IPC.web.selectAll),
    reload: (): Promise<void> => ipcRenderer.invoke(IPC.web.reload),
    force_reload: (): Promise<void> => ipcRenderer.invoke(IPC.web.forceReload),
    toggle_devtools: (): Promise<void> => ipcRenderer.invoke(IPC.web.toggleDevtools),
    actual_size: (): Promise<void> => ipcRenderer.invoke(IPC.web.actualSize),
    zoom_in: (): Promise<void> => ipcRenderer.invoke(IPC.web.zoomIn),
    zoom_out: (): Promise<void> => ipcRenderer.invoke(IPC.web.zoomOut),
    toggle_fullscreen: (): Promise<void> => ipcRenderer.invoke(IPC.web.toggleFullscreen),
    open_url: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shell.openExternal, url)
  },
  autoLocateSaveGames: (): Promise<AutoLocateResult> => ipcRenderer.invoke(IPC.saves.autoLocate),
  listSaveGameLocations: (): Promise<SaveGameLocation[]> => ipcRenderer.invoke(IPC.saves.locations),
  listAccountsInRoot: (saveGamesRoot: string): Promise<string[]> => ipcRenderer.invoke(IPC.saves.accountsInRoot, saveGamesRoot),
  listSavesInAccount: (accountDir: string): Promise<SaveCandidate[]> => ipcRenderer.invoke(IPC.saves.listInAccount, accountDir),
  resolveBlueprintDir: (saveGamesRoot: string, savePath: string): Promise<BlueprintDirResolution> => ipcRenderer.invoke(IPC.saves.resolveBlueprintDir, saveGamesRoot, savePath),
  discoverSaves: (gameBlueprintDir: string, selectedAccountDir?: string | null, recursive?: boolean): Promise<SaveDiscoveryResult> =>
    ipcRenderer.invoke(IPC.saves.discover, gameBlueprintDir, selectedAccountDir, recursive),
  getSteamName: (steamId: string): Promise<string | null> => ipcRenderer.invoke(IPC.account.steamName, steamId),
  buildDraftFromSave: (gameBlueprintDir: string, savePath: string): Promise<DraftTree> => ipcRenderer.invoke(IPC.draft.fromSave, gameBlueprintDir, savePath),
  buildDraftFromExternal: (gameBlueprintDir: string, mappingDir: string, savePath?: string | null): Promise<DraftTree> =>
    ipcRenderer.invoke(IPC.draft.fromExternal, gameBlueprintDir, mappingDir, savePath),
  planDraftApply: (draft: DraftTree): Promise<DraftApplyPlan> => ipcRenderer.invoke(IPC.draft.plan, draft),
  applyDraft: (options: DraftApplyOptions): Promise<ImportReport> => ipcRenderer.invoke(IPC.draft.apply, options),
  listBackups: (): Promise<BackupRecord[]> => ipcRenderer.invoke(IPC.backup.list),
  rollback: (backupDir: string): Promise<RollbackReport> => ipcRenderer.invoke(IPC.backup.rollback, backupDir),
  deleteBackup: (backupDir: string): Promise<void> => ipcRenderer.invoke(IPC.backup.delete, backupDir),
  importDroppedBlueprints: (paths: string[]): Promise<DroppedBlueprintImport> => ipcRenderer.invoke(IPC.blueprints.importDropped, paths),
  importZipBlueprints: (zipPaths: string[]): Promise<ZipImportResult> => ipcRenderer.invoke(IPC.blueprints.importZip, zipPaths),
  chooseZipFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.dialog.zipFiles),
  readDirtyFlag: (savePath: string): Promise<boolean> => ipcRenderer.invoke(IPC.dirty.read, savePath),
  writeDirtyFlag: (savePath: string, dirty: boolean): Promise<void> => ipcRenderer.invoke(IPC.dirty.write, savePath, dirty),
  scanMapping: (gameBlueprintDir: string, mappingDir: string): Promise<ScanReport> => ipcRenderer.invoke(IPC.mapping.scan, gameBlueprintDir, mappingDir),
  // Electron 32+ 移除了 File.path，改用 webUtils 在 preload 取拖入文件的真实路径。
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shell.openExternal, url),
  updater: {
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updater.check),
    download: (): Promise<void> => ipcRenderer.invoke(IPC.updater.download),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke(IPC.updater.quitAndInstall),
    onAvailable: (cb: (info: { version: string; notes: string }) => void): (() => void) => subscribe(IPC.updater.available, cb),
    onProgress: (cb: (percent: number) => void): (() => void) => subscribe(IPC.updater.progress, cb),
    onDownloaded: (cb: (info: { version: string }) => void): (() => void) => subscribe(IPC.updater.downloaded, cb),
    onError: (cb: (message: string) => void): (() => void) => subscribe(IPC.updater.error, cb)
  },
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke(IPC.shell.openPath, targetPath),
  dumpSave: (savePath: string): Promise<string> => ipcRenderer.invoke(IPC.diagnostics.dumpSave, savePath),
  scanBlueprintStructure: (savePath: string): Promise<string> => ipcRenderer.invoke(IPC.diagnostics.scanBlueprintStructure, savePath),
  diffSaveBlueprintCategory: (beforePath: string, afterPath: string): Promise<string> => ipcRenderer.invoke(IPC.diagnostics.diffSaveBlueprintCategory, beforePath, afterPath)
};

contextBridge.exposeInMainWorld('sbc', api);

export type SbcApi = typeof api;
