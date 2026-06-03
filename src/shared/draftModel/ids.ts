// Id generation (session-local uniqueness is all that's required).
//
// Ids must be unique across BOTH processes: the draft is built in the main
// process, then the renderer creates more nodes. A per-process counter would
// collide (main cat-1 vs renderer cat-1), so prefer a UUID when available.
let idCounter = 0;

export function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
