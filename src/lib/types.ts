import type { GameState, Seat } from "./game";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  /** 0 = white, 1 = black, null = spectator. */
  seat: Seat | null;
  /** Ms left of a pending host kick (10 s countdown, game in progress); null = no pending kick. */
  kickRemainingMs: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  /** Spectator waiting for a seat ("Intră la runda următoare"). Always false for seated players. */
  queued: boolean;
  /** 1-based place in the queue, null when not queued. */
  queuePosition: number | null;
}

/** What GET /api/rooms/[code]/state returns. Backgammon has no hidden information, so everyone sees everything. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    matchTo: number;
    /** [white, black] */
    score: [number, number];
    hasPassword: boolean;
    hostPlayerId: string | null;
    version: number;
  };
  players: PublicPlayer[];
  me: PublicPlayer;
  game: GameState | null;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  status: RoomStatus;
  matchTo: number;
  hasPassword: boolean;
  seated: number;
  spectators: number;
}

export interface Session {
  playerId: string;
  token: string;
}
