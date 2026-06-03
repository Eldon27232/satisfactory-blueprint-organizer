import { ipcMain } from 'electron';
import { autoLocateSaveGames, listAccountDirsInRoot, listSaveGameLocations, listSavesInAccountDir, locateSaveCandidatesInAccountDir, resolveBlueprintDirForSave } from '../../core/locateSaves';
import { resolveSteamPersonaName } from '../../core/steam';
import { IPC } from '../../shared/ipcChannels';

// 存档定位：自动探测、列出存档根/账户/存档、解析蓝图目录，以及 Steam 昵称解析。
export function registerSaveIpc(): void {
  ipcMain.handle(IPC.saves.autoLocate, async () => autoLocateSaveGames());
  ipcMain.handle(IPC.saves.locations, async () => listSaveGameLocations());
  ipcMain.handle(IPC.saves.accountsInRoot, async (_event, saveGamesRoot: string) => listAccountDirsInRoot(saveGamesRoot));
  ipcMain.handle(IPC.saves.listInAccount, async (_event, accountDir: string) => listSavesInAccountDir(accountDir));
  ipcMain.handle(IPC.saves.resolveBlueprintDir, async (_event, saveGamesRoot: string, savePath: string) => resolveBlueprintDirForSave(saveGamesRoot, savePath));
  ipcMain.handle(IPC.saves.discover, async (_event, gameBlueprintDir: string, selectedAccountDir?: string | null, recursive?: boolean) => {
    return locateSaveCandidatesInAccountDir(gameBlueprintDir, selectedAccountDir ?? null, Boolean(recursive));
  });
  ipcMain.handle(IPC.account.steamName, async (_event, steamId: string) => resolveSteamPersonaName(steamId));
}
