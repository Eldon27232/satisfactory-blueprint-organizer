import type { Notice } from '../types';

// ---------------------------------------------------------------------------
// Draft tree model — types & constants
//
// Pure, dependency-free model shared by the renderer (live editing) and the
// main process (apply). It never touches the filesystem or the .sav parser —
// it only describes desired state. Builders produce a DraftTree, the renderer
// mutates it through the pure helpers, and apply turns it into a CategoryPlan.
// ---------------------------------------------------------------------------

export const UNNAMED = '未命名';
export const UNDEFINED_CATEGORY = 'Undefined';

// Recycle bin: a draft-only category that is never written to the game. Blueprints
// dropped here are excluded from the category plan and their files are deleted on apply.
export const RECYCLE_BIN_ID = 'recycle-bin';
export const RECYCLE_BIN_SUB_ID = 'recycle-bin-sub';
export const RECYCLE_BIN_NAME = '回收站';

export type DraftBlueprintOrigin = 'external' | 'gameDir' | 'save';

export interface DraftBlueprint {
  /** Stable identity for the lifetime of a draft session (survives renames). */
  id: string;
  /** Current (possibly renamed) file stem, without extension. */
  stem: string;
  /** Stem as it exists on disk / in the save before any edits. */
  originalStem: string;
  origin: DraftBlueprintOrigin;
  /** Absolute source .sbp path for external imports; null when the file already lives in the game dir. */
  sourceSbpPath: string | null;
  sourceCfgPath: string | null;
  /** Whether a physical .sbp file exists to copy/rename. False for save-only names. */
  hasSbp: boolean;
  hasCfg: boolean;
  /** FGIconLibrary icon id read from the blueprint's .sbpcfg (config.iconID), or null. */
  iconId: number | null;
  /** Icon id as it exists in the .sbpcfg before edits; apply only rewrites a cfg when iconId differs from this. */
  originalIconId: number | null;
  /** Manager-only blueprint the user chose to keep: on apply its files are written back into the external mapping folder. */
  writeBackToMapping?: boolean;
  warnings: Notice[];
}

export interface DraftSubcategory {
  id: string;
  name: string;
  /** Blueprint ids in display order. A blueprint id appears in exactly one subcategory. */
  blueprintIds: string[];
}

export interface DraftCategory {
  id: string;
  name: string;
  /** FGIconLibrary integer id, or null to leave the existing IconID untouched. */
  iconId: number | null;
  /** Icon id read from the save before edits; used to report only genuinely changed category icons. */
  originalIconId?: number | null;
  subcategories: DraftSubcategory[];
}

export interface DraftTree {
  categories: DraftCategory[];
  /** id -> blueprint metadata. */
  blueprints: Record<string, DraftBlueprint>;
  /** Game blueprint dir these blueprints belong to (used to resolve gameDir file paths). */
  gameBlueprintDir: string;
  /** Target .sav this draft was built against, if any. */
  savePath: string | null;
  sessionName: string | null;
  /** Notices produced while building the draft (import-time warnings, icon issues, ...). */
  buildNotices: Notice[];
  /** True when the manager tree has unapplied manual edits (persisted per-save in app data). */
  dirty?: boolean;
  /** External mapping folder this draft was last diffed against; target for write-backs on apply. */
  mappingDir?: string;
  /**
   * 回收站：草稿内的独立子森林（结构与正常树同构：目录→子目录→蓝图），保存被删的
   * 目录/子目录/蓝图并保留来源（影子目录/子目录的名字即原目录/原子目录名）。独立于
   * `categories`，因此天然不进 plan/写回；apply 时其下蓝图按 getRecycledBlueprintIdSet 真删文件。
   * 恢复 = 把节点移回 categories（移出回收站）。
   */
  recycleBin?: DraftCategory[];
}
