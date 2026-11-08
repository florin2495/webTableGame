-- Spectator queue ("Intră la runda următoare") and a per-room round counter for the leaderboard.
--  backgammon_players.queued_at: set when a spectator asked to play next (null = not queued); queue order = queued_at.
--  backgammon_rooms.rounds_played: bumped once per finished game; used as round_no in hub_leaderboard_rounds
--    (game.gameNo restarts at 1 with every match, so it cannot identify a round inside a room).
-- Additive and idempotent. Run once in the Supabase SQL editor.
alter table public.backgammon_players add column if not exists queued_at timestamptz;
alter table public.backgammon_rooms add column if not exists rounds_played integer not null default 0;
