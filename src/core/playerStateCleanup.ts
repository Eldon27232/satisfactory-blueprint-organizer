import type { Notice, PlayerStateCleanupResult } from '../shared/types';
import { parseSaveFile, writeSaveFile } from './parseSave';

type AnyRecord = Record<string, any>;

interface PlayerStateInfo {
  object: AnyRecord;
  instanceName: string;
  identityKey: string | null;
  ownedPawn: string | null;
}

export async function inspectPlayerStateCleanup(savePath: string): Promise<PlayerStateCleanupResult> {
  const save = await parseSaveFile(savePath);
  return analyzeAndCleanupDuplicatePlayerStates(save, false);
}

export async function cleanupDuplicatePlayerStates(savePath: string): Promise<PlayerStateCleanupResult> {
  const save = await parseSaveFile(savePath);
  const result = analyzeAndCleanupDuplicatePlayerStates(save, true);
  if (result.changed && result.errors.length === 0) {
    await writeSaveFile(savePath, save);
    const reread = await parseSaveFile(savePath);
    const verification = analyzeAndCleanupDuplicatePlayerStates(reread, false);
    if (verification.duplicateGroups.some((group) => group.removable.length > 0)) {
      result.errors.push({
        severity: 'error',
        code: 'PLAYERSTATE_CLEANUP_VERIFY_FAILED',
        message: 'Duplicate PlayerState cleanup did not verify after rereading the save.'
      });
    }
  }
  return result;
}

export function analyzeAndCleanupDuplicatePlayerStates(save: unknown, mutate: boolean): PlayerStateCleanupResult {
  const warnings: Notice[] = [];
  const errors: Notice[] = [];
  const levelEntries = Object.entries(((save as AnyRecord)?.levels ?? {}) as Record<string, AnyRecord>);
  const allObjects = levelEntries.flatMap(([, level]) => (Array.isArray(level?.objects) ? level.objects : []) as AnyRecord[]);
  const playerStates = allObjects
    .filter((object) => String(object?.typePath ?? '').endsWith('BP_PlayerState.BP_PlayerState_C'))
    .map(toPlayerStateInfo);
  const byIdentity = groupByIdentity(playerStates);
  const removedObjects: string[] = [];
  const duplicateGroups: PlayerStateCleanupResult['duplicateGroups'] = [];

  for (const [identityKey, group] of byIdentity) {
    if (group.length < 2) continue;
    const keepers = group.filter((playerState) => playerState.ownedPawn);
    const candidates = group.filter((playerState) => !playerState.ownedPawn);
    const removable: string[] = [];
    const blocked: string[] = [];

    if (keepers.length === 0) {
      blocked.push(...candidates.map((candidate) => candidate.instanceName));
      warnings.push({
        severity: 'warning',
        code: 'PLAYERSTATE_DUPLICATE_NO_KEEPER',
        message: `Found duplicate PlayerState records for ${identityKey}, but none has mOwnedPawn. Cleanup skipped.`
      });
    } else {
      for (const candidate of candidates) {
        const subtree = collectInstanceSubtree(allObjects, candidate.instanceName);
        const refs = findBlockingExternalReferences(allObjects, subtree, candidate.instanceName);
        if (refs.length === 0) {
          removable.push(candidate.instanceName);
          if (mutate) {
            removeAllowedExternalReferences(allObjects, subtree);
            removeObjectsFromLevels(levelEntries, subtree, removedObjects);
          }
        } else {
          blocked.push(candidate.instanceName);
          warnings.push({
            severity: 'warning',
            code: 'PLAYERSTATE_DUPLICATE_HAS_REFERENCES',
            message: `Skipped duplicate PlayerState ${candidate.instanceName} because other objects still reference it.`
          });
        }
      }
    }

    duplicateGroups.push({
      identityKey,
      kept: keepers.map((keeper) => keeper.instanceName),
      removable,
      blocked
    });
  }

  if (duplicateGroups.some((group) => group.removable.length > 0)) {
    warnings.push({
      severity: 'warning',
      code: 'PLAYERSTATE_DUPLICATE_GHOST_FOUND',
      message: mutate
        ? `Removed ${removedObjects.length} duplicate PlayerState-related object(s) after backup.`
        : 'Found duplicate PlayerState records that can be cleaned during import after backup.'
    });
  }

  return {
    checked: true,
    changed: removedObjects.length > 0,
    playerStateCount: playerStates.length,
    duplicateGroups,
    removedObjects,
    warnings,
    errors
  };
}

