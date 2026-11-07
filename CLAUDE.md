@AGENTS.md

# webTableGame (Table / backgammon) - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webTableGame`, private). Never the work account.
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

Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (at most every 10 s);
re-joining with an existing nickname reclaims that place (same player id and seat, new token) from the same device
(`device_hash`) or once it has been unseen for 45 s, also mid-match. `/state` exposes only a derived `connected` flag.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `backgammon`);
this game must not be deployed before that table exists.

Rules for schema changes: new numbered file in `supabase/migrations/`, additive when possible, folded into
`supabase/schema.sql`. Code needing a migration is not pushed until the user ran it (verify by effect with the
service key from `.env.local`). Never print or commit the keys in `.env.local`.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with two players + two spectators (create, join, seat, start, roll, move,
  resign, next, lobby, leave, kick) against `npm run dev` (port 3020). Delete the test rooms afterwards.
