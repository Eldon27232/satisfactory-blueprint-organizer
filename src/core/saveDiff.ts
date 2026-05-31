import path from 'node:path';
import { DIAGNOSTICS_DIR } from '../shared/constants';
import { ensureDir, timestampForPath, writeJson } from './fsUtils';
import { findKeywordMatches, parseSaveFile } from './parseSave';

const DIFF_KEYWORDS = ['Blueprint', 'Category', 'SubCategory', 'Undefined', 'BlueprintCategory'];

export async function diffBlueprintCategorySaves(beforePath: string, afterPath: string, diagnosticsDir = DIAGNOSTICS_DIR): Promise<string> {
  const before = await parseSaveFile(beforePath);
  const after = await parseSaveFile(afterPath);
  const beforeMatches = findKeywordMatches(before, DIFF_KEYWORDS);
  const afterMatches = findKeywordMatches(after, DIFF_KEYWORDS);
  const beforeMap = new Map(beforeMatches.map((match) => [match.path, stableStringify(match.value)]));
  const afterMap = new Map(afterMatches.map((match) => [match.path, stableStringify(match.value)]));
  const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const changes = paths
    .filter((matchPath) => beforeMap.get(matchPath) !== afterMap.get(matchPath))
    .map((matchPath) => ({
      path: matchPath,
      before: beforeMap.get(matchPath) ? JSON.parse(beforeMap.get(matchPath) as string) : undefined,
      after: afterMap.get(matchPath) ? JSON.parse(afterMap.get(matchPath) as string) : undefined
    }));

  const report = {
    beforePath,
    afterPath,
    generatedAt: new Date().toISOString(),
    keywords: DIFF_KEYWORDS,
    changeCount: changes.length,
    changes
  };
  await ensureDir(diagnosticsDir);
  const targetPath = path.join(diagnosticsDir, `save-diff-blueprint-category-${timestampForPath()}.json`);
  await writeJson(targetPath, report);
  return targetPath;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortKeys(child)]));
  }
  return value;
}
