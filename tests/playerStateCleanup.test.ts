import { describe, expect, it } from 'vitest';
import { analyzeAndCleanupDuplicatePlayerStates } from '../src/core/playerStateCleanup';

describe('player state cleanup', () => {
  it('removes a duplicate same-identity player state without pawn and keeps the pawn owner', () => {
    const save = makeSave([
      playerState('Persistent_Level:PersistentLevel.BP_PlayerState_C_1', 'same', 'Persistent_Level:PersistentLevel.Char_Player_C_1'),
      child('Persistent_Level:PersistentLevel.BP_PlayerState_C_1.FGPlayerHotbar_1'),
      playerState('Persistent_Level:PersistentLevel.BP_PlayerState_C_2', 'same', null),
      child('Persistent_Level:PersistentLevel.BP_PlayerState_C_2.FGPlayerHotbar_2'),
      gameMode(['Persistent_Level:PersistentLevel.BP_PlayerState_C_2']),
      playerState('Persistent_Level:PersistentLevel.BP_PlayerState_C_3', 'other', 'Persistent_Level:PersistentLevel.Char_Player_C_3')
    ]);

    const result = analyzeAndCleanupDuplicatePlayerStates(save, true);

    expect(result.changed).toBe(true);
    expect(result.removedObjects).toEqual([
      'Persistent_Level:PersistentLevel.BP_PlayerState_C_2',
      'Persistent_Level:PersistentLevel.BP_PlayerState_C_2.FGPlayerHotbar_2'
    ]);
    expect(objectNames(save)).toContain('Persistent_Level:PersistentLevel.BP_PlayerState_C_1');
    expect(objectNames(save)).toContain('Persistent_Level:PersistentLevel.BP_PlayerState_C_3');
    expect(objectNames(save)).not.toContain('Persistent_Level:PersistentLevel.BP_PlayerState_C_2');
  });

  it('blocks cleanup when the duplicate player state has an external reference', () => {
    const save = makeSave([
      playerState('Persistent_Level:PersistentLevel.BP_PlayerState_C_1', 'same', 'Persistent_Level:PersistentLevel.Char_Player_C_1'),
      playerState('Persistent_Level:PersistentLevel.BP_PlayerState_C_2', 'same', null),
      {
        instanceName: 'Persistent_Level:PersistentLevel.SomeOtherObject',
        typePath: '/Script/FactoryGame.Other',
        properties: {
          Ref: {
            value: {
              pathName: 'Persistent_Level:PersistentLevel.BP_PlayerState_C_2'
            }
          }
        }
      }
    ]);

    const result = analyzeAndCleanupDuplicatePlayerStates(save, true);

    expect(result.changed).toBe(false);
    expect(result.duplicateGroups[0].blocked).toEqual(['Persistent_Level:PersistentLevel.BP_PlayerState_C_2']);
    expect(objectNames(save)).toContain('Persistent_Level:PersistentLevel.BP_PlayerState_C_2');
  });
});

function makeSave(objects: unknown[]): unknown {
  return {
    levels: {
      Persistent_Level: {
        objects
      }
    }
  };
}

function playerState(instanceName: string, offlineId: string, ownedPawn: string | null): unknown {
  return {
    instanceName,
    typePath: '/Game/FactoryGame/Character/Player/BP_PlayerState.BP_PlayerState_C',
    properties: {
      mClientIdentityInfo: {
        value: {
          offlineId,
          accountIds: { '6': [1, 2, 3] }
        }
      },
      ...(ownedPawn
        ? {
            mOwnedPawn: {
              value: {
                pathName: ownedPawn
              }
            }
          }
        : {})
    }
  };
}

function child(instanceName: string): unknown {
  return {
    instanceName,
    typePath: '/Script/FactoryGame.FGPlayerHotbar',
    properties: {}
  };
}

function gameMode(playerStates: string[]): unknown {
  return {
    instanceName: 'Persistent_Level:PersistentLevel.BP_GameMode_C_1',
    typePath: '/Game/FactoryGame/-Shared/Blueprint/BP_GameMode.BP_GameMode_C',
    specialProperties: {
      objects: playerStates.map((pathName) => ({ pathName }))
    }
  };
}

function objectNames(save: any): string[] {
  return save.levels.Persistent_Level.objects.map((object: any) => object.instanceName);
}
