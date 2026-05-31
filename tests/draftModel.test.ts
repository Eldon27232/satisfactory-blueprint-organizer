import { describe, expect, it } from 'vitest';
import {
  computeCategoryPlan,
  COPY_SUFFIX_CHAR,
  createCategory,
  deleteCategory,
  deleteSubcategory,
  deleteSubcategoryWithContents,
  getRecycledBlueprintIdSet,
  makeId,
  moveBlueprints,
  nextAvailableStem,
  recycleBlueprints,
  renameBlueprint,
  reorderCategory,
  reorderSubcategory,
  summarizeFileOps,
  validateDraft,
  type DraftBlueprint,
  type DraftTree
} from '../src/shared/draftModel';

function blueprint(id: string, stem: string, origin: DraftBlueprint['origin'] = 'gameDir'): DraftBlueprint {
  return { id, stem, originalStem: stem, origin, sourceSbpPath: origin === 'external' ? `C:/ext/${stem}.sbp` : null, sourceCfgPath: null, hasSbp: origin !== 'save', hasCfg: false, iconId: null, warnings: [] };
}

function sampleTree(): DraftTree {
  return {
    gameBlueprintDir: 'C:/game',
    savePath: 'C:/game/save.sav',
    sessionName: 'S',
    buildNotices: [],
    blueprints: {
      a: blueprint('a', 'alpha'),
      b: blueprint('b', 'beta'),
      c: blueprint('c', 'gamma')
    },
    categories: [
      {
        id: 'cat1',
        name: 'Power',
        iconId: 123,
        subcategories: [
          { id: 'sub1', name: 'Coal', blueprintIds: ['a', 'b'] },
          { id: 'sub2', name: 'Fuel', blueprintIds: [] }
        ]
      },
      { id: 'cat2', name: 'Logistics', iconId: null, subcategories: [{ id: 'sub3', name: 'Belts', blueprintIds: ['c'] }] }
    ]
  };
}

