import { describe, expect, it } from "vitest";
import {
  applyMove,
  BAR,
  checkerTotal,
  commitTurn,
  initialBoard,
  isRoomExpired,
  legalNextMoves,
  maxPlayable,
  newGame,
  parseMoves,
  pipCount,
  playTurn,
  resignGame,
  rollTurn,
  singleMoves,
  sumMoves,
  turnRules,
  type Board,
  type GameState,
  type Seat,
} from "./game";

/** Builds a board from mover-relative positions: { white: {pos: count}, black: {pos: count} }. */
function board(
  white: Record<number, number>,
  black: Record<number, number>,
  extra: Partial<Pick<Board, "bar" | "off">> = {},
): Board {
  const points = Array<number>(24).fill(0);
  for (const [pos, n] of Object.entries(white)) points[Number(pos) - 1] += n;
  for (const [pos, n] of Object.entries(black)) points[24 - Number(pos)] -= n;
  const b: Board = { points, bar: extra.bar ?? [0, 0], off: [0, 0] };
  for (const seat of [0, 1] as Seat[]) b.off[seat] = extra.off?.[seat] ?? 15 - checkerTotal(b, seat);
  return b;
}

function seq(...values: number[]) {
  let i = 0;
  return () => values[i++];
}

describe("initial board", () => {
  it("has 15 checkers each and 167 pips each", () => {
    const b = initialBoard();
    expect(checkerTotal(b, 0)).toBe(15);
    expect(checkerTotal(b, 1)).toBe(15);
    expect(b.off).toEqual([0, 0]);
    expect(pipCount(b, 0)).toBe(167);
    expect(pipCount(b, 1)).toBe(167);
  });
});

describe("single moves", () => {
  it("cannot land on a point held by 2+ opponents", () => {
    const b = initialBoard();
    // White 6 on pos 24 lands on 18 (empty) - ok; white 1 from 6 -> 5 ok; 13 - 1 = 12 is black's 13-point (5 black)
    const fives = singleMoves(b, 0, 5).map((m) => m.from);
    expect(fives).toContain(13); // 13 -> 8 own
    expect(fives).not.toContain(24); // 24 -> 19 = black's 6-point
    expect(fives).toContain(8); // 8 -> 3 empty
  });

  it("must enter from the bar first", () => {
    const b = board({ 13: 14 }, { 6: 2, 5: 2 }, { bar: [1, 0] });
    expect(singleMoves(b, 0, 6)).toEqual([]); // enters on 19 = black's 6-point (blocked)
    expect(singleMoves(b, 0, 5)).toEqual([]);
    expect(singleMoves(b, 0, 3)).toEqual([{ from: BAR, die: 3 }]);
  });

  it("hits a blot and sends it to the bar", () => {
    const b = board({ 8: 1 }, { 19: 1 }); // black pos 19 = index 5 = white pos 6
    const r = applyMove(b, 0, { from: 8, die: 2 });
    expect(r.hit).toBe(true);
    expect(r.board.bar[1]).toBe(1);
    expect(r.board.points[5]).toBe(1);
  });

  it("bears off exactly, and with a bigger die only from the highest point", () => {
    const b = board({ 4: 1, 2: 1 }, { 24: 1 });
    // 4/off exactly; 2/off with a 4 is not allowed while a checker stands on 4; 2 -> ... overshoot.
    expect(singleMoves(b, 0, 4)).toEqual([{ from: 4, die: 4 }]);
    expect(singleMoves(b, 0, 2)).toEqual([{ from: 4, die: 2 }, { from: 2, die: 2 }].sort((a, c) => a.from - c.from));
    expect(singleMoves(b, 0, 6)).toEqual([{ from: 4, die: 6 }]);
  });

  it("does not bear off while a checker is outside home", () => {
    const b = board({ 7: 1, 1: 1 }, { 24: 1 });
    expect(singleMoves(b, 0, 1)).toContainEqual({ from: 7, die: 1 });
    expect(singleMoves(b, 0, 1)).not.toContainEqual({ from: 1, die: 1 });
  });
});

describe("turn rules", () => {
  it("doubles play four times", () => {
    expect(turnRules(initialBoard(), 0, [3, 3]).required).toBe(4);
  });

  it("must play both dice when possible", () => {
    // White on 10 alone. 6 then 1 or 1 then 6; black blocks 4 and 9 so only 10/4? No - blocks 9 -> 1 first is blocked.
    const b = board({ 10: 1 }, { 16: 2 }); // black pos 16 = white pos 9 blocked
    // 1 first -> 9 blocked. 6 first -> 4, then 1 -> 3. So required 2 and the first move must be the 6.
    const r = turnRules(b, 0, [6, 1]);
    expect(r.required).toBe(2);
    expect(legalNextMoves(b, 0, [6, 1], 2)).toEqual([{ from: 10, die: 6 }]);
  });

  it("larger die rule", () => {
    // Only one checker, on 12. 6 -> 6 open, 5 -> 7 open; after 12/6 the 5 lands on 1 (blocked);
    // after 12/7 the 6 lands on 1 (blocked). Only one die can be played -> must play the 6.
    const b = board({ 12: 1 }, { 24: 2 }); // black pos 24 = white pos 1
    const r = turnRules(b, 0, [6, 5]);
    expect(r).toEqual({ required: 1, forceDie: 6 });
    expect(legalNextMoves(b, 0, [6, 5], 1, r.forceDie)).toEqual([{ from: 12, die: 6 }]);
  });

  it("no legal move -> required 0", () => {
    const b = board({ 13: 14 }, { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 }, { bar: [1, 0] });
    // Black holds white pos 19..24 (black pos 6..1): white cannot enter at all.
    expect(maxPlayable(b, 0, [6, 6, 6, 6])).toBe(0);
    expect(turnRules(b, 0, [4, 2]).required).toBe(0);
  });
});

