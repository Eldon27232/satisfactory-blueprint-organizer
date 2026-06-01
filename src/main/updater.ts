import { BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

// 应用内自动更新：从 GitHub release 读取 latest.yml，按需下载（带进度），
// 静默安装并重启。下载与安装都由用户在更新弹窗里主动触发。
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const send = (channel: string, payload?: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
    send('updater:available', { version: info.version, notes });
  });
  autoUpdater.on('update-not-available', () => send('updater:none'));
  autoUpdater.on('download-progress', (progress) => send('updater:progress', Math.round(progress.percent)));
  autoUpdater.on('update-downloaded', (info) => send('updater:downloaded', { version: info.version }));
  autoUpdater.on('error', (error) => send('updater:error', String(error?.message ?? error)));

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      send('updater:error', String(error instanceof Error ? error.message : error));
    }
  });
  ipcMain.handle('updater:download', async () => {
    await autoUpdater.downloadUpdate();
  });
  ipcMain.handle('updater:quitAndInstall', () => {
    // isSilent=true：静默安装到现有位置（不弹安装向导）；isForceRunAfter=true：装完自动重启。
    autoUpdater.quitAndInstall(true, true);
  });
}
