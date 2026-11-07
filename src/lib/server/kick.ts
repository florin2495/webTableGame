import "server-only";
import { isKickExpired, kickExpiryCutoff } from "@/lib/kick";
import { db, PLAYERS, ROOM_COLUMNS, ROOMS, type RoomRow } from "./db";
import { fail } from "./http";
import { removePlayer } from "./membership";

/**
 * Lazy enforcement of pending kicks: removes every player whose kick expired, exactly like an immediate kick
 * (`removePlayer`). The removal is claimed atomically (conditional update on the value that was read), so
 * concurrent requests never remove the same player twice. Returns the room as it is afterwards.
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<RoomRow> {
  const { data, error } = await db()
    .from(PLAYERS)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .lt("kick_requested_at", kickExpiryCutoff(Date.now()));
  if (error) throw error;
  const expired = ((data ?? []) as { id: string; kick_requested_at: string }[]).filter((p) =>
    isKickExpired(p.kick_requested_at, Date.now()),
  );
  if (expired.length === 0) return room;

  let current = room;
  for (const p of expired) {
    const { data: claimed, error: claimError } = await db()
      .from(PLAYERS)
      .update({ kick_requested_at: null })
      .eq("id", p.id)
      .eq("kick_requested_at", p.kick_requested_at)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) continue; // another request claimed it
    const { roomClosed } = await removePlayer(current, p.id, "player_kicked");
    if (roomClosed) fail(404, "Camera nu mai există.");
    // removePlayer changes the room (host hand-over, match abandoned): re-read before continuing.
    const { data: fresh, error: roomError } = await db().from(ROOMS).select(ROOM_COLUMNS).eq("id", room.id).maybeSingle();
    if (roomError) throw roomError;
    if (!fresh) fail(404, "Camera nu mai există.");
    current = fresh as RoomRow;
  }
  return current;
}