function toPlayerStateInfo(object: AnyRecord): PlayerStateInfo {
  return {
    object,
    instanceName: String(object.instanceName ?? ''),
    identityKey: getIdentityKey(object),
    ownedPawn: getObjectPath(getProperty(object.properties, 'mOwnedPawn')?.value)
  };
}

function groupByIdentity(playerStates: PlayerStateInfo[]): Map<string, PlayerStateInfo[]> {
  const groups = new Map<string, PlayerStateInfo[]>();
  for (const playerState of playerStates) {
    if (!playerState.identityKey) continue;
    const group = groups.get(playerState.identityKey) ?? [];
    group.push(playerState);
    groups.set(playerState.identityKey, group);
  }
  return groups;
}

function getIdentityKey(playerState: AnyRecord): string | null {
  const identity = getProperty(playerState.properties, 'mClientIdentityInfo')?.value;
  if (!identity || typeof identity !== 'object') return null;
  const offlineId = typeof identity.offlineId === 'string' ? identity.offlineId : '';
  const accountIds = identity.accountIds && typeof identity.accountIds === 'object' ? identity.accountIds : {};
  return JSON.stringify({ offlineId, accountIds: sortObject(accountIds) });
}

function collectInstanceSubtree(objects: AnyRecord[], instanceName: string): Set<string> {
  const subtree = new Set<string>();
  for (const object of objects) {
    const current = String(object?.instanceName ?? '');
    if (current === instanceName || current.startsWith(`${instanceName}.`)) {
      subtree.add(current);
    }
  }
  return subtree;
}

function findBlockingExternalReferences(objects: AnyRecord[], subtree: Set<string>, rootInstanceName: string): string[] {
  const refs: string[] = [];
  for (const object of objects) {
    const owner = String(object?.instanceName ?? '');
    if (!owner || subtree.has(owner)) continue;
    if (hasOnlyAllowedExternalReference(object, subtree)) continue;
    if (containsPathReference(object, rootInstanceName, subtree, new WeakSet<object>())) refs.push(owner);
  }
  return refs;
}

function hasOnlyAllowedExternalReference(object: AnyRecord, subtree: Set<string>): boolean {
  if (!String(object?.typePath ?? '').includes('BP_GameMode_C')) return false;
  const objects = object?.specialProperties?.objects;
  if (!Array.isArray(objects)) return false;
  return objects.some((item: AnyRecord) => subtree.has(String(item?.pathName ?? '')));
}

function removeAllowedExternalReferences(objects: AnyRecord[], subtree: Set<string>): void {
  for (const object of objects) {
    if (!String(object?.typePath ?? '').includes('BP_GameMode_C')) continue;
    const refs = object?.specialProperties?.objects;
    if (!Array.isArray(refs)) continue;
    object.specialProperties.objects = refs.filter((item: AnyRecord) => !subtree.has(String(item?.pathName ?? '')));
  }
}

function containsPathReference(value: unknown, rootInstanceName: string, subtree: Set<string>, seen: WeakSet<object>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as AnyRecord;
  if (typeof record.pathName === 'string' && (record.pathName === rootInstanceName || subtree.has(record.pathName))) return true;
  for (const child of Object.values(record)) {
    if (containsPathReference(child, rootInstanceName, subtree, seen)) return true;
  }
  return false;
}

function removeObjectsFromLevels(levelEntries: Array<[string, AnyRecord]>, subtree: Set<string>, removedObjects: string[]): void {
  for (const [, level] of levelEntries) {
    if (!Array.isArray(level?.objects)) continue;
    level.objects = level.objects.filter((object: AnyRecord) => {
      const remove = subtree.has(String(object?.instanceName ?? ''));
      if (remove) removedObjects.push(String(object.instanceName));
      return !remove;
    });
  }
}

function getProperty(properties: AnyRecord | undefined, name: string): AnyRecord | null {
  const property = properties?.[name];
  return Array.isArray(property) ? property[0] : property ?? null;
}

function getObjectPath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const pathName = (value as AnyRecord).pathName;
  return typeof pathName === 'string' && pathName.length > 0 ? pathName : null;
}

function sortObject(value: AnyRecord): AnyRecord {
  return Object.keys(value)
    .sort()
    .reduce<AnyRecord>((result, key) => {
      result[key] = value[key];
      return result;
    }, {});
}
