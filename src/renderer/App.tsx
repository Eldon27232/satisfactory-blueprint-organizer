import { AlertTriangle, ArchiveRestore, CheckCircle2, FolderOpen, Play, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BackupRecord, DryRunResult, ImportReport, Notice } from '../shared/types';
import { detectLanguage, saveLanguage, translate, type Language } from './i18n';

export function App(): JSX.Element {
  const [language, setLanguage] = useState<Language>(() => detectLanguage());
  const [gameBlueprintDir, setGameBlueprintDir] = useState('');
  const [mappingDir, setMappingDir] = useState('');
  const [selectedAccountDir, setSelectedAccountDir] = useState<string | null>(null);
  const [recursiveSaveScan, setRecursiveSaveScan] = useState(false);
  const [selectedSavePath, setSelectedSavePath] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [gameClosedConfirmed, setGameClosedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);

  const defaultSave = useMemo(() => {
    const matched = dryRun?.saveDiscovery?.candidates.filter((candidate) => candidate.matchedSession && !candidate.hasSessionConflict) ?? [];
    return matched.length === 1 ? matched[0].path : null;
  }, [dryRun]);
  const effectiveSavePath = selectedSavePath ?? defaultSave;
  const effectiveAccountDir = selectedAccountDir ?? dryRun?.selectedAccountDir ?? null;
  const notices = useMemo<Notice[]>(() => [...(dryRun?.warnings ?? []), ...(dryRun?.errors ?? [])], [dryRun]);
  const canExecute = Boolean(dryRun && effectiveSavePath && gameClosedConfirmed && (allowOverwrite || dryRun.scan.targetExistingCount === 0) && dryRun.errors.length === 0);
  const t = (key: Parameters<typeof translate>[1]): string => translate(language, key);

  useEffect(() => {
    void refreshBackups();
  }, []);

  function changeLanguage(nextLanguage: Language): void {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  async function chooseGameDir(): Promise<void> {
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    const selected = await window.sbc.chooseGameBlueprintDirectory();
    if (selected) {
      setGameBlueprintDir(selected);
      setDryRun(null);
      setSelectedSavePath(null);
      setSelectedAccountDir(null);
    }
  }

  async function chooseMappingDir(): Promise<void> {
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    const selected = await window.sbc.chooseMappingDirectory();
    if (selected) {
      setMappingDir(selected);
      setDryRun(null);
    }
  }

  async function chooseSaveFile(): Promise<void> {
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    const selected = await window.sbc.chooseSavFile();
    if (selected) {
      setSelectedSavePath(selected);
      setSelectedAccountDir(parentDir(selected));
      setDryRun(null);
    }
  }

  async function runDryRun(): Promise<void> {
    if (!gameBlueprintDir || !mappingDir) return;
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    await runBusy(t('scanCompleted'), async () => {
      const result = await window.sbc.dryRun(gameBlueprintDir, mappingDir, selectedSavePath, selectedAccountDir, recursiveSaveScan);
      setDryRun(result);
      if (!selectedAccountDir && result.selectedAccountDir) setSelectedAccountDir(result.selectedAccountDir);
      if (!selectedSavePath) setSelectedSavePath(result.selectedSavePath);
    });
  }

  async function execute(): Promise<void> {
    if (!effectiveSavePath) return;
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    await runBusy(t('importCompleted'), async () => {
      const report = await window.sbc.executeImport({
        gameBlueprintDir,
        mappingDir,
        selectedAccountDir: effectiveAccountDir ?? parentDir(effectiveSavePath),
        recursiveSaveScan,
        selectedSavePath: effectiveSavePath,
        allowOverwrite,
        gameClosedConfirmed
      });
      setImportReport(report);
      await refreshBackups();
    });
  }

  async function repairPlayerState(): Promise<void> {
    if (!effectiveSavePath || !gameBlueprintDir || !window.sbc) return;
    await runBusy(t('playerStateRepairCompleted'), async () => {
      const report = await window.sbc.repairPlayerStates(effectiveSavePath, gameBlueprintDir);
      setStatus(`${t('playerStateRepairCompleted')}\nBackup: ${report.backupDir}\nRemoved objects: ${report.result.removedObjects.length}`);
      await refreshBackups();
    });
  }

  async function refreshBackups(): Promise<void> {
    if (!window.sbc) return;
    setBackups(await window.sbc.listBackups());
  }

  async function rollback(backupDir: string): Promise<void> {
    if (!window.sbc) {
      setStatus('Electron preload API is not available. Please run the packaged app again after rebuilding.');
      return;
    }
    await runBusy(t('rollbackCompleted'), async () => {
      await window.sbc.rollback(backupDir);
      await refreshBackups();
    });
  }

  async function runBusy(successMessage: string, action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setStatus('');
    try {
      await action();
      setStatus(successMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>{t('appTitle')}</h1>
          <p>{t('appSubtitle')}</p>
        </div>
        <div className="top-actions">
          <label className="language-picker">
            <span>{t('language')}</span>
            <select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
              <option value="zh-CN">{t('chinese')}</option>
              <option value="en-US">{t('english')}</option>
            </select>
          </label>
          <button className="secondary" onClick={refreshBackups} disabled={busy}>
            <RotateCcw size={16} /> {t('refreshBackups')}
          </button>
        </div>
      </header>

      <section className="panel paths-panel">
        <PathPicker label={t('gameBlueprintFolder')} selectLabel={t('select')} value={gameBlueprintDir} onChoose={chooseGameDir} onChange={setGameBlueprintDir} />
        <PathPicker label={t('externalMappingFolder')} selectLabel={t('select')} value={mappingDir} onChoose={chooseMappingDir} onChange={setMappingDir} />
        <div className="actions-row">
          <button onClick={runDryRun} disabled={busy || !gameBlueprintDir || !mappingDir}>
            <Search size={16} /> {t('scanDryRun')}
          </button>
          <button className="secondary" onClick={chooseSaveFile} disabled={busy}>
            <FolderOpen size={16} /> {t('chooseSav')}
          </button>
          <label className="check-row">
            <input type="checkbox" checked={allowOverwrite} onChange={(event) => setAllowOverwrite(event.target.checked)} />
            {t('allowOverwrite')}
          </label>
          <label className="check-row">
            <input type="checkbox" checked={gameClosedConfirmed} onChange={(event) => setGameClosedConfirmed(event.target.checked)} />
            {t('gameClosed')}
          </label>
          <label className="check-row">
            <input type="checkbox" checked={recursiveSaveScan} onChange={(event) => setRecursiveSaveScan(event.target.checked)} />
            {t('recursiveSaveScan')}
          </label>
          <button className="danger" onClick={execute} disabled={busy || !canExecute}>
            <Play size={16} /> {t('execute')}
          </button>
        </div>
      </section>

      {dryRun && (
        <>
          <section className="grid two">
            <div className="panel">
              <h2>{t('detectedPaths')}</h2>
              <Info label="SessionName" value={dryRun.saveDiscovery?.sessionName ?? '-'} />
              <Info label={t('saveGamesRoot')} value={dryRun.saveDiscovery?.saveGamesRoot ?? '-'} />
              <Info label={t('savWriter')} value={dryRun.categoryCapability.reason} />

              <h2 className="subhead">{t('accountFolder')}</h2>
              <div className="save-list">
                {(dryRun.saveDiscovery?.accountDirs ?? []).map((accountDir) => (
                  <label className={`save-item ${effectiveAccountDir === accountDir ? 'selected' : ''}`} key={accountDir}>
                    <input
                      type="radio"
                      checked={effectiveAccountDir === accountDir}
                      onChange={() => {
                        setSelectedAccountDir(accountDir);
                        setSelectedSavePath(null);
                      }}
                    />
                    <span>
                      <strong>{accountDir.split(/[\\/]/).pop()}</strong>
                      <small>{accountDir}</small>
                    </span>
                  </label>
                ))}
              </div>

              <h2 className="subhead">{t('saveCandidates')}</h2>
              <div className="actions-row wrap compact-actions">
                <button className="secondary" onClick={chooseSaveFile} disabled={busy}>
                  <FolderOpen size={16} /> {t('chooseSav')}
                </button>
                {selectedSavePath && !dryRun.saveDiscovery?.candidates.some((candidate) => candidate.path === selectedSavePath) && (
                  <small>{t('manuallySelected')}: {selectedSavePath}</small>
                )}
              </div>
              <div className="save-list">
                {(dryRun.saveDiscovery?.candidates ?? []).map((candidate) => (
                  <label className={`save-item ${effectiveSavePath === candidate.path ? 'selected' : ''}`} key={candidate.path}>
                    <input type="radio" checked={effectiveSavePath === candidate.path} onChange={() => setSelectedSavePath(candidate.path)} />
                    <span>
                      <strong>{candidate.fileName}</strong>
                      <small>{candidate.path}</small>
                      <small>
                        {t('filenameTime')}: {candidate.fileNameTimestamp ?? '-'} | {t('mtime')}: {new Date(candidate.modifiedTime).toLocaleString()} | {(candidate.size / 1024 / 1024).toFixed(1)} MB
                      </small>
                      <small>
                        {t('matched')}: {String(candidate.matchedSession)} | {t('prefix')}: {String(candidate.prefixMatched)} | {t('header')}: {String(candidate.headerMatched)} | {candidate.saveKind ?? 'unknown'}
                      </small>
                      <small>{t('parser')}: {candidate.parsed ? `${candidate.sessionName ?? '-'} / ${candidate.saveName ?? '-'}` : `${t('failed')}: ${candidate.parseError ?? 'unknown'}`}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="panel">
              <h2>{t('dryRunSummary')}</h2>
              <div className="stats">
                <Stat label={t('blueprints')} value={dryRun.scan.entries.length} />
                <Stat label={t('missingCfg')} value={dryRun.scan.missingCfgCount} />
                <Stat label={t('duplicates')} value={dryRun.scan.duplicateStemCount} />
                <Stat label={t('categories')} value={dryRun.categoriesToCreate.length} />
                <Stat label={t('subcategories')} value={dryRun.subcategoriesToCreate.length} />
                <Stat label={t('copyFiles')} value={dryRun.filesToCopy} />
                <Stat label={t('overwrite')} value={dryRun.filesToOverwrite} />
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>{t('mappingPreview')}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('blueprint')}</th>
                    <th>{t('category')}</th>
                    <th>{t('subcategory')}</th>
                    <th>{t('relativePath')}</th>
                    <th>{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.scan.entries.map((entry) => (
                    <tr key={entry.sourceSbpPath}>
                      <td>{entry.blueprintStem}</td>
                      <td>{entry.category}</td>
                      <td>{entry.subcategory}</td>
                      <td>{entry.relativePath}</td>
                      <td>{entry.errors.length ? 'Error' : entry.warnings.length ? 'Warning' : 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>{t('warningsErrors')}</h2>
            <NoticeList notices={notices} emptyLabel={t('noNotice')} />
          </section>
        </>
      )}

      <section className="grid two">
        <div className="panel">
          <h2>{t('reportsDiagnostics')}</h2>
          <div className="actions-row wrap">
            <button className="secondary" disabled={!importReport} onClick={() => importReport && window.sbc.openPath(importReport.reportDir)}>
              <FolderOpen size={16} /> {t('openReport')}
            </button>
            <button className="secondary" disabled={!effectiveSavePath} onClick={() => effectiveSavePath && window.sbc.dumpSave(effectiveSavePath).then(setStatus)}>
              <ShieldAlert size={16} /> {t('dumpSave')}
            </button>
            <button className="secondary" disabled={!effectiveSavePath} onClick={() => effectiveSavePath && window.sbc.scanBlueprintStructure(effectiveSavePath).then(setStatus)}>
              <Search size={16} /> {t('scanStructure')}
            </button>
            <button className="secondary" disabled={busy || !effectiveSavePath || !gameBlueprintDir} onClick={repairPlayerState}>
              <ShieldAlert size={16} /> {t('repairPlayerState')}
            </button>
          </div>
          {status && <pre className="status">{status}</pre>}
        </div>

        <div className="panel">
          <h2>{t('backupsRollback')}</h2>
          <div className="actions-row">
            <button className="secondary" onClick={() => window.sbc.openPath('Backups')}>
              <FolderOpen size={16} /> {t('openBackups')}
            </button>
          </div>
          <div className="backup-list">
            {backups.map((backup) => (
              <div className="backup-item" key={backup.path}>
                <div>
                  <strong>{backup.id}</strong>
                  <small>{backup.path}</small>
                </div>
                <button className="secondary" disabled={busy} onClick={() => rollback(backup.path)}>
                  <ArchiveRestore size={16} /> {t('rollback')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function parentDir(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(0, normalized.lastIndexOf('/')).replaceAll('/', '\\');
}

function PathPicker(props: { label: string; selectLabel: string; value: string; onChange: (value: string) => void; onChoose: () => void }): JSX.Element {
  return (
    <label className="path-picker">
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      <button type="button" className="secondary" onClick={props.onChoose}>
        <FolderOpen size={16} /> {props.selectLabel}
      </button>
    </label>
  );
}

function Info(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="info-row">
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

function NoticeList(props: { notices: Notice[]; emptyLabel: string }): JSX.Element {
  if (props.notices.length === 0) {
    return (
      <div className="empty-state">
        <CheckCircle2 size={18} /> {props.emptyLabel}
      </div>
    );
  }
  return (
    <div className="notice-list">
      {props.notices.map((notice, index) => (
        <div className={`notice ${notice.severity}`} key={`${notice.code}-${index}`}>
          <AlertTriangle size={16} />
          <div>
            <strong>{notice.code}</strong>
            <span>{notice.message}</span>
            {notice.path && <small>{notice.path}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
