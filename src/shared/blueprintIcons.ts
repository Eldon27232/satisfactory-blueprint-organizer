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
