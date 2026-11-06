import { connection } from "next/server";
import { isValidMatchTo, MATCH_DEFAULT, NICKNAME_MAX } from "@/lib/game";
import { hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db, PLAYERS, ROOMS } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupExpiredRooms } from "@/lib/server/room";
import type { RoomListItem } from "@/lib/types";

// GET /api/rooms - public list of open rooms (lobby to join, playing to watch).
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await cleanupExpiredRooms();
    const { data, error } = await db()
      .from(ROOMS)
      .select("code, name, status, match_to, password_hash, last_activity_at, backgammon_players!backgammon_players_room_id_fkey(seat)")
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? []).map((r) => {
      const members = (r as unknown as Record<string, { seat: number | null }[]>)[PLAYERS] ?? [];
      return {
        code: r.code,
        name: r.name,
        status: r.status,
        matchTo: r.match_to,
        hasPassword: r.password_hash !== null,
        seated: members.filter((m) => m.seat !== null).length,
        spectators: members.filter((m) => m.seat === null).length,
      };
    });
    return { rooms };
  });
}

// POST /api/rooms - create a room; the creator takes the white seat and is host.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const matchTo = body.matchTo === undefined ? MATCH_DEFAULT : Number(body.matchTo);
    if (!isValidMatchTo(matchTo)) fail(400, "Meciul poate fi până la 1, 3, 5 sau 7 puncte.");

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from(ROOMS)
        .insert({ code: newRoomCode(), name, password_hash: passwordHash, match_to: matchTo })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from(PLAYERS)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), is_host: true, seat: 0 })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db().from(ROOMS).update({ host_player_id: player.id }).eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
