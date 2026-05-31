import { diffBlueprintCategorySaves } from '../src/core/saveDiff';

const beforePath = process.argv[2];
const afterPath = process.argv[3];
if (!beforePath || !afterPath) {
  console.error('Usage: npm run diff-save-blueprint-category -- <before.sav> <after.sav>');
  process.exit(1);
}

const output = await diffBlueprintCategorySaves(beforePath, afterPath);
console.log(output);
