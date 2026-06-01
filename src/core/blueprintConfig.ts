import { promises as fs } from 'node:fs';
import { BlueprintConfig, BlueprintConfigReader, BlueprintConfigWriter } from '@etothepii/satisfactory-file-parser';

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

/** Rewrite a blueprint's .sbpcfg with a new icon id (config.iconID), preserving everything else. */
export async function writeBlueprintIconId(cfgPath: string, iconId: number): Promise<void> {
  const file = new Uint8Array(await fs.readFile(cfgPath)).buffer;
  const config = BlueprintConfig.Parse(new BlueprintConfigReader(file));
  config.iconID = iconId;
  const writer = new BlueprintConfigWriter();
  BlueprintConfig.Serialize(writer, config);
  await fs.writeFile(cfgPath, Buffer.from(writer.endWriting()));
}
