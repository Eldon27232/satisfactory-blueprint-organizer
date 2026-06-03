import { describe, expect, it } from 'vitest';
import {
  computeCategoryPlan,
  getRecycledBlueprintIdSet,
  recycleBlueprints,
  recycleCategory,
  recycleSubcategory,
  renameBlueprint,
  restoreRecycledBlueprints,
  restoreRecycledCategory,
  restoreRecycledSubcategory,
  validateDraft,
  type DraftBlueprint,
  type DraftCategory,
  type DraftTree
} from '../src/shared/draftModel';

function bp(id: string, stem: string): DraftBlueprint {
  return { id, stem, originalStem: stem, origin: 'gameDir', sourceSbpPath: null, sourceCfgPath: null, hasSbp: true, hasCfg: false, iconId: null, originalIconId: null, warnings: [] };
}

function tree(): DraftTree {
  return {
    gameBlueprintDir: 'C:/game',
    savePath: null,
    sessionName: 'S',
    buildNotices: [],
    blueprints: { a: bp('a', 'alpha'), b: bp('b', 'beta'), c: bp('c', 'gamma') },
    categories: [
      { id: 'cat1', name: 'Power', iconId: null, subcategories: [
        { id: 'sub1', name: 'Coal', blueprintIds: ['a', 'b'] },
        { id: 'sub2', name: 'Fuel', blueprintIds: [] }
      ] },
      { id: 'cat2', name: 'Logistics', iconId: null, subcategories: [
        { id: 'sub3', name: 'Belts', blueprintIds: ['c'] }
      ] }
    ]
  };
}

const bin = (t: DraftTree): DraftCategory[] => t.recycleBin ?? [];
const shadow = (t: DraftTree, name: string): DraftCategory => bin(t).find((c) => c.name === name)!;

