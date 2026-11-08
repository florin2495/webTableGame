import { MAX_SPECTATORS, NICKNAME_MAX } from "@/lib/game";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, PLAYERS } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { enforceExpiredKicks } from "@/lib/server/kick";
import { getRoomByCode, touchRoom } from "@/lib/server/room";

interface MemberRow {
  id: string;
  nickname: string;
  seat: 0 | 1 | null;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, deviceId? }
// A nickname that already has a place in the room (seat or spectator) reclaims it (same player id, same seat,
// new token) when the request comes from the same device or the place has been disconnected for 45 s - also
// mid-game. Otherwise: in the lobby the newcomer takes a free seat if there is one; else (or while a game runs)
// they join as a spectator. At most MAX_SPECTATORS spectators per room.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    // Expired kicks first, so a kicked player cannot dodge the removal by reclaiming the seat.
    const room = await enforceExpiredKicks(await getRoomByCode(code));

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: rows, error: membersError } = await db()
      .from(PLAYERS)
      .select("id, nickname, seat, token_hash, device_hash, last_seen_at")
      .eq("room_id", room.id);
    if (membersError) throw membersError;
    const members = (rows ?? []) as MemberRow[];

    const existing = members.find((m) => m.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      const { data, error } = await db()
        .from(PLAYERS)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token, seat: existing.seat };
    }

    const taken = new Set(members.map((m) => m.seat));
    const freeSeat = room.status === "lobby" ? (([0, 1] as const).find((s) => !taken.has(s)) ?? null) : null;
    if (freeSeat === null && members.filter((m) => m.seat === null).length >= MAX_SPECTATORS) {
      fail(409, `Camera e plină: sunt deja ${MAX_SPECTATORS} spectatori.`);
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(PLAYERS)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: deviceHash, seat: freeSeat })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul sau locul a fost luat chiar acum. Mai încearcă.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "player_joined");
    return { code: room.code, playerId: data.id, token, seat: freeSeat };
  });
}
