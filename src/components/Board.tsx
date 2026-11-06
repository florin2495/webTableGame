"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyMove, BAR, indexOf, other, posOf, type Board as BoardData, type Move, type Seat } from "@/lib/game";
import { CHECKER_FILL, CHECKER_STROKE } from "./Dice";

/** A clickable spot: a point index 0..23, the bar, or the bear-off tray. */
export type Spot = number | "bar" | "off";

// Geometry (SVG units). Two quarters of 6 points, the bar between, the bear-off tray on the right.
const PW = 40; // point width
const R = 17; // checker radius
const TOP = 16; // label strip
const INNER_H = 410;
const BOTTOM = TOP + INNER_H; // 426
const W = 594;
const H = BOTTOM + 16;
const MID = TOP + INNER_H / 2;
const TRI_H = 170;
const BAR_X = 250;
const TRAY_X = 540;
const MAX_STACK = 5;
/** Time a checker takes to slide one step (one die). */
export const STEP_MS = 280;

const colX = (c: number) => (c < 6 ? 10 + c * PW : BAR_X + PW + (c - 6) * PW);

/** Board index shown in column c (0..11, left to right) of the top / bottom row. */
function indexAt(view: Seat, row: "top" | "bottom", c: number): number {
  if (view === 0) return row === "top" ? 12 + c : 11 - c;
  return row === "top" ? 11 - c : 12 + c;
}

/** A turn (or part of one) to replay as sliding checkers: `moves` played from `start` end in the `board` prop. */
export interface Playback {
  /** Changes whenever a new animation should run. */
  id: string;
  seat: Seat;
  start: BoardData;
  moves: Move[];
}

interface Props {
  board: BoardData;
  /** Orientation: the seat whose home is drawn bottom-right. Spectators see White's view. */
  view: Seat;
  selectable?: ReadonlySet<Spot>;
  selected?: Spot | null;
  destinations?: ReadonlySet<Spot>;
  /** Destinations reached by combining dice (drawn differently). */
  sumDestinations?: ReadonlySet<Spot>;
  playback?: Playback | null;
  /** Points touched by the last move, lightly highlighted. */
  recent?: ReadonlySet<number>;
  onSpot?: (spot: Spot) => void;
}

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Which move of the playback is sliding now (moves.length = finished). */
function usePlaybackStep(playback: Playback | null | undefined, reduced: boolean): number {
  const id = playback?.id ?? null;
  const n = playback?.moves.length ?? 0;
  const [st, setSt] = useState<{ id: string | null; k: number }>({ id, k: 0 });
  if (st.id !== id) setSt({ id, k: 0 });
  const k = reduced ? n : st.id === id ? Math.min(st.k, n) : 0;
  useEffect(() => {
    if (id === null || k >= n) return;
    const t = window.setTimeout(() => setSt((s) => (s.id === id ? { id, k: s.k + 1 } : s)), STEP_MS);
    return () => window.clearTimeout(t);
  }, [id, k, n]);
  return k;
}

