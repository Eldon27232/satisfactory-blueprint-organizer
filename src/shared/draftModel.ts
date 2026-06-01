import type { Notice } from './types';

// ---------------------------------------------------------------------------
// Draft tree model
//
// Pure, dependency-free model shared by the renderer (live editing) and the
// main process (apply). It never touches the filesystem or the .sav parser —
// it only describes desired state and validates it. The core builders produce
// a DraftTree, the renderer mutates it through the pure helpers below, and the
// apply workflow turns it into a CategoryPlan + FilePlan.
// ---------------------------------------------------------------------------

export const UNNAMED = '未命名';
export const UNDEFINED_CATEGORY = 'Undefined';

// Recycle bin: a draft-only category that is never written to the game. Blueprints
// dropped here are excluded from the category plan and their files are deleted on apply.
export const RECYCLE_BIN_ID = 'recycle-bin';
export const RECYCLE_BIN_SUB_ID = 'recycle-bin-sub';
export const RECYCLE_BIN_NAME = '回收站';

// Appended (1, then 2, ...) to disambiguate pasted copies. U+2800 (Braille blank)
// is single-width, renders invisibly, and — unlike a normal space — is NOT stripped
// by trim(), so it never triggers the trailing-space mismatch bug.
export const COPY_SUFFIX_CHAR = '⠀';

export type DraftBlueprintOrigin = 'external' | 'gameDir' | 'save';

export interface DraftBlueprint {
  /** Stable identity for the lifetime of a draft session (survives renames). */
  id: string;
  /** Current (possibly renamed) file stem, without extension. */
  stem: string;
  /** Stem as it exists on disk / in the save before any edits. */
  originalStem: string;
  origin: DraftBlueprintOrigin;
  /** Absolute source .sbp path for external imports; null when the file already lives in the game dir. */
  sourceSbpPath: string | null;
  sourceCfgPath: string | null;
  /** Whether a physical .sbp file exists to copy/rename. False for save-only names. */
  hasSbp: boolean;
  hasCfg: boolean;
  /** FGIconLibrary icon id read from the blueprint's .sbpcfg (config.iconID), or null. */
  iconId: number | null;
  /** Icon id as it exists in the .sbpcfg before edits; apply only rewrites a cfg when iconId differs from this. */
  originalIconId: number | null;
  /** Manager-only blueprint the user chose to keep: on apply its files are written back into the external mapping folder. */
  writeBackToMapping?: boolean;
  warnings: Notice[];
}

export interface DraftSubcategory {
  id: string;
  name: string;
  /** Blueprint ids in display order. A blueprint id appears in exactly one subcategory. */
  blueprintIds: string[];
}

export interface DraftCategory {
  id: string;
  name: string;
  /** FGIconLibrary integer id, or null to leave the existing IconID untouched. */
  iconId: number | null;
  /** Icon id read from the save before edits; used to report only genuinely changed category icons. */
  originalIconId?: number | null;
  subcategories: DraftSubcategory[];
}

export interface DraftTree {
  categories: DraftCategory[];
  /** id -> blueprint metadata. */
  blueprints: Record<string, DraftBlueprint>;
  /** Game blueprint dir these blueprints belong to (used to resolve gameDir file paths). */
  gameBlueprintDir: string;
  /** Target .sav this draft was built against, if any. */
  savePath: string | null;
  sessionName: string | null;
  /** Notices produced while building the draft (import-time warnings, icon issues, ...). */
  buildNotices: Notice[];
  /** True when the manager tree has unapplied manual edits (persisted per-save in app data). */
  dirty?: boolean;
  /** External mapping folder this draft was last diffed against; target for write-backs on apply. */
  mappingDir?: string;
}

// ---------------------------------------------------------------------------
// Id generation (session-local uniqueness is all that's required)
// ---------------------------------------------------------------------------

let idCounter = 0;

// Ids must be unique across BOTH processes: the draft is built in the main
// process, then the renderer creates more nodes. A per-process counter would
// collide (main cat-1 vs renderer cat-1), so prefer a UUID when available.
export function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findCategory(tree: DraftTree, categoryId: string): DraftCategory | undefined {
  return tree.categories.find((category) => category.id === categoryId);
}

export function findSubcategory(tree: DraftTree, subcategoryId: string): { category: DraftCategory; subcategory: DraftSubcategory } | undefined {
  for (const category of tree.categories) {
    const subcategory = category.subcategories.find((item) => item.id === subcategoryId);
    if (subcategory) return { category, subcategory };
  }
  return undefined;
}

export function locateBlueprint(tree: DraftTree, blueprintId: string): { category: DraftCategory; subcategory: DraftSubcategory } | undefined {
  for (const category of tree.categories) {
    for (const subcategory of category.subcategories) {
      if (subcategory.blueprintIds.includes(blueprintId)) return { category, subcategory };
    }
  }
  return undefined;
}

