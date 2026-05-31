# Satisfactory Blueprint Classifier

Windows desktop tool for mapping an external folder tree to Satisfactory blueprint categories while keeping game blueprint files flat.

The current `.sav` category writer is intentionally disabled until diagnostics prove the exact category fields for a target save structure. The tool still supports scanning, save discovery, dry-run, backup, flat copy, reports, rollback, and parser-based diagnostics.

## Commands

```powershell
npm install
npm run dev
npm run build
npm run dist
```

`npm run dist` creates `release/win-unpacked/Satisfactory Blueprint Classifier.exe`.
`npm run dist:nsis` is also available for an installer build, but it may require Windows symlink permissions because electron-builder downloads its signing/resource-edit helper.

## Save discovery

Select the game blueprint folder:

```text
...\FactoryGame\Saved\SaveGames\blueprints\<SessionName>
```

The app derives `SaveGames`, lists account/user directories under it, and scans the selected account directory for `.sav` files. By default it scans only one level and prioritizes files named like `<SessionName>_*.sav`.

## Diagnostics

```powershell
npm run dump-save -- "C:\path\Save.sav"
npm run scan-blueprint-structure -- "C:\path\Save.sav"
npm run diff-save-blueprint-category -- "C:\path\before.sav" "C:\path\after.sav"
```
