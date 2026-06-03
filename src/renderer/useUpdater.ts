import { useEffect, useState } from 'react';

export type UpdatePhase = 'available' | 'downloading' | 'downloaded';

export interface UseUpdater {
  updateInfo: { version: string; notes: string } | null;
  updatePhase: UpdatePhase;
  updatePercent: number;
  /** 关闭更新弹窗（下载中不允许）。 */
  dismiss: () => void;
  /** 开始下载更新。 */
  startDownload: () => void;
  /** 装好后退出并安装重启。 */
  quitAndInstall: () => void;
}

// 应用内自动更新：启动时检查一次，订阅 available/progress/downloaded 事件，并在卸载时退订
// （preload 的 onXxx 返回退订函数）。下载与安装由用户在弹窗里主动触发。
export function useUpdater(): UseUpdater {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string } | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('available');
  const [updatePercent, setUpdatePercent] = useState(0);

  useEffect(() => {
    const updater = window.sbc?.updater;
    if (!updater) return;
    const unsubscribe = [
      updater.onAvailable((info) => { setUpdateInfo(info); setUpdatePhase('available'); }),
      updater.onProgress((percent) => setUpdatePercent(percent)),
      updater.onDownloaded((info) => { setUpdateInfo((previous) => previous ?? { version: info.version, notes: '' }); setUpdatePhase('downloaded'); })
    ];
    void updater.check();
    return () => { for (const off of unsubscribe) off(); };
  }, []);

  return {
    updateInfo,
    updatePhase,
    updatePercent,
    dismiss: () => setUpdateInfo(null),
    startDownload: () => { setUpdatePhase('downloading'); setUpdatePercent(0); void window.sbc?.updater.download(); },
    quitAndInstall: () => { void window.sbc?.updater.quitAndInstall(); }
  };
}
