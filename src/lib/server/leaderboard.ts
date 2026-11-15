import "server-only";
import type { GameState } from "@/lib/game";
import { db, PLAYERS, type RoomRow } from "./db";

const GAME_SLUG = "backgammon";

/** Leaderboard identity: the nickname, trimmed and lowercased (no accounts: same nickname = same person). */
export const playerKey = (nickname: string) => nickname.trim().toLowerCase();

/** Rooms created by the e2e tests (scripts/e2e.mjs, tests/ui) never reach the shared leaderboard. */
export function isTestRoom(roomName: string): boolean {
  return roomName.startsWith("e2e-test-");
}

/**
 * Reports a finished game to the hub-owned `hub_leaderboard` (+1 games for both players, +1 wins for the winner).
 * Idempotent: the round is claimed first in `hub_leaderboard_rounds` (PK game, room_code, round_no); a duplicate
 * means it was already counted. Best effort - it never throws, a leaderboard problem must not break the game.
 * `roundNo` is the room's rounds_played counter (game.gameNo restarts with every match).
 * Test rooms (isTestRoom) are skipped.
 */
export async function reportRound(room: RoomRow, game: GameState, roundNo: number): Promise<void> {
  try {
    if (game.winner === null || isTestRoom(room.name)) return;
    const { data: members, error: membersError } = await db()
      .from(PLAYERS)
      .select("nickname, seat")
      .eq("room_id", room.id)
      .in("seat", [0, 1]);
    if (membersError) throw membersError;
    if (!members || members.length === 0) return;

    const claim = await db()
      .from("hub_leaderboard_rounds")
      .insert({ game: GAME_SLUG, room_code: room.code, round_no: roundNo });
    if (claim.error) {
      if (claim.error.code === "23505") return; // already counted
      throw claim.error;
    }

    for (const m of members as { nickname: string; seat: 0 | 1 }[]) {
      const key = playerKey(m.nickname);
      const won = m.seat === game.winner ? 1 : 0;
      const { data: row, error: readError } = await db()
        .from("hub_leaderboard")
        .select("wins, games")
        .eq("game", GAME_SLUG)
        .eq("player_key", key)
        .maybeSingle();
      if (readError) throw readError;
      const { error } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME_SLUG,
            player_key: key,
            display_name: m.nickname.trim(),
            wins: (row?.wins ?? 0) + won,
            games: (row?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (error) throw error;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
