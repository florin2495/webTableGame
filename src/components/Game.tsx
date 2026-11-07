"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_AUTO_CONFIRM, PREF_AUTO_ROLL, PREF_SOUND, readPref, useBoolPref } from "@/lib/client/prefs";
import { playChecker, playDice, playWin, playYourTurn } from "@/lib/client/sound";
import {
  applyMove,
  BAR,
  expandDice,
  indexOf,
  moveLabel,
  pipCount,
  playTurn,
  posOf,
  seatName,
  sumMoves,
  type Board as BoardData,
  type GameState,
  type Move,
  type Seat,
} from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { Board, STEP_MS, type Playback, type Spot } from "./Board";
import { CheckerDot, Die } from "./Dice";
import { MemberList, OfflineBadge } from "./MemberList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  game: GameState;
  token: string;
  refresh: () => Promise<void>;
}

const soundOn = () => readPref(PREF_SOUND) !== "0";

/** After the last move the turn confirms itself unless the player presses "Anulează". */
const AUTO_CONFIRM_MS = 3000;

const sameBoard = (a: BoardData, b: BoardData) =>
  a.points.every((n, i) => n === b.points[i]) && a.bar[0] === b.bar[0] && a.bar[1] === b.bar[1] && a.off[0] === b.off[0] && a.off[1] === b.off[1];

/**
 * The checker slides to show for a state change: the last turn replayed from the board we had
 * before. Only when the replay really ends on the new board (otherwise we missed an update: snap).
 * Nothing for my own move - I already saw it slide while composing it.
 */
function derivePlayback(prev: GameState | null, game: GameState, version: number, mySeat: Seat | null): Playback | null {
  const last = game.lastTurn;
  if (!prev || !last || last.passed || last.resigned || last.moves.length === 0) return null;
  if (prev.gameNo !== game.gameNo || last.seat === mySeat || sameBoard(prev.board, game.board)) return null;
  let b = prev.board;
  for (const m of last.moves) b = applyMove(b, last.seat, m).board;
  if (!sameBoard(b, game.board)) return null;
  return { id: `v${version}`, seat: last.seat, start: prev.board, moves: last.moves };
}

export function Game({ state, game, token, refresh }: Props) {
  const { room, me, players } = state;
  const nick = (s: Seat) => players.find((p) => p.seat === s)?.nickname ?? seatName(s);
  useGameSounds(state, game);

  // Derived during render (React's "adjust state on prop change" pattern): the move animation to show.
  const [seen, setSeen] = useState<{ version: number; game: GameState | null }>({ version: room.version, game: null });
  const [playback, setPlayback] = useState<Playback | null>(null);
  if (seen.version !== room.version) {
    setSeen({ version: room.version, game });
    setPlayback(derivePlayback(seen.game, game, room.version, me.seat));
  } else if (seen.game === null) {
    setSeen({ version: room.version, game });
  }

  return (
    <div className="flex flex-col gap-3">
      <ScoreBar state={state} game={game} nick={nick} />
      {/* key: a new server state (new version) resets the half-played local turn */}
      <Play key={room.version} state={state} game={game} token={token} refresh={refresh} nick={nick} remotePlayback={playback} />
      {room.status === "finished" && <GameOver state={state} game={game} token={token} refresh={refresh} nick={nick} />}
      {me.seat === null && (
        <p className="rounded-lg bg-sky-100 px-3 py-2 text-center text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          👁 Ești spectator. Vezi tabla din partea lui {nick(0)} (Alb).
        </p>
      )}
      <Card>
        <h2 className="mb-1 font-bold">În cameră</h2>
        <MemberList state={state} token={token} refresh={refresh} />
      </Card>
    </div>
  );
}

