import { notifyRoom } from "@/lib/server/broadcast";
import { handle } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, updateRoom, clearPendingKicks } from "@/lib/server/room";

// POST /api/rooms/[code]/lobby - host ends the match and returns everyone to the lobby
// (to change seats, let a spectator play, or change the match length).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/lobby">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await updateRoom(room, { status: "lobby", game: null, score_white: 0, score_black: 0 });
    await clearPendingKicks(room.id);
    await notifyRoom(room.id, "back_to_lobby");
    return { ok: true };
  });
}
