import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { resolveDataRoot } from './paths';
import { registerUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;

// 运行时窗口/任务栏图标。打包后图标作为 extraResources 放在 resources/icon.ico；
// 开发时指向项目 build/icon.ico（__dirname 为 out/main）。
function appIconPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '../../build/icon.ico');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: 'Satisfactory Blueprint Organizer',
    // Avoid the blank-white flash on launch: keep the window hidden until the
    // renderer has painted its first frame, and match the page background color.
    show: false,
    backgroundColor: '#f5f6f1',
    icon: appIconPath(),
    // mac-style: hide the native title bar; the renderer draws its own traffic-light bar.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Windows 据此关联任务栏图标/通知与应用身份；不设会让任务栏回退到默认图标。
  if (process.platform === 'win32') app.setAppUserModelId('dev.local.satisfactory-blueprint-organizer');
  // 把工作目录切到数据根，使 Backups/Reports/diagnostics 等相对路径统一落在这里。
  try {
    process.chdir(resolveDataRoot());
  } catch {
    // ignore: 退回默认工作目录
  }
  registerIpc();
  Menu.setApplicationMenu(null);
  createWindow();
  registerUpdater(() => mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
