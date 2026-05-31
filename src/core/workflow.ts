import type { DryRunResult, ExecuteOptions, ImportReport, Notice, PlayerStateRepairReport } from '../shared/types';
import { applyBlueprintCategories } from './applyBlueprintCategories';
import { createBackup } from './backup';
import { discoverBlueprintCategoryCapability } from './blueprintCategoryDiscovery';
import { copyBlueprintsFlat } from './copyBlueprints';
import { pathExists } from './fsUtils';
import { locateSaveCandidatesInAccountDir } from './locateSaves';
import { cleanupDuplicatePlayerStates, inspectPlayerStateCleanup } from './playerStateCleanup';
import { writeImportReport } from './reports';
import { scanMappingFolder } from './scanMapping';

export async function createDryRun(
  gameBlueprintDir: string,
  mappingDir: string,
  selectedSavePath?: string | null,
  selectedAccountDir?: string | null,
  recursiveSaveScan = false
): Promise<DryRunResult> {
  const [scan, saveDiscovery] = await Promise.all([
    scanMappingFolder({ gameBlueprintDir, mappingDir }),
    locateSaveCandidatesInAccountDir(gameBlueprintDir, selectedAccountDir ?? null, recursiveSaveScan)
  ]);

  const effectiveSavePath = selectedSavePath ?? chooseDefaultSave(saveDiscovery.candidates);
  const capability = await discoverBlueprintCategoryCapability(effectiveSavePath);
  const playerStateCheck = effectiveSavePath ? await inspectPlayerStateCleanup(effectiveSavePath) : undefined;
  const warnings: Notice[] = [...scan.warnings, ...saveDiscovery.warnings];
  const errors: Notice[] = [...scan.errors, ...saveDiscovery.errors];
  if (playerStateCheck) {
    warnings.push(...playerStateCheck.warnings);
    errors.push(...playerStateCheck.errors);
  }
  const targetExisting = scan.targetExistingCount;
  if (!effectiveSavePath) {
    warnings.push({
      severity: 'warning',
      code: 'NO_SELECTED_SAVE',
      message: 'No target .sav is selected yet. Choose a save before importing.'
    });
  }

  return {
    scan,
    saveDiscovery,
    selectedSavePath: effectiveSavePath,
    selectedAccountDir: saveDiscovery.selectedAccountDir,
    recursiveSaveScan,
    categoriesToCreate: scan.categories,
    subcategoriesToCreate: scan.subcategories,
    filesToCopy: scan.entries.length + scan.entries.filter((entry) => entry.sourceCfgPath).length,
    filesToOverwrite: targetExisting,
    categoryCapability: capability,
    playerStateCheck,
    warnings,
    errors
  };
}

export async function executeImport(options: ExecuteOptions): Promise<ImportReport> {
  const dryRun = await createDryRun(options.gameBlueprintDir, options.mappingDir, options.selectedSavePath, options.selectedAccountDir, options.recursiveSaveScan);
  const warnings = [...dryRun.warnings];
  const errors = [...dryRun.errors];

  if (!options.gameClosedConfirmed) {
    errors.push({
      severity: 'error',
      code: 'GAME_NOT_CONFIRMED_CLOSED',
      message: 'Confirm the game and dedicated server are closed before importing.'
    });
  }
  if (!(await pathExists(options.selectedSavePath))) {
    errors.push({
      severity: 'error',
      code: 'SELECTED_SAVE_MISSING',
      message: 'Selected .sav does not exist.',
      path: options.selectedSavePath
    });
  }
  if (!options.allowOverwrite && dryRun.scan.targetExistingCount > 0) {
    errors.push({
      severity: 'error',
      code: 'OVERWRITE_NOT_ALLOWED',
      message: 'Target blueprint files already exist. Enable overwrite to continue.'
    });
  }
  if (!dryRun.categoryCapability.canWrite) {
    warnings.push({
      severity: 'warning',
      code: 'SAVE_CATEGORY_WRITE_DISABLED',
      message: dryRun.categoryCapability.reason,
      path: options.selectedSavePath
    });
  }
  const blockingErrors = errors.filter((error) => error.code !== 'SAVE_CATEGORY_WRITE_DISABLED');
  if (blockingErrors.length > 0) {
    throw new Error(blockingErrors.map((error) => `[${error.code}] ${error.message}`).join('\n'));
  }

  const backupDir = await createBackup({
    savePath: options.selectedSavePath,
    blueprintDir: options.gameBlueprintDir,
    mappingReport: dryRun
  });

  const copyResult = await copyBlueprintsFlat(dryRun.scan.entries, options.allowOverwrite);
  const playerStateCleanup = await cleanupDuplicatePlayerStates(options.selectedSavePath);
  if (playerStateCleanup.errors.length > 0) {
    throw new Error(playerStateCleanup.errors.map((error) => `[${error.code}] ${error.message}`).join('\n'));
  }
  warnings.push(...playerStateCleanup.warnings);
  const applyResult = await applyBlueprintCategories(options.selectedSavePath, dryRun.scan.entries, dryRun.categoryCapability);
  return writeImportReport({
    selectedGameBlueprintDir: options.gameBlueprintDir,
    selectedMappingDir: options.mappingDir,
    selectedSavePath: options.selectedSavePath,
    backupDir,
    copiedFiles: copyResult.copiedFiles,
    overwrittenFiles: copyResult.overwrittenFiles,
    skippedFiles: copyResult.skippedFiles,
    categoriesCreated: applyResult.categoriesCreated,
    subcategoriesCreated: applyResult.subcategoriesCreated,
    blueprintAssignments: applyResult.assignments,
    warnings,
    errors,
    verificationResult: {
      saveWriteAttempted: dryRun.categoryCapability.canWrite,
      passed: applyResult.verification.passed,
      message: applyResult.verification.message,
      categoryCounts: applyResult.verification.categoryCounts,
      undefinedCount: applyResult.verification.undefinedCount
    },
    playerStateCleanup
  });
}

export async function repairPlayerStates(savePath: string, blueprintDir: string): Promise<PlayerStateRepairReport> {
  if (!(await pathExists(savePath))) {
    throw new Error(`Selected .sav does not exist: ${savePath}`);
  }
  if (!(await pathExists(blueprintDir))) {
    throw new Error(`Game blueprint folder does not exist: ${blueprintDir}`);
  }
  const inspection = await inspectPlayerStateCleanup(savePath);
  const backupDir = await createBackup({
    savePath,
    blueprintDir,
    mappingReport: { playerStateRepairBefore: true, inspection },
    prefix: 'playerstate-repair-before'
  });
  const result = await cleanupDuplicatePlayerStates(savePath);
  return {
    backupDir,
    selectedSavePath: savePath,
    result
  };
}

function chooseDefaultSave(candidates: Array<{ matchedSession: boolean; hasSessionConflict?: boolean; path: string }>): string | null {
  const matched = candidates.filter((candidate) => candidate.matchedSession && !candidate.hasSessionConflict);
  return matched[0]?.path ?? null;
}
