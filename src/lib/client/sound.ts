"use client";

// Tiny synthesized sounds (Web Audio) - no audio files to load.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, gain = 0.15, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Wooden "clack" of a checker. */
export function playChecker() {
  tone(180, 0, 0.08, 0.25, "triangle");
  tone(420, 0, 0.04, 0.08, "square");
}

/** A few rattles of dice. */
export function playDice() {
  for (let i = 0; i < 5; i++) tone(700 + Math.random() * 900, i * 0.05, 0.04, 0.07, "square");
}

/** Two rising notes: it is your turn. */
export function playYourTurn() {
  tone(660, 0, 0.14, 0.12);
  tone(880, 0.12, 0.2, 0.12);
}

export function playWin() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.25, 0.12));
}
