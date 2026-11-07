import { db, PLAYER_COLUMNS, PLAYERS, type PlayerRow } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { notifyRoom } from "@/lib/server/broadcast";
import { removePlayer } from "@/lib/server/membership";
import { requireHost, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/kick  { playerId } - host removes another member.
// While a game is running and the target is seated, the kick is only *pending*: the player has
// KICK_GRACE_MS to press "Ignoră" (see ./ignore), after which enforceExpiredKicks removes them.
// Spectators, and everyone outside a running game, are removed at once.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);

    const body = await readJson(req);
    const targetId = typeof body.playerId === "string" ? body.playerId : "";
    if (targetId === player.id) fail(400, "Nu te poți scoate singur. Folosește „Părăsește camera”.");

    const { data: target, error } = await db()
      .from(PLAYERS)
      .select(PLAYER_COLUMNS)
      .eq("id", targetId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error; // 22P02 = malformed uuid
    if (!target) fail(404, "Jucătorul nu mai e în cameră.");

    if (room.status === "playing" && (target as PlayerRow).seat !== null) {
      // A second kick on an already pending player is a no-op: the deadline is not reset.
      const { error: pendingError } = await db()
        .from(PLAYERS)
        .update({ kick_requested_at: new Date().toISOString() })
        .eq("id", targetId)
        .is("kick_requested_at", null);
      if (pendingError) throw pendingError;
      await notifyRoom(room.id, "kick_pending");
      return { ok: true, pending: true };
    }

    await removePlayer(room, targetId, "player_kicked");
    return { ok: true };
  });
}
