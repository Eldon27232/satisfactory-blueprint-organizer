import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RollbackReport } from '../shared/types';
import { createBackup } from './backup';
import { copyDirectorySnapshot, ensureDir, pathExists, removeDirectoryContents, writeJson } from './fsUtils';

export async function rollbackFromBackup(backupDir: string): Promise<RollbackReport> {
  const metaPath = path.join(backupDir, 'backup-meta.json');
  if (!(await pathExists(metaPath))) {
    throw new Error(`备份缺少 backup-meta.json：${backupDir}`);
  }
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as { savePath?: string; blueprintDir?: string };
  if (!meta.savePath || !meta.blueprintDir) {
    throw new Error('备份元数据缺少 savePath 或 blueprintDir。');
  }

  const rollbackBeforeBackupDir = await createBackup({
    savePath: meta.savePath,
    blueprintDir: meta.blueprintDir,
    mappingReport: { rollbackBefore: true, sourceBackupDir: backupDir },
    prefix: 'rollback-before'
  });

  const savedFiles = await fs.readdir(path.join(backupDir, 'save'));
  const sourceSave = path.join(backupDir, 'save', savedFiles.find((name) => name.toLowerCase().endsWith('.sav')) ?? '');
  if (!(await pathExists(sourceSave))) {
    throw new Error('备份中未找到 .sav 文件。');
  }
  await ensureDir(path.dirname(meta.savePath));
  await fs.copyFile(sourceSave, meta.savePath);

  await removeDirectoryContents(meta.blueprintDir);
  await copyDirectorySnapshot(path.join(backupDir, 'blueprints'), meta.blueprintDir);

  const report: RollbackReport = {
    backupDir,
    rollbackBeforeBackupDir,
    restoredSavePath: meta.savePath,
    restoredBlueprintDir: meta.blueprintDir,
    warnings: [],
    errors: []
  };
  await writeJson(path.join(backupDir, 'rollback-report.json'), report);
  return report;
}