export function Board({ board: finalBoard, view, selectable, selected = null, destinations, sumDestinations, playback, recent, onSpot }: Props) {
  const opp: Seat = view === 0 ? 1 : 0;
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
  const step = usePlaybackStep(playback, reduced);
  const sliding = playback && step < playback.moves.length ? playback : null;
  const interactive = Boolean(onSpot) && !sliding;
  const click = (spot: Spot) => () => onSpot?.(spot);
  const isSum = (spot: Spot) => !sliding && (sumDestinations?.has(spot) ?? false);
  const isTarget = (spot: Spot) => !sliding && ((destinations?.has(spot) ?? false) || isSum(spot));
  const isSource = (spot: Spot) => !sliding && (selectable?.has(spot) ?? false);

  const columns: { idx: number; row: "top" | "bottom"; c: number }[] = [];
  for (const row of ["top", "bottom"] as const) for (let c = 0; c < 12; c++) columns.push({ idx: indexAt(view, row, c), row, c });

  // Where checkers stand (SVG units), for the sliding ones.
  const pointXY = (idx: number, k: number) => {
    const col = columns.find((x) => x.idx === idx)!;
    return { x: colX(col.c) + PW / 2, y: col.row === "top" ? TOP + R + k * 2 * R : BOTTOM - R - k * 2 * R };
  };
  const barXY = (seat: Seat, k: number) => ({ x: BAR_X + PW / 2, y: seat === opp ? MID - 24 - k * 2 * R : MID + 24 + k * 2 * R });
  const offXY = (seat: Seat, k: number) => ({
    x: TRAY_X + 22,
    y: (seat === opp ? TOP + 4 + k * 11 : BOTTOM - 4 - (k + 1) * 11) + 4.5,
  });

  // While a move slides, draw the board without the moving checker (and without a hit blot);
  // the flyers are drawn on top.
  let board = finalBoard;
  const flyers: { key: string; seat: Seat; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  if (sliding) {
    let base = sliding.start;
    for (let i = 0; i < step; i++) base = applyMove(base, sliding.seat, sliding.moves[i]).board;
    const m = sliding.moves[step];
    const seat = sliding.seat;
    const sgn = seat === 0 ? 1 : -1;
    const res = applyMove(base, seat, m);
    const points = [...base.points];
    const bar: [number, number] = [base.bar[0], base.bar[1]];
    let from: { x: number; y: number };
    if (m.from === BAR) {
      from = barXY(seat, Math.min(bar[seat], 4) - 1);
      bar[seat]--;
    } else {
      const i = indexOf(seat, m.from);
      from = pointXY(i, Math.min(Math.abs(points[i]), MAX_STACK) - 1);
      points[i] -= sgn;
    }
    const to = m.from - m.die;
    let toXY: { x: number; y: number };
    if (to <= 0) {
      toXY = offXY(seat, base.off[seat]);
    } else {
      const j = indexOf(seat, to);
      if (res.hit) {
        points[j] = 0;
        flyers.push({ key: "blot", seat: other(seat), from: pointXY(j, 0), to: barXY(other(seat), Math.min(base.bar[other(seat)], 3)) });
      }
      toXY = pointXY(j, Math.min(Math.abs(points[j]), MAX_STACK - 1));
    }
    flyers.push({ key: "mover", seat, from, to: toXY });
    board = { points, bar, off: base.off };
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-manipulation select-none" role="img" aria-label="Tabla de joc">
      <defs>
        <radialGradient id="chk0" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={CHECKER_FILL[0]} />
        </radialGradient>
        <radialGradient id="chk1" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#57534e" />
          <stop offset="100%" stopColor={CHECKER_FILL[1]} />
        </radialGradient>
      </defs>

      {/* Frame, playing field, bar, tray */}
      <rect x="0" y="0" width={W} height={H} rx="12" fill="#5b3a1f" />
      <rect x="10" y={TOP} width={BAR_X - 10} height={INNER_H} fill="#e9d5a7" />
      <rect x={BAR_X + PW} y={TOP} width={TRAY_X - 10 - BAR_X - PW} height={INNER_H} fill="#e9d5a7" />
      <rect x={BAR_X} y={TOP} width={PW} height={INNER_H} fill="#7a4e2a" />
      <rect x={TRAY_X} y={TOP} width={44} height={INNER_H} rx="4" fill="#3f2814" />
      <line x1={TRAY_X} x2={TRAY_X + 44} y1={MID} y2={MID} stroke="#5b3a1f" strokeWidth="3" />

      {/* Points */}
      {columns.map(({ idx, row, c }) => {
        const x = colX(c);
        const base = row === "top" ? TOP : BOTTOM;
        const tip = row === "top" ? TOP + TRI_H : BOTTOM - TRI_H;
        const dark = (c + (row === "top" ? 0 : 1)) % 2 === 0;
        const label = posOf(view, idx);
        return (
          <g key={`p${idx}`}>
            <polygon
              points={`${x},${base} ${x + PW},${base} ${x + PW / 2},${tip}`}
              fill={dark ? "#9a3412" : "#44403c"}
              opacity={0.9}
            />
            {recent?.has(idx) && (
              <polygon points={`${x},${base} ${x + PW},${base} ${x + PW / 2},${tip}`} fill="#facc15" opacity={0.35} />
            )}
            <text
              x={x + PW / 2}
              y={row === "top" ? TOP - 4 : BOTTOM + 12}
              textAnchor="middle"
              fontSize="10"
              fill="#e7d3b0"
              fontFamily="var(--font-geist-mono), monospace"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Checkers on points */}
      {columns.map(({ idx, row, c }) => {
        const n = board.points[idx];
        if (n === 0 && !isTarget(idx)) return null;
        const seat: Seat = n > 0 ? 0 : 1;
        const count = Math.abs(n);
        const x = colX(c) + PW / 2;
        const cy = (k: number) => (row === "top" ? TOP + R + k * 2 * R : BOTTOM - R - k * 2 * R);
        const shown = Math.min(count, MAX_STACK);
        const topK = shown - 1;
        return (
          <g key={`c${idx}`}>
            {Array.from({ length: shown }, (_, k) => (
              <Checker
                key={k}
                cx={x}
                cy={cy(k)}
                seat={seat}
                ring={k === topK ? (selected === idx ? "selected" : isSource(idx) ? "source" : null) : null}
              />
            ))}
            {count > MAX_STACK && (
              <text x={x} y={cy(topK) + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={seat === 0 ? "#1c1917" : "#fafaf9"}>
                {count}
              </text>
            )}
            {isTarget(idx) && <TargetMark cx={x} cy={cy(Math.min(count, MAX_STACK - 1))} sum={isSum(idx)} />}
          </g>
        );
      })}

      {/* Bar: opponent's hit checkers above the middle, own below */}
      {([opp, view] as Seat[]).map((seat) => {
        const count = board.bar[seat];
        const above = seat === opp;
        const shown = Math.min(count, 4);
        const cy = (k: number) => (above ? MID - 24 - k * 2 * R : MID + 24 + k * 2 * R);
        return (
          <g key={`bar${seat}`}>
            {Array.from({ length: shown }, (_, k) => (
              <Checker
                key={k}
                cx={BAR_X + PW / 2}
                cy={cy(k)}
                seat={seat}
                ring={!above && k === shown - 1 ? (selected === "bar" ? "selected" : isSource("bar") ? "source" : null) : null}
              />
            ))}
            {count > 4 && (
              <text x={BAR_X + PW / 2} y={cy(3) + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={seat === 0 ? "#1c1917" : "#fafaf9"}>
                {count}
              </text>
            )}
          </g>
        );
      })}

      {/* Borne-off checkers: opponent's in the top half of the tray, own in the bottom half */}
      {([opp, view] as Seat[]).map((seat) => {
        const count = board.off[seat];
        const top = seat === opp;
        return (
          <g key={`off${seat}`}>
            {Array.from({ length: count }, (_, k) => (
              <rect
                key={k}
                x={TRAY_X + 4}
                y={top ? TOP + 4 + k * 11 : BOTTOM - 4 - (k + 1) * 11}
                width={36}
                height={9}
                rx={2}
                fill={CHECKER_FILL[seat]}
                stroke={CHECKER_STROKE[seat]}
              />
            ))}
          </g>
        );
      })}
      {isTarget("off") && (
        <rect
          x={TRAY_X + 1}
          y={MID + 2}
          width={42}
          height={INNER_H / 2 - 3}
          rx={4}
          fill={isSum("off") ? "#0ea5e9" : "#22c55e"}
          fillOpacity={0.25}
          stroke={isSum("off") ? "#0284c7" : "#22c55e"}
          strokeWidth={3}
          strokeDasharray={isSum("off") ? "2 5" : undefined}
          className="animate-pulse"
        />
      )}

      {/* Sliding checkers (CSS transforms only: no layout work) */}
      {flyers.map((f) => (
        <Flyer key={`${sliding?.id}-${step}-${f.key}`} seat={f.seat} from={f.from} to={f.to} />
      ))}

      {/* Click targets (on top of everything) */}
      {interactive && (
        <g>
          {columns.map(({ idx, row, c }) => (
            <rect
              key={`t${idx}`}
              x={colX(c)}
              y={row === "top" ? TOP : MID}
              width={PW}
              height={INNER_H / 2}
              fill="transparent"
              className={isSource(idx) || isTarget(idx) ? "cursor-pointer" : ""}
              onClick={click(idx)}
            />
          ))}
          <rect x={BAR_X} y={MID} width={PW} height={INNER_H / 2} fill="transparent" onClick={click("bar")} />
          <rect x={TRAY_X} y={MID} width={44} height={INNER_H / 2} fill="transparent" onClick={click("off")} />
        </g>
      )}
    </svg>
  );
}

function Checker({ cx, cy, seat, ring }: { cx: number; cy: number; seat: Seat; ring: "source" | "selected" | null }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={R - 1} fill={`url(#chk${seat})`} stroke={CHECKER_STROKE[seat]} strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={R - 7} fill="none" stroke={CHECKER_STROKE[seat]} strokeOpacity="0.35" />
      {ring === "source" && <circle cx={cx} cy={cy} r={R - 1} fill="none" stroke="#6366f1" strokeWidth="3" />}
      {ring === "selected" && <circle cx={cx} cy={cy} r={R + 1} fill="none" stroke="#22c55e" strokeWidth="4" />}
    </g>
  );
}

function TargetMark({ cx, cy, sum = false }: { cx: number; cy: number; sum?: boolean }) {
  return sum ? (
    <circle cx={cx} cy={cy} r={R - 3} fill="#0ea5e9" fillOpacity={0.3} stroke="#0284c7" strokeWidth="3" strokeDasharray="2 5" strokeLinecap="round" className="animate-pulse" />
  ) : (
    <circle cx={cx} cy={cy} r={R - 3} fill="#22c55e" fillOpacity={0.35} stroke="#16a34a" strokeWidth="3" strokeDasharray="5 4" className="animate-pulse" />
  );
}

/** A checker sliding from one spot to another over STEP_MS (Web Animations API, transform only). */
function Flyer({ seat, from, to }: { seat: Seat; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const ref = useRef<SVGGElement>(null);
  const at = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px)`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.animate !== "function") {
      el.style.transform = at(to);
      return;
    }
    const a = el.animate([{ transform: at(from) }, { transform: at(to) }], { duration: STEP_MS, easing: "ease-out", fill: "forwards" });
    return () => a.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <g ref={ref} style={{ transform: at(from) }} pointerEvents="none">
      <Checker cx={0} cy={0} seat={seat} ring={null} />
    </g>
  );
}
