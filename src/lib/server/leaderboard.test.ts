import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isTestRoom, playerKey } from "./leaderboard";

describe("isTestRoom", () => {
  it("matches the rooms of scripts/e2e.mjs and tests/ui", () => {
    expect(isTestRoom("e2e-test-m1abc")).toBe(true);
    expect(isTestRoom("e2e-test-ui-m1abc")).toBe(true);
    expect(isTestRoom("e2e-test-bad")).toBe(true);
  });
  it("lets real rooms through", () => {
    expect(isTestRoom("Masa lui Ana")).toBe(false);
    expect(isTestRoom("e2e test")).toBe(false);
    expect(isTestRoom("my-e2e-test-room")).toBe(false);
    expect(isTestRoom("")).toBe(false);
  });
});

describe("playerKey", () => {
  it("trims and lowercases the nickname", () => {
    expect(playerKey("  Ana ")).toBe("ana");
  });
});
