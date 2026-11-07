/** Pending kick: a host kick during a running game gives the player KICK_GRACE_MS to press "Ignoră". */
export const KICK_GRACE_MS = 10_000;
/** Network grace on top of the visible countdown; after this the removal is enforced and "Ignoră" is refused. */
export const KICK_ENFORCE_MS = KICK_GRACE_MS + 2000;

const toMs = (v: string | number): number => (typeof v === "number" ? v : new Date(v).getTime());

/** Milliseconds left of the visible countdown, clamped to [0, KICK_GRACE_MS]; null when no kick is pending. */
export function kickRemainingMs(requestedAt: string | null, now: number): number | null {
  if (requestedAt === null) return null;
  const at = toMs(requestedAt);
  if (Number.isNaN(at)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, KICK_GRACE_MS - (now - at)));
}

/** True once the grace (plus network margin) has passed: the player must be removed and can no longer ignore. */
export function isKickExpired(requestedAt: string | null, now: number): boolean {
  if (requestedAt === null) return false;
  const at = toMs(requestedAt);
  return !Number.isNaN(at) && now - at > KICK_ENFORCE_MS;
}

/** ISO timestamp: pending kicks requested before this are expired. */
export function kickExpiryCutoff(now: number): string {
  return new Date(now - KICK_ENFORCE_MS).toISOString();
}
