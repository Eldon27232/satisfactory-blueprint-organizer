import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BlueprintMappingEntry } from '../shared/types';
import { ensureDir, pathExists } from './fsUtils';

export interface CopyBlueprintsResult {
  copiedFiles: string[];
  overwrittenFiles: string[];
  skippedFiles: string[];
}

export async function copyBlueprintsFlat(entries: BlueprintMappingEntry[], allowOverwrite: boolean): Promise<CopyBlueprintsResult> {
  const copiedFiles: string[] = [];
  const overwrittenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const handledTargets = new Set<string>();
  for (const entry of entries) {
    await copyOne(entry.sourceSbpPath, entry.targetSbpPath, allowOverwrite, handledTargets, copiedFiles, overwrittenFiles, skippedFiles);
    if (entry.sourceCfgPath && entry.targetCfgPath) {
      await copyOne(entry.sourceCfgPath, entry.targetCfgPath, allowOverwrite, handledTargets, copiedFiles, overwrittenFiles, skippedFiles);
    }
  }
  return { copiedFiles, overwrittenFiles, skippedFiles };
}

async function copyOne(source: string, target: string, allowOverwrite: boolean, handledTargets: Set<string>, copiedFiles: string[], overwrittenFiles: string[], skippedFiles: string[]): Promise<void> {
  const targetKey = target.toLowerCase();
  if (handledTargets.has(targetKey)) {
    skippedFiles.push(target);
    return;
  }
  handledTargets.add(targetKey);
  await ensureDir(path.dirname(target));
  const exists = await pathExists(target);
  if (exists && !allowOverwrite) {
    skippedFiles.push(target);
    return;
  }
  await fs.copyFile(source, target);
  if (exists) {
    overwrittenFiles.push(target);
  } else {
    copiedFiles.push(target);
  }
}
