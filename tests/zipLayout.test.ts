import { describe, expect, it } from 'vitest';
import {
  assignZipEntry,
  buildLayoutPreview,
  categoryLevelDiscard,
  defaultCategoryLevel,
  defaultSubLevel,
  folderNamesAtLevel,
  isCleanCategoryLevel,
  levelFolderBreakdown,
  maxDepth,
  type ZipLayoutItem
} from '../src/shared/zipLayout';

function items(...paths: string[]): ZipLayoutItem[] {
  // 每个 path 形如 'A/B/stem'：最后一段是 stem，前面是目录段。
  return paths.map((path) => {
    const segments = path.split('/');
    return { dirSegments: segments.slice(0, -1), stem: segments[segments.length - 1] };
  });
}

describe('zipLayout structure', () => {
  it('maxDepth and folderNamesAtLevel', () => {
    const it1 = items('A/x/bp1', 'A/y/bp2', 'B/x/bp3', 'root');
    expect(maxDepth(it1)).toBe(2);
    expect(folderNamesAtLevel(it1, 1)).toEqual(['A', 'B']);
    expect(folderNamesAtLevel(it1, 2)).toEqual(['x', 'y']); // 去重、首次出现序
  });

  it('levelFolderBreakdown counts blueprints per folder at a level', () => {
    const it1 = items('A/x/bp1', 'A/y/bp2', 'B/x/bp3');
    expect(levelFolderBreakdown(it1, 1)).toEqual([
      { name: 'A', count: 2 },
      { name: 'B', count: 1 }
    ]);
  });
});

describe('zipLayout clean-category rules', () => {
  it('level 0 and a single-wrapper chain are clean; branching upper level is not', () => {
    const wrapped = items('W/CatA/x/bp1', 'W/CatB/y/bp2'); // 单一外壳 W
    expect(isCleanCategoryLevel(wrapped, 0)).toBe(true);
    expect(isCleanCategoryLevel(wrapped, 1)).toBe(true); // 根无散落
    expect(isCleanCategoryLevel(wrapped, 2)).toBe(true); // 上层只有 W 一个文件夹
    expect(isCleanCategoryLevel(wrapped, 3)).toBe(false); // 第2层分叉(CatA/CatB)，选第3层会合并丢弃
  });

  it('a blueprint shallower than C makes C non-clean and reports discard count', () => {
    const mixed = items('A/deep/bp1', 'A/loose', 'B/deep/bp2'); // A/loose 在第1层
    expect(isCleanCategoryLevel(mixed, 1)).toBe(true); // 根无散落
    expect(isCleanCategoryLevel(mixed, 2)).toBe(false); // 'A/loose' 浅于第2层
    expect(categoryLevelDiscard(mixed, 2)).toEqual({ discardedBlueprints: 1, mergesUpperGrouping: true });
  });

  it('root-level loose blueprints make level 1 non-clean', () => {
    const mixed = items('loose', 'A/bp1'); // 根散落 loose
    expect(isCleanCategoryLevel(mixed, 1)).toBe(false);
    expect(categoryLevelDiscard(mixed, 1).discardedBlueprints).toBe(1);
  });
});

describe('zipLayout assignment', () => {
  const segs = ['Cat', 'Sub', 'Deep'];
  it('assigns category from level C and subcategory from level S', () => {
    expect(assignZipEntry('Z', segs, 1, 2)).toEqual({ category: 'Cat', subcategory: 'Sub' });
  });
  it('C=0 uses the zip name as a single category', () => {
    expect(assignZipEntry('Z', segs, 0, 1)).toEqual({ category: 'Z', subcategory: 'Cat' });
  });
  it('deeper-than-S is flattened into the level-S folder', () => {
    expect(assignZipEntry('Z', segs, 1, 2)).toEqual({ category: 'Cat', subcategory: 'Sub' }); // 'Deep' 被拍平
  });
  it('not reaching S falls back to 未命名', () => {
    expect(assignZipEntry('Z', ['Cat'], 1, 2)).toEqual({ category: 'Cat', subcategory: '未命名' });
  });
  it('no sub level → everything under 未命名', () => {
    expect(assignZipEntry('Z', segs, 1, null)).toEqual({ category: 'Cat', subcategory: '未命名' });
  });
  it('shallower than C → discarded (null)', () => {
    expect(assignZipEntry('Z', ['Cat'], 2, 3)).toBeNull();
  });
});

describe('zipLayout preview', () => {
  it('aggregates categories/subcategories with counts and discards', () => {
    const it1 = items('A/x/bp1', 'A/x/bp2', 'A/y/bp3', 'B/x/bp4', 'loose'); // 'loose' 深度0
    const preview = buildLayoutPreview(it1, 'Z', 1, 2); // C=1, S=2
    expect(preview.imported).toBe(4);
    expect(preview.discarded).toBe(1); // 'loose' 浅于 C=1
    const a = preview.categories.find((c) => c.name === 'A')!;
    expect(a.subcategories).toEqual([
      { name: 'x', count: 2 },
      { name: 'y', count: 1 }
    ]);
    expect(preview.categories.find((c) => c.name === 'B')!.subcategories).toEqual([{ name: 'x', count: 1 }]);
  });
});

describe('zipLayout smart defaults', () => {
  it('skips a single wrapper folder', () => {
    const wrapped = items('W/CatA/x/bp1', 'W/CatB/y/bp2');
    const c = defaultCategoryLevel(wrapped);
    expect(c).toBe(2); // 跳过外壳 W，选 CatA/CatB 那层
    expect(defaultSubLevel(wrapped, c)).toBe(3);
  });

  it('picks level 1 when top folders already branch', () => {
    const branched = items('A/x/bp1', 'B/y/bp2');
    expect(defaultCategoryLevel(branched)).toBe(1);
  });

  it('falls back to 0 when the root has loose blueprints', () => {
    const mixed = items('loose', 'W/A/bp1');
    expect(defaultCategoryLevel(mixed)).toBe(0); // 第1层非干净 → 整包作单一分类，无损
  });

  it('flat zip → category level 0, no sub', () => {
    const flat = items('bp1', 'bp2');
    expect(maxDepth(flat)).toBe(0);
    expect(defaultCategoryLevel(flat)).toBe(0);
    expect(defaultSubLevel(flat, 0)).toBeNull();
  });
});
