import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup } from '../src/core/backup';
import { rollbackFromBackup } from '../src/core/rollback';
import { writeImportReport } from '../src/core/reports';

let tempRoot: string;
let oldCwd: string;

beforeEach(async () => {
  oldCwd = process.cwd();
  tempRoot = await fs.mkdtemp(path.join(oldCwd, 'tmp-report-'));
  process.chdir(tempRoot);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('reports, backup, rollback', () => {
  it('writes JSON and markdown reports', async () => {
    const report = await writeImportReport({
      selectedGameBlueprintDir: 'game',
      selectedMappingDir: 'mapping',
      selectedSavePath: 'save.sav',
      backupDir: 'backup',
      copiedFiles: ['a.sbp'],
      overwrittenFiles: [],
      skippedFiles: [],
      categoriesCreated: [],
      subcategoriesCreated: [],
      blueprintAssignments: [{ blueprintStem: 'a', category: 'A', subcategory: 'B' }],
      warnings: [],
      errors: [],
      verificationResult: { saveWriteAttempted: false, passed: false, message: 'disabled' }
    });
    expect(await exists(path.join(report.reportDir, 'import-report.json'))).toBe(true);
    expect(await exists(path.join(report.reportDir, 'import-report.md'))).toBe(true);
  });

  it('backs up and rolls back save plus blueprint snapshot', async () => {
    const savePath = path.join(tempRoot, 'SessionA.sav');
    const blueprintDir = path.join(tempRoot, 'blueprints');
    await fs.mkdir(blueprintDir, { recursive: true });
    await fs.writeFile(savePath, 'original-save');
    await fs.writeFile(path.join(blueprintDir, 'old.sbp'), 'old');
    const backupDir = await createBackup({ savePath, blueprintDir, mappingReport: { ok: true } });
    await fs.writeFile(savePath, 'changed-save');
    await fs.writeFile(path.join(blueprintDir, 'new.sbp'), 'new');
    const report = await rollbackFromBackup(backupDir);
    expect(await fs.readFile(savePath, 'utf8')).toBe('original-save');
    expect(await exists(path.join(blueprintDir, 'old.sbp'))).toBe(true);
    expect(await exists(path.join(blueprintDir, 'new.sbp'))).toBe(false);
    expect(report.rollbackBeforeBackupDir).toContain('rollback-before');
  });

  it('rejects rollback from a path outside the backups root', async () => {
    // 红线：回滚会写存档/蓝图夹，必须拒绝 backups 根之外的目录。
    const outside = path.join(tempRoot, 'evil-backup');
    await fs.mkdir(outside, { recursive: true });
    await expect(rollbackFromBackup(outside)).rejects.toThrow(/拒绝回滚/);
  });
});

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
