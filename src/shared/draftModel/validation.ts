import { getRecycledBlueprintIdSet, isRecycleCategory } from './recycle';
import type { Notice } from '../types';
import type { DraftBlueprint, DraftTree } from './types';

// Reject only Windows-illegal filename characters (< > : " / \ | ? *) and control chars.
// Spaces and hyphens ARE legal in blueprint stems — they must NOT be in this class, otherwise
// every name like "Storage Mk 2" or "Belt-A" is wrongly flagged (the 556-false-positives bug).
const illegalWindowsNamePattern = /[<>:"/\\|?*\x00-\x1f]/;

export interface DraftValidationResult {
  notices: Notice[];
  /** blueprint ids that collide on final stem or have illegal names (rendered red). */
  conflictBlueprintIds: Set<string>;
  hasBlockingError: boolean;
}

export function validateDraft(tree: DraftTree): DraftValidationResult {
  const notices: Notice[] = [];
  const conflictBlueprintIds = new Set<string>();
  const recycledIds = getRecycledBlueprintIdSet(tree);
  const liveBlueprints = Object.values(tree.blueprints).filter((blueprint) => !recycledIds.has(blueprint.id));

  // Illegal / empty stems.
  for (const blueprint of liveBlueprints) {
    const stem = blueprint.stem.trim();
    if (stem.length === 0 || illegalWindowsNamePattern.test(blueprint.stem)) {
      conflictBlueprintIds.add(blueprint.id);
      notices.push({
        severity: 'error',
        code: 'ILLEGAL_BLUEPRINT_NAME',
        message: `蓝图名 "${blueprint.stem}" 为空或包含 Windows 非法字符。`
      });
    }
  }

  // Duplicate final stems across the whole (flat) game dir.
  const byStem = new Map<string, DraftBlueprint[]>();
  for (const blueprint of liveBlueprints) {
    const key = blueprint.stem.trim().toLowerCase();
    if (!key) continue;
    byStem.set(key, [...(byStem.get(key) ?? []), blueprint]);
  }
  for (const [, group] of byStem) {
    if (group.length <= 1) continue;
    for (const blueprint of group) conflictBlueprintIds.add(blueprint.id);
    notices.push({
      severity: 'error',
      code: 'DUPLICATE_BLUEPRINT_STEM',
      message: `蓝图名冲突："${group[0].stem}" 出现 ${group.length} 次。游戏蓝图目录是平铺的，名称必须唯一。`
    });
  }

  // Illegal category / subcategory names.
  for (const category of tree.categories) {
    if (isRecycleCategory(category)) continue;
    if (category.name.trim().length === 0) {
      notices.push({ severity: 'error', code: 'ILLEGAL_CATEGORY_NAME', message: '分类名不能为空。' });
    }
    for (const subcategory of category.subcategories) {
      if (subcategory.name.trim().length === 0) {
        notices.push({ severity: 'error', code: 'ILLEGAL_SUBCATEGORY_NAME', message: `分类 "${category.name}" 下有子分类名为空。` });
      }
    }
  }

  // Duplicate category names (they would merge in-game; warn).
  const categoryNameCounts = new Map<string, number>();
  for (const category of tree.categories) {
    if (isRecycleCategory(category)) continue;
    const key = category.name.trim();
    categoryNameCounts.set(key, (categoryNameCounts.get(key) ?? 0) + 1);
  }
  for (const [name, count] of categoryNameCounts) {
    if (count > 1) notices.push({ severity: 'warning', code: 'DUPLICATE_CATEGORY_NAME', message: `存在 ${count} 个同名分类 "${name}"，写入时会被合并。` });
  }

  const hasBlockingError = notices.some((notice) => notice.severity === 'error');
  return { notices, conflictBlueprintIds, hasBlockingError };
}
