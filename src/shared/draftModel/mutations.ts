import { makeId } from './ids';
import { countBlueprintsInCategory, findCategory, findSubcategory } from './lookup';
import { UNNAMED, type DraftBlueprint, type DraftCategory, type DraftTree } from './types';

// Mutations: return a new tree, never mutate the argument. `clone` is the shared deep-ish copy
// (categories/subcategories/blueprintIds arrays + blueprints map) reused by recycle/import/reorder.

export function cloneCategory(category: DraftCategory): DraftCategory {
  return {
    ...category,
    subcategories: category.subcategories.map((subcategory) => ({
      ...subcategory,
      blueprintIds: [...subcategory.blueprintIds]
    }))
  };
}

export function clone(tree: DraftTree): DraftTree {
  return {
    ...tree,
    categories: tree.categories.map(cloneCategory),
    // 回收站是独立子森林，clone 必须一并深拷，否则 mutation 会污染原 tree。
    recycleBin: tree.recycleBin ? tree.recycleBin.map(cloneCategory) : undefined,
    blueprints: { ...tree.blueprints }
  };
}

// Smallest unique stem: append COPY_SUFFIX_CHAR once, then twice, ... until free.
// U+2800 (Braille blank) is single-width, renders invisibly, and — unlike a normal space —
// is NOT stripped by trim(), so it never triggers the trailing-space mismatch bug.
// （下沉到 mutations：importMerge 与 recycle 都要用，放这里避免两者循环依赖。）
export const COPY_SUFFIX_CHAR = '⠀';

export function nextAvailableStem(baseStem: string, takenLower: Set<string>): string {
  let candidate = baseStem;
  let suffix = '';
  while (takenLower.has(candidate.toLowerCase())) {
    suffix += COPY_SUFFIX_CHAR;
    candidate = baseStem + suffix;
  }
  return candidate;
}

export function allStemsLower(tree: DraftTree): Set<string> {
  return new Set(Object.values(tree.blueprints).map((blueprint) => blueprint.stem.trim().toLowerCase()));
}

export function createCategory(tree: DraftTree, name: string): DraftTree {
  const next = clone(tree);
  const category: DraftCategory = {
    id: makeId('cat'),
    name,
    iconId: null,
    subcategories: [{ id: makeId('sub'), name: UNNAMED, blueprintIds: [] }]
  };
  next.categories.push(category);
  return next;
}

export function createSubcategory(tree: DraftTree, categoryId: string, name: string): DraftTree {
  const next = clone(tree);
  const category = findCategory(next, categoryId);
  if (!category) return tree;
  category.subcategories.push({ id: makeId('sub'), name, blueprintIds: [] });
  return next;
}

export function renameCategory(tree: DraftTree, categoryId: string, name: string): DraftTree {
  const next = clone(tree);
  const category = findCategory(next, categoryId);
  if (!category) return tree;
  category.name = name;
  return next;
}

export function renameSubcategory(tree: DraftTree, subcategoryId: string, name: string): DraftTree {
  const next = clone(tree);
  const found = findSubcategory(next, subcategoryId);
  if (!found) return tree;
  found.subcategory.name = name;
  return next;
}

export function setCategoryIcon(tree: DraftTree, categoryId: string, iconId: number | null): DraftTree {
  const next = clone(tree);
  const category = findCategory(next, categoryId);
  if (!category) return tree;
  category.iconId = iconId;
  return next;
}

/** Change a single blueprint's icon (written into its .sbpcfg on apply). */
export function setBlueprintIcon(tree: DraftTree, blueprintId: string, iconId: number | null): DraftTree {
  const blueprint = tree.blueprints[blueprintId];
  if (!blueprint) return tree;
  const next = clone(tree);
  next.blueprints[blueprintId] = { ...blueprint, iconId };
  return next;
}

/** Delete a category only when it holds no blueprints. */
export function deleteCategory(tree: DraftTree, categoryId: string): { tree: DraftTree; ok: boolean; reason?: string } {
  const category = findCategory(tree, categoryId);
  if (!category) return { tree, ok: false, reason: 'not-found' };
  if (countBlueprintsInCategory(category) > 0) return { tree, ok: false, reason: 'not-empty' };
  const next = clone(tree);
  next.categories = next.categories.filter((item) => item.id !== categoryId);
  return { tree: next, ok: true };
}

