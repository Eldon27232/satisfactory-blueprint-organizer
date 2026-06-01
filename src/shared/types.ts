export type Severity = 'info' | 'warning' | 'error';

export interface Notice {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
}

export interface BlueprintMappingEntry {
  sourceSbpPath: string;
  sourceCfgPath: string | null;
  targetSbpPath: string;
  targetCfgPath: string | null;
  blueprintStem: string;
  category: string;
  subcategory: string;
  relativePath: string;
  warnings: Notice[];
  errors: Notice[];
}

export interface ScanReport {
  selectedGameBlueprintDir: string;
  selectedMappingDir: string;
  entries: BlueprintMappingEntry[];
  categories: string[];
  subcategories: string[];
  missingCfgCount: number;
  duplicateStemCount: number;
  targetExistingCount: number;
  warnings: Notice[];
  errors: Notice[];
}

export interface SaveCandidate {
  path: string;
  fileName: string;
  fileNameTimestamp: string | null;
  modifiedTime: string;
  size: number;
  prefixMatched: boolean;
  headerMatched: boolean | null;
  hasSessionConflict: boolean;
  matchedSession: boolean;
  parsed: boolean;
  parseError?: string;
  sessionName?: string;
  mapName?: string;
  saveName?: string;
  playTimeSeconds?: number;
  saveKind?: 'autosave' | 'manual' | 'unknown';
}

export interface SaveDiscoveryResult {
  gameBlueprintDir: string;
  sessionName: string;
  saveGamesRoot: string;
  accountDirs: string[];
  selectedAccountDir: string | null;
  recursive: boolean;
  candidates: SaveCandidate[];
  warnings: Notice[];
  errors: Notice[];
}

/** A Windows user that has a Satisfactory SaveGames folder. */
export interface SaveGameLocation {
  /** Windows user folder name (e.g. the account under C:\Users). */
  userName: string;
  saveGamesRoot: string;
}

/** Result of auto-locating the fixed Satisfactory SaveGames root and its account folders. */
export interface AutoLocateResult {
  saveGamesRoot: string | null;
  rootExists: boolean;
  accountDirs: string[];
}

/** Blueprint dir resolved from a selected .sav (SaveGames\blueprints\<SessionName>). */
export interface BlueprintDirResolution {
  blueprintDir: string | null;
  sessionName: string | null;
  exists: boolean;
  notices: Notice[];
}

export interface BlueprintCategoryCapability {
  canWrite: boolean;
  confidence: 'none' | 'diagnostic-only' | 'reliable';
  reason: string;
  evidence: unknown[];
}

export interface DryRunResult {
  scan: ScanReport;
  saveDiscovery: SaveDiscoveryResult | null;
  selectedSavePath: string | null;
  selectedAccountDir: string | null;
  recursiveSaveScan: boolean;
  categoriesToCreate: string[];
  subcategoriesToCreate: string[];
  filesToCopy: number;
  filesToOverwrite: number;
  categoryCapability: BlueprintCategoryCapability;
  playerStateCheck?: PlayerStateCleanupResult;
  warnings: Notice[];
  errors: Notice[];
}

export interface ExecuteOptions {
  gameBlueprintDir: string;
  mappingDir: string;
  selectedAccountDir: string;
  recursiveSaveScan: boolean;
  selectedSavePath: string;
  allowOverwrite: boolean;
  gameClosedConfirmed: boolean;
}

export interface ImportReport {
  selectedGameBlueprintDir: string;
  selectedMappingDir: string;
  selectedSavePath: string;
  backupDir: string;
  copiedFiles: string[];
  overwrittenFiles: string[];
  skippedFiles: string[];
  renamedFiles?: Array<{ from: string; to: string }>;
  deletedFiles?: string[];
  iconUpdates?: Array<{ category: string; iconId: number }>;
  categoriesCreated: string[];
  subcategoriesCreated: string[];
  blueprintAssignments: Array<{
    blueprintStem: string;
    category: string;
    subcategory: string;
  }>;
  warnings: Notice[];
  errors: Notice[];
  verificationResult: {
    saveWriteAttempted: boolean;
    passed: boolean;
    message: string;
    categoryCounts?: Record<string, number>;
    undefinedCount?: number;
  };
  playerStateCleanup?: PlayerStateCleanupResult;
  reportDir: string;
}

export interface PlayerStateCleanupResult {
  checked: boolean;
  changed: boolean;
  playerStateCount: number;
  duplicateGroups: Array<{
    identityKey: string;
    kept: string[];
    removable: string[];
    blocked: string[];
  }>;
  removedObjects: string[];
  warnings: Notice[];
  errors: Notice[];
}

export interface BackupRecord {
  id: string;
  path: string;
  createdAt: string;
  savePath?: string;
  blueprintDir?: string;
}

export interface RollbackReport {
  backupDir: string;
  rollbackBeforeBackupDir: string;
  restoredSavePath: string | null;
  restoredBlueprintDir: string | null;
  warnings: Notice[];
  errors: Notice[];
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  notes: string;
  url: string;
}

export interface PlayerStateRepairReport {
  backupDir: string;
  selectedSavePath: string;
  result: PlayerStateCleanupResult;
}