function ScoreBar({ state, game, nick }: { state: RoomState; game: GameState; nick: (s: Seat) => string }) {
  const { room, me } = state;
  return (
    <div className="grid grid-cols-2 gap-2">
      {([0, 1] as Seat[]).map((s) => {
        const onTurn = room.status === "playing" && game.turn === s;
        return (
          <div
            key={s}
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
              onTurn ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <CheckerDot seat={s} size={22} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {nick(s)}
                  {me.seat === s && <span className="font-normal text-zinc-500"> (tu)</span>}
                </span>
                <OfflineBadge connected={state.players.find((p) => p.seat === s)?.connected} />
                <span className="block text-[11px] text-zinc-500">
                  {pipCount(game.board, s)} pips · {game.board.off[s]}/15 scoase
                </span>
              </span>
            </span>
            <span className="text-right">
              <span className="block text-2xl font-black tabular-nums leading-none">{room.score[s]}</span>
              <span className="block text-[10px] text-zinc-500">din {room.matchTo}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Play({ state, game, token, refresh, nick, remotePlayback }: Props & { nick: (s: Seat) => string; remotePlayback: Playback | null }) {
  const { room, me } = state;
  const seat = me.seat;
  const view: Seat = seat ?? 0;
  const myTurn = room.status === "playing" && seat !== null && game.turn === seat;
  const canMove = myTurn && game.phase === "move" && game.dice !== null;

  // Each tap is a "batch": one die, or several dice for a checker moved by the sum. Undo removes a batch.
  const [batches, setBatches] = useState<Move[][]>([]);
  const moves = useMemo(() => batches.flat(), [batches]);
  const [localPlay, setLocalPlay] = useState<Playback | null>(null);
  const playId = useRef(0);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const progress = useMemo(() => {
    if (!canMove || seat === null || !game.dice) return null;
    const p = playTurn(game.board, seat, game.dice, moves);
    return typeof p === "string" ? null : p;
  }, [canMove, seat, game.board, game.dice, moves]);

  const shownBoard = progress?.board ?? game.board;
  const spotOf = (from: number): Spot => (from === BAR ? "bar" : indexOf(seat ?? 0, from));
  const destOf = (m: Move): Spot => {
    const to = m.from - m.die;
    return to <= 0 ? "off" : indexOf(seat ?? 0, to);
  };

  const next = progress?.next ?? [];
  const selectable = new Set<Spot>(next.map((m) => spotOf(m.from)));
  // Destination -> the smallest die that gets the selected checker there.
  const destinations = new Map<Spot, Move[]>();
  const sumDestinations = new Set<Spot>();
  if (selected !== null && seat !== null && game.dice) {
    const single = new Map<Spot, Move>();
    for (const m of next) {
      if (spotOf(m.from) !== selected) continue;
      const d = destOf(m);
      const cur = single.get(d);
      if (!cur || m.die < cur.die) single.set(d, m);
    }
    for (const [d, m] of single) destinations.set(d, [m]);
    // Several dice with the same checker; a point a single die reaches keeps the single move.
    const from = typeof selected === "number" ? posOf(seat, selected) : BAR;
    for (const sm of sumMoves(game.board, seat, game.dice, moves, from)) {
      const d: Spot = sm.dest <= 0 ? "off" : indexOf(seat, sm.dest);
      if (destinations.has(d)) continue;
      destinations.set(d, sm.moves);
      sumDestinations.add(d);
    }
  }

  function onSpot(spot: Spot) {
    if (busy) return;
    const batch = selected !== null ? destinations.get(spot) : undefined;
    if (batch && seat !== null) {
      setBatches([...batches, batch]);
      setLocalPlay({ id: `l${++playId.current}`, seat, start: shownBoard, moves: batch });
      setSelected(null);
      if (soundOn()) playChecker();
      return;
    }
    setSelected(selectable.has(spot) && spot !== selected ? spot : null);
  }

  async function send(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/${path}`, { token, body });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const [autoRoll] = useBoolPref(PREF_AUTO_ROLL, false);
  const [autoConfirm] = useBoolPref(PREF_AUTO_CONFIRM, false);

  // Auto-roll: once per server state (Play is keyed by version), after the opponent's slide finished.
  // After a failed request the automation stops and the manual buttons take over (no retry loop).
  const needsRoll = myTurn && game.phase === "roll" && autoRoll && !error;
  const rollDelay = 500 + (remotePlayback?.moves.length ?? 0) * STEP_MS;
  useEffect(() => {
    if (!needsRoll || busy) return;
    const t = window.setTimeout(() => {
      if (soundOn()) playDice();
      void send("roll");
    }, rollDelay);
    return () => window.clearTimeout(t);
    // `send` is recreated every render; the timer only needs the values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRoll, busy, rollDelay]);

  // Auto-confirm: every die used -> confirm after AUTO_CONFIRM_MS, or right after the last slide when the
  // "confirm immediately" setting is on. "Anulează" changes `moves`, which cancels the timer.
  const doneKey = progress?.done && moves.length > 0 && !error ? JSON.stringify(moves) : null;
  const lastSlideMs = (batches.at(-1)?.length ?? 0) * STEP_MS + 150;
  const confirmDelay = autoConfirm ? lastSlideMs : AUTO_CONFIRM_MS;
  const [countdown, setCountdown] = useState<{ key: string; left: number } | null>(null);
  useEffect(() => {
    if (!doneKey || busy) return;
    const started = Date.now();
    const tick = () => setCountdown({ key: doneKey, left: Math.max(0, Math.ceil((confirmDelay - (Date.now() - started)) / 1000)) });
    const first = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 250);
    const fire = window.setTimeout(() => void send("move", { moves: JSON.parse(doneKey) as Move[] }), confirmDelay);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearTimeout(fire);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, busy, confirmDelay]);
  const secondsLeft = !autoConfirm && countdown && countdown.key === doneKey && !busy ? countdown.left : null;

  // Last turn highlight + caption (only once the current player has not started moving).
  const last = game.lastTurn;
  const recent = new Set<number>();
  if (last && moves.length === 0) {
    for (const m of last.moves) {
      if (m.from !== BAR) recent.add(indexOf(last.seat, m.from));
      const to = m.from - m.die;
      if (to > 0) recent.add(indexOf(last.seat, to));
    }
  }

  const remaining = progress?.remaining ?? (game.dice ? expandDice(game.dice) : []);
  const allDice = game.dice ? expandDice(game.dice) : [];
  const isDouble = allDice.length === 4;
  const usedCount = allDice.length - remaining.length;

  return (
    <Card className="p-2 sm:p-3">
      <Board
        board={shownBoard}
        view={view}
        selectable={canMove ? selectable : undefined}
        selected={selected}
        destinations={new Set([...destinations.keys()].filter((d) => !sumDestinations.has(d)))}
        sumDestinations={sumDestinations}
        playback={localPlay ?? remotePlayback}
        recent={recent}
        onSpot={canMove ? onSpot : undefined}
      />

      <div className="mt-3 flex flex-col items-center gap-3">
        {game.dice && room.status === "playing" && (
          <div className="flex items-center gap-2">
            <CheckerDot seat={game.turn} size={20} />
            {isDouble
              ? allDice.map((d, i) => <Die key={i} value={d} used={i < usedCount} size={36} dark={game.turn === 1} />)
              : game.dice.map((d, i) => (
                  <Die key={i} value={d} used={!remaining.includes(d)} size={44} dark={game.turn === 1} />
                ))}
          </div>
        )}

        <TurnCaption state={state} game={game} nick={nick} myTurn={myTurn} progressDone={progress?.done ?? false} />

        {secondsLeft !== null && (
          <p role="status" className="text-center text-sm font-semibold text-amber-700 dark:text-amber-400">
            Se confirmă automat în {secondsLeft} s… Apasă „Anulează” ca să schimbi.
          </p>
        )}

        {needsRoll && (
          <p className="text-center text-xs text-zinc-500">🎲 Zarurile se aruncă automat…</p>
        )}

        {myTurn && game.phase === "roll" && !needsRoll && (
          <Button className="w-full max-w-xs text-lg" onClick={() => void send("roll").then(() => soundOn() && playDice())} disabled={busy}>
            🎲 Aruncă zarurile
          </Button>
        )}

        {canMove && (
          <div className="grid w-full max-w-sm grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setBatches(batches.slice(0, -1));
                setLocalPlay({ id: `l${++playId.current}`, seat: view, start: game.board, moves: [] });
                setSelected(null);
              }}
              disabled={busy || batches.length === 0}
            >
              ↶ Anulează
            </Button>
            <Button onClick={() => void send("move", { moves })} disabled={busy || !progress?.done}>
              Confirmă
            </Button>
          </div>
        )}

        {last && moves.length === 0 && <LastTurnLine game={game} nick={nick} />}
        <ErrorText>{error}</ErrorText>

        {room.status === "playing" && seat !== null && (
          <button
            type="button"
            className="text-xs font-semibold text-zinc-500 underline disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cedezi jocul? Adversarul primește punctele (2 dacă n-ai scos nicio piesă).")) void send("resign");
            }}
          >
            Cedează jocul
          </button>
        )}
      </div>
    </Card>
  );
}

function TurnCaption({
  state,
  game,
  nick,
  myTurn,
  progressDone,
}: {
  state: RoomState;
  game: GameState;
  nick: (s: Seat) => string;
  myTurn: boolean;
  progressDone: boolean;
}) {
  if (state.room.status !== "playing") return null;
  let text: string;
  if (game.opening && game.phase === "move") {
    const [w, b] = game.opening;
    const opening = `Deschidere: ${nick(0)} ${w}, ${nick(1)} ${b}. Începe ${nick(game.turn)}. `;
    text = opening + (myTurn ? "Mută cu ambele zaruri." : "");
  } else if (myTurn) {
    text =
      game.phase === "roll"
        ? "E rândul tău."
        : progressDone
          ? "Gata. Apasă „Confirmă” (sau „Anulează” ca să schimbi)."
          : "Alege o piesă (conturată cu albastru), apoi unde o muți (cerc verde = un zar, albastru punctat = suma zarurilor).";
  } else {
    text = game.phase === "roll" ? `${nick(game.turn)} dă cu zarul…` : `${nick(game.turn)} mută…`;
  }
  return (
    <p className={`text-center text-sm ${myTurn ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400"}`}>
      {text}
    </p>
  );
}

function LastTurnLine({ game, nick }: { game: GameState; nick: (s: Seat) => string }) {
  const t = game.lastTurn;
  if (!t) return null;
  const who = nick(t.seat);
  if (t.resigned) return <p className="text-center text-xs text-zinc-500">{who} a cedat jocul.</p>;
  const dice = `${t.dice[0]}-${t.dice[1]}`;
  if (t.passed) return <p className="text-center text-xs text-zinc-500">{who} a dat {dice} și nu a putut muta.</p>;
  return (
    <p className="text-center text-xs text-zinc-500">
      Ultima mutare: {who} a dat {dice}:{" "}
      <span className="font-mono">{t.moves.map((m, i) => moveLabel(m, t.hits[i])).join("  ")}</span>
    </p>
  );
}

function GameOver({ state, game, token, refresh, nick }: Props & { nick: (s: Seat) => string }) {
  const { room, me } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const winner = game.winner;
  const matchWinner: Seat | null = room.score[0] >= room.matchTo ? 0 : room.score[1] >= room.matchTo ? 1 : null;
  const isHost = room.hostPlayerId === me.id;

  async function send(path: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/${path}`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  if (winner === null) return null;
  return (
    <Card className="border-amber-300 bg-amber-50 text-center dark:border-amber-800 dark:bg-amber-950">
      <p className="text-2xl font-black">
        🏆 {nick(winner)} {matchWinner !== null ? "câștigă meciul!" : "câștigă jocul"}
      </p>
      <p className="mt-1 text-sm">
        +{game.points} {game.points === 2 ? "puncte (marț!)" : "punct"} · Scor: {nick(0)} {room.score[0]} – {room.score[1]} {nick(1)}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {matchWinner === null && me.seat !== null && (
          <Button onClick={() => void send("next")} disabled={busy}>
            Jocul următor
          </Button>
        )}
        {matchWinner === null && me.seat === null && (
          <p className="text-xs text-zinc-500">Așteptăm ca jucătorii să pornească jocul următor.</p>
        )}
        {isHost && (
          <Button variant="secondary" onClick={() => void send("lobby")} disabled={busy}>
            {matchWinner !== null ? "Meci nou (înapoi în lobby)" : "Oprește meciul (înapoi în lobby)"}
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

/** Sounds for changes made by others: dice, moves, your turn, game won. */
function useGameSounds(state: RoomState, game: GameState) {
  const prev = useRef<{ version: number; game: GameState } | null>(null);
  const version = state.room.version;
  const seat = state.me.seat;
  useEffect(() => {
    const p = prev.current;
    prev.current = { version, game };
    if (!p || p.version === version || !soundOn()) return;
    if (game.phase === "over" && p.game.phase !== "over") return playWin();
    const turnPassedToMe = seat !== null && game.turn === seat && p.game.turn !== seat;
    if (game.lastTurn && game.lastTurn.seat !== seat && JSON.stringify(game.lastTurn) !== JSON.stringify(p.game.lastTurn) && game.lastTurn.moves.length > 0) {
      playChecker();
    }
    if (turnPassedToMe) window.setTimeout(playYourTurn, 250);
    else if (game.dice && game.turn !== seat && JSON.stringify(game.dice) !== JSON.stringify(p.game.dice)) playDice();
  }, [version, game, seat]);
}
