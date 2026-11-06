import { newGame } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { randomDie } from "@/lib/server/crypto";
import { fail, handle } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/start - host, lobby, both seats taken. Starts a new match.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const seats = new Set((await listPlayers(room.id)).map((p) => p.seat));
    if (!seats.has(0) || !seats.has(1)) fail(409, "Ai nevoie de doi jucători așezați (Alb și Negru).");

    await updateRoom(room, { status: "playing", score_white: 0, score_black: 0, game: newGame(1, randomDie) });
    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
