import { AlertTriangle, CheckSquare, ChevronDown, ChevronRight, ClipboardPaste, Copy, FolderInput, FolderPlus, ImageIcon, Layers, Minus, Plus, Scissors, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { getBlueprintIconById, getBlueprintIconDisplayName } from '../shared/blueprintIcons';
import {
  addBlueprints,
  allStemsLower,
  countBlueprintsInCategory,
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  deleteSubcategoryWithContents,
  getRecycledBlueprintIdSet,
  isRecycleCategory,
  locateBlueprint,
  makeId,
  moveBlueprints,
  nextAvailableStem,
  recycleBlueprints,
  RECYCLE_BIN_ID,
  renameBlueprint,
  renameCategory,
  renameSubcategory,
  reorderCategory,
  reorderSubcategory,
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

type Selection = { type: 'category'; id: string } | { type: 'subcategory'; id: string } | null;
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(draft.categories.map((category) => category.id)));
  const [iconPickerCategoryId, setIconPickerCategoryId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; count: number } | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<DraftApplyPlan | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [importNotices, setImportNotices] = useState<Notice[]>([]);
  const [showNotices, setShowNotices] = useState(false);
  const drag = useRef<DragState>(null);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const conflicts = validation.conflictBlueprintIds;
  const recycledIds = useMemo(() => getRecycledBlueprintIdSet(draft), [draft]);
  const allNotices = useMemo(() => [...draft.buildNotices, ...validation.notices, ...importNotices], [draft.buildNotices, validation.notices, importNotices]);
  const errorCount = allNotices.filter((notice) => notice.severity === 'error').length;
  const warningCount = allNotices.filter((notice) => notice.severity === 'warning').length;

  const visibleBlueprints = useMemo(() => computeVisibleBlueprints(draft, selection, search, recycledIds), [draft, selection, search, recycledIds]);

  // Recycle bin is a draft-only category; render it as a fixed dock, not in the scrolling tree.
  const treeCategories = useMemo(() => draft.categories.filter((category) => !isRecycleCategory(category)), [draft]);
  const recycleBin = useMemo(() => draft.categories.find(isRecycleCategory), [draft]);
  const recycleBinSelected = selection?.type === 'category' && selection.id === RECYCLE_BIN_ID;

  const pasteTargetSubId = resolvePasteTargetSubId(draft, selection);
  const canPaste = Boolean(clipboard && clipboard.ids.length > 0 && pasteTargetSubId);

  function update(next: DraftTree): void {
    setDeleteError('');
    setDraft(next);
  }

  function selectNode(node: Selection): void {
    setSelection(node);
    setSelectedBlueprintIds([]);
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

  // 从系统拖入 .sbp/.sbpcfg 文件到当前选中的子分类；成对校验，缺一不导入并计入 error。
  async function onDropFiles(event: React.DragEvent<HTMLElement>): Promise<void> {
    if (event.dataTransfer.files.length === 0) return; // 内部拖拽（移动蓝图）不在此处理
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((value): value is string => Boolean(value));
    if (paths.length === 0) return;
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
          warnings: []
        };
      });
      setDraft(addBlueprints(draft, additions, targetSubId));
    }
    setImportNotices(result.errors);
    if (result.errors.length > 0) setShowNotices(true);
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
    } else if (state.kind === 'category' && !isRecycleCategory(category)) {
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

  function removeSubcategory(subcategoryId: string): void {
    const result = deleteSubcategory(draft, subcategoryId);
    if (!result.ok) {
      setDeleteError(t('deleteBlocked'));
      return;
    }
    update(result.tree);
    selectNode(null);
  }

  function requestDeleteSubcategory(subcategory: DraftSubcategory): void {
    if (subcategory.blueprintIds.length > 0) {
      setPendingDelete({ id: subcategory.id, name: subcategory.name, count: subcategory.blueprintIds.length });
    } else {
      removeSubcategory(subcategory.id);
    }
  }

  function confirmDeleteSubcategory(): void {
    if (!pendingDelete) return;
    update(deleteSubcategoryWithContents(draft, pendingDelete.id));
    setPendingDelete(null);
    selectNode(null);
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
          <button className="secondary" onClick={props.onBack} disabled={props.busy}>
            {t('back')}
          </button>
          <button className="secondary" onClick={props.onImportExternal} disabled={props.busy}>
            <FolderInput size={16} /> {t('importExternal')}
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
            count={recycleBin ? countBlueprintsInCategory(recycleBin) : 0}
            selected={recycleBinSelected}
            onSelect={() => selectNode({ type: 'category', id: RECYCLE_BIN_ID })}
            onDrop={dropOnRecycle}
          />
        </aside>

        {/* MIDDLE: blueprint grid */}
        <section
          className="pane grid-pane"
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={(event) => void onDropFiles(event)}
        >
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
              onDeleteCategory={removeCategory}
              onDeleteSubcategory={requestDeleteSubcategory}
              onOpenIconPicker={setIconPickerCategoryId}
              onClearIcon={(id) => update(setCategoryIcon(draft, id, null))}
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

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('delete')}</h2>
            </header>
            <div className="confirm-body">
              <p>{t('deleteSubcategoryConfirm').replace('{name}', pendingDelete.name).replace('{n}', String(pendingDelete.count))}</p>
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="secondary" onClick={() => setPendingDelete(null)}>
                {t('cancel')}
              </button>
              <button className="danger" onClick={confirmDeleteSubcategory}>
                {t('delete')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategoryRow(props: {
  category: DraftCategory;
  expanded: boolean;
  selection: Selection;
  onToggle: () => void;
  onSelectCategory: () => void;
  onSelectSubcategory: (subcategoryId: string) => void;
  onDragStartCategory: () => void;
  onDragStartSubcategory: (subcategoryId: string) => void;
  onDropCategory: () => void;
  onDropSubcategory: (subcategoryId: string) => void;
  onAddSubcategory: () => void;
  onDeleteSubcategory: (subcategory: DraftSubcategory) => void;
  addSubcategoryLabel: string;
  deleteLabel: string;
}): JSX.Element {
  const [over, setOver] = useState<string | null>(null);
  const recycle = isRecycleCategory(props.category);
  const icon = props.category.iconId !== null ? getBlueprintIconById(props.category.iconId) : null;
  const count = countBlueprintsInCategory(props.category);
  const isSelected = props.selection?.type === 'category' && props.selection.id === props.category.id;

  return (
    <div className="tree-category">
      <div
        className={`tree-row category ${recycle ? 'recycle' : ''} ${isSelected ? 'selected' : ''} ${over === 'cat' ? 'drop-target' : ''}`}
        draggable={!recycle}
        onClick={props.onSelectCategory}
        onDragStart={recycle ? undefined : props.onDragStartCategory}
        onDragOver={(event) => {
          event.preventDefault();
          setOver('cat');
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(null);
          props.onDropCategory();
        }}
      >
        <button
          className="tree-chevron"
          onClick={(event) => {
            event.stopPropagation();
            props.onToggle();
          }}
        >
          {props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {recycle ? <Trash2 size={18} className="recycle-icon" /> : <IconImage icon={icon} size={22} />}
        <span className="tree-name">{props.category.name}</span>
        <span className="tree-count">{count}</span>
        {!recycle && (
          <button
            className="tree-action"
            title={props.addSubcategoryLabel}
            onClick={(event) => {
              event.stopPropagation();
              props.onAddSubcategory();
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {props.expanded &&
        props.category.subcategories.map((subcategory, index) => {
          const subSelected = props.selection?.type === 'subcategory' && props.selection.id === subcategory.id;
          return (
            <div
              key={subcategory.id}
              className={`tree-row subcategory ${subSelected ? 'selected' : ''} ${over === subcategory.id ? 'drop-target' : ''}`}
              draggable={!recycle}
              onClick={() => props.onSelectSubcategory(subcategory.id)}
              onDragStart={recycle ? undefined : (event) => { event.stopPropagation(); props.onDragStartSubcategory(subcategory.id); }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(subcategory.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                props.onDropSubcategory(subcategory.id);
              }}
            >
              <span className="sub-index">{index + 1}.</span>
              <span className="tree-name">{subcategory.name}</span>
              <span className="tree-count">{subcategory.blueprintIds.length}</span>
              {!recycle && (
                <button
                  className="tree-action danger"
                  title={props.deleteLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDeleteSubcategory(subcategory);
                  }}
                >
                  <Minus size={14} />
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecycleBinPanel(props: {
  label: string;
  hint: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onDrop: () => void;
}): JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`recycle-dock ${props.selected ? 'selected' : ''} ${over ? 'drop-target' : ''}`}
      title={props.hint}
      onClick={props.onSelect}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        props.onDrop();
      }}
    >
      <Trash2 size={18} className="recycle-icon" />
      <span className="tree-name">{props.label}</span>
      <span className="tree-count">{props.count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface InspectorProps {
  language: Language;
  draft: DraftTree;
  selection: Selection;
  selectedBlueprintIds: string[];
  conflicts: Set<string>;
  deleteError: string;
  onRenameCategory: (id: string, name: string) => void;
  onRenameSubcategory: (id: string, name: string) => void;
  onRenameBlueprint: (id: string, stem: string) => void;
  onAddSubcategory: (categoryId: string) => void;
  onDeleteCategory: (id: string) => void;
  onDeleteSubcategory: (subcategory: DraftSubcategory) => void;
  onOpenIconPicker: (categoryId: string) => void;
  onClearIcon: (categoryId: string) => void;
}

function Inspector(props: InspectorProps): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);

  if (props.selectedBlueprintIds.length === 1) {
    const blueprint = props.draft.blueprints[props.selectedBlueprintIds[0]];
    if (blueprint) return <BlueprintInspector language={props.language} draft={props.draft} blueprint={blueprint} conflict={props.conflicts.has(blueprint.id)} onRename={props.onRenameBlueprint} />;
  }
  if (props.selectedBlueprintIds.length > 1) {
    return <div className="inspector-block">{t('selectedCount').replace('{n}', String(props.selectedBlueprintIds.length))}</div>;
  }

  if (props.selection?.type === 'category') {
    const category = props.draft.categories.find((item) => item.id === props.selection?.id);
    if (category && isRecycleCategory(category)) {
      return <div className="inspector-block muted">{t('recycleHint')}</div>;
    }
    if (category) {
      const icon = category.iconId !== null ? getBlueprintIconById(category.iconId) : null;
      const empty = countBlueprintsInCategory(category) === 0;
      return (
        <div className="inspector-block">
          <label className="field">
            <span>{t('categoryName')}</span>
            <input value={category.name} onChange={(event) => props.onRenameCategory(category.id, event.target.value)} />
          </label>
          <div className="field">
            <span>{t('icon')}</span>
            <div className="icon-field">
              <IconImage icon={icon} size={48} />
              <div className="icon-field-actions">
                <button className="secondary" onClick={() => props.onOpenIconPicker(category.id)}>
                  <ImageIcon size={14} /> {t('setIcon')}
                </button>
                <button className="link" disabled={category.iconId === null} onClick={() => props.onClearIcon(category.id)}>
                  {t('clearIcon')}
                </button>
              </div>
              <small className="muted">{category.iconId === null ? t('noIcon') : `#${category.iconId}`}</small>
            </div>
          </div>
          <div className="inspector-actions">
            <button className="secondary" onClick={() => props.onAddSubcategory(category.id)}>
              <FolderPlus size={14} /> {t('addSubcategory')}
            </button>
            <button className="danger ghost" disabled={!empty} onClick={() => props.onDeleteCategory(category.id)}>
              <Trash2 size={14} /> {t('delete')}
            </button>
          </div>
          {props.deleteError && <div className="inspector-error">{props.deleteError}</div>}
        </div>
      );
    }
  }

  if (props.selection?.type === 'subcategory') {
    const found = findSub(props.draft, props.selection.id);
    if (found) {
      const empty = found.subcategory.blueprintIds.length === 0;
      const recycle = isRecycleCategory(found.category);
      return (
        <div className="inspector-block">
          <div className="field">
            <span>{t('categoriesPane')}</span>
            <strong>{found.category.name}</strong>
          </div>
          {!recycle && (
            <label className="field">
              <span>{t('subcategoryName')}</span>
              <input value={found.subcategory.name} onChange={(event) => props.onRenameSubcategory(found.subcategory.id, event.target.value)} />
            </label>
          )}
          {!recycle && (
            <div className="inspector-actions">
              <button className="danger ghost" disabled={!empty} onClick={() => props.onDeleteSubcategory(found.subcategory)}>
                <Trash2 size={14} /> {t('delete')}
              </button>
            </div>
          )}
          {props.deleteError && <div className="inspector-error">{props.deleteError}</div>}
        </div>
      );
    }
  }

  return <div className="inspector-block muted">{t('selectNodeHint')}</div>;
}

function BlueprintInspector(props: { language: Language; draft: DraftTree; blueprint: DraftBlueprint; conflict: boolean; onRename: (id: string, stem: string) => void }): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);
  const location = locateBlueprint(props.draft, props.blueprint.id);
  const originLabel = props.blueprint.origin === 'external' ? t('originExternal') : props.blueprint.origin === 'gameDir' ? t('originGameDir') : t('originSave');
  const icon = props.blueprint.iconId !== null ? getBlueprintIconById(props.blueprint.iconId) : null;
  return (
    <div className="inspector-block">
      <div className="field">
        <span>{t('icon')}</span>
        <div className="icon-field">
          {icon ? <IconImage icon={icon} size={48} /> : <Layers size={32} className="bp-card-icon" />}
          <small className="muted">
            {props.blueprint.iconId === null ? t('noIcon') : `#${props.blueprint.iconId} ${icon ? getBlueprintIconDisplayName(icon, props.language) : ''}`}
          </small>
        </div>
      </div>
      <label className="field">
        <span>{t('blueprintName')}</span>
        <input className={props.conflict ? 'conflict' : ''} value={props.blueprint.stem} onChange={(event) => props.onRename(props.blueprint.id, event.target.value)} disabled={!props.blueprint.hasSbp && props.blueprint.origin === 'save'} />
      </label>
      {props.conflict && <div className="inspector-error">{t('nameConflict')}</div>}
      <div className="field">
        <span>{t('origin')}</span>
        <strong>{originLabel}</strong>
      </div>
      {location && (
        <div className="field">
          <span>{t('categoriesPane')}</span>
          <strong>
            {location.category.name} / {location.subcategory.name}
          </strong>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface VisibleGroup {
  key: string;
  title: string | null;
  blueprints: DraftBlueprint[];
}

function computeVisibleBlueprints(draft: DraftTree, selection: Selection, search: string, recycledIds: Set<string>): { groups: VisibleGroup[] } {
  const needle = search.trim().toLowerCase();
  if (needle) {
    const matches = Object.values(draft.blueprints).filter((blueprint) => !recycledIds.has(blueprint.id) && blueprint.stem.toLowerCase().includes(needle));
    return { groups: [{ key: 'search', title: null, blueprints: matches }] };
  }
  if (selection?.type === 'subcategory') {
    const found = findSub(draft, selection.id);
    if (!found) return { groups: [] };
    return { groups: [{ key: found.subcategory.id, title: null, blueprints: resolveBlueprints(draft, found.subcategory) }] };
  }
  if (selection?.type === 'category') {
    const category = draft.categories.find((item) => item.id === selection.id);
    if (!category) return { groups: [] };
    return {
      groups: category.subcategories.map((subcategory) => ({
        key: subcategory.id,
        title: subcategory.name,
        blueprints: resolveBlueprints(draft, subcategory)
      }))
    };
  }
  return { groups: [] };
}

function resolveBlueprints(draft: DraftTree, subcategory: DraftSubcategory): DraftBlueprint[] {
  return subcategory.blueprintIds.map((id) => draft.blueprints[id]).filter((blueprint): blueprint is DraftBlueprint => Boolean(blueprint));
}

function findSub(draft: DraftTree, subcategoryId: string): { category: DraftCategory; subcategory: DraftSubcategory } | undefined {
  for (const category of draft.categories) {
    const subcategory = category.subcategories.find((item) => item.id === subcategoryId);
    if (subcategory) return { category, subcategory };
  }
  return undefined;
}

function resolvePasteTargetSubId(draft: DraftTree, selection: Selection): string | null {
  if (selection?.type === 'subcategory') {
    const found = findSub(draft, selection.id);
    if (found && !isRecycleCategory(found.category)) return found.subcategory.id;
    return null;
  }
  if (selection?.type === 'category') {
    const category = draft.categories.find((item) => item.id === selection.id);
    if (category && !isRecycleCategory(category)) return category.subcategories[0]?.id ?? null;
  }
  return null;
}

function makeCopyBlueprint(draft: DraftTree, source: DraftBlueprint, newStem: string): DraftBlueprint {
  const sep = draft.gameBlueprintDir.includes('\\') ? '\\' : '/';
  const sourceSbpPath = source.origin === 'external' ? source.sourceSbpPath : `${draft.gameBlueprintDir}${sep}${source.originalStem}.sbp`;
  const sourceCfgPath = source.origin === 'external' ? source.sourceCfgPath : source.hasCfg ? `${draft.gameBlueprintDir}${sep}${source.originalStem}.sbpcfg` : null;
  return {
    id: makeId('bp'),
    stem: newStem,
    originalStem: newStem,
    origin: 'external',
    sourceSbpPath,
    sourceCfgPath,
    hasSbp: true,
    hasCfg: source.hasCfg,
    iconId: source.iconId,
    warnings: []
  };
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
