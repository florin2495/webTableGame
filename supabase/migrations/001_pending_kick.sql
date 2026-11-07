-- Pending kick: a host kick during a running game starts a 10 s countdown (null = no pending kick).
alter table public.backgammon_players add column if not exists kick_requested_at timestamptz;
