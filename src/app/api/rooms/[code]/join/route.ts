import { MAX_MEMBERS, NICKNAME_MAX } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, PLAYERS } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, listPlayers, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/join  { nickname, password? }
// In the lobby the newcomer takes a free seat if there is one. Otherwise (or while a game runs)
// they join as a spectator. At most MAX_MEMBERS people per room.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const members = await listPlayers(room.id);
    if (members.length >= MAX_MEMBERS) fail(409, `Camera e plină (2 jucători + ${MAX_MEMBERS - 2} spectatori).`);
    if (members.some((m) => m.nickname.toLowerCase() === nickname.toLowerCase())) {
      fail(409, "Nickname-ul e deja folosit în cameră.");
    }

    const taken = new Set(members.map((m) => m.seat));
    const freeSeat = room.status === "lobby" ? (([0, 1] as const).find((s) => !taken.has(s)) ?? null) : null;

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(PLAYERS)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), seat: freeSeat })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul sau locul a fost luat chiar acum. Mai încearcă.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "player_joined");
    return { code: room.code, playerId: data.id, token, seat: freeSeat };
  });
}
