import { useState } from 'react';
import type { MappingDiff } from '../shared/mappingDiff';
import { translate, type Language } from './i18n';

type Decision = 'keep' | 'delete';

interface MappingDiffDialogProps {
  language: Language;
  mappingDir: string;
  diff: MappingDiff;
  onCancel: () => void;
  onConfirm: (keepIds: string[], deleteIds: string[]) => void;
}

export function MappingDiffDialog(props: MappingDiffDialogProps): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(props.diff.managerOnly.map((blueprint) => [blueprint.id, 'keep' as Decision]))
  );

  const setAll = (decision: Decision): void => {
    setDecisions(Object.fromEntries(props.diff.managerOnly.map((blueprint) => [blueprint.id, decision])));
  };

  const confirm = (): void => {
    const keepIds = props.diff.managerOnly.filter((b) => decisions[b.id] !== 'delete').map((b) => b.id);
    const deleteIds = props.diff.managerOnly.filter((b) => decisions[b.id] === 'delete').map((b) => b.id);
    props.onConfirm(keepIds, deleteIds);
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal diff-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>{t('mappingDiffTitle')}</h2>
        </header>
        <div className="diff-body">
          <small className="muted">{props.mappingDir}</small>

          <section className="diff-section">
            <h4>{t('diffExternalOnly')} ({props.diff.externalOnly.length})</h4>
            <p className="muted diff-hint">{t('diffExternalHint')}</p>
            {props.diff.externalOnly.length === 0 ? (
              <div className="muted diff-empty">—</div>
            ) : (
              <div className="diff-list">
                {props.diff.externalOnly.map((entry) => (
                  <div className="diff-row" key={entry.sourceSbpPath}>
                    <span className="diff-name">{entry.blueprintStem}</span>
                    <span className="muted diff-path">{entry.category} / {entry.subcategory}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="diff-section">
            <div className="diff-section-head">
              <h4>{t('diffManagerOnly')} ({props.diff.managerOnly.length})</h4>
              {props.diff.managerOnly.length > 0 && (
                <div className="diff-bulk">
                  <button className="link" onClick={() => setAll('keep')}>{t('diffKeepAll')}</button>
                  <button className="link" onClick={() => setAll('delete')}>{t('diffDeleteAll')}</button>
                </div>
              )}
            </div>
            <p className="muted diff-hint">{t('diffKeepHint')}</p>
            {props.diff.managerOnly.length === 0 ? (
              <div className="muted diff-empty">—</div>
            ) : (
              <div className="diff-list">
                {props.diff.managerOnly.map((blueprint) => (
                  <div className="diff-row" key={blueprint.id}>
                    <span className="diff-name">{blueprint.stem}</span>
                    <div className="diff-choice">
                      <label>
                        <input type="radio" checked={decisions[blueprint.id] !== 'delete'} onChange={() => setDecisions((d) => ({ ...d, [blueprint.id]: 'keep' }))} />
                        {t('diffKeep')}
                      </label>
                      <label>
                        <input type="radio" checked={decisions[blueprint.id] === 'delete'} onChange={() => setDecisions((d) => ({ ...d, [blueprint.id]: 'delete' }))} />
                        {t('diffDelete')}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <small className="muted">{t('diffBoth').replace('{n}', String(props.diff.bothCount))}</small>
        </div>
        <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
          <button className="secondary" onClick={props.onCancel}>{t('cancel')}</button>
          <button className="primary" onClick={confirm}>{t('diffApplyMerge')}</button>
        </footer>
      </div>
    </div>
  );
}
