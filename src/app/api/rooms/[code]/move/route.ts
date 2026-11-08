import { commitTurn, parseMoves } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { finishGamePatch } from "@/lib/server/match";
import { reportRound } from "@/lib/server/leaderboard";
import { requireMember, requireSeated, requireStatus, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/move  { moves: [{from, die}] } - plays the whole turn at once.
// The server replays and validates every move; the client's own check is only for the UI.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/move">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");
    const seat = requireSeated(player);
    const game = room.game;
    if (!game || game.turn !== seat) fail(409, "Nu e rândul tău.");

    const body = await readJson(req);
    const moves = parseMoves(body.moves);
    if (!moves) fail(400, "Mutări invalide.");

    const next = commitTurn(game, moves);
    if (typeof next === "string") fail(409, next);

    await updateRoom(room, next.phase === "over" ? finishGamePatch(room, next) : { game: next });
    if (next.phase === "over") await reportRound(room, next, room.rounds_played + 1);
    await notifyRoom(room.id, next.phase === "over" ? "game_over" : "moved");
    return { ok: true };
  });
}
