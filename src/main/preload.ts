import { contextBridge, ipcRenderer } from 'electron';
import type { BackupRecord, DryRunResult, ExecuteOptions, ImportReport, PlayerStateRepairReport, RollbackReport } from '../shared/types';

const api = {
  chooseGameBlueprintDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory', 'gameBlueprintDir'),
  chooseMappingDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory', 'mappingDir'),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:directory'),
  chooseSavFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:file', [{ name: 'Satisfactory Save', extensions: ['sav'] }], 'saveFile'),
  dryRun: (gameBlueprintDir: string, mappingDir: string, selectedSavePath?: string | null, selectedAccountDir?: string | null, recursiveSaveScan?: boolean): Promise<DryRunResult> =>
    ipcRenderer.invoke('workflow:dryRun', gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, recursiveSaveScan),
  executeImport: (options: ExecuteOptions): Promise<ImportReport> => ipcRenderer.invoke('workflow:execute', options),
  repairPlayerStates: (savePath: string, blueprintDir: string): Promise<PlayerStateRepairReport> => ipcRenderer.invoke('workflow:repairPlayerStates', savePath, blueprintDir),
  listBackups: (): Promise<BackupRecord[]> => ipcRenderer.invoke('backup:list'),
  rollback: (backupDir: string): Promise<RollbackReport> => ipcRenderer.invoke('backup:rollback', backupDir),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath),
  dumpSave: (savePath: string): Promise<string> => ipcRenderer.invoke('diagnostics:dumpSave', savePath),
  scanBlueprintStructure: (savePath: string): Promise<string> => ipcRenderer.invoke('diagnostics:scanBlueprintStructure', savePath),
  diffSaveBlueprintCategory: (beforePath: string, afterPath: string): Promise<string> => ipcRenderer.invoke('diagnostics:diffSaveBlueprintCategory', beforePath, afterPath)
};

contextBridge.exposeInMainWorld('sbc', api);

export type SbcApi = typeof api;
