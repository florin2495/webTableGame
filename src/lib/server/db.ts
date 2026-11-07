import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState, Seat } from "@/lib/game";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export const ROOMS = "backgammon_rooms";
export const PLAYERS = "backgammon_players";

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  status: "lobby" | "playing" | "finished";
  match_to: number;
  score_white: number;
  score_black: number;
  game: GameState | null;
  version: number;
  host_player_id: string | null;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, status, match_to, score_white, score_black, game, version, host_player_id, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  seat: Seat | null;
  joined_at: string;
  /** Pending host kick during a running game (null = none). */
  kick_requested_at: string | null;
}

export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, seat, joined_at, kick_requested_at";
