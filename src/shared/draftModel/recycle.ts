import { makeId } from './ids';
import { clone, nextAvailableStem } from './mutations';
import { findCategory, findSubcategory, locateBlueprint } from './lookup';
import { RECYCLE_BIN_ID, UNNAMED, type DraftCategory, type DraftSubcategory, type DraftTree } from './types';

// 回收站 = draft.recycleBin：草稿内独立子森林，结构与正常树同构（目录→子目录→蓝图）。
// 影子目录/影子子目录的「名字」即来源名（原目录名/原子目录名）—— 来源信息天然编码在层级里。
// 删除 = 把节点移进回收站对应影子位置；恢复 = 移回正常树（按来源名归位，缺失则兜底「未命名」）。
// apply 时回收站里的蓝图按 getRecycledBlueprintIdSet 真删文件；恢复 = 移出回收站 = 不删。

// 兜底顶层目录名（恢复孤儿子目录/蓝图、且原目录已不在时落脚处）。与子分类默认名一致。
const ORPHAN_CATEGORY = UNNAMED;

const sameName = (a: string, b: string): boolean => a.trim() === b.trim();

// 保留：新模型下 categories 里不再有回收站 category，本函数恒为 false。让旧的
// filter(!isRecycleCategory) / 拖拽 guard 自动无害，避免大面积改动。
export function isRecycleCategory(category: DraftCategory): boolean {
  return category.id === RECYCLE_BIN_ID;
}

// 保留：旧的「保持回收站末尾」调用（importMerge / reorder）。新模型回收站独立，find 不到 → no-op。
export function keepRecycleLast(tree: DraftTree): DraftTree {
  const bin = tree.categories.find(isRecycleCategory);
  if (!bin) return tree;
  tree.categories = [...tree.categories.filter((category) => !isRecycleCategory(category)), bin];
  return tree;
}

export function getRecycleBin(tree: DraftTree): DraftCategory[] {
  return tree.recycleBin ?? [];
}

