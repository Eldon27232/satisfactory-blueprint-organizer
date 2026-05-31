import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanMappingFolder } from '../src/core/scanMapping';

let tempRoot: string;
let mappingDir: string;
let gameDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(process.cwd(), 'tmp-scan-'));
  mappingDir = path.join(tempRoot, 'mapping');
  gameDir = path.join(tempRoot, 'SaveGames', 'blueprints', 'SessionA');
  await fs.mkdir(mappingDir, { recursive: true });
  await fs.mkdir(gameDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('scanMappingFolder', () => {
  it('maps two-level folders to category and subcategory', async () => {
    await writeBlueprint('Power', 'Coal', '8coal', true);
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.entries[0]).toMatchObject({
      blueprintStem: '8coal',
      category: 'Power',
      subcategory: 'Coal'
    });
    expect(report.missingCfgCount).toBe(0);
  });

  it('maps a root-level blueprint to 未命名 / 未命名', async () => {
    await fs.writeFile(path.join(mappingDir, 'loose.sbp'), 'sbp');
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.entries[0]).toMatchObject({ blueprintStem: 'loose', category: '未命名', subcategory: '未命名' });
  });

  it('maps a one-level folder to category / 未命名', async () => {
    const dir = path.join(mappingDir, 'Power');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'turbo.sbp'), 'sbp');
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.entries[0]).toMatchObject({ blueprintStem: 'turbo', category: 'Power', subcategory: '未命名' });
  });

  it('trims deeper paths to the first two levels with a warning', async () => {
    await writeBlueprint('Power', path.join('Coal', 'Mk2'), 'plant', true);
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.entries[0]).toMatchObject({ category: 'Power', subcategory: 'Coal' });
    expect(report.entries[0].warnings.some((warning) => warning.code === 'DEPTH_TRIMMED')).toBe(true);
  });

  it('warns duplicate stems after flattening without blocking multi-category assignment', async () => {
    await writeBlueprint('Power', 'Coal', 'same', true);
    await writeBlueprint('Logistics', 'Splitter', 'same', true);
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.duplicateStemCount).toBe(1);
    expect(report.warnings.filter((warning) => warning.code === 'DUPLICATE_BLUEPRINT_STEM')).toHaveLength(2);
    expect(report.errors.filter((error) => error.code === 'DUPLICATE_BLUEPRINT_STEM')).toHaveLength(0);
  });

  it('warns when sbpcfg is missing', async () => {
    await writeBlueprint('Power', 'Coal', 'missingCfg', false);
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.missingCfgCount).toBe(1);
    expect(report.warnings.some((warning) => warning.code === 'MISSING_SBPCFG')).toBe(true);
  });

  it('warns when target blueprint already exists', async () => {
    await writeBlueprint('Power', 'Coal', 'existing', true);
    await fs.writeFile(path.join(gameDir, 'existing.sbp'), 'old');
    const report = await scanMappingFolder({ mappingDir, gameBlueprintDir: gameDir });
    expect(report.targetExistingCount).toBe(1);
  });
});

async function writeBlueprint(category: string, subcategory: string, stem: string, withCfg: boolean): Promise<void> {
  const dir = path.join(mappingDir, category, subcategory);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${stem}.sbp`), 'sbp');
  if (withCfg) await fs.writeFile(path.join(dir, `${stem}.sbpcfg`), 'cfg');
}
