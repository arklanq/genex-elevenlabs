import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

/** ElevenLabs' REST root. */
const API = "https://api.elevenlabs.io";
/** How long one generation may take; Studio ends a plugin call after 190 s. */
const CALL_TIMEOUT_MS = 180_000;
/** How long a free read (plan, voices) may take, under the panel's 60 s wait. */
const READ_TIMEOUT_MS = 30_000;
/** The largest audio file the plugin accepts. */
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
/** How many voices one search returns, and how many recent files the index keeps. */
const VOICE_PAGE = 20;
const INDEX_SIZE = 50;
const INDEX_ID = "index";
/** How much of the key's end the panel shows, so the user can tell keys apart. */
const KEY_HINT_CHARS = 4;
const DEFAULT_FORMAT = "mp3_44100_128";
/** Formats a browser game can play, by codec prefix, with their file extension. */
const FORMAT_EXTENSIONS = { mp3: ".mp3", wav: ".wav", opus: ".opus" };
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A key a header can carry: printable ASCII without spaces. */
const KEY_SHAPE = /^[\x21-\x7e]+$/;
/** ElevenLabs answers a valid key that lacks one permission with this status. */
const MISSING_PERMISSIONS = "missing_permissions";

const Operation = { Speech: "speech", Sfx: "sfx", Music: "music" };
/** Fields the plugin sets itself; an agent's options may not override them. */
const RESERVED_OPTIONS = ["text", "prompt", "output_format", "composition_plan"];

const MESSAGE = {
  Locked: "The ElevenLabs key is locked or not set. Open Plugins → ElevenLabs and press Connect.",
  ProjectRequired: "Open a game first.",
  UnknownOperation: (op) => `Unknown operation ${op}. Use ${Object.values(Operation).join(", ")}.`,
  TextRequired: "speech needs text and voice (a voiceId from elevenlabs__voices).",
  PromptRequired: (op) => `${op} needs a prompt.`,
  BadVoice: "voice must be a voiceId such as JBFqnCBsd6RMkjVDRZzb.",
  BadName: "name must be lowercase letters, digits and dashes, at most 40 characters.",
  BadFormat: "output_format must start with mp3_, wav_ or opus_.",
  BadKey: "That does not look like an ElevenLabs API key. Copy it again from elevenlabs.io.",
  BadOptions: "options must be a JSON object.",
  TooLarge: "The ElevenLabs answer is larger than 100 MiB.",
  NoPermission: "This key cannot read the plan; generation may still work.",
  UnknownAction: "Unknown ElevenLabs action.",
};

/**
 * Read the unlocked ElevenLabs key from the host's memory lease.
 * @param {import('./plugin-sdk/index.d.ts').PluginContext} ctx
 */
async function sessionKey(ctx) {
  const key = await ctx.host("credentials.session");
  if (!key) throw new Error(MESSAGE.Locked);
  return key;
}

/** An ElevenLabs error, keeping its status code so callers can tell a missing permission apart. */
class ElevenLabsError extends Error {
  /**
   * @param {number} status
   * @param {unknown} detail
   */
  constructor(status, detail) {
    super(`ElevenLabs ${status}: ${describe(detail)}`);
    /** @public */
    this.status = typeof detail === "object" && detail ? /** @type {any} */ (detail).status : undefined;
  }
}

/** ElevenLabs puts the reason in `detail`: an object, a list of field errors or plain text. */
function describe(detail) {
  if (Array.isArray(detail)) return detail.map((d) => `${(d.loc ?? []).join(".")}: ${d.msg}`).join("; ");
  if (typeof detail === "object" && detail) return /** @type {any} */ (detail).message ?? JSON.stringify(detail);
  return String(detail ?? "request failed");
}

/**
 * Call ElevenLabs and return the raw response, or throw its own message.
 * @param {string} key
 * @param {string} route
 * @param {RequestInit} [init]
 */
async function elevenlabs(key, route, init = {}) {
  // fetch's own error for a bad header value quotes the value, so the key is checked first.
  if (!KEY_SHAPE.test(key)) throw new Error(MESSAGE.BadKey);
  const response = await fetch(`${API}${route}`, {
    ...init,
    headers: { "xi-api-key": key, ...init.headers },
    // A redirect would carry the key header to whatever host it names.
    redirect: "error",
  });
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  throw new ElevenLabsError(response.status, body?.detail ?? response.statusText);
}

