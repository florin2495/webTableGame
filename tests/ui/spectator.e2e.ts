// Scenario 2: someone opens the invite link of a running match. They become a spectator (board without player
// controls), the players see them live, they see every turn live, they queue for the next round ("Intră la runda
// următoare", seen by the players), see the end of the game, and when a seat frees up in the lobby the queue seats
// them. Desktop Chromium only: it checks game logic and Realtime (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, readState, REALTIME_MS, startMatch, withPlayers } from "./helpers";

test("a late joiner watches as a spectator and gets the next free seat", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;
    const member = (p: (typeof players)[number], name: string) =>
      p.page.getByTestId("member-list").locator(`li[data-nickname="${name}"]`);

    await test.step("two players start a match", async () => {
      room.code = await createRoom(host, 1);
      await joinRoom(guest, room.code);
      await startMatch(host, [guest]);
    });

    await test.step("a third person joins mid-game and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-banner")).toBeVisible();
      await expect(sp.getByTestId("play")).toBeVisible();
      for (const id of ["roll", "confirm-turn", "resign", "spot-bar"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      for (const p of [host, guest]) await expect(member(p, spectator.name)).toHaveAttribute("data-seat", "spectator", { timeout: REALTIME_MS });
    });

    await test.step("the spectator sees every turn live", () => playTurns([host, guest], [spectator], room.code, 3));

    await test.step("the spectator queues for the next round, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toContainText("În coadă (locul 1)");
      await expect(member(host, spectator.name)).toHaveAttribute("data-queued", "true", { timeout: REALTIME_MS });
    });

    await test.step("a player resigns, the spectator sees the end of the game", async () => {
      guest.page.once("dialog", (d) => void d.accept());
      await guest.page.getByTestId("resign").click();
      await expect(spectator.page.getByTestId("game-over")).toContainText(`${host.name} câștigă meciul!`, { timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("back-to-lobby")).toHaveCount(0); // host only
    });

    await test.step("back in the lobby the guest leaves: the queued spectator takes the free seat", async () => {
      await host.page.getByTestId("back-to-lobby").click();
      await expect(spectator.page.getByTestId("lobby")).toBeVisible({ timeout: REALTIME_MS });
      await leaveAll([guest]);
      await expect(spectator.page.getByTestId("seat-1")).toContainText(spectator.name, { timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("queue-toggle")).toHaveCount(0);
      await expect(host.page.getByTestId("seat-1")).toContainText(spectator.name, { timeout: REALTIME_MS });
      const s = await readState(spectator, room.code);
      expect(s.me.seat).toBe(1);
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, host]);
      room.closed = true;
    });
  });
});
