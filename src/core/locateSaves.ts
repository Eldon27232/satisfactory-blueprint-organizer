import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SAVE_EXT } from '../shared/constants';
import type { Notice, SaveCandidate, SaveDiscoveryResult } from '../shared/types';
import { pathExists } from './fsUtils';
import { parseSaveMetadata } from './parseSave';

const MAX_RECURSIVE_SAVE_FILES = 300;
const MAX_METADATA_PARSE_FILES = 25;
const SKIP_RECURSIVE_DIR_NAMES = new Set(['blueprints', 'backup', 'backups', 'reports', 'diagnostics', 'node_modules']);

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
      const metadata = await parseSaveMetadata(savePath);
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