/** Delete a subcategory only when it holds no blueprints. */
export function deleteSubcategory(tree: DraftTree, subcategoryId: string): { tree: DraftTree; ok: boolean; reason?: string } {
  const found = findSubcategory(tree, subcategoryId);
  if (!found) return { tree, ok: false, reason: 'not-found' };
  if (found.subcategory.blueprintIds.length > 0) return { tree, ok: false, reason: 'not-empty' };
  const next = clone(tree);
  const category = findCategory(next, found.category.id);
  if (category) category.subcategories = category.subcategories.filter((item) => item.id !== subcategoryId);
  return { tree: next, ok: true };
}

/**
 * Delete a non-empty subcategory after confirmation: its blueprints are moved to
 * a sibling subcategory (or a freshly created 未命名 one) so no blueprint/file is lost.
 */
export function deleteSubcategoryWithContents(tree: DraftTree, subcategoryId: string): DraftTree {
  const found = findSubcategory(tree, subcategoryId);
  if (!found) return tree;
  const next = clone(tree);
  const category = findCategory(next, found.category.id);
  const target = category?.subcategories.find((item) => item.id === subcategoryId);
  if (!category || !target) return tree;
  let destination = category.subcategories.find((item) => item.id !== subcategoryId);
  if (!destination) {
    destination = { id: makeId('sub'), name: UNNAMED, blueprintIds: [] };
    category.subcategories.push(destination);
  }
  for (const id of target.blueprintIds) {
    if (!destination.blueprintIds.includes(id)) destination.blueprintIds.push(id);
  }
  category.subcategories = category.subcategories.filter((item) => item.id !== subcategoryId);
  return next;
}

/**
 * 解散子分类：把它的蓝图并入本目录的「未命名」子分类（无则新建），再删掉该子分类。
 * 用于「删子目录 → 并进本目录·未命名」选项（蓝图留在本目录、不删文件）。
 */
export function mergeSubcategoryIntoUnnamed(tree: DraftTree, subcategoryId: string): DraftTree {
  const found = findSubcategory(tree, subcategoryId);
  if (!found) return tree;
  const next = clone(tree);
  const category = findCategory(next, found.category.id);
  const target = category?.subcategories.find((sub) => sub.id === subcategoryId);
  if (!category || !target) return tree;
  let unnamed = category.subcategories.find((sub) => sub.id !== subcategoryId && sub.name.trim() === UNNAMED);
  if (!unnamed) {
    unnamed = { id: makeId('sub'), name: UNNAMED, blueprintIds: [] };
    category.subcategories.push(unnamed);
  }
  for (const id of target.blueprintIds) if (!unnamed.blueprintIds.includes(id)) unnamed.blueprintIds.push(id);
  category.subcategories = category.subcategories.filter((sub) => sub.id !== subcategoryId);
  return next;
}

export function renameBlueprint(tree: DraftTree, blueprintId: string, stem: string): DraftTree {
  const blueprint = tree.blueprints[blueprintId];
  if (!blueprint) return tree;
  const next = clone(tree);
  next.blueprints[blueprintId] = { ...blueprint, stem };
  return next;
}

/** Move one or more blueprints into a target subcategory, preserving order and single membership. */
export function moveBlueprints(tree: DraftTree, blueprintIds: string[], targetSubcategoryId: string): DraftTree {
  const target = findSubcategory(tree, targetSubcategoryId);
  if (!target) return tree;
  const moving = new Set(blueprintIds.filter((id) => tree.blueprints[id]));
  if (moving.size === 0) return tree;
  const next = clone(tree);
  for (const category of next.categories) {
    for (const subcategory of category.subcategories) {
      subcategory.blueprintIds = subcategory.blueprintIds.filter((id) => !moving.has(id));
    }
  }
  const targetSub = findSubcategory(next, targetSubcategoryId);
  if (!targetSub) return tree;
  for (const id of blueprintIds) {
    if (moving.has(id) && !targetSub.subcategory.blueprintIds.includes(id)) {
      targetSub.subcategory.blueprintIds.push(id);
    }
  }
  return next;
}

/** Add freshly-built blueprints (e.g. pasted copies) into a target subcategory. */
export function addBlueprints(tree: DraftTree, newBlueprints: DraftBlueprint[], targetSubcategoryId: string): DraftTree {
  const target = findSubcategory(tree, targetSubcategoryId);
  if (!target || newBlueprints.length === 0) return tree;
  const next = clone(tree);
  for (const blueprint of newBlueprints) next.blueprints[blueprint.id] = blueprint;
  const targetSub = findSubcategory(next, targetSubcategoryId);
  if (targetSub) targetSub.subcategory.blueprintIds.push(...newBlueprints.map((blueprint) => blueprint.id));
  return next;
}
