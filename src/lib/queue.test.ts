import { describe, expect, it } from "vitest";
import { pickPromotions, queueOrder, queuePosition, validateSeatOrder } from "./queue";

describe("validateSeatOrder", () => {
  it("accepts a full permutation", () => {
    expect(validateSeatOrder(["a", "b"], ["b", "a"])).toEqual(["b", "a"]);
    expect(validateSeatOrder(["a"], ["a"])).toEqual(["a"]);
  });
  it("rejects partial, duplicate, foreign and malformed orders", () => {
    expect(validateSeatOrder(["a", "b"], ["a"])).toBeNull();
    expect(validateSeatOrder(["a", "b"], ["a", "a"])).toBeNull();
    expect(validateSeatOrder(["a", "b"], ["a", "c"])).toBeNull();
    expect(validateSeatOrder(["a", "b"], ["a", "b", "c"])).toBeNull();
    expect(validateSeatOrder(["a", "b"], "ab")).toBeNull();
    expect(validateSeatOrder(["a", "b"], ["a", 2])).toBeNull();
  });
});

describe("spectator queue", () => {
  const s = [
    { id: "x", queued_at: "2026-01-01T00:00:03Z" },
    { id: "y", queued_at: null },
    { id: "z", queued_at: "2026-01-01T00:00:01Z" },
  ];
  it("orders by request time and skips the unqueued", () => {
    expect(queueOrder(s).map((p) => p.id)).toEqual(["z", "x"]);
    expect(queuePosition(s, "x")).toBe(2);
    expect(queuePosition(s, "y")).toBeNull();
  });
  it("fills free seats in queue order, rest stay spectators", () => {
    expect(pickPromotions([1], s)).toEqual([{ id: "z", seat: 1 }]);
    expect(pickPromotions([1, 0], s)).toEqual([
      { id: "z", seat: 0 },
      { id: "x", seat: 1 },
    ]);
    expect(pickPromotions([], s)).toEqual([]);
  });
});
