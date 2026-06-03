import { Trash2 } from 'lucide-react';
import { useState } from 'react';

// 回收站固定停靠面板：渲染在分类树下方（不随树滚动），可把蓝图拖进来删除。
export function RecycleBinPanel(props: {
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
