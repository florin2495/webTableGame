import { resignGame } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle } from "@/lib/server/http";
import { finishGamePatch } from "@/lib/server/match";
import { reportRound } from "@/lib/server/leaderboard";
import { requireMember, requireSeated, requireStatus, stateAfter, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/resign - a seated player gives up the current game.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/resign">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");
    const seat = requireSeated(player);
    if (!room.game) fail(409, "Nu există un joc în desfășurare.");

    const over = resignGame(room.game, seat);
    const patch = finishGamePatch(room, over);
    await updateRoom(room, patch);
    await reportRound(room, over, room.rounds_played + 1);
    const state = await stateAfter(room, patch, player);
    await notifyRoom(room.id, "game_over", player.id);
    return { ok: true, state };
  });
}