describe('draftModel mutations', () => {
  it('moves blueprints and keeps single membership', () => {
    const next = moveBlueprints(sampleTree(), ['a'], 'sub3');
    const sub1 = next.categories[0].subcategories[0];
    const sub3 = next.categories[1].subcategories[0];
    expect(sub1.blueprintIds).toEqual(['b']);
    expect(sub3.blueprintIds).toEqual(['c', 'a']);
    // no blueprint appears twice
    const all = next.categories.flatMap((category) => category.subcategories.flatMap((sub) => sub.blueprintIds));
    expect(new Set(all).size).toBe(all.length);
  });

  it('refuses to delete a non-empty category', () => {
    const result = deleteCategory(sampleTree(), 'cat1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-empty');
  });

  it('deletes an empty subcategory', () => {
    const result = deleteSubcategory(sampleTree(), 'sub2');
    expect(result.ok).toBe(true);
    expect(result.tree.categories[0].subcategories.find((sub) => sub.id === 'sub2')).toBeUndefined();
  });

  it('creates a category with a default subcategory', () => {
    const next = createCategory(sampleTree(), 'New');
    const created = next.categories[next.categories.length - 1];
    expect(created.name).toBe('New');
    expect(created.subcategories).toHaveLength(1);
  });

  it('generates unique ids (no cross-process collision)', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeId('cat')));
    expect(ids.size).toBe(500);
  });

  it('deletes a non-empty subcategory by moving its blueprints to a sibling', () => {
    const next = deleteSubcategoryWithContents(sampleTree(), 'sub1'); // sub1 has a,b; sibling sub2 (Fuel)
    const power = next.categories[0];
    expect(power.subcategories.find((sub) => sub.id === 'sub1')).toBeUndefined();
    expect(power.subcategories[0].blueprintIds).toEqual(expect.arrayContaining(['a', 'b']));
    // nothing lost
    const all = next.categories.flatMap((category) => category.subcategories.flatMap((sub) => sub.blueprintIds));
    expect(new Set(all)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('draftModel validation', () => {
  it('flags duplicate final stems as a blocking error', () => {
    const tree = sampleTree();
    const renamed = renameBlueprint(tree, 'b', 'alpha');
    const result = validateDraft(renamed);
    expect(result.hasBlockingError).toBe(true);
    expect(result.conflictBlueprintIds.has('a')).toBe(true);
    expect(result.conflictBlueprintIds.has('b')).toBe(true);
    expect(result.notices.some((notice) => notice.code === 'DUPLICATE_BLUEPRINT_STEM')).toBe(true);
  });

  it('flags illegal blueprint names', () => {
    const tree = sampleTree();
    const renamed = renameBlueprint(tree, 'a', 'bad/name');
    const result = validateDraft(renamed);
    expect(result.hasBlockingError).toBe(true);
    expect(result.conflictBlueprintIds.has('a')).toBe(true);
  });

  it('passes a clean tree', () => {
    expect(validateDraft(sampleTree()).hasBlockingError).toBe(false);
  });
});

describe('draftModel recycle / paste / reorder', () => {
  it('moves blueprints to the recycle bin and excludes them from the plan + validation', () => {
    const tree = recycleBlueprints(sampleTree(), ['a']);
    expect(getRecycledBlueprintIdSet(tree).has('a')).toBe(true);
    // recycle bin is not part of the category plan
    const plan = computeCategoryPlan(tree);
    expect(plan.some((category) => category.category === '回收站')).toBe(false);
    const planStems = plan.flatMap((c) => c.subcategories.flatMap((s) => s.blueprintStems));
    expect(planStems).not.toContain('alpha');
  });

  it('recycled blueprints do not trigger duplicate-stem conflicts', () => {
    let tree = renameBlueprint(sampleTree(), 'b', 'alpha'); // a + b both "alpha"
    expect(validateDraft(tree).hasBlockingError).toBe(true);
    tree = recycleBlueprints(tree, ['b']); // recycle one of them
    expect(validateDraft(tree).hasBlockingError).toBe(false);
  });

  it('nextAvailableStem appends one, then two copy chars', () => {
    const taken = new Set(['foo', 'foo' + COPY_SUFFIX_CHAR]);
    expect(nextAvailableStem('Foo', taken)).toBe('Foo' + COPY_SUFFIX_CHAR + COPY_SUFFIX_CHAR);
    expect(nextAvailableStem('Bar', taken)).toBe('Bar');
  });

  it('reorders categories and keeps the recycle bin last', () => {
    const recycled = recycleBlueprints(sampleTree(), []); // creates an empty recycle bin
    const reordered = reorderCategory(recycled, 'cat2', 'cat1'); // move Logistics before Power
    expect(reordered.categories.map((c) => c.id).slice(0, 2)).toEqual(['cat2', 'cat1']);
    expect(reordered.categories[reordered.categories.length - 1].name).toBe('回收站');
  });

  it('reorders subcategories within a category', () => {
    const reordered = reorderSubcategory(sampleTree(), 'sub2', 'sub1'); // Fuel before Coal
    expect(reordered.categories[0].subcategories.map((s) => s.id)).toEqual(['sub2', 'sub1']);
  });
});

describe('draftModel plan + file ops', () => {
  it('computes a category plan in display order with icons', () => {
    const plan = computeCategoryPlan(sampleTree());
    expect(plan[0]).toMatchObject({ category: 'Power', iconId: 123, menuPriority: 0 });
    expect(plan[0].subcategories[0]).toMatchObject({ name: 'Coal', menuPriority: 0, blueprintStems: ['alpha', 'beta'] });
    expect(plan[1]).toMatchObject({ category: 'Logistics', iconId: null, menuPriority: 1 });
  });

  it('summarizes copies and renames', () => {
    const tree = sampleTree();
    tree.blueprints.d = blueprint('d', 'delta', 'external');
    tree.categories[0].subcategories[1].blueprintIds.push('d');
    const renamed = renameBlueprint(tree, 'a', 'alpha2');
    const ops = summarizeFileOps(renamed);
    expect(ops.copies.map((copy) => copy.stem)).toContain('delta');
    expect(ops.renames).toContainEqual({ from: 'alpha', to: 'alpha2', cfg: false });
  });
});
