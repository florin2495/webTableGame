-- Table (backgammon) multiplayer - Supabase schema
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Shared Supabase project for all hailatat.icu mini-games: every object of this game is prefixed
-- "backgammon_" (lowercase - Postgres folds unquoted names), so nothing collides with other games.
-- Re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- backgammon_rooms: one row per room. The whole game position lives in `game` (jsonb);
-- `version` is bumped on every game change, and every update is conditional on it
-- (optimistic concurrency), so two concurrent moves can never both apply.
-- ---------------------------------------------------------------------------
create table if not exists public.backgammon_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  match_to         smallint not null default 3 check (match_to in (1, 3, 5, 7)),
  score_white      smallint not null default 0 check (score_white >= 0),
  score_black      smallint not null default 0 check (score_black >= 0),
  game             jsonb,                                  -- null in the lobby
  version          integer not null default 0,
  host_player_id   uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists backgammon_rooms_status_activity_idx on public.backgammon_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- backgammon_players: members of a room. seat 0 = white, 1 = black, null = spectator.
-- Identity = random token kept by the browser; only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.backgammon_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.backgammon_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  token_hash text not null unique,
  is_host    boolean not null default false,
  seat       smallint check (seat in (0, 1)),
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz                          -- pending host kick during a game (null = none)
);
-- (databases created before the pending-kick feature: supabase/migrations/001_pending_kick.sql)
create unique index if not exists backgammon_players_room_nickname_uq on public.backgammon_players (room_id, lower(nickname));
create unique index if not exists backgammon_players_room_seat_uq on public.backgammon_players (room_id, seat) where seat is not null;
create index if not exists backgammon_players_room_idx on public.backgammon_players (room_id);

do $$ begin
  alter table public.backgammon_rooms
    add constraint backgammon_rooms_host_fk foreign key (host_player_id) references public.backgammon_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (Next.js Route Handlers, bypasses RLS) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.backgammon_rooms   enable row level security;
alter table public.backgammon_players enable row level security;

revoke all on public.backgammon_rooms, public.backgammon_players from anon, authenticated;
