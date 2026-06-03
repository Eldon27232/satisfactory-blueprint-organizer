import { describe, expect, it } from 'vitest';
import { computeVisibleBlueprints, makeCopyBlueprint, resolveBlueprints, resolvePasteTargetSubId, uniqueName } from '../src/renderer/manager/managerSelectors';
import { RECYCLE_BIN_ID, type DraftBlueprint, type DraftTree } from '../src/shared/draftModel';

function bp(id: string, stem: string, extra: Partial<DraftBlueprint> = {}): DraftBlueprint {
  return {
    id,
    stem,
    originalStem: stem,
    origin: 'gameDir',
    sourceSbpPath: null,
    sourceCfgPath: null,
    hasSbp: true,
    hasCfg: true,
    iconId: null,
    originalIconId: null,
    warnings: [],
    ...extra
  };
}

function tree(): DraftTree {
  return {
    gameBlueprintDir: 'C:\\game',
    savePath: 'C:\\game\\s.sav',
    sessionName: 'S',
    buildNotices: [],
    blueprints: {
      a: bp('a', 'alpha'),
      b: bp('b', 'beta'),
      r: bp('r', 'recycled')
    },
    categories: [
      {
        id: 'cat1',
        name: 'Power',
        iconId: null,
        subcategories: [
          { id: 'sub1', name: 'Coal', blueprintIds: ['a'] },
          { id: 'sub2', name: 'Nuclear', blueprintIds: ['b'] }
        ]
      },
      {
        id: RECYCLE_BIN_ID,
        name: '回收站',
        iconId: null,
        subcategories: [{ id: 'rsub', name: '回收站', blueprintIds: ['r'] }]
      }
    ]
  };
}

describe('computeVisibleBlueprints', () => {
  it('filters by stem across all blueprints, excluding recycled', () => {
    // needle 'e' 命中 beta 与 recycled，但 recycled 在回收集合中被排除；alpha 不含 'e'。
    const result = computeVisibleBlueprints(tree(), null, 'e', new Set(['r']));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].blueprints.map((b) => b.stem)).toEqual(['beta']);
  });

  it('shows a single subcategory when one is selected', () => {
    const result = computeVisibleBlueprints(tree(), { type: 'subcategory', id: 'sub1' }, '', new Set());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].blueprints.map((b) => b.stem)).toEqual(['alpha']);
  });

  it('groups by subcategory when a category is selected', () => {
    const result = computeVisibleBlueprints(tree(), { type: 'category', id: 'cat1' }, '', new Set());
    expect(result.groups.map((g) => g.title)).toEqual(['Coal', 'Nuclear']);
    expect(result.groups[0].blueprints.map((b) => b.stem)).toEqual(['alpha']);
    expect(result.groups[1].blueprints.map((b) => b.stem)).toEqual(['beta']);
  });

  it('returns no groups when nothing is selected', () => {
    expect(computeVisibleBlueprints(tree(), null, '', new Set()).groups).toEqual([]);
  });
});

describe('resolveBlueprints', () => {
  it('resolves ids in order and drops missing ones', () => {
    const t = tree();
    const sub = { id: 'x', name: 'x', blueprintIds: ['b', 'missing', 'a'] };
    expect(resolveBlueprints(t, sub).map((b) => b.stem)).toEqual(['beta', 'alpha']);
  });
});

describe('resolvePasteTargetSubId', () => {
  it('returns the subcategory itself when a subcategory is selected', () => {
    expect(resolvePasteTargetSubId(tree(), { type: 'subcategory', id: 'sub2' })).toBe('sub2');
  });

  it('returns the first subcategory when a category is selected', () => {
    expect(resolvePasteTargetSubId(tree(), { type: 'category', id: 'cat1' })).toBe('sub1');
  });

  it('refuses the recycle bin (category and subcategory)', () => {
    expect(resolvePasteTargetSubId(tree(), { type: 'category', id: RECYCLE_BIN_ID })).toBeNull();
    expect(resolvePasteTargetSubId(tree(), { type: 'subcategory', id: 'rsub' })).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(resolvePasteTargetSubId(tree(), null)).toBeNull();
  });
});

describe('makeCopyBlueprint', () => {
  it('derives source paths from the game dir for a gameDir blueprint', () => {
    const t = tree();
    const copy = makeCopyBlueprint(t, t.blueprints.a, 'alpha-copy');
    expect(copy.origin).toBe('external');
    expect(copy.stem).toBe('alpha-copy');
    expect(copy.sourceSbpPath).toBe('C:\\game\\alpha.sbp');
    expect(copy.sourceCfgPath).toBe('C:\\game\\alpha.sbpcfg');
    expect(copy.id).not.toBe(t.blueprints.a.id);
  });

  it('reuses staging paths for an external blueprint', () => {
    const t = tree();
    const ext = bp('e', 'ext', { origin: 'external', sourceSbpPath: 'C:/stage/ext.sbp', sourceCfgPath: 'C:/stage/ext.sbpcfg' });
    const copy = makeCopyBlueprint(t, ext, 'ext-copy');
    expect(copy.sourceSbpPath).toBe('C:/stage/ext.sbp');
    expect(copy.sourceCfgPath).toBe('C:/stage/ext.sbpcfg');
  });

  it('keeps cfg path null when the source has no cfg', () => {
    const t = tree();
    const copy = makeCopyBlueprint(t, bp('n', 'nocfg', { hasCfg: false }), 'nocfg-copy');
    expect(copy.sourceCfgPath).toBeNull();
    expect(copy.hasCfg).toBe(false);
  });
});

describe('uniqueName', () => {
  it('returns the base name when free', () => {
    expect(uniqueName('新分类', [])).toBe('新分类');
  });

  it('appends an increasing suffix on collision', () => {
    expect(uniqueName('新分类', ['新分类'])).toBe('新分类 2');
    expect(uniqueName('新分类', ['新分类', '新分类 2'])).toBe('新分类 3');
  });
});
