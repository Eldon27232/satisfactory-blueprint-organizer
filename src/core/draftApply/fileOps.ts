import path from 'node:path';
import { BLUEPRINT_CONFIG_EXT, BLUEPRINT_EXT } from '../../shared/constants';
import { getRecycledBlueprintIdSet, locateBlueprint, UNNAMED, type DraftBlueprint, type DraftTree } from '../../shared/draftModel';
import type { Notice } from '../../shared/types';
import { pathExists } from '../fsUtils';

// 把草稿解析成「将要发生的具体文件操作」。这是确认页 plan 与 apply 执行的共同基础：
// 同一份 ResolvedFileOps 既用于生成预览，也驱动写盘 pipeline，二者绝不会算出不同的结果。
// 纯解析，不写盘（仅用 pathExists 做冲突/来源检查）。

export interface ResolvedCopy {
  blueprint: DraftBlueprint;
  fromSbp: string;
  toSbp: string;
  fromCfg: string | null;
  toCfg: string | null;
}

export interface ResolvedRename {
  blueprint: DraftBlueprint;
  fromSbp: string;
  toSbp: string;
  fromCfg: string | null;
  toCfg: string | null;
}

export interface ResolvedDeletion {
  sbp: string;
  cfg: string | null;
}

export interface ResolvedMappingWriteBack {
  fromSbp: string;
  toSbp: string;
  fromCfg: string | null;
  toCfg: string | null;
}

export interface ResolvedFileOps {
  copies: ResolvedCopy[];
  renames: ResolvedRename[];
  deletions: ResolvedDeletion[];
  /** Blueprint names to strip from the save's categories (recycled blueprints). */
  removedStems: string[];
  saveOnly: string[];
  /** .sbpcfg files whose iconID must be rewritten (icon changed in the manager). */
  iconWrites: Array<{ cfgPath: string; iconId: number }>;
  /** Files copied back into the external mapping folder for kept manager-only blueprints. */
  mappingWriteBacks: ResolvedMappingWriteBack[];
  notices: Notice[];
}

export function gamePath(gameBlueprintDir: string, stem: string, ext: string): string {
  return path.join(gameBlueprintDir, `${stem}${ext}`);
}

export function sanitizeSegment(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || UNNAMED;
}

/** Resolve the concrete copy/rename operations and any on-disk conflicts. */
export async function resolveFileOps(draft: DraftTree): Promise<ResolvedFileOps> {
  const copies: ResolvedCopy[] = [];
  const renames: ResolvedRename[] = [];
  const deletions: ResolvedDeletion[] = [];
  const removedStems: string[] = [];
  const saveOnly: string[] = [];
  const iconWrites: Array<{ cfgPath: string; iconId: number }> = [];
  const mappingWriteBacks: ResolvedFileOps['mappingWriteBacks'] = [];
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

  // Icon edits: any kept blueprint whose icon changed and has a .sbpcfg ending up in the game dir.
  for (const blueprint of Object.values(draft.blueprints)) {
    if (recycledIds.has(blueprint.id)) continue;
    if (!blueprint.hasSbp || !blueprint.hasCfg) continue;
    if (blueprint.iconId === null || blueprint.iconId === blueprint.originalIconId) continue;
    iconWrites.push({ cfgPath: gamePath(gameDir, blueprint.stem, BLUEPRINT_CONFIG_EXT), iconId: blueprint.iconId });
  }

  // Write-backs: manager-only blueprints the user chose to keep are copied into the external mapping
  // folder under their current category/subcategory (source = their final file in the game dir).
  if (draft.mappingDir) {
    for (const blueprint of Object.values(draft.blueprints)) {
      if (recycledIds.has(blueprint.id) || !blueprint.writeBackToMapping || !blueprint.hasSbp) continue;
      const located = locateBlueprint(draft, blueprint.id);
      if (!located) continue;
      const dir = path.join(draft.mappingDir, sanitizeSegment(located.category.name), sanitizeSegment(located.subcategory.name));
      mappingWriteBacks.push({
        fromSbp: gamePath(gameDir, blueprint.stem, BLUEPRINT_EXT),
        toSbp: path.join(dir, `${blueprint.stem}${BLUEPRINT_EXT}`),
        fromCfg: blueprint.hasCfg ? gamePath(gameDir, blueprint.stem, BLUEPRINT_CONFIG_EXT) : null,
        toCfg: blueprint.hasCfg ? path.join(dir, `${blueprint.stem}${BLUEPRINT_CONFIG_EXT}`) : null
      });
    }
  }

  return { copies, renames, deletions, removedStems, saveOnly, iconWrites, mappingWriteBacks, notices };
}
