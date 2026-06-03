// 主进程 <-> 渲染进程 IPC channel 名集中定义，供 preload 与 main 各域注册函数共用，
// 避免 channel 字符串散落在多个文件里造成漂移（preload 写一个名、main 写另一个名而不报错）。
export const IPC = {
  dialog: {
    directory: 'dialog:directory',
    file: 'dialog:file',
    zipFiles: 'dialog:zipFiles'
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggleMaximize',
    close: 'window:close'
  },
  web: {
    undo: 'web:undo',
    redo: 'web:redo',
    cut: 'web:cut',
    copy: 'web:copy',
    paste: 'web:paste',
    delete: 'web:delete',
    selectAll: 'web:selectAll',
    reload: 'web:reload',
    forceReload: 'web:forceReload',
    toggleDevtools: 'web:toggleDevtools',
    actualSize: 'web:actualSize',
    zoomIn: 'web:zoomIn',
    zoomOut: 'web:zoomOut',
    toggleFullscreen: 'web:toggleFullscreen'
  },
  shell: {
    openExternal: 'shell:openExternal',
    openPath: 'shell:openPath'
  },
  saves: {
    autoLocate: 'saves:autoLocate',
    locations: 'saves:locations',
    accountsInRoot: 'saves:accountsInRoot',
    listInAccount: 'saves:listInAccount',
    resolveBlueprintDir: 'saves:resolveBlueprintDir',
    discover: 'saves:discover'
  },
  account: {
    steamName: 'account:steamName'
  },
  draft: {
    fromSave: 'draft:fromSave',
    fromExternal: 'draft:fromExternal',
    plan: 'draft:plan',
    apply: 'draft:apply'
  },
  workflow: {
    dryRun: 'workflow:dryRun',
    execute: 'workflow:execute',
    repairPlayerStates: 'workflow:repairPlayerStates'
  },
  backup: {
    list: 'backup:list',
    rollback: 'backup:rollback',
    delete: 'backup:delete'
  },
  blueprints: {
    importDropped: 'blueprints:importDropped',
    importZip: 'blueprints:importZip'
  },
  dirty: {
    read: 'dirty:read',
    write: 'dirty:write'
  },
  mapping: {
    scan: 'mapping:scan'
  },
  diagnostics: {
    dumpSave: 'diagnostics:dumpSave',
    scanBlueprintStructure: 'diagnostics:scanBlueprintStructure',
    diffSaveBlueprintCategory: 'diagnostics:diffSaveBlueprintCategory'
  },
  // 主进程 -> 渲染进程的单向推送也走这里（updater 事件），渲染进程通过 preload 订阅。
  updater: {
    check: 'updater:check',
    download: 'updater:download',
    quitAndInstall: 'updater:quitAndInstall',
    available: 'updater:available',
    none: 'updater:none',
    progress: 'updater:progress',
    downloaded: 'updater:downloaded',
    error: 'updater:error'
  }
} as const;