describe('recycle into bin', () => {
  it('recycles a whole category, removing it from the tree but keeping its structure in the bin', () => {
    const t = recycleCategory(tree(), 'cat1');
    expect(t.categories.map((c) => c.id)).toEqual(['cat2']);
    expect(getRecycledBlueprintIdSet(t)).toEqual(new Set(['a', 'b']));
    expect(shadow(t, 'Power').subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a', 'b']);
    expect(computeCategoryPlan(t).some((c) => c.category === 'Power')).toBe(false); // 不进 plan
  });

  it('recycles a subcategory under a shadow of its origin category', () => {
    const t = recycleSubcategory(tree(), 'sub1'); // Coal from Power
    expect(getRecycledBlueprintIdSet(t)).toEqual(new Set(['a', 'b']));
    expect(t.categories.find((c) => c.id === 'cat1')!.subcategories.map((s) => s.id)).toEqual(['sub2']); // Coal removed
    expect(shadow(t, 'Power').subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a', 'b']);
  });

  it('recycles loose blueprints by their origin path', () => {
    const t = recycleBlueprints(tree(), ['a', 'c']);
    expect(getRecycledBlueprintIdSet(t)).toEqual(new Set(['a', 'c']));
    expect(shadow(t, 'Power').subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a']);
    expect(shadow(t, 'Logistics').subcategories.find((s) => s.name === 'Belts')!.blueprintIds).toEqual(['c']);
    expect(t.categories[0].subcategories[0].blueprintIds).toEqual(['b']); // 正常树移除 a
  });

  it('excludes recycled blueprints from validation conflicts', () => {
    let t = renameBlueprint(tree(), 'b', 'alpha'); // a + b 都 alpha → 冲突
    expect(validateDraft(t).hasBlockingError).toBe(true);
    t = recycleBlueprints(t, ['b']);
    expect(validateDraft(t).hasBlockingError).toBe(false);
  });

  it('merges a same-name shadow when recycling a category after one of its subcategories', () => {
    let t = recycleSubcategory(tree(), 'sub1'); // 影子 Power/Coal(a,b)
    t = recycleCategory(t, 'cat1'); // 整个 Power(剩 Fuel) → 合并进同名影子
    const powers = bin(t).filter((c) => c.name === 'Power');
    expect(powers).toHaveLength(1);
    expect(powers[0].subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a', 'b']);
    expect(t.categories.some((c) => c.id === 'cat1')).toBe(false);
  });
});

describe('restore from bin', () => {
  it('restores a whole category back to the top level (cascading its subs/blueprints)', () => {
    let t = recycleCategory(tree(), 'cat1');
    t = restoreRecycledCategory(t, shadow(t, 'Power').id);
    expect(getRecycledBlueprintIdSet(t).size).toBe(0);
    const power = t.categories.find((c) => c.name === 'Power')!;
    expect(power.subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a', 'b']);
  });

  it('restores a category by merging into an existing same-name category', () => {
    let t = recycleSubcategory(tree(), 'sub1'); // 影子 Power/Coal; 正常 Power 还在(剩 Fuel)
    t = restoreRecycledCategory(t, shadow(t, 'Power').id);
    const powers = t.categories.filter((c) => c.name === 'Power');
    expect(powers).toHaveLength(1); // 并入,不重复
    expect(powers[0].subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toEqual(['a', 'b']);
    expect(getRecycledBlueprintIdSet(t).size).toBe(0);
  });

  it('restores a subcategory back to its origin category when it still exists', () => {
    let t = recycleSubcategory(tree(), 'sub3'); // Belts from Logistics; Logistics 仍在(空)
    const s = shadow(t, 'Logistics');
    t = restoreRecycledSubcategory(t, s.id, s.subcategories[0].id);
    expect(t.categories.find((c) => c.name === 'Logistics')!.subcategories.find((x) => x.name === 'Belts')!.blueprintIds).toEqual(['c']);
    expect(getRecycledBlueprintIdSet(t).size).toBe(0);
  });

  it('restores a subcategory into the 未命名 category when its origin category is gone', () => {
    let t = recycleCategory(tree(), 'cat2'); // 整个 Logistics 进回收站
    const s = shadow(t, 'Logistics');
    t = restoreRecycledSubcategory(t, s.id, s.subcategories[0].id);
    const orphan = t.categories.find((c) => c.name === '未命名')!;
    expect(orphan.subcategories.find((x) => x.name === 'Belts')!.blueprintIds).toEqual(['c']);
  });

  it('restores a blueprint to its origin sub', () => {
    let t = recycleBlueprints(tree(), ['a']); // a from Power/Coal; Power/Coal 仍在(剩 b)
    t = restoreRecycledBlueprints(t, ['a']);
    expect(t.categories.find((c) => c.name === 'Power')!.subcategories.find((s) => s.name === 'Coal')!.blueprintIds).toContain('a');
    expect(getRecycledBlueprintIdSet(t).size).toBe(0);
  });

  it('falls back to the 未命名 sub when the origin sub is gone', () => {
    let t = recycleSubcategory(tree(), 'sub1'); // 整个 Coal(a,b) 进回收站; Power 剩 Fuel
    t = restoreRecycledBlueprints(t, ['a']); // 原目录 Power 在、原子目录 Coal 不在 → Power/未命名
    const power = t.categories.find((c) => c.name === 'Power')!;
    expect(power.subcategories.find((s) => s.name === '未命名')!.blueprintIds).toContain('a');
    expect(getRecycledBlueprintIdSet(t).has('b')).toBe(true); // b 仍在回收站
  });

  it('auto-renames a restored blueprint when its stem collides with a live one', () => {
    let t = recycleBlueprints(tree(), ['a']); // a (alpha) 进回收站
    t = renameBlueprint(t, 'b', 'alpha'); // 正常树 b 现在也叫 alpha
    t = restoreRecycledBlueprints(t, ['a']); // a 恢复,stem alpha 冲突 → 改名
    const stems = Object.values(t.blueprints).map((blueprint) => blueprint.stem);
    expect(stems.filter((s) => s === 'alpha')).toHaveLength(1); // b 保持 alpha
    expect(t.blueprints.a.stem).not.toBe('alpha');
    expect(t.blueprints.a.stem.startsWith('alpha')).toBe(true);
  });
});
