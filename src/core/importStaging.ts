import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataRoot } from '../main/paths';

// 导入暂存区：从系统拖入 / 从压缩包解压出来的蓝图文件，先复制到这里（应用数据目录下），
// 草稿只引用暂存副本；apply 时再从暂存区复制进游戏蓝图夹。这样即使原始来源（压缩软件的
// 临时夹、被删的源目录）在 apply 前消失，也不会出现 ENOENT。
//
// 红线：暂存区在 dataRoot 下，绝不写游戏蓝图夹 / .sav / 外部映射夹。

const STAGING_DIR_NAME = '.import-staging';

export function importStagingRoot(): string {
  return path.join(resolveDataRoot(), STAGING_DIR_NAME);
}

// 启动时清理上次会话遗留的暂存（草稿不跨会话持久化，遗留副本必为孤儿）。
export async function cleanImportStaging(): Promise<void> {
  try {
    await fs.rm(importStagingRoot(), { recursive: true, force: true });
  } catch {
    // ignore: 清理失败不致命
  }
}

// 新建一个唯一的暂存子目录，返回其绝对路径。每次导入操作用一个独立子目录。
export async function createStagingDir(): Promise<string> {
  const dir = path.join(importStagingRoot(), randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
