import "server-only";
import type { GameState } from "@/lib/game";
import type { RoomRow } from "./db";

/** Room update for a game that just ended: add the points, status -> finished. */
export function finishGamePatch(room: RoomRow, game: GameState): Partial<RoomRow> {
  const patch: Partial<RoomRow> = { status: "finished", game, rounds_played: room.rounds_played + 1 };
  if (game.winner === 0) patch.score_white = room.score_white + game.points;
  if (game.winner === 1) patch.score_black = room.score_black + game.points;
  return patch;
}

/** 0 / 1 once a player reached the match length, otherwise null. */
export function matchWinner(room: Pick<RoomRow, "score_white" | "score_black" | "match_to">): 0 | 1 | null {
  if (room.score_white >= room.match_to) return 0;
  if (room.score_black >= room.match_to) return 1;
  return null;
}
