import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR } from '../shared/constants';
import type { BackupRecord } from '../shared/types';
import { assertWithinRoot, copyDirectorySnapshot, ensureDir, pathExists, timestampForPath, writeJson } from './fsUtils';

export interface CreateBackupOptions {
  savePath: string;
  blueprintDir: string;
  mappingReport: unknown;
  rootDir?: string;
  prefix?: string;
}

export async function createBackup(options: CreateBackupOptions): Promise<string> {
  const backupId = `${options.prefix ? `${options.prefix}-` : ''}${timestampForPath()}`;
  const backupDir = path.resolve(options.rootDir ?? BACKUPS_DIR, backupId);
  const saveDir = path.join(backupDir, 'save');
  const blueprintsDir = path.join(backupDir, 'blueprints');
  await ensureDir(saveDir);
  await ensureDir(blueprintsDir);

  if (!(await pathExists(options.savePath))) {
    throw new Error(`备份失败：目标 .sav 不存在：${options.savePath}`);
  }
  if (!(await pathExists(options.blueprintDir))) {
    throw new Error(`备份失败：目标蓝图目录不存在：${options.blueprintDir}`);
  }

  await fs.copyFile(options.savePath, path.join(saveDir, path.basename(options.savePath)));
  await copyDirectorySnapshot(options.blueprintDir, blueprintsDir);
  await writeJson(path.join(backupDir, 'mapping-report-before.json'), options.mappingReport);
  await writeJson(path.join(backupDir, 'backup-meta.json'), {
    createdAt: new Date().toISOString(),
    savePath: options.savePath,
    blueprintDir: options.blueprintDir
  });
  return backupDir;
}

export async function listBackups(rootDir = BACKUPS_DIR): Promise<BackupRecord[]> {
  if (!(await pathExists(rootDir))) return [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const records: BackupRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backupPath = path.resolve(rootDir, entry.name);
    const metaPath = path.join(backupPath, 'backup-meta.json');
    let meta: Partial<BackupRecord> & { savePath?: string; blueprintDir?: string } = {};
    if (await pathExists(metaPath)) {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as typeof meta;
    }
    records.push({
      id: entry.name,
      path: backupPath,
      createdAt: String(meta.createdAt ?? entry.name),
      savePath: meta.savePath,
      blueprintDir: meta.blueprintDir
    });
  }
  return records.sort((a, b) => b.id.localeCompare(a.id));
}

/** Permanently delete one backup directory. Refuses any path outside the backups root. */
export async function deleteBackup(backupDir: string, rootDir = BACKUPS_DIR): Promise<void> {
  const target = assertWithinRoot(rootDir, backupDir, `拒绝删除：不是备份目录内的路径：${backupDir}`);
  await fs.rm(target, { recursive: true, force: true });
}
