import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface DocsClass {
  ClassName?: string;
  mDisplayName?: string;
  mPersistentBigIcon?: string;
  mSmallIcon?: string;
}

interface DocsGroup {
  Classes?: DocsClass[];
}

interface IconRecord {
  id: number;
  name: string;
  texture: string;
  itemDescriptor: string | null;
  displayNameZhHans?: string | null;
  displayNameSource?: string | null;
}

interface IconLibrary {
  icons: IconRecord[];
  [key: string]: unknown;
}

const projectRoot = process.cwd();
const docsPath =
  process.argv[2] ??
  'D:/SteamLibrary/steamapps/common/Satisfactory/CommunityResources/Docs/zh-Hans.json';
const libraryPath = path.join(projectRoot, 'src/shared/blueprintIconLibrary.generated.json');

function readUtf16Json<T>(filePath: string): T {
  let text = readFileSync(filePath).toString('utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text) as T;
}

function descriptorClassName(itemDescriptor: string | null): string | null {
  if (!itemDescriptor) return null;
  const match = /[./]([^./]+_C)$/.exec(itemDescriptor);
  return match?.[1] ?? null;
}

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined') return null;
  return trimmed;
}

function textureMatches(value: unknown, iconTexture: string): boolean {
  if (typeof value !== 'string' || !value || !iconTexture) return false;
  const normalized = value.replace(/^Texture2D\s+/, '').replace(/^"|"$/g, '');
  return normalized.includes(iconTexture) || iconTexture.includes(normalized);
}

function candidateNames(className: string): string[] {
  const names = [className];
  if (className.startsWith('Desc_')) {
    const stem = className.replace(/^Desc_/, '').replace(/_C$/, '');
    names.push(`Build_${stem}_C`, `Recipe_${stem}_C`, `BP_${stem}_C`);
  }
  return [...new Set(names)];
}

const docs = readUtf16Json<DocsGroup[]>(docsPath);
const library = JSON.parse(readFileSync(libraryPath, 'utf8')) as IconLibrary;

const classes = docs.flatMap((group) => group.Classes ?? []);
const byClass = new Map(classes.filter((entry) => entry.ClassName).map((entry) => [entry.ClassName as string, entry]));

let matched = 0;
let direct = 0;
let fallback = 0;

const enriched = library.icons.map((icon) => {
  let displayName: string | null = null;
  let source: string | null = null;
  const className = descriptorClassName(icon.itemDescriptor);

  if (className) {
    for (const candidate of candidateNames(className)) {
      const candidateName = cleanDisplayName(byClass.get(candidate)?.mDisplayName);
      if (candidateName) {
        displayName = candidateName;
        source = candidate;
        direct += candidate === className ? 1 : 0;
        fallback += candidate === className ? 0 : 1;
        break;
      }
    }
  }

  if (!displayName) {
    const textureClass = classes.find(
      (entry) =>
        cleanDisplayName(entry.mDisplayName) &&
        (textureMatches(entry.mPersistentBigIcon, icon.texture) || textureMatches(entry.mSmallIcon, icon.texture)),
    );
    if (textureClass) {
      displayName = cleanDisplayName(textureClass.mDisplayName);
      source = textureClass.ClassName ?? 'texture-match';
      fallback += 1;
    }
  }

  if (displayName) matched += 1;
  return {
    ...icon,
    displayNameZhHans: displayName,
    displayNameSource: source,
  };
});

writeFileSync(
  libraryPath,
  `${JSON.stringify(
    {
      ...library,
      localizedNameSource: docsPath,
      localizedNameLocale: 'zh-Hans',
      localizedNameMatched: matched,
      icons: enriched,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Matched ${matched}/${library.icons.length} icons (${direct} direct, ${fallback} fallback).`);
