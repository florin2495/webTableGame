// End-to-end test of the Table (backgammon) API with real players.
// Usage: node scripts/e2e.mjs [baseUrl incl. /backgammon]   (default: production)
// Two players + two spectators. Every room is named "e2e-test-..." and removed at the end (everyone leaves,
// then a DB delete of leftovers as a safety net: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else
// .env.local). Sends nothing to /api/feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/backgammon").replace(/\/$/, "");
const BASE_PATH = new URL(BASE).pathname;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;

// ---------------------------------------------------------------------------
// Minimal copy of the rules (src/lib/game.ts) to pick a legal turn. The server re-checks everything.
// ---------------------------------------------------------------------------
const BAR = 25;
const sign = (s) => (s === 0 ? 1 : -1);
const idx = (s, pos) => (s === 0 ? pos - 1 : 24 - pos);
const ownAt = (b, s, pos) => (pos === BAR ? b.bar[s] : Math.max(0, b.points[idx(s, pos)] * sign(s)));
const oppAt = (b, s, pos) => Math.max(0, -b.points[idx(s, pos)] * sign(s));
function allHome(b, s) {
  if (b.bar[s] > 0) return false;
  for (let p = 7; p <= 24; p++) if (ownAt(b, s, p) > 0) return false;
  return true;
}
function singleMoves(b, s, die) {
  if (b.bar[s] > 0) return oppAt(b, s, BAR - die) < 2 ? [{ from: BAR, die }] : [];
  const out = [];
  const home = allHome(b, s);
  for (let pos = 1; pos <= 24; pos++) {
    if (ownAt(b, s, pos) === 0) continue;
    const to = pos - die;
    if (to >= 1) {
      if (oppAt(b, s, to) < 2) out.push({ from: pos, die });
    } else if (home) {
      let higher = false;
      for (let p = pos + 1; p <= 6; p++) if (ownAt(b, s, p) > 0) higher = true;
      if (to === 0 || !higher) out.push({ from: pos, die });
    }
  }
  return out;
}
function applyMove(b, s, m) {
  const points = [...b.points];
  const bar = [...b.bar];
  const off = [...b.off];
  if (m.from === BAR) bar[s]--;
  else points[idx(s, m.from)] -= sign(s);
  const to = m.from - m.die;
  if (to <= 0) off[s]++;
  else {
    const i = idx(s, to);
    if (points[i] === -sign(s)) {
      points[i] = 0;
      bar[1 - s]++;
    }
    points[i] += sign(s);
  }
  return { points, bar, off };
}
const expand = (d) => (d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : [...d]);
const without = (dice, die) => {
  const i = dice.indexOf(die);
  return [...dice.slice(0, i), ...dice.slice(i + 1)];
};
function pips(b, s) {
  let t = b.bar[s] * BAR;
  for (let p = 1; p <= 24; p++) t += ownAt(b, s, p) * p;
  return t;
}
/** Every maximal move sequence; the best one (most dice, larger die when only one, then lowest pip count + most off). */
function pickTurn(b, s, dice) {
  const seqs = [];
  const walk = (board, rem, path) => {
    let moved = false;
    for (const die of new Set(rem)) {
      for (const m of singleMoves(board, s, die)) {
        moved = true;
        walk(applyMove(board, s, m), without(rem, die), [...path, m]);
      }
    }
    if (!moved) seqs.push({ path, board });
  };
  walk(b, expand(dice), []);
  const max = Math.max(...seqs.map((q) => q.path.length));
  let ok = seqs.filter((q) => q.path.length === max);
  if (max === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice);
    if (ok.some((q) => q.path[0].die === hi)) ok = ok.filter((q) => q.path[0].die === hi);
  }
  const score = (q) => pips(q.board, s) - 2 * q.board.off[s];
  ok.sort((a, b2) => score(a) - score(b2));
  return { moves: ok[0].path, required: max };
}

// ---------------------------------------------------------------------------

