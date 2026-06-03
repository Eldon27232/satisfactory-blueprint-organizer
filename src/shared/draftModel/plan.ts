import { isRecycleCategory } from './recycle';
import type { Notice } from '../types';
import type { DraftTree } from './types';

// CategoryPlan — declarative desired state consumed by the apply core.

export interface CategoryPlanSubcategory {
  name: string;
  menuPriority: number;
  blueprintStems: string[];
}

export interface CategoryPlanEntry {
  category: string;
  iconId: number | null;
  menuPriority: number;
  subcategories: CategoryPlanSubcategory[];
}

export type CategoryPlan = CategoryPlanEntry[];

export function computeCategoryPlan(tree: DraftTree): CategoryPlan {
  return tree.categories.filter((category) => !isRecycleCategory(category)).map((category, categoryIndex) => ({
    category: category.name.trim(),
    iconId: category.iconId,
    menuPriority: categoryIndex,
    subcategories: category.subcategories.map((subcategory, subIndex) => ({
      name: subcategory.name.trim(),
      menuPriority: subIndex,
      blueprintStems: subcategory.blueprintIds
        .map((id) => tree.blueprints[id]?.stem.trim())
        .filter((stem): stem is string => Boolean(stem))
    }))
  }));
}

// File-op summary (logical, path-free — for the confirm UI counts).
export interface FileOpSummary {
  copies: Array<{ stem: string; cfg: boolean }>;
  renames: Array<{ from: string; to: string; cfg: boolean }>;
  saveOnly: string[];
}

// Apply preview / options (filled in by the apply core, shown on the confirm page).
export interface DraftApplyOptions {
  draft: DraftTree;
  gameClosedConfirmed: boolean;
}

export interface DraftApplyPlan {
  savePath: string | null;
  sessionName: string | null;
  gameBlueprintDir: string;
  categoryPlan: CategoryPlan;
  iconUpdates: Array<{ category: string; iconId: number }>;
  copies: Array<{ from: string; to: string; cfg: boolean }>;
  renames: Array<{ from: string; to: string; cfg: boolean }>;
  /** Files removed because their blueprint was put in the recycle bin. */
  deletions: string[];
  saveOnly: string[];
  /** Files written back into the external mapping folder (kept manager-only blueprints). */
  writeBacks: string[];
  notices: Notice[];
  /** True only when there are no blocking errors and a writable save is selected. */
  canApply: boolean;
}

export function summarizeFileOps(tree: DraftTree): FileOpSummary {
  const copies: FileOpSummary['copies'] = [];
  const renames: FileOpSummary['renames'] = [];
  const saveOnly: string[] = [];
  for (const blueprint of Object.values(tree.blueprints)) {
    if (!blueprint.hasSbp) {
      saveOnly.push(blueprint.stem);
      continue;
    }
    if (blueprint.origin === 'external') {
      copies.push({ stem: blueprint.stem, cfg: blueprint.hasCfg });
    } else if (blueprint.stem !== blueprint.originalStem) {
      renames.push({ from: blueprint.originalStem, to: blueprint.stem, cfg: blueprint.hasCfg });
    }
  }
  return { copies, renames, saveOnly };
}
