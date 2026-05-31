import { promises as fs } from 'node:fs';
import { BlueprintConfig, BlueprintConfigReader } from '@etothepii/satisfactory-file-parser';

/**
 * Read the icon id out of a blueprint's .sbpcfg (config.iconID). The config file
 * is tiny and parses in well under a millisecond. Returns null on any failure so
 * a single broken file never blocks building the draft.
 */
export async function readBlueprintIconId(cfgPath: string): Promise<number | null> {
  try {
    const file = new Uint8Array(await fs.readFile(cfgPath)).buffer;
    const config = BlueprintConfig.Parse(new BlueprintConfigReader(file));
    return typeof config.iconID === 'number' ? config.iconID : null;
  } catch {
    return null;
  }
}
