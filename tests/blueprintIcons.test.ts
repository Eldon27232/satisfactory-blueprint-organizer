import { describe, expect, it } from 'vitest';
import { BLUEPRINT_ICON_LIBRARY, getBlueprintIconById, listVisibleBlueprintIcons } from '../src/shared/blueprintIcons';

describe('blueprint icon library', () => {
  it('maps save/category IconID and blueprint config iconID into the same library', () => {
    expect(BLUEPRINT_ICON_LIBRARY.total).toBe(876);
    expect(getBlueprintIconById(45)?.texture).toContain('IconDesc_ConveyorSplitter_512');
    expect(getBlueprintIconById(782)?.localizationKey).toBe('Icons/QuestionMark');
    expect(getBlueprintIconById(782)?.imagePath).toBe('/blueprint-icons/0782.webp');
  });

  it('exposes visible icons for future category icon selection', () => {
    expect(listVisibleBlueprintIcons().length).toBe(835);
    expect(BLUEPRINT_ICON_LIBRARY.extractedAssets).toMatchObject({
      extractedPngCount: 850,
      placeholderSvgCount: 26,
      selfContained: true,
      runtimeExternalDependencies: []
    });
  });
});
