"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { MATCH_OPTIONS, MAX_MEMBERS, minutesLabel, ROOM_IDLE_MINUTES, seatName, type Seat } from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { CheckerDot } from "./Dice";
import { MemberList, OfflineBadge } from "./MemberList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}

export function Lobby({ state, token, refresh }: Props) {
  const { room, me, players } = state;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHost = room.hostPlayerId === me.id;
  const bySeat = (s: Seat) => players.find((p) => p.seat === s) ?? null;
  const bothSeated = bySeat(0) !== null && bySeat(1) !== null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const sit = (seat: Seat | null) => run(() => api(`${base}/seat`, { token, body: { seat } }));
  const start = () => run(() => api(`${base}/start`, { token, body: {} }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-3 font-bold">La masă</h2>
        <div className="grid grid-cols-2 gap-3">
          {([0, 1] as Seat[]).map((s) => {
            const p = bySeat(s);
            const mine = p?.id === me.id;
            return (
              <div
                key={s}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center ${mine ? "border-indigo-500" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <CheckerDot seat={s} size={36} />
                <span className="text-xs font-semibold uppercase text-zinc-500">{seatName(s)}</span>
                <span className="min-h-6 truncate font-semibold">{p ? p.nickname : <span className="text-zinc-400">liber</span>}</span>
                {p && <OfflineBadge connected={p.connected} />}
                {!p && (
                  <Button variant="secondary" className="w-full" onClick={() => void sit(s)} disabled={busy}>
                    {me.seat === null ? "Ia locul" : "Mută-te aici"}
                  </Button>
                )}
                {mine && (
                  <Button variant="secondary" className="w-full" onClick={() => void sit(null)} disabled={busy}>
                    Ridică-te
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {me.seat === null && (
          <p className="mt-3 text-center text-sm text-zinc-500">
            Ești spectator. Poți lua un loc liber cât camera e în lobby.
          </p>
        )}
        {isHost ? (
          <>
            <Button className="mt-4 w-full" onClick={() => void start()} disabled={busy || !bothSeated}>
              Pornește meciul
            </Button>
            {!bothSeated && (
              <p className="mt-2 text-center text-xs text-zinc-500">
                Ai nevoie de doi jucători la masă. Trimite codul (sus, în dreapta) unui prieten.
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-center text-xs text-zinc-500">
            {players.find((p) => p.isHost)?.nickname ?? "Host-ul"} pornește meciul când sunt doi la masă.
          </p>
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      {isHost && <MatchSettings key={room.matchTo} state={state} token={token} refresh={refresh} />}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">În cameră</h2>
          <span className="text-sm tabular-nums text-zinc-500">
            {players.length}/{MAX_MEMBERS}
          </span>
        </div>
        <MemberList state={state} token={token} refresh={refresh} />
        <p className="mt-2 text-center text-xs text-zinc-500">
          2 jucători + 2 spectatori. Spectatorii pot intra și în timpul jocului. Camera se închide după{" "}
          {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu o are deschisă.
        </p>
      </Card>
    </div>
  );
}

function MatchSettings({ state, token, refresh }: Props) {
  const { room } = state;
  const [matchTo, setMatchTo] = useState(room.matchTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/settings`, { token, body: { matchTo } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <details>
        <summary className="cursor-pointer font-bold">Lungimea meciului (doar tu o poți schimba)</summary>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Meci până la
            <select
              value={matchTo}
              onChange={(e) => setMatchTo(Number(e.target.value))}
              className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MATCH_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "punct" : "puncte"}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => void save()} disabled={busy || matchTo === room.matchTo}>
            Salvează
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
      </details>
    </Card>
  );
}
