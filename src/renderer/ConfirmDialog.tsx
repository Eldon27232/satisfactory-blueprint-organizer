import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import type { DraftApplyPlan } from '../shared/draftModel';
import type { Notice } from '../shared/types';
import { translate, type Language } from './i18n';

interface ConfirmDialogProps {
  language: Language;
  plan: DraftApplyPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (gameClosedConfirmed: boolean) => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);
  const [gameClosed, setGameClosed] = useState(false);
  const { plan } = props;
  const errors = plan.notices.filter((notice) => notice.severity === 'error');
  const warnings = plan.notices.filter((notice) => notice.severity === 'warning');
  const totalCategoryBlueprints = plan.categoryPlan.reduce(
    (sum, category) => sum + category.subcategories.reduce((subSum, subcategory) => subSum + subcategory.blueprintStems.length, 0),
    0
  );

  return (
    <div className="modal-backdrop" onClick={props.busy ? undefined : props.onCancel}>
      <div className="modal confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>{t('confirmTitle')}</h2>
          <button className="icon-button" onClick={props.onCancel} disabled={props.busy} aria-label="close">
            <X size={18} />
          </button>
        </header>

        <div className="confirm-body">
          <Row label={t('targetSave')} value={plan.savePath ?? '-'} />
          <Row label="SessionName" value={plan.sessionName ?? '-'} />
          <p className="backup-note">{t('backupNote')}</p>

          <div className="confirm-stats">
            <Stat label={t('filesToCopy')} value={plan.copies.length} />
            <Stat label={t('filesToRename')} value={plan.renames.length} />
            <Stat label={t('filesToDelete')} value={plan.deletions.length} />
            <Stat label={t('categoriesToUpdate')} value={plan.categoryPlan.length} />
            <Stat label={t('iconUpdatesLabel')} value={plan.iconUpdates.length} />
            <Stat label={t('blueprintsCount')} value={totalCategoryBlueprints} />
            <Stat label={t('saveOnlyLabel')} value={plan.saveOnly.length} />
          </div>

          {plan.renames.length > 0 && (
            <Section title={t('filesToRename')}>
              {plan.renames.map((rename) => (
                <li key={rename.to}>
                  {baseName(rename.from)} → {baseName(rename.to)}
                </li>
              ))}
            </Section>
          )}
          {plan.deletions.length > 0 && (
            <Section title={t('filesToDelete')}>
              {plan.deletions.map((file) => (
                <li key={file}>{baseName(file)}</li>
              ))}
            </Section>
          )}
          {plan.iconUpdates.length > 0 && (
            <Section title={t('iconUpdatesLabel')}>
              {plan.iconUpdates.map((icon) => (
                <li key={icon.category}>
                  {icon.category}: IconID {icon.iconId}
                </li>
              ))}
            </Section>
          )}

          <NoticeBlock notices={errors} className="error" />
          <NoticeBlock notices={warnings} className="warning" />
        </div>

        <footer className="confirm-foot">
          <label className={`game-closed-check ${plan.canApply ? '' : 'disabled'}`}>
            <input type="checkbox" checked={gameClosed} disabled={!plan.canApply || props.busy} onChange={(event) => setGameClosed(event.target.checked)} />
            <span>{t('gameClosedConfirm')}</span>
          </label>
          <div className="confirm-actions">
            <button className="secondary" onClick={props.onCancel} disabled={props.busy}>
              {t('cancel')}
            </button>
            <button className="danger" disabled={!plan.canApply || !gameClosed || props.busy} onClick={() => props.onConfirm(gameClosed)}>
              {t('confirmApply')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="confirm-row">
      <span>{props.label}</span>
      <strong title={props.value}>{props.value}</strong>
    </div>
  );
}

function Stat(props: { label: string; value: number }): JSX.Element {
  return (
    <div className="stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="confirm-section">
      <h4>{props.title}</h4>
      <ul>{props.children}</ul>
    </div>
  );
}

function NoticeBlock(props: { notices: Notice[]; className: string }): JSX.Element | null {
  if (props.notices.length === 0) return null;
  return (
    <div className={`confirm-notices ${props.className}`}>
      {props.notices.map((notice, index) => (
        <div className="confirm-notice" key={`${notice.code}-${index}`}>
          <AlertTriangle size={14} />
          <span>{notice.message}</span>
        </div>
      ))}
    </div>
  );
}

function baseName(filePath: string): string {
  return filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? filePath;
}
