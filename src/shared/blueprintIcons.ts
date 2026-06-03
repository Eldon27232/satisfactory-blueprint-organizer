// 蓝图图标库：加载约 600KB 的 generated.json。本模块仅供 renderer（IconPicker / 蓝图卡片 / 检查器）
// 引用——core / main 切勿 import，以免把这份大 JSON 拉进主/核心进程的 bundle。
import iconLibrary from './blueprintIconLibrary.generated.json';

export type BlueprintIconType =
  | 'ESIT_Building'
  | 'ESIT_Equipment'
  | 'ESIT_Part'
  | 'ESIT_Monochrome'
  | 'ESIT_Material'
  | 'ESIT_Custom'
  | 'ESIT_MapStamp';

export interface BlueprintIconRecord {
  id: number;
  iconType: BlueprintIconType;
  hidden: boolean;
  searchOnly: boolean;
  animated: boolean;
  displayNameOverride: boolean;
  name: string;
  localizationTable: string | null;
  localizationKey: string | null;
  displayNameZhHans?: string | null;
  displayNameSource?: string | null;
  texture: string;
  itemDescriptor: string | null;
  imagePath: string;
  imageKind: 'extracted-png' | 'placeholder-svg';
}

export const BLUEPRINT_ICON_LIBRARY = iconLibrary;

export function getBlueprintIconById(iconId: number): BlueprintIconRecord | null {
  return (iconLibrary.icons as BlueprintIconRecord[]).find((icon) => icon.id === iconId) ?? null;
}

export function listVisibleBlueprintIcons(): BlueprintIconRecord[] {
  return (iconLibrary.icons as BlueprintIconRecord[]).filter((icon) => !icon.hidden && !icon.searchOnly);
}

export function listBlueprintIconsByType(iconType: BlueprintIconType): BlueprintIconRecord[] {
  return (iconLibrary.icons as BlueprintIconRecord[]).filter((icon) => icon.iconType === iconType);
}

export function getBlueprintIconDisplayName(icon: BlueprintIconRecord, locale: string): string {
  if (locale.toLowerCase().startsWith('zh') && icon.displayNameZhHans) return icon.displayNameZhHans;
  return icon.name;
}
