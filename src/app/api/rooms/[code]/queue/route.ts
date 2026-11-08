import { notifyRoom } from "@/lib/server/broadcast";
import { db, PLAYERS } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { promoteQueued } from "@/lib/server/queue";
import { requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - a spectator toggles "Intră la runda următoare". Queued spectators take the
// seats that free up (stop match / player left), in queue order. In the lobby a free seat is taken right away.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.seat !== null) fail(409, "Ești deja la masă.");

    const queued = player.queued_at === null;
    const { error } = await db()
      .from(PLAYERS)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    if (queued && room.status === "lobby") await promoteQueued(room.id);

    await touchRoom(room.id);
    await notifyRoom(room.id, "queue_changed");
    return { ok: true, queued };
  });
}
