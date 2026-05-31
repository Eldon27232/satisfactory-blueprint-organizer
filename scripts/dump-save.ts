import { dumpSaveToDiagnostics } from '../src/core/parseSave';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: npm run dump-save -- <save.sav>');
  process.exit(1);
}

const output = await dumpSaveToDiagnostics(savePath);
console.log(output);
