// Scenario 3 (phone only): no screen may scroll sideways (home, lobby, game), the controls stay big enough to tap,
// and real touch taps play turns (dice, checker, destination, "Confirmă") that reach the other phone live.
// Scenario 1 already plays on the emulated iPhone; this one checks the layout and touch input.
import { expect, test } from "@playwright/test";
import { createRoom, expectNoHorizontalScroll, joinRoom, leaveAll, playTurns, REALTIME_MS, startMatch, withPlayers } from "./helpers";

/** Buttons: Apple / Material recommend 44 px; the Button component has min-h-11 (44 px). */
const MIN_BUTTON_PX = 40;
/**
 * Board points: on a 390 px wide phone a point column is ~23 px wide, but its tap area is the whole half-board
 * height (~135 px), so the area is generous. Keep a floor so a layout change cannot squeeze it further.
 */
const MIN_POINT_W = 20;
const MIN_POINT_H = 100;

test("home, lobby and game fit a phone screen and work by touch", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby fits the screen", async () => {
      room.code = await createRoom(host, 3);
      await joinRoom(guest, room.code);
      for (const p of players) await expectNoHorizontalScroll(p.page);
      const h = await host.page.getByTestId("start-match").evaluate((e) => e.getBoundingClientRect().height);
      expect(h, "start button height").toBeGreaterThanOrEqual(MIN_BUTTON_PX);
    });

    await test.step("game screen fits, controls are big enough to tap", async () => {
      await startMatch(host, [guest]);
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        const h = await p.page.getByTestId("leave").evaluate((e) => e.getBoundingClientRect().height);
        expect(h, `${p.name}'s leave button height`).toBeGreaterThanOrEqual(MIN_BUTTON_PX);
      }
      // The opening player has the board's tap targets.
      const mover = (await host.page.getByTestId("spot-0").count()) > 0 ? host : guest;
      const sizes = await mover.page
        .locator('[data-testid^="spot-"]')
        .evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
      expect(sizes.length).toBe(26); // 24 points + bar + bear-off tray
      expect(Math.min(...sizes.map((s) => s[0])), "narrowest point").toBeGreaterThanOrEqual(MIN_POINT_W);
      expect(Math.min(...sizes.map((s) => s[1])), "shortest point").toBeGreaterThanOrEqual(MIN_POINT_H);
    });

    await test.step("turns played by touch taps reach the other phone live", async () => {
      await playTurns([host, guest], [], room.code, 2, { tap: true });
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    await test.step("the guest leaves mid-match (back to the lobby), then the host, the room closes", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("lobby")).toBeVisible({ timeout: REALTIME_MS });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
