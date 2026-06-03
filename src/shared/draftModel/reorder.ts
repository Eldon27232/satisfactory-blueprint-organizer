import { findCategory, findSubcategory } from './lookup';
import { clone } from './mutations';
import { isRecycleCategory, keepRecycleLast } from './recycle';
import type { DraftTree } from './types';

// Reordering: drag categories / subcategories to sort. The recycle bin never moves and stays last.

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

// Re-parent a subcategory under a different category (drop onto the category header, e.g. an empty
// category). Appends to the target category's end. Dropping onto another subcategory instead routes
// through reorderSubcategory, which inserts at that subcategory's position.
export function moveSubcategoryToCategory(tree: DraftTree, draggedSubId: string, targetCategoryId: string): DraftTree {
  const next = clone(tree);
  const found = findSubcategory(next, draggedSubId);
  const targetCategory = findCategory(next, targetCategoryId);
  if (!found || !targetCategory) return tree;
  if (isRecycleCategory(found.category) || isRecycleCategory(targetCategory)) return tree;
  if (found.category.id === targetCategoryId) return tree; // already in this category
  found.category.subcategories = found.category.subcategories.filter((subcategory) => subcategory.id !== draggedSubId);
  targetCategory.subcategories.push(found.subcategory);
  return next;
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
