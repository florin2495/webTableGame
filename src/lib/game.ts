// Pure backgammon ("table") rules - shared by server and client, no I/O.
//
// Board: 24 points, index 0..23. A positive count = white checkers, negative = black.
// White (seat 0) moves from index 23 down to 0 and bears off below 0; its home is 0..5.
// Black (seat 1) moves from index 0 up to 23 and bears off above 23; its home is 18..23.
//
// Moves are expressed relative to the mover ("pip position"): 1..24, where 1 is the point
// closest to bearing off, 25 is the bar and 0 or less means borne off. This is the standard
// backgammon notation (e.g. "24/18 13/10"), the same for both colours.

export type Seat = 0 | 1;

export interface Board {
  points: number[];
  bar: [number, number];
  off: [number, number];
}

/** One checker moved by one die. `from` is 1..24, or BAR (25). */
export interface Move {
  from: number;
  die: number;
}

export const BAR = 25;
export const CHECKERS = 15;

export const NICKNAME_MAX = 10;
export const MAX_SPECTATORS = 16;
export const MAX_MEMBERS = 2 + MAX_SPECTATORS;
export const MATCH_OPTIONS = [1, 3, 5, 7] as const;
export const MATCH_DEFAULT = 3;

/**
 * Lobby/finished rooms close after this long without anyone having them open. Every open room
 * page polls /state, which refreshes the timer (see PRESENCE_TOUCH_MS).
 */
export const ROOM_IDLE_MINUTES = 10;
/** A game in progress survives a longer gap (phones lose connection, screens lock). */
export const PLAYING_IDLE_MINUTES = 30;
export const PRESENCE_TOUCH_MS = 20_000;

export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  const limit = status === "playing" ? PLAYING_IDLE_MINUTES : ROOM_IDLE_MINUTES;
  return idle > limit * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * member (seated player or spectator, both are player rows) has been seen within it. Swept every time
 * the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 120_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

export function isValidMatchTo(n: unknown): n is number {
  return (MATCH_OPTIONS as readonly number[]).includes(n as number);
}

export const seatName = (seat: Seat) => (seat === 0 ? "Alb" : "Negru");
export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const sign = (seat: Seat) => (seat === 0 ? 1 : -1);

/** Board index of a mover-relative position 1..24. */
export function indexOf(seat: Seat, pos: number): number {
  return seat === 0 ? pos - 1 : 24 - pos;
}

/** Mover-relative position 1..24 of a board index. */
export function posOf(seat: Seat, index: number): number {
  return seat === 0 ? index + 1 : 24 - index;
}

export function initialBoard(): Board {
  const points = Array<number>(24).fill(0);
  for (const seat of [0, 1] as Seat[]) {
    const s = sign(seat);
    points[indexOf(seat, 24)] = 2 * s;
    points[indexOf(seat, 13)] = 5 * s;
    points[indexOf(seat, 8)] = 3 * s;
    points[indexOf(seat, 6)] = 5 * s;
  }
  return { points, bar: [0, 0], off: [0, 0] };
}

/** How many of `seat`'s checkers stand on mover-relative position `pos` (25 = bar). */
export function ownAt(board: Board, seat: Seat, pos: number): number {
  if (pos === BAR) return board.bar[seat];
  return Math.max(0, board.points[indexOf(seat, pos)] * sign(seat));
}

function opponentAt(board: Board, seat: Seat, pos: number): number {
  return Math.max(0, -board.points[indexOf(seat, pos)] * sign(seat));
}

/** True when every remaining checker of `seat` is in its home board (positions 1..6). */
export function allHome(board: Board, seat: Seat): boolean {
  if (board.bar[seat] > 0) return false;
  for (let pos = 7; pos <= 24; pos++) if (ownAt(board, seat, pos) > 0) return false;
  return true;
}

