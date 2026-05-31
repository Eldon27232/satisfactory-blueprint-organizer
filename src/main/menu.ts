import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export type MenuLanguage = 'zh-CN' | 'en-US';

export function localeToMenuLanguage(locale: string): MenuLanguage {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function labels(language: MenuLanguage) {
  const zh = language === 'zh-CN';
  return {
    file: zh ? '文件' : 'File',
    quit: zh ? '退出' : 'Quit',
    edit: zh ? '编辑' : 'Edit',
    undo: zh ? '撤销' : 'Undo',
    redo: zh ? '重做' : 'Redo',
    cut: zh ? '剪切' : 'Cut',
    copy: zh ? '复制' : 'Copy',
    paste: zh ? '粘贴' : 'Paste',
    selectAll: zh ? '全选' : 'Select All',
    view: zh ? '视图' : 'View',
    reload: zh ? '重新加载' : 'Reload',
    forceReload: zh ? '强制重新加载' : 'Force Reload',
    devTools: zh ? '开发者工具' : 'Toggle DevTools',
    resetZoom: zh ? '实际大小' : 'Actual Size',
    zoomIn: zh ? '放大' : 'Zoom In',
    zoomOut: zh ? '缩小' : 'Zoom Out',
    fullscreen: zh ? '切换全屏' : 'Toggle Fullscreen',
    window: zh ? '窗口' : 'Window',
    minimize: zh ? '最小化' : 'Minimize',
    close: zh ? '关闭' : 'Close',
    help: zh ? '帮助' : 'Help',
    about: zh ? '关于' : 'About'
  };
}

/** Build and install a localized application menu (File / Edit / View / Window / Help). */
export function buildAppMenu(language: MenuLanguage): void {
  const l = labels(language);
  const template: MenuItemConstructorOptions[] = [
    { label: l.file, submenu: [{ role: 'quit', label: l.quit }] },
    {
      label: l.edit,
      submenu: [
        { role: 'undo', label: l.undo },
        { role: 'redo', label: l.redo },
        { type: 'separator' },
        { role: 'cut', label: l.cut },
        { role: 'copy', label: l.copy },
        { role: 'paste', label: l.paste },
        { role: 'selectAll', label: l.selectAll }
      ]
    },
    {
      label: l.view,
      submenu: [
        { role: 'reload', label: l.reload },
        { role: 'forceReload', label: l.forceReload },
        { role: 'toggleDevTools', label: l.devTools },
        { type: 'separator' },
        { role: 'resetZoom', label: l.resetZoom },
        { role: 'zoomIn', label: l.zoomIn },
        { role: 'zoomOut', label: l.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l.fullscreen }
      ]
    },
    {
      label: l.window,
      submenu: [
        { role: 'minimize', label: l.minimize },
        { role: 'close', label: l.close }
      ]
    },
    {
      label: l.help,
      submenu: [{ label: l.about, click: () => app.showAboutPanel?.() }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
