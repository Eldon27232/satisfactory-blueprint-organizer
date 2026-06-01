import { promises as fs } from 'node:fs';
import path from 'node:path';

// 每个存档的「有未应用手动更改」脏标记。按红线要求不写进存档文件夹，而是集中存在
// 应用数据目录（cwd 已在主进程启动时切到 dataRoot）下的一个 JSON，按存档绝对路径为键。
const STATE_FILE = 'organizer-state.json';

async function readState(): Promise<Record<string, boolean>> {
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve(STATE_FILE), 'utf8')) as Record<string, boolean>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export async function readDirtyFlag(savePath: string): Promise<boolean> {
  const state = await readState();
  return Boolean(state[savePath]);
}

export async function writeDirtyFlag(savePath: string, dirty: boolean): Promise<void> {
  const state = await readState();
  if (dirty) state[savePath] = true;
  else delete state[savePath];
  await fs.writeFile(path.resolve(STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
}
