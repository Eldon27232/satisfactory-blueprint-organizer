import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BLUEPRINT_CONFIG_EXT, BLUEPRINT_EXT } from '../shared/constants';
import type { BlueprintMappingEntry, Notice, ScanReport } from '../shared/types';
import { pathExists } from './fsUtils';

const illegalWindowsNamePattern = /[<>:"/\\|?*\x00-\x1f]/;

export interface ScanMappingOptions {
  mappingDir: string;
  gameBlueprintDir: string;
}

export async function scanMappingFolder(options: ScanMappingOptions): Promise<ScanReport> {
  const warnings: Notice[] = [];
  const errors: Notice[] = [];
  const entries: BlueprintMappingEntry[] = [];
  const seenStems = new Map<string, BlueprintMappingEntry[]>();

  if (!(await pathExists(options.mappingDir))) {
    errors.push({
      severity: 'error',
      code: 'MAPPING_DIR_MISSING',
      message: '外部映射文件夹不存在。',
      path: options.mappingDir
    });
  }
  if (!(await pathExists(options.gameBlueprintDir))) {
    errors.push({
      severity: 'error',
      code: 'GAME_BLUEPRINT_DIR_MISSING',
      message: '游戏蓝图文件夹不存在。',
      path: options.gameBlueprintDir
    });
  }
  if (errors.length > 0) {
    return emptyReport(options, warnings, errors);
  }

  const sbpFiles = await findSbpFiles(options.mappingDir);
  for (const sbpPath of sbpFiles) {
    const relativePath = path.relative(options.mappingDir, sbpPath);
    const segments = relativePath.split(path.sep);
    const stem = path.basename(sbpPath, BLUEPRINT_EXT);
    const entryWarnings: Notice[] = [];
    const entryErrors: Notice[] = [];

    if (segments.length < 3) {
      entryErrors.push({
        severity: 'error',
        code: 'ROOT_OR_MISSING_CATEGORY',
        message: '蓝图必须至少放在 Category\\Subcategory\\文件.sbp 下。',
        path: sbpPath
      });
    }
    if (illegalWindowsNamePattern.test(stem) || stem.trim().length === 0) {
      entryErrors.push({
        severity: 'error',
        code: 'ILLEGAL_BLUEPRINT_NAME',
        message: '蓝图文件名 stem 为空或包含 Windows 非法字符。',
        path: sbpPath
      });
    }

    const category = segments[0] ?? 'Undefined';
    const subPath = segments.slice(1, -1);
    const subcategory = subPath.length <= 1 ? subPath[0] ?? 'Undefined' : subPath.join(' - ');
    if (subPath.length > 1) {
      entryWarnings.push({
        severity: 'warning',
        code: 'DEPTH_COLLAPSED',
        message: `超过两级目录，已映射为 Category="${category}", Subcategory="${subcategory}"。`,
        path: sbpPath
      });
    }

    const cfgPath = path.join(path.dirname(sbpPath), `${stem}${BLUEPRINT_CONFIG_EXT}`);
    const sourceCfgPath = (await pathExists(cfgPath)) ? cfgPath : null;
    if (!sourceCfgPath) {
      entryWarnings.push({
        severity: 'warning',
        code: 'MISSING_SBPCFG',
        message: '缺少同名 .sbpcfg，将只复制 .sbp。',
        path: sbpPath
      });
    }

    const targetSbpPath = path.join(options.gameBlueprintDir, `${stem}${BLUEPRINT_EXT}`);
    const targetCfgPath = sourceCfgPath ? path.join(options.gameBlueprintDir, `${stem}${BLUEPRINT_CONFIG_EXT}`) : null;
    if (await pathExists(targetSbpPath)) {
      entryWarnings.push({
        severity: 'warning',
        code: 'TARGET_EXISTS',
        message: '目标游戏蓝图目录已有同名 .sbp，默认执行会阻止覆盖。',
        path: targetSbpPath
      });
    }
    if (targetCfgPath && (await pathExists(targetCfgPath))) {
      entryWarnings.push({
        severity: 'warning',
        code: 'TARGET_CFG_EXISTS',
        message: '目标游戏蓝图目录已有同名 .sbpcfg，默认执行会阻止覆盖。',
        path: targetCfgPath
      });
    }

    const entry: BlueprintMappingEntry = {
      sourceSbpPath: sbpPath,
      sourceCfgPath,
      targetSbpPath,
      targetCfgPath,
      blueprintStem: stem,
      category,
      subcategory,
      relativePath,
      warnings: entryWarnings,
      errors: entryErrors
    };
    entries.push(entry);
    seenStems.set(stem.toLowerCase(), [...(seenStems.get(stem.toLowerCase()) ?? []), entry]);
  }

  for (const sameStemEntries of seenStems.values()) {
    if (sameStemEntries.length <= 1) continue;
    for (const entry of sameStemEntries) {
      entry.warnings.push({
        severity: 'warning',
        code: 'DUPLICATE_BLUEPRINT_STEM',
        message: `Duplicate blueprint stem "${entry.blueprintStem}". The file is copied once, and this stem will be assigned to every mapped category path.`,
        path: entry.sourceSbpPath
      });
    }
  }

  const allWarnings = [...warnings, ...entries.flatMap((entry) => entry.warnings)];
  const allErrors = [...errors, ...entries.flatMap((entry) => entry.errors)];
  return {
    selectedGameBlueprintDir: options.gameBlueprintDir,
    selectedMappingDir: options.mappingDir,
    entries,
    categories: [...new Set(entries.map((entry) => entry.category))].sort(localeCompare),
    subcategories: [...new Set(entries.map((entry) => `${entry.category}/${entry.subcategory}`))].sort(localeCompare),
    missingCfgCount: entries.filter((entry) => !entry.sourceCfgPath).length,
    duplicateStemCount: [...seenStems.values()].filter((group) => group.length > 1).length,
    targetExistingCount: entries.filter((entry) => entry.warnings.some((warning) => warning.code === 'TARGET_EXISTS' || warning.code === 'TARGET_CFG_EXISTS')).length,
    warnings: allWarnings,
    errors: allErrors
  };
}

async function findSbpFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findSbpFiles(fullPath)));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === BLUEPRINT_EXT) {
      result.push(fullPath);
    }
  }
  return result.sort(localeCompare);
}

function localeCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN');
}

function emptyReport(options: ScanMappingOptions, warnings: Notice[], errors: Notice[]): ScanReport {
  return {
    selectedGameBlueprintDir: options.gameBlueprintDir,
    selectedMappingDir: options.mappingDir,
    entries: [],
    categories: [],
    subcategories: [],
    missingCfgCount: 0,
    duplicateStemCount: 0,
    targetExistingCount: 0,
    warnings,
    errors
  };
}
