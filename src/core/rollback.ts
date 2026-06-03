import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR } from '../shared/constants';
import type { RollbackReport } from '../shared/types';
import { createBackup } from './backup';
import { assertWithinRoot, copyDirectorySnapshot, ensureDir, pathExists, removeDirectoryContents, writeJson } from './fsUtils';

export async function rollbackFromBackup(backupDir: string, rootDir = BACKUPS_DIR): Promise<RollbackReport> {
  // 红线保护：回滚会写存档与蓝图夹，因此只接受 backups 根内的备份目录，拒绝越界路径
  // （与 deleteBackup 同级的边界校验）。
  const resolvedBackupDir = assertWithinRoot(rootDir, backupDir, `拒绝回滚：不是备份目录内的路径：${backupDir}`);

  const metaPath = path.join(resolvedBackupDir, 'backup-meta.json');
  if (!(await pathExists(metaPath))) {
    throw new Error(`备份缺少 backup-meta.json：${resolvedBackupDir}`);
  }
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as { savePath?: string; blueprintDir?: string };
  if (!meta.savePath || !meta.blueprintDir) {
    throw new Error('备份元数据缺少 savePath 或 blueprintDir。');
  }

  const rollbackBeforeBackupDir = await createBackup({
    savePath: meta.savePath,
    blueprintDir: meta.blueprintDir,
    mappingReport: { rollbackBefore: true, sourceBackupDir: resolvedBackupDir },
    prefix: 'rollback-before'
  });

  const savedFiles = await fs.readdir(path.join(resolvedBackupDir, 'save'));
  const sourceSave = path.join(resolvedBackupDir, 'save', savedFiles.find((name) => name.toLowerCase().endsWith('.sav')) ?? '');
  if (!(await pathExists(sourceSave))) {
    throw new Error('备份中未找到 .sav 文件。');
  }
  await ensureDir(path.dirname(meta.savePath));
  await fs.copyFile(sourceSave, meta.savePath);

  await removeDirectoryContents(meta.blueprintDir);
  await copyDirectorySnapshot(path.join(resolvedBackupDir, 'blueprints'), meta.blueprintDir);

  const report: RollbackReport = {
    backupDir: resolvedBackupDir,
    rollbackBeforeBackupDir,
    restoredSavePath: meta.savePath,
    restoredBlueprintDir: meta.blueprintDir,
    warnings: [],
    errors: []
  };
  await writeJson(path.join(resolvedBackupDir, 'rollback-report.json'), report);
  return report;
}
