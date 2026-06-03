import { ipcMain } from 'electron';
import { scanBlueprintStructure } from '../../core/blueprintCategoryDiscovery';
import { dumpSaveToDiagnostics } from '../../core/parseSave';
import { diffBlueprintCategorySaves } from '../../core/saveDiff';
import { IPC } from '../../shared/ipcChannels';

// 诊断工具：导出存档结构、扫描蓝图分类结构、对比两个存档的蓝图分类记录。
export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC.diagnostics.dumpSave, async (_event, savePath: string) => dumpSaveToDiagnostics(savePath));
  ipcMain.handle(IPC.diagnostics.scanBlueprintStructure, async (_event, savePath: string) => scanBlueprintStructure(savePath));
  ipcMain.handle(IPC.diagnostics.diffSaveBlueprintCategory, async (_event, beforePath: string, afterPath: string) => diffBlueprintCategorySaves(beforePath, afterPath));
}
