import React from 'react';
import { translate, type Language } from './i18n';

// mac 风格交通灯。平台固定为 mac，三个圆点通过 preload 暴露的 titlebar 方法控制窗口。
type Props = {
  language: Language;
  tooltips?: boolean;
};

const titlebar = (): NonNullable<Window['sbc']>['titlebar'] | undefined => window.sbc?.titlebar;

export function WindowControls(props: Props): JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(props.language, key);
  return (
    <section className="window-titlebar-controls type-mac">
      <div
        className="control minimize"
        onClick={() => void titlebar()?.minimize()}
        title={props.tooltips ? t('tbMinimize') : undefined}
      >
        ─
      </div>
      <div
        className="control maximize"
        onClick={() => void titlebar()?.toggle_maximize()}
        title={props.tooltips ? t('tbMaximize') : undefined}
      >
        ☐
      </div>
      <div
        className="control close"
        onClick={() => void titlebar()?.exit()}
        title={props.tooltips ? t('tbClose') : undefined}
      >
        X
      </div>
    </section>
  );
}

export default WindowControls;
