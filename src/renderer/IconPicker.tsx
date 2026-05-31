import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { listVisibleBlueprintIcons, type BlueprintIconRecord, type BlueprintIconType } from '../shared/blueprintIcons';
import { translate, type Language } from './i18n';

const ICON_TYPES: BlueprintIconType[] = ['ESIT_Building', 'ESIT_Equipment', 'ESIT_Part', 'ESIT_Material', 'ESIT_Monochrome', 'ESIT_Custom', 'ESIT_MapStamp'];

interface IconPickerProps {
  language: Language;
  currentIconId: number | null;
  onPick: (iconId: number | null) => void;
  onClose: () => void;
}

export function IconPicker(props: IconPickerProps): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<BlueprintIconType | 'all'>('all');

  const allIcons = useMemo(() => listVisibleBlueprintIcons(), []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allIcons.filter((icon) => {
      if (type !== 'all' && icon.iconType !== type) return false;
      if (!needle) return true;
      return icon.name.toLowerCase().includes(needle) || String(icon.id).includes(needle);
    });
  }, [allIcons, query, type]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal icon-picker" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>{t('iconPickerTitle')}</h2>
          <button className="icon-button" onClick={props.onClose} aria-label="close">
            <X size={18} />
          </button>
        </header>
        <div className="icon-picker-controls">
          <input autoFocus placeholder={t('iconSearch')} value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={type} onChange={(event) => setType(event.target.value as BlueprintIconType | 'all')}>
            <option value="all">{t('allTypes')}</option>
            {ICON_TYPES.map((iconType) => (
              <option key={iconType} value={iconType}>
                {iconType.replace('ESIT_', '')}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => props.onPick(null)}>
            {t('iconNone')}
          </button>
        </div>
        <div className="icon-grid">
          {filtered.slice(0, 600).map((icon) => (
            <button
              key={icon.id}
              className={`icon-cell ${props.currentIconId === icon.id ? 'selected' : ''}`}
              title={`${icon.name} (#${icon.id})`}
              onClick={() => props.onPick(icon.id)}
            >
              <IconImage icon={icon} />
              <span>{icon.name}</span>
            </button>
          ))}
        </div>
        <footer className="icon-picker-foot">
          <small>{filtered.length}</small>
        </footer>
      </div>
    </div>
  );
}

export function IconImage(props: { icon: BlueprintIconRecord | null; size?: number }): JSX.Element {
  const size = props.size ?? 40;
  if (!props.icon) return <span className="icon-image placeholder" style={{ width: size, height: size }} />;
  return <img className="icon-image" src={iconSrc(props.icon.imagePath)} width={size} height={size} alt={props.icon.name} loading="lazy" />;
}

// The library stores absolute paths ("/blueprint-icons/0001.png"). The renderer is
// built with a relative base and loaded via file:// when packaged, where a leading
// slash resolves to the filesystem root. Strip it so it resolves next to index.html.
function iconSrc(imagePath: string): string {
  return imagePath.replace(/^\/+/, '');
}
