import { describe, expect, it } from 'vitest';
import { canAccessBlueprintCategoryRecords } from '../src/core/applyBlueprintCategories';

describe('applyBlueprintCategories discovery', () => {
  it('detects BP_GameState_C mBlueprintCategoryRecords', () => {
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
                  values: [
                    {
                      type: 'BlueprintCategoryRecord',
                      properties: {
                        CategoryName: { type: 'StrProperty', value: 'Undefined' },
                        IsUndefined: { type: 'BoolProperty', value: true },
                        SubCategoryRecords: {
                          type: 'ArrayProperty',
                          values: [
                            {
                              type: 'BlueprintSubCategoryRecord',
                              properties: {
                                SubCategoryName: { type: 'StrProperty', value: 'Undefined' },
                                IsUndefined: { type: 'BoolProperty', value: true },
                                BlueprintNames: { type: 'ArrayProperty', values: [] }
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    };

    expect(canAccessBlueprintCategoryRecords(save)).toMatchObject({ canWrite: true });
  });
});
