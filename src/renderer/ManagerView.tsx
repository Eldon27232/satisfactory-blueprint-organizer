import { AlertTriangle, CheckSquare, ClipboardPaste, Copy, FileArchive, FolderInput, Layers, Plus, Scissors, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { getBlueprintIconById } from '../shared/blueprintIcons';
import {
  addBlueprints,
  allStemsLower,
  countBlueprintsInCategory,
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  getRecycledBlueprintIdSet,
  mergeSubcategoryIntoUnnamed,
  moveBlueprints,
  moveSubcategoryToCategory,
  nextAvailableStem,
  recycleBlueprints,
  recycleCategory,
  recycleSubcategory,
  renameBlueprint,
  renameCategory,
  renameSubcategory,
  reorderCategory,
  reorderSubcategory,
  restoreRecycledBlueprints,
  restoreRecycledCategory,
  restoreRecycledSubcategory,
  setBlueprintIcon,
  setCategoryIcon,
  validateDraft,
  type DraftApplyPlan,
  type DraftBlueprint,
  type DraftCategory,
  type DraftSubcategory,
  type DraftTree
} from '../shared/draftModel';
import { ConfirmDialog } from './ConfirmDialog';
import { IconImage, IconPicker } from './IconPicker';
import { translate, type Language } from './i18n';
import type { Notice } from '../shared/types';
import { computeVisibleBlueprints, makeCopyBlueprint, resolvePasteTargetSubId, uniqueName, type Selection } from './manager/managerSelectors';
import { CategoryRow } from './manager/CategoryRow';
import { RecycleBinPanel } from './manager/RecycleBinPanel';
import { RecycleBinBrowser } from './manager/RecycleBinBrowser';
import { Inspector } from './manager/Inspector';
import { useBlueprintImports } from './manager/useBlueprintImports';
import { ZipImportWizard } from './manager/ZipImportWizard';

type DragState = { kind: 'blueprints'; ids: string[] } | { kind: 'category'; id: string } | { kind: 'subcategory'; id: string } | null;
type Clipboard = { ids: string[]; mode: 'copy' | 'cut' } | null;

interface ManagerViewProps {
  language: Language;
  draft: DraftTree;
  setDraft: (draft: DraftTree) => void;
  busy: boolean;
  onBack: () => void;
  onApply: (gameClosedConfirmed: boolean) => Promise<void>;
  onImportExternal: () => void;
  fetchPlan: () => Promise<DraftApplyPlan>;
}

export function ManagerView(props: ManagerViewProps): JSX.Element {
  const { draft, setDraft } = props;
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);

  const [selection, setSelection] = useState<Selection>(null);
  const [selectedBlueprintIds, setSelectedBlueprintIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  // 默认全部收起：进入管理界面时所有分类折叠，用户按需展开。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [iconPickerCategoryId, setIconPickerCategoryId] = useState<string | null>(null);
  const [iconPickerBlueprintId, setIconPickerBlueprintId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'category' | 'subcategory'; id: string; name: string; count: number } | null>(null);
  // 选中回收站时，中间区切换成分层浏览器（Windows 文件夹式）而非蓝图网格。
  const [showRecycle, setShowRecycle] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<DraftApplyPlan | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const drag = useRef<DragState>(null);

  function update(next: DraftTree): void {
    setDeleteError('');
    setDraft({ ...next, dirty: true });
    if (next.savePath) void window.sbc?.writeDirtyFlag(next.savePath, true);
  }

  // 导入相关状态与逻辑（拖入 / 选 zip / 散文件）封装在 hook 内，组件只消费其结果。
  const { importNotices, showNotices, setShowNotices, onDropFiles, onClickImportZip, zipWizard, resolveZipWizard, cancelZipWizard } = useBlueprintImports({ draft, selection, update });

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const conflicts = validation.conflictBlueprintIds;
  const recycledIds = useMemo(() => getRecycledBlueprintIdSet(draft), [draft]);
  const allNotices = useMemo(() => [...draft.buildNotices, ...validation.notices, ...importNotices], [draft.buildNotices, validation.notices, importNotices]);
  const errorCount = allNotices.filter((notice) => notice.severity === 'error').length;
  const warningCount = allNotices.filter((notice) => notice.severity === 'warning').length;

  const visibleBlueprints = useMemo(() => computeVisibleBlueprints(draft, selection, search, recycledIds), [draft, selection, search, recycledIds]);

  // 回收站是独立子森林（draft.recycleBin），渲染为底部固定 dock；选中后中间区切换成分层浏览器。
  const treeCategories = draft.categories;
  const recycleBin = draft.recycleBin ?? [];
  const recycleBinCount = recycledIds.size;

  const pasteTargetSubId = resolvePasteTargetSubId(draft, selection);
  const canPaste = Boolean(clipboard && clipboard.ids.length > 0 && pasteTargetSubId);

  function selectNode(node: Selection): void {
    setSelection(node);
    setSelectedBlueprintIds([]);
    setShowRecycle(false);
  }

  function toggleExpanded(categoryId: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  // ---- blueprint selection ----
  function handleBlueprintClick(event: React.MouseEvent, blueprintId: string, orderedIds: string[]): void {
    if (event.shiftKey && selectedBlueprintIds.length > 0) {
      const anchor = selectedBlueprintIds[selectedBlueprintIds.length - 1];
      const from = orderedIds.indexOf(anchor);
      const to = orderedIds.indexOf(blueprintId);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelectedBlueprintIds(orderedIds.slice(lo, hi + 1));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedBlueprintIds((previous) => (previous.includes(blueprintId) ? previous.filter((id) => id !== blueprintId) : [...previous, blueprintId]));
      return;
    }
    setSelectedBlueprintIds([blueprintId]);
  }

  function toggleBlueprintSelected(blueprintId: string): void {
    setSelectedBlueprintIds((previous) => (previous.includes(blueprintId) ? previous.filter((id) => id !== blueprintId) : [...previous, blueprintId]));
  }

  // Select all blueprints currently shown in the grid; click again to clear the selection.
  function toggleSelectAllVisible(): void {
    const ids = visibleBlueprints.groups.flatMap((group) => group.blueprints.map((blueprint) => blueprint.id));
    const allSelected = ids.length > 0 && ids.every((id) => selectedBlueprintIds.includes(id));
    setSelectedBlueprintIds(allSelected ? [] : ids);
  }

  // ---- drag & drop ----
  function onDragStartBlueprint(event: React.DragEvent, blueprintId: string): void {
    const ids = selectedBlueprintIds.includes(blueprintId) ? selectedBlueprintIds : [blueprintId];
    if (!selectedBlueprintIds.includes(blueprintId)) setSelectedBlueprintIds([blueprintId]);
    drag.current = { kind: 'blueprints', ids };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
  }

  function dropOnSubcategory(subcategoryId: string): void {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (state.kind === 'blueprints') {
      update(moveBlueprints(draft, state.ids, subcategoryId));
      setSelectedBlueprintIds([]);
    } else if (state.kind === 'subcategory') {
      update(reorderSubcategory(draft, state.id, subcategoryId));
    }
  }

  function dropOnCategory(category: DraftCategory): void {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (state.kind === 'blueprints') {
      const target = category.subcategories[0];
      if (target) {
        update(moveBlueprints(draft, state.ids, target.id));
        setSelectedBlueprintIds([]);
      }
    } else if (state.kind === 'subcategory') {
      // 拖子目录到分类标题：归属到该分类（挂末尾）。拖到某个子目录上则走 dropOnSubcategory 跨分类插入。
      update(moveSubcategoryToCategory(draft, state.id, category.id));
    } else if (state.kind === 'category') {
      update(reorderCategory(draft, state.id, category.id));
    }
  }

  function dropOnRecycle(): void {
    const state = drag.current;
    drag.current = null;
    if (state?.kind === 'blueprints') {
      update(recycleBlueprints(draft, state.ids));
      setSelectedBlueprintIds([]);
    }
  }

  // ---- toolbar operations ----
  function recycleSelected(): void {
    if (selectedBlueprintIds.length === 0) return;
    update(recycleBlueprints(draft, selectedBlueprintIds));
    setSelectedBlueprintIds([]);
  }

  function copySelected(mode: 'copy' | 'cut'): void {
    if (selectedBlueprintIds.length === 0) return;
    setClipboard({ ids: [...selectedBlueprintIds], mode });
  }

  function paste(): void {
    if (!clipboard || !pasteTargetSubId) return;
    if (clipboard.mode === 'cut') {
      update(moveBlueprints(draft, clipboard.ids, pasteTargetSubId));
      setClipboard(null);
      return;
    }
    const taken = allStemsLower(draft);
    const copies: DraftBlueprint[] = [];
    for (const id of clipboard.ids) {
      const source = draft.blueprints[id];
      if (!source || !source.hasSbp) continue; // can't duplicate a file that doesn't exist
      const newStem = nextAvailableStem(source.stem, taken);
      taken.add(newStem.toLowerCase());
      copies.push(makeCopyBlueprint(draft, source, newStem));
    }
    if (copies.length > 0) update(addBlueprints(draft, copies, pasteTargetSubId));
  }

  // ---- category / subcategory management ----
  function addCategory(): void {
    const name = uniqueName('新分类', draft.categories.map((category) => category.name));
    const next = createCategory(draft, name);
    const created = next.categories[next.categories.length - 1];
    update(next);
    setExpanded((previous) => new Set(previous).add(created.id));
    selectNode({ type: 'category', id: created.id });
  }

  function addSubcategory(categoryId: string): void {
    const category = draft.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const name = uniqueName('新子分类', category.subcategories.map((subcategory) => subcategory.name));
    const next = createSubcategory(draft, categoryId, name);
    const updatedCategory = next.categories.find((item) => item.id === categoryId);
    const created = updatedCategory?.subcategories[updatedCategory.subcategories.length - 1];
    update(next);
    setExpanded((previous) => new Set(previous).add(categoryId)); // 默认收起时也要展开父分类，否则新子分类不可见
    if (created) selectNode({ type: 'subcategory', id: created.id });
  }

  function removeCategory(categoryId: string): void {
    const result = deleteCategory(draft, categoryId);
    if (!result.ok) {
      setDeleteError(t('deleteBlocked'));
      return;
    }
    update(result.tree);
    selectNode(null);
  }

  // 删目录：非空 → 二次确认后整个目录进回收站；空目录直接删除。
  function requestDeleteCategory(categoryId: string): void {
    const category = draft.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const count = countBlueprintsInCategory(category);
    if (count > 0) setPendingDelete({ kind: 'category', id: categoryId, name: category.name, count });
    else removeCategory(categoryId);
  }

  function removeSubcategory(subcategoryId: string): void {
    const result = deleteSubcategory(draft, subcategoryId);
    if (!result.ok) {
      setDeleteError(t('deleteBlocked'));
      return;
    }
    update(result.tree);
    selectNode(null);
  }

  // 删子目录：非空 → 二选一弹窗（并进本目录·未命名 / 进回收站）；空目录直接删。
  function requestDeleteSubcategory(subcategory: DraftSubcategory): void {
    if (subcategory.blueprintIds.length > 0) {
      setPendingDelete({ kind: 'subcategory', id: subcategory.id, name: subcategory.name, count: subcategory.blueprintIds.length });
    } else {
      removeSubcategory(subcategory.id);
    }
  }

  // 确认删除目录 → 整个目录（连子目录/蓝图）进回收站。
  function confirmDeleteCategory(): void {
    if (!pendingDelete) return;
    update(recycleCategory(draft, pendingDelete.id));
    setPendingDelete(null);
    selectNode(null);
  }

  // 删子目录的两个动作：并进本目录·未命名子分类 / 进回收站。
  function dissolveSubcategoryToUnnamed(): void {
    if (!pendingDelete) return;
    update(mergeSubcategoryIntoUnnamed(draft, pendingDelete.id));
    setPendingDelete(null);
    selectNode(null);
  }
  function recycleSubcategoryToBin(): void {
    if (!pendingDelete) return;
    update(recycleSubcategory(draft, pendingDelete.id));
    setPendingDelete(null);
    selectNode(null);
  }

  // ---- 回收站恢复（供 RecycleBinBrowser 调用）----
  function restoreCategories(ids: string[]): void {
    update(ids.reduce((tree, id) => restoreRecycledCategory(tree, id), draft));
  }
  function restoreSubcategories(items: Array<{ categoryId: string; subId: string }>): void {
    update(items.reduce((tree, item) => restoreRecycledSubcategory(tree, item.categoryId, item.subId), draft));
  }
  function restoreBlueprintsFromBin(ids: string[]): void {
    update(restoreRecycledBlueprints(draft, ids));
  }

  // ---- apply ----
  async function openConfirm(): Promise<void> {
    setConfirmBusy(true);
    try {
      setConfirmPlan(await props.fetchPlan());
    } finally {
      setConfirmBusy(false);
    }
  }

  async function confirmApply(gameClosedConfirmed: boolean): Promise<void> {
    setConfirmBusy(true);
    try {
      await props.onApply(gameClosedConfirmed);
      setConfirmPlan(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const hasSelection = selectedBlueprintIds.length > 0;
  const visibleBlueprintIds = visibleBlueprints.groups.flatMap((group) => group.blueprints.map((blueprint) => blueprint.id));
  const allVisibleSelected = visibleBlueprintIds.length > 0 && visibleBlueprintIds.every((id) => selectedBlueprintIds.includes(id));

  return (
    <div className="manager">
      <header className="manager-top">
        <div className="manager-top-left">
          <button className="secondary" onClick={() => (draft.dirty ? setConfirmLeave(true) : props.onBack())} disabled={props.busy}>
            {t('back')}
          </button>
          <button className="secondary" onClick={props.onImportExternal} disabled={props.busy}>
            <FolderInput size={16} /> {t('importExternal')}
          </button>
          <button className="secondary" onClick={() => void onClickImportZip()} disabled={props.busy}>
            <FileArchive size={16} /> {t('importZip')}
          </button>
          <div className="manager-session">
            <strong>{draft.sessionName ?? '-'}</strong>
            <small title={draft.savePath ?? ''}>{draft.savePath ?? '-'}</small>
          </div>
        </div>
        <div className="manager-top-right">
          <span className={`pill clickable ${errorCount ? 'error' : 'ok'}`} title={t('viewNotices')} onClick={() => setShowNotices(true)}>{errorCount} {t('errors')}</span>
          <span className={`pill clickable ${warningCount ? 'warning' : 'ok'}`} title={t('viewNotices')} onClick={() => setShowNotices(true)}>{warningCount} {t('warnings')}</span>
          <button className="secondary" disabled={visibleBlueprintIds.length === 0} onClick={toggleSelectAllVisible}>
            <CheckSquare size={16} /> {allVisibleSelected ? t('deselectAll') : t('selectAll')}
          </button>
          <div className="bp-toolbar">
            <button className="icon-button" title={t('opDelete')} disabled={!hasSelection} onClick={recycleSelected}>
              <Trash2 size={16} />
            </button>
            <button className="icon-button" title={t('opCopy')} disabled={!hasSelection} onClick={() => copySelected('copy')}>
              <Copy size={16} />
            </button>
            <button className="icon-button" title={t('opCut')} disabled={!hasSelection} onClick={() => copySelected('cut')}>
              <Scissors size={16} />
            </button>
            <button className={`icon-button ${clipboard ? 'armed' : ''}`} title={t('opPaste')} disabled={!canPaste} onClick={paste}>
              <ClipboardPaste size={16} />
            </button>
          </div>
          <button className="primary" disabled={props.busy || confirmBusy} onClick={openConfirm}>
            {t('apply')}
          </button>
        </div>
      </header>

      <div className="manager-body">
        {/* LEFT: category tree */}
        <aside className="pane tree-pane">
          <div className="pane-head">
            <span>{t('categoriesPane')}</span>
            <button className="icon-button" title={t('addCategory')} onClick={addCategory}>
              <Plus size={16} />
            </button>
          </div>
          <div className="tree-scroll">
            {treeCategories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                expanded={expanded.has(category.id)}
                selection={selection}
                onToggle={() => toggleExpanded(category.id)}
                onSelectCategory={() => selectNode({ type: 'category', id: category.id })}
                onSelectSubcategory={(subcategoryId) => selectNode({ type: 'subcategory', id: subcategoryId })}
                onDragStartCategory={() => { drag.current = { kind: 'category', id: category.id }; }}
                onDragStartSubcategory={(subcategoryId) => { drag.current = { kind: 'subcategory', id: subcategoryId }; }}
                onDropCategory={() => dropOnCategory(category)}
                onDropSubcategory={dropOnSubcategory}
                onAddSubcategory={() => addSubcategory(category.id)}
                onDeleteSubcategory={requestDeleteSubcategory}
                addSubcategoryLabel={t('addSubcategory')}
                deleteLabel={t('delete')}
              />
            ))}
          </div>
          <RecycleBinPanel
            label={t('recycleBin')}
            hint={t('recycleDockHint')}
            count={recycleBinCount}
            selected={showRecycle}
            onSelect={() => { setShowRecycle(true); setSelection(null); setSelectedBlueprintIds([]); }}
            onDrop={dropOnRecycle}
          />
        </aside>

        {/* MIDDLE: blueprint grid */}
        <section
          className="pane grid-pane"
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={(event) => void onDropFiles(event)}
        >
          {showRecycle ? (
            <RecycleBinBrowser
              language={props.language}
              recycleBin={recycleBin}
              blueprints={draft.blueprints}
              onRestoreCategories={restoreCategories}
              onRestoreSubcategories={restoreSubcategories}
              onRestoreBlueprints={restoreBlueprintsFromBin}
            />
          ) : (
          <>
          <div className="pane-head">
            <input className="search" placeholder={t('searchBlueprints')} value={search} onChange={(event) => setSearch(event.target.value)} />
            {hasSelection && <small className="muted">{t('selectedCount').replace('{n}', String(selectedBlueprintIds.length))}</small>}
          </div>
          <div className="grid-scroll">
            {visibleBlueprints.groups.length === 0 && <div className="empty-hint">{search ? t('noBlueprintsHere') : t('selectNodeHint')}</div>}
            {visibleBlueprints.groups.map((group) => (
              <div className="grid-group" key={group.key}>
                {group.title && <h4 className="grid-group-title">{group.title}</h4>}
                {group.blueprints.length === 0 ? (
                  <div className="empty-hint small">{t('noBlueprintsHere')}</div>
                ) : (
                  <div className="card-grid">
                    {group.blueprints.map((blueprint) => {
                      const icon = blueprint.iconId !== null ? getBlueprintIconById(blueprint.iconId) : null;
                      const selected = selectedBlueprintIds.includes(blueprint.id);
                      return (
                        <div
                          key={blueprint.id}
                          role="button"
                          tabIndex={0}
                          className={`bp-card ${selected ? 'selected' : ''} ${conflicts.has(blueprint.id) ? 'conflict' : ''}`}
                          draggable
                          onDragStart={(event) => onDragStartBlueprint(event, blueprint.id)}
                          onClick={(event) => handleBlueprintClick(event, blueprint.id, group.blueprints.map((item) => item.id))}
                        >
                          <input
                            type="checkbox"
                            className="bp-card-check"
                            checked={selected}
                            title={t('selectToggle')}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleBlueprintSelected(blueprint.id)}
                          />
                          <span className="bp-card-thumb">{icon ? <IconImage icon={icon} size={64} /> : <Layers size={34} className="bp-card-icon" />}</span>
                          <span className="bp-card-name">{blueprint.stem}</span>
                          {!blueprint.hasSbp && <span className="bp-card-tag">{t('originSave')}</span>}
                          {conflicts.has(blueprint.id) && <AlertTriangle size={14} className="bp-card-conflict" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid-foot muted">{t('moveHint')}</div>
          </>
          )}
        </section>

        {/* RIGHT: inspector */}
        <aside className="pane inspector-pane">
          <div className="pane-head">{t('inspector')}</div>
          <div className="inspector-scroll">
            <Inspector
              language={props.language}
              draft={draft}
              selection={selection}
              selectedBlueprintIds={selectedBlueprintIds}
              conflicts={conflicts}
              deleteError={deleteError}
              onRenameCategory={(id, name) => update(renameCategory(draft, id, name))}
              onRenameSubcategory={(id, name) => update(renameSubcategory(draft, id, name))}
              onRenameBlueprint={(id, stem) => update(renameBlueprint(draft, id, stem))}
              onAddSubcategory={addSubcategory}
              onDeleteCategory={requestDeleteCategory}
              onDeleteSubcategory={requestDeleteSubcategory}
              onOpenIconPicker={setIconPickerCategoryId}
              onClearIcon={(id) => update(setCategoryIcon(draft, id, null))}
              onSetBlueprintIcon={setIconPickerBlueprintId}
            />
          </div>
        </aside>
      </div>

      {iconPickerCategoryId && (
        <IconPicker
          language={props.language}
          currentIconId={draft.categories.find((category) => category.id === iconPickerCategoryId)?.iconId ?? null}
          onPick={(iconId) => {
            update(setCategoryIcon(draft, iconPickerCategoryId, iconId));
            setIconPickerCategoryId(null);
          }}
          onClose={() => setIconPickerCategoryId(null)}
        />
      )}

      {iconPickerBlueprintId && (
        <IconPicker
          language={props.language}
          currentIconId={draft.blueprints[iconPickerBlueprintId]?.iconId ?? null}
          onPick={(iconId) => {
            update(setBlueprintIcon(draft, iconPickerBlueprintId, iconId));
            setIconPickerBlueprintId(null);
          }}
          onClose={() => setIconPickerBlueprintId(null)}
        />
      )}

      {confirmPlan && (
        <ConfirmDialog language={props.language} plan={confirmPlan} busy={confirmBusy || props.busy} onCancel={() => setConfirmPlan(null)} onConfirm={confirmApply} />
      )}

      {showNotices && (
        <div className="modal-backdrop" onClick={() => setShowNotices(false)}>
          <div className="modal notices-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('warningsErrors')}</h2>
            </header>
            <div className="notices-body">
              {allNotices.length === 0 ? (
                <div className="empty-state">{t('allGood')}</div>
              ) : (
                allNotices.map((notice, index) => (
                  <div className={`notice ${notice.severity}`} key={`${notice.code}-${index}`}>
                    <AlertTriangle size={16} />
                    <div>
                      <strong>{notice.code}</strong>
                      <span>{notice.message}</span>
                      {notice.path && <small>{notice.path}</small>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="primary" onClick={() => setShowNotices(false)}>{t('gotIt')}</button>
            </footer>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('unsavedTitle')}</h2>
            </header>
            <div className="confirm-body">
              <p>{t('unsavedMessage')}</p>
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="secondary" onClick={() => setConfirmLeave(false)}>{t('cancel')}</button>
              <button className="danger" onClick={() => { setConfirmLeave(false); props.onBack(); }}>{t('discardLeave')}</button>
            </footer>
          </div>
        </div>
      )}

      {zipWizard && (
        <ZipImportWizard
          key={`${zipWizard.zips[zipWizard.index].zipName}-${zipWizard.index}`}
          language={props.language}
          zipName={zipWizard.zips[zipWizard.index].zipName}
          entries={zipWizard.zips[zipWizard.index].entries}
          position={zipWizard.index + 1}
          total={zipWizard.zips.length}
          onConfirm={resolveZipWizard}
          onCancel={cancelZipWizard}
        />
      )}

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('delete')}</h2>
            </header>
            <div className="confirm-body">
              <p>
                {(pendingDelete.kind === 'category' ? t('deleteCategoryConfirm') : t('deleteSubcategoryChoose'))
                  .replace('{name}', pendingDelete.name)
                  .replace('{n}', String(pendingDelete.count))}
              </p>
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="secondary" onClick={() => setPendingDelete(null)}>
                {t('cancel')}
              </button>
              {pendingDelete.kind === 'category' ? (
                <button className="danger" onClick={confirmDeleteCategory}>
                  {t('deleteToRecycle')}
                </button>
              ) : (
                <>
                  <button className="secondary" onClick={dissolveSubcategoryToUnnamed}>
                    {t('dissolveToUnnamed')}
                  </button>
                  <button className="danger" onClick={recycleSubcategoryToBin}>
                    {t('deleteToRecycle')}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// 子组件 CategoryRow / RecycleBinPanel / Inspector 已拆到 ./manager 下的独立文件；
// 纯派生逻辑见 ./manager/managerSelectors。本文件只保留主视图与事件编排。
