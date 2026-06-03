import { AlertTriangle, ArchiveRestore, CheckCircle2, FolderOpen, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DraftTree } from '../shared/draftModel';
import type { BackupRecord, ImportReport, Notice, SaveCandidate, SaveGameLocation } from '../shared/types';
import { availableLanguages, detectLanguage, saveLanguage, translate, type Language } from './i18n';
import { ManagerView } from './ManagerView';
import { Titlebar } from './Titlebar';
import { computeMappingDiff, mergeMappingDiff, type MappingDiff } from '../shared/mappingDiff';
import { pickReleaseNotes } from '../shared/releaseNotes';
import { MappingDiffDialog } from './MappingDiffDialog';
import { useUpdater } from './useUpdater';

type View = 'setup' | 'manager';

export function App(): JSX.Element {
  const [language, setLanguage] = useState<Language>(() => detectLanguage());
  const [view, setView] = useState<View>('setup');

  // Auto-located save flow: Windows user -> game account -> save.
  const [userLocations, setUserLocations] = useState<SaveGameLocation[]>([]);
  const [selectedUserName, setSelectedUserName] = useState<string | null>(null);
  const [saveGamesRoot, setSaveGamesRoot] = useState<string | null>(null);
  const [accountDirs, setAccountDirs] = useState<string[]>([]);
  const [selectedAccountDir, setSelectedAccountDir] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveCandidate[]>([]);
  const [selectedSavePath, setSelectedSavePath] = useState<string | null>(null);
  const [gameBlueprintDir, setGameBlueprintDir] = useState('');
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [locateNotices, setLocateNotices] = useState<Notice[]>([]);
  const [steamNames, setSteamNames] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState<DraftTree | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'info' | 'error'>('info');
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupToDelete, setBackupToDelete] = useState<BackupRecord | null>(null);
  const [mappingDiffState, setMappingDiffState] = useState<{ mappingDir: string; diff: MappingDiff } | null>(null);
  const [setupWarning, setSetupWarning] = useState(false);

  const { updateInfo, updatePhase, updatePercent, dismiss: dismissUpdate, startDownload: startUpdateDownload, quitAndInstall: quitAndInstallUpdate } = useUpdater();

  const t = (key: Parameters<typeof translate>[1]): string => translate(language, key);

  useEffect(() => {
    void autoLocate();
    void refreshBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve Steam persona names for account folders named like a SteamID64 (once each).
  const steamAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const accountDir of accountDirs) {
      const name = baseName(accountDir);
      if (!STEAMID64_RE.test(name) || steamAttempted.current.has(name)) continue;
      steamAttempted.current.add(name);
      void window.sbc?.getSteamName(name).then((resolved) => {
        if (resolved) setSteamNames((previous) => ({ ...previous, [name]: resolved }));
      });
    }
  }, [accountDirs]);

  function accountLabel(accountDir: string): string {
    const name = baseName(accountDir);
    return steamNames[name] ?? name;
  }

  function saveLabel(candidate: SaveCandidate): string {
    const base = candidate.saveName?.trim() || candidate.fileName;
    const when = candidate.fileNameTimestamp ?? candidate.modifiedTime.replace('T', ' ').slice(0, 19);
    return `${base} · ${when}`;
  }

  function api(): NonNullable<Window['sbc']> | null {
    if (!window.sbc) {
      setStatusKind('error');
      setStatus('Electron preload API 不可用，请重新构建后再运行打包应用。');
      return null;
    }
    return window.sbc;
  }

  function changeLanguage(next: Language): void {
    setLanguage(next);
    saveLanguage(next);
  }

  async function runBusy(action: () => Promise<void>, successMessage?: string): Promise<void> {
    setBusy(true);
    setStatus('');
    setStatusKind('info');
    try {
      await action();
      if (successMessage) {
        setStatusKind('info');
        setStatus(successMessage);
      }
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function autoLocate(): Promise<void> {
    const sbc = api();
    if (!sbc) return;
    await runBusy(async () => {
      const locations = await sbc.listSaveGameLocations();
      setUserLocations(locations);
      setSelectedUserName(null);
      setSaveGamesRoot(null);
      setAccountDirs([]);
      setSelectedAccountDir(null);
      setSaves([]);
      setSelectedSavePath(null);
      setGameBlueprintDir('');
      setSessionName(null);
      setLocateNotices([]);
      if (locations.length === 0) {
        setLocateNotices([{ severity: 'error', code: 'SAVEGAMES_ROOT_NOT_FOUND', message: t('rootNotFound') }]);
        return;
      }
      await selectUser(locations[0]);
    });
  }

  async function selectUser(location: SaveGameLocation): Promise<void> {
    const sbc = window.sbc;
    if (!sbc) return;
    setSelectedUserName(location.userName);
    setSaveGamesRoot(location.saveGamesRoot);
    setSelectedAccountDir(null);
    setSaves([]);
    setSelectedSavePath(null);
    setGameBlueprintDir('');
    setSessionName(null);
    const accounts = await sbc.listAccountsInRoot(location.saveGamesRoot);
    setAccountDirs(accounts);
    if (accounts.length === 0) {
      setLocateNotices([{ severity: 'warning', code: 'NO_ACCOUNT_DIR', message: t('noAccountFound'), path: location.saveGamesRoot }]);
      return;
    }
    setLocateNotices([]);
    setSelectedAccountDir(accounts[0]);
    await loadSaves(accounts[0], location.saveGamesRoot);
  }

  async function loadSaves(accountDir: string, root: string | null): Promise<void> {
    const sbc = window.sbc;
    if (!sbc) return;
    const list = await sbc.listSavesInAccount(accountDir);
    setSaves(list);
    if (list.length > 0 && root) {
      await selectSave(list[0].path, root);
    } else {
      setSelectedSavePath(null);
      setGameBlueprintDir('');
      setSessionName(null);
      setLocateNotices(list.length === 0 ? [{ severity: 'warning', code: 'NO_SAVE_IN_ACCOUNT', message: t('noSaveInAccount'), path: accountDir }] : []);
    }
  }

  async function selectSave(savePath: string, root: string): Promise<void> {
    const sbc = window.sbc;
    if (!sbc) return;
    setSelectedSavePath(savePath);
    const resolution = await sbc.resolveBlueprintDir(root, savePath);
    setGameBlueprintDir(resolution.blueprintDir ?? '');
    setSessionName(resolution.sessionName);
    setLocateNotices(resolution.notices);
  }

  function onAccountChange(accountDir: string): void {
    setSelectedAccountDir(accountDir);
    void runBusy(async () => {
      await loadSaves(accountDir, saveGamesRoot);
    });
  }

  function onSaveChange(savePath: string): void {
    void runBusy(async () => {
      if (saveGamesRoot) await selectSave(savePath, saveGamesRoot);
    });
  }

  function onUserChange(userName: string): void {
    const location = userLocations.find((item) => item.userName === userName);
    if (!location) return;
    void runBusy(async () => {
      await selectUser(location);
    });
  }

  // --- Manual fallbacks (kept small): override the auto-located paths. ---
  async function chooseSaveFileManually(): Promise<void> {
    const sbc = api();
    if (!sbc) return;
    const file = await sbc.chooseSavFile();
    if (!file) return;
    const accountDir = parentDir(file);
    const root = saveGamesRoot ?? parentDir(accountDir);
    await runBusy(async () => {
      setSaveGamesRoot(root);
      setSelectedAccountDir(accountDir);
      setAccountDirs((previous) => (previous.includes(accountDir) ? previous : [...previous, accountDir]));
      const list = await sbc.listSavesInAccount(accountDir);
      setSaves(list);
      await selectSave(file, root);
    });
  }

  async function chooseBlueprintDirManually(): Promise<void> {
    const sbc = api();
    if (!sbc) return;
    const dir = await sbc.chooseGameBlueprintDirectory();
    if (dir) setGameBlueprintDir(dir);
  }

  async function enterManager(): Promise<void> {
    const sbc = api();
    if (!sbc) return;
    if (!gameBlueprintDir || !selectedSavePath) {
      setSetupWarning(true);
      return;
    }
    await runBusy(async () => {
      const tree = await sbc.buildDraftFromSave(gameBlueprintDir, selectedSavePath);
      const blocking = tree.buildNotices.filter((notice) => notice.severity === 'error');
      if (blocking.length > 0) {
        throw new Error(blocking.map((notice) => `[${notice.code}] ${notice.message}`).join('\n'));
      }
      setDraft(tree);
      setImportReport(null);
      setView('manager');
    });
  }

  async function importExternalMapping(): Promise<void> {
    const sbc = api();
    if (!sbc || !draft) return;
    const mappingDir = await sbc.chooseMappingDirectory();
    if (!mappingDir) return;
    await runBusy(async () => {
      const scan = await sbc.scanMapping(draft.gameBlueprintDir, mappingDir);
      const blocking = scan.errors.filter((notice) => notice.severity === 'error');
      if (blocking.length > 0) {
        throw new Error(blocking.map((notice) => `[${notice.code}] ${notice.message}`).join('\n'));
      }
      const diff = computeMappingDiff(draft, scan.entries);
      if (diff.externalOnly.length === 0 && diff.managerOnly.length === 0) {
        setStatusKind('info');
        setStatus(t('diffNothing'));
        return;
      }
      setMappingDiffState({ mappingDir, diff });
    });
  }

  function confirmMappingMerge(keepIds: string[], deleteIds: string[]): void {
    if (!mappingDiffState || !draft) return;
    const merged = mergeMappingDiff(draft, mappingDiffState.mappingDir, mappingDiffState.diff.externalOnly, keepIds, deleteIds);
    setDraft({ ...merged, dirty: true });
    if (merged.savePath) void window.sbc?.writeDirtyFlag(merged.savePath, true);
    setMappingDiffState(null);
  }

  async function fetchPlan() {
    const sbc = window.sbc;
    if (!sbc || !draft) throw new Error('No draft.');
    return sbc.planDraftApply(draft);
  }

  async function applyDraft(gameClosedConfirmed: boolean): Promise<void> {
    const sbc = api();
    if (!sbc || !draft) return;
    await runBusy(async () => {
      const report = await sbc.applyDraft({ draft, gameClosedConfirmed });
      setImportReport(report);
      await refreshBackups();
      // Rebuild the draft from the freshly written save so further edits stay consistent.
      if (draft.savePath) {
        const refreshed = await sbc.buildDraftFromSave(draft.gameBlueprintDir, draft.savePath);
        setDraft(refreshed);
      }
      if (draft.savePath) await sbc.writeDirtyFlag(draft.savePath, false);
      setStatusKind(report.verificationResult.passed ? 'info' : 'error');
      setStatus(`${t('importCompleted')} ${report.verificationResult.passed ? t('verifyPassed') : t('verifyFailed')}\n${report.verificationResult.message}`);
    });
  }

  async function refreshBackups(): Promise<void> {
    if (!window.sbc) return;
    setBackups(await window.sbc.listBackups());
  }

  async function rollback(backupDir: string): Promise<void> {
    const sbc = api();
    if (!sbc) return;
    await runBusy(async () => {
      await sbc.rollback(backupDir);
      await refreshBackups();
    }, t('rollbackCompleted'));
  }

  async function confirmDeleteBackup(): Promise<void> {
    const sbc = api();
    const target = backupToDelete;
    if (!sbc || !target) return;
    setBackupToDelete(null);
    await runBusy(async () => {
      await sbc.deleteBackup(target.path);
      await refreshBackups();
    });
  }

  async function repairPlayerState(): Promise<void> {
    const sbc = api();
    if (!sbc || !selectedSavePath || !gameBlueprintDir) return;
    await runBusy(async () => {
      const report = await sbc.repairPlayerStates(selectedSavePath, gameBlueprintDir);
      await refreshBackups();
      setStatus(`${t('playerStateRepairCompleted')}\nBackup: ${report.backupDir}\nRemoved: ${report.result.removedObjects.length}`);
    });
  }

  if (view === 'manager' && draft) {
    return (
      <div className="app-root">
        <Titlebar title={t('appTitle')} language={language} />
        <main className="app-shell manager-shell">
          <ManagerView
            language={language}
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onBack={() => setView('setup')}
            onApply={applyDraft}
            onImportExternal={importExternalMapping}
            fetchPlan={fetchPlan}
          />
          {status && statusKind === 'error' && <pre className="floating-status error">{status}</pre>}
          {mappingDiffState && (
            <MappingDiffDialog
              language={language}
              mappingDir={mappingDiffState.mappingDir}
              diff={mappingDiffState.diff}
              onCancel={() => setMappingDiffState(null)}
              onConfirm={confirmMappingMerge}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app-root">
      <Titlebar title={t('appTitle')} language={language} />
      <div className="app-scroll">
        <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>{t('appTitle')}</h1>
        </div>
        <div className="top-actions">
          <label className="language-picker">
            <span>{t('language')}</span>
            <select value={language} onChange={(event) => changeLanguage(event.target.value)}>
              {availableLanguages.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" onClick={() => void autoLocate()} disabled={busy}>
            <RotateCcw size={16} /> {t('relocate')}
          </button>
        </div>
      </header>

      <section className="panel paths-panel">
        <h2>{t('selectSaveTitle')}</h2>

        <div className="path-picker-row">
        <label className="path-picker">
          <span>{t('userName')}</span>
          <select
            value={selectedUserName ?? ''}
            disabled={busy || userLocations.length === 0}
            onChange={(event) => onUserChange(event.target.value)}
          >
            {userLocations.length === 0 && <option value="">{t('rootNotFound')}</option>}
            {userLocations.map((location) => (
              <option key={location.userName} value={location.userName}>
                {location.userName}
              </option>
            ))}
          </select>
        </label>

        <label className="path-picker">
          <span>{t('gameName')}</span>
          <select
            value={selectedAccountDir ?? ''}
            disabled={busy || accountDirs.length === 0}
            onChange={(event) => onAccountChange(event.target.value)}
          >
            {accountDirs.length === 0 && <option value="">{t('noAccountFound')}</option>}
            {accountDirs.map((accountDir) => (
              <option key={accountDir} value={accountDir}>
                {accountLabel(accountDir)}
              </option>
            ))}
          </select>
        </label>
        </div>

        <label className="path-picker">
          <span>{t('save')}</span>
          <select
            value={selectedSavePath ?? ''}
            disabled={busy || saves.length === 0}
            onChange={(event) => onSaveChange(event.target.value)}
          >
            {saves.length === 0 && <option value="">{t('noSaveInAccount')}</option>}
            {saves.map((candidate) => (
              <option key={candidate.path} value={candidate.path}>
                {saveLabel(candidate)}
              </option>
            ))}
          </select>
        </label>

        <div className="actions-row">
          <div className="selected-save">
            <span className="muted">{t('sessionName')}</span>
            <strong>{sessionName ?? '-'}</strong>
            {gameBlueprintDir && <small title={gameBlueprintDir}>{gameBlueprintDir}</small>}
          </div>
          <button className="primary" onClick={enterManager} disabled={busy}>
            {t('openBlueprintManager')}
          </button>
        </div>

        <div className="fallback-actions">
          <span className="muted">{t('manualFallback')}</span>
          <button className="link" onClick={() => void chooseSaveFileManually()} disabled={busy}>
            {t('chooseSav')}
          </button>
          <button className="link" onClick={() => void chooseBlueprintDirManually()} disabled={busy}>
            {t('chooseBlueprintDir')}
          </button>
        </div>
      </section>

      {locateNotices.length > 0 && (
        <section className="panel">
          <NoticeList notices={locateNotices} emptyLabel={t('allGood')} />
        </section>
      )}

      <section className="grid two">
        <div className="panel">
          <h2>{t('backupsRollback')}</h2>
          <div className="actions-row wrap backups-actions">
            <button className="secondary" onClick={() => window.sbc?.openPath('Backups')}>
              <FolderOpen size={16} /> {t('openBackups')}
            </button>
            <button className="secondary" disabled={busy || !selectedSavePath || !gameBlueprintDir} onClick={repairPlayerState}>
              <ShieldAlert size={16} /> {t('repairPlayerState')}
            </button>
            <button className="secondary" disabled={!importReport} onClick={() => importReport && window.sbc?.openPath(importReport.reportDir)}>
              <FolderOpen size={16} /> {t('openReport')}
            </button>
          </div>
          <div className="backup-list">
            {backups.length === 0 ? (
              <div className="muted backup-empty">{t('noBackups')}</div>
            ) : (
              backups.map((backup) => (
                <div className="backup-row" key={backup.path}>
                  <span className="backup-id" title={backup.path}>{backup.id}</span>
                  <div className="backup-row-actions">
                    <button className="secondary" disabled={busy} onClick={() => rollback(backup.path)}>
                      <ArchiveRestore size={14} /> {t('rollback')}
                    </button>
                    <button className="icon-button danger" disabled={busy} title={t('delete')} onClick={() => setBackupToDelete(backup)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <h2>{t('warningsErrors')}</h2>
          {status && statusKind === 'error' ? (
            <pre className="status error">{status}</pre>
          ) : (
            <div className="empty-state">
              <CheckCircle2 size={18} /> {t('allGood')}
            </div>
          )}
        </div>
      </section>

      {setupWarning && (
        <div className="modal-backdrop" onClick={() => setSetupWarning(false)}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('needSaveTitle')}</h2>
            </header>
            <div className="confirm-body">
              <p>{t('needSaveMessage')}</p>
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="primary" onClick={() => setSetupWarning(false)}>
                {t('gotIt')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {backupToDelete && (
        <div className="modal-backdrop" onClick={() => setBackupToDelete(null)}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('deleteBackupTitle')}</h2>
            </header>
            <div className="confirm-body">
              <p>{t('deleteBackupMessage').replace('{id}', backupToDelete.id)}</p>
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              <button className="secondary" onClick={() => setBackupToDelete(null)}>
                {t('cancel')}
              </button>
              <button className="danger" onClick={() => void confirmDeleteBackup()}>
                {t('delete')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="modal-backdrop" onClick={updatePhase === 'downloading' ? undefined : dismissUpdate}>
          <div className="modal small-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <h2>{t('updateAvailableTitle')}</h2>
            </header>
            <div className="confirm-body">
              <p>{t('updateNewVersion').replace('{v}', updateInfo.version)}</p>
              {updatePhase === 'available' && updateInfo.notes && (
                <>
                  <strong>{t('updateNotesLabel')}</strong>
                  {renderReleaseNotes(pickReleaseNotes(updateInfo.notes, language))}
                </>
              )}
              {updatePhase === 'downloading' && (
                <div className="update-progress">
                  <div className="update-progress-bar">
                    <div style={{ width: `${updatePercent}%` }} />
                  </div>
                  <small className="muted">{t('updateDownloading')} {updatePercent}%</small>
                </div>
              )}
              {updatePhase === 'downloaded' && <p className="muted">{t('updateDownloaded')}</p>}
            </div>
            <footer className="confirm-actions" style={{ padding: '14px 18px' }}>
              {updatePhase === 'available' && (
                <>
                  <button className="secondary" onClick={dismissUpdate}>{t('updateLater')}</button>
                  <button className="primary" onClick={startUpdateDownload}>{t('updateNow')}</button>
                </>
              )}
              {updatePhase === 'downloading' && <button className="secondary" disabled>{t('updateDownloading')}</button>}
              {updatePhase === 'downloaded' && <button className="primary" onClick={quitAndInstallUpdate}>{t('updateRestart')}</button>}
            </footer>
          </div>
        </div>
      )}
        </main>
      </div>
    </div>
  );
}

const STEAMID64_RE = /^7656119\d{10}$/;

function parentDir(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(0, normalized.lastIndexOf('/')).replaceAll('/', '\\');
}

function baseName(targetPath: string): string {
  return targetPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? targetPath;
}

// 极简 markdown 渲染：标题（#）、无序列表（-/*）、普通段落。够更新公告用，不引入依赖。
// 公告文本已先经 pickReleaseNotes 归一化（HTML→Markdown 风格）。
function renderReleaseNotes(text: string): JSX.Element {
  return (
    <div className="update-notes">
      {text.split('\n').map((raw, index) => {
        const line = raw.trim();
        if (!line) return null;
        if (/^#{1,6}\s/.test(line)) {
          return (
            <div key={index} className="notes-heading">
              {line.replace(/^#{1,6}\s+/, '')}
            </div>
          );
        }
        if (/^[-*]\s/.test(line)) {
          return (
            <div key={index} className="notes-item">
              • {line.replace(/^[-*]\s+/, '')}
            </div>
          );
        }
        return <div key={index}>{line}</div>;
      })}
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
