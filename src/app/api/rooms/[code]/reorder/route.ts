import { validateSeatOrder } from "@/lib/queue";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, PLAYERS } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, lobby only (no game running).
// `order` is a full permutation of the seated players: first = White (seat 0), second = Black (seat 1).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);

    const seated = (await listPlayers(room.id)).filter((p) => p.seat !== null);
    const order = validateSeatOrder(
      seated.map((p) => p.id),
      body.order,
    );
    if (!order) fail(400, "Ordinea trebuie să conțină exact jucătorii de la masă.");
    const changes = order
      .map((id, seat) => ({ id, seat: seat as 0 | 1, from: seated.find((p) => p.id === id)!.seat }))
      .filter((c) => c.seat !== c.from);

    // The (room, seat) unique index forbids a direct swap: park everyone who moves, then seat them.
    if (changes.length > 0) {
      const park = await db().from(PLAYERS).update({ seat: null }).in("id", changes.map((c) => c.id));
      if (park.error) throw park.error;
      for (const c of changes) {
        const { error } = await db().from(PLAYERS).update({ seat: c.seat }).eq("id", c.id);
        if (error) {
          // Best effort: put everybody back where they were so nobody is left standing.
          for (const r of changes) await db().from(PLAYERS).update({ seat: r.from }).eq("id", r.id);
          throw error;
        }
      }
      await touchRoom(room.id);
      await notifyRoom(room.id, "seat_changed");
    }
    return { ok: true };
  });
}
