import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_ENFORCE_MS, KICK_GRACE_MS, kickExpiryCutoff, kickRemainingMs } from "./kick";

const T0 = Date.parse("2026-11-07T10:00:00.000Z");
const at = new Date(T0).toISOString();

describe("kickRemainingMs", () => {
  it("is null when no kick is pending", () => {
    expect(kickRemainingMs(null, T0)).toBeNull();
  });
  it("counts down from the grace period", () => {
    expect(kickRemainingMs(at, T0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(at, T0 + 4000)).toBe(6000);
    expect(kickRemainingMs(at, T0 + KICK_GRACE_MS)).toBe(0);
  });
  it("clamps to [0, KICK_GRACE_MS]", () => {
    expect(kickRemainingMs(at, T0 + 60_000)).toBe(0);
    expect(kickRemainingMs(at, T0 - 5000)).toBe(KICK_GRACE_MS); // clock skew: request "in the future"
  });
  it("ignores an unparsable timestamp", () => {
    expect(kickRemainingMs("nope", T0)).toBeNull();
  });
});

describe("isKickExpired", () => {
  it("is false without a pending kick", () => {
    expect(isKickExpired(null, T0)).toBe(false);
  });
  it("allows the 2 s network margin after the visible countdown", () => {
    expect(isKickExpired(at, T0 + KICK_GRACE_MS + 1)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS + 1)).toBe(true);
  });
  it("matches kickExpiryCutoff", () => {
    const now = T0 + 30_000;
    expect(kickExpiryCutoff(now)).toBe(new Date(now - KICK_ENFORCE_MS).toISOString());
  });
});
