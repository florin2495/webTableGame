import type { Seat } from "@/lib/game";

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function Die({ value, used = false, size = 40, dark = false }: { value: number; used?: boolean; size?: number; dark?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`zar ${value}${used ? " (folosit)" : ""}`}
      className={`transition-opacity ${used ? "opacity-30" : ""}`}
    >
      <rect x="4" y="4" width="92" height="92" rx="18" fill={dark ? "#1c1917" : "#fafaf9"} stroke="#78716c" strokeWidth="4" />
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="9" fill={dark ? "#fafaf9" : "#1c1917"} />
      ))}
    </svg>
  );
}

export const CHECKER_FILL: Record<Seat, string> = { 0: "#fafaf9", 1: "#292524" };
export const CHECKER_STROKE: Record<Seat, string> = { 0: "#a8a29e", 1: "#0c0a09" };

export function CheckerDot({ seat, size = 18 }: { seat: Seat; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <circle cx="10" cy="10" r="8.5" fill={CHECKER_FILL[seat]} stroke={CHECKER_STROKE[seat]} strokeWidth="1.5" />
      <circle cx="10" cy="10" r="5" fill="none" stroke={CHECKER_STROKE[seat]} strokeOpacity="0.4" strokeWidth="1" />
    </svg>
  );
}
