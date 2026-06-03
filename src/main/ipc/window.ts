import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';

// 窗口控制（自绘 mac 风格红绿灯按钮）与 webContents 编辑/视图操作（标题栏菜单）。
export function registerWindowIpc(): void {
  ipcMain.handle(IPC.window.minimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle(IPC.window.toggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(IPC.window.close, (event) => BrowserWindow.fromWebContents(event.sender)?.close());

  ipcMain.handle(IPC.web.undo, (event) => event.sender.undo());
  ipcMain.handle(IPC.web.redo, (event) => event.sender.redo());
  ipcMain.handle(IPC.web.cut, (event) => event.sender.cut());
  ipcMain.handle(IPC.web.copy, (event) => event.sender.copy());
  ipcMain.handle(IPC.web.paste, (event) => event.sender.paste());
  ipcMain.handle(IPC.web.delete, (event) => event.sender.delete());
  ipcMain.handle(IPC.web.selectAll, (event) => event.sender.selectAll());
  ipcMain.handle(IPC.web.reload, (event) => event.sender.reload());
  ipcMain.handle(IPC.web.forceReload, (event) => event.sender.reloadIgnoringCache());
  ipcMain.handle(IPC.web.toggleDevtools, (event) => event.sender.toggleDevTools());
  ipcMain.handle(IPC.web.actualSize, (event) => event.sender.setZoomLevel(0));
  ipcMain.handle(IPC.web.zoomIn, (event) => event.sender.setZoomLevel(event.sender.getZoomLevel() + 0.5));
  ipcMain.handle(IPC.web.zoomOut, (event) => event.sender.setZoomLevel(event.sender.getZoomLevel() - 0.5));
  ipcMain.handle(IPC.web.toggleFullscreen, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });
}
