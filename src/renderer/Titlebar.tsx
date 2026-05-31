import React from 'react';
import type { Language } from './i18n';
import { WindowControls } from './WindowControls';

type Props = {
  title: string;
  language: Language;
};

// 标题栏：左侧 mac 交通灯 + 居中标题，背景透明，与业务窗口无缝衔接。
export function Titlebar(props: Props): JSX.Element {
  return (
    <div className="window-titlebar">
      <WindowControls language={props.language} tooltips={true} />
      <section className="window-titlebar-content centered">
        <div className="window-title">{props.title}</div>
      </section>
    </div>
  );
}

export default Titlebar;
