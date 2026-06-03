import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

import { decodeZipName, importZipBlueprints } from '../src/core/zipImport';
import { configureImportStaging } from '../src/core/importStaging';
import { mergeImportedBlueprints, type DraftTree } from '../src/shared/draftModel';

// 解耦后 importStaging 不再依赖 electron：直接注入临时目录作为数据根即可，无需 mock。
const TEST_DATA_ROOT = path.join(os.tmpdir(), 'sbc-zip-test');

beforeAll(() => {
  configureImportStaging(TEST_DATA_ROOT);
});

afterAll(async () => {
  await fs.rm(TEST_DATA_ROOT, { recursive: true, force: true });
});

describe('decodeZipName', () => {
  it('decodes Latin1-returned GBK bytes back to Chinese', () => {
    // GBK 「中文」= D6 D0 CE C4；fflate 在未打 UTF-8 标志时按 Latin1 逐字节返回。
    const latin1 = String.fromCharCode(0xd6, 0xd0, 0xce, 0xc4);
    expect(decodeZipName(latin1)).toBe('中文');
  });

  it('keeps already-UTF-8-decoded names unchanged', () => {
    expect(decodeZipName('材料超市/一层.sbp')).toBe('材料超市/一层.sbp');
  });

  it('keeps pure ASCII names unchanged', () => {
    expect(decodeZipName('Power/Coal/bp.sbp')).toBe('Power/Coal/bp.sbp');
  });
});

describe('importZipBlueprints', () => {
  async function makeZip(name: string, files: Record<string, string>): Promise<string> {
    const data: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(files)) data[key] = strToU8(value);
    const dir = path.join(os.tmpdir(), 'sbc-zip-test', randomUUID());
    await fs.mkdir(dir, { recursive: true });
    const zipPath = path.join(dir, name);
    await fs.writeFile(zipPath, zipSync(data));
    return zipPath;
  }

  it('extracts pairs, carries zipName + dirSegments, and excludes the rest', async () => {
    const zipPath = await makeZip('myzip.zip', {
      'flat.sbp': 'a',
      'flat.sbpcfg': 'a',
      'sub/one.sbp': 'b',
      'sub/one.sbpcfg': 'b',
      'CatA/SubB/two.sbp': 'c',
      'CatA/SubB/two.sbpcfg': 'c',
      'deep/x/y/three.sbp': 'd',
      'deep/x/y/three.sbpcfg': 'd',
      'lonely.sbp': 'e', // 缺 .sbpcfg → 警告，不导入
      'readme.txt': 'ignore me' // 无关文件 → 排除
    });

    const result = await importZipBlueprints([zipPath]);
    const byStem = Object.fromEntries(result.entries.map((entry) => [entry.stem, entry]));

    expect(result.entries).toHaveLength(4);
    expect(byStem.flat).toMatchObject({ zipName: 'myzip', dirSegments: [] });
    expect(byStem.one).toMatchObject({ zipName: 'myzip', dirSegments: ['sub'] });
    expect(byStem.two).toMatchObject({ zipName: 'myzip', dirSegments: ['CatA', 'SubB'] });
    expect(byStem.three).toMatchObject({ zipName: 'myzip', dirSegments: ['deep', 'x', 'y'] });

    // 暂存副本真实落盘。
    for (const entry of result.entries) {
      await expect(fs.access(entry.sbpPath)).resolves.toBeUndefined();
      await expect(fs.access(entry.cfgPath)).resolves.toBeUndefined();
    }

    // lonely 缺配对 → 一条 INCOMPLETE_BLUEPRINT 警告。
    expect(result.notices.some((notice) => notice.code === 'INCOMPLETE_BLUEPRINT')).toBe(true);
  });

  it('warns when a zip has no paired blueprints', async () => {
    const zipPath = await makeZip('empty.zip', { 'notes.txt': 'hi' });
    const result = await importZipBlueprints([zipPath]);
    expect(result.entries).toHaveLength(0);
    expect(result.notices.some((notice) => notice.code === 'ZIP_NO_BLUEPRINTS')).toBe(true);
  });
});

describe('mergeImportedBlueprints', () => {
  function emptyTree(): DraftTree {
    return {
      gameBlueprintDir: 'C:/game',
      savePath: 'C:/game/s.sav',
      sessionName: 'S',
      buildNotices: [],
      blueprints: {},
      categories: [{ id: 'cat1', name: 'Power', iconId: null, subcategories: [{ id: 'sub1', name: 'Coal', blueprintIds: [] }] }]
    };
  }

  function input(category: string, subcategory: string, stem: string) {
    return { category, subcategory, stem, sourceSbpPath: `C:/stage/${stem}.sbp`, sourceCfgPath: `C:/stage/${stem}.sbpcfg`, iconId: null };
  }

  it('creates new categories/subcategories and merges into existing ones by name', () => {
    const next = mergeImportedBlueprints(emptyTree(), [
      input('Power', 'Coal', 'reactor'), // 并入已有 Power/Coal
      input('Logistics', 'Belts', 'mk1'), // 新建 Logistics/Belts
      input('Logistics', 'Belts', 'mk2') // 复用刚建的 Logistics/Belts
    ]);

    const power = next.categories.find((category) => category.name === 'Power')!;
    expect(power.subcategories.find((sub) => sub.name === 'Coal')!.blueprintIds).toHaveLength(1);

    const logistics = next.categories.find((category) => category.name === 'Logistics')!;
    expect(next.categories).toHaveLength(2); // 只新增一个分类
    expect(logistics.subcategories).toHaveLength(1);
    expect(logistics.subcategories[0].blueprintIds).toHaveLength(2);

    // 蓝图为 external 来源，指向暂存路径。
    const all = Object.values(next.blueprints);
    expect(all).toHaveLength(3);
    expect(all.every((bp) => bp.origin === 'external' && bp.sourceSbpPath?.startsWith('C:/stage/'))).toBe(true);
  });

  it('de-duplicates stems against the existing tree', () => {
    const tree = emptyTree();
    tree.blueprints.x = { id: 'x', stem: 'reactor', originalStem: 'reactor', origin: 'gameDir', sourceSbpPath: null, sourceCfgPath: null, hasSbp: true, hasCfg: false, iconId: null, originalIconId: null, warnings: [] };
    tree.categories[0].subcategories[0].blueprintIds.push('x');

    const next = mergeImportedBlueprints(tree, [input('New', 'Sub', 'reactor')]);
    const stems = Object.values(next.blueprints).map((bp) => bp.stem);
    // 原 reactor 不变，新导入的被改名以保持平铺唯一。
    expect(stems.filter((stem) => stem === 'reactor')).toHaveLength(1);
    expect(stems.some((stem) => stem !== 'reactor' && stem.startsWith('reactor'))).toBe(true);
  });
});
