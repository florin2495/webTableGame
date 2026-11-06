import { rollTurn } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { randomDie } from "@/lib/server/crypto";
import { fail, handle } from "@/lib/server/http";
import { requireMember, requireSeated, requireStatus, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/roll - the player on turn rolls. Dice are rolled on the server.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/roll">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");
    const seat = requireSeated(player);
    const game = room.game;
    if (!game || game.turn !== seat) fail(409, "Nu e rândul tău.");
    if (game.phase !== "roll") fail(409, "Ai dat deja cu zarul.");

    const next = rollTurn(game, randomDie);
    await updateRoom(room, { game: next });
    await notifyRoom(room.id, "rolled");
    return { ok: true };
  });
}
