import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSaveGamesRoot, locateSaveCandidates, locateSaveCandidatesInAccountDir, parseSatisfactorySaveTimestamp } from '../src/core/locateSaves';

vi.mock('../src/core/parseSave', () => ({
  parseSaveMetadata: vi.fn(async (savePath: string) => ({
    sessionName: path.basename(savePath, '.sav').startsWith('SessionA_') ? 'SessionA' : 'Other'
  }))
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(process.cwd(), 'tmp-save-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('locateSaves', () => {
  it('derives SessionName and SaveGames root from blueprint dir', () => {
    const blueprintDir = path.join(tempRoot, 'FactoryGame', 'Saved', 'SaveGames', 'blueprints', 'SessionA');
    const result = deriveSaveGamesRoot(blueprintDir);
    expect(result.sessionName).toBe('SessionA');
    expect(path.basename(result.saveGamesRoot)).toBe('SaveGames');
    expect(result.errors).toHaveLength(0);
  });

  it('lists account directory saves and excludes blueprints folder', async () => {
    const saveRoot = path.join(tempRoot, 'FactoryGame', 'Saved', 'SaveGames');
    const accountDir = path.join(saveRoot, '76561199600411695');
    const blueprintDir = path.join(saveRoot, 'blueprints', 'SessionA');
    await fs.mkdir(accountDir, { recursive: true });
    await fs.mkdir(blueprintDir, { recursive: true });
    await fs.writeFile(path.join(accountDir, 'SessionA_290526-001821.sav'), 'fake');
    await fs.writeFile(path.join(accountDir, 'Other_290526-001821.sav'), 'fake');
    await fs.writeFile(path.join(saveRoot, 'blueprints', 'ignored.sav'), 'fake');
    const result = await locateSaveCandidates(blueprintDir);
    expect(result.accountDirs).toEqual([accountDir]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates.filter((candidate) => candidate.matchedSession)).toHaveLength(1);
    expect(result.candidates[0].fileNameTimestamp).toBe('2026-05-29 00:18:21');
    expect(result.warnings.some((warning) => warning.code === 'NON_SESSION_SAVES_HIDDEN')).toBe(true);
  });

  it('requires an account directory when more than one exists', async () => {
    const saveRoot = path.join(tempRoot, 'FactoryGame', 'Saved', 'SaveGames');
    const blueprintDir = path.join(saveRoot, 'blueprints', 'SessionA');
    await fs.mkdir(path.join(saveRoot, 'account-a'), { recursive: true });
    await fs.mkdir(path.join(saveRoot, 'account-b'), { recursive: true });
    await fs.mkdir(blueprintDir, { recursive: true });
    const result = await locateSaveCandidatesInAccountDir(blueprintDir, null);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.code === 'ACCOUNT_DIR_REQUIRED')).toBe(true);
  });

  it('parses Satisfactory save filename timestamps', () => {
    expect(parseSatisfactorySaveTimestamp('和猫猫_290526-001821.sav')).toBe('2026-05-29 00:18:21');
  });
});
