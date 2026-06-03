import path from 'node:path';
import {
  computeCategoryPlan,
  isRecycleCategory,
  validateDraft,
  type DraftApplyOptions,
  type DraftApplyPlan,
  type DraftTree
} from '../shared/draftModel';
import type { ImportReport, Notice } from '../shared/types';
import { applyCategoryPlanToSave, verifyCategoryPlan } from './applyBlueprintCategories';
import { createBackup } from './backup';
import { discoverBlueprintCategoryCapability } from './blueprintCategoryDiscovery';
import { parseSaveFile, writeSaveFile } from './parseSave';
import { writeImportReport } from './reports';
import { resolveFileOps } from './draftApply/fileOps';
import { buildFileOperations, executeApplyOperations, type ApplyOperation, type FileOpRecords } from './draftApply/pipeline';

/** Build the confirm-page preview for a draft. */
export async function planDraftApply(draft: DraftTree): Promise<DraftApplyPlan> {
  const validation = validateDraft(draft);
  const categoryPlan = computeCategoryPlan(draft);
  const ops = await resolveFileOps(draft);
  const notices: Notice[] = [...draft.buildNotices, ...validation.notices, ...ops.notices];

  let capabilityReason: string | null = null;
  if (!draft.savePath) {
    notices.push({ severity: 'error', code: 'NO_SELECTED_SAVE', message: '未选择目标 .sav，无法写入分类。' });
  } else {
    const capability = await discoverBlueprintCategoryCapability(draft.savePath);
    if (!capability.canWrite) {
      capabilityReason = capability.reason;
      notices.push({ severity: 'error', code: 'SAVE_CATEGORY_WRITE_DISABLED', message: capability.reason, path: draft.savePath });
    }
  }

  // Only report categories whose icon actually changed (iconId differs from what was read from the save).
  const iconUpdates = draft.categories
    .filter((category) => !isRecycleCategory(category) && category.iconId !== null && category.iconId !== (category.originalIconId ?? null))
    .map((category) => ({ category: category.name.trim(), iconId: category.iconId as number }));

  const hasError = notices.some((notice) => notice.severity === 'error');
  return {
    savePath: draft.savePath,
    sessionName: draft.sessionName,
    gameBlueprintDir: draft.gameBlueprintDir,
    categoryPlan,
    iconUpdates,
    copies: ops.copies.map((copy) => ({ from: copy.fromSbp, to: copy.toSbp, cfg: Boolean(copy.toCfg) })),
    renames: ops.renames.map((rename) => ({ from: rename.fromSbp, to: rename.toSbp, cfg: Boolean(rename.toCfg) })),
    deletions: ops.deletions.map((deletion) => deletion.sbp),
    saveOnly: ops.saveOnly,
    writeBacks: ops.mappingWriteBacks.map((wb) => wb.toSbp),
    notices,
    canApply: !hasError && Boolean(draft.savePath) && capabilityReason === null
  };
}

/**
 * Execute the draft: validate, back up, then run every write as an ordered operation pipeline
 * (file ops + save write). Any step failure aborts with a structured DraftApplyError (completed
 * steps + backup dir). The success path produces the same on-disk result as before.
 */
export async function executeDraftImport(options: DraftApplyOptions): Promise<ImportReport> {
  const { draft } = options;
  const plan = await planDraftApply(draft);
  const warnings = plan.notices.filter((notice) => notice.severity !== 'error');
  const blockingErrors = plan.notices.filter((notice) => notice.severity === 'error');

  if (!options.gameClosedConfirmed) {
    blockingErrors.push({ severity: 'error', code: 'GAME_NOT_CONFIRMED_CLOSED', message: '请先确认游戏和专用服务器已关闭。' });
  }
  if (!draft.savePath) {
    throw new Error('未选择目标 .sav。');
  }
  if (blockingErrors.length > 0) {
    throw new Error(blockingErrors.map((error) => `[${error.code}] ${error.message}`).join('\n'));
  }
  const savePath = draft.savePath;

  const ops = await resolveFileOps(draft);
  const backupDir = await createBackup({
    savePath,
    blueprintDir: draft.gameBlueprintDir,
    mappingReport: { draftApply: true, plan }
  });

  // All writes are modeled as an ordered operation pipeline: file ops first, then the save write.
  const records: FileOpRecords = { copiedFiles: [], renamedFiles: [], deletedFiles: [] };
  // 用容器对象承接 save 步骤的结果：避免 TS 因「闭包内赋值」无法收窄 outer 变量（会误判为 never）。
  const saveOutcome: { value: { created: ReturnType<typeof applyCategoryPlanToSave>; verification: ReturnType<typeof verifyCategoryPlan> } | null } = { value: null };

  // Write the save (categories, subcategories, BlueprintNames, IconID, MenuPriority), then reread + verify.
  const saveOp: ApplyOperation = {
    kind: 'save-write',
    label: `写入存档分类：${path.basename(savePath)}`,
    run: async () => {
      const save = await parseSaveFile(savePath);
      const created = applyCategoryPlanToSave(save, plan.categoryPlan, ops.removedStems);
      await writeSaveFile(savePath, save);
      const reread = await parseSaveFile(savePath);
      const verification = verifyCategoryPlan(reread, plan.categoryPlan);
      saveOutcome.value = { created, verification };
    }
  };

  const operations = [...buildFileOperations(ops, draft.gameBlueprintDir, records), saveOp];
  await executeApplyOperations(operations, backupDir);
  const saveResult = saveOutcome.value;
  if (!saveResult) throw new Error('保存步骤未执行。'); // 不可达：pipeline 成功即已运行 saveOp

  const { created, verification } = saveResult;
  if (verification.iconMismatches && verification.iconMismatches.length > 0) {
    warnings.push({ severity: 'warning', code: 'ICON_NOT_WRITTEN', message: verification.message });
  }

  const blueprintAssignments = plan.categoryPlan.flatMap((category) =>
    category.subcategories.flatMap((subcategory) =>
      subcategory.blueprintStems.map((stem) => ({ blueprintStem: stem, category: category.category, subcategory: subcategory.name }))
    )
  );

  return writeImportReport({
    selectedGameBlueprintDir: draft.gameBlueprintDir,
    selectedMappingDir: '',
    selectedSavePath: savePath,
    backupDir,
    copiedFiles: records.copiedFiles,
    overwrittenFiles: [],
    skippedFiles: [],
    renamedFiles: records.renamedFiles,
    deletedFiles: records.deletedFiles,
    iconUpdates: plan.iconUpdates,
    categoriesCreated: created.categoriesCreated,
    subcategoriesCreated: created.subcategoriesCreated,
    blueprintAssignments,
    warnings,
    errors: [],
    verificationResult: {
      saveWriteAttempted: true,
      passed: verification.passed,
      message: verification.message,
      categoryCounts: verification.categoryCounts,
      undefinedCount: verification.undefinedCount
    }
  });
}
