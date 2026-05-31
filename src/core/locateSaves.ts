import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SAVE_EXT } from '../shared/constants';
import type { AutoLocateResult, BlueprintDirResolution, Notice, SaveCandidate, SaveDiscoveryResult, SaveGameLocation } from '../shared/types';
import { pathExists } from './fsUtils';
import { parseSaveHeaderMetadata } from './parseSave';

const MAX_RECURSIVE_SAVE_FILES = 300;
// Header-only parsing is ~1ms, so we can afford to read every prefix-matched candidate.
const MAX_METADATA_PARSE_FILES = 300;
const SKIP_RECURSIVE_DIR_NAMES = new Set(['blueprints', 'backup', 'backups', 'reports', 'diagnostics', 'node_modules']);

// ---------------------------------------------------------------------------
// Auto-locate flow: start from the fixed SaveGames root, pick account + save,
// then derive the blueprint dir from the chosen save's SessionName. This is the
// inverse of the legacy "derive everything from a chosen blueprint dir" flow,
// which is kept below for the older import workflow.
// ---------------------------------------------------------------------------

/** The fixed Windows SaveGames root: %LOCALAPPDATA%\FactoryGame\Saved\SaveGames (no hard-coded user name). */
export function getDefaultSaveGamesRoot(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'FactoryGame', 'Saved', 'SaveGames');
}

/**
 * Enumerate every Windows user under C:\Users that has a Satisfactory SaveGames folder,
 * derived from %LOCALAPPDATA% (so no path is hard-coded). The current user is listed first.
 */
export async function listSaveGameLocations(): Promise<SaveGameLocation[]> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  const userHome = path.dirname(path.dirname(localAppData)); // e.g. C:\Users\27232
  const usersRoot = path.dirname(userHome); // e.g. C:\Users
  const relFromHome = path.relative(userHome, localAppData); // e.g. AppData\Local
  const currentUser = path.basename(userHome);

  const locations: SaveGameLocation[] = [];
  let userEntries: import('node:fs').Dirent[];
  try {
    userEntries = await fs.readdir(usersRoot, { withFileTypes: true });
  } catch {
    const root = path.join(localAppData, 'FactoryGame', 'Saved', 'SaveGames');
    if (await pathExists(root)) locations.push({ userName: currentUser, saveGamesRoot: root });
    return locations;
  }

  for (const entry of userEntries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(usersRoot, entry.name, relFromHome, 'FactoryGame', 'Saved', 'SaveGames');
    if (await pathExists(root)) locations.push({ userName: entry.name, saveGamesRoot: root });
  }
  locations.sort((a, b) => {
    if (a.userName === currentUser) return -1;
    if (b.userName === currentUser) return 1;
    return a.userName.localeCompare(b.userName);
  });
  return locations;
}

