import { ipcMain } from 'electron';
import { executeDraftImport, planDraftApply } from '../../core/applyDraft';
import { buildDraftFromExternalMapping, buildDraftFromSave } from '../../core/buildDraft';
import { readDirtyFlag, writeDirtyFlag } from '../../core/dirtyFlag';
import { scanMappingFolder } from '../../core/scanMapping';
import { createDryRun, executeImport, repairPlayerStates } from '../../core/workflow';
import type { DraftApplyOptions, DraftTree } from '../../shared/draftModel';
import type { ExecuteOptions } from '../../shared/types';
import { IPC } from '../../shared/ipcChannels';

// 草稿构建 / 计划 / 应用，以及与之相关的脏标记、外部映射扫描和旧导入工作流。
export function registerDraftIpc(): void {
  ipcMain.handle(IPC.draft.fromSave, async (_event, gameBlueprintDir: string, savePath: string) => buildDraftFromSave(gameBlueprintDir, savePath));
  ipcMain.handle(IPC.draft.fromExternal, async (_event, gameBlueprintDir: string, mappingDir: string, savePath?: string | null) => buildDraftFromExternalMapping(gameBlueprintDir, mappingDir, savePath ?? null));
  ipcMain.handle(IPC.draft.plan, async (_event, draft: DraftTree) => planDraftApply(draft));
  ipcMain.handle(IPC.draft.apply, async (_event, options: DraftApplyOptions) => executeDraftImport(options));

  // 旧的 dryRun/execute 导入流程（与 draft apply 概念重叠，保留兼容）。
  ipcMain.handle(IPC.workflow.dryRun, async (_event, gameBlueprintDir: string, mappingDir: string, selectedSavePath?: string | null, selectedAccountDir?: string | null, recursiveSaveScan?: boolean) => {
    return createDryRun(gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, Boolean(recursiveSaveScan));
  });
  ipcMain.handle(IPC.workflow.execute, async (_event, options: ExecuteOptions) => executeImport(options));
  ipcMain.handle(IPC.workflow.repairPlayerStates, async (_event, savePath: string, blueprintDir: string) => repairPlayerStates(savePath, blueprintDir));

  // 脏标记（某存档有未应用更改）与外部映射扫描，服务草稿/映射构建流程。
  ipcMain.handle(IPC.dirty.read, async (_event, savePath: string) => readDirtyFlag(savePath));
  ipcMain.handle(IPC.dirty.write, async (_event, savePath: string, dirty: boolean) => writeDirtyFlag(savePath, dirty));
  ipcMain.handle(IPC.mapping.scan, async (_event, gameBlueprintDir: string, mappingDir: string) => scanMappingFolder({ gameBlueprintDir, mappingDir }));
}
