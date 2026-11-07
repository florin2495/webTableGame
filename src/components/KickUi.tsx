"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/**
 * Live whole-second countdown from a server-provided "ms left" (not a timestamp: no client clock skew).
 * Re-anchors whenever the server sends a new value. null in, null out.
 */
export function useKickSeconds(remainingMs: number | null): number | null {
  const [tick, setTick] = useState<{ from: number | null; left: number } | null>(null);
  useEffect(() => {
    if (remainingMs === null) return;
    const started = Date.now();
    const update = () => setTick({ from: remainingMs, left: Math.max(0, Math.ceil((remainingMs - (Date.now() - started)) / 1000)) });
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [remainingMs]);
  if (remainingMs === null) return null;
  return tick && tick.from === remainingMs ? tick.left : Math.ceil(remainingMs / 1000);
}

/**
 * When a pending kick's countdown reaches 0, ask for fresh state (once, plus once more after the server's
 * 2 s network margin) so the removal is enforced promptly even though the poll interval is long.
 */
export function useKickWatcher(state: RoomState | null, refresh: () => Promise<void>) {
  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (!state) return;
    const pending = state.players.filter((p) => p.kickRemainingMs !== null);
    for (const key of [...fired.current]) {
      if (!pending.some((p) => key.startsWith(`${p.id}:`))) fired.current.delete(key);
    }
    const timers: number[] = [];
    for (const p of pending) {
      for (const [stage, extra] of [[0, 150], [1, 2400]] as const) {
        const key = `${p.id}:${stage}`;
        if (fired.current.has(key)) continue;
        timers.push(
          window.setTimeout(() => {
            fired.current.add(key);
            void refresh();
          }, (p.kickRemainingMs ?? 0) + extra),
        );
      }
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [state, refresh]);
}

/** "iese în {n} s" next to a player whose kick is pending. */
export function PendingKickBadge({ remainingMs }: { remainingMs: number }) {
  const s = useKickSeconds(remainingMs);
  return (
    <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      iese în {s} s
    </span>
  );
}

/** Blocking modal for the kicked player: only "Ignoră" closes it (or the countdown running out). */
export function KickModal({
  code,
  token,
  remainingMs,
  refresh,
}: {
  code: string;
  token: string;
  remainingMs: number;
  refresh: () => Promise<void>;
}) {
  const seconds = useKickSeconds(remainingMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${code}/kick/ignore`, { token, body: {} });
    } catch (err) {
      // 401 = already removed: the refresh below shows the usual "you were removed" screen.
      if (!(err instanceof ApiRequestError && err.status === 401)) {
        setError(err instanceof Error ? err.message : "Eroare.");
      }
    }
    await refresh();
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <h2 id="kick-title" className="text-lg font-black">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="mt-2 text-base">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {seconds} s ca să rămâi în joc.
        </p>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
        <Button autoFocus className="mt-4 w-full" onClick={() => void ignore()} disabled={busy}>
          Ignoră
        </Button>
      </div>
    </div>
  );
}
