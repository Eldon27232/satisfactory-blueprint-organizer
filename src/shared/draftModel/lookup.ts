import type { DraftCategory, DraftSubcategory, DraftTree } from './types';

// Lookups into the draft tree (read-only).

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
