import { makeId } from './ids';
import { allStemsLower, clone, nextAvailableStem } from './mutations';
import { isRecycleCategory, keepRecycleLast } from './recycle';
import type { DraftCategory, DraftSubcategory, DraftTree } from './types';

// Structured import (zip): merge blueprints carrying their own category/subcategory names into the
// tree, creating categories/subcategories on demand and merging by name into existing ones.
// （COPY_SUFFIX_CHAR / nextAvailableStem / allStemsLower 已下沉到 mutations，供此处与 recycle 复用。）

export interface ImportedBlueprintInput {
  category: string;
  subcategory: string;
  stem: string;
  /** Absolute path to the staged source .sbp (copied into app-data, safe until apply). */
  sourceSbpPath: string;
  sourceCfgPath: string;
  iconId: number | null;
}

function findOrCreateCategoryByName(tree: DraftTree, name: string): DraftCategory {
  const trimmed = name.trim();
  const existing = tree.categories.find((category) => !isRecycleCategory(category) && category.name.trim() === trimmed);
  if (existing) return existing;
  const category: DraftCategory = { id: makeId('cat'), name, iconId: null, subcategories: [] };
  const binIndex = tree.categories.findIndex(isRecycleCategory);
  if (binIndex >= 0) tree.categories.splice(binIndex, 0, category);
  else tree.categories.push(category);
  return category;
}

function findOrCreateSubcategoryByName(category: DraftCategory, name: string): DraftSubcategory {
  const trimmed = name.trim();
  const existing = category.subcategories.find((subcategory) => subcategory.name.trim() === trimmed);
  if (existing) return existing;
  const subcategory: DraftSubcategory = { id: makeId('sub'), name, blueprintIds: [] };
  category.subcategories.push(subcategory);
  return subcategory;
}

/**
 * Merge imported blueprints into the tree by their carried category/subcategory names.
 * Same-named categories/subcategories merge; new ones are created (before the recycle bin).
 * Stems are de-duplicated against the whole tree so the flat game dir stays unique.
 */
export function mergeImportedBlueprints(tree: DraftTree, inputs: ImportedBlueprintInput[]): DraftTree {
  if (inputs.length === 0) return tree;
  const next = clone(tree);
  const taken = allStemsLower(next);
  for (const input of inputs) {
    const category = findOrCreateCategoryByName(next, input.category);
    const subcategory = findOrCreateSubcategoryByName(category, input.subcategory);
    const stem = nextAvailableStem(input.stem, taken);
    taken.add(stem.trim().toLowerCase());
    const id = makeId('bp');
    next.blueprints[id] = {
      id,
      stem,
      originalStem: input.stem,
      origin: 'external',
      sourceSbpPath: input.sourceSbpPath,
      sourceCfgPath: input.sourceCfgPath,
      hasSbp: true,
      hasCfg: true,
      iconId: input.iconId,
      originalIconId: input.iconId,
      warnings: []
    };
    subcategory.blueprintIds.push(id);
  }
  return keepRecycleLast(next);
}
