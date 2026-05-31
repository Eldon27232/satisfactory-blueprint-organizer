import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BLUEPRINT_CONFIG_EXT, BLUEPRINT_EXT } from '../shared/constants';
import {
  computeCategoryPlan,
  getRecycledBlueprintIdSet,
  validateDraft,
  type DraftApplyOptions,
  type DraftApplyPlan,
  type DraftBlueprint,
  type DraftTree
} from '../shared/draftModel';
import type { ImportReport, Notice } from '../shared/types';
import { applyCategoryPlanToSave, verifyCategoryPlan } from './applyBlueprintCategories';
import { createBackup } from './backup';
import { discoverBlueprintCategoryCapability } from './blueprintCategoryDiscovery';
import { ensureDir, pathExists } from './fsUtils';
import { parseSaveFile, writeSaveFile } from './parseSave';
import { writeImportReport } from './reports';

interface ResolvedCopy {
  blueprint: DraftBlueprint;
  fromSbp: string;
  toSbp: string;
  fromCfg: string | null;
  toCfg: string | null;
}

interface ResolvedRename {
  blueprint: DraftBlueprint;
  fromSbp: string;
  toSbp: string;
  fromCfg: string | null;
  toCfg: string | null;
}

interface ResolvedDeletion {
  sbp: string;
  cfg: string | null;
}

interface ResolvedFileOps {
  copies: ResolvedCopy[];
  renames: ResolvedRename[];
  deletions: ResolvedDeletion[];
  /** Blueprint names to strip from the save's categories (recycled blueprints). */
  removedStems: string[];
  saveOnly: string[];
  notices: Notice[];
}

const RENAME_STAGING_DIR = '.sbc-rename-staging';

function gamePath(gameBlueprintDir: string, stem: string, ext: string): string {
  return path.join(gameBlueprintDir, `${stem}${ext}`);
}

/** Resolve the concrete copy/rename operations and any on-disk conflicts. */
async function resolveFileOps(draft: DraftTree): Promise<ResolvedFileOps> {
  const copies: ResolvedCopy[] = [];
  const renames: ResolvedRename[] = [];
  const deletions: ResolvedDeletion[] = [];
  const removedStems: string[] = [];
  const saveOnly: string[] = [];
  const notices: Notice[] = [];
  const gameDir = draft.gameBlueprintDir;
  const recycledIds = getRecycledBlueprintIdSet(draft);

  for (const blueprint of Object.values(draft.blueprints)) {
    // Recycled blueprints leave the game entirely: strip from the save, delete the file.
    if (recycledIds.has(blueprint.id)) {
      removedStems.push(blueprint.originalStem, blueprint.stem);
      if (blueprint.hasSbp && blueprint.origin === 'gameDir') {
        deletions.push({
          sbp: gamePath(gameDir, blueprint.originalStem, BLUEPRINT_EXT),
          cfg: blueprint.hasCfg ? gamePath(gameDir, blueprint.originalStem, BLUEPRINT_CONFIG_EXT) : null
        });
      }
      continue;
    }
    if (!blueprint.hasSbp) {
      saveOnly.push(blueprint.stem);
      continue;
    }
    const toSbp = gamePath(gameDir, blueprint.stem, BLUEPRINT_EXT);
    const toCfg = blueprint.hasCfg ? gamePath(gameDir, blueprint.stem, BLUEPRINT_CONFIG_EXT) : null;

    if (blueprint.origin === 'external') {
      const fromSbp = blueprint.sourceSbpPath;
      if (!fromSbp) continue;
      // Never overwrite an existing different blueprint in the flat game dir.
      if (await pathExists(toSbp)) {
        notices.push({ severity: 'error', code: 'TARGET_EXISTS', message: `游戏蓝图目录已存在同名蓝图 "${blueprint.stem}.sbp"，禁止覆盖。`, path: toSbp });
        continue;
      }
      copies.push({ blueprint, fromSbp, toSbp, fromCfg: blueprint.sourceCfgPath, toCfg });
    } else if (blueprint.origin === 'gameDir') {
      if (blueprint.stem === blueprint.originalStem) continue; // unchanged, no file op
      const fromSbp = gamePath(gameDir, blueprint.originalStem, BLUEPRINT_EXT);
      const fromCfg = blueprint.hasCfg ? gamePath(gameDir, blueprint.originalStem, BLUEPRINT_CONFIG_EXT) : null;
      if (!(await pathExists(fromSbp))) {
        notices.push({ severity: 'warning', code: 'RENAME_SOURCE_MISSING', message: `改名来源文件不存在，已跳过：${blueprint.originalStem}.sbp`, path: fromSbp });
        continue;
      }
      renames.push({ blueprint, fromSbp, toSbp, fromCfg, toCfg });
    }
  }

  return { copies, renames, deletions, removedStems, saveOnly, notices };
}

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

  const iconUpdates = categoryPlan
    .filter((entry) => entry.iconId !== null && entry.iconId !== undefined)
    .map((entry) => ({ category: entry.category, iconId: entry.iconId as number }));

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
    notices,
    canApply: !hasError && Boolean(draft.savePath) && capabilityReason === null
  };
}

