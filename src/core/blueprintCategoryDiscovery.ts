import path from 'node:path';
import { DIAGNOSTICS_DIR } from '../shared/constants';
import type { BlueprintCategoryCapability } from '../shared/types';
import { ensureDir, timestampForPath, writeJson } from './fsUtils';
import { findKeywordMatches, parseSaveFile } from './parseSave';
import { canAccessBlueprintCategoryRecords } from './applyBlueprintCategories';

const BLUEPRINT_KEYWORDS = ['Blueprint', 'Category', 'SubCategory', 'Undefined', 'BlueprintCategory'];

export async function scanBlueprintStructure(savePath: string, diagnosticsDir = DIAGNOSTICS_DIR): Promise<string> {
  const parsed = await parseSaveFile(savePath);
  const matches = findKeywordMatches(parsed, BLUEPRINT_KEYWORDS);
  const report = {
    savePath,
    generatedAt: new Date().toISOString(),
    keywords: BLUEPRINT_KEYWORDS,
    matchCount: matches.length,
    matches
  };
  await ensureDir(diagnosticsDir);
  const targetPath = path.join(diagnosticsDir, `blueprint-structure-report-${timestampForPath()}.json`);
  await writeJson(targetPath, report);
  return targetPath;
}

export async function discoverBlueprintCategoryCapability(savePath?: string | null): Promise<BlueprintCategoryCapability> {
  if (!savePath) {
    return {
      canWrite: false,
      confidence: 'none',
      reason: '未选择目标 .sav，无法写入分类。',
      evidence: []
    };
  }

  try {
    const parsed = await parseSaveFile(savePath);
    const access = canAccessBlueprintCategoryRecords(parsed);
    if (access.canWrite) {
      return {
        canWrite: true,
        confidence: 'reliable',
        reason: access.reason,
        evidence: access.evidence
      };
    }
    const matches = findKeywordMatches(parsed, BLUEPRINT_KEYWORDS);
    return {
      canWrite: false,
      confidence: 'diagnostic-only',
      reason: `Parsed save but could not safely access mBlueprintCategoryRecords: ${access.reason}`,
      evidence: matches.slice(0, 50)
    };
  } catch (error) {
    return {
      canWrite: false,
      confidence: 'none',
      reason: `解析 .sav 失败：${error instanceof Error ? error.message : String(error)}`,
      evidence: []
    };
  }
}
