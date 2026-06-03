import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFileOps } from '../src/core/draftApply/fileOps';
import { RECYCLE_BIN_ID, type DraftBlueprint, type DraftCategory, type DraftTree } from '../src/shared/draftModel';

let root: string;
let gameDir: string;
let stageDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sbc-fileops-'));
  gameDir = path.join(root, 'game');
  stageDir = path.join(root, 'stage');
  await fs.mkdir(gameDir, { recursive: true });
  await fs.mkdir(stageDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function bp(id: string, stem: string, extra: Partial<DraftBlueprint> = {}): DraftBlueprint {
  return {
    id,
    stem,
    originalStem: stem,
    origin: 'gameDir',
    sourceSbpPath: null,
    sourceCfgPath: null,
    hasSbp: true,
    hasCfg: true,
    iconId: null,
    originalIconId: null,
    warnings: [],
    ...extra
  };
}

// 把蓝图放进一个普通分类（用于 locateBlueprint / 非回收）。
function category(blueprintIds: string[]): DraftCategory {
  return { id: 'cat1', name: 'Power', iconId: null, subcategories: [{ id: 'sub1', name: 'Coal', blueprintIds }] };
}

function recycleCategory(blueprintIds: string[]): DraftCategory {
  return { id: RECYCLE_BIN_ID, name: '回收站', iconId: null, subcategories: [{ id: 'rsub', name: '回收站', blueprintIds }] };
}

function tree(blueprints: Record<string, DraftBlueprint>, categories: DraftCategory[], overrides: Partial<DraftTree> = {}): DraftTree {
  return { gameBlueprintDir: gameDir, savePath: null, sessionName: 'S', buildNotices: [], blueprints, categories, ...overrides };
}

async function writeFile(dir: string, name: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), 'x');
}

describe('resolveFileOps', () => {
  it('copies an external blueprint when the target name is free', async () => {
    await writeFile(stageDir, 'ext.sbp');
    await writeFile(stageDir, 'ext.sbpcfg');
    const b = bp('b1', 'ext', { origin: 'external', sourceSbpPath: path.join(stageDir, 'ext.sbp'), sourceCfgPath: path.join(stageDir, 'ext.sbpcfg') });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.copies).toHaveLength(1);
    expect(ops.copies[0].toSbp).toBe(path.join(gameDir, 'ext.sbp'));
    expect(ops.notices).toHaveLength(0);
  });

  it('refuses to overwrite an existing blueprint in the flat game dir', async () => {
    await writeFile(gameDir, 'ext.sbp'); // 目标已存在
    const b = bp('b1', 'ext', { origin: 'external', sourceSbpPath: path.join(stageDir, 'ext.sbp'), sourceCfgPath: null, hasCfg: false });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.copies).toHaveLength(0);
    expect(ops.notices.some((n) => n.code === 'TARGET_EXISTS')).toBe(true);
  });

  it('renames a gameDir blueprint whose stem changed', async () => {
    await writeFile(gameDir, 'old.sbp');
    await writeFile(gameDir, 'old.sbpcfg');
    const b = bp('b1', 'new', { originalStem: 'old' });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.renames).toHaveLength(1);
    expect(ops.renames[0].fromSbp).toBe(path.join(gameDir, 'old.sbp'));
    expect(ops.renames[0].toSbp).toBe(path.join(gameDir, 'new.sbp'));
  });

  it('warns when a rename source file is missing', async () => {
    const b = bp('b1', 'new', { originalStem: 'ghost' }); // ghost.sbp 不存在
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.renames).toHaveLength(0);
    expect(ops.notices.some((n) => n.code === 'RENAME_SOURCE_MISSING')).toBe(true);
  });

  it('produces no op for an unchanged gameDir blueprint', async () => {
    const b = bp('b1', 'same', { originalStem: 'same' });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.copies).toHaveLength(0);
    expect(ops.renames).toHaveLength(0);
  });

  it('deletes recycled gameDir blueprints and records removed stems', async () => {
    const b = bp('b1', 'trash', { originalStem: 'trash' });
    // 新模型：回收站是独立的 recycleBin 子森林，不在 categories 里。
    const ops = await resolveFileOps(tree({ b1: b }, [], { recycleBin: [recycleCategory(['b1'])] }));
    expect(ops.deletions).toHaveLength(1);
    expect(ops.deletions[0].sbp).toBe(path.join(gameDir, 'trash.sbp'));
    expect(ops.removedStems).toContain('trash');
  });

  it('collects save-only blueprints (no physical .sbp)', async () => {
    const b = bp('b1', 'phantom', { hasSbp: false, hasCfg: false });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.saveOnly).toContain('phantom');
  });

  it('queues an icon write when the icon changed for a kept blueprint', async () => {
    const b = bp('b1', 'lit', { iconId: 7, originalIconId: 1 });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])]));
    expect(ops.iconWrites).toHaveLength(1);
    expect(ops.iconWrites[0]).toEqual({ cfgPath: path.join(gameDir, 'lit.sbpcfg'), iconId: 7 });
  });

  it('queues a mapping write-back for kept manager-only blueprints', async () => {
    const mappingDir = path.join(root, 'mapping');
    const b = bp('b1', 'keep', { writeBackToMapping: true });
    const ops = await resolveFileOps(tree({ b1: b }, [category(['b1'])], { mappingDir }));
    expect(ops.mappingWriteBacks).toHaveLength(1);
    expect(ops.mappingWriteBacks[0].toSbp).toBe(path.join(mappingDir, 'Power', 'Coal', 'keep.sbp'));
  });
});
