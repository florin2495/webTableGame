# Table (backgammon) - hailatat.icu

Table în doi, pe telefon, cu prietenii. Încă doi pot intra în cameră ca spectatori, inclusiv în timpul jocului.
Același stil și aceeași arhitectură ca Bingo (`florin2495/webBingoGame`): Next.js pe Vercel, Supabase
(Postgres + Realtime Broadcast), fără conturi.

## Funcții
- Camere cu cod de 6 caractere, parolă opțională, listă de camere deschise (Joacă / Privește).
- Max 4 oameni: Alb, Negru, 2 spectatori. În lobby oricine poate lua un loc liber sau se poate ridica.
- Meci până la 1 / 3 / 5 / 7 puncte. Câștig simplu = 1 punct, marț = 2.
- Reguli complete: lovire, bară, intrare, dubla de 4 ori, obligația de a folosi cât mai multe zaruri
  (și zarul mare când merge doar unul), scoaterea pieselor. Zarurile se dau pe server.
- Tura se joacă local (cu Anulează) și se trimite întreagă la „Confirmă”. Serverul o validează din nou.
- Cedare, joc următor, înapoi în lobby, kick, ieșire, închidere automată la inactivitate.

## Setup
1. Supabase (proiectul comun al jocurilor): rulează `supabase/schema.sql` în SQL Editor.
   Toate tabelele au prefixul `backgammon_`.
2. `.env.local` după `.env.example` (aceleași chei ca la Bingo).
3. `npm install && npm run dev` → http://localhost:3020

## Vercel
Importă repo-ul, adaugă cele 3 variabile din `.env.example`, apoi domeniul `backgammon.hailatat.icu`
(Settings → Domains → Add Existing).

## Arhitectură
- `src/lib/game.ts` - regulile (pure, testate în `game.test.ts`), folosite și de client, și de server.
- `src/lib/server/*` - acces DB (service key), tokenuri, broadcast, concurență optimistă pe `version`.
- `src/app/api/rooms/**` - API (create, join, state, seat, settings, start, roll, move, resign, next, lobby, leave, kick).
- `src/components/*` - UI; tabla e un SVG (`Board.tsx`).
