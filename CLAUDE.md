@AGENTS.md

# webTableGame (Table / backgammon) - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webTableGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user. Served at `games.hailatat.icu/backgammon` (`basePath`; the hub proxies it to `web-table-game.vercel.app`, listed in the hub
  `florin2495/hailataticu-hub`, `src/games.ts`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".
- Functions run in `fra1` (Frankfurt, `vercel.json` `{ "regions": ["fra1"] }`), next to the Supabase DB. Never remove it: the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic (1-2 s per request instead of ~0.3 s).

## Database (shared Supabase project `vgpcagpqbeiqplfidmwo`, same as Bingo)
One Supabase project hosts every hailatat.icu mini-game. **Every object of this game is prefixed
`backgammon_`** (lowercase: Postgres folds unquoted identifiers). Realtime topics: `backgammon-room:<uuid>`.
Migrations are run by hand in the Supabase SQL editor; this table is the source of truth.

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified) | `backgammon_rooms`, `backgammon_players` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `backgammon_players.kick_requested_at timestamptz` (kick during a game waits 10 s, can be ignored). Code needs it: do not push before it is run. |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `backgammon_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Code needs it: do not push before it is run. |
| `supabase/migrations/003_queue_leaderboard.sql` | yes, verified 2026-11-14 by effect: production E2E exercises its columns (and the service role reads `queued_at`, `rounds_played`, `hub_leaderboard_rounds` = 200) | `backgammon_players.queued_at` (spectator queue), `backgammon_rooms.rounds_played` (leaderboard round_no). Leaderboard reporting also needs the hub's `002_hub_leaderboard.sql` (present). |

Seat order / spectators: `POST /reorder` (host, lobby only; `order` = the seated players, first = White) and
`POST /queue` (spectator toggle, "Intră la runda următoare"; queued spectators take seats freed in the lobby, in
queue order - see `src/lib/server/queue.ts`). Max 16 spectators (`MAX_SPECTATORS`).
Leaderboard (`src/lib/server/leaderboard.ts`): each finished game (move or resign) is one round, `round_no` =
`backgammon_rooms.rounds_played`; best effort, never breaks the game. Rooms named `e2e-test-…` (`isTestRoom`) are never
reported, so E2E runs do not pollute the hub leaderboard.

Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
re-joining with an existing nickname reclaims that place (same player id and seat, new token) from the same device
(`device_hash`) or once it has been unseen for 301 s (`DISCONNECT_MS`, also the "deconectat" badge), also mid-match. `/state` exposes only a derived `connected` flag.

## Abandoned rooms (600 s)
`GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (600 s, `game.ts`)
and with no member `last_seen_at` within 600 s (spectators are player rows, `seat` null) is deleted (players cascade).
Open room pages keep both fresh (`/state` polls every 60 s, `POLL_MS` in `RoomClient.tsx`; a request touches
`last_seen_at` at most every 10 s and `last_activity_at` at most every 20 s), so only rooms nobody has open disappear.
The 10/30-minute idle expiry stays too. Unit-tested with the DB mocked in `src/lib/server/room.test.ts`.
A missing room shows a neutral "Camera nu mai există (a fost închisă după inactivitate)." (`GONE`).

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `backgammon`);
this game must not be deployed before that table exists.

Rules for schema changes: new numbered file in `supabase/migrations/`, additive when possible, folded into
`supabase/schema.sql`. Code needing a migration is not pushed until the user ran it (verify by effect with the
service key from `.env.local`). Never print or commit the keys in `.env.local`.

## Testing (GitHub Actions, manual only)
Tests run only in GitHub Actions on the free tier (public repo: free, unlimited minutes on standard runners), with
`runs-on: ubuntu-latest` only: never larger, macOS, Windows or any billed runner, and never locally (see
`D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch` only (no automatic trigger): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").

| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest, `vitest.config.ts` = the `@/` alias only: `src/lib/game.test.ts`, `kick.test.ts`, `queue.test.ts`, `reconnect.test.ts` (pure logic), `src/lib/server/room.test.ts` (`cleanupAbandonedRooms`, Supabase client mocked), `leaderboard.test.ts` (`isTestRoom`); no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/backgammon`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does (`scripts/e2e.mjs`, Node built-ins only): page / `_next` assets / version / manifest / icons /
  `room/ABCDEF` over HTTP and that `web-table-game.vercel.app/backgammon` serves the same build; then the real API
  (production DB) with 2 players + 2 spectators: create (password), bad match length, wrong password, join (seat /
  spectator), busy nickname, public list, settings, seats, queue (lobby: takes the free seat at once), rejoin (player
  and spectator, same device, old token dead), start, out-of-turn / spectator / forged / malformed / illegal moves,
  a full game 1 played with legal moves (a copy of the rules picks them) with a mid-game rejoin and all 4 views
  compared, score, game 2 + queue order mid-game, resign (marț), match over, lobby, host reorder (swap colours),
  kick with "Ignoră", spectator kick, pending kick enforced (queued spectator takes the freed seat), leave.
  Rooms are `e2e-test-…` and deleted at the end; it never calls `/api/feedback`. Finished games are not reported to
  the hub leaderboard (`isTestRoom`).
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 60 s, so this checks Realtime). Dice are random: each turn reads `/state` with the
  token the page stored and picks a legal move with `src/lib/game.ts`, then taps checker + destination +
  "Confirmă" on the board (contexts use `reducedMotion: "reduce"`, so no slide hides the tap targets):
  - `game.e2e.ts` (both projects): two browser contexts create a password room (match to 1), join by link, start,
    6 turns live, resign = game and match over on both screens, back to the lobby, leave.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-game = spectator (no roll / confirm / resign
    / tap targets), players see them, they see every turn, queue (seen by the players), see the end, and when the
    guest leaves the lobby the queue seats them.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / lobby / game, buttons >= 40 px high, board tap
    targets >= 24 x 100 px (the game card has no side padding on phones, so a point is ~24.5 px wide on a 390 px
    phone), 2 turns played with touch taps, leave mid-match.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- Test ids used by `tests/ui` (renaming or removing one breaks them): `home-submit`, `tab-create` / `tab-join`
  (`Home.tsx`); `join-submit`, `leave`, `room-code`, `room-status` (`data-status`) (`RoomClient.tsx`); `lobby`,
  `seat-0` / `seat-1`, `start-match` (`Lobby.tsx`); `member-list` with `li[data-testid=member]` (`data-nickname`,
  `data-seat` 0/1/"spectator", `data-queued`), `queue-toggle` (`MemberList.tsx`); `play` (`data-version`,
  `data-status`, `data-turn`, `data-phase`, `data-game-no`), `roll`, `undo-turn`, `confirm-turn`, `resign`,
  `spectator-banner`, `game-over`, `next-game`, `back-to-lobby` (`Game.tsx`); board tap targets `spot-<0..23>`
  (board index, see `indexOf` in `game.ts`), `spot-bar`, `spot-off` (`Board.tsx`, only rendered when the player can
  move).
