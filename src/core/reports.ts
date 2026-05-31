import path from 'node:path';
import { REPORTS_DIR } from '../shared/constants';
import type { ImportReport } from '../shared/types';
import { ensureDir, timestampForPath, writeJson } from './fsUtils';

export async function writeImportReport(report: Omit<ImportReport, 'reportDir'>): Promise<ImportReport> {
  const reportDir = path.resolve(REPORTS_DIR, timestampForPath());
  await ensureDir(reportDir);
  const finalReport: ImportReport = { ...report, reportDir };
  await writeJson(path.join(reportDir, 'import-report.json'), finalReport);
  await writeMarkdownReport(path.join(reportDir, 'import-report.md'), finalReport);
  return finalReport;
}

async function writeMarkdownReport(filePath: string, report: ImportReport): Promise<void> {
  const lines = [
    '# Satisfactory Blueprint Import Report',
    '',
    `- Game blueprint dir: ${report.selectedGameBlueprintDir}`,
    `- Mapping dir: ${report.selectedMappingDir}`,
    `- Save path: ${report.selectedSavePath}`,
    `- Backup dir: ${report.backupDir}`,
    '',
    '## Summary',
    '',
    `- Copied files: ${report.copiedFiles.length}`,
    `- Overwritten files: ${report.overwrittenFiles.length}`,
    `- Skipped files: ${report.skippedFiles.length}`,
    `- Categories created: ${report.categoriesCreated.length}`,
    `- Subcategories created: ${report.subcategoriesCreated.length}`,
    `- Assignments: ${report.blueprintAssignments.length}`,
    `- PlayerState cleanup removed objects: ${report.playerStateCleanup?.removedObjects.length ?? 0}`,
    `- Warnings: ${report.warnings.length}`,
    `- Errors: ${report.errors.length}`,
    '',
    '## Verification',
    '',
    `- Save write attempted: ${report.verificationResult.saveWriteAttempted}`,
    `- Passed: ${report.verificationResult.passed}`,
    `- Message: ${report.verificationResult.message}`,
    `- Undefined count: ${report.verificationResult.undefinedCount ?? 'unknown'}`,
    '',
    '## Category Counts',
    '',
    ...(report.verificationResult.categoryCounts ? Object.entries(report.verificationResult.categoryCounts).map(([category, count]) => `- ${category}: ${count}`) : ['- Not available']),
    '',
    '## PlayerState Cleanup',
    '',
    `- Checked: ${report.playerStateCleanup?.checked ?? false}`,
    `- Changed: ${report.playerStateCleanup?.changed ?? false}`,
    `- PlayerState count: ${report.playerStateCleanup?.playerStateCount ?? 'unknown'}`,
    ...(report.playerStateCleanup?.duplicateGroups.length
      ? report.playerStateCleanup.duplicateGroups.map((group) => `- ${group.identityKey}: kept ${group.kept.length}, removable ${group.removable.length}, blocked ${group.blocked.length}`)
      : ['- No duplicate identity groups found']),
    '',
    '## Blueprint Assignments',
    '',
    ...report.blueprintAssignments.map((assignment) => `- ${assignment.blueprintStem}: ${assignment.category} / ${assignment.subcategory}`),
    '',
    '## Warnings',
    '',
    ...(report.warnings.length ? report.warnings.map((notice) => `- [${notice.code}] ${notice.message}${notice.path ? ` (${notice.path})` : ''}`) : ['- None']),
    '',
    '## Errors',
    '',
    ...(report.errors.length ? report.errors.map((notice) => `- [${notice.code}] ${notice.message}${notice.path ? ` (${notice.path})` : ''}`) : ['- None'])
  ];
  const fs = await import('node:fs/promises');
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
}
