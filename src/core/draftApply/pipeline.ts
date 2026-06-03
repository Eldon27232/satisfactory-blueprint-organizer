import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeBlueprintIconId } from '../blueprintConfig';
import { ensureDir, pathExists } from '../fsUtils';
import type { ResolvedFileOps } from './fileOps';

// apply 写盘建模成有序 operation pipeline：每一步是一个可执行单元，执行器逐步运行并记录结果。
// 这样中途失败时能明确「写到哪一步、已完成哪些、备份在哪」，而不是裸抛第一个错误。
// 注意：各 op 的写盘逻辑与顺序与历史实现严格一致，本模块只把执行结构化、可解释化。

export type ApplyOpKind = 'delete' | 'copy' | 'rename' | 'icon-write' | 'mapping-write-back' | 'save-write';

export interface ApplyOperation {
  kind: ApplyOpKind;
  label: string;
  run: () => Promise<void>;
}

export interface CompletedOperation {
  kind: ApplyOpKind;
  label: string;
}

// apply 中途失败：携带已完成步骤、失败步骤与备份目录，供 UI 解释「写到哪了、怎么恢复」。
export class DraftApplyError extends Error {
  constructor(
    message: string,
    public readonly completed: CompletedOperation[],
    public readonly failed: CompletedOperation,
    public readonly backupDir: string
  ) {
    super(message);
    this.name = 'DraftApplyError';
  }
}

const RENAME_STAGING_DIR = '.sbc-rename-staging';

export interface FileOpRecords {
  copiedFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
}

// 把已解析的文件操作转成有序 operation 列表，顺序与历史实现一致：
// 删除 → 复制 → 改名(两阶段) → 写图标 → 写回映射夹。每个 op 执行后把结果记入 records 供报告使用。
export function buildFileOperations(ops: ResolvedFileOps, gameBlueprintDir: string, records: FileOpRecords): ApplyOperation[] {
  const operations: ApplyOperation[] = [];

  // Deletions (recycle bin): remove files from the flat game dir.
  for (const deletion of ops.deletions) {
    operations.push({
      kind: 'delete',
      label: `删除回收蓝图：${path.basename(deletion.sbp)}`,
      run: async () => {
        if (await pathExists(deletion.sbp)) {
          await fs.rm(deletion.sbp, { force: true });
          records.deletedFiles.push(deletion.sbp);
        }
        if (deletion.cfg && (await pathExists(deletion.cfg))) {
          await fs.rm(deletion.cfg, { force: true });
          records.deletedFiles.push(deletion.cfg);
        }
      }
    });
  }

  // Copies (external imports).
  for (const copy of ops.copies) {
    operations.push({
      kind: 'copy',
      label: `复制导入蓝图：${path.basename(copy.toSbp)}`,
      run: async () => {
        await ensureDir(path.dirname(copy.toSbp));
        await fs.copyFile(copy.fromSbp, copy.toSbp);
        records.copiedFiles.push(copy.toSbp);
        if (copy.fromCfg && copy.toCfg) {
          await fs.copyFile(copy.fromCfg, copy.toCfg);
          records.copiedFiles.push(copy.toCfg);
        }
      }
    });
  }

  // Renames via two-phase staging (handles swaps/cycles in the flat dir) — one atomic operation.
  if (ops.renames.length > 0) {
    operations.push({
      kind: 'rename',
      label: `改名 ${ops.renames.length} 个蓝图`,
      run: async () => {
        const staging = path.join(gameBlueprintDir, RENAME_STAGING_DIR);
        await ensureDir(staging);
        try {
          for (const rename of ops.renames) {
            await fs.rename(rename.fromSbp, path.join(staging, path.basename(rename.toSbp)));
            if (rename.fromCfg && rename.toCfg && (await pathExists(rename.fromCfg))) {
              await fs.rename(rename.fromCfg, path.join(staging, path.basename(rename.toCfg)));
            }
          }
          for (const rename of ops.renames) {
            await fs.rename(path.join(staging, path.basename(rename.toSbp)), rename.toSbp);
            records.renamedFiles.push({ from: rename.fromSbp, to: rename.toSbp });
            if (rename.toCfg) {
              const stagedCfg = path.join(staging, path.basename(rename.toCfg));
              if (await pathExists(stagedCfg)) await fs.rename(stagedCfg, rename.toCfg);
            }
          }
        } finally {
          await fs.rm(staging, { recursive: true, force: true });
        }
      }
    });
  }

  // Blueprint icon edits: rewrite each changed .sbpcfg's iconID (files now at their final paths).
  for (const write of ops.iconWrites) {
    operations.push({
      kind: 'icon-write',
      label: `写入蓝图图标：${path.basename(write.cfgPath)}`,
      run: async () => {
        if (await pathExists(write.cfgPath)) {
          await writeBlueprintIconId(write.cfgPath, write.iconId);
        }
      }
    });
  }

  // Write-backs into the external mapping folder (kept manager-only blueprints).
  for (const wb of ops.mappingWriteBacks) {
    operations.push({
      kind: 'mapping-write-back',
      label: `写回映射夹：${path.basename(wb.toSbp)}`,
      run: async () => {
        if (await pathExists(wb.fromSbp)) {
          await ensureDir(path.dirname(wb.toSbp));
          await fs.copyFile(wb.fromSbp, wb.toSbp);
          records.copiedFiles.push(wb.toSbp);
          if (wb.fromCfg && wb.toCfg && (await pathExists(wb.fromCfg))) {
            await fs.copyFile(wb.fromCfg, wb.toCfg);
            records.copiedFiles.push(wb.toCfg);
          }
        }
      }
    });
  }

  return operations;
}

// 顺序执行 operation，逐个记录已完成步骤。任一步抛错即中止并抛 DraftApplyError，
// 携带已完成步骤、失败步与备份目录，供调用方生成可解释的失败报告。
export async function executeApplyOperations(operations: ApplyOperation[], backupDir: string): Promise<CompletedOperation[]> {
  const completed: CompletedOperation[] = [];
  for (const op of operations) {
    try {
      await op.run();
      completed.push({ kind: op.kind, label: op.label });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const lines = [
        `应用中途失败：${op.label}`,
        `原因：${detail}`,
        `已完成 ${completed.length} 步；备份目录：${backupDir}`
      ];
      if (completed.length > 0) lines.push('可在「备份与回滚」中回滚到应用前的状态。');
      throw new DraftApplyError(lines.join('\n'), completed, { kind: op.kind, label: op.label }, backupDir);
    }
  }
  return completed;
}
