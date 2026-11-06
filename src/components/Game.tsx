"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_SOUND, readPref } from "@/lib/client/prefs";
import { playChecker, playDice, playWin, playYourTurn } from "@/lib/client/sound";
import {
  BAR,
  expandDice,
  indexOf,
  moveLabel,
  pipCount,
  playTurn,
  seatName,
  type GameState,
  type Move,
  type Seat,
} from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { Board, type Spot } from "./Board";
import { CheckerDot, Die } from "./Dice";
import { MemberList } from "./MemberList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  game: GameState;
  token: string;
  refresh: () => Promise<void>;
}

const soundOn = () => readPref(PREF_SOUND) !== "0";

export function Game({ state, game, token, refresh }: Props) {
  const { room, me, players } = state;
  const nick = (s: Seat) => players.find((p) => p.seat === s)?.nickname ?? seatName(s);
  useGameSounds(state, game);

  return (
    <div className="flex flex-col gap-3">
      <ScoreBar state={state} game={game} nick={nick} />
      {/* key: a new server state (new version) resets the half-played local turn */}
      <Play key={room.version} state={state} game={game} token={token} refresh={refresh} nick={nick} />
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

function Play({ state, game, token, refresh, nick }: Props & { nick: (s: Seat) => string }) {
  const { room, me } = state;
  const seat = me.seat;
  const view: Seat = seat ?? 0;
  const myTurn = room.status === "playing" && seat !== null && game.turn === seat;
  const canMove = myTurn && game.phase === "move" && game.dice !== null;

  const [moves, setMoves] = useState<Move[]>([]);
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
  const destinations = new Map<Spot, Move>();
  if (selected !== null) {
    for (const m of next) {
      if (spotOf(m.from) !== selected) continue;
      const d = destOf(m);
      const cur = destinations.get(d);
      if (!cur || m.die < cur.die) destinations.set(d, m);
    }
  }

  function onSpot(spot: Spot) {
    if (busy) return;
    const move = selected !== null ? destinations.get(spot) : undefined;
    if (move) {
      setMoves([...moves, move]);
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
        destinations={new Set(destinations.keys())}
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

        {myTurn && game.phase === "roll" && (
          <Button className="w-full max-w-xs text-lg" onClick={() => void send("roll").then(() => soundOn() && playDice())} disabled={busy}>
            🎲 Aruncă zarurile
          </Button>
        )}

        {canMove && (
          <div className="grid w-full max-w-sm grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMoves(moves.slice(0, -1));
                setSelected(null);
              }}
              disabled={busy || moves.length === 0}
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
          : "Alege o piesă (conturată cu albastru), apoi unde o muți (cercul verde).";
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