/** List account folders directly under a SaveGames root (excluding `blueprints`). */
export async function listAccountDirsInRoot(saveGamesRoot: string): Promise<string[]> {
  if (!(await pathExists(saveGamesRoot))) return [];
  const entries = await fs.readdir(saveGamesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== 'blueprints')
    .map((entry) => path.join(saveGamesRoot, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/** Auto-locate the SaveGames root and list its account folders (excluding `blueprints`). */
export async function autoLocateSaveGames(): Promise<AutoLocateResult> {
  const saveGamesRoot = getDefaultSaveGamesRoot();
  if (!saveGamesRoot || !(await pathExists(saveGamesRoot))) {
    return { saveGamesRoot, rootExists: false, accountDirs: [] };
  }
  return { saveGamesRoot, rootExists: true, accountDirs: await listAccountDirsInRoot(saveGamesRoot) };
}

/** List every .sav directly in an account dir (no SessionName filter), with header metadata. */
export async function listSavesInAccountDir(accountDir: string): Promise<SaveCandidate[]> {
  if (!(await pathExists(accountDir))) return [];
  const warnings: Notice[] = [];
  const savePaths = await findSaveFiles(accountDir, false, warnings);
  const candidates: SaveCandidate[] = [];
  for (const savePath of savePaths) {
    const stat = await fs.stat(savePath);
    const fileName = path.basename(savePath);
    const candidate: SaveCandidate = {
      path: savePath,
      fileName,
      fileNameTimestamp: parseSatisfactorySaveTimestamp(fileName),
      modifiedTime: stat.mtime.toISOString(),
      size: stat.size,
      prefixMatched: false,
      headerMatched: null,
      hasSessionConflict: false,
      matchedSession: false,
      parsed: false,
      saveKind: inferSaveKind(fileName)
    };
    try {
      const metadata = await parseSaveHeaderMetadata(savePath);
      candidate.parsed = true;
      candidate.sessionName = isReliableParsedSessionName(metadata.sessionName) ? metadata.sessionName : undefined;
      candidate.mapName = metadata.mapName;
      candidate.saveName = metadata.saveName;
      candidate.playTimeSeconds = metadata.playTimeSeconds;
    } catch (error) {
      candidate.parseError = error instanceof Error ? error.message : String(error);
    }
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => Number(new Date(b.modifiedTime)) - Number(new Date(a.modifiedTime)));
}

/** Resolve SaveGames\blueprints\<SessionName> for a chosen .sav (SessionName from the save header). */
export async function resolveBlueprintDirForSave(saveGamesRoot: string, savePath: string): Promise<BlueprintDirResolution> {
  const notices: Notice[] = [];
  let sessionName: string | null = null;
  try {
    const metadata = await parseSaveHeaderMetadata(savePath);
    if (isReliableParsedSessionName(metadata.sessionName)) sessionName = metadata.sessionName;
  } catch (error) {
    notices.push({ severity: 'warning', code: 'SAVE_HEADER_READ_FAILED', message: `无法读取存档头部以确定 SessionName：${error instanceof Error ? error.message : String(error)}`, path: savePath });
  }
  if (!sessionName) {
    notices.push({ severity: 'error', code: 'SESSION_NAME_UNRESOLVED', message: '无法从存档确定 SessionName，因而无法定位蓝图目录。', path: savePath });
    return { blueprintDir: null, sessionName: null, exists: false, notices };
  }
  const blueprintDir = path.join(saveGamesRoot, 'blueprints', sessionName);
  const exists = await pathExists(blueprintDir);
  if (!exists) {
    notices.push({ severity: 'warning', code: 'BLUEPRINT_DIR_MISSING', message: `未找到该会话的蓝图目录：blueprints\\${sessionName}（此存档可能还没有蓝图）。`, path: blueprintDir });
  }
  return { blueprintDir, sessionName, exists, notices };
}

export function deriveSaveGamesRoot(gameBlueprintDir: string): { sessionName: string; saveGamesRoot: string; warnings: Notice[]; errors: Notice[] } {
  const normalized = path.resolve(gameBlueprintDir);
  const sessionName = path.basename(normalized);
  const blueprintParent = path.basename(path.dirname(normalized)).toLowerCase();
  const saveGamesRoot = path.dirname(path.dirname(normalized));
  const warnings: Notice[] = [];
  const errors: Notice[] = [];

  if (blueprintParent !== 'blueprints') {
    errors.push({
      severity: 'error',
      code: 'INVALID_BLUEPRINT_PATH',
      message: 'Path must end with SaveGames\\blueprints\\<SessionName>.',
      path: gameBlueprintDir
    });
  }
  if (path.basename(saveGamesRoot).toLowerCase() !== 'savegames') {
    warnings.push({
      severity: 'warning',
      code: 'UNUSUAL_SAVEGAMES_ROOT',
      message: 'The derived SaveGames root does not have the expected folder name.',
      path: saveGamesRoot
    });
  }

  return { sessionName, saveGamesRoot, warnings, errors };
}

export async function listAccountDirsFromBlueprintDir(gameBlueprintDir: string): Promise<string[]> {
  const derived = deriveSaveGamesRoot(gameBlueprintDir);
  if (!(await pathExists(derived.saveGamesRoot))) return [];
  const entries = await fs.readdir(derived.saveGamesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== 'blueprints')
    .map((entry) => path.join(derived.saveGamesRoot, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export async function locateSaveCandidates(gameBlueprintDir: string): Promise<SaveDiscoveryResult> {
  const accountDirs = await listAccountDirsFromBlueprintDir(gameBlueprintDir);
  return locateSaveCandidatesInAccountDir(gameBlueprintDir, accountDirs.length === 1 ? accountDirs[0] : null, false);
}

export async function locateSaveCandidatesInAccountDir(gameBlueprintDir: string, selectedAccountDir: string | null, recursive = false): Promise<SaveDiscoveryResult> {
  const derived = deriveSaveGamesRoot(gameBlueprintDir);
  const warnings = [...derived.warnings];
  const errors = [...derived.errors];
  const accountDirs = await listAccountDirsFromBlueprintDir(gameBlueprintDir);

  if (!(await pathExists(derived.saveGamesRoot))) {
    errors.push({
      severity: 'error',
      code: 'SAVEGAMES_ROOT_MISSING',
      message: 'The derived SaveGames root does not exist.',
      path: derived.saveGamesRoot
    });
    return baseResult(gameBlueprintDir, derived.sessionName, derived.saveGamesRoot, accountDirs, selectedAccountDir, recursive, warnings, errors);
  }

  if (!selectedAccountDir) {
    if (accountDirs.length === 0) {
      errors.push({
        severity: 'error',
        code: 'NO_ACCOUNT_DIR',
        message: 'No account/user directory was found under SaveGames.',
        path: derived.saveGamesRoot
      });
    } else {
      warnings.push({
        severity: 'warning',
        code: 'ACCOUNT_DIR_REQUIRED',
        message: 'Choose an account/user directory before scanning save files.',
        path: derived.saveGamesRoot
      });
    }
    return baseResult(gameBlueprintDir, derived.sessionName, derived.saveGamesRoot, accountDirs, selectedAccountDir, recursive, warnings, errors);
  }

  const normalizedSelected = path.resolve(selectedAccountDir).toLowerCase();
  const normalizedAccounts = accountDirs.map((dir) => path.resolve(dir).toLowerCase());
  const isInsideAccountDir = normalizedAccounts.some((accountDir) => normalizedSelected === accountDir || normalizedSelected.startsWith(`${accountDir}${path.sep}`.toLowerCase()));
  if (!isInsideAccountDir) {
    errors.push({
      severity: 'error',
      code: 'INVALID_ACCOUNT_DIR',
      message: 'The selected account/user directory is not under the derived SaveGames root.',
      path: selectedAccountDir
    });
    return baseResult(gameBlueprintDir, derived.sessionName, derived.saveGamesRoot, accountDirs, selectedAccountDir, recursive, warnings, errors);
  }

  const savePaths = await findSaveFiles(selectedAccountDir, recursive, warnings);
  const candidates: SaveCandidate[] = [];
  let parsedMetadataCount = 0;
  let hiddenNonSessionSaves = 0;
  for (const savePath of savePaths) {
    const stat = await fs.stat(savePath);
    const fileName = path.basename(savePath);
    const prefixMatched = fileName.toLowerCase().startsWith(`${derived.sessionName.toLowerCase()}_`);
    if (!prefixMatched) {
      hiddenNonSessionSaves++;
      continue;
    }
    const candidate: SaveCandidate = {
      path: savePath,
      fileName,
      fileNameTimestamp: parseSatisfactorySaveTimestamp(fileName),
      modifiedTime: stat.mtime.toISOString(),
      size: stat.size,
      prefixMatched,
      headerMatched: null,
      hasSessionConflict: false,
      matchedSession: false,
      parsed: false,
      saveKind: inferSaveKind(fileName)
    };

    const shouldParseMetadata = prefixMatched && parsedMetadataCount < MAX_METADATA_PARSE_FILES;
    if (shouldParseMetadata) {
      parsedMetadataCount++;
    }

    try {
      if (!shouldParseMetadata) {
        candidate.parseError = prefixMatched ? 'Skipped metadata parse after candidate limit.' : 'Skipped metadata parse for non-prefix candidate.';
        candidate.matchedSession = prefixMatched;
        candidates.push(candidate);
        continue;
      }
      const metadata = await parseSaveHeaderMetadata(savePath);
      candidate.parsed = true;
      candidate.sessionName = metadata.sessionName;
      candidate.mapName = metadata.mapName;
      candidate.saveName = metadata.saveName;
      candidate.playTimeSeconds = metadata.playTimeSeconds;
      const reliableSessionName = isReliableParsedSessionName(metadata.sessionName) ? metadata.sessionName : undefined;
      candidate.headerMatched = reliableSessionName ? reliableSessionName === derived.sessionName : null;
      candidate.hasSessionConflict = prefixMatched && Boolean(reliableSessionName) && reliableSessionName !== derived.sessionName;
      candidate.matchedSession = (prefixMatched || candidate.headerMatched === true) && !candidate.hasSessionConflict;
    } catch (error) {
      candidate.parseError = error instanceof Error ? error.message : String(error);
      candidate.matchedSession = prefixMatched;
    }

    if (candidate.hasSessionConflict) {
      warnings.push({
        severity: 'warning',
        code: 'SAVE_SESSION_CONFLICT',
        message: `File name matches SessionName but parsed session is "${candidate.sessionName}". It will not be selected by default.`,
        path: savePath
      });
    }
    candidates.push(candidate);
  }

  if (hiddenNonSessionSaves > 0) {
    warnings.push({
      severity: 'info',
      code: 'NON_SESSION_SAVES_HIDDEN',
      message: `Hidden ${hiddenNonSessionSaves} .sav file(s) that do not start with "${derived.sessionName}_".`,
      path: selectedAccountDir
    });
  }

  if (!candidates.some((candidate) => candidate.matchedSession)) {
    warnings.push({
      severity: 'warning',
      code: 'NO_MATCHING_SAVE',
      message: 'No .sav candidate matched the blueprint SessionName.',
      path: selectedAccountDir
    });
  }

  return {
    gameBlueprintDir,
    sessionName: derived.sessionName,
    saveGamesRoot: derived.saveGamesRoot,
    accountDirs,
    selectedAccountDir,
    recursive,
    candidates: candidates.sort(sortSaveCandidates),
    warnings,
    errors
  };
}

async function findSaveFiles(dir: string, recursive: boolean, warnings: Notice[]): Promise<string[]> {
  const result: string[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const currentDir = queue.shift() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && recursive && !SKIP_RECURSIVE_DIR_NAMES.has(entry.name.toLowerCase())) {
        queue.push(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === SAVE_EXT) {
        result.push(fullPath);
        if (recursive && result.length >= MAX_RECURSIVE_SAVE_FILES) {
          warnings.push({
            severity: 'warning',
            code: 'SAVE_SCAN_LIMIT_REACHED',
            message: `Recursive save scan stopped after ${MAX_RECURSIVE_SAVE_FILES} .sav files to avoid freezing the app.`,
            path: dir
          });
          return result;
        }
      }
    }
    if (!recursive) break;
  }
  return result;
}

export function parseSatisfactorySaveTimestamp(fileName: string): string | null {
  const match = fileName.match(/_(\d{6})-(\d{6})\.sav$/i);
  if (!match) return null;
  const [, datePart, timePart] = match;
  const year = 2000 + Number(datePart.slice(4, 6));
  const month = datePart.slice(2, 4);
  const day = datePart.slice(0, 2);
  const hour = timePart.slice(0, 2);
  const minute = timePart.slice(2, 4);
  const second = timePart.slice(4, 6);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function inferSaveKind(fileName: string): 'autosave' | 'manual' | 'unknown' {
  if (/^autosave/i.test(fileName)) return 'autosave';
  if (/\.sav$/i.test(fileName)) return 'manual';
  return 'unknown';
}

function isReliableParsedSessionName(value: string | undefined): value is string {
  if (!value) return false;
  return !['StrProperty', 'IntProperty', 'FloatProperty', 'BoolProperty', 'ArrayProperty', 'StructProperty'].includes(value);
}

function sortSaveCandidates(a: SaveCandidate, b: SaveCandidate): number {
  if (a.prefixMatched !== b.prefixMatched) return a.prefixMatched ? -1 : 1;
  if (a.matchedSession !== b.matchedSession) return a.matchedSession ? -1 : 1;
  return Number(new Date(b.modifiedTime)) - Number(new Date(a.modifiedTime));
}

function baseResult(
  gameBlueprintDir: string,
  sessionName: string,
  saveGamesRoot: string,
  accountDirs: string[],
  selectedAccountDir: string | null,
  recursive: boolean,
  warnings: Notice[],
  errors: Notice[]
): SaveDiscoveryResult {
  return { gameBlueprintDir, sessionName, saveGamesRoot, accountDirs, selectedAccountDir, recursive, candidates: [], warnings, errors };
}
