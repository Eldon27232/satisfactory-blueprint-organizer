import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFileOperations, DraftApplyError, executeApplyOperations, type ApplyOperation, type FileOpRecords } from '../src/core/draftApply/pipeline';
import type { ResolvedFileOps } from '../src/core/draftApply/fileOps';
import type { DraftBlueprint } from '../src/shared/draftModel';

let gameDir: string;
let stageDir: string;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sbc-pipeline-'));
  gameDir = path.join(root, 'game');
  stageDir = path.join(root, 'stage');
  await fs.mkdir(gameDir, { recursive: true });
  await fs.mkdir(stageDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(path.dirname(gameDir), { recursive: true, force: true });
});

const stubBlueprint = { id: 'x', stem: 'x', originalStem: 'x', origin: 'gameDir', sourceSbpPath: null, sourceCfgPath: null, hasSbp: true, hasCfg: false, iconId: null, originalIconId: null, warnings: [] } satisfies DraftBlueprint;

function emptyOps(overrides: Partial<ResolvedFileOps> = {}): ResolvedFileOps {
  return { copies: [], renames: [], deletions: [], removedStems: [], saveOnly: [], iconWrites: [], mappingWriteBacks: [], notices: [], ...overrides };
}

function records(): FileOpRecords {
  return { copiedFiles: [], renamedFiles: [], deletedFiles: [] };
}

describe('executeApplyOperations', () => {
  it('runs operations in order and records completed steps', async () => {
    const order: string[] = [];
    const ops: ApplyOperation[] = [
      { kind: 'delete', label: 'op1', run: async () => { order.push('1'); } },
      { kind: 'copy', label: 'op2', run: async () => { order.push('2'); } }
    ];
    const completed = await executeApplyOperations(ops, 'backup');
    expect(order).toEqual(['1', '2']);
    expect(completed.map((c) => c.label)).toEqual(['op1', 'op2']);
  });

  it('aborts on the first failing step with a structured DraftApplyError', async () => {
    const ops: ApplyOperation[] = [
      { kind: 'delete', label: 'op1', run: async () => {} },
      { kind: 'copy', label: 'op2', run: async () => { throw new Error('boom'); } },
      { kind: 'copy', label: 'op3', run: async () => { throw new Error('should not run'); } }
    ];
    let caught: DraftApplyError | null = null;
    try {
      await executeApplyOperations(ops, 'C:/backups/x');
    } catch (error) {
      caught = error as DraftApplyError;
    }
    expect(caught).toBeInstanceOf(DraftApplyError);
    expect(caught?.completed.map((c) => c.label)).toEqual(['op1']);
    expect(caught?.failed.label).toBe('op2');
    expect(caught?.backupDir).toBe('C:/backups/x');
    expect(caught?.message).toContain('备份目录');
  });
});

describe('buildFileOperations', () => {
  it('copies files and deletes files, recording each', async () => {
    await fs.writeFile(path.join(stageDir, 'new.sbp'), 'N');
    await fs.writeFile(path.join(gameDir, 'gone.sbp'), 'G');
    const ops = emptyOps({
      copies: [{ blueprint: stubBlueprint, fromSbp: path.join(stageDir, 'new.sbp'), toSbp: path.join(gameDir, 'new.sbp'), fromCfg: null, toCfg: null }],
      deletions: [{ sbp: path.join(gameDir, 'gone.sbp'), cfg: null }]
    });
    const rec = records();
    await executeApplyOperations(buildFileOperations(ops, gameDir, rec), 'backup');

    expect(await fs.readFile(path.join(gameDir, 'new.sbp'), 'utf8')).toBe('N');
    expect(rec.copiedFiles).toContain(path.join(gameDir, 'new.sbp'));
    expect(rec.deletedFiles).toContain(path.join(gameDir, 'gone.sbp'));
    await expect(fs.access(path.join(gameDir, 'gone.sbp'))).rejects.toBeTruthy();
  });

  it('handles a rename swap via two-phase staging (a<->b)', async () => {
    await fs.writeFile(path.join(gameDir, 'a.sbp'), 'A');
    await fs.writeFile(path.join(gameDir, 'b.sbp'), 'B');
    const ops = emptyOps({
      renames: [
        { blueprint: stubBlueprint, fromSbp: path.join(gameDir, 'a.sbp'), toSbp: path.join(gameDir, 'b.sbp'), fromCfg: null, toCfg: null },
        { blueprint: stubBlueprint, fromSbp: path.join(gameDir, 'b.sbp'), toSbp: path.join(gameDir, 'a.sbp'), fromCfg: null, toCfg: null }
      ]
    });
    const rec = records();
    await executeApplyOperations(buildFileOperations(ops, gameDir, rec), 'backup');

    // 两阶段 staging 后内容互换，且不残留 staging 目录。
    expect(await fs.readFile(path.join(gameDir, 'a.sbp'), 'utf8')).toBe('B');
    expect(await fs.readFile(path.join(gameDir, 'b.sbp'), 'utf8')).toBe('A');
    expect(rec.renamedFiles).toHaveLength(2);
    await expect(fs.access(path.join(gameDir, '.sbc-rename-staging'))).rejects.toBeTruthy();
  });
});
