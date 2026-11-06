"use client";

import { posOf, type Board as BoardData, type Seat } from "@/lib/game";
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

const colX = (c: number) => (c < 6 ? 10 + c * PW : BAR_X + PW + (c - 6) * PW);

/** Board index shown in column c (0..11, left to right) of the top / bottom row. */
function indexAt(view: Seat, row: "top" | "bottom", c: number): number {
  if (view === 0) return row === "top" ? 12 + c : 11 - c;
  return row === "top" ? 11 - c : 12 + c;
}

interface Props {
  board: BoardData;
  /** Orientation: the seat whose home is drawn bottom-right. Spectators see White's view. */
  view: Seat;
  selectable?: ReadonlySet<Spot>;
  selected?: Spot | null;
  destinations?: ReadonlySet<Spot>;
  /** Points touched by the last move, lightly highlighted. */
  recent?: ReadonlySet<number>;
  onSpot?: (spot: Spot) => void;
}

export function Board({ board, view, selectable, selected = null, destinations, recent, onSpot }: Props) {
  const opp: Seat = view === 0 ? 1 : 0;
  const interactive = Boolean(onSpot);
  const click = (spot: Spot) => () => onSpot?.(spot);
  const isTarget = (spot: Spot) => destinations?.has(spot) ?? false;
  const isSource = (spot: Spot) => selectable?.has(spot) ?? false;

  const columns: { idx: number; row: "top" | "bottom"; c: number }[] = [];
  for (const row of ["top", "bottom"] as const) for (let c = 0; c < 12; c++) columns.push({ idx: indexAt(view, row, c), row, c });

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
            {isTarget(idx) && <TargetMark cx={x} cy={cy(Math.min(count, MAX_STACK - 1))} />}
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
          fill="#22c55e"
          fillOpacity={0.25}
          stroke="#22c55e"
          strokeWidth={3}
          className="animate-pulse"
        />
      )}

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

function TargetMark({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle cx={cx} cy={cy} r={R - 3} fill="#22c55e" fillOpacity={0.35} stroke="#16a34a" strokeWidth="3" strokeDasharray="5 4" className="animate-pulse" />
  );
}