describe("playTurn / commitTurn", () => {
  it("plays the standard 3-1 opening (8/5 6/5)", () => {
    const g: GameState = { ...newGame(1, seq(3, 1)) };
    expect(g.turn).toBe(0);
    expect(g.phase).toBe("move");
    const next = commitTurn(g, [
      { from: 8, die: 3 },
      { from: 6, die: 1 },
    ]);
    if (typeof next === "string") throw new Error(next);
    expect(next.turn).toBe(1);
    expect(next.phase).toBe("roll");
    expect(next.board.points[4]).toBe(2); // white pos 5
  });

  it("rejects an incomplete turn and an illegal move", () => {
    const g = newGame(1, seq(3, 1));
    expect(commitTurn(g, [{ from: 8, die: 3 }])).toMatch(/Mai ai de mutat 1 piesă/);
    expect(commitTurn(g, [{ from: 24, die: 6 }, { from: 6, die: 1 }])).toBe("Mutare nepermisă.");
  });

  it("black moves the other way and opening chooses the higher die", () => {
    const g = newGame(1, seq(2, 5)); // white 2, black 5 -> black starts
    expect(g.turn).toBe(1);
    const p = playTurn(g.board, 1, g.dice!, [{ from: 13, die: 5 }]);
    if (typeof p === "string") throw new Error(p);
    expect(p.board.points[indexBlack(8)]).toBe(-4); // 3 + 1
  });

  it("passes the turn when the roll has no legal move", () => {
    const b = board({ 13: 14 }, { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 }, { bar: [1, 0] });
    const g: GameState = { ...newGame(1, seq(3, 1)), board: b, turn: 0, phase: "roll", dice: null };
    const r = rollTurn(g, seq(4, 2));
    expect(r.turn).toBe(1);
    expect(r.phase).toBe("roll");
    expect(r.lastTurn?.passed).toBe(true);
  });

  it("wins with a marț (2 points) when the loser bore off nothing", () => {
    const b = board({ 1: 1 }, { 13: 15 });
    const g: GameState = { ...newGame(1, seq(3, 1)), board: b, turn: 0, phase: "move", dice: [6, 5] };
    const r = commitTurn(g, [{ from: 1, die: 6 }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.phase).toBe("over");
    expect(r.winner).toBe(0);
    expect(r.points).toBe(2);
  });

  it("single point win when the loser bore off at least one", () => {
    const b = board({ 2: 1 }, { 1: 14 });
    const g: GameState = { ...newGame(1, seq(3, 1)), board: b, turn: 0, phase: "move", dice: [2, 1] };
    // Bearing off directly with the 2 would leave the 1 unused: both dice must be played.
    expect(commitTurn(g, [{ from: 2, die: 2 }])).toBe("Mutare nepermisă.");
    const r = commitTurn(g, [{ from: 2, die: 1 }, { from: 1, die: 2 }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.points).toBe(1);
  });

  it("resign gives the opponent the game", () => {
    const g = newGame(1, seq(3, 1));
    const r = resignGame(g, 0);
    expect(r.winner).toBe(1);
    expect(r.points).toBe(2);
  });
});

describe("moving a checker by the sum of the dice", () => {
  const dests = (r: ReturnType<typeof sumMoves>) => r.map((x) => x.dest).sort((a, b) => b - a);

  it("offers the sum point for two different dice", () => {
    const b = board({ 13: 1, 6: 14 }, {});
    const r = sumMoves(b, 0, [3, 5], [], 13);
    expect(dests(r)).toEqual([5]);
    expect(r[0].moves).toHaveLength(2);
    expect(r[0].moves[0].from).toBe(13);
  });

  it("uses the only order whose intermediate point is open", () => {
    // Black holds white's point 10 (black pos 15): 3 first is blocked, 5 first then 3 works.
    const b = board({ 13: 1, 6: 14 }, { 15: 2 });
    expect(sumMoves(b, 0, [3, 5], [], 13)).toEqual([{ dest: 5, moves: [{ from: 13, die: 5 }, { from: 8, die: 3 }], hits: 0 }]);
  });

  it("offers nothing when both intermediate points are blocked", () => {
    // White pos 10 (black 15) and 8 (black 17) blocked; another checker keeps the turn playable.
    const b = board({ 13: 1, 20: 1 }, { 15: 2, 17: 2 });
    expect(turnRules(b, 0, [3, 5]).required).toBe(2);
    expect(sumMoves(b, 0, [3, 5], [], 13)).toEqual([]);
  });

  it("prefers the order that does not hit when both reach the same point", () => {
    const b = board({ 13: 1, 6: 14 }, { 15: 1 }); // blot on white's 10
    const r = sumMoves(b, 0, [3, 5], [], 13);
    expect(r).toEqual([{ dest: 5, moves: [{ from: 13, die: 5 }, { from: 8, die: 3 }], hits: 0 }]);
  });

  it("hits on the intermediate point when that is the only order", () => {
    const b = board({ 13: 1, 6: 14 }, { 15: 1, 17: 2 }); // blot on 10, 8 blocked
    const r = sumMoves(b, 0, [3, 5], [], 13);
    expect(r).toEqual([{ dest: 5, moves: [{ from: 13, die: 3 }, { from: 10, die: 5 }], hits: 1 }]);
    const g: GameState = { ...newGame(1), board: b, turn: 0, phase: "move", dice: [3, 5], opening: null };
    const next = commitTurn(g, r[0].moves);
    expect(typeof next).not.toBe("string");
    if (typeof next !== "string") {
      expect(next.board.bar[1]).toBe(1);
      expect(next.lastTurn?.hits).toEqual([true, false]);
    }
  });

  it("doubles go two, three and four steps", () => {
    const b = board({ 20: 1 }, {});
    const r = sumMoves(b, 0, [4, 4], [], 20);
    expect(dests(r)).toEqual([12, 8, 4]);
    expect(r.map((x) => x.moves.length).sort()).toEqual([2, 3, 4]);
    // After one step has been played, fewer remain.
    const after = sumMoves(b, 0, [4, 4], [{ from: 20, die: 4 }], 16);
    expect(dests(after)).toEqual([8, 4]);
  });

  it("stops at a blocked point when doubles run into it", () => {
    const b = board({ 20: 1, 6: 14 }, { 17: 2 }); // black holds white's 8
    expect(dests(sumMoves(b, 0, [4, 4], [], 20))).toEqual([12]);
  });

  it("enters from the bar and continues with the other die", () => {
    const b = board({ 13: 1, 6: 14 }, {}, { bar: [1, 0] });
    const r = sumMoves(b, 0, [3, 5], [], BAR);
    expect(dests(r)).toEqual([17]);
    expect(r[0].moves[0].from).toBe(BAR);
    expect(sumMoves(b, 0, [3, 5], [], 13)).toEqual([]); // the bar must be entered first
  });

  it("bears off with the sum", () => {
    const b = board({ 3: 1 }, {});
    const r = sumMoves(b, 0, [1, 2], [], 3);
    expect(dests(r)).toEqual([0]);
    expect(r[0].moves).toHaveLength(2);
  });

  it("respects the larger-die and must-use-both rules", () => {
    // Only one die can be played -> no sum.
    expect(sumMoves(board({ 12: 1 }, { 24: 2 }), 0, [6, 5], [], 12)).toEqual([]);
    // Must play both dice: 1 first is blocked, so the sum is only reachable as 6 then 1.
    const b = board({ 10: 1 }, { 16: 2 });
    expect(sumMoves(b, 0, [6, 1], [], 10)).toEqual([{ dest: 3, moves: [{ from: 10, die: 6 }, { from: 4, die: 1 }], hits: 0 }]);
  });

  it("black uses the same logic in its own direction", () => {
    const b = board({ 6: 14 }, { 13: 1 });
    expect(dests(sumMoves(b, 1, [2, 3], [], 13))).toEqual([8]);
  });
});

describe("misc", () => {
  it("parses moves defensively", () => {
    expect(parseMoves([{ from: 8, die: 3 }])).toEqual([{ from: 8, die: 3 }]);
    expect(parseMoves([{ from: 0, die: 3 }])).toBeNull();
    expect(parseMoves([{ from: 8, die: 7 }])).toBeNull();
    expect(parseMoves("x")).toBeNull();
    expect(parseMoves([1, 2, 3, 4, 5])).toBeNull();
  });

  it("expires lobby rooms fast and playing rooms slowly", () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60_000);
    const fifteenMinAgo = new Date(now - 15 * 60_000);
    expect(isRoomExpired("lobby", fiveMinAgo, now)).toBe(false);
    expect(isRoomExpired("lobby", fifteenMinAgo, now)).toBe(true);
    expect(isRoomExpired("playing", fifteenMinAgo, now)).toBe(false);
  });

  it("doubles enumerate quickly", () => {
    const t = performance.now();
    for (const d of [1, 2, 3, 4, 5, 6]) legalNextMoves(initialBoard(), 0, [d, d, d, d], 4);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

function indexBlack(pos: number) {
  return 24 - pos;
}
