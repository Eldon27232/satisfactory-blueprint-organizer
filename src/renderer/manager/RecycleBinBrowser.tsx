import { ChevronLeft, Folder, FolderOpen, Layers, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { getBlueprintIconById } from '../../shared/blueprintIcons';
import { countBlueprintsInCategory, type DraftBlueprint, type DraftCategory } from '../../shared/draftModel';
import { IconImage } from '../IconPicker';
import { translate, type Language, type TranslationKey } from '../i18n';

// 回收站浏览器：Windows 文件夹式分层导航（根=影子目录 → 子目录 → 蓝图），可逐项/多选恢复。
// 数据来自 draft.recycleBin（影子森林）；恢复逻辑（归位/级联/改名）在 shared/draftModel 的纯函数里，
// 本组件只负责导航、选择与触发回调。
interface RecycleBinBrowserProps {
  language: Language;
  recycleBin: DraftCategory[];
  blueprints: Record<string, DraftBlueprint>;
  onRestoreCategories: (shadowCategoryIds: string[]) => void;
  onRestoreSubcategories: (items: Array<{ categoryId: string; subId: string }>) => void;
  onRestoreBlueprints: (blueprintIds: string[]) => void;
}

export function RecycleBinBrowser(props: RecycleBinBrowserProps): JSX.Element {
  const { recycleBin } = props;
  const t = (key: TranslationKey): string => translate(props.language, key);
  const [path, setPath] = useState<{ categoryId?: string; subId?: string }>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 渲染防御：路径节点可能因恢复而消失 → 自动回退到上层渲染。
  const categoryNode = recycleBin.find((category) => category.id === path.categoryId);
  const subNode = categoryNode?.subcategories.find((sub) => sub.id === path.subId);
  const level: 'root' | 'sub' | 'bp' = subNode ? 'bp' : categoryNode ? 'sub' : 'root';

  function navigate(next: { categoryId?: string; subId?: string }): void {
    setPath(next);
    setSelected(new Set());
  }

  function toggle(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function restore(ids: string[]): void {
    if (ids.length === 0) return;
    if (level === 'root') props.onRestoreCategories(ids);
    else if (level === 'sub') props.onRestoreSubcategories(ids.map((subId) => ({ categoryId: categoryNode!.id, subId })));
    else props.onRestoreBlueprints(ids);
    setSelected(new Set());
  }

  // 当前层条目（统一结构：id / 名字 / 计数 / 是否可进入 / 图标）。
  const rows = (() => {
    if (level === 'root') {
      return recycleBin.map((category) => ({
        id: category.id,
        name: category.name,
        count: countBlueprintsInCategory(category),
        enter: () => navigate({ categoryId: category.id }),
        icon: <Folder size={20} className="recycle-row-folder" />
      }));
    }
    if (level === 'sub') {
      return categoryNode!.subcategories.map((sub) => ({
        id: sub.id,
        name: sub.name,
        count: sub.blueprintIds.length,
        enter: () => navigate({ categoryId: categoryNode!.id, subId: sub.id }),
        icon: <Folder size={20} className="recycle-row-folder" />
      }));
    }
    return subNode!.blueprintIds.map((id) => {
      const blueprint = props.blueprints[id];
      const icon = blueprint?.iconId != null ? getBlueprintIconById(blueprint.iconId) : null;
      return {
        id,
        name: blueprint?.stem ?? id,
        count: null as number | null,
        enter: null as (() => void) | null,
        icon: icon ? <IconImage icon={icon} size={20} /> : <Layers size={18} className="bp-card-icon" />
      };
    });
  })();

  function goUp(): void {
    if (level === 'bp') navigate({ categoryId: categoryNode!.id });
    else if (level === 'sub') navigate({});
  }

  return (
    <div className="recycle-browser">
      <div className="recycle-browser-bar">
        <button className="secondary" disabled={level === 'root'} onClick={goUp}>
          <ChevronLeft size={16} /> {t('recycleBack')}
        </button>
        <div className="recycle-crumbs">
          <FolderOpen size={15} />
          <span>{t('recycleBin')}</span>
          {categoryNode && <span className="recycle-crumb-sep">/ {categoryNode.name}</span>}
          {subNode && <span className="recycle-crumb-sep">/ {subNode.name}</span>}
        </div>
        <button className="primary" disabled={selected.size === 0} onClick={() => restore([...selected])}>
          <RotateCcw size={15} /> {t('recycleRestoreSelected').replace('{n}', String(selected.size))}
        </button>
      </div>

      <div className="recycle-browser-list">
        {rows.length === 0 ? (
          <div className="empty-hint">{t('recycleEmpty')}</div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className={`recycle-row ${selected.has(row.id) ? 'selected' : ''} ${row.enter ? 'enterable' : ''}`}
              onDoubleClick={row.enter ?? undefined}
            >
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggle(row.id)}
              />
              <span className="recycle-row-icon">{row.icon}</span>
              <span className="recycle-row-name" onClick={row.enter ?? undefined}>
                {row.name}
              </span>
              {row.count != null && <span className="tree-count">{row.count}</span>}
              <button className="icon-button" title={t('recycleRestore')} onClick={() => restore([row.id])}>
                <RotateCcw size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
