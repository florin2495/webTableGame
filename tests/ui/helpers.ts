// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// Dice are random: every turn reads the room state (/state with the player's stored token) and picks a legal
// move with the game's own rules (src/lib/game.ts), then plays it by tapping the board like a person would.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BAR, indexOf, playTurn, type Move, type Seat } from "../../src/lib/game";
import type { RoomState } from "../../src/lib/types";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 60 s. */
export const REALTIME_MS = 5_000;
export const PASSWORD = "pw";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    // No checker slide animation: the board's click targets are hidden while a checker slides.
    reducedMotion: "reduce",
  });
  return { name, context, page: await context.newPage() };
}

/** Host creates a password-protected room from the home page; returns its code. */
export async function createRoom(host: Player, matchTo = 1): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Parolă (opțional)").fill(PASSWORD);
  await page.locator("select").selectOption(String(matchTo));
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  await expect(page.getByTestId("lobby")).toBeVisible();
  return page.url().match(/\/room\/([A-Z0-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (takes a free seat, or becomes a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByLabel("Parolă (dacă are camera)").fill(PASSWORD);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
}

/** Host starts the match from the lobby; every player sees the board within REALTIME_MS. */
export async function startMatch(host: Player, others: Player[]): Promise<void> {
  await expect(host.page.getByTestId("start-match")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-match").click();
  await expect(host.page.getByTestId("play")).toBeVisible();
  for (const p of others) await expect(p.page.getByTestId("play")).toBeVisible({ timeout: REALTIME_MS });
}

/** The player's room state, read with the token the page stored in localStorage. */
export async function readState(p: Player, code: string): Promise<RoomState> {
  const token = await p.page.evaluate((c) => JSON.parse(localStorage.getItem(`table:session:${c}`) ?? "{}").token as string, code);
  const res = await p.page.request.get(`api/rooms/${code}/state`, { headers: { "x-player-token": token } });
  expect(res.status(), "GET /state").toBe(200);
  return (await res.json()) as RoomState;
}

const spotOf = (seat: Seat, from: number) => (from === BAR ? "bar" : String(indexOf(seat, from)));
const destOf = (seat: Seat, m: Move) => (m.from - m.die <= 0 ? "off" : String(indexOf(seat, m.from - m.die)));

/**
 * The player on turn plays one whole turn through the UI: rolls if needed (a roll with no legal move passes the
 * turn by itself), then for every die taps a checker and its destination, then "Confirmă".
 * Returns the room version after the turn (to check that the other screens reach it).
 */
export async function playOneTurn(p: Player, code: string, { tap = false } = {}): Promise<number> {
  const press = (testId: string) => (tap ? p.page.getByTestId(testId).tap() : p.page.getByTestId(testId).click());
  let s = await readState(p, code);
  const seat = s.me.seat;
  if (seat === null || s.game?.turn !== seat) throw new Error(`${p.name} is not on turn`);

  if (s.game.phase === "roll") {
    const [res] = await Promise.all([
      p.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/roll`) && r.request().method() === "POST"),
      press("roll"),
    ]);
    expect(res.status(), "roll").toBe(200);
    s = ((await res.json()) as { state: RoomState }).state;
    if (s.game?.turn !== seat || s.game.phase !== "move") return s.room.version; // no legal move: turn passed
  }

  const game = s.game!;
  const moves: Move[] = [];
  for (;;) {
    const progress = playTurn(game.board, seat, game.dice!, moves);
    if (typeof progress === "string") throw new Error(`illegal local turn: ${progress}`);
    if (progress.done) break;
    const pick = progress.next[0];
    const src = spotOf(seat, pick.from);
    const dst = destOf(seat, pick);
    // The board plays the smallest die that takes the selected checker to the tapped point: mirror that.
    const played = progress.next.filter((m) => m.from === pick.from && destOf(seat, m) === dst).sort((a, b) => a.die - b.die)[0];
    await press(`spot-${src}`);
    await press(`spot-${dst}`);
    moves.push(played);
  }

  const [res] = await Promise.all([
    p.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/move`) && r.request().method() === "POST"),
    press("confirm-turn"),
  ]);
  expect(res.status(), `move ${JSON.stringify(moves)}`).toBe(200);
  return ((await res.json()) as { state: RoomState }).state.room.version;
}

/** Every screen shows the given room version (i.e. got the change live). */
export async function expectVersion(players: Player[], version: number): Promise<void> {
  for (const p of players) {
    await expect(p.page.getByTestId("play"), `${p.name} sees version ${version}`).toHaveAttribute("data-version", String(version), {
      timeout: REALTIME_MS,
    });
  }
}

/** Plays `turns` turns, whoever is on turn, checking every turn reaches `watchers` (everyone else) live. */
export async function playTurns(seated: [Player, Player], watchers: Player[], code: string, turns: number, opts = {}): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const s = await readState(seated[0], code);
    if (s.room.status !== "playing") return;
    const onTurn = s.players.find((x) => x.seat === s.game!.turn)!;
    const mover = seated.find((p) => p.name === onTurn.nickname)!;
    const version = await playOneTurn(mover, code, opts);
    await expectVersion([...seated, ...watchers].filter((p) => p !== mover), version);
  }
}

/** Leaves through the "Părăsește" button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/backgammon_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