/**
 * A free read that ends with the turn or after READ_TIMEOUT_MS.
 * @param {string} key @param {string} route @param {AbortSignal} signal
 */
const getJson = async (key, route, signal) =>
  (await elevenlabs(key, route, { signal: AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) })).json();

/**
 * Normalize `options`, which may arrive as an object or as legacy JSON text.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseOptions(value) {
  if (value === undefined || value === null || value === "") return {};
  const options = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof options !== "object" || Array.isArray(options)) throw new Error(MESSAGE.BadOptions);
  return /** @type {Record<string, unknown>} */ (options);
}

/** @param {unknown} value */
function outputFormat(value) {
  const format = String(value ?? DEFAULT_FORMAT);
  const extension = FORMAT_EXTENSIONS[/** @type {keyof typeof FORMAT_EXTENSIONS} */ (format.split("_")[0])];
  if (!extension || !/^[a-z0-9]+_[a-z0-9_]+$/.test(format)) throw new Error(MESSAGE.BadFormat);
  return { format, extension };
}

/**
 * The ElevenLabs route and JSON body for one generate call.
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>} options
 */
function request(args, options) {
  const body = Object.fromEntries(Object.entries(options).filter(([k]) => !RESERVED_OPTIONS.includes(k)));
  const operation = String(args.operation ?? "");
  if (operation === Operation.Speech) {
    if (!args.text || !args.voice) throw new Error(MESSAGE.TextRequired);
    if (!/^[A-Za-z0-9]{1,64}$/.test(String(args.voice))) throw new Error(MESSAGE.BadVoice);
    return { route: `/v1/text-to-speech/${args.voice}`, body: { ...body, text: String(args.text) } };
  }
  if (operation === Operation.Sfx || operation === Operation.Music) {
    if (!args.prompt) throw new Error(MESSAGE.PromptRequired(operation));
    const route = operation === Operation.Sfx ? "/v1/sound-generation" : "/v1/music";
    const field = operation === Operation.Sfx ? "text" : "prompt";
    return { route, body: { ...body, [field]: String(args.prompt) } };
  }
  throw new Error(MESSAGE.UnknownOperation(operation));
}

/**
 * Read an audio answer, refusing one over the size cap as soon as it passes it.
 * @param {Response} response
 */
async function audioBytes(response) {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) throw new Error(MESSAGE.TooLarge);
  if (!response.body) return Buffer.alloc(0);
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    // Leaving the loop early cancels the stream, so the rest is never downloaded.
    if (size > MAX_AUDIO_BYTES) throw new Error(MESSAGE.TooLarge);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Serialize index writes so concurrent calls do not drop each other. */
let indexWrite = Promise.resolve();

/**
 * Remember a delivered file, newest first.
 * @param {import('./plugin-sdk/index.d.ts').PluginContext} ctx
 * @param {Record<string, unknown>} entry
 */
function remember(ctx, entry) {
  const next = indexWrite.then(async () => {
    const index = /** @type {any[]} */ ((await ctx.host("jobs.read", { id: INDEX_ID })) ?? []);
    await ctx.host("jobs.write", { id: INDEX_ID, value: [entry, ...index].slice(0, INDEX_SIZE) });
  });
  indexWrite = next.catch(() => {});
  return next;
}

/**
 * Make one audio file and copy it into the game.
 * @param {import('./plugin-sdk/index.d.ts').PluginContext} ctx
 * @param {string} key
 * @param {Record<string, unknown>} args
 */