/** Execute the draft: backup, copy/rename files, write the save, reread + verify, write report. */
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

  const ops = await resolveFileOps(draft);
  const backupDir = await createBackup({
    savePath: draft.savePath,
    blueprintDir: draft.gameBlueprintDir,
    mappingReport: { draftApply: true, plan }
  });

  const copiedFiles: string[] = [];
  const renamedFiles: Array<{ from: string; to: string }> = [];
  const deletedFiles: string[] = [];
  const skippedFiles: string[] = [];

  // Deletions (recycle bin): remove files from the flat game dir.
  for (const deletion of ops.deletions) {
    if (await pathExists(deletion.sbp)) {
      await fs.rm(deletion.sbp, { force: true });
      deletedFiles.push(deletion.sbp);
    }
    if (deletion.cfg && (await pathExists(deletion.cfg))) {
      await fs.rm(deletion.cfg, { force: true });
      deletedFiles.push(deletion.cfg);
    }
  }

  // Copies (external imports).
  for (const copy of ops.copies) {
    await ensureDir(path.dirname(copy.toSbp));
    await fs.copyFile(copy.fromSbp, copy.toSbp);
    copiedFiles.push(copy.toSbp);
    if (copy.fromCfg && copy.toCfg) {
      await fs.copyFile(copy.fromCfg, copy.toCfg);
      copiedFiles.push(copy.toCfg);
    }
  }

  // Renames via two-phase staging (handles swaps/cycles in the flat dir).
  if (ops.renames.length > 0) {
    const staging = path.join(draft.gameBlueprintDir, RENAME_STAGING_DIR);
    await ensureDir(staging);
    try {
      for (const rename of ops.renames) {
        await fs.rename(rename.fromSbp, path.join(staging, path.basename(rename.toSbp)));
        if (rename.fromCfg && rename.toCfg && (await pathExists(rename.fromCfg))) {
          await fs.rename(rename.fromCfg, path.join(staging, path.basename(rename.toCfg)));
        }
      }
      for (const rename of ops.renames) {
        await fs.rename(path.join(staging, path.basename(rename.toSbp)), rename.toSbp);
        renamedFiles.push({ from: rename.fromSbp, to: rename.toSbp });
        if (rename.toCfg) {
          const stagedCfg = path.join(staging, path.basename(rename.toCfg));
          if (await pathExists(stagedCfg)) await fs.rename(stagedCfg, rename.toCfg);
        }
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  // Write the save (categories, subcategories, BlueprintNames, IconID, MenuPriority).
  const save = await parseSaveFile(draft.savePath);
  const { categoriesCreated, subcategoriesCreated } = applyCategoryPlanToSave(save, plan.categoryPlan, ops.removedStems);
  await writeSaveFile(draft.savePath, save);
  const reread = await parseSaveFile(draft.savePath);
  const verification = verifyCategoryPlan(reread, plan.categoryPlan);
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
    selectedSavePath: draft.savePath,
    backupDir,
    copiedFiles,
    overwrittenFiles: [],
    skippedFiles,
    renamedFiles,
    deletedFiles,
    iconUpdates: plan.iconUpdates,
    categoriesCreated,
    subcategoriesCreated,
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
