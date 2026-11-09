"use client";

import { useCallback, useEffect, useState } from "react";
import { api, parseSession, readSessionRaw } from "@/lib/client/api";
import { MAX_SPECTATORS } from "@/lib/game";
import type { RoomListItem } from "@/lib/types";

const POLL_MS = 10_000;

/** Public list of open rooms. Lobby rooms with a free seat: join to play. Otherwise: join to watch. */
export function RoomList({
  selected,
  onSelect,
  onRejoin,
}: {
  selected: string | null;
  onSelect: (room: RoomListItem) => void;
  onRejoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kick = () => void load();
    const first = window.setTimeout(kick, 0);
    const interval = window.setInterval(kick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const refreshButton = (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      aria-label="Reîncarcă camerele"
      title="Reîncarcă camerele"
      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={loading ? "animate-spin" : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );

  const header = (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-bold">Camere deschise</h2>
      {refreshButton}
    </div>
  );

  if (rooms === null) {
    return (
      <div>
        {header}
        <p className="py-4 text-center text-sm text-zinc-500">
          {error || "Caut camere…"}
        </p>
      </div>
    );
  }
  if (rooms.length === 0) {
    return (
      <div>
        {header}
        <p className="py-4 text-center text-sm text-zinc-500">
          Nicio cameră deschisă acum. Creează una sau introdu un cod mai jos.
        </p>
      </div>
    );
  }

  return (
    <div>
      {header}
      <ul className="flex flex-col gap-2">
        {rooms.map((r) => {
          const mine = parseSession(readSessionRaw(r.code)) !== null;
          const active = selected === r.code;
          const canPlay = r.status === "lobby" && r.seated < 2;
          const full = !canPlay && r.spectators >= MAX_SPECTATORS;
          const action = mine
            ? "Reintră"
            : full
              ? "Plină"
              : canPlay
                ? "Joacă"
                : "Privește";
          return (
            <li key={r.code}>
              <button
                type="button"
                disabled={full && !mine}
                onClick={() => (mine ? onRejoin(r.code) : onSelect(r))}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {r.hasPassword && <span aria-label="cu parolă">🔒 </span>}
                    {r.name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {r.status === "lobby" ? "Lobby" : "În joc"} · {r.seated}/2
                    jucători · {r.spectators}{" "}
                    {r.spectators === 1 ? "spectator" : "spectatori"} · până la{" "}
                    {r.matchTo}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold tracking-widest">
                    {r.code}
                  </span>
                  <span className="block text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                    {action}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
