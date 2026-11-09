import { newGame } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { randomDie } from "@/lib/server/crypto";
import { fail, handle } from "@/lib/server/http";
import { matchWinner } from "@/lib/server/match";
import { requireMember, requireSeated, requireStatus, stateAfter, updateRoom, clearPendingKicks } from "@/lib/server/room";

// POST /api/rooms/[code]/next - either seated player starts the next game of an unfinished match.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/next">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "finished");
    requireSeated(player);
    if (matchWinner(room) !== null) fail(409, "Meciul s-a terminat. Host-ul poate porni un meci nou.");

    const patch = { status: "playing" as const, game: newGame((room.game?.gameNo ?? 0) + 1, randomDie) };
    await updateRoom(room, patch);
    await clearPendingKicks(room.id);
    const state = await stateAfter(room, patch, player);
    await notifyRoom(room.id, "game_started", player.id);
    return { ok: true, state };
  });
}
