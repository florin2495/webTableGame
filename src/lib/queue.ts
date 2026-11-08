// Pure helpers for the seat order (host reorder) and the spectator queue. No I/O: unit-tested in queue.test.ts.

/** Seated player ids, white first. `order` must be a full permutation of exactly those ids; else null. */
export function validateSeatOrder(seatedIds: readonly string[], order: unknown): string[] | null {
  if (!Array.isArray(order) || order.length !== seatedIds.length) return null;
  if (!order.every((x): x is string => typeof x === "string")) return null;
  if (new Set(order).size !== order.length) return null;
  const known = new Set(seatedIds);
  return order.every((id) => known.has(id)) ? order : null;
}

interface Queued {
  id: string;
  queued_at: string | null;
}

/** Spectators waiting for a seat, oldest request first. */
export function queueOrder<T extends Queued>(spectators: readonly T[]): T[] {
  return spectators
    .filter((s) => s.queued_at !== null)
    .sort((a, b) => Date.parse(a.queued_at!) - Date.parse(b.queued_at!) || a.id.localeCompare(b.id));
}

/** Which queued spectator takes which free seat (queue order, lowest seat first). */
export function pickPromotions(freeSeats: readonly (0 | 1)[], spectators: readonly Queued[]): { id: string; seat: 0 | 1 }[] {
  const seats = [...freeSeats].sort();
  return queueOrder(spectators)
    .slice(0, seats.length)
    .map((s, i) => ({ id: s.id, seat: seats[i] }));
}

/** 1-based place in the queue, or null when not queued. */
export function queuePosition(spectators: readonly Queued[], id: string): number | null {
  const i = queueOrder(spectators).findIndex((s) => s.id === id);
  return i < 0 ? null : i + 1;
}
