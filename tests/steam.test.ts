import { describe, expect, it } from 'vitest';
import { isSteamId64, parsePersonaName } from '../src/core/steam';

describe('steam helpers', () => {
  it('recognises SteamID64 folder names', () => {
    expect(isSteamId64('76561199600411695')).toBe(true);
    expect(isSteamId64('not-a-steam-id')).toBe(false);
    expect(isSteamId64('12345678901234567')).toBe(false); // 17 digits but wrong prefix
  });

  it('parses the persona name from the ?xml=1 CDATA feed', () => {
    const xml = '<?xml version="1.0"?><profile><steamID64>76561199600411695</steamID64><steamID><![CDATA[E_ldon]]></steamID></profile>';
    expect(parsePersonaName(xml)).toBe('E_ldon');
  });

  it('falls back to personaname JSON then title', () => {
    expect(parsePersonaName('window.x = {"personaname":"Foo Bar"};')).toBe('Foo Bar');
    expect(parsePersonaName('<title>Steam Community :: Baz</title>')).toBe('Baz');
    expect(parsePersonaName('nothing here')).toBeNull();
  });
});