export function countBlueprintsInCategory(category: DraftCategory): number {
  return category.subcategories.reduce((sum, subcategory) => sum + subcategory.blueprintIds.length, 0);
}

// ---------------------------------------------------------------------------
// Mutations (return a new tree; never mutate the argument)
// ---------------------------------------------------------------------------

function clone(tree: DraftTree): DraftTree {
  return {
    ...tree,
    categories: tree.categories.map((category) => ({
      ...category,
      subcategories: category.subcategories.map((subcategory) => ({
        ...subcategory,
        blueprintIds: [...subcategory.blueprintIds]
      }))
    })),
    blueprints: { ...tree.blueprints }
  };
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

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------

export function isRecycleCategory(category: DraftCategory): boolean {
  return category.id === RECYCLE_BIN_ID;
}

export function getRecycleBin(tree: DraftTree): DraftCategory | undefined {
  return tree.categories.find(isRecycleCategory);
}

export function ensureRecycleBin(tree: DraftTree): DraftTree {
  if (getRecycleBin(tree)) return tree;
  const next = clone(tree);
  next.categories.push({
    id: RECYCLE_BIN_ID,
    name: RECYCLE_BIN_NAME,
    iconId: null,
    subcategories: [{ id: RECYCLE_BIN_SUB_ID, name: RECYCLE_BIN_NAME, blueprintIds: [] }]
  });
  return next;
}

export function recycleBlueprints(tree: DraftTree, blueprintIds: string[]): DraftTree {
  return moveBlueprints(ensureRecycleBin(tree), blueprintIds, RECYCLE_BIN_SUB_ID);
}

export function getRecycledBlueprintIdSet(tree: DraftTree): Set<string> {
  const bin = getRecycleBin(tree);
  if (!bin) return new Set();
  return new Set(bin.subcategories.flatMap((subcategory) => subcategory.blueprintIds));
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

/** Smallest unique stem: append COPY_SUFFIX_CHAR once, then twice, ... until free. */
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

// ---------------------------------------------------------------------------
// Reordering (drag categories / subcategories to sort)
// ---------------------------------------------------------------------------

function keepRecycleLast(tree: DraftTree): DraftTree {
  const bin = tree.categories.find(isRecycleCategory);
  if (!bin) return tree;
  tree.categories = [...tree.categories.filter((category) => !isRecycleCategory(category)), bin];
  return tree;
}

export function reorderCategory(tree: DraftTree, draggedId: string, targetId: string): DraftTree {
  if (draggedId === targetId) return tree;
  const next = clone(tree);
  const dragged = next.categories.find((category) => category.id === draggedId);
  if (!dragged || isRecycleCategory(dragged)) return tree;
  next.categories = next.categories.filter((category) => category.id !== draggedId);
  const targetIndex = next.categories.findIndex((category) => category.id === targetId);
  if (targetIndex < 0) return tree;
  next.categories.splice(targetIndex, 0, dragged);
  return keepRecycleLast(next);
}

export function reorderSubcategory(tree: DraftTree, draggedSubId: string, targetSubId: string): DraftTree {
  if (draggedSubId === targetSubId) return tree;
  const next = clone(tree);
  const dragFound = findSubcategory(next, draggedSubId);
  const targetFound = findSubcategory(next, targetSubId);
  if (!dragFound || !targetFound) return tree;
  if (isRecycleCategory(dragFound.category) || isRecycleCategory(targetFound.category)) return tree;
  const sourceCategory = findCategory(next, dragFound.category.id);
  const movingSub = sourceCategory?.subcategories.find((subcategory) => subcategory.id === draggedSubId);
  if (!sourceCategory || !movingSub) return tree;
  sourceCategory.subcategories = sourceCategory.subcategories.filter((subcategory) => subcategory.id !== draggedSubId);
  const targetCategory = findCategory(next, targetFound.category.id);
  if (!targetCategory) return tree;
  const insertIndex = targetCategory.subcategories.findIndex((subcategory) => subcategory.id === targetSubId);
  targetCategory.subcategories.splice(insertIndex < 0 ? targetCategory.subcategories.length : insertIndex, 0, movingSub);
  return next;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Reject Windows-illegal filename characters and control characters only.
// Spaces and hyphens are legal in blueprint stems.
const illegalWindowsNamePattern = /[<>:"/\\|?* -]/;

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

// ---------------------------------------------------------------------------
// CategoryPlan — declarative desired state consumed by the apply core
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File-op summary (logical, path-free — for the confirm UI counts)
// ---------------------------------------------------------------------------

export interface FileOpSummary {
  copies: Array<{ stem: string; cfg: boolean }>;
  renames: Array<{ from: string; to: string; cfg: boolean }>;
  saveOnly: string[];
}

// ---------------------------------------------------------------------------
// Apply preview / options (filled in by the apply core, shown on the confirm page)
// ---------------------------------------------------------------------------

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
