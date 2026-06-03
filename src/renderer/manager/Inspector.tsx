import { FolderPlus, ImageIcon, Layers, Trash2 } from 'lucide-react';
import { getBlueprintIconById, getBlueprintIconDisplayName } from '../../shared/blueprintIcons';
import { findSubcategory, isRecycleCategory, locateBlueprint, type DraftBlueprint, type DraftSubcategory, type DraftTree } from '../../shared/draftModel';
import { IconImage } from '../IconPicker';
import { translate, type Language } from '../i18n';
import type { Selection } from './managerSelectors';

export interface InspectorProps {
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
  onSetBlueprintIcon: (blueprintId: string) => void;
}

// 右侧检查器：根据当前选择（单个蓝图 / 多个蓝图 / 分类 / 子分类）渲染对应的编辑面板。
export function Inspector(props: InspectorProps): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);

  if (props.selectedBlueprintIds.length === 1) {
    const blueprint = props.draft.blueprints[props.selectedBlueprintIds[0]];
    if (blueprint) return <BlueprintInspector language={props.language} draft={props.draft} blueprint={blueprint} conflict={props.conflicts.has(blueprint.id)} onRename={props.onRenameBlueprint} onSetIcon={props.onSetBlueprintIcon} />;
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
            <button className="danger ghost" onClick={() => props.onDeleteCategory(category.id)}>
              <Trash2 size={14} /> {t('delete')}
            </button>
          </div>
          {props.deleteError && <div className="inspector-error">{props.deleteError}</div>}
        </div>
      );
    }
  }

  if (props.selection?.type === 'subcategory') {
    const found = findSubcategory(props.draft, props.selection.id);
    if (found) {
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
              <button className="danger ghost" onClick={() => props.onDeleteSubcategory(found.subcategory)}>
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

function BlueprintInspector(props: { language: Language; draft: DraftTree; blueprint: DraftBlueprint; conflict: boolean; onRename: (id: string, stem: string) => void; onSetIcon: (blueprintId: string) => void }): JSX.Element {
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
          <div className="icon-field-actions">
            {props.blueprint.hasCfg && (
              <button className="secondary" onClick={() => props.onSetIcon(props.blueprint.id)}>
                <ImageIcon size={14} /> {t('setIcon')}
              </button>
            )}
            <small className="muted">
              {props.blueprint.iconId === null ? t('noIcon') : `#${props.blueprint.iconId} ${icon ? getBlueprintIconDisplayName(icon, props.language) : ''}`}
            </small>
          </div>
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
