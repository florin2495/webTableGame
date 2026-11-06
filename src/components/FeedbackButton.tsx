"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref } from "@/lib/client/prefs";
import { Button, ErrorText } from "./ui";

const MAX = 1000;

export function FeedbackButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 rounded-lg border border-zinc-300 font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        💬 Feedback
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const nickname = useStringPref(PREF_NICKNAME) ?? "";
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 1800);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/feedback", { body: { message, nickname: nickname.trim(), website } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        {done ? (
          <p role="status" className="py-6 text-center font-semibold">
            Mulțumim! Mesajul a ajuns.
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <h2 id="feedback-title" className="text-base font-bold">
              Feedback
            </h2>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Ce problemă ai găsit sau ce am putea îmbunătăți?
              <textarea
                ref={areaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX}
                rows={5}
                required
                className="rounded-lg border border-zinc-300 bg-white p-3 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <span className="self-end text-xs font-normal text-zinc-500">
                {message.length}/{MAX}
              </span>
            </label>
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
            <ErrorText>{error}</ErrorText>
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" disabled={busy || message.trim().length === 0}>
                Trimite
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Anulează
              </Button>
            </div>
            <a
              href="https://hailatat.icu/feedback"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            >
              Vezi tot feedback-ul →
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