/** Legal moves of a single checker with a single die, ignoring the "use as many dice as possible" rule. */
export function singleMoves(board: Board, seat: Seat, die: number): Move[] {
  if (board.bar[seat] > 0) {
    return opponentAt(board, seat, BAR - die) < 2 ? [{ from: BAR, die }] : [];
  }
  const moves: Move[] = [];
  const home = allHome(board, seat);
  for (let pos = 1; pos <= 24; pos++) {
    if (ownAt(board, seat, pos) === 0) continue;
    const to = pos - die;
    if (to >= 1) {
      if (opponentAt(board, seat, to) < 2) moves.push({ from: pos, die });
    } else if (home) {
      // Exact bear-off, or a bigger die from the highest occupied point.
      let higher = false;
      for (let p = pos + 1; p <= 6; p++) if (ownAt(board, seat, p) > 0) higher = true;
      if (to === 0 || !higher) moves.push({ from: pos, die });
    }
  }
  return moves;
}

/** Applies one move (assumed legal). Returns a new board and whether it hit a blot. */
export function applyMove(board: Board, seat: Seat, move: Move): { board: Board; hit: boolean } {
  const points = [...board.points];
  const bar: [number, number] = [board.bar[0], board.bar[1]];
  const off: [number, number] = [board.off[0], board.off[1]];
  const s = sign(seat);

  if (move.from === BAR) bar[seat]--;
  else points[indexOf(seat, move.from)] -= s;

  const to = move.from - move.die;
  let hit = false;
  if (to <= 0) {
    off[seat]++;
  } else {
    const i = indexOf(seat, to);
    if (points[i] === -s) {
      points[i] = 0;
      bar[other(seat)]++;
      hit = true;
    }
    points[i] += s;
  }
  return { board: { points, bar, off }, hit };
}

/** The dice to play for a roll: doubles are played four times. */
export function expandDice(dice: readonly number[]): number[] {
  return dice.length === 2 && dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [...dice];
}

function removeDie(dice: readonly number[], die: number): number[] {
  const i = dice.indexOf(die);
  return i < 0 ? [...dice] : [...dice.slice(0, i), ...dice.slice(i + 1)];
}

const boardKey = (b: Board) => `${b.points.join(",")}|${b.bar.join(",")}|${b.off.join(",")}`;

