import { AlertTriangle, ArchiveRestore, CheckCircle2, FolderOpen, RotateCcw, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DraftTree } from '../shared/draftModel';
import type { BackupRecord, ImportReport, Notice, SaveCandidate, SaveGameLocation } from '../shared/types';
import { detectLanguage, saveLanguage, translate, type Language } from './i18n';
import { ManagerView } from './ManagerView';
import { Titlebar } from './Titlebar';

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
  const [selectedBackupPath, setSelectedBackupPath] = useState<string>('');
  const [setupWarning, setSetupWarning] = useState(false);

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
      const tree = await sbc.buildDraftFromExternal(draft.gameBlueprintDir, mappingDir, draft.savePath);
      const blocking = tree.buildNotices.filter((notice) => notice.severity === 'error');
      if (blocking.length > 0) {
        throw new Error(blocking.map((notice) => `[${notice.code}] ${notice.message}`).join('\n'));
      }
      setDraft(tree);
    }, t('externalImported'));
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
            <select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
              <option value="zh-CN">{t('chinese')}</option>
              <option value="en-US">{t('english')}</option>
            </select>
          </label>
          <button className="secondary" onClick={() => void autoLocate()} disabled={busy}>
            <RotateCcw size={16} /> {t('relocate')}
          </button>
        </div>
      </header>

      <section className="panel paths-panel">
        <h2>{t('selectSaveTitle')}</h2>

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
          <div className="actions-row wrap">
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
          <div className="actions-row">
            <select className="backup-select" value={selectedBackupPath} onChange={(event) => setSelectedBackupPath(event.target.value)} disabled={busy || backups.length === 0}>
              <option value="">{backups.length === 0 ? t('noBackups') : t('selectBackup')}</option>
              {backups.map((backup) => (
                <option key={backup.path} value={backup.path}>
                  {backup.id}
                </option>
              ))}
            </select>
            <button className="secondary" disabled={busy || !selectedBackupPath} onClick={() => selectedBackupPath && rollback(selectedBackupPath)}>
              <ArchiveRestore size={16} /> {t('rollback')}
            </button>
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
