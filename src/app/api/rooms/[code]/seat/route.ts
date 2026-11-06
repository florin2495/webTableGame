import { notifyRoom } from "@/lib/server/broadcast";
import { db, PLAYERS } from "@/lib/server/db";
import { fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/seat  { seat: 0 | 1 | null } - lobby only: sit down on a free seat or stand up.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/seat">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const seat = body.seat === null ? null : Number(body.seat);
    if (seat !== null && seat !== 0 && seat !== 1) fail(400, "Loc invalid.");
    if (seat === player.seat) return { ok: true };

    const { error } = await db().from(PLAYERS).update({ seat }).eq("id", player.id);
    if (isUniqueViolation(error)) fail(409, "Locul e deja ocupat.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "seat_changed");
    return { ok: true };
  });
}
