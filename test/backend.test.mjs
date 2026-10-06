import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { activate } from "../plugin/backend.mjs";

const AUDIO = new Uint8Array([73, 68, 51, 4]);
const VOICE = "JBFqnCBsd6RMkjVDRZzb";

/** A fake Studio host that keeps jobs and the key in memory and copies deliveries into the game. */
function fakeHost(root, game, key = "sk_test") {
  const jobs = new Map();
  const state = { key, saved: key };
  const host = async (method, args) => {
    switch (method) {
      case "credentials.session":
        return state.key;
      case "credentials.read":
        return state.saved;
      case "credentials.write":
        state.saved = state.key = args.token;
        return;
      case "credentials.clear":
        state.saved = state.key = null;
        return;
      case "storage.root":
        return root;
      case "jobs.read":
        return jobs.get(args.id) ?? null;
      case "jobs.write":
        jobs.set(args.id, structuredClone(args.value));
        return true;
      case "assets.deliver": {
        const target = path.join(game, "assets", "elevenlabs", args.jobId);
        await mkdir(target, { recursive: true });
        const files = (await readdir(args.output)).sort();
        for (const f of files) await copyFile(path.join(args.output, f), path.join(target, f));
        return files.map((f) => `assets/elevenlabs/${args.jobId}/${f}`);
      }
      default:
        throw new Error(`unexpected host call ${method}`);
    }
  };
  const ctx = { project: "demo", directory: game, threadId: "t", callId: 1, signal: new AbortController().signal, host };
  return { ctx, jobs, state };
}

/** Route fetch to canned ElevenLabs answers. */
function fakeElevenLabs({ subscription = { status: 200 } } = {}) {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, method: init.method ?? "GET", body: init.body && JSON.parse(init.body), key: init.headers?.["xi-api-key"] });
    if (url.pathname === "/v1/user/subscription") {
      if (subscription.status !== 200)
        return new Response(JSON.stringify({ detail: subscription.detail }), { status: subscription.status });
      return Response.json({ tier: "creator", character_count: 1200, character_limit: 100000, next_character_count_reset_unix: 1790000000 });
    }
    if (url.pathname === "/v2/voices")
      return Response.json({ voices: [{ voice_id: VOICE, name: "George", category: "premade", labels: { accent: "british" } }] });
    if (url.pathname.startsWith("/v1/text-to-speech/") || url.pathname === "/v1/sound-generation" || url.pathname === "/v1/music")
      return new Response(AUDIO, { headers: { "request-id": "req-1", "character-cost": "42" } });
    return new Response("{}", { status: 404 });
  };
  return requests;
}

const realFetch = globalThis.fetch;
let root;
let game;
beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "elevenlabs-plugin-"));
  root = path.join(base, "storage");
  game = path.join(base, "game");
  await mkdir(root);
  await mkdir(game);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("speech sends the text to the chosen voice and delivers the audio file into the game", async () => {
  const requests = fakeElevenLabs();
  const { ctx, jobs } = fakeHost(root, game);
  const plugin = await activate(/** @type {any} */ ({}));
  const result = await plugin.tool(
    "generate",
    { operation: "speech", text: "Welcome, traveller.", voice: VOICE, name: "intro-line", options: '{"model_id":"eleven_v3","text":"x"}' },
    ctx,
  );

  const call = requests.at(-1);
  assert.equal(call.url.pathname, `/v1/text-to-speech/${VOICE}`);
  assert.equal(call.url.searchParams.get("output_format"), "mp3_44100_128");
  assert.deepEqual(call.body, { model_id: "eleven_v3", text: "Welcome, traveller." });
  assert.equal(call.key, "sk_test");
  assert.equal(result.files.length, 1);
  assert.match(result.files[0], /^assets\/elevenlabs\/[a-f0-9-]{36}\/intro-line\.mp3$/);
  assert.deepEqual(new Uint8Array(await readFile(path.join(game, result.files[0]))), AUDIO);
  assert.equal(result.characterCost, "42");
  assert.equal(jobs.get("index")[0].jobId, result.jobId);
  assert.deepEqual(await readdir(path.join(root, "downloads")), [], "staging copy removed");
});