async function httpChecks() {
  console.log("HTTP");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200, `GET ${BASE} = ${page.status}`);
  const origin = new URL(BASE).origin;
  // The settings panel (with the version) is only on the room page: collect the chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/ABCDEF`)).text();
  const assetRe = new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\]+\\.(?:js|css)`, "g");
  const assets = [...new Set((html + roomHtml).match(assetRe) ?? [])];
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(origin + a)).status));
  check(assets.length > 0 && statuses.every((s) => s === 200), `${assets.length} /_next assets 200`);
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of assets.filter((x) => x.endsWith(".js"))) {
    if ((await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  }
  check(hasVersion, `client JS contains version ${version}`);
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url?.startsWith("/backgammon"), `manifest 200, start_url ${manifest?.start_url}`);
  const icons = manifest?.icons ?? [];
  const iconStatuses = await Promise.all(icons.map(async (i) => (await fetch(new URL(i.src, BASE + "/").href.replace(/\/backgammon\/backgammon/, "/backgammon"))).status));
  check(icons.length > 0 && iconStatuses.every((s) => s === 200), `${icons.length} manifest icons 200`);
  check((await fetch(`${BASE}/icon.svg`)).status === 200, "icon.svg 200");
  check((await fetch(`${BASE}/room/ABCDEF`)).status === 200, "GET /room/ABCDEF = 200");
  if (origin !== "https://web-table-game.vercel.app" && !origin.includes("localhost")) {
    const v = await fetch("https://web-table-game.vercel.app/backgammon");
    const vh = await v.text();
    const vAssets = [...new Set(vh.match(/\/backgammon\/_next\/static\/[^"']+\.js/g) ?? [])].sort();
    const hubAssets = [...new Set(html.match(/\/backgammon\/_next\/static\/[^"']+\.js/g) ?? [])].sort();
    check(v.status === 200 && vAssets.join() === hubAssets.join(), "web-table-game.vercel.app/backgammon serves the same build");
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();
  const stamp = Date.now().toString(36);

  console.log("Room, join, seats, settings");
  const devA = randomUUID();
  const r = await call("/api/rooms", { body: { name: `e2e-test-${stamp}`, nickname: "Ana", password: "pw", matchTo: 3, deviceId: devA } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana", deviceId: devA };
  check((await call("/api/rooms", { body: { name: "e2e-test-bad", nickname: "Ana", matchTo: 4 } })).status === 400, "matchTo 4 = 400");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  const join = async (nickname, deviceId = randomUUID()) => {
    const res = await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId } });
    return { ...res.data, status: res.status, name: nickname, deviceId };
  };
  const B = await join("Bob");
  check(B.status === 200 && B.seat === 1, "Bob joins and takes the black seat");
  const C = await join("Cris");
  const D = await join("Dan");
  check(C.seat === null && D.seat === null, "Cris and Dan join as spectators");
  check((await join("bob")).status === 409, "nickname of a connected member from another device = 409");
  const list = await call("/api/rooms");
  const item = list.data.rooms?.find((x) => x.code === code);
  check(item?.hasPassword && item.seated === 2 && item.spectators === 2 && item.matchTo === 3, "room in the public list (password, 2 seated, 2 spectators)");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { matchTo: 5 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { matchTo: 2 } })).status === 400, "matchTo 2 = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { matchTo: 3 } })).status === 200, "host sets match to 3");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { seat: 1 } })).status === 409, "spectator takes an occupied seat = 409");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { seat: null } })).status === 200, "Bob stands up");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with one seated player = 409");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: {} })).status === 409, "seated player queue = 409");
  const qc = await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} });
  let s0 = await state(code, A);
  check(qc.status === 200 && s0.players.find((p) => p.id === C.playerId)?.seat === 1, "queued spectator takes the free seat right away (lobby)");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { seat: null } })).status === 200, "Cris stands up again");
  s0 = await state(code, C);
  check(s0.me.seat === null && s0.me.queued === false, "Cris is a plain spectator again");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { seat: 1 } })).status === 200, "Bob sits back on black");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { seat: 7 } })).status === 400, "seat 7 = 400");

  console.log("Rejoin in the lobby");
  const reB = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: B.deviceId } });
  check(reB.status === 200 && reB.data.playerId === B.playerId && reB.data.seat === 1, "Bob rejoins from the same device, same seat");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token is dead");
  B.token = reB.data.token;
  const reC = await call(`/api/rooms/${code}/join`, { body: { nickname: "Cris", password: "pw", deviceId: C.deviceId } });
  check(reC.status === 200 && reC.data.playerId === C.playerId && reC.data.seat === null, "spectator Cris rejoins from the same device, still a spectator");
  C.token = reC.data.token;

  console.log("Start");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start twice = 409");
  let s = await state(code, A);
  check(s.room.status === "playing" && s.game.phase === "move" && s.game.opening?.[0] !== s.game.opening?.[1], "opening roll: different dice, starter moves");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { seat: null } })).status === 409, "seat change mid-game = 409");

  const bySeat = [A, B];
  const onTurn = () => bySeat[s.game.turn];
  const offTurn = () => bySeat[1 - s.game.turn];

  console.log("Invalid moves");
  check((await call(`/api/rooms/${code}/move`, { token: offTurn().token, body: { moves: [] } })).status === 409, "move out of turn = 409");
  check((await call(`/api/rooms/${code}/roll`, { token: offTurn().token, body: {} })).status === 409, "roll out of turn = 409");
  check((await call(`/api/rooms/${code}/roll`, { token: onTurn().token, body: {} })).status === 409, "roll while dice are on the table = 409");
  check((await call(`/api/rooms/${code}/move`, { token: C.token, body: { moves: [] } })).status === 403, "spectator move = 403");
  check((await call(`/api/rooms/${code}/move`, { token: "forged-token", body: { moves: [] } })).status === 401, "forged token = 401");
  check((await call(`/api/rooms/${code}/move`, { token: onTurn().token, body: { moves: "x" } })).status === 400, "malformed moves = 400");
  check((await call(`/api/rooms/${code}/move`, { token: onTurn().token, body: { moves: [{ from: 3, die: s.game.dice[0] }, { from: 3, die: s.game.dice[1] }] } })).status === 409, "moving from an empty point = 409");
  check((await call(`/api/rooms/${code}/move`, { token: onTurn().token, body: { moves: [] } })).status === 409, "incomplete turn = 409");

  console.log("Play game 1 to the end");
  let turns = 0;
  let hitsSeen = 0;
  let passes = 0;
  let consistent = true;
  let rejoinedMidGame = false;
  while (s.room.status === "playing" && turns < 400) {
    const me = onTurn();
    if (s.game.phase === "roll") {
      const rr = await call(`/api/rooms/${code}/roll`, { token: me.token, body: {} });
      if (rr.status !== 200) {
        check(false, `roll failed ${rr.status} ${rr.data.error}`);
        break;
      }
      s = rr.data.state ?? (await state(code, me));
      if (s.game.phase === "roll" && s.game.lastTurn?.passed) passes++;
      continue;
    }
    const seat = s.game.turn;
    const { moves } = pickTurn(s.game.board, seat, s.game.dice);
    const res = await call(`/api/rooms/${code}/move`, { token: me.token, body: { moves } });
    if (res.status !== 200) {
      check(false, `legal turn rejected ${res.status} ${res.data.error} dice=${s.game.dice} moves=${JSON.stringify(moves)}`);
      break;
    }
    turns++;
    s = res.data.state ?? (await state(code, me));
    hitsSeen += s.game.lastTurn?.hits?.filter(Boolean).length ?? 0;
    if (turns % 15 === 0) {
      const views = await Promise.all([A, B, C, D].map((p) => state(code, p)));
      const strip = (v) => JSON.stringify({ room: v.room, game: v.game, players: v.players.map((p) => [p.id, p.seat, p.isHost]) });
      if (!views.every((v) => strip(v) === strip(views[0]))) consistent = false;
      if (views.map((v) => v.me.id).join() !== [A, B, C, D].map((p) => p.playerId).join()) consistent = false;
    }
    if (turns === 20 && !rejoinedMidGame) {
      rejoinedMidGame = true;
      const before = JSON.stringify((await state(code, A)).game); // /state, not the move response (built from the patch)
      const re = await call(`/api/rooms/${code}/join`, { body: { nickname: "Ana", password: "pw", deviceId: A.deviceId } });
      check(re.status === 200 && re.data.playerId === A.playerId && re.data.seat === 0, "Ana rejoins mid-game from the same device, keeps white");
      const old = A.token;
      A.token = re.data.token;
      check((await call(`/api/rooms/${code}/roll`, { token: old, body: {} })).status === 401, "Ana's old token cannot play");
      s = await state(code, A);
      check(JSON.stringify(s.game) === before && s.room.hostPlayerId === A.playerId, "same game, still host after rejoin");
    }
  }
  check(s.room.status === "finished" && s.game.phase === "over" && s.game.winner !== null, `game over after ${turns} turns (${passes} passes, ${hitsSeen} hits)`);
  check(consistent, "all 4 members see the same room and game, each their own `me`");
  const w = s.game.winner;
  check(s.game.board.off[w] === 15 && (s.game.points === (s.game.board.off[1 - w] === 0 ? 2 : 1)), `winner ${w === 0 ? "Alb" : "Negru"} bore off 15, ${s.game.points} point(s)`);
  check(s.room.score[w] === s.game.points && s.room.score[1 - w] === 0, `score ${s.room.score.join("-")}`);
  check((await call(`/api/rooms/${code}/move`, { token: bySeat[w].token, body: { moves: [] } })).status === 409, "move after the game = 409");
  check((await call(`/api/rooms/${code}/lobby`, { token: B.token, body: {} })).status === 403, "non-host lobby = 403");

  console.log("Next game, resign, match over");
  check((await call(`/api/rooms/${code}/next`, { token: C.token, body: {} })).status === 403, "spectator next = 403");
  check((await call(`/api/rooms/${code}/next`, { token: B.token, body: {} })).status === 200, "Bob starts game 2");
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: {} })).status === 409, "next twice = 409");
  s = await state(code, A);
  check(s.game.gameNo === 2 && s.room.status === "playing", "game 2 running, score kept");
  check((await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} })).data.queued === true, "Cris queues for the next round mid-game");
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === true, "Dan queues too");
  s = await state(code, A);
  const cq = s.players.find((p) => p.id === C.playerId);
  const dq = s.players.find((p) => p.id === D.playerId);
  check(cq?.queued && cq.queuePosition === 1 && dq?.queued && dq.queuePosition === 2, "players see the queue in order (Cris 1, Dan 2)");
  check(cq?.seat === null && s.room.status === "playing", "queueing mid-game takes no seat");
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === false, "Dan leaves the queue");
  const loser = 1 - w;
  check((await call(`/api/rooms/${code}/resign`, { token: C.token, body: {} })).status === 403, "spectator resign = 403");
  check((await call(`/api/rooms/${code}/resign`, { token: bySeat[loser].token, body: {} })).status === 200, "loser of game 1 resigns");
  s = await state(code, A);
  check(s.game.winner === w && s.game.points === 2 && s.room.score[w] >= 3, `resign before bearing off = marț (2), score ${s.room.score.join("-")}`);
  check((await call(`/api/rooms/${code}/next`, { token: A.token, body: {} })).status === 409, "next after the match is won = 409");
  check((await call(`/api/rooms/${code}/lobby`, { token: A.token, body: {} })).status === 200, "host back to the lobby");
  s = await state(code, B);
  check(s.room.status === "lobby" && s.game === null && s.room.score.join() === "0,0", "lobby, score reset");
  check(s.players.find((p) => p.id === C.playerId)?.seat === null, "both seats taken: queued Cris stays a spectator");
  check((await call(`/api/rooms/${code}/reorder`, { token: B.token, body: { order: [B.playerId, A.playerId] } })).status === 403, "non-host reorder = 403");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [B.playerId, C.playerId] } })).status === 400, "reorder with a spectator = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [B.playerId, A.playerId] } })).status === 200, "host swaps the colours");
  s = await state(code, A);
  check(s.me.seat === 1 && s.players.find((p) => p.id === B.playerId)?.seat === 0, "Bob is White, Ana is Black");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, B.playerId] } })).status === 200, "host swaps them back");

  console.log("Kick with Ignoră, leave mid-match");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "new match");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: A.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicking self = 400");
  const k1 = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  check(k1.data.pending === true, "kick of a seated player mid-game is pending");
  s = await state(code, B);
  check(s.me.kickRemainingMs > 0, "Bob sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: B.token, body: {} })).status === 200, "Bob presses Ignoră");
  check((await state(code, B)).me.kickRemainingMs === null, "kick cleared");
  const kD = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } });
  check(kD.status === 200 && !kD.data.pending, "spectator kick is immediate");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "kicked spectator loses access");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  await sleep(12_800);
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "pending kick enforced after 12 s");
  s = await state(code, A);
  check(s.room.status === "lobby" && s.game === null && s.players.length === 2, "match abandoned, back to the lobby");
  const cNow = s.players.find((p) => p.id === C.playerId);
  check(cNow?.seat === 1 && !cNow.queued, "queued Cris took Bob's free seat");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: B.deviceId } })).data.seat === null, "kicked Bob can join again (spectator: both seats taken)");

  console.log("Cleanup");
  // Bob re-joined after the kick with a new token: reclaim it (same device) and leave with it.
  for (const p of [C]) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const bobNow = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: B.deviceId } });
  if (bobNow.data.token) await call(`/api/rooms/${code}/leave`, { token: bobNow.data.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  check(!(await call("/api/rooms")).data.rooms?.some((x) => x.code === code), "room no longer listed");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/backgammon_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