/** The most dice that can be played from this position (memoised within one call). */
export function maxPlayable(board: Board, seat: Seat, dice: readonly number[], memo = new Map<string, number>()): number {
  if (dice.length === 0) return 0;
  const key = `${boardKey(board)}#${[...dice].sort().join("")}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = 0;
  for (const die of new Set(dice)) {
    for (const m of singleMoves(board, seat, die)) {
      const n = 1 + maxPlayable(applyMove(board, seat, m).board, seat, removeDie(dice, die), memo);
      if (n > best) best = n;
      if (best === dice.length) break;
    }
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

export interface TurnRules {
  /** How many dice must be played this turn (as many as possible). */
  required: number;
  /** When only one of two different dice can be played, the larger one must be played if possible. */
  forceDie: number | null;
}

export function turnRules(board: Board, seat: Seat, dice: readonly number[]): TurnRules {
  const all = expandDice(dice);
  const required = maxPlayable(board, seat, all);
  let forceDie: number | null = null;
  if (required === 1 && all.length === 2 && all[0] !== all[1]) {
    const hi = Math.max(all[0], all[1]);
    const lo = Math.min(all[0], all[1]);
    forceDie = singleMoves(board, seat, hi).length > 0 ? hi : lo;
  }
  return { required, forceDie };
}

/**
 * Moves that can be played next and still let the turn use `need` dice in total from here.
 * `forceDie` applies only to the first move of a turn.
 */
export function legalNextMoves(
  board: Board,
  seat: Seat,
  remaining: readonly number[],
  need: number,
  forceDie: number | null = null,
): Move[] {
  if (need <= 0) return [];
  const memo = new Map<string, number>();
  const result: Move[] = [];
  for (const die of new Set(remaining)) {
    if (forceDie !== null && die !== forceDie) continue;
    for (const m of singleMoves(board, seat, die)) {
      const after = applyMove(board, seat, m).board;
      if (1 + maxPlayable(after, seat, removeDie(remaining, die), memo) >= need) result.push(m);
    }
  }
  return result;
}

/** Where a partially played turn stands: current board, unused dice, and the legal next moves. */
export interface TurnProgress {
  board: Board;
  remaining: number[];
  hits: number;
  next: Move[];
  done: boolean;
  required: number;
}

/** Replays `moves` from the start of the turn. Returns an error message for the first illegal move. */
export function playTurn(start: Board, seat: Seat, dice: readonly number[], moves: readonly Move[]): TurnProgress | string {
  const rules = turnRules(start, seat, dice);
  if (moves.length > rules.required) return `Poți muta doar ${rules.required} ${rules.required === 1 ? "piesă" : "piese"}.`;
  let board = start;
  let remaining = expandDice(dice);
  let hits = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const allowed = legalNextMoves(board, seat, remaining, rules.required - i, i === 0 ? rules.forceDie : null);
    if (!allowed.some((a) => a.from === m.from && a.die === m.die)) return "Mutare nepermisă.";
    const r = applyMove(board, seat, m);
    board = r.board;
    if (r.hit) hits++;
    remaining = removeDie(remaining, m.die);
  }
  const need = rules.required - moves.length;
  const next = legalNextMoves(board, seat, remaining, need, moves.length === 0 ? rules.forceDie : null);
  return { board, remaining, hits, next, done: need === 0, required: rules.required };
}

/** A destination reached by combining several dice with one checker. */
export interface SumMove {
  /** Mover-relative landing position; 0 = borne off. */
  dest: number;
  /** The single-die moves, in order, that get the checker there. */
  moves: Move[];
  hits: number;
}

/**
 * Destinations reachable by moving the checker on `from` (1..24 or BAR) with two or more of the
 * remaining dice in a row (non-doubles: a+b in either order; doubles: up to four steps). Each step
 * must itself be a legal next move of the turn (so bar entry, bearing off and the "use as many dice
 * as possible / larger die" rules all hold), and intermediate hits really happen. When several
 * sequences reach the same point, the one with the fewest hits wins. `moves` are the moves already
 * played this turn. Single-die destinations are not included.
 */
export function sumMoves(start: Board, seat: Seat, dice: readonly number[], moves: readonly Move[], from: number): SumMove[] {
  const progress = playTurn(start, seat, dice, moves);
  if (typeof progress === "string" || progress.done) return [];
  const rules = turnRules(start, seat, dice);
  const best = new Map<number, SumMove>();

  const walk = (b: Board, pos: number, rem: readonly number[], need: number, force: number | null, path: Move[], hits: number) => {
    if (need <= 0 || rem.length === 0) return;
    for (const m of legalNextMoves(b, seat, rem, need, force)) {
      if (m.from !== pos) continue;
      const r = applyMove(b, seat, m);
      const nextPath = [...path, m];
      const nextHits = hits + (r.hit ? 1 : 0);
      const to = pos - m.die;
      if (nextPath.length >= 2) {
        const dest = Math.max(to, 0);
        const cur = best.get(dest);
        if (!cur || nextHits < cur.hits || (nextHits === cur.hits && nextPath.length < cur.moves.length)) {
          best.set(dest, { dest, moves: nextPath, hits: nextHits });
        }
      }
      if (to >= 1) walk(r.board, to, removeDie(rem, m.die), need - 1, null, nextPath, nextHits);
    }
  };
  const need = rules.required - moves.length;
  walk(progress.board, from, progress.remaining, need, moves.length === 0 ? rules.forceDie : null, [], 0);
  return [...best.values()];
}

/** Total pips a player still has to travel (lower is better). */
export function pipCount(board: Board, seat: Seat): number {
  let total = board.bar[seat] * BAR;
  for (let pos = 1; pos <= 24; pos++) total += ownAt(board, seat, pos) * pos;
  return total;
}

/** Points won by `winner`: 2 for a "marț" (the loser bore off nothing), otherwise 1. */
export function gamePoints(board: Board, loser: Seat): number {
  return board.off[loser] === 0 ? 2 : 1;
}

export function rollDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 6);
}

/** Opening roll: one die each until they differ. The higher die starts and plays both dice. */
export function openingRoll(roll: () => number = () => rollDie()): { dice: [number, number]; starter: Seat } {
  for (;;) {
    const white = roll();
    const black = roll();
    if (white !== black) return { dice: [white, black], starter: white > black ? 0 : 1 };
  }
}

/** "24/18*" in the mover's own numbering. */
export function moveLabel(m: Move, hit = false): string {
  const to = m.from - m.die;
  return `${m.from === BAR ? "bară" : m.from}/${to <= 0 ? "afară" : to}${hit ? "*" : ""}`;
}

/** Sanity check of a board (used on data read back from the DB). */
export function checkerTotal(board: Board, seat: Seat): number {
  let n = board.bar[seat] + board.off[seat];
  for (let pos = 1; pos <= 24; pos++) n += ownAt(board, seat, pos);
  return n;
}

// ---------------------------------------------------------------------------
// Game state stored on the room (jsonb) and sent to every member.
// ---------------------------------------------------------------------------

export type Phase = "roll" | "move" | "over";

export interface LastTurn {
  seat: Seat;
  dice: [number, number];
  moves: Move[];
  /** Per move: did it hit a blot. */
  hits: boolean[];
  /** Rolled but had no legal move. */
  passed: boolean;
  resigned?: boolean;
}

export interface GameState {
  gameNo: number;
  board: Board;
  turn: Seat;
  phase: Phase;
  /** Dice of the current turn (null while waiting for a roll). */
  dice: [number, number] | null;
  /** Opening roll [white, black], shown until the first turn is played. */
  opening: [number, number] | null;
  lastTurn: LastTurn | null;
  winner: Seat | null;
  /** Points awarded for this game once it is over. */
  points: number;
}

export function newGame(gameNo: number, roll: () => number = () => rollDie()): GameState {
  const { dice, starter } = openingRoll(roll);
  return {
    gameNo,
    board: initialBoard(),
    turn: starter,
    phase: "move",
    dice: starter === 0 ? [dice[0], dice[1]] : [dice[1], dice[0]],
    opening: dice,
    lastTurn: null,
    winner: null,
    points: 0,
  };
}

/** Rolls for the player on turn. If no move is possible the turn passes immediately. */
export function rollTurn(game: GameState, roll: () => number = () => rollDie()): GameState {
  const dice: [number, number] = [roll(), roll()];
  if (turnRules(game.board, game.turn, dice).required === 0) {
    return {
      ...game,
      turn: other(game.turn),
      phase: "roll",
      dice: null,
      opening: null,
      lastTurn: { seat: game.turn, dice, moves: [], hits: [], passed: true },
    };
  }
  return { ...game, phase: "move", dice };
}

/** Validates and plays a whole turn. Returns the new state or an error message. */
export function commitTurn(game: GameState, moves: readonly Move[]): GameState | string {
  if (game.phase !== "move" || !game.dice) return "Nu e momentul să muți.";
  const seat = game.turn;
  const progress = playTurn(game.board, seat, game.dice, moves);
  if (typeof progress === "string") return progress;
  if (!progress.done) {
    const left = progress.required - moves.length;
    return `Mai ai de mutat ${left} ${left === 1 ? "piesă" : "piese"}.`;
  }

  // Replay to record which moves hit (for the "last move" line).
  const hits: boolean[] = [];
  let b = game.board;
  for (const m of moves) {
    const r = applyMove(b, seat, m);
    hits.push(r.hit);
    b = r.board;
  }

  const lastTurn: LastTurn = { seat, dice: game.dice, moves: [...moves], hits, passed: false };
  if (progress.board.off[seat] === CHECKERS) {
    return {
      ...game,
      board: progress.board,
      phase: "over",
      dice: null,
      opening: null,
      lastTurn,
      winner: seat,
      points: gamePoints(progress.board, other(seat)),
    };
  }
  return { ...game, board: progress.board, turn: other(seat), phase: "roll", dice: null, opening: null, lastTurn };
}

/** The player `loser` gives up the game. The opponent scores as if they had borne off now. */
export function resignGame(game: GameState, loser: Seat): GameState {
  return {
    ...game,
    phase: "over",
    dice: null,
    opening: null,
    winner: other(loser),
    points: gamePoints(game.board, loser),
    lastTurn: { seat: loser, dice: game.dice ?? [0, 0], moves: [], hits: [], passed: false, resigned: true },
  };
}

/** Parses a client-sent move list. Returns null on malformed input. */
export function parseMoves(value: unknown): Move[] | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  const moves: Move[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") return null;
    const { from, die } = v as Record<string, unknown>;
    if (!Number.isInteger(from) || !Number.isInteger(die)) return null;
    if ((from as number) < 1 || (from as number) > BAR || (die as number) < 1 || (die as number) > 6) return null;
    moves.push({ from: from as number, die: die as number });
  }
  return moves;
}