test("sfx and music put the prompt in the field each endpoint expects", async () => {
  const requests = fakeElevenLabs();
  const { ctx } = fakeHost(root, game);
  const plugin = await activate(/** @type {any} */ ({}));
  await plugin.tool("generate", { operation: "sfx", prompt: "wooden door creak", options: { duration_seconds: 2, loop: false } }, ctx);
  await plugin.tool("generate", { operation: "music", prompt: "calm forest theme", name: "forest", options: { output_format: "wav_44100" } }, ctx);

  assert.equal(requests[0].url.pathname, "/v1/sound-generation");
  assert.deepEqual(requests[0].body, { duration_seconds: 2, loop: false, text: "wooden door creak" });
  assert.equal(requests[1].url.pathname, "/v1/music");
  assert.deepEqual(requests[1].body, { prompt: "calm forest theme" });
  assert.equal(requests[1].url.searchParams.get("output_format"), "wav_44100");
});

test("hostile names, voices and formats are refused before anything is sent or written", async () => {
  const requests = fakeElevenLabs();
  const { ctx } = fakeHost(root, game);
  const plugin = await activate(/** @type {any} */ ({}));
  const cases = [
    [{ operation: "speech", text: "hi", voice: VOICE, name: "../escape" }, /name must be/],
    [{ operation: "speech", text: "hi", voice: VOICE, name: "Upper" }, /name must be/],
    [{ operation: "speech", text: "hi", voice: "../../v1/user" }, /voiceId/],
    [{ operation: "speech", text: "hi", voice: VOICE, options: { output_format: "mp3_44100&x=1" } }, /output_format/],
    [{ operation: "sfx", prompt: "x", options: { output_format: "pcm_16000" } }, /output_format/],
    [{ operation: "speech", text: "hi" }, /needs text and voice/],
    [{ operation: "music" }, /needs a prompt/],
    [{ operation: "clone" }, /Unknown operation/],
    [{ operation: "sfx", prompt: "x", options: "[1]" }, /JSON object/],
  ];
  for (const [args, error] of cases) await assert.rejects(plugin.tool("generate", args, ctx), error);
  assert.equal(requests.length, 0);
  await assert.rejects(readdir(path.join(root, "downloads")), { code: "ENOENT" });
});

test("voices searches the account and maps the fields", async () => {
  const requests = fakeElevenLabs();
  const { ctx } = fakeHost(root, game);
  const plugin = await activate(/** @type {any} */ ({}));
  const list = await plugin.tool("voices", { search: "british" }, ctx);
  assert.equal(requests[0].url.searchParams.get("search"), "british");
  assert.deepEqual(list[0], { voiceId: VOICE, name: "George", category: "premade", labels: { accent: "british" }, description: undefined });
});

test("tools fail with a clear message while the key is locked, and status still answers", async () => {
  fakeElevenLabs();
  const { ctx } = fakeHost(root, game, null);
  const plugin = await activate(/** @type {any} */ ({}));
  await assert.rejects(plugin.tool("generate", { operation: "sfx", prompt: "x" }, ctx), /press Connect/);
  assert.equal((await plugin.tool("status", {}, ctx)).connected, false);
});

test("connect saves only a key ElevenLabs accepts, and disconnect clears it", async () => {
  fakeElevenLabs({ subscription: { status: 401, detail: { status: "invalid_api_key", message: "Invalid API key" } } });
  const { ctx, state } = fakeHost(root, game, null);
  const plugin = await activate(/** @type {any} */ ({}));
  assert.deepEqual(await plugin.action("connect", {}, ctx), { connected: false, needsKey: true });
  await assert.rejects(plugin.action("connect", { token: "sk_bad" }, ctx), /Invalid API key/);
  assert.equal(state.saved, null);

  fakeElevenLabs();
  const answer = await plugin.action("connect", { token: " sk_good " }, ctx);
  assert.equal(answer.tier, "creator");
  assert.equal(state.saved, "sk_good");

  await plugin.action("disconnect", {}, ctx);
  assert.equal(state.saved, null);
});

test("a valid key without permission to read the plan is still saved", async () => {
  fakeElevenLabs({ subscription: { status: 401, detail: { status: "missing_permissions", message: "missing user_read" } } });
  const { ctx, state } = fakeHost(root, game, null);
  const plugin = await activate(/** @type {any} */ ({}));
  const answer = await plugin.action("connect", { token: "sk_scoped" }, ctx);
  assert.equal(answer.connected, true);
  assert.match(answer.note, /cannot read the plan/);
  assert.equal(state.saved, "sk_scoped");
});

test("status shows only the key's last four characters", async () => {
  fakeElevenLabs();
  const { ctx } = fakeHost(root, game, "sk_secreta81d");
  const plugin = await activate(/** @type {any} */ ({}));
  const state = await plugin.tool("status", {}, ctx);
  assert.equal(state.keyHint, "a81d");
  assert.doesNotMatch(JSON.stringify(state), /secret/);
});
