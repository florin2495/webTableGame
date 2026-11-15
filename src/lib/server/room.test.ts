// cleanupAbandonedRooms with the Supabase client mocked: no DB, only the queries it builds and what it deletes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DbModule from "./db";

interface Result {
  data?: unknown;
  error?: unknown;
}
interface Op {
  method: string;
  args: unknown[];
}
interface Query {
  table: string;
  ops: Op[];
}
interface Builder extends PromiseLike<Result> {
  select(...args: unknown[]): Builder;
  delete(...args: unknown[]): Builder;
  lt(...args: unknown[]): Builder;
  limit(...args: unknown[]): Builder;
  in(...args: unknown[]): Builder;
  eq(...args: unknown[]): Builder;
}

// Every from() records its chained calls; awaiting it yields the next queued result.
const fake = vi.hoisted(() => {
  const queries: Query[] = [];
  const results: Result[] = [];
  const from = (table: string): Builder => {
    const q: Query = { table, ops: [] };
    queries.push(q);
    const result = results.shift() ?? { data: null, error: null };
    const builder: Builder = {
      select: (...args) => record("select", args),
      delete: (...args) => record("delete", args),
      lt: (...args) => record("lt", args),
      limit: (...args) => record("limit", args),
      in: (...args) => record("in", args),
      eq: (...args) => record("eq", args),
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    function record(method: string, args: unknown[]): Builder {
      q.ops.push({ method, args });
      return builder;
    }
    return builder;
  };
  return { queries, results, client: { from } };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  db: () => fake.client,
}));

import { ROOM_ABANDONED_MS } from "@/lib/game";
import { PLAYERS, ROOMS } from "./db";
import { cleanupAbandonedRooms } from "./room";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const CUTOFF = new Date(NOW - ROOM_ABANDONED_MS).toISOString();
const room = (id: string, lastActivity: string, seen: (string | null)[] | null) => ({
  id,
  last_activity_at: lastActivity,
  [PLAYERS]: seen === null ? null : seen.map((last_seen_at) => ({ last_seen_at })),
});
const op = (q: Query, method: string) => q.ops.find((o) => o.method === method)?.args;

beforeEach(() => {
  fake.queries.length = 0;
  fake.results.length = 0;
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanupAbandonedRooms", () => {
  it("selects only rooms idle for ROOM_ABANDONED_MS (600 s), with their members' last_seen_at", async () => {
    fake.results.push({ data: [], error: null });
    await cleanupAbandonedRooms();
    expect(fake.queries).toHaveLength(1);
    const [select] = fake.queries;
    expect(select.table).toBe(ROOMS);
    expect(String(op(select, "select")?.[0])).toContain("last_seen_at");
    expect(op(select, "lt")).toEqual(["last_activity_at", CUTOFF]);
    expect(op(select, "limit")).toEqual([200]);
  });

  it("deletes silent rooms and keeps rooms with a member seen recently", async () => {
    fake.results.push(
      {
        data: [
          room("silent", ago(1200), [ago(900), ago(700)]),
          room("empty", ago(700), []),
          room("no-embed", ago(700), null),
          room("never-seen", ago(700), [null]),
          room("player-here", ago(1200), [ago(900), ago(30)]),
          room("spectator-here", ago(3600), [ago(3600), ago(3600), ago(599)]),
        ],
        error: null,
      },
      { error: null },
    );
    await cleanupAbandonedRooms();
    expect(fake.queries).toHaveLength(2);
    const del = fake.queries[1];
    expect(del.table).toBe(ROOMS);
    expect(op(del, "delete")).toBeDefined();
    expect(op(del, "in")).toEqual(["id", ["silent", "empty", "no-embed", "never-seen"]]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("re-checks the activity cutoff in the delete, so a room touched meanwhile survives", async () => {
    fake.results.push({ data: [room("silent", ago(1200), [])], error: null }, { error: null });
    await cleanupAbandonedRooms();
    expect(op(fake.queries[1], "lt")).toEqual(["last_activity_at", CUTOFF]);
  });

  it("does not delete anything when every room still has someone", async () => {
    fake.results.push({ data: [room("a", ago(1200), [ago(10)]), room("b", ago(900), [ago(300)])], error: null });
    await cleanupAbandonedRooms();
    expect(fake.queries).toHaveLength(1);
  });

  it("logs a failed select instead of throwing, and deletes nothing", async () => {
    fake.results.push({ data: null, error: { message: "boom" } });
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(fake.queries).toHaveLength(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("logs a failed delete instead of throwing", async () => {
    fake.results.push({ data: [room("silent", ago(1200), [])], error: null }, { error: { message: "boom" } });
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(fake.queries).toHaveLength(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
