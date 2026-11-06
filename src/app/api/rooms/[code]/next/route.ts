import { newGame } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { randomDie } from "@/lib/server/crypto";
import { fail, handle } from "@/lib/server/http";
import { matchWinner } from "@/lib/server/match";
import { requireMember, requireSeated, requireStatus, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/next - either seated player starts the next game of an unfinished match.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/next">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "finished");
    requireSeated(player);
    if (matchWinner(room) !== null) fail(409, "Meciul s-a terminat. Host-ul poate porni un meci nou.");

    await updateRoom(room, { status: "playing", game: newGame((room.game?.gameNo ?? 0) + 1, randomDie) });
    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
