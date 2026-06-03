import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function timestampForPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export async function copyDirectorySnapshot(sourceDir: string, targetDir: string): Promise<void> {
  await ensureDir(targetDir);
  if (!(await pathExists(sourceDir))) return;
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectorySnapshot(source, target);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(target));
      await fs.copyFile(source, target);
    }
  }
}

export async function removeDirectoryContents(dir: string): Promise<void> {
  if (!(await pathExists(dir))) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// 路径边界校验：target 必须在 root 内部（不含 root 本身）。集中给 backup/rollback/delete 等
// 危险写盘 API 复用，拒绝越界路径，防止误删 / 误覆盖 backups 根之外的目录。
export function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// 校验 target 在 root 内，否则抛错；通过则返回解析后的绝对路径供调用方直接使用。
export function assertWithinRoot(root: string, target: string, message?: string): string {
  if (!isWithinRoot(root, target)) {
    throw new Error(message ?? `拒绝操作：不是 ${root} 内的路径：${target}`);
  }
  return path.resolve(target);
}
