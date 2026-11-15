// Scenario 1: two real browsers play a live match on the deployed site: create (password, match to 1 point), join
// by link, start, several real turns played by tapping the board (dice read from the room state, a legal move
// picked with the game's rules), every turn reaching the other screen through Realtime (well under the 60 s
// polling fallback), resign = the game and the match end on both screens, back to the lobby, leave.
// Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, readState, REALTIME_MS, startMatch, withPlayers } from "./helpers";

const TURNS = 6;

test("two players play a live match until it ends", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link and takes Black", async () => {
      room.code = await createRoom(host, 1);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("seat-1")).toContainText(guest.name);
      await expect(host.page.getByTestId("seat-1")).toContainText(guest.name, { timeout: REALTIME_MS });
    });

    await test.step("host starts the match, both see the board", () => startMatch(host, [guest]));

    await test.step(`${TURNS} turns played on the board, each one live on the other screen`, async () => {
      await playTurns([host, guest], [], room.code, TURNS);
      const s = await readState(host, room.code);
      expect(s.game?.lastTurn, "a turn was played").not.toBeNull();
    });

    await test.step("the player on turn resigns: the game and the match end on both screens", async () => {
      const s = await readState(host, room.code);
      const loser = s.players.find((p) => p.seat === s.game!.turn)!.nickname === host.name ? host : guest;
      const winner = loser === host ? guest : host;
      loser.page.once("dialog", (d) => void d.accept());
      await loser.page.getByTestId("resign").click();
      for (const p of [loser, winner]) {
        await expect(p.page.getByTestId("game-over")).toContainText(`${winner.name} câștigă meciul!`, { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("play")).toHaveAttribute("data-status", "finished");
      }
      await expect(winner.page.getByTestId("next-game")).toHaveCount(0); // match to 1 point: over
    });

    await test.step("host goes back to the lobby, the guest follows live", async () => {
      await host.page.getByTestId("back-to-lobby").click();
      await expect(host.page.getByTestId("lobby")).toBeVisible();
      await expect(guest.page.getByTestId("lobby")).toBeVisible({ timeout: REALTIME_MS });
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("seat-1")).toContainText("liber", { timeout: REALTIME_MS });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
