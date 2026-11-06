@AGENTS.md

# webTableGame (Table / backgammon) - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webTableGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user. Target domain: `table.hailatat.icu` (listed in the hub
  `florin2495/hailataticu-hub`, `src/games.ts`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project `vgpcagpqbeiqplfidmwo`, same as Bingo)
One Supabase project hosts every hailatat.icu mini-game. **Every object of this game is prefixed
`backgammon_`** (lowercase: Postgres folds unquoted identifiers). Realtime topics: `backgammon-room:<uuid>`.
Migrations are run by hand in the Supabase SQL editor; this table is the source of truth.

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | **not yet** | `backgammon_rooms`, `backgammon_players` |

Rules for schema changes: new numbered file in `supabase/migrations/`, additive when possible, folded into
`supabase/schema.sql`. Code needing a migration is not pushed until the user ran it (verify by effect with the
service key from `.env.local`). Never print or commit the keys in `.env.local`.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with two players + two spectators (create, join, seat, start, roll, move,
  resign, next, lobby, leave, kick) against `npm run dev` (port 3010). Delete the test rooms afterwards.
