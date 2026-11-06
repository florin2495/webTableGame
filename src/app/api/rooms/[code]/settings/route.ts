import { isValidMatchTo } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, updateRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { matchTo } - host, lobby only.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const matchTo = Number(body.matchTo);
    if (!isValidMatchTo(matchTo)) fail(400, "Meciul poate fi până la 1, 3, 5 sau 7 puncte.");
    await updateRoom(room, { match_to: matchTo });
    await notifyRoom(room.id, "settings_changed");
    return { ok: true };
  });
}
