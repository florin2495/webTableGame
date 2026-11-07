import "server-only";
import { notifyRoom } from "./broadcast";
import { db, PLAYERS, ROOMS, type RoomRow } from "./db";
import { clearPendingKicks, listPlayers } from "./room";

/**
 * Removes a member from a room (used by both "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to a seated player if any, else the next member
 *  - a seated player removed while a match runs: the match is abandoned and the room
 *    goes back to the lobby, so a spectator can take the free seat
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  const all = await listPlayers(room.id);
  const leaving = all.find((p) => p.id === playerId);
  const remaining = all.filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from(ROOMS).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  const now = new Date().toISOString();
  const newHostId =
    room.host_player_id === playerId
      ? (remaining.find((p) => p.seat !== null) ?? remaining[0]).id
      : room.host_player_id;
  const update: Record<string, unknown> = { host_player_id: newHostId, updated_at: now, last_activity_at: now };

  if (leaving?.seat !== null && leaving?.seat !== undefined && room.status !== "lobby") {
    update.status = "lobby";
    update.game = null;
    update.score_white = 0;
    update.score_black = 0;
    update.version = room.version + 1;
  }

  // Update the room first so the host never points at a deleted player.
  const { error: roomError } = await db().from(ROOMS).update(update).eq("id", room.id);
  if (roomError) throw roomError;

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(PLAYERS).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from(PLAYERS).delete().eq("id", playerId);
  if (deleteError) throw deleteError;
  // Match abandoned -> back to the lobby: no game left to be kicked out of.
  if (update.status === "lobby") await clearPendingKicks(room.id);

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
