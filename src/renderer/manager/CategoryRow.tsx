import { ChevronDown, ChevronRight, Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { getBlueprintIconById } from '../../shared/blueprintIcons';
import { countBlueprintsInCategory, isRecycleCategory, type DraftCategory, type DraftSubcategory } from '../../shared/draftModel';
import { IconImage } from '../IconPicker';
import type { Selection } from './managerSelectors';

// 左侧分类树的一行：分类标题 + 可展开的子分类列表，支持拖拽排序与拖入蓝图。
export function CategoryRow(props: {
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
