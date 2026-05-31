import { describe, expect, it } from 'vitest';
import { applyCategoryPlanToSave, readBlueprintCategoryTree, verifyCategoryPlan } from '../src/core/applyBlueprintCategories';
import type { CategoryPlan } from '../src/shared/draftModel';

function subRecord(name: string, isUndefined: boolean, names: string[]): any {
  return {
    type: 'BlueprintSubCategoryRecord',
    properties: {
      SubCategoryName: { type: 'StrProperty', value: name },
      IsUndefined: { type: 'BoolProperty', value: isUndefined },
      MenuPriority: { type: 'IntProperty', value: 0 },
      BlueprintNames: { type: 'ArrayProperty', values: names }
    }
  };
}

function categoryRecord(name: string, isUndefined: boolean, iconId: number, subs: any[]): any {
  return {
    type: 'BlueprintCategoryRecord',
    properties: {
      CategoryName: { type: 'StrProperty', value: name },
      IsUndefined: { type: 'BoolProperty', value: isUndefined },
      IconID: { type: 'IntProperty', value: iconId },
      MenuPriority: { type: 'IntProperty', value: 0 },
      SubCategoryRecords: { type: 'ArrayProperty', values: subs }
    }
  };
}

function makeSave(): any {
  return {
    levels: {
      Persistent_Level: {
        objects: [
          {
            instanceName: 'Persistent_Level:PersistentLevel.BP_GameState_C_2147477645',
            typePath: '/Game/FactoryGame/-Shared/Blueprint/BP_GameState.BP_GameState_C',
            properties: {
              mBlueprintCategoryRecords: {
                type: 'ArrayProperty',
                values: [categoryRecord('Undefined', true, 0, [subRecord('Undefined', true, ['orphan'])])]
              }
            }
          }
        ]
      }
    }
  };
}

const plan: CategoryPlan = [
  { category: 'Undefined', iconId: null, menuPriority: 0, subcategories: [{ name: 'Undefined', menuPriority: 0, blueprintStems: [] }] },
  {
    category: '电力',
    iconId: 123,
    menuPriority: 1,
    subcategories: [
      { name: '煤炭', menuPriority: 0, blueprintStems: ['8coal', 'orphan'] },
      { name: '燃料', menuPriority: 1, blueprintStems: [] }
    ]
  }
];

describe('applyCategoryPlanToSave', () => {
  it('creates categories, writes IconID, and assigns blueprints', () => {
    const save = makeSave();
    const result = applyCategoryPlanToSave(save, plan);
    expect(result.categoriesCreated).toContain('电力');

    const tree = readBlueprintCategoryTree(save);
    const power = tree.categories.find((category) => category.name === '电力');
    expect(power?.iconId).toBe(123);
    const coal = power?.subcategories.find((sub) => sub.name === '煤炭');
    expect(coal?.blueprintNames.sort()).toEqual(['8coal', 'orphan']);
  });

  it('moves a blueprint out of Undefined (single membership)', () => {
    const save = makeSave();
    applyCategoryPlanToSave(save, plan);
    const tree = readBlueprintCategoryTree(save);
    const undefinedCategory = tree.categories.find((category) => category.isUndefined);
    const undefinedNames = undefinedCategory?.subcategories.flatMap((sub) => sub.blueprintNames) ?? [];
    expect(undefinedNames).not.toContain('orphan');
  });

  it('does not inject an extra Undefined subcategory into a new category', () => {
    const save = makeSave();
    applyCategoryPlanToSave(save, plan);
    const power = readBlueprintCategoryTree(save).categories.find((category) => category.name === '电力');
    expect(power?.subcategories.map((sub) => sub.name)).toEqual(['煤炭', '燃料']);
  });

  it('strips removed (recycled) stems from the save', () => {
    const save = makeSave();
    // 'orphan' currently lives in Undefined; apply with it removed and not in any plan subcategory.
    const planWithoutOrphan = [
      { category: 'Undefined', iconId: null, menuPriority: 0, subcategories: [{ name: 'Undefined', menuPriority: 0, blueprintStems: [] }] },
      { category: '电力', iconId: 123, menuPriority: 1, subcategories: [{ name: '煤炭', menuPriority: 0, blueprintStems: ['8coal'] }] }
    ];
    applyCategoryPlanToSave(save, planWithoutOrphan, ['orphan']);
    const allNames = readBlueprintCategoryTree(save).categories.flatMap((c) => c.subcategories.flatMap((s) => s.blueprintNames));
    expect(allNames).not.toContain('orphan');
  });

  it('verifies the plan after applying', () => {
    const save = makeSave();
    applyCategoryPlanToSave(save, plan);
    const verification = verifyCategoryPlan(save, plan);
    expect(verification.passed).toBe(true);
    expect(verification.duplicateMembership).toEqual([]);
    expect(verification.iconMismatches).toEqual([]);
  });

  it('reports verification failure when a stem is missing', () => {
    const save = makeSave();
    // apply a different plan, then verify against the expected plan
    applyCategoryPlanToSave(save, [{ category: '电力', iconId: 123, menuPriority: 0, subcategories: [{ name: '煤炭', menuPriority: 0, blueprintStems: [] }] }]);
    const verification = verifyCategoryPlan(save, plan);
    expect(verification.passed).toBe(false);
  });

  it('drops a category the plan no longer contains (stale Undefined removed)', () => {
    const save = makeSave(); // starts with only an Undefined category holding 'orphan'
    // The plan reclassifies 'orphan' and no longer contains any Undefined category.
    const planNoUndefined: CategoryPlan = [
      { category: '电力', iconId: 123, menuPriority: 0, subcategories: [{ name: '煤炭', menuPriority: 0, blueprintStems: ['orphan'] }] }
    ];
    applyCategoryPlanToSave(save, planNoUndefined);
    const tree = readBlueprintCategoryTree(save);
    expect(tree.categories.map((category) => category.name)).toEqual(['电力']);
    expect(tree.categories.some((category) => category.isUndefined)).toBe(false);
  });

  it('drops a subcategory the plan no longer contains', () => {
    const save = {
      levels: {
        Persistent_Level: {
          objects: [
            {
              instanceName: 'Persistent_Level:PersistentLevel.BP_GameState_C_2147477645',
              typePath: '/Game/FactoryGame/-Shared/Blueprint/BP_GameState.BP_GameState_C',
              properties: {
                mBlueprintCategoryRecords: {
                  type: 'ArrayProperty',
                  values: [categoryRecord('电力', false, 1, [subRecord('煤炭', false, ['8coal']), subRecord('燃料', false, ['fuel'])])]
                }
              }
            }
          ]
        }
      }
    };
    // Plan keeps only 煤炭 and merges both stems into it; 燃料 should disappear.
    const merged: CategoryPlan = [{ category: '电力', iconId: 1, menuPriority: 0, subcategories: [{ name: '煤炭', menuPriority: 0, blueprintStems: ['8coal', 'fuel'] }] }];
    applyCategoryPlanToSave(save, merged);
    const power = readBlueprintCategoryTree(save).categories.find((category) => category.name === '电力');
    expect(power?.subcategories.map((sub) => sub.name)).toEqual(['煤炭']);
    expect(power?.subcategories[0].blueprintNames.sort()).toEqual(['8coal', 'fuel']);
  });

  it('keeps every surviving blueprint exactly once across the whole save', () => {
    const save = makeSave();
    applyCategoryPlanToSave(save, plan);
    const allNames = readBlueprintCategoryTree(save).categories.flatMap((category) => category.subcategories.flatMap((sub) => sub.blueprintNames));
    const counts = new Map<string, number>();
    for (const name of allNames) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });
});
