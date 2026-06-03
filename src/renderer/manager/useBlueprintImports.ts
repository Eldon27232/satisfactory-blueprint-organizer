import { useState, type DragEvent } from 'react';
import {
  addBlueprints,
  allStemsLower,
  makeId,
  mergeImportedBlueprints,
  nextAvailableStem,
  type DraftBlueprint,
  type DraftTree,
  type ImportedBlueprintInput
} from '../../shared/draftModel';
import { assignZipEntry, maxDepth } from '../../shared/zipLayout';
import type { Notice, ZipBlueprintEntry } from '../../shared/types';
import type { Selection } from './managerSelectors';

// 一个待向导处理的 zip（深度 ≥2，需用户选层级）。
export interface ZipWizardZip {
  zipName: string;
  entries: ZipBlueprintEntry[];
}

// 向导队列：逐个处理 zips，index 指向当前正在处理的那个（界面显示 index+1 / zips.length）。
export interface ZipWizardState {
  zips: ZipWizardZip[];
  index: number;
}

interface UseBlueprintImportsParams {
  draft: DraftTree;
  selection: Selection;
  /** 应用一次草稿变更（含脏标记），由组件提供。 */
  update: (next: DraftTree) => void;
}

interface UseBlueprintImports {
  importNotices: Notice[];
  showNotices: boolean;
  setShowNotices: (value: boolean) => void;
  onDropFiles: (event: DragEvent<HTMLElement>) => Promise<void>;
  onClickImportZip: () => Promise<void>;
  /** 当前向导队列；null = 无向导。组件据此渲染 ZipImportWizard。 */
  zipWizard: ZipWizardState | null;
  /** 确认当前 zip 的层级选择：映射并并入草稿，推进到下一个 zip（或关闭）。 */
  resolveZipWizard: (categoryLevel: number, subLevel: number | null) => void;
  /** 取消向导：停止处理剩余 zip（已确认的不回滚）。 */
  cancelZipWizard: () => void;
}

function toInput(assigned: { category: string; subcategory: string }, entry: ZipBlueprintEntry): ImportedBlueprintInput {
  return {
    category: assigned.category,
    subcategory: assigned.subcategory,
    stem: entry.stem,
    sourceSbpPath: entry.sbpPath,
    sourceCfgPath: entry.cfgPath,
    iconId: entry.iconId
  };
}

