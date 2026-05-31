import { scanBlueprintStructure } from '../src/core/blueprintCategoryDiscovery';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: npm run scan-blueprint-structure -- <save.sav>');
  process.exit(1);
}

const output = await scanBlueprintStructure(savePath);
console.log(output);
