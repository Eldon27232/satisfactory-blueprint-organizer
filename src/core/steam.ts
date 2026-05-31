// Resolve a Steam persona name from a SteamID64 account-folder name via the
// public community profile XML endpoint. Best-effort: any failure (offline,
// private profile, rate limit) returns null so the caller falls back to the id.

const STEAMID64 = /^7656119\d{10}$/;

export function isSteamId64(name: string): boolean {
  return STEAMID64.test(name);
}

export async function resolveSteamPersonaName(steamId: string): Promise<string | null> {
  if (!isSteamId64(steamId)) return null;
  try {
    const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (SatisfactoryBlueprintOrganizer)' }
    });
    if (!response.ok) return null;
    return parsePersonaName(await response.text());
  } catch {
    return null;
  }
}

/** Extract the persona name from a Steam community ?xml=1 feed (or HTML fallback). */
export function parsePersonaName(text: string): string | null {
  // The ?xml=1 feed wraps the persona name in <steamID><![CDATA[...]]></steamID>.
  const cdata = text.match(/<steamID>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/steamID>/);
  if (cdata?.[1]?.trim()) return cdata[1].trim();

  // Fall back to the embedded JSON ("personaname":"...") or the page <title>.
  const persona = text.match(/"personaname"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (persona?.[1]) {
    try {
      return JSON.parse(`"${persona[1]}"`) as string;
    } catch {
      return persona[1];
    }
  }
  const title = text.match(/<title>\s*Steam Community\s*::\s*([\s\S]*?)<\/title>/);
  if (title?.[1]?.trim()) return title[1].trim();
  return null;
}