async function generate(ctx, key, args) {
  const options = parseOptions(args.options);
  const name = String(args.name || args.operation);
  if (!FILE_NAME.test(name)) throw new Error(MESSAGE.BadName);
  const { format, extension } = outputFormat(options.output_format);
  const { route, body } = request(args, options);
  const response = await elevenlabs(key, `${route}?output_format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  });
  const bytes = await audioBytes(response);
  // ElevenLabs has no job to recover, so the plugin names the delivery itself.
  const jobId = randomUUID();
  const dir = path.join(String(await ctx.host("storage.root")), "downloads", jobId);
  await mkdir(dir, { recursive: true });
  let files;
  try {
    await writeFile(path.join(dir, `${name}${extension}`), bytes);
    files = await ctx.host("assets.deliver", { output: dir, jobId });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const entry = {
    jobId,
    operation: args.operation,
    text: args.text ?? args.prompt,
    files,
    requestId: response.headers.get("request-id") ?? response.headers.get("song-id") ?? undefined,
    characterCost: response.headers.get("character-cost") ?? undefined,
    project: ctx.project,
    createdAt: new Date().toISOString(),
  };
  await ctx.host("jobs.write", { id: jobId, value: entry });
  await remember(ctx, entry);
  return entry;
}

/**
 * Search the account's voices.
 * @param {string} key
 * @param {unknown} search
 * @param {AbortSignal} signal
 */
async function voices(key, search, signal) {
  const query = new URLSearchParams({ page_size: String(VOICE_PAGE) });
  if (search) query.set("search", String(search));
  const data = await getJson(key, `/v2/voices?${query}`, signal);
  return (data.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category,
    labels: v.labels,
    description: v.description,
  }));
}

/**
 * The plan's credit use, or a note when the key cannot read it.
 * @param {string} key @param {AbortSignal} signal
 */
async function plan(key, signal) {
  try {
    const s = await getJson(key, "/v1/user/subscription", signal);
    return {
      tier: s.tier,
      used: s.character_count,
      limit: s.character_limit,
      resetsAt: s.next_character_count_reset_unix
        ? new Date(s.next_character_count_reset_unix * 1000).toISOString()
        : undefined,
    };
  } catch (error) {
    if (error instanceof ElevenLabsError && error.status === MISSING_PERMISSIONS) return { note: MESSAGE.NoPermission };
    return { error: String(error instanceof Error ? error.message : error) };
  }
}

/**
 * The account and recent files, for the agent's status tool and the panel's status action.
 * @param {import('./plugin-sdk/index.d.ts').PluginContext} ctx
 */
async function status(ctx) {
  const key = await ctx.host("credentials.session");
  const index = /** @type {any[]} */ ((await ctx.host("jobs.read", { id: INDEX_ID })) ?? []);
  const jobs = index.filter((job) => !ctx.project || job.project === ctx.project).slice(0, 10);
  if (!key) return { connected: false, message: MESSAGE.Locked, jobs };
  return { connected: true, keyHint: key.slice(-KEY_HINT_CHARS), ...(await plan(key, ctx.signal)), jobs };
}

/** @type {Record<string, (args: Record<string, any>, ctx: import('./plugin-sdk/index.d.ts').PluginContext) => Promise<unknown>>} */
const ACTIONS = {
  status: (_args, ctx) => status(ctx),
  async unlock(_args, ctx) {
    return { connected: !!(await ctx.host("credentials.read")) };
  },
  // Without a key, Connect reuses the saved one; the panel sends a new key as `token`.
  async connect(args, ctx) {
    if (typeof args.token !== "string" || !args.token.trim()) {
      const saved = await ctx.host("credentials.read");
      return saved ? { connected: true } : { connected: false, needsKey: true };
    }
    const token = args.token.trim();
    const answer = await plan(token, ctx.signal);
    if (answer.error) throw new Error(answer.error);
    await ctx.host("credentials.write", { token });
    return { connected: true, ...answer };
  },
  async disconnect(_args, ctx) {
    await ctx.host("credentials.clear");
    return { connected: false };
  },
};

/** @type {import('./plugin-sdk/index.d.ts').Activate} */
export const activate = async () => ({
  async tool(name, args, ctx) {
    if (name === "status") return status(ctx);
    const key = await sessionKey(ctx);
    if (name === "voices") return voices(key, args.search, ctx.signal);
    if (!ctx.project || !ctx.directory) throw new Error(MESSAGE.ProjectRequired);
    return generate(ctx, key, args);
  },
  async action(name, args, ctx) {
    const run = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
    if (!run) throw new Error(MESSAGE.UnknownAction);
    return run(args, ctx);
  },
});
