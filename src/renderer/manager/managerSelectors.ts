import {
  findSubcategory,
  isRecycleCategory,
  makeId,
  type DraftBlueprint,
  type DraftSubcategory,
  type DraftTree
} from '../../shared/draftModel';

// 草稿管理器的纯派生逻辑（不依赖 React / DOM）：从草稿 + 当前选择 + 搜索词推导可见蓝图、
// 粘贴目标、复制副本等。抽出独立模块便于单测，组件只负责渲染与事件。

export type Selection = { type: 'category'; id: string } | { type: 'subcategory'; id: string } | null;

export interface VisibleGroup {
  key: string;
  title: string | null;
  blueprints: DraftBlueprint[];
}

// 当前应在网格中展示的蓝图分组：有搜索词时全局按名过滤（排除回收站）；否则按选中的
// 子分类（单组）或分类（每个子分类一组）展开。
export function computeVisibleBlueprints(draft: DraftTree, selection: Selection, search: string, recycledIds: Set<string>): { groups: VisibleGroup[] } {
  const needle = search.trim().toLowerCase();
  if (needle) {
    const matches = Object.values(draft.blueprints).filter((blueprint) => !recycledIds.has(blueprint.id) && blueprint.stem.toLowerCase().includes(needle));
    return { groups: [{ key: 'search', title: null, blueprints: matches }] };
  }
  if (selection?.type === 'subcategory') {
    const found = findSubcategory(draft, selection.id);
    if (!found) return { groups: [] };
    return { groups: [{ key: found.subcategory.id, title: null, blueprints: resolveBlueprints(draft, found.subcategory) }] };
  }
  if (selection?.type === 'category') {
    const category = draft.categories.find((item) => item.id === selection.id);
    if (!category) return { groups: [] };
    return {
      groups: category.subcategories.map((subcategory) => ({
        key: subcategory.id,
        title: subcategory.name,
        blueprints: resolveBlueprints(draft, subcategory)
      }))
    };
  }
  return { groups: [] };
}

export function resolveBlueprints(draft: DraftTree, subcategory: DraftSubcategory): DraftBlueprint[] {
  return subcategory.blueprintIds.map((id) => draft.blueprints[id]).filter((blueprint): blueprint is DraftBlueprint => Boolean(blueprint));
}

// 粘贴目标子分类：选中子分类时即其本身；选中分类时取首个子分类；回收站不可作为目标。
export function resolvePasteTargetSubId(draft: DraftTree, selection: Selection): string | null {
  if (selection?.type === 'subcategory') {
    const found = findSubcategory(draft, selection.id);
    if (found && !isRecycleCategory(found.category)) return found.subcategory.id;
    return null;
  }
  if (selection?.type === 'category') {
    const category = draft.categories.find((item) => item.id === selection.id);
    if (category && !isRecycleCategory(category)) return category.subcategories[0]?.id ?? null;
  }
  return null;
}

// 复制一个蓝图为新的 external 副本：来源是游戏目录的蓝图则按 originalStem 拼出原始文件路径，
// external 来源则沿用其暂存路径。新副本指向同一源文件，apply 时复制成新名字。
export function makeCopyBlueprint(draft: DraftTree, source: DraftBlueprint, newStem: string): DraftBlueprint {
  const sep = draft.gameBlueprintDir.includes('\\') ? '\\' : '/';
  const sourceSbpPath = source.origin === 'external' ? source.sourceSbpPath : `${draft.gameBlueprintDir}${sep}${source.originalStem}.sbp`;
  const sourceCfgPath = source.origin === 'external' ? source.sourceCfgPath : source.hasCfg ? `${draft.gameBlueprintDir}${sep}${source.originalStem}.sbpcfg` : null;
  return {
    id: makeId('bp'),
    stem: newStem,
    originalStem: newStem,
    origin: 'external',
    sourceSbpPath,
    sourceCfgPath,
    hasSbp: true,
    hasCfg: source.hasCfg,
    iconId: source.iconId,
    originalIconId: source.iconId,
    warnings: []
  };
}

// 在已有名字集合中取一个不冲突的名字（base、base 2、base 3 ...）。
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
