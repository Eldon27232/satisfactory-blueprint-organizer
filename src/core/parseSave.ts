import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Parser, SatisfactorySaveHeader, SaveReader } from '@etothepii/satisfactory-file-parser';
import { DIAGNOSTICS_DIR } from '../shared/constants';
import { ensureDir, timestampForPath, writeJson } from './fsUtils';

export interface SaveMetadata {
  sessionName?: string;
  mapName?: string;
  saveName?: string;
  playTimeSeconds?: number;
}

/**
 * Read just the (uncompressed) save header for candidate metadata. ~1ms vs the
 * ~hundreds of ms a full ParseSave costs, because the body chunks are never
 * inflated. Reads only the first chunk of the file, falling back to the whole
 * file if the header is unexpectedly large.
 */
export async function parseSaveHeaderMetadata(savePath: string): Promise<SaveMetadata> {
  const tryParse = (buffer: ArrayBufferLike): SaveMetadata => {
    const header = SatisfactorySaveHeader.Parse(new SaveReader(buffer));
    return {
      sessionName: header.sessionName,
      mapName: header.mapName,
      saveName: header.saveName,
      playTimeSeconds: header.playDurationSeconds
    };
  };
  try {
    return tryParse(await readFileHead(savePath, 1 << 20));
  } catch {
    const file = new Uint8Array(await fs.readFile(savePath)).buffer;
    return tryParse(file);
  }
}

async function readFileHead(savePath: string, bytes: number): Promise<ArrayBuffer> {
  const handle = await fs.open(savePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead)).buffer;
  } finally {
    await handle.close();
  }
}

export async function parseSaveFile(savePath: string): Promise<unknown> {
  const file = new Uint8Array(await fs.readFile(savePath)).buffer;
  return Parser.ParseSave(path.basename(savePath, '.sav'), file, { throwErrors: false });
}

export async function writeSaveFile(savePath: string, save: unknown): Promise<void> {
  let fileHeader: Uint8Array | undefined;
  const bodyChunks: Uint8Array[] = [];
  Parser.WriteSave(save as never, (header: Uint8Array) => {
    fileHeader = header;
  }, (chunk: Uint8Array) => {
    bodyChunks.push(chunk);
  });
  if (!fileHeader) throw new Error('Parser.WriteSave did not emit a save header.');
  await fs.writeFile(savePath, Buffer.concat([Buffer.from(fileHeader), ...bodyChunks.map((chunk) => Buffer.from(chunk))]));
}

export async function parseSaveMetadata(savePath: string): Promise<SaveMetadata> {
  const parsed = await parseSaveFile(savePath);
  return extractSaveMetadata(parsed);
}

export function extractSaveMetadata(parsed: unknown): SaveMetadata {
  const metadata: SaveMetadata = {};
  const candidates = flattenInterestingScalars(parsed, ['session', 'map', 'save', 'play']);
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (!metadata.sessionName && key.includes('session') && typeof candidate.value === 'string') {
      metadata.sessionName = candidate.value;
    }
    if (!metadata.mapName && key.includes('map') && typeof candidate.value === 'string') {
      metadata.mapName = candidate.value;
    }
    if (!metadata.saveName && key.includes('save') && typeof candidate.value === 'string') {
      metadata.saveName = candidate.value;
    }
    if (!metadata.playTimeSeconds && key.includes('play') && typeof candidate.value === 'number') {
      metadata.playTimeSeconds = candidate.value;
    }
  }
  return metadata;
}

export async function dumpSaveToDiagnostics(savePath: string, diagnosticsDir = DIAGNOSTICS_DIR): Promise<string> {
  const parsed = await parseSaveFile(savePath);
  await ensureDir(diagnosticsDir);
  const targetPath = path.join(diagnosticsDir, `save-dump-${timestampForPath()}-${sanitizeFileStem(path.basename(savePath, '.sav'))}.json`);
  await writeJson(targetPath, parsed);
  return targetPath;
}

export function findKeywordMatches(parsed: unknown, keywords: string[]): Array<{ path: string; value: unknown; parentSummary?: unknown }> {
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const matches: Array<{ path: string; value: unknown; parentSummary?: unknown }> = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown, currentPath: string, parent: unknown, depth: number): void {
    if (depth > 80) return;
    if (value && typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        const keyMatches = lowerKeywords.some((keyword) => key.toLowerCase().includes(keyword));
        const valueMatches = typeof child === 'string' && lowerKeywords.some((keyword) => child.toLowerCase().includes(keyword));
        if (keyMatches || valueMatches) {
          matches.push({ path: nextPath, value: summarizeValue(child), parentSummary: summarizeValue(parent) });
        }
        visit(child, nextPath, value, depth + 1);
      }
    }
  }

  visit(parsed, '', null, 0);
  return matches;
}

export function flattenInterestingScalars(parsed: unknown, keywords: string[]): Array<{ path: string; value: string | number | boolean | null }> {
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const result: Array<{ path: string; value: string | number | boolean | null }> = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown, currentPath: string, depth: number): void {
    if (depth > 20) return;
    if (value && typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        const matches = lowerKeywords.some((keyword) => nextPath.toLowerCase().includes(keyword));
        if (matches && (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean' || child === null)) {
          result.push({ path: nextPath, value: child });
        }
        visit(child, nextPath, depth + 1);
      }
    }
  }

  visit(parsed, '', 0);
  return result;
}

function summarizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return { kind: 'array', length: value.length };
  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['instanceName', 'typePath', 'name', 'propertyType', 'type', 'pathName', 'levelName']) {
    if (key in record) summary[key] = record[key];
  }
  summary.keys = Object.keys(record).slice(0, 25);
  return summary;
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}