export function getRecycledBlueprintIdSet(tree: DraftTree): Set<string> {
  const ids = new Set<string>();
  for (const category of tree.recycleBin ?? []) {
    for (const subcategory of category.subcategories) {
      for (const id of subcategory.blueprintIds) ids.add(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

function findOrCreateShadowCategory(bin: DraftCategory[], name: string): DraftCategory {
  const existing = bin.find((category) => sameName(category.name, name));
  if (existing) return existing;
  const category: DraftCategory = { id: makeId('rcat'), name, iconId: null, subcategories: [] };
  bin.push(category);
  return category;
}

function findOrCreateShadowSub(category: DraftCategory, name: string): DraftSubcategory {
  const existing = category.subcategories.find((subcategory) => sameName(subcategory.name, name));
  if (existing) return existing;
  const subcategory: DraftSubcategory = { id: makeId('rsub'), name, blueprintIds: [] };
  category.subcategories.push(subcategory);
  return subcategory;
}

// 把一段子目录并入目标目录：同名子目录合并 blueprintIds，否则整段加入。
function mergeSubcategoryInto(target: DraftCategory, sub: DraftSubcategory): void {
  const existing = target.subcategories.find((item) => sameName(item.name, sub.name));
  if (existing) {
    for (const id of sub.blueprintIds) if (!existing.blueprintIds.includes(id)) existing.blueprintIds.push(id);
  } else {
    target.subcategories.push(sub);
  }
}

function removeIdsFromTree(tree: DraftTree, ids: Set<string>): void {
  for (const category of tree.categories) {
    for (const subcategory of category.subcategories) {
      subcategory.blueprintIds = subcategory.blueprintIds.filter((id) => !ids.has(id));
    }
  }
}

// 正常树（不含回收站）现有 stem 的小写集合，用于恢复时保持平铺唯一。
function normalStemsLower(tree: DraftTree): Set<string> {
  const set = new Set<string>();
  for (const category of tree.categories) {
    for (const subcategory of category.subcategories) {
      for (const id of subcategory.blueprintIds) {
        const stem = tree.blueprints[id]?.stem.trim().toLowerCase();
        if (stem) set.add(stem);
      }
    }
  }
  return set;
}

// 取（或在末尾建）正常树里名为 name 的目录 / 目录下名为 name 的子目录。
function ensureCategoryByName(tree: DraftTree, name: string): DraftCategory {
  const existing = tree.categories.find((category) => sameName(category.name, name));
  if (existing) return existing;
  const category: DraftCategory = { id: makeId('cat'), name, iconId: null, subcategories: [] };
  tree.categories.push(category);
  return category;
}

function ensureSubByName(category: DraftCategory, name: string): DraftSubcategory {
  const existing = category.subcategories.find((subcategory) => sameName(subcategory.name, name));
  if (existing) return existing;
  const subcategory: DraftSubcategory = { id: makeId('sub'), name, blueprintIds: [] };
  category.subcategories.push(subcategory);
  return subcategory;
}

// 把若干蓝图放进正常树指定子目录，stem 冲突自动改名（追加 COPY_SUFFIX_CHAR）保持平铺唯一。
function placeBlueprints(tree: DraftTree, subcategory: DraftSubcategory, ids: string[], taken: Set<string>): void {
  for (const id of ids) {
    const blueprint = tree.blueprints[id];
    if (!blueprint) continue;
    if (taken.has(blueprint.stem.trim().toLowerCase())) {
      tree.blueprints[id] = { ...blueprint, stem: nextAvailableStem(blueprint.stem, taken) };
    }
    taken.add(tree.blueprints[id].stem.trim().toLowerCase());
    if (!subcategory.blueprintIds.includes(id)) subcategory.blueprintIds.push(id);
  }
}

// 从回收站移除空的影子子目录与空的影子目录。
function pruneEmptyShadows(bin: DraftCategory[]): DraftCategory[] {
  for (const category of bin) {
    category.subcategories = category.subcategories.filter((subcategory) => subcategory.blueprintIds.length > 0);
  }
  return bin.filter((category) => category.subcategories.length > 0);
}

// ---------------------------------------------------------------------------
// 删除（移入回收站）
// ---------------------------------------------------------------------------

// 拖蓝图 / 多选删：每个蓝图按各自来源归入 影子目录(原目录名)/影子子目录(原子目录名)。
export function recycleBlueprints(tree: DraftTree, blueprintIds: string[]): DraftTree {
  const ids = blueprintIds.filter((id) => tree.blueprints[id]);
  if (ids.length === 0) return tree;
  const next = clone(tree);
  const bin = next.recycleBin ?? [];
  for (const id of ids) {
    const located = locateBlueprint(next, id);
    const shadowCategory = findOrCreateShadowCategory(bin, located?.category.name ?? ORPHAN_CATEGORY);
    const shadowSub = findOrCreateShadowSub(shadowCategory, located?.subcategory.name ?? UNNAMED);
    if (!shadowSub.blueprintIds.includes(id)) shadowSub.blueprintIds.push(id);
  }
  removeIdsFromTree(next, new Set(ids));
  next.recycleBin = bin;
  return next;
}

// 删子目录（连蓝图）进回收站，挂到 名=原目录名 的影子目录下。
export function recycleSubcategory(tree: DraftTree, subcategoryId: string): DraftTree {
  if (!findSubcategory(tree, subcategoryId)) return tree;
  const next = clone(tree);
  const found = findSubcategory(next, subcategoryId);
  if (!found) return tree;
  const originCategoryName = found.category.name;
  const movingSub = found.subcategory;
  found.category.subcategories = found.category.subcategories.filter((sub) => sub.id !== subcategoryId);
  const bin = next.recycleBin ?? [];
  mergeSubcategoryInto(findOrCreateShadowCategory(bin, originCategoryName), movingSub);
  next.recycleBin = bin;
  return next;
}

// 删整个目录（连结构）进回收站；同名影子目录则逐子目录合并。
export function recycleCategory(tree: DraftTree, categoryId: string): DraftTree {
  if (!findCategory(tree, categoryId)) return tree;
  const next = clone(tree);
  const moving = findCategory(next, categoryId);
  if (!moving) return tree;
  next.categories = next.categories.filter((item) => item.id !== categoryId);
  const bin = next.recycleBin ?? [];
  const existing = bin.find((item) => sameName(item.name, moving.name));
  if (existing) {
    for (const sub of moving.subcategories) mergeSubcategoryInto(existing, sub);
  } else {
    bin.push(moving);
  }
  next.recycleBin = bin;
  return next;
}

// ---------------------------------------------------------------------------
// 恢复（移回正常树）
// ---------------------------------------------------------------------------

// 恢复整个影子目录 → 作为顶层目录放回（连子目录/蓝图）。同名目录则并入，否则新建顶层。
export function restoreRecycledCategory(tree: DraftTree, shadowCategoryId: string): DraftTree {
  if (!(tree.recycleBin ?? []).some((category) => category.id === shadowCategoryId)) return tree;
  const next = clone(tree);
  const bin = next.recycleBin ?? [];
  const shadow = bin.find((category) => category.id === shadowCategoryId);
  if (!shadow) return tree;
  next.recycleBin = bin.filter((category) => category.id !== shadowCategoryId);
  const taken = normalStemsLower(next);
  const target = next.categories.find((category) => sameName(category.name, shadow.name)) ?? null;
  const destination = target ?? { id: makeId('cat'), name: shadow.name, iconId: shadow.iconId, subcategories: [] };
  for (const sub of shadow.subcategories) {
    placeBlueprints(next, ensureSubByName(destination, sub.name), sub.blueprintIds, taken);
  }
  if (!target) next.categories.push(destination);
  return next;
}

// 恢复一个影子子目录 → 原目录(按名)在则放回，否则进「未命名」目录。
export function restoreRecycledSubcategory(tree: DraftTree, shadowCategoryId: string, shadowSubId: string): DraftTree {
  const next = clone(tree);
  const bin = next.recycleBin ?? [];
  const shadowCategory = bin.find((category) => category.id === shadowCategoryId);
  const shadowSub = shadowCategory?.subcategories.find((subcategory) => subcategory.id === shadowSubId);
  if (!shadowCategory || !shadowSub) return tree;
  shadowCategory.subcategories = shadowCategory.subcategories.filter((subcategory) => subcategory.id !== shadowSubId);
  next.recycleBin = pruneEmptyShadows(bin);
  const taken = normalStemsLower(next);
  const targetCategory = next.categories.find((category) => sameName(category.name, shadowCategory.name)) ?? ensureCategoryByName(next, ORPHAN_CATEGORY);
  placeBlueprints(next, ensureSubByName(targetCategory, shadowSub.name), shadowSub.blueprintIds, taken);
  return next;
}

// 恢复一组蓝图 → 原目录(按名;无则「未命名」目录)下 原子目录(按名;无则该目录「未命名」子目录)。
export function restoreRecycledBlueprints(tree: DraftTree, blueprintIds: string[]): DraftTree {
  const ids = blueprintIds.filter((id) => tree.blueprints[id]);
  if (ids.length === 0) return tree;
  const next = clone(tree);
  const bin = next.recycleBin ?? [];
  const taken = normalStemsLower(next);
  const idSet = new Set(ids);
  for (const shadowCategory of bin) {
    for (const shadowSub of shadowCategory.subcategories) {
      const toRestore = shadowSub.blueprintIds.filter((id) => idSet.has(id));
      if (toRestore.length === 0) continue;
      const targetCategory = next.categories.find((category) => sameName(category.name, shadowCategory.name)) ?? ensureCategoryByName(next, ORPHAN_CATEGORY);
      const existingSub = targetCategory.subcategories.find((subcategory) => sameName(subcategory.name, shadowSub.name));
      const destSub = existingSub ?? ensureSubByName(targetCategory, UNNAMED);
      placeBlueprints(next, destSub, toRestore, taken);
      shadowSub.blueprintIds = shadowSub.blueprintIds.filter((id) => !idSet.has(id));
    }
  }
  next.recycleBin = pruneEmptyShadows(bin);
  return next;
}
