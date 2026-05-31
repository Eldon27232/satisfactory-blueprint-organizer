import { contextBridge, ipcRenderer } from 'electron';
import type { DraftApplyOptions, DraftApplyPlan, DraftTree } from '../shared/draftModel';
import type { AutoLocateResult, BackupRecord, BlueprintDirResolution, DryRunResult, ExecuteOptions, ImportReport, PlayerStateRepairReport, RollbackReport, SaveCandidate, SaveDiscoveryResult } from '../shared/types';

const api = {
  chooseGameBlueprintDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory', 'gameBlueprintDir'),
  chooseMappingDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory', 'mappingDir'),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory'),
  chooseSavFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:file', [{ name: 'Satisfactory Save', extensions: ['sav'] }], 'saveFile'),
  dryRun: (gameBlueprintDir: string, mappingDir: string, selectedSavePath?: string | null, selectedAccountDir?: string | null, recursiveSaveScan?: boolean): Promise<DryRunResult> =>
    ipcRenderer.invoke('workflow:dryRun', gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, recursiveSaveScan),
  executeImport: (options: ExecuteOptions): Promise<ImportReport> => ipcRenderer.invoke('workflow:execute', options),
  repairPlayerStates: (savePath: string, blueprintDir: string): Promise<PlayerStateRepairReport> => ipcRenderer.invoke('workflow:repairPlayerStates', savePath, blueprintDir),
  autoLocateSaveGames: (): Promise<AutoLocateResult> => ipcRenderer.invoke('saves:autoLocate'),
  listAccountsInRoot: (saveGamesRoot: string): Promise<string[]> => ipcRenderer.invoke('saves:accountsInRoot', saveGamesRoot),
  listSavesInAccount: (accountDir: string): Promise<SaveCandidate[]> => ipcRenderer.invoke('saves:listInAccount', accountDir),
  resolveBlueprintDir: (saveGamesRoot: string, savePath: string): Promise<BlueprintDirResolution> => ipcRenderer.invoke('saves:resolveBlueprintDir', saveGamesRoot, savePath),
  discoverSaves: (gameBlueprintDir: string, selectedAccountDir?: string | null, recursive?: boolean): Promise<SaveDiscoveryResult> =>
    ipcRenderer.invoke('saves:discover', gameBlueprintDir, selectedAccountDir, recursive),
  getSteamName: (steamId: string): Promise<string | null> => ipcRenderer.invoke('account:steamName', steamId),
  buildDraftFromSave: (gameBlueprintDir: string, savePath: string): Promise<DraftTree> => ipcRenderer.invoke('draft:fromSave', gameBlueprintDir, savePath),
  buildDraftFromExternal: (gameBlueprintDir: string, mappingDir: string, savePath?: string | null): Promise<DraftTree> =>
    ipcRenderer.invoke('draft:fromExternal', gameBlueprintDir, mappingDir, savePath),
  planDraftApply: (draft: DraftTree): Promise<DraftApplyPlan> => ipcRenderer.invoke('draft:plan', draft),
  applyDraft: (options: DraftApplyOptions): Promise<ImportReport> => ipcRenderer.invoke('draft:apply', options),
  listBackups: (): Promise<BackupRecord[]> => ipcRenderer.invoke('backup:list'),
  rollback: (backupDir: string): Promise<RollbackReport> => ipcRenderer.invoke('backup:rollback', backupDir),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath),
  dumpSave: (savePath: string): Promise<string> => ipcRenderer.invoke('diagnostics:dumpSave', savePath),
  scanBlueprintStructure: (savePath: string): Promise<string> => ipcRenderer.invoke('diagnostics:scanBlueprintStructure', savePath),
  diffSaveBlueprintCategory: (beforePath: string, afterPath: string): Promise<string> => ipcRenderer.invoke('diagnostics:diffSaveBlueprintCategory', beforePath, afterPath)
};

contextBridge.exposeInMainWorld('sbc', api);

export type SbcApi = typeof api;
