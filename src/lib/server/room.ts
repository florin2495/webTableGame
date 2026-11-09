import "server-only";
import { kickRemainingMs } from "@/lib/kick";
import { queuePosition } from "@/lib/queue";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import { isRoomExpired, minutesLabel, ROOM_IDLE_MINUTES, PLAYING_IDLE_MINUTES } from "@/lib/game";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, PLAYERS, ROOM_COLUMNS, ROOMS, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";
import { enforceExpiredKicks } from "./kick";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(ROOMS).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(ROOMS).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes idle rooms: lobby/finished after ROOM_IDLE_MINUTES, playing after PLAYING_IDLE_MINUTES. */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const shortCutoff = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const longCutoff = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const [a, b] = await Promise.all([
    db().from(ROOMS).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", shortCutoff),
    db().from(ROOMS).delete().eq("status", "playing").lt("last_activity_at", longCutoff),
  ]);
  if (a.error) console.error("cleanup failed", a.error);
  if (b.error) console.error("cleanup failed", b.error);
}

export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(ROOMS).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  // Pending kicks are enforced lazily (no timers on serverless): before the caller's membership is used.
  const room = await enforceExpiredKicks(await getRoomByCode(code));
  const { data, error } = await db()
    .from(PLAYERS)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(PLAYERS).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function requireSeated(player: PlayerRow): 0 | 1 {
  if (player.seat === null) fail(403, "Spectatorii doar privesc.");
  return player.seat;
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Jocul nu a început încă.",
      playing: "Jocul este în desfășurare.",
      finished: "Jocul s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(PLAYERS)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Clears every pending kick of the room (new game, back to the lobby, match abandoned). */
export async function clearPendingKicks(roomId: string): Promise<void> {
  const { error } = await db()
    .from(PLAYERS)
    .update({ kick_requested_at: null })
    .eq("room_id", roomId)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
}

/**
 * Updates the room only if nobody changed it since `room` was read (optimistic concurrency).
 * Bumps `version`. Fails with 409 when another request won the race.
 */
export async function updateRoom(room: RoomRow, patch: Partial<RoomRow>): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(ROOMS)
    .update({ ...patch, version: room.version + 1, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) fail(409, "Jocul s-a schimbat între timp. Mai încearcă o dată.");
}

const toPublic = (p: PlayerRow, now: number, spectators: PlayerRow[]): PublicPlayer => ({
  id: p.id,
  nickname: p.nickname,
  isHost: p.is_host,
  seat: p.seat,
  kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
  connected: isConnected(p.last_seen_at, now),
  queued: p.seat === null && p.queued_at !== null,
  queuePosition: p.seat === null ? queuePosition(spectators, p.id) : null,
});

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const players = await listPlayers(room.id);
  // Seated players first (white, black), then spectators in join order.
  const now = Date.now();
  const spectators = players.filter((p) => p.seat === null);
  const ordered = [...players].sort((a, b) => (a.seat ?? 9) - (b.seat ?? 9));
  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      matchTo: room.match_to,
      score: [room.score_white, room.score_black],
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      version: room.version,
    },
    players: ordered.map((p) => toPublic(p, now, spectators)),
    me: toPublic(me, now, spectators),
    game: room.game,
  };
}

/** The state the caller will see after `updateRoom(room, patch)`: returned by the action so no /state follows. */
export function stateAfter(room: RoomRow, patch: Partial<RoomRow>, me: PlayerRow): Promise<RoomState> {
  return buildState({ ...room, ...patch, version: room.version + 1 }, me);
}
