import type { BlueprintMappingEntry } from './types';
import {
  getRecycledBlueprintIdSet,
  makeId,
  recycleBlueprints,
  UNNAMED,
  type DraftBlueprint,
  type DraftCategory,
  type DraftSubcategory,
  type DraftTree
} from './draftModel';

export interface MappingDiff {
  /** In the external mapping folder but not in the manager tree → will be copied into the game dir on apply. */
  externalOnly: BlueprintMappingEntry[];
  /** In the manager tree (with a real file) but not in the external folder → user chooses delete or keep. */
  managerOnly: DraftBlueprint[];
  /** Count of blueprints present on both sides (left untouched). */
  bothCount: number;
}

function norm(stem: string): string {
  return stem.trim().toLowerCase();
}

/** Compare the current manager tree against an external mapping scan, keyed by file-name stem. */
export function computeMappingDiff(draft: DraftTree, entries: BlueprintMappingEntry[]): MappingDiff {
  const recycled = getRecycledBlueprintIdSet(draft);
  const draftByStem = new Map<string, DraftBlueprint>();
  for (const blueprint of Object.values(draft.blueprints)) {
    if (recycled.has(blueprint.id)) continue;
    draftByStem.set(norm(blueprint.stem), blueprint);
  }
  const externalStems = new Set(entries.map((entry) => norm(entry.blueprintStem)));
  const externalOnly = entries.filter((entry) => !draftByStem.has(norm(entry.blueprintStem)));
  const managerOnly = [...draftByStem.values()].filter((blueprint) => blueprint.hasSbp && !externalStems.has(norm(blueprint.stem)));
  return { externalOnly, managerOnly, bothCount: entries.length - externalOnly.length };
}

function ensureCategoryByName(tree: DraftTree, name: string): DraftCategory {
  let category = tree.categories.find((item) => item.name === name && item.id !== 'recycle-bin');
  if (!category) {
    category = { id: makeId('cat'), name, iconId: null, subcategories: [] };
    tree.categories.push(category);
  }
  return category;
}

function ensureSubcategoryByName(category: DraftCategory, name: string): DraftSubcategory {
  let subcategory = category.subcategories.find((item) => item.name === name);
  if (!subcategory) {
    subcategory = { id: makeId('sub'), name, blueprintIds: [] };
    category.subcategories.push(subcategory);
  }
  return subcategory;
}

/**
 * Merge a resolved diff back into the draft:
 *  - delete: managerOnly blueprints the user dropped (recycled).
 *  - keep: managerOnly blueprints flagged to write back into the mapping folder on apply.
 *  - externalOnly: added as external blueprints under their mapped category/subcategory.
 */
export function mergeMappingDiff(
  draft: DraftTree,
  mappingDir: string,
  externalOnly: BlueprintMappingEntry[],
  keepManagerIds: string[],
  deleteManagerIds: string[]
): DraftTree {
  let next = recycleBlueprints(draft, deleteManagerIds);
  next = {
    ...next,
    mappingDir,
    categories: next.categories.map((category) => ({
      ...category,
      subcategories: category.subcategories.map((subcategory) => ({ ...subcategory, blueprintIds: [...subcategory.blueprintIds] }))
    })),
    blueprints: { ...next.blueprints }
  };

  for (const id of keepManagerIds) {
    const blueprint = next.blueprints[id];
    if (blueprint) next.blueprints[id] = { ...blueprint, writeBackToMapping: true };
  }

  for (const entry of externalOnly) {
    const category = ensureCategoryByName(next, entry.category || UNNAMED);
    const subcategory = ensureSubcategoryByName(category, entry.subcategory || UNNAMED);
    const blueprint: DraftBlueprint = {
      id: makeId('bp'),
      stem: entry.blueprintStem,
      originalStem: entry.blueprintStem,
      origin: 'external',
      sourceSbpPath: entry.sourceSbpPath,
      sourceCfgPath: entry.sourceCfgPath,
      hasSbp: true,
      hasCfg: Boolean(entry.sourceCfgPath),
      iconId: null,
      originalIconId: null,
      warnings: entry.warnings
    };
    next.blueprints[blueprint.id] = blueprint;
    subcategory.blueprintIds.push(blueprint.id);
  }

  return next;
}
