import React from 'react';
import type { Language } from './i18n';

// mac 风格交通灯。平台固定为 mac，三个圆点通过 preload 暴露的 titlebar 方法控制窗口。
type Props = {
  language: Language;
  tooltips?: boolean;
};

const titlebar = (): NonNullable<Window['sbc']>['titlebar'] | undefined => window.sbc?.titlebar;

const TOOLTIPS = {
  'zh-CN': { minimize: '最小化', maximize: '最大化', close: '关闭' },
  'en-US': { minimize: 'Minimize', maximize: 'Maximize', close: 'Close' },
} as const;

export function WindowControls(props: Props): JSX.Element {
  const tip = TOOLTIPS[props.language];
  return (
    <section className="window-titlebar-controls type-mac">
      <div
        className="control minimize"
        onClick={() => void titlebar()?.minimize()}
        title={props.tooltips ? tip.minimize : undefined}
      >
        ─
      </div>
      <div
        className="control maximize"
        onClick={() => void titlebar()?.toggle_maximize()}
        title={props.tooltips ? tip.maximize : undefined}
      >
        ☐
      </div>
      <div
        className="control close"
        onClick={() => void titlebar()?.exit()}
        title={props.tooltips ? tip.close : undefined}
      >
        X
      </div>
    </section>
  );
}

export default WindowControls;