// 蓝图导入交互：从系统拖入（.zip 走压缩包导入、.sbp/.sbpcfg 走散文件导入）或点击按钮选 zip。
// 解压/复制在主进程完成，文件先落导入暂存区，草稿只引用暂存副本（apply 前不碰存档夹）。
// 压缩包：浅层（深度≤1）自动映射并入；深层（≥2）入向导队列，由用户逐个选「目录层/子目录层」。
export function useBlueprintImports({ draft, selection, update }: UseBlueprintImportsParams): UseBlueprintImports {
  const [importNotices, setImportNotices] = useState<Notice[]>([]);
  const [showNotices, setShowNotices] = useState(false);
  const [zipWizard, setZipWizard] = useState<ZipWizardState | null>(null);

  // 从系统拖入文件：.zip 与 .sbp/.sbpcfg 可同时拖入，分别走压缩包 / 散文件导入。
  async function onDropFiles(event: DragEvent<HTMLElement>): Promise<void> {
    if (event.dataTransfer.files.length === 0) return; // 内部拖拽（移动蓝图）不在此处理
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.sbc?.getPathForFile(file))
      .filter((value): value is string => Boolean(value));
    if (paths.length === 0) return;
    const zipPaths = paths.filter((p) => p.toLowerCase().endsWith('.zip'));
    const looseFiles = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower.endsWith('.sbp') || lower.endsWith('.sbpcfg');
    });
    if (zipPaths.length > 0) await importZipFromPaths(zipPaths);
    if (looseFiles.length > 0) await importLooseFiles(looseFiles);
  }

  // .sbp/.sbpcfg 散文件导入：必须先选中一个子分类；成对校验，缺一不导入并计入 error。
  async function importLooseFiles(paths: string[]): Promise<void> {
    if (selection?.type !== 'subcategory') {
      setImportNotices([{ severity: 'error', code: 'NO_SUBCATEGORY', message: '请先在左侧选择一个子分类，再把蓝图文件拖进来。' }]);
      setShowNotices(true);
      return;
    }
    const sbc = window.sbc;
    if (!sbc) return;
    const targetSubId = selection.id;
    const result = await sbc.importDroppedBlueprints(paths);
    if (result.blueprints.length > 0) {
      const taken = allStemsLower(draft);
      const additions: DraftBlueprint[] = result.blueprints.map((item) => {
        const stem = nextAvailableStem(item.stem, taken);
        taken.add(stem.trim().toLowerCase());
        return {
          id: makeId('bp'),
          stem,
          originalStem: item.stem,
          origin: 'external',
          sourceSbpPath: item.sbpPath,
          sourceCfgPath: item.cfgPath,
          hasSbp: true,
          hasCfg: true,
          iconId: item.iconId,
          originalIconId: item.iconId,
          warnings: []
        };
      });
      update(addBlueprints(draft, additions, targetSubId));
    }
    setImportNotices(result.errors);
    if (result.errors.length > 0) setShowNotices(true);
  }

  // 压缩包导入：解压（主进程）→ 按 zipName 分组 → 浅层自动并入、深层入向导队列。
  async function importZipFromPaths(zipPaths: string[]): Promise<void> {
    const sbc = window.sbc;
    if (!sbc) return;
    const result = await sbc.importZipBlueprints(zipPaths);
    setImportNotices(result.notices);
    if (result.notices.length > 0) setShowNotices(true);
    if (result.entries.length === 0) return;

    // 按 zipName 分组（保持首次出现顺序）。
    const groups = new Map<string, ZipBlueprintEntry[]>();
    for (const entry of result.entries) {
      const list = groups.get(entry.zipName) ?? [];
      list.push(entry);
      groups.set(entry.zipName, list);
    }

    const autoInputs: ImportedBlueprintInput[] = [];
    const wizardZips: ZipWizardZip[] = [];
    for (const [zipName, entries] of groups) {
      const depth = maxDepth(entries.map((entry) => ({ dirSegments: entry.dirSegments, stem: entry.stem })));
      if (depth >= 2) {
        wizardZips.push({ zipName, entries });
        continue;
      }
      // 浅层：整包名作分类，一层文件夹作子分类（C=0, S=1，等同旧自动映射）。
      for (const entry of entries) {
        const assigned = assignZipEntry(zipName, entry.dirSegments, 0, 1);
        if (assigned) autoInputs.push(toInput(assigned, entry));
      }
    }

    if (autoInputs.length > 0) update(mergeImportedBlueprints(draft, autoInputs));
    if (wizardZips.length > 0) setZipWizard({ zips: wizardZips, index: 0 });
  }

  // 点击"导入压缩包"按钮：选 zip → 导入。
  async function onClickImportZip(): Promise<void> {
    const sbc = window.sbc;
    if (!sbc) return;
    const zipPaths = await sbc.chooseZipFiles();
    if (zipPaths.length > 0) await importZipFromPaths(zipPaths);
  }

  // 确认当前 zip：按所选层级映射、丢弃浅层项，并入草稿，推进队列。
  function resolveZipWizard(categoryLevel: number, subLevel: number | null): void {
    if (!zipWizard) return;
    const zip = zipWizard.zips[zipWizard.index];
    const inputs: ImportedBlueprintInput[] = [];
    for (const entry of zip.entries) {
      const assigned = assignZipEntry(zip.zipName, entry.dirSegments, categoryLevel, subLevel);
      if (assigned) inputs.push(toInput(assigned, entry));
    }
    if (inputs.length > 0) update(mergeImportedBlueprints(draft, inputs));
    setZipWizard(zipWizard.index + 1 < zipWizard.zips.length ? { zips: zipWizard.zips, index: zipWizard.index + 1 } : null);
  }

  function cancelZipWizard(): void {
    setZipWizard(null);
  }

  return { importNotices, showNotices, setShowNotices, onDropFiles, onClickImportZip, zipWizard, resolveZipWizard, cancelZipWizard };
}
