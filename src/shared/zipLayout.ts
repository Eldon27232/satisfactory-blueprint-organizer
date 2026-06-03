import { UNNAMED } from './draftModel';

// 压缩包分层分析（纯函数，无副作用）。
//
// zip 解压后每个蓝图带一串目录段 dirSegments（从 zip 根到该文件父目录，已 GBK 解码）。
// 用户在向导里选「目录层 C」「子目录层 S」，本模块负责：
//   - 分析层级结构（最大深度、每层文件夹、某目录层是否「干净可选」）
//   - 把单个蓝图按 (C, S) 映射到 分类/子分类，或判定为「丢弃」
//   - 生成实时预览树
//   - 给出智能默认层
//
// 层级约定（1-based 文件夹深度）：
//   level 0 = zip 根（目录层选 0 表示「整个压缩包」作单一分类，名取 zipName）
//   level k = dirSegments[k-1]
//   一个蓝图「到达 level k」⟺ dirSegments.length >= k
//   一个蓝图的深度 = dirSegments.length

export interface ZipLayoutItem {
  dirSegments: string[];
  stem: string;
}

export interface PreviewCategory {
  name: string;
  subcategories: Array<{ name: string; count: number }>;
}

export interface LayoutPreview {
  categories: PreviewCategory[];
  imported: number;
  discarded: number;
}

export interface CategoryLevelDiscard {
  /** 浅于目录层、无法归类而被丢弃的蓝图数。 */
  discardedBlueprints: number;
  /** 目录层之上存在分叉文件夹（其分组会被合并/丢弃）。 */
  mergesUpperGrouping: boolean;
}

export function maxDepth(items: ZipLayoutItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.dirSegments.length), 0);
}

/** 某一层出现过的文件夹名（按首次出现顺序去重）。level 为 1-based。 */
export function folderNamesAtLevel(items: ZipLayoutItem[], level: number): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    if (item.dirSegments.length < level) continue;
    const name = item.dirSegments[level - 1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 某一层各文件夹下的蓝图数（用于子目录层选择器的展开预览）。 */
export function levelFolderBreakdown(items: ZipLayoutItem[], level: number): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.dirSegments.length < level) continue;
    const name = item.dirSegments[level - 1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return folderNamesAtLevel(items, level).map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

/**
 * 目录层 C 是否「干净可选」：
 *   - 没有蓝图浅于 C（否则它们无 level-C 文件夹，会被丢弃）
 *   - 第 1…C-1 层各自只有一个文件夹（上面是一条单链，不会合并丢弃上层分组）
 * C=0 永远干净；C=1 只要根没有散落蓝图就干净（根下多个文件夹是正常多目录，不算丢弃）。
 */
export function isCleanCategoryLevel(items: ZipLayoutItem[], level: number): boolean {
  if (level <= 0) return true;
  if (items.some((item) => item.dirSegments.length < level)) return false;
  for (let k = 1; k <= level - 1; k += 1) {
    if (folderNamesAtLevel(items, k).length > 1) return false;
  }
  return true;
}

/** 选中非干净目录层时，具体会丢弃什么（用于警告文案）。 */
export function categoryLevelDiscard(items: ZipLayoutItem[], level: number): CategoryLevelDiscard {
  const discardedBlueprints = level <= 0 ? 0 : items.filter((item) => item.dirSegments.length < level).length;
  let mergesUpperGrouping = false;
  for (let k = 1; k <= level - 1; k += 1) {
    if (folderNamesAtLevel(items, k).length > 1) {
      mergesUpperGrouping = true;
      break;
    }
  }
  return { discardedBlueprints, mergesUpperGrouping };
}

/**
 * 把单个蓝图按 (categoryLevel, subLevel) 映射到 分类/子分类。
 * 返回 null = 丢弃（浅于目录层）。subLevel=null 表示不分子目录（全进未命名）。
 */
export function assignZipEntry(
  zipName: string,
  dirSegments: string[],
  categoryLevel: number,
  subLevel: number | null
): { category: string; subcategory: string } | null {
  if (categoryLevel > 0 && dirSegments.length < categoryLevel) return null;
  const category = categoryLevel <= 0 ? zipName : dirSegments[categoryLevel - 1];
  let subcategory = UNNAMED;
  if (subLevel !== null && subLevel > categoryLevel && dirSegments.length >= subLevel) {
    subcategory = dirSegments[subLevel - 1];
  }
  return { category, subcategory };
}

/** 按当前 (C, S) 生成预览树（分类→子分类→数量），并统计导入/丢弃数。 */
export function buildLayoutPreview(
  items: ZipLayoutItem[],
  zipName: string,
  categoryLevel: number,
  subLevel: number | null
): LayoutPreview {
  const categories = new Map<string, Map<string, number>>();
  let imported = 0;
  let discarded = 0;
  for (const item of items) {
    const assigned = assignZipEntry(zipName, item.dirSegments, categoryLevel, subLevel);
    if (!assigned) {
      discarded += 1;
      continue;
    }
    imported += 1;
    const subs = categories.get(assigned.category) ?? new Map<string, number>();
    subs.set(assigned.subcategory, (subs.get(assigned.subcategory) ?? 0) + 1);
    categories.set(assigned.category, subs);
  }
  return {
    categories: [...categories.entries()].map(([name, subs]) => ({
      name,
      subcategories: [...subs.entries()].map(([subName, count]) => ({ name: subName, count }))
    })),
    imported,
    discarded
  };
}

/**
 * 智能默认目录层：跳过单一外壳文件夹（如 zip/MyBlueprints/CatA/... 默认选到 CatA 那层），
 * 只在下降后仍「干净」时才下降。若结果仍非干净（仅当根有散落蓝图）则回退到 0（整包作单一分类，无损）。
 */
export function defaultCategoryLevel(items: ZipLayoutItem[]): number {
  const maxD = maxDepth(items);
  if (maxD === 0) return 0;
  let level = 1;
  while (level < maxD && folderNamesAtLevel(items, level).length === 1 && isCleanCategoryLevel(items, level + 1)) {
    level += 1;
  }
  return isCleanCategoryLevel(items, level) ? level : 0;
}

/** 智能默认子目录层：目录层下面一层（若存在），否则不分。 */
export function defaultSubLevel(items: ZipLayoutItem[], categoryLevel: number): number | null {
  const maxD = maxDepth(items);
  return categoryLevel + 1 <= maxD ? categoryLevel + 1 : null;
}
