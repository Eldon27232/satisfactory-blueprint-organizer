import { describe, expect, it } from 'vitest';
import { computeMappingDiff, mergeMappingDiff } from '../src/shared/mappingDiff';
import type { DraftBlueprint, DraftTree } from '../src/shared/draftModel';
import type { BlueprintMappingEntry } from '../src/shared/types';

function bp(id: string, stem: string, hasSbp = true): DraftBlueprint {
  return { id, stem, originalStem: stem, origin: 'gameDir', sourceSbpPath: null, sourceCfgPath: null, hasSbp, hasCfg: false, iconId: null, originalIconId: null, warnings: [] };
}

function entry(stem: string, category = 'Cat', subcategory = 'Sub'): BlueprintMappingEntry {
  return {
    sourceSbpPath: `/m/${stem}.sbp`,
    sourceCfgPath: `/m/${stem}.sbpcfg`,
    targetSbpPath: `/g/${stem}.sbp`,
    targetCfgPath: `/g/${stem}.sbpcfg`,
    blueprintStem: stem,
    category,
    subcategory,
    relativePath: `${category}/${subcategory}/${stem}.sbp`,
    warnings: [],
    errors: []
  };
}

function tree(blueprints: DraftBlueprint[]): DraftTree {
  const sub = { id: 's1', name: 'Sub', blueprintIds: blueprints.map((b) => b.id) };
  return {
    categories: [{ id: 'c1', name: 'Cat', iconId: null, subcategories: [sub] }],
    blueprints: Object.fromEntries(blueprints.map((b) => [b.id, b])),
    gameBlueprintDir: '/g',
    savePath: '/g/s.sav',
    sessionName: 'S',
    buildNotices: []
  };
}

describe('computeMappingDiff', () => {
  it('splits external-only, manager-only and both by stem', () => {
    const diff = computeMappingDiff(tree([bp('a', 'alpha'), bp('b', 'beta')]), [entry('beta'), entry('gamma')]);
    expect(diff.externalOnly.map((e) => e.blueprintStem)).toEqual(['gamma']);
    expect(diff.managerOnly.map((b) => b.stem)).toEqual(['alpha']);
    expect(diff.bothCount).toBe(1);
  });

  it('excludes save-only blueprints (no file) from managerOnly', () => {
    const diff = computeMappingDiff(tree([bp('a', 'alpha', false)]), []);
    expect(diff.managerOnly).toEqual([]);
  });
});

describe('mergeMappingDiff', () => {
  it('adds external-only, marks keep, recycles delete', () => {
    const base = tree([bp('a', 'alpha'), bp('b', 'beta')]);
    const merged = mergeMappingDiff(base, '/m', [entry('gamma', 'NewCat', 'NewSub')], ['a'], ['b']);
    expect(merged.mappingDir).toBe('/m');
    expect(merged.blueprints['a'].writeBackToMapping).toBe(true);
    expect(Object.values(merged.blueprints).map((b) => b.stem)).toContain('gamma');
    expect(merged.categories.some((c) => c.name === 'NewCat')).toBe(true);
    // 删除项进独立的 recycleBin 子森林（不再是 categories 里的 recycle-bin 分类）。
    expect((merged.recycleBin ?? []).some((c) => c.subcategories.some((s) => s.blueprintIds.includes('b')))).toBe(true);
  });
});
