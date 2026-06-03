import { AlertTriangle, ChevronDown, ChevronRight, FileArchive, FolderTree } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  buildLayoutPreview,
  categoryLevelDiscard,
  defaultCategoryLevel,
  defaultSubLevel,
  folderNamesAtLevel,
  isCleanCategoryLevel,
  levelFolderBreakdown,
  maxDepth
} from '../../shared/zipLayout';
import type { ZipBlueprintEntry } from '../../shared/types';
import { translate, type Language, type TranslationKey } from '../i18n';

// 压缩包分层导入向导：对深层嵌套 zip，让用户高可视化地选「目录层 C / 子目录层 S」。
// 纯展示 + 编排，所有结构分析与映射来自 shared/zipLayout（纯函数、可测）。每个 zip 单独一个
// 向导实例（由父组件按 zipName 重挂载），确认后由父组件并入草稿并推进队列。
interface ZipImportWizardProps {
  language: Language;
  zipName: string;
  entries: ZipBlueprintEntry[];
  /** 队列位置，1-based。 */
  position: number;
  total: number;
  onConfirm: (categoryLevel: number, subLevel: number | null) => void;
  onCancel: () => void;
}

export function ZipImportWizard(props: ZipImportWizardProps): JSX.Element {
  const { zipName, entries } = props;
  const t = (key: TranslationKey): string => translate(props.language, key);

  const items = useMemo(() => entries.map((entry) => ({ dirSegments: entry.dirSegments, stem: entry.stem })), [entries]);
  const maxD = useMemo(() => maxDepth(items), [items]);
  const initialCategory = useMemo(() => defaultCategoryLevel(items), [items]);

  const [categoryLevel, setCategoryLevel] = useState(initialCategory);
  const [subLevel, setSubLevel] = useState<number | null>(() => defaultSubLevel(items, initialCategory));
  const [acknowledged, setAcknowledged] = useState(false);
  const [expandedSubLevel, setExpandedSubLevel] = useState<number | null>(null);

  function selectCategory(level: number): void {
    setCategoryLevel(level);
    setAcknowledged(false);
    setSubLevel(defaultSubLevel(items, level));
    setExpandedSubLevel(null);
  }

  const categoryOptions = useMemo(
    () =>
      Array.from({ length: maxD + 1 }, (_unused, level) => ({
        level,
        folderCount: level === 0 ? 1 : folderNamesAtLevel(items, level).length,
        clean: isCleanCategoryLevel(items, level)
      })),
    [items, maxD]
  );
  const subLevelOptions = useMemo(() => {
    const levels: number[] = [];
    for (let level = categoryLevel + 1; level <= maxD; level += 1) levels.push(level);
    return levels;
  }, [categoryLevel, maxD]);

  const clean = isCleanCategoryLevel(items, categoryLevel);
  const discard = categoryLevelDiscard(items, categoryLevel);
  const preview = useMemo(() => buildLayoutPreview(items, zipName, categoryLevel, subLevel), [items, zipName, categoryLevel, subLevel]);
  const subTotal = preview.categories.reduce((sum, category) => sum + category.subcategories.length, 0);
  const confirmDisabled = !clean && !acknowledged;

  function categoryLabel(level: number): string {
    return level === 0 ? t('zipWizardWholeZip') : t('zipWizardLevelN').replace('{n}', String(level));
  }

  const warnParts: string[] = [];
  if (discard.discardedBlueprints > 0) warnParts.push(t('zipWizardDiscardBlueprints').replace('{n}', String(discard.discardedBlueprints)));
  if (discard.mergesUpperGrouping) warnParts.push(t('zipWizardDiscardMerge'));

  return (
    <div className="modal-backdrop">
      <div className="modal zip-wizard" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <FileArchive size={18} /> {t('zipWizardTitle')}
          </h2>
          <div className="zip-wizard-meta">
            <strong title={zipName}>{zipName}</strong>
            <span className="muted">
              {props.position}/{props.total} · {t('zipWizardBlueprints').replace('{n}', String(entries.length))}
            </span>
          </div>
        </header>

        <div className="zip-wizard-body">
          {/* 目录层：整层 radio 选择 */}
          <section className="zip-wizard-section">
            <h4>{t('zipWizardCategoryLevel')}</h4>
            <div className="level-chips">
              {categoryOptions.map((option) => (
                <button
                  key={option.level}
                  className={`level-chip ${option.level === categoryLevel ? 'selected' : ''} ${option.clean ? '' : 'dirty'}`}
                  onClick={() => selectCategory(option.level)}
                >
                  <span className="level-chip-name">{categoryLabel(option.level)}</span>
                  <span className="level-chip-count">{t('zipWizardFolders').replace('{n}', String(option.folderCount))}</span>
                  {!option.clean && <AlertTriangle size={13} className="level-chip-warn" />}
                </button>
              ))}
            </div>
            {!clean && (
              <label className="zip-wizard-ack">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>
                  <AlertTriangle size={14} /> {warnParts.join('; ')}
                  <em>{t('zipWizardAck')}</em>
                </span>
              </label>
            )}
          </section>

          {/* 子目录层：整层 radio 选择，可展开预览该层文件夹 */}
          <section className="zip-wizard-section">
            <h4>{t('zipWizardSubLevel')}</h4>
            <div className="sub-level-list">
              <button className={`level-chip ${subLevel === null ? 'selected' : ''}`} onClick={() => setSubLevel(null)}>
                <span className="level-chip-name">{t('zipWizardNoSub')}</span>
              </button>
              {subLevelOptions.map((level) => {
                const breakdown = levelFolderBreakdown(items, level);
                const isExpanded = expandedSubLevel === level;
                return (
                  <div key={level} className="sub-level-option">
                    <button className={`level-chip ${subLevel === level ? 'selected' : ''}`} onClick={() => setSubLevel(level)}>
                      <span className="level-chip-name">{t('zipWizardLevelN').replace('{n}', String(level))}</span>
                      <span className="level-chip-count">{t('zipWizardFolders').replace('{n}', String(breakdown.length))}</span>
                    </button>
                    <button
                      className="sub-level-expand"
                      onClick={() => setExpandedSubLevel(isExpanded ? null : level)}
                      title={isExpanded ? t('zipWizardCollapse') : t('zipWizardExpand')}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    {isExpanded && (
                      <ul className="sub-level-breakdown">
                        {breakdown.map((folder) => (
                          <li key={folder.name}>
                            <span>{folder.name}</span>
                            <span className="muted">{folder.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 实时预览树 */}
          <section className="zip-wizard-section">
            <h4>
              <FolderTree size={15} /> {t('zipWizardPreview')}
            </h4>
            <div className="zip-wizard-summary">
              {t('zipWizardPreviewSummary')
                .replace('{cats}', String(preview.categories.length))
                .replace('{subs}', String(subTotal))
                .replace('{imported}', String(preview.imported))
                .replace('{discarded}', String(preview.discarded))}
            </div>
            <div className="zip-wizard-tree">
              {preview.categories.map((category) => (
                <div className="zip-wizard-cat" key={category.name}>
                  <div className="zip-wizard-cat-head">
                    <span className="tree-name">{category.name}</span>
                    <span className="tree-count">{category.subcategories.reduce((sum, sub) => sum + sub.count, 0)}</span>
                  </div>
                  <ul>
                    {category.subcategories.map((sub) => (
                      <li key={sub.name}>
                        <span>{sub.name}</span>
                        <span className="muted">{sub.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
          <button className="secondary" onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button className="primary" disabled={confirmDisabled} onClick={() => props.onConfirm(categoryLevel, subLevel)}>
            {props.position < props.total ? t('zipWizardConfirmNext') : t('zipWizardConfirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
