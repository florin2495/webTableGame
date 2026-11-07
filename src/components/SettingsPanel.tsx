"use client";

import { PREF_AUTO_CONFIRM, PREF_AUTO_ROLL, PREF_SOUND, useBoolPref } from "@/lib/client/prefs";
import { Card, Toggle } from "./ui";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

/** Per-device settings, collapsed by default, shown on every room screen. */
export function SettingsPanel() {
  const [soundOn, setSoundOn] = useBoolPref(PREF_SOUND, true);
  const [autoRoll, setAutoRoll] = useBoolPref(PREF_AUTO_ROLL, false);
  const [autoConfirm, setAutoConfirm] = useBoolPref(PREF_AUTO_CONFIRM, false);

  return (
    <Card className="py-2">
      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-bold">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>
            Setări
          </span>
          <span className="font-mono text-xs text-zinc-500">v{VERSION}</span>
        </summary>
        <div className="pb-1 pt-1">
          <Toggle
            label="Sunete"
            hint="Zaruri, piese mutate și un semnal când e rândul tău."
            checked={soundOn}
            onChange={setSoundOn}
          />
          <Toggle
            label="Aruncă zarurile automat"
            hint="Zarurile se dau singure când vine rândul tău."
            checked={autoRoll}
            onChange={setAutoRoll}
          />
          <Toggle
            label="Confirmă tura imediat"
            hint={
              autoConfirm
                ? "Tura pleacă imediat după ultima mutare, fără timp de „Anulează”."
                : "Oprit: după ultima mutare ai 3 secunde să apeși „Anulează”, apoi tura se confirmă singură."
            }
            checked={autoConfirm}
            onChange={setAutoConfirm}
          />
        </div>
      </details>
    </Card>
  );
}
