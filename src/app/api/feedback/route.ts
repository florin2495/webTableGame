import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";

const GAME_SLUG = "backgammon";
const MESSAGE_MAX = 1000;
const NICKNAME_MAX = 40;

// POST /api/feedback - stores a short player message in the hub-owned `hub_feedback` table.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // Honeypot: bots fill the hidden field; pretend success without storing anything.
    if (typeof body.website === "string" && body.website.trim() !== "") return { ok: true };

    if (typeof body.message !== "string") fail(400, "Mesajul lipsește.");
    const message = body.message.trim();
    if (message.length < 1 || message.length > MESSAGE_MAX) {
      fail(400, `Mesajul trebuie să aibă 1-${MESSAGE_MAX} caractere.`);
    }
    let nickname: string | null = null;
    if (body.nickname != null) {
      if (typeof body.nickname !== "string") fail(400, "Poreclă invalidă.");
      nickname = body.nickname.trim() || null;
      if (nickname && nickname.length > NICKNAME_MAX) fail(400, `Porecla poate avea cel mult ${NICKNAME_MAX} caractere.`);
    }

    const { error } = await db().from("hub_feedback").insert({
      game: GAME_SLUG,
      message,
      nickname,
      app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    });
    if (error) throw error;
    return { ok: true };
  });
}
