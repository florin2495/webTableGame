import "server-only";
import { pickPromotions } from "@/lib/queue";
import { db, PLAYERS } from "./db";
import { listPlayers } from "./room";

/**
 * Seats queued spectators on free seats, in queue order (call whenever seats may have been freed in the lobby:
 * the match was stopped, a player left or stood up). Returns true when somebody was seated.
 */
export async function promoteQueued(roomId: string): Promise<boolean> {
  const players = await listPlayers(roomId);
  const taken = new Set(players.map((p) => p.seat));
  const free = ([0, 1] as const).filter((s) => !taken.has(s));
  const picks = pickPromotions(
    free,
    players.filter((p) => p.seat === null),
  );
  let seated = false;
  for (const { id, seat } of picks) {
    const { data, error } = await db()
      .from(PLAYERS)
      .update({ seat, queued_at: null })
      .eq("id", id)
      .is("seat", null)
      .select("id");
    // A unique violation means somebody took the seat meanwhile: leave the rest queued.
    if (error) {
      if (error.code === "23505") continue;
      throw error;
    }
    if (data && data.length > 0) seated = true;
  }
  return seated;
}
